(function () {
  const STORAGE_KEY = "onyx-seller-id";
  const PARTNER_STORAGE_PREFIX = "onyx-home-partner";
  const CHAT_PREFILL_KEY = "onyx-chat-prefill";
  const viewEl = document.getElementById("view");
  const pageTitleEl = document.getElementById("page-title");
  const sellerSelect = document.getElementById("seller-select");
  const partnerSelect = document.getElementById("partner-select");
  const partnerSelectWrap = document.getElementById("partner-select-wrap");

  /** @type {{ id: string, name: string, region: string }[]} */
  let reps = [];

  /** @type {{ role: 'user'|'assistant', content: string }[]} */
  const chatMessages = [];

  let chatRouteActive = false;

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    return d.innerHTML;
  }

  function currentSeller() {
    const id = sellerSelect.value;
    return reps.find((r) => r.id === id) || reps[0] || null;
  }

  function partnerStorageKey(sellerId) {
    return `${PARTNER_STORAGE_PREFIX}:${sellerId || "unknown"}`;
  }

  function setPartnerSelectorVisibility(isHome) {
    if (!partnerSelectWrap || !partnerSelect) return;
    partnerSelectWrap.hidden = !isHome;
    partnerSelect.disabled = !isHome;
  }

  async function loadHomePartnerOptions(seller) {
    if (!partnerSelect || !seller) return;
    const res = await fetch("/api/partners");
    const data = await res.json().catch(() => ({}));
    const allPartners = (data.partners || []).filter((p) => p.accountOwnerName === seller.name);
    partnerSelect.innerHTML =
      `<option value="all">All partners</option>` +
      allPartners
        .map((p) => `<option value="${escapeHtml(p.id)}">${escapeHtml(p.companyName)} (${escapeHtml(p.distributorLevel)})</option>`)
        .join("");
    const saved = localStorage.getItem(partnerStorageKey(seller.id));
    if (saved && (saved === "all" || allPartners.some((p) => p.id === saved))) {
      partnerSelect.value = saved;
    } else {
      partnerSelect.value = "all";
      localStorage.setItem(partnerStorageKey(seller.id), "all");
    }
  }

  function parseRoute() {
    const rawFull = location.hash.replace(/^#/, "").replace(/^\/+/, "") || "home";
    const raw = rawFull.split("?")[0];
    const parts = raw.split("/").filter(Boolean);
    if (parts[0] === "chat") return { view: "chat", title: "During-call assist (AI)" };
    if (parts[0] === "home") return { view: "home", title: "Home" };
    if (parts[0] === "dashboard" && parts[1]) {
      const sub = parts[1];
      const titles = {
        insights: "Partner intelligence",
        "pre-call": "Pre-call brief",
        "post-call": "Post-call workspace",
        "next-caller": "Call queue",
        prospects: "Prospects",
      };
      return { view: "dashboard", sub, title: titles[sub] || "Dashboard" };
    }
    if (parts[0] === "data" && parts[1]) {
      const sub = parts[1];
      const titles = {
        partners: "Partners",
        orders: "Orders",
        keys: "License keys",
        "license-types": "License types",
        emails: "Emails",
        users: "Internal users",
        products: "Products",
      };
      return { view: "data", sub, title: titles[sub] || "Data" };
    }
    return { view: "home", title: "Home" };
  }

  function setNavActive() {
    const r = parseRoute();
    let match = "";
    if (r.view === "home") match = "home";
    else if (r.view === "chat") match = "chat";
    else if (r.view === "dashboard") match = `dashboard/${r.sub}`;
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
    pageTitleEl.textContent = route.title;
    setNavActive();
    setPartnerSelectorVisibility(route.view === "home");

    const seller = currentSeller();
    if (!seller) {
      viewEl.innerHTML = "<p class=\"empty\">Loading sellers…</p>";
      return;
    }

    try {
      if (route.view === "home") await renderHome();
      else if (route.view === "dashboard") await renderDashboard(route.sub, seller);
      else if (route.view === "data") await renderData(route.sub);
      else if (route.view === "chat") renderChatShell();
    } catch (err) {
      viewEl.innerHTML = `<p class="error">${escapeHtml(err.message || "Failed to load.")}</p>`;
    }

    if (route.view === "chat") {
      const input = document.getElementById("input");
      if (input) input.focus();
    }
  }

  async function renderHome() {
    const seller = currentSeller();
    await loadHomePartnerOptions(seller);
    const selectedPartnerId = partnerSelect ? partnerSelect.value : "all";
    const res = await fetch(
      `/api/home-dashboard?seller=${encodeURIComponent(seller.name)}${selectedPartnerId && selectedPartnerId !== "all" ? `&partnerId=${encodeURIComponent(selectedPartnerId)}` : ""}`,
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || "Could not load home dashboard.");

    const account = data.accountHeader || {};
    const installMix = data.installMix || {};
    const kpis = data.kpis || {};
    const deals = data.newDeals || [];
    const ongoing = data.ongoingDeals || [];
    const comms = data.communicationLog || [];
    const renewals = data.renewalRadar || [];
    const nextBestAction = data.nextBestAction || {};
    const scopeLabel = data.scope?.mode === "partner" ? "Partner view" : "Portfolio view";

    const dealsHtml = deals.length
      ? deals
          .map(
            (d) =>
              `<tr><td>${escapeHtml(d.customer)}</td><td>${escapeHtml(d.license)}</td><td>${escapeHtml(d.stage)}</td><td>${escapeHtml(d.close)}</td><td>${escapeHtml(d.owner)}</td><td><span class="home-status home-status--${escapeHtml(String(d.status || "").toLowerCase())}">${escapeHtml(d.status)}</span></td></tr>`,
          )
          .join("")
      : `<tr><td colspan="6">No deals for this view.</td></tr>`;

    const ongoingHtml = ongoing.length
      ? ongoing
          .map(
            (d) =>
              `<tr><td>${escapeHtml(d.customer)}</td><td>${escapeHtml(d.contract)}</td><td><span class="home-pill">${escapeHtml(d.type)}</span></td><td>${escapeHtml(d.stage)}</td><td>${escapeHtml(d.close)}</td><td><span class="home-status home-status--${escapeHtml(String(d.status || "").toLowerCase())}">${escapeHtml(d.status)}</span></td></tr>`,
          )
          .join("")
      : `<tr><td colspan="6">No ongoing deals.</td></tr>`;

    const commsHtml = comms.length
      ? comms
          .map(
            (c) =>
              `<tr><td>${escapeHtml(c.customer)}</td><td>${escapeHtml(c.lastContact)}</td><td>${escapeHtml(c.mood)}</td><td>${escapeHtml(c.nextStep)}</td><td><button class="home-icon-btn" type="button" disabled>→</button></td></tr>`,
          )
          .join("")
      : `<tr><td colspan="5">No communication entries.</td></tr>`;

    const renewalHtml = renewals.length
      ? renewals
          .map(
            (r) =>
              `<tr><td>${escapeHtml(r.customer)}</td><td>${escapeHtml(r.due)}</td><td>${escapeHtml(r.proposal)}</td><td><input type="checkbox" ${r.proposal === "Yes" ? "checked" : ""} disabled /></td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4">No upcoming renewals.</td></tr>`;

    viewEl.innerHTML = `
      <div class="partner-home">
        <section class="home-account card">
          <div>
            <h2 class="home-account-title">${escapeHtml(account.name || seller.name)}</h2>
            <p class="home-account-meta">${escapeHtml(account.level || "Partner")} · ${escapeHtml(account.region || seller.region)} · ${escapeHtml(scopeLabel)}</p>
          </div>
          <div class="home-health">
            <span class="home-health-score">${escapeHtml(String(account.installBase || 0))}</span>
            <span class="home-health-label">${escapeHtml(account.partnerHealth || "Stable")}</span>
          </div>
          <ul class="home-account-badges">
            <li>Open tickets ${escapeHtml(String(account.openTickets || 0))}</li>
            <li>New projects +${escapeHtml(String(account.newProjects || 0))}</li>
            <li>Growth ${escapeHtml(account.growthBadge || "+0%")}</li>
          </ul>
        </section>

        <div class="home-main-grid">
          <section class="card">
            <h3 class="h3">Install mix</h3>
            <div class="home-mix-row"><span>Enterprise</span><div class="home-progress"><div style="width:${Number(installMix.enterprisePct || 0)}%"></div></div><strong>${Number(installMix.enterprisePct || 0)}%</strong></div>
            <div class="home-mix-row"><span>PRO</span><div class="home-progress"><div style="width:${Number(installMix.proPct || 0)}%"></div></div><strong>${Number(installMix.proPct || 0)}%</strong></div>
            <div class="home-mix-row"><span>Basic</span><div class="home-progress"><div style="width:${Number(installMix.basicPct || 0)}%"></div></div><strong>${Number(installMix.basicPct || 0)}%</strong></div>
            <div class="home-kpi-stack">
              <p><span>Install base</span><strong>${escapeHtml(String(kpis.installBase || 0))} ext</strong></p>
              <p><span>Forecast</span><strong>${escapeHtml(String(kpis.forecastLabel || "$0"))}</strong></p>
              <p><span>Renewal rate</span><strong>${escapeHtml(String(kpis.renewalRate || 0))}%</strong></p>
              <p><span>YoY growth</span><strong>+${escapeHtml(String(kpis.yoyGrowth || 0))}%</strong></p>
            </div>
          </section>

          <section class="card home-table-card">
            <h3 class="h3">New deals</h3>
            <div class="table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>License</th><th>Stage</th><th>Close</th><th>Owner</th><th>Status</th></tr></thead><tbody>${dealsHtml}</tbody></table></div>
          </section>

          <section class="card home-table-card">
            <h3 class="h3">Ongoing deals</h3>
            <div class="table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>Contract</th><th>Type</th><th>Stage</th><th>Close</th><th>Status</th></tr></thead><tbody>${ongoingHtml}</tbody></table></div>
          </section>

          <section class="card home-table-card">
            <h3 class="h3">Communication log</h3>
            <div class="table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>Last contact</th><th>Mood</th><th>Next step</th><th>Action</th></tr></thead><tbody>${commsHtml}</tbody></table></div>
          </section>
        </div>

        <div class="home-lower-grid">
          <section class="card">
            <h3 class="h3">Renewal radar</h3>
            <div class="table-wrap"><table class="data-table"><thead><tr><th>Customer</th><th>Due</th><th>Proposal</th><th>Done</th></tr></thead><tbody>${renewalHtml}</tbody></table></div>
          </section>
          <section class="card">
            <h3 class="h3">Next best action</h3>
            <p class="home-nba-title">${escapeHtml(nextBestAction.title || "Schedule follow-up this month")}</p>
            <ul class="home-nba-list">
              ${(nextBestAction.bullets || []).map((b) => `<li>${escapeHtml(b)}</li>`).join("")}
            </ul>
            <div class="home-nba-actions">
              <button type="button" class="btn-secondary" disabled>Schedule</button>
              <button type="button" class="btn-secondary" disabled>Email</button>
              <button type="button" class="btn-secondary" disabled>Note</button>
            </div>
            <p class="muted small">Open opportunities: <strong>$${Number(kpis.openOpportunitiesUsd || 0).toLocaleString("en-US")}</strong></p>
          </section>
        </div>
      </div>
    `;
  }

  async function renderDashboard(sub, seller) {
    if (sub === "insights") {
      const [insRes, alRes] = await Promise.all([
        fetch(`/api/insights?seller=${encodeURIComponent(seller.name)}`),
        fetch(`/api/alerts?seller=${encodeURIComponent(seller.name)}`),
      ]);
      const data = await insRes.json().catch(() => ({}));
      const alData = await alRes.json().catch(() => ({}));
      if (!insRes.ok) throw new Error(data.error || "Could not load insights.");
      const alerts = alData.alerts || [];
      const sf = data.salesForceReality || {};
      const alertHtml = alerts
        .slice(0, 6)
        .map(
          (a) =>
            `<li class="alert-item alert-item--${escapeHtml(a.severity)}"><span class="alert-title">${escapeHtml(a.title)}</span><span class="alert-detail">${escapeHtml(a.detail)}</span></li>`,
        )
        .join("");
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro"><strong>Intelligence at a glance</strong> — one picture for <strong>${escapeHtml(seller.name)}</strong> (${escapeHtml(seller.region)}). Combines ERP signals with call cadence (demo).</p>
          <div class="metric-grid metric-grid--dense">
            <div class="metric"><span class="metric-label">Partners owned</span><span class="metric-value">${data.partnerCount}</span></div>
            <div class="metric"><span class="metric-label">Book revenue (USD)</span><span class="metric-value">$${data.orderTotalUsd.toLocaleString("en-US")}</span></div>
            <div class="metric"><span class="metric-label">Revenue YoY</span><span class="metric-value">${data.revenueYoYPercent >= 0 ? "+" : ""}${data.revenueYoYPercent}%</span></div>
            <div class="metric"><span class="metric-label">Renewals (90d)</span><span class="metric-value">${data.renewalsIn90Days}</span></div>
            <div class="metric"><span class="metric-label">Upgrade signals</span><span class="metric-value">${data.upgradeSignals}</span></div>
            <div class="metric"><span class="metric-label">16+ SC orders</span><span class="metric-value">${data.largeScOrders16Plus}</span></div>
            <div class="metric"><span class="metric-label">Stalled (heuristic)</span><span class="metric-value">${data.stalledPartnerCount}</span></div>
            <div class="metric"><span class="metric-label">Your calls</span><span class="metric-value">${data.callCount}</span></div>
            <div class="metric"><span class="metric-label">Scheduled</span><span class="metric-value">${data.scheduledCalls}</span></div>
            <div class="metric"><span class="metric-label">Pending orders</span><span class="metric-value">${data.openOrdersPending}</span></div>
          </div>
          <div class="intel-split">
            <div>
              <h3 class="h3">Time on communication (benchmark)</h3>
              <div class="pdf-bars pdf-bars--compact">
                <div class="pdf-bar"><span class="pdf-bar-label">Live comms</span><div class="pdf-bar-track"><div class="pdf-bar-fill" style="width:${sf.pctYearlyTimeOnLiveComms || 15}%"></div></div><span class="pdf-bar-pct">${sf.pctYearlyTimeOnLiveComms || 15}%</span></div>
                <div class="pdf-bar"><span class="pdf-bar-label">Pre/post meeting</span><div class="pdf-bar-track"><div class="pdf-bar-fill pdf-bar-fill--2" style="width:${sf.pctYearlyTimePrePostMeeting || 35}%"></div></div><span class="pdf-bar-pct">${sf.pctYearlyTimePrePostMeeting || 35}%</span></div>
              </div>
            </div>
            <div>
              <h3 class="h3">Proactive alerts</h3>
              ${alerts.length ? `<ul class="alert-list">${alertHtml}</ul>` : "<p class=\"muted\">No alerts.</p>"}
            </div>
          </div>
          <p class="muted small panel-foot">Full production vision: bi-directional Odoo/ERP, helpdesk, Meet transcriptions, and live whispers — see roadmap with stakeholders.</p>
        </div>
      `;
      return;
    }

    if (sub === "pre-call") {
      const q = new URLSearchParams(location.hash.includes("?") ? location.hash.split("?")[1] : "");
      const partnerId = q.get("partnerId");
      const res = await fetch(
        `/api/pre-call-brief?seller=${encodeURIComponent(seller.name)}${partnerId ? `&partnerId=${encodeURIComponent(partnerId)}` : ""}`,
      );
      const pack = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(pack.error || "Could not load brief.");
      if (!pack.ok || !pack.brief) {
        viewEl.innerHTML = `
          <div class="panel">
            <p class="panel-intro">Pre-call intelligence needs a partner context.</p>
            <p class="muted">${escapeHtml(pack.message || "Schedule a call in the demo data, or open from Call queue.")}</p>
            <p><a href="#/dashboard/next-caller">Go to Call queue</a></p>
          </div>`;
        return;
      }
      const b = pack.brief;
      const agenda = b.suggestedAgenda.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
      const objections = b.predictedObjections.map((x) => `<li>${escapeHtml(x)}</li>`).join("");
      const lastCalls = (b.lastCalls || [])
        .map(
          (c) =>
            `<tr><td>${escapeHtml(c.date)}</td><td>${escapeHtml(c.status)}</td><td>${escapeHtml(c.durationDisplay || "—")}</td><td>${escapeHtml(c.sentiment || "—")}</td><td>${escapeHtml(c.notes || "—")}</td></tr>`,
        )
        .join("");
      const orders = (b.recentOrders || [])
        .map(
          (o) =>
            `<tr><td>${escapeHtml(o.orderId)}</td><td>${escapeHtml(o.date)}</td><td>${escapeHtml(o.type)}</td><td>$${escapeHtml(String(o.totalUsd))}</td><td>${escapeHtml(o.status)}</td></tr>`,
        )
        .join("");
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro"><strong>AI pre-call brief</strong> — agenda prep, pipeline signals, and last-touch context (demo).</p>
          <div class="brief-header card-highlight">
            <h2>${escapeHtml(b.partner.companyName)}</h2>
            <p class="muted">${escapeHtml(b.partner.id)} · ${escapeHtml(b.partner.salesRegion)} · ${escapeHtml(b.partner.country)} · ${escapeHtml(b.partner.distributorLevel)} · ${escapeHtml(b.partner.contactName)}</p>
            <p>Order book (mock): <strong>$${b.orderBookUsd.toLocaleString("en-US")}</strong> · <a href="${b.dashboardLink}">Partner data</a></p>
            ${b.nextCall ? `<p>Next call: <strong>${escapeHtml(b.nextCall.date)}</strong> — ${escapeHtml(b.nextCall.notes || "")}</p>` : ""}
          </div>
          <div class="brief-grid">
            <section class="card brief-card">
              <h3 class="h3">Revenue &amp; trend</h3>
              <p>${escapeHtml(b.revenueTrendNarrative)}</p>
            </section>
            <section class="card brief-card">
              <h3 class="h3">Suggested agenda</h3>
              <ol class="brief-ol">${agenda}</ol>
            </section>
            <section class="card brief-card">
              <h3 class="h3">Predicted objections</h3>
              <ul class="brief-ul">${objections}</ul>
            </section>
          </div>
          <h3 class="h3">Recent orders (partner)</h3>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Order</th><th>Date</th><th>Type</th><th>Total</th><th>Status</th></tr></thead><tbody>${orders || "<tr><td colspan=\"5\">—</td></tr>"}</tbody></table></div>
          <h3 class="h3">Your last calls with this partner</h3>
          <div class="table-wrap"><table class="data-table"><thead><tr><th>Date</th><th>Status</th><th>Duration</th><th>Sentiment</th><th>Notes</th></tr></thead><tbody>${lastCalls || "<tr><td colspan=\"5\">—</td></tr>"}</tbody></table></div>
        </div>`;
      return;
    }

    if (sub === "post-call") {
      const seller = currentSeller();
      const preFollow = `Summarize my last partner call and draft a concise follow-up email. Seller: ${seller.name}. Include action items and owners.`;
      const preNote = `Produce structured meeting notes from the context we have in the demo CRM for my accounts. Seller: ${seller.name}.`;
      const prePlan = `List next-step action items and a 2-week plan for follow-ups for seller ${seller.name} (demo data).`;
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro"><strong>Post-call workspace</strong> — turn conversations into summaries, drafts, and CRM-ready outcomes. Production: Odoo immersion with bi-directional sync (blueprint).</p>
          <div class="post-grid">
            <section class="card post-card">
              <h3>Call summary &amp; notes</h3>
              <p class="muted">Automatic summary / structured notes from transcript + CRM (when integrated).</p>
              <button type="button" class="btn-secondary post-open-chat" data-prefill="${escapeHtml(preNote)}">Open in AI assistant</button>
            </section>
            <section class="card post-card">
              <h3>Follow-up email draft</h3>
              <p class="muted">Draft ready to edit and send.</p>
              <button type="button" class="btn-secondary post-open-chat" data-prefill="${escapeHtml(preFollow)}">Open in AI assistant</button>
            </section>
            <section class="card post-card">
              <h3>Action plan &amp; reminders</h3>
              <p class="muted">Next steps, calendar hooks, and ERP updates (demo: use chat prompts).</p>
              <button type="button" class="btn-secondary post-open-chat" data-prefill="${escapeHtml(prePlan)}">Open in AI assistant</button>
            </section>
          </div>
          <ul class="muted small checklist">
            <li>Automatic CRM update (bi-directional)</li>
            <li>Calendar events for follow-up meetings</li>
            <li>Alerts to account managers on stalled partners / large SC / PoC</li>
          </ul>
        </div>`;
      viewEl.querySelectorAll(".post-open-chat").forEach((btn) => {
        btn.addEventListener("click", () => {
          sessionStorage.setItem(CHAT_PREFILL_KEY, btn.getAttribute("data-prefill") || "");
          window.location.hash = "#/chat";
        });
      });
      return;
    }

    if (sub === "next-caller") {
      const res = await fetch(`/api/next-caller?seller=${encodeURIComponent(seller.name)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load calls.");
      const next = data.next;
      const queue = data.queue || [];
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro">Upcoming scheduled calls for <strong>${escapeHtml(seller.name)}</strong>. Use <strong>Pre-call brief</strong> for agenda, renewals, and objections before you dial.</p>
          ${
            next
              ? `<div class="next-call card-highlight">
            <h2>Next call</h2>
            <p><strong>${escapeHtml(next.partnerName)}</strong> · ${escapeHtml(next.date)} · ${escapeHtml(next.notes || "")}</p>
            <p class="muted">Call id ${escapeHtml(next.id)} · Partner ${escapeHtml(next.partnerId)}</p>
            <p class="next-actions"><a href="#/dashboard/pre-call?partnerId=${encodeURIComponent(next.partnerId)}">Pre-call brief (this partner)</a> · <a href="#/dashboard/post-call">Post-call workspace</a> · <a href="#/chat">During-call assist</a></p>
          </div>`
              : "<p class=\"muted\">No upcoming scheduled calls for this seller in the demo dataset.</p>"
          }
          <h3 class="h3">Queue</h3>
          <div class="table-wrap">
            <table class="data-table">
              <thead><tr><th>Date</th><th>Partner</th><th>Notes</th></tr></thead>
              <tbody>
                ${queue
                  .map(
                    (c) =>
                      `<tr><td>${escapeHtml(c.date)}</td><td>${escapeHtml(c.partnerName)}</td><td>${escapeHtml(c.notes || "—")}</td></tr>`,
                  )
                  .join("")}
                ${queue.length ? "" : "<tr><td colspan=\"3\">No rows</td></tr>"}
              </tbody>
            </table>
          </div>
        </div>
      `;
      return;
    }

    if (sub === "prospects") {
      const res = await fetch(`/api/prospects?seller=${encodeURIComponent(seller.name)}`);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || "Could not load prospects.");
      const rows = data.prospects || [];
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro">Partners in your region <strong>${escapeHtml(data.region)}</strong> (sample list for outreach prioritization).</p>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>Partner</th><th>Region</th><th>Country</th><th>Level</th><th>Contact</th><th>Account owner</th></tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (p) =>
                      `<tr>
                    <td>${escapeHtml(p.partnerId)} · ${escapeHtml(p.companyName)}</td>
                    <td>${escapeHtml(p.salesRegion)}</td>
                    <td>${escapeHtml(p.country)}</td>
                    <td>${escapeHtml(p.distributorLevel)}</td>
                    <td>${escapeHtml(p.contactName)}</td>
                    <td>${escapeHtml(p.accountOwnerName)}</td>
                  </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
  }

  async function renderData(sub) {
    if (sub === "partners") {
      const res = await fetch("/api/partners");
      const data = await res.json();
      const rows = data.partners || [];
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro">${rows.length} distributors in the demo.</p>
          <div class="table-wrap table-wrap--tall">
            <table class="data-table">
              <thead>
                <tr>
                  <th>ID</th><th>Company</th><th>Region</th><th>Country</th><th>Level</th><th>Owner</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (p) =>
                      `<tr>
                  <td>${escapeHtml(p.id)}</td>
                  <td>${escapeHtml(p.companyName)}</td>
                  <td>${escapeHtml(p.salesRegion)}</td>
                  <td>${escapeHtml(p.country)}</td>
                  <td>${escapeHtml(p.distributorLevel)}</td>
                  <td>${escapeHtml(p.accountOwnerName)}</td>
                </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
      return;
    }

    if (sub === "orders") {
      const res = await fetch("/api/orders");
      const data = await res.json();
      const rows = data.orders || [];
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro">${rows.length} orders.</p>
          <div class="table-wrap table-wrap--tall">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Order</th><th>Date</th><th>Status</th><th>Type</th><th>Reseller</th><th>Customer</th><th>Total</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (o) =>
                      `<tr>
                  <td>${escapeHtml(o.orderId)}</td>
                  <td>${escapeHtml(o.date)}</td>
                  <td>${escapeHtml(o.status)}</td>
                  <td>${escapeHtml(o.type)}</td>
                  <td>${escapeHtml(o.resellerId)}</td>
                  <td>${escapeHtml(o.company)}</td>
                  <td>$${escapeHtml(String(o.totalUsd))}</td>
                </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
      return;
    }

    if (sub === "keys") {
      const res = await fetch("/api/license-keys");
      const data = await res.json();
      const rows = data.licenseKeys || [];
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro">${rows.length} license keys.</p>
          <div class="table-wrap table-wrap--tall">
            <table class="data-table">
              <thead>
                <tr>
                  <th>Key</th><th>Deployed</th><th>Company</th><th>Edition</th><th>SC</th><th>Expires</th><th>Reseller</th><th>Flags</th>
                </tr>
              </thead>
              <tbody>
                ${rows
                  .map((k) => {
                    const flags = [];
                    if (k.flags?.licenseExpired) flags.push("expired");
                    if (k.flags?.notAssignedToReseller) flags.push("unassigned");
                    return `<tr>
                  <td class="mono">${escapeHtml(k.licenseKey)}</td>
                  <td>${escapeHtml(k.deployedAs)}</td>
                  <td>${escapeHtml(k.company)}</td>
                  <td>${escapeHtml(k.productEdition)}</td>
                  <td>${escapeHtml(String(k.primaryLicenseSc))}</td>
                  <td>${escapeHtml(k.licenseExpires)}</td>
                  <td>${escapeHtml(k.assignedResellerName || "—")}</td>
                  <td>${escapeHtml(flags.join(", ") || "—")}</td>
                </tr>`;
                  })
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
      return;
    }

    if (sub === "license-types") {
      const res = await fetch("/api/license-types");
      const data = await res.json();
      const rows = data.types || [];
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro">Primary License SC tiers (2<sup>2</sup>…2<sup>10</sup>) and product editions for the demo.</p>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>2<sup>n</sup></th><th>Primary SC</th><th>Product edition</th></tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (t) =>
                      `<tr>
                  <td>2^${escapeHtml(String(t.power))}</td>
                  <td>${escapeHtml(String(t.primaryLicenseSc))}</td>
                  <td>${escapeHtml(t.productEdition)}</td>
                </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
      return;
    }

    if (sub === "emails") {
      const res = await fetch("/api/emails");
      const data = await res.json();
      const rows = data.emails || [];
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro">${rows.length} messages.</p>
          <div class="table-wrap table-wrap--tall">
            <table class="data-table">
              <thead>
                <tr><th>Date</th><th>Partner</th><th>Subject</th><th>From → To</th><th>Sentiment</th></tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (e) =>
                      `<tr>
                  <td>${escapeHtml(e.date)}</td>
                  <td>${escapeHtml(e.partnerName)}</td>
                  <td>${escapeHtml(e.subject)}</td>
                  <td>${escapeHtml(e.from)} → ${escapeHtml(e.to)}</td>
                  <td>${escapeHtml(e.sentiment)}</td>
                </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
      return;
    }

    if (sub === "users") {
      const res = await fetch("/api/internal-users");
      const data = await res.json();
      const rows = data.internalUsers || [];
      viewEl.innerHTML = `
        <div class="panel">
          <p class="panel-intro">Customer-side assignees (sample).</p>
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>ID</th><th>Name</th><th>Email</th><th>Role</th></tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (u) =>
                      `<tr>
                  <td>${escapeHtml(u.id)}</td>
                  <td>${escapeHtml(u.fullName)}</td>
                  <td>${escapeHtml(u.email)}</td>
                  <td>${escapeHtml(u.role)}</td>
                </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
      return;
    }

    if (sub === "products") {
      const res = await fetch("/api/products");
      const data = await res.json();
      const rows = data.products || [];
      viewEl.innerHTML = `
        <div class="panel">
          <div class="table-wrap">
            <table class="data-table">
              <thead>
                <tr><th>SKU</th><th>Name</th><th>Price USD</th><th>Billing</th><th>Highlights</th></tr>
              </thead>
              <tbody>
                ${rows
                  .map(
                    (p) =>
                      `<tr>
                  <td>${escapeHtml(p.sku)}</td>
                  <td>${escapeHtml(p.name)}</td>
                  <td>${escapeHtml(String(p.priceUsd))}</td>
                  <td>${escapeHtml(p.billing)}</td>
                  <td>${escapeHtml(p.highlights.join("; "))}</td>
                </tr>`,
                  )
                  .join("")}
              </tbody>
            </table>
          </div>
        </div>
      `;
    }
  }

  function renderChatShell() {
    const prefill = sessionStorage.getItem(CHAT_PREFILL_KEY);
    if (prefill) sessionStorage.removeItem(CHAT_PREFILL_KEY);

    viewEl.innerHTML = `
      <div class="panel chat-panel">
        <p class="panel-intro">
          <strong>During-call assist</strong> — Selected seller: <strong id="chat-seller-label"></strong>. Mock CRM context is sent with each message. Production adds live transcription whispers, objection prompts, and next-best-action.
        </p>
        <div class="whisper-hints card">
          <span class="whisper-title">In-call intelligence (target)</span>
          <ul class="whisper-list">
            <li>Objection handling &amp; suggested responses</li>
            <li>Next best action / upsell &amp; cross-sell</li>
            <li>Agenda &amp; time management</li>
            <li>Instant partner performance &amp; product value points</li>
          </ul>
        </div>
        <div id="log" class="log" aria-live="polite"></div>
        <form id="form" class="form">
          <label class="sr-only" for="input">Message</label>
          <textarea id="input" name="message" rows="3" placeholder="Ask about a partner, renewal, competitor comparison, or draft language…" autocomplete="off"></textarea>
          <div class="form-actions">
            <button type="submit" id="send">Send</button>
          </div>
        </form>
        <p id="error" class="error" role="alert" hidden></p>
      </div>
    `;
    const seller = currentSeller();
    const label = document.getElementById("chat-seller-label");
    if (label && seller) label.textContent = `${seller.name} (${seller.region})`;

    const input = document.getElementById("input");
    if (input && prefill) input.value = prefill;

    const logEl = document.getElementById("log");
    logEl.innerHTML = "";
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

    const seller = currentSeller();
    sendBtn.disabled = true;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: chatMessages,
          seller: seller ? { id: seller.id, name: seller.name, region: seller.region } : null,
        }),
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

  async function applyUrlParams() {
    const params = new URLSearchParams(location.search);
    if (![...params.keys()].length) return;

    let targetSeller = null;
    const sellerName = params.get("seller");
    if (sellerName) {
      targetSeller = reps.find(
        (r) => r.name.toLowerCase() === sellerName.toLowerCase(),
      );
    }

    const partnerId = params.get("partnerId");
    if (partnerId && !targetSeller) {
      try {
        const res = await fetch("/api/partners");
        const data = await res.json();
        const partner = (data.partners || []).find((p) => p.id === partnerId);
        if (partner) {
          targetSeller = reps.find((r) => r.name === partner.accountOwnerName);
        }
      } catch {
        /* ignore */
      }
    }

    if (targetSeller) {
      localStorage.setItem(STORAGE_KEY, targetSeller.id);
      if (partnerId) {
        localStorage.setItem(partnerStorageKey(targetSeller.id), partnerId);
      }
    }

    const prefill = params.get("prefill");
    if (prefill) sessionStorage.setItem(CHAT_PREFILL_KEY, prefill);

    const route = params.get("route");
    if (route) {
      location.hash = route.startsWith("#")
        ? route
        : "#/" + route.replace(/^\/+/, "");
    }

    history.replaceState({}, "", location.pathname + location.hash);
  }

  async function init() {
    const res = await fetch("/api/sellers");
    const data = await res.json();
    reps = data.reps || [];
    sellerSelect.innerHTML = reps
      .map(
        (r) =>
          `<option value="${escapeHtml(r.id)}">${escapeHtml(r.name)} — ${escapeHtml(r.region)}</option>`,
      )
      .join("");

    await applyUrlParams();

    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved && reps.some((r) => r.id === saved)) sellerSelect.value = saved;
    else if (reps[0]) {
      sellerSelect.value = reps[0].id;
      localStorage.setItem(STORAGE_KEY, reps[0].id);
    }

    sellerSelect.addEventListener("change", () => {
      localStorage.setItem(STORAGE_KEY, sellerSelect.value);
      render();
    });
    if (partnerSelect) {
      partnerSelect.addEventListener("change", () => {
        const seller = currentSeller();
        if (!seller) return;
        localStorage.setItem(partnerStorageKey(seller.id), partnerSelect.value || "all");
        if (parseRoute().view === "home") render();
      });
    }

    window.addEventListener("hashchange", () => {
      render();
    });

    if (!location.hash || location.hash === "#") {
      location.hash = "#/home";
    }
    await render();
  }

  init();
})();
