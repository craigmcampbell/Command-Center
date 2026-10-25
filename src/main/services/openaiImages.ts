// Image generation for the Assistant, through OpenAI's Images API
// (POST /v1/images/generations). Checked against OpenAI's reference: the GPT
// image models return `data[0].b64_json` (never a URL), accept the three
// standard sizes and `low | medium | high` quality, and take `output_format`.
//
// This uses a regular project API key (`openai.apiKey`), NOT the Admin key the
// usage widget uses: an Admin key can't generate. Every call costs money, which
// is why assistantTools.ts puts a confirmation card in front of it.

import type { OpenAIScalarConfig } from "../../shared/types";

const API_URL = "https://api.openai.com/v1/images/generations";
export const DEFAULT_IMAGE_MODEL = "gpt-image-1";
// Generation is slow: a high-quality image can take over a minute.
const TIMEOUT_MS = 150_000;
export const PROMPT_MAX_CHARS = 4000;

export const IMAGE_SIZES = {
  square: "1024x1024",
  landscape: "1536x1024",
  portrait: "1024x1536",
} as const;
export type ImageShape = keyof typeof IMAGE_SIZES;
export const IMAGE_QUALITIES = ["low", "medium", "high"] as const;
export type ImageQuality = (typeof IMAGE_QUALITIES)[number];
// Medium is the cost-conscious default; "auto" can pick the expensive one.
export const DEFAULT_QUALITY: ImageQuality = "medium";

export type ImageResult =
  | { ok: true; data: Uint8Array; mime: "image/png" }
  | { ok: false; reason: string };

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export async function generateImage(
  settings: OpenAIScalarConfig | undefined,
  request: { prompt: string; shape?: ImageShape; quality?: ImageQuality },
  signal?: AbortSignal
): Promise<ImageResult> {
  const apiKey = settings?.apiKey?.trim();
  if (!apiKey) return { ok: false, reason: "No OpenAI API key configured for image generation" };
  const prompt = request.prompt.trim();
  if (!prompt) return { ok: false, reason: "prompt is required" };

  const deadline = AbortSignal.timeout(TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(API_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: settings?.imageModel?.trim() || DEFAULT_IMAGE_MODEL,
        prompt: prompt.slice(0, PROMPT_MAX_CHARS),
        size: IMAGE_SIZES[request.shape ?? "square"],
        quality: request.quality ?? DEFAULT_QUALITY,
        output_format: "png",
        n: 1,
      }),
      signal: signal ? AbortSignal.any([signal, deadline]) : deadline,
    });
  } catch {
    return { ok: false, reason: signal?.aborted ? "Image generation was stopped" : "Couldn't reach OpenAI" };
  }

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    // Reported from the status below.
  }
  if (res.status === 401) return { ok: false, reason: "OpenAI API key rejected" };
  if (res.status === 429) return { ok: false, reason: "OpenAI rate limit or quota reached" };
  if (!res.ok) {
    // A refused prompt (moderation) comes back as a 400 with the reason in `error.message`.
    const detail = typeof json?.error?.message === "string" ? `: ${clip(json.error.message, 240)}` : "";
    return { ok: false, reason: `OpenAI couldn't generate the image${detail}` };
  }
  const b64 = json?.data?.[0]?.b64_json;
  if (typeof b64 !== "string" || !b64) return { ok: false, reason: "OpenAI returned no image" };
  const data = new Uint8Array(Buffer.from(b64, "base64"));
  if (data.length === 0) return { ok: false, reason: "OpenAI returned no image" };
  return { ok: true, data, mime: "image/png" };
}
