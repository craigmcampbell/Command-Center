// Reads directly from the Obsidian vault on disk. No plugin or API needed —
// Obsidian notes are just markdown files, so we read them like any text file.

import fs from "node:fs";
import path from "node:path";
import type { GrimoireConfig, DailyNoteResult, MissionsResult } from "../../shared/types";

// Obsidian daily notes are conventionally named YYYY-MM-DD.md.
function todayFilename(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}.md`;
}

export function readDailyNote({ vaultPath, dailyLogDir }: GrimoireConfig): DailyNoteResult {
  const file = path.join(vaultPath, dailyLogDir, todayFilename());
  try {
    const content = fs.readFileSync(file, "utf8");
    return { ok: true, file, content };
  } catch {
    return {
      ok: false,
      file,
      reason: "No note for today yet",
      content: "",
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
        return {
          name: e.name.replace(/\.md$/, ""),
          path: full,
          modified: stat.mtimeMs,
        };
      })
      .sort((a, b) => b.modified - a.modified);
    return { ok: true, missions };
  } catch {
    return { ok: false, reason: "Missions folder not found", missions: [] };
  }
}
