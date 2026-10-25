// Preparing files for the Assistant composer. Main re-validates everything (it
// sniffs types from the bytes and enforces the same limits); this just keeps a
// bad pick from travelling over IPC, and shrinks big pictures first.

export const MAX_FILES = 5;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
export const MAX_TEXT_BYTES = 200 * 1024;
export const MAX_TOTAL_BYTES = 12 * 1024 * 1024;

// A picture is shrunk to this long edge before sending: vision models downscale
// anyway, and a 12-megapixel photo is a slow, costly upload for no benefit.
const MAX_EDGE = 1568;
const KEEP_ORIGINAL_BELOW_BYTES = 1.5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/gif", "image/webp"]);

export interface PendingAttachment {
  key: string;
  name: string;
  mime: string;
  kind: "image" | "text";
  size: number;
  data: Uint8Array;
  // For the chip and the live transcript; images only.
  previewUrl?: string;
}

async function shrinkImage(file: File): Promise<{ data: Uint8Array; mime: string } | null> {
  const original = new Uint8Array(await file.arrayBuffer());
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1 && file.size <= KEEP_ORIGINAL_BELOW_BYTES) {
      bitmap.close();
      return { data: original, mime: file.type };
    }
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) return { data: original, mime: file.type };
    // JPEG has no transparency; a transparent PNG would otherwise turn black.
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
    if (!blob) return { data: original, mime: file.type };
    return { data: new Uint8Array(await blob.arrayBuffer()), mime: "image/jpeg" };
  } catch {
    // Not decodable here; main will decide whether the bytes are a real image.
    return { data: original, mime: file.type };
  }
}

// A picked file, ready to send, or the reason it can't be.
export async function readAttachment(file: File): Promise<PendingAttachment | string> {
  const name = file.name || "pasted-image";
  const key = crypto.randomUUID();
  if (file.type.startsWith("image/")) {
    if (!IMAGE_TYPES.has(file.type)) return `${name}: only PNG, JPEG, GIF and WebP images are supported`;
    if (file.size > 40 * 1024 * 1024) return `${name} is too large`;
    const shrunk = await shrinkImage(file);
    if (!shrunk) return `${name} couldn't be read`;
    if (shrunk.data.length > MAX_IMAGE_BYTES) return `${name} is too large (8 MB limit for images)`;
    return {
      key,
      name,
      mime: shrunk.mime,
      kind: "image",
      size: shrunk.data.length,
      data: shrunk.data,
      previewUrl: URL.createObjectURL(new Blob([shrunk.data as BlobPart], { type: shrunk.mime })),
    };
  }
  if (file.size > MAX_TEXT_BYTES) return `${name} is too large (200 KB limit for text files)`;
  const data = new Uint8Array(await file.arrayBuffer());
  if (data.length === 0) return `${name} is empty`;
  try {
    if (data.slice(0, 8000).includes(0)) throw new Error("binary");
    new TextDecoder("utf-8", { fatal: true }).decode(data);
  } catch {
    return `${name} isn't an image or a text file I can read`;
  }
  return { key, name, mime: file.type || "text/plain", kind: "text", size: data.length, data };
}

// Which object URLs the transcript still shows, and which of the ones it showed
// before it has let go of (to be revoked).
export function previewUrlsToRelease(
  previous: ReadonlySet<string>,
  items: { attachments?: { previewUrl?: string }[] }[]
): { keep: Set<string>; release: string[] } {
  const keep = new Set<string>();
  for (const item of items) for (const a of item.attachments ?? []) if (a.previewUrl) keep.add(a.previewUrl);
  return { keep, release: [...previous].filter((url) => !keep.has(url)) };
}

export function describeSize(bytes: number): string {
  return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}
