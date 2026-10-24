// Files attached to an Assistant message: images (for vision models) and small
// text files. Everything arrives from the renderer as raw bytes, so nothing the
// caller claims is trusted: the type is sniffed from the bytes, the name is
// scrubbed, sizes are capped, and a file's id is the SHA-256 of its content —
// which is also its filename, so a path can never be steered by user input.
//
// Images are written under userData/assistant-attachments/<id> (identical files
// share one copy) and are read back when a message is sent to the model or
// shown in the transcript. Text files are kept inline in the stored message
// instead, because the model needs their text on every request.

import { app } from "electron";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { AssistantAttachment } from "../../shared/types";

export const MAX_ATTACHMENTS = 5;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_BYTES = 200 * 1024;
export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;
// A text file longer than this is cut, and the model is told.
export const TEXT_MAX_CHARS = 60_000;
const NAME_MAX_CHARS = 100;
export const ATTACHMENT_ID = /^[a-f0-9]{64}$/;

export function attachmentsDir(): string {
  return path.join(app.getPath("userData"), "assistant-attachments");
}

// The image type from the file's first bytes. Providers accept exactly these.
export function sniffImageMime(bytes: Uint8Array): string | null {
  const starts = (sig: number[], at = 0): boolean => sig.every((b, i) => bytes[at + i] === b);
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
  if (starts([0xff, 0xd8, 0xff])) return "image/jpeg";
  if (starts([0x47, 0x49, 0x46, 0x38]) && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61) return "image/gif";
  if (starts([0x52, 0x49, 0x46, 0x46]) && starts([0x57, 0x45, 0x42, 0x50], 8)) return "image/webp";
  return null;
}

export function cleanName(raw: unknown): string {
  const base = String(raw ?? "").split(/[\\/]/).pop() ?? "";
  const name = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim();
  return (name.length > NAME_MAX_CHARS ? name.slice(0, NAME_MAX_CHARS) : name) || "attachment";
}

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.slice(0, 8000).includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function textMime(claimed: string): string {
  return /^text\/[\w.+-]+$/i.test(claimed) || claimed === "application/json" ? claimed.toLowerCase() : "text/plain";
}

const sha256 = (bytes: Uint8Array): string => crypto.createHash("sha256").update(bytes).digest("hex");

export type PrepareResult = { ok: true; attachments: AssistantAttachment[] } | { ok: false; reason: string };

// Validates what the renderer sent and stores the images. All-or-nothing: if any
// file is refused, nothing is written.
export function prepareAttachments(inputs: unknown, dir: string = attachmentsDir()): PrepareResult {
  if (inputs === undefined || inputs === null) return { ok: true, attachments: [] };
  if (!Array.isArray(inputs)) return { ok: false, reason: "Attachments were malformed" };
  if (inputs.length > MAX_ATTACHMENTS) return { ok: false, reason: `Attach at most ${MAX_ATTACHMENTS} files at a time` };

  const prepared: { attachment: AssistantAttachment; bytes: Uint8Array }[] = [];
  let total = 0;
  for (const input of inputs) {
    const data: unknown = input?.data;
    const bytes = data instanceof Uint8Array ? data : data instanceof ArrayBuffer ? new Uint8Array(data) : null;
    if (!bytes || bytes.length === 0) return { ok: false, reason: "An attachment was empty" };
    const name = cleanName(input?.name);
    total += bytes.length;
    if (total > MAX_TOTAL_BYTES) return { ok: false, reason: "Those attachments are too large together" };

    const imageMime = sniffImageMime(bytes);
    if (imageMime) {
      if (bytes.length > MAX_IMAGE_BYTES) return { ok: false, reason: `${name} is too large (8 MB limit for images)` };
      prepared.push({
        attachment: { id: sha256(bytes), name, mime: imageMime, kind: "image", size: bytes.length },
        bytes,
      });
      continue;
    }
    if (bytes.length > MAX_TEXT_BYTES) {
      return { ok: false, reason: `${name} is too large (200 KB limit for text files)` };
    }
    const text = decodeText(bytes);
    if (text === null) return { ok: false, reason: `${name} isn't an image or a text file I can read` };
    const truncated = text.length > TEXT_MAX_CHARS;
    prepared.push({
      attachment: {
        id: sha256(bytes),
        name,
        mime: textMime(String(input?.mime ?? "")),
        kind: "text",
        size: bytes.length,
        text: text.slice(0, TEXT_MAX_CHARS),
        ...(truncated ? { truncated: true } : {}),
      },
      bytes,
    });
  }

  try {
    for (const { attachment, bytes } of prepared) {
      if (attachment.kind !== "image") continue;
      fs.mkdirSync(dir, { recursive: true });
      try {
        fs.writeFileSync(path.join(dir, attachment.id), bytes, { flag: "wx" });
      } catch (err) {
        // The same picture sent twice is stored once.
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      }
    }
  } catch {
    return { ok: false, reason: "Couldn't save the attachment" };
  }
  return { ok: true, attachments: prepared.map((p) => p.attachment) };
}

// Recently used images stay in memory: the same few are re-read on every request
// in a chat. Least recently used goes first, and the cache is bounded by size as
// well as count — an 8 MB image is ~11 MB as a data URL, so a count alone could
// hold over 100 MB.
const cache = new Map<string, string>();
const CACHE_MAX = 12;
export const CACHE_MAX_CHARS = 32 * 1024 * 1024;
let cachedChars = 0;

function cacheDelete(key: string): void {
  const url = cache.get(key);
  if (url === undefined) return;
  cachedChars -= url.length;
  cache.delete(key);
}

function cachePut(key: string, url: string): void {
  if (url.length > CACHE_MAX_CHARS) return;
  cache.set(key, url);
  cachedChars += url.length;
  while (cache.size > CACHE_MAX || cachedChars > CACHE_MAX_CHARS) {
    cacheDelete(cache.keys().next().value as string);
  }
}

export function readImageDataUrl(id: string, dir: string = attachmentsDir()): string | null {
  if (!ATTACHMENT_ID.test(id)) return null;
  const key = `${dir}\0${id}`;
  const hit = cache.get(key);
  if (hit) {
    // Re-inserted so it counts as the most recently used.
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  try {
    const bytes = fs.readFileSync(path.join(dir, id));
    const mime = sniffImageMime(bytes);
    if (!mime) return null;
    const url = `data:${mime};base64,${bytes.toString("base64")}`;
    cachePut(key, url);
    return url;
  } catch {
    return null;
  }
}

// Where an image lives on disk, for copying out; null for anything that isn't a
// well-formed id of a file that exists.
export function attachmentPath(id: string, dir: string = attachmentsDir()): string | null {
  if (!ATTACHMENT_ID.test(id)) return null;
  const file = path.join(dir, id);
  return fs.existsSync(file) ? file : null;
}

// Removes image files. The caller says which are no longer referenced anywhere.
export function deleteAttachmentFiles(ids: string[], dir: string = attachmentsDir()): void {
  for (const id of ids) {
    if (!ATTACHMENT_ID.test(id)) continue;
    cacheDelete(`${dir}\0${id}`);
    try {
      fs.unlinkSync(path.join(dir, id));
    } catch {
      // Already gone.
    }
  }
}
