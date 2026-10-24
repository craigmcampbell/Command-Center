const { app, BrowserWindow, ipcMain } = require('electron');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-renderer-'));
app.setPath('userData', userData);
const project = path.join(__dirname, '..');
const assert = require('node:assert/strict');
const calls = [];
const errors = [];
let projects = [{ id: 1, sortOrder: 0, name: 'Project Alpha', folder: '/code/alpha', status: 'active', pinned: false, repoId: 1, githubUrl: '', todoistTaskId: 'task1', note: { vaultLabel: 'Test', filePath: 'project.md' }, links: [{ label: 'Local app', url: 'http://localhost:3000' }], processIds: [], containerNames: ['db'] }];
let projectNote = '# Project note';
let projectMtime = 1;
let taskActive = true;
let chatList = [{ id: 'old-1', title: 'Plan the sprint', pinned: false, updatedAt: Date.now() - 86400000 * 3 }, { id: 'old-2', title: 'Docker ports question', pinned: false, updatedAt: Date.now() }];
// Held open by the mocked assistant so Stop and confirmation cards can be exercised mid-request.
let stopResolver = null;
let toolResolver = null;
let memoryText = '- 2026-10-12: Likes terse answers';
let tidyMode = 'ok';
let approveResolver = null;
let lastApproval = null;
let activeTimer = null;

const channels = [...fs.readFileSync(path.join(project, 'src/preload/index.ts'), 'utf8').matchAll(/ipcRenderer.invoke\("([^"]+)"/g)].map(m => m[1]);
const note = (id) => ({ id, vaultLabel: 'Test', filePath: `${id}.md`, label: `Note ${id}`, sortOrder: id });
for (const channel of new Set(channels)) ipcMain.handle(channel, async (evt, ...args) => {
  calls.push([channel, args]);
  if (channel === 'settings:getAll') return {
    app: { refreshMinutes: 0 },
    stats: { refreshSeconds: 1, publicIpEnabled: false },
    spotify: { enabled: false },
    docker: { updateChecksEnabled: false },
    grimoire: { vaultPath: '', dailyLogDir: '', missionsDir: '' },
    todoist: { apiToken: '' },
    googleCalendar: { clientId: '', clientSecret: '' },
    reader: { apiToken: '' },
  };
  if (channel === 'projects:list') return projects;
  if (channel === 'projects:save') {
    const [input, id] = args;
    if (id) projects = projects.map(p => p.id === id ? { ...p, ...input } : p);
    else projects.push({ ...input, id: projects.length + 1, sortOrder: projects.length });
    return projects;
  }
  if (channel === 'projects:remove') { projects = projects.filter(p => p.id !== args[0]); return projects; }
  if (channel === 'projects:reorder') { projects = args[0].map((id, sortOrder) => ({ ...projects.find(p => p.id === id), sortOrder })); return projects; }
  if (channel === 'settings:githubRepos:list') return [];
  if (channel === 'git:status') return { ok: true, repos: [{ id: 1, label: 'Alpha', path: '/code/alpha', ok: true, branch: 'main', ahead: 0, behind: 0, staged: 1, unstaged: 0, untracked: 0, conflicted: 0 }] };
  if (channel === 'claude:sessions' || channel === 'codex:sessions') return { ok: true, sessions: [] };
  if (channel === 'todoist:complete') { taskActive = false; return { ok: true }; }
  if (channel === 'todoist:tasks') return { ok: true, projects: [{ id: 'work', name: 'Work' }], tasks: args[0] && taskActive ? [{ id: 'task1', content: 'Undated project task', description: '', url: 'https://app.todoist.com/app/task/task1', priority: 1, due: null, overdue: false, deadline: null, project: 'Work', projectId: 'work', labels: [], subtasks: [{ id: 'child', content: 'Undated subtask', checked: false }], parentName: null }] : [] };
  if (channel === 'notes:read' && args[1] === 'project.md') return { ok: true, content: projectNote, mtimeMs: projectMtime };
  if (channel === 'notes:save' && args[1] === 'project.md') {
    if (args[3] !== undefined && args[3] !== projectMtime) return { ok: false, conflict: true, reason: 'Changed on disk' };
    projectNote = args[2]; projectMtime++; return { ok: true, mtimeMs: projectMtime };
  }
  if (channel === 'notes:statMany' && args[0].some(n => n.filePath === 'project.md')) return { ok: true, entries: [{ vaultLabel: 'Test', filePath: 'project.md', mtimeMs: projectMtime }] };
  if (channel === 'timeTracking:summaries') return {};
  if (channel === 'timeTracking:entries') return [];
  if (channel === 'timeTracking:activeTimer') return activeTimer;
  if (channel === 'timeTracking:start') { activeTimer = { taskId: args[0], taskContent: args[1], projectName: args[2], startedAt: Date.now() }; return activeTimer; }
  if (channel === 'timeTracking:stop') { activeTimer = null; return { ok: true }; }
  if (channel === 'settings:railway:update') return args[0];
  // A request that stays open until the user presses Stop.
  if (channel === 'assistant:ask' && args[1] === 'slow question') {
    evt.sender.send('assistant:delta', { requestId: args[2], text: 'Partial answer' });
    await new Promise(r => { stopResolver = r; });
    return { ok: true, stopped: true, conversationId: args[0] ?? 'conv-slow', text: 'Partial answer', toolCalls: [], remembered: [] };
  }
  // A request that waits on a confirmation card, then reports what the user chose.
  // A request that is mid tool calls until the test releases it, to see the live status.
  if (channel === 'assistant:ask' && args[1] === 'use tools') {
    const base = { requestId: args[2] };
    evt.sender.send('assistant:tool', { ...base, callId: 'k1', name: 'search_notes', args: 'query: sprint', phase: 'start' });
    evt.sender.send('assistant:tool', { ...base, callId: 'k2', name: 'get_due_tasks', phase: 'start' });
    await new Promise(r => { toolResolver = r; });
    evt.sender.send('assistant:tool', { ...base, callId: 'k1', name: 'search_notes', args: 'query: sprint', phase: 'end', ok: true });
    evt.sender.send('assistant:tool', { ...base, callId: 'k2', name: 'get_due_tasks', phase: 'end', ok: false });
    await new Promise(r => setTimeout(r, 300));
    return { ok: true, conversationId: args[0] ?? 'conv-1', text: 'Found one note.', remembered: [], toolCalls: [
      { name: 'search_notes', ok: true, args: 'query: sprint', result: '{"results":[{"vault":"Main","path":"Sprint.md"}],"truncated":false}' },
      { name: 'get_due_tasks', ok: false, result: 'Todoist token rejected' },
    ] };
  }
  if (channel === 'assistant:ask' && (args[1] === 'finish it' || args[1] === 'deny it')) {
    evt.sender.send('assistant:approval', { requestId: args[2], approvalId: args[1] === 'finish it' ? 'ap-1' : 'ap-2', tool: 'complete_task', summary: 'Complete task “Ship the POC” (Work)' });
    await new Promise(r => { approveResolver = r; });
    return { ok: true, conversationId: args[0] ?? 'conv-1', text: lastApproval ? 'Done.' : 'Okay, leaving it.', toolCalls: [lastApproval ? { name: 'complete_task', ok: true, args: 'task_id: t1', result: '{"completed":true}' } : { name: 'complete_task', ok: false, declined: true, args: 'task_id: t1', result: 'The user declined this action' }], remembered: [] };
  }
  if (channel === 'assistant:stop') { stopResolver?.(); stopResolver = null; return; }
  if (channel === 'assistant:approve') { lastApproval = args[1]; approveResolver?.(); approveResolver = null; return; }
  if (channel === 'assistant:regenerate') return { ok: true, conversationId: args[0], text: 'Regenerated answer.', toolCalls: [], remembered: [], usage: { promptTokens: 50, completionTokens: 10, costUsd: 0.001 } };
  if (channel === 'capture:submit') return { ok: true };
  if (channel === 'assistant:hotkeyStatus') return { accelerator: 'Cmd+Ctrl+Alt+Shift+A', registered: true };
  if (channel === 'assistant:hidePanel' || channel === 'assistant:openInDashboard') return;
  if (channel === 'settings:assistant:update') return args[0];
  if (channel === 'assistant:chats:pin') { chatList = chatList.map(c => c.id === args[0] ? { ...c, pinned: args[1] } : c); return { ok: true }; }
  if (channel === 'assistant:chats:rename') { chatList = chatList.map(c => c.id === args[0] ? { ...c, title: args[1] } : c); return { ok: true }; }
  if (channel === 'assistant:ask') {
    // Stream a first chunk, hold the reply open, then resolve with the full text.
    evt.sender.send('assistant:delta', { requestId: args[2], text: 'You have ' });
    evt.sender.send('assistant:delta', { requestId: 'someone-elses-request', text: 'LEAKED' });
    await new Promise(r => setTimeout(r, 500));
  }
  if (channel === 'assistant:chats:list') {
    const q = (args[0] ?? '').toLowerCase();
    return chatList.filter(c => !q || c.title.toLowerCase().includes(q)).sort((a, b) => Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt);
  }
  if (channel === 'assistant:chats:open') return { ok: true, id: args[0], title: 'Plan the sprint', pinned: false, usage: { promptTokens: 1200, completionTokens: 300, costUsd: 0.0123 }, items: [{ role: 'user', text: 'Plan the sprint', toolCalls: [], remembered: [] }, { role: 'assistant', text: 'Sprint transcript reply', toolCalls: [{ name: 'get_due_tasks', ok: true }], remembered: [] }] };
  if (channel === 'assistant:chats:remove') { chatList = chatList.filter(c => c.id !== args[0]); return { ok: true }; }
  if (channel === 'assistant:ask' && args[1] === 'show markdown') return { ok: true, conversationId: 'conv-1', toolCalls: [], remembered: [], text: '## Plan\n\nThis is **bold**, *italic* and `inline`.\n\n- first\n- second\n\n```ts\nconst x = 1;\n```\n\n[docs](https://example.com) and [bad](javascript:alert(1))\n\n<img src=x onerror="window.__pwned=1"> <script>window.__pwned=2</script>' };
  if (channel === 'assistant:ask' && args[1] === 'trigger setup') return { ok: false, needsSetup: true, reason: 'No model configured', conversationId: 'conv-2', text: '', toolCalls: [], remembered: [] };
  if (channel === 'assistant:ask') return { ok: true, conversationId: args[0] ?? 'conv-1', text: 'You have one task due.', toolCalls: [{ name: 'get_due_tasks', ok: true }], remembered: [], usage: { promptTokens: 120, completionTokens: 30, costUsd: 0.0042 } };
  if (channel === 'assistant:memory:get') return { ok: true, content: memoryText, path: '/tmp/assistant-memory.md' };
  if (channel === 'assistant:memory:save') { memoryText = args[0]; return { ok: true, content: memoryText, path: '/tmp/assistant-memory.md' }; }
  if (channel === 'assistant:memory:tidy') {
    if (tidyMode === 'error') return { ok: false, reason: 'The model returned an empty file, so nothing was changed', changed: false, current: '', proposed: '' };
    if (tidyMode === 'same') return { ok: true, changed: false, current: memoryText, proposed: memoryText };
    return { ok: true, changed: true, current: memoryText, proposed: '- 2026-10-12: Prefers terse, short answers\n- 2026-10-13: Lives in Denver\n', usage: { promptTokens: 400, completionTokens: 40, costUsd: 0.002 } };
  }
  if (channel === 'notes:vaults') return [{ id: 1, label: 'Test', path: '/tmp', sortOrder: 0 }];
  if (channel === 'notes:nav:list') return [note(1), note(2)];
  if (channel === 'notes:session:get') return { openNoteIds: [1,2], activeNoteId: 1 };
  if (channel === 'notes:read') return { ok: true, content: `# Content ${args[1]}`, mtimeMs: 1 };
  if (channel === 'notes:index') return { ok: true, entries: [] };
  if (channel === 'notes:statMany') return { ok: true, entries: [] };
  if (channel === 'process:statusAll' || channel === 'links:list') return [];
  if (channel === 'docker:list') return { ok: true, containers: [{ name: 'db', image: 'postgres:16', state: 'running', status: 'Up 1 hour' }] };
  if (channel === 'github:status') return { ok: true, repos: [], reviewRequested: [] };
  if (channel === 'railway:usage') return {
    ok: true,
    workspaces: [{
      id: 'workspace-1', name: 'Personal', billingPeriodStart: '2026-09-01T00:00:00Z',
      billingPeriodEnd: '2026-10-01T00:00:00Z', currentUsageDollars: 12,
      estimatedBillDollars: 18, creditBalance: 20, remainingUsageCreditBalance: 8,
      appliedCredits: 4, lineItems: [], services: [],
    }],
    currentUsageDollars: 12, estimatedBillDollars: 18, creditBalance: 20,
    remainingUsageCreditBalance: 8, appliedCredits: 4,
    lineItems: [{ key: 'MEMORY_USAGE_GB', label: 'Memory', currentUsageDollars: 11.5, estimatedUsageDollars: 17 }],
    services: [{
      key: 'workspace-1:p1:s1', workspaceId: 'workspace-1', projectId: 'p1', projectName: 'Home Lab',
      serviceId: 's1', serviceName: 'Open-WebUI', currentUsageDollars: 7.82,
      lineItems: [{ key: 'MEMORY_USAGE_GB', label: 'Memory', currentUsageDollars: 7.65 }],
    }],
    scanMs: 5,
  };
  if (channel.startsWith('ynab:')) return { ok: false, reason: 'Test fixture', accounts: [], transactions: [], categories: [], payees: [] };
  if (channel === 'stats:system') return { ok: true, cpuPercent: 1, loadAvg: [0,0,0], uptimeSeconds: 10, memory: { usedBytes: 10, totalBytes: 100, freeBytes: 90, wiredBytes: 0, compressedBytes: 0, cachedBytes: 0, swapUsedBytes: 0, swapTotalBytes: 0 } };
  if (channel === 'stats:storage') return { ok: true, volumes: [] };
  if (channel === 'stats:network') return { ok: true, interfaces: [] };
  if (channel === 'stats:topProcesses') return { ok: true, processes: [] };
  if (channel === 'time:active' || channel === 'time:activeTimer') return null;
  return { ok: false, reason: 'Test fixture', tasks: [], events: [], missions: [], content: '', summaries: [] };
});
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: true, width: 1200, height: 900, webPreferences: { preload: path.join(project, 'out/preload/index.js'), contextIsolation: true, nodeIntegration: false } });
  win.webContents.on('console-message', (_, level, message) => { if (level >= 3) errors.push(message); });
  await win.loadFile(path.join(project, 'out/renderer/index.html'));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const click = label => win.webContents.executeJavaScript(`(() => { const button = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(label)}); if (!button) throw new Error('Missing button: '+${JSON.stringify(label)}); button.click(); })()`);
  await wait(1800);
  assert.equal(calls.filter(([c]) => c.startsWith('stats:')).length, 0, 'Home should not collect stats');
  await win.webContents.executeJavaScript(`document.querySelector('.settings-trigger').click()`);
  await wait(100);
  await click('Integrations');
  await wait(100);
  assert.ok(await win.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-card h3')].some(e => e.textContent === 'Railway')`));
  await win.webContents.executeJavaScript(`(() => {
    const form = [...document.querySelectorAll('.settings-card')].find(e => e.querySelector('h3')?.textContent === 'Railway');
    const input = form.querySelector('input[type="password"]');
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'railway-test');
    input.dispatchEvent(new Event('input', { bubbles: true }));
    form.requestSubmit();
  })()`);
  await wait(100);
  assert.deepEqual(calls.find(([c]) => c === 'settings:railway:update')?.[1][0], { accountToken: 'railway-test', refreshSeconds: 900 });
  await win.webContents.executeJavaScript(`document.querySelector('.settings-close').click()`);
  await click('AI');
  await click('Railway');
  await wait(400);
  assert.equal(calls.filter(([c]) => c === 'railway:usage').length, 1, 'Railway tab should load billing');
  assert.ok(await win.webContents.executeJavaScript(`document.body.textContent.includes('Personal') && document.body.textContent.includes('$12.00')`));
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.slot-railway-services').textContent.includes('Open-WebUI')`), 'Railway by-service panel renders');
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.slot-railway-resources').textContent.includes('Memory')`), 'Railway resources panel renders');
  await click('Stats');
  await wait(2500);
  assert.ok(calls.filter(([c]) => c === 'stats:system').length >= 2, 'Visible Stats should poll');
  await click('Notes');
  await wait(800);
  const count = calls.filter(([c]) => c === 'stats:system').length;
  await wait(1400);
  assert.equal(calls.filter(([c]) => c === 'stats:system').length, count, 'Notes should pause stats');
  assert.equal(calls.filter(([c]) => c === 'notes:read').length, 1, 'Only active restored note loads');
  await win.webContents.executeJavaScript(`document.querySelectorAll('.notes-tab')[1].click()`);
  await wait(400);
  assert.equal(calls.filter(([c]) => c === 'notes:read').length, 2);
  assert.ok(await win.webContents.executeJavaScript(`document.body.textContent.includes('Content 2.md')`));
  await click('Projects');
  await wait(600);
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.projects-tab').textContent.includes('Project Alpha')`));
  assert.equal(calls.filter(([c, a]) => c === 'claude:sessions' && a[1] === '/code/alpha').length, 0, 'Collapsed projects do not load sessions');
  await click('Expand');
  await wait(500);
  assert.ok(calls.some(([c, a]) => c === 'claude:sessions' && a[0] === 5 && a[1] === '/code/alpha'));
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.project-details').textContent.includes('Undated subtask')`));
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.project-note').textContent.includes('Project note')`));
  await win.webContents.executeJavaScript(`document.querySelector('.project-details button[title="Start timer"]').click()`);
  await wait(100);
  assert.equal(activeTimer.taskId, 'task1');
  assert.ok(await win.webContents.executeJavaScript(`!!document.querySelector('.project-details button[title="Stop timer"]')`));
  await win.webContents.executeJavaScript(`document.querySelector('.project-details button[title="Stop timer"]').click()`);
  await wait(100);
  assert.equal(activeTimer, null);
  await click('Open in Obsidian');
  await wait(100);
  assert.ok(calls.some(([c, a]) => c === 'open:url' && a[0] === 'obsidian://open?vault=tmp&file=project.md'), 'Obsidian uses actual vault folder name');
  await click('Write');
  await wait(100);
  await win.webContents.executeJavaScript(`document.querySelector('.project-note .cm-content').focus()`);
  await win.webContents.insertText(' edited');
  await click('Collapse');
  await wait(200);
  assert.ok(projectNote.includes('edited'), 'Collapse flushes queued note edits');
  await click('Expand');
  await wait(200);
  await win.webContents.executeJavaScript(`document.querySelector('.project-note button[title="Expand"]').click()`);
  await wait(100);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.project-note .cm-content').length`), 1, 'Expanded note uses one editor owner');
  await win.webContents.executeJavaScript(`document.querySelector('.project-note .cm-content').focus()`);
  await win.webContents.insertText(' modal');
  await click('Close');
  await wait(200);
  assert.ok(projectNote.includes('modal'), 'Modal close flushes edits');
  projectNote = '# External content'; projectMtime++;
  await win.webContents.executeJavaScript(`window.dispatchEvent(new Event('focus'))`);
  await wait(200);
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.project-note .cm-content').textContent.includes('External content')`));
  await win.webContents.executeJavaScript(`document.querySelector('.project-note .cm-content').focus()`);
  await win.webContents.insertText(' local');
  projectMtime++;
  await wait(650);
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.project-note').textContent.includes('Changed on disk')`), 'Conflicting save is shown');
  assert.equal(projectNote, '# External content', 'Conflicting save preserves disk');
  await click('Keep mine');
  await wait(200);
  assert.ok(projectNote.includes('local'));
  await win.webContents.executeJavaScript(`document.querySelector('.project-note .cm-content').focus()`);
  await win.webContents.insertText(' tab');
  await click('Home');
  await wait(200);
  assert.ok(projectNote.includes('tab'), 'Tab changes flush note edits');
  await click('Projects');
  await wait(200);
  await win.webContents.executeJavaScript(`document.querySelector('.project-details button[title="Mark complete"]').click()`);
  await wait(450);
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.project-details').textContent.includes('not active or unavailable')`));
  await click('Archive');
  await wait(200);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.project-card:not([hidden])').length`), 0);
  await win.webContents.executeJavaScript(`document.querySelector('.projects-toolbar input[type="checkbox"]').click()`);
  await wait(100);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.project-card:not([hidden])').length`), 1);
  await click('Restore');
  await wait(100);
  await win.webContents.executeJavaScript(`document.querySelector('.projects-toolbar input[type="checkbox"]').click()`);
  await wait(100);
  await click('Add project');
  await wait(100);
  await win.webContents.executeJavaScript(`(() => {
    const form = document.querySelector('.project-editor');
    const inputs = form.querySelectorAll('input');
    const set = (input, value) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value); input.dispatchEvent(new Event('input', { bubbles: true })); };
    set(inputs[0], 'Project Beta'); set(inputs[1], '/code/beta');
  })()`);
  await wait(100);
  await win.webContents.executeJavaScript(`document.querySelector('.project-editor').requestSubmit()`);
  await wait(250);
  assert.equal(projects.length, 2, 'Editor saves new projects');
  await win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Pin Project Beta"]').click()`);
  await wait(200);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.project-card h2').textContent`), 'Project Beta');
  await win.webContents.executeJavaScript(`(() => { const input = document.querySelector('input[aria-label="Search projects"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, 'Alpha'); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(100);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelectorAll('.project-card:not([hidden])').length`), 1);
  fs.writeFileSync(path.join(project, 'out/projects-smoke.png'), (await win.webContents.capturePage()).toPNG());
  await click('Assistant');
  await wait(200);
  const typeAssistant = text => win.webContents.executeJavaScript(`(() => { const t = document.querySelector('.assistant-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, ${JSON.stringify(text)}); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await typeAssistant('what is due?');
  await click('Send');
  await wait(200);
  const midStream = await win.webContents.executeJavaScript(`({ log: document.querySelector('.assistant-log').textContent, busy: document.querySelector('.assistant-log').getAttribute('aria-busy'), chips: document.querySelectorAll('.assistant-chip').length, inputDisabled: document.querySelector('.assistant-input').disabled, stopShown: [...document.querySelectorAll('button')].some(b => b.textContent.trim() === 'Stop') })`);
  assert.ok(midStream.log.includes('You have ') && !midStream.log.includes('one task due'), 'Streamed text shows before the reply resolves');
  assert.ok(!midStream.log.includes('LEAKED'), 'Deltas for another request id are ignored');
  assert.equal(midStream.busy, 'true');
  assert.equal(midStream.chips, 0, 'Tool chips only arrive with the final reply');
  assert.ok(midStream.inputDisabled && midStream.stopShown, 'Input is locked and Stop is offered while streaming');
  await wait(500);
  assert.equal(calls.find(([c]) => c === 'assistant:ask')?.[1][0], null, 'First message starts a new conversation');
  assert.equal(calls.find(([c]) => c === 'assistant:ask')?.[1][1], 'what is due?');
  assert.match(calls.find(([c]) => c === 'assistant:ask')?.[1][2], /^[0-9a-f-]{36}$/, 'Each question carries a request id');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.assistant-log').textContent.split('You have').length - 1`), 1, 'Final reply replaces the streamed bubble instead of appending to it');
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.assistant-log').textContent.includes('You have one task due.') && document.querySelector('.assistant-chip').textContent === 'Todoist'`), 'Assistant reply and tool chip render');
  await click('Stats');
  await wait(100);
  await click('Assistant');
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.assistant-log').textContent.includes('You have one task due.')`), 'Transcript survives a trip to another tab');
  await typeAssistant('and tomorrow?');
  await click('Send');
  await wait(900);
  assert.equal(calls.filter(([c]) => c === 'assistant:ask')[1][1][0], 'conv-1', 'Follow-up reuses the conversation id');
  await click('Memory');
  await wait(200);
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.assistant-memory-text').value`), '- 2026-10-12: Likes terse answers');
  await typeAssistant('show markdown');
  await click('Send');
  await wait(900);
  const md = await win.webContents.executeJavaScript(`(() => { const b = [...document.querySelectorAll('.assistant-bubble-md')].pop(); return { h2: b.querySelector('h2')?.textContent, strong: b.querySelector('strong')?.textContent, em: !!b.querySelector('em'), li: b.querySelectorAll('li').length, code: b.querySelector('pre code')?.textContent, href: b.querySelector('a[href]')?.getAttribute('href'), blocked: b.querySelectorAll('.link-blocked').length, jsLinks: [...b.querySelectorAll('a')].filter(a => a.href.startsWith('javascript:')).length, injected: b.querySelectorAll('img, script').length, pwned: window.__pwned ?? null, text: b.textContent }; })()`);
  assert.equal(md.h2, 'Plan');
  assert.equal(md.strong, 'bold');
  assert.ok(md.em);
  assert.equal(md.li, 2);
  assert.ok(md.code.includes('const x = 1;'), 'Fenced code renders in a code block');
  assert.equal(md.href, 'https://example.com');
  assert.equal(md.blocked, 1, 'javascript: link is blocked, not linked');
  assert.equal(md.jsLinks, 0);
  assert.equal(md.injected, 0, 'Raw HTML from the model is escaped, not injected');
  assert.equal(md.pwned, null, 'No script ran');
  assert.ok(md.text.includes('<img'), 'Escaped HTML shows as text');
  assert.equal(await win.webContents.executeJavaScript(`(() => { const m = [...document.querySelectorAll('.assistant-msg')].pop(); return [...m.childNodes].every(n => n.nodeType === 1 && (n.classList.contains('assistant-bubble') || n.classList.contains('assistant-reply-actions'))); })()`), true, 'A reply with no tool calls renders only its bubble and actions (no stray 0 text node from an empty array)');
  assert.equal(await win.webContents.executeJavaScript(`[...document.querySelectorAll('.assistant-msg-user .assistant-bubble')].pop().classList.contains('note')`), false, 'User messages stay plain text');
  fs.writeFileSync(path.join(project, 'out/assistant-markdown-smoke.png'), (await win.webContents.capturePage()).toPNG());
  // Both routes into Settings land on the Assistant section, not General.
  const activeSettingsSection = () => win.webContents.executeJavaScript(`document.querySelector('.settings-nav-item.active')?.textContent`);
  await click('Settings');
  await wait(200);
  assert.equal(await activeSettingsSection(), 'Assistant', 'Header link opens the Assistant settings section');
  assert.ok(await win.webContents.executeJavaScript(`[...document.querySelectorAll('.settings-card h3')].some(e => e.textContent === 'Assistant')`), 'Assistant card is in its own section');
  await win.webContents.executeJavaScript(`document.querySelector('.settings-close').click()`);
  await wait(100);
  await typeAssistant('trigger setup');
  await click('Send');
  await wait(900);
  await click('Open Assistant settings');
  await wait(200);
  assert.equal(await activeSettingsSection(), 'Assistant', 'A setup error offers a button into the Assistant settings');
  await win.webContents.executeJavaScript(`document.querySelector('.settings-close').click()`);
  await wait(100);
  // The gear icon still opens General.
  await win.webContents.executeJavaScript(`document.querySelector('.settings-trigger').click()`);
  await wait(200);
  assert.equal(await activeSettingsSection(), 'General');
  await win.webContents.executeJavaScript(`document.querySelector('.settings-close').click()`);
  await wait(100);
  // ---- chat history: list, open, resume, delete ----
  const rowsText = () => win.webContents.executeJavaScript(`[...document.querySelectorAll('.assistant-chat-title')].map(e => e.textContent)`);
  assert.deepEqual(await rowsText(), ['Docker ports question', 'Plan the sprint'], 'History lists the saved chats, newest first');
  await win.webContents.executeJavaScript(`[...document.querySelectorAll('.assistant-chat-open')].find(b => b.textContent.includes('Plan the sprint')).click()`);
  await wait(250);
  assert.deepEqual(calls.filter(([c]) => c === 'assistant:chats:open').at(-1)[1], ['old-1']);
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.assistant-log').textContent.includes('Sprint transcript reply') && !document.querySelector('.assistant-log').textContent.includes('You have one task due')`), 'Opening a chat replaces the transcript with that chat');
  assert.equal(await win.webContents.executeJavaScript(`document.querySelector('.assistant-chat-open[aria-current="true"]')?.textContent.includes('Plan the sprint')`), true, 'The open chat is highlighted');
  await typeAssistant('continue where we left off');
  await click('Send');
  await wait(900);
  assert.equal(calls.filter(([c]) => c === 'assistant:ask').at(-1)[1][0], 'old-1', 'A new message in an opened chat continues that chat');
  // Cancelling a delete leaves the chat alone.
  const clickDelete = title => win.webContents.executeJavaScript(`document.querySelector('button[aria-label="Delete chat: ${title}"]').click()`);
  await clickDelete('Plan the sprint');
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.assistant-chat-confirm')?.textContent.includes('Delete this chat?')`), 'Delete asks for confirmation first');
  await click('Cancel');
  assert.equal(calls.filter(([c]) => c === 'assistant:chats:remove').length, 0, 'Cancel deletes nothing');
  // Deleting a chat that is not open leaves the open one in place.
  await clickDelete('Docker ports question');
  await click('Delete');
  await wait(250);
  assert.deepEqual(calls.filter(([c]) => c === 'assistant:chats:remove').at(-1)[1], ['old-2']);
  assert.deepEqual(await rowsText(), ['Plan the sprint']);
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.assistant-log').textContent.includes('Sprint transcript reply')`), 'Deleting another chat leaves the open one on screen');
  fs.writeFileSync(path.join(project, 'out/assistant-history-smoke.png'), (await win.webContents.capturePage()).toPNG());
  // Deleting the open chat clears the view and the next message starts a new chat.
  await clickDelete('Plan the sprint');
  await click('Delete');
  await wait(250);
  assert.deepEqual(await rowsText(), []);
  assert.ok(await win.webContents.executeJavaScript(`document.querySelector('.assistant-log').textContent.includes('Ask about your tasks')`), 'Deleting the open chat returns to an empty new chat');
  await typeAssistant('fresh start');
  await click('Send');
  await wait(900);
  assert.equal(calls.filter(([c]) => c === 'assistant:ask').at(-1)[1][0], null, 'After deleting the open chat, the next message is a new chat');
  // ======== new in this round: Stop, confirmations, reply actions, usage, history search/pin/rename ========
  const exec = code => win.webContents.executeJavaScript(code);
  const lastCall = name => calls.filter(([c]) => c === name).at(-1);
  const buttonLabels = () => exec(`[...document.querySelectorAll('button')].map(b => b.textContent.trim())`);
  const clickByLabel = label => exec(`(() => { const b = [...document.querySelectorAll('button')].find(e => e.textContent.trim() === ${JSON.stringify(label)} || e.getAttribute('aria-label') === ${JSON.stringify(label)}); if (!b) throw new Error('Missing button: ' + ${JSON.stringify(label)}); b.click(); })()`);
  const logText = () => exec(`document.querySelector('.assistant-log').textContent`);

  // Stop: the request stays open until Stop is pressed, and what streamed is kept.
  await typeAssistant('slow question');
  await click('Send');
  await wait(250);
  assert.ok((await buttonLabels()).includes('Stop') && !(await buttonLabels()).includes('Send'), 'Stop replaces Send while a reply is in flight');
  assert.ok((await logText()).includes('Partial answer'), 'Text streams before the reply finishes');
  await click('Stop');
  await wait(300);
  assert.equal(lastCall('assistant:stop')[1][0], calls.filter(([c]) => c === 'assistant:ask').at(-1)[1][2], 'Stop targets the in-flight request');
  assert.ok((await buttonLabels()).includes('Send'), 'Send returns once the turn ends');
  assert.ok((await logText()).includes('Partial answer'), 'A stopped reply keeps what had arrived');

  // Confirmation cards: nothing is allowed until the user says so.
  await typeAssistant('finish it');
  await click('Send');
  await wait(300);
  assert.ok((await exec(`document.querySelector('.assistant-approval')?.textContent`))?.includes('Complete task “Ship the POC” (Work)'), 'A confirmation card quotes the action');
  assert.ok((await logText()).includes('Waiting for your OK'), 'The reply says it is waiting on you');
  assert.equal(await exec(`document.querySelectorAll('.assistant-chip').length > 0 && [...document.querySelectorAll('.assistant-chip')].some(c => c.textContent.includes('Completed'))`), false, 'No result chip before the user answers');
  await click('Allow');
  await wait(300);
  assert.deepEqual(lastCall('assistant:approve')[1], ['ap-1', true]);
  assert.equal(await exec(`document.querySelectorAll('.assistant-approval').length`), 0, 'The card goes away once answered');
  assert.ok(await exec(`[...document.querySelectorAll('.assistant-chip')].some(c => c.textContent === 'Completed task')`), 'The completed action shows as a chip');
  assert.equal(await exec(`[...document.querySelectorAll('.assistant-msg')].pop().querySelector('.assistant-reply-actions')?.textContent.includes('Regenerate')`), false, 'A reply that changed something offers no Regenerate');
  await typeAssistant('deny it');
  await click('Send');
  await wait(300);
  await click('Deny');
  await wait(300);
  assert.deepEqual(lastCall('assistant:approve')[1], ['ap-2', false]);
  assert.ok(await exec(`[...document.querySelectorAll('.assistant-chip')].some(c => c.textContent === 'Completed task declined')`), 'A denied action shows as declined, not failed');

  // Copy, Regenerate, Save to notes, usage.
  await typeAssistant('plain question');
  await click('Send');
  await wait(900);
  assert.ok((await logText()).includes('You have one task due.'));
  await exec(`window.__copied = null; navigator.clipboard.writeText = async (t) => { window.__copied = t; }; undefined`);
  await exec(`[...document.querySelectorAll('.assistant-msg')].pop().querySelector('button[aria-label="Copy reply"]').click()`);
  await wait(100);
  assert.equal(await exec(`window.__copied`), 'You have one task due.', 'Copy puts the reply text on the clipboard');
  assert.equal(await exec(`[...document.querySelectorAll('.assistant-msg')].filter(m => [...m.querySelectorAll('button')].some(b => b.textContent.trim() === 'Regenerate')).length`), 1, 'Only the last reply offers Regenerate');
  await clickByLabel('Regenerate');
  await wait(300);
  assert.equal(lastCall('assistant:regenerate')[1][0], lastCall('assistant:ask')[1][0] ?? 'conv-1', 'Regenerate targets the open chat');
  assert.ok((await logText()).includes('Regenerated answer.') && !(await logText()).split('plain question').slice(1).join('').includes('You have one task due.'), 'Regenerate replaces the answer in place');
  assert.ok(/\d.*tokens · \$/.test(await exec(`document.querySelector('.assistant-usage')?.textContent ?? ''`)), 'The header shows tokens and cost for the chat');
  await exec(`(() => { const row = [...document.querySelectorAll('.assistant-msg')].pop().querySelector('.assistant-reply-actions'); [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Save to…').click(); })()`);
  await wait(50);
  await exec(`(() => { const row = [...document.querySelectorAll('.assistant-msg')].pop().querySelector('.assistant-reply-actions'); [...row.querySelectorAll('button')].find(b => b.textContent.trim() === 'Daily note').click(); })()`);
  await wait(200);
  const saved = lastCall('capture:submit')[1];
  assert.equal(saved[0], 'dailyNote');
  assert.ok(saved[1].startsWith('Asked the assistant: “plain question”') && saved[1].includes('Regenerated answer.'), 'Saving a reply to notes quotes the question');
  assert.ok((await exec(`[...document.querySelectorAll('.assistant-msg')].pop().textContent`)).includes('Saved'), 'The save is acknowledged');
  await clickByLabel('Save chat to…').catch(async () => { await exec(`[...document.querySelectorAll('.assistant-header-actions button')].find(b => b.textContent.trim() === 'Save chat to…').click()`); });
  await wait(50);
  await exec(`[...document.querySelectorAll('.assistant-header-actions button')].find(b => b.textContent.trim() === 'Scratchpad').click()`);
  await wait(200);
  const chatSaved = lastCall('capture:submit')[1];
  assert.equal(chatSaved[0], 'scratchpad');
  assert.ok(chatSaved[1].startsWith('Assistant chat') && chatSaved[1].includes('**You:** plain question') && chatSaved[1].includes('**Assistant:** Regenerated answer.'), 'Saving a chat exports every turn');

  // ======== tool visibility: live status while running, then an inspectable log ========
  await typeAssistant('use tools');
  await click('Send');
  await wait(300);
  const liveText = () => exec(`document.querySelector('.assistant-live-tools')?.textContent ?? ''`);
  assert.ok((await liveText()).includes('Searching your notes') && (await liveText()).includes('query: sprint'), 'A running call says what it is doing, with its arguments');
  assert.ok((await liveText()).includes('Checking Todoist'), 'Parallel calls are listed together');
  assert.equal(await exec(`document.querySelectorAll('.assistant-spinner').length`), 2, 'Running calls show a spinner');
  assert.ok(!(await logText()).includes('Thinking…'), 'No "Thinking…" while tools are visibly running');
  toolResolver();
  await wait(150);
  assert.ok((await liveText()).includes('Searched your notes'), 'A finished call switches to past tense');
  assert.ok((await liveText()).includes('Checked Todoist — failed'), 'A failed call says so');
  assert.equal(await exec(`document.querySelectorAll('.assistant-spinner').length`), 0, 'Nothing spins once every call has finished');
  await wait(400);
  assert.equal(await exec(`document.querySelector('.assistant-live-tools')`), null, 'The live list is replaced by the finished reply');
  assert.ok(await exec(`[...document.querySelectorAll('.assistant-chip')].some(c => c.textContent === 'Notes search') && [...document.querySelectorAll('.assistant-chip')].some(c => c.textContent === 'Todoist failed')`), 'Chips summarise the calls');
  assert.equal(await exec(`document.querySelector('.assistant-tool-log-list')`), null, 'The tool log starts collapsed');
  const lastMsg = `[...document.querySelectorAll('.assistant-msg')].pop()`;
  await exec(`${lastMsg}.querySelector('.assistant-tool-log button').click()`);
  await wait(50);
  assert.ok((await exec(`${lastMsg}.querySelector('.assistant-tool-log').textContent`)).includes('Hide tool details (2)'), 'The toggle counts the calls');
  const entries = await exec(`[...${lastMsg}.querySelectorAll('.assistant-tool-entry')].map(e => ({ text: e.textContent, bad: e.classList.contains('assistant-tool-entry-bad'), code: e.querySelector('code')?.textContent, args: e.querySelector('.assistant-tool-entry-args')?.textContent ?? null, summary: e.querySelector('summary')?.textContent ?? null }))`);
  assert.equal(entries.length, 2);
  assert.deepEqual([entries[0].code, entries[0].args, entries[0].summary, entries[0].bad], ['search_notes', 'query: sprint', 'Result', false], 'Each entry shows the tool, what was asked, and a result');
  assert.deepEqual([entries[1].code, entries[1].args, entries[1].summary, entries[1].bad], ['get_due_tasks', null, 'Error', true], 'A failed call is marked and offers its error');
  assert.ok(entries[1].text.includes('failed'));
  assert.equal(await exec(`${lastMsg}.querySelector('.assistant-tool-entry pre')?.checkVisibility?.() ?? false`), false, 'Results stay folded until asked for');
  await exec(`${lastMsg}.querySelector('.assistant-tool-entry-result summary').click()`);
  await wait(50);
  assert.ok((await exec(`${lastMsg}.querySelector('.assistant-tool-entry pre').textContent`)).includes('Sprint.md'), 'The result is shown as the model saw it');
  await exec(`${lastMsg}.scrollIntoView({ block: 'end' })`);
  await wait(100);
  fs.writeFileSync(path.join(project, 'out/assistant-toollog-smoke.png'), (await win.webContents.capturePage()).toPNG());
  await exec(`${lastMsg}.querySelector('.assistant-tool-log button').click()`);
  await wait(50);
  assert.equal(await exec(`${lastMsg}.querySelector('.assistant-tool-log-list')`), null, 'The log collapses again');
  // A reply with no tools has no log to open, and a declined one marks itself.
  assert.equal(await exec(`[...document.querySelectorAll('.assistant-msg')].filter(m => m.textContent.includes('You have one task due.') && m.querySelector('.assistant-tool-log')).length > 0`), true, 'Replies that used a tool get a log');
  assert.equal(await exec(`[...document.querySelectorAll('.assistant-msg-user')].every(m => !m.querySelector('.assistant-tool-log'))`), true, 'User messages never do');

  // ======== memory tidy: proposal, review, apply, undo — and the refusals ========
  if (!(await exec(`!!document.querySelector('.assistant-memory')`))) await click('Memory');
  await wait(300);
  const tidyButton = `[...document.querySelectorAll('.assistant-memory-tools button')].find(b => b.textContent.trim() === 'Tidy with AI')`;
  assert.equal(await exec(`${tidyButton}.disabled`), false, 'Tidy is available when the saved file has content');
  await exec(`${tidyButton}.click()`);
  await wait(300);
  const preview = await exec(`({ summary: document.querySelector('.assistant-tidy-summary')?.textContent, removed: [...document.querySelectorAll('.assistant-tidy-removed li')].map(l => l.textContent), added: [...document.querySelectorAll('.assistant-tidy-added li')].map(l => l.textContent), textareaShown: !!document.querySelector('.assistant-memory-text'), usage: document.querySelector('.assistant-tidy-usage')?.textContent })`);
  assert.equal(preview.summary, 'Proposed tidy: remove 1, add 2, keep 0');
  assert.deepEqual(preview.removed, ['- 2026-10-12: Likes terse answers']);
  assert.deepEqual(preview.added, ['- 2026-10-12: Prefers terse, short answers', '- 2026-10-13: Lives in Denver']);
  assert.equal(preview.textareaShown, false, 'The proposal replaces the editor while it is being reviewed');
  assert.ok(preview.usage.includes('tokens'), 'The cost of the tidy is shown');
  assert.equal(memoryText, '- 2026-10-12: Likes terse answers', 'Nothing is written by asking for a proposal');
  fs.writeFileSync(path.join(project, 'out/assistant-tidy-preview-smoke.png'), (await win.webContents.capturePage()).toPNG());
  await click('Discard');
  await wait(100);
  assert.equal(calls.filter(([c]) => c === 'assistant:memory:save').length, 0, 'Discard writes nothing');
  assert.equal(await exec(`document.querySelector('.assistant-memory-text').value`), '- 2026-10-12: Likes terse answers');

  // The file changing while the model thinks (a remember, an Obsidian edit) blocks Apply.
  await exec(`${tidyButton}.click()`);
  await wait(300);
  memoryText = '- 2026-10-12: Likes terse answers\n- 2026-10-14: Someone added this meanwhile';
  await click('Apply');
  await wait(300);
  assert.ok((await exec(`document.querySelector('.assistant-memory').textContent`)).includes('Memory changed while the tidy was being prepared'), 'A stale proposal is refused');
  assert.equal(calls.filter(([c]) => c === 'assistant:memory:save').length, 0, 'A refused apply writes nothing');
  memoryText = '- 2026-10-12: Likes terse answers';
  await click('Memory'); await wait(100); await click('Memory'); await wait(300); // reload the pane from disk

  // Apply writes exactly the proposal; Undo restores the previous text.
  await exec(`${tidyButton}.click()`);
  await wait(300);
  await click('Apply');
  await wait(300);
  assert.equal(memoryText, '- 2026-10-12: Prefers terse, short answers\n- 2026-10-13: Lives in Denver\n', 'Apply saves the proposal');
  assert.equal(await exec(`document.querySelector('.assistant-memory-text').value`), memoryText, 'The editor shows the applied text');
  assert.ok((await exec(`document.querySelector('.assistant-memory').textContent`)).includes('Tidied.'), 'Applying offers an undo');
  await exec(`[...document.querySelectorAll('.assistant-memory button')].find(b => b.textContent.trim() === 'Undo').click()`);
  await wait(300);
  assert.equal(memoryText, '- 2026-10-12: Likes terse answers', 'Undo puts the old file back');
  assert.equal(await exec(`document.querySelector('.assistant-memory-text').value`), '- 2026-10-12: Likes terse answers');
  // Tidy refuses to run over unsaved edits, and reports a model failure or "already tidy" plainly.
  await exec(`(() => { const t = document.querySelector('.assistant-memory-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'unsaved edit'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await wait(100);
  assert.equal(await exec(`${tidyButton}.disabled`), true, 'Tidy is disabled while there are unsaved edits (it works on the saved file)');
  await exec(`(() => { const t = document.querySelector('.assistant-memory-text'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, '- 2026-10-12: Likes terse answers'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  tidyMode = 'error';
  await wait(100);
  await exec(`${tidyButton}.click()`);
  await wait(300);
  assert.ok((await exec(`document.querySelector('.assistant-memory').textContent`)).includes('empty file'), 'A failed tidy explains itself');
  tidyMode = 'same';
  await exec(`${tidyButton}.click()`);
  await wait(300);
  assert.ok((await exec(`document.querySelector('.assistant-memory').textContent`)).includes('already tidy'), 'A no-op tidy says so');
  tidyMode = 'ok';
  fs.writeFileSync(path.join(project, 'out/assistant-tidy-smoke.png'), (await win.webContents.capturePage()).toPNG());

  // History: search, pin, rename.
  chatList = [{ id: 'h-1', title: 'Plan the sprint', pinned: false, updatedAt: Date.now() - 86400000 }, { id: 'h-2', title: 'Docker ports question', pinned: false, updatedAt: Date.now() }, { id: 'h-3', title: 'Gift ideas', pinned: false, updatedAt: Date.now() - 5000 }];
  const setSearch = text => exec(`(() => { const i = document.querySelector('.assistant-history-search'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await setSearch('sprint');
  await wait(500);
  assert.deepEqual(lastCall('assistant:chats:list')[1], ['sprint'], 'Search is sent to the store');
  assert.deepEqual(await rowsText(), ['Plan the sprint'], 'Only matching chats are listed');
  await setSearch('zzz');
  await wait(500);
  assert.ok((await exec(`document.querySelector('.assistant-history').textContent`)).includes('No chats match.'));
  await setSearch('');
  await wait(500);
  assert.deepEqual(await rowsText(), ['Docker ports question', 'Gift ideas', 'Plan the sprint']);
  await clickByLabel('Pin chat: Gift ideas');
  await wait(300);
  assert.deepEqual(lastCall('assistant:chats:pin')[1], ['h-3', true]);
  assert.deepEqual(await rowsText(), ['Gift ideas', 'Docker ports question', 'Plan the sprint'], 'A pinned chat moves to the top');
  assert.equal(await exec(`document.querySelectorAll('.assistant-chat-pin').length`), 1, 'A pinned chat is marked');
  await clickByLabel('Rename chat: Docker ports question');
  await wait(100);
  const setRename = text => exec(`(() => { const i = document.querySelector('.assistant-chat-rename'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, ${JSON.stringify(text)}); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await setRename('Ports FAQ');
  await exec(`document.querySelector('.assistant-chat-rename').dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))`);
  await wait(300);
  assert.deepEqual(lastCall('assistant:chats:rename')[1], ['h-2', 'Ports FAQ']);
  assert.ok((await rowsText()).includes('Ports FAQ'), 'The new title shows');
  const renames = calls.filter(([c]) => c === 'assistant:chats:rename').length;
  await clickByLabel('Rename chat: Ports FAQ');
  await wait(100);
  await setRename('Should not be saved');
  await exec(`document.querySelector('.assistant-chat-rename').dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))`);
  await wait(200);
  assert.equal(calls.filter(([c]) => c === 'assistant:chats:rename').length, renames, 'Escape cancels a rename');
  assert.ok((await rowsText()).includes('Ports FAQ'));

  // Settings: standing instructions and the quick-panel hotkey.
  await click('Settings');
  await wait(250);
  const card = `[...document.querySelectorAll('.settings-card')].find(c => c.querySelector('h3')?.textContent === 'Assistant')`;
  assert.equal(await exec(`${card}.querySelector('textarea')?.maxLength`), 4000, 'Instructions field is bounded');
  assert.equal(await exec(`[...${card}.querySelectorAll('.settings-field-row')].find(r => r.textContent.includes('Hotkey')).querySelector('input').value`), 'Cmd+Ctrl+Alt+Shift+A', 'The default hotkey is shown');
  const setField = (selector, text, proto = 'HTMLInputElement') => exec(`(() => { const el = ${card}.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(${proto}.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  const hotkeyInput = `[...${card}.querySelectorAll('.settings-field-row')].find(r => r.textContent.includes('Hotkey')).querySelector('input')`;
  const setHotkey = text => exec(`(() => { const el = ${hotkeyInput}; Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, ${JSON.stringify(text)}); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await setHotkey('NotAReal+Key+Q');
  await wait(100);
  assert.ok(await exec(`${card}.querySelector('.settings-field-error') !== null && ${card}.querySelector('button[type="submit"]').disabled`), 'An invalid hotkey is explained and cannot be saved');
  await setHotkey('Cmd+Alt+J');
  await setField('textarea', 'Be terse. Use metric units.', 'HTMLTextAreaElement');
  // AI titles are on by default, with a separate model for them.
  assert.equal(await exec(`${card}.querySelector('input[type="checkbox"]').checked`), true, 'AI chat titles are on by default');
  const titleModelInput = `[...${card}.querySelectorAll('.settings-field-row')].find(r => r.textContent.includes('Title model')).querySelector('input')`;
  assert.equal(await exec(`${titleModelInput}.placeholder`), '(same as Model)', 'A blank title model means the main model');
  assert.equal(await exec(`${titleModelInput}.disabled`), false);
  await setField('input[placeholder="(same as Model)"]', 'cheap/model');
  assert.equal(await exec(`${card}.querySelectorAll('input[type="checkbox"]')[1].checked`), true, 'Memory writes ask for confirmation by default');
  await exec(`${card}.querySelectorAll('input[type="checkbox"]')[1].click()`);
  await exec(`${card}.querySelector('input[type="checkbox"]').click()`);
  await wait(100);
  assert.equal(await exec(`${titleModelInput}.disabled`), true, 'The title model is greyed out when AI titles are off');
  await exec(`${card}.requestSubmit()`);
  await wait(300);
  const savedSettings = lastCall('settings:assistant:update')[1][0];
  assert.equal(savedSettings.quickHotkey, 'Cmd+Alt+J');
  assert.equal(savedSettings.systemPrompt, 'Be terse. Use metric units.');
  assert.equal(savedSettings.autoTitle, false, 'Turning AI titles off is saved explicitly');
  assert.equal(savedSettings.titleModel, 'cheap/model');
  assert.equal(savedSettings.askBeforeRemember, false, 'Relaxing the memory confirmation is saved explicitly');
  await setHotkey('');
  await exec(`${card}.requestSubmit()`);
  await wait(300);
  assert.equal(lastCall('settings:assistant:update')[1][0].quickHotkey, '', 'Clearing the hotkey saves an explicit "off", not the default');
  assert.equal(lastCall('settings:assistant:update')[1][0].autoTitle, false, 'An unrelated save keeps AI titles off');
  await exec(`document.querySelector('.settings-close').click()`);
  await wait(100);

  // The quick panel is its own window and entry point.
  const quick = new BrowserWindow({ show: true, width: 700, height: 560, webPreferences: { preload: path.join(project, 'out/preload/index.js'), contextIsolation: true, nodeIntegration: false } });
  const quickErrors = [];
  quick.webContents.on('console-message', (_, level, message) => { if (level >= 3) quickErrors.push(message); });
  await quick.loadFile(path.join(project, 'out/renderer/assistant-quick.html'));
  await wait(500);
  const qexec = code => quick.webContents.executeJavaScript(code);
  quick.webContents.send('app:command', { type: 'assistantPanelShown' });
  await wait(200);
  assert.ok((await qexec(`document.querySelector('.assistant-log').textContent`)).includes('Ask about your tasks'), 'The panel opens empty');
  assert.equal(await qexec(`document.activeElement === document.querySelector('.assistant-input')`), true, 'The composer has keyboard focus when summoned');
  await qexec(`(() => { const t = document.querySelector('.assistant-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'quick question'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await qexec(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send').click()`);
  await wait(900);
  assert.ok((await qexec(`document.querySelector('.assistant-log').textContent`)).includes('You have one task due.'), 'The panel streams and shows a reply');
  assert.equal(await qexec(`!!document.querySelector('.assistant-history, .assistant-memory')`), false, 'History and memory stay in the dashboard');
  fs.writeFileSync(path.join(project, 'out/assistant-quick-smoke.png'), (await quick.webContents.capturePage()).toPNG());
  await qexec(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))`);
  await wait(100);
  assert.ok(calls.some(([c]) => c === 'assistant:hidePanel'), 'Escape hides the panel');
  // Re-summoning starts a fresh chat when nothing is in flight.
  quick.webContents.send('app:command', { type: 'assistantPanelShown' });
  await wait(200);
  assert.ok((await qexec(`document.querySelector('.assistant-log').textContent`)).includes('Ask about your tasks'), 'Each summon starts fresh');
  // "Open in dashboard" hands over a chat that exists.
  await qexec(`(() => { const t = document.querySelector('.assistant-input'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(t, 'another one'); t.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await qexec(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Send').click()`);
  await wait(900);
  await qexec(`[...document.querySelectorAll('button')].find(b => b.textContent.trim() === 'Open in dashboard').click()`);
  await wait(100);
  assert.equal(lastCall('assistant:openInDashboard')[1][0], 'conv-1', 'Open in dashboard names the chat');
  assert.deepEqual(quickErrors, [], 'The quick panel logs no errors');
  quick.destroy();

  // The dashboard obeys the handoff: switches to the tab and opens that chat; settings on request.
  await click('Stats');
  await wait(200);
  assert.equal(await exec(`getComputedStyle(document.querySelector('.grid-assistant')).display`), 'none', 'Assistant tab is hidden while another tab shows');
  win.webContents.send('app:command', { type: 'openAssistantChat', chatId: 'h-1' });
  await wait(400);
  assert.notEqual(await exec(`getComputedStyle(document.querySelector('.grid-assistant')).display`), 'none', 'The handoff switches to the Assistant tab');
  assert.deepEqual(lastCall('assistant:chats:open')[1], ['h-1'], 'The handoff opens that chat');
  win.webContents.send('app:command', { type: 'openAssistantChat', chatId: null, openSettings: true });
  await wait(300);
  assert.equal(await exec(`document.querySelector('.settings-nav-item.active')?.textContent`), 'Assistant', 'A setup error from the panel opens Assistant settings');
  await exec(`document.querySelector('.settings-close').click()`);
  await wait(100);

  // A title written after the reply reloads the history list (and only then).
  const listCalls = () => calls.filter(([c]) => c === 'assistant:chats:list').length;
  const before = listCalls();
  chatList = chatList.map(c => c.id === 'h-1' ? { ...c, title: 'AI-written title' } : c);
  win.webContents.send('app:command', { type: 'assistantChatTitled', chatId: 'h-1' });
  await wait(400);
  assert.equal(listCalls(), before + 1, 'A landed title reloads the chat list');
  assert.ok((await rowsText()).includes('AI-written title'), 'The new title shows without any user action');
  fs.writeFileSync(path.join(project, 'out/assistant-smoke.png'), (await win.webContents.capturePage()).toPNG());
  await click('Stats');
  await wait(1200);
  win.hide();
  await wait(500);
  const hiddenCount = calls.filter(([c]) => c === 'stats:system').length;
  await wait(1500);
  assert.equal(calls.filter(([c]) => c === 'stats:system').length, hiddenCount, 'Hidden window should pause stats');
  assert.ok(calls.filter(([c]) => c === 'process:statusAll').length >= 3, 'Background status continues');
  assert.equal(calls.filter(([c]) => c === 'ynab:accounts').length, 0, 'Off-tab finance details stay idle');
  assert.deepEqual(errors, []);
  console.log('Renderer smoke passed: Projects CRUD/filter/archive, Assistant chat/memory, tasks, note autosave/conflicts/modal, existing tabs and polling, no console errors');
  win.destroy();
  fs.rmSync(userData, { recursive: true, force: true });
  app.exit(0);
}).catch(error => { console.error(error); console.error(errors); app.exit(1); });
