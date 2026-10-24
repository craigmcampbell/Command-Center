// Slash commands for the Assistant: skills from disk and the user's own saved
// prompts, each switched on by hand and each with its own tool allowlist.
//
// Nothing here is on by default. The skills folder holds dozens of
// coding-workflow skills that need a shell the Assistant doesn't have, so a
// skill only becomes a command once the user enables it in Settings. Skills and
// prompts share one table, keyed by command name.
//
// `tools` is the allowlist: null means "the default" (every tool that only
// reads), and a list replaces it, so a mutating tool is only ever available to a
// command the user explicitly gave it to. The loop enforces it twice — the model
// is only shown the allowed tools, and a call to any other is refused.

import type {
  AssistantCommandInfo,
  AssistantCommandResult,
  AssistantCommandSetting,
} from "../../shared/types";
import { getDatabase } from "./db";
import { readSkillBody, scanSkills, SKILL_NAME, skillsDir } from "./assistantSkills";

export type CommandKind = "skill" | "prompt";

export interface CommandRow {
  name: string;
  kind: CommandKind;
  enabled: boolean;
  tools: string[] | null;
  description: string;
  prompt: string;
}

interface DbRow {
  name: string;
  kind: CommandKind;
  enabled: number;
  tools: string | null;
  description: string;
  prompt: string;
}

const MAX_PROMPT_CHARS = 8000;
const MAX_DESCRIPTION_CHARS = 200;

export function initAssistantCommands(): void {
  getDatabase().exec(`CREATE TABLE IF NOT EXISTS assistant_commands (
    name TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    enabled INTEGER NOT NULL DEFAULT 0,
    tools TEXT,
    description TEXT NOT NULL DEFAULT '',
    prompt TEXT NOT NULL DEFAULT ''
  )`);
}

function fromDb(row: DbRow): CommandRow {
  let tools: string[] | null = null;
  if (row.tools) {
    try {
      const parsed = JSON.parse(row.tools);
      if (Array.isArray(parsed)) tools = parsed.filter((t): t is string => typeof t === "string");
    } catch {
      // A corrupt allowlist reads as the default (read-only), the safe side.
    }
  }
  return { ...row, enabled: row.enabled === 1, tools };
}

export function getCommandRow(name: string): CommandRow | null {
  const row = getDatabase().prepare(`SELECT * FROM assistant_commands WHERE name = ?`).get(name) as
    | DbRow
    | undefined;
  return row ? fromDb(row) : null;
}

export function listCommandRows(): CommandRow[] {
  return (getDatabase().prepare(`SELECT * FROM assistant_commands ORDER BY name`).all() as DbRow[]).map(fromDb);
}

function saveRow(row: CommandRow): void {
  getDatabase()
    .prepare(
      `INSERT INTO assistant_commands (name, kind, enabled, tools, description, prompt)
       VALUES (@name, @kind, @enabled, @tools, @description, @prompt)
       ON CONFLICT(name) DO UPDATE SET
         kind = excluded.kind, enabled = excluded.enabled, tools = excluded.tools,
         description = excluded.description, prompt = excluded.prompt`
    )
    .run({
      ...row,
      enabled: row.enabled ? 1 : 0,
      tools: row.tools ? JSON.stringify([...new Set(row.tools)].slice(0, 100)) : null,
    });
}

export interface ResolvedCommand {
  name: string;
  kind: CommandKind;
  // What is put in front of the user's message for the model.
  injected: string;
  // null = the default allowlist (computed by the caller, which knows the tools).
  tools: string[] | null;
}

// The command a user typed, if it exists and is switched on. Skill instructions
// are read from disk now, so edits to a SKILL.md take effect on the next use.
export async function resolveCommand(name: string): Promise<ResolvedCommand | null> {
  const row = getCommandRow(name);
  if (!row || !row.enabled) return null;
  if (row.kind === "prompt") {
    return { name, kind: "prompt", tools: row.tools, injected: `<command name="${name}">\n${row.prompt}\n</command>` };
  }
  const skill = await readSkillBody(name);
  if (!skill.ok) return null;
  return {
    name,
    kind: "skill",
    tools: row.tools,
    injected:
      `<skill name="${name}">\nThe user invoked the "${name}" skill. Follow these instructions for their request. ` +
      "Files the instructions mention are in the skill's folder: read them with `read_skill_file`. " +
      "You can't run commands or edit files, so skip any step that needs that and say so.\n\n" +
      `${skill.body}${skill.truncated ? "\n\n[The rest of the skill was cut off.]" : ""}\n</skill>`,
  };
}

// For the composer's picker: enabled commands only.
export async function listEnabledCommands(): Promise<AssistantCommandInfo[]> {
  const rows = listCommandRows().filter((r) => r.enabled);
  const skills = new Set((await scanSkills()).map((s) => s.name));
  return rows
    .filter((r) => r.kind === "prompt" || skills.has(r.name))
    .map((r) => ({ name: r.name, description: r.description, kind: r.kind }));
}

// For Settings: every skill found on disk (enabled or not) and every prompt.
export async function getCommandSettings(): Promise<{
  skillsDir: string;
  skills: AssistantCommandSetting[];
  prompts: AssistantCommandSetting[];
}> {
  const rows = new Map(listCommandRows().map((r) => [r.name, r]));
  const skills = (await scanSkills())
    .filter((s) => rows.get(s.name)?.kind !== "prompt")
    .map((s) => ({
      name: s.name,
      description: s.description,
      enabled: rows.get(s.name)?.enabled ?? false,
      tools: rows.get(s.name)?.tools ?? null,
    }));
  const prompts = [...rows.values()]
    .filter((r) => r.kind === "prompt")
    .map((r) => ({ name: r.name, description: r.description, enabled: r.enabled, tools: r.tools, prompt: r.prompt }));
  return { skillsDir: skillsDir(), skills, prompts };
}

const cleanTools = (tools: unknown): string[] | null =>
  Array.isArray(tools) ? tools.filter((t): t is string => typeof t === "string" && /^\w+$/.test(t)) : null;

export async function setSkillSetting(
  name: string,
  values: { enabled: boolean; tools: string[] | null }
): Promise<AssistantCommandResult> {
  const skill = (await scanSkills()).find((s) => s.name === name);
  if (!skill) return { ok: false, reason: "That skill isn't in the skills folder" };
  if (getCommandRow(name)?.kind === "prompt") return { ok: false, reason: "A saved prompt already uses that name" };
  saveRow({
    name,
    kind: "skill",
    enabled: values.enabled === true,
    tools: cleanTools(values.tools),
    description: skill.description.slice(0, MAX_DESCRIPTION_CHARS),
    prompt: "",
  });
  return { ok: true };
}

export async function savePromptCommand(input: {
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  tools: string[] | null;
}): Promise<AssistantCommandResult> {
  const name = (input.name ?? "").trim().toLowerCase();
  if (!SKILL_NAME.test(name)) {
    return { ok: false, reason: "Names use letters, numbers, - and _ (no spaces), up to 64 characters" };
  }
  const prompt = (input.prompt ?? "").trim();
  if (!prompt) return { ok: false, reason: "Write the prompt this command should send" };
  if (prompt.length > MAX_PROMPT_CHARS) return { ok: false, reason: "That prompt is too long" };
  if (getCommandRow(name)?.kind === "skill" || (await scanSkills()).some((s) => s.name === name)) {
    return { ok: false, reason: "A skill already uses that name" };
  }
  saveRow({
    name,
    kind: "prompt",
    enabled: input.enabled === true,
    tools: cleanTools(input.tools),
    description: (input.description ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_CHARS),
    prompt,
  });
  return { ok: true };
}

export function removePromptCommand(name: string): AssistantCommandResult {
  const row = getCommandRow(name);
  if (!row || row.kind !== "prompt") return { ok: false, reason: "No such saved prompt" };
  getDatabase().prepare(`DELETE FROM assistant_commands WHERE name = ?`).run(name);
  return { ok: true };
}
