"use strict";

/**
 * /api/sales/* — endpoints that wire the vendored Anthropic Sales plugin
 * skills to onyxvvv's snapshot data. Provider-agnostic: each request can
 * carry { provider: "anthropic" | "openai" }.
 *
 * Mount in server.js with:
 *   app.use(require("./salesRoutes"));
 */

const express = require("express");
const rateLimit = require("express-rate-limit");
const snapshotStore = require("./snapshotStore");
const skills = require("./skillLoader");
const { chat, availableProviders } = require("./aiProvider");

const router = express.Router();

const aiLimit = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many AI requests, slow down." },
});

// ── Snapshot helpers ─────────────────────────────────────────────────────────
function findSnapshot(sellerName) {
  const all = snapshotStore.listSnapshots();
  if (!all.length) return null;
  all.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
  if (sellerName) {
    const match = all.find((s) => s.name === sellerName);
    if (match) return snapshotStore.loadSnapshotBySlug(match.slug);
  }
  return snapshotStore.loadSnapshotBySlug(all[0].slug);
}

function partnerContext(snapshot, partnerId) {
  if (!snapshot || !partnerId) return null;
  const partner = (snapshot.partners || []).find((p) => p.id === partnerId);
  if (!partner) return null;
  const orders = (snapshot.orders || []).filter((o) => o.resellerId === partnerId);
  const keys = (snapshot.licenseKeys || []).filter((k) => k.assignedResellerId === partnerId);
  const calls = (snapshot.calls || []).filter((c) => c.partnerId === partnerId);
  // Trim to keep prompt size reasonable
  return {
    partner,
    recentOrders: orders.slice(-15),
    licenseKeys: keys.slice(0, 30),
    recentCalls: calls.slice(-10),
    orderCount: orders.length,
    keyCount: keys.length,
  };
}

function compactJson(obj) {
  return JSON.stringify(obj, null, 2);
}

// Common preamble — gives the AI the company context regardless of provider.
const PREAMBLE = `You are an AI assistant embedded in onyxvvv, a sales-force tool used by the 3CX sales team to manage their reseller (partner) relationships. The 3CX product is a software-based PBX. Resellers sell licenses and hosted PBX services to end customers. License "SC" = Simultaneous Calls capacity; common SC tiers are 4, 8, 16, 32, 64, 128, 256, 512, 1024. Editions: SMB, Standard, Professional, Enterprise. Reseller tiers: Bronze/Silver/Gold/Platinum/Titanium.

When you produce sales artifacts (briefs, summaries, follow-ups), be specific to the data provided. Never invent facts. If a data point is missing, say so. Output should be concise and immediately useful — bullet points, action items, owner names, dates.`;

// ── Provider list (for the UI toggle) ────────────────────────────────────────
router.get("/api/sales/providers", (_req, res) => {
  res.json({ providers: availableProviders(), skills: skills.listLoaded() });
});

// ── /api/sales/call-prep ─────────────────────────────────────────────────────
// Pre-call brief: account-research + call-prep skills, partner context.
router.post("/api/sales/call-prep", aiLimit, async (req, res) => {
  try {
    const { partnerId, seller, provider } = req.body || {};
    if (!partnerId) return res.status(400).json({ error: "partnerId required" });
    const snapshot = findSnapshot(seller);
    const ctx = partnerContext(snapshot, partnerId);
    if (!ctx) return res.status(404).json({ error: "Partner not found in snapshot" });

    const system = skills.composeSystem({
      plugin: "sales",
      skills: ["account-research", "call-prep"],
      preamble: PREAMBLE,
    });

    const userPrompt = `Build me a pre-call brief for the upcoming call with this 3CX reseller.

Output structure:
1. Account snapshot — 1-2 sentence summary of who they are and current health
2. Recent activity — what's changed in the last 90 days (orders, license activations/expirations, call history)
3. Suggested agenda — 3-5 bullets for the actual call
4. Predicted objections — likely pushback and how to handle each
5. Next-best-action — one concrete ask for this call

Reseller and snapshot data:
\`\`\`json
${compactJson(ctx)}
\`\`\``;

    const result = await chat({
      provider,
      system,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1500,
    });
    res.json(result);
  } catch (err) {
    console.error("[call-prep]", err);
    res.status(500).json({ error: err.message || "call-prep failed" });
  }
});

// ── /api/sales/call-summary ──────────────────────────────────────────────────
// Post-call: turn raw notes/transcript into structured summary + draft follow-up.
router.post("/api/sales/call-summary", aiLimit, async (req, res) => {
  try {
    const { partnerId, transcript, seller, provider } = req.body || {};
    if (!transcript || transcript.length < 30) return res.status(400).json({ error: "transcript (>=30 chars) required" });

    const snapshot = findSnapshot(seller);
    const ctx = partnerId ? partnerContext(snapshot, partnerId) : null;

    const system = skills.composeSystem({
      plugin: "sales",
      skills: ["call-summary"],
      commands: ["call-summary"],
      preamble: PREAMBLE,
    });

    const userPrompt = `Process the following call notes/transcript. Produce:

A) Internal call summary (3-6 bullets): topics, decisions, sentiment.
B) Action items: one per line, format \`[ ] OWNER — TASK — DUE\`.
C) Draft follow-up email (subject line + body) addressed to the reseller, recapping key points and confirming next steps.

${ctx ? `Reseller context (do NOT echo verbatim — use to ground specifics):
\`\`\`json
${compactJson({ partner: ctx.partner, orderCount: ctx.orderCount, keyCount: ctx.keyCount })}
\`\`\`
` : ""}
Notes/transcript:
"""
${transcript}
"""`;

    const result = await chat({
      provider,
      system,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1800,
    });
    res.json(result);
  } catch (err) {
    console.error("[call-summary]", err);
    res.status(500).json({ error: err.message || "call-summary failed" });
  }
});

// ── /api/sales/draft-outreach ────────────────────────────────────────────────
router.post("/api/sales/draft-outreach", aiLimit, async (req, res) => {
  try {
    const { partnerId, intent, seller, provider } = req.body || {};
    if (!partnerId) return res.status(400).json({ error: "partnerId required" });
    if (!intent) return res.status(400).json({ error: "intent required (e.g. 'renewal nudge', 'upsell to Enterprise')" });
    const snapshot = findSnapshot(seller);
    const ctx = partnerContext(snapshot, partnerId);
    if (!ctx) return res.status(404).json({ error: "Partner not found" });

    const system = skills.composeSystem({
      plugin: "sales",
      skills: ["draft-outreach", "account-research"],
      preamble: PREAMBLE,
    });

    const userPrompt = `Draft a personalised outreach email to this 3CX reseller.

Intent: ${intent}

Reseller data:
\`\`\`json
${compactJson(ctx)}
\`\`\`

Output: subject line + body. Keep it under 150 words. Reference one specific recent data point (most-recent order, expiring key, etc.). One clear CTA.`;

    const result = await chat({
      provider,
      system,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 800,
    });
    res.json(result);
  } catch (err) {
    console.error("[draft-outreach]", err);
    res.status(500).json({ error: err.message || "draft-outreach failed" });
  }
});

// ── /api/sales/pipeline-review ───────────────────────────────────────────────
// Whole-book health check for the seller. Uses pipeline-review + daily-briefing.
router.post("/api/sales/pipeline-review", aiLimit, async (req, res) => {
  try {
    const { seller, provider } = req.body || {};
    const snapshot = findSnapshot(seller);
    if (!snapshot) return res.status(404).json({ error: "No snapshot for seller" });

    const owned = (snapshot.partners || []).filter((p) => !seller || p.accountOwnerName === seller);
    const ids = new Set(owned.map((p) => p.id));
    const orders = (snapshot.orders || []).filter((o) => ids.has(o.resellerId));
    const keys = (snapshot.licenseKeys || []).filter((k) => ids.has(k.assignedResellerId));
    const calls = (snapshot.calls || []).filter((c) => c.seller === seller);

    const system = skills.composeSystem({
      plugin: "sales",
      skills: ["pipeline-review", "daily-briefing"],
      commands: ["pipeline-review"],
      preamble: PREAMBLE,
    });

    const userPrompt = `Review this seller's book of business and produce a weekly pipeline review.

Seller: ${seller || "(not specified)"}

Aggregated:
\`\`\`json
${compactJson({
      partnerCount: owned.length,
      orderCount: orders.length,
      orderTotalUsd: orders.reduce((s, o) => s + Number(o.totalUsd || 0), 0),
      keyCount: keys.length,
      callCount: calls.length,
      partners: owned.slice(0, 50).map((p) => ({
        id: p.id,
        company: p.companyName,
        level: p.distributorLevel,
        country: p.country,
        revenue: p.annualRevenueUsd,
      })),
      recentOrders: orders.slice(-30),
      recentCalls: calls.slice(-15),
    })}
\`\`\`

Output structure:
- Pipeline health snapshot (1 paragraph)
- Top 3 risks (stale partners, overdue renewals, declining order volume)
- Top 3 opportunities (upsell candidates, big renewals, expansion signals)
- This-week action plan: 5 concrete next steps with partner IDs`;

    const result = await chat({
      provider,
      system,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 2000,
    });
    res.json(result);
  } catch (err) {
    console.error("[pipeline-review]", err);
    res.status(500).json({ error: err.message || "pipeline-review failed" });
  }
});

// ── /api/sales/competitive-intel ─────────────────────────────────────────────
router.post("/api/sales/competitive-intel", aiLimit, async (req, res) => {
  try {
    const { partnerId, competitor, seller, provider } = req.body || {};
    if (!competitor) return res.status(400).json({ error: "competitor required" });
    const snapshot = findSnapshot(seller);
    const ctx = partnerId ? partnerContext(snapshot, partnerId) : null;

    const system = skills.composeSystem({
      plugin: "sales",
      skills: ["competitive-intelligence"],
      preamble: PREAMBLE,
    });

    const userPrompt = `Build a competitive battlecard for 3CX vs ${competitor}.

${ctx ? `In the context of this specific reseller:
\`\`\`json
${compactJson({ partner: ctx.partner })}
\`\`\`` : "Generic battlecard for the DACH/EU market."}

Output:
- Side-by-side differentiation matrix (5-7 axes)
- 3 talk tracks the seller can use mid-call when ${competitor} comes up
- 2 likely objections from a reseller leaning toward ${competitor} and how to neutralise them`;

    const result = await chat({
      provider,
      system,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1500,
    });
    res.json(result);
  } catch (err) {
    console.error("[competitive-intel]", err);
    res.status(500).json({ error: err.message || "competitive-intel failed" });
  }
});

// ── /api/sales/account-research ──────────────────────────────────────────────
router.post("/api/sales/account-research", aiLimit, async (req, res) => {
  try {
    const { partnerId, seller, provider } = req.body || {};
    if (!partnerId) return res.status(400).json({ error: "partnerId required" });
    const snapshot = findSnapshot(seller);
    const ctx = partnerContext(snapshot, partnerId);
    if (!ctx) return res.status(404).json({ error: "Partner not found" });

    const system = skills.composeSystem({
      plugin: "sales",
      skills: ["account-research"],
      preamble: PREAMBLE,
    });

    const userPrompt = `Synthesise an account research brief for this 3CX reseller. Use only the data given — flag gaps where you'd normally web-search.

\`\`\`json
${compactJson(ctx)}
\`\`\`

Output:
- Company snapshot (size, region, vertical concentration)
- Buying pattern (volume, edition mix, renewal cadence)
- Hiring/expansion signals (if visible in data)
- Gaps to fill: list the external research that would sharpen this brief`;

    const result = await chat({
      provider,
      system,
      messages: [{ role: "user", content: userPrompt }],
      maxTokens: 1500,
    });
    res.json(result);
  } catch (err) {
    console.error("[account-research]", err);
    res.status(500).json({ error: err.message || "account-research failed" });
  }
});

module.exports = router;
