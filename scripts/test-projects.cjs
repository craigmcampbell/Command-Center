// Exercise the real SQLite services in Electron's native-module runtime.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-projects-'));
  const output = path.join(__dirname, '../out/main/projects-test.cjs');
  try {
    await require('esbuild').build({
      stdin: { contents: `export * from './src/main/services/projects'; export * from './src/main/services/db'; export * from './src/main/services/settings';`, resolveDir: path.join(__dirname, '..') },
      outfile: output, bundle: true, platform: 'node', format: 'cjs', external: ['better-sqlite3'],
      plugins: [{ name: 'test-userdata', setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
        build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const app = { getPath: () => ${JSON.stringify(root)} };` }));
      } }],
    });
    const api = require(output);
    api.initDatabase(); api.initSettings(); api.initProjects();
    const db = api.getDatabase();
    db.prepare("UPDATE tabs SET label = 'My Home', sort_order = 99 WHERE id = 'home'").run();
    db.prepare("DELETE FROM tabs WHERE id = 'projects'").run();
    api.initSettings();
    assert.equal(api.listTabSettings().find(t => t.id === 'home').label, 'My Home');
    assert.equal(api.listTabSettings().at(-1).id, 'projects');
    const input = { name: 'App', folder: '/code/app', status: 'active', pinned: false, githubUrl: 'https://github.com/test/app', todoistTaskId: 'abc123', note: { vaultLabel: 'Test', filePath: 'App.md' }, links: [{ label: 'Local', url: 'http://localhost:3000' }], processIds: ['web'], containerNames: ['db'] };
    let projects = api.saveProject(input);
    const first = projects[0];
    assert.equal(first.name, 'App'); assert.ok(first.repoId);
    assert.equal(api.listGithubRepoSettings().length, 1);
    api.saveProject({ ...first, pinned: true, status: 'paused' }, first.id);
    assert.equal(api.listGithubRepoSettings().length, 1);
    projects = api.saveProject({ ...input, name: 'Shared' });
    assert.equal(projects[1].repoId, first.repoId);
    assert.equal(api.listGithubRepoSettings().length, 1);
    projects = api.reorderProjects(projects.map(p => p.id).reverse());
    assert.equal(projects[0].name, 'Shared');
    assert.throws(() => api.reorderProjects([first.id, first.id]));
    assert.throws(() => api.saveProject({ ...input, folder: 'relative' }));
    assert.throws(() => api.saveProject({ ...input, links: [{ label: 'Bad', url: 'javascript:alert(1)' }] }));
    assert.equal(api.normalizeProject({ ...input, todoistTaskId: 'https://app.todoist.com/app/task/build-app-abc123' }).todoistTaskId, 'abc123');
    api.saveProject({ ...first, status: 'archived' }, first.id);
    api.initProjects();
    assert.equal(api.listProjects().find(p => p.id === first.id).status, 'archived');
    api.removeProject(first.id);
    assert.equal(api.listGithubRepoSettings().length, 1, 'Removing a project preserves its repo');
    assert.equal(api.listProjects().length, 1);
    db.close();
    console.log('Projects SQLite smoke passed: CRUD, shared associations, reorder, archive, migration, validation');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(output, { force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
