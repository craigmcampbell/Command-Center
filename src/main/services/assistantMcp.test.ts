import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// A stand-in for the SDK: each "server" is keyed by its stdio command (or HTTP
// URL), so a test configures what connecting to it does and which tools it has.
const sdk = vi.hoisted(() => ({
  servers: new Map<
    string,
    {
      fail?: string;
      tools: { name: string; description?: string; inputSchema?: unknown; annotations?: { readOnlyHint?: boolean } }[];
      result?: unknown;
    }
  >(),
  connects: [] as string[],
  closes: [] as string[],
  calls: [] as { server: string; name: string; arguments: unknown }[],
  transports: [] as any[],
}));

vi.mock("@modelcontextprotocol/sdk/client/stdio.js", () => ({
  getDefaultEnvironment: () => ({ PATH: "/usr/bin", HOME: "/home/me" }),
  StdioClientTransport: class {
    key: string;
    stderr = null;
    constructor(public params: any) {
      this.key = params.command;
      sdk.transports.push(this);
    }
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    key: string;
    constructor(public url: URL, public opts: any) {
      this.key = url.href;
      sdk.transports.push(this);
    }
  },
}));
vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    key = "";
    onclose?: () => void;
    onerror?: (e: unknown) => void;
    async connect(transport: { key: string }) {
      this.key = transport.key;
      sdk.connects.push(transport.key);
      const server = sdk.servers.get(transport.key);
      if (!server || server.fail) throw new Error(server?.fail ?? "spawn ENOENT");
    }
    async listTools() {
      return { tools: sdk.servers.get(this.key)?.tools ?? [] };
    }
    async callTool(params: { name: string; arguments: unknown }) {
      sdk.calls.push({ server: this.key, ...params });
      return sdk.servers.get(this.key)?.result ?? { content: [{ type: "text", text: "ok" }] };
    }
    async close() {
      sdk.closes.push(this.key);
    }
  },
}));

const config = vi.hoisted(() => ({ servers: [] as any[] }));
vi.mock("./settings", () => ({ listMcpServerSettings: () => config.servers }));

import {
  callMcpTool,
  closeAllMcp,
  connectMcpServer,
  formatMcpResult,
  getMcpStatus,
  listMcpTools,
  MAX_MCP_RESULT_CHARS,
  mcpToolName,
} from "./assistantMcp";

const stdio = (id: number, label: string, command: string, extra: object = {}) => ({
  id,
  label,
  transport: "stdio",
  command,
  args: [],
  env: {},
  enabled: true,
  trustReadOnly: false,
  sortOrder: id,
  ...extra,
});

beforeEach(() => {
  sdk.servers.clear();
  sdk.connects = [];
  sdk.closes = [];
  sdk.calls = [];
  sdk.transports = [];
  config.servers = [];
});
afterEach(async () => {
  await closeAllMcp();
  vi.useRealTimers();
});

describe("tool names", () => {
  it("namespaces, sanitizes and bounds them for providers", () => {
    const taken = new Set<string>();
    expect(mcpToolName("My Todoist!", "find-tasks", taken)).toBe("mcp__My_Todoist__find_tasks");
    const long = mcpToolName("a-really-long-server-label-indeed", "x".repeat(100), taken);
    expect(long.length).toBeLessThanOrEqual(64);
    expect(long).toMatch(/^mcp__[A-Za-z0-9_]+$/);
    expect(mcpToolName("", "", taken)).toBe("mcp__server__tool");
  });

  it("never hands out the same name twice", () => {
    const taken = new Set<string>();
    const a = mcpToolName("srv", "a.b", taken);
    const b = mcpToolName("srv", "a-b", taken);
    expect(a).toBe("mcp__srv__a_b");
    expect(b).toBe("mcp__srv__a_b_2");
  });
});

describe("listing", () => {
  it("connects lazily and lists every enabled server's tools", async () => {
    sdk.servers.set("todo", {
      tools: [
        { name: "find-tasks", description: "Find tasks", inputSchema: { type: "object", $schema: "x" }, annotations: { readOnlyHint: true } },
        { name: "add-task", inputSchema: { type: "object", properties: { title: { type: "string" } } } },
      ],
    });
    config.servers = [stdio(1, "todo", "todo"), stdio(2, "off", "off", { enabled: false })];
    expect(sdk.connects).toEqual([]);

    const tools = await listMcpTools();
    expect(sdk.connects).toEqual(["todo"]);
    expect(tools.map((t) => [t.name, t.tool, t.readOnly])).toEqual([
      ["mcp__todo__find_tasks", "find-tasks", true],
      ["mcp__todo__add_task", "add-task", false],
    ]);
    // `$schema` is dropped; providers don't want it.
    expect(tools[0].inputSchema).toEqual({ type: "object" });

    await listMcpTools();
    expect(sdk.connects).toEqual(["todo"]);
    expect(getMcpStatus().map((s) => s.state)).toEqual(["connected", "disabled"]);
  });

  it("spawns with only safe defaults, a widened PATH, and the user's env", async () => {
    sdk.servers.set("npx", { tools: [] });
    config.servers = [stdio(1, "s", "npx", { args: ["-y", "pkg"], env: { API_KEY: "k" } })];
    await listMcpTools();
    const { params } = sdk.transports[0];
    expect(params.args).toEqual(["-y", "pkg"]);
    expect(params.env).toMatchObject({ HOME: "/home/me", API_KEY: "k" });
    expect(params.env.PATH).toMatch(/^\/opt\/homebrew\/bin:.*:\/usr\/bin$/);
    expect(params.stderr).toBe("pipe");
  });

  it("sends the bearer token to an HTTP server", async () => {
    sdk.servers.set("https://mcp.example.com/mcp", { tools: [{ name: "t" }] });
    config.servers = [
      { ...stdio(1, "remote", ""), transport: "http", url: "https://mcp.example.com/mcp", bearerToken: "secret" },
    ];
    expect((await listMcpTools()).map((t) => t.name)).toEqual(["mcp__remote__t"]);
    expect(sdk.transports[0].opts.requestInit.headers).toEqual({ Authorization: "Bearer secret" });
  });

  it("fails soft: a broken server has no tools, says why, and isn't respawned every turn", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    sdk.servers.set("good", { tools: [{ name: "ping" }] });
    sdk.servers.set("bad", { fail: "command not found: bad", tools: [] });
    config.servers = [stdio(1, "good", "good"), stdio(2, "bad", "bad")];

    expect((await listMcpTools()).map((t) => t.name)).toEqual(["mcp__good__ping"]);
    const bad = getMcpStatus().find((s) => s.id === 2)!;
    expect(bad).toMatchObject({ state: "failed", tools: [] });
    expect(bad.reason).toMatch(/command not found/);
    expect(sdk.closes).toContain("bad");

    await listMcpTools();
    expect(sdk.connects.filter((k) => k === "bad")).toHaveLength(1);
    // Settings' Connect button skips the wait.
    await connectMcpServer(2);
    expect(sdk.connects.filter((k) => k === "bad")).toHaveLength(2);
    // And so does time.
    vi.setSystemTime(Date.now() + 61_000);
    await listMcpTools();
    expect(sdk.connects.filter((k) => k === "bad")).toHaveLength(3);
  });

  it("reconnects after a config edit and closes servers that were removed", async () => {
    sdk.servers.set("v1", { tools: [{ name: "a" }] });
    sdk.servers.set("v2", { tools: [{ name: "b" }] });
    config.servers = [stdio(1, "s", "v1")];
    await listMcpTools();
    config.servers = [stdio(1, "s", "v2")];
    expect((await listMcpTools()).map((t) => t.tool)).toEqual(["b"]);
    expect(sdk.closes).toEqual(["v1"]);
    config.servers = [];
    expect(await listMcpTools()).toEqual([]);
    expect(sdk.closes).toEqual(["v1", "v2"]);
  });

  it("closes everything on quit", async () => {
    sdk.servers.set("a", { tools: [] });
    sdk.servers.set("b", { tools: [] });
    config.servers = [stdio(1, "a", "a"), stdio(2, "b", "b")];
    await listMcpTools();
    await closeAllMcp();
    expect(sdk.closes.sort()).toEqual(["a", "b"]);
  });
});

describe("calling", () => {
  it("sends the server's own tool name and the arguments", async () => {
    sdk.servers.set("todo", { tools: [{ name: "find-tasks" }], result: { content: [{ type: "text", text: "3 tasks" }] } });
    config.servers = [stdio(1, "todo", "todo")];
    const [tool] = await listMcpTools();
    expect(await callMcpTool(tool, { query: "x" })).toMatchObject({ ok: true, text: "3 tasks", isError: false });
    expect(sdk.calls).toEqual([{ server: "todo", name: "find-tasks", arguments: { query: "x" } }]);
  });

  it("refuses once the server has been switched off", async () => {
    sdk.servers.set("todo", { tools: [{ name: "t" }] });
    config.servers = [stdio(1, "todo", "todo")];
    const [tool] = await listMcpTools();
    config.servers = [stdio(1, "todo", "todo", { enabled: false })];
    expect(await callMcpTool(tool, {})).toMatchObject({ ok: false });
    expect(sdk.calls).toEqual([]);
  });
});

describe("formatMcpResult", () => {
  it("flattens content to text and leaves media out", () => {
    expect(
      formatMcpResult({
        content: [
          { type: "text", text: "hello" },
          { type: "image", data: "AAAA", mimeType: "image/png" },
          { type: "resource", resource: { uri: "file:///a", text: "inside" } },
          { type: "resource_link", name: "doc", uri: "https://x" },
        ],
      }).text
    ).toBe("hello\n\n[image left out]\n\ninside\n\n[link doc: https://x]");
    expect(formatMcpResult({ structuredContent: { n: 1 } }).text).toBe('{"n":1}');
    expect(formatMcpResult({ content: [], isError: true }).isError).toBe(true);
  });

  it("caps what reaches the model", () => {
    const out = formatMcpResult({ content: [{ type: "text", text: "x".repeat(MAX_MCP_RESULT_CHARS + 50) }] });
    expect(out.text).toHaveLength(MAX_MCP_RESULT_CHARS);
    expect(out.truncated).toBe(true);
  });
});
