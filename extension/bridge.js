// ============================================================
// ONYX Bridge  |  bridge.js (content script on the ONYX origin)
// ============================================================
// Lets the /erp page request a per-partner deep-fetch from the
// extension via window CustomEvents, since the page itself isn't
// in chrome.* land. One-way request/response keyed by reqId.
// ============================================================

(() => {
  if (window.__onyxBridgeContent__) return;
  window.__onyxBridgeContent__ = true;

  // Tell the page the bridge is loaded.
  window.dispatchEvent(new CustomEvent("onyx-bridge:ready"));

  window.addEventListener("onyx-bridge:fetch-detail", async (e) => {
    const reqId = e.detail?.reqId;
    const partnerId = e.detail?.partnerId;
    let result, error;
    try {
      const r = await chrome.runtime.sendMessage({
        type: "FETCH_PARTNER_DETAIL",
        partnerId,
      });
      if (!r?.ok) error = r?.error || "Background did not respond";
      else result = r.result;
    } catch (err) {
      error = err?.message || String(err);
    }
    window.dispatchEvent(
      new CustomEvent("onyx-bridge:detail-fetched", {
        detail: { reqId, ok: !error, error, result },
      }),
    );
  });
})();
