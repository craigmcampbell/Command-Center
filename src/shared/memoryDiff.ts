// A line-level diff for the memory file, used to show what a "Tidy" proposal
// would change before anything is written. Memory is a set of one-line facts, so
// a multiset comparison is the right granularity: order changes are ignored
// (tidying may reorder), duplicates are counted (merging two identical lines
// shows as one removal).

export interface MemoryDiff {
  // Lines that would disappear.
  removed: string[];
  // Lines that would be new (including a merged line that rewords two old ones).
  added: string[];
  // Lines present in both.
  kept: number;
}

const significant = (text: string): string[] => text.split("\n").filter((line) => line.trim() !== "");

export function diffMemory(before: string, after: string): MemoryDiff {
  const remaining = new Map<string, number>();
  for (const line of significant(after)) remaining.set(line, (remaining.get(line) ?? 0) + 1);

  const removed: string[] = [];
  let kept = 0;
  for (const line of significant(before)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
      kept++;
    } else {
      removed.push(line);
    }
  }

  // What's left over in `after` is new; emitted in `after`'s order.
  const added: string[] = [];
  for (const line of significant(after)) {
    const count = remaining.get(line) ?? 0;
    if (count > 0) {
      remaining.set(line, count - 1);
      added.push(line);
    }
  }
  return { removed, added, kept };
}
