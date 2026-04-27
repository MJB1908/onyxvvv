// ============================================================
// ONYX Bridge  |  background.js (service worker)
// ============================================================
// Two arms:
//   (A) ONYX bridge — fetches against the configured ONYX server
//       (host_permission means no CORS hassle from content scripts).
//   (B) staff.3cx.com (ERP) writer — posts the rep's note back into
//       the partner's Notes tab using the user's logged-in cookies.
//
// Message types handled:
//   CHECK_SESSION  → { ok, result: { healthy, sessionInfo } }
//   GET_ONYX_URL   → { ok, url }
//   SET_ONYX_URL   → { ok }
//   MATCH_CALLER   → { ok, result } where result is what /api/match-caller returned
//   POST_NOTE      → { ok, onyx, erp } — dual-write: always tries ONYX,
//                    additionally tries staff.3cx.com (best-effort)
// ============================================================

const ERP_BASE = "https://staff.3cx.com";
const ERP_EDIT_PATH = "/partner/edit.aspx";
const CF_DOMAIN = "staff.3cx.com";
const DEFAULT_ONYX_URL = "http://localhost:3000";

// ── ONYX URL config ──────────────────────────────────────────────────────────

async function getOnyxUrl() {
  const { onyxUrl } = await chrome.storage.local.get("onyxUrl");
  return (onyxUrl || DEFAULT_ONYX_URL).replace(/\/+$/, "");
}

async function setOnyxUrl(value) {
  if (!value) {
    await chrome.storage.local.remove("onyxUrl");
    return;
  }
  new URL(value); // throws on invalid
  await chrome.storage.local.set({ onyxUrl: String(value).replace(/\/+$/, "") });
}

// ── Progress broadcast (popup listens via chrome.runtime.onMessage) ─────────

function broadcast(type, payload) {
  try {
    chrome.runtime.sendMessage({ type, payload });
  } catch {
    /* no listener — ignore */
  }
}

// ── ONYX bridge ──────────────────────────────────────────────────────────────

async function matchCallerOnyx(phone) {
  const base = await getOnyxUrl();
  const url = `${base}/api/match-caller?phone=${encodeURIComponent(phone)}`;
  const r = await fetch(url, { method: "GET" });
  if (!r.ok) throw new Error(`ONYX match-caller ${r.status}`);
  return r.json();
}

async function postNoteOnyx(payload) {
  const base = await getOnyxUrl();
  const r = await fetch(`${base}/api/notes`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `ONYX notes POST ${r.status}`);
  return body;
}

// ── ERP (staff.3cx.com) ──────────────────────────────────────────────────────

async function checkSessionHealth() {
  const get = (name) =>
    new Promise((r) => chrome.cookies.get({ url: `https://${CF_DOMAIN}`, name }, r));
  const [cfAuth, erpAuth, cfApp] = await Promise.all([
    get("CF_Authorization"),
    get(".ERPAUTH"),
    get("CF_AppSession"),
  ]);
  const issues = [];
  let sessionInfo = null;

  if (!(cfAuth || cfApp)) {
    issues.push({ code: "CF_EXPIRED", msg: "Not signed in to staff.3cx.com" });
  } else if (cfAuth) {
    try {
      const parts = cfAuth.value.split(".");
      if (parts.length >= 2) {
        const raw = parts[1].replace(/-/g, "+").replace(/_/g, "/");
        const pad = raw.length % 4 === 0 ? "" : "=".repeat(4 - (raw.length % 4));
        const p = JSON.parse(atob(raw + pad));
        const now = Math.floor(Date.now() / 1000);
        const mins = Math.round(((p.exp ?? 0) - now) / 60);
        if (p.exp && now >= p.exp) {
          issues.push({ code: "CF_EXPIRED", msg: `Session expired ${Math.abs(mins)}min ago` });
        }
        sessionInfo = {
          email: p.email ?? "unknown",
          minsLeft: mins,
          expiresAt: p.exp ? new Date(p.exp * 1000).toLocaleTimeString() : "?",
        };
      }
    } catch {
      sessionInfo = { email: "signed in", minsLeft: 999, expiresAt: "?" };
    }
  }
  if (!erpAuth) issues.push({ code: "APP_EXPIRED", msg: "ERP session expired" });

  return { healthy: issues.length === 0, issues, sessionInfo };
}

function extractFormFields(html) {
  const r = {};
  let m;
  const inputRe = /<input\b([^>]+)>/gi;
  while ((m = inputRe.exec(html)) !== null) {
    const a = m[1];
    const nm = a.match(/\bname="([^"]+)"/i);
    const vm = a.match(/\bvalue="([^"]*)"/i);
    const tm = a.match(/\btype="([^"]+)"/i);
    if (!nm) continue;
    const t = (tm?.[1] ?? "text").toLowerCase();
    if (["submit", "image", "button"].includes(t)) continue;
    if (["checkbox", "radio"].includes(t)) {
      if (/\bchecked\b/i.test(a)) r[nm[1]] = vm ? vm[1] : "on";
      continue;
    }
    r[nm[1]] = vm ? vm[1] : "";
  }
  const selRe = /<select\b([^>]*)>([\s\S]*?)<\/select>/gi;
  while ((m = selRe.exec(html)) !== null) {
    const nm = m[1].match(/\bname="([^"]+)"/i);
    if (!nm) continue;
    const sel =
      m[2].match(/value="([^"]*)"[^>]*selected/i) ||
      m[2].match(/<option\b[^>]*value="([^"]*)"/i);
    if (sel) r[nm[1]] = sel[1];
  }
  const taRe = /<textarea\b[^>]*\bname="([^"]+)"[^>]*>([\s\S]*?)<\/textarea>/gi;
  while ((m = taRe.exec(html)) !== null) r[m[1]] = m[2];
  return r;
}

function parseUpdatePanel(text) {
  const s = {};
  let pos = 0;
  while (pos < text.length) {
    const le = text.indexOf("|", pos);
    if (le === -1) break;
    const len = parseInt(text.substring(pos, le), 10);
    if (isNaN(len)) break;
    const te = text.indexOf("|", le + 1);
    if (te === -1) break;
    const ie = text.indexOf("|", te + 1);
    if (ie === -1) break;
    s[text.substring(te + 1, ie)] = {
      type: text.substring(le + 1, te),
      content: text.substring(ie + 1, ie + 1 + len),
    };
    pos = ie + 1 + len + 1;
  }
  return s;
}

function detectAuthFailure(html) {
  if (html.includes("login.3cx.com") || html.includes("Account/ExternalLogin"))
    return { failed: true, code: "CF_EXPIRED", msg: "Cloudflare session expired" };
  if (html.includes("cf-turnstile"))
    return { failed: true, code: "CF_CHALLENGE", msg: "Cloudflare challenge — open staff.3cx.com" };
  if (html.includes('id="loginForm"'))
    return { failed: true, code: "APP_EXPIRED", msg: "Staff portal session expired" };
  return { failed: false };
}

function htmlDecode(s) {
  return String(s ?? "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#160;/g, " ")
    .replace(/&nbsp;/g, " ")
    .trim();
}

function isDisabledRow(attrStr) {
  const m = (attrStr || "").match(/\bclass="([^"]*)"/i);
  return m ? /\bdisabled\b/.test(m[1]) : false;
}

/**
 * Parse the staff.3cx.com customers.aspx Main_dg datagrid into rows.
 * Restored from the original scraper (commit cb3c0a2). Depth-counts
 * nested tables to find the correct closing tag, skips disabled-class
 * rows, extracts the customer id from the partner edit href, and the
 * full company name from the title attribute.
 */
function parsePartnersFromHtml(html) {
  const tableIdx = html.indexOf('id="Main_dg"');
  if (tableIdx < 0) return [];
  const tableStart = html.lastIndexOf("<table", tableIdx);
  if (tableStart < 0) return [];

  let depth = 0,
    pos = tableStart,
    tableEnd = -1;
  while (pos < html.length) {
    const no = html.indexOf("<table", pos);
    const nc = html.indexOf("</table>", pos);
    if (nc < 0) break;
    if (no >= 0 && no < nc) {
      depth++;
      pos = no + 6;
    } else {
      depth--;
      if (depth === 0) {
        tableEnd = nc + 8;
        break;
      }
      pos = nc + 8;
    }
  }
  const tableHtml = html.substring(
    tableStart,
    tableEnd > 0 ? tableEnd : html.length,
  );

  const rowMatches = [
    ...tableHtml.matchAll(/<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi),
  ];
  if (rowMatches.length < 2) return [];

  const headerCells = [
    ...rowMatches[0][2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
  ].map((m) => htmlDecode(m[1].replace(/<[^>]+>/g, " ")).trim());

  const partners = [];
  for (let i = 1; i < rowMatches.length; i++) {
    if (isDisabledRow(rowMatches[i][1])) continue;
    const cells = [
      ...rowMatches[i][2].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi),
    ].map((m) => m[1]);
    if (cells.length < 3) continue;

    const hrefM = cells[2].match(/\/partner\/edit\.aspx\?i=(\d+)/i);
    if (!hrefM) continue;
    const id = hrefM[1];

    const titleM = cells[2].match(/title="([^"]+)"/);
    const company = titleM
      ? htmlDecode(titleM[1])
      : htmlDecode(cells[2].replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

    const row = { id, company };
    headerCells.forEach((h, idx) => {
      if (!h || idx < 2 || idx >= cells.length) return;
      const val = htmlDecode(cells[idx].replace(/<[^>]+>/g, " "))
        .replace(/\s+/g, " ")
        .trim();
      if (val && val !== " ") row[h] = val;
    });
    if (!row.country && row["Country"]) row.country = row["Country"];
    if (!row.region && row["Sales Region"]) row.region = row["Sales Region"];
    if (!row.cert && row["Cert"]) row.cert = row["Cert"];
    if (!row.category && row["Partner Category"]) row.category = row["Partner Category"];
    if (!row.agent && row["Team Agent"]) row.agent = row["Team Agent"];
    if (!row.revenue && row["Annual Revenue"]) row.revenue = row["Annual Revenue"];

    partners.push(row);
  }
  return partners;
}

async function fetchPartnerList() {
  const html1 = await fetchPage(`${ERP_BASE}/customers.aspx?m=1`);
  const page1 = parsePartnersFromHtml(html1);
  if (!page1.length) {
    throw new Error(`No partner data on customers.aspx (${html1.length} chars)`);
  }
  const totalPages = parseInt(html1.match(/Page 1 of (\d+)/)?.[1] || "1", 10);
  const MAX_PAGES = Math.min(totalPages, 5);
  let all = [...page1];

  if (MAX_PAGES > 1) {
    const fields = extractFormFields(html1);
    let currentFields = { ...fields };
    for (let page = 2; page <= MAX_PAGES; page++) {
      try {
        broadcast(
          "refresh_progress",
          `Loading partners page ${page}/${MAX_PAGES}…`,
        );
        const postFields = {
          ...currentFields,
          __EVENTTARGET: "ctl00$Main$NavigatorControl$NextButton",
          __EVENTARGUMENT: "",
          __ASYNCPOST: "true",
          ctl00$ScriptManager1:
            "ctl00$Main$CustomersUpdatePanel|ctl00$Main$NavigatorControl$NextButton",
        };
        const resp = await fetch(`${ERP_BASE}/customers.aspx?m=1`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
            Accept: "*/*",
            Origin: ERP_BASE,
            "X-MicrosoftAjax": "Delta=true",
            "X-Requested-With": "XMLHttpRequest",
          },
          body: new URLSearchParams(postFields).toString(),
        });
        const text = await resp.text();
        const sections = parseUpdatePanel(text);
        if (sections["__VIEWSTATE"]?.content) {
          currentFields["__VIEWSTATE"] = sections["__VIEWSTATE"].content;
        }
        const combined = Object.values(sections).map((s) => s.content).join("\n");
        const pageData = parsePartnersFromHtml(combined);
        if (!pageData.length) break;
        all = all.concat(pageData);
      } catch (e) {
        console.warn(`Partner list page ${page} failed:`, e.message);
        break;
      }
    }
  }
  return all;
}

async function runFullScrape() {
  const health = await checkSessionHealth();
  if (!health.healthy) {
    const issue = health.issues[0];
    throw Object.assign(new Error(issue.msg), { code: issue.code });
  }
  const repEmail = health.sessionInfo?.email;
  if (!repEmail || repEmail === "unknown") {
    throw new Error("Could not determine rep email from staff.3cx.com session");
  }

  broadcast("refresh_progress", "Fetching partner list…");
  const partners = await fetchPartnerList();

  const onyxBase = await getOnyxUrl();
  broadcast("refresh_progress", `Sending ${partners.length} partners to ONYX…`);
  const r = await fetch(`${onyxBase}/api/ingest/erp`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      repEmail,
      repName: repEmail.split("@")[0],
      partners,
      orders: [],
      licenseKeys: [],
      calls: [],
      notes: [],
    }),
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(body.error || `Ingest failed (${r.status})`);

  await chrome.storage.local.set({
    lastRefreshAt: Date.now(),
    lastRefreshRepEmail: repEmail,
    lastRefreshCounts: body.counts,
  });

  return { repEmail, ...body };
}

async function fetchPage(url) {
  const r = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/html,application/xhtml+xml", Referer: ERP_BASE },
  });
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`);
  const html = await r.text();
  const fail = detectAuthFailure(html);
  if (fail.failed) throw Object.assign(new Error(fail.msg), { code: fail.code });
  return html;
}

async function postPanel(partnerId, formData) {
  const url = `${ERP_BASE}${ERP_EDIT_PATH}?i=${encodeURIComponent(partnerId)}`;
  const r = await fetch(url, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
      Accept: "*/*",
      Origin: ERP_BASE,
      Referer: `${ERP_BASE}/`,
      "X-MicrosoftAjax": "Delta=true",
      "X-Requested-With": "XMLHttpRequest",
    },
    body: new URLSearchParams(formData).toString(),
  });
  if (!r.ok) throw new Error(`POST partner/edit → ${r.status}`);
  return r.text();
}

/**
 * staff.3cx.com note POST — 3-step ASP.NET WebForms UpdatePanel flow:
 *   step 1: btnNotes (open Notes tab)         → captures fresh VIEWSTATE
 *   step 2: AddBtn   (open Add Note dialog)   → captures fresh VIEWSTATE
 *   step 3: OKBtn    (submit subject + body)  → checks for error message panel
 */
async function postCallNoteErp({ partnerId, subject, body, noteType = 2 }) {
  const health = await checkSessionHealth();
  if (!health.healthy) {
    const issue = health.issues[0];
    throw Object.assign(new Error(issue.msg), { code: issue.code });
  }

  broadcast("note_progress", "ERP: opening partner page…");
  const html = await fetchPage(
    `${ERP_BASE}${ERP_EDIT_PATH}?i=${encodeURIComponent(partnerId)}`,
  );
  const fields = extractFormFields(html);

  broadcast("note_progress", "ERP: opening Notes tab…");
  const s1 = {
    ...fields,
    __ASYNCPOST: "true",
    __EVENTTARGET: "ctl00$Main$btnNotes",
    __EVENTARGUMENT: "",
    ctl00$ScriptManager1: "ctl00$Main$CustomerEditUpdatePanel|ctl00$Main$btnNotes",
  };
  delete s1["ctl00$Main$CustomerNotes$AddBtn"];
  delete s1["ctl00$Main$CustomerNotes$OKBtn"];
  const r1 = await postPanel(partnerId, s1);
  const vs1 = parseUpdatePanel(r1)["__VIEWSTATE"]?.content;
  if (!vs1) throw new Error("ERP step 1 (btnNotes) returned no VIEWSTATE");
  fields["__VIEWSTATE"] = vs1;

  broadcast("note_progress", "ERP: opening Add Note…");
  const s2 = {
    ...fields,
    __ASYNCPOST: "true",
    __EVENTTARGET: "",
    "ctl00$Main$CustomerNotes$AddBtn": "Add New Note",
    "ctl00$Main$CustomerNotes$ddlNoteType": String(noteType),
    ctl00$ScriptManager1:
      "ctl00$Main$CustomerNotes$CustomerNotesUpdatePanel|ctl00$Main$CustomerNotes$AddBtn",
  };
  delete s2["ctl00$Main$btnNotes"];
  const r2 = await postPanel(partnerId, s2);
  const vs2 = parseUpdatePanel(r2)["__VIEWSTATE"]?.content;
  if (!vs2) throw new Error("ERP step 2 (AddBtn) returned no VIEWSTATE");
  fields["__VIEWSTATE"] = vs2;

  broadcast("note_progress", "ERP: saving…");
  const s3 = {
    ...fields,
    __ASYNCPOST: "true",
    __EVENTTARGET: "",
    "ctl00$Main$CustomerNotes$OKBtn": "OK",
    "ctl00$Main$CustomerNotes$tbSubject": subject,
    "ctl00$Main$CustomerNotes$tbBody": body,
    "ctl00$Main$CustomerNotes$ddlNoteType": String(noteType),
    ctl00$ScriptManager1:
      "ctl00$Main$CustomerNotes$PopupUpdatePanel|ctl00$Main$CustomerNotes$OKBtn",
  };
  delete s3["ctl00$Main$CustomerNotes$AddBtn"];
  const r3 = await postPanel(partnerId, s3);
  const sects3 = parseUpdatePanel(r3);
  const err = sects3["Main_MessageBoxUpdatePanel"]?.content?.trim() ?? "";
  if (err && err !== "&#160;" && !err.startsWith("<!--")) {
    throw new Error(err.replace(/<[^>]+>/g, " ").trim().substring(0, 200));
  }
  return { partnerId, subject };
}

// ── Dual-write POST_NOTE ─────────────────────────────────────────────────────

async function postNoteDual(payload) {
  const result = { onyx: null, erp: null };

  // Always try ONYX first — it should always work.
  try {
    broadcast("note_progress", "ONYX: saving…");
    const onyx = await postNoteOnyx({ ...payload, source: "extension" });
    result.onyx = { ok: true, note: onyx.note };
  } catch (e) {
    result.onyx = { ok: false, error: e.message };
  }

  // Then try ERP — best-effort. Failure here doesn't fail the whole call.
  try {
    const erp = await postCallNoteErp(payload);
    result.erp = { ok: true, ...erp };
  } catch (e) {
    result.erp = { ok: false, code: e.code || null, error: e.message };
  }

  return result;
}

// ── Message dispatcher ───────────────────────────────────────────────────────

const handlers = {
  CHECK_SESSION: async () => {
    const result = await checkSessionHealth();
    return { ok: true, result };
  },
  GET_ONYX_URL: async () => ({ ok: true, url: await getOnyxUrl() }),
  SET_ONYX_URL: async (msg) => {
    await setOnyxUrl(msg.url);
    return { ok: true };
  },
  MATCH_CALLER: async (msg) => {
    const result = await matchCallerOnyx(msg.phone);
    return { ok: true, result };
  },
  POST_NOTE: async (msg) => {
    const result = await postNoteDual(msg.payload || {});
    return { ok: result.onyx?.ok || result.erp?.ok, ...result };
  },
  REFRESH_DATA: async () => {
    const result = await runFullScrape();
    return { ok: true, result };
  },
  GET_LAST_REFRESH: async () => {
    const stored = await chrome.storage.local.get([
      "lastRefreshAt",
      "lastRefreshRepEmail",
      "lastRefreshCounts",
    ]);
    return { ok: true, ...stored };
  },
};

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  const handler = handlers[msg?.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg))
    .then(sendResponse)
    .catch((e) => sendResponse({ ok: false, error: e?.message || String(e), code: e?.code }));
  return true; // async response
});
