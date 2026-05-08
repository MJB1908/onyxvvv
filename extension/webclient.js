// ============================================================
// webclient.js — content script on team.3cx.com
// ============================================================

// ── Inject page-context script ────────────────────────────────────────────────
(function injectPageScript() {
  const s = document.createElement('script');
  s.src = chrome.runtime.getURL('webclient_inject.js');
  s.type = 'text/javascript';
  s.onload = () => s.remove();
  (document.head || document.documentElement).appendChild(s);
})();

// ── State ─────────────────────────────────────────────────────────────────────
let overlay = null;
let dismissTimer = null;
let activeLookupId = 0;
let activeCallNumber = null;
let activeCallPartner = null;
const callerCache = new Map();
const CALLER_CACHE_TTL = 5 * 60 * 1000;

// ── Call events ───────────────────────────────────────────────────────────────
window.addEventListener('__3cx_prm_call', async (evt) => {
  handleCallEvent(evt, 'inbound');
});

window.addEventListener('__3cx_prm_call_outbound', async (evt) => {
  handleCallEvent(evt, 'outbound');
});

async function handleCallEvent(evt, direction = 'inbound') {
  const { number } = evt.detail || {};
  if (!number) return;

  activeCallNumber = number;
  activeCallPartner = null;

  const lookupId = ++activeLookupId;

  showOverlay({ number, state: 'looking', direction });

  const resp = await lookupCaller(number);

  if (lookupId !== activeLookupId || !overlay || activeCallNumber !== number) return;

  if (resp?.ok && resp.result) {
    activeCallPartner = resp.result;
    showOverlay({ number, state: 'found', partner: resp.result, direction });
  } else {
    showOverlay({ number, state: 'unknown', direction });
  }
}

window.addEventListener('__3cx_prm_call_answered', (evt) => {
  if (!overlay || !activeCallNumber) return;
  if (evt.detail?.number && evt.detail.number !== activeCallNumber) return;

  const card = overlay.querySelector('.prm-card');
  card?.classList.add('prm-answered');

  const dot = overlay.querySelector('.prm-call-dot');
  if (dot) {
    dot.style.background = '#4a9eff';
    dot.classList.remove('prm-pulse');
  }

  const label = overlay.querySelector('.prm-label');
  if (label) label.textContent = 'In Call';

  const actions = overlay.querySelector('.prm-actions');
  if (actions) actions.style.display = 'none';

  const footer = overlay.querySelector('.prm-footer-msg');
  if (footer) footer.textContent = '';
});

window.addEventListener('__3cx_prm_call_ended', (evt) => {
  if (!overlay || !activeCallNumber) return;
  if (evt.detail?.number && evt.detail.number !== activeCallNumber) return;

  startAutoDismiss(6000);

  const dot = overlay.querySelector('.prm-call-dot');
  if (dot) {
    dot.style.background = '#e05c5c';
    dot.classList.remove('prm-pulse');
  }

  const label = overlay.querySelector('.prm-label');
  if (label) label.textContent = 'Call Ended';

  const footer = overlay.querySelector('.prm-footer-msg');
  if (footer) footer.textContent = 'Closing in 6s';

  const actions = overlay.querySelector('.prm-actions');
  if (actions) actions.style.display = 'flex';

  chrome.storage.local.set({
    lastCall: {
      number: activeCallNumber,
      timestamp: Date.now(),
      partnerId: activeCallPartner?.id || null
    }
  });
});

// ── Background messaging ──────────────────────────────────────────────────────
function bgMsg(type, extra = {}) {
  return new Promise(resolve => {
    chrome.runtime.sendMessage({ type, ...extra }, response => {
      if (chrome.runtime.lastError) {
        resolve({
          ok: false,
          error: chrome.runtime.lastError.message
        });
        return;
      }

      resolve(response || { ok: false });
    });
  });
}

async function lookupCaller(number) {
  const key = String(number || '');
  const cached = callerCache.get(key);

  if (cached && Date.now() - cached.createdAt < CALLER_CACHE_TTL) {
    return cached.response;
  }

  const response = await bgMsg('MATCH_CALLER', { number });

  if (response?.ok) {
    callerCache.set(key, { response, createdAt: Date.now() });
  }

  return response;
}

// ── Overlay renderer ──────────────────────────────────────────────────────────
function showOverlay({ number, state, partner, direction = 'inbound' }) {
  removeOverlay(false);
  injectStyles();

  overlay = document.createElement('div');
  overlay.id = 'prm-call-overlay';

  if (state === 'looking') {
    overlay.innerHTML = buildLookingHTML(number, direction);
  } else if (state === 'found' && partner) {
    overlay.innerHTML = buildFoundHTML(number, partner, direction);
  } else {
    overlay.innerHTML = buildUnknownHTML(number, direction);
  }

  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay?.classList.add('prm-visible'));

  overlay.querySelectorAll('.prm-dismiss').forEach(btn => {
    btn.addEventListener('click', () => removeOverlay());
  });

  overlay.querySelector('#prm-open-partner')?.addEventListener('click', () => {
    chrome.storage.local.set({
      dashboardJumpPartnerId: partner?.id
    });

    bgMsg('OPEN_DASHBOARD');
    removeOverlay();
  });

  overlay.querySelector('#prm-add-note')?.addEventListener('click', () => {
    chrome.storage.local.set({
      dashboardJumpPartnerId: partner?.id,
      dashboardJumpTab: 'notes',
      dashboardPrefillSubject: `Call from ${number}`
    });

    bgMsg('OPEN_DASHBOARD');
    removeOverlay();
  });

  overlay.querySelector('#prm-open-prm')?.addEventListener('click', () => {
    chrome.storage.local.set({
      dashboardSearchNumber: number,
      dashboardJumpTab: 'partners'
    });

    bgMsg('OPEN_DASHBOARD');
    removeOverlay();
  });

  if (state === 'unknown') startAutoDismiss(20000);
}

function buildLookingHTML(number, direction = 'inbound') {
  return `
    <div class="prm-card">
      <div class="prm-topbar">
        <span class="prm-call-dot prm-pulse"></span>
        <span class="prm-label">${esc(callLabel(direction))}</span>
        <button class="prm-x prm-dismiss">✕</button>
      </div>
      <div class="prm-number">${esc(formatNumber(number))}</div>
      <div class="prm-looking">
        <span class="prm-spinner"></span> Looking up partner…
      </div>
    </div>`;
}

function buildFoundHTML(number, p, direction = 'inbound') {
  const initials = getInitials(p.company);
  const tier = detectTier(p.category || p.type || '');
  const lastNote = p.lastNote;
  const noteDate = lastNote ? parseNoteDate(lastNote.modified) : null;
  const daysSince = noteDate ? daysBetween(noteDate, new Date()) : null;

  return `
    <div class="prm-card prm-found">
      <div class="prm-topbar">
        <span class="prm-call-dot prm-pulse"></span>
        <span class="prm-label">${esc(callLabel(direction))}</span>
        <button class="prm-x prm-dismiss">✕</button>
      </div>

      <div class="prm-number">${esc(formatNumber(number))}</div>

      <div class="prm-partner-row">
        <div class="prm-avatar">${esc(initials)}</div>
        <div class="prm-partner-info">
          <div class="prm-partner-name">${esc(p.company || 'Unknown Partner')}</div>
          <div class="prm-partner-contact">
            ${esc(p.contact || '')}${p.email ? ` · ${esc(p.email)}` : ''}
          </div>
        </div>
        ${tier ? `<span class="prm-tier prm-tier-${esc(tier.cls)}">${esc(tier.label)}</span>` : ''}
      </div>

      ${lastNote ? `
        <div class="prm-last-note">
          <span class="prm-note-icon">📝</span>
          <span class="prm-note-text">
            <strong>${esc(lastNote.subject || '')}</strong>
            ${daysSince !== null ? `<span class="prm-note-age">${daysSince}d ago · ${esc(lastNote.poster || '')}</span>` : ''}
          </span>
        </div>` : ''}

      <div class="prm-actions">
        <button id="prm-open-partner" class="prm-btn prm-btn-primary">Open Partner</button>
        <button id="prm-add-note" class="prm-btn prm-btn-secondary">+ Note</button>
        <button class="prm-btn prm-btn-ghost prm-dismiss">Dismiss</button>
      </div>

      <div class="prm-footer-msg"></div>
    </div>`;
}

function buildUnknownHTML(number, direction = 'inbound') {
  return `
    <div class="prm-card prm-unknown">
      <div class="prm-topbar">
        <span class="prm-call-dot prm-pulse"></span>
        <span class="prm-label">${esc(callLabel(direction))}</span>
        <button class="prm-x prm-dismiss">✕</button>
      </div>

      <div class="prm-number">${esc(formatNumber(number))}</div>
      <div class="prm-no-match">No partner match found</div>

      <div class="prm-actions">
        <button id="prm-open-prm" class="prm-btn prm-btn-secondary">Open PRM</button>
        <button class="prm-btn prm-btn-ghost prm-dismiss">Dismiss</button>
      </div>

      <div class="prm-footer-msg"></div>
    </div>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function removeOverlay(animate = true) {
  clearTimeout(dismissTimer);

  if (!overlay) return;

  const current = overlay;

  if (!animate) {
    current.remove();
    if (overlay === current) overlay = null;
    return;
  }

  current.classList.remove('prm-visible');

  setTimeout(() => {
    current.remove();
    if (overlay === current) overlay = null;
  }, 300);
}

function startAutoDismiss(ms) {
  clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => removeOverlay(), ms);
}

function callLabel(direction) {
  return direction === 'outbound' ? 'Outbound Call' : 'Inbound Call';
}

function formatNumber(n) {
  const number = String(n || '');

  if (number.startsWith('+49') && number.length >= 11) {
    return number.replace(/(\+49)(\d{3,5})(\d+)/, '$1 $2 $3');
  }

  return number;
}

function getInitials(company) {
  return String(company || '?')
    .trim()
    .split(/\s+/)
    .map(w => w[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

function detectTier(str) {
  const s = String(str || '').toLowerCase();

  if (s.includes('plat')) return { label: 'Platinum', cls: 'platinum' };
  if (s.includes('gold')) return { label: 'Gold', cls: 'gold' };
  if (s.includes('silv')) return { label: 'Silver', cls: 'silver' };
  if (s.includes('auth')) return { label: 'Auth.', cls: 'auth' };

  return null;
}

function parseNoteDate(str) {
  if (!str) return null;

  const raw = String(str);
  const m = raw.match(/(\d{2})\/(\d{2})\/(\d{2,4})/);

  if (m) {
    const year = m[3].length === 2 ? `20${m[3]}` : m[3];
    return new Date(`${year}-${m[2]}-${m[1]}`);
  }

  return new Date(raw);
}

function daysBetween(d1, d2) {
  if (!d1 || !d2 || isNaN(d1) || isNaN(d2)) return null;
  return Math.round(Math.abs(d2 - d1) / 86400000);
}

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// ── Styles ────────────────────────────────────────────────────────────────────
function injectStyles() {
  if (document.getElementById('prm-styles')) return;

  const style = document.createElement('style');
  style.id = 'prm-styles';

  style.textContent = `
    #prm-call-overlay {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      font-family: 'Segoe UI', system-ui, sans-serif;
      font-size: 13px;
      transform: translateY(120%);
      opacity: 0;
      transition: transform .3s cubic-bezier(.34,1.56,.64,1), opacity .25s ease;
      pointer-events: none;
    }

    #prm-call-overlay.prm-visible {
      transform: translateY(0);
      opacity: 1;
      pointer-events: all;
    }

    .prm-card {
      background: #1a1d24;
      border: 1px solid #2a2d36;
      border-radius: 12px;
      width: 320px;
      box-shadow: 0 8px 32px rgba(0,0,0,.6), 0 0 0 1px rgba(0,200,170,.15);
      overflow: hidden;
    }

    .prm-found { border-color: #00c4aa44; }
    .prm-unknown { border-color: #f0a50044; }

    .prm-topbar {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 10px 14px 6px;
      background: #12141a;
    }

    .prm-call-dot {
      width: 8px;
      height: 8px;
      border-radius: 50%;
      background: #4caf82;
      flex-shrink: 0;
    }

    .prm-pulse {
      animation: prm-pulse 1.2s ease-in-out infinite;
    }

    @keyframes prm-pulse {
      0%, 100% { opacity: 1; transform: scale(1); }
      50% { opacity: .6; transform: scale(1.3); }
    }

    .prm-label {
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .5px;
      color: #4caf82;
      flex: 1;
    }

    .prm-x {
      background: none;
      border: none;
      color: #5a5f6b;
      font-size: 14px;
      cursor: pointer;
      padding: 0 2px;
      line-height: 1;
      transition: color .15s;
    }

    .prm-x:hover {
      color: #e8eaee;
    }

    .prm-number {
      padding: 8px 14px 4px;
      font-size: 20px;
      font-weight: 700;
      color: #e8eaee;
      letter-spacing: .5px;
    }

    .prm-looking {
      padding: 10px 14px 14px;
      font-size: 12px;
      color: #8b909a;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .prm-spinner {
      display: inline-block;
      width: 12px;
      height: 12px;
      border: 2px solid #2a2d36;
      border-top-color: #00c4aa;
      border-radius: 50%;
      animation: prm-spin .7s linear infinite;
    }

    @keyframes prm-spin {
      to { transform: rotate(360deg); }
    }

    .prm-partner-row {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 10px 14px 6px;
      border-top: 1px solid #2a2d36;
    }

    .prm-avatar {
      width: 36px;
      height: 36px;
      border-radius: 8px;
      background: linear-gradient(135deg, #00c4aa, #0097c7);
      display: flex;
      align-items: center;
      justify-content: center;
      font-weight: 700;
      font-size: 14px;
      color: #fff;
      flex-shrink: 0;
    }

    .prm-partner-info {
      flex: 1;
      min-width: 0;
    }

    .prm-partner-name {
      font-size: 14px;
      font-weight: 600;
      color: #e8eaee;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .prm-partner-contact {
      font-size: 11px;
      color: #8b909a;
      margin-top: 1px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .prm-tier {
      font-size: 10px;
      font-weight: 700;
      padding: 2px 7px;
      border-radius: 4px;
      flex-shrink: 0;
    }

    .prm-tier-platinum { background: #2a2040; color: #c8a8f0; }
    .prm-tier-gold { background: #2d2410; color: #f0c060; }
    .prm-tier-silver { background: #1e2228; color: #a0b0c0; }
    .prm-tier-auth { background: #1a2a1a; color: #70c070; }

    .prm-last-note {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      margin: 6px 14px 0;
      padding: 8px 10px;
      background: #12141a;
      border-radius: 6px;
      border: 1px solid #2a2d36;
    }

    .prm-note-icon {
      font-size: 12px;
      flex-shrink: 0;
      margin-top: 1px;
    }

    .prm-note-text {
      font-size: 11px;
      color: #8b909a;
      line-height: 1.4;
    }

    .prm-note-text strong {
      color: #c8cdd6;
      display: block;
    }

    .prm-note-age {
      color: #5a5f6b;
    }

    .prm-no-match {
      padding: 8px 14px 4px;
      font-size: 12px;
      color: #f0a500;
    }

    .prm-actions {
      display: flex;
      gap: 6px;
      padding: 10px 14px 12px;
    }

    .prm-btn {
      padding: 7px 12px;
      border: none;
      border-radius: 6px;
      font: 600 11px 'Segoe UI', system-ui, sans-serif;
      cursor: pointer;
      transition: opacity .15s;
    }

    .prm-btn-primary {
      background: linear-gradient(135deg, #00c4aa, #0097c7);
      color: #fff;
      flex: 1;
    }

    .prm-btn-secondary {
      background: #2a2d36;
      color: #c8cdd6;
      flex: 1;
    }

    .prm-btn-ghost {
      background: transparent;
      color: #5a5f6b;
      border: 1px solid #2a2d36;
    }

    .prm-btn:hover {
      opacity: .85;
    }

    .prm-card.prm-answered {
      border-color: #4a9eff44;
    }

    .prm-answered .prm-last-note,
    .prm-answered .prm-no-match {
      display: none;
    }

    .prm-footer-msg {
      padding: 0 14px 8px;
      font-size: 10px;
      color: #5a5f6b;
      text-align: center;
      min-height: 16px;
    }
  `;

  document.head.appendChild(style);
}