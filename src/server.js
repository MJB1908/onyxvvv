"use strict";

const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { chatCompletion, partnerInsight } = require("./openaiClient");
const snapshotStore = require("./snapshotStore");
const settingsStore = require("./settingsStore");
const secretsStore = require("./secretsStore");
const erpDataAdapter = require("./erpDataAdapter");
const salesRoutes = require("./salesRoutes");
const aiProvider = require("./aiProvider");

// In-memory notes store (local to this server instance)
const notes = [];
let nextNoteId = 1;

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 8000;

const app = express();
app.disable("x-powered-by");
// Body limit 8mb — Real reseller portfolios can ship 2,000+ partner records
// in one ingest payload (around 2MB). 256kb was the old default for the
// mock-data prototype. Header still kept tight so we don't accept absurd
// uploads, but enough room for a full DACH region scrape with margin.
app.use(express.json({ limit: "8mb" }));

/**
 * Find the most recent snapshot for a seller name, or fall back to the most
 * recent snapshot when no name is given. Used by /api/sales/* and /api/chat.
 */
function findSnapshot(sellerName) {
  const snapshots = snapshotStore.listSnapshots();
  if (!snapshots.length) return null;
  snapshots.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  if (!sellerName) return snapshotStore.loadSnapshotBySlug(snapshots[0].slug);
  for (const s of snapshots) {
    if (s.name === sellerName) return snapshotStore.loadSnapshotBySlug(s.slug);
  }
  return snapshotStore.loadSnapshotBySlug(snapshots[0].slug);
}

/**
 * Resolve the authenticated user.
 *
 * Lookup order (most explicit wins):
 *   1. X-Onyx-User header — for production setups where a reverse proxy
 *      (Cloudflare Access, Caddy forward_auth, or any auth proxy) injects the
 *      user's email after validating their session.
 *   2. ONYX_DEV_USER env var — for explicit dev overrides.
 *   3. Most recent snapshot's rep email — the "ERP already told us who you are"
 *      signal. The Chrome extension scrapes staff.3cx.com using your live
 *      session cookies, so the rep email it pushes IS authenticated by 3CX.
 *      For a single-tenant deploy (you talk to your own ONYX, you scrape your
 *      own data) this is sufficient.
 *
 * The only case where this returns null is when no snapshot exists yet — i.e.
 * a brand-new install where you haven't run the extension refresh. The UI then
 * shows the "no data, run a refresh" empty state, which is the right message.
 */
function authUser(req) {
  const fromHeader = req.get("X-Onyx-User");
  if (fromHeader) return fromHeader;
  if (process.env.ONYX_DEV_USER) return process.env.ONYX_DEV_USER;
  const snapshots = snapshotStore.listSnapshots();
  if (!snapshots.length) return null;
  snapshots.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  return snapshots[0].email || null;
}

const ALLOWED_ORIGINS = new Set([
  "https://team.3cx.com",
  "https://staff.3cx.com",
  "https://mail.google.com",
]);
app.use("/api", (req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (ALLOWED_ORIGINS.has(origin) || origin.startsWith("chrome-extension://"))) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Onyx-User");
    res.setHeader("Access-Control-Max-Age", "600");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests, try again shortly." },
});

// ── Health & Identity ────────────────────────────────────────────────────────
app.get("/health", (_req, res) => res.json({ ok: true }));

/**
 * GET /api/me
 *
 * Returns the authenticated user. Three states:
 *
 *   200 OK + { hasSnapshot: true, ... }
 *     Normal case. Auto-detected from the latest snapshot's rep email
 *     (or from X-Onyx-User / ONYX_DEV_USER if set).
 *
 *   200 OK + { hasSnapshot: false, needsRefresh: true, email: null }
 *     No snapshot yet. The user needs to run an ERP refresh from the
 *     Chrome extension — that single action authenticates them AND
 *     populates ONYX in one step.
 *
 *   401 Unauthorized
 *     Reserved for future production setups where a reverse proxy is
 *     expected to inject X-Onyx-User but didn't. Today, with the
 *     snapshot-based fallback, this only fires if explicitly configured.
 */
app.get("/api/me", (req, res) => {
  const email = authUser(req);

  if (!email) {
    // No header, no env, no snapshot — first run. Be helpful, not 401.
    return res.json({
      email: null,
      name: null,
      region: null,
      hasSnapshot: false,
      needsRefresh: true,
      message:
        "No reseller data loaded yet. Open the ONYX Chrome extension on staff.3cx.com and run a refresh — that loads your data and signs you in.",
    });
  }

  const snap = snapshotStore.loadSnapshot(email);
  res.json({
    email,
    name: snap?.rep?.name || email.split("@")[0],
    region: snap?.rep?.region || null,
    hasSnapshot: !!snap,
    needsRefresh: !snap,
    snapshotUpdatedAt: snap?.updatedAt || null,
    partnerCount: Array.isArray(snap?.partners) ? snap.partners.length : 0,
  });
});

// ── Settings ─────────────────────────────────────────────────────────────────
app.get("/api/settings", (_req, res) => {
  res.json({
    settings: settingsStore.loadSettings(),
    availableModels: aiProvider.AVAILABLE_MODELS,
    providers: aiProvider.availableProviders(),
    secrets: secretsStore.status(),
    masterKeyAvailable: secretsStore.masterKeyAvailable(),
  });
});

app.post("/api/settings", (req, res) => {
  try {
    const updated = settingsStore.saveSettings(req.body || {});
    res.json({ ok: true, settings: updated });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// ── Secrets (UI-set API keys) ────────────────────────────────────────────────
app.put("/api/secrets/:provider", async (req, res) => {
  try {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!["anthropic", "openai"].includes(provider)) {
      return res.status(400).json({ error: "provider must be 'anthropic' or 'openai'" });
    }
    if (!secretsStore.masterKeyAvailable()) {
      return res.status(503).json({
        error:
          "ONYX_SECRET_KEY env var not set. API keys cannot be persisted without it. " +
          "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"",
      });
    }
    const apiKey = (req.body || {}).apiKey;
    if (!apiKey || typeof apiKey !== "string") {
      return res.status(400).json({ error: "apiKey is required" });
    }
    try {
      await aiProvider.validateApiKey(provider, apiKey);
    } catch (e) {
      return res.status(400).json({ error: `Key validation failed: ${e.message}` });
    }
    const result = secretsStore.setSecret(provider + "ApiKey", apiKey);
    res.json({ ok: true, ...result, status: secretsStore.status()[provider] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete("/api/secrets/:provider", (req, res) => {
  try {
    const provider = String(req.params.provider || "").toLowerCase();
    if (!["anthropic", "openai"].includes(provider)) {
      return res.status(400).json({ error: "provider must be 'anthropic' or 'openai'" });
    }
    const result = secretsStore.removeSecret(provider + "ApiKey");
    res.json({ ok: true, ...result, status: secretsStore.status()[provider] });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ── Data endpoints (kept) ────────────────────────────────────────────────────
app.get("/api/partners", (_req, res) => {
  const snapshot = findSnapshot("");
  res.json({ partners: snapshot ? snapshot.partners || [] : [] });
});
app.get("/api/orders", (_req, res) => {
  const snapshot = findSnapshot("");
  res.json({ orders: snapshot ? snapshot.orders || [] : [] });
});
app.get("/api/license-keys", (_req, res) => {
  const snapshot = findSnapshot("");
  res.json({ licenseKeys: snapshot ? snapshot.licenseKeys || [] : [] });
});
app.get("/api/calls", (_req, res) => {
  const snapshot = findSnapshot("");
  res.json({ calls: snapshot ? snapshot.calls || [] : [] });
});
app.get("/api/emails", (_req, res) => {
  const snapshot = findSnapshot("");
  res.json({ emails: snapshot ? snapshot.emails || [] : [] });
});

// ── Caller / phone match ─────────────────────────────────────────────────────
app.get("/api/match-caller", (req, res) => {
  const phone = req.query.phone;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "Query parameter phone is required." });
  }
  const snapshot = findSnapshot("");
  if (!snapshot) return res.json({ matched: false, callerDigits: "", candidates: [] });
  res.json(erpDataAdapter.matchCaller(phone, snapshot));
});

// ── Snapshots ────────────────────────────────────────────────────────────────
app.get("/api/snapshots", (_req, res) => {
  res.json({ snapshots: snapshotStore.listSnapshots() });
});
app.get("/api/snapshots/:slug", (req, res) => {
  const snapshot = snapshotStore.loadSnapshotBySlug(req.params.slug);
  if (!snapshot) return res.status(404).json({ error: "Snapshot not found" });
  res.json(snapshot);
});

// ── Ingest (extension) ───────────────────────────────────────────────────────
app.post("/api/ingest/erp", (req, res) => {
  try {
    const { repEmail, repName, repRegion, partners, orders, licenseKeys, calls } = req.body || {};
    if (!repEmail || typeof repEmail !== "string") {
      return res.status(400).json({ error: "repEmail is required" });
    }
    const snapshot = snapshotStore.saveSnapshot(repEmail, {
      rep: {
        email: repEmail,
        name: typeof repName === "string" ? repName : null,
        region: typeof repRegion === "string" ? repRegion : null,
      },
      partners: Array.isArray(partners) ? partners : [],
      orders: Array.isArray(orders) ? orders : [],
      licenseKeys: Array.isArray(licenseKeys) ? licenseKeys : [],
      calls: Array.isArray(calls) ? calls : [],
    });
    res.status(201).json({
      ok: true,
      slug: snapshot.rep.slug,
      updatedAt: snapshot.updatedAt,
      counts: {
        partners: snapshot.partners.length,
        orders: snapshot.orders.length,
        licenseKeys: snapshot.licenseKeys.length,
        calls: snapshot.calls.length,
      },
    });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/ingest/erp/partner-detail", (req, res) => {
  try {
    const { repEmail, partnerId, detail } = req.body || {};
    if (!repEmail || !partnerId || !detail) {
      return res.status(400).json({ error: "repEmail, partnerId, detail are required" });
    }
    const stored = snapshotStore.savePartnerDetail(repEmail, String(partnerId), detail);
    res.status(201).json({ ok: true, partnerId: String(partnerId), fetchedAt: stored.fetchedAt });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

app.post("/api/calls/log", (req, res) => {
  try {
    const { repEmail, partnerId, callerPhone, partnerName, matchedDigits, source } = req.body || {};
    if (!repEmail || !callerPhone) {
      return res.status(400).json({ error: "repEmail and callerPhone are required" });
    }
    const entry = snapshotStore.appendCallLog(repEmail, {
      partnerId: partnerId ? String(partnerId) : null,
      partnerName: partnerName || null,
      callerPhone: String(callerPhone),
      matchedDigits: typeof matchedDigits === "number" ? matchedDigits : null,
      source: typeof source === "string" ? source : "webclient",
    });
    res.status(201).json({ ok: true, entry });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── Notes (in-memory) ────────────────────────────────────────────────────────
function addNote({ partnerId, subject, body, noteType, seller, source }) {
  if (!partnerId || typeof partnerId !== "string") throw new Error("partnerId is required");
  if (!subject || typeof subject !== "string") throw new Error("subject is required");
  if (!body || typeof body !== "string") throw new Error("body is required");
  const note = {
    id: `note-${String(nextNoteId++).padStart(5, "0")}`,
    partnerId,
    subject: subject.slice(0, 200),
    body: body.slice(0, 8000),
    noteType: Number.isFinite(noteType) ? noteType : 1,
    seller: typeof seller === "string" ? seller : null,
    source: typeof source === "string" ? source : "onyx",
    createdAt: new Date().toISOString(),
  };
  notes.push(note);
  return note;
}
function listNotes(partnerId) {
  return partnerId ? notes.filter((n) => n.partnerId === partnerId).slice().reverse() : notes.slice().reverse();
}

app.get("/api/notes", (req, res) => {
  const partnerId = req.query.partnerId;
  res.json({ notes: listNotes(typeof partnerId === "string" ? partnerId : undefined) });
});

app.post("/api/notes", (req, res) => {
  try {
    const { partnerId, subject, body, noteType, seller, source } = req.body || {};
    const note = addNote({
      partnerId,
      subject,
      body,
      noteType: typeof noteType === "string" ? Number.parseInt(noteType, 10) : noteType,
      seller,
      source,
    });
    res.status(201).json({ ok: true, note });
  } catch (err) {
    res.status(400).json({ ok: false, error: err.message });
  }
});

// ── During-call chat ─────────────────────────────────────────────────────────
app.post("/api/chat", chatLimiter, async (req, res) => {
  try {
    const messages = req.body?.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: "Expected body.messages as a non-empty array." });
    }
    if (messages.length > MAX_MESSAGES) {
      return res.status(400).json({ error: `At most ${MAX_MESSAGES} messages per request.` });
    }
    for (const m of messages) {
      if (!m || (m.role !== "user" && m.role !== "assistant")) {
        return res.status(400).json({ error: "Each message must have role user or assistant." });
      }
      if (typeof m.content !== "string" || m.content.length > MAX_CONTENT_LENGTH) {
        return res.status(400).json({ error: "Invalid or too long message content." });
      }
    }

    // Resolve seller from /api/me-style auth instead of trusting client
    const email = authUser(req);
    let snapshot = null;
    let sellerPayload = null;
    if (email) {
      snapshot = snapshotStore.loadSnapshot(email);
      if (snapshot?.rep) {
        sellerPayload = {
          id: snapshot.rep.email || email,
          name: snapshot.rep.name || email.split("@")[0],
          region: snapshot.rep.region || null,
        };
      }
    }

    const reply = await chatCompletion(messages, sellerPayload, snapshot);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || "Chat failed." });
  }
});

app.use(salesRoutes);

// ── Static + SPA root ────────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "unified.html"));
});
app.get("/erp", (_req, res) => res.redirect("/"));
app.get("/admin", (_req, res) => res.redirect("/#/settings"));
app.get("/admin.html", (_req, res) => res.redirect("/#/settings"));

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  const provs = aiProvider.availableProviders().map((p) => p.id).join(", ") || "none";
  console.log(`ONYX listening on ${PORT} — providers: ${provs} — secret store: ${secretsStore.masterKeyAvailable() ? "ready" : "DISABLED (set ONYX_SECRET_KEY)"}`);
});
