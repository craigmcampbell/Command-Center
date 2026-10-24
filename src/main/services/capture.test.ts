import { describe, expect, it, vi } from "vitest";

// capture.ts composes services that open SQLite; only the pure formatter is under test.
vi.mock("./scratchpad", () => ({ getScratchpad: vi.fn(), saveScratchpad: vi.fn() }));
vi.mock("./grimoire", () => ({ readDailyNote: vi.fn(), saveDailyNote: vi.fn() }));
vi.mock("./settings", () => ({ getGrimoireSettings: vi.fn() }));

import { formatCaptureEntry } from "./capture";

describe("formatCaptureEntry", () => {
  it("leaves a single line exactly as before", () => {
    expect(formatCaptureEntry("14:05", "buy milk")).toBe("- 14:05 buy milk");
  });

  it("indents every continuation line so the capture stays one list item", () => {
    const entry = formatCaptureEntry(
      "14:05",
      "From the assistant:\n\n- one\n- two\n\n```ts\nconst x = 1;\n```"
    );
    expect(entry).toBe(
      ["- 14:05 From the assistant:", "", "  - one", "  - two", "", "  ```ts", "  const x = 1;", "  ```"].join("\n")
    );
  });

  it("never leaves trailing whitespace on blank lines", () => {
    const entry = formatCaptureEntry("09:00", "a\n   \nb");
    expect(entry.split("\n")).toEqual(["- 09:00 a", "", "  b"]);
  });

  it("normalises Windows and old-Mac line endings", () => {
    expect(formatCaptureEntry("09:00", "a\r\nb\rc")).toBe("- 09:00 a\n  b\n  c");
  });
});
