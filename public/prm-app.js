(function () {
  "use strict";

  const CHAT_PREFILL_KEY = "onyx-chat-prefill";
  const viewEl = document.getElementById("view");
  const pageTitleEl = document.getElementById("page-title");
  const topbarUserEl = document.getElementById("topbar-user");

  /** @type {{ email: string|null, name: string|null, region: string|null, hasSnapshot: boolean, needsRefresh: boolean, partnerCount?: number, snapshotUpdatedAt?: string|null, message?: string } | null} */
  let me = null;

  /** @type {{ role: 'user'|'assistant', content: string }[]} */
  const chatMessages = [];

  let chatRouteActive = false;

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function currentSeller() {
    if (!me || !me.email) return null;
    return { id: me.email, name: me.name, region: me.region };
  }

  // Build fetch headers with X-Onyx-User only if we know who the user is.
  // The server falls back to the latest snapshot's rep if the header is
  // absent, so this is purely additive — safe to call before me is loaded.
  function authHeaders(extra) {
    const h = { ...(extra || {}) };
    if (me?.email) h["X-Onyx-User"] = me.email;
    return h;
  }

  // ── Routing ────────────────────────────────────────────────────────────────
  function parseRoute() {
    const rawFull = location.hash.replace(/^#/, "").replace(/^\/+/, "");
    const raw = rawFull.split("?")[0];
    const parts = raw.split("/").filter(Boolean);

    // Empty hash → reseller overview (PRM)
    if (parts.length === 0) return { view: "prm", title: "Reseller Overview" };

    // Legacy redirect: /home → /actions
    if (parts[0] === "home") {
      location.hash = "#/actions";
      return { view: "actions", title: "Actions" };
    }

    if (parts[0] === "prm") return { view: "prm", title: "Reseller Overview" };
    if (parts[0] === "dashboard") return { view: "dashboard", title: "Dashboard" };
    if (parts[0] === "overview") { location.hash = "#/dashboard"; return { view: "dashboard", title: "Dashboard" }; }
    if (parts[0] === "actions") return { view: "actions", title: "Actions" };
    if (parts[0] === "pre-call") return { view: "pre-call", title: "Pre-call brief" };
    if (parts[0] === "post-call") return { view: "post-call", title: "Post-call" };
    if (parts[0] === "chat") return { view: "chat", title: "During-call assist" };
    if (parts[0] === "settings") return { view: "settings", title: "Settings" };
    if (parts[0] === "data" && parts[1]) {
      const sub = parts[1];
      const titles = { partners: "Partners", orders: "Orders", keys: "License keys", emails: "Emails" };
      if (!titles[sub]) return { view: "prm", title: "Reseller Overview" }; // unknown data sub → home
      return { view: "data", sub, title: titles[sub] };
    }
    return { view: "prm", title: "Reseller Overview" };
  }

  function setNavActive() {
    const r = parseRoute();
    let match = "";
    if (r.view === "prm") match = "prm";
    else if (r.view === "actions") match = "actions";
    else if (r.view === "pre-call") match = "pre-call";
    else if (r.view === "post-call") match = "post-call";
    else if (r.view === "chat") match = "chat";
    else if (r.view === "settings") match = "settings";
    else if (r.view === "data") match = `data/${r.sub}`;

    document.querySelectorAll(".nav-item[data-match]").forEach((el) => {
      const m = el.getAttribute("data-match");
      const on = m === match;
      el.classList.toggle("nav-item--active", on);
      if (on) el.setAttribute("aria-current", "page");
      else el.removeAttribute("aria-current");
    });
  }

  async function render() {
    const route = parseRoute();
    chatRouteActive = route.view === "chat";

    // Hide topbar title on the root reseller overview — PRM owns its own header
    if (route.view === "prm") {
      pageTitleEl.style.visibility = "hidden";
    } else {
      pageTitleEl.style.visibility = "";
      pageTitleEl.textContent = route.title;
    }

    setNavActive();

    // No snapshot loaded yet — no data, nothing to render. The Chrome
    // extension is the way in: it scrapes staff.3cx.com under the user's
    // live session, so running a refresh BOTH loads the data AND identifies
    // the user. Settings is the only route that works with no snapshot
    // (the user can configure API keys before scraping anything).
    // Dashboard and settings work without the needsRefresh check
    if ((!me || me.needsRefresh) && route.view !== "settings" && route.view !== "dashboard") {
      viewEl.innerHTML = `
        <div class="panel">
          <h2 class="h2">No reseller data yet</h2>
          <p>Open the ONYX Chrome extension on <a href="https://staff.3cx.com" target="_blank" rel="noopener">staff.3cx.com</a> and run a refresh. That single action loads your resellers, orders, and license keys — and tells ONYX who you are.</p>
          <p class="muted small">If you're already running the extension and seeing this, check the extension popup for errors (Cloudflare session expired, etc.).</p>
        </div>`;
      return;
    }

    try {
      if (route.view === "prm") await renderPrm();
      else if (route.view === "dashboard") await renderOverview();
      else if (route.view === "actions") await renderActions();
      else if (route.view === "pre-call") await renderPreCall();
      else if (route.view === "post-call") renderPostCall();
      else if (route.view === "chat") renderChatShell();
      else if (route.view === "settings") await renderSettings();
      else if (route.view === "data") await renderData(route.sub);
    } catch (err) {
      console.error(err);
      viewEl.innerHTML = `<div class="panel"><p class="error">${escapeHtml(err.message || "Failed to load.")}</p></div>`;
    }

    if (route.view === "chat") {
      const input = document.getElementById("input");
      if (input) input.focus();
    }
  }

  // ── Reseller Overview (PRM) — root ────────────────────────────────────────
  async function renderPrm() {
    if (!window.prmApp) {
      viewEl.innerHTML = '<div class="panel"><p class="empty">PRM module failed to load — check that prm-app.js is present.</p></div>';
      return;
    }
    const list = await fetch("/api/snapshots").then((r) => r.json()).catch(() => ({ snapshots: [] }));
    if (!list.snapshots?.length) {
      viewEl.innerHTML = `
        <div class="panel">
          <h2 class="h2">No reseller data yet</h2>
          <p>Open the ONYX Chrome extension on <a href="https://staff.3cx.com" target="_blank" rel="noopener">staff.3cx.com</a> and load your partner list. The extension pushes data to this server automatically.</p>
          <p class="muted small">If you've already loaded partners in the extension, wait a few seconds for the push to complete and refresh this page.</p>
        </div>`;
      return;
    }
    list.snapshots.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const target = list.snapshots.find((s) => s.email === me?.email) || list.snapshots[0];
    const snapshot = await fetch(`/api/snapshots/${encodeURIComponent(target.slug)}`).then((r) => r.json());
    viewEl.innerHTML = "";
    // Read partnerId from URL if navigating from Dashboard
    const q = new URLSearchParams(location.hash.includes("?") ? location.hash.split("?")[1] : "");
    const autoPartnerId = q.get("partnerId") || null;
    await window.prmApp.mount(viewEl, { snapshot, seller: currentSeller(), autoPartnerId });
  }

  // ── Dashboard ─────────────────────────────────────────────────────
  async function renderOverview() {
    if (!window.regionalOverview) {
      viewEl.innerHTML = '<div class="panel"><p class="empty">Dashboard module failed to load — check that regional-overview.js is present.</p></div>';
      return;
    }
    // Load snapshot from server
    const list = await fetch("/api/snapshots").then((r) => r.json()).catch(() => ({ snapshots: [] }));
    if (!list.snapshots?.length) {
      viewEl.innerHTML = `
        <div class="panel">
          <h2 class="h2">No reseller data yet</h2>
          <p>Open the ONYX Chrome extension on <a href="https://staff.3cx.com" target="_blank" rel="noopener">staff.3cx.com</a> and load your partner list. The extension pushes data to this server automatically.</p>
        </div>`;
      return;
    }
    list.snapshots.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    const target = list.snapshots.find((s) => s.email === me?.email) || list.snapshots[0];
    const snapshot = await fetch(`/api/snapshots/${encodeURIComponent(target.slug)}`).then((r) => r.json());
    viewEl.innerHTML = "";
    await window.regionalOverview.mount(viewEl, {
      snapshot,
      onPartnerClick: (partnerId) => { location.hash = `#/prm?partnerId=${partnerId}`; },
      onRefresh: () => renderOverview(),
    });
  }

  // ── Actions — "What should I do today?" ─────────────────────────────────────
  async function renderActions() {
    const seller = currentSeller();
    if (!seller || !me.hasSnapshot) {
      viewEl.innerHTML = `
        <div class="panel">
          <h2 class="h2">Daily Actions</h2>
          <p class="muted">Your prioritised sales to-do list — new trial conversions and partners to re-engage. Data comes from the extension's enrichment.</p>
          <p class="muted">No data yet. Open the ONYX extension, click "Get Data", then enrich from the Dashboard.</p>
        </div>`;
      return;
    }

    const list = await fetch("/api/snapshots").then((r) => r.json()).catch(() => ({ snapshots: [] }));
    const target = list.snapshots?.find((s) => s.email === me.email) || list.snapshots?.[0];
    if (!target) {
      viewEl.innerHTML = '<div class="panel"><p class="empty">No snapshot available.</p></div>';
      return;
    }
    const snapshot = await fetch(`/api/snapshots/${encodeURIComponent(target.slug)}`).then((r) => r.json());

    const partners = snapshot.partners || [];
    const details = snapshot.details || {};

    // Build enriched partner list from snapshot.details
    const enriched = partners.map(p => {
      const ks = details[p.id]?.keysSummary || details[p.id] || {};
      return {
        id: p.id,
        company: p.companyName || p.company || "—",
        country: p.country || "",
        level: ks.level || p.distributorLevel || "",
        agent: p.accountOwnerName || p.agent || "",
        trials: ks.trials ?? 0,
        keys: ks.keys ?? ks.commercialKeys ?? 0,
        newActivations: ks.newActivations ?? 0,
        expiringSoon: ks.expiringSoon ?? 0,
        overdue: ks.overdue ?? 0,
        renewalRate: ks.renewalRate ?? null,
        lastContactDaysAgo: ks.lastContactDaysAgo ?? null,
        score: ks.score ?? null,
        enriched: ks.keys !== undefined || ks.commercialKeys !== undefined,
      };
    });

    const enrichedCount = enriched.filter(p => p.enriched).length;

    // ── Trials: partners with open trial keys (new business) ──
    const withTrials = enriched
      .filter(p => p.trials > 0)
      .sort((a, b) => b.trials - a.trials);

    // ── Not contacted: partners with no contact > 30 days ──
    const notContacted = enriched
      .filter(p => p.enriched && (p.lastContactDaysAgo === null || p.lastContactDaysAgo > 30))
      .sort((a, b) => (b.lastContactDaysAgo ?? 999) - (a.lastContactDaysAgo ?? 999));

    // ── KPIs ──
    const totalTrials = enriched.reduce((s, p) => s + p.trials, 0);
    const partnersWithTrials = withTrials.length;
    const notContacted30 = notContacted.length;
    const notContacted60 = enriched.filter(p => p.enriched && (p.lastContactDaysAgo === null || p.lastContactDaysAgo > 60)).length;

    function contactLabel(d) {
      if (d === null) return '<span style="color:var(--error)">Never</span>';
      if (d <= 7) return `<span style="color:#2d9e5f">${d}d ago</span>`;
      if (d <= 30) return `<span style="color:#0077b6">${d}d ago</span>`;
      if (d <= 60) return `<span style="color:#e67e00">${d}d ago</span>`;
      return `<span style="color:var(--error)">${d}d ago</span>`;
    }

    viewEl.innerHTML = `
      <div class="actions-grid" style="display:flex;flex-direction:column;gap:1rem">

        <!-- KPI cards -->
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px">
          <div class="metric metric--actions">
            <span class="metric-label">Open Trials</span>
            <span class="metric-value" style="color:#e67e00">${totalTrials}</span>
          </div>
          <div class="metric metric--actions">
            <span class="metric-label">Partners with Trials</span>
            <span class="metric-value">${partnersWithTrials}</span>
          </div>
          <div class="metric metric--actions ${notContacted30 > 0 ? "metric--warn" : ""}">
            <span class="metric-label">Not contacted (>30d)</span>
            <span class="metric-value">${notContacted30}</span>
          </div>
          <div class="metric metric--actions ${notContacted60 > 0 ? "metric--alert" : ""}">
            <span class="metric-label">Not contacted (>60d)</span>
            <span class="metric-value">${notContacted60}</span>
          </div>
        </div>

        ${enrichedCount === 0 ? `
        <div class="card" style="border-color:#4a3580">
          <p style="color:#c4a8ff;font-size:13px">✦ No enrichment data yet. Open the <a href="#/dashboard">Dashboard</a> and click "Enrich All" to populate this page with real data.</p>
        </div>` : ""}

        <!-- New Trials — convert to paid -->
        <section class="card actions-card">
          <h3 class="h3" style="color:var(--text)">🆕 Open Trials — convert to new business</h3>
          ${withTrials.length ? `
            <table class="data-table data-table--compact">
              <thead><tr><th>Partner</th><th>Country</th><th>Level</th><th>Trials</th><th>Existing Keys</th><th>Agent</th><th></th></tr></thead>
              <tbody>
                ${withTrials.slice(0, 15).map(p => `
                  <tr>
                    <td><a href="#/prm?partnerId=${encodeURIComponent(p.id)}">${escapeHtml(p.company)}</a></td>
                    <td style="color:var(--muted)">${escapeHtml(p.country)}</td>
                    <td>${escapeHtml(p.level || "—")}</td>
                    <td style="font-weight:700;color:#e67e00">${p.trials}</td>
                    <td>${p.keys}</td>
                    <td style="color:var(--muted);font-size:0.85rem">${escapeHtml(p.agent)}</td>
                    <td><a href="#/pre-call?partnerId=${encodeURIComponent(p.id)}" style="font-size:0.8rem;white-space:nowrap">Pre-call →</a></td>
                  </tr>`).join("")}
              </tbody>
            </table>
            ${withTrials.length > 15 ? `<p class="muted" style="margin-top:8px;font-size:12px">${withTrials.length - 15} more partners with trials</p>` : ""}
          ` : '<p class="muted">No open trials detected. Run enrichment from the Dashboard to check.</p>'}
        </section>

        <!-- Not contacted — re-engage -->
        <section class="card actions-card">
          <h3 class="h3" style="color:var(--text)">📞 Re-engage — no contact in 30+ days</h3>
          ${notContacted.length ? `
            <table class="data-table data-table--compact">
              <thead><tr><th>Partner</th><th>Country</th><th>Keys</th><th>Score</th><th>Last Contact</th><th>Agent</th><th></th></tr></thead>
              <tbody>
                ${notContacted.slice(0, 15).map(p => `
                  <tr>
                    <td><a href="#/prm?partnerId=${encodeURIComponent(p.id)}">${escapeHtml(p.company)}</a></td>
                    <td style="color:var(--muted)">${escapeHtml(p.country)}</td>
                    <td>${p.keys}</td>
                    <td>${p.score !== null ? `<span style="color:${p.score >= 70 ? "#2d9e5f" : p.score >= 40 ? "#e67e00" : "var(--error)"};font-weight:600">${p.score}</span>` : "—"}</td>
                    <td>${contactLabel(p.lastContactDaysAgo)}</td>
                    <td style="color:var(--muted);font-size:0.85rem">${escapeHtml(p.agent)}</td>
                    <td><a href="#/pre-call?partnerId=${encodeURIComponent(p.id)}" style="font-size:0.8rem;white-space:nowrap">Pre-call →</a></td>
                  </tr>`).join("")}
              </tbody>
            </table>
            ${notContacted.length > 15 ? `<p class="muted" style="margin-top:8px;font-size:12px">${notContacted.length - 15} more partners not contacted</p>` : ""}
          ` : '<p class="muted">All enriched partners have been contacted within 30 days.</p>'}
        </section>
      </div>`;
  }

  function parseLicenseDate(s) {
    if (!s) return null;
    const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{2,4})/);
    if (m) {
      const yr = m[3].length === 2 ? "20" + m[3] : m[3];
      return new Date(`${yr}-${m[2]}-${m[1]}`);
    }
    const d = new Date(s);
    return isNaN(d) ? null : d;
  }

  // ── Pre-call brief — direct to /api/sales/call-prep ────────────────────────
  async function renderPreCall() {
    const q = new URLSearchParams(location.hash.includes("?") ? location.hash.split("?")[1] : "");
    const partnerId = q.get("partnerId");
    if (!partnerId) {
      viewEl.innerHTML = `
        <div class="panel">
          <h2 class="h2">Pre-call brief</h2>
          <p class="muted">Open this from a partner row in the Reseller Overview, or paste a partner ID:</p>
          <form id="precall-form" class="inline-form">
            <input type="text" id="precall-id" placeholder="partner ID (e.g. prt-024)" />
            <button type="submit" class="btn-primary">Generate brief</button>
          </form>
          <p class="muted small"><a href="#/">← Reseller Overview</a></p>
        </div>`;
      document.getElementById("precall-form").addEventListener("submit", (e) => {
        e.preventDefault();
        const id = document.getElementById("precall-id").value.trim();
        if (id) location.hash = `#/pre-call?partnerId=${encodeURIComponent(id)}`;
      });
      return;
    }

    viewEl.innerHTML = `
      <div class="panel">
        <h2 class="h2">Pre-call brief — ${escapeHtml(partnerId)}</h2>
        <p class="muted" id="brief-status"><span class="spinner-inline"></span>Generating with ${escapeHtml(localStorage.getItem("onyx-ai-provider") || "auto")}…</p>
        <pre class="ai-output" id="brief-output" hidden></pre>
      </div>`;

    try {
      const r = await fetch("/api/sales/call-prep", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ partnerId, seller: me.name }),
      });
      const data = await r.json();
      if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
      document.getElementById("brief-status").innerHTML = `Generated by <strong>${escapeHtml(data.provider)}</strong> · ${escapeHtml(data.model)}`;
      const out = document.getElementById("brief-output");
      out.hidden = false;
      out.textContent = data.text || JSON.stringify(data, null, 2);
    } catch (e) {
      document.getElementById("brief-status").innerHTML = `<span class="error">Failed: ${escapeHtml(e.message)}</span>`;
    }
  }

  // ── Post-call workspace ────────────────────────────────────────────────────
  function renderPostCall() {
    const seller = currentSeller();
    const preFollow = `Summarize my last partner call and draft a concise follow-up email. Seller: ${seller.name}. Include action items and owners.`;
    const preNote = `Produce structured meeting notes from the context we have for my accounts. Seller: ${seller.name}.`;
    const prePlan = `List next-step action items and a 2-week plan for follow-ups for seller ${seller.name}.`;
    viewEl.innerHTML = `
      <div class="panel">
        <p class="panel-intro"><strong>Post-call workspace</strong> — turn conversations into summaries, drafts, and CRM-ready outcomes.</p>
        <div class="post-grid">
          <section class="card post-card">
            <h3>Call summary &amp; notes</h3>
            <p class="muted">Structured summary from your transcript or rough notes.</p>
            <button type="button" class="btn-secondary post-open-chat" data-prefill="${escapeHtml(preNote)}">Open in AI assistant</button>
          </section>
          <section class="card post-card">
            <h3>Follow-up email draft</h3>
            <p class="muted">Draft ready to edit and send.</p>
            <button type="button" class="btn-secondary post-open-chat" data-prefill="${escapeHtml(preFollow)}">Open in AI assistant</button>
          </section>
          <section class="card post-card">
            <h3>Action plan &amp; reminders</h3>
            <p class="muted">Next steps and a 2-week plan.</p>
            <button type="button" class="btn-secondary post-open-chat" data-prefill="${escapeHtml(prePlan)}">Open in AI assistant</button>
          </section>
        </div>
      </div>`;
    viewEl.querySelectorAll(".post-open-chat").forEach((btn) => {
      btn.addEventListener("click", () => {
        sessionStorage.setItem(CHAT_PREFILL_KEY, btn.getAttribute("data-prefill") || "");
        location.hash = "#/chat";
      });
    });
  }

  // ── Chat ────────────────────────────────────────────────────────────────────
  function renderChatShell() {
    const prefill = sessionStorage.getItem(CHAT_PREFILL_KEY);
    if (prefill) sessionStorage.removeItem(CHAT_PREFILL_KEY);
    viewEl.innerHTML = `
      <div class="panel chat-panel">
        <p class="panel-intro"><strong>During-call assist</strong> — Selected seller: <strong>${escapeHtml(me.name)}</strong>${me.region ? ` (${escapeHtml(me.region)})` : ""}. Snapshot context is sent with each message.</p>
        <div id="log" class="log" aria-live="polite"></div>
        <form id="form" class="form">
          <label class="sr-only" for="input">Message</label>
          <textarea id="input" name="message" rows="3" placeholder="Ask about a partner, renewal, competitor comparison, or draft language…" autocomplete="off"></textarea>
          <div class="form-actions">
            <button type="submit" id="send">Send</button>
          </div>
        </form>
        <p id="error" class="error" role="alert" hidden></p>
      </div>`;

    const input = document.getElementById("input");
    if (input && prefill) input.value = prefill;
    const logEl = document.getElementById("log");
    chatMessages.forEach((m) => appendMessageNode(logEl, m.role, m.content));
  }

  function appendMessageNode(logEl, role, content) {
    const wrap = document.createElement("div");
    wrap.className = "msg " + role;
    const roleEl = document.createElement("div");
    roleEl.className = "msg-role";
    roleEl.textContent = role === "user" ? "You" : "Assistant";
    const body = document.createElement("div");
    body.className = "msg-body";
    body.textContent = content;
    wrap.appendChild(roleEl);
    wrap.appendChild(body);
    logEl.appendChild(wrap);
    logEl.scrollTop = logEl.scrollHeight;
  }

  document.addEventListener("submit", async (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement) || form.id !== "form") return;
    e.preventDefault();
    if (!chatRouteActive) return;

    const input = document.getElementById("input");
    const sendBtn = document.getElementById("send");
    const errorEl = document.getElementById("error");
    const logEl = document.getElementById("log");
    if (!input || !sendBtn || !logEl) return;

    const text = input.value.trim();
    if (!text) return;

    const showError = (t) => {
      if (errorEl) {
        errorEl.hidden = !t;
        errorEl.textContent = t || "";
      }
    };
    showError("");
    input.value = "";
    chatMessages.push({ role: "user", content: text });
    appendMessageNode(logEl, "user", text);

    sendBtn.disabled = true;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ messages: chatMessages }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || res.statusText || "Request failed");
      const reply = data.reply;
      if (typeof reply !== "string") throw new Error("Invalid response.");
      chatMessages.push({ role: "assistant", content: reply });
      appendMessageNode(logEl, "assistant", reply);
    } catch (err) {
      showError(err.message || "Something went wrong.");
      chatMessages.pop();
    } finally {
      sendBtn.disabled = false;
      input.focus();
    }
  });

  // ── Settings ────────────────────────────────────────────────────────────────
  async function renderSettings() {
    const s = await fetch("/api/settings").then((r) => r.json());
    const settings = s.settings;
    const secrets = s.secrets;
    const masterReady = s.masterKeyAvailable;
    const models = s.availableModels;

    function radioCard(value, label, sub, checked) {
      return `
        <label class="radio-card ${checked ? "radio-card--active" : ""}">
          <input type="radio" name="ai-pref" value="${value}" ${checked ? "checked" : ""}>
          <div class="radio-card-label">${escapeHtml(label)}</div>
          <div class="radio-card-sub">${escapeHtml(sub)}</div>
        </label>`;
    }

    function secretRow(provider, label) {
      const st = secrets[provider];
      const isStore = st.source === "store";
      const isEnv = st.source === "env";
      const statusPill = st.source === "none"
        ? `<span class="pill pill--muted">Not configured</span>`
        : isEnv
        ? `<span class="pill pill--ok">Configured via env · …${escapeHtml(st.last4)}</span>`
        : `<span class="pill pill--ok">Configured via UI · …${escapeHtml(st.last4)}</span>`;
      return `
        <div class="secret-row">
          <div>
            <div class="secret-label">${escapeHtml(label)}</div>
            <div class="secret-status">${statusPill}<code class="muted small">${escapeHtml(st.envVar)}</code></div>
          </div>
          <div class="secret-actions">
            <button type="button" class="btn-secondary" data-secret-edit="${provider}" ${!masterReady && !isEnv ? "disabled title='ONYX_SECRET_KEY is not set'" : ""}>${isStore || isEnv ? "Replace" : "Set"}</button>
            ${isStore ? `<button type="button" class="btn-link" data-secret-remove="${provider}">Remove</button>` : ""}
          </div>
        </div>
        <div class="secret-edit" data-secret-form="${provider}" hidden>
          <input type="password" data-secret-input="${provider}" placeholder="${provider === "anthropic" ? "sk-ant-..." : "sk-..."}" autocomplete="off" />
          <button type="button" class="btn-primary" data-secret-save="${provider}">Save &amp; validate</button>
          <button type="button" class="btn-link" data-secret-cancel="${provider}">Cancel</button>
          <span class="secret-msg" data-secret-msg="${provider}"></span>
        </div>`;
    }

    viewEl.innerHTML = `
      <div class="settings-page">
        <section class="card">
          <h3 class="h3">Account</h3>
          ${me?.email ? `
          <div class="kv-grid">
            <div><span class="kv-label">Email</span><span class="kv-value">${escapeHtml(me.email)}</span></div>
            <div><span class="kv-label">Snapshot</span><span class="kv-value">${me.hasSnapshot ? `${me.partnerCount} partners · ${escapeHtml(me.snapshotUpdatedAt || "")}` : "<em>none</em>"}</span></div>
          </div>` : `
          <p class="muted">No account detected yet. Run an ERP refresh from the Chrome extension to populate this — your reseller email becomes your ONYX identity automatically.</p>`}
        </section>

        <section class="card">
          <h3 class="h3">AI provider preference</h3>
          <p class="muted small">Used when the request doesn't specify one. Validated against keys actually configured.</p>
          <div class="radio-group" id="ai-pref-group">
            ${radioCard("auto", "Auto", "Pick whichever is configured", settings.aiProviderPreference === "auto")}
            ${radioCard("anthropic", "Claude", "Anthropic — recommended for analysis", settings.aiProviderPreference === "anthropic")}
            ${radioCard("openai", "ChatGPT", "OpenAI — broader knowledge cutoff", settings.aiProviderPreference === "openai")}
          </div>
          <p id="ai-pref-status" class="muted small"></p>
        </section>

        <section class="card">
          <h3 class="h3">API keys</h3>
          <p class="muted small">Keys set here override <code>process.env</code>. Stored encrypted with AES-256-GCM, key derived from <code>ONYX_SECRET_KEY</code>. ${masterReady ? "" : '<strong class="error">ONYX_SECRET_KEY is not set — UI saves disabled.</strong>'}</p>
          ${secretRow("anthropic", "Anthropic (Claude)")}
          ${secretRow("openai", "OpenAI (ChatGPT)")}
        </section>

        <section class="card">
          <h3 class="h3">Default models</h3>
          <div class="form-row">
            <label class="form-label">Anthropic</label>
            <select id="anthropic-model">
              ${models.anthropic.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === settings.anthropicModel ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}
            </select>
          </div>
          <div class="form-row">
            <label class="form-label">OpenAI</label>
            <select id="openai-model">
              ${models.openai.map((m) => `<option value="${escapeHtml(m.id)}" ${m.id === settings.openaiModel ? "selected" : ""}>${escapeHtml(m.name)}</option>`).join("")}
            </select>
          </div>
          <p id="model-status" class="muted small"></p>
        </section>

        <section class="card">
          <h3 class="h3">Reseller overview defaults</h3>
          <div class="form-row">
            <label class="form-label">Default tier filter</label>
            <select id="prm-default-tier">
              ${["all", "Titanium", "Platinum", "Gold", "Silver", "Bronze", "Affiliate", "Academy"]
                .map((t) => `<option value="${t}" ${t === settings.prmDefaultTier ? "selected" : ""}>${t === "all" ? "All tiers" : t}</option>`).join("")}
            </select>
          </div>
          <p id="prm-status" class="muted small"></p>
        </section>

        <section class="card card--muted">
          <h3 class="h3">About</h3>
          <p class="muted small">ONYX — AI Sales Force Assistant</p>
          <p class="muted small"><a href="/health" target="_blank">/health</a></p>
        </section>
      </div>`;

    // Wire AI preference
    document.getElementById("ai-pref-group").addEventListener("change", async (e) => {
      const v = e.target.value;
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ aiProviderPreference: v }),
      });
      const status = document.getElementById("ai-pref-status");
      status.textContent = r.ok ? "✓ Saved" : "✗ Save failed";
      document.querySelectorAll(".radio-card").forEach((el) => el.classList.toggle("radio-card--active", el.querySelector("input").checked));
    });

    // Wire model selectors
    ["anthropic-model", "openai-model"].forEach((id) => {
      const provider = id.split("-")[0];
      document.getElementById(id).addEventListener("change", async (e) => {
        const r = await fetch("/api/settings", {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ [`${provider}Model`]: e.target.value }),
        });
        const status = document.getElementById("model-status");
        status.textContent = r.ok ? `✓ ${provider} model saved` : "✗ Save failed";
      });
    });

    // Wire PRM tier
    document.getElementById("prm-default-tier").addEventListener("change", async (e) => {
      const r = await fetch("/api/settings", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ prmDefaultTier: e.target.value }),
      });
      const status = document.getElementById("prm-status");
      status.textContent = r.ok ? "✓ Saved" : "✗ Save failed";
    });

    // Wire secret rows
    viewEl.querySelectorAll("[data-secret-edit]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.getAttribute("data-secret-edit");
        document.querySelector(`[data-secret-form="${p}"]`).hidden = false;
        document.querySelector(`[data-secret-input="${p}"]`).focus();
      });
    });
    viewEl.querySelectorAll("[data-secret-cancel]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.getAttribute("data-secret-cancel");
        document.querySelector(`[data-secret-form="${p}"]`).hidden = true;
        document.querySelector(`[data-secret-input="${p}"]`).value = "";
        document.querySelector(`[data-secret-msg="${p}"]`).textContent = "";
      });
    });
    viewEl.querySelectorAll("[data-secret-save]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const p = btn.getAttribute("data-secret-save");
        const inp = document.querySelector(`[data-secret-input="${p}"]`);
        const msg = document.querySelector(`[data-secret-msg="${p}"]`);
        if (!inp.value) { msg.textContent = "Empty"; return; }
        msg.innerHTML = '<span class="spinner-inline"></span>Validating…';
        try {
          const r = await fetch(`/api/secrets/${p}`, {
            method: "PUT",
            headers: authHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ apiKey: inp.value }),
          });
          const d = await r.json();
          if (!r.ok) throw new Error(d.error || "Save failed");
          msg.innerHTML = '<span style="color:var(--ok)">✓ Validated &amp; saved</span>';
          setTimeout(() => renderSettings(), 800);
        } catch (e) {
          msg.innerHTML = `<span class="error">${escapeHtml(e.message)}</span>`;
        }
      });
    });
    viewEl.querySelectorAll("[data-secret-remove]").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const p = btn.getAttribute("data-secret-remove");
        if (!confirm(`Remove ${p} key from ONYX? (Env var, if set, will still apply.)`)) return;
        await fetch(`/api/secrets/${p}`, { method: "DELETE", headers: authHeaders() });
        renderSettings();
      });
    });
  }

  // ── Data tables ────────────────────────────────────────────────────────────
  async function renderData(sub) {
    const config = {
      partners: { url: "/api/partners", key: "partners", cols: [
        { h: "ID", v: (p) => p.id },
        { h: "Company", v: (p) => p.companyName },
        { h: "Region", v: (p) => p.salesRegion },
        { h: "Country", v: (p) => p.country },
        { h: "Level", v: (p) => p.distributorLevel },
        { h: "Owner", v: (p) => p.accountOwnerName },
      ]},
      orders: { url: "/api/orders", key: "orders", cols: [
        { h: "Order", v: (o) => o.orderId },
        { h: "Date", v: (o) => o.date },
        { h: "Status", v: (o) => o.status },
        { h: "Type", v: (o) => o.type },
        { h: "Reseller", v: (o) => o.resellerId },
        { h: "Customer", v: (o) => o.company },
        { h: "Total", v: (o) => `$${o.totalUsd}` },
      ]},
      keys: { url: "/api/license-keys", key: "licenseKeys", cols: [
        { h: "Key", v: (k) => k.licenseKey, cls: "mono" },
        { h: "Customer", v: (k) => k.company },
        { h: "Edition", v: (k) => k.productEdition },
        { h: "SC", v: (k) => String(k.primaryLicenseSc) },
        { h: "Expires", v: (k) => k.licenseExpires },
        { h: "Reseller", v: (k) => k.assignedResellerName || "—" },
      ]},
      emails: { url: "/api/emails", key: "emails", cols: [
        { h: "Date", v: (e) => e.date },
        { h: "Partner", v: (e) => e.partnerName },
        { h: "Subject", v: (e) => e.subject },
        { h: "Sentiment", v: (e) => e.sentiment },
      ]},
    }[sub];

    if (!config) {
      viewEl.innerHTML = '<div class="panel"><p class="empty">Unknown data view.</p></div>';
      return;
    }

    const data = await fetch(config.url).then((r) => r.json());
    const rows = data[config.key] || [];

    viewEl.innerHTML = `
      <div class="panel">
        <p class="panel-intro">${rows.length} rows</p>
        <div class="table-wrap table-wrap--tall">
          <table class="data-table">
            <thead><tr>${config.cols.map((c) => `<th>${escapeHtml(c.h)}</th>`).join("")}</tr></thead>
            <tbody>
              ${rows.map((r) => `<tr>${config.cols.map((c) => `<td class="${c.cls || ""}">${escapeHtml(c.v(r) ?? "")}</td>`).join("")}</tr>`).join("")}
            </tbody>
          </table>
        </div>
      </div>`;
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  async function init() {
    try {
      const r = await fetch("/api/me");
      // /api/me always returns 200 in the snapshot-aware model — even with no
      // snapshot it returns { needsRefresh: true } so we can render a sensible
      // empty state.
      if (r.ok) {
        me = await r.json();
        if (topbarUserEl) {
          topbarUserEl.textContent = me?.name
            ? me.name + (me.region ? ` · ${me.region}` : "")
            : "";
        }
      }
    } catch (e) {
      console.warn("/api/me failed:", e);
    }

    window.addEventListener("hashchange", render);
    await render();
  }

  init();
})();
