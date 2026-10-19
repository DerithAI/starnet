'use strict';
/* test/refit-firstride-stale.test.js — the auto-narrated first ride only ever answers the edit that powered its line
   (2026-10-14, the busy-station walk: BUILD MODE › Conveyors › BUILD YOUR OWN LINE, one lone INBOX placed at the top rooms,
   and the floor said "LINE READY — a test crate rides it now … WATCH IT replays it" over the FOREMAN's untouched line on the
   far side of the station, and a test ride started there).

   The cause: a session's first compile judged every line against nothing, so an already-complete floor armed its one
   narrated ride as BUILD MODE opened — it played over the untouched foreman line before the user did anything, or (held
   back by a card) after the user's first edit, whatever that edit was. Now the first compile only takes the baseline: the
   ride arms on the first line a compile completes after an edit (its one shot is not burned meanwhile) and stays armed
   until it narrates.

   build.js is a browser IIFE; the production maybeFirstRide runs here in a vm with the plan and the latch stubbed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
const start = build.indexOf('  function maybeFirstRide() {'), end = build.indexOf('  function fireFirstRide() {');
assert.ok(start > 0 && end > start, 'maybeFirstRide is where the test reads it');
const declared = /let ridePending = false, rideTimer = 0, rideAgentId = null, ridePrevReach = null(, rideFresh = false)?;/.exec(build);   // (rideFresh: the 10-14 first pass)
assert.ok(declared, 'the ride state is declared as the test expects');

const lines = { foreman: true, nova: true };   // agents whose lines have their own reaching mouth and a full crew
const ctx = vm.createContext({
  valPlan: null, valComps: [], ridePending: false, rideAgentId: null, ridePrevReach: null, rideFresh: false, seen: false,
  rideSeen() { return ctx.seen; }, rideMouthFor(a) { return lines[a] ? { x: 1, y: 1 } : null; }
});
vm.runInContext(build.slice(start, end), ctx);
const compile = (...reaching) => {
  ctx.valPlan = { reach: Object.fromEntries(reaching.map(a => [a, true])) };
  ctx.valComps = reaching.map(a => ({ intakes: [1], bays: [{ agentId: a }] }));
  vm.runInContext('maybeFirstRide()', ctx);
};

// entry on a floor whose FOREMAN line is already complete: the first compile is the baseline, nobody's edit
compile('foreman');
assert.equal(ctx.ridePending, false, 'BUILD MODE opening on an already-complete line arms no ride (it would play over the untouched line)');
assert.equal(ctx.rideAgentId, null, '…and names no line');

// the user places a lone INBOX: the plan recompiles, nothing new powers on
compile('foreman');
assert.equal(ctx.ridePending, false, 'an edit that completes nothing arms no ride on the line that was already complete');
assert.equal(ctx.rideAgentId, null, '…and names no line');

// the user finishes a line of their own: THAT is the teachable moment, and it stays armed through later edits until it narrates
compile('foreman', 'nova');
assert.equal(ctx.ridePending, true, 'a line the user just powered on arms the ride');
assert.equal(ctx.rideAgentId, 'nova', '…on the line they powered');
compile('foreman', 'nova');
assert.equal(ctx.ridePending, true, 'a later edit that powers nothing new keeps that ride armed (the coach may still be up)');
assert.equal(ctx.rideAgentId, 'nova', '…on the same line');

// a fresh session on a floor already seen narrates nothing
ctx.ridePending = false; ctx.rideAgentId = null; ctx.ridePrevReach = null; ctx.rideFresh = false; ctx.seen = true;
compile('foreman', 'nova');
assert.equal(ctx.ridePending, false, 'a station that already had its narrated ride never arms another');

/* …and the ride reads THIS compile's lines. rebake() recompiled the plan and called maybeFirstRide BEFORE regrouping the
   floor's lines (valComps), so the entry compile judged every line against no lines at all (null: nothing complete, nothing
   armed) and the user's first edit then found every already-complete line "newly complete" — the live repro on the busy
   station, BUILD MODE opened on the Conveyors tab: one lone INBOX, and LINE READY on the foreman's line. */
const bStart = build.indexOf('  function rebake() {'), bEnd = build.indexOf('  // A browser animation callback', bStart);
assert.ok(bStart > 0 && bEnd > bStart, 'rebake is where the test reads it');
const comps = [{ intakes: [1], bays: [{ agentId: 'foreman' }] }];
let seenComps = 'never called';
const editor = vm.createContext({
  station: { projectGeometry: () => ({ origin: { tx: 0, ty: 0 } }) }, cache: {}, cacheGeo: null, bakeDirty: false, bakeDirtyRects: null,
  projectionDirty: false, bakeDirtyRectsGlobal: false, bakeVisibleOnly: false, planDirty: true, valPlan: null, valLive: null, valComps: null,
  ghost: null, lastStampIds: null, renderFinCard() {}, refreshLineFacts() {}, visibleBakeRect() { return null; }, MAX_REFIT_CHUNKS: 18,
  StationBake: { bakeIncremental() { return {}; } },
  Pipeline: { compileRoutingPlan: () => ({ reach: { foreman: true } }), lineComponents: () => comps },
  maybeFirstRide() { seenComps = editor.valComps; }
});
vm.runInContext(build.slice(bStart, bEnd), editor);
vm.runInContext('rebake()', editor);
assert.equal(seenComps, comps, 'the first-ride check runs on the lines THIS compile grouped, never on none (or the last edit\'s)');

console.log('refit-firstride-stale: BUILD MODE opening and an unrelated edit arm no ride; the line the user powers keeps its ride — PASS');
