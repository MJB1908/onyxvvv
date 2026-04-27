"use strict";

const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { chatCompletion } = require("./openaiClient");
const mockApi = require("./mockApi");
const snapshotStore = require("./snapshotStore");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 8000;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

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
  res.json({ reps: mockApi.salesTeam.reps });
});

app.get("/api/insights", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  res.json(mockApi.insightsForSeller(seller));
});

app.get("/api/next-caller", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  res.json(mockApi.getNextCallsForSeller(seller));
});

app.get("/api/prospects", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  res.json(mockApi.prospectsForSeller(seller));
});

app.get("/api/alerts", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  res.json(mockApi.alertsForSeller(seller));
});

app.get("/api/home-dashboard", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  const partnerId = req.query.partnerId;
  res.json(mockApi.homeDashboardForSeller(seller, typeof partnerId === "string" ? partnerId : undefined));
});

app.get("/api/pre-call-brief", (req, res) => {
  const seller = req.query.seller;
  if (!seller || typeof seller !== "string") {
    return res.status(400).json({ error: "Query parameter seller (name) is required." });
  }
  const partnerId = req.query.partnerId;
  res.json(mockApi.preCallBrief(seller, typeof partnerId === "string" ? partnerId : undefined));
});

app.get("/api/partners", (_req, res) => {
  res.json({ partners: mockApi.partners });
});

app.get("/api/orders", (_req, res) => {
  res.json({ orders: mockApi.orders });
});

app.get("/api/license-keys", (_req, res) => {
  res.json({ licenseKeys: mockApi.licenseKeys });
});

app.get("/api/calls", (_req, res) => {
  res.json({ calls: mockApi.calls });
});

app.get("/api/emails", (_req, res) => {
  res.json({ emails: mockApi.emails });
});

app.get("/api/internal-users", (_req, res) => {
  res.json({ internalUsers: mockApi.internalUsers });
});

app.get("/api/products", (_req, res) => {
  res.json({ products: mockApi.products });
});

app.get("/api/license-types", (_req, res) => {
  res.json(mockApi.licenseTypes);
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
  res.json(mockApi.matchCaller(phone));
});

app.get("/api/notes", (req, res) => {
  const partnerId = req.query.partnerId;
  res.json({ notes: mockApi.listNotes(typeof partnerId === "string" ? partnerId : undefined) });
});

app.post("/api/notes", (req, res) => {
  try {
    const { partnerId, subject, body, noteType, seller, source } = req.body || {};
    const note = mockApi.addNote({
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

app.get("/erp", (_req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "erp.html"));
});

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
