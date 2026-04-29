"use strict";

/**
 * Encrypted secrets store for runtime API keys.
 *
 * Why this exists:
 *   API keys live in process.env by default — operations layer concern.
 *   But the user wants to set them from the Settings UI without redeploying.
 *   Writing plaintext keys to disk is an instant security regression.
 *   So: AES-256-GCM with a key derived from ONYX_SECRET_KEY env var.
 *   If ONYX_SECRET_KEY isn't set, this module REFUSES to store secrets —
 *   better to fail loudly than encrypt with a hardcoded default.
 *
 * Lookup order (the consumer is aiProvider.js):
 *   1. Explicit override on the request (least surprising)
 *   2. This store (UI-set, persists across restarts)
 *   3. process.env (deployment-platform-set)
 *
 * On-disk format:
 *   data/secrets.json — JSON object, mode 0600, gitignored.
 *   {
 *     "anthropicApiKey": { "iv": "...", "tag": "...", "ct": "..." },
 *     "openaiApiKey":    { "iv": "...", "tag": "...", "ct": "..." },
 *     "kdfSalt": "...",
 *     "updatedAt": "..."
 *   }
 *
 * Threat model:
 *   • Attacker with read access to data/ but not the env: can't decrypt.
 *   • Attacker with both: game over (same as any encrypted-on-disk scheme
 *     where the key sits next to the cipher). Use proper KMS for prod.
 */

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

const SECRETS_FILE = process.env.ONYX_SECRETS_FILE
  ? path.resolve(process.env.ONYX_SECRETS_FILE)
  : path.join(__dirname, "..", "data", "secrets.json");

const ALGO = "aes-256-gcm";
const KEY_LEN = 32;
const IV_LEN = 12;

const SUPPORTED_KEYS = new Set(["anthropicApiKey", "openaiApiKey"]);

// ── KDF ──────────────────────────────────────────────────────────────────────
function getMasterKey(salt) {
  const secret = process.env.ONYX_SECRET_KEY;
  if (!secret || secret.length < 16) {
    throw new Error(
      "ONYX_SECRET_KEY env var must be set (>= 16 chars) to write secrets. " +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
    );
  }
  return crypto.scryptSync(secret, salt, KEY_LEN);
}

// ── On-disk read / write ─────────────────────────────────────────────────────
function ensureDir() {
  fs.mkdirSync(path.dirname(SECRETS_FILE), { recursive: true });
}

function readFile() {
  try {
    return JSON.parse(fs.readFileSync(SECRETS_FILE, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    console.warn("[secretsStore] read failed:", e.message);
    return null;
  }
}

function writeFile(data) {
  ensureDir();
  // Write to a tmp file then rename — atomic, mode 0600.
  const tmp = SECRETS_FILE + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, SECRETS_FILE);
  try { fs.chmodSync(SECRETS_FILE, 0o600); } catch { /* best-effort */ }
}

// ── Crypto primitives ────────────────────────────────────────────────────────
function encrypt(plaintext, salt) {
  const key = getMasterKey(Buffer.from(salt, "hex"));
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), tag: tag.toString("hex"), ct: ct.toString("hex") };
}

function decrypt(blob, salt) {
  const key = getMasterKey(Buffer.from(salt, "hex"));
  const iv = Buffer.from(blob.iv, "hex");
  const tag = Buffer.from(blob.tag, "hex");
  const ct = Buffer.from(blob.ct, "hex");
  const decipher = crypto.createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return pt.toString("utf8");
}

// ── Public API ───────────────────────────────────────────────────────────────
function getSecret(name) {
  if (!SUPPORTED_KEYS.has(name)) return null;
  const data = readFile();
  if (!data || !data[name] || !data.kdfSalt) return null;
  try {
    return decrypt(data[name], data.kdfSalt);
  } catch (e) {
    console.warn(`[secretsStore] decrypt ${name} failed (probably ONYX_SECRET_KEY changed):`, e.message);
    return null;
  }
}

function setSecret(name, value) {
  if (!SUPPORTED_KEYS.has(name)) throw new Error(`Unsupported secret: ${name}`);
  if (!value || typeof value !== "string" || value.length < 8) {
    throw new Error("API key must be at least 8 characters");
  }
  let data = readFile() || {};
  if (!data.kdfSalt) data.kdfSalt = crypto.randomBytes(16).toString("hex");
  data[name] = encrypt(value, data.kdfSalt);
  data.updatedAt = new Date().toISOString();
  writeFile(data);
  return { ok: true, last4: value.slice(-4), updatedAt: data.updatedAt };
}

function removeSecret(name) {
  if (!SUPPORTED_KEYS.has(name)) throw new Error(`Unsupported secret: ${name}`);
  const data = readFile();
  if (!data || !data[name]) return { ok: true, removed: false };
  delete data[name];
  data.updatedAt = new Date().toISOString();
  writeFile(data);
  return { ok: true, removed: true };
}

/**
 * Per-provider status for the Settings UI.
 * source: "store" (UI-set) | "env" (process.env) | "none"
 * last4: last 4 chars of the configured key (or null)
 */
function status() {
  const out = {};
  const data = readFile() || {};
  for (const provider of ["anthropic", "openai"]) {
    const storeKey = provider + "ApiKey";
    const envKey = provider.toUpperCase() + "_API_KEY";
    let source = "none", last4 = null;
    if (data[storeKey]) {
      try {
        const v = decrypt(data[storeKey], data.kdfSalt);
        source = "store";
        last4 = v.slice(-4);
      } catch { /* fall through to env */ }
    }
    if (source === "none" && process.env[envKey]) {
      source = "env";
      last4 = process.env[envKey].slice(-4);
    }
    out[provider] = {
      source,
      last4,
      envVar: envKey,
      updatedAt: source === "store" ? data.updatedAt : null,
    };
  }
  return out;
}

/**
 * Whether ONYX_SECRET_KEY is configured (for UI to gate the Save button).
 */
function masterKeyAvailable() {
  const k = process.env.ONYX_SECRET_KEY;
  return !!(k && k.length >= 16);
}

module.exports = { getSecret, setSecret, removeSecret, status, masterKeyAvailable };
