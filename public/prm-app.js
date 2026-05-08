/* ============================================================
   PRM dashboard — onyxvvv embed module
   Mountable inside any container (SPA's #view, a modal, …).
   Reuses /api/snapshots/:slug, /api/notes, /api/sales/* endpoints.
   No globals — exposes window.prmApp = { mount, unmount }.
   Ported from anthropics/3cx-prm/dashboard.js.
   ============================================================ */
(function () {
  "use strict";

  const esc = (s) =>
    String(s ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");

  // ── Edition / tier helpers (verbatim from dashboard.js, trimmed) ──────────
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
  // The PRM rendering layer expects { company, contact, email, phone, type, …,
  // tabs:{ keys, orders, notesParsed, users } }. onyxvvv stores partners as
  // { companyName, contactName, accountOwnerEmail, distributorLevel, … } and
  // keys/orders as flat lists. These adapters bridge the two without touching
  // the existing /api/* shape.
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
    // Handles both server snapshot format (licenseKey, productEdition, primaryLicenseSc)
    // AND scraper format (key, product, sc, expiry, issuedTo)
    const keyStr = k.licenseKey || k.key || "";
    return {
      keyId: k.keyId || "",                   // Numeric ID from scraper (for edit.aspx URLs)
      key: keyStr,                            // Full license key string
      product: k.productEdition || k.product || "",
      sc: k.primaryLicenseSc || k.sc || "",
      maxExt: k.primaryLicenseSc || k.maxExt || k.sc || "",
      expiry: k.licenseExpires || k.expiry || "",
      registration: k.company || k.issuedTo || k.registration || "",
      version: k.version || "",
      activatedOn: k.hostingExpires || k.activatedOn || null,
      purchased: k.purchased || null,
      disabled: !!(k.disabled || (k.flags && k.flags.licenseExpired)),
    };
  }

  function viewOrder(o) {
    return {
      orderNo: o.orderId || o.orderNo || "",
      orderUrl: o.orderUrl || "",
      created: o.date || o.created || "",
      status: o.status || "",
      currency: o.currency || "USD",
      amount: o.totalUsd || o.amount || "",
      tax: o.tax || "",
      payment: o.paymentMethod || o.payment || o.txnId || "",
      proformaNo: o.proformaNo || "",
      country: o.country || "",
      type: o.type || "",
      description: o.description || "",
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
      filters: { level: "", search: "" },
      notes: [],
    };
  }

  // ── Compose the partner-360 from snapshot + notes ─────────────────────────
  async function composePartner(state, partnerId) {
    const view = state.partnerList.find((p) => p.id === partnerId);
    if (!view) return null;
    const snap = state.snapshot;

    // Always fetch server-side notes (posted via SPA note form)
    let serverNotes = [];
    try {
      const r = await (window.onyxApiFetch||fetch)(`/api/notes?partnerId=${encodeURIComponent(partnerId)}`);
      const d = await r.json();
      serverNotes = (d.notes || []).map(viewNote);
    } catch { /* offline-tolerant */ }

    // ── Check snapshot.details (pushed by extension via /api/ingest/erp/partner-detail)
    const detail = snap.details?.[partnerId];
    if (detail) {
      // Full partner360 data (has tabs with key/order/note arrays)
      if (detail.tabs) {
        view.company = detail.company || view.company;
        view.contact = detail.contact || view.contact;
        view.email = detail.email || view.email;
        view.phone = detail.phone || view.phone;
        view.type = detail.type || view.type;
        view.category = detail.category || view.category;
        view.country = detail.country || view.country;
        view.enabled = detail.enabled ?? view.enabled;
        view.revenue = detail.revenue || view.revenue;
        const scraperNotes = Array.isArray(detail.tabs.notesParsed) ? detail.tabs.notesParsed.map(viewNote) : [];
        view.tabs = {
          keys: Array.isArray(detail.tabs.keys) ? detail.tabs.keys.map(viewKey) : [],
          orders: Array.isArray(detail.tabs.orders) ? detail.tabs.orders.map(viewOrder) : [],
          notesParsed: [...serverNotes, ...scraperNotes],
          users: Array.isArray(detail.tabs.users) ? detail.tabs.users : [],
        };
        return view;
      }

      // Enrichment-only data (keysSummary — aggregate stats, no individual rows)
      const ks = detail.keysSummary || detail;
      if (ks && (ks.keys !== undefined || ks.commercialKeys !== undefined)) {
        view.enrichmentSummary = ks;
        view.tabs = { keys: [], orders: [], notesParsed: serverNotes, users: [] };
        return view;
      }
    }

    // ── Fallback: filter from snapshot flat arrays ────────────────────────
    const keys = (snap.licenseKeys || []).filter((k) => k.assignedResellerId === partnerId).map(viewKey);
    const orders = (snap.orders || []).filter((o) => o.resellerId === partnerId).map(viewOrder);
    view.tabs = { keys, orders, notesParsed: serverNotes, users: [] };
    return view;
  }

  // ── Health score (simplified vs original) ─────────────────────────────────
  function computeHealth(p) {
    const ks = p.enrichmentSummary;
    // If we have enrichment summary, use its score directly
    if (ks?.score) {
      const score = Math.max(0, Math.min(100, ks.score));
      const color = score >= 70 ? "#2d9e5f" : score >= 40 ? "#e67e00" : "#dc3545";
      return { score, color };
    }
    const notes = p.tabs?.notesParsed || [];
    const keys = p.tabs?.keys || [];
    let score = 50;
    if (keys.length > 5) score += 10;
    if (keys.length > 15) score += 5;
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
  // RENDERING
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
          </div>
          <div class="prm-partner-list" data-role="partner-list"></div>
        </aside>
        <section class="prm-main" data-role="main"></section>
      </div>
      <div class="prm-ai-bar" data-role="ai-bar" hidden>
        <span class="prm-ai-label">✦ AI</span>
        <span data-role="ai-text">Pick a reseller and hit Analyse.</span>
      </div>`;
    renderLevelChips(state);
    renderSidebar(state);
    renderMain(state);
    wireSidebar(state);
  }

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

  function renderSidebar(state) {
    const list = state.partnerList.filter((p) => {
      if (state.filters.level && p.type !== state.filters.level) return false;
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
      .map(
        (p) => `
        <div class="prm-pitem ${state.partner && state.partner.id === p.id ? "active" : ""}" data-id="${esc(p.id)}">
          <div class="prm-pitem-name">${esc(p.company)}</div>
          <div class="prm-pitem-meta">
            #${esc(p.id)}
            ${p.country ? ` · ${esc(p.country)}` : ""}
            ${p.type ? ` · ${esc(p.type)}` : ""}
          </div>
        </div>`,
      )
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
    c.querySelector('[data-role="partner-list"]').addEventListener("click", async (e) => {
      const item = e.target.closest(".prm-pitem");
      if (!item) return;
      const partnerId = item.dataset.id;
      state.partner = await composePartner(state, partnerId);
      state.activeTab = "overview";
      // update URL hash so back-button works (optional — defer to host SPA)
      try { history.replaceState(null, "", `#/prm?partnerId=${encodeURIComponent(partnerId)}`); } catch {}
      renderSidebar(state);
      renderMain(state);
    });
  }

  // ── Main pane ─────────────────────────────────────────────────────────────
  function renderMain(state) {
    const main = state.container.querySelector('[data-role="main"]');
    const aiBar = state.container.querySelector('[data-role="ai-bar"]');
    const p = state.partner;
    if (!p) {
      main.innerHTML = '<div class="prm-loading" style="margin:auto">Pick a reseller from the left.</div>';
      aiBar.hidden = true;
      renderFloatingChat(state);
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
          <div class="prm-p-sub">#${esc(p.id)} · ${esc(p.country || "—")} · ${p.contact ? `Contact: ${esc(p.contact)}` : `Owner: ${esc(p.agent || "—")}`}${p.salesRep ? ` · Rep: ${esc(p.salesRep)}` : ""}${p.startDate ? ` · Since ${esc(p.startDate)}` : ""}</div>
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
          <button class="prm-p-btn" data-action="copy-email">✉ Email</button>
        </div>
      </header>

      <div class="prm-pills-row">
        <div class="prm-spill ${p.enabled ? "green" : "red"}">${p.enabled ? "Active" : "Inactive"}</div>
        ${p.solutionProvider ? '<div class="prm-spill blue">Solution Provider</div>' : ""}
        ${p.highPotential ? '<div class="prm-spill green">High Potential</div>' : ""}
        ${p.revenue ? `<div class="prm-spill">Revenue <strong>$${Number(p.revenue).toLocaleString("en-US")}</strong></div>` : ""}
        ${p.tabs?.keys?.length ? `<div class="prm-spill">${p.tabs.keys.length} keys</div>` : ""}
        ${p.tabs?.orders?.length ? `<div class="prm-spill">${p.tabs.orders.length} orders</div>` : ""}
        ${p.creditLimit ? `<div class="prm-spill">Credit <strong>${esc(p.creditLimit)}</strong></div>` : ""}
        ${p.sellModel ? `<div class="prm-spill" title="How they sell 3CX">${esc(p.sellModel)}</div>` : ""}
        ${p.sipTrunkProvider ? `<div class="prm-spill" title="SIP Trunk Provider">SIP: <strong>${esc(p.sipTrunkProvider)}</strong></div>` : ""}
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
    // Action handler: set up ONCE on main (not every renderMain call)
    if (!main._actionHandlerAttached) {
      main._actionHandlerAttached = true;
      main.addEventListener("click", (e) => {
        const a = e.target.closest("[data-action]");
        if (!a) return;
        handleAction(state, a.dataset.action);
      });
    }

    renderTab(state);
    // Show floating AI chat when partner is selected
    _chatMessages = []; // Reset chat for new partner
    _chatOpen = false;
    renderFloatingChat(state);
  }

  function renderTab(state) {
    const el = state.container.querySelector('[data-role="tab-content"]');
    const p = state.partner;
    switch (state.activeTab) {
      case "overview": renderOverview(el, p); break;
      case "notes":    renderNotes(el, p, state); break;
      case "keys":     renderKeys(el, p); break;
      case "orders":   renderOrders(el, p); break;
      case "users":    renderUsers(el, p); break;
    }
  }

  function renderOverview(el, p) {
    const keys = p.tabs?.keys || [];
    const orders = p.tabs?.orders || [];
    const notes = p.tabs?.notesParsed || [];
    const ks = p.enrichmentSummary; // from enrichment (aggregate stats only)
    const today = new Date();

    // Use enrichment summary if individual key rows aren't available
    let installBase, liveCount, customerCount, renewalRate, edMix, expiringSoon;

    if (keys.length > 0) {
      // Full data — compute from individual keys
      const liveKeys = keys.filter((k) => !k.disabled);
      liveCount = liveKeys.length;
      installBase = keys.length;
      customerCount = [...new Set(liveKeys.map((k) => k.registration).filter(Boolean))].length;
      const editions = {};
      liveKeys.forEach((k) => {
        const ed = editionOf(k.product);
        if (!editions[ed.full]) editions[ed.full] = { ...ed, count: 0 };
        editions[ed.full].count++;
      });
      edMix = editions;
      expiringSoon = liveKeys
        .map((k) => ({ ...k, days: parseDate(k.expiry) ? Math.round((parseDate(k.expiry) - today) / 86400000) : null }))
        .filter((k) => k.days !== null && k.days <= 90)
        .sort((a, b) => a.days - b.days);
      renewalRate = liveKeys.length
        ? Math.round((liveKeys.filter((k) => { const d = parseDate(k.expiry); return d && d > today; }).length / liveKeys.length) * 100)
        : 0;
    } else if (ks) {
      // Enrichment summary — show aggregate stats
      installBase = ks.keys || ks.commercialKeys || 0;
      liveCount = installBase;
      customerCount = null; // not available from summary
      renewalRate = ks.renewalRate || 0;
      edMix = {};
      if (ks.edMix) {
        Object.entries(ks.edMix).forEach(([name, count]) => {
          edMix[name] = { full: name, short: name.substring(0,3).toUpperCase(), color: "#0077b6", bg: "#e3f2fd", count };
        });
      }
      expiringSoon = [];
    } else {
      installBase = 0; liveCount = 0; customerCount = 0; renewalRate = 0; edMix = {}; expiringSoon = [];
    }

    const totalEd = Object.values(edMix).reduce((a, b) => a + b.count, 0) || 1;
    const fromEnrichment = keys.length === 0 && ks;

    el.innerHTML = `
      ${fromEnrichment ? `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;margin-bottom:10px;background:var(--surface-2);border:1px solid #4a3580;border-radius:6px">
        <span style="font-size:11px;color:#c4a8ff;flex:1">✦ Enrichment summary — click to load full detail</span>
        <button data-action="fetch-full-detail" style="font-size:12px;padding:4px 12px;border-radius:5px;border:1px solid #4a3580;background:var(--prm-s);color:#a78bfa;cursor:pointer;font-weight:600;font-family:inherit;transition:all .15s">↻ Load full detail</button>
      </div>` : ""}

      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
        <div class="prm-section" style="padding:10px 12px;margin:0">
          <div style="font-size:10px;color:var(--prm-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Install Base</div>
          <div style="font-size:22px;font-weight:600">${installBase}</div>
          <div style="font-size:10px;color:var(--prm-dim)">${liveCount} live</div>
        </div>
        <div class="prm-section" style="padding:10px 12px;margin:0">
          <div style="font-size:10px;color:var(--prm-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">${customerCount !== null ? "Customers" : "New (30d)"}</div>
          <div style="font-size:22px;font-weight:600">${customerCount !== null ? customerCount : (ks?.newActivations || 0)}</div>
        </div>
        <div class="prm-section" style="padding:10px 12px;margin:0">
          <div style="font-size:10px;color:var(--prm-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Renewal Rate</div>
          <div style="font-size:22px;font-weight:600;color:${renewalRate >= 80 ? "var(--prm-green)" : renewalRate >= 60 ? "var(--prm-amber)" : "var(--prm-red)"}">${renewalRate}%</div>
        </div>
        <div class="prm-section" style="padding:10px 12px;margin:0">
          <div style="font-size:10px;color:var(--prm-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">${fromEnrichment ? "Expiring" : "Orders"}</div>
          <div style="font-size:22px;font-weight:600">${fromEnrichment ? (ks?.expiringSoon || 0) : orders.length}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="prm-section">
          <div class="prm-section-head"><span class="prm-section-title">Install mix</span></div>
          <div style="padding:10px 14px">
            ${Object.entries(edMix).map(([name, ed]) => {
              const pct = Math.round((ed.count / totalEd) * 100);
              return `<div style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
                  <span style="color:var(--prm-m)">${esc(name)}</span><span style="font-weight:600">${pct}%</span>
                </div>
                <div style="height:5px;background:var(--prm-s2);border-radius:3px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${ed.color || "#0077b6"};border-radius:3px"></div>
                </div></div>`;
            }).join("") || '<div class="prm-empty">No keys</div>'}
          </div>
        </div>
        <div class="prm-section">
          <div class="prm-section-head">
            <span class="prm-section-title" style="color:var(--prm-amber)">⚠ Renewal radar</span>
            <span class="prm-section-count">${expiringSoon.length}</span>
          </div>
          ${expiringSoon.length ? `<div>${expiringSoon.slice(0,8).map((k) => {
            const col = k.days < 0 ? "var(--prm-red)" : k.days <= 30 ? "var(--prm-amber)" : "var(--prm-green)";
            return `<div style="display:flex;align-items:center;gap:8px;padding:6px 14px;border-bottom:1px solid var(--prm-b)">
              <span style="flex:1;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.registration || k.key || "—")}</span>
              <span style="font-size:10px;font-weight:700;color:${col}">${k.days < 0 ? `${Math.abs(k.days)}d late` : `${k.days}d`}</span>
            </div>`;
          }).join("")}</div>` : '<div class="prm-empty">No renewals due</div>'}
        </div>
      </div>

      <div class="prm-section" style="margin-top:12px">
        <div class="prm-section-head">
          <span class="prm-section-title">Recent notes</span>
          <span class="prm-section-count">${notes.length}</span>
        </div>
        <div>${notes.slice(0,4).map(renderNoteCard).join("") || '<div class="prm-empty">No notes</div>'}</div>
      </div>
    `;
  }

  const NB_CLASS = { Contact: "nb-contact", Support: "nb-support", Call: "nb-call", Project: "nb-project", Commitments: "nb-commitments", Email: "nb-email" };
  function renderNoteCard(n) {
    return `<div class="prm-note-card">
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
                <option value="5">Email</option>
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
        <div class="prm-section-head"><span class="prm-section-title">Timeline</span><span class="prm-section-count">${notes.length}</span></div>
        <div>${notes.length ? notes.map(renderNoteCard).join("") : '<div class="prm-empty">No notes yet.</div>'}</div>
      </div>`;
  }

  function renderKeys(el, p) {
    const keys = p.tabs?.keys || [];
    if (!keys.length) { el.innerHTML = '<div class="prm-section"><div class="prm-empty">No license keys.</div></div>'; return; }
    const today = new Date();
    el.innerHTML = `
      <div class="prm-section">
        <div class="prm-section-head"><span class="prm-section-title">All license keys</span><span class="prm-section-count">${keys.length}</span></div>
        <div style="overflow-x:auto"><table class="prm-dtable" id="prm-keys-table">
          <thead><tr><th>Key</th><th>Product</th><th>SC</th><th>Expiry</th><th>Customer</th><th>Version</th></tr></thead>
          <tbody>${keys.map((k) => {
            const d = parseDate(k.expiry);
            const days = d ? Math.round((d - today) / 86400000) : null;
            const col = days === null ? "" : days < 0 ? "color:var(--prm-red);font-weight:600" : days <= 30 ? "color:var(--prm-amber);font-weight:600" : "color:var(--prm-green)";
            return `<tr class="prm-key-row${k.disabled ? " prm-key-row-disabled" : ""}" data-key-id="${esc(k.keyId)}" style="cursor:pointer">
              <td style="font-family:monospace;font-size:11px">${k.keyId ? `<a class="prm-key-link" href="https://staff.3cx.com/key/edit.aspx?i=${encodeURIComponent(k.keyId)}" target="_blank" rel="noopener" onclick="event.stopPropagation()">${esc(k.key)}</a>` : esc(k.key)}</td>
              <td>${esc(k.product)}</td>
              <td><span style="background:rgba(45,158,95,.15);color:#2d9e5f;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">${esc(k.sc)}SC</span></td>
              <td style="${col};font-size:11px">${esc(k.expiry)}${days !== null ? ` <span style="color:var(--prm-dim)">(${days < 0 ? `${Math.abs(days)}d late` : `${days}d`})</span>` : ""}</td>
              <td style="font-size:11px;color:var(--prm-m)">${esc(k.registration || "—")}</td>
              <td style="font-size:11px;color:var(--prm-dim)">${esc(k.version)}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>`;

    // Wire key row click → expandable detail
    el.querySelectorAll(".prm-key-row").forEach(row => {
      row.addEventListener("click", async () => {
        const keyId = row.dataset.keyId;
        if (!keyId) return;
        // Toggle: if detail row already exists, remove it
        const existing = row.nextElementSibling;
        if (existing?.classList?.contains("prm-key-detail-row")) { existing.remove(); return; }
        // Remove any other open detail rows
        el.querySelectorAll(".prm-key-detail-row").forEach(r => r.remove());
        // Insert loading row
        const detailRow = document.createElement("tr");
        detailRow.className = "prm-key-detail-row";
        detailRow.innerHTML = '<td colspan="6" style="padding:12px 16px;background:var(--prm-s2);border-bottom:2px solid #4a3580"><span style="color:var(--prm-dim);font-size:11px">↻ Loading key detail…</span></td>';
        row.after(detailRow);
        try {
          // Fetch via bridge
          const result = await new Promise((resolve) => {
            const reqId = `kd_${Date.now()}`;
            const handler = (e) => { if (e.detail?.reqId !== reqId) return; window.removeEventListener("onyx-bridge:response", handler); resolve(e.detail); };
            window.addEventListener("onyx-bridge:response", handler);
            window.dispatchEvent(new CustomEvent("onyx-bridge:request", { detail: { reqId, type: "FETCH_KEY_DETAIL", keyId } }));
            setTimeout(() => { window.removeEventListener("onyx-bridge:response", handler); resolve(null); }, 30000);
          });
          if (result?.ok && result.result) {
            const kd = result.result;
            detailRow.innerHTML = `<td colspan="6" style="padding:14px 20px;background:var(--prm-s2);border-bottom:2px solid #4a3580;border-left:3px solid #6f42c1">
              <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;font-size:11px">
                <div>
                  <div style="color:var(--prm-dim);font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Company</div>
                  <div style="font-weight:700;color:var(--prm-t)">${esc(kd.issuedTo || "—")}</div>
                </div>
                <div>
                  <div style="color:var(--prm-dim);font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">FQDN</div>
                  <div style="font-weight:600;color:var(--prm-a)">${esc(kd.fqdn || "—")}</div>
                </div>
                <div>
                  <div style="color:var(--prm-dim);font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">IP Address</div>
                  <div style="font-weight:600;font-family:monospace">${esc(kd.ip || "—")}</div>
                </div>
                <div>
                  <div style="color:var(--prm-dim);font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Deployed As</div>
                  <div style="font-weight:600">${esc(kd.deployedAs || "—")}</div>
                </div>
                <div>
                  <div style="color:var(--prm-dim);font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Extensions</div>
                  <div style="font-weight:700;color:#0077b6">${esc(kd.extensions || "—")}</div>
                </div>
                <div>
                  <div style="color:var(--prm-dim);font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Purchase Date</div>
                  <div style="font-weight:600">${esc(kd.purchaseDate || "—")}</div>
                </div>
                <div>
                  <div style="color:var(--prm-dim);font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Activations</div>
                  <div style="font-weight:600">${esc(kd.activations || "—")}</div>
                </div>
                <div>
                  <div style="color:var(--prm-dim);font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Facility ID</div>
                  <div style="font-family:monospace;font-size:10px;color:var(--prm-dim)">${esc(kd.facilityId || "—")}</div>
                </div>
                <div>
                  <div style="color:var(--prm-dim);font-size:9px;text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Ports / WebMeeting</div>
                  <div style="font-size:10px">${esc(kd.httpsPort || "—")}/${esc(kd.httpPort || "—")} · <span style="color:var(--prm-a)">${esc(kd.webMeetingFqdn || "—")}</span></div>
                </div>
              </div>
            </td>`;
          } else {
            detailRow.innerHTML = '<td colspan="6" style="padding:12px 16px;background:var(--prm-s2)"><span style="color:var(--prm-red);font-size:11px">Failed to load key detail. Extension not connected?</span></td>';
          }
        } catch (e) {
          detailRow.innerHTML = `<td colspan="6" style="padding:12px 16px;background:var(--prm-s2)"><span style="color:var(--prm-red);font-size:11px">Error: ${esc(e.message)}</span></td>`;
        }
      });
    });
  }

  function renderOrders(el, p) {
    const orders = p.tabs?.orders || [];
    if (!orders.length) { el.innerHTML = '<div class="prm-section"><div class="prm-empty">No orders.</div></div>'; return; }
    const totals = orders.filter((o) => /paid|complete/i.test(o.status)).reduce((s, o) => s + Number(o.amount || 0), 0);
    el.innerHTML = `
      <div class="prm-section">
        <div class="prm-section-head"><span class="prm-section-title">Orders</span><span class="prm-section-count">${orders.length} · Σ $${totals.toLocaleString("en-US")}</span></div>
        <div style="overflow-x:auto"><table class="prm-dtable">
          <thead><tr><th>Order #</th><th>Date</th><th>Status</th><th>Type</th><th style="text-align:right">Amount</th><th>Payment</th></tr></thead>
          <tbody>${orders.map((o) => {
            const cls = /paid/i.test(o.status) ? "green" : /pending/i.test(o.status) ? "amber" : /cancel|reject/i.test(o.status) ? "red" : "blue";
            return `<tr>
              <td style="font-family:monospace;font-size:11px">${esc(o.orderNo)}</td>
              <td style="font-size:11px">${esc(o.created)}</td>
              <td><span class="prm-order-status ${cls}">${esc(o.status)}</span></td>
              <td style="font-size:11px;color:var(--prm-m)">${esc(o.type || "")}</td>
              <td style="font-size:11px;text-align:right;font-weight:600">$${Number(o.amount || 0).toLocaleString("en-US")}</td>
              <td style="font-size:11px;color:var(--prm-m)">${esc(o.payment || "")}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>`;
  }

  function renderUsers(el, p) {
    const users = p.tabs?.users || [];
    if (!users.length) {
      el.innerHTML = `<div class="prm-section"><div class="prm-empty">No users loaded. ${p.enrichmentSummary ? 'Click "↻ Load full detail" to fetch user data from the ERP.' : ""}</div></div>`;
      return;
    }
    el.innerHTML = `
      <div class="prm-section">
        <div class="prm-section-head"><span class="prm-section-title">Users</span><span class="prm-section-count">${users.length}</span></div>
        <div style="overflow-x:auto"><table class="prm-dtable">
          <thead><tr><th>Name</th><th>Email</th><th>Phone</th><th>Roles</th><th>Cert</th><th>Status</th><th>Last Login</th></tr></thead>
          <tbody>${users.map((u) => {
            const name = [u.firstName, u.lastName].filter(Boolean).join(" ") || u.name || "—";
            const isOwner = (u.roles || "").includes("Owner");
            return `<tr>
              <td style="font-weight:${isOwner ? 700 : 500};white-space:nowrap">${esc(name)}${isOwner ? ' <span style="color:var(--prm-a);font-size:9px;font-weight:700">OWNER</span>' : ""}</td>
              <td style="font-size:11px"><a href="mailto:${esc(u.email || "")}" style="color:var(--prm-a);text-decoration:none">${esc(u.email || "—")}</a></td>
              <td style="font-size:11px;white-space:nowrap;color:var(--prm-m)">${esc(u.phone || "—")}</td>
              <td style="font-size:10px;color:var(--prm-dim);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(u.roles || "")}">${esc(u.roles || "—")}</td>
              <td style="font-size:11px">${u.certLevel ? `<span style="background:${u.certLevel === "Advanced" ? "rgba(0,119,182,.15);color:#5c9dff" : "rgba(45,158,95,.12);color:#2d9e5f"};padding:1px 6px;border-radius:3px;font-size:9px;font-weight:700">${esc(u.certLevel)}</span>` : '<span style="color:var(--prm-dim)">—</span>'}</td>
              <td style="font-size:11px;color:${u.status === "enrolled" ? "var(--prm-green)" : "var(--prm-dim)"}">${esc(u.status || "—")}</td>
              <td style="font-size:11px;color:var(--prm-dim)">${esc(u.lastLogin || "—")}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>`;
  }

  // ── Action handlers ───────────────────────────────────────────────────────
  async function handleAction(state, action) {
    const p = state.partner;
    if (!p) return;
    const c = state.container;

    if (action === "fetch-full-detail") {
      const status = c.querySelector('[data-action="fetch-full-detail"]');
      if (status) { status.innerHTML = '<span style="display:inline-block;animation:prm-spin .7s linear infinite">↻</span> Loading…'; status.disabled = true; }
      try {
        // Call extension via bridge to fetch full partner360
        const result = await new Promise((resolve) => {
          const reqId = `p360_${Date.now()}`;
          const handler = (e) => {
            if (e.detail?.reqId !== reqId) return;
            window.removeEventListener("onyx-bridge:response", handler);
            resolve(e.detail);
          };
          window.addEventListener("onyx-bridge:response", handler);
          window.dispatchEvent(new CustomEvent("onyx-bridge:request", {
            detail: { reqId, type: "FETCH_PARTNER360", partnerId: p.id },
          }));
          setTimeout(() => { window.removeEventListener("onyx-bridge:response", handler); resolve(null); }, 60000);
        });
        if (result?.ok) {
          // Re-compose partner with fresh full data (pushed to server by extension)
          await new Promise(r => setTimeout(r, 1000)); // wait for server to process the push
          // Reload snapshot to get the freshly pushed detail
          const snapList = await (window.onyxApiFetch||fetch)("/api/snapshots").then(r => r.json());
          if (snapList.snapshots?.length) {
            snapList.snapshots.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
            const target = snapList.snapshots.find(s => s.email === state.seller?.id) || snapList.snapshots[0];
            const freshSnap = await (window.onyxApiFetch||fetch)(`/api/snapshots/${encodeURIComponent(target.slug)}`).then(r => r.json());
            state.snapshot = freshSnap;
          }
          state.partner = await composePartner(state, p.id);
          renderMain(state);
        } else {
          if (status) { status.textContent = "↻ Failed — extension not connected?"; status.disabled = false; }
        }
      } catch (e) {
        if (status) { status.textContent = `↻ ${e.message}`; status.disabled = false; }
      }
      return;
    }

    if (action === "copy-email" && p.email) {
      navigator.clipboard?.writeText(p.email);
      return;
    }

    if (action === "run-call-prep") {
      const ai = c.querySelector('[data-role="ai-text"]');
      ai.innerHTML = '<span class="prm-spinner"></span>Generating pre-call brief…';
      try {
        const r = await (window.onyxApiFetch||fetch)("/api/sales/call-prep", {
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
        // 1. Post to ONYX server (local storage)
        await (window.onyxApiFetch||fetch)("/api/notes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ partnerId: p.id, subject, body, noteType, seller: state.seller?.name || null, source: "onyx-prm" }),
        });

        // 2. Post to ERP (staff.3cx.com) via extension bridge — fire-and-forget
        try {
          window.dispatchEvent(new CustomEvent("onyx-bridge:request", {
            detail: {
              reqId: `note_${Date.now()}`,
              type: "POST_NOTE",
              payload: { partnerId: p.id, subject, body, noteType },
            },
          }));
          status.textContent = "✓ Posted to ONYX + ERP";
        } catch {
          status.textContent = "✓ Posted to ONYX (ERP bridge unavailable)";
        }

        // Re-compose with fresh notes
        await new Promise(r => setTimeout(r, 500)); // brief delay for ERP to process
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
        const r = await (window.onyxApiFetch||fetch)("/api/sales/call-summary", {
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
  // FLOATING AI CHAT — appears when a partner is selected
  // ============================================================
  let _chatEl = null;
  let _chatOpen = false;
  let _chatMessages = [];
  let _chatLoading = false;

  function injectChatCSS() {
    if (document.getElementById("prm-chat-css")) return;
    const s = document.createElement("style");
    s.id = "prm-chat-css";
    s.textContent = `
.prm-fab{position:fixed;bottom:24px;right:24px;width:52px;height:52px;border-radius:50%;background:linear-gradient(135deg,#7c4dff,#651fff);color:#fff;border:none;cursor:pointer;font-size:22px;box-shadow:0 4px 16px rgba(124,77,255,.35);z-index:1000;display:flex;align-items:center;justify-content:center;transition:transform .15s,box-shadow .15s;}
.prm-fab:hover{transform:scale(1.08);box-shadow:0 6px 24px rgba(124,77,255,.45);}
.prm-chat-panel{position:fixed;bottom:88px;right:24px;width:420px;max-height:520px;background:var(--prm-s,#141c28);border:1px solid var(--prm-b,#2d3a4d);border-radius:14px;box-shadow:0 8px 32px rgba(0,0,0,.4);z-index:1001;display:flex;flex-direction:column;overflow:hidden;font-family:var(--prm-font,'Segoe UI',system-ui,sans-serif);}
.prm-chat-head{display:flex;align-items:center;gap:10px;padding:12px 16px;background:var(--prm-s2,#1a2332);border-bottom:1px solid var(--prm-b,#2d3a4d);}
.prm-chat-head-title{flex:1;font-size:13px;font-weight:600;color:var(--prm-t,#e8edf4);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;}
.prm-chat-close{background:none;border:none;color:var(--prm-dim,#6b7a8d);font-size:16px;cursor:pointer;padding:4px;}
.prm-chat-close:hover{color:var(--prm-t,#e8edf4);}
.prm-chat-actions{padding:10px 14px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid var(--prm-b,#2d3a4d);}
.prm-chat-action{font-size:11px;padding:5px 12px;border-radius:6px;border:1px solid var(--prm-b,#2d3a4d);background:var(--prm-s,#141c28);color:var(--prm-m,#8b9cb3);cursor:pointer;font-family:inherit;font-weight:600;transition:all .15s;}
.prm-chat-action:hover{border-color:#7c4dff;color:#a78bfa;}
.prm-chat-action.loading{opacity:.5;cursor:wait;}
.prm-chat-body{flex:1;overflow-y:auto;padding:12px 14px;display:flex;flex-direction:column;gap:10px;min-height:120px;max-height:340px;}
.prm-chat-msg{font-size:12px;line-height:1.55;padding:10px 12px;border-radius:8px;white-space:pre-wrap;word-break:break-word;}
.prm-chat-msg.ai{background:var(--prm-s2,#1a2332);color:var(--prm-t,#e8edf4);border:1px solid var(--prm-b,#2d3a4d);}
.prm-chat-msg.user{background:rgba(124,77,255,.12);color:#c4a8ff;border:1px solid rgba(124,77,255,.25);align-self:flex-end;max-width:85%;}
.prm-chat-msg.loading-msg{color:var(--prm-dim,#6b7a8d);font-style:italic;}
.prm-chat-input-row{display:flex;gap:6px;padding:10px 14px;border-top:1px solid var(--prm-b,#2d3a4d);}
.prm-chat-input{flex:1;background:var(--prm-s2,#1a2332);border:1px solid var(--prm-b,#2d3a4d);border-radius:6px;color:var(--prm-t,#e8edf4);font:12px var(--prm-font,'Segoe UI',system-ui,sans-serif);padding:7px 10px;outline:none;resize:none;}
.prm-chat-input:focus{border-color:#7c4dff;}
.prm-chat-send{background:linear-gradient(135deg,#7c4dff,#651fff);border:none;border-radius:6px;color:#fff;font-size:12px;font-weight:700;padding:7px 14px;cursor:pointer;font-family:inherit;}
.prm-chat-send:disabled{opacity:.4;cursor:not-allowed;}
`;
    document.head.appendChild(s);
  }

  function renderFloatingChat(state) {
    injectChatCSS();
    // Remove old elements
    document.querySelectorAll(".prm-fab,.prm-chat-panel").forEach((el) => el.remove());

    if (!state.partner) return; // No partner selected — no chat

    // FAB button
    const fab = document.createElement("button");
    fab.className = "prm-fab";
    fab.innerHTML = "✦";
    fab.title = "AI Assistant";
    fab.addEventListener("click", () => {
      _chatOpen = !_chatOpen;
      renderFloatingChat(state);
    });
    document.body.appendChild(fab);

    if (!_chatOpen) return;

    const p = state.partner;
    const panel = document.createElement("div");
    panel.className = "prm-chat-panel";

    const actions = [
      { key: "precall", label: "✦ Pre-call brief", endpoint: "/api/sales/call-prep" },
      { key: "postcall", label: "📝 Post-call summary", endpoint: "/api/sales/call-summary", needsInput: true },
      { key: "research", label: "🔍 Account research", endpoint: "/api/sales/account-research" },
      { key: "outreach", label: "✉ Draft outreach", endpoint: "/api/sales/draft-outreach", needsIntent: true },
    ];

    panel.innerHTML = `
      <div class="prm-chat-head">
        <span style="font-size:14px">✦</span>
        <div class="prm-chat-head-title">AI · ${esc(p.company || p.companyName || "Partner")}</div>
        <button class="prm-chat-close" id="prmChatClose">✕</button>
      </div>
      <div class="prm-chat-actions" id="prmChatActions">
        ${actions.map((a) => `<button class="prm-chat-action${_chatLoading ? " loading" : ""}" data-key="${a.key}" ${_chatLoading ? "disabled" : ""}>${a.label}</button>`).join("")}
      </div>
      <div class="prm-chat-body" id="prmChatBody">
        ${_chatMessages.length === 0 ? `<div class="prm-chat-msg ai" style="color:var(--prm-dim)">Select an action above, or ask a question about ${esc(p.company || "this partner")} below.</div>` : ""}
        ${_chatMessages.map((m) => `<div class="prm-chat-msg ${m.role}">${esc(m.text)}</div>`).join("")}
        ${_chatLoading ? '<div class="prm-chat-msg loading-msg">Thinking…</div>' : ""}
      </div>
      <div class="prm-chat-input-row">
        <textarea class="prm-chat-input" id="prmChatInput" rows="1" placeholder="Ask about ${esc(p.company || "this partner")}…"></textarea>
        <button class="prm-chat-send" id="prmChatSend" ${_chatLoading ? "disabled" : ""}>Send</button>
      </div>
    `;
    document.body.appendChild(panel);

    // Scroll to bottom
    const body = panel.querySelector("#prmChatBody");
    body.scrollTop = body.scrollHeight;

    // Events
    panel.querySelector("#prmChatClose").addEventListener("click", () => {
      _chatOpen = false;
      renderFloatingChat(state);
    });

    panel.querySelectorAll(".prm-chat-action").forEach((btn) => {
      btn.addEventListener("click", async () => {
        if (_chatLoading) return;
        const key = btn.dataset.key;
        const action = actions.find((a) => a.key === key);
        if (!action) return;

        // Post-call needs transcript input
        if (action.needsInput) {
          const transcript = prompt("Paste your call notes or transcript:");
          if (!transcript || transcript.length < 30) { alert("Transcript must be at least 30 characters."); return; }
          await runAI(state, action.label, action.endpoint, { partnerId: p.id, transcript, seller: state.seller });
          return;
        }
        // Outreach needs intent
        if (action.needsIntent) {
          const intent = prompt("What's the goal? (e.g. 'renewal nudge', 'upsell to Enterprise')");
          if (!intent) return;
          await runAI(state, action.label, action.endpoint, { partnerId: p.id, intent, seller: state.seller });
          return;
        }
        // Pre-call, research — just need partnerId
        await runAI(state, action.label, action.endpoint, { partnerId: p.id, seller: state.seller });
      });
    });

    // Free-form chat
    const input = panel.querySelector("#prmChatInput");
    const sendBtn = panel.querySelector("#prmChatSend");
    async function sendFreeChat() {
      const text = input.value.trim();
      if (!text || _chatLoading) return;
      _chatMessages.push({ role: "user", text });
      _chatLoading = true;
      renderFloatingChat(state);
      try {
        const ks = p.enrichmentSummary || {};
        const context = `Partner: ${p.company || p.companyName}, ID: ${p.id}, Country: ${p.country}, Level: ${p.level || p.distributorLevel}. Keys: ${ks.keys || ks.commercialKeys || "?"}, Renewal rate: ${ks.renewalRate || "?"}%, Score: ${ks.score || "?"}.`;
        const messages = _chatMessages.map((m) => ({
          role: m.role === "ai" ? "assistant" : m.role,
          content: m.role === "user" ? `[Context: ${context}]\n\n${m.text}` : m.text,
        }));
        const r = await (window.onyxApiFetch||fetch)("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages }),
        });
        const d = await r.json();
        if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
        _chatMessages.push({ role: "ai", text: d.reply || d.text || "No response." });
      } catch (e) {
        _chatMessages.push({ role: "ai", text: `Error: ${e.message}` });
      } finally {
        _chatLoading = false;
        renderFloatingChat(state);
      }
    }
    sendBtn.addEventListener("click", sendFreeChat);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendFreeChat(); }
    });
  }

  async function runAI(state, label, endpoint, body) {
    _chatMessages.push({ role: "user", text: label });
    _chatLoading = true;
    renderFloatingChat(state);
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json();
      if (!r.ok) throw new Error(d.error || `HTTP ${r.status}`);
      _chatMessages.push({ role: "ai", text: d.text || d.reply || JSON.stringify(d) });
    } catch (e) {
      _chatMessages.push({ role: "ai", text: `Error: ${e.message}` });
    } finally {
      _chatLoading = false;
      renderFloatingChat(state);
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
    // Stash on element so unmount can find it
    container._prmState = state;
    return state;
  }

  function unmount(container) {
    if (!container) return;
    container.classList.remove("prm-app");
    container.innerHTML = "";
    delete container._prmState;
    // Remove floating chat elements
    document.querySelectorAll(".prm-fab,.prm-chat-panel").forEach((el) => el.remove());
    _chatMessages = [];
    _chatOpen = false;
  }

  window.prmApp = { mount, unmount };
})();
