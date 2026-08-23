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
  GrimoireConfig,
  NotificationHealth,
  NotificationSettings,
  OpenRouterScalarConfig,
  ProcessConfig,
  VaultConfig,
  YnabScalarConfig,
} from "../../../shared/types";
import { validateAccelerator } from "../../../shared/accelerator";
import {
  useGithubRepoSettingsList,
  useProcessSettingsList,
  useVaultSettingsList,
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
  | "vaults"
  | "githubRepos"
  | "processes"
  | "data";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "grimoire", label: "Grimoire" },
  { id: "integrations", label: "Integrations" },
  { id: "vaults", label: "Vaults" },
  { id: "githubRepos", label: "Repositories" },
  { id: "processes", label: "Processes" },
  { id: "data", label: "Data" },
];

interface SettingsPageProps {
  open: boolean;
  onClose: () => void;
  onProcessConfigsChange: (configs: ProcessConfig[]) => void;
  onAppRefreshMinutesChange: (minutes: number | undefined) => void;
  onDockerRefreshSecondsChange: (seconds: number) => void;
  onGitRefreshSecondsChange: (seconds?: number) => void;
  onNotificationSettingsChange: (values: NotificationSettings) => void;
  onGithubRefreshSecondsChange: (seconds: number) => void;
  onYnabRefreshSecondsChange: (seconds: number) => void;
  onTodoistShowTimeTrackingChange: (show: boolean) => void;
  onOpenRouterRefreshSecondsChange: (seconds?: number) => void;
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
  value: { refreshSeconds: number };
  onSaved: (v: { refreshSeconds: number }) => void;
}) {
  const [seconds, setSeconds] = useState(String(value.refreshSeconds));
  const [saving, setSaving] = useState(false);
  useEffect(() => setSeconds(String(value.refreshSeconds)), [value.refreshSeconds]);
  const dirty = seconds !== String(value.refreshSeconds);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.docker.update({
      refreshSeconds: Number(seconds) || 15,
    });
    setSaving(false);
    onSaved(result);
  }

  return (
    <form className="settings-card" onSubmit={handleSave}>
      <h3>Docker</h3>
      <p className="settings-card-hint">How often the Services widget polls `docker ps`.</p>
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
              </li>
            ))}
          </ul>
        )}

        <div className="settings-card-footer">
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

// ---- top-level page ----

export default function SettingsPage({
  open,
  onClose,
  onProcessConfigsChange,
  onAppRefreshMinutesChange,
  onDockerRefreshSecondsChange,
  onGitRefreshSecondsChange,
  onNotificationSettingsChange,
  onGithubRefreshSecondsChange,
  onYnabRefreshSecondsChange,
  onTodoistShowTimeTrackingChange,
  onOpenRouterRefreshSecondsChange,
}: SettingsPageProps) {
  const [section, setSection] = useState<SectionId>("general");
  const [data, setData] = useState<AppConfig | null>(null);

  useEffect(() => {
    if (!open) return;
    setSection("general");
    window.api.settings.getAll().then(setData);
  }, [open]);

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
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
