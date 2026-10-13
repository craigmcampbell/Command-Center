import { describe, expect, it } from "vitest";
import { diffMemory } from "./memoryDiff";

describe("diffMemory", () => {
  it("reports nothing for identical files", () => {
    expect(diffMemory("- a\n- b\n", "- a\n- b\n")).toEqual({ removed: [], added: [], kept: 2 });
  });

  it("finds removed and added lines", () => {
    expect(diffMemory("- a\n- b\n- c\n", "- a\n- c\n- d\n")).toEqual({
      removed: ["- b"],
      added: ["- d"],
      kept: 2,
    });
  });

  it("ignores reordering and blank lines", () => {
    expect(diffMemory("- a\n\n- b\n", "- b\n- a\n")).toEqual({ removed: [], added: [], kept: 2 });
  });

  it("counts duplicates, so merging two identical lines is one removal", () => {
    expect(diffMemory("- a\n- a\n- b\n", "- a\n- b\n")).toEqual({
      removed: ["- a"],
      added: [],
      kept: 2,
    });
  });

  it("shows a merged line as the old ones removed and the new one added", () => {
    expect(
      diffMemory(
        "- 2026-10-01: Likes terse answers\n- 2026-10-05: Prefers short replies\n",
        "- 2026-10-05: Likes terse, short replies\n"
      )
    ).toEqual({
      removed: ["- 2026-10-01: Likes terse answers", "- 2026-10-05: Prefers short replies"],
      added: ["- 2026-10-05: Likes terse, short replies"],
      kept: 0,
    });
  });

  it("handles empty sides", () => {
    expect(diffMemory("", "- a\n")).toEqual({ removed: [], added: ["- a"], kept: 0 });
    expect(diffMemory("- a\n", "")).toEqual({ removed: ["- a"], added: [], kept: 0 });
  });
});
