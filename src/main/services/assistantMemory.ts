// The Assistant's memory: a markdown file of dated one-line facts. Lives in the
// app data folder by default, or at `assistant.memoryPath` (e.g. inside an
// Obsidian vault, so it can be read and edited there too).
//
// The file is read ONCE when a chat starts and baked into that chat's system
// prompt (see services/assistant.ts), so writes here never change a running
// conversation — they show up from the next new one.

import { app } from "electron";
import fs from "node:fs";
import path from "node:path";
import type { AssistantMemoryResult } from "../../shared/types";
import { cleanFact } from "./assistantTranscript";
import { getAssistantSettings } from "./settings";

export const MEMORY_MAX_BYTES = 16 * 1024;
// `forget` refuses to delete more than this many lines in one call: a vague
// fragment like "the" would otherwise be a one-shot way to wipe the file.
export const FORGET_MAX_LINES = 5;
export const FORGET_MIN_FRAGMENT = 3;

export function localDate(): string {
  // en-CA formats as YYYY-MM-DD in the local timezone, unlike toISOString().
  return new Date().toLocaleDateString("en-CA");
}

function memoryFile(): string {
  const custom = getAssistantSettings().memoryPath?.trim();
  return custom || path.join(app.getPath("userData"), "assistant-memory.md");
}

export function readMemoryFile(): string {
  try {
    return fs.readFileSync(memoryFile(), "utf8");
  } catch {
    return "";
  }
}

export function getAssistantMemory(): AssistantMemoryResult {
  const file = memoryFile();
  try {
    return { ok: true, content: fs.readFileSync(file, "utf8"), path: file };
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      return { ok: true, content: "", path: file };
    }
    return { ok: false, reason: "Couldn't read the memory file", content: "", path: file };
  }
}

export function saveAssistantMemory(content: string): AssistantMemoryResult {
  const file = memoryFile();
  if (Buffer.byteLength(content) > MEMORY_MAX_BYTES) {
    return { ok: false, reason: "Memory is too large — trim it first", content, path: file };
  }
  try {
    fs.writeFileSync(file, content, "utf8");
    return { ok: true, content, path: file };
  } catch {
    return { ok: false, reason: "Couldn't write the memory file", content, path: file };
  }
}

export function appendFact(fact: string): { ok: true; fact: string } | { ok: false; reason: string } {
  const clean = cleanFact(fact);
  if (!clean) return { ok: false, reason: "Empty fact" };
  const existing = readMemoryFile();
  const line = `- ${localDate()}: ${clean}`;
  const next = `${existing}${existing === "" || existing.endsWith("\n") ? "" : "\n"}${line}\n`;
  if (Buffer.byteLength(next) > MEMORY_MAX_BYTES) {
    return { ok: false, reason: "Memory is full — ask the user to prune it" };
  }
  const saved = saveAssistantMemory(next);
  return saved.ok ? { ok: true, fact: clean } : { ok: false, reason: saved.reason ?? "Write failed" };
}

// The exact lines `forget(fragment)` would delete, so the confirmation card can
// show them rather than the model's description of them.
export function findMemoryLines(
  fragment: string
): { ok: true; lines: string[] } | { ok: false; reason: string } {
  const needle = fragment.replace(/\s+/g, " ").trim().toLowerCase();
  if (needle.length < FORGET_MIN_FRAGMENT) {
    return { ok: false, reason: `Give at least ${FORGET_MIN_FRAGMENT} characters to match` };
  }
  const lines = readMemoryFile()
    .split("\n")
    .filter((line) => line.trim() && line.toLowerCase().includes(needle));
  if (lines.length === 0) return { ok: false, reason: "Nothing in memory matches that" };
  if (lines.length > FORGET_MAX_LINES) {
    return {
      ok: false,
      reason: `That matches ${lines.length} lines; be more specific (at most ${FORGET_MAX_LINES})`,
    };
  }
  return { ok: true, lines };
}

// Removes the given lines by exact match, once each. Matching exactly (not
// re-running the fragment search) means a line the user added between the
// approval card and the click can never be deleted by mistake.
export function removeMemoryLines(lines: string[]): number {
  const remaining = readMemoryFile().split("\n");
  let removed = 0;
  for (const target of lines) {
    const index = remaining.indexOf(target);
    if (index >= 0) {
      remaining.splice(index, 1);
      removed++;
    }
  }
  if (removed === 0) return 0;
  const saved = saveAssistantMemory(remaining.join("\n"));
  return saved.ok ? removed : 0;
}
