// Command palette action registry — the single place new palette actions get
// added. buildActions() is called fresh each time the palette opens, so it
// always reflects current state (running containers, current projects, etc.)
// rather than a stale snapshot. No IPC lives here — every run() just calls
// the same window.api methods the regular widgets already use.

import type { DockerResult, LinkItem } from "../../shared/types";

export interface PaletteAction {
  id: string;
  title: string;
  category: string;
  run: () => void | Promise<void>;
}

export interface PaletteTab {
  id: string;
  label: string;
}

export interface PaletteContext {
  tabs: PaletteTab[];
  onNavigateTab: (id: string) => void;
  claudeProjects: LinkItem[];
  localApps: LinkItem[];
  learning: LinkItem[];
  fileLinks: LinkItem[];
  docker: DockerResult | null;
  onRefreshDocker: () => Promise<void>;
  onRefreshAll: () => Promise<void>;
  onNewScratchpadNote: () => Promise<void>;
}

export function buildActions(ctx: PaletteContext): PaletteAction[] {
  const actions: PaletteAction[] = [];

  for (const tab of ctx.tabs) {
    actions.push({
      id: `tab:${tab.id}`,
      title: `Go to ${tab.label}`,
      category: "Tab",
      run: () => ctx.onNavigateTab(tab.id),
    });
  }

  for (const project of ctx.claudeProjects) {
    actions.push({
      id: `project:${project.id}`,
      title: project.label,
      category: "Project",
      run: async () => {
        await window.api.claude.launch(project.link);
      },
    });
  }

  for (const app of ctx.localApps) {
    actions.push({
      id: `app:${app.id}`,
      title: app.label,
      category: "App",
      run: async () => {
        await window.api.openUrl(app.link);
      },
    });
  }

  for (const item of ctx.learning) {
    actions.push({
      id: `learning:${item.id}`,
      title: item.label,
      category: "Learning",
      run: async () => {
        await window.api.openUrl(item.link);
      },
    });
  }

  for (const item of ctx.fileLinks) {
    actions.push({
      id: `fileLink:${item.id}`,
      title: item.label,
      category: "File Link",
      run: async () => {
        await window.api.forklift.open(item.link);
      },
    });
  }

  if (ctx.docker?.ok) {
    for (const container of ctx.docker.containers) {
      const running = container.state === "running";
      actions.push({
        id: `docker:${container.name}`,
        title: `${running ? "Stop" : "Start"} ${container.name}`,
        category: "Container",
        run: async () => {
          const toggle = running ? window.api.docker.stop : window.api.docker.start;
          await toggle(container.name);
          await ctx.onRefreshDocker();
        },
      });
    }
  }

  // Extend this list with more quick actions as they come up.
  actions.push(
    {
      id: "action:new-scratchpad-note",
      title: "New scratchpad note",
      category: "Action",
      run: () => ctx.onNewScratchpadNote(),
    },
    {
      id: "action:refresh-all",
      title: "Refresh all",
      category: "Action",
      run: () => ctx.onRefreshAll(),
    }
  );

  return actions;
}

// Case-insensitive subsequence match — query characters must appear in text
// in the same order, not necessarily contiguously, so "gcal" still matches
// "Go to Calendar isn't needed" etc.
export function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) qi++;
  }
  return qi === q.length;
}

export function filterActions(actions: PaletteAction[], query: string): PaletteAction[] {
  const trimmed = query.trim();
  if (!trimmed) return actions;
  return actions.filter((a) => fuzzyMatch(trimmed, `${a.title} ${a.category}`));
}
