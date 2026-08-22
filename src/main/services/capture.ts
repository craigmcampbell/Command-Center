// Quick capture: append a line to today's daily note or the scratchpad from
// anywhere on the system, via a global hotkey. Composes the existing services
// rather than touching files or the DB itself.
//
// Main is the sole writer. That matters because both targets are also edited
// by autosaving widgets that hold the WHOLE buffer in renderer memory and
// write it back wholesale — so after appending here, the renderer has to be
// told to drop its stale copy (see the "captured" AppCommand). Without that,
// the widget's next save would silently erase whatever was captured.

import { getScratchpad, saveScratchpad } from "./scratchpad";
import { readDailyNote, saveDailyNote } from "./grimoire";
import { getGrimoireSettings } from "./settings";
import type { ActionResult, CaptureTarget } from "../../shared/types";

function todayDateString(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function timeStamp(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

// Keeps exactly one blank-line gap when there's existing content, and no
// leading newline when there isn't — so capturing into an empty note doesn't
// start the file with whitespace.
function appendLine(existing: string, line: string): string {
  const body = existing.replace(/\s+$/, "");
  return body.length > 0 ? `${body}\n${line}\n` : `${line}\n`;
}

function captureToDailyNote(text: string): ActionResult {
  const settings = getGrimoireSettings();
  const date = todayDateString();
  const current = readDailyNote(settings, date);

  // `missing: true` (no note for today yet) is fine — saveDailyNote writes
  // unconditionally and creates the file, which is how a day's log normally
  // gets started from the dashboard. A genuine failure (bad vault path) is
  // not fine, and must not be papered over by writing to a bogus location.
  if (!current.ok && !current.missing) {
    return { ok: false, reason: current.reason ?? "Couldn't read today's note" };
  }

  // A note that doesn't exist yet has empty `content` and carries its template
  // separately, so capture is the thing that creates it — from the template,
  // with the captured line appended beneath.
  const existing = current.missing ? current.templateContent ?? "" : current.content;
  return saveDailyNote(settings, date, appendLine(existing, `- ${timeStamp()} ${text}`));
}

function captureToScratchpad(text: string): ActionResult {
  saveScratchpad(appendLine(getScratchpad(), `- ${timeStamp()} ${text}`));
  return { ok: true };
}

export function capture(target: CaptureTarget, text: string): ActionResult {
  const trimmed = text.trim();
  if (!trimmed) return { ok: false, reason: "Nothing to capture" };

  return target === "scratchpad" ? captureToScratchpad(trimmed) : captureToDailyNote(trimmed);
}
