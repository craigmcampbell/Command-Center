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
  ProcessConfig,
  VaultConfig,
  YnabScalarConfig,
} from "../../../shared/types";
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

type SectionId = "general" | "grimoire" | "integrations" | "vaults" | "githubRepos" | "processes";

const SECTIONS: { id: SectionId; label: string }[] = [
  { id: "general", label: "General" },
  { id: "grimoire", label: "Grimoire" },
  { id: "integrations", label: "Integrations" },
  { id: "vaults", label: "Vaults" },
  { id: "githubRepos", label: "GitHub Repos" },
  { id: "processes", label: "Processes" },
];

interface SettingsPageProps {
  open: boolean;
  onClose: () => void;
  onProcessConfigsChange: (configs: ProcessConfig[]) => void;
  onAppRefreshMinutesChange: (minutes: number | undefined) => void;
  onDockerRefreshSecondsChange: (seconds: number) => void;
  onGithubRefreshSecondsChange: (seconds: number) => void;
  onYnabRefreshSecondsChange: (seconds: number) => void;
  onTodoistShowTimeTrackingChange: (show: boolean) => void;
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

function GrimoireCard({
  value,
  onSaved,
}: {
  value: { vaultPath: string; dailyLogDir: string; missionsDir: string };
  onSaved: (v: { vaultPath: string; dailyLogDir: string; missionsDir: string }) => void;
}) {
  const [vaultPath, setVaultPath] = useState(value.vaultPath);
  const [dailyLogDir, setDailyLogDir] = useState(value.dailyLogDir);
  const [missionsDir, setMissionsDir] = useState(value.missionsDir);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setVaultPath(value.vaultPath);
    setDailyLogDir(value.dailyLogDir);
    setMissionsDir(value.missionsDir);
  }, [value.vaultPath, value.dailyLogDir, value.missionsDir]);
  const dirty =
    vaultPath !== value.vaultPath ||
    dailyLogDir !== value.dailyLogDir ||
    missionsDir !== value.missionsDir;

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    setSaving(true);
    const result = await window.api.settings.grimoire.update({ vaultPath, dailyLogDir, missionsDir });
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

// ---- GitHub Repos section ----

function GithubRepoEditForm({
  item,
  onSave,
  onCancel,
}: {
  item: GitHubRepoConfig;
  onSave: (label: string, owner: string, repo: string, branch: string) => void;
  onCancel: () => void;
}) {
  const [label, setLabel] = useState(item.label);
  const [owner, setOwner] = useState(item.owner);
  const [repo, setRepo] = useState(item.repo);
  const [branch, setBranch] = useState(item.branch);
  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!label.trim() || !owner.trim() || !repo.trim() || !branch.trim()) return;
    onSave(label.trim(), owner.trim(), repo.trim(), branch.trim());
  }
  return (
    <form className="settings-array-form" onSubmit={handleSubmit}>
      <input className="settings-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" autoFocus />
      <input className="settings-input" value={owner} onChange={(e) => setOwner(e.target.value)} placeholder="owner" />
      <input className="settings-input" value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="repo" />
      <input className="settings-input" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="main" />
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
  onSave: (label: string, owner: string, repo: string, branch: string) => void;
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
          onSave={(label, owner, repo, branch) => {
            onSave(label, owner, repo, branch);
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
          {item.owner}/{item.repo}@{item.branch}
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
    if (!label.trim() || !owner.trim() || !repo.trim() || !branch.trim()) return;
    add(label.trim(), owner.trim(), repo.trim(), branch.trim());
    setLabel("");
    setOwner("");
    setRepo("");
    setBranch("main");
  }

  return (
    <div className="settings-card">
      <h3>GitHub Repos</h3>
      <p className="settings-card-hint">Repos tracked by the GitHub widget's CI status + PR count.</p>
      {repos.length === 0 ? (
        <p className="muted">No repos configured.</p>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={repos.map((r) => r.id)} strategy={verticalListSortingStrategy}>
            {repos.map((r) => (
              <GithubRepoRow
                key={r.id}
                item={r}
                onSave={(label, owner, repo, branch) => update(r.id, label, owner, repo, branch)}
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
        <button
          type="submit"
          disabled={!label.trim() || !owner.trim() || !repo.trim() || !branch.trim()}
          aria-label="Add"
        >
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
  onGithubRefreshSecondsChange,
  onYnabRefreshSecondsChange,
  onTodoistShowTimeTrackingChange,
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
                </>
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
