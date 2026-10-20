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

  G._resetForTest();
  A.report('pollgate.test');
})().catch(e => { console.error(e); process.exit(1); });
