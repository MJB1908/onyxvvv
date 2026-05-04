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
    return {
      keyId: k.licenseKey,
      key: (k.licenseKey || "").split("-")[0] || k.licenseKey,
      product: k.productEdition || "",
      sc: k.primaryLicenseSc || "",
      maxExt: k.primaryLicenseSc || "",
      expiry: k.licenseExpires || "",
      registration: k.company || "",
      version: k.version || "",
      activatedOn: k.hostingExpires || null,
      purchased: null,
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

    // ── Check snapshot.details (pushed by extension via /api/ingest/erp/partner-detail)
    const detail = snap.details?.[partnerId];
    if (detail) {
      // Merge detail data into the view object
      view.company = detail.company || view.company;
      view.contact = detail.contact || view.contact;
      view.email = detail.email || view.email;
      view.phone = detail.phone || view.phone;
      view.type = detail.type || view.type;
      view.category = detail.category || view.category;
      view.country = detail.country || view.country;
      view.enabled = detail.enabled ?? view.enabled;
      view.revenue = detail.revenue || view.revenue;
      view.tabs = {
        keys: Array.isArray(detail.tabs?.keys) ? detail.tabs.keys.map(viewKey) : [],
        orders: Array.isArray(detail.tabs?.orders) ? detail.tabs.orders.map(viewOrder) : [],
        notesParsed: Array.isArray(detail.tabs?.notesParsed) ? detail.tabs.notesParsed.map(viewNote) : [],
        users: Array.isArray(detail.tabs?.users) ? detail.tabs.users : [],
      };
      return view;
    }

    // ── Fallback: filter from snapshot flat arrays ────────────────────────
    const keys = (snap.licenseKeys || []).filter((k) => k.assignedResellerId === partnerId).map(viewKey);
    const orders = (snap.orders || []).filter((o) => o.resellerId === partnerId).map(viewOrder);
    let notes = [];
    try {
      const r = await fetch(`/api/notes?partnerId=${encodeURIComponent(partnerId)}`);
      const d = await r.json();
      notes = (d.notes || []).map(viewNote);
    } catch { /* offline-tolerant */ }
    view.tabs = { keys, orders, notesParsed: notes, users: [] };
    return view;
  }

  // ── Health score (simplified vs original) ─────────────────────────────────
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
      case "overview": renderOverview(el, p); break;
      case "notes":    renderNotes(el, p, state); break;
      case "keys":     renderKeys(el, p); break;
      case "orders":   renderOrders(el, p); break;
      case "users":    el.innerHTML = '<div class="prm-empty">User data not in current snapshot.</div>'; break;
    }
  }

  function renderOverview(el, p) {
    const keys = p.tabs?.keys || [];
    const orders = p.tabs?.orders || [];
    const notes = p.tabs?.notesParsed || [];
    const today = new Date();
    const liveKeys = keys.filter((k) => !k.disabled);
    const customers = [...new Set(liveKeys.map((k) => k.registration).filter(Boolean))];
    const editions = {};
    liveKeys.forEach((k) => {
      const ed = editionOf(k.product);
      if (!editions[ed.full]) editions[ed.full] = { ...ed, count: 0 };
      editions[ed.full].count++;
    });
    const totalEd = Object.values(editions).reduce((a, b) => a + b.count, 0) || 1;

    const expiringSoon = liveKeys
      .map((k) => ({ ...k, days: parseDate(k.expiry) ? Math.round((parseDate(k.expiry) - today) / 86400000) : null }))
      .filter((k) => k.days !== null && k.days <= 90)
      .sort((a, b) => a.days - b.days);

    const renewalRate = liveKeys.length
      ? Math.round((liveKeys.filter((k) => { const d = parseDate(k.expiry); return d && d > today; }).length / liveKeys.length) * 100)
      : 0;

    el.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:14px">
        <div class="prm-section" style="padding:10px 12px;margin:0">
          <div style="font-size:10px;color:var(--prm-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Install Base</div>
          <div style="font-size:22px;font-weight:600">${keys.length}</div>
          <div style="font-size:10px;color:var(--prm-dim)">${liveKeys.length} live</div>
        </div>
        <div class="prm-section" style="padding:10px 12px;margin:0">
          <div style="font-size:10px;color:var(--prm-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Customers</div>
          <div style="font-size:22px;font-weight:600">${customers.length}</div>
        </div>
        <div class="prm-section" style="padding:10px 12px;margin:0">
          <div style="font-size:10px;color:var(--prm-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Renewal Rate</div>
          <div style="font-size:22px;font-weight:600;color:${renewalRate >= 80 ? "var(--prm-green)" : renewalRate >= 60 ? "var(--prm-amber)" : "var(--prm-red)"}">${renewalRate}%</div>
        </div>
        <div class="prm-section" style="padding:10px 12px;margin:0">
          <div style="font-size:10px;color:var(--prm-dim);text-transform:uppercase;letter-spacing:.4px;margin-bottom:3px">Orders</div>
          <div style="font-size:22px;font-weight:600">${orders.length}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="prm-section">
          <div class="prm-section-head"><span class="prm-section-title">Install mix</span></div>
          <div style="padding:10px 14px">
            ${Object.entries(editions).map(([name, ed]) => {
              const pct = Math.round((ed.count / totalEd) * 100);
              return `<div style="margin-bottom:8px">
                <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">
                  <span style="color:var(--prm-m)">${esc(name)}</span><span style="font-weight:600">${pct}%</span>
                </div>
                <div style="height:5px;background:var(--prm-s2);border-radius:3px;overflow:hidden">
                  <div style="height:100%;width:${pct}%;background:${ed.color};border-radius:3px"></div>
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
        <div style="overflow-x:auto"><table class="prm-dtable">
          <thead><tr><th>Key</th><th>Product</th><th>SC</th><th>Expiry</th><th>Customer</th><th>Version</th></tr></thead>
          <tbody>${keys.map((k) => {
            const d = parseDate(k.expiry);
            const days = d ? Math.round((d - today) / 86400000) : null;
            const col = days === null ? "" : days < 0 ? "color:var(--prm-red);font-weight:600" : days <= 30 ? "color:var(--prm-amber);font-weight:600" : "color:var(--prm-green)";
            return `<tr${k.disabled ? ' class="prm-key-row-disabled"' : ""}>
              <td style="font-family:monospace;font-size:11px"><a class="prm-key-link" href="https://staff.3cx.com/key/edit.aspx?i=${encodeURIComponent(k.keyId)}" target="_blank" rel="noopener">${esc(k.key)}</a></td>
              <td>${esc(k.product)}</td>
              <td><span style="background:#e8f5ee;color:#2d9e5f;padding:2px 6px;border-radius:4px;font-size:11px;font-weight:700">${esc(k.sc)}SC</span></td>
              <td style="${col};font-size:11px">${esc(k.expiry)}${days !== null ? ` <span style="color:var(--prm-dim)">(${days < 0 ? `${Math.abs(days)}d late` : `${days}d`})</span>` : ""}</td>
              <td style="font-size:11px;color:var(--prm-m)">${esc(k.registration || "—")}</td>
              <td style="font-size:11px;color:var(--prm-dim)">${esc(k.version)}</td>
            </tr>`;
          }).join("")}</tbody>
        </table></div>
      </div>`;
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

  // ── Action handlers ───────────────────────────────────────────────────────
  async function handleAction(state, action) {
    const p = state.partner;
    if (!p) return;
    const c = state.container;

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
        // Re-compose with fresh notes
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
    // Stash on element so unmount can find it
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
