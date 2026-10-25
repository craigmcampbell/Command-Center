// Opt-in live eval for the Assistant: sends a handful of golden prompts to a
// real model on OpenRouter, with the Assistant's real tool schemas, and checks
// which tools it reaches for on the first step. Run it before switching the
// Assistant's model; it spends a few cents and is never part of `npm test`.
//
//   OPENROUTER_API_KEY=sk-or-... ASSISTANT_EVAL_MODEL=vendor/model node scripts/assistant-eval.cjs
//   ... node scripts/assistant-eval.cjs --record out/eval-streams
//
// Without OPENROUTER_API_KEY it prints a note and exits 0. Without
// ASSISTANT_EVAL_MODEL it reads the model from the app's settings, which needs
// Electron's runtime for better-sqlite3:
//   ELECTRON_RUN_AS_NODE=1 npx electron scripts/assistant-eval.cjs
//
// Only the first step is checked: no tool actually runs, so nothing in Todoist,
// YNAB or memory can change. `--record <dir>` saves each raw SSE response, which
// is how a new provider quirk becomes a fixture for assistant.eval.test.ts.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// [prompt, expectation]. `any`: at least one of these tools must be called.
// `none`: no tool may be called. A call to a mutating tool is always a failure
// on the first step for prompts that don't ask for a change.
const GOLDEN = [
  ['What is due today?', { any: ['get_due_tasks'] }],
  ["What's on my calendar tomorrow?", { any: ['get_schedule'] }],
  ['Are my docker containers running?', { any: ['docker_status'] }],
  ['Is CI green on my repos?', { any: ['github_status', 'github_list_prs'] }],
  ['Do I have uncommitted changes in any of my local repos?', { any: ['git_status'] }],
  ['Find my notes about the sprint retro.', { any: ['search_notes'] }],
  ['Remember that I prefer metric units.', { any: ['remember'] }],
  ['Any unapproved transactions in YNAB?', { any: ['ynab_unapproved'] }],
  ['What did I tell you about my coffee order?', { any: ['recall_memory'], allowNone: true }],
  ['What is 17 times 23?', { none: true }],
];
const MUTATING = new Set(['complete_task', 'reschedule_task', 'create_task', 'forget', 'approve_transaction', 'categorize_transaction', 'reader_save_link', 'reader_move_to_inbox', 'generate_image']);

const SYSTEM = [
  "You are the built-in assistant of Command Center, the user's personal desktop dashboard. They use you for quick questions, so answer directly and briefly.",
  'Look things up with your tools instead of guessing: tasks, schedule, notes, repos and Docker state are live data.',
  "Call `remember` only when the user explicitly asks you to remember something or states a lasting preference.",
  `Today is ${new Date().toLocaleDateString('en-US', { weekday: 'long' })} ${new Date().toISOString().slice(0, 10)}.`,
].join('\n\n');

function configuredModel() {
  if (process.env.ASSISTANT_EVAL_MODEL) return process.env.ASSISTANT_EVAL_MODEL.trim();
  const dbPath = path.join(os.homedir(), 'Library', 'Application Support', 'Command Center', 'command-center.db');
  try {
    const Database = require('better-sqlite3');
    const db = new Database(dbPath, { readonly: true, fileMustExist: true });
    const row = db.prepare(`SELECT value FROM settings WHERE key = 'assistant'`).get();
    db.close();
    return row ? JSON.parse(row.value).model?.trim() : undefined;
  } catch (error) {
    console.error(`Couldn't read the model from ${dbPath} (${error.message}).`);
    console.error('Set ASSISTANT_EVAL_MODEL, or run under ELECTRON_RUN_AS_NODE=1 npx electron.');
    return undefined;
  }
}

// The real schemas, bundled from assistantTools.ts so the model sees exactly
// what the Assistant offers. Electron and SQLite are stubbed: nothing here runs a tool.
async function loadTools() {
  const out = path.join(os.tmpdir(), `cc-assistant-eval-tools-${process.pid}.cjs`);
  await require('esbuild').build({
    stdin: { contents: `export { TOOLS } from './src/main/services/assistantTools';`, resolveDir: path.join(__dirname, '..') },
    outfile: out, bundle: true, platform: 'node', format: 'cjs', logLevel: 'error',
    plugins: [{ name: 'stubs', setup(build) {
      build.onResolve({ filter: /^(electron|better-sqlite3)$/ }, (args) => ({ path: args.path, namespace: 'stub' }));
      // CommonJS with a Proxy, so any named import (app, shell, BrowserWindow…) resolves.
      build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ loader: 'js', contents: `const app = { getPath: () => ${JSON.stringify(os.tmpdir())}, isPackaged: false }; module.exports = new Proxy(function Stub() { throw new Error('not available in eval'); }, { get: (t, k) => (k === 'app' ? app : k === '__esModule' ? false : t) });` }));
    } }],
  });
  try { return require(out).TOOLS; } finally { fs.rmSync(out, { force: true }); }
}

// Same assembly rules as assistantClient.ts: fragments keyed by `index`.
function parseStream(text) {
  const calls = new Map();
  let content = '';
  let finish;
  let error;
  for (const line of text.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') continue;
    let chunk;
    try { chunk = JSON.parse(data); } catch { continue; }
    if (chunk.error) error = chunk.error.message ?? 'provider error';
    const choice = chunk.choices?.[0];
    if (!choice) continue;
    if (typeof choice.delta?.content === 'string') content += choice.delta.content;
    for (const f of choice.delta?.tool_calls ?? []) {
      const i = typeof f.index === 'number' ? f.index : 0;
      const call = calls.get(i) ?? { name: '', arguments: '' };
      if (f.function?.name && !call.name) call.name = f.function.name;
      if (typeof f.function?.arguments === 'string') call.arguments += f.function.arguments;
      calls.set(i, call);
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  return { content, finish, error, calls: [...calls.values()].filter((c) => c.name) };
}

function judge(expect, calls) {
  const names = calls.map((c) => c.name);
  const badArgs = calls.filter((c) => { try { JSON.parse(c.arguments || '{}'); return false; } catch { return true; } });
  if (badArgs.length) return `unparseable arguments for ${badArgs.map((c) => c.name).join(', ')}`;
  const mutating = names.filter((n) => MUTATING.has(n));
  if (mutating.length) return `called a mutating tool: ${mutating.join(', ')}`;
  if (expect.none) return names.length ? `expected no tools, called ${names.join(', ')}` : null;
  if (names.length === 0) return expect.allowNone ? null : `expected one of ${expect.any.join(', ')}, called nothing`;
  return names.some((n) => expect.any.includes(n)) ? null : `expected one of ${expect.any.join(', ')}, called ${names.join(', ')}`;
}

(async () => {
  const apiKey = process.env.OPENROUTER_API_KEY?.trim();
  if (!apiKey) {
    console.log('assistant-eval: skipped (set OPENROUTER_API_KEY to run it).');
    return;
  }
  const model = configuredModel();
  if (!model) process.exit(1);
  const recordAt = process.argv.indexOf('--record');
  const recordDir = recordAt >= 0 ? process.argv[recordAt + 1] : null;
  if (recordDir) fs.mkdirSync(recordDir, { recursive: true });
  // What a plain chat is offered: the skill-file reader only appears once a
  // slash command has been used, and image generation needs an OpenAI key.
  const tools = (await loadTools()).filter((t) => !['read_skill_file', 'generate_image'].includes(t.function.name));
  console.log(`assistant-eval: ${GOLDEN.length} prompts against ${model}, ${tools.length} tools offered\n`);

  let failed = 0;
  let cost = 0;
  for (const [i, [prompt, expect]] of GOLDEN.entries()) {
    const started = Date.now();
    let verdict;
    let detail = '';
    try {
      const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'X-Title': 'Command Center eval' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: prompt }], tools, max_tokens: 1024, stream: true, usage: { include: true } }),
        signal: AbortSignal.timeout(120_000),
      });
      const text = await response.text();
      if (recordDir) fs.writeFileSync(path.join(recordDir, `${String(i + 1).padStart(2, '0')}.${response.ok ? 'sse' : 'json'}`), text);
      if (!response.ok) throw new Error(`HTTP ${response.status}: ${text.slice(0, 200)}`);
      const usage = [...text.matchAll(/"cost":\s*([0-9.eE-]+)/g)].pop();
      if (usage) cost += Number(usage[1]);
      const parsed = parseStream(text);
      if (parsed.error) throw new Error(`model error: ${parsed.error}`);
      verdict = judge(expect, parsed.calls);
      detail = parsed.calls.length ? parsed.calls.map((c) => c.name).join(', ') : `(answered: ${parsed.content.replace(/\s+/g, ' ').slice(0, 50)})`;
      if (!parsed.finish) detail += ' [no finish_reason]';
    } catch (error) {
      verdict = error.message;
    }
    if (verdict) failed++;
    const ms = Date.now() - started;
    console.log(`${verdict ? 'FAIL' : 'ok  '}  ${prompt.padEnd(58)} ${String(ms).padStart(6)}ms  ${verdict ?? detail}`);
  }
  console.log(`\n${GOLDEN.length - failed}/${GOLDEN.length} passed · about $${cost.toFixed(4)}${recordDir ? ` · streams saved to ${recordDir}` : ''}`);
  if (failed) process.exit(1);
})().catch((error) => { console.error(error); process.exit(1); });
