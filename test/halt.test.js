/* node test/halt.test.js — the E-STOP kill logic (sidecar/halt.js). Locks: killAll aborts EVERY browser run
   AND every messaging-hub run, marks hub runs `superseded` BEFORE aborting (so no stale partial reply ships
   after the kill), returns the count, and never throws on null maps or a throwing abort (an E-STOP must not
   fail). The HTTP route /api/halt is verified separately by a live sidecar smoke. */
'use strict';
const A = require('./_assert.js');
const { killAll } = require('../sidecar/halt.js');

function fakeAc() { let aborted = false; return { abort() { aborted = true; }, get aborted() { return aborted; } }; }

/* ---- browser runs only ---- */
{
  const a = fakeAc(), b = fakeAc();
  const n = killAll(new Map([['r1', a], ['r2', b]]), null);
  A.eq(n, 2, 'aborts both browser runs and counts them');
  A.ok(a.aborted && b.aborted, 'both browser controllers aborted');
}

/* ---- browser + hub runs: hub runs are marked superseded BEFORE the abort ---- */
{
  const a = fakeAc();
  const h1 = { abort: fakeAc(), superseded: false };
  const h2 = { abort: fakeAc(), superseded: false };
  const n = killAll(new Map([['r1', a]]), new Map([['c1', h1], ['c2', h2]]));
  A.eq(n, 3, 'counts browser + both hub runs');
  A.ok(a.aborted, 'browser run aborted');
  A.ok(h1.abort.aborted && h2.abort.aborted, 'both hub runs aborted');
  A.ok(h1.superseded && h2.superseded, 'hub runs marked superseded — no stale partial delivered after HALT');
}

/* ---- MULTIPLE hub maps (Telegram + Discord) are all killed in one call ---- */
{
  const a = fakeAc();
  const tg = { abort: fakeAc(), superseded: false };
  const dc = { abort: fakeAc(), superseded: false };
  const n = killAll(new Map([['r1', a]]), new Map([['c1', tg]]), new Map([['c2', dc]]));
  A.eq(n, 3, 'counts browser + telegram + discord hub runs');
  A.ok(a.aborted, 'browser run aborted');
  A.ok(tg.abort.aborted && tg.superseded, 'telegram hub run aborted + superseded');
  A.ok(dc.abort.aborted && dc.superseded, 'discord hub run aborted + superseded');
  A.eq(killAll(null, null, null), 0, 'all-null hub maps -> 0, no throw');
}

/* ---- the E-STOP must be unbreakable: null maps, a throwing abort, a null rec ---- */
{
  A.eq(killAll(null, null), 0, 'null maps -> 0, no throw');
  const boom = { abort() { throw new Error('boom'); } };
  let n;
  A.notThrows(() => { n = killAll(new Map([['r1', boom], ['r2', fakeAc()]]), null); }, 'a throwing abort never propagates out of the E-STOP');
  A.eq(n, 2, 'still counts a run whose abort threw');
  A.notThrows(() => killAll(new Map(), new Map([['c', null]])), 'a null hub rec is tolerated');
}

/* ---- THE STATION'S OWN FAULT is not the Commander's E-STOP (wave 2 repair, conveyor-backend-08): the process-fault containment
   marks the hub runs it is about to kill `faulted`, so the hub's notice, the step test and the hand-off records name the fault.
   halted stays the one stop flag every consumer reads; faulted only picks the words. ---- */
{
  const { markFaulted } = require('../sidecar/halt.js');
  const a = fakeAc();
  const h1 = { abort: fakeAc(), superseded: false, halted: false };
  const h2 = { abort: fakeAc(), superseded: false, halted: false };
  const browser = new Map([['r1', a]]);
  A.eq(markFaulted(new Map([['c1', h1]]), null, new Map([['c2', h2], ['c3', null]])), 2, 'marks every hub run of every map (null maps and recs tolerated)');
  A.ok(h1.faulted === true && h2.faulted === true, 'each hub run carries faulted');
  A.ok(!h1.abort.aborted && !h1.superseded && !h1.halted, 'marking alone stops nothing: the kill is still killAll');
  A.eq(killAll(browser, new Map([['c1', h1]])), 2, 'then the ordinary kill');
  A.ok(h1.halted === true && h1.superseded === true && h1.faulted === true, 'a fault-killed hub run is halted AND faulted');
  const e = { abort: fakeAc(), superseded: false, halted: false };
  killAll(null, new Map([['c', e]]));
  A.ok(e.halted === true && !e.faulted, 'a plain E-STOP never marks a run faulted');
  A.notThrows(() => markFaulted(), 'no maps -> no throw');
}

A.report('halt');
