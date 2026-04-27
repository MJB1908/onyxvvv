"use strict";

const fs = require("fs");
const path = require("path");

const SNAPSHOT_DIR = path.join(__dirname, "..", "data", "snapshots");

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
  return enriched;
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
  const file = path.join(SNAPSHOT_DIR, `${slug.replace(/[^a-z0-9_]/gi, "")}.json`);
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    throw e;
  }
}

function listSnapshots() {
  ensureDir();
  return fs
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
}

module.exports = {
  slugifyEmail,
  saveSnapshot,
  loadSnapshot,
  loadSnapshotBySlug,
  listSnapshots,
};
