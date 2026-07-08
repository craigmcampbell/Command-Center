// Reads directly from the Obsidian vault on disk. No plugin or API needed —
// Obsidian notes are just markdown files, so we read them like any text file.

import fs from "node:fs";
import path from "node:path";
import type { GrimoireConfig, DailyNoteResult, MissionsResult } from "../../shared/types";

const DAILY_NOTE_NAME = /^(\d{4}-\d{2}-\d{2})\.md$/;

function todayDateString(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Obsidian has no separate "display name" for a vault — it's just the
// folder's basename — so this deep link works without any extra config.
// relativePath is relative to the vault root, without the .md extension.
function obsidianUriFor(vaultPath: string, relativePath: string): string {
  const vaultName = path.basename(vaultPath);
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(relativePath)}`;
}

function cleanTag(raw: string): string {
  return raw.trim().replace(/^["']|["']$/g, "").replace(/^#/, "");
}

// Reads the "tags" field out of a note's YAML frontmatter. Handles the
// common forms Obsidian writes: inline array (`tags: [a, b]`), inline list
// (`tags: a, b`), and multi-line list (`tags:` followed by `- a` lines).
// Not a full YAML parser — good enough for a personal vault's frontmatter.
function parseFrontmatterTags(content: string): string[] {
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fmMatch) return [];
  const lines = fmMatch[1].split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const tagsMatch = lines[i].match(/^tags:\s*(.*)$/);
    if (!tagsMatch) continue;

    const inline = tagsMatch[1].trim();
    if (inline.startsWith("[")) {
      return inline
        .replace(/^\[|\]$/g, "")
        .split(",")
        .map(cleanTag)
        .filter(Boolean);
    }
    if (inline) {
      return inline.split(",").map(cleanTag).filter(Boolean);
    }

    const tags: string[] = [];
    for (let j = i + 1; j < lines.length; j++) {
      const itemMatch = lines[j].match(/^\s*-\s*(.+)$/);
      if (!itemMatch) break;
      tags.push(cleanTag(itemMatch[1]));
    }
    return tags;
  }
  return [];
}

// Every other daily note that actually exists on disk, sorted chronologically —
// lets prev/next navigation skip straight over days with no note.
function listDailyNoteDates(vaultPath: string, dailyLogDir: string): string[] {
  const dir = path.join(vaultPath, dailyLogDir);
  try {
    return fs
      .readdirSync(dir, { withFileTypes: true })
      .filter((e) => e.isFile() && DAILY_NOTE_NAME.test(e.name))
      .map((e) => e.name.replace(/\.md$/, ""))
      .sort();
  } catch {
    return [];
  }
}

export function readDailyNote(
  { vaultPath, dailyLogDir }: GrimoireConfig,
  dateStr?: string
): DailyNoteResult {
  const date = dateStr || todayDateString();
  const file = path.join(vaultPath, dailyLogDir, `${date}.md`);

  const dates = listDailyNoteDates(vaultPath, dailyLogDir);
  const prevDate = [...dates].reverse().find((d) => d < date) || null;
  const nextDate = dates.find((d) => d > date) || null;

  const obsidianUri = obsidianUriFor(vaultPath, path.join(dailyLogDir, date));

  try {
    const content = fs.readFileSync(file, "utf8");
    return { ok: true, file, content, date, prevDate, nextDate, obsidianUri };
  } catch {
    return {
      ok: false,
      file,
      reason: date === todayDateString() ? "No note for today yet" : "No note for this day",
      content: "",
      date,
      prevDate,
      nextDate,
      obsidianUri,
    };
  }
}

export function listMissions({ vaultPath, missionsDir }: GrimoireConfig): MissionsResult {
  const dir = path.join(vaultPath, missionsDir);
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const missions = entries
      .filter((e) => e.isFile() && e.name.endsWith(".md"))
      .map((e) => {
        const full = path.join(dir, e.name);
        const stat = fs.statSync(full);
        const name = e.name.replace(/\.md$/, "");
        let tags: string[] = [];
        try {
          tags = parseFrontmatterTags(fs.readFileSync(full, "utf8"));
        } catch {
          // fine — just no tags to show
        }
        return {
          name,
          path: full,
          modified: stat.mtimeMs,
          obsidianUri: obsidianUriFor(vaultPath, path.join(missionsDir, name)),
          tags,
        };
      })
      .sort((a, b) => b.modified - a.modified);
    return { ok: true, missions };
  } catch {
    return { ok: false, reason: "Missions folder not found", missions: [] };
  }
}
