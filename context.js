// ============================================================
// 3CX Partner PRM  |  popup.js
// ============================================================

const $ = id => document.getElementById(id);

// ── SW-safe message helper ────────────────────────────────────────────────────
// Wakes the service worker by pinging it first, then sends the real message.
// Handles the MV3 "SW terminated" problem gracefully.
function msg(type, extra = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...extra }, (r) => {
        if (chrome.runtime.lastError) {
          // SW was terminated — resolve with null rather than throwing
          console.warn('PRM SW:', chrome.runtime.lastError.message);
          resolve(null);
        } else {
          resolve(r);
        }
      });
    } catch (e) {
      console.warn('PRM msg error:', e);
      resolve(null);
    }
  });
}

function setStatus(t, c = 'idle', sp = false) {
  const el = $('status');
  el.className = c;
  el.innerHTML = sp ? `<div class="spinner"></div>${t}` : t;
}

// ── Session health ────────────────────────────────────────────────────────────
async function checkSession() {
  const dot = $('dot'), bar = $('bar');
  // Give SW up to 3s to respond
  const r = await Promise.race([
    msg('CHECK_SESSION'),
    new Promise(res => setTimeout(() => res(null), 3000))
  ]);

  if (!r?.ok) {
    dot.style.background = '#e05c5c';
    dot.title = r?.error ?? 'Session check failed — reload extension or log in';
    bar.style.cssText = 'display:block;padding:5px 14px;font-size:11px;background:#2d1e1e;border-left:3px solid #e05c5c;color:#e05c5c;border-bottom:1px solid var(--b)';
    bar.innerHTML = `🔒 Not signed in — <a href="https://staff.3cx.com" target="_blank" style="color:#e05c5c">open staff.3cx.com</a>`;
    return;
  }

  const h = r.result;
  if (h.healthy) {
    dot.style.background = '#4caf82';
    dot.title = h.sessionInfo
      ? `${h.sessionInfo.email} — expires ${h.sessionInfo.expiresAt}`
      : 'Signed in';
    if (h.sessionInfo?.minsLeft < 60 && h.sessionInfo?.minsLeft > 0) {
      bar.style.cssText = 'display:block;padding:5px 14px;font-size:11px;background:#1e2d20;border-left:3px solid #f0a500;color:#c8a85a;border-bottom:1px solid var(--b)';
      bar.textContent = `⚠️ Session expires in ${h.sessionInfo.minsLeft}min`;
    }
  } else {
    dot.style.background = '#e05c5c';
    const reason = h.issues?.[0]?.msg ?? 'Session issue';
    dot.title = reason;
    bar.style.cssText = 'display:block;padding:5px 14px;font-size:11px;background:#2d1e1e;border-left:3px solid #e05c5c;color:#e05c5c;border-bottom:1px solid var(--b)';
    const isCF = h.issues?.some(i => i.code === 'CF_EXPIRED');
    bar.innerHTML = isCF
      ? `🔒 Not signed in — <a href="https://staff.3cx.com" target="_blank" style="color:#e05c5c">open staff.3cx.com</a>`
      : `⚠️ ${reason}`;
  }
}

// ── Dashboard — open DIRECTLY (no SW needed) ─────────────────────────────────
$('btnDash').addEventListener('click', () => {
  const url = chrome.runtime.getURL('dashboard.html');
  chrome.tabs.create({ url });
});

// ── Gmail autofill ────────────────────────────────────────────────────────────
(async () => {
  try {
    const [tab] = await chrome.tabs.query({
      active: true, currentWindow: true, url: 'https://mail.google.com/*'
    });
    if (!tab) return;
    let e;
    try {
      e = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_EMAIL' });
    } catch {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      e = await chrome.tabs.sendMessage(tab.id, { type: 'EXTRACT_EMAIL' });
    }
    if (e?.subject && !$('subj').value) $('subj').value = e.subject;
    if (e?.body    && !$('nbody').value) $('nbody').value = e.body;
    if (e?.is3cx) setStatus('📞 3CX transcription detected', 'ok');
  } catch { /* no Gmail tab */ }
})();

// ── Persist partner ID ────────────────────────────────────────────────────────
chrome.storage.local.get('lastPid', d => {
  if (d.lastPid) $('pid').value = d.lastPid;
});
$('pid').addEventListener('input', () =>
  chrome.storage.local.set({ lastPid: $('pid').value.trim() })
);

// ── Post note ─────────────────────────────────────────────────────────────────
$('btnPost').addEventListener('click', async () => {
  const pid  = $('pid').value.trim();
  const subj = $('subj').value.trim();
  const body = $('nbody').value.trim();
  if (!pid)  { setStatus('⚠️ Partner ID required', 'err'); return; }
  if (!subj) { setStatus('⚠️ Subject required',    'err'); return; }
  if (!body) { setStatus('⚠️ Body required',       'err'); return; }

  $('btnPost').disabled = true;
  setStatus('Posting…', 'busy', true);
  const r = await msg('POST_NOTE', {
    payload: { partnerId: pid, subject: subj, body, noteType: parseInt($('ntype').value) }
  });
  $('btnPost').disabled = false;
  r?.ok ? setStatus('✅ Note posted!', 'ok') : setStatus(`❌ ${r?.error ?? 'Failed'}`, 'err');
});

// Progress from background
chrome.runtime.onMessage.addListener(m => {
  if (m.type === 'note_progress') setStatus(m.payload, 'busy', true);
});

$('btnClr').addEventListener('click', () => {
  $('subj').value = ''; $('nbody').value = '';
  setStatus('Cleared', 'idle');
});
$('noteType')?.addEventListener('change', () =>
  chrome.storage.local.set({ lastNoteType: $('ntype')?.value })
);

// ── Init ──────────────────────────────────────────────────────────────────────
checkSession();
