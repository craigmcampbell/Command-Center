import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseSkillFile, readSkillBody, readSkillFile, scanSkills } from "./assistantSkills";

describe("parseSkillFile", () => {
  it("reads name, description and body", () => {
    const parsed = parseSkillFile("---\nname: tdd\ndescription: Test-driven development.\n---\n\n# TDD\nBody.\n");
    expect(parsed).toEqual({ name: "tdd", description: "Test-driven development.", body: "# TDD\nBody." });
  });

  it("joins a block-scalar description and strips quotes", () => {
    const parsed = parseSkillFile(
      '---\nname: "humanizer"\ndescription: |\n  Rewrite AI-sounding text\n  so it reads like you.\nlicense: MIT\n---\nBody'
    );
    expect(parsed.name).toBe("humanizer");
    expect(parsed.description).toBe("Rewrite AI-sounding text so it reads like you.");
    expect(parsed.body).toBe("Body");
  });

  it("treats a file with no frontmatter as all body", () => {
    expect(parseSkillFile("Just instructions")).toEqual({ description: "", body: "Just instructions" });
  });

  it("copes with CRLF and a BOM", () => {
    const parsed = parseSkillFile("﻿---\r\nname: x\r\ndescription: d\r\n---\r\nBody\r\n");
    expect(parsed).toMatchObject({ name: "x", description: "d", body: "Body" });
  });
});

describe("skills on disk", () => {
  let root: string;
  let outside: string;
  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cc-skills-"));
    outside = fs.mkdtempSync(path.join(os.tmpdir(), "cc-outside-"));
    fs.mkdirSync(path.join(root, "alpha", "refs"), { recursive: true });
    fs.writeFileSync(path.join(root, "alpha", "SKILL.md"), "---\nname: alpha\ndescription: First skill\n---\nDo alpha things.");
    fs.writeFileSync(path.join(root, "alpha", "refs", "notes.md"), "reference text");
    fs.writeFileSync(path.join(root, "alpha", "blob.bin"), Buffer.from([0x41, 0, 0x42]));
    fs.writeFileSync(path.join(outside, "secret.txt"), "TOP SECRET");
    fs.symlinkSync(path.join(outside, "secret.txt"), path.join(root, "alpha", "leak.txt"));
    fs.mkdirSync(path.join(root, "not-a-skill"));
    fs.writeFileSync(path.join(root, "not-a-skill", "README.md"), "x");
    fs.writeFileSync(path.join(root, "loose-file.md"), "x");
    fs.mkdirSync(path.join(root, "bad name"));
    fs.writeFileSync(path.join(root, "bad name", "SKILL.md"), "---\ndescription: no\n---\nx");
    // Skills are usually installed as symlinks to a folder elsewhere.
    fs.mkdirSync(path.join(outside, "linked"));
    fs.writeFileSync(path.join(outside, "linked", "SKILL.md"), "---\ndescription: Linked skill\n---\nBody");
    fs.symlinkSync(path.join(outside, "linked"), path.join(root, "linked"));
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  });

  it("lists folders with a SKILL.md, following symlinks, skipping everything else", async () => {
    expect(await scanSkills(root)).toEqual([
      { name: "alpha", description: "First skill" },
      { name: "linked", description: "Linked skill" },
    ]);
    expect(await scanSkills(path.join(root, "missing"))).toEqual([]);
  });

  it("reads a skill's instructions without the frontmatter", async () => {
    expect(await readSkillBody("alpha", root)).toEqual({ ok: true, body: "Do alpha things.", truncated: false });
    expect(await readSkillBody("../alpha", root)).toMatchObject({ ok: false });
    expect(await readSkillBody("nope", root)).toMatchObject({ ok: false });
  });

  it("reads and lists files inside the skill's folder", async () => {
    expect(await readSkillFile("alpha", "refs/notes.md", root)).toEqual({
      ok: true,
      content: "reference text",
      truncated: false,
    });
    expect(await readSkillFile("alpha", "", root)).toMatchObject({
      ok: true,
      files: ["SKILL.md", "blob.bin", "leak.txt", "refs/"],
    });
    expect(await readSkillFile("alpha", "refs", root)).toEqual({ ok: true, files: ["notes.md"] });
  });

  it("refuses anything outside the folder", async () => {
    for (const bad of ["../not-a-skill/README.md", "../../etc/passwd", "refs/../../loose-file.md", "/etc/passwd", "leak.txt"]) {
      expect(await readSkillFile("alpha", bad, root)).toMatchObject({ ok: false });
    }
    expect(await readSkillFile("../alpha", "SKILL.md", root)).toMatchObject({ ok: false });
    expect(await readSkillFile("alpha", "a\0b", root)).toMatchObject({ ok: false });
  });

  it("refuses binary files and truncates long text", async () => {
    expect(await readSkillFile("alpha", "blob.bin", root)).toEqual({ ok: false, reason: "That file isn't text" });
    fs.writeFileSync(path.join(root, "alpha", "long.md"), "z".repeat(50_000));
    const long = await readSkillFile("alpha", "long.md", root);
    expect(long).toMatchObject({ ok: true, truncated: true });
    expect((long as { content: string }).content).toHaveLength(30_000);
  });
});
