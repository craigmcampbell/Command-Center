import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { indexedFile, pruneIndex } from "./transcriptIndex";

const roots: string[] = [];
function fixture(text: string): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-index-"));
  roots.push(root);
  const file = path.join(root, "session.jsonl");
  fs.writeFileSync(file, text);
  return file;
}
afterEach(() => { for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true }); });

describe("incremental transcript index", () => {
  it("reads only appended complete UTF-8 records and retries an unfinished line", async () => {
    const file = fixture('α\n');
    let read = 0;
    const parse = async (lines: AsyncIterable<string>, previous: string[] = []) => {
      for await (const line of lines) { read++; previous.push(line); }
      return previous;
    };
    expect(await indexedFile(file, parse)).toEqual(['α']);
    fs.appendFileSync(file, 'β');
    expect(await indexedFile(file, parse)).toEqual(['α']);
    fs.appendFileSync(file, '\nγ\n');
    expect(await indexedFile(file, parse)).toEqual(['α', 'β', 'γ']);
    expect(read).toBe(3);
    await indexedFile(file, parse);
    expect(read).toBe(3);
  });

  it("rebuilds truncated, rewritten, and replaced transcripts", async () => {
    const file = fixture('one\ntwo\n');
    const parse = async (lines: AsyncIterable<string>, previous: string[] = []) => {
      for await (const line of lines) previous.push(line);
      return previous;
    };
    await indexedFile(file, parse);
    fs.writeFileSync(file, 'new\n');
    expect(await indexedFile(file, parse)).toEqual(['new']);
    fs.writeFileSync(file, 'alt\n');
    fs.utimesSync(file, new Date(), new Date(Date.now() + 1000));
    expect(await indexedFile(file, parse)).toEqual(['alt']);
    fs.writeFileSync(file + '.tmp', 'replacement\n');
    fs.renameSync(file + '.tmp', file);
    expect(await indexedFile(file, parse)).toEqual(['replacement']);
  });

  it("rejects append reuse when the retained prefix was rewritten and prunes deleted paths", async () => {
    const file = fixture('old\n');
    let seeded = false;
    const parse = async (lines: AsyncIterable<string>, previous?: string[]) => {
      seeded = !!previous;
      const result = previous ?? [];
      for await (const line of lines) result.push(line);
      return result;
    };
    await indexedFile(file, parse);
    fs.writeFileSync(file, 'new\nmore\n');
    expect(await indexedFile(file, parse)).toEqual(['new', 'more']);
    expect(seeded).toBe(false);
    pruneIndex([path.dirname(file)], []);
    await indexedFile(file, parse);
    expect(seeded).toBe(false);
  });
});
