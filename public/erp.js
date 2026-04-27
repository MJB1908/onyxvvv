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
          <div class="pitem-name">${escapeHtml(p.company)}</div>
          <div class="pitem-meta">${escapeHtml(getPartnerCountry(p))} · ${escapeHtml(getPartnerLevel(p))}</div>
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
      return `<div class="placeholder"><strong>Calls aren't available from staff.3cx.com</strong>For real call history, look at team.3cx.com (the webclient overlay shows inbound caller-id matches in real time).</div>`;
    }
  }

  function renderKeysTable(keys) {
    return `
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
    return `
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
    if (!state.notes.length) {
      return `<div class="placeholder">No notes yet for this reseller.</div>`;
    }
    return state.notes
      .map(
        (n) => `
        <div class="note">
          <div class="note-head">
            <span class="source">${escapeHtml(n.source || "onyx")}</span>
            <span>${relativeTime(n.createdAt)}</span>
            ${n.seller ? `<span>· ${escapeHtml(n.seller)}</span>` : ""}
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

  // ── Init ───────────────────────────────────────────────────────────────────

  (async function init() {
    wireSearch();
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
  })();
})();
