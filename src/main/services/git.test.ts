import { expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ active: 0, peak: 0, logs: 0, head: 'first' }));
vi.mock('node:child_process', () => ({ execFile: (_cmd: string, args: string[], _options: unknown, callback: (error: null, stdout: string, stderr: string) => void) => {
  state.active++;
  state.peak = Math.max(state.peak, state.active);
  const status = args.includes('status');
  if (!status) state.logs++;
  setTimeout(() => {
    state.active--;
    callback(null, status ? `# branch.oid ${state.head}\n# branch.head main\n` : `123\0subject\0${new Date().toISOString()}`, '');
  }, 1);
} }));
import { getGitStatuses } from './git';
it('limits repository concurrency and reloads commit metadata only when HEAD changes', async () => {
  const repos = Array.from({ length: 8 }, (_, id) => ({ id, label: `Repo ${id}`, owner: '', repo: '', branch: 'main', localPath: `/tmp/repo-${id}`, sortOrder: id }));
  const result = await getGitStatuses(repos);
  expect(result.repos).toHaveLength(8);
  expect(state.peak).toBeLessThanOrEqual(3);
  expect(state.logs).toBe(8);
  await getGitStatuses(repos);
  expect(state.logs).toBe(8);
  state.head = 'second';
  await getGitStatuses(repos);
  expect(state.logs).toBe(16);
});
