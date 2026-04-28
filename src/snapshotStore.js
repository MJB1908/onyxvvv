"use strict";

const fs = require("fs");
const path = require("path");

const SNAPSHOT_DIR = process.env.ONYX_SNAPSHOT_DIR
  ? path.resolve(process.env.ONYX_SNAPSHOT_DIR)
  : path.join(__dirname, "..", "data", "snapshots");

let snapshotListCache = null;
let cacheTime = 0;
const CACHE_TTL = 5000; // 5 seconds

function ensureDir() {
  fs.mkdirSync(SNAPSHOT_DIR, { recursive: true });
}

function slugifyEmail(email) {
  return String(email || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function snapshotPath(repEmail) {
  const slug = slugifyEmail(repEmail);
  if (!slug) throw new Error("Invalid rep email");
  return { slug, file: path.join(SNAPSHOT_DIR, `${slug}.json`) };
}

function saveSnapshot(repEmail, snapshot) {
  ensureDir();
  const { slug, file } = snapshotPath(repEmail);
  const enriched = {
    ...snapshot,
    rep: { ...(snapshot.rep || {}), email: repEmail, slug },
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(file, JSON.stringify(enriched, null, 2));
  snapshotListCache = null; // Invalidate cache
  return enriched;
}

function savePartnerDetail(repEmail, partnerId, detail) {
  ensureDir();
  const { file } = snapshotPath(repEmail);
  if (!fs.existsSync(file)) {
    throw new Error("No snapshot exists for this rep — run a full refresh first");
  }
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  snapshot.details = snapshot.details || {};
  snapshot.details[partnerId] = {
    ...detail,
    fetchedAt: new Date().toISOString(),
  };
  snapshot.updatedAt = new Date().toISOString();
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  snapshotListCache = null; // Invalidate cache
  return snapshot.details[partnerId];
}

function loadSnapshot(repEmail) {
  try {
    const { file } = snapshotPath(repEmail);
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function loadSnapshotBySlug(slug) {
  const sanitized = String(slug || "").replace(/[^a-z0-9_]/gi, "");
  if (!sanitized || sanitized.length === 0) return null;

  const file = path.join(SNAPSHOT_DIR, `${sanitized}.json`);
  // Prevent directory traversal
  if (!file.startsWith(SNAPSHOT_DIR)) return null;

  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function appendCallLog(repEmail, entry) {
  ensureDir();
  const { file } = snapshotPath(repEmail);
  if (!fs.existsSync(file)) {
    throw new Error("No snapshot exists for this rep — run a full refresh first");
  }
  const snapshot = JSON.parse(fs.readFileSync(file, "utf8"));
  snapshot.callLog = snapshot.callLog || [];
  const stored = {
    id: `cl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    receivedAt: new Date().toISOString(),
    ...entry,
  };
  snapshot.callLog.push(stored);
  // Cap to keep file size sane.
  if (snapshot.callLog.length > 5000) {
    snapshot.callLog = snapshot.callLog.slice(-5000);
  }
  fs.writeFileSync(file, JSON.stringify(snapshot, null, 2));
  snapshotListCache = null; // Invalidate cache
  return stored;
}

function listSnapshots() {
  ensureDir();
  const now = Date.now();

  // Return cached list if still fresh
  if (snapshotListCache && now - cacheTime < CACHE_TTL) {
    return snapshotListCache;
  }

  const result = fs
    .readdirSync(SNAPSHOT_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        const s = JSON.parse(fs.readFileSync(path.join(SNAPSHOT_DIR, f), "utf8"));
        return {
          slug: f.replace(/\.json$/, ""),
          email: s.rep?.email || null,
          name: s.rep?.name || null,
          updatedAt: s.updatedAt,
          partnerCount: Array.isArray(s.partners) ? s.partners.length : 0,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  snapshotListCache = result;
  cacheTime = now;
  return result;
}

module.exports = {
  slugifyEmail,
  saveSnapshot,
  savePartnerDetail,
  appendCallLog,
  loadSnapshot,
  loadSnapshotBySlug,
  listSnapshots,
};
