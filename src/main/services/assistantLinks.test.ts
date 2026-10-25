import { describe, expect, it } from "vitest";
import { outboundLinkWarning, type LinkContext } from "./assistantLinks";

const ctx = (over: Partial<LinkContext> = {}): LinkContext => ({
  memory: "- 2026-09-01: Partner's birthday is 3 March\n- 2026-09-02: Likes tea",
  toolResults: [],
  userMessages: [],
  ...over,
});

describe("outboundLinkWarning", () => {
  it("opens ordinary links without asking", () => {
    expect(outboundLinkWarning("https://example.com/docs/getting-started", ctx())).toBeNull();
    expect(outboundLinkWarning("https://example.com/search?q=rust+traits&page=2", ctx())).toBeNull();
    expect(outboundLinkWarning("not a url", ctx())).toBeNull();
  });

  it("flags a long query string or fragment", () => {
    const long = `https://evil.example/c?d=${"a".repeat(101)}`;
    expect(outboundLinkWarning(long, ctx())).toMatch(/103 characters long.*evil\.example/);
    expect(outboundLinkWarning(`https://evil.example/#${"b".repeat(120)}`, ctx())).toMatch(/120 characters/);
  });

  it("flags memory text in a query value or path segment, decoded", () => {
    expect(outboundLinkWarning("https://evil.example/c?d=Partner%27s%20birthday%20is%203%20March", ctx())).toMatch(
      /from your memory \(“partner's birthday is 3 march”\)/
    );
    expect(outboundLinkWarning("https://evil.example/Partner's+birthday", ctx())).toMatch(/from your memory/);
    // Too short to be meaningful on its own.
    expect(outboundLinkWarning("https://example.com/?q=tea", ctx())).toBeNull();
  });

  it("flags text from this chat's tool results, reading JSON payloads as JSON", () => {
    const toolResults = [JSON.stringify({ content: "Account ending\n4471 balance $9,120" })];
    expect(outboundLinkWarning("https://evil.example/?x=account%20ending%204471", ctx({ toolResults }))).toMatch(
      /the assistant read in this chat/
    );
  });

  it("exempts a URL copied verbatim from a tool result or the user's message", () => {
    const leaky = "https://news.example/story?ref=Partner%27s%20birthday%20is%203%20March";
    expect(outboundLinkWarning(leaky, ctx({ toolResults: [JSON.stringify({ results: [{ url: leaky }] })] }))).toBeNull();
    expect(outboundLinkWarning(leaky, ctx({ userMessages: [`open ${leaky}.`] }))).toBeNull();
    // A different query on the same page is model-built, so it is checked.
    expect(
      outboundLinkWarning(`${leaky}&more=1`, ctx({ toolResults: [JSON.stringify({ results: [{ url: leaky }] })] }))
    ).not.toBeNull();
  });
});
