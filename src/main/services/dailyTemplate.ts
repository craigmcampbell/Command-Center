// Renders an Obsidian daily-note template into the content for a new daily
// note, so a note created from the dashboard isn't an empty file.
//
// Deliberately different from services/notes.ts's createNote, which copies a
// template's RAW text and lets Obsidian's Templater plugin evaluate it. That's
// correct there — those notes get opened in Obsidian. It's wrong here: nothing
// will ever evaluate a file the dashboard wrote, because Templater only
// processes files it creates itself. So a raw copy would leave a literal
// `<%* ... %>` code block sitting in the note forever.
//
// Instead we substitute the `{{...}}` placeholders ourselves and strip the
// Templater blocks. Consequence, accepted knowingly: anything the Templater
// JavaScript would have generated is simply absent.

import fs from "node:fs";
import path from "node:path";

// Zero-padded ISO-8601 week number (weeks start Monday; week 1 contains the
// first Thursday of the year). Verified against this vault's own convention —
// `5 Logs/Weekly Notes/2026-W24.md` covers June 8-12 2026, and ISO week 24 of
// 2026 begins Monday June 8. Locale-based numbering would drift from that and
// produce wikilinks to week notes that don't exist.
function isoWeek(date: Date): { week: number; year: number } {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  // Shift to the Thursday of this week; the year that Thursday falls in is the
  // ISO week-year, which is why late December can belong to week 1 of the next
  // year (and early January to week 52/53 of the previous one).
  const dayNum = d.getUTCDay() || 7; // Sunday 0 -> 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return { week, year: d.getUTCFullYear() };
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const pad = (n: number) => String(n).padStart(2, "0");

// A small subset of moment's format tokens — enough for the placeholders these
// templates actually use. Ordered longest-first so `YYYY` is matched before
// `YY`, and `[literal]` is handled first so bracketed text is never treated as
// tokens (that's how `{{date:YYYY-[W]ww}}` keeps its literal "W").
function formatDate(date: Date, format: string): string {
  // `YYYY` is the CALENDAR year, not the ISO week-year, matching moment (where
  // the week-year is `GGGG`). So 2027-01-01 formats as "2027-W53" even though
  // that date is ISO week 53 of *2026*. It looks wrong but it's what Obsidian
  // would produce for the same template, which is what matters — the point is
  // to generate the link Obsidian would.
  const { week } = isoWeek(date);
  const tokens: Record<string, string> = {
    YYYY: String(date.getFullYear()),
    YY: String(date.getFullYear()).slice(-2),
    MMMM: MONTHS[date.getMonth()],
    MMM: MONTHS[date.getMonth()].slice(0, 3),
    MM: pad(date.getMonth() + 1),
    DD: pad(date.getDate()),
    dddd: DAYS[date.getDay()],
    ddd: DAYS[date.getDay()].slice(0, 3),
    ww: pad(week),
    HH: pad(date.getHours()),
    mm: pad(date.getMinutes()),
    ss: pad(date.getSeconds()),
  };

  return format.replace(
    /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|DD|dddd|ddd|ww|HH|mm|ss/g,
    (match, literal?: string) => (literal !== undefined ? literal : tokens[match])
  );
}

// Parses the "YYYY-MM-DD" the daily note is keyed by, as a LOCAL date. Passing
// the string to `new Date()` would parse it as UTC and land on the previous
// day for anyone west of Greenwich — the same trap todoist.ts documents.
function parseLocalDate(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function renderTemplateText(raw: string, dateStr: string): string {
  const date = parseLocalDate(dateStr);

  const withoutTemplater = raw
    // `<%* ... %>` (execution) and `<% ... %>` (interpolation) alike. [\s\S]
    // rather than the `s` flag so this matches across newlines.
    .replace(/<%[\s\S]*?%>/g, "")
    // Stripping a multi-line block leaves a run of blank lines behind; collapse
    // any run of 3+ newlines to the single blank line a human would have left.
    .replace(/\n{3,}/g, "\n\n")
    // This particular template starts with a newline, and a note that opens on
    // a blank line looks like a mistake even though it's faithful to the source.
    .replace(/^\n+/, "");

  return withoutTemplater.replace(
    /\{\{(date|time|title)(?::([^}]*))?\}\}/g,
    (_match, kind: string, format?: string) => {
      if (kind === "title") return dateStr;
      if (format) return formatDate(date, format);
      return kind === "time" ? formatDate(date, "HH:mm") : dateStr;
    }
  );
}

// Returns null whenever there's nothing usable to apply — unset, escaping the
// vault, or unreadable. Never throws: a missing template must not stop a note
// from being created.
export function renderDailyTemplate(
  vaultPath: string,
  templatePath: string | undefined,
  dateStr: string
): string | null {
  if (!templatePath?.trim() || !vaultPath) return null;

  const resolved = path.resolve(vaultPath, templatePath);
  const root = path.resolve(vaultPath);
  // Same containment guard notes.ts applies to vault reads — a stray `../`
  // must not turn a template path into an arbitrary file read.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) return null;

  try {
    return renderTemplateText(fs.readFileSync(resolved, "utf8"), dateStr);
  } catch {
    return null;
  }
}
