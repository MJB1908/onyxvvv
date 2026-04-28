"use strict";

const fs = require("fs");
const path = require("path");

const SETTINGS_FILE = process.env.ONYX_SETTINGS_FILE
  ? path.resolve(process.env.ONYX_SETTINGS_FILE)
  : path.join(__dirname, "..", "data", "settings.json");

const DEFAULT_SETTINGS = {
  openaiModel: "gpt-4o-mini",
  openaiTemperature: 0.6,
  openaiMaxTokens: 1024,
  version: "1.0",
};

const AVAILABLE_MODELS = [
  { id: "gpt-4o-mini", name: "GPT-4o Mini (fast, cost-effective)" },
  { id: "gpt-4o", name: "GPT-4o (balanced)" },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo (powerful)" },
];

function ensureDir() {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true });
}

function loadSettings() {
  try {
    const content = fs.readFileSync(SETTINGS_FILE, "utf8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(content) };
  } catch (e) {
    if (e.code === "ENOENT") return DEFAULT_SETTINGS;
    console.error("Error loading settings:", e.message);
    return DEFAULT_SETTINGS;
  }
}

function saveSettings(updates) {
  ensureDir();
  const current = loadSettings();
  const updated = { ...current, ...updates, version: "1.0" };
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2));
  return updated;
}

module.exports = {
  loadSettings,
  saveSettings,
  DEFAULT_SETTINGS,
  AVAILABLE_MODELS,
};
