"use strict";

/**
 * Unified AI provider — Anthropic Claude + OpenAI.
 *
 * Key resolution (in order):
 *   1. Explicit override on the request: `apiKey` field
 *   2. secretsStore (UI-set, encrypted on disk)
 *   3. process.env (deployment-platform-set)
 *
 * Model resolution:
 *   1. Request's `model` field
 *   2. settingsStore (UI-set)
 *   3. process.env.{ANTHROPIC,OPENAI}_MODEL
 *   4. Hardcoded defaults
 */

const secretsStore = require("./secretsStore");
const settingsStore = require("./settingsStore");

const HARD_DEFAULTS = {
  anthropic: "claude-opus-4-5",
  openai: "gpt-4o-mini",
};

function getApiKey(provider) {
  if (provider === "anthropic") {
    return secretsStore.getSecret("anthropicApiKey") || process.env.ANTHROPIC_API_KEY || null;
  }
  if (provider === "openai") {
    return secretsStore.getSecret("openaiApiKey") || process.env.OPENAI_API_KEY || null;
  }
  return null;
}

function getDefaultModel(provider) {
  const settings = settingsStore.loadSettings();
  if (provider === "anthropic") {
    return settings.anthropicModel || process.env.ANTHROPIC_MODEL || HARD_DEFAULTS.anthropic;
  }
  if (provider === "openai") {
    return settings.openaiModel || process.env.OPENAI_MODEL || HARD_DEFAULTS.openai;
  }
  return null;
}

function pickProvider(requested) {
  const hasA = !!getApiKey("anthropic");
  const hasO = !!getApiKey("openai");

  if (requested === "anthropic" || requested === "claude") {
    if (!hasA) throw new Error("Anthropic API key not configured (set in Settings or ANTHROPIC_API_KEY env var)");
    return "anthropic";
  }
  if (requested === "openai" || requested === "gpt" || requested === "chatgpt") {
    if (!hasO) throw new Error("OpenAI API key not configured (set in Settings or OPENAI_API_KEY env var)");
    return "openai";
  }

  // Auto-pick: respect the user's preference, fall back to whichever is set
  const preferred = settingsStore.loadSettings().aiProviderPreference;
  if (preferred === "anthropic" && hasA) return "anthropic";
  if (preferred === "openai" && hasO) return "openai";

  if (hasA) return "anthropic";
  if (hasO) return "openai";
  throw new Error("No AI provider configured. Open Settings to add an Anthropic or OpenAI API key.");
}

async function callAnthropic({ system, messages, model, maxTokens }) {
  const Anthropic = require("@anthropic-ai/sdk").default;
  const client = new Anthropic({ apiKey: getApiKey("anthropic") });
  const response = await client.messages.create({
    model: model || getDefaultModel("anthropic"),
    max_tokens: maxTokens || 1500,
    system: system || undefined,
    messages: messages.map((m) => ({ role: m.role, content: m.content })),
  });
  const text = (response.content || [])
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");
  return { text, provider: "anthropic", model: response.model, usage: response.usage };
}

async function callOpenAI({ system, messages, model, maxTokens }) {
  const OpenAI = require("openai").default || require("openai");
  const client = new OpenAI({ apiKey: getApiKey("openai") });
  const fullMessages = system
    ? [{ role: "system", content: system }, ...messages]
    : messages;
  const response = await client.chat.completions.create({
    model: model || getDefaultModel("openai"),
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
  return (provider === "anthropic" ? callAnthropic : callOpenAI)({
    system: opts.system,
    messages: Array.isArray(opts.messages) ? opts.messages : [],
    model: opts.model,
    maxTokens: opts.maxTokens,
  });
}

function availableProviders() {
  const list = [];
  if (getApiKey("anthropic")) list.push({ id: "anthropic", label: "Claude", model: getDefaultModel("anthropic") });
  if (getApiKey("openai"))    list.push({ id: "openai",    label: "ChatGPT", model: getDefaultModel("openai") });
  return list;
}

/**
 * Validate an API key by hitting the provider with a minimal request.
 * Used by Settings before persisting a UI-entered key.
 */
async function validateApiKey(provider, apiKey) {
  if (!apiKey || apiKey.length < 8) throw new Error("API key too short");
  if (provider === "anthropic") {
    const Anthropic = require("@anthropic-ai/sdk").default;
    const client = new Anthropic({ apiKey });
    // Cheapest sanity check: 1-token completion on the cheapest model
    await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 1,
      messages: [{ role: "user", content: "hi" }],
    });
    return { ok: true };
  }
  if (provider === "openai") {
    const OpenAI = require("openai").default || require("openai");
    const client = new OpenAI({ apiKey });
    // List models is the canonical "is this key valid" call — no token cost
    await client.models.list();
    return { ok: true };
  }
  throw new Error(`Unknown provider: ${provider}`);
}

const AVAILABLE_MODELS = {
  anthropic: [
    { id: "claude-opus-4-7",   name: "Claude Opus 4.7 (most capable)" },
    { id: "claude-opus-4-5",   name: "Claude Opus 4.5" },
    { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6 (balanced)" },
    { id: "claude-haiku-4-5",  name: "Claude Haiku 4.5 (fast & cheap)" },
  ],
  openai: [
    { id: "gpt-4o",      name: "GPT-4o (balanced)" },
    { id: "gpt-4o-mini", name: "GPT-4o mini (fast & cheap)" },
    { id: "gpt-4-turbo", name: "GPT-4 Turbo" },
  ],
};

module.exports = {
  chat,
  pickProvider,
  availableProviders,
  validateApiKey,
  getApiKey,
  getDefaultModel,
  AVAILABLE_MODELS,
  HARD_DEFAULTS,
};
