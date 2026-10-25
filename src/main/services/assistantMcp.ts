// MCP client for the Assistant: connects to the servers configured in Settings
// → Assistant → MCP servers, lists their tools, and calls them. Uses the
// official SDK (`@modelcontextprotocol/sdk`) for both transports the spec
// defines: stdio (a spawned child process) and Streamable HTTP.
//
// This file only connects, names and calls. Whether a call needs the user's
// OK, and what the card says, is decided in assistantTools.ts like every other
// tool. Decisions worth not "simplifying":
//
//  1. Connections are lazy. Nothing is spawned at boot; the first turn (or the
//     Settings "Connect" button) connects, and later turns reuse it. A config
//     edit is noticed by fingerprint and reconnects; a removed or disabled
//     server is closed.
//  2. Failure is soft and remembered. A server that won't start or list has no
//     tools, Settings shows why (including the tail of its stderr), and it is
//     not retried for RETRY_AFTER_MS, so a broken command isn't respawned on
//     every message.
//  3. Names are namespaced and sanitized: `mcp__<server>__<tool>`, only
//     [A-Za-z0-9_], at most 64 characters (the strictest provider limit), and
//     de-duplicated. Nothing a built-in tool is called can start with `mcp__`.
//  4. Everything a server sends is untrusted: tool descriptions, its
//     `readOnlyHint`, and results. Results are flattened to text and capped;
//     the hint only ever skips a card when the user has ALSO trusted that
//     server's read-only tools.

import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { getDefaultEnvironment, StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { isMcpToolName, MCP_TOOL_PREFIX } from "../../shared/assistant";
import type { McpServerConfig, McpServerStatus } from "../../shared/types";
import { listMcpServerSettings } from "./settings";

export { isMcpToolName };
const NAME_MAX = 64;
const SERVER_SLUG_MAX = 20;
const CONNECT_TIMEOUT_MS = 30_000;
const LIST_TIMEOUT_MS = 15_000;
const CALL_TIMEOUT_MS = 120_000;
const RETRY_AFTER_MS = 60_000;
const MAX_TOOLS_PER_SERVER = 64;
const MAX_LIST_PAGES = 5;
const MAX_DESCRIPTION_CHARS = 1000;
const MAX_SCHEMA_CHARS = 20_000;
const STDERR_TAIL_CHARS = 2000;
export const MAX_MCP_RESULT_CHARS = 12_000;

export interface McpTool {
  // Namespaced, what the model calls.
  name: string;
  serverId: number;
  serverLabel: string;
  // The server's own name, what is sent back to it.
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
  // The server's `readOnlyHint`. A claim, not a guarantee.
  readOnly: boolean;
}

interface RawTool {
  tool: string;
  description: string;
  inputSchema: Record<string, unknown>;
  readOnly: boolean;
}

interface Connection {
  fingerprint: string;
  state: "connecting" | "connected" | "failed";
  reason?: string;
  failedAt?: number;
  client?: Client;
  tools: RawTool[];
  stderr: string;
  // Settles (never rejects) once connecting has succeeded or failed.
  ready: Promise<void>;
}

const connections = new Map<number, Connection>();
// The last catalogue built, by namespaced name. Read by prepareTool and the
// regenerate check, which run after a turn has listed tools.
let catalogue = new Map<string, McpTool>();

// ---- naming ----------------------------------------------------------------

function slug(text: string, fallback: string): string {
  const cleaned = text.replace(/[^A-Za-z0-9_]+/g, "_").replace(/_+/g, "_").replace(/^_|_$/g, "");
  return cleaned || fallback;
}

// `mcp__<server>__<tool>` within the provider's character set and length,
// unique among `taken` (which it adds to).
export function mcpToolName(serverLabel: string, tool: string, taken: Set<string>): string {
  const base = `${MCP_TOOL_PREFIX}${slug(serverLabel, "server").slice(0, SERVER_SLUG_MAX).replace(/_$/, "")}__${slug(tool, "tool")}`.slice(
    0,
    NAME_MAX
  );
  let name = base;
  for (let n = 2; taken.has(name); n++) {
    const suffix = `_${n}`;
    name = base.slice(0, NAME_MAX - suffix.length) + suffix;
  }
  taken.add(name);
  return name;
}

// ---- connecting ------------------------------------------------------------

// What a connection depends on; a label or trust change doesn't need a reconnect.
function fingerprint(server: McpServerConfig): string {
  return JSON.stringify(
    server.transport === "http"
      ? ["http", server.url ?? "", server.bearerToken ?? ""]
      : ["stdio", server.command ?? "", server.args ?? [], server.env ?? {}]
  );
}

// A GUI-launched app gets launchd's bare PATH, so `npx`/`uvx` from Homebrew or
// ~/.local/bin wouldn't be found (the same problem docker.ts works around).
// A PATH in the server's own env replaces this.
function widenedPath(base: string | undefined): string {
  return [
    "/opt/homebrew/bin",
    "/usr/local/bin",
    path.join(os.homedir(), ".local", "bin"),
    ...(base ? [base] : []),
  ].join(":");
}

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.replace(/\s+/g, " ").trim().slice(0, 300) || "unknown error";
}

function failureReason(error: unknown, stderr: string): string {
  const tail = stderr.trim().split("\n").slice(-3).join(" ").replace(/\s+/g, " ").slice(-300);
  return tail ? `${errorText(error)} (stderr: ${tail})` : errorText(error);
}

function makeTransport(server: McpServerConfig, conn: Connection) {
  if (server.transport === "http") {
    const raw = server.url?.trim();
    if (!raw) throw new Error("No URL configured");
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      throw new Error("The URL isn't valid");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("The URL must be http or https");
    const token = server.bearerToken?.trim();
    return new StreamableHTTPClientTransport(url, {
      ...(token ? { requestInit: { headers: { Authorization: `Bearer ${token}` } } } : {}),
    });
  }
  const command = server.command?.trim();
  if (!command) throw new Error("No command configured");
  const defaults = getDefaultEnvironment();
  const transport = new StdioClientTransport({
    command,
    args: server.args ?? [],
    // Only the SDK's safe defaults (HOME, PATH, USER…) plus what the user set,
    // never this app's whole environment.
    env: { ...defaults, PATH: widenedPath(defaults.PATH), ...(server.env ?? {}) },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk: Buffer | string) => {
    conn.stderr = (conn.stderr + chunk.toString()).slice(-STDERR_TAIL_CHARS);
  });
  return transport;
}

function toRawTool(tool: {
  name: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: { readOnlyHint?: boolean };
}): RawTool {
  let schema: Record<string, unknown> =
    tool.inputSchema && typeof tool.inputSchema === "object" && !Array.isArray(tool.inputSchema)
      ? { ...(tool.inputSchema as Record<string, unknown>) }
      : {};
  delete schema.$schema;
  if (schema.type !== "object" || JSON.stringify(schema).length > MAX_SCHEMA_CHARS) {
    schema = { type: "object", properties: {} };
  }
  return {
    tool: tool.name,
    description: (tool.description ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_DESCRIPTION_CHARS),
    inputSchema: schema,
    readOnly: tool.annotations?.readOnlyHint === true,
  };
}

async function openConnection(server: McpServerConfig, conn: Connection): Promise<void> {
  const client = new Client({ name: "command-center", version: "1.0.0" });
  conn.client = client;
  client.onclose = () => {
    // The server exited or the session ended: forget it so the next use reconnects.
    if (connections.get(server.id) === conn && conn.state === "connected") connections.delete(server.id);
  };
  client.onerror = (error) => console.warn(`MCP server "${server.label}": ${errorText(error)}`);
  await client.connect(makeTransport(server, conn), { timeout: CONNECT_TIMEOUT_MS });
  const tools: RawTool[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_LIST_PAGES && tools.length < MAX_TOOLS_PER_SERVER; page++) {
    const result = await client.listTools(cursor ? { cursor } : undefined, { timeout: LIST_TIMEOUT_MS });
    for (const tool of result.tools ?? []) {
      if (typeof tool?.name === "string" && tool.name) tools.push(toRawTool(tool));
    }
    cursor = result.nextCursor;
    if (!cursor) break;
  }
  conn.tools = tools.slice(0, MAX_TOOLS_PER_SERVER);
}

function closeConnection(conn: Connection): Promise<void> {
  const client = conn.client;
  conn.client = undefined;
  return client ? client.close().catch(() => {}) : Promise.resolve();
}

function ensureConnection(server: McpServerConfig, force = false): Promise<Connection> {
  const fp = fingerprint(server);
  const existing = connections.get(server.id);
  if (existing) {
    const stale = existing.fingerprint !== fp;
    const retry =
      existing.state === "failed" && (force || Date.now() - (existing.failedAt ?? 0) > RETRY_AFTER_MS);
    const reconnect = force && existing.state === "connected";
    if (!stale && !retry && !reconnect) return existing.ready.then(() => existing);
    connections.delete(server.id);
    void closeConnection(existing);
  }
  const conn: Connection = { fingerprint: fp, state: "connecting", tools: [], stderr: "", ready: Promise.resolve() };
  conn.ready = (async () => {
    try {
      await openConnection(server, conn);
      conn.state = "connected";
      // Replaced (config edited, server removed) while connecting.
      if (connections.get(server.id) !== conn) await closeConnection(conn);
    } catch (error) {
      conn.state = "failed";
      conn.reason = failureReason(error, conn.stderr);
      conn.failedAt = Date.now();
      conn.tools = [];
      await closeConnection(conn);
    }
  })();
  connections.set(server.id, conn);
  return conn.ready.then(() => conn);
}

function readServers(): McpServerConfig[] {
  try {
    return listMcpServerSettings();
  } catch {
    return [];
  }
}

// Closes connections whose server was removed or disabled.
function prune(servers: McpServerConfig[]): void {
  const wanted = new Set(servers.filter((s) => s.enabled).map((s) => s.id));
  for (const [id, conn] of connections) {
    if (!wanted.has(id)) {
      connections.delete(id);
      void closeConnection(conn);
    }
  }
}

function rebuildCatalogue(servers: McpServerConfig[]): void {
  const next = new Map<string, McpTool>();
  const taken = new Set<string>();
  for (const server of servers) {
    if (!server.enabled) continue;
    const conn = connections.get(server.id);
    if (conn?.state !== "connected") continue;
    for (const raw of conn.tools) {
      const name = mcpToolName(server.label, raw.tool, taken);
      next.set(name, { name, serverId: server.id, serverLabel: server.label, ...raw });
    }
  }
  catalogue = next;
}

// Every tool of every enabled server, connecting as needed. Never throws: a
// server that fails just contributes nothing.
export async function listMcpTools(): Promise<McpTool[]> {
  const servers = readServers();
  prune(servers);
  const enabled = servers.filter((s) => s.enabled);
  if (enabled.length > 0) await Promise.all(enabled.map((s) => ensureConnection(s)));
  rebuildCatalogue(servers);
  return [...catalogue.values()];
}

// From the last listing; no connecting.
export function getMcpTool(name: string): McpTool | undefined {
  return catalogue.get(name);
}

export function cachedMcpTools(): McpTool[] {
  return [...catalogue.values()];
}

// The server's current settings, or null when it is gone or switched off.
export function mcpServerFor(tool: McpTool): McpServerConfig | null {
  return readServers().find((s) => s.id === tool.serverId && s.enabled) ?? null;
}

// ---- calling ---------------------------------------------------------------

interface ContentPart {
  type?: string;
  text?: string;
  uri?: string;
  name?: string;
  resource?: { uri?: string; text?: string };
}

// Flattens a CallToolResult to text for the model. Images and audio are not
// passed on (the model is told one was left out); text is capped.
export function formatMcpResult(result: unknown): { text: string; isError: boolean; truncated: boolean } {
  const r = (result ?? {}) as {
    content?: ContentPart[];
    structuredContent?: unknown;
    toolResult?: unknown;
    isError?: boolean;
  };
  const parts: string[] = [];
  for (const part of Array.isArray(r.content) ? r.content : []) {
    if (part?.type === "text" && typeof part.text === "string") parts.push(part.text);
    else if (part?.type === "image" || part?.type === "audio") parts.push(`[${part.type} left out]`);
    else if (part?.type === "resource") {
      parts.push(typeof part.resource?.text === "string" ? part.resource.text : `[resource ${part.resource?.uri ?? ""}]`);
    } else if (part?.type === "resource_link") parts.push(`[link ${part.name ?? ""}: ${part.uri ?? ""}]`);
  }
  if (parts.length === 0 && r.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  if (parts.length === 0 && r.toolResult !== undefined) parts.push(JSON.stringify(r.toolResult));
  const text = parts.join("\n\n");
  const truncated = text.length > MAX_MCP_RESULT_CHARS;
  return {
    text: truncated ? text.slice(0, MAX_MCP_RESULT_CHARS) : text,
    isError: r.isError === true,
    truncated,
  };
}

export async function callMcpTool(
  tool: McpTool,
  args: Record<string, unknown>,
  signal?: AbortSignal
): Promise<{ ok: true; text: string; isError: boolean; truncated: boolean } | { ok: false; reason: string }> {
  const server = mcpServerFor(tool);
  if (!server) return { ok: false, reason: `The MCP server "${tool.serverLabel}" is no longer enabled` };
  const conn = await ensureConnection(server);
  if (conn.state !== "connected" || !conn.client) {
    return { ok: false, reason: `The MCP server "${tool.serverLabel}" isn't available: ${conn.reason ?? "not connected"}` };
  }
  try {
    const result = await conn.client.callTool({ name: tool.tool, arguments: args }, undefined, {
      signal,
      timeout: CALL_TIMEOUT_MS,
    });
    return { ok: true, ...formatMcpResult(result) };
  } catch (error) {
    if (signal?.aborted) return { ok: false, reason: "Stopped" };
    return { ok: false, reason: `The MCP call failed: ${errorText(error)}` };
  }
}

// ---- Settings --------------------------------------------------------------

export function getMcpStatus(): McpServerStatus[] {
  const servers = readServers();
  const byServer = new Map<number, McpTool[]>();
  for (const tool of catalogue.values()) {
    byServer.set(tool.serverId, [...(byServer.get(tool.serverId) ?? []), tool]);
  }
  return servers.map((server) => {
    const conn = connections.get(server.id);
    const state: McpServerStatus["state"] = !server.enabled ? "disabled" : (conn?.state ?? "idle");
    return {
      id: server.id,
      label: server.label,
      state,
      ...(state === "failed" && conn?.reason ? { reason: conn.reason } : {}),
      tools:
        state === "connected"
          ? (byServer.get(server.id) ?? []).map((t) => ({
              name: t.name,
              tool: t.tool,
              ...(t.description ? { description: t.description } : {}),
              readOnly: t.readOnly,
              autoRun: t.readOnly && server.trustReadOnly,
            }))
          : [],
    };
  });
}

// The Settings "Connect" button: (re)connects one server now, past any backoff.
export async function connectMcpServer(id: number): Promise<McpServerStatus[]> {
  const servers = readServers();
  prune(servers);
  const server = servers.find((s) => s.id === id && s.enabled);
  if (server) await ensureConnection(server, true);
  rebuildCatalogue(servers);
  return getMcpStatus();
}

// On quit, like processes.ts's stopAll: closing a stdio client ends the child
// (stdin closed, then SIGTERM, then SIGKILL — the SDK does the escalation).
export async function closeAllMcp(): Promise<void> {
  const all = [...connections.values()];
  connections.clear();
  catalogue = new Map();
  await Promise.race([
    Promise.all(all.map(closeConnection)),
    new Promise((resolve) => setTimeout(resolve, 4000)),
  ]);
}
