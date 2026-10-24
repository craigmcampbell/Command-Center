import { useCallback, useEffect, useState } from "react";
import type { McpServerConfig, McpServerInput, McpServerStatus } from "../../../shared/types";
import { IconEye, IconEyeOff } from "./icons";

// Settings → Assistant → MCP servers. Each row is a server the Assistant can
// call tools on; main connects to it on first use (or on Connect here) and
// reports back. Saved per row-action, like the other list sections. The
// renderer only edits this list and reads a status: it never talks to a server.

interface Draft {
  id: number | null;
  label: string;
  transport: "stdio" | "http";
  command: string;
  // One argument per line, so arguments with spaces need no quoting rules.
  args: string;
  // KEY=value, one per line.
  env: string;
  url: string;
  bearerToken: string;
  enabled: boolean;
  trustReadOnly: boolean;
}

const EMPTY_DRAFT: Draft = {
  id: null,
  label: "",
  transport: "stdio",
  command: "",
  args: "",
  env: "",
  url: "",
  bearerToken: "",
  enabled: true,
  trustReadOnly: false,
};

function toDraft(server: McpServerConfig): Draft {
  return {
    id: server.id,
    label: server.label,
    transport: server.transport,
    command: server.command ?? "",
    args: (server.args ?? []).join("\n"),
    env: Object.entries(server.env ?? {})
      .map(([k, v]) => `${k}=${v}`)
      .join("\n"),
    url: server.url ?? "",
    bearerToken: server.bearerToken ?? "",
    enabled: server.enabled,
    trustReadOnly: server.trustReadOnly,
  };
}

function toInput(draft: Draft): McpServerInput {
  const env: Record<string, string> = {};
  for (const line of draft.env.split("\n")) {
    const eq = line.indexOf("=");
    if (eq > 0) env[line.slice(0, eq).trim()] = line.slice(eq + 1);
  }
  return {
    label: draft.label.trim(),
    transport: draft.transport,
    command: draft.command.trim() || undefined,
    args: draft.args.split("\n").map((a) => a.trim()).filter(Boolean),
    env,
    url: draft.url.trim() || undefined,
    bearerToken: draft.bearerToken.trim() || undefined,
    enabled: draft.enabled,
    trustReadOnly: draft.trustReadOnly,
  };
}

function toInputFrom(server: McpServerConfig, patch: Partial<McpServerInput>): McpServerInput {
  const { id: _id, sortOrder: _order, ...rest } = server;
  return { ...rest, ...patch };
}

const STATE_LABEL: Record<McpServerStatus["state"], string> = {
  disabled: "Off",
  idle: "Not connected yet",
  connecting: "Connecting…",
  connected: "Connected",
  failed: "Failed",
};

function TokenField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="settings-secret-field">
      <input
        className="settings-input"
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Optional"
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

export default function AssistantMcpCard() {
  const [servers, setServers] = useState<McpServerConfig[] | null>(null);
  const [status, setStatus] = useState<McpServerStatus[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [connecting, setConnecting] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [list, current] = await Promise.all([
      window.api.settings.mcpServers.list(),
      window.api.assistant.mcp.status(),
    ]);
    setServers(list);
    setStatus(current);
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function connect(id: number) {
    setConnecting(id);
    try {
      setStatus(await window.api.assistant.mcp.connect(id));
    } finally {
      setConnecting(null);
    }
  }

  async function save() {
    if (!draft) return;
    const input = toInput(draft);
    if (!input.label) return setError("Give the server a name");
    if (input.transport === "stdio" && !input.command) return setError("A stdio server needs a command");
    if (input.transport === "http" && !/^https?:\/\//i.test(input.url ?? "")) {
      return setError("An HTTP server needs an http(s) URL");
    }
    setError(null);
    const list =
      draft.id === null
        ? await window.api.settings.mcpServers.add(input)
        : await window.api.settings.mcpServers.update(draft.id, input);
    setServers(list);
    setDraft(null);
    // Connect straight away so a typo shows up here, not mid-chat.
    const saved = draft.id ?? list[list.length - 1]?.id;
    if (saved !== undefined && input.enabled) await connect(saved);
    else setStatus(await window.api.assistant.mcp.status());
  }

  async function patch(server: McpServerConfig, values: Partial<McpServerInput>) {
    setServers(await window.api.settings.mcpServers.update(server.id, toInputFrom(server, values)));
    setStatus(await window.api.assistant.mcp.status());
  }

  async function remove(id: number) {
    setServers(await window.api.settings.mcpServers.remove(id));
    setStatus(await window.api.assistant.mcp.status());
  }

  if (!servers) return null;

  return (
    <div className="settings-card">
      <h3>MCP servers</h3>
      <p className="settings-card-hint">
        Tools from Model Context Protocol servers, offered to the Assistant alongside its own. A
        local server is a command this app starts (for example <code>npx -y some-mcp-server</code>
        ); a remote one is a Streamable HTTP URL. Every call asks you first and shows the exact
        arguments, unless the server marks a tool read-only <em>and</em> you trust that server's
        read-only tools below. Anything a server returns is treated as untrusted. Tokens and
        environment values are stored in plaintext, like the other tokens in Settings.
      </p>
      {error && <p className="settings-error">{error}</p>}

      {servers.length === 0 ? (
        <p className="muted">No MCP servers configured.</p>
      ) : (
        <ul className="assistant-command-list">
          {servers.map((server) => {
            const s = status.find((x) => x.id === server.id);
            return (
              <li key={server.id}>
                <div className="assistant-command-row">
                  <label className="settings-checkbox-label">
                    <input
                      type="checkbox"
                      checked={server.enabled}
                      onChange={(e) => void patch(server, { enabled: e.target.checked })}
                    />
                    <strong>{server.label}</strong>
                    <span className="muted">
                      {" "}
                      {server.transport === "http" ? server.url : [server.command, ...(server.args ?? [])].join(" ")}
                    </span>
                  </label>
                  <span>
                    {server.enabled && (
                      <button
                        type="button"
                        className="assistant-link"
                        disabled={connecting === server.id}
                        onClick={() => void connect(server.id)}
                      >
                        {connecting === server.id ? "Connecting…" : s?.state === "connected" ? "Reconnect" : "Connect"}
                      </button>
                    )}{" "}
                    <button type="button" className="assistant-link" onClick={() => setDraft(toDraft(server))}>
                      Edit
                    </button>{" "}
                    <button type="button" className="assistant-link" onClick={() => void remove(server.id)}>
                      Delete
                    </button>
                  </span>
                </div>
                <p className="muted assistant-command-desc">
                  {connecting === server.id ? "Connecting…" : STATE_LABEL[s?.state ?? "idle"]}
                  {s?.state === "connected" && ` · ${s.tools.length} tool${s.tools.length === 1 ? "" : "s"}`}
                </p>
                {s?.state === "failed" && s.reason && <p className="settings-error">{s.reason}</p>}
                <label className="settings-checkbox-label">
                  <input
                    type="checkbox"
                    checked={server.trustReadOnly}
                    onChange={(e) => void patch(server, { trustReadOnly: e.target.checked })}
                  />
                  Trust read-only tools (run tools this server marks read-only without asking)
                </label>
                {s?.state === "connected" && s.tools.length > 0 && (
                  <ul className="assistant-mcp-tools">
                    {s.tools.map((tool) => (
                      <li key={tool.name} title={tool.description}>
                        <code>{tool.tool}</code>
                        <span className="assistant-tool-warn">
                          {" "}
                          {tool.autoRun ? "runs without asking" : tool.readOnly ? "read-only, asks first" : "asks first"}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {draft ? (
        <div className="assistant-prompt-form">
          <div className="settings-field-row">
            <label>Name</label>
            <input
              className="settings-input"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="todoist"
              spellCheck={false}
            />
          </div>
          <div className="settings-field-row">
            <label>Transport</label>
            <span>
              <label className="settings-checkbox-label">
                <input
                  type="radio"
                  checked={draft.transport === "stdio"}
                  onChange={() => setDraft({ ...draft, transport: "stdio" })}
                />
                Local command (stdio)
              </label>
              <label className="settings-checkbox-label">
                <input
                  type="radio"
                  checked={draft.transport === "http"}
                  onChange={() => setDraft({ ...draft, transport: "http" })}
                />
                Remote URL (Streamable HTTP)
              </label>
            </span>
          </div>
          {draft.transport === "stdio" ? (
            <>
              <div className="settings-field-row">
                <label>Command</label>
                <input
                  className="settings-input"
                  value={draft.command}
                  onChange={(e) => setDraft({ ...draft, command: e.target.value })}
                  placeholder="npx"
                  spellCheck={false}
                />
              </div>
              <div className="settings-field-row settings-field-row-top">
                <label>Arguments</label>
                <textarea
                  className="settings-input settings-textarea"
                  value={draft.args}
                  onChange={(e) => setDraft({ ...draft, args: e.target.value })}
                  placeholder={"One per line, e.g.\n-y\n@modelcontextprotocol/server-everything"}
                  rows={3}
                  spellCheck={false}
                />
              </div>
              <div className="settings-field-row settings-field-row-top">
                <label>Environment</label>
                <textarea
                  className="settings-input settings-textarea"
                  value={draft.env}
                  onChange={(e) => setDraft({ ...draft, env: e.target.value })}
                  placeholder="KEY=value, one per line"
                  rows={2}
                  spellCheck={false}
                />
              </div>
            </>
          ) : (
            <>
              <div className="settings-field-row">
                <label>URL</label>
                <input
                  className="settings-input"
                  value={draft.url}
                  onChange={(e) => setDraft({ ...draft, url: e.target.value })}
                  placeholder="https://example.com/mcp"
                  spellCheck={false}
                />
              </div>
              <div className="settings-field-row">
                <label>Bearer token</label>
                <TokenField value={draft.bearerToken} onChange={(v) => setDraft({ ...draft, bearerToken: v })} />
              </div>
            </>
          )}
          <label className="settings-checkbox-label">
            <input
              type="checkbox"
              checked={draft.trustReadOnly}
              onChange={(e) => setDraft({ ...draft, trustReadOnly: e.target.checked })}
            />
            Trust read-only tools
          </label>
          <div className="assistant-approval-actions">
            <button type="button" className="assistant-approval-allow" onClick={() => void save()}>
              Save server
            </button>
            <button
              type="button"
              className="assistant-approval-deny"
              onClick={() => {
                setDraft(null);
                setError(null);
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={() => setDraft(EMPTY_DRAFT)}>
          Add a server
        </button>
      )}
    </div>
  );
}
