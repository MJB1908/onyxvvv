"use strict";

/**
 * Skill loader for vendored Anthropic plugins (sales, marketing, …).
 *
 * Reads SKILL.md files from src/skills/<plugin>/skills/<skill>/SKILL.md and
 * commands/<command>.md, exposing them as plain strings. The strings are
 * meant to be injected as the `system` parameter on a chat call when the
 * matching workflow runs.
 *
 * The plugin format is documented at:
 *   https://github.com/anthropics/knowledge-work-plugins
 *
 * Vendor it with:
 *   git submodule add https://github.com/anthropics/knowledge-work-plugins \
 *     vendor/knowledge-work-plugins
 *   ln -s ../vendor/knowledge-work-plugins/sales src/skills/sales
 *
 * Or shallow-clone the `sales/` subtree into src/skills/sales. Either way,
 * SKILL.md files will be picked up at boot. Falls back to an empty string
 * if a file is missing — endpoints stay live, just with less context.
 */

const fs = require("node:fs");
const path = require("node:path");

const SKILLS_ROOT = path.join(__dirname, "skills");

// Strip frontmatter — the public sales plugin uses YAML frontmatter for the
// skill metadata block. We pass the body to the LLM, not the metadata.
function stripFrontmatter(md) {
  if (!md.startsWith("---")) return md;
  const end = md.indexOf("\n---", 3);
  if (end === -1) return md;
  return md.slice(end + 4).replace(/^\s*\n/, "");
}

function readIfExists(filePath) {
  try {
    return stripFrontmatter(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") console.warn(`[skillLoader] read ${filePath} failed:`, err.message);
    return "";
  }
}

function loadPluginSkills(pluginName) {
  const skillsDir = path.join(SKILLS_ROOT, pluginName, "skills");
  const commandsDir = path.join(SKILLS_ROOT, pluginName, "commands");
  const skills = {};
  const commands = {};

  if (fs.existsSync(skillsDir)) {
    for (const dir of fs.readdirSync(skillsDir, { withFileTypes: true })) {
      if (!dir.isDirectory()) continue;
      const skillPath = path.join(skillsDir, dir.name, "SKILL.md");
      const content = readIfExists(skillPath);
      if (content) skills[dir.name] = content;
    }
  }
  if (fs.existsSync(commandsDir)) {
    for (const file of fs.readdirSync(commandsDir)) {
      if (!file.endsWith(".md")) continue;
      const content = readIfExists(path.join(commandsDir, file));
      if (content) commands[file.replace(/\.md$/, "")] = content;
    }
  }
  return { skills, commands };
}

const cache = {
  sales: loadPluginSkills("sales"),
};

function getSkill(plugin, name) {
  return cache[plugin]?.skills?.[name] || "";
}

function getCommand(plugin, name) {
  return cache[plugin]?.commands?.[name] || "";
}

/**
 * Compose a system prompt by concatenating one or more skills with a small
 * preamble. The skills are vendored markdown verbatim; the preamble keeps
 * them grounded in the onyxvvv context (3CX reseller, partner ID, seller
 * name).
 */
function composeSystem({ plugin = "sales", skills = [], commands = [], preamble = "" }) {
  const parts = [];
  if (preamble) parts.push(preamble.trim());
  for (const s of skills) {
    const body = getSkill(plugin, s);
    if (body) parts.push(`# Skill: ${s}\n\n${body}`);
  }
  for (const c of commands) {
    const body = getCommand(plugin, c);
    if (body) parts.push(`# Command: ${c}\n\n${body}`);
  }
  return parts.join("\n\n---\n\n");
}

function reload(plugin) {
  cache[plugin] = loadPluginSkills(plugin);
}

function listLoaded() {
  const out = {};
  for (const [plugin, { skills, commands }] of Object.entries(cache)) {
    out[plugin] = {
      skills: Object.keys(skills),
      commands: Object.keys(commands),
    };
  }
  return out;
}

module.exports = { getSkill, getCommand, composeSystem, reload, listLoaded };
