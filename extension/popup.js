// ONYX Bridge popup: launcher into ONYX + ERP-aware note posting.

const DEFAULT_ONYX_URL = "http://localhost:3000";

const $ = (id) => document.getElementById(id);

function setStatus(text, cls = "idle", spinner = false) {
  const el = $("status");
  el.className = cls;
  el.innerHTML = spinner ? `<div class="spinner"></div>${escapeHtml(text)}` : escapeHtml(text);
}

function escapeHtml(s) {
  const d = document.createElement("div");
  d.textContent = s == null ? "" : String(s);
  return d.innerHTML;
}

function bgSend(type, extra = {}) {
  return new Promise((resolve) => {
    try {
      chrome.runtime.sendMessage({ type, ...extra }, (r) => {
        if (chrome.runtime.lastError) {
          resolve({ ok: false, error: chrome.runtime.lastError.message });
        } else {
          resolve(r);
        }
      });
    } catch (e) {
      resolve({ ok: false, error: e?.message || String(e) });
    }
  });
}

// ── Open ONYX with deep-link params ──────────────────────────────────────────

function buildOnyxUrl(base, { route, partnerId, prefill, seller } = {}) {
  const url = new URL(base + "/");
  if (seller) url.searchParams.set("seller", seller);
  if (partnerId) url.searchParams.set("partnerId", partnerId);
  if (prefill) url.searchParams.set("prefill", prefill);
  if (route) url.hash = route.startsWith("#") ? route : "#/" + route.replace(/^\/+/, "");
  return url.toString();
}

async function openOnyx(opts) {
  const r = await bgSend("GET_ONYX_URL");
  const base = (r?.url || DEFAULT_ONYX_URL).replace(/\/+$/, "");
  await chrome.tabs.create({ url: buildOnyxUrl(base, opts) });
  window.close();
}

// ── ERP session indicator ────────────────────────────────────────────────────

async function refreshErpStatus() {
  const dot = $("erpDot");
  const text = $("erpText");
  const link = $("erpLogin");
  const r = await Promise.race([
    bgSend("CHECK_SESSION"),
    new Promise((res) => setTimeout(() => res(null), 3000)),
  ]);

  if (!r?.ok) {
    dot.className = "warn";
    text.textContent = "Unknown";
    link.hidden = false;
    return;
  }

  const h = r.result;
  if (h.healthy) {
    dot.className = "ok";
    const email = h.sessionInfo?.email || "signed in";
    const mins = h.sessionInfo?.minsLeft;
    text.textContent =
      mins != null && mins > 0 && mins < 60
        ? `${email} (expires ${mins}m)`
        : email;
    link.hidden = true;
  } else {
    dot.className = "bad";
    text.textContent = h.issues?.[0]?.msg || "Not signed in";
    link.hidden = false;
  }
}

// ── Gmail email extraction ───────────────────────────────────────────────────

async function getActiveGmailTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    currentWindow: true,
    url: "https://mail.google.com/*",
  });
  return tab || null;
}

async function extractEmailFromTab(tab) {
  try {
    return await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_EMAIL" });
  } catch {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
    return chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_EMAIL" });
  }
}

// ── Wire up UI ───────────────────────────────────────────────────────────────

$("btnDash").addEventListener("click", () => openOnyx());

$("btnEmail").addEventListener("click", async () => {
  setStatus("Reading email…", "busy", true);
  const tab = await getActiveGmailTab();
  if (!tab) {
    setStatus("Open a Gmail thread first", "err");
    return;
  }
  const email = await extractEmailFromTab(tab);
  if (!email?.body) {
    setStatus("No email body found on this page", "err");
    return;
  }
  const prefill =
    `Help me draft a reply to this email from ${email.sender || "the sender"}.\n\n` +
    `Subject: ${email.subject}\n\n${email.body}`;
  await openOnyx({ route: "chat", prefill });
});

$("btnSave").addEventListener("click", async () => {
  const value = $("onyxUrl").value.trim();
  const r = await bgSend("SET_ONYX_URL", { url: value });
  if (r?.ok) setStatus(value ? "Saved" : `Reset to default (${DEFAULT_ONYX_URL})`, "ok");
  else setStatus(r?.error || "Save failed", "err");
});

$("btnClr").addEventListener("click", () => {
  $("subj").value = "";
  $("nbody").value = "";
  setStatus("Cleared", "idle");
});

$("pid").addEventListener("input", () => {
  chrome.storage.local.set({ lastPid: $("pid").value.trim() });
});
$("seller").addEventListener("input", () => {
  chrome.storage.local.set({ lastSeller: $("seller").value.trim() });
});
$("ntype").addEventListener("change", () => {
  chrome.storage.local.set({ lastNoteType: $("ntype").value });
});

$("btnPost").addEventListener("click", async () => {
  const partnerId = $("pid").value.trim();
  const subject = $("subj").value.trim();
  const body = $("nbody").value.trim();
  const noteType = parseInt($("ntype").value, 10);
  const seller = $("seller").value.trim() || null;

  if (!partnerId) return setStatus("Partner ID required", "err");
  if (!subject) return setStatus("Subject required", "err");
  if (!body) return setStatus("Body required", "err");

  $("btnPost").disabled = true;
  setStatus("Posting…", "busy", true);

  const r = await bgSend("POST_NOTE", {
    payload: { partnerId, subject, body, noteType, seller },
  });

  $("btnPost").disabled = false;

  if (!r) return setStatus("Background did not respond", "err");

  const onyxOk = r.onyx?.ok;
  const erpOk = r.erp?.ok;
  if (onyxOk && erpOk) {
    setStatus("Posted to ERP + ONYX", "ok");
  } else if (onyxOk) {
    const erpErr = r.erp?.error || "ERP unavailable";
    setStatus(`ONYX ✓  ERP ✗ (${erpErr})`, "warn");
    if (r.erp?.code === "CF_EXPIRED" || r.erp?.code === "APP_EXPIRED") {
      $("erpLogin").hidden = false;
    }
  } else if (erpOk) {
    setStatus(`ERP ✓  ONYX ✗ (${r.onyx?.error || "unknown"})`, "err");
  } else {
    setStatus(`Failed: ONYX ${r.onyx?.error || "?"} | ERP ${r.erp?.error || "?"}`, "err");
  }
});

// Listen for progress updates from background while posting
chrome.runtime.onMessage.addListener((m) => {
  if (m?.type === "note_progress") setStatus(String(m.payload || ""), "busy", true);
});

// ── Init ─────────────────────────────────────────────────────────────────────

(async function init() {
  const stored = await chrome.storage.local.get(["onyxUrl", "lastPid", "lastSeller", "lastNoteType"]);
  $("onyxUrl").value = (stored.onyxUrl || DEFAULT_ONYX_URL).replace(/\/+$/, "");
  if (stored.lastPid) $("pid").value = stored.lastPid;
  if (stored.lastSeller) $("seller").value = stored.lastSeller;
  if (stored.lastNoteType) $("ntype").value = stored.lastNoteType;

  const tab = await getActiveGmailTab();
  if (tab) {
    $("btnEmail").disabled = false;
    $("emailHint").textContent = "";
  }

  refreshErpStatus();
})();
