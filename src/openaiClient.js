"use strict";

const OpenAI = require("openai");

const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

/**
 * Build context string from live ERP data
 * @param {object} snapshot - The ERP snapshot with live data
 * @returns {string}
 */
function buildContextFromSnapshot(snapshot) {
  if (!snapshot) {
    return "No ERP data available. This is a live system with real partner and order data.";
  }

  const lines = [];
  lines.push("### Live ERP Data");
  lines.push("");
  lines.push(`**Sales Rep**: ${snapshot.rep?.name || "Unknown"} (${snapshot.rep?.email || "unknown@example.com"})`);
  lines.push(`**Region**: ${snapshot.rep?.region || "—"}`);
  lines.push("");

  if (snapshot.partners?.length) {
    lines.push(`**Partners (${snapshot.partners.length} total)**`);
    snapshot.partners.slice(0, 10).forEach((p) => {
      lines.push(
        `- ${p.companyName} (${p.country}) - Level: ${p.distributorLevel} - Contact: ${p.contactName}`,
      );
    });
    if (snapshot.partners.length > 10) {
      lines.push(`... and ${snapshot.partners.length - 10} more partners`);
    }
    lines.push("");
  }

  if (snapshot.orders?.length) {
    lines.push(`**Orders (${snapshot.orders.length} total)**`);
    const recentOrders = snapshot.orders.sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 5);
    recentOrders.forEach((o) => {
      lines.push(`- ${o.company} (${o.date}): ${o.type} - $${o.totalUsd} (Status: ${o.status})`);
    });
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * @param {{ id?: string, name?: string, region?: string } | null | undefined} seller
 * @param {object} snapshot - Optional live ERP snapshot
 */
function buildSystemPrompt(seller, snapshot) {
  const context = buildContextFromSnapshot(snapshot);
  let userBlock = "";
  if (seller && seller.name) {
    const idLine = seller.id ? `Rep ID: ${seller.id}. ` : "";
    userBlock = `\n\n**Current user (sales rep)**\n${idLine}Name: ${seller.name}. Primary region: ${seller.region || "—"}. Treat questions as coming from this rep unless the user says otherwise.`;
  }
  return `You are the ONYX AI Sales Force Assistant: a concise, professional helper for sales reps who sell PBX phone system licenses and related services through distributors (partners/resellers). Support pre-call prep, in-call positioning, and post-call follow-up. Use the live ERP data below when relevant; if something is not in the data, say you do not have that information. Do not invent customer emails, license keys, or commercial terms beyond what is listed. Prefer bullet points for clarity when listing options.

${context}${userBlock}`;
}

/**
 * @param {Array<{ role: string, content: string }>} userFacingMessages
 * @param {{ id?: string, name?: string, region?: string } | null | undefined} seller
 * @param {object} snapshot - Optional live ERP snapshot
 * @returns {Promise<string>}
 */
async function chatCompletion(userFacingMessages, seller, snapshot) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const system = { role: "system", content: buildSystemPrompt(seller, snapshot) };
  const apiMessages = [system, ...userFacingMessages.map((m) => ({ role: m.role, content: m.content }))];

  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: apiMessages,
    temperature: 0.6,
    max_tokens: 1024,
  });

  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) {
    throw new Error("Empty response from model.");
  }
  return text;
}

/**
 * Generate a focused brief for a single reseller — used by the /erp page's
 * Insight bar. Avoids the full-corpus context from chatCompletion since
 * we only care about THIS partner's data.
 *
 * @param {object} partner - { row, detail?, callLog?, onyxNotes? }
 * @returns {Promise<string>}
 */
async function partnerInsight(partner) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const sys =
    "You are ONYX Insight: a concise sales-coaching brief generator for reps " +
    "selling PBX phone system licenses through a distributor. Given one " +
    "partner's data, produce a brief in three short paragraphs:\n" +
    "1) Current state — level, region, recent activity (1–2 lines).\n" +
    "2) Signals — anything worth knowing from keys/orders/notes/calls " +
    "(renewals due, large SC orders, missed calls, sentiment, etc.).\n" +
    "3) Suggested next action — one specific thing to do this week.\n" +
    "Be specific, no fluff, no hedging. If data is missing, say so briefly.";
  const user = `Partner data:\n\n\`\`\`json\n${JSON.stringify(partner, null, 2).slice(0, 8000)}\n\`\`\``;
  const completion = await client.chat.completions.create({
    model: MODEL,
    messages: [
      { role: "system", content: sys },
      { role: "user", content: user },
    ],
    temperature: 0.5,
    max_tokens: 500,
  });
  const text = completion.choices[0]?.message?.content?.trim();
  if (!text) throw new Error("Empty response from model.");
  return text;
}

module.exports = { chatCompletion, buildSystemPrompt, partnerInsight, MODEL };
