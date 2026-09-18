import { useEffect, useMemo, useState } from "react";
import type { ClaudeSessionsResult, CodexSessionsResult, DockerResult, DockerUpdateCheckResult, GitHubStatusResult, GitStatusResult, ProcessConfig, ProcessStatus, Project, ProjectInput, TodoistResult } from "../../../shared/types";
import { usePolling, useWindowVisible } from "../hooks/usePolling";
import { GitRow } from "./GitStatusWidget";
import { RepoRow, PrRow } from "./GitHubWidget";
import { DockerRow } from "./DockerWidget";
import { SessionRow as ClaudeSessionRow } from "./ClaudeSessionsWidget";
import { SessionRow as CodexSessionRow } from "./CodexSessionsWidget";
import ManagedProcessesWidget from "./ManagedProcessesWidget";
import TodoistWidget from "./TodoistWidget";
import ProjectEditor from "./ProjectEditor";
import ProjectNote from "./ProjectNote";

interface ProjectsTabProps {
  active: boolean;
  tasks: TodoistResult | null;
  docker: DockerResult | null;
  updates: DockerUpdateCheckResult | null;
  git: GitStatusResult | null;
  github: GitHubStatusResult | null;
  processes: ProcessConfig[];
  statuses: ProcessStatus[];
  showTimeTracking: boolean;
  refreshMinutes: number;
  onDockerRefresh: () => Promise<void>;
  onCheckUpdates: () => Promise<void>;
  onProcessRefresh: () => Promise<void>;
  onReposRefresh: () => Promise<void>;
  onTodoistRefresh: () => Promise<void>;
}

function ProjectCard({ project, visible, tasks, refreshTasks, onEdit, onSave, onRemove, onMove, first, last, ...props }: ProjectsTabProps & {
  project: Project; visible: boolean; tasks: TodoistResult | null; refreshTasks: () => Promise<void>;
  onEdit: () => void; onSave: (input: ProjectInput, id?: number) => Promise<void>;
  onRemove: () => Promise<void>; onMove: (delta: number) => Promise<void>; first: boolean; last: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [noteLoaded, setNoteLoaded] = useState(false);
  const [claude, setClaude] = useState<ClaudeSessionsResult | null>(null);
  const [codex, setCodex] = useState<CodexSessionsResult | null>(null);
  const [error, setError] = useState("");
  const [removing, setRemoving] = useState(false);
  const [busy, setBusy] = useState(false);
  const windowVisible = useWindowVisible();
  const detailed = props.active && visible && expanded;
  usePolling(async () => {
    const [c, x] = await Promise.all([window.api.claude.sessions(5, project.folder), window.api.codex.sessions(5, project.folder)]);
    setClaude(c); setCodex(x);
  }, props.refreshMinutes > 0 ? props.refreshMinutes * 60_000 : 2_147_483_647, detailed && windowVisible, 0, project.folder);
  const run = async (action: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true); setError("");
    try {
      const result = await action();
      if (result && typeof result === "object" && "ok" in result && !result.ok) setError(String("reason" in result ? result.reason : "Action failed."));
    } catch (e) { setError(String(e)); } finally { setBusy(false); }
  };
  const git = props.git?.repos.find(r => r.id === project.repoId);
  const github = props.github?.repos.find(r => project.githubUrl === `https://github.com/${r.owner}/${r.repo}`);
  const task = tasks?.tasks.find(t => t.id === project.todoistTaskId);
  const taskData = useMemo(() => tasks && task ? { ...tasks, tasks: [task] } : null, [tasks, task]);
  return <article className={`project-card ${expanded ? "expanded" : ""}`} hidden={!visible}>
    <header className="project-card-head"><h2>{project.name}</h2><span className="tag">{project.status}</span><div className="project-card-tools">
      <button disabled={busy} aria-label={`${project.pinned ? "Unpin" : "Pin"} ${project.name}`} onClick={() => void run(() => onSave({ ...project, pinned: !project.pinned }, project.id))}>{project.pinned ? "★" : "☆"}</button>
      <button disabled={first || busy} aria-label={`Move ${project.name} up`} onClick={() => void run(() => onMove(-1))}>↑</button><button disabled={last || busy} aria-label={`Move ${project.name} down`} onClick={() => void run(() => onMove(1))}>↓</button>
      <button onClick={onEdit}>Edit</button><button aria-expanded={expanded} onClick={() => { setExpanded(!expanded); setNoteLoaded(true); }}>{expanded ? "Collapse" : "Expand"}</button>
    </div></header>
    <div className="project-actions"><button disabled={busy} onClick={() => void run(() => window.api.cursor.open(project.folder))}>Cursor</button><button disabled={busy} onClick={() => void run(() => window.api.forklift.open(project.folder))}>Folder</button><button disabled={busy} onClick={() => void run(() => window.api.claude.launch(project.folder))}>Claude Code</button>
      {project.todoistTaskId && <button onClick={() => void run(() => window.api.openUrl(`https://app.todoist.com/app/task/${project.todoistTaskId}`))}>Todoist</button>}
      {project.githubUrl && <button onClick={() => void run(() => window.api.openUrl(project.githubUrl))}>GitHub</button>}
      {project.links.map((link, i) => <button key={i} onClick={() => void run(() => window.api.openUrl(link.url))}>{link.label}</button>)}
    </div><p className="project-path muted">{project.folder}</p>
    {error && <p role="alert" className="error">{error}</p>}
    <section className={expanded ? "project-section" : undefined}>
    {expanded && <h3 className="project-section-title">Code & Git</h3>}
    {git ? <GitRow repo={git} /> : <p className="muted">{props.git?.reason || (props.git ? "Git status unavailable. Check the folder or repository settings." : "Loading Git status…")}</p>}
    </section>
    {project.githubUrl && <section className={expanded ? "project-section" : undefined}>
      {expanded && <h3 className="project-section-title">GitHub</h3>}
      {github ? <RepoRow repo={github} /> : <p className="muted">{props.github?.reason || "GitHub status unavailable."}</p>}
      {detailed && github?.openPrs.map(pr => <PrRow key={pr.url} pr={pr} showRepo={false} />)}
    </section>}
    {!expanded && <div className="project-summary muted">{project.todoistTaskId && <span>{task?.content || (tasks?.ok ? "Task not active or unavailable" : "Task unavailable")}</span>}{project.containerNames.map(name => <span key={name}>{name}: {props.docker?.ok ? props.docker.containers.find(c => c.name === name)?.state || "unavailable" : "unavailable"}</span>)}{project.processIds.map(id => <span key={id}>{props.processes.find(p => p.id === id)?.label || id}: {props.statuses.find(s => s.id === id)?.running ? "running" : "stopped or unavailable"}</span>)}</div>}
    {detailed && <div className="project-details">
      {project.todoistTaskId && (tasks?.ok && task ? <TodoistWidget embedded data={taskData} onRefresh={refreshTasks} showTimeTracking={props.showTimeTracking} /> : <section className="project-section"><h3 className="project-section-title">Todoist</h3><p className="muted">{tasks?.ok ? "Linked task is not active or unavailable. Its Todoist link is preserved above." : tasks?.reason || "Loading task…"}</p></section>)}
      {project.containerNames.length > 0 && <section className="project-section"><h3 className="project-section-title">Services</h3>{!props.docker?.ok && <p className="muted">{props.docker?.reason || "Docker unavailable"}</p>}{project.containerNames.map(name => {
        const container = props.docker?.ok ? props.docker.containers.find(c => c.name === name) : undefined;
        return container ? <DockerRow key={name} container={container} updateStatus={props.updates?.images.find(i => i.image === container.image)} onRefresh={props.onDockerRefresh} onCheckUpdatesNow={props.onCheckUpdates} /> : <p className="muted" key={name}>{name}: unavailable</p>;
      })}<button onClick={() => void run(props.onCheckUpdates)}>Check image updates</button></section>}
      {project.processIds.length > 0 && <><ManagedProcessesWidget configs={props.processes.filter(p => project.processIds.includes(p.id))} statuses={props.statuses} onRefresh={props.onProcessRefresh} />{project.processIds.filter(id => !props.processes.some(p => p.id === id)).map(id => <p className="muted" key={id}>{id}: process unavailable</p>)}</>}
      <section className="project-section"><h3 className="project-section-title">Claude sessions</h3>{claude?.ok ? claude.sessions.length ? claude.sessions.map(s => <ClaudeSessionRow key={s.id} session={s} />) : <p className="muted">No sessions in this folder.</p> : <p className="muted">{claude?.reason || "Loading…"}</p>}</section>
      <section className="project-section"><h3 className="project-section-title">Codex sessions</h3>{codex?.ok ? codex.sessions.length ? codex.sessions.map(s => <CodexSessionRow key={s.id} session={s} />) : <p className="muted">No sessions in this folder.</p> : <p className="muted">{codex?.reason || "Loading…"}</p>}</section>
    </div>}
    {noteLoaded && project.note && <ProjectNote key={`${project.note.vaultLabel}/${project.note.filePath}`} note={project.note} visible={detailed} />}
    {detailed && <div className="project-actions project-management"><button className="project-action-archive" disabled={busy} onClick={() => void run(() => onSave({ ...project, status: project.status === "archived" ? "active" : "archived" }, project.id))}>{project.status === "archived" ? "Restore" : "Archive"}</button><button className="project-action-danger" onClick={() => setRemoving(true)}>Remove project</button>{removing && <><span>Remove this project’s associations?</span><button className="project-action-danger" disabled={busy} onClick={() => void run(onRemove)}>Remove</button><button onClick={() => setRemoving(false)}>Cancel</button></>}</div>}
  </article>;
}

export default function ProjectsTab(props: ProjectsTabProps) {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [search, setSearch] = useState("");
  const [archived, setArchived] = useState(false);
  const [editor, setEditor] = useState<Project | null | undefined>();
  const [error, setError] = useState("");
  const visible = useWindowVisible();
  useEffect(() => { window.api.projects.list().then(p => { setProjects(p); setLoaded(true); }).catch(e => setError(String(e))); }, []);
  usePolling(props.onTodoistRefresh, props.refreshMinutes > 0 ? props.refreshMinutes * 60_000 : 2_147_483_647, props.active && visible && projects.some(p => p.todoistTaskId), 0);
  const refreshTasks = props.onTodoistRefresh;
  const save = async (input: ProjectInput, id?: number) => {
    setProjects(await window.api.projects.save(input, id));
    await props.onReposRefresh();
  };
  const ordered = [...projects].sort((a, b) => Number(b.pinned) - Number(a.pinned) || a.sortOrder - b.sortOrder);
  const matches = (p: Project) => (archived ? p.status === "archived" : p.status !== "archived") && `${p.name} ${p.folder}`.toLowerCase().includes(search.toLowerCase());
  const shown = ordered.filter(matches);
  const move = async (p: Project, delta: number) => {
    const peers = shown.filter(item => item.pinned === p.pinned);
    const target = peers[peers.findIndex(item => item.id === p.id) + delta];
    if (!target) return;
    const ids = projects.map(item => item.id); const a = ids.indexOf(p.id), b = ids.indexOf(target.id);
    [ids[a], ids[b]] = [ids[b], ids[a]];
    setProjects(await window.api.projects.reorder(ids));
  };
  return <main className="projects-tab" hidden={!props.active}>
    <div className="projects-toolbar"><input aria-label="Search projects" placeholder="Search projects…" value={search} onChange={e => setSearch(e.target.value)} /><label className="project-check"><input type="checkbox" checked={archived} onChange={e => setArchived(e.target.checked)} />Archived</label><button onClick={() => setEditor(null)}>Add project</button></div>
    {error && <p role="alert" className="error">{error}</p>}{!loaded && !error && <p className="muted">Loading projects…</p>}{loaded && shown.length === 0 && <p className="muted">{projects.length ? "No matching projects." : "Add your first project to connect its code, tasks, services, and notes."}</p>}
    <div className="projects-grid">{ordered.map(project => {
      const peers = shown.filter(p => p.pinned === project.pinned);
      return <ProjectCard key={project.id} {...props} project={project} visible={matches(project)} tasks={props.tasks} refreshTasks={refreshTasks} onEdit={() => setEditor(project)} onSave={save} onRemove={async () => { setProjects(await window.api.projects.remove(project.id)); }} onMove={delta => move(project, delta)} first={peers[0]?.id === project.id} last={peers.at(-1)?.id === project.id} />;
    })}</div>
    {editor !== undefined && props.active && <ProjectEditor project={editor} docker={props.docker} processes={props.processes} onSave={save} onClose={() => setEditor(undefined)} />}
  </main>;
}
