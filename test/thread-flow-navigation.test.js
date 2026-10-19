/* Thread UX regressions: delegated participation stays findable without exposing worker storage, and polling that
   adopts thread metadata keeps that index current; shared files keep their author and the version that belonged to
   the reply. Live DOM proof is separate. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');
const W = require('../frontend/app/workstreams.js');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
function fn(src, name) {
  const hit = new RegExp('^( {0,4})(?:async )?function ' + name + '\\([^]*?\\n\\1\\}', 'm').exec(src);
  if (!hit) throw new Error('Missing function ' + name);
  return hit[0];
}

/* The parent remains the one conversation in every view, including after work finishes or archives. */
W.init({ generalId: 'general', activeId: 'general', workstreams: [
  { id: 'general', title: null, agentId: 'nova', kind: 'chat' },
  { id: 'launch', title: 'Launch', agentId: 'nova', kind: 'chat' },
  { id: 'mira-work', title: 'Compare prices', agentId: 'mira', worker: true, parentStreamId: 'launch',
    runIds: ['mira-run'], lastRunOk: true, history: [{ role: 'assistant', content: 'Competitor pricing is 19.' }] },
  { id: 'rook-work', title: 'Check code', agentId: 'rook', worker: true, parentStreamId: 'launch', history: [] },
  { id: 'agent-created', title: 'Side research', agentId: 'mira', parentStreamId: 'general', history: [] }
] });
const visibleFor = (id, includeArchived = false) => W.list({ includeArchived }).filter(w => W.hasAgent(w, id)).map(w => w.id).sort();
A.eq(visibleFor('mira'), ['agent-created', 'launch'], 'completed delegated work lists the parent under its worker, never the storage row');
A.eq(visibleFor('rook'), ['launch'], 'each worker can find the conversation that holds their work');
A.ok(!W.hasAgent(W.get('general'), 'mira'), 'a session the agent created with a parent link does not imply delegated participation');
const hits = W.search('Competitor').filter(h => W.hasAgent(W.get(h.id), 'mira'));
A.eq(hits.map(h => [h.id, h.workerId]), [['launch', 'mira-work']], 'worker-scoped search keeps its parent hit and exact worker reveal target');
W.archive('launch');
A.eq(visibleFor('mira'), ['agent-created'], 'archiving the parent hides it from the worker open-session view');
A.eq(visibleFor('mira', true), ['agent-created', 'launch'], 'the same archived parent is discoverable under its worker');
W.archive('mira-work'); W.archive('launch', false);
A.eq(visibleFor('mira'), ['agent-created', 'launch'], 'legacy archive state on hidden storage does not hide a visible parent receipt');
W.init(JSON.parse(JSON.stringify(W.serialize())));
A.ok(W.hasAgent(W.get('launch'), 'mira'), 'participation survives save/reload');
W.adopt({ id: 'vex-work', worker: true, parentStreamId: 'launch', agentId: 'vex' });
A.ok(W.hasAgent(W.get('launch'), 'vex'), 'a newly delegated worker invalidates the participation index');
W.setAgent('vex-work', 'finn');
A.ok(!W.hasAgent(W.get('launch'), 'vex') && W.hasAgent(W.get('launch'), 'finn'), 'rebinding a worker updates both old and new participation');
W.del('vex-work');
A.ok(!W.hasAgent(W.get('launch'), 'finn'), 'deleting a worker removes its participation');
W.del('launch');
A.eq(W.search('Competitor'), [], 'deleting the parent removes its worker search results');
A.ok(!W.get('mira-work') && !W.get('rook-work'), 'deleting the conversation removes its hidden worker records');
W.adopt({ id: 'launch', agentId: 'nova', revive: true });
A.ok(!W.hasAgent(W.get('launch'), 'mira'), 'reviving a parent never resurrects deleted worker membership');
W.reset();
A.ok(!W.hasAgent({ id: 'launch', agentId: 'nova' }, 'mira'), 'reset clears participation');

/* An attention shortcut follows the actual asker, not every past participant in that conversation. */
W.adopt({ id: 'home', agentId: 'nova' });
W.adopt({ id: 'm', agentId: 'mira', worker: true, parentStreamId: 'home' });
W.adopt({ id: 'r', agentId: 'rook', worker: true, parentStreamId: 'home' });
let asks = [{ agentId: 'nova', workerAgentId: 'rook' }];
const waiting = new Function('Workstreams', 'Channels', 'railPendingIds', 'railHasAgent', fn(read('frontend/app/app.js'), 'waitingSessionOf') + ';return waitingSessionOf;')(
  W, { pendingAllOf: () => asks }, () => ['home'], (w, id) => W.hasAgent(w, id));
A.eq(waiting('mira'), null, 'MIRA is not routed to a former crewmate\'s approval');
A.eq(waiting('rook'), 'home', 'ROOK is routed to the parent carrying ROOK\'s stamped ask');
A.eq(waiting('nova'), null, 'the lead stamp does not misattribute a worker ask');
asks.push({ agentId: 'nova', workerAgentId: 'mira' });
A.eq(waiting('mira'), 'home', 'the second pending worker ask is found too');
asks = [{ agentId: 'nova' }];
A.eq(waiting('nova'), 'home', 'ordinary direct asks still route to the lead');

/* Real group ledger shape: immutable versions append, each message carries author/run/sequence. */
const g = { id: 'g', messages: [
  { id: 'm1', author: 'mira', runId: 'r1', seq: 2, at: 20 },
  { id: 'm2', author: 'mira', runId: 'r2', seq: 4, at: 40 },
  { id: 'm3', author: 'rook', runId: 'r3', seq: 6, at: 60 },
  { id: 'm4', author: 'mira', runId: 'r4', seq: 8, at: 80 },
  { id: 'm0', author: 'mira', seq: 1, at: 1 }
], artifacts: [
  { id: 'mira-old', sourcePath: 'out/report.md', name: 'report.md', agentId: 'mira', runId: 'r1', messageSeq: 1, createdAt: 10 },
  { id: 'mira-new', sourcePath: 'out/report.md', name: 'report.md', agentId: 'mira', runId: 'r2', messageSeq: 3, createdAt: 30 },
  { id: 'rook-own', sourcePath: 'out/report.md', name: 'report.md', agentId: 'rook', runId: 'r3', messageSeq: 5, createdAt: 50 }
] };
const gc = read('frontend/app/group-chat.js');
const sharedFor = new Function('group', fn(gc, 'sharedFor') + ';return sharedFor;')(g);
const pick = (m, author = 'mira', p = 'out/report.md') => sharedFor('g', p, author, m)?.id || null;
A.eq(pick('m1'), 'mira-old', 'old reply retains its published version after later edits');
A.eq(pick('m2'), 'mira-new', 'new reply opens its own run\'s version');
A.eq(pick('m3', 'rook'), 'rook-own', 'same path from another author resolves to that author\'s version');
A.eq(pick('m4'), 'mira-new', 'a later reference can use the author\'s latest previously shared version');
A.eq(pick('m0'), null, 'an earlier message never captures a file published later');
A.eq(pick('m1', 'rook'), null, 'the resolver refuses a mismatched message author');
A.eq(sharedFor('other', 'out/report.md', 'mira', 'm1'), null, 'a stale group resolver cannot read the active group\'s files');
A.eq(pick('m2', 'mira', '.\\out\\report.md'), 'mira-new', 'equivalent separators and a leading dot normalize');
A.eq(pick('m2', 'mira', 'report.md'), 'mira-new', 'a unique authored basename resolves its correct version');
g.artifacts.push({ id: 'mira-other-path', sourcePath: 'draft/report.md', name: 'report.md', agentId: 'mira', runId: 'r2', messageSeq: 3, createdAt: 30 });
A.eq(pick('m2', 'mira', 'report.md'), null, 'two authored paths with the same basename fall back instead of guessing');
A.eq(pick('m2'), 'mira-new', 'an exact path remains usable despite another same-named file');
g.artifacts.push({ id: 'mira-newer-same-run', sourcePath: 'out/report.md', name: 'report.md', agentId: 'mira', runId: 'r2', messageSeq: 3, createdAt: 30 });
A.eq(pick('m2'), 'mira-newer-same-run', 'equal-timestamp publishes use the last immutable version in that run');
g.artifacts.push({ id: 'rook-only', sourcePath: 'unique.png', name: 'unique.png', agentId: 'rook', runId: 'r3', messageSeq: 5, createdAt: 50 });
A.eq(pick('m4', 'mira', 'unique.png'), null, 'another author\'s only basename is never a shared fallback');

g.messages.push({ id: 'attachment-message', author: 'user', seq: 10, at: 100, artifactIds: ['user-old'] });
g.artifacts.push(
  { id: 'user-old', sourcePath: 'upload.txt', name: 'upload.txt', agentId: 'user', messageSeq: 9, createdAt: 90 },
  { id: 'user-new', sourcePath: 'upload.txt', name: 'upload.txt', agentId: 'user', messageSeq: 9, createdAt: 91 });
A.eq(pick('attachment-message', 'user', 'upload.txt'), 'user-old', 'an explicit attached artifact outranks a newer same-path upload');

/* Both hyperlink capture and inline image hydration must pass the same origin to the resolver. */
const opened = [], fallback = [], imageLoads = [];
const makeRefs = new Function('Chat', 'sharedFor', 'openFile', 'showError', 'sharedBlobs', fn(gc, 'fileRefs') + ';return fileRefs;')({
  workspaceFileRefs: author => ({ wire: (a, p) => { a.fallback = author + ':' + p; }, image: p => { fallback.push(author + ':' + p); return Promise.resolve('own'); } }),
  imageBlobUrl: (url, p) => { imageLoads.push([url, p]); return Promise.resolve('immutable'); }
}, sharedFor, async (id, artifact) => { opened.push([id, artifact.id]); }, e => { throw e; }, new Map());
(async () => {
  const link = { addEventListener: (_event, cb) => { link.click = cb; } };
  const refs = makeRefs('g', 'rook', 'm3'); refs.wire(link, 'out/report.md');
  link.click({ preventDefault() {}, stopImmediatePropagation() {} });
  A.eq(opened, [['g', 'rook-own']], 'the clickable result opens the speaker\'s immutable artifact');
  A.eq(await refs.image('out/report.md'), 'immutable', 'image uses the shared version too');
  A.ok(imageLoads[0][0].includes('file=rook-own'), 'image fetch names the exact artifact id');
  const own = makeRefs('g', 'mira', 'm4');
  A.eq(await own.image('unique.png'), 'own', 'missing authored shared file uses its own workspace');
  A.eq(fallback, ['mira:unique.png'], 'workspace fallback stays bound to the speaker');
  // Real Overseer.refresh: a delivered stream can exist before its worker metadata arrives.
  W.init({ generalId: 'poll-home', workstreams: [
    { id: 'poll-home', agentId: 'nova', title: null },
    { id: 'poll-worker', agentId: 'mira', title: 'Original title', history: [{ role: 'assistant', content: 'A saved finding' }] }
  ] });
  A.ok(!W.hasAgent(W.get('poll-home'), 'mira'), 'pre-poll participation index has no unproven link');
  const snapshot = { threads: [{ id: 'poll-worker', agentId: 'mira', parentStreamId: 'poll-home', worker: true, projectRoot: 'C:/launch', title: 'Incoming metadata' }], workers: [] };
  let saves = 0, refreshes = 0;
  const ctx = { Workstreams: W, App: { persist: () => { saves++; }, refreshRail: () => { refreshes++; } },
    fetch: async () => ({ ok: true, json: async () => snapshot }), AbortController, setTimeout, clearTimeout, console, module: { exports: {} } };
  require('node:vm').runInNewContext(read('frontend/app/overseer.js'), ctx);
  await ctx.module.exports.refresh();
  A.ok(W.hasAgent(W.get('poll-home'), 'mira'), 'polling an existing stream invalidates the stale participation index');
  A.eq(W.list().filter(w => W.hasAgent(w, 'mira')).map(w => w.id), ['poll-home'], 'the live poll replaces the visible worker row with its discoverable parent');
  A.eq(W.get('poll-worker').title, 'Original title', 'additive adoption preserves existing conversation content and title');
  A.eq(W.get('poll-worker').projectRoot, 'C:/launch', 'the same poll adopts a missing project scope');
  A.eq([saves, refreshes], [1, 1], 'new thread metadata persists and refreshes the rail once');
  await ctx.module.exports.refresh();
  A.eq([saves, refreshes], [1, 1], 'an unchanged poll does not repeatedly persist or repaint');
  snapshot.threads[0].parentStreamId = 'other'; snapshot.threads[0].projectRoot = 'C:/other';
  W.adopt({ id: 'other', agentId: 'nova' }); await ctx.module.exports.refresh();
  A.eq([W.get('poll-worker').parentStreamId, W.get('poll-worker').projectRoot], ['poll-home', 'C:/launch'], 'later metadata never silently rehomes an established worker');
  A.report('thread-flow-navigation.test');
})().catch(e => { console.error(e); process.exitCode = 1; });
