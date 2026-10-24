// The Home tab's "needs attention" strip. Pure — no React, no IPC, and the
// clock is a parameter — so the rules can be tested directly, same as alerts.ts.
//
// Everything here is derived from state App.tsx already holds; this adds no
// fetching of its own. Each source is optional because each loads on its own
// schedule: a source that hasn't answered yet (null) or failed (ok: false) just
// contributes nothing, so a missing token never reads as "all clear" for that
// source — the strip's `ready` flag is what gates the all-clear message.

import type {
  CalendarResult,
  GitHubStatusResult,
  ProcessConfig,
  ProcessStatus,
  TodoistResult,
  YnabMonthResult,
  YnabUnapprovedResult,
} from "../../../shared/types";
import { isCiFailure, isCrash, isOverspent } from "./alerts";

export type TodaySeverity = "alert" | "warn" | "info";

export interface TodayItem {
  id: string;
  severity: TodaySeverity;
  label: string;
  // Tab to jump to when clicked; absent when the thing is already on Home.
  tab?: string;
}

export interface TodayInput {
  todoist: TodoistResult | null;
  calendar: CalendarResult | null;
  github: GitHubStatusResult | null;
  unapproved: YnabUnapprovedResult | null;
  budgetHealth: YnabMonthResult | null;
  processStatuses: ProcessStatus[];
  processConfigs: ProcessConfig[];
  now: Date;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function localDateKey(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function minutesLabel(mins: number): string {
  if (mins < 1) return "now";
  if (mins < 60) return `in ${mins}m`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m === 0 ? `in ${h}h` : `in ${h}h ${m}m`;
}

// The next timed event today that hasn't ended. Only when the calendar widget
// is showing today: it can be paged to another day, and "next up" about a
// different day would be misleading.
function nextEvent(calendar: CalendarResult | null, now: Date): TodayItem | null {
  if (!calendar?.ok || calendar.date !== localDateKey(now)) return null;
  const upcoming = calendar.events
    .filter((e) => !e.allDay)
    .map((e) => ({ e, start: Date.parse(e.start), end: Date.parse(e.end) }))
    .filter((x) => Number.isFinite(x.start) && (x.end > now.getTime() || x.start > now.getTime()))
    .sort((a, b) => a.start - b.start)[0];
  if (!upcoming) return null;

  const mins = Math.round((upcoming.start - now.getTime()) / 60_000);
  const when =
    mins <= 0
      ? "happening now"
      : `${new Date(upcoming.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })} (${minutesLabel(mins)})`;
  return {
    id: "next-event",
    // Close enough to need leaving the desk for.
    severity: mins <= 15 ? "warn" : "info",
    label: `${upcoming.e.summary || "Event"} — ${when}`,
  };
}

export function buildTodayItems(input: TodayInput): TodayItem[] {
  const items: TodayItem[] = [];

  const next = nextEvent(input.calendar, input.now);
  if (next) items.push(next);

  if (input.todoist?.ok) {
    const overdue = input.todoist.tasks.filter((t) => t.overdue).length;
    const dueToday = input.todoist.tasks.length - overdue;
    if (overdue > 0) items.push({ id: "overdue", severity: "alert", label: `${plural(overdue, "overdue task")}` });
    if (dueToday > 0) items.push({ id: "due-today", severity: "info", label: `${dueToday} due today` });
  }

  if (input.github?.ok) {
    const failing = input.github.repos.filter((r) => r.ok && r.ci && isCiFailure(r.ci.conclusion));
    if (failing.length > 0) {
      items.push({
        id: "ci",
        severity: "alert",
        label: `CI failing: ${failing.map((r) => r.label).join(", ")}`,
        tab: "development",
      });
    }
    const reviews = input.github.reviewRequested.length;
    if (reviews > 0) {
      items.push({
        id: "reviews",
        severity: "warn",
        label: `${plural(reviews, "PR")} awaiting your review`,
        tab: "development",
      });
    }
  }

  const crashed = input.processStatuses.filter((s) => isCrash(s.exitCode));
  if (crashed.length > 0) {
    const names = crashed.map((s) => input.processConfigs.find((c) => c.id === s.id)?.label ?? s.id);
    items.push({ id: "processes", severity: "alert", label: `Crashed: ${names.join(", ")}`, tab: "development" });
  }

  if (input.budgetHealth?.ok) {
    const over = input.budgetHealth.categories.filter((c) => isOverspent(c.balance)).length;
    if (over > 0) {
      items.push({ id: "overspent", severity: "warn", label: `${plural(over, "category", "categories")} overspent`, tab: "finances" });
    }
  }

  if (input.unapproved?.ok && input.unapproved.transactions.length > 0) {
    items.push({
      id: "unapproved",
      severity: "info",
      label: `${plural(input.unapproved.transactions.length, "unapproved transaction")}`,
      tab: "finances",
    });
  }

  const rank: Record<TodaySeverity, number> = { alert: 0, warn: 1, info: 2 };
  // Stable: ties keep insertion order (next event first within its band).
  return items.map((item, i) => ({ item, i })).sort((a, b) => rank[a.item.severity] - rank[b.item.severity] || a.i - b.i).map((x) => x.item);
}

// Whether enough has loaded for an empty list to mean "nothing needs you"
// rather than "nothing has answered yet".
export function todayReady(input: Pick<TodayInput, "todoist" | "github">): boolean {
  return input.todoist !== null && input.github !== null;
}
