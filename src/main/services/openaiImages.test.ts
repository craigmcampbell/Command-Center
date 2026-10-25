import { afterEach, describe, expect, it, vi } from "vitest";
import { generateImage } from "./openaiImages";

const key = { apiKey: "sk-test" };
const PNG_B64 = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]).toString("base64");

function stubFetch(status: number, body: unknown) {
  const fn = vi.fn(async (_url: string, _init: RequestInit) => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}
afterEach(() => vi.unstubAllGlobals());

describe("generateImage", () => {
  it("posts a medium-quality square PNG request and decodes the base64 image", async () => {
    const fn = stubFetch(200, { data: [{ b64_json: PNG_B64 }] });
    const res = await generateImage(key, { prompt: "  a red fox  " });
    expect(fn.mock.calls[0][0]).toBe("https://api.openai.com/v1/images/generations");
    const init = fn.mock.calls[0][1];
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
    expect(JSON.parse(init.body as string)).toEqual({
      model: "gpt-image-1",
      prompt: "a red fox",
      size: "1024x1024",
      quality: "medium",
      output_format: "png",
      n: 1,
    });
    expect(res).toMatchObject({ ok: true, mime: "image/png" });
    expect([...(res as { data: Uint8Array }).data]).toEqual([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  });

  it("honours shape, quality and a configured model", async () => {
    const fn = stubFetch(200, { data: [{ b64_json: PNG_B64 }] });
    await generateImage({ ...key, imageModel: " gpt-image-1.5 " }, { prompt: "x", shape: "landscape", quality: "high" });
    expect(JSON.parse(fn.mock.calls[0][1].body as string)).toMatchObject({
      model: "gpt-image-1.5",
      size: "1536x1024",
      quality: "high",
    });
    await generateImage(key, { prompt: "x", shape: "portrait" });
    expect(JSON.parse(fn.mock.calls[1][1].body as string).size).toBe("1024x1536");
  });

  it("cuts an over-long prompt", async () => {
    const fn = stubFetch(200, { data: [{ b64_json: PNG_B64 }] });
    await generateImage(key, { prompt: "p".repeat(9000) });
    expect(JSON.parse(fn.mock.calls[0][1].body as string).prompt).toHaveLength(4000);
  });

  it("fails soft without a key or a prompt, without calling OpenAI", async () => {
    const fn = stubFetch(200, {});
    expect(await generateImage({}, { prompt: "x" })).toMatchObject({ ok: false, reason: expect.stringContaining("API key") });
    expect(await generateImage({ adminApiKey: "sk-admin" }, { prompt: "x" })).toMatchObject({ ok: false });
    expect(await generateImage(key, { prompt: "  " })).toEqual({ ok: false, reason: "prompt is required" });
    expect(fn).not.toHaveBeenCalled();
  });

  it("reports rejected keys, rate limits, refused prompts and empty answers", async () => {
    stubFetch(401, { error: { message: "bad key" } });
    expect(await generateImage(key, { prompt: "x" })).toEqual({ ok: false, reason: "OpenAI API key rejected" });
    stubFetch(429, {});
    expect(await generateImage(key, { prompt: "x" })).toMatchObject({ ok: false, reason: expect.stringContaining("rate limit") });
    stubFetch(400, { error: { message: "Your request was rejected by the safety system." } });
    expect(await generateImage(key, { prompt: "x" })).toEqual({
      ok: false,
      reason: "OpenAI couldn't generate the image: Your request was rejected by the safety system.",
    });
    stubFetch(200, { data: [] });
    expect(await generateImage(key, { prompt: "x" })).toEqual({ ok: false, reason: "OpenAI returned no image" });
    stubFetch(200, { data: [{ url: "https://example.com/x.png" }] });
    expect(await generateImage(key, { prompt: "x" })).toEqual({ ok: false, reason: "OpenAI returned no image" });
  });

  it("reports a network failure, and a Stop as a stop", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await generateImage(key, { prompt: "x" })).toEqual({ ok: false, reason: "Couldn't reach OpenAI" });
    const controller = new AbortController();
    controller.abort();
    expect(await generateImage(key, { prompt: "x" }, controller.signal)).toEqual({
      ok: false,
      reason: "Image generation was stopped",
    });
  });
});
