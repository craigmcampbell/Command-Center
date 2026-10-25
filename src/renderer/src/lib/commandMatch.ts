import type { AssistantCommandInfo } from "../../../shared/types";

// Slash commands that match what was typed after "/", best first: names that
// start with it, then names that contain it, then descriptions that do. The
// original order (alphabetical, from main) breaks ties, so results are stable.
export function matchCommands(commands: AssistantCommandInfo[], typed: string): AssistantCommandInfo[] {
  const q = typed.toLowerCase();
  const rank = (c: AssistantCommandInfo): number => {
    const name = c.name.toLowerCase();
    if (name.startsWith(q)) return 0;
    if (name.includes(q)) return 1;
    return c.description.toLowerCase().includes(q) ? 2 : -1;
  };
  return commands
    .map((c, order) => ({ c, order, r: rank(c) }))
    .filter(({ r }) => r >= 0)
    .sort((a, b) => a.r - b.r || a.order - b.order)
    .map(({ c }) => c);
}
