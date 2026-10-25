import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Claude Code keeps other sessions' worktrees under .claude/worktrees, each
    // a full checkout. Without this, `npm test` runs every copy of the suite
    // (inflating the count), and the copies race on shared temp folders.
    exclude: [...configDefaults.exclude, ".claude/**"],
  },
});
