"use strict";

/**
 * Unified AI provider — Anthropic Claude + OpenAI.
 *
 * Usage:
 *   const { chat } = require("./aiProvider");
 *   const reply = await chat({
 *     system: "You are a sales assistant…",
 *     messages: [{ role: "user", content: "…" }],
 *     provider: "anthropic",            // or "openai", or undefined to auto-pick
 *     model: "claude-opus-4-7",         // optional override
 *     maxTokens: 1500,
 *   });
 *
 * Auto-pick: prefers ANTHROPIC_API_KEY if both keys are set; falls back to
 * whichever is present. Throws if neither is configured.
 *
 * The shape of `messages` follows the OpenAI convention
 * ({ role: "user"|"assistant", content: string }) regardless of provider —
 * Anthropic's separate `system` parameter is handled internally.
 */

const DEFAULT_MODELS = {
  anthropic: process.env.ANTHROPIC_MODEL || "claude-opus-4-5",
  openai:    process.env.OPENAI_MODEL    || "gpt-4o-mini",
};

function pickProvider(requested) {
  const hasA = !!process.env.ANTHROPIC_API_KEY;
  const hasO = !!process.env.OPENAI_API_KEY;
  if (requested === "anthropic") {
    if (!hasA) throw new Error("ANTHROPIC_API_KEY not configured");
    return "anthropic";
  }
  if (requested === "openai") {
    if (!hasO) throw new Error("OPENAI_API_KEY not configured");
    return "openai";
  }
  if (requested === "claude") return pickProvider("anthropic");
  if (requested === "gpt" || requested === "chatgpt") return pickProvider("openai");
  if (hasA) return "anthropic";
  if (hasO) return "openai";
  throw new Error("No AI provider configured (set ANTHROPIC_API_KEY or OPENAI_API_KEY)");
}

async function callAnthropic({ system, messages, model, maxTokens }) {
  // Lazy require so the SDK is only loaded when used.
  const Anthropic = require("@anthropic-ai/sdk").default;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const response = await client.messages.create({
    model: model || DEFAULT_MODELS.anthropic,
    max_tokens: maxTokens || 1500,
    system: system || undefined,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  // Concatenate text blocks; ignore tool_use etc. for now.
  const text = (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return {
    text,
    provider: "anthropic",
    model: response.model,
    usage: response.usage,
  };
}

async function callOpenAI({ system, messages, model, maxTokens }) {
  const OpenAI = require("openai").default || require("openai");
  const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  const fullMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;
  const response = await client.chat.completions.create({
    model: model || DEFAULT_MODELS.openai,
    max_tokens: maxTokens || 1500,
    messages: fullMessages,
  });
  return {
    text: response.choices?.[0]?.message?.content || "",
    provider: "openai",
    model: response.model,
    usage: response.usage,
  };
}

async function chat(opts = {}) {
  const provider = pickProvider(opts.provider);
  const args = {
    system: opts.system,
    messages: Array.isArray(opts.messages) ? opts.messages : [],
    model: opts.model,
    maxTokens: opts.maxTokens,
  };
  if (provider === "anthropic") return callAnthropic(args);
  return callOpenAI(args);
}

function availableProviders() {
  const list = [];
  if (process.env.ANTHROPIC_API_KEY) list.push({ id: "anthropic", label: "Claude", model: DEFAULT_MODELS.anthropic });
  if (process.env.OPENAI_API_KEY)    list.push({ id: "openai",    label: "ChatGPT", model: DEFAULT_MODELS.openai });
  return list;
}

module.exports = { chat, pickProvider, availableProviders, DEFAULT_MODELS };
