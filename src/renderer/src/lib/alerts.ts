// Transition detection for OS notifications. Pure — no React, no IPC, no
// Date.now() — so the rules can be reasoned about and tested directly.
//
// Everything here is EDGE-triggered: we notify when something *changes into* a
// bad state, never because it currently is one. Level-triggering would re-fire
// about the same red build on every poll (every 5 min for CI, every 15s for
// Docker), which is how notification features become things people turn off.

import type {
  AppAlert,
  DockerResult,
  GitHubStatusResult,
  NotificationSettings,
  ProcessConfig,
  ProcessStatus,
  TraySummary,
} from "../../../shared/types";

export interface AlertSnapshot {
  ci: Record<string, string | null>;
  processes: Record<string, number | null>;
  containers: Record<string, string>;
}

// GitHub reports several flavours of "broken". `cancelled` and `skipped` are
// deliberately excluded — those are usually someone doing something on
// purpose, not a build that needs attention.
const CI_FAILURE_CONCLUSIONS = new Set(["failure", "timed_out", "startup_failure"]);

function isCiFailure(conclusion: string | null | undefined): boolean {
  return conclusion != null && CI_FAILURE_CONCLUSIONS.has(conclusion);
}

// A process that ran and exited badly. A deliberate stop kills the group with
// SIGTERM, and services/processes.ts records `null` for a signal death (its
// exit handler takes only the `code` argument), so manual stops can't reach
// this — no "was this stop intentional?" bookkeeping needed anywhere.
function isCrash(exitCode: number | null | undefined): boolean {
  return exitCode != null && exitCode !== 0;
}

export function buildSnapshot(
  github: GitHubStatusResult | null,
  processStatuses: ProcessStatus[],
  docker: DockerResult | null
): AlertSnapshot {
  const ci: Record<string, string | null> = {};
  if (github?.ok) {
    for (const repo of github.repos) {
      // `ci: null` means no run has ever been recorded for the repo; that's
      // absence of information, not a state to compare against, so skip it
      // entirely rather than recording a null that could look like a change.
      if (repo.ci) ci[repo.label] = repo.ci.conclusion;
    }
  }

  const processes: Record<string, number | null> = {};
  for (const status of processStatuses) {
    // A process never started this session simply has no entry (same
    // convention ManagedProcessesWidget uses), so it can't look like a change.
    processes[status.id] = status.exitCode;
  }

  const containers: Record<string, string> = {};
  if (docker?.ok) {
    for (const c of docker.containers) containers[c.name] = c.state;
  }

  return { ci, processes, containers };
}

export function diffAlerts(
  prev: AlertSnapshot | null,
  next: AlertSnapshot,
  settings: NotificationSettings,
  processConfigs: ProcessConfig[] = []
): AppAlert[] {
  // First observation after launch: adopt it as the baseline silently.
  // Otherwise starting the app with CI already red would fire a burst of
  // notifications about things the user already knows.
  if (prev === null) return [];
  if (settings.enabled === false) return [];

  const alerts: AppAlert[] = [];

  if (settings.ciFailure !== false) {
    for (const [label, conclusion] of Object.entries(next.ci)) {
      // A repo absent from prev is newly configured, not newly broken.
      if (!(label in prev.ci)) continue;
      if (isCiFailure(conclusion) && !isCiFailure(prev.ci[label])) {
        alerts.push({
          kind: "ci",
          key: label,
          title: "CI failed",
          body: `${label} — latest run ${conclusion}`,
          tab: "development",
        });
      }
    }
  }

  if (settings.processCrash !== false) {
    const labelFor = (id: string) => processConfigs.find((p) => p.id === id)?.label ?? id;
    for (const [id, exitCode] of Object.entries(next.processes)) {
      if (!(id in prev.processes)) continue;
      if (isCrash(exitCode) && !isCrash(prev.processes[id])) {
        alerts.push({
          kind: "process",
          key: id,
          title: "Process crashed",
          body: `${labelFor(id)} exited with code ${exitCode}`,
          tab: "development",
        });
      }
    }
  }

  if (settings.dockerExit !== false) {
    for (const [name, state] of Object.entries(next.containers)) {
      if (!(name in prev.containers)) continue;
      if (state === "exited" && prev.containers[name] === "running") {
        alerts.push({
          kind: "docker",
          key: name,
          title: "Container stopped",
          body: `${name} exited`,
          tab: "development",
        });
      }
    }
  }

  return alerts;
}

// Level-triggered, unlike the alerts above — the tray shows what is currently
// true, so it's computed from the snapshot alone with no history.
export function summarize(snapshot: AlertSnapshot): TraySummary {
  return {
    ciFailures: Object.values(snapshot.ci).filter(isCiFailure).length,
    processesDown: Object.values(snapshot.processes).filter(isCrash).length,
    containersExited: Object.values(snapshot.containers).filter((s) => s === "exited").length,
  };
}
