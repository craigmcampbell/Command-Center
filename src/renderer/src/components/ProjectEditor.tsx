import { useEffect, useState } from "react";
import type { DockerResult, GitHubRepoConfig, ProcessConfig, Project, ProjectInput, VaultConfig } from "../../../shared/types";
import NoteBrowserModal from "./NoteBrowserModal";

export default function ProjectEditor({ project, docker, processes, onSave, onClose }: {
  project: Project | null; docker: DockerResult | null; processes: ProcessConfig[];
  onSave: (input: ProjectInput, id?: number) => Promise<void>; onClose: () => void;
}) {
  const [draft, setDraft] = useState<ProjectInput>(project ?? { name: "", folder: "", status: "active", pinned: false, githubUrl: "", todoistTaskId: "", note: null, links: [], processIds: [], containerNames: [] });
  const [repos, setRepos] = useState<GitHubRepoConfig[]>([]);
  const [vaults, setVaults] = useState<VaultConfig[]>([]);
  const [browser, setBrowser] = useState<string | null>(null);
  const [vault, setVault] = useState(project?.note?.vaultLabel || "");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { void Promise.all([window.api.settings.githubRepos.list(), window.api.notes.vaults()]).then(([r, v]) => { setRepos(r); setVaults(v); }).catch(e => setError(String(e))); }, []);
  const field = <K extends keyof ProjectInput>(key: K, value: ProjectInput[K]) => setDraft(d => ({ ...d, [key]: value }));
  const toggle = (key: "processIds" | "containerNames", value: string) => field(key, draft[key].includes(value) ? draft[key].filter(v => v !== value) : [...draft[key], value]);
  return <div className="settings-scrim"><form className="project-editor" role="dialog" aria-modal="true" aria-label={project ? "Edit project" : "Add project"} onSubmit={async e => {
    e.preventDefault(); setBusy(true); setError("");
    try { await onSave(draft, project?.id); onClose(); } catch (err) { setError(String(err)); } finally { setBusy(false); }
  }}>
    <div className="project-note-heading"><h2>{project ? "Edit project" : "Add project"}</h2><button type="button" onClick={onClose} disabled={busy}>Cancel</button></div>
    <label>Name<input required autoFocus value={draft.name} onChange={e => field("name", e.target.value)} /></label>
    <label>Use an existing repository<select value={draft.repoId || ""} onChange={e => {
      const repo = repos.find(r => r.id === Number(e.target.value));
      if (repo) setDraft(d => ({ ...d, repoId: repo.id, folder: repo.localPath || "", githubUrl: repo.owner && repo.repo ? `https://github.com/${repo.owner}/${repo.repo}` : "" }));
      else field("repoId", undefined);
    }}><option value="">Enter a folder below</option>{repos.map(r => <option value={r.id} key={r.id}>{r.label}</option>)}</select></label>
    <label>Primary folder<input required placeholder="/Users/you/dev/project" value={draft.folder} onChange={e => field("folder", e.target.value)} /></label>
    <label>GitHub repository (optional)<input placeholder="https://github.com/owner/repo" value={draft.githubUrl} onChange={e => field("githubUrl", e.target.value)} /></label>
    <label>Todoist task URL or ID<input value={draft.todoistTaskId} onChange={e => field("todoistTaskId", e.target.value)} /></label>
    <label>Status<select value={draft.status} onChange={e => field("status", e.target.value as ProjectInput["status"])}><option value="active">Active</option><option value="paused">Paused</option><option value="archived">Archived</option></select></label>
    <label className="project-check"><input type="checkbox" checked={draft.pinned} onChange={e => field("pinned", e.target.checked)} />Pinned</label>
    <fieldset><legend>Obsidian note</legend><select aria-label="Vault" value={vault} onChange={e => setVault(e.target.value)}><option value="">Select vault</option>{vaults.map(v => <option key={v.label}>{v.label}</option>)}</select> <button type="button" disabled={!vault} onClick={() => setBrowser(vault)}>Choose note</button>
      {draft.note && <p>{draft.note.vaultLabel} / {draft.note.filePath} <button type="button" onClick={() => field("note", null)}>Unlink</button></p>}
    </fieldset>
    <fieldset><legend>App links</legend>{draft.links.map((link, i) => <div className="project-link-edit" key={i}><input required aria-label="Link label" placeholder="Local / Production / Hosting" value={link.label} onChange={e => field("links", draft.links.map((v, j) => j === i ? { ...v, label: e.target.value } : v))} /><input required type="url" aria-label="Link URL" placeholder="https://…" value={link.url} onChange={e => field("links", draft.links.map((v, j) => j === i ? { ...v, url: e.target.value } : v))} /><button type="button" onClick={() => field("links", draft.links.filter((_, j) => i !== j))}>Remove</button></div>)}<button type="button" onClick={() => field("links", [...draft.links, { label: "", url: "" }])}>Add link</button></fieldset>
    <fieldset><legend>Docker containers</legend>{!docker?.ok && <p className="muted">{docker?.reason || "Docker unavailable"}</p>}{Array.from(new Set([...(docker?.containers || []).map(c => c.name), ...draft.containerNames])).map(name => <label className="project-check" key={name}><input type="checkbox" checked={draft.containerNames.includes(name)} onChange={() => toggle("containerNames", name)} />{name}</label>)}</fieldset>
    <fieldset><legend>Managed processes</legend>{processes.length === 0 && <p className="muted">Add managed processes in Settings.</p>}{Array.from(new Set([...processes.map(p => p.id), ...draft.processIds])).map(id => <label className="project-check" key={id}><input type="checkbox" checked={draft.processIds.includes(id)} onChange={() => toggle("processIds", id)} />{processes.find(p => p.id === id)?.label || `${id} (unavailable)`}</label>)}</fieldset>
    {error && <p role="alert" className="error">{error}</p>}<button disabled={busy} type="submit">{busy ? "Saving…" : "Save project"}</button>
  </form>{browser && <NoteBrowserModal vaultLabel={browser} onClose={() => setBrowser(null)} onPick={filePath => { field("note", { vaultLabel: browser, filePath }); setBrowser(null); }} />}</div>;
}
