// ONYX Bridge popup: launch the ONYX dashboard with optional context.

const DEFAULT_ONYX_URL = "http://localhost:3000";

const $ = (id) => document.getElementById(id);

function setStatus(text, cls = "idle") {
  const el = $("status");
  el.textContent = text;
  el.className = cls;
}

async function getOnyxUrl() {
  const { onyxUrl } = await chrome.storage.local.get("onyxUrl");
  return (onyxUrl || DEFAULT_ONYX_URL).replace(/\/+$/, "");
}

function buildOnyxUrl(base, { route, partnerId, prefill, seller } = {}) {
  const url = new URL(base + "/");
  if (seller) url.searchParams.set("seller", seller);
  if (partnerId) url.searchParams.set("partnerId", partnerId);
  if (prefill) url.searchParams.set("prefill", prefill);
  if (route) url.hash = route.startsWith("#") ? route : "#/" + route.replace(/^\/+/, "");
  return url.toString();
}

async function openOnyx(opts) {
  const base = await getOnyxUrl();
  await chrome.tabs.create({ url: buildOnyxUrl(base, opts) });
  window.close();
}

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

$("btnDash").addEventListener("click", () => openOnyx());

$("btnEmail").addEventListener("click", async () => {
  setStatus("Reading email…", "idle");
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
  if (!value) {
    await chrome.storage.local.remove("onyxUrl");
    setStatus(`Reset to default (${DEFAULT_ONYX_URL})`, "ok");
    return;
  }
  try {
    new URL(value);
  } catch {
    setStatus("Invalid URL", "err");
    return;
  }
  await chrome.storage.local.set({ onyxUrl: value.replace(/\/+$/, "") });
  setStatus("Saved", "ok");
});

(async function init() {
  const base = await getOnyxUrl();
  $("onyxUrl").value = base;

  const tab = await getActiveGmailTab();
  const btn = $("btnEmail");
  const hint = $("emailHint");
  if (tab) {
    btn.disabled = false;
    hint.textContent = "";
  }
})();
