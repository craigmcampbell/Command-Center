import { describe, expect, it } from "vitest";
import { previewUrlsToRelease } from "./attachments";

describe("previewUrlsToRelease", () => {
  it("keeps what is still shown and releases what is gone", () => {
    const items = [{ attachments: [{ previewUrl: "blob:a" }, {}] }, {}, { attachments: [{ previewUrl: "blob:c" }] }];
    const { keep, release } = previewUrlsToRelease(new Set(["blob:a", "blob:b"]), items);
    expect([...keep].sort()).toEqual(["blob:a", "blob:c"]);
    expect(release).toEqual(["blob:b"]);
  });

  it("releases everything when the transcript is cleared", () => {
    expect(previewUrlsToRelease(new Set(["blob:a"]), []).release).toEqual(["blob:a"]);
  });
});
