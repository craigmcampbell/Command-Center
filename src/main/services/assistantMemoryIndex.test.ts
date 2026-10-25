import { describe, expect, it } from "vitest";
import {
  CORE_MAX_CHARS,
  memoryLines,
  memoryPromptBlock,
  searchMemory,
  selectCore,
  tokenize,
} from "./assistantMemoryIndex";

const fact = (day: number, text: string) => `- 2026-09-${String(day).padStart(2, "0")}: ${text}`;

const SAMPLE = [
  "# Memory",
  fact(1, "Prefers terse answers"),
  fact(2, "Daughter Mia has a piano recital on Fridays"),
  fact(3, "Deploys the blog with Netlify, not Vercel"),
  fact(4, "Allergic to shellfish"),
  fact(5, "Main bank account is at Credit Union West"),
  "",
].join("\n");

describe("tokenize", () => {
  it("lowercases, drops stopwords and short words, and folds plurals", () => {
    expect(tokenize("The Deployments of my blogs, and a x")).toEqual(["deployment", "blog"]);
    expect(tokenize("Café 2026 über")).toEqual(["café", "2026", "über"]);
  });
});

describe("memoryLines", () => {
  it("skips blanks and headings", () => {
    expect(memoryLines(SAMPLE)).toHaveLength(5);
  });
});

describe("searchMemory", () => {
  it("finds a fact by its words and ranks the best match first", () => {
    const hits = searchMemory(SAMPLE, "where do I deploy my blog");
    expect(hits[0].line).toContain("Netlify");
  });

  it("matches a longer word by prefix, but an exact word outranks it", () => {
    const content = [fact(1, "Writes deployment notes"), fact(2, "Will deploy on Friday")].join("\n");
    const hits = searchMemory(content, "deploy");
    expect(hits.map((h) => h.line)).toEqual([fact(2, "Will deploy on Friday"), fact(1, "Writes deployment notes")]);
  });

  it("ignores the date prefix", () => {
    expect(searchMemory(SAMPLE, "2026-09-04")).toEqual([]);
  });

  it("returns nothing for an empty query, stopwords only, or no overlap", () => {
    expect(searchMemory(SAMPLE, "")).toEqual([]);
    expect(searchMemory(SAMPLE, "what is the")).toEqual([]);
    expect(searchMemory(SAMPLE, "kubernetes")).toEqual([]);
    expect(searchMemory("", "anything")).toEqual([]);
  });

  it("prefers the newer of two equally good facts, and honours the limit", () => {
    const content = [fact(1, "Likes espresso"), fact(2, "Likes espresso")].join("\n");
    expect(searchMemory(content, "espresso")[0].line).toBe(fact(2, "Likes espresso"));
    expect(searchMemory(content, "espresso", 1)).toHaveLength(1);
    const many = Array.from({ length: 40 }, (_, i) => fact(1, `espresso ${i}`)).join("\n");
    expect(searchMemory(many, "espresso", 500)).toHaveLength(20);
  });

  it("weights a rare word above a common one", () => {
    const content = [
      ...Array.from({ length: 10 }, (_, i) => fact(1, `Likes coffee number ${i}`)),
      fact(2, "Likes zanzibar"),
    ].join("\n");
    expect(searchMemory(content, "likes zanzibar")[0].line).toContain("zanzibar");
  });
});

describe("selectCore / memoryPromptBlock", () => {
  it("sends a small memory whole and unchanged", () => {
    expect(selectCore(SAMPLE).partial).toBe(false);
    expect(memoryPromptBlock(SAMPLE)).toBe(`<memory>\n${SAMPLE.trim()}\n</memory>`);
    expect(memoryPromptBlock("  \n")).toBe("<memory>(empty)</memory>");
  });

  function big(): string {
    const lines = [fact(1, "Old fact [pinned] always wanted")];
    for (let i = 0; i < 400; i++) lines.push(fact(2, `Filler fact number ${i} with some padding words`));
    lines.push(fact(9, "Newest fact"));
    return lines.join("\n");
  }

  it("keeps pinned lines and the newest, in file order, within budget", () => {
    const core = selectCore(big());
    expect(core.partial).toBe(true);
    expect(core.total).toBe(402);
    expect(core.lines[0]).toContain("[pinned]");
    expect(core.lines.at(-1)).toContain("Newest fact");
    expect(core.lines.join("\n").length).toBeLessThanOrEqual(CORE_MAX_CHARS);
    expect(core.lines.length).toBeLessThan(402);
  });

  it("tells the model memory is partial and how to reach the rest", () => {
    const block = memoryPromptBlock(big());
    expect(block).toContain("Memory holds 402 facts");
    expect(block).toContain("recall_memory");
    expect(block).not.toContain("Filler fact number 0 ");
  });
});
