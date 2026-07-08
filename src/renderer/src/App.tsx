// The UI. Runs sandboxed — it can only reach the main process through the
// `window.api` object that the preload set up. No Node, no fs, no exec here.

import { useCallback, useEffect, useState } from "react";
import type {
  AppConfig,
  DockerResult,
  DailyNoteResult,
  MissionsResult,
  TodoistResult,
} from "../../shared/types";
import DockerWidget from "./components/DockerWidget";
import DailyNoteWidget from "./components/DailyNoteWidget";
import MissionsWidget from "./components/MissionsWidget";
import TodoistWidget from "./components/TodoistWidget";
import SillyTavernWidget from "./components/SillyTavernWidget";
import ClaudeLauncherWidget from "./components/ClaudeLauncherWidget";

function tickClock(): string {
  return new Date()
    .toLocaleString("en-US", {
      weekday: "short",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    })
    .toUpperCase();
}

export default function App() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [docker, setDocker] = useState<DockerResult | null>(null);
  const [daily, setDaily] = useState<DailyNoteResult | null>(null);
  const [missions, setMissions] = useState<MissionsResult | null>(null);
  const [todoist, setTodoist] = useState<TodoistResult | null>(null);
  const [clock, setClock] = useState(tickClock());

  const loadDocker = useCallback(async () => {
    setDocker(await window.api.docker.list());
  }, []);
  const loadDaily = useCallback(async () => {
    setDaily(await window.api.grimoire.dailyNote());
  }, []);
  const loadMissions = useCallback(async () => {
    setMissions(await window.api.grimoire.missions());
  }, []);
  const loadTodoist = useCallback(async () => {
    setTodoist(await window.api.todoist.tasks());
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.all([loadDocker(), loadDaily(), loadMissions(), loadTodoist()]);
  }, [loadDocker, loadDaily, loadMissions, loadTodoist]);

  // ---- boot: load config, then every widget, then start Docker's refresh ----
  useEffect(() => {
    let intervalId: ReturnType<typeof setInterval> | undefined;
    (async () => {
      const cfg = await window.api.getConfig();
      setConfig(cfg);
      await Promise.all([loadDocker(), loadDaily(), loadMissions(), loadTodoist()]);

      const secs = cfg.docker?.refreshSeconds || 15;
      intervalId = setInterval(loadDocker, secs * 1000);
    })();
    return () => clearInterval(intervalId);
  }, [loadDocker, loadDaily, loadMissions, loadTodoist]);

  // ---- clock / stardate ----
  useEffect(() => {
    const id = setInterval(() => setClock(tickClock()), 1000 * 30);
    return () => clearInterval(id);
  }, []);

  return (
    <>
      <div className="chrome-drag"></div>

      <header className="masthead">
        <div className="mark">
          <span className="glyph">◈</span>
          <div>
            <h1>Command Center</h1>
            <p className="stardate">{clock}</p>
          </div>
        </div>
        <button className="refresh" title="Refresh everything" onClick={refreshAll}>
          ⟳ Refresh
        </button>
      </header>

      <main className="grid">
        <DockerWidget data={docker} />
        <DailyNoteWidget data={daily} />
        <MissionsWidget data={missions} />
        <TodoistWidget data={todoist} onRefresh={loadTodoist} />
        <SillyTavernWidget instances={config?.sillytavern?.instances || []} />
        <ClaudeLauncherWidget projects={config?.claudeCode?.projects || []} />
      </main>
    </>
  );
}
