"use strict";

const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = process.env.ONYX_SETTINGS_FILE
  ? path.resolve(process.env.ONYX_SETTINGS_FILE)
  : path.join(__dirname, "..", "data", "settings.json");

const DEFAULT_SETTINGS = {
  // AI
  aiProviderPreference: "auto",       // "auto" | "anthropic" | "openai"
  anthropicModel: "claude-opus-4-5",
  openaiModel: "gpt-4o-mini",
  openaiTemperature: 0.6,
  openaiMaxTokens: 1024,

  // PRM dashboard defaults
  prmDefaultTier: "all",              // "all" | "Titanium" | "Platinum" | …
  prmDefaultSort: "company",          // "company" | "country" | "level" | "agent"

  version: "2.0",
};

function ensureDir() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
}

function loadSettings() {
  try {
    const content = fs.readFileSync(SETTINGS_FILE, "utf8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
  } catch (e) {
    if (e.code === "ENOENT") return { ...DEFAULT_SETTINGS };
    console.error("Error loading settings:", e.message);
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(updates) {
  ensureDir();
  const current = loadSettings();
  // Whitelist allowed fields so the public endpoint can't write arbitrary keys
  const allowed = [
    "aiProviderPreference",
    "anthropicModel",
    "openaiModel",
    "openaiTemperature",
    "openaiMaxTokens",
    "prmDefaultTier",
    "prmDefaultSort",
  ];
  const sanitized = Object.fromEntries(
    Object.entries(updates).filter(([k]) => allowed.includes(k))
  );
  const updated = { ...current, ...sanitized, version: "2.0" };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

module.exports = {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
};
