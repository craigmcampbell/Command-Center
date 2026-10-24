import { describe, expect, it } from "vitest";
import { buildTodayItems, todayReady, type TodayInput } from "./today";

const NOW = new Date(2026, 9, 23, 10, 0, 0); // local 10:00, Oct 23 2026

const base: TodayInput = {
  todoist: null,
  calendar: null,
  github: null,
  unapproved: null,
  budgetHealth: null,
  processStatuses: [],
  processConfigs: [],
  now: NOW,
};

const task = (overdue: boolean) => ({ overdue }) as any;
const ids = (input: Partial<TodayInput>) => buildTodayItems({ ...base, ...input }).map((i) => i.id);

describe("buildTodayItems", () => {
  it("is empty when nothing has loaded or failed", () => {
    expect(buildTodayItems(base)).toEqual([]);
    expect(ids({ todoist: { ok: false, tasks: [], projects: [] }, github: { ok: false, repos: [], reviewRequested: [] } })).toEqual([]);
  });

  it("splits overdue from due-today and ranks alerts first", () => {
    const items = buildTodayItems({
      ...base,
      todoist: { ok: true, projects: [], tasks: [task(false), task(true), task(true)] },
      unapproved: { ok: true, transactions: [{} as any] },
    });
    expect(items.map((i) => [i.id, i.label])).toEqual([
      ["overdue", "2 overdue tasks"],
      ["due-today", "1 due today"],
      ["unapproved", "1 unapproved transaction"],
    ]);
  });

  it("reports failing CI by repo and counts review requests", () => {
    const repo = (label: string, conclusion: string | null) => ({ label, ok: true, ci: { conclusion } }) as any;
    const items = buildTodayItems({
      ...base,
      github: {
        ok: true,
        repos: [repo("a", "failure"), repo("b", "success"), repo("c", "cancelled"), repo("d", "timed_out")],
        reviewRequested: [{} as any, {} as any],
      },
    });
    expect(items.map((i) => i.label)).toEqual(["CI failing: a, d", "2 PRs awaiting your review"]);
    expect(items.every((i) => i.tab === "development")).toBe(true);
  });

  it("names crashed processes from their config, and ignores signal deaths", () => {
    const items = buildTodayItems({
      ...base,
      processConfigs: [{ id: "api", label: "API server" } as any],
      processStatuses: [
        { id: "api", running: false, exitCode: 1, logs: [] },
        { id: "stopped", running: false, exitCode: null, logs: [] },
        { id: "fine", running: false, exitCode: 0, logs: [] },
      ],
    });
    expect(items.map((i) => i.label)).toEqual(["Crashed: API server"]);
  });

  it("counts overspent categories", () => {
    const cat = (balance: number) => ({ balance }) as any;
    expect(
      buildTodayItems({ ...base, budgetHealth: { ok: true, toBeBudgeted: 0, ageOfMoney: null, categories: [cat(-1), cat(5), cat(-0.01)] } }).map((i) => i.label)
    ).toEqual(["2 categories overspent"]);
  });

  describe("next event", () => {
    const event = (summary: string, start: Date, end: Date, allDay = false) =>
      ({ summary, start: start.toISOString(), end: end.toISOString(), allDay }) as any;
    const at = (h: number, m = 0) => new Date(2026, 9, 23, h, m);
    const cal = (events: any[], date = "2026-10-23") => ({ ok: true, date, events }) as any;

    it("picks the first timed event that hasn't ended, and warns when it's close", () => {
      const items = buildTodayItems({
        ...base,
        calendar: cal([
          event("Holiday", at(0), at(23), true),
          event("Earlier", at(8), at(9)),
          event("Standup", at(10, 10), at(10, 30)),
          event("Lunch", at(12), at(13)),
        ]),
      });
      expect(items).toHaveLength(1);
      expect(items[0].severity).toBe("warn");
      expect(items[0].label).toContain("Standup");
      expect(items[0].label).toContain("in 10m");
    });

    it("says 'happening now' for an event in progress", () => {
      const items = buildTodayItems({ ...base, calendar: cal([event("Review", at(9, 30), at(10, 30))]) });
      expect(items[0].label).toBe("Review — happening now");
    });

    it("stays quiet when the widget is showing another day", () => {
      expect(ids({ calendar: cal([event("Standup", at(10, 10), at(10, 30))], "2026-10-24") })).toEqual([]);
    });
  });
});

describe("todayReady", () => {
  it("needs both todoist and github to have answered", () => {
    expect(todayReady({ todoist: null, github: null })).toBe(false);
    expect(todayReady({ todoist: { ok: true, tasks: [], projects: [] }, github: null })).toBe(false);
    expect(todayReady({ todoist: { ok: true, tasks: [], projects: [] }, github: { ok: true, repos: [], reviewRequested: [] } })).toBe(true);
  });
});
