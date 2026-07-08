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
import LinkLauncherWidget from "./components/LinkLauncherWidget";
import ClaudeLauncherWidget from "./components/ClaudeLauncherWidget";
import { IconMark, IconRefresh } from "./components/icons";

type TabId = "home" | "development";

const TABS: { id: TabId; label: string }[] = [
  { id: "home", label: "Home" },
  { id: "development", label: "Development" },
];

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
  const [refreshing, setRefreshing] = useState(false);
  const [activeTab, setActiveTab] = useState<TabId>("home");
  const [dailyDate, setDailyDate] = useState<string | null>(null);

  const loadDocker = useCallback(async () => {
    setDocker(await window.api.docker.list());
  }, []);
  const loadDaily = useCallback(async () => {
    setDaily(await window.api.grimoire.dailyNote(dailyDate ?? undefined));
  }, [dailyDate]);
  const loadMissions = useCallback(async () => {
    setMissions(await window.api.grimoire.missions());
  }, []);
  const loadTodoist = useCallback(async () => {
    setTodoist(await window.api.todoist.tasks());
  }, []);

  const navigateDaily = useCallback(async (date: string | null) => {
    setDailyDate(date);
    setDaily(await window.api.grimoire.dailyNote(date ?? undefined));
  }, []);

  const refreshAll = useCallback(async () => {
    setRefreshing(true);
    await Promise.all([loadDocker(), loadDaily(), loadMissions(), loadTodoist()]);
    setRefreshing(false);
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
    // Intentionally empty: this must run once at mount only. loadDaily's
    // identity changes whenever dailyDate does (prev/next navigation), and
    // re-running this effect would stack a second Docker refresh interval.
  }, []);

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
          <IconMark size={28} className="glyph" />
          <div>
            <h1>Command Center</h1>
            <p className="stardate">{clock}</p>
          </div>
        </div>
        <button className="refresh" title="Refresh everything" onClick={refreshAll}>
          <IconRefresh className={refreshing ? "spin" : ""} />
          Refresh
        </button>
      </header>

      <nav className="tabs">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            className={`tab ${activeTab === tab.id ? "active" : ""}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </nav>

      {activeTab === "home" && (
        <main className="grid grid-home">
          <div className="slot slot-todoist">
            <TodoistWidget data={todoist} onRefresh={loadTodoist} />
          </div>
          <div className="slot slot-daily">
            <DailyNoteWidget data={daily} onNavigate={navigateDaily} />
          </div>
          <div className="slot slot-missions">
            <MissionsWidget data={missions} />
          </div>
          <div className="slot slot-apps">
            <LinkLauncherWidget
              title="Local Apps"
              instances={config?.localApps?.instances || []}
            />
          </div>
          <div className="slot slot-learning">
            <LinkLauncherWidget
              title="Learning"
              instances={config?.learning?.instances || []}
            />
          </div>
        </main>
      )}

      {activeTab === "development" && (
        <main className="grid grid-dev">
          <div className="slot slot-services">
            <DockerWidget data={docker} />
          </div>
          <div className="slot slot-claude">
            <ClaudeLauncherWidget projects={config?.claudeCode?.projects || []} />
          </div>
        </main>
      )}
    </>
  );
}
