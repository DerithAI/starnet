/* node test/comms-deliverable-replay.test.js — a stream's recorded deliverables (the ▤ saved / ▤ made rows)
   are replayed by renderHistory in time order, so a reload, stream switch or Try Again keeps the clickable
   file rows a customer relies on (2026-09-14 report: "can't send clickable files anymore, sends a text path").
   chat.js is browser/DOM flow and not require-able (see chat-stopped-retry.test.js) — the record shape is
   exercised through Workstreams; the production render and opening functions are executed directly. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');
const vm = require('node:vm');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/chat.js'), 'utf8');

// ---- the record every replay depends on: Workstreams files {title, kind, runId, t} on the stream ----
{
  const Workstreams = require('../frontend/app/workstreams.js');
  const ws = Workstreams.create ? Workstreams.create({ agentId: 'agent', title: 'files' }) : null;
  A.ok(ws && ws.id, 'a workstream can be created headlessly');
  A.eq(Workstreams.recordDeliverable(ws.id, { title: 'out/report.md', kind: 'file', runId: 'r1', t: 1000 }), true, 'a file deliverable is recorded');
  A.eq(Workstreams.recordDeliverable(ws.id, { title: 'out/cover.png', kind: 'image', runId: 'r1', t: 1200 }), true, 'an image deliverable is recorded');
  const w = Workstreams.get ? Workstreams.get(ws.id) : Workstreams.find(ws.id);
  A.eq(w.deliverables.map(d => d.title), ['out/report.md', 'out/cover.png'], 'deliverables persist on the stream in arrival order');
  A.eq(w.deliverables.map(d => d.kind), ['file', 'image'], 'the RENDERED kind is what gets recorded (file stays file, image stays image)');
  A.eq(w.deliverables.map(d => d.t), [1000, 1200], 'each record carries the time the live row was painted');
}

// Execute the exact production render functions. Full replay and incremental insertion
// intentionally have different deliverable/retry behavior; formatting is not their contract.
const renderSource = ['function replayableDeliverables(ws)', 'function replayDeliverableRow(d, agentId)', 'function renderHistory(onlyTurns)']
  .map(header => { const body = A.fnBody(src, header); A.ok(body.length > 100 && body.length < 7000, header + ' is bounded'); return body; }).join('\n');
const fixture = {
  id: 'worker-chat', agentId: 'vex', history: [{ role: 'user', content: 'request', ts: 1 }, { role: 'assistant', content: 'first reply', ts: 20 }, { role: 'assistant', content: 'last reply', ts: 40 }],
  deliverables: [{ title: 'after.md', kind: 'file', t: 50 }, { title: 'clip.mp4', kind: 'file', t: 20 }, { title: 'before.md', kind: 'file', t: 10 }, { title: 'sound.wav', kind: 'audio', t: 30 }, { title: 'picture.png', kind: 'image', t: 35 }, { title: 'ignored', kind: 'skill', t: 2 }, { title: ' ', kind: 'file', t: 3 }]
};
function boot(code = renderSource, failProse = false) {
  const events = [], c = vm.createContext({ activeWs: JSON.parse(JSON.stringify(fixture)), renderingHistory: false,
    // These conflicting identities must never replace the recorded stream owner.
    agent: { id: 'hero' }, attachAgentId: () => 'other-focused-agent',
    mediaKindOf: title => title.endsWith('.mp4') ? 'video' : title.endsWith('.png') ? 'image' : 'file',
    deliverableLine: (title, owner) => events.push(['file', title, owner]),
    imageDeliverableLine: (title, owner) => events.push(['image', title, owner]),
    mediaPlayerLine: (title, owner, kind) => events.push([kind, title, owner]),
    addUser: text => events.push(['user', text]), toolLine: text => events.push(['status', text]), trimMarkerLine() {},
    goalStepOf: () => null, goalStepLine: goal => events.push(['goal-step', goal]),   // no goal-loop turns in this fixture (comms-system-register.test owns those)
    row: () => ({ d: { classList: { add() {} } }, body: {} }), turnFileRefs: agentId => ({ agentId }),
    renderProse: (_body, text) => { if (failProse) throw new Error('render failed'); events.push(['reply', text]); },
    isBusy: () => false, offerTryAgain: () => events.push(['retry']), offerRetry: () => events.push(['retry']) });
  vm.runInContext(code, c); return { c, events };
}
const expected = [['user', 'request'], ['file', 'before.md', 'vex'], ['video', 'clip.mp4', 'vex'], ['reply', 'first reply'], ['audio', 'sound.wav', 'vex'], ['image', 'picture.png', 'vex'], ['reply', 'last reply'], ['file', 'after.md', 'vex']];
{
  const { c, events } = boot(), before = JSON.stringify(c.activeWs.deliverables);
  A.eq(c.replayableDeliverables(c.activeWs).map(d => d.title), ['before.md', 'clip.mp4', 'sound.wav', 'picture.png', 'after.md'], 'eligible files replay in timestamp order and ignore blank/skill records');
  A.eq(JSON.stringify(c.activeWs.deliverables), before, 'sorting never mutates the persisted arrival ledger');
  c.renderHistory(); A.eq(events, expected, 'files at or before each reply render first, leftovers last, all with the stream owner');
  A.eq(c.renderingHistory, false, 'full replay restores animation state');
  events.length = 0; c.renderHistory([{ role: 'assistant', content: 'new reply', ts: 60, stopped: true }]);
  A.eq(events, [['reply', 'new reply']], 'incremental insertion paints only new prose without duplicate files or stale retry controls');
  events.length = 0; c.replayDeliverableRow({ title: 'promoted.png', kind: 'file' }, 'rook');
  A.eq(events, [['image', 'promoted.png', 'rook']], 'recorded generic files still use the matching live media renderer');
}
{
  const { c } = boot(renderSource, true);
  A.throws(() => c.renderHistory(), 'a renderer exception is observable');
  A.eq(c.renderingHistory, false, 'a failed replay still restores animation state');
}
// Mutation controls prove these observations would reject the old class of regressions.
for (const [label, mutated] of [
  ['missing sort', renderSource.replace('.sort((a, b) => (+a.t || 0) - (+b.t || 0))', '')],
  ['missing final flush', renderSource.replace('flushDeliverablesBefore(null);', '')],
  ['wrong workspace', renderSource.replace("(activeWs && activeWs.agentId) || 'agent'", "'hero'")]
]) { const { c, events } = boot(mutated); c.renderHistory(); A.ok(JSON.stringify(events) !== JSON.stringify(expected), 'ordering/ownership fixture rejects ' + label); }
{
  const { c, events } = boot(renderSource.replace('onlyTurns ? [] : replayableDeliverables(activeWs)', 'replayableDeliverables(activeWs)'));
  c.renderHistory([{ role: 'assistant', content: 'new reply', ts: 60 }]);
  A.ok(events.length > 1, 'incremental fixture detects replayed old file rows');
}
{
  const { c } = boot(renderSource.replace('finally { renderingHistory = false; }', 'finally {}'), true);
  try { c.renderHistory(); } catch (_) {}
  A.eq(c.renderingHistory, true, 'exception fixture detects missing state cleanup');
}
// Opening remains bound to the rendered file even after the user changes conversations.
{
  const opened = [], ticketed = [], handlers = {}, a = { addEventListener: (name, fn) => (handlers[name] ||= []).push(fn) };
  const c = vm.createContext({ fileUrl: (title, owner, project) => { ticketed.push([title, owner, project]); return '/file/' + owner + '/' + title; },
    tauriCore: () => ({ invoke: (name, args) => { opened.push([name, args]); return Promise.resolve(); } }), window: { getSelection: () => '' } });
  const body = A.fnBody(src, 'function wireFileOpen(a, title, agentId, projectRoot)');
  A.ok(body.length > 500 && body.length < 5000, 'file-opening closure is bounded');
  // the link asks for the readable document view of a text deliverable (live walk 10-14): the same helper chat.js uses
  vm.runInContext((/const TEXT_DOC_RE = [^\n]+;/.exec(src) || [''])[0] + '\n' + A.fnBody(src, 'function readableUrl(url, filePath)'), c);
  vm.runInContext(body, c);
  c.wireFileOpen(a, 'out/report.md', 'vex'); c.activeWs = { agentId: 'someone-else' };
  for (const fn of handlers.pointerdown || []) fn({});
  for (const fn of handlers.click || []) fn({ preventDefault() {}, stopPropagation() {} });
  A.eq(opened, [['starnet_open_artifact', { path: 'out/report.md', agentId: 'vex' }]], 'click opens the original exact artifact through its owning workspace');
  A.ok(ticketed.every(call => call[0] === 'out/report.md' && call[1] === 'vex'), 'ticket refresh keeps the original path and owner after switching');
  A.eq([a.target, a.rel], ['_blank', 'noopener'], 'browser links retain native new-tab behavior');
  c.window.getSelection = () => 'selected prose';
  for (const fn of handlers.click || []) fn({ preventDefault() {}, stopPropagation() {} });
  A.eq(opened.length, 1, 'text selection never opens the file');
}
A.report('comms-deliverable-replay.test');
