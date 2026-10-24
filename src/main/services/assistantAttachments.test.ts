import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({ app: { getPath: () => os.tmpdir() } }));

import {
  cleanName,
  deleteAttachmentFiles,
  MAX_ATTACHMENTS,
  prepareAttachments,
  readImageDataUrl,
  sniffImageMime,
  TEXT_MAX_CHARS,
} from "./assistantAttachments";

const PNG = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 1, 2]);
const GIF = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2]);
const WEBP = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 1]);
const text = (s: string) => new TextEncoder().encode(s);
const sha = (b: Uint8Array) => crypto.createHash("sha256").update(b).digest("hex");

describe("sniffImageMime", () => {
  it("identifies the four supported formats from their bytes", () => {
    expect(sniffImageMime(PNG)).toBe("image/png");
    expect(sniffImageMime(JPEG)).toBe("image/jpeg");
    expect(sniffImageMime(GIF)).toBe("image/gif");
    expect(sniffImageMime(WEBP)).toBe("image/webp");
    expect(sniffImageMime(text("hello"))).toBeNull();
    expect(sniffImageMime(new Uint8Array())).toBeNull();
  });
});

describe("cleanName", () => {
  it("keeps only a plain file name", () => {
    expect(cleanName("../../etc/passwd")).toBe("passwd");
    expect(cleanName("C:\\Users\\me\\notes.txt")).toBe("notes.txt");
    expect(cleanName("a\u0000b\nc.txt")).toBe("abc.txt");
    expect(cleanName("")).toBe("attachment");
    expect(cleanName(undefined)).toBe("attachment");
    expect(cleanName("x".repeat(300))).toHaveLength(100);
  });
});

describe("prepareAttachments", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "cc-attach-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("stores an image under its content hash and reports it", () => {
    const res = prepareAttachments([{ name: "shot.png", mime: "image/png", data: PNG }], dir);
    expect(res).toEqual({
      ok: true,
      attachments: [{ id: sha(PNG), name: "shot.png", mime: "image/png", kind: "image", size: PNG.length }],
    });
    expect(fs.readFileSync(path.join(dir, sha(PNG)))).toEqual(Buffer.from(PNG));
  });

  it("believes the bytes, not the claimed type or name", () => {
    const res = prepareAttachments([{ name: "evil.txt", mime: "text/plain", data: PNG }], dir);
    expect(res).toMatchObject({ ok: true, attachments: [{ kind: "image", mime: "image/png" }] });
    const fake = prepareAttachments([{ name: "photo.png", mime: "image/png", data: text("not an image at all") }], dir);
    expect(fake).toMatchObject({ ok: true, attachments: [{ kind: "text", mime: "text/plain" }] });
  });

  it("keeps a text file inline and cuts a long one", () => {
    const res = prepareAttachments([{ name: "n.md", mime: "text/markdown", data: text("# Title\nBody") }], dir);
    expect(res).toMatchObject({ ok: true, attachments: [{ kind: "text", mime: "text/markdown", text: "# Title\nBody" }] });
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]); // text isn't written to disk

    const long = prepareAttachments([{ name: "big.txt", mime: "", data: text("z".repeat(TEXT_MAX_CHARS + 50)) }], dir);
    const a = (long as { attachments: { text: string; truncated?: boolean }[] }).attachments[0];
    expect(a.text).toHaveLength(TEXT_MAX_CHARS);
    expect(a.truncated).toBe(true);
  });

  it("refuses binary data, oversized files, empty files and too many files", () => {
    expect(prepareAttachments([{ name: "a.bin", mime: "", data: Uint8Array.from([1, 2, 0, 3, 4]) }], dir)).toMatchObject({ ok: false });
    expect(prepareAttachments([{ name: "a.txt", mime: "", data: Uint8Array.from([0xff, 0xfe, 0xfd, 0x80]) }], dir)).toMatchObject({ ok: false });
    expect(prepareAttachments([{ name: "a.txt", mime: "", data: text("x".repeat(201 * 1024)) }], dir)).toMatchObject({ ok: false, reason: expect.stringContaining("200 KB") });
    const bigImage = new Uint8Array(9 * 1024 * 1024);
    bigImage.set(PNG);
    expect(prepareAttachments([{ name: "a.png", mime: "image/png", data: bigImage }], dir)).toMatchObject({ ok: false, reason: expect.stringContaining("8 MB") });
    expect(prepareAttachments([{ name: "a", mime: "", data: new Uint8Array() }], dir)).toMatchObject({ ok: false });
    const many = Array.from({ length: MAX_ATTACHMENTS + 1 }, (_, i) => ({ name: `${i}.txt`, mime: "", data: text(`file ${i}`) }));
    expect(prepareAttachments(many, dir)).toMatchObject({ ok: false });
    expect(prepareAttachments("nope", dir)).toMatchObject({ ok: false });
    expect(prepareAttachments([{ name: "x", mime: "", data: "a string" }], dir)).toMatchObject({ ok: false });
  });

  it("caps the total, and writes nothing when any file is refused", () => {
    const seven = new Uint8Array(7 * 1024 * 1024);
    seven.set(PNG);
    const other = new Uint8Array(7 * 1024 * 1024);
    other.set(JPEG);
    expect(prepareAttachments([{ name: "a.png", mime: "", data: seven }, { name: "b.jpg", mime: "", data: other }], dir)).toMatchObject({ ok: false });

    const res = prepareAttachments([{ name: "ok.png", mime: "", data: PNG }, { name: "bad.bin", mime: "", data: Uint8Array.from([0, 1, 2]) }], dir);
    expect(res.ok).toBe(false);
    expect(fs.existsSync(dir) ? fs.readdirSync(dir) : []).toEqual([]);
  });

  it("stores the same picture once, and treats none as none", () => {
    prepareAttachments([{ name: "a.png", mime: "", data: PNG }], dir);
    expect(prepareAttachments([{ name: "copy.png", mime: "", data: PNG }], dir)).toMatchObject({ ok: true });
    expect(fs.readdirSync(dir)).toHaveLength(1);
    expect(prepareAttachments(undefined, dir)).toEqual({ ok: true, attachments: [] });
  });

  it("reads an image back as a data URL, and deletes it", () => {
    const [a] = (prepareAttachments([{ name: "a.jpg", mime: "", data: JPEG }], dir) as { attachments: { id: string }[] }).attachments;
    expect(readImageDataUrl(a.id, dir)).toBe(`data:image/jpeg;base64,${Buffer.from(JPEG).toString("base64")}`);
    deleteAttachmentFiles([a.id], dir);
    expect(fs.readdirSync(dir)).toEqual([]);
    expect(readImageDataUrl(a.id, dir)).toBeNull();
  });

  it("never lets an id name a path", () => {
    fs.writeFileSync(path.join(dir, "secret.txt"), "TOP SECRET");
    for (const id of ["../secret.txt", "secret.txt", "", "a".repeat(63), `${"a".repeat(64)}/..`]) {
      expect(readImageDataUrl(id, dir), id).toBeNull();
    }
    deleteAttachmentFiles(["../secret.txt", "secret.txt"], dir);
    expect(fs.existsSync(path.join(dir, "secret.txt"))).toBe(true);
  });
});
