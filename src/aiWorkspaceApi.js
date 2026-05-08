"use strict";

const { chatCompletionWithOptions, truncateTranscriptLines } = require("./openaiClient");

// ── Helpers ──────────────────────────────────────────────────────────────────

function bodyPartnerId(body) {
  const s = typeof body?.partnerId === "string" ? body.partnerId.trim() : "";
  return s || undefined;
}

function parseSeller(body) {
  const seller = body?.seller;
  if (
    !seller ||
    typeof seller !== "object" ||
    typeof seller.name !== "string" ||
    (seller.id !== undefined && typeof seller.id !== "string") ||
    (seller.region !== undefined && typeof seller.region !== "string")
  ) {
    return null;
  }
  return { id: seller.id, name: seller.name, region: seller.region };
}

function tryParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function clampRunbookLines(lines) {
  if (!Array.isArray(lines)) return [];
  const out = lines.map((x) => String(x || "").trim()).filter(Boolean);
  return out.slice(0, 5);
}

function padAchieved(achieved, n) {
  const a = Array.isArray(achieved) ? achieved.map(Boolean) : [];
  while (a.length < n) a.push(false);
  return a.slice(0, n);
}

// ── Build partner context from live ERP data ─────────────────────────────────
// Replaces mockApi.getPartnerScopedPackForAi with real data lookups.
// dataSource is { partners, orders, licenseKeys, calls, erpPartners, notes }
// from the server's live stores.

function buildPartnerPack(dataSource, sellerName, partnerId) {
  const { partners = [], orders = [], licenseKeys = [], calls = [], erpPartners = [], notes = [] } = dataSource || {};

  // Find the partner — try ERP data first (richer), then snapshot
  let pid = partnerId;
  let ep = pid ? erpPartners.find(e => String(e.id) === String(pid)) : null;
  let sp = pid ? partners.find(p => p.id === pid || p.partnerId === pid) : null;

  // If no specific partner, pick the first ERP partner
  if (!ep && !sp && erpPartners.length) {
    ep = erpPartners[0];
    pid = String(ep.id);
  }
  if (!ep && !sp && partners.length) {
    sp = partners[0];
    pid = sp.id || sp.partnerId;
  }

  if (!ep && !sp) {
    return { ok: false, message: "No partner context available. Load ERP data first.", pack: null };
  }

  const companyName = ep?.company || sp?.companyName || "Partner";
  const country = ep?.country || sp?.country || "—";
  const level = ep?.category || sp?.distributorLevel || "—";
  const contactName = ep?.contact || sp?.contactName || "—";
  const contactEmail = ep?.email || sp?.accountOwnerEmail || "";
  const revenue = ep?.revenue || sp?.revenue || "—";

  // Partner orders/keys
  const myOrders = orders.filter(o => o.resellerId === pid || o.partnerId === pid)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 8);
  const myKeys = licenseKeys.filter(k => k.resellerId === pid || k.partnerId === pid).slice(0, 10);
  const myCalls = calls.filter(c => c.partnerId === pid)
    .sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 5);
  const myNotes = notes.filter(n => n.partnerId === pid)
    .sort((a, b) => (b.ts || 0) - (a.ts || 0)).slice(0, 5);

  // ERP detail data (if available from enrichment)
  const tabs = ep?.tabs || {};
  const keysSummary = tabs.keys || [];
  const revenueData = tabs.revenue || {};

  return {
    ok: true,
    pack: {
      brief: {
        partner: {
          id: pid,
          companyName,
          salesRegion: ep?.salesRep || sellerName || "—",
          country,
          distributorLevel: level,
          contactName,
          accountOwnerEmail: contactEmail,
          notes: myNotes.map(n => `[${n.poster || ""}] ${n.body || ""}`).join(" | ").slice(0, 2000) || "",
        },
        nextCall: myCalls[0] ? {
          id: myCalls[0].id,
          date: myCalls[0].date,
          notes: myCalls[0].notes || myCalls[0].subject || "",
          objectives: null,
        } : null,
        orderBookUsd: myOrders.reduce((s, o) => s + Number(o.totalUsd || o.amount || 0), 0),
        revenueTrendNarrative: revenueData.revenueBalance
          ? `Current year: €${revenueData.revenueBalance}, Previous: €${revenueData.previousAnnual || "—"}`
          : revenue ? `Annual revenue: ${revenue}` : "No revenue data",
        recentOrders: myOrders.slice(0, 5).map(o => ({
          orderId: o.orderId || o.id,
          date: o.date,
          type: o.type || "Order",
          totalUsd: o.totalUsd || o.amount || 0,
          status: o.status || "—",
        })),
        renewalsPreview: myKeys.filter(k => k.expiry).slice(0, 5).map(k => ({
          key: (k.key || k.licenseKey || "").slice(0, 9) + "...",
          expiry: k.expiry || k.licenseExpires,
          product: k.product || k.productEdition,
        })),
        upgradesPreview: [],
        lastCalls: myCalls.map(c => ({
          date: c.date,
          subject: c.subject || c.notes || "Call",
          outcome: c.outcome || "—",
        })),
        suggestedAgenda: [],
        predictedObjections: [],
        keysSummary: keysSummary.slice(0, 8).map(k => ({
          key: (k.key || "").slice(0, 9) + "...",
          product: k.product,
          sc: k.sc,
          expiry: k.expiry,
          disabled: k.disabled,
        })),
      },
      productsSample: [
        { sku: "3CXPSSPLA", name: "3CX PRO Annual", priceUsd: "per SC", billing: "Annual" },
        { sku: "3CXPSPROFSPLA", name: "3CX Professional Annual", priceUsd: "per SC", billing: "Annual" },
        { sku: "3CXPSPROFENTSPLA", name: "3CX AI Edition Annual", priceUsd: "per SC", billing: "Annual" },
      ],
    },
  };
}

function buildCallSetupScopedPayload(pack) {
  const b = pack.brief;
  const objectives =
    b.nextCall?.objectives?.length
      ? b.nextCall.objectives
      : b.nextCall?.notes
        ? [`(from call notes) ${b.nextCall.notes}`]
        : [];

  return {
    client: {
      id: b.partner.id,
      companyName: b.partner.companyName,
      salesRegion: b.partner.salesRegion,
      country: b.partner.country,
      distributorLevel: b.partner.distributorLevel,
      contactName: b.partner.contactName,
    },
    clientSetup: b.partner.notes || null,
    objectives,
    scheduledCall: b.nextCall,
    revenueAndPipeline: {
      orderBookUsd: b.orderBookUsd,
      revenueTrendNarrative: b.revenueTrendNarrative,
      recentOrders: b.recentOrders,
      renewalsPreview: b.renewalsPreview,
      upgradesPreview: b.upgradesPreview,
    },
    relationshipContext: {
      lastCallsWithPartner: b.lastCalls,
      suggestedAgenda: b.suggestedAgenda,
      predictedObjections: b.predictedObjections,
    },
    keysSummary: b.keysSummary,
    productCatalogSample: pack.productsSample,
  };
}

// ── AI Handlers ──────────────────────────────────────────────────────────────

async function handleCallSetupSummary(body, dataSource) {
  const seller = parseSeller(body);
  if (!seller) return { ok: false, error: "Invalid seller object.", status: 400 };

  const packRes = buildPartnerPack(dataSource, seller.name, bodyPartnerId(body));
  if (!packRes.ok || !packRes.pack) {
    return { ok: false, error: packRes.message || "No partner context.", status: 400 };
  }

  const companyName = packRes.pack.brief.partner.companyName;
  const payload = buildCallSetupScopedPayload(packRes.pack);
  const userMessage = `Build a summary for my next call with the client ${companyName}:\n${JSON.stringify(payload)}`;

  const systemPrompt = `You are the ONYX Call Setup Assistant for 3CX channel sales reps in the DACH region. The user message contains structured JSON with real ERP data — use only that JSON plus the seller identity; do not assume other CRM data.

Output a concise pre-call briefing in Markdown with these sections (use ## headings): **Client**, **Client setup**, **Objectives**, **Scope of call** (pipeline, relationship, risks, agenda alignment). Stay factual to the JSON. If objectives are thin, infer sensible call goals from context and label them as inferred.`;

  const reply = await chatCompletionWithOptions([{ role: "user", content: userMessage }], seller, {
    systemPrompt,
    temperature: 0.35,
    maxTokens: 1400,
  });

  return { ok: true, reply };
}

async function handleCallSetupRunbook(body, dataSource) {
  const seller = parseSeller(body);
  if (!seller) return { ok: false, error: "Invalid seller object.", status: 400 };

  const summaryText = typeof body.summaryText === "string" ? body.summaryText : "";
  const packRes = buildPartnerPack(dataSource, seller.name, bodyPartnerId(body));
  if (!packRes.ok || !packRes.pack) {
    return { ok: false, error: packRes.message || "No partner context.", status: 400 };
  }

  const payload = buildCallSetupScopedPayload(packRes.pack);
  const userMsg = `Create a terse call runbook for the seller as 4–5 bullet points only (parallel structure, actionable). Use this briefing and JSON context.\n\n## Brief\n${summaryText.slice(0, 12000)}\n\n## Data\n${JSON.stringify(payload)}`;

  const text = await chatCompletionWithOptions([{ role: "user", content: userMsg }], seller, {
    systemPrompt:
      'Respond with ONLY valid JSON: {"runbookLines":["...","..."]} with between 4 and 5 strings, each one runbook bullet (no numbering prefix in strings).',
    temperature: 0.25,
    maxTokens: 500,
    jsonMode: true,
  });

  const parsed = tryParseJson(text);
  let lines = clampRunbookLines(parsed?.runbookLines);
  while (lines.length < 4) lines.push("(Add runbook detail)");
  lines = clampRunbookLines(lines);

  return { ok: true, runbookLines: lines };
}

async function handleRunbookCoach(body) {
  const seller = parseSeller(body);
  if (!seller) return { ok: false, error: "Invalid seller object.", status: 400 };

  const runbook = typeof body.runbook === "string" ? body.runbook : "";
  const instruction = typeof body.instruction === "string" ? body.instruction : "";
  const briefContext = typeof body.briefContext === "string" ? body.briefContext : "";

  if (!instruction.trim()) return { ok: false, error: "instruction is required.", status: 400 };

  const userMsg = `## Current runbook\n${runbook.slice(0, 12000)}\n\n## Brief / context\n${briefContext.slice(0, 8000)}\n\n## Seller instruction\n${instruction.slice(0, 4000)}`;

  const text = await chatCompletionWithOptions([{ role: "user", content: userMsg }], seller, {
    systemPrompt:
      'You revise the seller runbook only. Respond with ONLY valid JSON: {"runbookLines":["...",...]} with 4–5 bullet strings total. Keep bullets short and parallel; reflect the instruction while staying realistic for PBX/license sales.',
    temperature: 0.2,
    maxTokens: 500,
    jsonMode: true,
  });

  const parsed = tryParseJson(text);
  const lines = clampRunbookLines(parsed?.runbookLines);
  if (lines.length < 4) {
    return { ok: false, error: "Could not parse runbook from model.", status: 500 };
  }
  return { ok: true, runbookLines: lines };
}

async function handleSimCallTurn(body, dataSource) {
  const seller = parseSeller(body);
  if (!seller) return { ok: false, error: "Invalid seller object.", status: 400 };

  const role = body.role === "buyer" ? "buyer" : "seller";
  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const brief = typeof body.brief === "string" ? body.brief : "";
  const runbookBullets = Array.isArray(body.runbookBullets) ? clampRunbookLines(body.runbookBullets) : [];

  const packRes = buildPartnerPack(dataSource, seller.name, bodyPartnerId(body));
  if (!packRes.ok || !packRes.pack) {
    return { ok: false, error: packRes.message || "No partner context.", status: 400 };
  }

  const b = packRes.pack.brief;
  if (!b?.partner) return { ok: false, error: "Invalid partnerPack.", status: 400 };

  const transcriptText = truncateTranscriptLines(transcript, 10000);
  const partnerName = b.partner.companyName;
  const contact = b.partner.contactName;

  let systemPrompt;
  if (role === "seller") {
    systemPrompt = `You are ${seller.name}, a 3CX sales rep in the DACH region, practicing a sales call with ${contact} from ${partnerName}. Continue the conversation naturally based on the brief and runbook. Respond in character as the seller. Output ONLY JSON: {"text":"your next line"}`;
  } else {
    systemPrompt = `You are ${contact}, the contact at ${partnerName} (a 3CX partner), on a sales call with ${seller.name}. You are realistic — sometimes cooperative, sometimes challenging. Ask about pricing, timelines, competition. Based on the brief context, respond in character as the buyer. Output ONLY JSON: {"text":"your next line"}`;
  }

  const userMsg = `## Brief\n${brief.slice(0, 6000)}\n\n## Runbook\n${runbookBullets.map(x => `- ${x}`).join("\n")}\n\n## Transcript so far\n${transcriptText || "(call just started)"}\n\nGenerate the next ${role} line.`;

  const text = await chatCompletionWithOptions([{ role: "user", content: userMsg }], seller, {
    systemPrompt,
    temperature: role === "seller" ? 0.45 : 0.55,
    maxTokens: 400,
    jsonMode: true,
  });

  const parsed = tryParseJson(text);
  const lineText = typeof parsed?.text === "string" ? parsed.text.trim() : "";
  if (!lineText) return { ok: false, error: "Empty sim line.", status: 500 };

  const speaker = role === "seller" ? seller.name : contact;
  return { ok: true, line: { speaker, role, text: lineText } };
}

function normalizeSentiment(s) {
  const o = s && typeof s === "object" ? s : {};
  let overall = typeof o.overall === "string" ? o.overall.trim().toLowerCase() : "neutral";
  if (!["positive", "neutral", "negative"].includes(overall)) overall = "neutral";
  const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
  return { overall, rationale };
}

function normalizeTopicGuidance(t) {
  const o = t && typeof t === "object" ? t : {};
  const stayOnTopic = o.stayOnTopic !== false;
  const recommendedFocus = typeof o.recommendedFocus === "string" ? o.recommendedFocus.trim() : "";
  const rationale = typeof o.rationale === "string" ? o.rationale.trim() : "";
  return { stayOnTopic, recommendedFocus, rationale };
}

async function handleDuringCallEval(body) {
  const seller = parseSeller(body);
  if (!seller) return { ok: false, error: "Invalid seller object.", status: 400 };

  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const runbookBullets = clampRunbookLines(Array.isArray(body.runbookBullets) ? body.runbookBullets : []);
  const brief = typeof body.brief === "string" ? body.brief : "";

  if (runbookBullets.length === 0) {
    return { ok: false, error: "runbookBullets required.", status: 400 };
  }

  const transcriptText = truncateTranscriptLines(transcript, 12000);
  const bulletsBlock = runbookBullets.map((x, i) => `${i + 1}. ${x}`).join("\n");

  const userMsg = `## Brief\n${brief.slice(0, 8000)}\n\n## Runbook (mark achievement per line index 0..n-1)\n${bulletsBlock}\n\n## Transcript\n${transcriptText || "(no lines yet)"}\n\nReturn JSON only with this shape:
{
  "achieved": [ boolean, ... ],
  "momentSummary": "1-2 sentences: what just happened in the latest exchange",
  "sentiment": { "overall": "positive"|"neutral"|"negative", "rationale": "partner tone from transcript" },
  "topicGuidance": { "stayOnTopic": boolean, "recommendedFocus": "next angle or runbook item to lean into", "rationale": "continue current thread vs pivot" },
  "evaluation": "optional 2-4 sentence proactive coach paragraph (tactical advice)"
}
Be proactive: advise whether to deepen the current topic or move to the next agenda/runbook item.`;

  const text = await chatCompletionWithOptions([{ role: "user", content: userMsg }], seller, {
    systemPrompt:
      "You are an expert live sales coach for 3CX channel sales (PBX/UC). Output valid JSON only. achieved length must equal runbook bullet count.",
    temperature: 0.08,
    maxTokens: 900,
    jsonMode: true,
  });

  const parsed = tryParseJson(text);
  const achieved = padAchieved(parsed?.achieved, runbookBullets.length);
  const momentSummary = typeof parsed?.momentSummary === "string" ? parsed.momentSummary.trim() : "";
  const sentiment = normalizeSentiment(parsed?.sentiment);
  const topicGuidance = normalizeTopicGuidance(parsed?.topicGuidance);
  let evaluation = typeof parsed?.evaluation === "string" ? parsed.evaluation.trim() : "";
  if (!evaluation && momentSummary) evaluation = momentSummary;

  return { ok: true, achieved, momentSummary, sentiment, topicGuidance, evaluation, runbookBullets };
}

async function handlePostCallDrafts(body, dataSource) {
  const seller = parseSeller(body);
  if (!seller) return { ok: false, error: "Invalid seller object.", status: 400 };

  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const brief = typeof body.brief === "string" ? body.brief : "";
  const runbookBullets = clampRunbookLines(Array.isArray(body.runbookBullets) ? body.runbookBullets : []);

  let lastEvalSummary = "";
  if (body.lastEval != null) {
    if (typeof body.lastEval === "string") lastEvalSummary = body.lastEval.slice(0, 8000);
    else lastEvalSummary = JSON.stringify(body.lastEval).slice(0, 8000);
  }

  const packRes = buildPartnerPack(dataSource, seller.name, bodyPartnerId(body));
  const briefPack = packRes.ok && packRes.pack?.brief?.partner ? packRes.pack.brief.partner : {};

  const companyName = typeof body.companyName === "string" ? body.companyName.trim() : briefPack.companyName || "Partner";
  const clientName = typeof body.clientName === "string" ? body.clientName.trim() : briefPack.contactName || "Contact";
  const clientEmail = briefPack.accountOwnerEmail || "contact@partner.com";

  const transcriptText = truncateTranscriptLines(transcript, 14000);

  const userMsg = `## Seller\n${seller.name} (${seller.region || "—"})\n\n## Partner\n${companyName} — primary contact ${clientName} (draft email to ${clientEmail})\n\n## Pre-call brief\n${brief.slice(0, 10000)}\n\n## Runbook used\n${runbookBullets.map((x) => `- ${x}`).join("\n")}\n\n## Latest in-call AI evaluation snapshot\n${lastEvalSummary || "—"}\n\n## Call transcript\n${transcriptText || "(empty)"}\n\nReturn ONLY valid JSON:
{
  "meetingNotes": "structured bullets as markdown-ready text suitable for CRM notes",
  "followUpSubject": "short email subject line",
  "followUpBody": "professional follow-up email body to the partner contact, ready to send",
  "actionPlanBullets": [ "3-6 concrete next steps with owner hints" ]
}`;

  const text = await chatCompletionWithOptions([{ role: "user", content: userMsg }], seller, {
    systemPrompt:
      "You draft post-call artifacts for 3CX channel sales reps in the DACH region. Stay consistent with transcript and brief. JSON only.",
    temperature: 0.25,
    maxTokens: 1200,
    jsonMode: true,
  });

  const parsed = tryParseJson(text);
  const meetingNotes = typeof parsed?.meetingNotes === "string" ? parsed.meetingNotes.trim() : "";
  const followUpSubject = typeof parsed?.followUpSubject === "string" ? parsed.followUpSubject.trim() : "Follow-up: next steps";
  const followUpBody = typeof parsed?.followUpBody === "string" ? parsed.followUpBody.trim() : "";
  const actionPlanBullets = Array.isArray(parsed?.actionPlanBullets)
    ? parsed.actionPlanBullets.map((x) => String(x || "").trim()).filter(Boolean).slice(0, 12)
    : [];

  return { ok: true, meetingNotes, followUpSubject, followUpBody, actionPlanBullets, clientEmail, clientName, companyName };
}

async function handleDuringCallWhisper(body) {
  const seller = parseSeller(body);
  if (!seller) return { ok: false, error: "Invalid seller object.", status: 400 };

  const message = typeof body.message === "string" ? body.message : "";
  if (!message.trim()) return { ok: false, error: "message is required.", status: 400 };

  const transcript = Array.isArray(body.transcript) ? body.transcript : [];
  const runbookBullets = clampRunbookLines(Array.isArray(body.runbookBullets) ? body.runbookBullets : []);
  const brief = typeof body.brief === "string" ? body.brief : "";
  const previousEvaluation = typeof body.previousEvaluation === "string" ? body.previousEvaluation : "";

  const transcriptText = truncateTranscriptLines(transcript, 10000);
  const userMsg = `## Brief\n${brief.slice(0, 6000)}\n\n## Runbook\n${runbookBullets.map((x) => `- ${x}`).join("\n")}\n\n## Last evaluation snapshot\n${previousEvaluation.slice(0, 4000)}\n\n## Transcript excerpt\n${transcriptText}\n\n## Rep question\n${message.slice(0, 2000)}`;

  const reply = await chatCompletionWithOptions([{ role: "user", content: userMsg }], seller, {
    systemPrompt:
      "You are an in-call coach for the seller only (whisper/coach channel). Answer in 2–6 sentences: concrete guidance referencing the brief and runbook. No role-play dialogue; coach voice only.",
    temperature: 0.25,
    maxTokens: 500,
  });

  return { ok: true, reply };
}

module.exports = {
  handleCallSetupSummary,
  handleCallSetupRunbook,
  handleRunbookCoach,
  handleSimCallTurn,
  handleDuringCallEval,
  handleDuringCallWhisper,
  handlePostCallDrafts,
  buildPartnerPack,
  buildCallSetupScopedPayload,
};
