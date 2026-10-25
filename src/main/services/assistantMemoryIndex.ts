// Finding things in the Assistant's memory file without sending all of it.
// Pure: no Electron, DB or network.
//
// The file stays the source of truth (it is hand-edited, possibly in an
// Obsidian vault), so there is no separate index to keep in sync: a lookup
// scores the file's lines directly. It holds hundreds of one-line facts, not
// millions of documents, so a BM25 pass over them costs microseconds and needs
// no schema, no migration and nothing to rebuild when the file changes.
//
// Small memories are sent whole, exactly as before. A big one gets a "core"
// (pinned lines plus the newest) in the system prompt and the rest is reached
// with the `recall_memory` tool.

// Whole-file threshold and core budget: about 1,500 tokens.
export const CORE_MAX_CHARS = 6000;
export const RECALL_DEFAULT_LIMIT = 8;
export const RECALL_MAX_LIMIT = 20;

const PINNED = /\[pin(ned)?\]|📌/i;
const STOPWORDS = new Set(
  "a an and are as at be but by for from has have he her his i in is it its me my of on or our she that the their them they this to was we were what when where which who will with you your about do does did how".split(
    " "
  )
);
const K1 = 1.2;
const B = 0.75;
// A query word also matches longer words that start with it ("deploy" finds
// "deployment"), but less strongly than an exact match.
const PREFIX_WEIGHT = 0.7;
const PREFIX_MIN_LENGTH = 4;

// `- 2026-10-12: Prefers terse answers` -> `Prefers terse answers`. The date is
// not something anyone searches for, and every line has one.
function factBody(line: string): string {
  return line.replace(/^\s*[-*]\s*/, "").replace(/^\d{4}-\d{2}-\d{2}\s*:?\s*/, "");
}

function stem(word: string): string {
  return word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}

export function tokenize(text: string): string[] {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
  return words.filter((w) => w.length >= 2 && !STOPWORDS.has(w)).map(stem);
}

// The lines that count as facts: everything non-blank except markdown headings.
export function memoryLines(content: string): string[] {
  return content.split("\n").filter((l) => l.trim() && !/^\s*#/.test(l));
}

export interface MemoryMatch {
  line: string;
  score: number;
}

// Best matches first; newer lines (later in the file) win ties. Empty when the
// query has no usable words or nothing shares one.
export function searchMemory(content: string, query: string, limit = RECALL_DEFAULT_LIMIT): MemoryMatch[] {
  const terms = [...new Set(tokenize(query))];
  const lines = memoryLines(content);
  if (terms.length === 0 || lines.length === 0) return [];

  const docs = lines.map((line) => tokenize(factBody(line)));
  const avgLength = docs.reduce((n, d) => n + d.length, 0) / docs.length || 1;

  const weightOf = (doc: string[], term: string): number => {
    let tf = 0;
    for (const token of doc) {
      if (token === term) tf += 1;
      else if (term.length >= PREFIX_MIN_LENGTH && token.startsWith(term)) tf += PREFIX_WEIGHT;
    }
    return tf;
  };

  const idf = new Map<string, number>();
  for (const term of terms) {
    const df = docs.filter((doc) => weightOf(doc, term) > 0).length;
    idf.set(term, Math.log(1 + (docs.length - df + 0.5) / (df + 0.5)));
  }

  const scored: (MemoryMatch & { order: number })[] = [];
  docs.forEach((doc, order) => {
    let score = 0;
    for (const term of terms) {
      const tf = weightOf(doc, term);
      if (tf === 0) continue;
      score += (idf.get(term) ?? 0) * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * doc.length) / avgLength)));
    }
    if (score > 0) scored.push({ line: lines[order], score, order });
  });
  scored.sort((a, b) => b.score - a.score || b.order - a.order);
  const cap = Math.max(1, Math.min(limit, RECALL_MAX_LIMIT));
  return scored.slice(0, cap).map(({ line, score }) => ({ line, score }));
}

export interface MemoryCore {
  lines: string[];
  total: number;
  // False when every line fits and the whole file is shown.
  partial: boolean;
}

// What goes in the system prompt: the whole file when it is small; otherwise
// the pinned lines first (a line marked `[pinned]` or 📌 is always wanted),
// then the newest, until the budget is spent. Kept in file order.
export function selectCore(content: string, maxChars = CORE_MAX_CHARS): MemoryCore {
  const lines = memoryLines(content);
  if (content.trim().length <= maxChars) return { lines, total: lines.length, partial: false };

  const chosen = new Set<number>();
  let used = 0;
  const take = (i: number): void => {
    if (chosen.has(i) || used + lines[i].length + 1 > maxChars) return;
    chosen.add(i);
    used += lines[i].length + 1;
  };
  for (let i = lines.length - 1; i >= 0; i--) if (PINNED.test(lines[i])) take(i);
  for (let i = lines.length - 1; i >= 0; i--) take(i);
  const picked = [...chosen].sort((a, b) => a - b).map((i) => lines[i]);
  return { lines: picked, total: lines.length, partial: picked.length < lines.length };
}

// The memory section of the system prompt.
export function memoryPromptBlock(content: string): string {
  if (!content.trim()) return "<memory>(empty)</memory>";
  const core = selectCore(content);
  if (!core.partial) return `<memory>\n${content.trim()}\n</memory>`;
  return [
    `<memory>\n${core.lines.join("\n")}\n</memory>`,
    `(Memory holds ${core.total} facts; only ${core.lines.length} are shown above: the pinned ones and the newest. ` +
      "Before saying you don't know something about the user, or when they refer to something from the past, look it up with `recall_memory`.)",
  ].join("\n");
}
