// Full-screen Settings overlay, opened via the gear icon in the header. Owns
// its own state (fetched fresh via window.api.settings.* every time it
// opens, same "rebuild fresh" idiom as CommandPalette) rather than being
// lifted into App.tsx — the only things pushed back up are the handful of
// values App.tsx already caches reactively for its polling intervals and the
// Processes widget.

import { useCallback, useEffect, useState } from "react";
import type { FormEvent, MouseEvent } from "react";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import {
  SortableContext,
  arrayMove,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import type {
  AppConfig,
  GitHubRepoConfig,
  GitHubRepoInput,
  BackupFile,
  BackupSettings,
  CaptureHotkeyStatus,
  CaptureSettings,
  DockerSettings,
  StatsSettings,
  GrimoireConfig,
  NotificationHealth,
  NotificationSettings,
  OpenRouterScalarConfig,
  OpenAIScalarConfig,
  FirecrawlScalarConfig,
  AssistantModelCheck,
  AssistantScalarConfig,
  AssistantSpendToday,
  RailwayScalarConfig,
  ProcessConfig,
  SubredditConfig,
  TabConfig,
  VaultConfig,
  YnabScalarConfig,
  YouTubeChannelConfig,
} from "../../../shared/types";
import { DEFAULT_ASSISTANT_ACCELERATOR } from "../../../shared/assistant";
import AssistantCommandsCard from "./AssistantCommandsCard";
import { validateAccelerator } from "../../../shared/accelerator";
import { normalizeSubreddit } from "../../../shared/subreddit";
import { parseChannelInput } from "../../../shared/youtubeChannel";
import {
  useGithubRepoSettingsList,
  useProcessSettingsList,
  useSubredditSettingsList,
  useVaultSettingsList,
  useYouTubeChannelSettingsList,
} from "../hooks/useSettingsLists";
import {
  IconCheck,
  IconEye,
  IconEyeOff,
  IconGrip,
  IconPencil,
  IconPlus,
  IconTrash,
  IconX,
} from "./icons";

type SectionId =
  | "general"
  | "grimoire"
  | "integrations"
  | "assistant"
  | "vaults"
  | "githubRepos"
  | "processes"
  | "tabs"
  | "social"
  | "data";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "grimoire", label: "Grimoire" },
  { id: "integrations", label: "Integrations" },
  { id: "assistant", label: "Assistant" },
  { id: "vaults", label: "Vaults" },
  { id: "githubRepos", label: "Repositories" },
  { id: "processes", label: "Processes" },
  { id: "tabs", label: "Tabs" },
  { id: "social", label: "Social" },
  { id: "data", label: "Data" },
];

interface SettingsPageProps {
  open: boolean;
  // Which section to land on when opened; the gear icon passes nothing and
  // gets General, the Assistant tab's "Settings" link passes "assistant".
  initialSection?: SectionId;
  onClose: () => void;
  onProcessConfigsChange: (configs: ProcessConfig[]) => void;
  onTabsChange: (tabs: TabConfig[]) => void;
  onAppRefreshMinutesChange: (minutes: number | undefined) => void;
  onDockerRefreshSecondsChange: (seconds: number) => void;
  onDockerUpdateSettingsChange: (settings: DockerSettings) => void;
  onStatsSettingsChange: (settings: StatsSettings) => void;
  onSpotifyEnabledChange: (enabled: boolean) => void;
  onGitRefreshSecondsChange: (seconds?: number) => void;
  onNotificationSettingsChange: (values: NotificationSettings) => void;
  onGithubRefreshSecondsChange: (seconds: number) => void;
  onYnabRefreshSecondsChange: (seconds: number) => void;
  onTodoistShowTimeTrackingChange: (show: boolean) => void;
  onOpenRouterRefreshSecondsChange: (seconds?: number) => void;
  onOpenAIRefreshSecondsChange: (seconds?: number) => void;
  onFirecrawlRefreshSecondsChange: (seconds?: number) => void;
  onRailwayRefreshSecondsChange: (seconds?: number) => void;
}

function slugify(label: string): string {
  const base = label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
  return base || "process";
}

function uniqueSlug(label: string, taken: Set<string>): string {
  const base = slugify(label);
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}-${i}`)) i++;
  return `${base}-${i}`;
}

function SecretField({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="settings-secret-field">
      <input
        className="settings-input"
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        autoComplete="off"
      />
      <button
        type="button"
        className="settings-secret-toggle"
        onClick={() => setVisible((v) => !v)}
        aria-label={visible ? "Hide" : "Show"}
      >
        {visible ? <IconEyeOff /> : <IconEye />}
      </button>
    </div>
  );
}

// ---- scalar section cards ----

function AppCard({
  value,
  onSaved,
}: {
  value: { refreshMinutes?: number };
  onSaved: (v: { refreshMinutes?: number }) => void;
}) {
  const [minutes, setMinutes] = useState(String(value.refreshMinutes ?? ""));
  const [saving, setSaving] = useState(false);
  useEffect(() => setMinutes(String(value.refreshMinutes ?? "")), [value.refreshMinutes]);
  const dirty = minutes !== String(value.refreshMinutes ?? "");

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const refreshMinutes = minutes.trim() === "" ? undefined : Number(minutes);
    const result = await window.api.settings.app.update({ refreshMinutes });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Auto-refresh</h3>
      <p className="settings-card-hint">
        How often the whole dashboard refreshes itself, in minutes. Leave blank to disable.
      </p>
      <div className="settings-field-row">
        <label>Refresh minutes</label>
        <input
          className="settings-input"
          type="number"
          min={0}
          value={minutes}
          onChange={(e) => setMinutes(e.target.value)}
          placeholder="10"
        />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function DockerCard({
  value,
  onSaved,
}: {
  value: DockerSettings;
  onSaved: (v: DockerSettings) => void;
}) {
  const [seconds, setSeconds] = useState(String(value.refreshSeconds));
  const [updateChecksEnabled, setUpdateChecksEnabled] = useState(value.updateChecksEnabled ?? true);
  const [updateCheckMinutes, setUpdateCheckMinutes] = useState(
    String(value.updateCheckMinutes ?? 60)
  );
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setSeconds(String(value.refreshSeconds));
    setUpdateChecksEnabled(value.updateChecksEnabled ?? true);
    setUpdateCheckMinutes(String(value.updateCheckMinutes ?? 60));
  }, [value.refreshSeconds, value.updateChecksEnabled, value.updateCheckMinutes]);
  const dirty =
    seconds !== String(value.refreshSeconds) ||
    updateChecksEnabled !== (value.updateChecksEnabled ?? true) ||
    updateCheckMinutes !== String(value.updateCheckMinutes ?? 60);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.docker.update({
      refreshSeconds: Number(seconds) || 15,
      updateChecksEnabled,
      updateCheckMinutes: Number(updateCheckMinutes) || 60,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Docker</h3>
      <p className="settings-card-hint">
        How often the Services widget polls `docker ps`, and whether it checks registries for
        newer images.
      </p>
      <div className="settings-field-row">
        <label>Refresh seconds</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
        />
      </div>
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={updateChecksEnabled}
          onChange={(e) => setUpdateChecksEnabled(e.target.checked)}
        />
        Check for image updates
      </label>
      <div className="settings-field-row">
        <label>Check every (minutes)</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          disabled={!updateChecksEnabled}
          value={updateCheckMinutes}
          onChange={(e) => setUpdateCheckMinutes(e.target.value)}
        />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function StatsCard({
  value,
  onSaved,
}: {
  value: StatsSettings;
  onSaved: (v: StatsSettings) => void;
}) {
  const [backgroundNetwork, setBackgroundNetwork] = useState(value.backgroundNetwork === true);
  const [seconds, setSeconds] = useState(String(value.refreshSeconds));
  const [publicIpEnabled, setPublicIpEnabled] = useState(value.publicIpEnabled ?? true);
  const [publicIpCheckMinutes, setPublicIpCheckMinutes] = useState(
    String(value.publicIpCheckMinutes ?? 60)
  );
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setSeconds(String(value.refreshSeconds));
    setBackgroundNetwork(value.backgroundNetwork === true);
    setPublicIpEnabled(value.publicIpEnabled ?? true);
    setPublicIpCheckMinutes(String(value.publicIpCheckMinutes ?? 60));
  }, [value.refreshSeconds, value.publicIpEnabled, value.publicIpCheckMinutes, value.backgroundNetwork]);
  const dirty =
    seconds !== String(value.refreshSeconds) ||
    backgroundNetwork !== (value.backgroundNetwork === true) ||
    publicIpEnabled !== (value.publicIpEnabled ?? true) ||
    publicIpCheckMinutes !== String(value.publicIpCheckMinutes ?? 60);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.stats.update({
      backgroundNetwork,
      refreshSeconds: Number(seconds) || 5,
      publicIpEnabled,
      publicIpCheckMinutes: Number(publicIpCheckMinutes) || 60,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Stats</h3>
      <p className="settings-card-hint">
        Detailed stats refresh while this tab is visible. Storage and battery refresh at most
        once per minute. Public IP uses a third-party service.
      </p>
      <div className="settings-field-row">
        <label>Refresh seconds</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
        />
      </div>
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={publicIpEnabled}
          onChange={(e) => setPublicIpEnabled(e.target.checked)}
        />
        Check public IP
      </label>
      <label className="settings-checkbox-label">
        <input type="checkbox" checked={backgroundNetwork} onChange={(e) => setBackgroundNetwork(e.target.checked)} />
        Keep network history while other tabs are open or the window is hidden
      </label>
      <div className="settings-field-row">
        <label>Check every (minutes)</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          disabled={!publicIpEnabled}
          value={publicIpCheckMinutes}
          onChange={(e) => setPublicIpCheckMinutes(e.target.value)}
        />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function SpotifyCard({
  value,
  onSaved,
}: {
  value: { enabled: boolean };
  onSaved: (v: { enabled: boolean }) => void;
}) {
  const [draft, setDraft] = useState(value.enabled);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(value.enabled), [value.enabled]);
  const dirty = draft !== value.enabled;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.spotify.update({ enabled: draft });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Spotify</h3>
      <p className="settings-card-hint">
        Shows a banner at the bottom of the window with the currently playing track, read
        directly from the local Spotify app — no account connection needed.
      </p>
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={draft}
          onChange={(e) => setDraft(e.target.checked)}
        />
        Show Now Playing banner
      </label>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function GitCard({
  value,
  onSaved,
}: {
  value: { refreshSeconds?: number };
  onSaved: (v: { refreshSeconds?: number }) => void;
}) {
  const current = String(value.refreshSeconds ?? 30);
  const [seconds, setSeconds] = useState(current);
  const [saving, setSaving] = useState(false);
  useEffect(() => setSeconds(current), [current]);
  const dirty = seconds !== current;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.git.update({
      refreshSeconds: Number(seconds) || 30,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Git</h3>
      <p className="settings-card-hint">
        How often the Git widget re-runs `git status` over your local repos. Separate from the
        GitHub interval — this one costs no API quota, so it can be much shorter.
      </p>
      <div className="settings-field-row">
        <label>Refresh seconds</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          value={seconds}
          onChange={(e) => setSeconds(e.target.value)}
        />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function NotificationsCard({
  value,
  onSaved,
}: {
  value: NotificationSettings;
  onSaved: (v: NotificationSettings) => void;
}) {
  // Absent means on — matches getNotificationSettings()'s defaults, so a
  // config written before this section existed reads as fully enabled.
  const norm = (v: NotificationSettings) => ({
    enabled: v.enabled !== false,
    ciFailure: v.ciFailure !== false,
    processCrash: v.processCrash !== false,
    dockerExit: v.dockerExit !== false,
    overspending: v.overspending !== false,
  });
  const [draft, setDraft] = useState(norm(value));
  const [saving, setSaving] = useState(false);
  const [health, setHealth] = useState<NotificationHealth | null>(null);

  useEffect(() => setDraft(norm(value)), [value]);
  useEffect(() => {
    void window.api.notifications.health().then(setHealth);
  }, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(norm(value));

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.notifications.update(draft);
    setSaving(false);
    onSaved(result);
  }

  const triggers: { key: keyof typeof draft; label: string }[] = [
    { key: "ciFailure", label: "CI turns red" },
    { key: "processCrash", label: "A managed process crashes" },
    { key: "dockerExit", label: "A Docker container stops" },
    { key: "overspending", label: "A budget category becomes overspent" },
  ];

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Notifications</h3>
      <p className="settings-card-hint">
        Desktop notifications for things worth interrupting you about. Each fires only on the
        transition into that state, never repeatedly while it persists.
      </p>

      {health && !health.supported && (
        <p className="settings-card-warning">
          This system reports that notifications aren’t supported. The menubar tray still shows
          status.
        </p>
      )}
      {health?.lastFailure && (
        <p className="settings-card-warning">
          macOS rejected the last notification ({health.lastFailure}). Check System Settings →
          Notifications → Command Center. The menubar tray still shows status.
        </p>
      )}

      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
        />
        Enable notifications
      </label>

      {triggers.map((t) => (
        <label key={t.key} className="settings-checkbox-label settings-checkbox-nested">
          <input
            type="checkbox"
            checked={draft[t.key]}
            disabled={!draft.enabled}
            onChange={(e) => setDraft({ ...draft, [t.key]: e.target.checked })}
          />
          {t.label}
        </label>
      ))}

      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function CaptureCard({
  value,
  onSaved,
}: {
  value: CaptureSettings;
  onSaved: (v: CaptureSettings) => void;
}) {
  const current = value.accelerator ?? "";
  const [accelerator, setAccelerator] = useState(current);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<CaptureHotkeyStatus | null>(null);

  useEffect(() => setAccelerator(current), [current]);
  useEffect(() => {
    void window.api.capture.hotkeyStatus().then(setStatus);
  }, []);

  const dirty = accelerator !== current;
  const validationError = accelerator.trim() ? validateAccelerator(accelerator) : null;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (validationError) return;
    setSaving(true);
    const result = await window.api.settings.capture.update({ ...value, accelerator });
    setStatus(await window.api.capture.hotkeyStatus());
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Quick capture</h3>
      <p className="settings-card-hint">
        A global hotkey that opens a small capture panel from any app, writing to today's daily
        note or the scratchpad. Uses Electron accelerator syntax, e.g.{" "}
        <code>Cmd+Ctrl+Alt+Shift+Q</code>.
      </p>

      {status && !status.registered && status.accelerator && (
        <p className="settings-card-warning">
          Couldn’t register <code>{status.accelerator}</code>. Pick a different combination.
        </p>
      )}

      <div className="settings-field-row">
        <label>Hotkey</label>
        <input
          className="settings-input"
          value={accelerator}
          onChange={(e) => setAccelerator(e.target.value)}
          placeholder="Cmd+Ctrl+Alt+Shift+Q"
        />
      </div>
      {validationError && <p className="settings-field-error">{validationError}</p>}

      {/* macOS gives no usable signal here: globalShortcut.register() returns
          true even for a combo another app already owns, so promising conflict
          detection would be a lie. Say what to do instead. */}
      <p className="settings-card-hint">
        If the hotkey does nothing, another app has likely claimed it — launchers and macro tools
        take precedence, and macOS gives no way to detect that. Try a different combination.
      </p>

      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving || !!validationError}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function DataCard({
  value,
  onSaved,
}: {
  value: BackupSettings;
  onSaved: (v: BackupSettings) => void;
}) {
  const norm = (v: BackupSettings) => ({ enabled: v.enabled !== false, keep: v.keep ?? 7 });
  const [draft, setDraft] = useState(norm(value));
  const [saving, setSaving] = useState(false);
  const [backups, setBackups] = useState<BackupFile[]>([]);
  const [exportMsg, setExportMsg] = useState<string | null>(null);
  // The backup awaiting an "are you sure" — restoring replaces everything.
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [restoreMsg, setRestoreMsg] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => setDraft(norm(value)), [value]);
  const refreshList = () => void window.api.backup.list().then(setBackups);
  useEffect(refreshList, []);

  const dirty = JSON.stringify(draft) !== JSON.stringify(norm(value));

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.backup.update(draft);
    setSaving(false);
    onSaved(result);
  }

  async function handleExport() {
    setExportMsg(null);
    const result = await window.api.backup.export();
    // A dismissed save dialog is not a failure — say nothing at all.
    if (result.canceled) return;
    setExportMsg(result.ok ? `Exported to ${result.path}` : `Export failed: ${result.reason}`);
  }

  async function handleRestore(file: string | null) {
    setRestoreMsg(null);
    setRestoring(true);
    // Success relaunches the app, so there's nothing to show afterwards; only
    // a failure (or a dismissed file dialog) comes back here.
    const result = file
      ? await window.api.backup.restore(file)
      : await window.api.backup.restoreFromFile();
    setRestoring(false);
    setConfirmRestore(null);
    if (result.canceled) return;
    setRestoreMsg(
      result.ok
        ? `Restoring… the app will restart. The database it replaced was kept at ${result.path}`
        : `Restore failed: ${result.reason}`
    );
  }

  return (
    <>
      <form className="settings-card" onSubmit={handleSave}>
        <h3>Backups</h3>
        <p className="settings-card-hint">
          Everything this app stores lives in a single SQLite file — notes, habits, finances, time
          entries, and settings. A copy is written automatically once per day.
        </p>

        <label className="settings-checkbox-label">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => setDraft({ ...draft, enabled: e.target.checked })}
          />
          Back up automatically on launch
        </label>
        <div className="settings-field-row">
          <label>Keep</label>
          <input
            className="settings-input"
            type="number"
            min={1}
            value={draft.keep}
            disabled={!draft.enabled}
            onChange={(e) => setDraft({ ...draft, keep: Number(e.target.value) || 7 })}
          />
        </div>

        {backups.length > 0 && (
          <ul className="settings-backup-list">
            {backups.map((b) => (
              <li key={b.path}>
                <span className="settings-backup-name">{b.name}</span>
                <span className="settings-backup-size">{formatBytes(b.size)}</span>
                {confirmRestore === b.path ? (
                  <span className="settings-backup-actions">
                    <button type="button" disabled={restoring} onClick={() => void handleRestore(b.path)}>
                      {restoring ? "Restoring…" : "Confirm restore"}
                    </button>
                    <button type="button" disabled={restoring} onClick={() => setConfirmRestore(null)}>
                      Cancel
                    </button>
                  </span>
                ) : (
                  <span className="settings-backup-actions">
                    <button type="button" disabled={restoring} onClick={() => setConfirmRestore(b.path)}>
                      Restore
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}

        {confirmRestore && (
          <p className="settings-card-warning">
            Restoring replaces everything in the app — notes nav, habits, finances, time entries and
            settings, including API tokens — with the contents of this backup, then restarts. The
            current database is kept first so this can be undone.
          </p>
        )}
        {restoreMsg && <p className="settings-card-hint">{restoreMsg}</p>}

        <div className="settings-card-footer">
          <button type="button" disabled={restoring} onClick={() => void handleRestore(null)}>
            Restore from file…
          </button>
          <button type="submit" disabled={!dirty || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </form>

      <div className="settings-card">
        <h3>Export database</h3>
        <p className="settings-card-hint">
          Writes a complete copy wherever you choose — for moving to another machine, or keeping a
          copy somewhere else.
        </p>
        <p className="settings-card-warning">
          The exported file contains your API tokens (Todoist, GitHub, Readwise, YNAB, Google) in
          plaintext, exactly as they are stored here. Treat it like a password file, and think
          twice before putting it in a synced or shared folder.
        </p>
        {exportMsg && <p className="settings-card-hint">{exportMsg}</p>}
        <div className="settings-card-footer">
          <button type="button" onClick={handleExport}>
            Export database…
          </button>
        </div>
      </div>
    </>
  );
}

function GrimoireCard({
  value,
  onSaved,
}: {
  value: GrimoireConfig;
  onSaved: (v: GrimoireConfig) => void;
}) {
  const [vaultPath, setVaultPath] = useState(value.vaultPath);
  const [dailyLogDir, setDailyLogDir] = useState(value.dailyLogDir);
  const [missionsDir, setMissionsDir] = useState(value.missionsDir);
  const [dailyTemplatePath, setDailyTemplatePath] = useState(value.dailyTemplatePath ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setVaultPath(value.vaultPath);
    setDailyLogDir(value.dailyLogDir);
    setMissionsDir(value.missionsDir);
    setDailyTemplatePath(value.dailyTemplatePath ?? "");
  }, [value.vaultPath, value.dailyLogDir, value.missionsDir, value.dailyTemplatePath]);
  const dirty =
    vaultPath !== value.vaultPath ||
    dailyLogDir !== value.dailyLogDir ||
    missionsDir !== value.missionsDir ||
    dailyTemplatePath !== (value.dailyTemplatePath ?? "");

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.grimoire.update({
      vaultPath,
      dailyLogDir,
      missionsDir,
      dailyTemplatePath: dailyTemplatePath.trim() || undefined,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Grimoire</h3>
      <p className="settings-card-hint">
        The Obsidian vault backing the Home tab's daily note and missions list.
      </p>
      <div className="settings-field-row">
        <label>Vault path</label>
        <input
          className="settings-input"
          value={vaultPath}
          onChange={(e) => setVaultPath(e.target.value)}
          placeholder="/absolute/path/to/vault"
        />
      </div>
      <div className="settings-field-row">
        <label>Daily log dir</label>
        <input
          className="settings-input"
          value={dailyLogDir}
          onChange={(e) => setDailyLogDir(e.target.value)}
          placeholder="5 Logs/Daily"
        />
      </div>
      <div className="settings-field-row">
        <label>Missions dir</label>
        <input
          className="settings-input"
          value={missionsDir}
          onChange={(e) => setMissionsDir(e.target.value)}
          placeholder="3 Missions"
        />
      </div>
      <div className="settings-field-row">
        <label>Daily template</label>
        <input
          className="settings-input"
          value={dailyTemplatePath}
          onChange={(e) => setDailyTemplatePath(e.target.value)}
          placeholder="_System/templates/daily template.md (optional)"
        />
      </div>
      <p className="settings-card-hint">
        Vault-relative template seeded into a daily note that doesn’t exist yet. <code>
        {"{{date}}"}</code> placeholders are filled in for that note’s date; Templater{" "}
        <code>{"<% … %>"}</code> blocks are removed, since nothing here can execute them.
      </p>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function TodoistCard({
  value,
  onSaved,
}: {
  value: { apiToken: string; showTimeTracking?: boolean };
  onSaved: (v: { apiToken: string; showTimeTracking?: boolean }) => void;
}) {
  const [apiToken, setApiToken] = useState(value.apiToken);
  const [showTimeTracking, setShowTimeTracking] = useState(value.showTimeTracking !== false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setApiToken(value.apiToken);
    setShowTimeTracking(value.showTimeTracking !== false);
  }, [value.apiToken, value.showTimeTracking]);
  const dirty =
    apiToken !== value.apiToken || showTimeTracking !== (value.showTimeTracking !== false);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.todoist.update({ apiToken, showTimeTracking });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Todoist</h3>
      <p className="settings-card-hint">
        API token from Todoist's integration settings — powers the Due &amp; Overdue widget.
      </p>
      <div className="settings-field-row">
        <label>API token</label>
        <SecretField value={apiToken} onChange={setApiToken} placeholder="•••••••••••••••" />
      </div>
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={showTimeTracking}
          onChange={(e) => setShowTimeTracking(e.target.checked)}
        />
        Show time tracking controls on tasks
      </label>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function GoogleCalendarCard({
  value,
  onSaved,
}: {
  value: { clientId: string; clientSecret: string };
  onSaved: (v: { clientId: string; clientSecret: string }) => void;
}) {
  const [clientId, setClientId] = useState(value.clientId);
  const [clientSecret, setClientSecret] = useState(value.clientSecret);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setClientId(value.clientId);
    setClientSecret(value.clientSecret);
  }, [value.clientId, value.clientSecret]);
  const dirty = clientId !== value.clientId || clientSecret !== value.clientSecret;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.googleCalendar.update({ clientId, clientSecret });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Google Calendar</h3>
      <p className="settings-card-hint">
        OAuth client from a Google Cloud project (Desktop app type) — powers Today's Schedule.
      </p>
      <div className="settings-field-row">
        <label>Client ID</label>
        <input
          className="settings-input"
          value={clientId}
          onChange={(e) => setClientId(e.target.value)}
        />
      </div>
      <div className="settings-field-row">
        <label>Client secret</label>
        <SecretField value={clientSecret} onChange={setClientSecret} />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function ReaderCard({
  value,
  onSaved,
}: {
  value: { apiToken: string };
  onSaved: (v: { apiToken: string }) => void;
}) {
  const [apiToken, setApiToken] = useState(value.apiToken);
  const [saving, setSaving] = useState(false);
  useEffect(() => setApiToken(value.apiToken), [value.apiToken]);
  const dirty = apiToken !== value.apiToken;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.reader.update({ apiToken });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Readwise Reader</h3>
      <p className="settings-card-hint">
        Access token from readwise.io/access_token — powers the Reader tab.
      </p>
      <div className="settings-field-row">
        <label>API token</label>
        <SecretField value={apiToken} onChange={setApiToken} placeholder="•••••••••••••••" />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function GithubScalarCard({
  value,
  onSaved,
}: {
  value: { token?: string; refreshSeconds?: number; reviewUser?: string };
  onSaved: (v: { token?: string; refreshSeconds?: number; reviewUser?: string }) => void;
}) {
  const [token, setToken] = useState(value.token ?? "");
  const [refreshSeconds, setRefreshSeconds] = useState(String(value.refreshSeconds ?? 300));
  const [reviewUser, setReviewUser] = useState(value.reviewUser ?? "");
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setToken(value.token ?? "");
    setRefreshSeconds(String(value.refreshSeconds ?? 300));
    setReviewUser(value.reviewUser ?? "");
  }, [value.token, value.refreshSeconds, value.reviewUser]);
  const dirty =
    token !== (value.token ?? "") ||
    refreshSeconds !== String(value.refreshSeconds ?? 300) ||
    reviewUser !== (value.reviewUser ?? "");

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.github.update({
      token: token || undefined,
      refreshSeconds: Number(refreshSeconds) || 300,
      reviewUser: reviewUser || undefined,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>GitHub</h3>
      <p className="settings-card-hint">
        Personal access token (repo + read:org scope) — powers CI status, open PRs, and
        review-requested search. Repos to track live in their own section.
      </p>
      <div className="settings-field-row">
        <label>Token</label>
        <SecretField value={token} onChange={setToken} placeholder="•••••••••••••••" />
      </div>
      <div className="settings-field-row">
        <label>Refresh seconds</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          value={refreshSeconds}
          onChange={(e) => setRefreshSeconds(e.target.value)}
        />
      </div>
      <div className="settings-field-row">
        <label>Review username</label>
        <input
          className="settings-input"
          value={reviewUser}
          onChange={(e) => setReviewUser(e.target.value)}
          placeholder="your-github-username"
        />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function OpenRouterCard({
  value,
  onSaved,
}: {
  value: OpenRouterScalarConfig;
  onSaved: (v: OpenRouterScalarConfig) => void;
}) {
  const [managementApiKey, setManagementApiKey] = useState(value.managementApiKey ?? "");
  const [refreshSeconds, setRefreshSeconds] = useState(String(value.refreshSeconds ?? 900));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setManagementApiKey(value.managementApiKey ?? "");
    setRefreshSeconds(String(value.refreshSeconds ?? 900));
  }, [value.managementApiKey, value.refreshSeconds]);
  const dirty =
    managementApiKey !== (value.managementApiKey ?? "") ||
    refreshSeconds !== String(value.refreshSeconds ?? 900);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.openrouter.update({
      managementApiKey: managementApiKey || undefined,
      refreshSeconds: Number(refreshSeconds) || 900,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>OpenRouter</h3>
      <p className="settings-card-hint">
        Requires a <strong>Management API key</strong> — a separate credential from a normal
        OpenRouter inference key, created under OpenRouter's dashboard (Settings → Provisioning
        Keys). It powers the OpenRouter tab's usage-by-model, usage-by-key, and credit balance
        reporting; a regular inference key can't be used here.
      </p>
      <div className="settings-field-row">
        <label>Management API key</label>
        <SecretField
          value={managementApiKey}
          onChange={setManagementApiKey}
          placeholder="•••••••••••••••"
        />
      </div>
      <div className="settings-field-row">
        <label>Refresh seconds</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          value={refreshSeconds}
          onChange={(e) => setRefreshSeconds(e.target.value)}
        />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function OpenAICard({
  value,
  onSaved,
}: {
  value: OpenAIScalarConfig;
  onSaved: (v: OpenAIScalarConfig) => void;
}) {
  const [adminApiKey, setAdminApiKey] = useState(value.adminApiKey ?? "");
  const [apiKey, setApiKey] = useState(value.apiKey ?? "");
  const [imageModel, setImageModel] = useState(value.imageModel ?? "");
  const [imageShape, setImageShape] = useState(value.imageShape ?? "square");
  const [imageQuality, setImageQuality] = useState(value.imageQuality ?? "medium");
  const [refreshSeconds, setRefreshSeconds] = useState(String(value.refreshSeconds ?? 900));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setAdminApiKey(value.adminApiKey ?? "");
    setApiKey(value.apiKey ?? "");
    setImageModel(value.imageModel ?? "");
    setImageShape(value.imageShape ?? "square");
    setImageQuality(value.imageQuality ?? "medium");
    setRefreshSeconds(String(value.refreshSeconds ?? 900));
  }, [value.adminApiKey, value.apiKey, value.imageModel, value.imageShape, value.imageQuality, value.refreshSeconds]);
  const dirty =
    adminApiKey !== (value.adminApiKey ?? "") ||
    apiKey !== (value.apiKey ?? "") ||
    imageModel !== (value.imageModel ?? "") ||
    imageShape !== (value.imageShape ?? "square") ||
    imageQuality !== (value.imageQuality ?? "medium") ||
    refreshSeconds !== String(value.refreshSeconds ?? 900);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.openai.update({
      adminApiKey: adminApiKey || undefined,
      apiKey: apiKey || undefined,
      imageModel: imageModel.trim() || undefined,
      imageShape: imageShape === "square" ? undefined : imageShape,
      imageQuality: imageQuality === "medium" ? undefined : imageQuality,
      refreshSeconds: Number(refreshSeconds) || 900,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>OpenAI</h3>
      <p className="settings-card-hint">
        Local Codex subscription usage is read from this machine and needs no key. The optional
        <strong> Admin API key</strong> below is a separate, org-level credential created under
        OpenAI's dashboard (Settings → Organization → Admin keys); it powers only the OpenAI API
        usage-by-model and cost-by-line-item section. A regular project key can't be used there.
      </p>
      <div className="settings-field-row">
        <label>Admin API key</label>
        <SecretField
          value={adminApiKey}
          onChange={setAdminApiKey}
          placeholder="•••••••••••••••"
        />
      </div>
      <div className="settings-field-row">
        <label>Refresh seconds</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          value={refreshSeconds}
          onChange={(e) => setRefreshSeconds(e.target.value)}
        />
      </div>
      <p className="settings-card-hint">
        The Assistant can generate images when you add a regular <strong>API key</strong> (a
        project key from OpenAI's dashboard; an Admin key can't generate). Each image costs money,
        so the Assistant always shows you its exact prompt and asks first, and makes at most two
        per reply. Leave the model blank for gpt-image-1.
      </p>
      <div className="settings-field-row">
        <label>API key (images)</label>
        <SecretField value={apiKey} onChange={setApiKey} placeholder="sk-…" />
      </div>
      <div className="settings-field-row">
        <label>Image model</label>
        <input
          className="settings-input"
          value={imageModel}
          onChange={(e) => setImageModel(e.target.value)}
          placeholder="gpt-image-1"
          spellCheck={false}
        />
      </div>
      <div className="settings-field-row">
        <label>Default size</label>
        <select
          className="settings-input"
          value={imageShape}
          onChange={(e) => setImageShape(e.target.value as typeof imageShape)}
        >
          <option value="square">Square (1024×1024)</option>
          <option value="landscape">Landscape (1536×1024)</option>
          <option value="portrait">Portrait (1024×1536)</option>
        </select>
      </div>
      <div className="settings-field-row">
        <label>Default quality</label>
        <select
          className="settings-input"
          value={imageQuality}
          onChange={(e) => setImageQuality(e.target.value as typeof imageQuality)}
        >
          <option value="low">Low (cheapest)</option>
          <option value="medium">Medium</option>
          <option value="high">High (most expensive)</option>
        </select>
      </div>
      <p className="settings-card-hint">
        These apply when the Assistant doesn't pick a size itself. It will still choose landscape
        for a banner or portrait for a wallpaper, or follow you if you ask for a size, and the
        confirmation card always shows what it will use.
      </p>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function FirecrawlCard({
  value,
  onSaved,
}: {
  value: FirecrawlScalarConfig;
  onSaved: (v: FirecrawlScalarConfig) => void;
}) {
  const [apiKey, setApiKey] = useState(value.apiKey ?? "");
  const [refreshSeconds, setRefreshSeconds] = useState(String(value.refreshSeconds ?? 900));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setApiKey(value.apiKey ?? "");
    setRefreshSeconds(String(value.refreshSeconds ?? 900));
  }, [value.apiKey, value.refreshSeconds]);
  const dirty =
    apiKey !== (value.apiKey ?? "") || refreshSeconds !== String(value.refreshSeconds ?? 900);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.firecrawl.update({
      apiKey: apiKey || undefined,
      refreshSeconds: Number(refreshSeconds) || 900,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Firecrawl</h3>
      <p className="settings-card-hint">
        API key from the Firecrawl dashboard. Powers the AI tab's Firecrawl widget (remaining
        credits, plan allotment, billing period).
      </p>
      <div className="settings-field-row">
        <label>API key</label>
        <SecretField value={apiKey} onChange={setApiKey} placeholder="•••••••••••••••" />
      </div>
      <div className="settings-field-row">
        <label>Refresh seconds</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          value={refreshSeconds}
          onChange={(e) => setRefreshSeconds(e.target.value)}
        />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// "1.50", "$2" → dollars; blank, zero or junk → no cap.
function parseUsd(text: string): number | undefined {
  const n = Number(text.trim().replace(/^\$/, ""));
  return text.trim() && Number.isFinite(n) && n > 0 ? n : undefined;
}

function usdText(value: number | undefined): string {
  return value === undefined ? "" : String(value);
}

// One slug per line or comma-separated, in the order they should be tried.
function parseSlugList(text: string): string[] {
  return [...new Set(text.split(/[\n,]/).map((s) => s.trim()).filter(Boolean))];
}

function formatSpend(today: AssistantSpendToday): string {
  const cost = `$${today.costUsd < 0.01 && today.costUsd > 0 ? today.costUsd.toFixed(4) : today.costUsd.toFixed(2)}`;
  const unseen = today.unpriced
    ? `, plus ${today.unpriced} request${today.unpriced === 1 ? "" : "s"} with no reported cost`
    : "";
  return `${cost} across ${today.requests} request${today.requests === 1 ? "" : "s"}${unseen}`;
}

// Warnings from OpenRouter's model list about the slugs just saved. Advisory:
// the settings are saved either way.
function modelWarnings(checks: AssistantModelCheck[]): string[] {
  const out: string[] = [];
  for (const c of checks) {
    if (!c.ok) out.push(`Couldn't check ${c.slug || "the model"}: ${c.reason ?? "unknown error"}.`);
    else if (!c.known) out.push(`${c.slug} isn't in OpenRouter's model list. Check the spelling.`);
    else if (!c.tools) out.push(`${c.slug} doesn't list tool calling, which the assistant needs.`);
  }
  return out;
}

function AssistantCard({
  value,
  onSaved,
}: {
  value: AssistantScalarConfig;
  onSaved: (v: AssistantScalarConfig) => void;
}) {
  // Unset means "the default combo"; an explicit empty string means "off".
  const currentHotkey = value.quickHotkey ?? DEFAULT_ASSISTANT_ACCELERATOR;
  const [apiKey, setApiKey] = useState(value.apiKey ?? "");
  const [model, setModel] = useState(value.model ?? "");
  // Unset means on; only an explicit false turns AI titles off.
  const [autoTitle, setAutoTitle] = useState(value.autoTitle !== false);
  const [titleModel, setTitleModel] = useState(value.titleModel ?? "");
  // Unset means ask; only an explicit false relaxes it.
  const [askBeforeRemember, setAskBeforeRemember] = useState(value.askBeforeRemember !== false);
  const [memoryPath, setMemoryPath] = useState(value.memoryPath ?? "");
  // Blank means the default; 0 turns automatic compaction off.
  const [compactAt, setCompactAt] = useState(
    value.compactAtTokens === undefined ? "" : String(value.compactAtTokens)
  );
  // Unset means on; only an explicit false turns cache breakpoints off.
  const [promptCache, setPromptCache] = useState(value.promptCache !== false);
  const [systemPrompt, setSystemPrompt] = useState(value.systemPrompt ?? "");
  const [fallbacks, setFallbacks] = useState((value.fallbackModels ?? []).join("\n"));
  const [replyCap, setReplyCap] = useState(usdText(value.maxCostPerReplyUsd));
  const [dailyCap, setDailyCap] = useState(usdText(value.maxCostPerDayUsd));
  const [spend, setSpend] = useState<AssistantSpendToday | null>(null);
  const [checks, setChecks] = useState<AssistantModelCheck[] | null>(null);
  const [hotkey, setHotkey] = useState(currentHotkey);
  const [status, setStatus] = useState<CaptureHotkeyStatus | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setApiKey(value.apiKey ?? "");
    setModel(value.model ?? "");
    setAutoTitle(value.autoTitle !== false);
    setTitleModel(value.titleModel ?? "");
    setAskBeforeRemember(value.askBeforeRemember !== false);
    setMemoryPath(value.memoryPath ?? "");
    setCompactAt(value.compactAtTokens === undefined ? "" : String(value.compactAtTokens));
    setPromptCache(value.promptCache !== false);
    setSystemPrompt(value.systemPrompt ?? "");
    setFallbacks((value.fallbackModels ?? []).join("\n"));
    setReplyCap(usdText(value.maxCostPerReplyUsd));
    setDailyCap(usdText(value.maxCostPerDayUsd));
    setHotkey(value.quickHotkey ?? DEFAULT_ASSISTANT_ACCELERATOR);
  }, [
    value.apiKey,
    value.model,
    value.autoTitle,
    value.titleModel,
    value.askBeforeRemember,
    value.memoryPath,
    value.compactAtTokens,
    value.promptCache,
    value.systemPrompt,
    value.fallbackModels,
    value.maxCostPerReplyUsd,
    value.maxCostPerDayUsd,
    value.quickHotkey,
  ]);
  useEffect(() => {
    void window.api.assistant.hotkeyStatus().then(setStatus);
    void window.api.assistant.spendToday().then(setSpend);
  }, []);

  const dirty =
    apiKey !== (value.apiKey ?? "") ||
    model !== (value.model ?? "") ||
    autoTitle !== (value.autoTitle !== false) ||
    titleModel !== (value.titleModel ?? "") ||
    askBeforeRemember !== (value.askBeforeRemember !== false) ||
    memoryPath !== (value.memoryPath ?? "") ||
    compactAt !== (value.compactAtTokens === undefined ? "" : String(value.compactAtTokens)) ||
    promptCache !== (value.promptCache !== false) ||
    systemPrompt !== (value.systemPrompt ?? "") ||
    parseSlugList(fallbacks).join("\n") !== (value.fallbackModels ?? []).join("\n") ||
    replyCap !== usdText(value.maxCostPerReplyUsd) ||
    dailyCap !== usdText(value.maxCostPerDayUsd) ||
    hotkey !== currentHotkey;
  const hotkeyError = hotkey.trim() ? validateAccelerator(hotkey) : null;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (hotkeyError) return;
    setSaving(true);
    const fallbackModels = parseSlugList(fallbacks);
    const slugs = [model.trim(), ...fallbackModels].filter(Boolean);
    const slugsChanged =
      slugs.join("\n") !== [value.model?.trim() ?? "", ...(value.fallbackModels ?? [])].filter(Boolean).join("\n");
    const result = await window.api.settings.assistant.update({
      apiKey: apiKey || undefined,
      model: model.trim() || undefined,
      autoTitle,
      titleModel: titleModel.trim() || undefined,
      askBeforeRemember,
      memoryPath: memoryPath.trim() || undefined,
      compactAtTokens: /^\d+$/.test(compactAt.trim()) ? Number(compactAt.trim()) : undefined,
      promptCache,
      systemPrompt: systemPrompt.trim() || undefined,
      fallbackModels: fallbackModels.length ? fallbackModels : undefined,
      maxCostPerReplyUsd: parseUsd(replyCap),
      maxCostPerDayUsd: parseUsd(dailyCap),
      quickHotkey: hotkey.trim(),
    });
    setStatus(await window.api.assistant.hotkeyStatus());
    setSaving(false);
    onSaved(result);
    // Checked after saving, never instead of it: the list can lag a new model.
    if (slugsChanged && slugs.length) {
      setChecks(null);
      setChecks(await Promise.all(slugs.map((slug) => window.api.assistant.checkModel(slug))));
    }
  }

  const warnings = checks ? modelWarnings(checks) : [];
  // The primary model's context window, for a compaction suggestion that is
  // only worth showing when it differs from what's set.
  const primary = checks?.[0]?.slug === model.trim() ? checks[0] : null;
  const effectiveCompactAt = /^\d+$/.test(compactAt.trim()) ? Number(compactAt.trim()) : 30000;
  const suggestion =
    primary?.suggestedCompactAt && primary.suggestedCompactAt !== effectiveCompactAt ? primary : null;

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Assistant</h3>
      <p className="settings-card-hint">
        The Assistant tab's chat runs on OpenRouter. It needs a <strong>regular API key</strong>{" "}
        (create one under Keys on openrouter.ai) — the Management key in Integrations → OpenRouter
        is rejected for chat. The model is an OpenRouter slug that supports tool calling, such as
        anthropic/claude-sonnet-4.5. Memory file is an absolute path — point it into a vault to edit
        it in Obsidian; blank keeps it in the app's data folder. Keep secrets out of it.
      </p>
      <div className="settings-field-row">
        <label>API key</label>
        <SecretField value={apiKey} onChange={setApiKey} placeholder="sk-or-…" />
      </div>
      <div className="settings-field-row">
        <label>Model</label>
        <input
          className="settings-input"
          value={model}
          onChange={(e) => setModel(e.target.value)}
          placeholder="provider/model-name"
          spellCheck={false}
        />
      </div>
      {warnings.map((w) => (
        <p key={w} className="settings-card-warning">
          {w}
        </p>
      ))}
      {primary?.known && primary.tools && !suggestion && warnings.length === 0 && (
        <p className="settings-card-hint">
          {primary.slug} supports tool calling
          {primary.contextLength ? ` (${primary.contextLength.toLocaleString()}-token context)` : ""}.
        </p>
      )}
      <div className="settings-field-row settings-field-row-top">
        <label>Fallbacks</label>
        <textarea
          className="settings-input settings-textarea"
          value={fallbacks}
          onChange={(e) => setFallbacks(e.target.value)}
          placeholder="One model slug per line, tried in order (optional)"
          rows={2}
          spellCheck={false}
        />
      </div>
      <p className="settings-card-hint">
        If the model is rate-limited, down or rejects a request, OpenRouter tries these in order and
        bills whichever one answers. Each reply shows which model answered. They need tool calling
        too.
      </p>
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={autoTitle}
          onChange={(e) => setAutoTitle(e.target.checked)}
        />
        Write a short title for each new chat from its first message
      </label>
      <div className="settings-field-row">
        <label>Title model</label>
        <input
          className="settings-input"
          value={titleModel}
          onChange={(e) => setTitleModel(e.target.value)}
          placeholder="(same as Model)"
          spellCheck={false}
          disabled={!autoTitle}
        />
      </div>
      <p className="settings-card-hint">
        The title is one tiny extra request, sent with your first message so it is usually ready
        when the reply lands, and billed to the title model (or the main model if this is blank). Use
        a small, plain model: a reasoning model can spend its whole budget thinking and return no
        title. Until it arrives, and if it fails, a chat is named after your first question.
      </p>
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={askBeforeRemember}
          onChange={(e) => setAskBeforeRemember(e.target.checked)}
        />
        Ask me before saving anything to memory
      </label>
      <p className="settings-card-hint">
        Turn this off and the assistant saves what you ask it to remember straight away — except
        after it has read tasks, calendar, notes or other third-party text, when it always asks.
      </p>
      <div className="settings-field-row">
        <label>Memory file</label>
        <input
          className="settings-input"
          value={memoryPath}
          onChange={(e) => setMemoryPath(e.target.value)}
          placeholder="(app data folder)/assistant-memory.md"
          spellCheck={false}
        />
      </div>
      <div className="settings-field-row">
        <label>Compact at</label>
        <input
          className="settings-input"
          inputMode="numeric"
          value={compactAt}
          onChange={(e) => setCompactAt(e.target.value)}
          placeholder="30000 (estimated tokens; 0 = never)"
          spellCheck={false}
        />
      </div>
      {suggestion && (
        <p className="settings-card-hint">
          {suggestion.slug} has a {suggestion.contextLength!.toLocaleString()}-token context window;{" "}
          {suggestion.suggestedCompactAt!.toLocaleString()} would suit it.{" "}
          <button
            type="button"
            className="assistant-link"
            onClick={() => setCompactAt(String(suggestion.suggestedCompactAt))}
          >
            Use {suggestion.suggestedCompactAt!.toLocaleString()}
          </button>
        </p>
      )}
      <p className="settings-card-hint">
        When a chat would grow past this, its older turns are summarized (one extra request on the
        main model) and the model reads the summary instead. Nothing is deleted: the full chat stays
        on screen and searchable. The Compact button in the tab does it on demand.
      </p>
      <div className="settings-field-row">
        <label>Max per reply</label>
        <input
          className="settings-input"
          inputMode="decimal"
          value={replyCap}
          onChange={(e) => setReplyCap(e.target.value)}
          placeholder="(no cap) USD, e.g. 0.50"
          spellCheck={false}
        />
      </div>
      <div className="settings-field-row">
        <label>Max per day</label>
        <input
          className="settings-input"
          inputMode="decimal"
          value={dailyCap}
          onChange={(e) => setDailyCap(e.target.value)}
          placeholder="(no cap) USD, e.g. 5"
          spellCheck={false}
        />
      </div>
      <p className="settings-card-hint">
        Spending caps use the cost OpenRouter reports. A reply stops calling the model once it has
        cost the per-reply amount (it can overshoot by the one step that crossed it). Once today’s
        assistant spend — replies, titles and summaries — reaches the daily amount, new questions are
        refused until tomorrow. A request whose provider reports no cost can’t be counted and is
        flagged instead of treated as free.
        {spend && <> Today so far: {formatSpend(spend)}.</>}
      </p>
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={promptCache}
          onChange={(e) => setPromptCache(e.target.checked)}
        />
        Use prompt caching on Anthropic models
      </label>
      <p className="settings-card-hint">
        Marks the stable start of each request so a long chat re-reads it at about a tenth of the
        price. Writing the cache costs a quarter more than normal input, so a chat you only send one
        message in costs slightly more. OpenAI, DeepSeek and Gemini cache on their own; this setting
        doesn’t affect them. The tab header shows how much of a chat was read from cache.
      </p>
      <div className="settings-field-row settings-field-row-top">
        <label>Instructions</label>
        <textarea
          className="settings-input settings-textarea"
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          placeholder="Standing instructions added to every chat, e.g. “Be terse. Use metric units.”"
          rows={3}
          maxLength={4000}
        />
      </div>

      <h3 className="settings-subhead">Quick panel</h3>
      <p className="settings-card-hint">
        A global hotkey that opens a small ask-anything panel from any app. Clear the field to turn
        it off. Uses Electron accelerator syntax, e.g. <code>Cmd+Ctrl+Alt+Shift+A</code>.
      </p>
      {status && !status.registered && status.accelerator && (
        <p className="settings-card-warning">
          Couldn’t register <code>{status.accelerator}</code>. Pick a different combination.
        </p>
      )}
      <div className="settings-field-row">
        <label>Hotkey</label>
        <input
          className="settings-input"
          value={hotkey}
          onChange={(e) => setHotkey(e.target.value)}
          placeholder="(off)"
          spellCheck={false}
        />
      </div>
      {hotkeyError && <p className="settings-field-error">{hotkeyError}</p>}
      {/* macOS gives no usable signal here: globalShortcut.register() returns
          true even for a combo another app already owns, so promising conflict
          detection would be a lie. Say what to do instead. */}
      <p className="settings-card-hint">
        If the hotkey does nothing, another app has likely claimed it — macOS gives no way to detect
        that. Try a different combination.
      </p>

      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving || !!hotkeyError}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function RailwayCard({
  value,
  onSaved,
}: {
  value: RailwayScalarConfig;
  onSaved: (v: RailwayScalarConfig) => void;
}) {
  const [accountToken, setAccountToken] = useState(value.accountToken ?? "");
  const [refreshSeconds, setRefreshSeconds] = useState(String(value.refreshSeconds ?? 900));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setAccountToken(value.accountToken ?? "");
    setRefreshSeconds(String(value.refreshSeconds ?? 900));
  }, [value.accountToken, value.refreshSeconds]);
  const dirty =
    accountToken !== (value.accountToken ?? "") ||
    refreshSeconds !== String(value.refreshSeconds ?? 900);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.railway.update({
      accountToken: accountToken || undefined,
      refreshSeconds: Number(refreshSeconds) || 900,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Railway</h3>
      <p className="settings-card-hint">
        Account or workspace token from Railway&apos;s account settings. Account tokens combine
        every accessible workspace; workspace tokens show their own workspace. Project tokens
        use different authentication and are not supported.
      </p>
      <div className="settings-field-row">
        <label>API token</label>
        <SecretField
          value={accountToken}
          onChange={setAccountToken}
          placeholder="•••••••••••••••"
        />
      </div>
      <div className="settings-field-row">
        <label>Refresh seconds</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          value={refreshSeconds}
          onChange={(e) => setRefreshSeconds(e.target.value)}
        />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

function YnabScalarCard({
  value,
  onSaved,
}: {
  value: YnabScalarConfig;
  onSaved: (v: YnabScalarConfig) => void;
}) {
  const [token, setToken] = useState(value.token ?? "");
  const [planId, setPlanId] = useState(value.planId ?? "");
  const [refreshSeconds, setRefreshSeconds] = useState(String(value.refreshSeconds ?? 300));
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setToken(value.token ?? "");
    setPlanId(value.planId ?? "");
    setRefreshSeconds(String(value.refreshSeconds ?? 300));
  }, [value.token, value.planId, value.refreshSeconds]);
  const dirty =
    token !== (value.token ?? "") ||
    planId !== (value.planId ?? "") ||
    refreshSeconds !== String(value.refreshSeconds ?? 300);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.ynab.update({
      ...value,
      token: token || undefined,
      planId: planId || undefined,
      refreshSeconds: Number(refreshSeconds) || 300,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>YNAB</h3>
      <p className="settings-card-hint">
        Personal access token and plan id — powers the Finances tab's accounts, unapproved
        transactions, and scheduled transactions.
      </p>
      <div className="settings-field-row">
        <label>Token</label>
        <SecretField value={token} onChange={setToken} placeholder="•••••••••••••••" />
      </div>
      <div className="settings-field-row">
        <label>Plan id</label>
        <input
          className="settings-input"
          value={planId}
          onChange={(e) => setPlanId(e.target.value)}
          placeholder="last-used, default, or a plan uuid"
        />
      </div>
      <div className="settings-field-row">
        <label>Refresh seconds</label>
        <input
          className="settings-input"
          type="number"
          min={1}
          value={refreshSeconds}
          onChange={(e) => setRefreshSeconds(e.target.value)}
        />
      </div>
      <div className="settings-card-footer">
        <button type="submit" disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save"}
        </button>
      </div>
    </form>
  );
}

// ---- Vaults section ----

function VaultEditForm({
  item,
  onSave,
  onCancel,
}: {
  item: VaultConfig;
  onSave: (label: string, path: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [path, setPath] = useState(item.path);
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    const p = path.trim();
    if (!l || !p) return;
    onSave(l, p);
  }
  return (
    <form className="settings-array-form" onSubmit={handleSubmit}>
      <input className="settings-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" autoFocus />
      <input className="settings-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/absolute/path" />
      <button type="submit" className="settings-array-save" aria-label="Save">
        <IconCheck />
      </button>
      <button type="button" className="settings-array-cancel" onClick={onCancel} aria-label="Cancel">
        <IconX />
      </button>
    </form>
  );
}

function VaultRow({
  item,
  onSave,
  onDelete,
}: {
  item: VaultConfig;
  onSave: (label: string, path: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="settings-array-row editing">
        <VaultEditForm
          item={item}
          onSave={(label, path) => {
            onSave(label, path);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={`settings-array-row ${isDragging ? "dragging" : ""}`}>
      <button className="drag-handle" {...attributes} {...listeners} aria-label="Reorder">
        <IconGrip />
      </button>
      <div className="settings-array-row-main">
        <span className="settings-array-row-label">{item.label}</span>
        <span className="settings-array-row-sub">{item.path}</span>
      </div>
      <span className="row-actions">
        <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
          <IconPencil />
        </button>
        <button className="row-action danger" onClick={onDelete} aria-label="Delete">
          <IconTrash />
        </button>
      </span>
    </div>
  );
}

function VaultsSection({ vaults, onChange }: { vaults: VaultConfig[]; onChange: (v: VaultConfig[]) => void }) {
  const { add, update, remove, reorder } = useVaultSettingsList(onChange);
  const [label, setLabel] = useState("");
  const [path, setPath] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = vaults.findIndex((i) => i.id === active.id);
    const newIndex = vaults.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorder(arrayMove(vaults, oldIndex, newIndex));
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    const l = label.trim();
    const p = path.trim();
    if (!l || !p) return;
    add(l, p);
    setLabel("");
    setPath("");
  }

  return (
    <div className="settings-card">
      <h3>Vaults</h3>
      <p className="settings-card-hint">
        Obsidian vault roots the Notes tab can browse. Separate from Grimoire's vault above — point
        this at as many vaults as you like, including that same one.
      </p>
      {vaults.length === 0 ? (
        <p className="muted">No vaults configured.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={vaults.map((v) => v.id)} strategy={verticalListSortingStrategy}>
            {vaults.map((v) => (
              <VaultRow
                key={v.id}
                item={v}
                onSave={(label, path) => update(v.id, label, path)}
                onDelete={() => remove(v.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      <form className="settings-array-form" onSubmit={handleAdd}>
        <input className="settings-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
        <input className="settings-input" value={path} onChange={(e) => setPath(e.target.value)} placeholder="/absolute/path" />
        <button type="submit" disabled={!label.trim() || !path.trim()} aria-label="Add">
          <IconPlus />
        </button>
      </form>
    </div>
  );
}

// ---- Social section ----
//
// Two array lists in one section rather than two more entries in the nav —
// they're the two halves of a single tab's configuration. Both follow the
// Vaults shape above: dnd-kit reorder, inline edit, add form at the bottom.

// Channels are named by whatever the user can actually see — an @handle, or a
// pasted channel URL — and resolved to the `UC…` id the feed needs once, here,
// rather than on every poll. parseChannelInput gates the button without a
// network call; the resolve confirms the channel actually exists.
function ChannelFields({
  channel,
  label,
  onChannel,
  onLabel,
  autoFocus,
}: {
  channel: string;
  label: string;
  onChannel: (v: string) => void;
  onLabel: (v: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <>
      <input
        className="settings-input"
        value={channel}
        onChange={(e) => onChannel(e.target.value)}
        placeholder="@handle, channel URL, or UC…"
        autoFocus={autoFocus}
      />
      <input
        className="settings-input"
        value={label}
        onChange={(e) => onLabel(e.target.value)}
        placeholder="Label (optional)"
      />
    </>
  );
}

function YouTubeChannelEditForm({
  item,
  onSave,
  onCancel,
}: {
  item: YouTubeChannelConfig;
  onSave: (label: string, channelId: string) => void;
  onCancel: () => void;
}) {
  const [channel, setChannel] = useState(item.channelId);
  const [label, setLabel] = useState(item.label);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const valid = parseChannelInput(channel) !== null;

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const res = await window.api.youtube.resolveChannel(channel);
    setBusy(false);
    if (!res.ok || !res.channelId) {
      setError(res.reason || "Couldn't resolve that channel");
      return;
    }
    onSave(label.trim() || res.title || res.channelId, res.channelId);
  }

  return (
    <form className="settings-array-form" onSubmit={handleSubmit}>
      <ChannelFields channel={channel} label={label} onChannel={setChannel} onLabel={setLabel} autoFocus />
      <button type="submit" className="settings-array-save" disabled={!valid || busy} aria-label="Save">
        <IconCheck />
      </button>
      <button type="button" className="settings-array-cancel" onClick={onCancel} aria-label="Cancel">
        <IconX />
      </button>
      {error && <span className="settings-array-error">{error}</span>}
    </form>
  );
}

function YouTubeChannelRow({
  item,
  onSave,
  onDelete,
}: {
  item: YouTubeChannelConfig;
  onSave: (label: string, channelId: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="settings-array-row editing">
        <YouTubeChannelEditForm
          item={item}
          onSave={(label, channelId) => {
            onSave(label, channelId);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={`settings-array-row ${isDragging ? "dragging" : ""}`}>
      <button className="drag-handle" {...attributes} {...listeners} aria-label="Reorder">
        <IconGrip />
      </button>
      <div className="settings-array-row-main">
        <span className="settings-array-row-label">{item.label}</span>
        <span className="settings-array-row-sub">{item.channelId}</span>
      </div>
      <span className="row-actions">
        <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
          <IconPencil />
        </button>
        <button className="row-action danger" onClick={onDelete} aria-label="Delete">
          <IconTrash />
        </button>
      </span>
    </div>
  );
}

function YouTubeChannelsSection({
  channels,
  onChange,
}: {
  channels: YouTubeChannelConfig[];
  onChange: (c: YouTubeChannelConfig[]) => void;
}) {
  const { add, update, remove, reorder } = useYouTubeChannelSettingsList(onChange);
  const [channel, setChannel] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const valid = parseChannelInput(channel) !== null;

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = channels.findIndex((i) => i.id === active.id);
    const newIndex = channels.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorder(arrayMove(channels, oldIndex, newIndex));
  }

  async function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!valid || busy) return;
    setBusy(true);
    setError("");
    const res = await window.api.youtube.resolveChannel(channel);
    setBusy(false);
    if (!res.ok || !res.channelId) {
      setError(res.reason || "Couldn't resolve that channel");
      return;
    }
    // An empty label takes the channel's own name, so pasting a handle is the
    // whole interaction.
    add(label.trim() || res.title || res.channelId, res.channelId);
    setChannel("");
    setLabel("");
  }

  return (
    <div className="settings-card">
      <h3>YouTube channels</h3>
      <p className="settings-card-hint">
        Paste a channel @handle, its URL, or a UC… ID — all three work, and the label fills in
        from the channel's own name if you leave it blank. Read from YouTube's public feed, so no
        API key is needed; it carries the ~15 most recent uploads per channel with Shorts mixed in.
      </p>
      {channels.length === 0 ? (
        <p className="muted">No channels configured.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={channels.map((c) => c.id)} strategy={verticalListSortingStrategy}>
            {channels.map((c) => (
              <YouTubeChannelRow
                key={c.id}
                item={c}
                onSave={(label, channelId) => update(c.id, label, channelId)}
                onDelete={() => remove(c.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      <form className="settings-array-form" onSubmit={handleAdd}>
        <ChannelFields channel={channel} label={label} onChannel={setChannel} onLabel={setLabel} />
        <button type="submit" disabled={!valid || busy} aria-label="Add">
          <IconPlus />
        </button>
      </form>
      {error && <p className="settings-array-error">{error}</p>}
      {busy && <p className="muted">Looking up the channel…</p>}
    </div>
  );
}

function SubredditEditForm({
  item,
  onSave,
  onCancel,
}: {
  item: SubredditConfig;
  onSave: (subreddit: string) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(item.subreddit);
  const normalized = normalizeSubreddit(name);
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!normalized) return;
    onSave(normalized);
  }
  return (
    <form className="settings-array-form" onSubmit={handleSubmit}>
      <input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="rust" autoFocus />
      <button type="submit" className="settings-array-save" disabled={!normalized} aria-label="Save">
        <IconCheck />
      </button>
      <button type="button" className="settings-array-cancel" onClick={onCancel} aria-label="Cancel">
        <IconX />
      </button>
    </form>
  );
}

function SubredditRow({
  item,
  onSave,
  onDelete,
}: {
  item: SubredditConfig;
  onSave: (subreddit: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="settings-array-row editing">
        <SubredditEditForm
          item={item}
          onSave={(subreddit) => {
            onSave(subreddit);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={`settings-array-row ${isDragging ? "dragging" : ""}`}>
      <button className="drag-handle" {...attributes} {...listeners} aria-label="Reorder">
        <IconGrip />
      </button>
      <div className="settings-array-row-main">
        <span className="settings-array-row-label">r/{item.subreddit}</span>
      </div>
      <span className="row-actions">
        <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
          <IconPencil />
        </button>
        <button className="row-action danger" onClick={onDelete} aria-label="Delete">
          <IconTrash />
        </button>
      </span>
    </div>
  );
}

function SubredditsSection({
  subreddits,
  onChange,
}: {
  subreddits: SubredditConfig[];
  onChange: (s: SubredditConfig[]) => void;
}) {
  const { add, update, remove, reorder } = useSubredditSettingsList(onChange);
  const [name, setName] = useState("");
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  // Same normalizer main applies on write, so the form can't accept something
  // the write would silently drop.
  const normalized = normalizeSubreddit(name);

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = subreddits.findIndex((i) => i.id === active.id);
    const newIndex = subreddits.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorder(arrayMove(subreddits, oldIndex, newIndex));
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!normalized) return;
    add(normalized);
    setName("");
  }

  return (
    <div className="settings-card">
      <h3>Subreddits</h3>
      <p className="settings-card-hint">
        One tab each in the Reddit widget, in this order. No API key or account needed —
        posts are read the same way a browser tab would.
      </p>
      {subreddits.length === 0 ? (
        <p className="muted">No subreddits configured.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={subreddits.map((s) => s.id)} strategy={verticalListSortingStrategy}>
            {subreddits.map((s) => (
              <SubredditRow
                key={s.id}
                item={s}
                onSave={(subreddit) => update(s.id, subreddit)}
                onDelete={() => remove(s.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      <form className="settings-array-form" onSubmit={handleAdd}>
        <input className="settings-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="rust — or r/rust" />
        <button type="submit" disabled={!normalized} aria-label="Add">
          <IconPlus />
        </button>
      </form>
    </div>
  );
}

// ---- Repositories section ----

// A row is valid with a label, a branch, and at least one of the two sides it
// can describe: owner+repo (GitHub widget) or a local path (Git widget). A
// GitHub-only row and a local-only row are both legitimate.
function repoDraftIsValid(d: {
  label: string;
  owner: string;
  repo: string;
  branch: string;
  localPath: string;
}): boolean {
  if (!d.label.trim() || !d.branch.trim()) return false;
  const hasRemote = Boolean(d.owner.trim() && d.repo.trim());
  const hasLocal = Boolean(d.localPath.trim());
  return hasRemote || hasLocal;
}

function draftToRepoInput(d: {
  label: string;
  owner: string;
  repo: string;
  branch: string;
  localPath: string;
}): GitHubRepoInput {
  return {
    label: d.label.trim(),
    owner: d.owner.trim() || undefined,
    repo: d.repo.trim() || undefined,
    branch: d.branch.trim(),
    localPath: d.localPath.trim() || undefined,
  };
}

function GithubRepoEditForm({
  item,
  onSave,
  onCancel,
}: {
  item: GitHubRepoConfig;
  onSave: (input: GitHubRepoInput) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [owner, setOwner] = useState(item.owner ?? "");
  const [repo, setRepo] = useState(item.repo ?? "");
  const [branch, setBranch] = useState(item.branch);
  const [localPath, setLocalPath] = useState(item.localPath ?? "");
  const draft = { label, owner, repo, branch, localPath };
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!repoDraftIsValid(draft)) return;
    onSave(draftToRepoInput(draft));
  }
  return (
    <form className="settings-array-form" onSubmit={handleSubmit}>
      <input className="settings-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" autoFocus />
      <input className="settings-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" />
      <input className="settings-input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" />
      <input className="settings-input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
      <input className="settings-input" value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/local/path (optional)" />
      <button type="submit" className="settings-array-save" aria-label="Save">
        <IconCheck />
      </button>
      <button type="button" className="settings-array-cancel" onClick={onCancel} aria-label="Cancel">
        <IconX />
      </button>
    </form>
  );
}

function GithubRepoRow({
  item,
  onSave,
  onDelete,
}: {
  item: GitHubRepoConfig;
  onSave: (input: GitHubRepoInput) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="settings-array-row editing">
        <GithubRepoEditForm
          item={item}
          onSave={(input) => {
            onSave(input);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={`settings-array-row ${isDragging ? "dragging" : ""}`}>
      <button className="drag-handle" {...attributes} {...listeners} aria-label="Reorder">
        <IconGrip />
      </button>
      <div className="settings-array-row-main">
        <span className="settings-array-row-label">{item.label}</span>
        <span className="settings-array-row-sub">
          {[
            item.owner && item.repo ? `${item.owner}/${item.repo}@${item.branch}` : null,
            item.localPath,
          ]
            .filter(Boolean)
            .join(" · ")}
        </span>
      </div>
      <span className="row-actions">
        <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
          <IconPencil />
        </button>
        <button className="row-action danger" onClick={onDelete} aria-label="Delete">
          <IconTrash />
        </button>
      </span>
    </div>
  );
}

function GithubReposSection({
  repos,
  onChange,
}: {
  repos: GitHubRepoConfig[];
  onChange: (r: GitHubRepoConfig[]) => void;
}) {
  const { add, update, remove, reorder } = useGithubRepoSettingsList(onChange);
  const [label, setLabel] = useState("");
  const [owner, setOwner] = useState("");
  const [repo, setRepo] = useState("");
  const [branch, setBranch] = useState("main");
  const [localPath, setLocalPath] = useState("");
  const draft = { label, owner, repo, branch, localPath };
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = repos.findIndex((i) => i.id === active.id);
    const newIndex = repos.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorder(arrayMove(repos, oldIndex, newIndex));
  }

  function handleAdd(e: FormEvent) {
    e.preventDefault();
    if (!repoDraftIsValid(draft)) return;
    add(draftToRepoInput(draft));
    setLabel("");
    setOwner("");
    setRepo("");
    setBranch("main");
    setLocalPath("");
  }

  return (
    <div className="settings-card">
      <h3>Repositories</h3>
      <p className="settings-card-hint">
        Tracked repos. Set owner/repo for the GitHub widget's CI status + PR count, and a local
        path for the Git widget's working-tree status — either alone is fine, or both together.
      </p>
      {repos.length === 0 ? (
        <p className="muted">No repos configured.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={repos.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {repos.map((r) => (
              <GithubRepoRow
                key={r.id}
                item={r}
                onSave={(input) => update(r.id, input)}
                onDelete={() => remove(r.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      <form className="settings-array-form" onSubmit={handleAdd}>
        <input className="settings-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
        <input className="settings-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" />
        <input className="settings-input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" />
        <input className="settings-input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
        <input className="settings-input" value={localPath} onChange={(e) => setLocalPath(e.target.value)} placeholder="/local/path (optional)" />
        <button type="submit" disabled={!repoDraftIsValid(draft)} aria-label="Add">
          <IconPlus />
        </button>
      </form>
    </div>
  );
}

// ---- Processes section ----

interface ProcessDraft {
  label: string;
  command: string;
  args: string;
  cwd: string;
  url: string;
  autoOpenUrl: boolean;
  openDelayMs: string;
}

function draftToProc(draft: ProcessDraft, id: string): Omit<ProcessConfig, "sortOrder"> {
  return {
    id,
    label: draft.label.trim(),
    command: draft.command.trim(),
    args: draft.args
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean),
    cwd: draft.cwd.trim() || undefined,
    url: draft.url.trim() || undefined,
    autoOpenUrl: draft.autoOpenUrl || undefined,
    openDelayMs: draft.openDelayMs.trim() === "" ? undefined : Number(draft.openDelayMs),
  };
}

function procToDraft(proc: Omit<ProcessConfig, "sortOrder">): ProcessDraft {
  return {
    label: proc.label,
    command: proc.command,
    args: (proc.args ?? []).join(", "),
    cwd: proc.cwd ?? "",
    url: proc.url ?? "",
    autoOpenUrl: proc.autoOpenUrl ?? false,
    openDelayMs: proc.openDelayMs != null ? String(proc.openDelayMs) : "",
  };
}

function ProcessFields({
  draft,
  onChange,
}: {
  draft: ProcessDraft;
  onChange: (d: ProcessDraft) => void;
}) {
  return (
    <>
      <input
        className="settings-input"
        value={draft.label}
        onChange={(e) => onChange({ ...draft, label: e.target.value })}
        placeholder="Label"
      />
      <input
        className="settings-input"
        value={draft.command}
        onChange={(e) => onChange({ ...draft, command: e.target.value })}
        placeholder="Command"
      />
      <input
        className="settings-input"
        value={draft.args}
        onChange={(e) => onChange({ ...draft, args: e.target.value })}
        placeholder="Args (comma-separated)"
      />
      <input
        className="settings-input"
        value={draft.cwd}
        onChange={(e) => onChange({ ...draft, cwd: e.target.value })}
        placeholder="Working dir (optional)"
      />
      <input
        className="settings-input"
        value={draft.url}
        onChange={(e) => onChange({ ...draft, url: e.target.value })}
        placeholder="URL to open (optional)"
      />
      <input
        className="settings-input settings-input-narrow"
        type="number"
        min={0}
        value={draft.openDelayMs}
        onChange={(e) => onChange({ ...draft, openDelayMs: e.target.value })}
        placeholder="Open delay ms"
      />
      <label className="settings-checkbox-label">
        <input
          type="checkbox"
          checked={draft.autoOpenUrl}
          onChange={(e) => onChange({ ...draft, autoOpenUrl: e.target.checked })}
        />
        Auto-open URL on start
      </label>
    </>
  );
}

function ProcessEditForm({
  item,
  onSave,
  onCancel,
}: {
  item: ProcessConfig;
  onSave: (proc: Omit<ProcessConfig, "id" | "sortOrder">) => void;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<ProcessDraft>(procToDraft(item));
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!draft.label.trim() || !draft.command.trim()) return;
    const { id: _unused, ...rest } = draftToProc(draft, item.id);
    onSave(rest);
  }
  return (
    <form className="settings-array-form settings-process-form" onSubmit={handleSubmit}>
      <div className="settings-process-id">
        id: <code>{item.id}</code>
      </div>
      <ProcessFields draft={draft} onChange={setDraft} />
      <div className="settings-array-form-actions">
        <button type="submit" className="settings-array-save" aria-label="Save">
          <IconCheck /> Save
        </button>
        <button type="button" className="settings-array-cancel" onClick={onCancel} aria-label="Cancel">
          <IconX /> Cancel
        </button>
      </div>
    </form>
  );
}

function ProcessRow({
  item,
  onSave,
  onDelete,
}: {
  item: ProcessConfig;
  onSave: (proc: Omit<ProcessConfig, "id" | "sortOrder">) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
  });
  const style = { transform: CSS.Transform.toString(transform), transition };

  if (editing) {
    return (
      <div ref={setNodeRef} style={style} className="settings-array-row editing">
        <ProcessEditForm
          item={item}
          onSave={(proc) => {
            onSave(proc);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      </div>
    );
  }

  return (
    <div ref={setNodeRef} style={style} className={`settings-array-row ${isDragging ? "dragging" : ""}`}>
      <button className="drag-handle" {...attributes} {...listeners} aria-label="Reorder">
        <IconGrip />
      </button>
      <div className="settings-array-row-main">
        <span className="settings-array-row-label">{item.label}</span>
        <span className="settings-array-row-sub">
          {item.command} {(item.args ?? []).join(" ")}
        </span>
      </div>
      <span className="row-actions">
        <button className="row-action" onClick={() => setEditing(true)} aria-label="Edit">
          <IconPencil />
        </button>
        <button className="row-action danger" onClick={onDelete} aria-label="Delete">
          <IconTrash />
        </button>
      </span>
    </div>
  );
}

function ProcessAddForm({
  existingIds,
  onAdd,
}: {
  existingIds: string[];
  onAdd: (proc: Omit<ProcessConfig, "sortOrder">) => void;
}) {
  const [draft, setDraft] = useState<ProcessDraft>(procToDraft({ id: "", label: "", command: "", args: [] }));
  const [id, setId] = useState("");
  const [idTouched, setIdTouched] = useState(false);

  function handleLabelChange(next: ProcessDraft) {
    setDraft(next);
    if (!idTouched) {
      setId(uniqueSlug(next.label, new Set(existingIds)));
    }
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const finalId = id.trim() || uniqueSlug(draft.label, new Set(existingIds));
    if (!draft.label.trim() || !draft.command.trim() || !finalId) return;
    onAdd(draftToProc(draft, finalId));
    setDraft(procToDraft({ id: "", label: "", command: "", args: [] }));
    setId("");
    setIdTouched(false);
  }

  return (
    <form className="settings-array-form settings-process-form" onSubmit={handleSubmit}>
      <div className="settings-field-row">
        <label>Process id</label>
        <input
          className="settings-input"
          value={id}
          onChange={(e) => {
            setId(e.target.value);
            setIdTouched(true);
          }}
          placeholder="auto-generated from label"
        />
      </div>
      <ProcessFields draft={draft} onChange={handleLabelChange} />
      <div className="settings-array-form-actions">
        <button type="submit" disabled={!draft.label.trim() || !draft.command.trim()}>
          <IconPlus /> Add process
        </button>
      </div>
    </form>
  );
}

function ProcessesSection({
  processes,
  onChange,
}: {
  processes: ProcessConfig[];
  onChange: (p: ProcessConfig[]) => void;
}) {
  const { add, update, remove, reorder } = useProcessSettingsList(onChange);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));

  function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = processes.findIndex((i) => i.id === active.id);
    const newIndex = processes.findIndex((i) => i.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    reorder(arrayMove(processes, oldIndex, newIndex));
  }

  return (
    <div className="settings-card">
      <h3>Processes</h3>
      <p className="settings-card-hint">
        Long-running local tools the Development tab's Processes widget can start/stop/tail. Not a
        terminal — the process's own web UI (if it has one) opens via the URL below.
      </p>
      {processes.length === 0 ? (
        <p className="muted">No processes configured.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={processes.map((p) => p.id)} strategy={verticalListSortingStrategy}>
            {processes.map((p) => (
              <ProcessRow
                key={p.id}
                item={p}
                onSave={(proc) => update(p.id, proc)}
                onDelete={() => remove(p.id)}
              />
            ))}
          </SortableContext>
        </DndContext>
      )}
      <ProcessAddForm existingIds={processes.map((p) => p.id)} onAdd={add} />
    </div>
  );
}

// ---- tabs ----

function TabRow({
  tab,
  isLastVisible,
  onRename,
  onToggleHidden,
}: {
  tab: TabConfig;
  isLastVisible: boolean;
  onRename: (label: string) => void;
  onToggleHidden: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(tab.label);
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tab.id });
  const style = { transform: CSS.Transform.toString(transform), transition };

  function commit() {
    const trimmed = value.trim();
    if (trimmed && trimmed !== tab.label) onRename(trimmed);
    else setValue(tab.label);
    setEditing(false);
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`settings-array-row ${isDragging ? "dragging" : ""} ${tab.hidden ? "tab-row-hidden" : ""}`}
    >
      <button className="drag-handle" {...attributes} {...listeners} aria-label={`Reorder ${tab.label}`}>
        <IconGrip />
      </button>
      {editing ? (
        <input
          className="settings-input"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setValue(tab.label);
              setEditing(false);
            }
          }}
        />
      ) : (
        <div className="settings-array-row-main">
          <span className="settings-array-row-label">{tab.label}</span>
          {tab.hidden && <span className="settings-array-row-sub">hidden</span>}
        </div>
      )}
      <span className="row-actions always-visible">
        <button className="row-action" onClick={() => setEditing(true)} aria-label={`Rename ${tab.label}`} title="Rename">
          <IconPencil />
        </button>
        <button
          className="row-action"
          onClick={onToggleHidden}
          disabled={isLastVisible}
          aria-label={tab.hidden ? `Show ${tab.label}` : `Hide ${tab.label}`}
          title={isLastVisible ? "At least one tab must stay visible" : tab.hidden ? "Show tab" : "Hide tab"}
        >
          {tab.hidden ? <IconEyeOff /> : <IconEye />}
        </button>
      </span>
    </div>
  );
}

function TabsSection({ tabs, onChange }: { tabs: TabConfig[]; onChange: (tabs: TabConfig[]) => void }) {
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }));
  const visibleCount = tabs.filter((t) => !t.hidden).length;

  async function handleDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldIndex = tabs.findIndex((t) => t.id === active.id);
    const newIndex = tabs.findIndex((t) => t.id === over.id);
    if (oldIndex === -1 || newIndex === -1) return;
    const next = arrayMove(tabs, oldIndex, newIndex);
    onChange(next); // optimistic, so the row doesn't snap back while the write lands
    onChange(await window.api.settings.tabs.reorder(next.map((t) => t.id)));
  }

  return (
    <div className="settings-card">
      <h3>Tabs</h3>
      <p className="settings-card-hint">
        Drag to set the order of the tab strip, click the eye to show or hide a tab, and the pencil to rename
        one. A hidden tab keeps its data and is simply left out of the strip and the command palette.
      </p>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={tabs.map((t) => t.id)} strategy={verticalListSortingStrategy}>
          {tabs.map((t) => (
            <TabRow
              key={t.id}
              tab={t}
              isLastVisible={!t.hidden && visibleCount <= 1}
              onRename={async (label) => onChange(await window.api.settings.tabs.rename(t.id, label))}
              onToggleHidden={async () => onChange(await window.api.settings.tabs.setHidden(t.id, !t.hidden))}
            />
          ))}
        </SortableContext>
      </DndContext>
    </div>
  );
}

// ---- top-level page ----

export default function SettingsPage({
  open,
  initialSection,
  onClose,
  onProcessConfigsChange,
  onTabsChange,
  onAppRefreshMinutesChange,
  onDockerRefreshSecondsChange,
  onDockerUpdateSettingsChange,
  onStatsSettingsChange,
  onSpotifyEnabledChange,
  onGitRefreshSecondsChange,
  onNotificationSettingsChange,
  onGithubRefreshSecondsChange,
  onYnabRefreshSecondsChange,
  onTodoistShowTimeTrackingChange,
  onOpenRouterRefreshSecondsChange,
  onOpenAIRefreshSecondsChange,
  onFirecrawlRefreshSecondsChange,
  onRailwayRefreshSecondsChange,
}: SettingsPageProps) {
  const [section, setSection] = useState<SectionId>(initialSection ?? "general");
  const [data, setData] = useState<AppConfig | null>(null);
  const [tabs, setTabs] = useState<TabConfig[]>([]);

  useEffect(() => {
    if (!open) return;
    setSection(initialSection ?? "general");
    window.api.settings.getAll().then((cfg) => {
      setData(cfg);
      setTabs(cfg.tabs ?? []);
    });
  }, [open, initialSection]);

  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  const handleScrimClick = useCallback(
    (e: MouseEvent<HTMLDivElement>) => {
      if (e.target === e.currentTarget) onClose();
    },
    [onClose]
  );

  if (!open) return null;

  return (
    <div className="settings-scrim" onClick={handleScrimClick}>
      <div className="settings-panel" role="dialog" aria-modal="true" aria-label="Settings">
        <div className="settings-head">
          <h2>Settings</h2>
          <button className="settings-close" onClick={onClose} title="Close">
            <IconX />
          </button>
        </div>

        {!data ? (
          <div className="settings-body">
            <p className="muted">Loading…</p>
          </div>
        ) : (
          <div className="settings-body">
            <nav className="settings-nav">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  className={`settings-nav-item ${section === s.id ? "active" : ""}`}
                  onClick={() => setSection(s.id)}
                >
                  {s.label}
                </button>
              ))}
            </nav>

            <div className="settings-content">
              {section === "general" && (
                <>
                  <AppCard
                    value={data.app ?? {}}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, app: v } : prev));
                      onAppRefreshMinutesChange(v.refreshMinutes);
                    }}
                  />
                  <DockerCard
                    value={data.docker}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, docker: v } : prev));
                      onDockerRefreshSecondsChange(v.refreshSeconds);
                      onDockerUpdateSettingsChange(v);
                    }}
                  />
                  <StatsCard
                    value={data.stats ?? { refreshSeconds: 5, publicIpEnabled: true, publicIpCheckMinutes: 60 }}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, stats: v } : prev));
                      onStatsSettingsChange(v);
                    }}
                  />
                  <SpotifyCard
                    value={data.spotify ?? { enabled: true }}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, spotify: v } : prev));
                      onSpotifyEnabledChange(v.enabled);
                    }}
                  />
                  <GitCard
                    value={data.git ?? {}}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, git: v } : prev));
                      onGitRefreshSecondsChange(v.refreshSeconds);
                    }}
                  />
                  <NotificationsCard
                    value={data.notifications ?? {}}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, notifications: v } : prev));
                      onNotificationSettingsChange(v);
                    }}
                  />
                  <CaptureCard
                    value={data.capture ?? {}}
                    onSaved={(v) => setData((prev) => (prev ? { ...prev, capture: v } : prev))}
                  />
                </>
              )}

              {section === "data" && (
                <DataCard
                  value={data.backup ?? {}}
                  onSaved={(v) => setData((prev) => (prev ? { ...prev, backup: v } : prev))}
                />
              )}

              {section === "grimoire" && (
                <GrimoireCard
                  value={data.grimoire}
                  onSaved={(v) => setData((prev) => (prev ? { ...prev, grimoire: v } : prev))}
                />
              )}

              {section === "integrations" && (
                <>
                  <TodoistCard
                    value={data.todoist}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, todoist: v } : prev));
                      onTodoistShowTimeTrackingChange(v.showTimeTracking !== false);
                    }}
                  />
                  <GoogleCalendarCard
                    value={data.googleCalendar}
                    onSaved={(v) => setData((prev) => (prev ? { ...prev, googleCalendar: v } : prev))}
                  />
                  <ReaderCard
                    value={data.reader}
                    onSaved={(v) => setData((prev) => (prev ? { ...prev, reader: v } : prev))}
                  />
                  <GithubScalarCard
                    value={data.github ?? {}}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, github: { ...prev.github, ...v } } : prev));
                      onGithubRefreshSecondsChange(v.refreshSeconds ?? 300);
                    }}
                  />
                  <YnabScalarCard
                    value={data.ynab ?? {}}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, ynab: v } : prev));
                      onYnabRefreshSecondsChange(v.refreshSeconds ?? 300);
                    }}
                  />
                  <OpenRouterCard
                    value={data.openrouter ?? {}}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, openrouter: v } : prev));
                      onOpenRouterRefreshSecondsChange(v.refreshSeconds);
                    }}
                  />
                  <OpenAICard
                    value={data.openai ?? {}}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, openai: v } : prev));
                      onOpenAIRefreshSecondsChange(v.refreshSeconds);
                    }}
                  />
                  <FirecrawlCard
                    value={data.firecrawl ?? {}}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, firecrawl: v } : prev));
                      onFirecrawlRefreshSecondsChange(v.refreshSeconds);
                    }}
                  />
                  <RailwayCard
                    value={data.railway ?? {}}
                    onSaved={(v) => {
                      setData((prev) => (prev ? { ...prev, railway: v } : prev));
                      onRailwayRefreshSecondsChange(v.refreshSeconds);
                    }}
                  />
                </>
              )}

              {section === "assistant" && (
                <>
                  <AssistantCard
                    value={data.assistant ?? {}}
                    onSaved={(v) => setData((prev) => (prev ? { ...prev, assistant: v } : prev))}
                  />
                  <AssistantCommandsCard />
                </>
              )}

              {section === "vaults" && (
                <VaultsSection
                  vaults={data.vaults ?? []}
                  onChange={(vaults) => setData((prev) => (prev ? { ...prev, vaults } : prev))}
                />
              )}

              {section === "githubRepos" && (
                <GithubReposSection
                  repos={data.github?.repos ?? []}
                  onChange={(repos) =>
                    setData((prev) => (prev ? { ...prev, github: { ...prev.github, repos } } : prev))
                  }
                />
              )}

              {section === "processes" && (
                <ProcessesSection
                  processes={data.processes ?? []}
                  onChange={(processes) => {
                    setData((prev) => (prev ? { ...prev, processes } : prev));
                    onProcessConfigsChange(processes);
                  }}
                />
              )}

              {section === "tabs" && (
                <TabsSection
                  tabs={tabs}
                  onChange={(next) => {
                    setTabs(next);
                    onTabsChange(next);
                  }}
                />
              )}

              {section === "social" && (
                <>
                  <YouTubeChannelsSection
                    channels={data.youtubeChannels ?? []}
                    onChange={(youtubeChannels) =>
                      setData((prev) => (prev ? { ...prev, youtubeChannels } : prev))
                    }
                  />
                  <SubredditsSection
                    subreddits={data.subreddits ?? []}
                    onChange={(subreddits) =>
                      setData((prev) => (prev ? { ...prev, subreddits } : prev))
                    }
                  />
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
