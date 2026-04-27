// ============================================================
// ONYX Bridge  |  webclient.js (content script on team.3cx.com)
// ============================================================
// Detects inbound calls on the 3CX webclient, asks the ONYX server
// (via background) to match the caller-id against partner phones,
// and renders a floating overlay with a deep-link into ONYX.
//
// Detection strategy is intentionally heuristic — team.3cx.com's
// internal call APIs aren't documented, so we listen for the cues
// the UI gives us, in priority order:
//
//   1. document.title changes that include an inbound-call cue and
//      a phone-shaped number (most reliable across 3CX versions).
//   2. MutationObserver on the body — any newly-added element whose
//      text contains BOTH an inbound cue and a phone-shaped number.
//
// Both feed the same matchCaller() once per phone number per 30s,
// so duplicates from overlapping cues collapse to one overlay.
// ============================================================

(() => {
  if (window.__onyxBridgeWebclient__) return;
  window.__onyxBridgeWebclient__ = true;

  const INBOUND_CUE_RE =
    /\b(incoming|inbound|ringing|llamada\s+entrante|appel\s+entrant|eingehend)\b/i;
  // Capture E.164-ish numbers (must have ≥7 digits total).
  const PHONE_RE = /(\+?\d[\d\s().\-]{6,}\d)/;

  const RECENT_TTL_MS = 30_000;
  const recent = new Map(); // digits → timestamp

  function digitsOnly(s) {
    return String(s == null ? "" : s).replace(/\D/g, "");
  }

  function isFreshCaller(digits) {
    const now = Date.now();
    for (const [k, t] of recent) if (now - t > RECENT_TTL_MS) recent.delete(k);
    if (recent.has(digits)) return false;
    recent.set(digits, now);
    return true;
  }

  function extractPhoneFromText(text) {
    if (!text) return null;
    const m = String(text).match(PHONE_RE);
    if (!m) return null;
    const d = digitsOnly(m[1]);
    return d.length >= 7 ? m[1].trim() : null;
  }

  function looksInbound(text) {
    return INBOUND_CUE_RE.test(String(text || ""));
  }

  // ── Match + render ─────────────────────────────────────────────────────────

  async function onInboundCall(rawPhone) {
    const digits = digitsOnly(rawPhone);
    if (!isFreshCaller(digits)) return;

    let result;
    try {
      result = await chrome.runtime.sendMessage({ type: "MATCH_CALLER", phone: rawPhone });
    } catch (e) {
      console.warn("[ONYX] match-caller failed:", e?.message || e);
      return;
    }
    if (!result?.ok) {
      console.warn("[ONYX] match-caller error:", result?.error);
      return;
    }

    const url = await chrome.runtime.sendMessage({ type: "GET_ONYX_URL" });
    const onyxBase = (url?.url || "http://localhost:3000").replace(/\/+$/, "");

    renderOverlay({ caller: rawPhone, ...result.result, onyxBase });
  }

  // ── Overlay ───────────────────────────────────────────────────────────────

  function injectStylesOnce() {
    if (document.getElementById("onyx-overlay-styles")) return;
    const s = document.createElement("style");
    s.id = "onyx-overlay-styles";
    s.textContent = `
      #onyx-overlay {
        position: fixed; top: 16px; right: 16px; z-index: 2147483647;
        width: 320px; max-width: calc(100vw - 32px);
        background: #141c28; color: #e6e8eb;
        border: 1px solid #2d3a4d; border-radius: 10px;
        font: 13px/1.4 system-ui, -apple-system, "Segoe UI", sans-serif;
        box-shadow: 0 12px 32px rgba(0,0,0,.4);
        animation: onyx-slide-in .18s ease-out;
      }
      @keyframes onyx-slide-in {
        from { transform: translateX(20px); opacity: 0; }
        to   { transform: none; opacity: 1; }
      }
      #onyx-overlay header {
        display: flex; align-items: center; gap: 8px;
        padding: 10px 12px; border-bottom: 1px solid #2d3a4d;
      }
      #onyx-overlay .logo {
        width: 22px; height: 22px; border-radius: 5px;
        background: linear-gradient(135deg, #5c9dff, #3d8bfd);
        display: flex; align-items: center; justify-content: center;
        font-weight: 700; font-size: 9px; color: #fff;
      }
      #onyx-overlay header h1 { margin: 0; font-size: 12px; flex: 1; }
      #onyx-overlay .close {
        background: transparent; border: 0; color: #9ba3ae;
        cursor: pointer; font-size: 16px; line-height: 1;
      }
      #onyx-overlay .body { padding: 10px 12px 12px; }
      #onyx-overlay .caller {
        font-size: 11px; color: #9ba3ae; text-transform: uppercase;
        letter-spacing: .04em; margin-bottom: 4px;
      }
      #onyx-overlay .number { font-size: 14px; font-weight: 600; margin-bottom: 8px; }
      #onyx-overlay .partner { font-size: 14px; font-weight: 600; }
      #onyx-overlay .meta { font-size: 12px; color: #9ba3ae; margin: 4px 0 10px; }
      #onyx-overlay .open {
        display: block; width: 100%; text-align: center;
        background: #3d8bfd; color: #fff; text-decoration: none;
        padding: 8px 10px; border-radius: 6px; font-weight: 600;
      }
      #onyx-overlay .open:hover { opacity: .9; }
      #onyx-overlay .nomatch { color: #9ba3ae; font-style: italic; }
    `;
    document.documentElement.appendChild(s);
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function renderOverlay({ caller, matched, candidates, onyxBase }) {
    injectStylesOnce();
    document.getElementById("onyx-overlay")?.remove();

    const root = document.createElement("div");
    root.id = "onyx-overlay";

    let bodyHtml;
    if (matched && candidates.length) {
      const c = candidates[0];
      const p = c.partner;
      const owner = c.accountOwner?.name || "—";
      const params = new URLSearchParams({
        partnerId: p.id,
        route: "dashboard/insights",
      });
      bodyHtml = `
        <div class="caller">Inbound</div>
        <div class="number">${escapeHtml(caller)}</div>
        <div class="partner">${escapeHtml(p.companyName)}</div>
        <div class="meta">
          ${escapeHtml(p.distributorLevel)} · ${escapeHtml(p.country)}<br>
          Owner: ${escapeHtml(owner)}
          ${candidates.length > 1 ? ` · +${candidates.length - 1} other match${candidates.length > 2 ? "es" : ""}` : ""}
        </div>
        <a class="open" href="${onyxBase}/?${params.toString()}" target="_blank" rel="noopener">Open in ONYX →</a>
      `;
    } else {
      const params = new URLSearchParams({
        route: "chat",
        prefill: `Inbound caller ${caller} did not match any partner phone in ONYX. What should I do?`,
      });
      bodyHtml = `
        <div class="caller">Inbound</div>
        <div class="number">${escapeHtml(caller)}</div>
        <p class="nomatch">No partner match in ONYX</p>
        <a class="open" href="${onyxBase}/?${params.toString()}" target="_blank" rel="noopener">Ask ONYX about this caller →</a>
      `;
    }

    root.innerHTML = `
      <header>
        <div class="logo">ONYX</div>
        <h1>Caller match</h1>
        <button class="close" aria-label="Dismiss">×</button>
      </header>
      <div class="body">${bodyHtml}</div>
    `;
    root.querySelector(".close").addEventListener("click", () => root.remove());
    document.body.appendChild(root);

    // Auto-dismiss after 45s if the user doesn't act on it.
    setTimeout(() => root.remove(), 45_000);
  }

  // ── Detectors ─────────────────────────────────────────────────────────────

  function tryDetectFromText(text) {
    if (!looksInbound(text)) return;
    const phone = extractPhoneFromText(text);
    if (!phone) return;
    onInboundCall(phone);
  }

  // 1) Title watcher
  let lastTitle = "";
  function checkTitle() {
    if (document.title === lastTitle) return;
    lastTitle = document.title;
    tryDetectFromText(document.title);
  }
  setInterval(checkTitle, 500);

  // 2) DOM mutation watcher — added subtrees only
  const observer = new MutationObserver((records) => {
    for (const rec of records) {
      for (const node of rec.addedNodes) {
        if (node.nodeType !== Node.ELEMENT_NODE) continue;
        const text = node.textContent || "";
        if (text.length > 4000) continue; // skip large unrelated subtrees
        tryDetectFromText(text);
      }
    }
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
})();
