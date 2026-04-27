"use strict";

const path = require("path");
const express = require("express");
const rateLimit = require("express-rate-limit");
const { chatCompletion } = require("./openaiClient");
const mockApi = require("./mockApi");

const PORT = Number.parseInt(process.env.PORT || "3000", 10);
const MAX_MESSAGES = 40;
const MAX_CONTENT_LENGTH = 8000;

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "256kb" }));

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

app.use(express.static(path.join(__dirname, "..", "public")));

app.listen(PORT, () => {
  console.log(`Listening on ${PORT}`);
});
