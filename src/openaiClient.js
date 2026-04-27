"use strict";

const OpenAI = require("openai");
const { getMockContextString } = require("./mock/context");

const MODEL = process.env.OPENAI_MODEL || "gpt-4.1-mini";

/**
 * @param {{ id?: string, name?: string, region?: string } | null | undefined} seller
 */
function buildSystemPrompt(seller) {
  const context = getMockContextString();
  let userBlock = "";
  if (seller && seller.name) {
    const idLine = seller.id ? `Rep ID: ${seller.id}. ` : "";
    userBlock = `\n\n**Current user (sales rep)**\n${idLine}Name: ${seller.name}. Primary region: ${seller.region || "—"}. Treat questions as coming from this rep unless the user says otherwise.`;
  }
  return `You are the ONYX AI Sales Force Assistant: a concise, professional helper for reps who sell PBX phone system licenses and related services through distributors (partners/resellers). Support pre-call prep, in-call positioning, and post-call follow-up. Use the mock ERP/CRM data below when relevant; if something is not in the data, say you do not have that information in this demo dataset. Do not invent customer emails, license keys, or commercial terms beyond what is listed. Prefer bullet points for clarity when listing options.

${context}${userBlock}`;
}

/**
 * @param {Array<{ role: string, content: string }>} userFacingMessages
 * @param {{ id?: string, name?: string, region?: string } | null | undefined} seller
 * @returns {Promise<string>}
 */
async function chatCompletion(userFacingMessages, seller) {
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const system = { role: "system", content: buildSystemPrompt(seller) };
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

module.exports = { chatCompletion, buildSystemPrompt, MODEL };
