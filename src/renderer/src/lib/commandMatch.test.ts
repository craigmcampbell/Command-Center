import { describe, expect, it } from "vitest";
import { matchCommands } from "./commandMatch";

const cmd = (name: string, description = "") => ({ name, description, kind: "skill" as const });
const all = [
  cmd("code-review", "Review the changes since a commit"),
  cmd("humanizer", "Rewrite AI-sounding text"),
  cmd("plan-day", "Plan my day from tasks"),
  cmd("review-budget", "Check this month's budget"),
  cmd("writing-shape", "Shape a draft; humanize the tone"),
];

describe("matchCommands", () => {
  it("lists everything for a bare slash", () => {
    expect(matchCommands(all, "")).toEqual(all);
  });

  it("matches anywhere in the name", () => {
    expect(matchCommands(all, "izer").map((c) => c.name)).toEqual(["humanizer"]);
    expect(matchCommands(all, "day").map((c) => c.name)).toEqual(["plan-day"]);
  });

  it("matches descriptions too", () => {
    expect(matchCommands(all, "budget").map((c) => c.name)).toEqual(["review-budget"]);
    expect(matchCommands(all, "tone").map((c) => c.name)).toEqual(["writing-shape"]);
  });

  it("ranks name prefix, then name contains, then description", () => {
    expect(matchCommands(all, "review").map((c) => c.name)).toEqual(["review-budget", "code-review"]);
    expect(matchCommands(all, "human").map((c) => c.name)).toEqual(["humanizer", "writing-shape"]);
  });

  it("ignores case and finds nothing for nonsense", () => {
    expect(matchCommands(all, "HUM")[0].name).toBe("humanizer");
    expect(matchCommands(all, "zzz")).toEqual([]);
  });
});
