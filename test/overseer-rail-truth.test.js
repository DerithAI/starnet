/* node test/overseer-rail-truth.test.js — the crew row and the DELEGATED card say "station unreachable" only when the
   harness proved it (idle CPU piece 3, fix round 3, 2026-10-20).

   THE LIE. The rail's crew row and a running DELEGATED row read Overseer.fresh() alone and said "station unreachable"
   whenever it was false: right after the page's own event loop was busy (a late beat — the station had answered every ask
   it was given), and while a catch-up read was simply on its way for a ledger a sleep left old.

   GENUINE (executed): the REAL frontend/app/overseer.js (its fetch stubbed, on a fake monotonic + wall clock and timer
   queue) feeds the REAL railRowState (sliced from app.js, as session-indicators.test.js does) and the REAL
   Delegated.stateOf, across: answered · a late beat · an ask in flight with an old ledger · a real failure. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

(async () => {
  // ---- the REAL overseer on one fake clock + timer queue; /api/overseer answers after 40 ms, hangs or refuses on cue ----
  let T = 7e6, mode = 'answer', tid = 0;
  const timers = new Map();
  const setT = (fn, ms) => { const id = ++tid; timers.set(id, { fn, at: T + Math.max(0, ms || 0) }); return id; };
  const drain = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };
  const advance = async ms => {
    const end = T + ms;
    for (;;) {
      let nx = null; for (const [id, t] of timers) if (t.at <= end && (!nx || t.at < nx[1].at || (t.at === nx[1].at && id < nx[0]))) nx = [id, t];
      if (!nx) break; timers.delete(nx[0]); T = Math.max(T, nx[1].at); nx[1].fn(); await drain();
    }
    T = Math.max(T, end); await drain();
  };
  const stall = ms => { T += ms; };   // the page's event loop busy (or the machine asleep): the clock moves, no task runs
  const ledger = { threads: [], reviews: [], workers: [
    { id: 'wo', runId: 'ro', streamId: 'ko', status: 'running', parentStreamId: 'b', startedAt: 1000, canInterrupt: true },
    { id: 'w2', runId: 'r2', streamId: 'k2', status: 'running', parentStreamId: 'b', startedAt: 1000, canInterrupt: true }] };
  const oc = vm.createContext({
    module: { exports: {} }, console: { debug() {} }, AbortController, performance: { now: () => T }, Date: { now: () => T },
    setTimeout: setT, clearTimeout: id => { timers.delete(id); }, setInterval: () => 0,
    Workstreams: { generalId: () => 'general', get: () => null, adopt: r => r }, App: { persist() {}, refreshRail() {} },
    fetch: (_u, o) => new Promise((res, rej) => {
      o.signal.addEventListener('abort', () => rej(new Error('aborted')));
      if (mode === 'hang') return;
      setT(() => (mode === 'fail' ? rej(new Error('offline')) : res({ ok: true, json: async () => ledger })), 40);
    })
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/app/overseer.js'), 'utf8'), oc);
  const O = oc.module.exports;
  const ask = async () => { const p = O.refresh(); await advance(41); await p; };

  // ---- the REAL rail projection (app.js railRowState) over the real channel + session reducers ----
  const Channels = require('../frontend/app/channels.js');
  const app = fs.readFileSync(path.join(__dirname, '../frontend/app/app.js'), 'utf8');
  const storeContext = vm.createContext({ Date: { now: () => 2000 } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../frontend/app/workstreams.js'), 'utf8'), storeContext);
  const Workstreams = storeContext.Workstreams;
  const rail = vm.createContext({ Channels, Workstreams, Overseer: O, Date: { now: () => 2000 }, agents: new Map([['nova', { name: 'NOVA' }]]), railFmtElapsed: ms => String(ms), railRelTime: () => '1m' });
  vm.runInContext(A.fnBody(app, 'function railRowState(w)'), rail);
  Workstreams.init({ workstreams: [{ id: 'general', title: null }, { id: 'b', agentId: 'nova', title: 'Other', lastActiveAt: 1000, lastReadAt: 1000 }], activeId: 'general', generalId: 'general' });
  Channels.reset();
  const row = () => { const st = rail.railRowState(Workstreams.get('b')); return st.meta + ' | ' + st.status; };

  // ---- the REAL DELEGATED row state (delegated.js stateOf) for one of those running workers ----
  global.document = undefined;
  global.Overseer = O;
  global.Channels = { pendingOf: () => null, pendingAllOf: () => [], isBusy: () => false, runIdOf: () => '', elapsedOf: () => 0 };
  global.App = { agentName: id => id };
  const D = require('../frontend/app/delegated.js');
  const runningRow = { ws: { id: 'ko', agentId: 'researcher', title: 'Scan competitors', history: [], runIds: [] }, worker: ledger.workers[0] };
  const card = () => D.stateOf(runningRow, 'b', 'lead1').live;

  /* 1. ANSWERED */
  await ask();
  A.eq(row(), '2 working | 2 of the crew working on what you delegated', 'answered: the asking conversation says its crew is working');
  A.eq(card(), 'working', 'answered: the running worker reads working');

  /* 2. A LATE BEAT: right after that answer the page's own event loop is busy 10 s; the rail's tick is the first to run */
  stall(10000);
  A.eq(row(), '2 working | 2 of the crew working on what you delegated', 'LATE BEAT: the station answered every ask — the row stays "2 working" (it read "crew · unknown | station unreachable — crew state unknown")');
  A.eq(card(), 'working', 'LATE BEAT: the DELEGATED row stays working (it read "status unknown — station unreachable")');
  await ask();

  /* 3. AN ASK IN FLIGHT FOR AN OLD LEDGER: an hour asleep, the catch-up read is on its way */
  stall(3600000); mode = 'hang';
  const pending = O.refresh();
  A.eq(row(), 'crew · unknown | checking the station — crew state unknown', 'IN FLIGHT, OLD LEDGER: an hour-old ledger is not "2 working", and the station is being checked, not called unreachable (it said "station unreachable")');
  A.eq(card(), 'status unknown — checking the station', 'IN FLIGHT, OLD LEDGER: the DELEGATED row claims no state and no outage (it said "station unreachable")');

  /* 4. A REAL FAILURE: that read runs past its 8 s deadline on the page's own timer; then a refused read */
  await advance(8100); await pending;
  A.eq(row(), 'crew · unknown | station unreachable — crew state unknown', 'REAL FAILURE: past its deadline the row says the station is unreachable');
  A.eq(card(), 'status unknown — station unreachable', 'REAL FAILURE: and so does the DELEGATED row');
  mode = 'answer'; await ask();
  A.eq(row(), '2 working | 2 of the crew working on what you delegated', 'recovered: the next answer lights the crew again');
  mode = 'fail'; await ask();
  A.eq(row(), 'crew · unknown | station unreachable — crew state unknown', 'REAL FAILURE: a refused read is unreachable at once');
  A.eq(card(), 'status unknown — station unreachable', 'REAL FAILURE: on the DELEGATED row too');

  delete global.Overseer; delete global.Channels; delete global.App; delete global.document;
  A.report('overseer-rail-truth.test');
})().catch(e => { console.error(e); process.exit(1); });
