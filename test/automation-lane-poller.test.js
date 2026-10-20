/* node test/automation-lane-poller.test.js — the GOAL LOOPS lane keeps ONE /api/loops poller per AUTOMATION window body
   (idle CPU piece 3, 2026-10-20).

   THE LEAK. StationUI re-renders a window by running its builder again on the SAME connected body (AWAY WORK's openAway =
   openTerm + rerender, a roster change, "AUTOMATION › section" while the window is open). windows/loops.js armed a NEW
   4 s setInterval(refresh) in every wire() and the old one only died once the body left the DOM, so each re-render added
   a permanent /api/loops poller (and kept the previous render's closures alive) for as long as the window stayed open.

   GENUINE (executed): the REAL windows/loops.js runs in a vm with a permissive stub DOM; the lane registered with the
   AutomationWindow stub is built and wired three times on one body, the way three re-renders do. Exactly one 4 s poller
   may be live; the body leaving the DOM ends it. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend/app/windows/loops.js'), 'utf8');

// any element: unknown methods return another element, lists are empty, nothing is ever a thenable
function el(extra) {
  const o = Object.assign({ isConnected: true, dataset: {}, style: {}, value: '', hidden: false, disabled: false, innerHTML: '', textContent: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false } }, extra || {});
  return new Proxy(o, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol' || k === 'then' || k === 'toJSON') return undefined;
      if (k === 'querySelectorAll') return () => [];
      if (k === 'getClientRects') return () => [{}];
      return () => el();
    },
    set(t, k, v) { t[k] = v; return true; }
  });
}

const live = new Map();   // interval id -> { fn, ms }
let seq = 0, getCalls = 0;
const lanes = [];
const ctx = vm.createContext({
  window: {}, console,
  localStorage: { getItem: () => null, setItem() {} },
  document: { querySelector: () => null, createElement: () => el(), activeElement: null },
  StationUI: { h: { present: [{ id: 'agent', name: 'Agent' }], sel: 0, esc: s => String(s), sfx() {}, notify() {}, fmtRel: () => '', consoleSection: {} } },
  AutomationWindow: { registerLane: fn => lanes.push(fn) },
  Harness: { api: { get: async () => { getCalls++; return { loops: [] }; } } },
  fetch: async () => ({ ok: true, json: async () => ({ loops: [] }) }),
  setInterval: (fn, ms) => { const id = ++seq; live.set(id, { fn, ms }); return id; },
  clearInterval: id => { live.delete(id); },
  setTimeout: () => 0, clearTimeout() {},
  JSON, Math, Number, Object, Array, Set, Map, String, Promise, Error, isFinite, AbortController
});
vm.runInContext(src, ctx, { filename: 'windows/loops.js' });
A.eq(lanes.length, 1, 'the GOAL LOOPS lane registers with the AUTOMATION window');

const lanePollers = () => [...live.entries()].filter(([, t]) => t.ms === 4000);
const settle = async () => { for (let n = 0; n < 50; n++) await Promise.resolve(); };
(async () => {
const body = el();
for (let i = 0; i < 3; i++) {
  const lane = lanes[0](body);
  A.ok(lane && typeof lane.wire === 'function', 'render ' + (i + 1) + ': the lane builds');
  lane.wire();
}
A.eq(lanePollers().length, 1, 'three renders of one AUTOMATION body keep exactly ONE 4 s /api/loops poller (it was one per render)');

// the live poller is this render's: it reads the station
await settle();
const before = getCalls;
lanePollers()[0][1].fn();
await settle();
A.ok(getCalls > before, 'the surviving poller still refreshes the window');

// a second, separate window body has its own poller
const other = el();
lanes[0](other).wire();
A.eq(lanePollers().length, 2, 'a different window body owns its own poller');

// the window closes: its body leaves the DOM and the next beat clears the poller
body.isConnected = false;
const mine = lanePollers().find(([id]) => id === body.__lpPoll) || lanePollers()[0];
mine[1].fn();
A.eq(lanePollers().length, 1, 'a body that left the DOM ends its poller on the next beat');
A.ok(!body.__lpPoll, 'and forgets it');

/* design 3.1a's minimized skip (fix round, 2026-10-20). StationUI minimizes a window to the strip with its element kept
   alive and connected (display:none, stationui.js), so isConnected alone kept a minimized AUTOMATION window reading
   /api/loops and rebuilding its cards every 4 s while the station was on screen. A body with no client rects skips the
   beat and keeps its poller; the first beat after a restore reads again. */
let rects = [{}];
const mBody = el({ getClientRects: () => rects });
lanes[0](mBody).wire();
await settle();
const mPoll = lanePollers().find(([id]) => id === mBody.__lpPoll);
A.ok(mPoll, 'fixture: the window has its 4 s poller');
rects = [];
const atMin = getCalls;
mPoll[1].fn(); await settle();
A.eq(getCalls, atMin, 'a minimized AUTOMATION window does not read /api/loops on its beat (it read every 4 s)');
A.ok(lanePollers().some(([id]) => id === mBody.__lpPoll), '…and keeps its poller for when it is restored');
rects = [{}];
mPoll[1].fn(); await settle();
A.ok(getCalls > atMin, 'restored: the next beat reads again');

// in the app the poller runs through PollGate (idle CPU piece 3): still exactly one loop per body, at the 4 s cadence
const gateLoops = new Set();
const gatedLanes = [];
const gated = vm.createContext(Object.assign({}, ctx, {
  AutomationWindow: { registerLane: fn => gatedLanes.push(fn) },
  PollGate: { every(fn, o) { const loop = { fn, ms: o.ms, immediate: o.immediate, stop() { gateLoops.delete(loop); } }; gateLoops.add(loop); return loop; } }
}));
vm.runInContext(src, gated, { filename: 'windows/loops.js' });
const gBody = el();
for (let i = 0; i < 3; i++) gatedLanes[0](gBody).wire();
const msOf = l => (typeof l.ms === 'function' ? l.ms() : l.ms);
const gLane = [...gateLoops].filter(l => msOf(l) === 4000);
A.eq(gLane.length, 1, 'through PollGate: three renders of one body keep ONE 4 s loop');
A.eq(gLane[0].immediate, false, '…armed like the interval it replaces (first beat after 4 s)');
gBody.isConnected = false; gLane[0].fn();
A.eq([...gateLoops].filter(l => msOf(l) === 4000).length, 0, 'through PollGate: a body that left the DOM stops its loop');

/* fix round 2 (2026-10-20), now the FALLBACK where no ResizeObserver exists (fix round 3 below reads at once where one
   does): a restored window reads within ~1 s, not up to 4 s. StationUI's restore repaints only the
   dossier, so an AUTOMATION window minimized for an hour showed hour-old loop states (a "running" loop long finished)
   until its next 4 s beat. While the poller is skipping, its beat comes every 1 s (a client-rects check, never a read).
   GENUINE (executed): the REAL pollgate.js on a fake monotonic clock + timers drives the REAL windows/loops.js poller. */
{
  const G = require('../frontend/app/pollgate.js');
  let clock = 2e6, tseq = 0;
  const timers = new Map();
  const setT = (fn, ms) => { const id = ++tseq; timers.set(id, { fn, at: clock + Math.max(0, ms || 0) }); return id; };
  G._resetForTest(); G._setClockForTest(() => clock); G._setTimersForTest(setT, id => { timers.delete(id); }); G._setFrameForTest(null);
  G._setDocForTest({ hidden: false, addEventListener() {}, removeEventListener() {} }, null);
  const advance = async ms => {
    const until = clock + ms;
    for (;;) {
      let nx = null; for (const [id, t] of timers) if (t.at <= until && (!nx || t.at < nx[1].at)) nx = [id, t];
      if (!nx) break; timers.delete(nx[0]); clock = nx[1].at; nx[1].fn(); await settle();
    }
    clock = until; await settle();
  };
  const realLanes = [];
  let reads = 0;
  const real = vm.createContext(Object.assign({}, ctx, {
    AutomationWindow: { registerLane: fn => realLanes.push(fn) }, PollGate: G,
    Harness: { api: { get: async () => { reads++; return { loops: [] }; } } }
  }));
  vm.runInContext(src, real, { filename: 'windows/loops.js' });
  let shown = [{}];
  const rBody = el({ getClientRects: () => shown });
  realLanes[0](rBody).wire();
  await settle();
  reads = 0;
  await advance(4000);
  A.eq(reads, 1, 'real gate: an open window reads every 4 s');
  shown = [];   // minimized to the strip
  await advance(60000);
  A.eq(reads, 1, 'real gate: a minimized window never reads (a minute of skipped beats)');
  await advance(300);
  shown = [{}];   // restored
  await advance(1000);
  A.eq(reads, 2, 'real gate: restored, the window reads within ~1 s (it showed its pre-minimize cards up to 4 s)');
  await advance(3500);
  A.eq(reads, 2, 'real gate: …then the 4 s cadence is back (no 1 s reads while it can be seen)');
  await advance(600);
  A.eq(reads, 3, 'real gate: …and the next read comes 4 s after the last');
  rBody.isConnected = false;
  await advance(5000);
  A.eq(G._debug().loops, 0, 'real gate: a closed window ends its loop');
  G._resetForTest();
}

/* fix round 3 (2026-10-20): RESTORED = READ AT ONCE. A window restored from the strip showed its pre-minimize loop states
   until the next beat came round (up to ~1 s, 4 s before that). In the app a ResizeObserver on the body sees it come
   back in the frame it is shown (its box goes from none to a size) and the beat runs right then.
   GENUINE (executed): the REAL pollgate.js on a fake clock + timers drives the REAL windows/loops.js poller; the
   ResizeObserver is a stand-in that reports a size change the way the browser does when the minimized window's
   display:none is lifted (StationUI restoreTerm) — the one thing node cannot render. */
{
  const G = require('../frontend/app/pollgate.js');
  let clock = 3e6, tseq = 0;
  const timers = new Map();
  const setT = (fn, ms) => { const id = ++tseq; timers.set(id, { fn, at: clock + Math.max(0, ms || 0) }); return id; };
  G._resetForTest(); G._setClockForTest(() => clock); G._setTimersForTest(setT, id => { timers.delete(id); }); G._setFrameForTest(null);
  G._setDocForTest({ hidden: false, addEventListener() {}, removeEventListener() {} }, null);
  const advance = async ms => {
    const until = clock + ms;
    for (;;) {
      let nx = null; for (const [id, t] of timers) if (t.at <= until && (!nx || t.at < nx[1].at)) nx = [id, t];
      if (!nx) break; timers.delete(nx[0]); clock = nx[1].at; nx[1].fn(); await settle();
    }
    clock = until; await settle();
  };
  const observers = [];
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.targets = []; this.live = true; observers.push(this); }
    observe(t) { this.targets.push(t); }
    disconnect() { this.live = false; this.targets = []; }
  }
  const resized = target => { for (const o of observers) if (o.live && o.targets.includes(target)) o.cb([{ target }], o); };
  const lanesRO = [];
  let reads = 0;
  const roCtx = vm.createContext(Object.assign({}, ctx, {
    AutomationWindow: { registerLane: fn => lanesRO.push(fn) }, PollGate: G, ResizeObserver: FakeResizeObserver,
    Harness: { api: { get: async () => { reads++; return { loops: [] }; } } }
  }));
  vm.runInContext(src, roCtx, { filename: 'windows/loops.js' });
  let shown = [{}];
  const body = el({ getClientRects: () => shown });
  lanesRO[0](body).wire();
  await settle();
  reads = 0;
  await advance(4000);
  A.eq(reads, 1, 'RO: an open window reads every 4 s');
  shown = []; resized(body);   // minimized to the strip: the box goes away
  await advance(60000);
  A.eq(reads, 1, 'RO: a minimized window never reads');
  A.eq(body.__lpPoll.interval(), 4000, 'RO: a minimized window keeps its 4 s beat, never a 1 s one (the restore is seen, not polled for)');
  await advance(1700);
  shown = [{}]; resized(body);   // restored: the box comes back in the frame it is shown
  await settle();
  A.eq(reads, 2, 'RESTORED: the window reads at once, as it becomes visible (it waited for its next beat, up to ~1 s)');
  await advance(3900);
  A.eq(reads, 2, 'RESTORED: …no second read beside it (that read reset the beat)');
  await advance(100);
  A.eq(reads, 3, 'RESTORED: …and the next read comes a full 4 s later');
  resized(body);   // an ordinary resize of an open window is not a restore
  await settle();
  A.eq(reads, 3, 'a resize of a window already on screen reads nothing extra');
  // a re-render on the same body keeps ONE observer; the closed window leaves none
  lanesRO[0](body).wire(); await settle();
  A.eq(observers.filter(o => o.live).length, 1, 'a re-render keeps exactly one live ResizeObserver per body');
  body.isConnected = false;
  await advance(5000);
  A.eq(observers.filter(o => o.live).length, 0, 'a closed window disconnects its ResizeObserver');
  A.eq(G._debug().loops, 0, '…and ends its loop');
  G._resetForTest();
}

/* fix round 5 (2026-10-20): RESTORED = NOTHING STALE DRAWN. The restore's read starts as the body is shown, but its answer
   is a round trip away, and nothing marked the cards on screen as unconfirmed: the first frames of the CRT power-on drew
   the pre-minimize states (here the E-STOP banner of a halt lifted while the window sat in the strip) until the answer
   landed. GENUINE (executed): the REAL pollgate.js + the REAL windows/loops.js with the stand-in ResizeObserver; the
   /api/loops reads stay pending until the test answers them, and the gate line and card list are real nodes we read. */
{
  const G = require('../frontend/app/pollgate.js');
  let clock = 4e6, tseq = 0;
  const timers = new Map();
  const setT = (fn, ms) => { const id = ++tseq; timers.set(id, { fn, at: clock + Math.max(0, ms || 0) }); return id; };
  G._resetForTest(); G._setClockForTest(() => clock); G._setTimersForTest(setT, id => { timers.delete(id); }); G._setFrameForTest(null);
  G._setDocForTest({ hidden: false, addEventListener() {}, removeEventListener() {} }, null);
  const advance = async ms => {
    const until = clock + ms;
    for (;;) {
      let nx = null; for (const [id, t] of timers) if (t.at <= until && (!nx || t.at < nx[1].at)) nx = [id, t];
      if (!nx) break; timers.delete(nx[0]); clock = nx[1].at; nx[1].fn(); await settle();
    }
    clock = until; await settle();
  };
  const observers = [];
  class FakeResizeObserver {
    constructor(cb) { this.cb = cb; this.targets = []; this.live = true; observers.push(this); }
    observe(t) { this.targets.push(t); }
    disconnect() { this.live = false; this.targets = []; }
  }
  const resized = target => { for (const o of observers) if (o.live && o.targets.includes(target)) o.cb([{ target }], o); };
  const gets = [];   // each /api/loops read, answered (or failed) by the test
  const holdLanes = [];
  const hctx = vm.createContext(Object.assign({}, ctx, {
    AutomationWindow: { registerLane: fn => holdLanes.push(fn) }, PollGate: G, ResizeObserver: FakeResizeObserver,
    Harness: { api: { get: () => new Promise((res, rej) => gets.push({ res, rej })) } }
  }));
  vm.runInContext(src, hctx, { filename: 'windows/loops.js' });
  const gate = el({ querySelector: () => null }), list = el();
  let shown = [{}];
  const body = el({ getClientRects: () => shown, querySelector: sel => (sel === '#lp-gate' ? gate : sel === '#lp-list' ? list : el()) });
  const drawn = () => gate.style.visibility !== 'hidden' && list.style.visibility !== 'hidden';
  const estop = () => /LOOPS ARE STOPPED/.test(gate.innerHTML || '');
  holdLanes[0](body).wire(); await settle();
  gets.shift().res({ halted: true, loops: [] }); await settle();
  A.ok(estop() && drawn(), 'fixture: the open window shows the station\'s E-STOP banner');
  // minimized to the strip for 10 s (its beats skip); the halt is lifted meanwhile
  shown = []; resized(body);
  await advance(10000);
  A.eq(gets.length, 0, 'fixture: a minimized window reads nothing');
  shown = [{}]; resized(body); await settle();   // restored: the box comes back in the frame it is shown
  A.eq(gets.length, 1, 'restored: its read is out at once');
  A.ok(!drawn(), 'RESTORED, ANSWER NOT IN: the pre-minimize gate line and cards are not drawn (the power-on showed the lifted E-STOP as current)');
  gets.shift().res({ halted: false, loops: [] }); await settle();
  A.ok(drawn() && !estop(), '…the answer lands: drawn, and only what the station says now');
  // a restore inside one beat (nothing skipped: the cards are as fresh as the cadence keeps them) shows them at once
  await advance(4000);
  gets.shift().res({ halted: true, loops: [] }); await settle();
  shown = []; resized(body);
  await advance(1000);
  shown = [{}]; resized(body); await settle();
  A.ok(drawn() && estop(), 'restored inside one beat: the cards show at once, as before');
  gets.shift().res({ halted: true, loops: [] }); await settle();
  // a restore read that fails paints the cards under the "may be out of date" line
  shown = []; resized(body);
  await advance(10000);
  shown = [{}]; resized(body); await settle();
  A.ok(!drawn(), 'fixture: restored after skipped beats, held');
  gets.shift().rej(new Error('The station took too long to respond. Please retry.')); await settle();
  A.ok(drawn() && /may be out of date/.test(gate.textContent || ''), 'a restore read that fails: the cards are drawn under the line that says they may be out of date');
  body.isConnected = false;
  await advance(5000);
  G._resetForTest();
}

A.report('automation-lane-poller.test');
})().catch(e => { console.error(e); process.exit(1); });
