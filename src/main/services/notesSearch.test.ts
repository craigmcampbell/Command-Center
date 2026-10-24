import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";

const vault = vi.hoisted(() => ({ root: "" }));

// notes.ts opens the shared SQLite connection for its nav tables, which can't
// load under host Node; search only needs the vault list.
vi.mock("./db", () => ({ getDatabase: vi.fn() }));
vi.mock("./settings", () => ({
  listVaultSettings: () => [{ id: 1, label: "Main", path: vault.root, sortOrder: 0 }],
}));

import { searchNotes } from "./notes";

function write(rel: string, content: string) {
  const abs = path.join(vault.root, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content);
}

beforeAll(() => {
  vault.root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-vault-"));
  write("Sprint Planning.md", "Nothing about the topic in here.");
  write("Projects/Roadmap.md", "We should plan the SPRINT around the docker migration.\nSecond line.");
  write("Projects/Docker notes.md", "Containers and images.");
  write("Journal/2026-10-12.md", "Met about the sprint. Docker came up too.");
  write(".obsidian/workspace.md", "sprint docker secret config");
  write("Archive/big.md", "sprint ".repeat(100_000)); // > 512k chars: skipped
});

describe("searchNotes", () => {
  it("ranks filename matches first, without reading them", async () => {
    const result = await searchNotes("Main", "sprint");
    expect(result.ok).toBe(true);
    expect(result.hits[0]).toEqual({ path: "Sprint Planning.md", nameMatch: true, snippet: "" });
  });

  it("finds body matches case-insensitively and quotes the surrounding text", async () => {
    const result = await searchNotes("Main", "SPRINT");
    const roadmap = result.hits.find((h) => h.path === "Projects/Roadmap.md")!;
    expect(roadmap.nameMatch).toBe(false);
    expect(roadmap.snippet).toContain("plan the SPRINT around the docker migration");
  });

  it("requires every term to appear (AND), in the path or the body", async () => {
    const result = await searchNotes("Main", "sprint docker");
    const paths = result.hits.map((h) => h.path);
    expect(paths).toContain("Projects/Roadmap.md");
    expect(paths).toContain("Journal/2026-10-12.md");
    expect(paths).not.toContain("Projects/Docker notes.md"); // has docker, not sprint
  });

  it("never looks inside dot-folders like .obsidian", async () => {
    const result = await searchNotes("Main", "secret");
    expect(result.hits).toEqual([]);
  });

  it("skips oversized files rather than reading them", async () => {
    const result = await searchNotes("Main", "sprint");
    expect(result.hits.map((h) => h.path)).not.toContain("Archive/big.md");
  });

  it("caps results and says so", async () => {
    const result = await searchNotes("Main", "sprint", 1);
    expect(result.hits).toHaveLength(1);
    expect(result.truncated).toBe(true);
  });

  it("fails soft for an empty query and an unknown vault", async () => {
    expect(await searchNotes("Main", "   ")).toMatchObject({ ok: false, hits: [] });
    expect(await searchNotes("Nope", "sprint")).toMatchObject({
      ok: false,
      reason: 'Vault "Nope" isn\'t configured',
    });
  });
});
