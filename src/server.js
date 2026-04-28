"use strict";

const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { chatCompletion, partnerInsight } = require("./openaiClient");
const snapshotStore = require("./snapshotStore");
const erpDataAdapter = require("./erpDataAdapter");

// In-memory notes store (local to this server instance)
const notes = [];
let nextNoteId = 1;

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 8000;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

/**
 * Find the most recent snapshot for a seller name or email.
 * First tries to find by rep name, then by email matching.
 * If no seller specified, returns the most recent snapshot.
 */
function findSnapshot(sellerNameOrEmail) {
  const snapshots = snapshotStore.listSnapshots();
  if (!snapshots.length) return null;

  // Sort by most recent first
  snapshots.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));

  // If no seller specified, return most recent
  if (!sellerNameOrEmail) {
    return snapshotStore.loadSnapshotBySlug(snapshots[0].slug);
  }

  // Try exact name match first
  for (const s of snapshots) {
    if (s.name === sellerNameOrEmail) {
      return snapshotStore.loadSnapshotBySlug(s.slug);
    }
  }

  // Try email match
  for (const s of snapshots) {
    if (s.email === sellerNameOrEmail) {
      return snapshotStore.loadSnapshotBySlug(s.slug);
    }
  }

  // Return most recent as fallback
  return snapshotStore.loadSnapshotBySlug(snapshots[0].slug);
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
    res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
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

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/api/sellers", (_req, res) => {
  const snapshots = snapshotStore.listSnapshots();
  const reps = snapshots
    .map((s) => ({
      id: s.email,
      name: s.name || s.email.split("@")[0],
      email: s.email,
    }))
    .filter((r) => r.name);
  res.json({ reps });
});

app.get("/api/insights", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  const snapshot = findSnapshot(seller);
  if (!snapshot) {
    return res.status(404).json({ error: "No snapshot found for seller. Refresh ERP data first." });
  }
  res.json(erpDataAdapter.insightsForSeller(seller, snapshot));
});

app.get("/api/next-caller", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  const snapshot = findSnapshot(seller);
  if (!snapshot) {
    return res.json({ next: null, queue: [] });
  }
  res.json(erpDataAdapter.getNextCallsForSeller(seller, snapshot));
});

app.get("/api/prospects", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  const snapshot = findSnapshot(seller);
  if (!snapshot) {
    return res.json({ region: "—", prospects: [] });
  }
  res.json(erpDataAdapter.prospectsForSeller(seller, snapshot));
});

app.get("/api/alerts", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  const snapshot = findSnapshot(seller);
  if (!snapshot) {
    return res.json({ alerts: [] });
  }
  res.json(erpDataAdapter.alertsForSeller(seller, snapshot));
});

app.get("/api/home-dashboard", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  const snapshot = findSnapshot(seller);
  if (!snapshot) {
    return res.json(erpDataAdapter.homeDashboardForSeller(seller, null));
  }
  const partnerId = req.query.partnerId;
  res.json(erpDataAdapter.homeDashboardForSeller(seller, snapshot));
});

app.get("/api/pre-call-brief", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  const partnerId = req.query.partnerId;
  const snapshot = findSnapshot(seller);
  if (!snapshot) {
    return res.status(404).json({ ok: false, message: "No snapshot found. Refresh ERP data first.", brief: null });
  }
  res.json(erpDataAdapter.preCallBrief(seller, typeof partnerId === "string" ? partnerId : undefined, snapshot));
});

app.get("/api/partners", (_req, res) => {
  const snapshot = findSnapshot("");
  const partners = snapshot ? snapshot.partners || [] : [];
  res.json({ partners });
});

app.get("/api/orders", (_req, res) => {
  const snapshot = findSnapshot("");
  const orders = snapshot ? snapshot.orders || [] : [];
  res.json({ orders });
});

app.get("/api/license-keys", (_req, res) => {
  const snapshot = findSnapshot("");
  const licenseKeys = snapshot ? snapshot.licenseKeys || [] : [];
  res.json({ licenseKeys });
});

app.get("/api/calls", (_req, res) => {
  const snapshot = findSnapshot("");
  const calls = snapshot ? snapshot.calls || [] : [];
  res.json({ calls });
});

app.get("/api/emails", (_req, res) => {
  const snapshot = findSnapshot("");
  const emails = snapshot ? snapshot.emails || [] : [];
  res.json({ emails });
});

app.post("/api/ingest/erp", (req, res) => {
  try {
    const { repEmail, repName, repRegion, partners, orders, licenseKeys, calls, notes } =
      req.body || {};
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
      notes: Array.isArray(notes) ? notes : [],
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

app.get("/api/sellers/me", (req, res) => {
  const email = req.query.email;
  if (!email || typeof email !== "string") {
    return res.status(400).json({ error: "Query parameter email is required" });
  }
  const snapshot = snapshotStore.loadSnapshot(email);
  if (!snapshot) {
    return res
      .status(404)
      .json({ found: false, slug: snapshotStore.slugifyEmail(email) });
  }
  res.json({
    found: true,
    rep: snapshot.rep,
    updatedAt: snapshot.updatedAt,
    counts: {
      partners: snapshot.partners?.length || 0,
      orders: snapshot.orders?.length || 0,
      licenseKeys: snapshot.licenseKeys?.length || 0,
      calls: snapshot.calls?.length || 0,
    },
  });
});

app.get("/api/snapshots", (_req, res) => {
  res.json({ snapshots: snapshotStore.listSnapshots() });
});

app.get("/api/snapshots/:slug", (req, res) => {
  const snapshot = snapshotStore.loadSnapshotBySlug(req.params.slug);
  if (!snapshot) return res.status(404).json({ error: "Snapshot not found" });
  res.json(snapshot);
});

app.get("/api/match-caller", (req, res) => {
  const phone = req.query.phone;
  if (!phone || typeof phone !== "string") {
    return res.status(400).json({ error: "Query parameter phone is required." });
  }
  const snapshot = findSnapshot("");
  if (!snapshot) {
    return res.json({ matched: false, callerDigits: "", candidates: [] });
  }
  res.json(erpDataAdapter.matchCaller(phone, snapshot));
});

// Helper functions for notes management
function addNote({ partnerId, subject, body, noteType, seller, source }) {
  if (!partnerId || typeof partnerId !== "string") {
    throw new Error("partnerId is required");
  }
  if (!subject || typeof subject !== "string") {
    throw new Error("subject is required");
  }
  if (!body || typeof body !== "string") {
    throw new Error("body is required");
  }
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
  if (partnerId) {
    return notes.filter((n) => n.partnerId === partnerId).slice().reverse();
  }
  return notes.slice().reverse();
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

app.post("/api/insight", chatLimiter, async (req, res) => {
  if (!process.env.OPENAI_API_KEY) {
    return res.status(503).json({ error: "AI is not configured (missing OPENAI_API_KEY)." });
  }
  try {
    const partner = req.body?.partner;
    if (!partner || typeof partner !== "object") {
      return res.status(400).json({ error: "body.partner is required" });
    }
    const insight = await partnerInsight(partner);
    res.json({ insight });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err?.message || "Insight failed" });
  }
});

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

    if (!process.env.OPENAI_API_KEY) {
      return res.status(503).json({ error: "AI is not configured (missing OPENAI_API_KEY)." });
    }

    const seller = req.body?.seller;
    const sellerPayload =
      seller &&
      typeof seller === "object" &&
      typeof seller.name === "string" &&
      (seller.id === undefined || typeof seller.id === "string") &&
      (seller.region === undefined || typeof seller.region === "string")
        ? { id: seller.id, name: seller.name, region: seller.region }
        : null;

    const reply = await chatCompletion(messages, sellerPayload);
    res.json({ reply });
  } catch (err) {
    console.error(err);
    const msg = err?.message || "Chat failed.";
    res.status(500).json({ error: msg });
  }
});

// Serve the unified dashboard
app.get("/", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "unified.html"));
});

// Legacy /erp route - redirect to root
app.get("/erp", (_req, res) => {
  res.redirect("/");
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
