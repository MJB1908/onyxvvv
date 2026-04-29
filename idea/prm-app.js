/* ============================================================
   PRM dashboard v2 — onyxvvv embed module
   Mountable inside any container (SPA's #view, a modal, …).
   Reuses /api/snapshots/:slug, /api/notes, /api/sales/* endpoints.
   No globals — exposes window.prmApp = { mount, unmount }.

   v2 closes the parity gaps with anthropics/3cx-prm dashboard.js:
     • Quick Note modal (top-right popup with customer dropdown)
     • Agent chips in sidebar (dynamic, with counts)
     • Cert badges in sidebar partner rows
     • 3-column overview layout
     • New Activations table (last 30 days)
     • Upcoming Renewals table (91–180 day window)
     • Largest/Average extensions block
     • Notes Type + Poster filter chips
     • Keys: Renewal Radar section + Ext badge + retired tag
     • Orders: license-key chips per row + totals by currency
   ============================================================ */
(function () {
  "use strict";

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // ── Edition / tier helpers ────────────────────────────────────────────────
  function editionOf(product) {
    if (!product) return { full: "Other", short: "OTH", color: "#5a6270", bg: "#f0f2f5" };
    const p = String(product).replace(/^3CX\s+/i, "").replace(/\s*\((?:Annual|Perpetual)\)\s*$/i, "").trim();
    const table = [
      [/Enterprise/i,   { full: "Enterprise",   short: "ENT",  color: "#6f42c1", bg: "#f0ebff" }],
      [/Professional/i, { full: "Professional", short: "PRO",  color: "#0077b6", bg: "#e3f2fd" }],
      [/Standard/i,     { full: "Standard",     short: "STD",  color: "#00838f", bg: "#e0f7fa" }],
      [/SMB/i,          { full: "SMB",          short: "SMB",  color: "#8e44ad", bg: "#f4ecf9" }],
      [/Basic/i,        { full: "Basic",        short: "BSC",  color: "#5a6270", bg: "#f0f2f5" }],
      [/Free/i,         { full: "Free",         short: "FREE", color: "#2d9e5f", bg: "#e8f5ee" }],
    ];
    for (const [re, v] of table) if (re.test(p)) return v;
    return { full: p || "Other", short: (p.substring(0, 3) || "OTH").toUpperCase(), color: "#5a6270", bg: "#f0f2f5" };
  }

  function detectTier(level) {
    const k = String(level || "").toLowerCase();
    if (k.includes("titan")) return { label: "Titanium", class: "titanium" };
    if (k.includes("plat"))  return { label: "Platinum", class: "platinum" };
    if (k.includes("gold"))  return { label: "Gold",     class: "gold" };
    if (k.includes("silv"))  return { label: "Silver",   class: "silver" };
    if (k.includes("bronz")) return { label: "Bronze",   class: "bronze" };
    return { label: level || "Partner", class: "default" };
  }

  // Sidebar cert-badge text. onyxvvv has no separate cert field, so we
  // derive an abbreviation from distributorLevel — matches the original
  // PRM's intent (a small inline marker per row) using available data.
  function certShort(level) {
    const k = String(level || "").toLowerCase();
    if (k.includes("titan")) return "TIT";
    if (k.includes("plat"))  return "PLA";
    if (k.includes("gold"))  return "GLD";
    if (k.includes("silv"))  return "SLV";
    if (k.includes("bronz")) return "BRO";
    return "";
  }

  function shortAgentName(full) {
    return String(full || "").trim().split(/\s+/)[0] || full || "";
  }

  function parseDate(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
    if (m) {
      const yr = m[3].length === 2 ? "20" + m[3] : m[3];
      return new Date(`${yr}-${m[2]}-${m[1]}`);
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  // ── Adapters: onyxvvv → PRM-shape ─────────────────────────────────────────
  function viewPartner(p) {
    return {
      id: p.id,
      company: p.companyName || p.company || "—",
      contact: p.contactName || "",
      email: p.accountOwnerEmail || "",
      phone: p.accountOwnerPhone || "",
      type: p.distributorLevel || "",
      category: p.distributorLevel || "",
      country: p.country || "",
      region: p.salesRegion || "",
      enabled: true,
      publicId: p.partnerCode || "",
      agent: p.accountOwnerName || "",
      revenue: p.annualRevenueUsd || 0,
      notes: p.notes || "",
      raw: p,
    };
  }

  function viewKey(k) {
    // Synthetic "purchased" date: assume keys are sold on a 12-month cadence,
    // so purchased ≈ hostingExpires − 12 months. This is a useful proxy for
    // matching keys to orders by date in the Orders tab. Real ERP data will
    // ship a real purchase date once wired live.
    const hostExp = parseDate(k.hostingExpires);
    const purchased = hostExp ? new Date(hostExp.getFullYear() - 1, hostExp.getMonth(), hostExp.getDate()) : null;
    return {
      keyId: k.licenseKey,
      key: (k.licenseKey || "").split("-")[0] || k.licenseKey,
      product: k.productEdition || "",
      sc: k.primaryLicenseSc || "",
      maxExt: k.primaryLicenseSc || "",
      expiry: k.licenseExpires || "",
      hostingExpires: k.hostingExpires || "",
      registration: k.company || "",
      version: k.version || "",
      activatedOn: purchased ? purchased.toISOString().slice(0, 10) : null,
      purchased: purchased ? purchased.toISOString().slice(0, 10) : null,
      disabled: !!(k.flags && k.flags.licenseExpired),
    };
  }

  function viewOrder(o) {
    return {
      orderNo: o.orderId,
      orderUrl: "",
      created: o.date,
      status: o.status,
      currency: "USD",
      amount: o.totalUsd,
      tax: "",
      payment: o.paymentMethod,
      proformaNo: "",
      country: o.country || "",
      type: o.type,
      description: o.description,
      quantity: o.quantity,
    };
  }

  const NTYPE_LABELS = ["Contact", "Support", "Call", "Project", "Commitments", "Email"];
  function viewNote(n) {
    return {
      index: n.id,
      type: NTYPE_LABELS[n.noteType] || "Contact",
      subject: n.subject,
      body: n.body,
      modified: n.createdAt,
      poster: n.seller || n.source,
      reminder: "",
    };
  }

  // ── State (per mount instance) ─────────────────────────────────────────────
  function makeState(opts) {
    return {
      container: null,
      snapshot: opts.snapshot,
      seller: opts.seller,
      partnerList: (opts.snapshot?.partners || []).map(viewPartner),
      partner: null,
      activeTab: "overview",
      filters: { level: "", agent: "", search: "" },
      noteFilters: { type: "", poster: "" },
    };
  }

  // ── Compose the partner-360 from snapshot + notes ─────────────────────────
  async function composePartner(state, partnerId) {
    const view = state.partnerList.find((p) => p.id === partnerId);
    if (!view) return null;
    const snap = state.snapshot;
    const keys = (snap.licenseKeys || []).filter((k) => k.assignedResellerId === partnerId).map(viewKey);
    const orders = (snap.orders || []).filter((o) => o.resellerId === partnerId).map(viewOrder);
    const calls = (snap.calls || []).filter((c) => c.partnerId === partnerId);
    let notes = [];
    try {
      const r = await fetch(`/api/notes?partnerId=${encodeURIComponent(partnerId)}`);
      const d = await r.json();
      notes = (d.notes || []).map(viewNote);
    } catch { /* offline-tolerant */ }
    view.tabs = { keys, orders, notesParsed: notes, users: [], calls };
    return view;
  }

  // ── Health score ──────────────────────────────────────────────────────────
  function computeHealth(p) {
    const notes = p.tabs?.notesParsed || [];
    const keys = p.tabs?.keys || [];
    let score = 50;
    if (notes.length > 5) score += 10;
    if (notes.length > 15) score += 5;
    if (keys.length > 0) score += 10;
    if (keys.length > 5) score += 5;
    if (p.enabled) score += 5;
    const last = notes[0] && parseDate(notes[0].modified);
    if (last) {
      const days = (Date.now() - last) / 86400000;
      if (days < 7) score += 15;
      else if (days < 30) score += 8;
      else if (days > 90) score -= 15;
    } else score -= 5;
    score = Math.max(0, Math.min(100, score));
    const color = score >= 70 ? "#2d9e5f" : score >= 40 ? "#e67e00" : "#dc3545";
    return { score, color };
  }

  // ============================================================
  // RENDERING — TOP-LEVEL SHELL
  // ============================================================
  function render(state) {
    const c = state.container;
    c.innerHTML = `
      <div class="prm-layout">
        <aside class="prm-sidebar">
          <div class="prm-sidebar-header" data-role="sidebar-header">Resellers (${state.partnerList.length})</div>
          <div class="prm-sidebar-filter">
            <input type="text" data-role="search" placeholder="Search resellers…" autocomplete="off">
            <div class="prm-chip-group">
              <div class="prm-chip-group-label">Level</div>
              <div class="prm-chip-row" data-role="level-chips"></div>
            </div>
            <div class="prm-chip-group" data-role="agent-chip-group" hidden>
              <div class="prm-chip-group-label">Account owner</div>
              <div class="prm-chip-row" data-role="agent-chips"></div>
            </div>
          </div>
          <div class="prm-partner-list" data-role="partner-list"></div>
        </aside>
        <section class="prm-main" data-role="main"></section>
      </div>
      <div class="prm-ai-bar" data-role="ai-bar" hidden>
        <span class="prm-ai-label">✦ AI</span>
        <span data-role="ai-text">Pick a reseller and hit Pre-call brief.</span>
      </div>

      <!-- Quick Note modal — anchored top-right of viewport -->
      <div class="prm-qn-backdrop" data-role="qn-backdrop"></div>
      <div class="prm-qn-modal" role="dialog" aria-modal="true" data-role="qn-modal">
        <div class="prm-qn-head">
          <div class="prm-qn-title">Quick Note</div>
          <button class="prm-qn-close" data-action="qn-close" aria-label="Close">×</button>
        </div>
        <div class="prm-qn-body">
          <div class="prm-qn-partner-hint" data-role="qn-hint"></div>
          <div class="prm-qn-row">
            <select data-role="qn-type">
              <option value="0">Contact</option>
              <option value="1">Support</option>
              <option value="2" selected>Call</option>
              <option value="3">Project</option>
              <option value="4">Commitments</option>
              <option value="5">Email</option>
            </select>
            <input type="text" data-role="qn-subject" placeholder="Subject…">
          </div>
          <select class="prm-qn-customer" data-role="qn-customer">
            <option value="">Add customer to subject (optional)</option>
          </select>
          <textarea data-role="qn-body" rows="5" placeholder="Note body…"></textarea>
          <div class="prm-qn-actions">
            <span class="prm-qn-status" data-role="qn-status"></span>
            <button class="prm-btn prm-btn-primary" data-action="qn-post">Post →</button>
          </div>
        </div>
      </div>`;

    renderLevelChips(state);
    rebuildAgentChips(state);
    renderSidebar(state);
    renderMain(state);
    wireSidebar(state);
    wireQuickNoteModal(state);
  }

  // ============================================================
  // SIDEBAR
  // ============================================================
  function renderLevelChips(state) {
    const counts = new Map();
    counts.set("", state.partnerList.length);
    for (const p of state.partnerList) {
      const k = (p.type || "").trim();
      if (k) counts.set(k, (counts.get(k) || 0) + 1);
    }
    const levels = [...counts.keys()].filter(Boolean).sort();
    const row = state.container.querySelector('[data-role="level-chips"]');
    row.innerHTML =
      `<div class="prm-chip ${state.filters.level === "" ? "active" : ""}" data-level="">All<span class="count">${counts.get("")}</span></div>` +
      levels
        .map(
          (l) =>
            `<div class="prm-chip ${state.filters.level === l ? "active" : ""}" data-level="${esc(l)}">${esc(l)}<span class="count">${counts.get(l)}</span></div>`,
        )
        .join("");
  }

  // Agent chips — built from currently-loaded partner list, sorted by count.
  // Hidden when there are no agents (all partners with empty accountOwnerName).
  function rebuildAgentChips(state) {
    const wrap = state.container.querySelector('[data-role="agent-chip-group"]');
    const row = state.container.querySelector('[data-role="agent-chips"]');
    if (!wrap || !row) return;

    const counts = {};
    state.partnerList.forEach((p) => {
      const a = p.agent || "";
      if (a) counts[a] = (counts[a] || 0) + 1;
    });
    const agents = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    if (!agents.length) { wrap.hidden = true; return; }
    wrap.hidden = false;

    row.innerHTML =
      `<div class="prm-chip ${state.filters.agent === "" ? "active" : ""}" data-agent="">All<span class="count">${state.partnerList.length}</span></div>` +
      agents
        .map(
          ([name, n]) =>
            `<div class="prm-chip ${state.filters.agent === name ? "active" : ""}" data-agent="${esc(name)}" title="${esc(name)}">${esc(shortAgentName(name))}<span class="count">${n}</span></div>`,
        )
        .join("");
  }

  function renderSidebar(state) {
    const list = state.partnerList.filter((p) => {
      if (state.filters.level && p.type !== state.filters.level) return false;
      if (state.filters.agent && p.agent !== state.filters.agent) return false;
      if (state.filters.search) {
        const q = state.filters.search.toLowerCase();
        if (!JSON.stringify(p).toLowerCase().includes(q)) return false;
      }
      return true;
    });
    const el = state.container.querySelector('[data-role="partner-list"]');
    if (!list.length) { el.innerHTML = '<div class="prm-empty">No matches</div>'; return; }

    el.innerHTML = list
      .slice(0, 200)
      .map((p) => {
        const tier = detectTier(p.type);
        const certText = certShort(p.type);
        return `
        <div class="prm-pitem ${state.partner && state.partner.id === p.id ? "active" : ""}" data-id="${esc(p.id)}">
          <div class="prm-pitem-name">${esc(p.company)}</div>
          <div class="prm-pitem-meta">
            <span class="prm-pitem-id">#${esc(p.id)}</span>
            ${certText ? `<span class="prm-cert prm-cert-${tier.class}">${esc(certText)}</span>` : ""}
            ${p.country ? `<span class="prm-pitem-country">${esc(p.country)}</span>` : ""}
          </div>
        </div>`;
      })
      .join("");
  }

  function wireSidebar(state) {
    const c = state.container;
    c.querySelector('[data-role="search"]').addEventListener("input", (e) => {
      state.filters.search = e.target.value.trim();
      renderSidebar(state);
    });
    c.querySelector('[data-role="level-chips"]').addEventListener("click", (e) => {
      const chip = e.target.closest(".prm-chip");
      if (!chip) return;
      state.filters.level = chip.dataset.level || "";
      renderLevelChips(state);
      renderSidebar(state);
    });
    c.querySelector('[data-role="agent-chips"]').addEventListener("click", (e) => {
      const chip = e.target.closest(".prm-chip");
      if (!chip) return;
      state.filters.agent = chip.dataset.agent || "";
      rebuildAgentChips(state);
      renderSidebar(state);
    });
    c.querySelector('[data-role="partner-list"]').addEventListener("click", async (e) => {
      const item = e.target.closest(".prm-pitem");
      if (!item) return;
      const partnerId = item.dataset.id;
      state.partner = await composePartner(state, partnerId);
      state.activeTab = "overview";
      state.noteFilters = { type: "", poster: "" };
      try { history.replaceState(null, "", `#/prm?partnerId=${encodeURIComponent(partnerId)}`); } catch {}
      renderSidebar(state);
      renderMain(state);
    });
  }

  // ============================================================
  // MAIN PANE
  // ============================================================
  function renderMain(state) {
    const main = state.container.querySelector('[data-role="main"]');
    const aiBar = state.container.querySelector('[data-role="ai-bar"]');
    const p = state.partner;
    if (!p) {
      main.innerHTML = '<div class="prm-loading" style="margin:auto">Pick a reseller from the left.</div>';
      aiBar.hidden = true;
      return;
    }
    aiBar.hidden = false;
    const tier = detectTier(p.type);
    const initials = p.company.split(/\s+/).map((w) => w[0] || "").join("").substring(0, 2).toUpperCase();
    const health = computeHealth(p);

    main.innerHTML = `
      <header class="prm-p-header">
        <div class="prm-p-avatar">${esc(initials)}</div>
        <div class="prm-p-info">
          <div class="prm-p-name">${esc(p.company)}</div>
          <div class="prm-p-sub">#${esc(p.id)} · ${esc(p.country || "—")} · Owner: ${esc(p.agent || "—")}</div>
        </div>
        <span class="prm-tier-badge prm-tier-${tier.class}">${esc(tier.label)}</span>
        <div class="prm-health-ring" title="Health score">
          <svg width="50" height="50" viewBox="0 0 50 50">
            <circle cx="25" cy="25" r="20" fill="none" stroke="#e1e4e8" stroke-width="4"/>
            <circle cx="25" cy="25" r="20" fill="none" stroke="${health.color}" stroke-width="4"
              stroke-dasharray="${(health.score / 100) * 125.6} 125.6" stroke-linecap="round"/>
          </svg>
          <div class="prm-health-score" style="color:${health.color}">${health.score}</div>
        </div>
        <div class="prm-p-actions">
          <button class="prm-p-btn" data-action="qn-open">+ Note</button>
          <button class="prm-p-btn" data-action="copy-email">✉ Email</button>
          <button class="prm-p-btn primary" data-action="run-call-prep">✦ Pre-call brief</button>
        </div>
      </header>

      <div class="prm-pills-row">
        <div class="prm-spill ${p.enabled ? "green" : "red"}">${p.enabled ? "Active" : "Inactive"}</div>
        ${p.region ? `<div class="prm-spill blue">Region <strong>${esc(p.region)}</strong></div>` : ""}
        ${p.publicId ? `<div class="prm-spill">Code <strong>${esc(p.publicId)}</strong></div>` : ""}
        ${p.revenue ? `<div class="prm-spill">Revenue <strong>$${Number(p.revenue).toLocaleString("en-US")}</strong></div>` : ""}
        ${p.tabs?.keys?.length ? `<div class="prm-spill">${p.tabs.keys.length} keys</div>` : ""}
        ${p.tabs?.orders?.length ? `<div class="prm-spill">${p.tabs.orders.length} orders</div>` : ""}
        ${p.tabs?.calls?.length ? `<div class="prm-spill blue">${p.tabs.calls.length} calls</div>` : ""}
      </div>

      <nav class="prm-tabs" data-role="tabs">
        ${["overview", "notes", "keys", "orders", "users"]
          .map((t) => `<div class="prm-tab ${t === state.activeTab ? "active" : ""}" data-tab="${t}">${
            { overview: "Overview", notes: `Notes (${p.tabs?.notesParsed?.length || 0})`, keys: "License keys", orders: "Orders", users: "Users" }[t]
          }</div>`)
          .join("")}
      </nav>

      <div class="prm-content" data-role="tab-content"></div>
    `;

    main.querySelector('[data-role="tabs"]').addEventListener("click", (e) => {
      const t = e.target.closest(".prm-tab");
      if (!t) return;
      state.activeTab = t.dataset.tab;
      renderMain(state);
    });
    main.addEventListener("click", (e) => {
      const a = e.target.closest("[data-action]");
      if (!a) return;
      handleAction(state, a.dataset.action);
    });

    renderTab(state);
  }

  function renderTab(state) {
    const el = state.container.querySelector('[data-role="tab-content"]');
    const p = state.partner;
    switch (state.activeTab) {
      case "overview": renderOverview(el, p, state); break;
      case "notes":    renderNotes(el, p, state); break;
      case "keys":     renderKeys(el, p); break;
      case "orders":   renderOrders(el, p); break;
      case "users":    el.innerHTML = '<div class="prm-empty">User data not in current snapshot.</div>'; break;
    }
  }

  // ============================================================
  // OVERVIEW — 3-column layout
  // ============================================================
  function renderOverview(el, p, state) {
    const keys = p.tabs?.keys || [];
    const orders = p.tabs?.orders || [];
    const notes = p.tabs?.notesParsed || [];
    const calls = p.tabs?.calls || [];
    const today = new Date();

    // ── Computed metrics ────────────────────────────────────────────────────
    const liveKeys = keys.filter((k) => !k.disabled);
    const disabledKeys = keys.filter((k) => k.disabled);
    const customers = [...new Set(liveKeys.map((k) => k.registration).filter(Boolean))];
    const extNums = liveKeys.map((k) => parseInt(k.maxExt) || 0).filter((x) => x > 0);
    const largestExt = extNums.length ? Math.max(...extNums) : 0;
    const avgExt = extNums.length ? Math.round(extNums.reduce((a, b) => a + b, 0) / extNums.length) : 0;

    // Install mix by edition (live keys only)
    const buckets = {};
    liveKeys.forEach((k) => {
      const ed = editionOf(k.product);
      if (!buckets[ed.short]) buckets[ed.short] = { ...ed, count: 0 };
      buckets[ed.short].count++;
    });
    const totalEd = Object.values(buckets).reduce((a, b) => a + b.count, 0) || 1;

    // Renewal radar — keys expiring ≤90 days, asc
    const withDays = liveKeys
      .filter((k) => k.expiry)
      .map((k) => {
        const d = parseDate(k.expiry);
        return { ...k, daysLeft: d ? Math.round((d - today) / 86400000) : null };
      })
      .filter((k) => k.daysLeft !== null && k.daysLeft <= 90)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    // New deals = activated in last 30 days (uses synthetic activation date)
    const ACTIVATION_WINDOW_DAYS = 30;
    const newDeals = liveKeys
      .filter((k) => {
        if (!k.activatedOn) return false;
        const d = parseDate(k.activatedOn);
        return d && (today - d) / 86400000 <= ACTIVATION_WINDOW_DAYS && (today - d) >= 0;
      })
      .sort((a, b) => parseDate(b.activatedOn) - parseDate(a.activatedOn))
      .slice(0, 10);

    // Ongoing deals = expiring 91-180 days (renewals window)
    const ongoingDeals = liveKeys
      .filter((k) => {
        if (!k.expiry) return false;
        const d = parseDate(k.expiry);
        if (!d) return false;
        const days = Math.round((d - today) / 86400000);
        return days > 90 && days <= 180;
      })
      .map((k) => {
        const d = parseDate(k.expiry);
        return { ...k, daysLeft: d ? Math.round((d - today) / 86400000) : null };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 10);

    // Renewal rate = % of live keys not overdue
    const notOverdue = liveKeys.filter((k) => { const d = parseDate(k.expiry); return d && d > today; });
    const renewalRate = liveKeys.length ? Math.round((notOverdue.length / liveKeys.length) * 100) : 0;

    // ── Helpers (closures) ──────────────────────────────────────────────────
    function mixBar(label, count, color) {
      const pct = Math.round((count / totalEd) * 100);
      return `
        <div style="margin-bottom:8px">
          <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
            <span style="color:var(--prm-m)">${esc(label)}</span><span style="font-weight:600">${pct}%</span>
          </div>
          <div style="height:5px;background:var(--prm-s2);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${pct}%;background:${color};border-radius:3px"></div>
          </div>
        </div>`;
    }
    function tierTag(product, sc) {
      const ed = editionOf(product);
      const label = sc ? `${esc(sc)}SC ${esc(ed.short)}` : esc(ed.short);
      return `<span class="prm-ed-tag" style="background:${ed.bg};color:${ed.color}">${label}</span>`;
    }
    function statusTag(days) {
      if (days === null) return "";
      if (days < 0)   return `<span class="prm-ed-tag" style="background:#ffeaea;color:#dc3545">Overdue</span>`;
      if (days <= 30) return `<span class="prm-ed-tag" style="background:#fff3e0;color:#e67e00">Urgent</span>`;
      if (days <= 60) return `<span class="prm-ed-tag" style="background:#fff8e1;color:#996500">Soon</span>`;
      return `<span class="prm-ed-tag" style="background:#e8f5ee;color:#2d9e5f">Active</span>`;
    }
    function moodTag(mood) {
      const m = (mood ?? "").toLowerCase();
      if (m === "positive")  return `<span class="prm-mood prm-mood-positive">Positive</span>`;
      if (m.includes("risk") || m === "negative" || m === "at_risk") return `<span class="prm-mood prm-mood-at_risk">At risk</span>`;
      return `<span class="prm-mood prm-mood-neutral">Neutral</span>`;
    }
    function chanIcon(ch) {
      const c = (ch ?? "").toLowerCase();
      if (c.includes("call") || c.includes("phone")) return "📞";
      if (c.includes("email")) return "✉";
      if (c.includes("chat")) return "💬";
      return "📞";
    }

    // ── Render the 3-column layout ──────────────────────────────────────────
    el.innerHTML = `
      <div class="prm-overview-grid">

        <!-- LEFT COLUMN -->
        <div class="prm-overview-col prm-overview-col-left">

          <!-- Install Mix + ext stats -->
          <div class="prm-section">
            <div class="prm-section-head"><span class="prm-section-title">Install mix</span></div>
            <div style="padding:10px 14px">
              ${Object.entries(buckets).map(([_, b]) => mixBar(b.full, b.count, b.color)).join("") || '<div style="color:var(--prm-dim);font-size:12px">No key data</div>'}
              <div class="prm-extstats">
                <div>
                  <div class="prm-extstats-label">Largest</div>
                  <div class="prm-extstats-value">${largestExt}</div>
                  <div class="prm-extstats-unit">ext</div>
                </div>
                <div>
                  <div class="prm-extstats-label">Average</div>
                  <div class="prm-extstats-value">${avgExt}</div>
                  <div class="prm-extstats-unit">ext</div>
                </div>
              </div>
            </div>
          </div>

          <!-- KPI grid -->
          <div class="prm-mini-grid">
            <div class="prm-section prm-mini-section">
              <div class="prm-mini-label">Install Base</div>
              <div class="prm-mini-value">${keys.length}</div>
              <div class="prm-mini-sub">${liveKeys.length} live${disabledKeys.length ? ` · ${disabledKeys.length} retired` : ""}</div>
            </div>
            <div class="prm-section prm-mini-section">
              <div class="prm-mini-label">Customers</div>
              <div class="prm-mini-value">${customers.length}</div>
              <div class="prm-mini-sub">unique</div>
            </div>
            <div class="prm-section prm-mini-section">
              <div class="prm-mini-label">Renewal Rate</div>
              <div class="prm-mini-value" style="color:${renewalRate >= 80 ? "var(--prm-green)" : renewalRate >= 60 ? "var(--prm-amber)" : "var(--prm-red)"}">${renewalRate}%</div>
              <div class="prm-mini-sub">active keys</div>
            </div>
            <div class="prm-section prm-mini-section">
              <div class="prm-mini-label">New (30d)</div>
              <div class="prm-mini-value" style="color:var(--prm-blue)">${newDeals.length}</div>
              <div class="prm-mini-sub">activations</div>
            </div>
          </div>

          <!-- Renewal Radar -->
          <div class="prm-section">
            <div class="prm-section-head">
              <span class="prm-section-title" style="color:var(--prm-amber)">⚠ Renewal radar</span>
              <span class="prm-section-count">${withDays.length}</span>
            </div>
            ${withDays.length ? withDays.slice(0, 8).map((k) => {
              const col = k.daysLeft < 0 ? "var(--prm-red)" : k.daysLeft <= 30 ? "var(--prm-amber)" : "var(--prm-green)";
              return `<div class="prm-rr-row" data-action="jump-keys">
                <span class="prm-rr-name" title="${esc(k.registration || "")}">${esc((k.registration || k.key || "").substring(0, 22))}</span>
                ${tierTag(k.product, k.sc)}
                <span class="prm-rr-days" style="color:${col}">${k.daysLeft < 0 ? `${Math.abs(k.daysLeft)}d late` : `${k.daysLeft}d`}</span>
              </div>`;
            }).join("") : '<div class="prm-empty">No renewals due</div>'}
          </div>

        </div>

        <!-- CENTER COLUMN -->
        <div class="prm-overview-col prm-overview-col-center">

          <!-- New Activations table (last 30 days) -->
          <div class="prm-section">
            <div class="prm-section-head">
              <span class="prm-section-title">New activations</span>
              <span class="prm-section-count">last 30 days — ${newDeals.length}</span>
            </div>
            ${newDeals.length ? `<div style="overflow-x:auto"><table class="prm-dtable">
              <thead><tr><th>Customer</th><th>License</th><th>Version</th><th>Activated</th><th>Status</th></tr></thead>
              <tbody>${newDeals.map((k) => {
                const d = parseDate(k.expiry);
                const days = d ? Math.round((d - today) / 86400000) : null;
                return `<tr>
                  <td style="font-size:12px;font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(k.registration)}">${esc((k.registration || "—").substring(0, 22))}</td>
                  <td>${tierTag(k.product, k.sc)}</td>
                  <td style="font-size:11px;color:var(--prm-dim)">${esc(k.version || "—")}</td>
                  <td style="font-size:11px;white-space:nowrap">${esc(k.activatedOn || "—")}</td>
                  <td>${statusTag(days)}</td>
                </tr>`;
              }).join("")}</tbody></table></div>` : '<div class="prm-empty">No activations in last 30 days</div>'}
          </div>

          <!-- Upcoming Renewals (91-180 days) -->
          <div class="prm-section">
            <div class="prm-section-head">
              <span class="prm-section-title">Upcoming renewals</span>
              <span class="prm-section-count">91–180 days — ${ongoingDeals.length}</span>
            </div>
            ${ongoingDeals.length ? `<div style="overflow-x:auto"><table class="prm-dtable">
              <thead><tr><th>Customer</th><th>Current</th><th>Expiry</th><th>Version</th><th>Status</th></tr></thead>
              <tbody>${ongoingDeals.map((k) => `<tr>
                <td style="font-size:12px;font-weight:500;max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(k.registration)}">${esc((k.registration || "—").substring(0, 22))}</td>
                <td>${tierTag(k.product, k.sc)}</td>
                <td style="font-size:11px;white-space:nowrap;color:var(--prm-amber);font-weight:600">${esc(k.expiry || "—")}</td>
                <td style="font-size:11px;color:var(--prm-dim)">${esc(k.version || "—")}</td>
                <td>${statusTag(k.daysLeft)}</td>
              </tr>`).join("")}</tbody></table></div>` : '<div class="prm-empty">No renewals in 91–180 day window</div>'}
          </div>

          <!-- Recent Notes -->
          <div class="prm-section">
            <div class="prm-section-head">
              <span class="prm-section-title">Recent notes</span>
              <span class="prm-section-count" data-action="jump-notes" style="cursor:pointer;color:var(--prm-a)">${notes.length} — view all →</span>
            </div>
            <div>${notes.slice(0, 4).map(renderNoteCard).join("") || '<div class="prm-empty">No notes yet</div>'}</div>
          </div>

        </div>

        <!-- RIGHT COLUMN — Communication Log (uses snapshot.calls) -->
        <div class="prm-overview-col prm-overview-col-right">

          <div class="prm-section">
            <div class="prm-section-head">
              <span class="prm-section-title">Communication log</span>
              <span class="prm-section-count">${calls.length}</span>
            </div>
            <div>
              ${calls.length ? calls.slice(0, 8).map((c) => `
                <div class="prm-call-row">
                  <div class="prm-call-row-top">
                    <span class="prm-call-icon">${chanIcon("call")}</span>
                    <span class="prm-call-subject">${esc(c.notes || c.subject || "(untitled call)")}</span>
                    ${moodTag(c.sentiment)}
                  </div>
                  <div style="display:flex;align-items:center;gap:8px;font-size:10px;color:var(--prm-dim)">
                    <span>${esc(c.date || "")}</span>
                    ${c.seller ? `<span style="color:var(--prm-m)">${esc(c.seller)}</span>` : ""}
                    ${c.status ? `<span>· ${esc(c.status)}</span>` : ""}
                  </div>
                </div>`).join("") : '<div class="prm-empty">No calls logged for this reseller</div>'}
            </div>
          </div>

        </div>

      </div>`;
  }

  // ============================================================
  // NOTES — with Type + Poster filter chips
  // ============================================================
  const NB_CLASS = { Contact: "nb-contact", Support: "nb-support", Call: "nb-call", Project: "nb-project", Commitments: "nb-commitments", Email: "nb-email" };
  function renderNoteCard(n) {
    return `<div class="prm-note-card" data-type="${esc(n.type || "")}" data-poster="${esc(n.poster || "")}">
      <div class="prm-note-head-row">
        <span class="prm-note-badge ${NB_CLASS[n.type] || "nb-contact"}">${esc(n.type || "")}</span>
        <span class="prm-note-subj">${esc(n.subject || "(no subject)")}</span>
        <span class="prm-note-date">${esc(n.modified || "")}</span>
      </div>
      ${n.poster ? `<div class="prm-note-meta-row"><span class="prm-note-poster">👤 ${esc(n.poster)}</span></div>` : ""}
      <div class="prm-note-body">${esc(n.body || "")}</div>
    </div>`;
  }

  function renderNotes(el, p, state) {
    const notes = p.tabs?.notesParsed || [];

    // Build filter facets from current data
    const typeCounts = {};
    const posterCounts = {};
    notes.forEach((n) => {
      if (n.type)   typeCounts[n.type]     = (typeCounts[n.type] || 0) + 1;
      if (n.poster) posterCounts[n.poster] = (posterCounts[n.poster] || 0) + 1;
    });
    const typeList = Object.entries(typeCounts).sort((a, b) => b[1] - a[1]);
    const posterList = Object.entries(posterCounts).sort((a, b) => b[1] - a[1]);

    el.innerHTML = `
      <div class="prm-section" style="margin-bottom:14px">
        <div class="prm-section-head"><span class="prm-section-title">Post note</span></div>
        <div style="padding:14px 16px">
          <div class="prm-form-row">
            <div class="prm-form-group" style="flex:0 0 140px">
              <label>Type</label>
              <select data-role="note-type">
                <option value="0">Contact</option><option value="1">Support</option>
                <option value="2" selected>Call</option><option value="3">Project</option>
                <option value="4">Commitments</option><option value="5">Email</option>
              </select>
            </div>
            <div class="prm-form-group">
              <label>Subject</label>
              <input type="text" data-role="note-subject" placeholder="Subject…">
            </div>
          </div>
          <div class="prm-form-group" style="margin-bottom:10px">
            <label>Body</label>
            <textarea data-role="note-body" placeholder="Note body…"></textarea>
          </div>
          <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end">
            <span data-role="note-status" style="flex:1;font-size:11px;color:var(--prm-m)"></span>
            <button class="prm-btn prm-btn-ai" data-action="ai-summarise">✦ AI summarise</button>
            <button class="prm-btn prm-btn-primary" data-action="post-note">Post →</button>
          </div>
        </div>
      </div>

      <div class="prm-section">
        <div class="prm-section-head">
          <span class="prm-section-title">Timeline</span>
          <span class="prm-section-count">${notes.length}</span>
        </div>
        ${notes.length ? `
          <div class="prm-notes-filter-bar">
            <div class="prm-chip-group">
              <div class="prm-chip-group-label">Type</div>
              <div class="prm-chip-row" data-role="note-type-chips">
                <div class="prm-chip ${state.noteFilters.type === "" ? "active" : ""}" data-type="">All<span class="count">${notes.length}</span></div>
                ${typeList.map(([t, c]) => `<div class="prm-chip ${state.noteFilters.type === t ? "active" : ""}" data-type="${esc(t)}">${esc(t)}<span class="count">${c}</span></div>`).join("")}
              </div>
            </div>
            ${posterList.length > 1 ? `
            <div class="prm-chip-group">
              <div class="prm-chip-group-label">Poster</div>
              <div class="prm-chip-row" data-role="note-poster-chips">
                <div class="prm-chip ${state.noteFilters.poster === "" ? "active" : ""}" data-poster="">All<span class="count">${notes.length}</span></div>
                ${posterList.map(([n, c]) => `<div class="prm-chip ${state.noteFilters.poster === n ? "active" : ""}" data-poster="${esc(n)}" title="${esc(n)}">${esc(shortAgentName(n))}<span class="count">${c}</span></div>`).join("")}
              </div>
            </div>` : ""}
          </div>` : ""}
        <div data-role="notes-timeline">
          ${notes.length ? notes.map(renderNoteCard).join("") : '<div class="prm-empty">No notes yet.</div>'}
        </div>
      </div>`;

    // Apply filters in-place (avoids re-rendering the full note bodies)
    function applyNoteFilters() {
      const cards = el.querySelectorAll('[data-role="notes-timeline"] .prm-note-card');
      cards.forEach((card) => {
        const okType = !state.noteFilters.type || card.dataset.type === state.noteFilters.type;
        const okPoster = !state.noteFilters.poster || card.dataset.poster === state.noteFilters.poster;
        card.style.display = okType && okPoster ? "" : "none";
      });
    }
    applyNoteFilters();

    // Wire chip clicks. Toggling marks the chip active and re-applies filters.
    el.querySelector('[data-role="note-type-chips"]')?.addEventListener("click", (e) => {
      const chip = e.target.closest(".prm-chip");
      if (!chip) return;
      state.noteFilters.type = chip.dataset.type || "";
      el.querySelectorAll('[data-role="note-type-chips"] .prm-chip').forEach((c) => c.classList.toggle("active", c === chip));
      applyNoteFilters();
    });
    el.querySelector('[data-role="note-poster-chips"]')?.addEventListener("click", (e) => {
      const chip = e.target.closest(".prm-chip");
      if (!chip) return;
      state.noteFilters.poster = chip.dataset.poster || "";
      el.querySelectorAll('[data-role="note-poster-chips"] .prm-chip').forEach((c) => c.classList.toggle("active", c === chip));
      applyNoteFilters();
    });
  }

  // ============================================================
  // KEYS — with Renewal Radar section + Ext badge + retired tag
  // ============================================================
  function renderKeys(el, p) {
    const keys = p.tabs?.keys || [];
    if (!keys.length) {
      el.innerHTML = '<div class="prm-section"><div class="prm-empty">No license keys.</div></div>';
      return;
    }
    const today = new Date();
    const live = keys.filter((k) => !k.disabled);
    const retired = keys.filter((k) => k.disabled);
    const withDays = keys
      .map((k) => { const d = parseDate(k.expiry); return { ...k, daysLeft: d ? Math.round((d - today) / 86400000) : null }; })
      .sort((a, b) => (a.daysLeft ?? 9999) - (b.daysLeft ?? 9999));
    const expiring = withDays.filter((k) => !k.disabled && k.daysLeft !== null && k.daysLeft <= 90);

    function expiryStyle(d) {
      if (d === null) return "";
      if (d < 0)   return "color:var(--prm-red);font-weight:600";
      if (d <= 30) return "color:var(--prm-red);font-weight:600";
      if (d <= 60) return "color:var(--prm-amber);font-weight:600";
      if (d <= 90) return "color:var(--prm-amber)";
      return "color:var(--prm-green)";
    }
    function expiryLabel(k) {
      if (k.daysLeft === null) return esc(k.expiry || "");
      if (k.daysLeft < 0)  return `${esc(k.expiry)} <span style="color:var(--prm-red)">(${Math.abs(k.daysLeft)}d overdue)</span>`;
      if (k.daysLeft === 0) return `${esc(k.expiry)} <span style="color:var(--prm-red)">(today)</span>`;
      return `${esc(k.expiry)} <span style="color:var(--prm-dim)">(${k.daysLeft}d)</span>`;
    }
    function keyRow(k) {
      const url = k.keyId ? `https://staff.3cx.com/key/edit.aspx?i=${encodeURIComponent(k.keyId)}` : "";
      const keyCell = url
        ? `<a href="${url}" target="_blank" rel="noopener" class="prm-key-link">${esc(k.key)}</a>`
        : esc(k.key);
      const rowCls = k.disabled ? ' class="prm-key-row-disabled"' : "";
      const disBadge = k.disabled ? ` <span class="prm-key-retired-tag">retired</span>` : "";
      const scLabel = k.sc ? `${esc(k.sc)}SC` : "—";
      const extLabel = k.maxExt ? `${esc(k.maxExt)} ext` : "—";
      return `<tr${rowCls}>
        <td style="font-family:monospace;font-size:11px">${keyCell}${disBadge}</td>
        <td style="font-size:12px">${esc(k.product)}</td>
        <td style="white-space:nowrap">
          <span class="prm-sc-badge">${scLabel}</span>
          <span class="prm-ext-badge">${extLabel}</span>
        </td>
        <td style="font-size:11px;${k.disabled ? "" : expiryStyle(k.daysLeft)}">${k.disabled ? '<span style="color:var(--prm-dim)">—</span>' : expiryLabel(k)}</td>
        <td style="font-size:11px;color:var(--prm-m)">${esc(k.registration || "—")}</td>
        <td style="font-size:11px;color:var(--prm-dim)">${esc(k.version || "")}</td>
      </tr>`;
    }

    el.innerHTML = `
      ${expiring.length ? `
      <div class="prm-section" style="margin-bottom:12px">
        <div class="prm-section-head">
          <span class="prm-section-title" style="color:var(--prm-amber)">⚠ Renewal radar</span>
          <span class="prm-section-count">${expiring.length} expiring within 90 days</span>
        </div>
        <div style="overflow-x:auto">
          <table class="prm-dtable">
            <thead><tr>
              <th>Key</th><th>Product</th><th>SC / Ext</th><th>Expiry</th><th>Customer</th><th>Version</th>
            </tr></thead>
            <tbody>${expiring.map(keyRow).join("")}</tbody>
          </table>
        </div>
      </div>` : ""}

      <div class="prm-section">
        <div class="prm-section-head">
          <span class="prm-section-title">All license keys</span>
          <span class="prm-section-count">${keys.length}${retired.length ? ` · ${live.length} live · ${retired.length} retired` : ""}</span>
        </div>
        <div style="overflow-x:auto">
          <table class="prm-dtable">
            <thead><tr>
              <th>Key</th><th>Product</th><th>SC / Ext</th><th>Expiry</th><th>Customer</th><th>Version</th>
            </tr></thead>
            <tbody>${withDays.map(keyRow).join("")}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ============================================================
  // ORDERS — with license-key chips + currency totals
  // ============================================================
  function renderOrders(el, p) {
    const orders = p.tabs?.orders || [];
    const keys = p.tabs?.keys || [];
    if (!orders.length) {
      el.innerHTML = '<div class="prm-section"><div class="prm-empty">No orders.</div></div>';
      return;
    }

    // ── Date-matching trick: build a date→keys index, then for each order
    // find keys whose synthetic purchased date falls within ±14 days. Keys
    // in the index that don't match any order go nowhere — they show only
    // in the Keys tab. The original PRM uses an exact-day match against
    // staff.3cx.com's "Purchased" date column. onyxvvv's mock data has no
    // purchase date, so we approximate with hostingExpires − 12 months.
    // Real ERP wiring will get tighter matches.
    const MATCH_WINDOW_DAYS = 14;
    const keysByIso = {};
    keys.forEach((k) => {
      if (!k.purchased) return;
      const iso = String(k.purchased).slice(0, 10);
      (keysByIso[iso] ||= []).push(k);
    });
    const isoKeys = Object.keys(keysByIso).map((iso) => ({ iso, date: parseDate(iso) })).filter((x) => x.date);

    function keysForOrder(order) {
      const od = parseDate(order.created);
      if (!od) return [];
      const out = [];
      for (const { iso, date } of isoKeys) {
        if (Math.abs(od - date) / 86400000 <= MATCH_WINDOW_DAYS) {
          out.push(...keysByIso[iso]);
        }
      }
      return out;
    }

    function statusBadge(s) {
      const st = (s || "").toLowerCase();
      const cls =
        /paid/.test(st) ? "green" :
        /pending/.test(st) ? "amber" :
        /cancel|reject/.test(st) ? "red" :
        /free/.test(st) ? "blue" : "";
      return `<span class="prm-order-status ${cls}">${esc(s || "—")}</span>`;
    }

    function keyChips(order) {
      const matched = keysForOrder(order);
      if (!matched.length) return `<span class="prm-order-nokey">—</span>`;
      // De-dup if the ±14d window catches the same key twice
      const seen = new Set();
      const unique = matched.filter((k) => {
        const id = k.keyId || k.key;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      });
      return unique.map((k) => {
        const ed = editionOf(k.product);
        const url = k.keyId ? `https://staff.3cx.com/key/edit.aspx?i=${encodeURIComponent(k.keyId)}` : "";
        const label = `${k.key}${k.sc ? " · " + k.sc + "SC" : ""}`;
        const inner = `<span class="prm-order-key-ed" style="background:${ed.bg};color:${ed.color}">${esc(ed.short)}</span> ${esc(label)}`;
        return url
          ? `<a href="${url}" target="_blank" rel="noopener" class="prm-order-key-chip" title="Open key in staff.3cx.com">${inner}</a>`
          : `<span class="prm-order-key-chip">${inner}</span>`;
      }).join(" ");
    }

    function orderRow(o) {
      const amt = [o.currency, o.amount].filter(Boolean).join(" ") || "—";
      return `<tr>
        <td style="font-family:monospace;font-size:11px;white-space:nowrap">${esc(o.orderNo || "—")}</td>
        <td style="font-size:11px;white-space:nowrap">${esc(o.created || "—")}</td>
        <td style="white-space:nowrap">${statusBadge(o.status)}</td>
        <td class="prm-order-keys">${keyChips(o)}</td>
        <td style="font-size:11px;white-space:nowrap;text-align:right;font-weight:600">${esc(amt)}</td>
        <td style="font-size:11px;white-space:nowrap;color:var(--prm-m)">${esc(o.type || "—")}</td>
        <td style="font-size:11px;white-space:nowrap;color:var(--prm-m)">${esc(o.payment || "—")}</td>
      </tr>`;
    }

    // ── Totals by currency (only count paid/completed) ──────────────────────
    const paidOrders = orders.filter((o) => /paid|complete/i.test(o.status || ""));
    const totalsByCurrency = {};
    paidOrders.forEach((o) => {
      const n = parseFloat(String(o.amount).replace(/[^\d.]/g, ""));
      if (!isFinite(n)) return;
      const cur = o.currency || "USD";
      totalsByCurrency[cur] = (totalsByCurrency[cur] || 0) + n;
    });
    const totalsLine = Object.entries(totalsByCurrency)
      .map(([cur, n]) => `${cur} ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`)
      .join(" · ");

    // ── Match-rate metric: how many orders mapped to ≥1 key chip ───────────
    const matched = orders.filter((o) => keysForOrder(o).length > 0).length;
    const matchPct = orders.length ? Math.round((matched / orders.length) * 100) : 0;

    el.innerHTML = `
      <div class="prm-section">
        <div class="prm-section-head">
          <span class="prm-section-title">Orders</span>
          <span class="prm-section-count">
            ${orders.length}${paidOrders.length ? ` · ${paidOrders.length} paid` : ""}${totalsLine ? ` · Σ ${totalsLine}` : ""}
            ${keys.length ? ` · ${matched}/${orders.length} matched to keys (${matchPct}%)` : ""}
          </span>
        </div>
        <div style="overflow-x:auto">
          <table class="prm-dtable">
            <thead><tr>
              <th>Order #</th><th>Date</th><th>Status</th><th>License keys</th>
              <th style="text-align:right">Amount</th><th>Type</th><th>Payment</th>
            </tr></thead>
            <tbody>${orders.map(orderRow).join("")}</tbody>
          </table>
        </div>
      </div>`;
  }

  // ============================================================
  // QUICK NOTE MODAL
  // ============================================================
  function openQuickNote(state) {
    const p = state.partner;
    if (!p) return;
    const c = state.container;
    const backdrop = c.querySelector('[data-role="qn-backdrop"]');
    const modal = c.querySelector('[data-role="qn-modal"]');
    const hint = c.querySelector('[data-role="qn-hint"]');
    const customerSelect = c.querySelector('[data-role="qn-customer"]');

    hint.innerHTML = `Note for <strong>${esc(p.company)}</strong> <span style="color:var(--prm-dim)">· #${esc(p.id)}</span>`;

    // Populate customer dropdown from partner's keys (unique registrations)
    const keys = p.tabs?.keys || [];
    const customers = [...new Set(keys.map((k) => k.registration).filter(Boolean))].sort();
    customerSelect.innerHTML =
      `<option value="">Add customer to subject (optional)</option>` +
      customers.slice(0, 100).map((cust) => `<option value="${esc(cust)}">${esc(cust.substring(0, 60))}</option>`).join("");

    // Reset fields
    c.querySelector('[data-role="qn-subject"]').value = "";
    c.querySelector('[data-role="qn-body"]').value = "";
    c.querySelector('[data-role="qn-type"]').value = "2";
    const status = c.querySelector('[data-role="qn-status"]');
    status.textContent = "";
    status.className = "prm-qn-status";

    backdrop.classList.add("open");
    modal.classList.add("open");
    setTimeout(() => c.querySelector('[data-role="qn-subject"]').focus(), 80);
  }

  function closeQuickNote(state) {
    const c = state.container;
    c.querySelector('[data-role="qn-backdrop"]')?.classList.remove("open");
    c.querySelector('[data-role="qn-modal"]')?.classList.remove("open");
  }

  async function postQuickNote(state) {
    const p = state.partner;
    if (!p) return;
    const c = state.container;
    const subject = c.querySelector('[data-role="qn-subject"]').value.trim();
    const body = c.querySelector('[data-role="qn-body"]').value.trim();
    const noteType = parseInt(c.querySelector('[data-role="qn-type"]').value || "2", 10);
    const status = c.querySelector('[data-role="qn-status"]');

    function setStatus(text, cls) {
      status.textContent = text;
      status.className = "prm-qn-status" + (cls ? " " + cls : "");
    }

    if (!subject) { setStatus("⚠️ Subject required", "err"); return; }
    if (!body)    { setStatus("⚠️ Body required", "err"); return; }

    setStatus("Posting…", "busy");
    try {
      const r = await fetch("/api/notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          partnerId: p.id,
          subject,
          body,
          noteType,
          seller: state.seller?.name || null,
          source: "onyx-prm",
        }),
      });
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(d.error || `HTTP ${r.status}`);
      }
      setStatus("✅ Posted — refreshing", "ok");
      // Re-compose with fresh notes and re-render
      state.partner = await composePartner(state, p.id);
      setTimeout(() => {
        closeQuickNote(state);
        renderMain(state);
      }, 600);
    } catch (e) {
      setStatus(`❌ ${e.message}`, "err");
    }
  }

  function wireQuickNoteModal(state) {
    const c = state.container;
    c.querySelector('[data-role="qn-backdrop"]').addEventListener("click", () => closeQuickNote(state));
    c.querySelector('[data-role="qn-customer"]').addEventListener("change", (e) => {
      const cust = e.target.value;
      if (!cust) return;
      const subj = c.querySelector('[data-role="qn-subject"]');
      // Prepend customer to subject (matches original PRM behaviour)
      const current = subj.value.replace(/^[^:]+:\s*/, "");
      subj.value = `${cust}: ${current}`.trim().replace(/:\s*$/, "");
      e.target.value = "";
    });
    // ESC closes the modal — listener stays scoped to the document but checks
    // that the modal is open before doing anything.
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        const modal = c.querySelector('[data-role="qn-modal"]');
        if (modal?.classList.contains("open")) closeQuickNote(state);
      }
    });
  }

  // ============================================================
  // ACTION HANDLERS
  // ============================================================
  async function handleAction(state, action) {
    const p = state.partner;
    const c = state.container;

    if (action === "qn-open")  { openQuickNote(state);  return; }
    if (action === "qn-close") { closeQuickNote(state); return; }
    if (action === "qn-post")  { postQuickNote(state);  return; }

    if (action === "jump-keys")  { state.activeTab = "keys";  renderMain(state); return; }
    if (action === "jump-notes") { state.activeTab = "notes"; renderMain(state); return; }

    if (!p) return;

    if (action === "copy-email" && p.email) {
      navigator.clipboard?.writeText(p.email);
      return;
    }

    if (action === "run-call-prep") {
      const ai = c.querySelector('[data-role="ai-text"]');
      ai.innerHTML = '<span class="prm-spinner"></span>Generating pre-call brief…';
      try {
        const r = await fetch("/api/sales/call-prep", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partnerId: p.id,
            seller: state.seller?.name || null,
            provider: localStorage.getItem("onyx-ai-provider") || undefined,
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        ai.textContent = d.text || JSON.stringify(d);
      } catch (e) {
        ai.textContent = `Failed: ${e.message}`;
      }
      return;
    }

    if (action === "post-note") {
      const subject = c.querySelector('[data-role="note-subject"]').value.trim();
      const body = c.querySelector('[data-role="note-body"]').value.trim();
      const noteType = parseInt(c.querySelector('[data-role="note-type"]').value, 10);
      const status = c.querySelector('[data-role="note-status"]');
      if (!subject || !body) { status.textContent = "Subject and body required"; return; }
      status.textContent = "Posting…";
      try {
        await fetch("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partnerId: p.id, subject, body, noteType, seller: state.seller?.name || null, source: "onyx-prm" }),
        });
        state.partner = await composePartner(state, p.id);
        renderMain(state);
      } catch (e) {
        status.textContent = `Failed: ${e.message}`;
      }
      return;
    }

    if (action === "ai-summarise") {
      const body = c.querySelector('[data-role="note-body"]');
      const status = c.querySelector('[data-role="note-status"]');
      if (!body.value.trim()) { status.textContent = "Paste raw notes/transcript first"; return; }
      status.textContent = "Summarising…";
      try {
        const r = await fetch("/api/sales/call-summary", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            partnerId: p.id, transcript: body.value,
            provider: localStorage.getItem("onyx-ai-provider") || undefined,
          }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        body.value = d.text;
        status.textContent = "✦ Summarised — review and post";
      } catch (e) {
        status.textContent = `Failed: ${e.message}`;
      }
      return;
    }
  }

  // ============================================================
  // PUBLIC API
  // ============================================================
  async function mount(container, opts = {}) {
    const state = makeState({
      snapshot: opts.snapshot,
      seller: opts.seller,
    });
    state.container = container;
    container.classList.add("prm-app");
    render(state);

    // Direct-link support: ?partnerId in hash
    const m = location.hash.match(/partnerId=([^&]+)/);
    if (m) {
      state.partner = await composePartner(state, decodeURIComponent(m[1]));
      if (state.partner) { renderSidebar(state); renderMain(state); }
    }
    container._prmState = state;
    return state;
  }

  function unmount(container) {
    if (!container) return;
    container.classList.remove("prm-app");
    container.innerHTML = "";
    delete container._prmState;
  }

  window.prmApp = { mount, unmount };
})();
