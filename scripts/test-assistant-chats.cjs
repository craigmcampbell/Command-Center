// Exercise the real SQLite chat store in Electron's native-module runtime.
// (vitest runs under host Node, which can't load better-sqlite3's Electron build.)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cc-assistant-chats-'));
  const output = path.join(__dirname, '../out/main/assistant-chats-test.cjs');
  try {
    await require('esbuild').build({
      stdin: { contents: `export * from './src/main/services/assistantChats'; export * from './src/main/services/assistantCommands'; export * from './src/main/services/db';`, resolveDir: path.join(__dirname, '..') },
      outfile: output, bundle: true, platform: 'node', format: 'cjs', external: ['better-sqlite3'],
      plugins: [{ name: 'test-userdata', setup(build) {
        build.onResolve({ filter: /^electron$/ }, () => ({ path: 'electron', namespace: 'test' }));
        build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const app = { getPath: () => ${JSON.stringify(root)} };` }));
      } }],
    });
    // Skills are looked up under the home folder.
    process.env.HOME = root;
    fs.mkdirSync(path.join(root, '.agents', 'skills', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'skills', 'demo', 'SKILL.md'), '---\nname: demo\ndescription: A demo skill\n---\nDO THE DEMO');
    const api = require(output);
    api.initDatabase();
    const db = api.getDatabase();

    // A database from the first version of this feature: no pin/search/usage
    // columns yet. The migration must add them and backfill search text.
    db.exec(`CREATE TABLE assistant_chats (id TEXT PRIMARY KEY, title TEXT NOT NULL, messages TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
    db.prepare(`INSERT INTO assistant_chats VALUES (?, ?, ?, 1, 1)`).run('legacy', 'Old chat', JSON.stringify([
      { role: 'user', content: 'tell me about kubernetes' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', type: 'function', function: { name: 'docker_status', arguments: '{"secretword":1}' } }] },
      { role: 'tool', tool_call_id: 'c', content: '{"containers":["hiddenpayload"]}' },
      { role: 'assistant', content: 'It orchestrates containers.' },
    ]));
    api.initAssistantChats();
    api.initAssistantChats(); // idempotent: runs every boot
    const legacy = api.loadChat('legacy');
    assert.equal(legacy.pinned, false);
    assert.deepEqual(legacy.usage, { promptTokens: 0, completionTokens: 0, costUsd: null }, 'Old chats start with no usage, not zero cost');
    assert.deepEqual(api.listChats('kubernetes').map(c => c.id), ['legacy'], 'Backfilled search text finds what was said');
    assert.deepEqual(api.listChats('hiddenpayload'), [], 'Tool payloads are never searchable');
    assert.deepEqual(api.listChats('secretword'), [], 'Tool-call arguments are never searchable');
    // The JSON column was copied into message rows, and is left as a backup.
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM assistant_messages WHERE chat_id = 'legacy'`).get().n, 4, 'Legacy messages were migrated to rows');
    assert.equal(legacy.messages.length, 4);
    assert.deepEqual(legacy.messages[1].tool_calls[0].function.name, 'docker_status', 'Tool calls survive the migration');
    assert.equal(legacy.messages[1].content, null, 'A null assistant content stays null');
    assert.notEqual(db.prepare(`SELECT messages FROM assistant_chats WHERE id = 'legacy'`).get().messages, '[]', 'The original JSON is kept as a backup');
    db.prepare(`UPDATE assistant_messages SET content = 'EDITED' WHERE chat_id = 'legacy' AND seq = 0`).run();
    api.initAssistantChats();
    assert.equal(api.loadChat('legacy').messages[0].content, 'EDITED', 'Booting again never re-migrates a chat that already has rows');
    db.exec(`DELETE FROM assistant_chats`);
    db.exec(`DELETE FROM assistant_messages`);

    // A message table from before slash commands lacks the command columns.
    db.exec(`DROP TABLE assistant_messages`);
    db.exec(`CREATE TABLE assistant_messages (chat_id TEXT NOT NULL, seq INTEGER NOT NULL, role TEXT NOT NULL, content TEXT, tool_calls TEXT, tool_call_id TEXT, archived INTEGER NOT NULL DEFAULT 0, summary INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (chat_id, seq)) WITHOUT ROWID`);
    api.initAssistantChats();
    const cmdMessages = [{ role: 'user', content: 'tidy this', command: 'demo', injected: '<skill>DO THE DEMO</skill>' }, { role: 'assistant', content: 'Done.' }, { role: 'user', content: 'thanks' }];
    api.saveChat('cmd', 'Command chat', cmdMessages);
    assert.deepEqual(api.loadChat('cmd').messages, cmdMessages, 'A command and its injected instructions round-trip; plain messages gain no fields');
    assert.deepEqual(api.listChats('DO THE DEMO'), [], 'Injected instructions are not searchable');
    api.deleteChat('cmd');

    // Attachments: stored as JSON on the message, round-trip exactly, and a
    // shared image is only unreferenced once every chat using it is gone.
    const A = 'a'.repeat(64), B = 'b'.repeat(64);
    const image = (id, name) => ({ id, name, mime: 'image/png', kind: 'image', size: 12 });
    const textFile = { id: 'c'.repeat(64), name: 'n.md', mime: 'text/markdown', kind: 'text', size: 5, text: 'Hello', truncated: true };
    api.saveChat('att1', 'One', [{ role: 'user', content: 'look', attachments: [image(A, 'x.png'), textFile] }, { role: 'assistant', content: 'ok' }]);
    api.saveChat('att2', 'Two', [{ role: 'user', content: '', attachments: [image(A, 'same.png'), image(B, 'y.png')] }]);
    assert.deepEqual(api.loadChat('att1').messages[0].attachments, [image(A, 'x.png'), textFile], 'Attachments round-trip, including inline text');
    assert.equal(api.loadChat('att1').messages[1].attachments, undefined, 'Other messages gain no attachments field');
    assert.deepEqual(api.chatImageIds('att1'), [A], 'Only images are listed, not text files');
    assert.deepEqual(api.chatImageIds('att2').sort(), [A, B]);
    assert.equal(api.isAttachmentReferenced(A), true);
    api.deleteChat('att2');
    assert.equal(api.isAttachmentReferenced(A), true, 'An image another chat still uses is kept');
    assert.equal(api.isAttachmentReferenced(B), false);
    api.deleteChat('att1');
    assert.equal(api.isAttachmentReferenced(A), false);
    assert.equal(api.isAttachmentReferenced('not hex'), false, 'A malformed id matches nothing');
    assert.deepEqual(api.listChats('Hello'), [], 'Attached text is not searchable');

    // Slash commands: skills from disk and saved prompts, each off until enabled.
    api.initAssistantCommands();
    api.initAssistantCommands();
    let settings = await api.getCommandSettings();
    assert.deepEqual(settings.skills, [{ name: 'demo', description: 'A demo skill', enabled: false, tools: null }], 'A found skill starts switched off');
    assert.equal(await api.resolveCommand('demo'), null, 'An off skill cannot be run');
    assert.deepEqual(await api.listEnabledCommands(), []);
    assert.deepEqual(await api.setSkillSetting('demo', { enabled: true, tools: null }), { ok: true });
    const resolved = await api.resolveCommand('demo');
    assert.equal(resolved.kind, 'skill');
    assert.equal(resolved.tools, null, 'No allowlist means the read-only default');
    assert.match(resolved.injected, /DO THE DEMO/);
    assert.deepEqual(await api.listEnabledCommands(), [{ name: 'demo', description: 'A demo skill', kind: 'skill' }]);
    await api.setSkillSetting('demo', { enabled: true, tools: ['get_due_tasks', 'create_task', 'not a tool!'] });
    assert.deepEqual((await api.resolveCommand('demo')).tools, ['get_due_tasks', 'create_task'], 'An allowlist persists, malformed names dropped');
    assert.equal((await api.setSkillSetting('missing', { enabled: true, tools: null })).ok, false, 'Only skills that exist can be enabled');
    fs.rmSync(path.join(root, '.agents', 'skills', 'demo'), { recursive: true });
    assert.equal(await api.resolveCommand('demo'), null, 'A skill deleted from disk stops working');
    assert.deepEqual(await api.listEnabledCommands(), []);

    assert.equal((await api.savePromptCommand({ name: 'Plan Day', description: '', prompt: 'x', enabled: true, tools: null })).ok, false, 'Names cannot contain spaces');
    assert.equal((await api.savePromptCommand({ name: 'plan', description: '', prompt: '   ', enabled: true, tools: null })).ok, false, 'A prompt is required');
    assert.deepEqual(await api.savePromptCommand({ name: 'Plan', description: 'Plan my day', prompt: 'Plan my day from my tasks.', enabled: true, tools: null }), { ok: true });
    assert.equal((await api.resolveCommand('plan')).kind, 'prompt');
    assert.match((await api.resolveCommand('plan')).injected, /Plan my day from my tasks/);
    await api.savePromptCommand({ name: 'plan', description: 'Plan my day', prompt: 'Updated.', enabled: false, tools: null });
    assert.equal(await api.resolveCommand('plan'), null, 'A prompt can be switched off');
    assert.equal(api.listCommandRows().length, 2, 'Saving the same name updates it');
    fs.mkdirSync(path.join(root, '.agents', 'skills', 'clash'), { recursive: true });
    fs.writeFileSync(path.join(root, '.agents', 'skills', 'clash', 'SKILL.md'), '---\ndescription: c\n---\nBody');
    assert.equal((await api.savePromptCommand({ name: 'clash', description: '', prompt: 'x', enabled: true, tools: null })).ok, false, 'A prompt cannot shadow a skill');
    assert.equal(api.removePromptCommand('demo').ok, false, 'Only prompts can be deleted here');
    assert.equal(api.removePromptCommand('plan').ok, true);
    assert.equal(api.getCommandRow('plan'), null);

    assert.deepEqual(api.listChats(), []);
    assert.equal(api.loadChat('missing'), null);

    const first = [{ role: 'user', content: 'hi' }, { role: 'assistant', content: 'Hello.', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'get_due_tasks', arguments: '{}' } }] }, { role: 'tool', tool_call_id: 'c1', content: '{"total":0}' }];
    api.saveChat('a', 'First chat', first, { promptTokens: 100, completionTokens: 20, costUsd: 0.5 });
    const a = api.loadChat('a');
    assert.deepEqual(a.messages, first, 'Tool-call messages round-trip exactly');
    assert.equal(a.title, 'First chat');

    assert.equal(db.prepare(`SELECT messages FROM assistant_chats WHERE id = 'a'`).get().messages, '[]', 'New chats do not write the old JSON column');

    // Compaction flags and the summary message round-trip, in order.
    const compacted = [
      { role: 'user', content: 'old question', archived: true },
      { role: 'assistant', content: 'old answer', archived: true },
      { role: 'system', content: 'The summary.', summary: true },
      { role: 'user', content: 'new question' },
    ];
    api.saveChat('cmp', 'Compacted', compacted);
    assert.deepEqual(api.loadChat('cmp').messages, compacted, 'archived and summary flags round-trip');
    api.saveChat('cmp', 'Compacted', [...compacted.slice(0, 3), { role: 'user', content: 'again' }]);
    assert.equal(api.loadChat('cmp').messages.length, 4, 'A save replaces the messages rather than appending');
    assert.deepEqual(api.listChats('summary'), [], 'The summary is not searchable text');
    api.deleteChat('cmp');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM assistant_messages WHERE chat_id = 'cmp'`).get().n, 0, 'Deleting a chat deletes its message rows');

    // A later turn replaces the messages, ADDS usage, and leaves the title alone
    // (that is the user's to change) and created_at as it was.
    db.prepare(`UPDATE assistant_chats SET created_at = 1000, updated_at = 1000 WHERE id = 'a'`).run();
    api.saveChat('a', 'IGNORED TITLE', [...first, { role: 'user', content: 'again' }], { promptTokens: 50, completionTokens: 5, costUsd: 0.25 });
    const a2 = api.loadChat('a');
    assert.equal(a2.title, 'First chat', 'A rewrite never overwrites the title');
    assert.equal(a2.messages.length, 4);
    assert.deepEqual(a2.usage, { promptTokens: 150, completionTokens: 25, costUsd: 0.75 }, 'Usage accumulates across turns');
    assert.equal(db.prepare(`SELECT created_at FROM assistant_chats WHERE id = 'a'`).get().created_at, 1000, 'created_at survives a rewrite');
    assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM assistant_chats`).get().n, 1, 'Saving an existing id replaces it');

    // Unknown cost stays unknown instead of becoming a free-looking 0.
    api.saveChat('nocost', 'No cost', [{ role: 'user', content: 'x' }], { promptTokens: 5, completionTokens: 1, costUsd: null });
    assert.equal(api.loadChat('nocost').usage.costUsd, null);
    api.saveChat('nocost', 'No cost', [{ role: 'user', content: 'x' }], { promptTokens: 5, completionTokens: 1, costUsd: null });
    assert.equal(api.loadChat('nocost').usage.costUsd, null, 'Still null after more turns without a cost');
    api.saveChat('nocost', 'No cost', [{ role: 'user', content: 'x' }], { promptTokens: 1, completionTokens: 1, costUsd: 0.1 });
    assert.equal(api.loadChat('nocost').usage.costUsd, 0.1, 'A reported cost is counted from the first one reported');
    api.deleteChat('nocost');

    // Ordering: newest first, pinned above everything.
    api.saveChat('b', 'Second chat', [{ role: 'user', content: 'yo' }]);
    db.prepare(`UPDATE assistant_chats SET updated_at = 2000 WHERE id = 'b'`).run();
    db.prepare(`UPDATE assistant_chats SET updated_at = 1500 WHERE id = 'a'`).run();
    assert.deepEqual(api.listChats().map(c => c.id), ['b', 'a'], 'Newest first');
    assert.equal(api.setChatPinned('a', true), true);
    assert.deepEqual(api.listChats().map(c => [c.id, c.pinned]), [['a', true], ['b', false]], 'Pinned chats come first');
    assert.equal(db.prepare(`SELECT updated_at FROM assistant_chats WHERE id = 'a'`).get().updated_at, 1500, 'Pinning does not reorder by recency');
    assert.equal(api.setChatPinned('a', false), true);
    assert.equal(api.setChatPinned('nope', true), false);

    // Rename.
    assert.equal(api.renameChat('a', '  Sprint   planning\n'), true);
    assert.equal(api.loadChat('a').title, 'Sprint planning', 'Whitespace is normalised');
    assert.equal(api.renameChat('a', '   '), false, 'A blank title is refused');
    assert.equal(api.loadChat('a').title, 'Sprint planning');
    assert.equal(api.renameChat('a', 'x'.repeat(300)), true);
    assert.equal(api.loadChat('a').title.length, 120, 'Titles are capped');
    api.renameChat('a', 'Sprint planning');
    assert.equal(api.renameChat('nope', 'x'), false);
    api.saveChat('a', 'ignored', [...first, { role: 'user', content: 'once more' }]);
    assert.equal(api.loadChat('a').title, 'Sprint planning', 'A rename survives later replies');

    // Search: every term, in the title or in what was said.
    api.saveChat('c', 'Docker ports', [{ role: 'user', content: 'which port does postgres use?' }, { role: 'assistant', content: 'Usually 5432.' }]);
    assert.deepEqual(api.listChats('sprint').map(c => c.id), ['a'], 'Matches the title');
    assert.deepEqual(api.listChats('postgres').map(c => c.id), ['c'], 'Matches what was said');
    assert.deepEqual(api.listChats('docker postgres').map(c => c.id), ['c'], 'Terms are ANDed across title and text');
    assert.deepEqual(api.listChats('docker sprint'), [], 'A term that matches nothing excludes the chat');
    assert.deepEqual(api.listChats('POSTGRES').map(c => c.id), ['c'], 'Case-insensitive');
    api.saveChat('d', '100% done', [{ role: 'user', content: 'snake_case or camelCase' }]);
    assert.deepEqual(api.listChats('100%').map(c => c.id), ['d'], 'A literal % is not a wildcard');
    assert.deepEqual(api.listChats('snake_case').map(c => c.id), ['d'], 'A literal _ is not a wildcard');
    assert.deepEqual(api.listChats('snake-case'), [], '… and _ does not match other characters');
    assert.deepEqual(api.listChats("'; DROP TABLE assistant_chats; --"), [], 'Queries are parameterised');
    assert.equal(api.listChats().length, 4);
    assert.deepEqual(api.listChats('   ').length, 4, 'A blank query lists everything');

    // AI titles: the upgrade only replaces the placeholder it was computed
    // against, in one statement — so a rename made meanwhile always wins.
    api.saveChat('t', 'what is due today', [{ role: 'user', content: 'what is due today' }, { role: 'assistant', content: 'Two tasks.' }], { promptTokens: 100, completionTokens: 20, costUsd: 0.002 });
    assert.equal(api.renameChatIfUnchanged('t', 'what is due today', '  Due   tasks overview '), true);
    assert.equal(api.loadChat('t').title, 'Due tasks overview', 'The placeholder is replaced, whitespace normalised');
    assert.equal(api.renameChatIfUnchanged('t', 'what is due today', 'Stale second attempt'), false, 'A title computed against an old placeholder does not apply');
    api.renameChat('t', 'My own name');
    assert.equal(api.renameChatIfUnchanged('t', 'Due tasks overview', 'AI title that lost the race'), false, 'A user rename wins over an in-flight AI title');
    assert.equal(api.loadChat('t').title, 'My own name');
    assert.equal(api.renameChatIfUnchanged('t', 'My own name', '   '), false, 'A blank title is never applied');
    assert.equal(api.renameChatIfUnchanged('nope', 'x', 'y'), false);
    assert.equal(api.loadChat('t').messages.length, 2, 'Titling never touches the messages');
    db.prepare(`UPDATE assistant_chats SET updated_at = 4242 WHERE id = 't'`).run();
    api.renameChatIfUnchanged('t', 'My own name', 'Renamed again');
    assert.equal(db.prepare(`SELECT updated_at FROM assistant_chats WHERE id = 't'`).get().updated_at, 4242, 'A retitle does not move the chat up the list');

    // The title request's spend is added to the chat without disturbing anything else.
    assert.equal(api.addChatUsage('t', { promptTokens: 30, completionTokens: 4, costUsd: 0.0001 }), true);
    assert.deepEqual(api.loadChat('t').usage, { promptTokens: 130, completionTokens: 24, costUsd: 0.0021 });
    assert.equal(db.prepare(`SELECT updated_at FROM assistant_chats WHERE id = 't'`).get().updated_at, 4242, 'Adding usage does not reorder the list');
    assert.equal(api.addChatUsage('t', { promptTokens: 5, completionTokens: 1, costUsd: null }), true);
    assert.deepEqual(api.loadChat('t').usage, { promptTokens: 135, completionTokens: 25, costUsd: 0.0021 }, 'An unreported cost leaves the total alone');
    api.saveChat('t-free', 'No cost yet', [{ role: 'user', content: 'x' }], { promptTokens: 1, completionTokens: 1, costUsd: null });
    api.addChatUsage('t-free', { promptTokens: 1, completionTokens: 1, costUsd: null });
    assert.equal(api.loadChat('t-free').usage.costUsd, null, 'Still unknown, not a free-looking zero');
    assert.equal(api.addChatUsage('gone', { promptTokens: 1, completionTokens: 1, costUsd: 0.1 }), false, 'A chat deleted meanwhile is simply not found');
    api.deleteChat('t');
    api.deleteChat('t-free');

    // A corrupt row reads as missing rather than breaking the list or the load.
    db.prepare(`INSERT INTO assistant_messages (chat_id, seq, role, content, tool_calls) VALUES ('b', 99, 'assistant', NULL, 'not json')`).run();
    assert.equal(api.loadChat('b'), null);
    assert.equal(api.listChats().length, 4, 'The list never parses message bodies');

    assert.equal(api.deleteChat('b'), true);
    assert.equal(api.deleteChat('b'), false, 'Deleting twice reports nothing deleted');
    assert.equal(api.listChats().length, 3);
    db.close();
    console.log('Assistant chats SQLite smoke passed: migration to message rows, compaction flags, slash commands, attachments, upsert, usage, pin, rename, AI-title guard, search, corrupt row, delete');
  } finally { fs.rmSync(root, { recursive: true, force: true }); fs.rmSync(output, { force: true }); }
})().catch(error => { console.error(error); process.exit(1); });
