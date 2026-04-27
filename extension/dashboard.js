// ============================================================
// 3CX Partner PRM  |  dashboard.js
// ============================================================

const $  = id => document.getElementById(id);
const esc = s => String(s??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');

// ── Edition normalizer ───────────────────────────────────────────────────────
// Strips "3CX " prefix and "(Annual)" / "(Perpetual)" suffix. Returns both
// full and short forms. One place to maintain; every tier badge uses this.
function editionOf(product) {
  if (!product) return { full: 'Other', short: 'OTH', color: '#5a6270', bg: '#f0f2f5' };
  const p = String(product)
    .replace(/^3CX\s+/i, '')
    .replace(/\s*\((?:Annual|Perpetual)\)\s*$/i, '')
    .trim();
  const table = [
    // full name patterns → { full, short, color, bg }
    [/Enterprise/i,   { full: 'Enterprise',   short: 'ENT',  color: '#6f42c1', bg: '#f0ebff' }],
    [/Professional/i, { full: 'Professional', short: 'PRO',  color: '#0077b6', bg: '#e3f2fd' }],
    [/Standard/i,     { full: 'Standard',     short: 'STD',  color: '#00838f', bg: '#e0f7fa' }],
    [/SMB/i,          { full: 'SMB',          short: 'SMB',  color: '#8e44ad', bg: '#f4ecf9' }],
    [/Basic/i,        { full: 'Basic',        short: 'BSC',  color: '#5a6270', bg: '#f0f2f5' }],
    [/Trial/i,        { full: 'Trial',        short: 'TRL',  color: '#e67e00', bg: '#fff3e0' }],
    [/Free/i,         { full: 'Free',         short: 'FREE', color: '#2d9e5f', bg: '#e8f5ee' }],
  ];
  for (const [re, v] of table) if (re.test(p)) return v;
  return { full: p || 'Other', short: (p.substring(0,3) || 'OTH').toUpperCase(),
           color: '#5a6270', bg: '#f0f2f5' };
}

// ── License key URL builder ─────────────────────────────────────────────────
function keyEditUrl(keyId) {
  return keyId ? `https://staff.3cx.com/key/edit.aspx?i=${encodeURIComponent(keyId)}` : '';
}
function orderViewUrl(orderId) {
  return orderId ? `https://staff.3cx.com/order/view.aspx?i=${encodeURIComponent(orderId)}` : '';
}

// SW-safe message helper — handles MV3 service worker termination gracefully
// and detects when the extension context has been invalidated (user reloaded
// the extension while this tab was still open).
let __contextInvalidatedShown = false;
function showContextInvalidatedBanner() {
  if (__contextInvalidatedShown) return;
  __contextInvalidatedShown = true;
  const bar = document.createElement('div');
  bar.style.cssText = 'position:fixed;top:0;left:0;right:0;z-index:9999;padding:10px 16px;background:#dc3545;color:#fff;font:600 12px sans-serif;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.3);';
  bar.innerHTML = `Extension was reloaded — this tab is out of sync. <a href="#" id="__reloadLink" style="color:#fff;text-decoration:underline;margin-left:8px">Refresh tab</a>`;
  document.body.appendChild(bar);
  document.getElementById('__reloadLink').addEventListener('click', (e) => {
    e.preventDefault();
    location.reload();
  });
}
function msg(type, extra = {}) {
  return new Promise(resolve => {
    // Detect an invalidated extension context up front — chrome.runtime.id
    // becomes undefined when the extension is reloaded.
    if (!chrome.runtime?.id) {
      showContextInvalidatedBanner();
      resolve(null);
      return;
    }
    try {
      chrome.runtime.sendMessage({ type, ...extra }, r => {
        const err = chrome.runtime.lastError;
        if (err) {
          if (/context invalidated/i.test(err.message || '')) {
            showContextInvalidatedBanner();
          } else {
            console.warn('PRM SW:', err.message);
          }
          resolve(null);
        } else {
          resolve(r);
        }
      });
    } catch(e) {
      if (/context invalidated/i.test(e.message || '')) {
        showContextInvalidatedBanner();
      } else {
        console.warn('PRM msg error:', e);
      }
      resolve(null);
    }
  });
}

// ── State ─────────────────────────────────────────────────────────────────────
let state = {
  partner:     null,   // current full partner360 object
  partnerList: [],     // sidebar list
  sheetData:   [],     // Gmail classifications from Sheet
  activeTab:   'overview',
  filters:     { levelId: '', levelName: '', agent: '', search: '' },
};

// ── Init ──────────────────────────────────────────────────────────────────────
async function init() {
  await loadSettings();
  checkSession();
  loadPartnerList();
  loadSheetFromStorage();
  setupFilterChips();
  setupSearch();
  setupSettings();

  // Progress from background
  chrome.runtime.onMessage.addListener(m => {
    if (m.type==='partner360_status') setAI(`Loading ${m.payload}…`, false);
    if (m.type==='sheet_synced') { loadSheetFromStorage(); }
  });
}

// ── Settings ──────────────────────────────────────────────────────────────────
async function loadSettings() {
  const d = await chrome.storage.local.get(['openaiKey','sheetId']);
  if (d.openaiKey) $('cfgOpenai').value = d.openaiKey;
  if (d.sheetId)   $('cfgSheet').value  = d.sheetId;
}

function setupSettings() {
  $('btnSave').addEventListener('click', async () => {
    await chrome.storage.local.set({
      openaiKey: $('cfgOpenai').value.trim(),
      sheetId:   $('cfgSheet').value.trim()
    });
    $('btnSave').textContent = '✓ Saved';
    setTimeout(() => $('btnSave').textContent = 'Save Settings', 1500);
  });

  $('btnSync').addEventListener('click', async () => {
    $('btnSync').textContent = '↻ Syncing…';
    await msg('SYNC_SHEET');
    await loadSheetFromStorage();
    $('btnSync').textContent = '↻ Sync';
  });

  $('btnGmail').addEventListener('click', () => {
    state.activeTab = 'comms';
    if (state.partner) renderMain();
  });
}

// ── Session health ─────────────────────────────────────────────────────────────
async function checkSession() {
  const r = await Promise.race([
    msg('CHECK_SESSION'),
    new Promise(res => setTimeout(() => res(null), 3000))
  ]);
  const dot = $('sessionDot');
  if (!r?.ok) {
    dot.style.background = '#e05c5c';
    dot.title = 'Not signed in or session check failed';
    if (!state.partner) {
      $('main').innerHTML = `<div class="loading" style="margin:auto">
        <div style="color:#e05c5c;font-size:14px;margin-bottom:12px">🔒 Not signed in</div>
        <a href="https://staff.3cx.com" target="_blank"
           style="color:#4a9eff;font-size:13px">Open staff.3cx.com to log in →</a>
      </div>`;
    }
    return;
  }
  const h = r.result;
  if (h.healthy) {
    dot.style.background = '#4caf82';
    dot.title = h.sessionInfo
      ? `${h.sessionInfo.email} — expires ${h.sessionInfo.expiresAt}`
      : 'Signed in';
  } else {
    dot.style.background = '#e05c5c';
    const reason = h.issues?.[0]?.msg ?? 'Session issue';
    dot.title = reason;
    // Show banner in main area if not loaded yet
    if (!state.partner) {
      $('main').innerHTML = `<div class="loading" style="margin:auto;color:#e05c5c">
        🔒 ${esc(reason)}<br><br>
        <a href="https://staff.3cx.com" target="_blank" style="color:#4a9eff">
          Open staff.3cx.com to log in
        </a>
      </div>`;
    }
  }
  // Debug info on hover (shift+click dot to log cookies)
  dot.addEventListener('click', e => {
    if (e.shiftKey) console.log('PRM session:', JSON.stringify(h, null, 2));
  }, { once: true });
}

// ── Sheet data ────────────────────────────────────────────────────────────────
async function loadSheetFromStorage() {
  const d = await chrome.storage.local.get(['sheetData']);
  state.sheetData = d.sheetData ?? [];
  if (state.partner) renderMain();
}

// ── Partner list ──────────────────────────────────────────────────────────────
function setupFilterChips() {
  const searchInp = $('sidebarSearch');
  const levelRow  = $('levelChipRow');
  const agentRow  = $('agentChipRow');
  const agentWrap = $('agentChips');
  if (!levelRow && !searchInp) return;

  // Level chips — server-side fetch (except "All" which uses cached unfiltered)
  levelRow?.querySelectorAll('.chip').forEach(chip => {
    chip.addEventListener('click', async () => {
      const levelId   = chip.dataset.level || '';
      const levelName = chip.textContent.trim();
      // Optimistic UI
      levelRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      state.filters.levelId   = levelId;
      state.filters.levelName = levelId ? levelName : '';
      state.filters.agent     = '';  // reset agent on level change (list changes)
      $('partnerList').innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';

      const msgType  = levelId ? 'FETCH_PARTNER_LIST_FILTERED' : 'FETCH_PARTNER_LIST';
      const msgExtra = levelId ? { levelId } : {};
      const r = await msg(msgType, msgExtra);
      if (r?.ok && r.result?.length) {
        state.partnerList = r.result;
        chrome.storage.local.set({ partnerCache: r.result });
        if (searchInp) searchInp.value = '';
        rebuildAgentChips();
        renderSidebar();
        updateSidebarHeader(r.result.length);
      } else {
        const err = r?.error
          ? `Filter failed: ${r.error}`
          : (levelId ? 'No partners found for this level' : 'Could not load partner list');
        showSidebarManualEntry(err);
      }
    });
  });

  // Agent chips — client-side filter (agents rebuilt whenever the partner list changes)
  agentRow?.addEventListener('click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    agentRow.querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
    state.filters.agent = chip.dataset.agent || '';
    renderSidebar();
  });

  // Text search — client-side
  let debounce;
  searchInp?.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      state.filters.search = searchInp.value.trim().toLowerCase();
      renderSidebar();
    }, 150);
  });
}

// Rebuild agent chips from currently-loaded partner list
function rebuildAgentChips() {
  const agentRow  = $('agentChipRow');
  const agentWrap = $('agentChips');
  if (!agentRow || !agentWrap) return;

  const counts = {};
  state.partnerList.forEach(p => {
    const a = p.agent ?? p['Team Agent'] ?? '';
    if (a) counts[a] = (counts[a] ?? 0) + 1;
  });
  const agents = Object.entries(counts).sort((a,b) => b[1] - a[1]);

  if (!agents.length) { agentWrap.style.display = 'none'; return; }

  agentWrap.style.display = '';
  agentRow.innerHTML =
    `<div class="chip active" data-agent="">All<span class="count">${state.partnerList.length}</span></div>` +
    agents.map(([name, n]) =>
      `<div class="chip" data-agent="${esc(name)}" title="${esc(name)}">${esc(shortAgentName(name))}<span class="count">${n}</span></div>`
    ).join('');
}

// Short form for agent chip label — first name only
function shortAgentName(full) {
  return String(full).split(/\s+/)[0] || full;
}

function updateSidebarHeader(n) {
  const header = document.querySelector('.sidebar-header');
  if (!header) return;
  header.textContent = state.filters.levelName
    ? `Partners — ${state.filters.levelName} (${n})`
    : `Partners (${n})`;
}

async function loadPartnerList() {
  $('partnerList').innerHTML = '<div class="loading"><span class="spinner"></span>Loading…</div>';
  try {
    const r = await msg('FETCH_PARTNER_LIST');
    console.log('PRM FETCH_PARTNER_LIST result:', r);
    if (r?.ok && r.result?.length) {
      state.partnerList = r.result;
      rebuildAgentChips();
      renderSidebar();
      chrome.storage.local.set({ partnerCache: r.result });
      const hdr = document.querySelector('.sidebar-header');
      if (hdr) hdr.textContent = `Partners (${r.result.length})`;
    } else {
      const err = r?.error ?? 'Partner list unavailable — enter ID directly';
      console.warn('PRM partner list failed:', err);
      showSidebarManualEntry(err);
    }
  } catch(e) {
    console.error('PRM partner list exception:', e);
    showSidebarManualEntry(e.message);
  }
}

function showSidebarManualEntry(reason) {
  $('partnerList').innerHTML = `
    <div style="padding:12px 14px">
      <div style="font-size:11px;color:var(--dim);margin-bottom:10px;line-height:1.5">
        ${esc(reason)}<br><br>Enter Partner ID directly:
      </div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <input id="directId" type="text" placeholder="e.g. 35424"
          style="flex:1;background:var(--s2);border:1px solid var(--b);border-radius:5px;
                 color:var(--t);font:12px var(--font);padding:5px 8px;outline:none" />
        <div id="btnDirectLoad"
          style="padding:5px 10px;background:var(--a);border-radius:5px;
                 color:#fff;font:600 11px var(--font);cursor:pointer;flex-shrink:0">
          Go
        </div>
      </div>
      <div id="btnDebugFetch"
        style="padding:4px 8px;background:var(--b);border-radius:5px;
               color:var(--dim);font:11px var(--font);cursor:pointer;text-align:center">
        🔍 Debug: fetch customers.aspx
      </div>
      <div id="debugOut" style="margin-top:8px;font-size:10px;color:var(--dim);
        word-break:break-all;max-height:200px;overflow-y:auto;line-height:1.4"></div>
    </div>
  `;
  $('directId')?.addEventListener('keydown', e => {
    if (e.key === 'Enter') doDirectLoad();
  });
  $('btnDirectLoad')?.addEventListener('click', doDirectLoad);
  $('btnDebugFetch')?.addEventListener('click', async () => {
    $('debugOut').textContent = 'Fetching…';
    const r = await msg('DEBUG_FETCH_CUSTOMERS');
    if (r?.ok) {
      const info = r.result;
      $('debugOut').innerHTML = `
        <b>Partners found:</b> ${info.partnersFound}<br>
        <b>Has Main_dg:</b> ${info.hasMainDg}<br>
        <b>Sample:</b><br>
        <pre style="font-size:9px;white-space:pre-wrap;color:var(--m)">${esc(JSON.stringify(info.sample, null, 2))}</pre>
      `;
      if (info.partnersFound > 0) {
        $('debugOut').innerHTML += '<b style="color:var(--green)">✅ Parser working — reload extension to apply</b>';
      }
    } else {
      $('debugOut').textContent = 'Error: ' + (r?.error ?? 'unknown');
    }
  });
}

function doDirectLoad() {
  const id = $('directId')?.value?.trim();
  if (id) loadPartner(id);
}

function renderSidebar(_legacyFilter) {
  // Combine agent filter + search text
  const search = (_legacyFilter ?? state.filters.search ?? '').toLowerCase();
  const agent  = state.filters.agent ?? '';
  let list = state.partnerList;
  if (agent)  list = list.filter(p => (p.agent ?? p['Team Agent'] ?? '') === agent);
  if (search) list = list.filter(p => JSON.stringify(p).toLowerCase().includes(search));

  if (!list.length) { $('partnerList').innerHTML = '<div class="empty">No results</div>'; return; }

  // Try to find common fields for name/id — handle dynamic column names
  $('partnerList').innerHTML = list.slice(0,100).map(p => {
    const nameKey = Object.keys(p).find(k => k.toLowerCase().includes('compan') || k.toLowerCase().includes('name') || k==='Company');
    const idKey   = Object.keys(p).find(k => k.toLowerCase().includes('id') || k==='ID');
    const name    = nameKey ? p[nameKey] : Object.values(p)[0] ?? '—';
    const id      = idKey   ? p[idKey]   : '';
    const isActive = state.partner?.id && (id===String(state.partner.id)||name===state.partner.company);
    const cert     = p.cert ?? p['Cert'] ?? '';
    const country  = p.country ?? p['Country'] ?? '';
    const certColor = { ADV:'#2d9e5f', BAS:'#5a6270', PRE:'#0077b6', EXP:'#6f42c1' }[cert] ?? '#9ba3ae';
    return `<div class="pitem${isActive?' active':''}" data-id="${esc(id)}" data-name="${esc(name)}">
      <div class="pitem-name">${esc(name)}</div>
      <div class="pitem-meta">
        <span style="color:var(--dim)">#${esc(id)}</span>
        ${cert ? `<span style="color:${certColor};font-weight:600;margin-left:6px">${esc(cert)}</span>` : ''}
        ${country ? `<span style="color:var(--dim);margin-left:4px">${esc(country)}</span>` : ''}
      </div>
    </div>`;
  }).join('');

  $('partnerList').querySelectorAll('.pitem').forEach(el => {
    el.addEventListener('click', () => {
      const id = el.dataset.id;
      if (id) loadPartner(id);
    });
  });
}

// ── Search ────────────────────────────────────────────────────────────────────
function setupSearch() {
  const input = $('searchInput'), drop = $('searchDrop');
  if (!input || !drop) return;
  let debounce;

  input.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      const q = input.value.trim();
      if (!q) { drop.classList.remove('open'); renderSidebar(); return; }

      if (state.partnerList.length) {
        const results = state.partnerList.filter(p =>
          JSON.stringify(p).toLowerCase().includes(q.toLowerCase())
        ).slice(0,10);

        drop.innerHTML = results.map(p => {
          const nameKey = Object.keys(p).find(k=>k.toLowerCase().includes('compan')||k.toLowerCase().includes('name'));
          const idKey   = Object.keys(p).find(k=>k.toLowerCase().includes('id'));
          const name = nameKey ? p[nameKey] : Object.values(p)[0]??'—';
          const id   = idKey   ? p[idKey]   : '';
          return `<div class="sditem" data-id="${esc(id)}"><b>${esc(name)}</b><span class="sid">#${esc(id)}</span></div>`;
        }).join('') || '<div class="sditem">No results</div>';
        drop.classList.add('open');

        drop.querySelectorAll('.sditem[data-id]').forEach(el =>
          el.addEventListener('click', () => { drop.classList.remove('open'); input.value=''; loadPartner(el.dataset.id); })
        );
      } else if (q.length >= 3) {
        // Direct ID or name lookup — always show even with empty list
        drop.innerHTML = `<div class="sditem" data-id="${esc(q)}">
          ${/^\d+$/.test(q) ? `Load partner <b>#${esc(q)}</b>` : `Search for <b>${esc(q)}</b>`}
        </div>`;
        drop.classList.add('open');
        drop.querySelector('.sditem').addEventListener('click', () => {
          drop.classList.remove('open'); input.value='';
          loadPartner(q);
        });
      }
    }, 200);
  });

  document.addEventListener('click', e => { if (!e.target.closest('.search-wrap')) drop.classList.remove('open'); });
}

// ── Load partner ──────────────────────────────────────────────────────────────
async function loadPartner(partnerId) {
  $('main').innerHTML = '<div class="loading" style="margin:auto"><span class="spinner"></span>Loading partner data…</div>';
  setAI('Fetching partner data…', false);
  renderSidebar(); // highlight selected

  const r = await msg('FETCH_PARTNER360', { partnerId });
  if (!r?.ok) {
    $('main').innerHTML = `<div class="loading" style="margin:auto;color:#e05c5c">❌ ${esc(r?.error??'Failed to load')}</div>`;
    return;
  }

  state.partner    = r.result;
  state.activeTab  = 'overview';
  renderMain();
  renderSidebar();

  // Async AI analysis
  generateAI();
}

// ── Render main ───────────────────────────────────────────────────────────────
function renderMain() {
  const p = state.partner;
  if (!p) return;

  const tier      = detectTier(p);
  const initials  = p.company.split(' ').map(w=>w[0]).join('').substring(0,2).toUpperCase();
  const health    = computeHealth(p);
  const commsForPartner = state.sheetData.filter(row =>
    row.partner_id===String(p.id) || row.sender?.toLowerCase().includes(p.email?.split('@')[1]??'NOEMAIL')
  );

  $('main').innerHTML = `
    <!-- Partner header -->
    <div class="p-header">
      <div class="p-avatar">${esc(initials)}</div>
      <div class="p-info">
        <div class="p-name">${esc(p.company)}</div>
        <div class="p-sub">${esc(p.contact)} · ${esc(p.email)} · ${esc(p.phone)}</div>
      </div>
      <span class="tier-badge tier-${tier.class}">${esc(tier.label)}</span>
      <div class="health-ring">
        <svg width="50" height="50" viewBox="0 0 50 50">
          <circle cx="25" cy="25" r="20" fill="none" stroke="#2a2d36" stroke-width="4"/>
          <circle cx="25" cy="25" r="20" fill="none" stroke="${health.color}" stroke-width="4"
            stroke-dasharray="${(health.score/100)*125.6} 125.6" stroke-linecap="round"/>
        </svg>
        <div class="health-score" style="color:${health.color}">${health.score}</div>
      </div>
      <div class="p-actions">
        <button class="p-btn" data-action="open-note">+ Note</button>
        <button class="p-btn" data-action="copy-email">✉ Email</button>
        <button class="p-btn primary" data-action="generate-ai">✦ Analyse</button>
      </div>
    </div>

    <!-- Pills row: identifiers + status + profile + discounts -->
    <div class="pills-row">
      <!-- Partner IDs -->
      <div class="spill" title="Internal ID (used in URLs)">Internal ID <strong>${esc(String(p.id))}</strong></div>
      ${p.publicId ? `<div class="spill" title="3CX Support/Billing Partner ID (external)">3CX ID <strong>${esc(p.publicId)}</strong></div>` : ''}

      <!-- Status -->
      <div class="spill ${p.enabled?'green':'red'}">${p.enabled?'Active':'Inactive'}</div>

      <!-- Profile -->
      ${p.type     ? `<div class="spill blue" title="Partner Level"><strong>${esc(p.type.replace(/\s*Partner\s*$/i,''))}</strong></div>` : ''}
      ${p.category ? `<div class="spill" title="Partner Category">${esc(p.category)}</div>` : ''}
      ${p.country  ? `<div class="spill" title="Country">${esc(p.country)}</div>`
                    : (p.address ? `<div class="spill">${esc(p.address.split(',').slice(-1)[0].trim())}</div>` : '')}

      <!-- Discounts (only shown if non-zero) -->
      ${(() => {
        const pd = p.discounts ?? {};
        const nz = v => v && String(v).replace(/[^\d.]/g,'') !== '0' && String(v).replace(/[^\d.]/g,'') !== '0.0';
        const parts = [];
        if (nz(pd.product))     parts.push(`P:${esc(pd.product)}%`);
        if (nz(pd.maintenance)) parts.push(`M:${esc(pd.maintenance)}%`);
        if (nz(pd.hosting))     parts.push(`H:${esc(pd.hosting)}%`);
        return parts.length
          ? `<div class="spill blue" title="Product / Maintenance / Hosting discount">Disc <strong>${parts.join(' · ')}</strong></div>`
          : '';
      })()}

      <!-- Extras -->
      ${p.sageId ? `<div class="spill">Sage <strong>${esc(p.sageId)}</strong></div>` : ''}
      ${p.supportPin ? `<div class="spill" title="Phone Support PIN">PIN <strong>${esc(p.supportPin)}</strong></div>` : ''}
      ${commsForPartner.length ? `<div class="spill blue">${commsForPartner.length} emails</div>` : ''}
    </div>

    <!-- Tabs -->
    <div class="tabs" id="tabBar">
      ${['overview','notes','comms','keys','orders','users'].map(t=>
        `<div class="tab${t===state.activeTab?' active':''}" data-tab="${t}">${{
          overview:'Overview', notes:'Notes', comms:'Communications',
          keys:'Keys', orders:'Orders', users:'Users'
        }[t]}</div>`
      ).join('')}
    </div>

    <!-- Tab content -->
    <div class="content" id="tabContent"></div>
  `;

  // Tab switching
  $('tabBar').querySelectorAll('.tab').forEach(tab =>
    tab.addEventListener('click', () => {
      state.activeTab = tab.dataset.tab;
      $('tabBar').querySelectorAll('.tab').forEach(t=>t.classList.toggle('active',t===tab));
      renderTab();
    })
  );

  renderTab();
}

function renderTab() {
  const p = state.partner;
  switch (state.activeTab) {
    case 'overview': renderOverview(p);  break;
    case 'notes':    renderNotes(p);     break;
    case 'comms':    renderComms(p);     break;
    case 'keys':     renderKeys(p);    break;
    case 'orders':   renderOrders(p); break;
    case 'users':    renderUsers(p);   break;
  }
}

// ── Overview tab ──────────────────────────────────────────────────────────────
function renderOverview(p) {
  const notes  = p.tabs?.notesParsed ?? [];
  const keys   = Array.isArray(p.tabs?.keys) ? p.tabs.keys : [];
  const orders = flattenGrids(p.tabs?.orders);
  const comms  = state.sheetData.filter(r =>
    r.partner_id === String(p.id) ||
    (p.email && r.sender?.toLowerCase().includes(p.email.split('@')[1] ?? ''))
  );

  // ── Computed metrics ──────────────────────────────────────────────────────
  const today        = new Date();
  // `keys` includes disabled (retired) keys — good for historical install base.
  // `liveKeys` = currently-active keys — used for install mix, renewals, averages.
  const liveKeys     = keys.filter(k => !k.disabled);
  const disabledKeys = keys.filter(k => k.disabled);
  const customers    = [...new Set(liveKeys.map(k => k.registration).filter(Boolean))];
  const totalKeys    = keys.length;                 // all, for Install Base
  const liveKeyCount = liveKeys.length;             // for display in sub-lines
  const extNums      = liveKeys.map(k => parseInt(k.maxExt) || 0).filter(x => x > 0);
  const largestExt   = extNums.length ? Math.max(...extNums) : 0;
  const avgExt       = extNums.length ? Math.round(extNums.reduce((a,b)=>a+b,0)/extNums.length) : 0;
  console.log(`[overview] keys total=${totalKeys} live=${liveKeyCount} disabled=${disabledKeys.length} customers=${customers.length}`);

  // Install mix by product edition — live keys only (retired keys skew the picture)
  const editionBuckets = {};  // { short: { full, short, color, count } }
  liveKeys.forEach(k => {
    const ed = editionOf(k.product);
    if (!editionBuckets[ed.short]) editionBuckets[ed.short] = { ...ed, count: 0 };
    editionBuckets[ed.short].count++;
  });
  const editions = Object.fromEntries(
    Object.values(editionBuckets).map(b => [b.full, b.count])
  );
  const editionColor = Object.fromEntries(
    Object.values(editionBuckets).map(b => [b.full, b.color])
  );
  const totalEd = Object.values(editions).reduce((a,b)=>a+b,0) || 1;

  // Renewal radar — expiring ≤90 days, sorted ascending (live keys only)
  const withDays = liveKeys.filter(k => k.expiry).map(k => {
    const d = parseKeyDate(k.expiry);
    const days = d ? Math.round((d - today) / 86400000) : null;
    return { ...k, daysLeft: days };
  }).filter(k => k.daysLeft !== null && k.daysLeft <= 90)
    .sort((a, b) => a.daysLeft - b.daysLeft);

  // New deals = keys activated in last 30 days (live keys only — a retired key
  // activated yesterday isn't really a "new deal")
  const ACTIVATION_WINDOW_DAYS = 30;
  const newDeals = liveKeys.filter(k => {
    if (!k.activatedOn) return false;
    const d = parseKeyDate(k.activatedOn);
    return d && (today - d) / 86400000 <= ACTIVATION_WINDOW_DAYS;
  }).sort((a, b) => {
    const da = parseKeyDate(a.activatedOn), db = parseKeyDate(b.activatedOn);
    return (db || 0) - (da || 0);
  }).slice(0, 10);
  console.log(`[overview] new deals (${ACTIVATION_WINDOW_DAYS}d) = ${newDeals.length} (from ${liveKeys.filter(k=>k.activatedOn).length} live keys with activation dates)`);

  // Ongoing deals = keys expiring 91–180 days (renewals)
  const ongoingDeals = liveKeys.filter(k => {
    if (!k.expiry) return false;
    const d = parseKeyDate(k.expiry);
    if (!d) return false;
    const days = Math.round((d - today) / 86400000);
    return days > 90 && days <= 180;
  }).sort((a, b) => {
    const da = parseKeyDate(a.expiry), db = parseKeyDate(b.expiry);
    return (da || 0) - (db || 0);
  }).slice(0, 8);

  // Renewal rate = % of live keys that are not overdue
  const notOverdue  = liveKeys.filter(k => { const d = parseKeyDate(k.expiry); return d && d > today; });
  const renewalRate = liveKeyCount > 0 ? Math.round((notOverdue.length / liveKeyCount) * 100) : 0;

  // Install mix bar helper
  function mixBar(label, count, color) {
    const pct = Math.round((count / totalEd) * 100);
    return `<div style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
        <span style="color:var(--m)">${esc(label)}</span>
        <span style="font-weight:600">${pct}%</span>
      </div>
      <div style="height:5px;background:var(--s2);border-radius:3px;overflow:hidden">
        <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
      </div>
    </div>`;
  }

  // Tier badge — uses short form (PRO/ENT/STD/…) for inline space-constrained spots
  function tierBadge(product, sc) {
    const ed  = editionOf(product);
    const label = sc ? `${esc(sc)}SC ${esc(ed.short)}` : esc(ed.short);
    return `<span style="background:${ed.bg};color:${ed.color};font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;white-space:nowrap">${label}</span>`;
  }

  function statusBadge(days) {
    if (days === null) return '';
    if (days < 0)  return `<span style="background:#ffeaea;color:#dc3545;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px">Overdue</span>`;
    if (days <= 30) return `<span style="background:#fff3e0;color:#e67e00;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px">Urgent</span>`;
    if (days <= 60) return `<span style="background:#fff8e1;color:#996500;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px">Soon</span>`;
    return `<span style="background:#e8f5ee;color:#2d9e5f;font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px">Active</span>`;
  }

  function moodBadge(mood) {
    const m = (mood ?? '').toLowerCase();
    if (m === 'positive') return `<span style="background:#e8f5ee;color:#2d9e5f;font-size:10px;font-weight:700;padding:1px 7px;border-radius:4px">Positive</span>`;
    if (m.includes('risk') || m === 'at_risk') return `<span style="background:#ffeaea;color:#dc3545;font-size:10px;font-weight:700;padding:1px 7px;border-radius:4px">At risk</span>`;
    return `<span style="background:#f0f2f5;color:#5a6270;font-size:10px;font-weight:700;padding:1px 7px;border-radius:4px">Neutral</span>`;
  }

  function chanIcon(ch) {
    const c = (ch ?? '').toLowerCase();
    if (c.includes('call') || c.includes('phone') || c === '📞') return '📞';
    if (c.includes('email') || c === '✉') return '✉';
    if (c.includes('chat') || c.includes('slack')) return '💬';
    return '📋';
  }

  $('tabContent').innerHTML = `
  <div style="display:grid;grid-template-columns:260px 1fr 300px;gap:12px;align-items:start;padding-bottom:16px">

    <!-- ═══ LEFT PANEL ═══ -->
    <div style="display:flex;flex-direction:column;gap:10px">

      <!-- Install Mix -->
      <div class="section">
        <div class="section-head"><span class="section-title">Install Mix</span></div>
        <div style="padding:10px 14px">
          ${Object.entries(editions).map(([ed, cnt]) => mixBar(ed, cnt,
            editionColor[ed] || '#9ba3ae'
          )).join('') || '<div style="color:var(--dim);font-size:12px">No key data</div>'}
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:10px;padding-top:10px;border-top:1px solid var(--b)">
            <div>
              <div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Largest</div>
              <div style="font-size:18px;font-weight:600">${largestExt}</div>
              <div style="font-size:10px;color:var(--dim)">ext</div>
            </div>
            <div>
              <div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:2px">Average</div>
              <div style="font-size:18px;font-weight:600">${avgExt}</div>
              <div style="font-size:10px;color:var(--dim)">ext</div>
            </div>
          </div>
        </div>
      </div>

      <!-- KPIs -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div class="section" style="padding:10px 12px">
          <div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Install Base</div>
          <div style="font-size:22px;font-weight:600">${totalKeys}</div>
          <div style="font-size:10px;color:var(--dim)">keys${disabledKeys.length ? ` · <span style="color:var(--m)">${liveKeyCount} live</span>` : ''}</div>
        </div>
        <div class="section" style="padding:10px 12px">
          <div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Customers</div>
          <div style="font-size:22px;font-weight:600">${customers.length}</div>
          <div style="font-size:10px;color:var(--dim)">unique</div>
        </div>
        <div class="section" style="padding:10px 12px">
          <div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Renewal Rate</div>
          <div style="font-size:22px;font-weight:600;color:${renewalRate>=80?'var(--green)':renewalRate>=60?'var(--amber)':'var(--red)'}">${renewalRate}%</div>
          <div style="font-size:10px;color:var(--dim)">active keys</div>
        </div>
        <div class="section" style="padding:10px 12px">
          <div style="font-size:10px;color:var(--dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">New (30d)</div>
          <div style="font-size:22px;font-weight:600;color:var(--blue)">${newDeals.length}</div>
          <div style="font-size:10px;color:var(--dim)">activations</div>
        </div>
      </div>

      <!-- Renewal Radar -->
      <div class="section">
        <div class="section-head">
          <span class="section-title" style="color:var(--amber)">⚠ Renewal Radar</span>
          <span class="section-count">${withDays.length}</span>
        </div>
        <div style="padding:0 2px">
          ${withDays.length ? withDays.slice(0,8).map(k => {
            const d = k.daysLeft;
            const col = d < 0 ? '#dc3545' : d <= 30 ? '#e67e00' : d <= 60 ? '#996500' : '#2d9e5f';
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 12px;border-bottom:1px solid var(--b);cursor:pointer"
              data-action="jump-keys">
              <span style="flex:1;font-size:11px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${esc(k.registration)}">${esc((k.registration||k.key||'').substring(0,22))}</span>
              ${tierBadge(k.product, k.sc)}
              <span style="font-size:10px;font-weight:700;color:${col};white-space:nowrap;min-width:44px;text-align:right">${
                d < 0 ? `${Math.abs(d)}d late` : `${d}d`
              }</span>
            </div>`;
          }).join('') : '<div class="empty">No renewals due</div>'}
        </div>
      </div>

      <!-- Next Best Action -->
      <div class="section" id="nbaPanel">
        <div class="section-head">
          <span class="section-title">✦ Next Best Action</span>
          <span class="section-count" style="cursor:pointer;color:var(--a)" data-action="generate-ai">Refresh</span>
        </div>
        <div style="padding:10px 14px;font-size:12px;color:var(--m);line-height:1.6" id="nbaText">
          Click Analyse to generate AI recommendations.
        </div>
      </div>

    </div>

    <!-- ═══ CENTER PANEL ═══ -->
    <div style="display:flex;flex-direction:column;gap:10px">

      <!-- New Activations (New Deals) -->
      <div class="section">
        <div class="section-head">
          <span class="section-title">New Activations</span>
          <span class="section-count" style="color:var(--dim)">last 30 days — ${newDeals.length}</span>
        </div>
        ${newDeals.length ? `<div style="overflow-x:auto">
          <table class="dtable">
            <thead><tr>
              <th>Customer</th><th>License</th><th>Version</th><th>Activated</th><th>Status</th>
            </tr></thead>
            <tbody>${newDeals.map(k => `<tr>
              <td style="font-size:12px;font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${esc(k.registration)}">${esc((k.registration||'—').substring(0,22))}</td>
              <td>${tierBadge(k.product, k.sc)}</td>
              <td style="font-size:11px;color:var(--dim)">${esc(k.version?.replace('v20.0 ','') || '—')}</td>
              <td style="font-size:11px;white-space:nowrap">${esc(k.activatedOn||'—')}</td>
              <td>${statusBadge(k.daysLeft)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : '<div class="empty">No activations in last 30 days</div>'}
      </div>

      <!-- Ongoing Deals (Renewals 91–180 days) -->
      <div class="section">
        <div class="section-head">
          <span class="section-title">Upcoming Renewals</span>
          <span class="section-count" style="color:var(--dim)">91–180 days — ${ongoingDeals.length}</span>
        </div>
        ${ongoingDeals.length ? `<div style="overflow-x:auto">
          <table class="dtable">
            <thead><tr>
              <th>Customer</th><th>Current</th><th>Expiry</th><th>Version</th><th>Status</th>
            </tr></thead>
            <tbody>${ongoingDeals.map(k => `<tr>
              <td style="font-size:12px;font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"
                title="${esc(k.registration)}">${esc((k.registration||'—').substring(0,22))}</td>
              <td>${tierBadge(k.product, k.sc)}</td>
              <td style="font-size:11px;white-space:nowrap;color:var(--amber);font-weight:600">${esc(k.expiry||'—')}</td>
              <td style="font-size:11px;color:var(--dim)">${esc(k.version?.replace('v20.0 ','') || '—')}</td>
              <td>${statusBadge(k.daysLeft ?? null)}</td>
            </tr>`).join('')}</tbody>
          </table>
        </div>` : '<div class="empty">No renewals in 91–180 day window</div>'}
      </div>

      <!-- Recent Notes -->
      <div class="section">
        <div class="section-head">
          <span class="section-title">Recent Notes</span>
          <span class="section-count" style="cursor:pointer;color:var(--a)" data-action="jump-notes">${notes.length} — view all →</span>
        </div>
        <div>${notes.slice(0,4).map(renderNoteCard).join('') || '<div class="empty">No notes yet</div>'}</div>
      </div>

    </div>

    <!-- ═══ RIGHT PANEL ═══ -->
    <div style="display:flex;flex-direction:column;gap:10px">

      <!-- Communication Log -->
      <div class="section">
        <div class="section-head">
          <span class="section-title">Communication Log</span>
          <span class="section-count">${comms.length}</span>
        </div>
        <div>
          ${comms.length ? comms.slice(0,8).map(row => {
            const subj   = row.subject ?? row.Subject ?? '(no subject)';
            const sender = row.sender  ?? row.from    ?? '';
            const ts     = row.timestamp ?? row.date  ?? '';
            const mood   = row.sentiment ?? row.mood  ?? '';
            const summary= row.summary ?? '';
            const nextStep = row.urgency === 'high' ? 'Follow up now' : summary.substring(0,40) || '';
            return `<div style="padding:8px 12px;border-bottom:1px solid var(--b);display:flex;flex-direction:column;gap:4px">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:13px">${chanIcon(row.category)}</span>
                <span style="font-size:12px;font-weight:500;flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(subj.substring(0,32))}</span>
                ${moodBadge(mood)}
              </div>
              <div style="display:flex;align-items:center;gap:8px;font-size:10px;color:var(--dim)">
                <span>${esc(ts)}</span>
                ${nextStep ? `<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--m)">${esc(nextStep)}</span>` : ''}
              </div>
            </div>`;
          }).join('') : '<div class="empty">No comms. Set up Sheet ID in settings.</div>'}
        </div>
      </div>

    </div>
  </div>`;

  wireNoteCards();
}

function prependCustomer(customer) {
  if (!customer) return;
  const subj = $('ovSubject');
  if (!subj) return;
  // Prepend customer name to subject, remove old customer if present
  const current = subj.value.replace(/^[^:]+:\s*/, '');
  subj.value = `${customer}: ${current}`.trim().replace(/:\s*$/, '');
  $('ovCustomer').value = ''; // reset dropdown
};

async function postNoteFromOverview() {
  const p = state.partner; if (!p) return;
  const subject  = $('ovSubject')?.value?.trim();
  const body     = $('ovBody')?.value?.trim();
  const noteType = parseInt($('ovNoteType')?.value ?? '2');
  const status   = $('ovStatus');
  if (!subject) { if (status) status.textContent = '⚠️ Subject required'; return; }
  if (!body)    { if (status) status.textContent = '⚠️ Body required'; return; }
  if (status) status.textContent = 'Posting…';
  const r = await msg('POST_NOTE', { payload: { partnerId: p.id, subject, body, noteType } });
  if (r?.ok) {
    if (status) status.textContent = '✅ Posted!';
    if ($('ovSubject')) $('ovSubject').value = '';
    if ($('ovBody'))    $('ovBody').value = '';
    setTimeout(() => loadPartner(p.id), 800);
  } else {
    if (status) status.textContent = `❌ ${r?.error ?? 'Failed'}`;
  }
};


function renderNotes(p) {
  const notes = p.tabs?.notesParsed ?? [];

  // Derive filter options
  const typeCounts   = {};
  const posterCounts = {};
  notes.forEach(n => {
    if (n.type)   typeCounts[n.type]     = (typeCounts[n.type]   ?? 0) + 1;
    if (n.poster) posterCounts[n.poster] = (posterCounts[n.poster] ?? 0) + 1;
  });
  const typeList   = Object.entries(typeCounts).sort((a,b) => b[1] - a[1]);
  const posterList = Object.entries(posterCounts).sort((a,b) => b[1] - a[1]);

  $('tabContent').innerHTML = `
    <!-- Post form -->
    <div class="section" style="margin-bottom:16px">
      <div class="section-head"><span class="section-title">Post New Note</span></div>
      <div class="section-body" style="padding:14px 16px">
        <div class="form-row">
          <div class="form-group" style="flex:0 0 140px">
            <label>Type</label>
            <select id="fNoteType">
              <option value="0">Contact</option><option value="1">Support</option>
              <option value="2" selected>Call</option><option value="3">Project</option>
              <option value="4">Commitments</option><option value="5">Email</option>
            </select>
          </div>
          <div class="form-group">
            <label>Subject</label>
            <input type="text" id="fSubject" placeholder="Note subject…" />
          </div>
        </div>
        <div class="form-group" style="margin-bottom:10px">
          <label>Body</label>
          <textarea id="fBody" placeholder="Note body…"></textarea>
        </div>
        <div class="form-actions">
          <div id="fStatus" style="flex:1;font-size:11px;color:var(--m)"></div>
          <button class="btn btn-ai" id="btnAiSummarise" data-action="ai-summarise">✦ AI Summarise</button>
          <button class="btn btn-primary" id="btnPostNote" data-action="post-note">Post Note →</button>
        </div>
      </div>
    </div>

    <!-- Existing notes -->
    <div class="section">
      <div class="section-head">
        <span class="section-title">Timeline</span>
        <span class="section-count">${notes.length}</span>
      </div>
      ${notes.length ? `
      <div class="notes-filter-bar">
        <div class="chip-group">
          <div class="chip-group-label">Type</div>
          <div class="chip-row" id="noteTypeChips">
            <div class="chip active" data-type="">All</div>
            ${typeList.map(([t,c]) => `<div class="chip" data-type="${esc(t)}">${esc(t)}<span class="count">${c}</span></div>`).join('')}
          </div>
        </div>
        ${posterList.length > 1 ? `
        <div class="chip-group">
          <div class="chip-group-label">Poster</div>
          <div class="chip-row" id="notePosterChips">
            <div class="chip active" data-poster="">All</div>
            ${posterList.map(([p,c]) => `<div class="chip" data-poster="${esc(p)}" title="${esc(p)}">${esc(shortAgentName(p))}<span class="count">${c}</span></div>`).join('')}
          </div>
        </div>` : ''}
      </div>` : ''}
      <div class="section-body" id="notesTimeline">
        ${notes.length ? notes.map(renderNoteCard).join('') : '<div class="empty">No notes for this partner.</div>'}
      </div>
    </div>
  `;

  // Wire filter chips
  const applyNoteFilters = () => {
    const activeType   = $('noteTypeChips')?.querySelector('.chip.active')?.dataset.type ?? '';
    const activePoster = $('notePosterChips')?.querySelector('.chip.active')?.dataset.poster ?? '';
    $('notesTimeline').querySelectorAll('.note-card-v2').forEach(card => {
      const t = card.dataset.type, po = card.dataset.poster;
      const match = (!activeType || t === activeType) && (!activePoster || po === activePoster);
      card.style.display = match ? '' : 'none';
    });
  };
  ['noteTypeChips','notePosterChips'].forEach(id => {
    $(id)?.addEventListener('click', e => {
      const chip = e.target.closest('.chip'); if (!chip) return;
      $(id).querySelectorAll('.chip').forEach(c => c.classList.toggle('active', c === chip));
      applyNoteFilters();
    });
  });

  wireNoteCards();
}

// ── Comms tab ─────────────────────────────────────────────────────────────────
function renderComms(p) {
  const all   = state.sheetData;
  const mine  = all.filter(r => r.partner_id===String(p.id) ||
    (p.email && r.sender?.toLowerCase().includes(p.email.split('@')[1]??'')));

  // Tab filter
  const cats = ['all','transcription','partner_comm','lead','reseller_prospect'];
  let activeCat = 'all';

  function render() {
    const filtered = activeCat==='all' ? mine : mine.filter(r=>r.category===activeCat);
    $('commsContent').innerHTML = filtered.length
      ? filtered.map(renderEmailCard).join('')
      : '<div class="empty">No emails in this category for this partner.</div>';
  }

  $('tabContent').innerHTML = `
    <div class="section">
      <div class="section-head">
        <span class="section-title">Gmail Communications</span>
        <span class="section-count">${mine.length} emails</span>
      </div>
      <div style="display:flex;gap:6px;padding:8px 16px;border-bottom:1px solid var(--b);flex-wrap:wrap">
        ${cats.map(c=>`<div class="pill comm-cat${c===activeCat?' active':''}" data-cat="${c}" style="cursor:pointer;font-size:11px;padding:3px 9px;border-radius:4px;background:var(--b);color:var(--m)">${c==='all'?'All':c.replace('_',' ')}</div>`).join('')}
      </div>
      <div class="section-body" id="commsContent"></div>
    </div>
    ${!all.length?`<div class="section"><div class="empty">No Sheet data. Add your Sheet ID in settings and click Sync.</div></div>`:''}
  `;

  render();
  $('tabContent').querySelectorAll('.comm-cat').forEach(el =>
    el.addEventListener('click', () => {
      activeCat = el.dataset.cat;
      $('tabContent').querySelectorAll('.comm-cat').forEach(e=>e.style.color=e===el?'var(--a)':'var(--m)');
      render();
    })
  );
}

// ── Keys tab ─────────────────────────────────────────────────────────────────
function renderKeys(p) {
  const keys = p.tabs?.keys ?? [];
  if (!keys.length) {
    $('tabContent').innerHTML = '<div class="section"><div class="empty">No license keys loaded.</div></div>';
    return;
  }

  // Renewal radar — sort by expiry (live keys only; retired keys aren't renewed)
  const today = new Date();
  const live = keys.filter(k => !k.disabled);
  const retired = keys.filter(k => k.disabled);
  const withDays = keys.filter(k => k.expiry).map(k => {
    const exp = parseKeyDate(k.expiry);
    const days = exp ? Math.round((exp - today) / 86400000) : null;
    return { ...k, daysLeft: days };
  }).sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));

  const expiring = withDays.filter(k => !k.disabled && k.daysLeft !== null && k.daysLeft <= 90);

  function expiryClass(d) {
    if (d === null) return '';
    if (d < 0)   return 'style="color:var(--red);font-weight:600"';
    if (d <= 30) return 'style="color:var(--red);font-weight:600"';
    if (d <= 60) return 'style="color:var(--amber);font-weight:600"';
    if (d <= 90) return 'style="color:var(--warn)"';
    return 'style="color:var(--green)"';
  }

  function expiryLabel(k) {
    if (k.daysLeft === null) return esc(k.expiry);
    if (k.daysLeft < 0)  return `${esc(k.expiry)} <span style="color:var(--red)">(${Math.abs(k.daysLeft)}d overdue)</span>`;
    if (k.daysLeft === 0) return `${esc(k.expiry)} <span style="color:var(--red)">(today)</span>`;
    return `${esc(k.expiry)} <span style="color:var(--dim)">(${k.daysLeft}d)</span>`;
  }

  function keyRow(k) {
    const d = k.daysLeft;
    const scLabel = k.sc ? `${esc(k.sc)}SC` : '—';
    const extLabel = k.maxExt ? `${esc(k.maxExt)} ext` : '—';
    const url     = keyEditUrl(k.keyId);
    const keyCell = url
      ? `<a href="${url}" target="_blank" rel="noopener" class="key-link" title="Open in staff.3cx.com">${esc(k.key)}</a>`
      : esc(k.key);
    const rowCls = k.disabled ? ' class="key-row-disabled"' : '';
    const disBadge = k.disabled ? ` <span class="key-retired-tag">retired</span>` : '';
    return `<tr${rowCls}>
      <td style="font-family:monospace;font-size:11px">${keyCell}${disBadge}</td>
      <td style="font-size:12px">${esc(k.product)}</td>
      <td style="text-align:center;white-space:nowrap">
        <span style="background:#e8f5ee;color:#2d9e5f;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">${scLabel}</span>
        <span style="color:var(--dim);font-size:10px;margin-left:4px">${extLabel}</span>
      </td>
      <td style="font-size:11px" ${k.disabled ? '' : expiryClass(d)}>${k.disabled ? '<span style="color:var(--dim)">—</span>' : expiryLabel(k)}</td>
      <td style="font-size:11px;color:var(--m)">${esc(k.registration||'—')}</td>
      <td style="font-size:11px;color:var(--dim)">${esc(k.version||'')}</td>
    </tr>`;
  }

  $('tabContent').innerHTML = `
    ${expiring.length ? `
    <div class="section" style="margin-bottom:12px">
      <div class="section-head">
        <span class="section-title" style="color:var(--amber)">⚠ Renewal Radar</span>
        <span class="section-count">${expiring.length} expiring within 90 days</span>
      </div>
      <div style="overflow-x:auto">
        <table class="dtable">
          <thead><tr>
            <th>Key</th><th>Product</th><th>SC / Ext</th>
            <th>Expiry</th><th>Customer</th><th>Version</th>
          </tr></thead>
          <tbody>${expiring.map(keyRow).join('')}</tbody>
        </table>
      </div>
    </div>` : ''}

    <div class="section">
      <div class="section-head">
        <span class="section-title">All License Keys</span>
        <span class="section-count">${keys.length}${retired.length ? ` · ${live.length} live · ${retired.length} retired` : ''}</span>
      </div>
      <div style="overflow-x:auto">
        <table class="dtable">
          <thead><tr>
            <th>Key</th><th>Product</th><th>SC / Ext</th>
            <th>Expiry</th><th>Customer</th><th>Version</th>
          </tr></thead>
          <tbody>${withDays.map(keyRow).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

function parseKeyDate(str) {
  if (!str) return null;
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (m) {
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    return new Date(`${yr}-${m[2]}-${m[1]}`);
  }
  const d = new Date(str);
  return isNaN(d) ? null : d;
}

// ── Orders tab ───────────────────────────────────────────────────────────────
// Custom renderer for orders. Drops the From/s address boilerplate parsed out
// upstream. Each order row gets:
//   • clickable order number → staff portal detail page
//   • clickable license-key chips, cross-referenced to keys by purchase date
function renderOrders(p) {
  const orders = Array.isArray(p.tabs?.orders) ? p.tabs.orders : [];
  if (!orders.length) {
    $('tabContent').innerHTML = '<div class="section"><div class="empty">No orders loaded for this partner.</div></div>';
    return;
  }

  // Build date→keys map for fast lookup. Keys with matching `purchased` date
  // get associated with that order. Falls back to same-day match.
  const keys = Array.isArray(p.tabs?.keys) ? p.tabs.keys : [];
  const keysByDate = {};
  keys.forEach(k => {
    if (!k.purchased) return;
    const d = parseKeyDate(k.purchased);
    if (!d) return;
    const iso = d.toISOString().slice(0, 10);
    (keysByDate[iso] ??= []).push(k);
  });

  const keysForOrder = (order) => {
    const d = parseKeyDate(order.created);
    if (!d) return [];
    return keysByDate[d.toISOString().slice(0, 10)] ?? [];
  };

  const statusBadge = (s) => {
    const st = (s || '').toLowerCase();
    const cls = st.includes('paid')       ? 'green'
             : st.includes('pending')     ? 'amber'
             : st.includes('cancel') || st.includes('reject') ? 'red'
             : st.includes('free')        ? 'blue'
             : '';
    return `<span class="order-status ${cls}">${esc(s || '—')}</span>`;
  };

  const keyChips = (order) => {
    const matched = keysForOrder(order);
    if (!matched.length) return `<span class="order-nokey">—</span>`;
    return matched.map(k => {
      const ed  = editionOf(k.product);
      const url = keyEditUrl(k.keyId);
      const label = `${k.key}${k.sc ? ' · ' + k.sc + 'SC' : ''}`;
      const inner = `<span class="order-key-ed" style="background:${ed.bg};color:${ed.color}">${esc(ed.short)}</span> ${esc(label)}`;
      return url
        ? `<a href="${url}" target="_blank" rel="noopener" class="order-key-chip" title="Open license in staff.3cx.com">${inner}</a>`
        : `<span class="order-key-chip">${inner}</span>`;
    }).join(' ');
  };

  const orderRow = (o) => {
    const orderCell = o.orderUrl
      ? `<a href="${esc(o.orderUrl)}" target="_blank" rel="noopener" class="order-link">${esc(o.orderNo || '—')}</a>`
      : esc(o.orderNo || '—');
    const amt = [o.currency, o.amount].filter(Boolean).join(' ') || '—';
    const tax = [o.currency, o.tax].filter(Boolean).join(' ') || '—';
    return `<tr>
      <td style="font-family:monospace;font-size:11px;white-space:nowrap">${orderCell}</td>
      <td style="font-size:11px;white-space:nowrap">${esc(o.created || '—')}</td>
      <td style="white-space:nowrap">${statusBadge(o.status)}</td>
      <td class="order-keys">${keyChips(o)}</td>
      <td style="font-size:11px;white-space:nowrap;text-align:right;font-weight:600">${esc(amt)}</td>
      <td style="font-size:11px;white-space:nowrap;text-align:right;color:var(--dim)">${esc(tax)}</td>
      <td style="font-size:11px;white-space:nowrap;color:var(--m)">${esc(o.payment || '—')}</td>
      <td style="font-size:11px;white-space:nowrap;color:var(--dim)">${esc(o.proformaNo || '—')}</td>
      <td style="font-size:11px;white-space:nowrap;color:var(--dim)">${esc(o.country || '—')}</td>
    </tr>`;
  };

  // Totals by currency (ignoring tax, ignoring free samples)
  const paidOrders = orders.filter(o => (o.status || '').toLowerCase().includes('paid'));
  const totalsByCurrency = {};
  paidOrders.forEach(o => {
    if (!o.amount) return;
    const n = parseFloat(String(o.amount).replace(/[^\d.]/g, ''));
    if (!isFinite(n)) return;
    const cur = o.currency || '';
    totalsByCurrency[cur] = (totalsByCurrency[cur] ?? 0) + n;
  });
  const totalsLine = Object.entries(totalsByCurrency)
    .map(([cur, n]) => `${cur ? cur + ' ' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`)
    .join(' · ');

  $('tabContent').innerHTML = `
    <div class="section">
      <div class="section-head">
        <span class="section-title">Orders</span>
        <span class="section-count">${orders.length} ${paidOrders.length ? `· ${paidOrders.length} paid` : ''}${totalsLine ? ` · Σ ${totalsLine}` : ''}</span>
      </div>
      <div style="overflow-x:auto">
        <table class="dtable">
          <thead><tr>
            <th>Order #</th>
            <th>Date</th>
            <th>Status</th>
            <th>License Keys</th>
            <th style="text-align:right">Amount</th>
            <th style="text-align:right">Tax</th>
            <th>Payment</th>
            <th>Proforma</th>
            <th>Country</th>
          </tr></thead>
          <tbody>${orders.map(orderRow).join('')}</tbody>
        </table>
      </div>
    </div>
  `;
}

// ── Users tab ────────────────────────────────────────────────────────────────
function renderUsers(p) {
  const users = p.tabs?.users ?? [];
  if (!users.length) {
    $('tabContent').innerHTML = '<div class="section"><div class="empty">No users data. Try reloading this partner.</div></div>';
    return;
  }

  const today = new Date();
  const parseDate = (s) => {
    const m = String(s||'').match(/^(\d{2})\/(\d{2})\/(\d{2,4})/);
    if (!m) return null;
    const yr = m[3].length === 2 ? '20' + m[3] : m[3];
    const d = new Date(`${yr}-${m[2]}-${m[1]}`);
    return isNaN(d) ? null : d;
  };

  const ROLE_COLOR = {
    Owner:      '#6f42c1',
    Sales:      '#0077b6',
    Support:    '#2d9e5f',
    Purchase:   '#00838f',
    Accounting: '#e67e00',
  };

  function rolePills(roles) {
    if (!Array.isArray(roles) || !roles.length) return '<span style="color:var(--dim);font-size:10px">—</span>';
    return roles.map(role => {
      const col = Object.keys(ROLE_COLOR).find(k => role.includes(k));
      const style = col
        ? `background:${ROLE_COLOR[col]}22;color:${ROLE_COLOR[col]};border:1px solid ${ROLE_COLOR[col]}55`
        : 'background:var(--s2);color:var(--m);border:1px solid var(--b)';
      return `<span style="display:inline-block;font-size:9px;font-weight:700;padding:2px 6px;border-radius:3px;${style};margin:1px 3px 1px 0;white-space:nowrap">${esc(role)}</span>`;
    }).join('');
  }

  function certBadge(cert) {
    if (!cert || cert === ' ' || cert === '\u00a0') return '<span style="color:var(--dim);font-size:10px">—</span>';
    const col = cert.includes('Advanced') ? '#6f42c1'
              : cert.includes('Basic')    ? '#0077b6'
              : '#5a6270';
    return `<span style="font-size:10px;font-weight:700;padding:2px 7px;border-radius:4px;background:${col}22;color:${col};border:1px solid ${col}55">${esc(cert)}</span>`;
  }

  function statusPill(status) {
    const s  = (status||'').toLowerCase();
    const col = s.includes('enroll') ? '#2d9e5f' : '#9ba3ae';
    return `<span style="display:inline-flex;align-items:center;gap:5px;font-size:11px;color:${col}">
      <span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:${col}"></span>${esc(status||'')}
    </span>`;
  }

  function loginAge(s) {
    const d = parseDate(s);
    if (!d) return '';
    const days = Math.round((today - d) / 86400000);
    if (days < 0)   return '';
    if (days === 0) return 'today';
    if (days === 1) return 'yesterday';
    if (days < 30)  return `${days}d ago`;
    if (days < 365) return `${Math.round(days/30)}mo ago`;
    return `${Math.round(days/365)}y ago`;
  }

  function loginCell(s) {
    const d = parseDate(s);
    const age = loginAge(s);
    if (!d) return `<span style="color:var(--dim)">${esc(s||'—')}</span>`;
    const days = Math.round((today - d) / 86400000);
    const col = days <= 30  ? 'var(--green)'
              : days <= 90  ? 'var(--m)'
              : days <= 365 ? 'var(--amber)'
              : 'var(--red)';
    return `<span style="color:${col};font-size:11px">${esc(s)}</span>${age ? ` <span style="color:var(--dim);font-size:10px">· ${esc(age)}</span>` : ''}`;
  }

  const owners      = users.filter(u => u.roles?.includes('Owner')).length;
  const advanced    = users.filter(u => u.cert?.includes('Advanced')).length;
  const basic       = users.filter(u => u.cert?.includes('Basic')).length;
  const uncertified = users.length - advanced - basic;
  const last30      = users.filter(u => {
    const d = parseDate(u.lastLogin);
    if (!d) return false;
    return (today - d) / 86400000 <= 30;
  }).length;

  $('tabContent').innerHTML = `
    <div class="section">
      <div class="section-head">
        <span class="section-title">Users</span>
        <span class="section-count">
          ${users.length} ${owners ? `· ${owners} owner${owners>1?'s':''}` : ''}
          ${advanced ? `· ${advanced} advanced` : ''}
          ${basic ? `· ${basic} basic` : ''}
          ${uncertified ? `· ${uncertified} uncertified` : ''}
          ${last30 ? `· ${last30} active ≤30d` : ''}
        </span>
      </div>
      <div style="overflow-x:auto">
        <table class="dtable">
          <thead><tr>
            <th>Name</th>
            <th>Email</th>
            <th>Phone</th>
            <th>Roles</th>
            <th>Certification</th>
            <th>Status</th>
            <th>Last Login</th>
          </tr></thead>
          <tbody>${users.map(u => {
            const fullName = `${u.firstName||''} ${u.lastName||''}`.trim() || '—';
            const emailUrl = u.userId ? `https://staff.3cx.com/user/edit.aspx?i=${encodeURIComponent(u.userId)}` : '';
            const emailCell = u.email
              ? (emailUrl
                  ? `<a href="${emailUrl}" target="_blank" rel="noopener" class="key-link">${esc(u.email)}</a>`
                  : esc(u.email))
              : '—';
            const mailtoCell = u.email
              ? ` <a href="mailto:${esc(u.email)}" title="Send email" style="margin-left:4px;color:var(--dim);text-decoration:none">✉</a>`
              : '';
            return `<tr>
              <td style="font-size:12px;font-weight:500;white-space:nowrap">${esc(fullName)}</td>
              <td style="font-size:11px;white-space:nowrap">${emailCell}${mailtoCell}</td>
              <td style="font-size:11px;color:var(--m);white-space:nowrap">${esc(u.phone||'—')}</td>
              <td style="line-height:1.8">${rolePills(u.roles)}</td>
              <td style="white-space:nowrap">${certBadge(u.cert)}</td>
              <td style="white-space:nowrap">${statusPill(u.status)}</td>
              <td style="white-space:nowrap">${loginCell(u.lastLogin)}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Generic table tab ─────────────────────────────────────────────────────────
// Debug helper — call from console: debugTab('ctl00$Main$btnUsers')
window.debugTab = async function(target) {
  const p = state.partner; if (!p) { console.log('No partner loaded'); return; }
  const r = await msg('DEBUG_FETCH_TAB', { partnerId: p.id, target });
  console.log('Tab debug result:', JSON.stringify(r?.result, null, 2));
  if (r?.result) {
    const res = r.result;
    $('tabContent').innerHTML = `
      <div style="padding:16px;font-family:monospace;font-size:11px;line-height:1.8;background:var(--s2);border-radius:8px;margin:12px">
        <b>Sections (${res.sectionCount}):</b> ${esc(res.sectionKeys.join(', '))}<br>
        <b>All HTML length:</b> ${res.allHtmlLen}<br>
        <b>Tables found:</b> ${res.tableCount}<br>
        <b>Table info:</b> ${esc(res.tableInfo.join(' | '))}<br>
        <b>&lt;th&gt; headers:</b> ${esc(res.thHeaders.join(', ') || 'none')}<br>
        <b>parseMainDg headers:</b> ${esc(res.dgHeaders.join(', ') || 'none')}<br>
        <b>parseMainDg rows:</b> ${res.dgRowCount}<br>
        <b>Preview:</b><br>
        <pre style="white-space:pre-wrap;font-size:10px;color:var(--m)">${esc(res.preview)}</pre>
      </div>`;
  }
};


function renderTable(rows, title) {
  // Accept flat array or nested grids
  if (!Array.isArray(rows)) rows = flattenGrids(rows);
  if (!rows.length) {
    $('tabContent').innerHTML = `<div class="section"><div class="empty">No ${esc(title)} data loaded for this partner.</div></div>`;
    return;
  }
  const headers = Object.keys(rows[0]).filter(h => h && h !== 'Edit' && h !== 'Delete' && h !== ' ' && !h.endsWith('_id'));
  $('tabContent').innerHTML = `
    <div class="section">
      <div class="section-head">
        <span class="section-title">${esc(title)}</span>
        <span class="section-count">${rows.length}</span>
      </div>
      <div style="overflow-x:auto">
        <table class="dtable">
          <thead><tr>${headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead>
          <tbody>${rows.map(row => `<tr>${headers.map(h => `<td>${esc(row[h] ?? '')}</td>`).join('')}</tr>`).join('')}</tbody>
        </table>
      </div>
    </div>`;
}

// ── Card renderers ────────────────────────────────────────────────────────────
const NOTE_BADGE_CLASS = { Contact:'nb-contact', Support:'nb-support', Call:'nb-call',
  Project:'nb-project', Commitments:'nb-commitments', Email:'nb-email' };

function renderNoteCard(n) {
  const badgeCls = NOTE_BADGE_CLASS[n.type] ?? 'nb-contact';
  return `<div class="note-card-v2" data-i="${n.index}" data-type="${esc(n.type||'')}" data-poster="${esc(n.poster||'')}">
    <div class="note-head-row">
      <span class="note-badge ${badgeCls}">${esc(n.type||'')}</span>
      <span class="note-subj">${esc(n.subject||'(no subject)')}</span>
      <span class="note-date">${esc(n.modified||'')}</span>
    </div>
    <div class="note-meta-row">
      <span class="note-poster">👤 ${esc(n.poster||'')}</span>
      ${n.reminder ? `<span class="note-reminder">🔔 ${esc(n.reminder)}</span>` : ''}
    </div>
    <div class="note-body-v2">${esc(n.body||'(no body)')}</div>
  </div>`;
}

function renderEmailCard(row) {
  const cat  = row.category ?? 'other';
  const mood = row.sentiment ?? row.mood ?? '';
  return `<div class="email-card">
    <div class="email-top">
      <span class="email-cat ec-${esc(cat)}">${esc(cat.replace('_',' '))}</span>
      <span class="email-subj">${esc(row.subject??row.Subject??'(no subject)')}</span>
      <span class="email-age">${esc(row.timestamp??row.date??'')}</span>
    </div>
    <div class="email-meta">
      ${esc(row.sender??row.from??'')}
      ${mood?`<span class="mood-pill mp-${esc(mood)}">${esc(mood)}</span>`:''}
      ${row.summary?` · ${esc(row.summary.substring(0,80))}`:''} 
    </div>
  </div>`;
}

function wireNoteCards() {
  // Cards are expanded by default; no click handler needed.
  // Filter chip wiring happens in renderNotes.
}

// ── Post note ─────────────────────────────────────────────────────────────────
async function postNote() {
  const p = state.partner; if (!p) return;
  const subj = $('fSubject')?.value?.trim();
  const body = $('fBody')?.value?.trim();
  const type = parseInt($('fNoteType')?.value??'2');
  if (!subj) { $('fStatus').textContent='⚠️ Subject required'; return; }
  if (!body) { $('fStatus').textContent='⚠️ Body required'; return; }
  $('btnPostNote').disabled = true;
  $('fStatus').textContent = 'Posting…';
  const r = await msg('POST_NOTE',{payload:{partnerId:p.id,subject:subj,body,noteType:type}});
  $('btnPostNote').disabled = false;
  if (r?.ok) {
    $('fStatus').textContent='✅ Posted!';
    $('fSubject').value=''; $('fBody').value='';
    // Reload notes
    setTimeout(()=>loadPartner(p.id),1000);
  } else {
    $('fStatus').textContent=`❌ ${r?.error??'Failed'}`;
  }
};

// openNote handled by delegated listener

// ── AI Summarise ──────────────────────────────────────────────────────────────
async function aiSummarise() {
  const body = $('fBody')?.value?.trim();
  if (!body) { $('fStatus').textContent='⚠️ Paste a transcription in the Body field first'; return; }
  $('btnAiSummarise').disabled = true;
  $('fStatus').textContent = '✦ Summarising…';
  const r = await msg('SUMMARISE', { body });
  $('btnAiSummarise').disabled = false;
  if (r?.ok) {
    $('fBody').value = r.result;
    $('fStatus').textContent = '✦ Done — review and post';
  } else {
    $('fStatus').textContent = `❌ ${r?.error??'OpenAI error'}`;
  }
};

// ── AI analysis (Next Best Action) ───────────────────────────────────────────
async function generateAI() {
  const p = state.partner; if (!p) return;
  // Update both the AI bar and the NBA panel in overview
  setAI('✦ Analysing…', true);
  const nbaText = $('nbaText');
  if (nbaText) nbaText.textContent = '✦ Generating recommendations…';

  const keys = Array.isArray(p.tabs?.keys) ? p.tabs.keys : [];
  const expiringKeys = keys.filter(k => {
    const d = parseKeyDate(k.expiry);
    if (!d) return false;
    const days = Math.round((d - new Date()) / 86400000);
    return days >= 0 && days <= 90;
  });

  const r = await msg('NEXT_BEST_ACTION', { partnerData: {
    company:      p.company,
    type:         p.type,
    category:     p.category,
    discounts:    p.discounts,
    totalKeys:    keys.length,
    expiringKeys: expiringKeys.length,
    recentNotes:  p.tabs?.notesParsed?.slice(0,5),
    recentComms:  state.sheetData.filter(row=>row.partner_id===String(p.id)).slice(0,5)
  }});

  const text = r?.ok ? r.result : `Could not generate: ${r?.error}`;
  setAI(text, false);
  if (nbaText) {
    // Format as bullet points if the response has newlines
    const formatted = text.split('\n').filter(l => l.trim())
      .map(l => { const clean = l.replace(/^[•\u2022\-*]\s*/, ''); return `<div style="display:flex;gap:6px;margin-bottom:4px"><span style="color:var(--a)">•</span><span>${esc(clean)}</span></div>`; })
      .join('');
    nbaText.innerHTML = formatted || esc(text);
  }
};

function setAI(text, loading=false) {
  $('aiText').innerHTML = (loading?'<span class="spinner"></span>':'')+esc(text);
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function flattenGrids(grids) {
  if (!grids) return [];
  return grids.flatMap(g => Array.isArray(g) ? g : (g?.rows?rowsToObjects(g.headers,g.rows):[]));
}

function rowsToObjects(headers,rows){
  return (rows??[]).map(cells=>{
    const obj={};
    (headers??[]).forEach((h,i)=>{if(h?.trim())obj[h.trim()]=cells[i]??'';});
    return obj;
  });
}

function detectTier(p) {
  const cat = (p.category??'').toLowerCase();
  if (cat.includes('plat')) return { label:'Platinum', class:'platinum' };
  if (cat.includes('gold')) return { label:'Gold',     class:'gold' };
  if (cat.includes('silv')) return { label:'Silver',   class:'silver' };
  if (cat.includes('auth')) return { label:'Authorised',class:'authorised' };
  return { label: p.category||p.type||'Partner', class:'default' };
}

function computeHealth(p) {
  const notes  = p.tabs?.notesParsed ?? [];
  const keys   = flattenGrids(p.tabs?.keys);
  let score = 50;
  if (notes.length>5)  score+=10;
  if (notes.length>15) score+=5;
  const lastNote = notes[0];
  if (lastNote) {
    const d = daysBetween(parseDate(lastNote.modified), new Date());
    if (d<7)  score+=15; else if (d<30) score+=8; else if (d>90) score-=15;
  } else score-=10;
  if (keys.length>0)  score+=10;
  if (p.enabled)      score+=5;
  score = Math.max(0, Math.min(100, score));
  const color = score>=70 ? '#4caf82' : score>=40 ? '#f0a500' : '#e05c5c';
  return { score, color };
}

function parseDate(str) {
  if (!str) return null;
  // Handles dd/mm/yy hh:mm or standard formats
  const m = str.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
  if (m) return new Date(`20${m[3].slice(-2)}-${m[2]}-${m[1]}`);
  return new Date(str);
}

function daysBetween(d1, d2) {
  if (!d1||!d2||isNaN(d1)||isNaN(d2)) return null;
  return Math.round(Math.abs(d2-d1)/86400000);
}

function copyEmail() {
  const p = state.partner; if (!p?.email) return;
  navigator.clipboard.writeText(p.email);
};

// ── Quick Note modal ─────────────────────────────────────────────────────────
function openQuickNoteModal() {
  const p = state.partner;
  if (!p) return;
  const backdrop = $('qnBackdrop');
  const modal    = $('qnModal');
  if (!backdrop || !modal) {
    console.warn('[QuickNote] modal markup missing — dashboard.html is out of date. Reload the extension and refresh this tab.');
    alert('Quick Note UI not loaded. Please refresh this tab (Cmd/Ctrl+R) after reloading the extension.');
    return;
  }
  const hint = $('qnPartnerHint');
  if (hint) hint.innerHTML = `Note for <strong>${esc(p.company||'')}</strong> <span style="color:var(--dim)">· ${esc(String(p.id))}</span>`;

  // Populate customer dropdown from this partner's keys
  const keys = Array.isArray(p.tabs?.keys) ? p.tabs.keys : [];
  const customers = [...new Set(keys.map(k => k.registration).filter(Boolean))].sort();
  const cust = $('qnCustomer');
  if (cust) {
    cust.innerHTML = `<option value="">Add customer to subject (optional)</option>` +
      customers.slice(0, 100).map(c => `<option value="${esc(c)}">${esc(c.substring(0, 60))}</option>`).join('');
  }

  // Reset fields
  if ($('qnSubject')) $('qnSubject').value = '';
  if ($('qnBody'))    $('qnBody').value = '';
  if ($('qnType'))    $('qnType').value = '2';
  if ($('qnStatus')) { $('qnStatus').textContent = ''; $('qnStatus').className = 'qn-status'; }
  if ($('qnPost'))    $('qnPost').disabled = false;

  backdrop.classList.add('open');
  modal.classList.add('open');
  setTimeout(() => $('qnSubject')?.focus(), 80);
}
function closeQuickNoteModal() {
  $('qnBackdrop')?.classList.remove('open');
  $('qnModal')?.classList.remove('open');
}
async function postQuickNote() {
  const p = state.partner;
  if (!p) return;
  const subj = $('qnSubject').value.trim();
  const body = $('qnBody').value.trim();
  const type = parseInt($('qnType').value || '2');
  const setStatus = (t, cls='') => {
    const s = $('qnStatus');
    s.textContent = t;
    s.className = 'qn-status' + (cls ? ' ' + cls : '');
  };
  if (!subj) { setStatus('⚠️ Subject required', 'err'); return; }
  if (!body) { setStatus('⚠️ Body required', 'err'); return; }

  $('qnPost').disabled = true;
  setStatus('Posting…', 'busy');
  const r = await msg('POST_NOTE', { payload: { partnerId: p.id, subject: subj, body, noteType: type } });
  if (r?.ok) {
    setStatus('✅ Posted — refreshing', 'ok');
    setTimeout(() => {
      closeQuickNoteModal();
      loadPartner(p.id);
    }, 700);
  } else {
    $('qnPost').disabled = false;
    setStatus(`❌ ${r?.error ?? 'Failed'}`, 'err');
  }
}
// Wire modal close triggers — handle both ready and pre-ready states
function wireQuickNoteModal() {
  $('qnClose')?.addEventListener('click', closeQuickNoteModal);
  $('qnBackdrop')?.addEventListener('click', closeQuickNoteModal);
  $('qnPost')?.addEventListener('click', postQuickNote);
  $('qnCustomer')?.addEventListener('change', (e) => {
    const c = e.target.value;
    if (!c) return;
    const subj = $('qnSubject');
    const current = subj.value.replace(/^[^:]+:\s*/, '');
    subj.value = `${c}: ${current}`.trim().replace(/:\s*$/, '');
    e.target.value = '';
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && $('qnModal')?.classList.contains('open')) {
      closeQuickNoteModal();
    }
  });
}
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', wireQuickNoteModal);
} else {
  wireQuickNoteModal();
}

// ── Global delegated event handler (CSP: no inline onclick allowed) ─────────────
// Must be at end of file so all functions are defined before listener is registered.
document.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  const action = el.dataset.action;
  try {
    switch (action) {
      case 'open-note':
        openQuickNoteModal();
        break;
      case 'copy-email':
        if (state.partner?.email) navigator.clipboard.writeText(state.partner.email);
        break;
      case 'generate-ai':
        generateAI();
        break;
      case 'jump-keys':
        state.activeTab = 'keys';
        renderMain();
        break;
      case 'jump-notes':
        state.activeTab = 'notes';
        renderMain();
        break;
      case 'post-note-overview':
        postNoteFromOverview();
        break;
      case 'post-note':
        postNote();
        break;
      case 'ai-summarise':
        aiSummarise();
        break;
    }
  } catch(err) {
    console.error('PRM action error:', action, err);
  }
});

document.addEventListener('change', e => {
  const el = e.target.closest('[data-action]');
  if (!el) return;
  if (el.dataset.action === 'prepend-customer') {
    prependCustomer(el.value);
  }
});

// ── Boot ──────────────────────────────────────────────────────────────────────
init();
