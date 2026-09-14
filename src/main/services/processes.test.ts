import { EventEmitter } from 'node:events';
import { expect, it, vi } from 'vitest';
const children = vi.hoisted(() => [] as any[]);
vi.mock('node:child_process', () => ({ spawn: () => {
  const child = new EventEmitter() as any;
  child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  children.push(child);
  return child;
} }));
import { getAllStatus, getStatus, startProcess } from './processes';
it('bounds retained output by bytes and omits logs from routine status', () => {
  startProcess({ id: 'test', label: 'test', command: 'test', sortOrder: 0 });
  for (let i = 0; i < 20; i++) children[0].stdout.emit('data', Buffer.alloc(64 * 1024, 'x'));
  const logs = getStatus('test').logs;
  expect(logs.reduce((n, line) => n + Buffer.byteLength(line), 0)).toBeLessThanOrEqual(512 * 1024);
  expect(getAllStatus()[0].logs).toEqual([]);
  expect(getAllStatus()[0].running).toBe(true);
});
