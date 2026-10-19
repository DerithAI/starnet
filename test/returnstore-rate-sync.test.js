/* test/returnstore-rate-sync.test.js — org P14 wiring (2026-10-14): a run waiting for its rating shows in TWO places, DELIVERABLES ›
   TO REVIEW and the delivered result in WORKFLOWS. Rating it in either one must clear it from the other, so neither window keeps
   claiming work still waits for a verdict it already got (truthful telemetry). Run for real: returnstore.js in a vm with a pending crate,
   OutboxView/WorkflowsWindow as counting stubs; then source-locked: each window names itself when it resolves. */
'use strict';
const A = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const Returns = require('../frontend/app/returns.js');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

function boot() {
  let saved = JSON.stringify({ lastSeenAt: 1000 });
  const hits = { outbox: 0, workflows: 0 }, wfIds = [];
  const ctx = vm.createContext({ Returns, Date,
    localStorage: { getItem: () => saved, setItem: (_, v) => { saved = v; }, removeItem: () => { saved = null; } },
    XpStore: { loadRunHistory: async () => ({ runs: [] }) }, window: { addEventListener() {} },
    setTimeout: () => 0, clearTimeout() {}, setInterval: () => 1, clearInterval() {},
    OutboxView: { refresh() { hits.outbox++; } }, WorkflowsWindow: { refresh(ids) { hits.workflows++; wfIds.push(ids); } } });
  vm.runInContext(rd('frontend/app/returnstore.js') + '\nthis.store = ReturnStore;', ctx);
  ctx.store.init({ enabled: true });
  return { store: ctx.store, hits, wfIds };
}
const fold = (s, id) => { A.ok(s.foldRow({ runId: id, agentId: 'nova', title: id, ts: 1 })); };

{ // rated in WORKFLOWS → TO REVIEW repaints (a minimized DELIVERABLES no longer lists the run); WORKFLOWS repaints itself
  const { store, hits } = boot(); fold(store, 'r1'); hits.outbox = hits.workflows = 0;
  store.resolve('r1', 'workflows');
  A.equal(store.pendingCount(), 0);
  A.equal(hits.outbox, 1, 'a rating in WORKFLOWS rebuilds every mounted TO REVIEW');
  A.equal(hits.workflows, 0, 'WORKFLOWS is not nudged for its own rating (it schedules its own paint)');
}
{ // rated in TO REVIEW → WORKFLOWS' rate control goes; TO REVIEW is NOT rebuilt (its collected() fade would be cut short)
  const { store, hits, wfIds } = boot(); fold(store, 'r2'); hits.outbox = hits.workflows = 0;
  store.resolve('r2', 'outbox');
  A.equal(hits.workflows, 1, 'a rating in TO REVIEW nudges WORKFLOWS to drop its rate control');
  A.deepEqual(JSON.parse(JSON.stringify(wfIds)), [['r2']], '…naming the rated run, so WORKFLOWS repaints only when it shows that run\'s rate control');
  A.equal(hits.outbox, 0, 'TO REVIEW is not rebuilt under its own fading row');
}
{ // rated from a COMMS away beat (onRated(runId), no caller) → both windows catch up
  const { store, hits } = boot(); fold(store, 'r3'); hits.outbox = hits.workflows = 0;
  store.resolve('r3');
  A.deepEqual(hits, { outbox: 1, workflows: 1 }, 'a COMMS rating repaints both windows');
}
{ // CLEAR ALL in TO REVIEW → WORKFLOWS' rate control goes too
  const { store, hits, wfIds } = boot(); fold(store, 'r4'); fold(store, 'r5'); hits.outbox = hits.workflows = 0;
  store.resolveAll(['r4', 'r5']);
  A.equal(store.pendingCount(), 0);
  A.ok(hits.workflows >= 1 && hits.outbox >= 1, 'CLEAR ALL repaints TO REVIEW and nudges WORKFLOWS');
  A.deepEqual(JSON.parse(JSON.stringify(wfIds)), [['r4', 'r5']], '…naming the cleared runs');
}
{ // the callers name themselves
  const outbox = rd('frontend/app/windows/outbox.js'), wf = rd('frontend/app/windows/workflows.js');
  A.equal((outbox.match(/RS\.resolve\(rw\.runId, 'outbox'\)/g) || []).length, 2, 'both TO REVIEW collect paths (rate + mark reviewed) name themselves');
  A.ok(!/RS\.resolve\(rw\.runId\)/.test(outbox), 'no anonymous TO REVIEW resolve left');
  A.ok(/ReturnStore\.resolve\(rw\.runId, 'workflows'\)/.test(wf), 'WORKFLOWS names itself when it rates');
}
{ // WORKFLOWS' refresh(runIds) repaints only when its delivered result shows the rate control for one of those runs (org P14 review):
  // paint() rebuilds the body and shuts every open <details> drawer, and the window stays alive() while minimized
  const wf = rd('frontend/app/windows/workflows.js');
  const at = wf.indexOf('  const refresh = runIds => {'), end = wf.indexOf('\n  };', at);
  A.ok(at > 0 && end > at && end - at < 800, 'sliced WorkflowsWindow.refresh (' + (end - at) + ' chars)');
  const run = (shown, connected) => {
    let painted = 0;
    const body = { isConnected: connected !== false,
      querySelector: q => (q === '.wfw-rate[data-rate-for]' && shown ? { getAttribute: k => (k === 'data-rate-for' ? shown : null) } : null) };
    const ctx = vm.createContext({ body, schedule: () => { painted++; } });
    vm.runInContext('const alive = () => !!(body && body.isConnected);\n' + wf.slice(at, end + 5) + '\nthis.refresh = refresh;', ctx);
    return ids => { painted = 0; ctx.refresh(ids); return painted; };
  };
  A.equal(run('r9')(['r9']), 1, 'the shown run was rated elsewhere: its rate control goes (one repaint)');
  A.equal(run('r9')(['r1']), 0, 'another run was rated: the open drawers stay open (no repaint)');
  A.equal(run(null)(['r1']), 0, 'no rate control shown (a job being read, a line, the editor): no repaint');
  A.equal(run('r9')(['r4', 'r9']), 1, 'CLEAR ALL naming the shown run repaints');
  A.equal(run('r9')(undefined), 1, 'an unnamed nudge still repaints an open window');
  A.equal(run('r9', false)(['r9']), 0, 'a closed window never repaints');
  const rs = rd('frontend/app/returnstore.js');
  A.ok(/changed\(from, \[runId\]\)/.test(rs) && /WorkflowsWindow\.refresh\(runIds\)/.test(rs) && /WorkflowsWindow\.refresh\(runIds\.filter\(Boolean\)\)/.test(rs),
    'ReturnStore hands WORKFLOWS the rated run ids on every path (resolve and CLEAR ALL)');
}
console.log('returnstore-rate-sync: ok');
