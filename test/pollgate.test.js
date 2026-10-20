/* node test/pollgate.test.js — the pure contract of frontend/app/pollgate.js (idle CPU piece 3, 2026-10-20).

   PollGate is the one owner of "is anyone looking?" for the browser's background polls: a poll keeps its own cadence while
   the page can be seen, slows to a 30 s floor while the Commander is away (hidden AND no input for 10 s), never stops, and
   catches up the moment the Commander is back. Fake document, window, clock and timers; nothing real is scheduled. */
'use strict';
const A = require('./_assert.js');
const G = require('../frontend/app/pollgate.js');

let clock = 1000000;
const timers = new Map();
let seq = 0;
G._setClockForTest(() => clock);
G._setTimersForTest((fn, ms) => { const id = ++seq; timers.set(id, { fn, at: clock + Math.max(0, ms) }); return id; }, id => { timers.delete(id); });
function listeners() { const m = {}; return { m, addEventListener(k, fn) { (m[k] = m[k] || []).push(fn); }, removeEventListener(k, fn) { m[k] = (m[k] || []).filter(f => f !== fn); }, fire(k) { for (const f of (m[k] || []).slice()) f({ type: k }); } }; }
const doc = Object.assign(listeners(), { hidden: false });
const win = listeners();
G._setDocForTest(doc, win);
// run every timer due by `until`, in time order (timers a run schedules are honoured in the same pass)
async function advance(ms) {
  const until = clock + ms;
  for (;;) {
    let next = null;
    for (const [id, t] of timers) if (t.at <= until && (!next || t.at < next[1].at)) next = [id, t];
    if (!next) break;
    timers.delete(next[0]); clock = Math.max(clock, next[1].at); next[1].fn();
    for (let n = 0; n < 10; n++) await Promise.resolve();
  }
  clock = until;
}

(async () => {
  // ---- away(): hidden AND no input for 10 s ----
  G._resetForTest();
  A.eq(G.away(), false, 'a visible page is never away');
  doc.hidden = true;
  A.eq(G.away(), true, 'hidden with no recent input is away');
  win.fire('pointermove');
  A.eq(G.away(), false, 'input proves the page is on screen, whatever document.hidden says (a webview that misreports hidden)');
  clock += 9999; A.eq(G.away(), false, 'the input grace lasts 10 s');
  clock += 1; A.eq(G.away(), true, '…and then the hidden page is away again');
  doc.hidden = false;

  // ---- every(): the visible cadence, then the away floor, never a stop ----
  G._resetForTest();
  let runs = [];
  const loop = G.every(() => { runs.push(clock); }, { ms: 5000 });
  A.eq(runs.length, 1, 'immediate (the default) runs once on arm, like fn(); setInterval(fn, ms)');
  await advance(20000);
  A.eq(runs.length, 5, 'visible: one run every 5 s (0, 5, 10, 15, 20)');
  A.ok(runs.every((t, i) => i === 0 || t - runs[i - 1] === 5000), 'the visible spacing is exactly the configured cadence');
  A.eq(loop.cadence(), 5000, 'cadence() is the interval in force when the last run started');
  doc.hidden = true; clock += 0;
  runs = [];
  await advance(60000);
  A.ok(runs.length >= 1 && runs.length <= 2, 'away: the loop slows to the 30 s floor (' + runs.length + ' runs in 60 s, was 12)');
  A.ok(runs.length > 0, 'away polls slow down; they never stop');
  A.eq(loop.cadence(), 30000, 'a run that started while away records the 30 s cadence');
  A.eq(loop.interval(), 30000, 'interval() is the cadence in force now');

  // ---- wake: visible again runs the overdue loop at once ----
  runs = [];
  clock += 7000;   // more than the visible 5 s since the last away run
  doc.hidden = false; doc.fire('visibilitychange');
  A.eq(runs.length, 1, 'back on screen: an overdue loop runs at once, not on its next away beat');
  await advance(5000);
  A.eq(runs.length, 2, '…and keeps its visible cadence again');
  loop.stop();
  await advance(60000);
  A.eq(runs.length, 2, 'stop() ends the chain');

  // ---- wake callbacks fire only after the gate was away; the first input counts as a return ----
  G._resetForTest();
  let woke = 0;
  const off = G.onWake(() => { woke++; });
  win.fire('focus');
  A.eq(woke, 0, 'a focus while the gate was never away is not a wake');
  doc.hidden = true; clock += 11000;
  A.eq(G.away(), true, 'fixture: away');
  win.fire('keydown');
  A.eq(woke, 1, 'the first input after being away wakes (a webview still saying hidden)');
  win.fire('keydown');
  A.eq(woke, 1, 'later input is not another wake');
  off();
  doc.hidden = false;

  // ---- immediate:false: first run after one cadence ----
  G._resetForTest();
  runs = [];
  G.every(() => { runs.push(clock); }, { ms: 1000, immediate: false });
  A.eq(runs.length, 0, 'immediate:false does not run on arm');
  await advance(1000);
  A.eq(runs.length, 1, '…it runs after one cadence');

  // ---- a pending run blocks overlap; a throw or rejection still reschedules ----
  G._resetForTest();
  let release, started = 0;
  G.every(() => { started++; return new Promise(r => { release = r; }); }, { ms: 1000 });
  await advance(5000);
  A.eq(started, 1, 'a run still in flight is never overlapped by the next beat');
  release(); for (let n = 0; n < 10; n++) await Promise.resolve();
  await advance(1000);
  A.eq(started, 2, 'once it settles the chain carries on');
  G._resetForTest();
  const raised = [];
  G._setRaiseForTest(e => raised.push('throw:' + e.message), e => raised.push('reject:' + e.message));
  let throws = 0, rejects = 0;
  G.every(() => { throws++; throw new Error('boom'); }, { ms: 1000 });
  G.every(() => { rejects++; return Promise.reject(new Error('offline')); }, { ms: 1000 });
  await advance(3000);
  A.eq(throws, 4, 'a throwing poll still reschedules');
  A.eq(rejects, 4, 'a rejecting poll still reschedules');
  A.eq(raised.filter(x => x === 'throw:boom').length, 4, 'each throw is re-raised outside the chain (as loud as under setInterval)');
  A.eq(raised.filter(x => x === 'reject:offline').length, 4, 'each rejection is re-raised as an unhandled rejection (as loud as an unawaited poll)');

  // ---- a live cadence function is read at every schedule ----
  G._resetForTest();
  let fast = true; runs = [];
  G.every(() => { runs.push(clock); }, { ms: () => (fast ? 1000 : 5000), immediate: false });
  await advance(3000);
  A.eq(runs.length, 3, 'ms() = 1 s: three runs in 3 s');
  fast = false;
  await advance(10000);
  A.ok(runs.length === 5 || runs.length === 6, 'ms() = 5 s: the cadence follows the function (' + (runs.length - 3) + ' runs in 10 s)');

  /* ---- A BEAT THAT NEVER SETTLES NEVER ENDS THE LOOP (fix round, 2026-10-20) ----
     world.js pollFeedState and the loops watcher returned fetches with no deadline: one read the sidecar accepted and never
     answered left the chain waiting on it for good (2 runs in 10 min where setInterval made 10). Each beat now has a
     deadline of max(2 x its cadence, 15 s); past it the chain moves on, and the abandoned promise's late answer changes
     nothing. */
  G._resetForTest();
  let calls = 0;
  G.every(() => { calls++; return calls === 2 ? new Promise(() => {}) : undefined; }, { ms: 60000 });
  await advance(10 * 60000);
  A.ok(calls >= 9, 'a 60 s loop whose 2nd read hangs forever still runs in 10 min (' + calls + ' runs; 2 before the deadline)');
  A.ok(timers.size > 0, '…and is still scheduled');

  G._resetForTest();
  let lateFirst = null, beats = 0;
  G.every(() => { beats++; if (beats === 1) return new Promise(r => { lateFirst = r; }); return undefined; }, { ms: 1000 });
  await advance(14999);
  A.eq(beats, 1, 'a 1 s beat in flight is waited on up to its 15 s deadline (no overlap before it)');
  await advance(1);
  A.eq(beats, 2, 'at the deadline the chain moves on and runs the overdue beat');
  lateFirst(); for (let n = 0; n < 10; n++) await Promise.resolve();
  const atLate = beats;
  await advance(10000);
  A.eq(beats - atLate, 10, 'the abandoned beat answering late starts no second chain (10 runs in 10 s, not 20)');

  /* the Commander comes back while a beat started away is hung: the catch-up is not blocked by it */
  G._resetForTest();
  let k = 0;
  G.every(() => { k++; if (k === 2) return new Promise(() => {}); return undefined; }, { ms: 1000 });
  doc.hidden = true;
  await advance(30000);
  A.eq(k, 2, 'fixture: away, the 30 s beat ran and hangs');
  await advance(20000);   // 20 s into the hung away beat: past a 1 s loop's 15 s deadline, short of the 60 s away one
  doc.hidden = false; doc.fire('visibilitychange');
  A.eq(k, 3, 'back on screen: a beat hung past the live deadline is abandoned and the overdue loop runs at once');
  G._resetForTest();
  k = 0;
  G.every(() => { k++; if (k === 2) return new Promise(() => {}); return undefined; }, { ms: 1000 });
  doc.hidden = true;
  await advance(30000);
  await advance(5000);    // 5 s into the hung away beat
  doc.hidden = false; doc.fire('visibilitychange');
  A.eq(k, 2, 'a beat only 5 s out on return is still awaited (its answer is on its way)');
  await advance(9999);
  A.eq(k, 2, '…until the live 15 s deadline');
  await advance(1);
  A.eq(k, 3, '…which is pulled in from the 60 s away deadline: the loop runs at 15 s, not 60 s');
  G._resetForTest();
  k = 0;
  const hungLoop = G.every(() => { k++; return k === 1 ? new Promise(() => {}) : undefined; }, { ms: 1000, immediate: true });
  clock += 16000;   // timers frozen (a frozen page): the guard has not fired yet
  hungLoop.runNow();
  A.eq(k, 2, 'runNow() is not blocked by a beat hung past its deadline either');
  doc.hidden = false;

  /* ---- AWAY IS NEVER CLAIMED AGAINST THE PAGE'S OWN EVIDENCE OF BEING ON SCREEN ----
     world.js cinecamTick: embedded webviews (the preview harness, some Tauri states) report document.hidden while still
     rendering, and a hands-off viewer gives no input. Away now needs every signal the page has to agree. */
  G._resetForTest();
  const frames = [];
  G._setFrameForTest(cb => { frames.push(cb); return frames.length; });
  doc.hidden = true; doc.visibilityState = 'visible';
  A.eq(G.away(), false, 'hidden but visibilityState "visible": the signals disagree, so not away');
  doc.visibilityState = 'hidden'; doc.hasFocus = () => true;
  A.eq(G.away(), false, 'hidden but the document holds focus: on screen, not away');
  doc.hasFocus = () => false;
  frames.length = 0;
  A.eq(G.away(), false, 'hidden, unfocused, idle: not away until a frame probe has had its chance');
  A.eq(frames.length, 1, 'one rAF probe is out');
  G.away(); A.eq(frames.length, 1, '…only one, however often away() is asked');
  clock += 1999; A.eq(G.away(), false, 'no frame for 1.999 s: not proven yet');
  clock += 1; A.eq(G.away(), true, 'no frame for 2 s (a really hidden page never runs rAF): away');
  frames.shift()(0);   // the page draws again with no visibilitychange (a webview that never says it is back)
  A.eq(G.away(), false, 'a drawn frame proves the page is on screen again');

  /* a webview that says hidden but keeps drawing keeps the visible cadence (it slowed to 30 s before) */
  G._resetForTest();
  frames.length = 0;
  G._setFrameForTest(cb => { const id = ++seq; timers.set(id, { fn: () => cb(clock), at: clock + 16 }); return id; });
  let drawn = 0;
  G.every(() => { drawn++; }, { ms: 1000, immediate: false });
  await advance(60000);
  A.eq(drawn, 60, 'hidden + idle + unfocused but drawing frames: a 1 s loop keeps its 1 s cadence (' + drawn + ' runs in 60 s, was 2)');
  /* …and a page that really is hidden still slows */
  G._resetForTest();
  G._setFrameForTest(cb => { frames.push(cb); return frames.length; });
  frames.length = 0;
  drawn = 0;
  G.every(() => { drawn++; }, { ms: 1000, immediate: false });
  await advance(60000);
  A.ok(drawn >= 2 && drawn <= 4, 'hidden + idle + no frames: the 1 s loop slows to the 30 s floor (' + drawn + ' runs in 60 s)');
  /* a frame after being away is a return: the overdue loop runs at once */
  clock += 5000;
  const before = drawn;
  frames.splice(0).forEach(f => f(0));
  A.eq(drawn, before + 1, 'the first frame drawn after being away wakes the gate: the overdue loop runs at once');
  G._setFrameForTest(null);
  doc.hidden = false; delete doc.visibilityState; delete doc.hasFocus;

  G._resetForTest();

  /* ---- THE DEFAULT CLOCK IS MONOTONIC (a backward wall-clock step never stalls a loop) ----
     A fresh PollGate in a vm with its OWN defaults: performance.now advances steadily while Date.now steps back 5 min
     (a w32time correction after resume). The next 1 s beat must come 1 s later, not 5 min later. */
  {
    const vm = require('vm');
    let mono = 50000, wall = 1760000000000;
    const q = new Map(); let qs = 0;
    const box = { module: { exports: {} }, Promise,
      performance: { now: () => mono }, Date: { now: () => wall },
      setTimeout: (fn, ms) => { const id = ++qs; q.set(id, { fn, at: mono + Math.max(0, ms) }); return id; },
      clearTimeout: id => { q.delete(id); } };
    vm.runInNewContext(require('fs').readFileSync(require('path').join(__dirname, '../frontend/app/pollgate.js'), 'utf8'), box);
    const P = box.module.exports;
    const step = ms => { const until = mono + ms; for (;;) { let nx = null; for (const [id, t] of q) if (t.at <= until && (!nx || t.at < nx[1].at)) nx = [id, t]; if (!nx) break; q.delete(nx[0]); wall += nx[1].at - mono; mono = nx[1].at; nx[1].fn(); } wall += until - mono; mono = until; };
    let r = 0;
    P.every(() => { r++; }, { ms: 1000 });
    A.eq(r, 1, 'fixture: the loop ran on arm');
    wall -= 5 * 60000;
    step(1000);
    A.eq(r, 2, 'the wall clock stepped back 5 min: the next 1 s beat still comes 1 s later (it waited 5 min on Date.now)');
    step(3000);
    A.eq(r, 5, '…and the cadence carries on');
  }

  G._resetForTest();
  A.report('pollgate.test');
})().catch(e => { console.error(e); process.exit(1); });
