// ============================================================
// ONYX Bridge Client  |  onyx-bridge-client.js
// ============================================================
// Loaded by the SPA (on onrender.com or localhost). Provides a
// simple async API for requesting data from the ONYX Chrome
// extension via bridge.js (content script).
//
// Usage:
//   const partners = await onyxBridge.fetchPartnerList();
//   const partner  = await onyxBridge.fetchPartner360();
//   const session  = await onyxBridge.checkSession();
//
// If the extension isn't installed or bridge.js isn't running,
// calls resolve to null after a 3-second timeout.
// ============================================================

window.onyxBridge = (() => {
  let _ready = false;
  let _readyPromise = null;
  let _reqId = 0;

  // Listen for bridge ready signal
  window.addEventListener("onyx-bridge:ready", () => { _ready = true; });

  // If bridge.js already fired before this script loaded, detect it
  // by checking if the content script injected its marker.
  if (window.__onyxBridgeContent__) _ready = true;

  /**
   * Wait for bridge to be ready (max 3 seconds).
   * Returns true if bridge is available, false otherwise.
   */
  function waitForBridge() {
    if (_ready) return Promise.resolve(true);
    if (_readyPromise) return _readyPromise;
    _readyPromise = new Promise((resolve) => {
      const handler = () => { _ready = true; resolve(true); };
      window.addEventListener("onyx-bridge:ready", handler, { once: true });
      setTimeout(() => { if (!_ready) resolve(false); }, 3000);
    });
    return _readyPromise;
  }

  /**
   * Send a message to the extension background via bridge.js.
   * Returns { ok, result, error } or null if bridge unavailable.
   */
  function send(type, payload = {}) {
    return new Promise((resolve) => {
      if (!_ready) { resolve(null); return; }
      const reqId = `br_${++_reqId}_${Date.now()}`;
      const handler = (e) => {
        if (e.detail?.reqId !== reqId) return;
        window.removeEventListener("onyx-bridge:response", handler);
        resolve(e.detail);
      };
      window.addEventListener("onyx-bridge:response", handler);
      window.dispatchEvent(new CustomEvent("onyx-bridge:request", {
        detail: { reqId, type, ...payload },
      }));
      // Timeout: if extension takes too long, don't hang the SPA
      setTimeout(() => {
        window.removeEventListener("onyx-bridge:response", handler);
        resolve(null);
      }, 30000); // 30s — partner360 can take a while on slow connections
    });
  }

  // ── Public API ────────────────────────────────────────────────────────────

  return {
    /** True once bridge.js has signalled it's loaded */
    get ready() { return _ready; },

    /** Wait up to 3s for the bridge to become available */
    waitForBridge,

    /** Raw message send — any type the background supports */
    send,

    /** Check staff.3cx.com session health */
    async checkSession() {
      const r = await send("CHECK_SESSION");
      return r?.ok ? r.result : null;
    },

    /** Fetch the partner list (scrapes customers.aspx, caches in extension) */
    async fetchPartnerList() {
      const r = await send("FETCH_PARTNER_LIST");
      return r?.ok ? r.result : [];
    },

    /** Fetch filtered partner list by tier level */
    async fetchPartnerListFiltered(levelId) {
      const r = await send("FETCH_PARTNER_LIST_FILTERED", { levelId });
      return r?.ok ? r.result : [];
    },

    /** Fetch full partner 360 (keys, orders, notes, users — ~3 sec) */
    async fetchPartner360(partnerId) {
      const r = await send("FETCH_PARTNER360", { partnerId });
      return r?.ok ? r.result : null;
    },

    /** Get refresh status from chrome.storage.local */
    async getRefreshStatus() {
      const r = await send("REFRESH_STATUS");
      return r?.ok ? r.result : null;
    },

    /**
     * Build a snapshot-shaped object that prm-app.js can consume.
     * The snapshot has partners from the list and empty detail arrays.
     * Per-partner details are loaded on-demand via fetchPartner360.
     */
    async buildSnapshot(email) {
      const partners = await this.fetchPartnerList();
      return {
        rep: { email: email || "bridge-user", name: email?.split("@")[0] || "User" },
        partners: partners.map(p => ({
          id: p.id,
          companyName: p.company,
          contactName: p.contact || "",
          country: p.country || p.Country || "",
          salesRegion: p.region || p["Sales Region"] || "",
          distributorLevel: p.cert || p.Cert || "",
          partnerCategory: p.category || p["Partner Category"] || "",
          accountOwnerName: p.agent || p["Team Agent"] || "",
          annualRevenueUsd: p.revenue || p["Annual Revenue"] || "",
        })),
        // Empty — per-partner details come from fetchPartner360 on click
        licenseKeys: [],
        orders: [],
        calls: [],
        updatedAt: new Date().toISOString(),
      };
    },
  };
})();
