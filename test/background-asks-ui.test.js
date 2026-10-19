/* node test/background-asks-ui.test.js — a BACKGROUND hand-off's approvals on the page (2026-10-13).

   In ASK mode a worker handed off in the background (team.dispatch background:true) asks after the lead's reply has
   ended. Its ask used to be denied by the lead's teardown within a second; the delegation row flashed "Needs you" then
   "Writing" and NEEDS YOU stayed empty. The sidecar now keeps the ask open and announces it on the station bus
   (background:true + the asking conversation + the run id to answer with — test/e2e.approval-lifecycle.test.js proves
   that end). This pins the page end:
     · Channels keeps a background ask through its conversation's run start / end / STOP, never pauses that run's clock,
       and the run's own "paused on" reading ignores it (the lead keeps working);
     · chat.js files a station-bus ask under the conversation that handed the work off — the worker's row, the bell, the
       ack that earns the one bounded extension — and answers it with the ask's own runId;
     · the reconnect snapshot re-announces an ask a reloaded page never heard, and withdraws one settled while the page
       was not listening (never claiming a decision for it). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

// ---------------- Channels: a background ask outlives its conversation's run ----------------
{
  const C = require('../frontend/app/channels.js'); C.reset();
  C.begin('ws_a', 1000); C.setRunId('ws_a', 'lead1', 1000);
  C.setPending('ws_a', { promptId: 'own', tool: 'team.dispatch', runId: 'lead1' }, 2000);
  C.setPending('ws_a', { promptId: 'bg1', tool: 'fs.write', runId: 'lead1', background: true, workerAgentId: 'vex' });
  A.eq(C.runPendingOf('ws_a').promptId, 'own', 'the run reads its OWN ask as what it is paused on');
  C.clearPending('ws_a', 5000, 'own');
  A.eq(C.runPendingOf('ws_a'), null, 'with only a background ask left, the run is not paused');
  A.eq(C.pendingOf('ws_a').promptId, 'bg1', 'the background ask is still filed on the conversation');
  A.eq(C.elapsedOf('ws_a', 9000), 9000 - 1000 - 3000, 'the run clock paused only for its own ask (2000→5000), never for the worker\'s');
  A.eq(C.statusOf('ws_a'), 'working…', 'the busy run reads working, not awaiting');
  C.end('ws_a');
  A.eq(C.pendingAllOf('ws_a').map(p => p.promptId), ['bg1'], 'the reply ending keeps the background ask (the worker still waits)');
  A.eq(C.statusOf('ws_a'), 'awaiting your approval…', 'an idle conversation with a waiting worker says so');
  C.begin('ws_a', 10000);
  A.eq(C.pendingAllOf('ws_a').map(p => p.promptId), ['bg1'], 'a new message in the conversation keeps it too');
  A.eq(C.runPendingOf('ws_a'), null, '…and the new run is not paused on it');
  C.setPending('ws_a', { promptId: 'own2', tool: 'fs.write', runId: 'lead2' }, 11000);
  C.clearPending('ws_a', 12000);   // a STOP's bulk clear
  A.eq(C.pendingAllOf('ws_a').map(p => p.promptId), ['bg1'], 'STOP clears the stopped run\'s own asks, never a background worker\'s');
  C.clearPending('ws_a', 13000, 'bg1');
  A.eq(C.pendingAllOf('ws_a').length, 0, 'its own answer (by promptId) clears it');
  C.end('ws_a');
  A.eq(C.statusOf('ws_a'), 'online', 'nothing waits: online');
  C.reset();
}

// ---------------- chat.js: file a station-bus ask, re-announce from the snapshot, withdraw a settled one ----------------
const ch = rd('frontend/app/chat.js');
const a = ch.indexOf('  function pendingFrom(ev, ws) {'), b = ch.indexOf('  // who is asking:', a);
const c = ch.indexOf('  /* A BACKGROUND WORKER\'S ASK (2026-10-13).'), d = ch.indexOf('  // ── "RATE THE WORK"', c);
A.ok(a > 0 && b > a && c > 0 && d > c, 'fixture: the page functions are where this test lifts them from');
const Channels = require('../frontend/app/channels.js'); Channels.reset();
const handlers = {};
const U = { bus: { on: (n, fn) => (handlers[n] = handlers[n] || []).push(fn), emit: (n, p) => (handlers[n] || []).forEach(fn => fn(p)) } };
const rows = [], notes = [], acks = [], settled = [], repaints = [], retired = [];
let active = 'ws_lead';
const threads = { ws_lead: { id: 'ws_lead', agentId: 'agent' }, ws_vex: { id: 'ws_vex', agentId: 'vex', worker: true, parentStreamId: 'ws_lead' }, ws_other: { id: 'ws_other', agentId: 'agent' } };
const settledHere = new Set();
const ctx = vm.createContext({ console, Promise, Date, Number, String, Object, Set, Map,
  U, Channels,
  Workstreams: { get: id => threads[id] || null },
  isActiveWs: ws => !!ws && ws.id === active,
  permissionRow: (p, ws) => rows.push(ws.id + ':' + p.promptId),
  backgroundPermissionNotify: (p, ws) => notes.push(ws.id + ':' + p.promptId),
  syncStatus: () => {}, consentAckFailed: () => notes.push('ackfail'),
  settledPromptNotices: settledHere,
  retireConsentCard: (id, text) => retired.push(id + ':' + text),
  settlePromptNotice: (wsId, id) => settled.push(wsId + ':' + id),
  Harness: { consentAck: (runId, promptId) => { acks.push(runId + ':' + promptId); return Promise.resolve({ ok: true }); } },
  Delegated: { repaint: () => repaints.push(1) }, NeedsYou: { render: () => repaints.push('ny') }, App: { refreshRail: () => {} } });
vm.runInContext(ch.slice(a, b) + ch.slice(c, d) + '\n;this.__file = fileBackgroundAsk; this.__reconcile = reconcileBackgroundAsks;', ctx, { filename: 'chat-background-asks.js' });

const ev = { promptId: 'p1', agentId: 'agent', tool: 'fs.write', scope: 'write', argsSummary: '{"path":"launch-email.md"}', workerAgentId: 'vex', workerRunId: 'w1', workerStreamId: 'ws_vex', askedAt: 1000, background: true, runId: 'lead1', streamId: 'ws_lead' };
U.bus.emit('permission.prompt', ev);
const filed = Channels.pendingAllOf('ws_lead');
A.eq(filed.length, 1, 'a station-bus background ask is filed on the conversation that handed the work off');
A.eq(filed[0].runId, 'lead1', 'it is answered with the ask\'s own runId (the lead\'s reply has ended; Channels has no live run id)');
A.eq(filed[0].background, true, 'filed as a background ask (it outlives the conversation\'s runs)');
A.eq(filed[0].workerStreamId, 'ws_vex', 'its worker row finds it by the worker\'s thread');
A.eq(rows, ['ws_lead:p1'], 'the open conversation draws it (its worker row + the one bell entry)');
A.eq(acks, ['lead1:p1'], 'the page attests the ask is on screen, with the ask\'s runId');
A.eq(Channels.runPendingOf('ws_lead'), null, 'filing it never pauses the conversation\'s own run');
U.bus.emit('permission.prompt', Object.assign({}, ev));
A.eq(Channels.pendingAllOf('ws_lead').length, 1, 'the same ask arriving again (bus + snapshot) is filed once');
A.eq(rows.length, 1, '…and drawn once');
U.bus.emit('permission.prompt', { promptId: 'p0', agentId: 'agent', tool: 'fs.write', workerAgentId: 'vex', workerStreamId: 'ws_vex' });
A.eq(Channels.pendingAllOf('ws_lead').length, 1, 'an ask on a run\'s own stream (no background stamp) is left to that stream\'s handler');

// a conversation that is not on screen: bell + rail, no row drawn; found through the worker thread when streamId is unknown here
active = 'ws_other';
U.bus.emit('permission.prompt', Object.assign({}, ev, { promptId: 'p2', streamId: 'ws_gone', askedAt: 1500 }));
A.ok(Channels.pendingAllOf('ws_lead').some(p => p.promptId === 'p2'), 'an ask whose conversation id this page lacks is filed through the worker thread\'s parent');
A.eq(notes, ['ws_lead:p2'], 'a conversation not on screen gets the bell + toast instead');
U.bus.emit('permission.prompt', Object.assign({}, ev, { promptId: 'p3', streamId: 'ws_nowhere', workerStreamId: 'ws_nowhere2' }));
A.ok(!Channels.allPending().some(x => x.p.promptId === 'p3'), 'an ask no conversation on this page handed off is not filed anywhere');

// the reconnect snapshot: an ask this page never heard is re-announced on the page bus; a settled one is withdrawn
const heard = [];
U.bus.on('permission.prompt', p => heard.push(p.promptId));
ctx.__reconcile({ ts: 20000, prompts: [
  { runId: 'lead1', agentId: 'vex', promptId: 'p1', background: true, tool: 'fs.write', workerAgentId: 'vex', workerStreamId: 'ws_vex', streamId: 'ws_lead', askedAt: 1000, leadAgentId: 'agent' },
  { runId: 'lead1', agentId: 'rook', promptId: 'p9', background: true, tool: 'fs.write', scope: 'write', argsSummary: '{"path":"pricing-page.md"}', workerAgentId: 'rook', workerRunId: 'w9', workerStreamId: 'ws_rook', streamId: 'ws_lead', askedAt: 19000, leadAgentId: 'agent' },
  { runId: 'r-own', agentId: 'agent', promptId: 'own9' }
] });
A.eq(heard, ['p9'], 'only the ask this page never heard is re-announced (on the page bus, so every surface learns it)');
const after = Channels.pendingAllOf('ws_lead').map(p => p.promptId).sort();
A.eq(after, ['p1', 'p9'], 'the re-announced ask is filed; the one the station no longer lists (p2, asked long before the snapshot) is withdrawn');
A.ok(settled.indexOf('ws_lead:p2') >= 0, 'the withdrawn ask\'s bell entry settles');
A.ok(repaints.indexOf('ny') >= 0, 'NEEDS YOU repaints after a withdrawal');
A.ok(!Channels.allPending().some(x => x.p.promptId === 'own9'), 'a run\'s own ask in the snapshot is never filed by this path');
ctx.__reconcile({ ts: 21000, prompts: [{ runId: 'lead1', promptId: 'p9', background: true, askedAt: 19000, streamId: 'ws_lead', workerStreamId: 'ws_rook' }] });
A.ok(Channels.pendingAllOf('ws_lead').some(p => p.promptId === 'p9'), 'an ask younger than the snapshot\'s grace is never withdrawn on an absence');
A.ok(retired.indexOf('p2:■ no longer waiting on you') >= 0, 'a withdrawn ask\'s fallback card is retired too (its keys would answer nothing)');
A.ok(retired.every(r => !/nothing was approved|denied|approved/.test(r)), 'in neutral words: this page does not know what settled it, so it claims no decision');

// a background ask with no home on this page is announced ONCE, not again on every 30-s snapshot
heard.length = 0;
const homeless = { runId: 'lead1', agentId: 'mira', promptId: 'p7', background: true, tool: 'fs.write', workerAgentId: 'mira', workerStreamId: 'ws_mira', streamId: 'ws_later', askedAt: 20500, leadAgentId: 'agent' };
ctx.__reconcile({ ts: 22000, prompts: [homeless] });
ctx.__reconcile({ ts: 52000, prompts: [homeless] });
A.eq(heard, ['p7'], 'an ask no conversation here can file is announced on the page bus once, not on every snapshot');
// its conversation loads on this page later: the next snapshot files it quietly (no second announcement to every listener)
threads.ws_later = { id: 'ws_later', agentId: 'agent' };
repaints.length = 0;
ctx.__reconcile({ ts: 82000, prompts: [homeless] });
A.eq(heard, ['p7'], '…still one announcement');
A.ok(Channels.pendingAllOf('ws_later').some(p => p.promptId === 'p7'), 'once its conversation exists here, the snapshot files it');
A.ok(repaints.indexOf('ny') >= 0, '…and NEEDS YOU repaints for it');
// an ask this page already answered is never re-filed by a snapshot taken just before the answer landed
settledHere.add('p8');
ctx.__reconcile({ ts: 83000, prompts: [{ runId: 'lead1', promptId: 'p8', background: true, tool: 'fs.write', workerStreamId: 'ws_vex', streamId: 'ws_lead', askedAt: 82900 }] });
A.ok(!Channels.allPending().some(x => x.p.promptId === 'p8') && heard.indexOf('p8') < 0, 'an ask settled on this page is not resurrected by a stale snapshot');
Channels.reset();

// ---------------- the bell at a run's end: a background worker's ask is still waiting ----------------
{
  const s0 = ch.indexOf('  const settledPromptNotices = new Set();'), s1 = ch.indexOf('  async function answerConsent(', s0);
  A.ok(s0 > 0 && s1 > s0, 'fixture: the bell settle block');
  const Ch = require('../frontend/app/channels.js'); Ch.reset();
  const filedBell = [], settledBell = [];
  const bctx = vm.createContext({ console, String, Channels: Ch, Workstreams: { get: id => ({ id, agentId: 'agent' }) },
    askerName: p => p.workerAgentId || 'NOVA', actionPhrase: p => 'change ' + p.file,
    StationUI: { notify: (text, cls, cat, o) => filedBell.push({ text, o }), settleNotifs: k => settledBell.push(k) } });
  vm.runInContext(ch.slice(s0, s1) + '\n;this.__end = settleRunNeeds;', bctx, { filename: 'chat-bell.js' });
  Ch.begin('ws_lead', 1); Ch.setRunId('ws_lead', 'lead1', 1);
  Ch.setPending('ws_lead', { promptId: 'own', tool: 'fs.write', runId: 'lead1', file: 'brief.md' }, 2);
  // ROOK asked during NOVA's wrap-up: its bell entry is filed under the same conversation key as NOVA's own asks
  Ch.setPending('ws_lead', { promptId: 'bgR', tool: 'fs.write', runId: 'lead1', background: true, workerAgentId: 'ROOK', file: 'pricing-page.md' });
  Ch.end('ws_lead');
  bctx.__end('ws_lead');
  A.eq(settledBell, [], 'the lead\'s run ending does NOT mark the conversation\'s bell entry Handled while a background worker still waits');
  A.eq(filedBell.length, 1, 'the entry is re-filed for the worker that still waits');
  const f = filedBell[0] || { o: {} };
  A.eq([f.o.key, f.o.prompt, f.o.quiet, f.o.kind], ['needs:ws_lead', 'bgR', true, 'needs'], '…under the conversation\'s key, for that ask, quietly (already announced: no second toast or chime)');
  A.ok(/ROOK/.test(f.text) && /pricing-page\.md/.test(f.text), 'it names the worker and what it still waits on: ' + f.text);
  Ch.clearPending('ws_lead', 3, 'bgR');
  bctx.__end('ws_lead');
  A.eq(settledBell, ['needs:ws_lead'], 'with nothing left waiting, the run\'s end settles the entry as before');
  Ch.reset();
  A.eq((ch.match(/settleRunNeeds\(ws\.id\)/g) || []).length, 3, 'the clean end, the error end and the thrown teardown (STOP, a dropped stream) all settle the bell through settleRunNeeds');
  A.ok(!/StationUI\.settleNotifs\('needs:' \+ ws\.id\)/.test(ch), 'no run-end path settles needs:<conversation> blindly any more');
}

// ---------------- a background ask's fallback card outlives its lead's run ----------------
{
  const o0 = ch.indexOf('  const openConsentCards = new Map();'), o1 = ch.indexOf('  function permissionRow(p, ws) {', o0);
  A.ok(o0 > 0 && o1 > o0, 'fixture: the open-card bookkeeping');
  const lines = [];
  const octx = vm.createContext({ console, String, Map, askAnswerers: new Map() });
  vm.runInContext(ch.slice(o0, o1) + '\n;this.__cards = openConsentCards; this.__retireRun = retireOpenConsents; this.__retireOne = retireConsentCard;', octx, { filename: 'chat-cards.js' });
  const card = (id, extra) => octx.__cards.set(id, Object.assign({ wsId: 'ws_lead', runId: 'lead1', worker: false, retire: t => lines.push(id + ':' + t) }, extra));
  card('own'); card('clone', { worker: true, background: true });
  octx.__retireRun('ws_lead', 'lead1');
  A.eq(lines, ['own:■ the run ended before an answer — nothing was approved'], 'the lead\'s run end retires its own card, never a background worker\'s (still live on the station)');
  A.ok(octx.__cards.has('clone'), 'the background card stays open and answerable');
  A.eq(octx.__retireOne('clone', '■ no longer waiting on you'), true, 'a background card retires on its own settle');
  A.eq(lines[1], 'clone:■ no longer waiting on you', '…in the words its caller chose');
  A.ok(!octx.__cards.has('clone'), '…and leaves the bookkeeping');
  A.eq(octx.__retireOne('clone', 'x'), false, 'retiring an unknown card is a no-op');
  A.ok(/openConsentCards\.set\(String\(p\.promptId\), \{ wsId: ws\.id, runId: String\(p\.runId \|\| ''\), worker: !!\(p\.workerAgentId \|\| p\.workerRunId\), background: p\.background === true,/.test(ch),
    'permissionRow records whether a card is a background worker\'s ask');
  // a background worker STOPPED while its ask waited: the station says stopped (not expired), and the card says so
  A.ok(/tag\.textContent = resp\.stopped \? '■ ' \+ askerName\(p, ws\) \+ ' stopped before an answer — nothing was approved' : resp\.expired \?/.test(ch),
    'a stopped worker\'s card reads that it stopped, never "no answer in time"');
}

// ---------------- a team.spawn clone's ask names a HELPER, never its raw id ----------------
{
  const app = rd('frontend/app/app.js');
  const m = /    agentName: (id => \{ const a = agents\.get\(id\);[^\n]*\}),\n/.exec(app);
  A.ok(!!m, 'fixture: App.agentName');
  const agentName = m ? vm.runInNewContext('(' + m[1] + ')', { agents: new Map([['webdesigner', { id: 'webdesigner', name: 'ROOK' }]]) }) : () => null;
  A.eq(agentName('webdesigner'), 'ROOK', 'a crew member is named by its name');
  A.eq(agentName('sub-dd57cc13-e72c-4360-93e2-c2bd8ef52d94'), 'HELPER', 'a background clone (team.spawn) is a HELPER on its card and in NEEDS YOU, never its id');
  A.eq(agentName('nobody'), null, 'any other unknown id stays unknown (callers keep their own fallback)');
}

// ---------------- the bell after a reload: one ask never reads both Handled and Waiting on you ----------------
{
  const ui = rd('frontend/app/stationui.js');
  const n0 = ui.indexOf('  function notifyPrefOf(category) {'), n1 = ui.indexOf('  // A caller that leads with an ALL-CAPS token');
  A.ok(n0 > 0 && n1 > n0, 'fixture: the notify core');
  const nctx = { store: { notifs: [], settings: {} }, open: {}, notifyDefaults: () => ({}), uid: (() => { let i = 0; return () => 'u' + (++i); })(),
    save() {}, badges() {}, rerender() {}, toast() {}, openTerm() {}, App: {} };
  vm.runInNewContext(ui.slice(n0, n1) + '\nthis.api = { notify, reap: reapDeadPrompts };', nctx);
  // the entry the page's earlier life filed for VEX's ask; the reload reaps it as Handled
  nctx.store.notifs.push({ id: 'old', t: 1, txt: 'VEX needs approval to change launch-email.md', kind: 'needs', key: 'needs:ws_lead', prompt: 'bgV', life: 'life_before', read: false, go: { ws: 'ws_lead' } });
  nctx.api.reap();
  A.eq(nctx.store.notifs[0].done, true, 'fixture: a reload reaps the earlier life\'s prompt entry');
  // the reconnect snapshot re-files the same ask: it is still waiting on the station
  nctx.api.notify('VEX needs approval to change launch-email.md', 'warn', 'needsApproval', { kind: 'needs', go: { ws: 'ws_lead' }, key: 'needs:ws_lead', prompt: 'bgV' });
  const forAsk = nctx.store.notifs.filter(n => n.prompt === 'bgV');
  A.eq(forAsk.length, 1, 'the ask has ONE bell entry after the reload, not a Handled one beside a waiting one');
  A.ok(forAsk[0] && !forAsk[0].done, '…and it reads Waiting on you');
}

// ---------------- the row's receipt while a worker's write waits on you ----------------
{
  // the worker's call is durably recorded before it runs (per-turn transcript), its result only after you answer: the
  // receipt must not read "Wrote launch-email.md" for a write that has not happened (live walk 2026-10-13)
  global.DeskScreen = { parseScreens: require('../frontend/app/deskscreen.js')._parseScreens || require('../frontend/app/deskscreen.js').parseScreens };
  const D = require('../frontend/app/delegated.js');
  const waiting = [{ role: 'assistant', toolCalls: JSON.stringify([{ id: 'w1', function: { name: 'fs_write', arguments: JSON.stringify({ path: 'launch-email.md', content: '# x' }) } }]) }];
  const live = D._internals.foldReceipt(null, waiting);
  A.eq(live.steps.map(s => s.verb + ':' + s.arg + ':' + s.done).join('|'), 'writing:launch-email.md:false', 'a write still waiting reads "writing", unfinished');
  const done = D._internals.foldReceipt(null, waiting.concat([{ role: 'tool', toolCallId: 'w1', content: 'wrote launch-email.md (47 B)' }]));
  A.eq(done.steps.map(s => s.verb + ':' + s.done).join('|'), 'wrote:true', 'once its result lands it reads "wrote"');
  delete global.DeskScreen;
}

// ---------------- wiring that the lift cannot see ----------------
A.ok(/U\.bus\.on\('permission\.prompt', fileBackgroundAsk\)/.test(ch), 'the page listens for background asks on its bus (the station bridge re-emits SSE there)');
A.ok(/const p = runPendingOf\(activeWs\);/.test(ch) && /const pend = runPendingOf\(activeWs\);/.test(ch), 'the live presence card reads only the run\'s own ask (a worker waiting never reads AWAITING APPROVAL on a working lead)');
A.ok(/Chat\.reconcileBackgroundAsks\(snap\)/.test(rd('frontend/app/world.js')), 'the bridge\'s reconnect snapshot feeds the background-ask reconcile');
A.ok(/consentPhrase: actionPhrase, reconcileBackgroundAsks,/.test(ch), 'Chat exports the reconcile');

A.report('background-asks-ui.test');
