import { expect, it } from "vitest";
import { matchesProjectFolder } from "./projectPaths";
it("matches normalized folders and descendants, excluding sibling prefixes and other worktrees", () => {
  expect(matchesProjectFolder("/code/app", "/code/app/")).toBe(true);
  expect(matchesProjectFolder("/code/app/src/../web", "/code/app")).toBe(true);
  expect(matchesProjectFolder("/code/application", "/code/app")).toBe(false);
  expect(matchesProjectFolder("/code/app/../app-worktree", "/code/app")).toBe(false);
  expect(matchesProjectFolder("", "/code/app")).toBe(false);
});
