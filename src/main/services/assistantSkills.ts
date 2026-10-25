// Skills on disk, as slash commands for the Assistant. Only filesystem work and
// parsing live here, so it can be tested against a temp folder; which skills are
// switched on, and with which tools, is assistantCommands.ts.
//
// A skill is a folder holding SKILL.md (YAML-ish frontmatter with a `name` and
// `description`, then instructions). The Assistant has no shell or editor, so a
// skill can only be followed with the Assistant's own tools, and the files next
// to its SKILL.md are reached through `read_skill_file` — which is confined to
// that skill's folder.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const SKILL_NAME = /^[a-z0-9][a-z0-9_-]{0,63}$/i;
const SKILL_MAX_BYTES = 200 * 1024;
export const SKILL_BODY_MAX_CHARS = 30_000;
const FILE_MAX_BYTES = 200 * 1024;
const FILE_MAX_CHARS = 30_000;
const LIST_MAX = 100;
const SCAN_MAX = 500;

export function skillsDir(): string {
  return path.join(os.homedir(), ".agents", "skills");
}

export interface ParsedSkill {
  name?: string;
  description: string;
  body: string;
}

// Frontmatter is small and regular enough not to need a YAML dependency:
// `key: value`, or `key: |` / `key: >` / `key:` followed by indented lines.
export function parseSkillFile(text: string): ParsedSkill {
  const match = text.replace(/^﻿/, "").match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n([\s\S]*))?$/);
  if (!match) return { description: "", body: text.trim() };

  const fields: Record<string, string> = {};
  const lines = match[1].split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const kv = lines[i].match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const [, key, rest] = kv;
    if (rest === "" || /^[|>][+-]?$/.test(rest)) {
      const block: string[] = [];
      while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || lines[i + 1].trim() === "")) {
        block.push(lines[++i].trim());
      }
      fields[key] = block.join(" ").replace(/\s+/g, " ").trim();
    } else {
      fields[key] = rest.replace(/^(['"])(.*)\1$/, "$2").trim();
    }
  }
  return { name: fields.name, description: fields.description ?? "", body: (match[2] ?? "").trim() };
}

export interface SkillSummary {
  name: string;
  description: string;
}

// Every skill folder under the skills directory (symlinked folders included —
// that is how they are usually installed). A missing directory is just "none".
export async function scanSkills(dir: string = skillsDir()): Promise<SkillSummary[]> {
  let entries: string[];
  try {
    entries = await fs.promises.readdir(dir);
  } catch {
    return [];
  }
  const found: SkillSummary[] = [];
  for (const name of entries.sort().slice(0, SCAN_MAX)) {
    if (!SKILL_NAME.test(name)) continue;
    try {
      const file = path.join(dir, name, "SKILL.md");
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > SKILL_MAX_BYTES) continue;
      const { description } = parseSkillFile(await fs.promises.readFile(file, "utf8"));
      found.push({ name, description });
    } catch {
      // Not a skill folder.
    }
  }
  return found;
}

export async function readSkillBody(
  name: string,
  dir: string = skillsDir()
): Promise<{ ok: true; body: string; truncated: boolean } | { ok: false; reason: string }> {
  if (!SKILL_NAME.test(name)) return { ok: false, reason: "Not a valid skill name" };
  try {
    const file = path.join(dir, name, "SKILL.md");
    const stat = await fs.promises.stat(file);
    if (!stat.isFile() || stat.size > SKILL_MAX_BYTES) return { ok: false, reason: "That skill file is too large" };
    const { body } = parseSkillFile(await fs.promises.readFile(file, "utf8"));
    if (!body) return { ok: false, reason: "That skill has no instructions" };
    return body.length > SKILL_BODY_MAX_CHARS
      ? { ok: true, body: body.slice(0, SKILL_BODY_MAX_CHARS), truncated: true }
      : { ok: true, body, truncated: false };
  } catch {
    return { ok: false, reason: "That skill couldn't be read" };
  }
}

export type SkillFileResult =
  | { ok: true; content: string; truncated: boolean }
  | { ok: true; files: string[] }
  | { ok: false; reason: string };

// A file inside one skill's folder, or (for a folder / blank path) its listing.
// Both the folder and the target are resolved through symlinks first and the
// target must still be under the folder, so `..` and an escaping symlink both
// fail. Text only, bounded.
export async function readSkillFile(
  name: string,
  relative: string,
  dir: string = skillsDir()
): Promise<SkillFileResult> {
  if (!SKILL_NAME.test(name)) return { ok: false, reason: "Not a valid skill name" };
  if (relative.includes("\0") || path.isAbsolute(relative)) {
    return { ok: false, reason: "Use a path relative to the skill's folder" };
  }
  try {
    const root = await fs.promises.realpath(path.join(dir, name));
    const target = await fs.promises.realpath(path.resolve(root, relative || "."));
    if (target !== root && !target.startsWith(root + path.sep)) {
      return { ok: false, reason: "That path is outside the skill's folder" };
    }
    const stat = await fs.promises.stat(target);
    if (stat.isDirectory()) {
      const names = (await fs.promises.readdir(target, { withFileTypes: true }))
        .map((e) => (e.isDirectory() ? `${e.name}/` : e.name))
        .sort();
      return { ok: true, files: names.slice(0, LIST_MAX) };
    }
    if (!stat.isFile()) return { ok: false, reason: "That isn't a file" };
    if (stat.size > FILE_MAX_BYTES) return { ok: false, reason: "That file is too large" };
    const text = await fs.promises.readFile(target, "utf8");
    if (text.slice(0, 2000).includes("\0")) return { ok: false, reason: "That file isn't text" };
    return text.length > FILE_MAX_CHARS
      ? { ok: true, content: text.slice(0, FILE_MAX_CHARS), truncated: true }
      : { ok: true, content: text, truncated: false };
  } catch {
    return { ok: false, reason: "No such file in that skill" };
  }
}
