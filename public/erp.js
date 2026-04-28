(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const params = new URLSearchParams(location.search);

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function relativeTime(iso) {
    if (!iso) return "never";
    const diff = Date.now() - new Date(iso).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "just now";
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.floor(hours / 24)}d ago`;
  }

  function tierClass(level) {
    const k = String(level || "").toLowerCase();
    if (k.includes("titanium")) return "tier-titanium";
    if (k.includes("platinum")) return "tier-platinum";
    if (k.includes("gold")) return "tier-gold";
    if (k.includes("silver")) return "tier-silver";
    if (k.includes("bronze")) return "tier-bronze";
    return "tier-default";
  }

  function getPartnerLevel(p) {
    return p.cert || p["Cert"] || p["Partner Category"] || p.category || "—";
  }

  function getPartnerCountry(p) {
    return p.country || p["Country"] || "—";
  }

  function getPartnerRegion(p) {
    return p.region || p["Sales Region"] || "—";
  }

  function getPartnerAgent(p) {
    return p.agent || p["Team Agent"] || "—";
  }

  function getPartnerRevenue(p) {
    return p.revenue || p["Annual Revenue"] || "—";
  }

  // ── State ──────────────────────────────────────────────────────────────────

  const state = {
    snapshot: null,
    partners: [],
    filteredPartners: [],
    levelFilter: "",
    searchQuery: "",
    activePartnerId: null,
    activeTab: "overview",
    notes: [],
    bridgeReady: false,
    detailFetching: new Set(),
  };

  // ── Extension bridge (only available when the page is opened in a browser
  // that has the ONYX extension installed and the page URL matches the
  // bridge's content_script pattern). One-way request/response by reqId.
  // ──────────────────────────────────────────────────────────────────────────

  const detailWaiters = new Map(); // reqId → resolve

  window.addEventListener("onyx-bridge:ready", () => {
    state.bridgeReady = true;
    // If a tab is already open and waiting, re-render so its CTA updates.
    if (state.activePartnerId) renderMain();
  });

  window.addEventListener("onyx-bridge:detail-fetched", (e) => {
    const d = e.detail || {};
    const resolver = detailWaiters.get(d.reqId);
    if (!resolver) return;
    detailWaiters.delete(d.reqId);
    resolver(d);
  });

  function bridgeFetchDetail(partnerId) {
    if (!state.bridgeReady) {
      return Promise.reject(new Error("Extension bridge not detected"));
    }
    const reqId = `req-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    return new Promise((resolve, reject) => {
      detailWaiters.set(reqId, (d) => (d.ok ? resolve(d.result) : reject(new Error(d.error || "Fetch failed"))));
      window.dispatchEvent(
        new CustomEvent("onyx-bridge:fetch-detail", {
          detail: { reqId, partnerId },
        }),
      );
      setTimeout(() => {
        if (detailWaiters.has(reqId)) {
          detailWaiters.delete(reqId);
          reject(new Error("Detail fetch timed out (60s)"));
        }
      }, 60_000);
    });
  }

  async function reloadSnapshot() {
    const slug = state.snapshot?.rep?.slug;
    if (!slug) return;
    const r = await fetch(`/api/snapshots/${encodeURIComponent(slug)}`);
    if (!r.ok) return;
    state.snapshot = await r.json();
    state.partners = state.snapshot.partners || [];
  }

  function partnerDetail(partnerId) {
    return state.snapshot?.details?.[partnerId] || null;
  }

  async function ensurePartnerDetail(partnerId) {
    if (partnerDetail(partnerId) || state.detailFetching.has(partnerId)) return;
    if (!state.bridgeReady) return;
    state.detailFetching.add(partnerId);
    renderMain();
    try {
      await bridgeFetchDetail(partnerId);
      await reloadSnapshot();
    } catch (e) {
      console.warn("[ONYX] detail fetch failed:", e.message);
    } finally {
      state.detailFetching.delete(partnerId);
      if (partnerId === state.activePartnerId) renderMain();
    }
  }

  // ── Snapshot load ──────────────────────────────────────────────────────────

  async function pickSnapshot() {
    const repEmail = params.get("repEmail");
    const slug = params.get("slug");
    if (slug) {
      const r = await fetch(`/api/snapshots/${encodeURIComponent(slug)}`);
      if (r.ok) return r.json();
    }
    if (repEmail) {
      const summary = await fetch(
        `/api/sellers/me?email=${encodeURIComponent(repEmail)}`,
      );
      if (summary.ok) {
        const s = await summary.json();
        const r = await fetch(`/api/snapshots/${encodeURIComponent(s.rep.slug)}`);
        if (r.ok) return r.json();
      }
    }
    // Fall back to most recently updated snapshot
    const list = await fetch("/api/snapshots").then((r) => r.json());
    if (!list.snapshots?.length) return null;
    list.snapshots.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const top = list.snapshots[0];
    const r = await fetch(`/api/snapshots/${encodeURIComponent(top.slug)}`);
    return r.ok ? r.json() : null;
  }

  // ── Sidebar ────────────────────────────────────────────────────────────────

  function applyFilters() {
    const q = state.searchQuery.trim().toLowerCase();
    state.filteredPartners = state.partners.filter((p) => {
      if (state.levelFilter && getPartnerLevel(p) !== state.levelFilter) return false;
      if (q && !String(p.company || "").toLowerCase().includes(q)) return false;
      return true;
    });
    $("resellerCount").textContent = state.filteredPartners.length;
    renderPartnerList();
  }

  function renderLevelChips() {
    const counts = new Map();
    counts.set("", state.partners.length);
    for (const p of state.partners) {
      const lvl = getPartnerLevel(p);
      counts.set(lvl, (counts.get(lvl) || 0) + 1);
    }
    const levels = [...counts.keys()].filter((l) => l && l !== "—");
    levels.sort();
    const chips = [
      `<div class="chip ${state.levelFilter === "" ? "active" : ""}" data-level="">All<span class="count">${counts.get("")}</span></div>`,
      ...levels.map(
        (l) =>
          `<div class="chip ${state.levelFilter === l ? "active" : ""}" data-level="${escapeHtml(l)}">${escapeHtml(l)}<span class="count">${counts.get(l)}</span></div>`,
      ),
    ];
    $("levelChips").innerHTML = chips.join("");
    for (const el of $("levelChips").querySelectorAll(".chip")) {
      el.addEventListener("click", () => {
        state.levelFilter = el.dataset.level;
        applyFilters();
        renderLevelChips();
      });
    }
  }

  function renderPartnerList() {
    const list = state.filteredPartners;
    if (!list.length) {
      $("partnerList").innerHTML = `<div class="empty">No matches</div>`;
      return;
    }
    $("partnerList").innerHTML = list
      .map(
        (p) => `
        <div class="pitem ${p.id === state.activePartnerId ? "active" : ""}" data-id="${escapeHtml(p.id)}">
          <div class="pitem-name">${escapeHtml(p.company || "—")}</div>
          <div class="pitem-meta">
            ID: ${escapeHtml(p.id)} · ${escapeHtml(getPartnerRegion(p))} · ${escapeHtml(getPartnerLevel(p))} · Owner: ${escapeHtml(getPartnerAgent(p))}
          </div>
        </div>`,
      )
      .join("");
    for (const el of $("partnerList").querySelectorAll(".pitem")) {
      el.addEventListener("click", () => selectPartner(el.dataset.id));
    }
  }

  // ── Main pane ──────────────────────────────────────────────────────────────

  async function selectPartner(id) {
    state.activePartnerId = id;
    state.activeTab = "overview";
    state.notes = [];
    renderPartnerList();
    renderMain();
    await loadNotes(id);
    if (state.activeTab === "notes") renderMain();
  }

  async function loadNotes(partnerId) {
    try {
      const r = await fetch(`/api/notes?partnerId=${encodeURIComponent(partnerId)}`);
      const data = await r.json();
      state.notes = data.notes || [];
    } catch {
      state.notes = [];
    }
  }

  // Merge ONYX notes (POSTs to /api/notes) with ERP-side notes (parsed from
  // staff.3cx.com Notes tab during partner-detail fetch). Both render in
  // the Notes tab with a source badge.
  function combinedNotesForActivePartner() {
    const onyx = state.notes.map((n) => ({
      source: n.source || "onyx",
      subject: n.subject,
      body: n.body,
      whenIso: n.createdAt,
      who: n.seller || null,
    }));
    const detail = partnerDetail(state.activePartnerId);
    const erp = (detail?.erpNotes || []).map((n) => ({
      source: "erp",
      subject: n.subject,
      body: n.body,
      whenIso: null,
      whenLabel: n.modified || null,
      who: n.poster || null,
      type: n.type || null,
    }));
    return [...onyx, ...erp].sort((a, b) => {
      const ta = a.whenIso ? Date.parse(a.whenIso) : 0;
      const tb = b.whenIso ? Date.parse(b.whenIso) : 0;
      return tb - ta;
    });
  }

  function callLogForActivePartner() {
    const log = state.snapshot?.callLog || [];
    return log
      .filter((c) => !state.activePartnerId || c.partnerId === state.activePartnerId)
      .slice()
      .reverse();
  }

  function isStale(detail) {
    if (!detail?.fetchedAt) return true;
    return Date.now() - Date.parse(detail.fetchedAt) > 24 * 3600 * 1000;
  }

  function staleCount() {
    return state.partners.filter((p) => isStale(partnerDetail(p.id))).length;
  }

  function renderMain() {
    const partner = state.partners.find((p) => p.id === state.activePartnerId);
    if (!partner) {
      $("main").innerHTML = `
        <div class="empty" style="margin:auto">
          <strong>Pick a reseller from the left</strong>
          Or hit "Refresh my data from ERP" in the extension popup if the list is empty.
        </div>`;
      return;
    }

    const initials = partner.company
      .split(/\s+/)
      .map((w) => w[0])
      .join("")
      .slice(0, 2)
      .toUpperCase();
    const level = getPartnerLevel(partner);
    const tab = state.activeTab;

    $("main").innerHTML = `
      <div class="p-header">
        <div class="p-avatar">${escapeHtml(initials)}</div>
        <div class="p-info">
          <div class="p-name">${escapeHtml(partner.company)}</div>
          <div class="p-sub">ID ${escapeHtml(partner.id)} · ${escapeHtml(getPartnerCountry(partner))}</div>
        </div>
        <div class="tier-badge ${tierClass(level)}">${escapeHtml(level)}</div>
      </div>

      <div class="pills-row">
        <div class="spill">Region <strong>${escapeHtml(getPartnerRegion(partner))}</strong></div>
        <div class="spill">Team agent <strong>${escapeHtml(getPartnerAgent(partner))}</strong></div>
        <div class="spill">Revenue <strong>${escapeHtml(getPartnerRevenue(partner))}</strong></div>
        ${partner.category ? `<div class="spill">Category <strong>${escapeHtml(partner.category)}</strong></div>` : ""}
      </div>

      <div class="tabs">
        <div class="tab ${tab === "overview" ? "active" : ""}" data-tab="overview">Overview</div>
        <div class="tab ${tab === "keys" ? "active" : ""}" data-tab="keys">License keys</div>
        <div class="tab ${tab === "orders" ? "active" : ""}" data-tab="orders">Orders</div>
        <div class="tab ${tab === "calls" ? "active" : ""}" data-tab="calls">Calls</div>
        <div class="tab ${tab === "notes" ? "active" : ""}" data-tab="notes">Notes <span class="count">${state.notes.length}</span></div>
      </div>

      <div class="tab-content" id="tabContent">${renderTab(tab, partner)}</div>
    `;

    for (const el of $("main").querySelectorAll(".tab")) {
      el.addEventListener("click", () => {
        state.activeTab = el.dataset.tab;
        renderMain();
      });
    }
    if (tab === "notes") wireNoteForm(partner);
    const fetchBtn = $("btnFetchDetail");
    if (fetchBtn) fetchBtn.addEventListener("click", () => ensurePartnerDetail(partner.id));
    for (const btn of document.querySelectorAll(".detail-refresh")) {
      btn.addEventListener("click", () => forcePartnerDetail(btn.dataset.id));
    }
    renderInsightBar(partner);
    refreshTopBarStatus();
  }

  async function forcePartnerDetail(partnerId) {
    if (state.detailFetching.has(partnerId)) return;
    if (!state.bridgeReady) return;
    state.detailFetching.add(partnerId);
    renderMain();
    try {
      await bridgeFetchDetail(partnerId);
      await reloadSnapshot();
    } catch (e) {
      console.warn("[ONYX] detail refresh failed:", e.message);
    } finally {
      state.detailFetching.delete(partnerId);
      if (partnerId === state.activePartnerId) renderMain();
    }
  }

  // ── Top-bar status ─────────────────────────────────────────────────────────

  function refreshTopBarStatus() {
    const n = staleCount();
    const badge = $("staleBadge");
    if (n > 0) {
      badge.hidden = false;
      badge.textContent = `${n} stale`;
      badge.title = `${n} reseller${n === 1 ? "" : "s"} have not been deep-fetched in the last 24h or never`;
    } else {
      badge.hidden = true;
    }
    $("lastSync").textContent = state.snapshot
      ? `Last sync ${relativeTime(state.snapshot.updatedAt)}`
      : "";
  }

  // ── Refresh-all (sequential, throttled) ───────────────────────────────────

  let refreshAllRunning = false;

  async function refreshAllDetails() {
    if (refreshAllRunning) return;
    if (!state.bridgeReady) {
      alert("ONYX extension bridge not detected — open this page from the extension popup.");
      return;
    }
    refreshAllRunning = true;
    const btn = $("btnRefreshAll");
    const originalText = btn.textContent;
    btn.disabled = true;
    let done = 0;
    const total = state.partners.length;
    try {
      for (const p of state.partners) {
        if (!refreshAllRunning) break;
        btn.textContent = `Refreshing ${++done}/${total}…`;
        try {
          await bridgeFetchDetail(p.id);
        } catch (e) {
          console.warn(`[ONYX] refresh-all: ${p.id} failed:`, e.message);
        }
        // Throttle so staff.3cx.com doesn't get hammered.
        await new Promise((r) => setTimeout(r, 2500));
      }
      await reloadSnapshot();
    } finally {
      refreshAllRunning = false;
      btn.disabled = false;
      btn.textContent = originalText;
      if (state.activePartnerId) renderMain();
      else refreshTopBarStatus();
    }
  }

  // ── Insight bar ───────────────────────────────────────────────────────────

  const INSIGHT_KEY_PREFIX = "onyx-insight:";

  function insightCacheKey(partnerId) {
    return `${INSIGHT_KEY_PREFIX}${state.snapshot?.rep?.slug || "unknown"}:${partnerId}`;
  }

  function loadInsightFromCache(partnerId) {
    try {
      const raw = localStorage.getItem(insightCacheKey(partnerId));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }

  function saveInsightToCache(partnerId, insight) {
    try {
      localStorage.setItem(
        insightCacheKey(partnerId),
        JSON.stringify({ insight, generatedAt: new Date().toISOString() }),
      );
    } catch {
      /* localStorage full — ignore */
    }
  }

  function renderInsightBar(partner) {
    const bar = $("insightBar");
    if (!partner) {
      bar.hidden = true;
      return;
    }
    bar.hidden = false;
    const cached = loadInsightFromCache(partner.id);
    if (cached) {
      $("insightMeta").textContent = `${partner.company} · generated ${relativeTime(cached.generatedAt)}`;
      $("insightBody").textContent = cached.insight;
      $("btnInsight").textContent = "Regenerate";
      $("btnInsightClear").hidden = false;
    } else {
      $("insightMeta").textContent = partner.company;
      $("insightBody").innerHTML = `<div class="placeholder">No insight cached. Click <strong>Generate</strong> to ask ONYX for a brief based on this reseller's data.</div>`;
      $("btnInsight").textContent = "Generate";
      $("btnInsightClear").hidden = true;
    }
  }

  async function generateInsight() {
    const partner = state.partners.find((p) => p.id === state.activePartnerId);
    if (!partner) return;
    const detail = partnerDetail(partner.id);
    const onyxNotes = state.notes;
    const callLog = (state.snapshot?.callLog || [])
      .filter((c) => c.partnerId === partner.id)
      .slice(-20);
    const payload = { partner: { row: partner, detail, onyxNotes, callLog } };

    $("btnInsight").disabled = true;
    $("insightBody").innerHTML = `<div class="placeholder"><span class="spinner"></span>Asking ONYX…</div>`;
    try {
      const r = await fetch("/api/insight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      saveInsightToCache(partner.id, data.insight);
      renderInsightBar(partner);
    } catch (e) {
      $("insightBody").textContent = `Insight failed: ${e.message}`;
    } finally {
      $("btnInsight").disabled = false;
    }
  }

  function clearInsight(partnerId) {
    try {
      localStorage.removeItem(insightCacheKey(partnerId));
    } catch {
      /* ignore */
    }
    const partner = state.partners.find((p) => p.id === partnerId);
    if (partner) renderInsightBar(partner);
  }

  function renderTab(tab, partner) {
    if (tab === "overview") {
      return `
        <div class="card">
          <h2>Reseller info</h2>
          <dl class="kv">
            <dt>Company</dt><dd>${escapeHtml(partner.company)}</dd>
            <dt>Customer ID</dt><dd>${escapeHtml(partner.id)}</dd>
            <dt>Level</dt><dd>${escapeHtml(getPartnerLevel(partner))}</dd>
            <dt>Country</dt><dd>${escapeHtml(getPartnerCountry(partner))}</dd>
            <dt>Sales region</dt><dd>${escapeHtml(getPartnerRegion(partner))}</dd>
            <dt>Team agent</dt><dd>${escapeHtml(getPartnerAgent(partner))}</dd>
            <dt>Annual revenue</dt><dd>${escapeHtml(getPartnerRevenue(partner))}</dd>
            ${partner.category ? `<dt>Category</dt><dd>${escapeHtml(partner.category)}</dd>` : ""}
          </dl>
        </div>
        <div class="card">
          <h2>Open in staff.3cx.com</h2>
          <a class="btn btn-secondary" href="https://staff.3cx.com/partner/edit.aspx?i=${encodeURIComponent(partner.id)}" target="_blank" rel="noopener">Open partner page →</a>
        </div>`;
    }
    if (tab === "keys" || tab === "orders" || tab === "calls") {
      return renderDetailTab(tab, partner);
    }
    if (tab === "notes") {
      return `
        <div class="notes-list" id="notesList">${renderNotes()}</div>
        <div class="note-form">
          <h2>Add note (writes to ERP + ONYX)</h2>
          <div class="row">
            <div>
              <label for="ntype">Type</label>
              <select id="ntype">
                <option value="0">Contact</option>
                <option value="1">Support</option>
                <option value="2" selected>Call</option>
                <option value="3">Project</option>
                <option value="5">Email</option>
              </select>
            </div>
            <div style="flex:3">
              <label for="nsubj">Subject</label>
              <input type="text" id="nsubj" placeholder="Subject…" autocomplete="off">
            </div>
          </div>
          <label for="nbody">Body</label>
          <textarea id="nbody" placeholder="Note body…"></textarea>
          <div class="actions">
            <span class="status" id="nstatus"></span>
            <button class="btn-secondary btn" id="nclear">Clear</button>
            <button class="btn" id="npost">Post →</button>
          </div>
        </div>`;
    }
    return "";
  }

  function renderDetailTab(tab, partner) {
    const detail = partnerDetail(partner.id);
    const fetching = state.detailFetching.has(partner.id);

    if (fetching) {
      return `<div class="placeholder"><span class="spinner"></span><strong>Fetching from staff.3cx.com…</strong>This usually takes 5–15 seconds per partner.</div>`;
    }

    if (!detail) {
      if (!state.bridgeReady) {
        return `<div class="placeholder">
          <strong>Per-partner detail not synced yet</strong>
          Open this page from the ONYX extension to enable on-demand fetch from staff.3cx.com — or run a deep refresh from the popup.
        </div>`;
      }
      return `<div class="placeholder">
        <strong>Not yet fetched for this reseller</strong>
        <button class="btn" id="btnFetchDetail" style="margin-top:10px">Fetch from staff.3cx.com →</button>
      </div>`;
    }

    if (tab === "keys") {
      const errMsg = detail.errors?.keys
        ? `<div class="placeholder" style="color:var(--red);text-align:left;margin-bottom:10px"><strong>Keys fetch failed</strong>${escapeHtml(detail.errors.keys)}</div>`
        : "";
      if (!detail.keys?.length) {
        return errMsg + `<div class="placeholder">No license keys for this reseller.</div>`;
      }
      return errMsg + renderKeysTable(detail.keys);
    }
    if (tab === "orders") {
      const errMsg = detail.errors?.orders
        ? `<div class="placeholder" style="color:var(--red);text-align:left;margin-bottom:10px"><strong>Orders fetch failed</strong>${escapeHtml(detail.errors.orders)}</div>`
        : "";
      if (!detail.orders?.length) {
        return errMsg + `<div class="placeholder">No orders for this reseller.</div>`;
      }
      return errMsg + renderOrdersTable(detail.orders);
    }
    if (tab === "calls") {
      const log = callLogForActivePartner();
      if (!log.length) {
        return `<div class="placeholder">
          <strong>No inbound calls logged yet</strong>
          When the team.3cx.com webclient overlay matches an inbound caller to this partner, it will appear here.
        </div>`;
      }
      return `
        <div class="card">
          <h2>Inbound calls (${log.length})</h2>
          <table class="data-table">
            <thead><tr>
              <th>When</th><th>Caller</th><th>Match strength</th><th>Source</th>
            </tr></thead>
            <tbody>${log.map((c) => `
              <tr>
                <td>${escapeHtml(relativeTime(c.receivedAt))}</td>
                <td><code>${escapeHtml(c.callerPhone)}</code></td>
                <td>${c.matchedDigits ? `${c.matchedDigits} digits` : "—"}</td>
                <td>${escapeHtml(c.source || "—")}</td>
              </tr>`).join("")}
            </tbody>
          </table>
        </div>`;
    }
  }

  function detailHeader(partner, detail) {
    const fetched = detail?.fetchedAt ? `Fetched ${relativeTime(detail.fetchedAt)}` : "";
    return `
      <div class="detail-toolbar">
        <span>${fetched}</span>
        <button class="btn-secondary btn detail-refresh" data-id="${escapeHtml(partner.id)}">Refresh</button>
      </div>`;
  }

  function renderKeysTable(keys) {
    const partner = state.partners.find((p) => p.id === state.activePartnerId);
    return `
      ${detailHeader(partner, partnerDetail(partner.id))}
      <div class="card">
        <h2>License keys (${keys.length})</h2>
        <table class="data-table">
          <thead><tr>
            <th>Key</th><th>Product</th><th>SC</th><th>Expiry</th>
            <th>Version</th><th>Issued to</th><th>Activations</th>
          </tr></thead>
          <tbody>${keys.map((k) => `
            <tr${k.disabled ? ' style="opacity:.5"' : ""}>
              <td><code>${escapeHtml(k.key)}</code></td>
              <td>${escapeHtml(k.product)}</td>
              <td>${escapeHtml(k.sc)}</td>
              <td>${escapeHtml(k.expiry)}</td>
              <td>${escapeHtml(k.version)}</td>
              <td>${escapeHtml(k.issuedTo)}</td>
              <td>${escapeHtml(k.activations)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function renderOrdersTable(orders) {
    const partner = state.partners.find((p) => p.id === state.activePartnerId);
    return `
      ${detailHeader(partner, partnerDetail(partner.id))}
      <div class="card">
        <h2>Orders (${orders.length})</h2>
        <table class="data-table">
          <thead><tr>
            <th>Order #</th><th>Status</th><th>Created</th>
            <th>Country</th><th>Payment</th><th>Amount</th>
          </tr></thead>
          <tbody>${orders.map((o) => `
            <tr>
              <td>${o.orderUrl ? `<a href="${escapeHtml(o.orderUrl)}" target="_blank" rel="noopener">${escapeHtml(o.orderNo)}</a>` : escapeHtml(o.orderNo)}</td>
              <td>${escapeHtml(o.status)}</td>
              <td>${escapeHtml(o.created)}</td>
              <td>${escapeHtml(o.country)}</td>
              <td>${escapeHtml(o.payment)}</td>
              <td>${escapeHtml(o.currency)} ${escapeHtml(o.amount)}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </div>`;
  }

  function renderNotes() {
    const all = combinedNotesForActivePartner();
    if (!all.length) {
      return `<div class="placeholder">No notes yet for this reseller.</div>`;
    }
    return all
      .map(
        (n) => `
        <div class="note">
          <div class="note-head">
            <span class="source source-${escapeHtml(n.source)}">${escapeHtml(n.source.toUpperCase())}</span>
            <span>${escapeHtml(n.whenIso ? relativeTime(n.whenIso) : n.whenLabel || "—")}</span>
            ${n.who ? `<span>· ${escapeHtml(n.who)}</span>` : ""}
            ${n.type ? `<span>· ${escapeHtml(n.type)}</span>` : ""}
          </div>
          <div class="note-subj">${escapeHtml(n.subject)}</div>
          <div class="note-body">${escapeHtml(n.body)}</div>
        </div>`,
      )
      .join("");
  }

  function wireNoteForm(partner) {
    $("nclear").addEventListener("click", () => {
      $("nsubj").value = "";
      $("nbody").value = "";
      $("nstatus").textContent = "";
      $("nstatus").className = "status";
    });
    $("npost").addEventListener("click", async () => {
      const subject = $("nsubj").value.trim();
      const body = $("nbody").value.trim();
      const noteType = parseInt($("ntype").value, 10);
      const status = $("nstatus");
      if (!subject) {
        status.textContent = "Subject required";
        status.className = "status err";
        return;
      }
      if (!body) {
        status.textContent = "Body required";
        status.className = "status err";
        return;
      }
      $("npost").disabled = true;
      status.textContent = "Posting…";
      status.className = "status";
      try {
        const r = await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partnerId: partner.id,
            subject,
            body,
            noteType,
            seller: state.snapshot?.rep?.name || state.snapshot?.rep?.email || null,
            source: "onyx-web",
          }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
        status.textContent =
          "Saved to ONYX. ERP write happens via the extension popup (Note section).";
        status.className = "status warn";
        $("nsubj").value = "";
        $("nbody").value = "";
        await loadNotes(partner.id);
        $("notesList").innerHTML = renderNotes();
      } catch (e) {
        status.textContent = e.message || "Failed";
        status.className = "status err";
      } finally {
        $("npost").disabled = false;
      }
    });
  }

  // ── Search ─────────────────────────────────────────────────────────────────

  function wireSearch() {
    $("sidebarSearch").addEventListener("input", (e) => {
      state.searchQuery = e.target.value;
      applyFilters();
    });
  }

  function wireTopBar() {
    $("btnRefreshAll").addEventListener("click", refreshAllDetails);
    $("btnInsight").addEventListener("click", generateInsight);
    $("btnInsightClear").addEventListener("click", () => {
      if (state.activePartnerId) clearInsight(state.activePartnerId);
    });
  }

  // ── Init ───────────────────────────────────────────────────────────────────

  (async function init() {
    wireSearch();
    wireTopBar();
    const snapshot = await pickSnapshot();
    if (!snapshot) {
      $("partnerList").innerHTML = `
        <div class="empty">
          <strong>No snapshot yet</strong>
          Open the extension popup and click <code>Refresh my data from ERP</code>.
        </div>`;
      $("who").textContent = "no rep snapshot loaded";
      $("lastSync").textContent = "";
      return;
    }
    state.snapshot = snapshot;
    state.partners = snapshot.partners || [];
    $("who").innerHTML = `<strong>${escapeHtml(snapshot.rep?.name || snapshot.rep?.email || "—")}</strong> · ${escapeHtml(snapshot.rep?.region || "—")}`;
    $("lastSync").textContent = `Last sync ${relativeTime(snapshot.updatedAt)}`;
    renderLevelChips();
    applyFilters();
    refreshTopBarStatus();
  })();
})();
