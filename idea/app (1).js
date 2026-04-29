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

    // Empty hash → reseller dashboard (PRM)
    if (parts.length === 0) return { view: "prm", title: "Reseller dashboard" };

    // Legacy redirect: /home → /actions
    if (parts[0] === "home") {
      location.hash = "#/actions";
      return { view: "actions", title: "Actions" };
    }

    if (parts[0] === "prm") return { view: "prm", title: "Reseller dashboard" };
    if (parts[0] === "actions") return { view: "actions", title: "Actions" };
    if (parts[0] === "pre-call") return { view: "pre-call", title: "Pre-call brief" };
    if (parts[0] === "post-call") return { view: "post-call", title: "Post-call" };
    if (parts[0] === "chat") return { view: "chat", title: "During-call assist" };
    if (parts[0] === "settings") return { view: "settings", title: "Settings" };
    if (parts[0] === "data" && parts[1]) {
      const sub = parts[1];
      const titles = { partners: "Partners", orders: "Orders", keys: "License keys", emails: "Emails" };
      if (!titles[sub]) return { view: "prm", title: "Reseller dashboard" }; // unknown data sub → home
      return { view: "data", sub, title: titles[sub] };
    }
    return { view: "prm", title: "Reseller dashboard" };
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

    // Hide topbar title on the root reseller dashboard — PRM owns its own header
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
    if ((!me || me.needsRefresh) && route.view !== "settings") {
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

  // ── Reseller dashboard (PRM) — root ────────────────────────────────────────
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
          <p class="muted">Open the ONYX Chrome extension on staff.3cx.com and run a refresh to load your resellers.</p>
        </div>`;
      return;
    }
    list.snapshots.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    // Prefer the snapshot tied to the authenticated user; else most-recent
    const target = list.snapshots.find((s) => s.email === me.email) || list.snapshots[0];
    const snapshot = await fetch(`/api/snapshots/${encodeURIComponent(target.slug)}`).then((r) => r.json());
    viewEl.innerHTML = "";
    await window.prmApp.mount(viewEl, { snapshot, seller: currentSeller() });
  }

  // ── Actions — was Home; reseller-aware action queue ────────────────────────
  async function renderActions() {
    const seller = currentSeller();
    if (!seller || !me.hasSnapshot) {
      viewEl.innerHTML = `
        <div class="panel">
          <h2 class="h2">Welcome${me ? `, ${escapeHtml(me.name)}` : ""}</h2>
          <p class="muted">No snapshot loaded yet. Run a refresh from the ONYX Chrome extension on staff.3cx.com to populate your action queue.</p>
        </div>`;
      return;
    }

    // Pull the snapshot to compute action items
    const list = await fetch("/api/snapshots").then((r) => r.json()).catch(() => ({ snapshots: [] }));
    const target = list.snapshots?.find((s) => s.email === me.email) || list.snapshots?.[0];
    if (!target) {
      viewEl.innerHTML = '<div class="panel"><p class="empty">No snapshot available.</p></div>';
      return;
    }
    const snapshot = await fetch(`/api/snapshots/${encodeURIComponent(target.slug)}`).then((r) => r.json());

    const partners = snapshot.partners || [];
    const keys = snapshot.licenseKeys || [];
    const orders = snapshot.orders || [];
    const calls = snapshot.calls || [];
    const today = new Date();

    // Top of mind: keys expiring in next 30 days
    const expiringSoon = keys
      .filter((k) => k.licenseExpires && !k.flags?.licenseExpired)
      .map((k) => {
        const d = parseLicenseDate(k.licenseExpires);
        return { ...k, daysLeft: d ? Math.round((d - today) / 86400000) : null };
      })
      .filter((k) => k.daysLeft !== null && k.daysLeft >= 0 && k.daysLeft <= 30)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    // Already overdue
    const overdue = keys
      .filter((k) => k.licenseExpires && !k.flags?.licenseExpired)
      .map((k) => {
        const d = parseLicenseDate(k.licenseExpires);
        return { ...k, daysLeft: d ? Math.round((d - today) / 86400000) : null };
      })
      .filter((k) => k.daysLeft !== null && k.daysLeft < 0)
      .sort((a, b) => a.daysLeft - b.daysLeft);

    // Stale partners — no calls and no recent notes
    const partnerCallMap = new Map();
    calls.forEach((c) => {
      if (!c.partnerId) return;
      const prev = partnerCallMap.get(c.partnerId);
      if (!prev || (c.date || "") > (prev.date || "")) partnerCallMap.set(c.partnerId, c);
    });
    const stalePartners = partners
      .filter((p) => {
        const last = partnerCallMap.get(p.id);
        if (!last || !last.date) return true;
        const d = parseLicenseDate(last.date);
        return !d || (today - d) / 86400000 > 90;
      })
      .slice(0, 8);

    // Upcoming calls
    const upcomingCalls = calls
      .filter((c) => c.status === "scheduled" || c.status === "planned")
      .sort((a, b) => (a.date || "").localeCompare(b.date || ""))
      .slice(0, 6);

    viewEl.innerHTML = `
      <div class="actions-grid">
        <div class="actions-summary">
          <div class="metric metric--actions">
            <span class="metric-label">Partners</span>
            <span class="metric-value">${partners.length}</span>
          </div>
          <div class="metric metric--actions ${overdue.length ? "metric--alert" : ""}">
            <span class="metric-label">Overdue renewals</span>
            <span class="metric-value">${overdue.length}</span>
          </div>
          <div class="metric metric--actions ${expiringSoon.length ? "metric--warn" : ""}">
            <span class="metric-label">Expiring (30d)</span>
            <span class="metric-value">${expiringSoon.length}</span>
          </div>
          <div class="metric metric--actions">
            <span class="metric-label">Upcoming calls</span>
            <span class="metric-value">${upcomingCalls.length}</span>
          </div>
        </div>

        <section class="card actions-card">
          <h3 class="h3">⚠ Renewal radar</h3>
          ${overdue.length || expiringSoon.length ? `
            <table class="data-table data-table--compact">
              <thead><tr><th>Customer</th><th>Reseller</th><th>Edition</th><th>Expires</th></tr></thead>
              <tbody>
                ${overdue.slice(0, 5).map((k) => `
                  <tr>
                    <td>${escapeHtml(k.company || "—")}</td>
                    <td>${escapeHtml(k.assignedResellerName || "—")}</td>
                    <td>${escapeHtml(k.productEdition)}</td>
                    <td class="cell-danger">${escapeHtml(k.licenseExpires)} <small>(${Math.abs(k.daysLeft)}d overdue)</small></td>
                  </tr>`).join("")}
                ${expiringSoon.slice(0, 5).map((k) => `
                  <tr>
                    <td>${escapeHtml(k.company || "—")}</td>
                    <td>${escapeHtml(k.assignedResellerName || "—")}</td>
                    <td>${escapeHtml(k.productEdition)}</td>
                    <td class="cell-warn">${escapeHtml(k.licenseExpires)} <small>(${k.daysLeft}d)</small></td>
                  </tr>`).join("")}
              </tbody>
            </table>` : '<p class="muted">No renewals due in the next 30 days.</p>'}
        </section>

        <section class="card actions-card">
          <h3 class="h3">📅 Upcoming calls</h3>
          ${upcomingCalls.length ? `
            <table class="data-table data-table--compact">
              <thead><tr><th>Date</th><th>Partner</th><th>Notes</th></tr></thead>
              <tbody>
                ${upcomingCalls.map((c) => {
                  const partner = partners.find((p) => p.id === c.partnerId);
                  return `<tr>
                    <td>${escapeHtml(c.date)}</td>
                    <td>${escapeHtml(partner?.companyName || c.partnerId || "—")}</td>
                    <td class="muted">${escapeHtml(c.notes || "—")}</td>
                  </tr>`;
                }).join("")}
              </tbody>
            </table>
            <p class="card-foot"><a href="#/pre-call">Open a pre-call brief →</a></p>
            ` : '<p class="muted">No scheduled calls.</p>'}
        </section>

        <section class="card actions-card">
          <h3 class="h3">💤 Stale partners (>90 days)</h3>
          ${stalePartners.length ? `
            <ul class="bare-list">
              ${stalePartners.map((p) => `
                <li>
                  <a href="#/?partnerId=${encodeURIComponent(p.id)}">${escapeHtml(p.companyName)}</a>
                  <span class="muted">· ${escapeHtml(p.distributorLevel || "—")} · ${escapeHtml(p.country || "—")}</span>
                </li>`).join("")}
            </ul>` : '<p class="muted">All partners contacted recently.</p>'}
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
          <p class="muted">Open this from a partner row in the Reseller dashboard, or paste a partner ID:</p>
          <form id="precall-form" class="inline-form">
            <input type="text" id="precall-id" placeholder="partner ID (e.g. prt-024)" />
            <button type="submit" class="btn-primary">Generate brief</button>
          </form>
          <p class="muted small"><a href="#/">← Reseller dashboard</a></p>
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
            <div><span class="kv-label">Name</span><span class="kv-value">${escapeHtml(me.name || "—")}</span></div>
            <div><span class="kv-label">Region</span><span class="kv-value">${escapeHtml(me.region || "—")}</span></div>
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
          <h3 class="h3">Reseller dashboard defaults</h3>
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
