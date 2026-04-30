// ============================================================
// ONYX Bridge  |  bridge.js (content script on ONYX SPA origin)
// ============================================================
// Lets the SPA (running on onrender.com or localhost) request data from
// the extension's background.js via CustomEvents.
//
// Protocol:
//   SPA -> bridge:  CustomEvent "onyx-bridge:request"  { reqId, type, ...payload }
//   bridge -> BG:   chrome.runtime.sendMessage({ type, ...payload })
//   BG -> bridge:   response via sendResponse callback
//   bridge -> SPA:  CustomEvent "onyx-bridge:response"  { reqId, ok, result|error }
// ============================================================

(() => {
  if (window.__onyxBridgeContent__) return;
  window.__onyxBridgeContent__ = true;

  window.dispatchEvent(new CustomEvent("onyx-bridge:ready"));

  window.addEventListener("onyx-bridge:request", async (e) => {
    const { reqId, type, ...payload } = e.detail || {};
    if (!type) return;
    let result, error;
    try {
      const r = await chrome.runtime.sendMessage({ type, ...payload });
      if (!r?.ok) error = r?.error || "Background did not respond";
      else result = r.result;
    } catch (err) {
      error = err?.message || String(err);
    }
    window.dispatchEvent(
      new CustomEvent("onyx-bridge:response", {
        detail: { reqId, ok: !error, error, result },
      }),
    );
  });
})();
