const { Worker } = require('node:worker_threads');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-worker-'));
  fs.mkdirSync(path.join(root, 'sessions'));
  const file = path.join(root, 'sessions', 'test.jsonl');
  const at = new Date().toISOString();
  const record = (n) => JSON.stringify({ type: 'event_msg', timestamp: at, payload: { type: 'token_count', info: { last_token_usage: { input_tokens: n, output_tokens: 3 } } } }) + '\n';
  fs.writeFileSync(file, record(10));
  const make = () => new Worker(path.join(__dirname, '../out/main/usage-worker.js'), { workerData: { indexPath: path.join(root, 'index.sqlite') } });
  async function query(worker) {
    return new Promise((resolve, reject) => {
      worker.once('error', reject);
      worker.once('message', (message) => message.error ? reject(new Error(message.error)) : resolve(message.value));
      worker.postMessage({ id: 1, method: 'getCodexUsage', args: [root] });
    });
  }
  let worker = make();
  assert.equal((await query(worker)).today.tokens.input, 10);
  await worker.terminate();
  // New worker reopens the persisted index and appends only new records.
  fs.appendFileSync(file, record(20));
  worker = make();
  assert.equal((await query(worker)).today.tokens.input, 30);
  await worker.terminate();
  fs.rmSync(root, { recursive: true, force: true });
  console.log('Electron worker + native SQLite restart/append smoke passed');
})().catch(error => { console.error(error); process.exit(1); });
