import { describe, expect, it } from "vitest";
import { chatToMarkdown, replyToMarkdown } from "./assistantMarkdown";

describe("replyToMarkdown", () => {
  it("quotes the question so the saved note stands alone", () => {
    expect(replyToMarkdown("what's due?", "Two tasks.\n\n- a\n- b")).toBe(
      "Asked the assistant: “what's due?”\n\nTwo tasks.\n\n- a\n- b"
    );
  });
  it("shortens a long question to one line", () => {
    const out = replyToMarkdown("word ".repeat(100), "ok");
    const header = out.split("\n")[0];
    expect(header.length).toBeLessThan(130);
    expect(header.endsWith("…”")).toBe(true);
  });
  it("copes with no known question", () => {
    expect(replyToMarkdown(null, " hi ")).toBe("From the assistant:\n\nhi");
  });
});

describe("chatToMarkdown", () => {
  it("labels each turn and skips errors and empty messages", () => {
    expect(
      chatToMarkdown("Sprint planning", [
        { role: "user", text: "plan it" },
        { role: "error", text: "Rate limited" },
        { role: "assistant", text: "Here is a plan." },
        { role: "assistant", text: "   " },
      ])
    ).toBe("Assistant chat — Sprint planning\n\n**You:** plan it\n\n**Assistant:** Here is a plan.");
  });
  it("works for an untitled chat", () => {
    expect(chatToMarkdown(null, [{ role: "user", text: "hi" }])).toBe("Assistant chat\n\n**You:** hi");
  });
});
