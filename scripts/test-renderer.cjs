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
let activeTimer = null;

const channels = [...fs.readFileSync(path.join(project, 'src/preload/index.ts'), 'utf8').matchAll(/ipcRenderer.invoke\("([^"]+)"/g)].map(m => m[1]);
const note = (id) => ({ id, vaultLabel: 'Test', filePath: `${id}.md`, label: `Note ${id}`, sortOrder: id });
for (const channel of new Set(channels)) ipcMain.handle(channel, (_, ...args) => {
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
  console.log('Renderer smoke passed: Projects CRUD/filter/archive, tasks, note autosave/conflicts/modal, existing tabs and polling, no console errors');
  win.destroy();
  fs.rmSync(userData, { recursive: true, force: true });
  app.exit(0);
}).catch(error => { console.error(error); console.error(errors); app.exit(1); });
