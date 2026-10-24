import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AssistantCommandConfig,
  AssistantCommandSetting,
  AssistantToolInfo,
} from "../../../shared/types";

// Settings → Assistant → commands. Skills found in the skills folder and saved
// prompts both become `/commands` in the Assistant, once switched on here. Each
// has a tool allowlist: unset means "everything that only reads", and a custom
// list is the only way a command can be given a tool that changes something.
// Saved per row-action, like the other list sections.

interface ToolsEditorProps {
  tools: AssistantToolInfo[];
  value: string[] | null;
  onChange: (tools: string[] | null) => void;
}

function ToolsEditor({ tools, value, onChange }: ToolsEditorProps) {
  const custom = value !== null;
  const chosen = new Set(value ?? []);
  return (
    <div className="assistant-tools-editor">
      <label className="settings-checkbox-label">
        <input
          type="radio"
          checked={!custom}
          onChange={() => onChange(null)}
        />
        Read-only tools (default)
      </label>
      <label className="settings-checkbox-label">
        <input
          type="radio"
          checked={custom}
          onChange={() => onChange(tools.filter((t) => !t.mutating).map((t) => t.name))}
        />
        Choose tools
      </label>
      {custom && (
        <div className="assistant-tools-grid">
          {tools.map((tool) => (
            <label key={tool.name} className="settings-checkbox-label">
              <input
                type="checkbox"
                checked={chosen.has(tool.name)}
                onChange={(e) => {
                  const next = new Set(chosen);
                  if (e.target.checked) next.add(tool.name);
                  else next.delete(tool.name);
                  onChange(tools.map((t) => t.name).filter((n) => next.has(n)));
                }}
              />
              <code>{tool.name}</code>
              {tool.mutating && <span className="assistant-tool-warn"> changes data</span>}
              {tool.external && <span className="assistant-tool-warn"> uses the internet</span>}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

interface PromptDraft {
  name: string;
  description: string;
  prompt: string;
  enabled: boolean;
  tools: string[] | null;
}

const EMPTY_DRAFT: PromptDraft = { name: "", description: "", prompt: "", enabled: true, tools: null };

export default function AssistantCommandsCard() {
  const [config, setConfig] = useState<AssistantCommandConfig | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [openTools, setOpenTools] = useState<string | null>(null);
  const [draft, setDraft] = useState<PromptDraft | null>(null);

  const load = useCallback(async () => {
    setConfig(await window.api.assistant.commands.config());
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function run(action: Promise<{ ok: boolean; reason?: string }>): Promise<boolean> {
    const result = await action;
    setError(result.ok ? null : (result.reason ?? "That didn't work"));
    await load();
    return result.ok;
  }

  const skills = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return (config?.skills ?? []).filter(
      (s) => !term || s.name.toLowerCase().includes(term) || s.description.toLowerCase().includes(term)
    );
  }, [config, filter]);

  if (!config) return null;

  const saveSkill = (skill: AssistantCommandSetting, patch: Partial<AssistantCommandSetting>) =>
    run(
      window.api.assistant.commands.setSkill(skill.name, {
        enabled: patch.enabled ?? skill.enabled,
        tools: patch.tools === undefined ? skill.tools : patch.tools,
      })
    );

  async function savePrompt() {
    if (!draft) return;
    if (await run(window.api.assistant.commands.savePrompt(draft))) setDraft(null);
  }

  return (
    <div className="settings-card">
      <h3>Assistant commands</h3>
      <p className="settings-card-hint">
        Type <code>/</code> in the Assistant to run a command. Skills come from{" "}
        <code>{config.skillsDir}</code> and stay off until you switch them on here. The Assistant
        has no shell or editor, so skills that depend on running code won't work well; ones that
        shape writing or research do. A command can only use the tools you allow it, and by
        default that is read-only tools (no web access, no memory writes), so a skill can never
        change your data or spend credits unless you say so.
      </p>
      {error && <p className="settings-error">{error}</p>}

      <h4>Skills</h4>
      {config.skills.length === 0 ? (
        <p className="muted">No skills found in that folder.</p>
      ) : (
        <>
          <input
            className="settings-input"
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter skills…"
            aria-label="Filter skills"
          />
          <ul className="assistant-command-list">
            {skills.map((skill) => (
              <li key={skill.name}>
                <div className="assistant-command-row">
                  <label className="settings-checkbox-label">
                    <input
                      type="checkbox"
                      checked={skill.enabled}
                      onChange={(e) => void saveSkill(skill, { enabled: e.target.checked })}
                    />
                    <strong>/{skill.name}</strong>
                  </label>
                  {skill.enabled && (
                    <button
                      type="button"
                      className="assistant-link"
                      onClick={() => setOpenTools(openTools === skill.name ? null : skill.name)}
                      aria-expanded={openTools === skill.name}
                    >
                      Tools: {skill.tools === null ? "read-only" : `${skill.tools.length} chosen`}
                    </button>
                  )}
                </div>
                {skill.description && <p className="muted assistant-command-desc">{skill.description}</p>}
                {skill.enabled && openTools === skill.name && (
                  <ToolsEditor
                    tools={config.tools}
                    value={skill.tools}
                    onChange={(tools) => void saveSkill(skill, { tools })}
                  />
                )}
              </li>
            ))}
          </ul>
        </>
      )}

      <h4>Saved prompts</h4>
      <ul className="assistant-command-list">
        {config.prompts.map((p) => (
          <li key={p.name}>
            <div className="assistant-command-row">
              <label className="settings-checkbox-label">
                <input
                  type="checkbox"
                  checked={p.enabled}
                  onChange={(e) =>
                    void run(
                      window.api.assistant.commands.savePrompt({
                        name: p.name,
                        description: p.description,
                        prompt: p.prompt ?? "",
                        enabled: e.target.checked,
                        tools: p.tools,
                      })
                    )
                  }
                />
                <strong>/{p.name}</strong>
              </label>
              <span>
                <button
                  type="button"
                  className="assistant-link"
                  onClick={() =>
                    setDraft({
                      name: p.name,
                      description: p.description,
                      prompt: p.prompt ?? "",
                      enabled: p.enabled,
                      tools: p.tools,
                    })
                  }
                >
                  Edit
                </button>{" "}
                <button
                  type="button"
                  className="assistant-link"
                  onClick={() => void run(window.api.assistant.commands.removePrompt(p.name))}
                >
                  Delete
                </button>
              </span>
            </div>
            {p.description && <p className="muted assistant-command-desc">{p.description}</p>}
          </li>
        ))}
      </ul>

      {draft ? (
        <div className="assistant-prompt-form">
          <div className="settings-field-row">
            <label>Name</label>
            <input
              className="settings-input"
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              placeholder="plan-day"
              spellCheck={false}
            />
          </div>
          <div className="settings-field-row">
            <label>Description</label>
            <input
              className="settings-input"
              value={draft.description}
              onChange={(e) => setDraft({ ...draft, description: e.target.value })}
              placeholder="Shown in the / picker"
            />
          </div>
          <div className="settings-field-row settings-field-row-top">
            <label>Prompt</label>
            <textarea
              className="settings-input settings-textarea"
              value={draft.prompt}
              onChange={(e) => setDraft({ ...draft, prompt: e.target.value })}
              placeholder="What the Assistant should do. Anything typed after the command is added below it."
              rows={5}
            />
          </div>
          <ToolsEditor tools={config.tools} value={draft.tools} onChange={(tools) => setDraft({ ...draft, tools })} />
          <div className="assistant-approval-actions">
            <button type="button" onClick={() => void savePrompt()}>
              Save prompt
            </button>
            <button type="button" className="assistant-approval-deny" onClick={() => setDraft(null)}>
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setDraft(EMPTY_DRAFT)}>
          Add a prompt
        </button>
      )}
    </div>
  );
}
