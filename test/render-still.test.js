/* node test/render-still.test.js — the STILL tier of RENDER PACING (world.js).

   Andrew, 2026-10-21 (approved): "draw 30/s while nothing on screen moves, snap back to 60 the instant anything moves
   (144 while panning)". The installed 0.13.5 idled at 178% of a core, 96% of it DRAWING an unchanged station 60x a second.
   The contract this file locks:
     1. a still scene is redrawn 30x a second, waiting in a timer (no per-vsync rAF spin) — and mode 'still' says so;
     2. anything that moves is drawn at the normal pace from the very next vsync: 60, or 144 while the hand pans;
     3. motion that STARTS between still frames never waits out the 33 ms tick — a body whose idle clock, fidget or talk
        turn comes due mid-interval, a decision whose first step lands on the next tick, and a wake from outside the
        frame (input, a harness event, a World API call) all land on the next vsync;
     4. every motion source the frame knows about flips the still flag (unsure is motion: a prop whose art moves on its
        clock, a breathing body, a meteor), the ambient ones (off-screen bodies, float dust, a static speech bubble, a
        cold belt) do not, and every clock the inner life gates on is either due in the verdict or exempt for a reason.
   The world is a browser IIFE: the pacer block, the verdict block and frame() are lifted out of the source and run in a vm
   sandbox on a fake vsync clock — behaviour, not prose. The prop / sky / sprite readouts the verdict reads are proven by
   test/render-still-readouts.test.js. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const world = fs.readFileSync(path.join(root, 'frontend/app/world.js'), 'utf8');
const assets = fs.readFileSync(path.join(root, 'frontend/js/assets.js'), 'utf8');
const ghostline = fs.readFileSync(path.join(root, 'frontend/app/ghostline.js'), 'utf8');
const util = fs.readFileSync(path.join(root, 'frontend/js/util.js'), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"\\])\/\/.*$/gm, '$1');
const code = strip(world);

// ---- the lifted source --------------------------------------------------------------------------------------------
const pFrom = world.indexOf('  const PACE_VISIBLE_MS'), pTo = world.indexOf('  function renderPace()');
const vFrom = world.indexOf('  /* STILL VERDICT'), vTo = world.indexOf('  // ---- end STILL VERDICT');
A.ok(pFrom > 0 && pTo > pFrom && pTo - pFrom < 12000, 'world.js carries the RENDER PACING block before renderPace()');
A.ok(vFrom > pTo && vTo > vFrom && vTo - vFrom < 20000, 'world.js carries the STILL VERDICT block after renderPace()');
const renderPaceSrc = A.fnBody(world, '  function renderPace()');
const frameSrc = A.fnBody(code, 'function frame(now, force)');
const isTalkKindSrc = A.fnBody(code, 'function isTalkKind(kind)');
A.ok(renderPaceSrc && frameSrc && frameSrc.length < 3000 && isTalkKindSrc, 'renderPace(), the paced frame(now, force) and isTalkKind are found');
// the inner-life constants the verdict reads, taken from world.js itself (never re-typed here)
const num = name => {
  const m = world.match(new RegExp('\\b' + name + ' = ([0-9][0-9 *+/.]*)[;,]'));
  A.ok(!!m, name + ' is a world.js constant');
  return m ? Function('return (' + m[1] + ')')() : NaN;
};
const K = {};
for (const n of ['TALK_SLOT_MS', 'TALK_SPEAK_MS', 'GATHER_SPEAK_MS', 'GATHER_GAP_MS', 'GATHER_QUIET_MS', 'OVERSEER_BREAK_MS', 'CURSOR_FRESH_MS', 'LINK_STALE_MS']) K[n] = num(n);

// the world state the verdict reads, as sandbox globals (var = settable from the test)
const PRELUDE = `
var frameCapMs = 0, lastDrawnAt = 0, running = true, raf = 0, camUserAt = 0;
var renderFaults = 0, lastFaultMsg = '', reviewParts = null, reviewStamp = 0, cache = {};
var RENDER_FAULT_LIMIT = 30, reviewPerformance = { enabled: false, samples: [] };
var scale = 2, panX = 0, panY = 0, cv = { width: 800, height: 600 }, T = 12;
var agent = null, crew = [], camAnim = null, camLerp = null, camLock = null, geo = null, beltLiveSet = null;
var convey = null, ghost = null, handoffBoxes = [], sendCrates = [], deskFlash = new Map(), dockFlashes = new Map();
var pinFlourishAt = -1e9, firstShipPulse = null, awakeFrozen = false, arrivalScene = null, kindleArmed = false, kindleP = 0, floodAt = 0;
var wakeDark = 0, wakeDarkTarget = 0, dawnAt = 0, sparkAt = 0, bornAt = 0, truthPulseAt = 0, wakeAt = 0, levelUpAt = 0;
var cineHoldUntil = 0, cineWalkAt = -1e9, cineIdleMs = 120000, socialBeat = null, gathering = null;
var FLASH_MS = 950, HANDOFF_GRACE_MS = 8000;
var activity = 'idle', lastCursor = { wx: 0, wy: 0, t: -1e9 }, gatherGateUntil = -1e9, stationBusyAt = -1e9, gatherRollAt = -1e9;
var chatFocusId = null, chatWarmUntil = -1e9, stillPass = null, linkStaleDim = false, lastSseEventAt = 0, rmOn = false;
${Object.entries(K).map(([k, v]) => 'var ' + k + ' = ' + v + ';').join(' ')}
function reduceMotion() { return rmOn; }
${isTalkKindSrc}
var bodyPosX = b => b ? (b.seated ? b.seatPx : b.px) : 0, bodyPosY = b => b ? (b.seated ? b.seatPy : b.py) : 0;
var propUse = p => (p && p.use) || null;
var scene = { step() {} };
function drawRenderFault() {}
function frameBody(now) { stillBegin(); scene.step(now); stillVerdict(now); }
`;
const EXPOSE = `
this.W = { paceMs, scheduleFrame, paceWake, motionWake, userActive, cameraMoved, renderPace, stillBegin, stillVerdict, stillMove, noteDue, frame,
  noteDrawCost, resetBudget: () => { drawCostMs = 0; },
  st: () => ({ stillNow, stillWhy, stillDue, paceTimer, inputAt, motionUntil, vsyncMs, stillFrames }),
  consts: { PACE_VISIBLE_MS, PACE_MOTION_MS, PACE_STILL_MS, PACE_MOTION_HOLD_MS, INPUT_HOLD_MS, BODY_CLOCKS } };`;

function makeWorld(hz) {
  const env = { now: 0, rafQ: [], timers: [], tid: 0, rafCalls: 0, draws: [], hz };
  const P = 1000 / hz;
  const sb = {
    console, Map, Math, Object, Infinity, NaN,
    document: { hasFocus: () => true },
    performance: { now: () => env.now },
    requestAnimationFrame: fn => { env.rafQ.push(fn); return env.rafQ.length + 1000; },
    cancelAnimationFrame: () => { env.rafQ.length = 0; },
    setTimeout: (fn, ms) => { const id = ++env.tid; env.timers.push({ id, at: env.now + Math.max(0, ms), fn }); return id; },
    clearTimeout: id => { env.timers = env.timers.filter(t => t.id !== id); },
  };
  vm.createContext(sb);
  vm.runInContext(PRELUDE + world.slice(pFrom, pTo) + '\n' + renderPaceSrc + '\n' + world.slice(vFrom, vTo) + '\n' + frameSrc + '\n' + EXPOSE, sb);
  const W = sb.W;
  // the event loop: timers fire at their time; rAF callbacks run on the next vsync boundary (k * P)
  const actions = [];   // test-side events at a wall time: { at, fn }
  let vk = 1;           // the index of the next vsync to deliver (counted, so an event landing ON a boundary can't skip it)
  function runUntil(t) {
    for (let guard = 0; guard < 1e6; guard++) {
      const nextV = vk * P;
      let nextT = Infinity, ti = -1;
      for (let i = 0; i < env.timers.length; i++) if (env.timers[i].at < nextT) { nextT = env.timers[i].at; ti = i; }
      let nextA = Infinity, ai = -1;
      for (let i = 0; i < actions.length; i++) if (actions[i].at < nextA) { nextA = actions[i].at; ai = i; }
      const next = Math.min(nextV, nextT, nextA);
      if (next > t) { env.now = t; return; }
      env.now = next;
      if (next === nextA) { const a = actions.splice(ai, 1)[0]; a.fn(); continue; }
      if (next === nextT && nextT < nextV) { const tm = env.timers.splice(ti, 1)[0]; tm.fn(); continue; }
      vk++;
      const q = env.rafQ.splice(0);
      for (const fn of q) { env.rafCalls++; fn(env.now); }
    }
    throw new Error('event loop did not settle');
  }
  // run on to the next draw and stop just after it: the returned time is that draw, and the clock is within 0.5 ms of it
  function toNextDraw() { const n = env.draws.length; while (env.draws.length === n) runUntil(env.now + 0.5); return env.draws[env.draws.length - 1]; }
  const firstVsyncAtOrAfter = t => Math.ceil(t / P - 1e-9) * P;
  return { sb, W, env, P, runUntil, toNextDraw, firstVsyncAtOrAfter, at: (t, fn) => actions.push({ at: t, fn }) };
}
const count = (arr, a, b) => arr.filter(t => t >= a && t < b).length;

// a body the scene sim moves: idle until its clock comes due, then walks 30 world px/s; drawBody's readouts held constant.
// glanceCd: Infinity — a hero whose glance cooldown is far off (a lapsed one rolls every tick: motion, see section 7)
function body(over) {
  return Object.assign({ id: 'a', px: 200, py: 150, dir: 'south', state: 'idle', idleUntil: Infinity, glanceCd: Infinity, _pose: 'set.rot.south', _renderFrame: 0 }, over || {});
}
function walkerScene(w, b) {
  let last = 0;
  w.sb.scene = { step(now) {
    w.env.draws.push(now);
    const dt = last ? now - last : 0; last = now;
    if (b.state === 'idle' && now >= b.idleUntil) { b.state = 'walk'; b.walkFrom = now; }
    if (b.state === 'walk') b.px += 0.03 * dt;
  } };
}

// ---- 1. a still scene is drawn 30x a second, from a timer --------------------------------------------------------
{
  const w = makeWorld(60), b = body();
  w.sb.agent = b; walkerScene(w, b);
  w.W.frame(0);
  w.runUntil(1000);
  const raf0 = w.env.rafCalls;
  w.runUntil(2000);
  const n = count(w.env.draws, 1000, 2000);
  A.ok(n >= 29 && n <= 31, 'a still station is redrawn 30x a second (' + n + ' draws in 1 s on a 60 Hz panel)');
  A.ok(w.env.rafCalls - raf0 <= 31, '...each one booked from a timer: no per-vsync rAF spin while still (' + (w.env.rafCalls - raf0) + ' callbacks)');
  const rp = w.W.renderPace();
  A.eq(rp.mode, 'still', "renderPace().mode reads 'still' — the bench and telemetry can prove the tier");
  A.ok(Math.abs(rp.paceMs - 33.3) < 0.1 && rp.still === true && rp.stillWhy === null, '...at the 30/s pace, with no motion source named');
  A.ok(rp.stillFrames >= 29 && typeof rp.stillWhyCounts === 'object', '...and it counts the frames it judged still (' + rp.stillFrames + '), for a bench window');
  let waits = 0; for (let i = 0; i < 100; i++) { w.runUntil(w.env.now + 1); if (w.W.renderPace().timerWait) waits++; }
  A.ok(waits >= 85, '...waiting in a timer between draws (' + waits + '% of the time)');
  A.ok(Math.abs(w.W.st().vsyncMs - 1000 / 60) < 0.5, 'a timer-booked callback is never learned as a vsync (vsyncMs stays ' + w.W.st().vsyncMs.toFixed(2) + ' ms)');
}

// ---- 2. motion is drawn at the normal pace ------------------------------------------------------------------------
{
  const w = makeWorld(60), b = body({ idleUntil: 0 });
  w.sb.agent = b; walkerScene(w, b);
  w.W.frame(0);
  w.runUntil(2000);
  const n = count(w.env.draws, 1000, 2000);
  A.ok(n >= 59 && n <= 61, 'a walking body is drawn 60x a second (' + n + ')');
  A.eq(w.W.renderPace().mode, 'visible', "...in the 'visible' mode");
  A.eq(w.W.st().stillWhy, 'body', "...and the verdict names the body as the motion");
  const c = w.W.renderPace().stillWhyCounts;
  A.ok(c.body >= 100, '...and counts the frames the body kept moving (' + JSON.stringify(c) + ')');
}

// ---- 3. the hand panning: 144x a second, then back to still --------------------------------------------------------
{
  const w = makeWorld(144), b = body();
  w.sb.agent = b; walkerScene(w, b);
  w.W.frame(0);
  w.runUntil(1000);
  A.eq(w.W.renderPace().mode, 'still', 'a 144 Hz panel at rest is still');
  for (let t = 1000; t < 2000; t += 3) w.at(t, () => { w.sb.panX += 1; w.W.cameraMoved(); });   // a drag: mousemove every 3 ms
  w.runUntil(2000);
  const n = count(w.env.draws, 1100, 2000);
  A.ok(n >= 128 && n <= 131, 'while the hand pans, the floor is drawn 144x a second (' + n + ' in 0.9 s on a 144 Hz panel)');
  A.eq(w.W.renderPace().mode, 'motion', "...in the 'motion' mode");
  w.runUntil(2000 + w.W.consts.PACE_MOTION_HOLD_MS + 500);
  const t0 = w.env.now; w.runUntil(t0 + 1000);
  const s = count(w.env.draws, t0, t0 + 1000);
  A.ok(s >= 27 && s <= 31, 'the hand lets go, the hold runs out, and the still scene drops back to ~30/s (' + s + ')');
  A.eq(w.W.renderPace().mode, 'still', "...in the 'still' mode");
}

// ---- 4. a body whose idle clock comes due MID-INTERVAL walks on the next vsync ------------------------------------------
{
  const w = makeWorld(60), b = body();
  w.sb.agent = b; walkerScene(w, b);
  w.W.frame(0);
  w.runUntil(1000);
  A.ok(w.W.st().stillNow, 'the floor is still before the walk');
  const L = w.toNextDraw();
  // the decision is set on the scene (the inner life's idleUntil) BEFORE the next still frame, due between two still ticks
  b.idleUntil = L + 45;   // still ticks would land at L+33.3 and L+66.7; the first vsync at/after the clock is L+50
  w.runUntil(L + 200);
  const after = w.env.draws.filter(t => t > L + 34);
  A.ok(Math.abs(after[0] - (L + 50)) < 0.01, 'the body starts walking ON the first vsync after its clock (drawn at +' + (after[0] - L).toFixed(1) + ' ms, not +66.7)');
  A.ok(b.state === 'walk' && b.walkFrom === after[0], '...and that very draw is the one that shows it walking');
  const gaps = after.slice(1, 6).map((t, i) => t - after[i]);
  A.ok(gaps.every(g => Math.abs(g - 1000 / 60) < 0.01), '...followed at the normal 60/s pace (' + gaps.map(g => g.toFixed(1)).join(' ') + ')');
}

// ---- 4b. what else starts between still frames: a fidget, a talk turn, a decision whose step lands next tick ------------
{
  // (a) the hero at a prop: maybeGlance's fidget comes due 3 ms after a still draw → drawn on the first vsync (+16.7, not +33.3).
  // The inner life arms it inside a tick (a frame), as maybeGlance does: here, the draw at/after armAt sets nextFidget = now + 3.
  const w = makeWorld(60), b = body({ goal: 'use', glanceCd: 0, nextFidget: Infinity });
  w.sb.agent = b;
  let armAt = Infinity, L = null;
  w.sb.scene = { step(now) {
    w.env.draws.push(now);
    if (b.goal === 'use' && now >= b.nextFidget) { b.dir = 'west'; b.fidgetAt = now; b.nextFidget = now + 4000; }
    if (now >= armAt && L == null) { L = now; b.nextFidget = now + 3; }
  } };
  w.W.frame(0); w.runUntil(1000);
  A.ok(w.W.st().stillNow, 'the hero standing at a prop, fidget not due, is still');
  armAt = w.env.now;
  w.runUntil(armAt + 200);
  const next = w.env.draws.find(t => t > L);
  A.ok(Math.abs(next - (L + 1000 / 60)) < 0.01 && b.fidgetAt === next, 'a fidget due 3 ms after a still draw is drawn on the first vsync (+' + (next - L).toFixed(1) + ' ms; the still tick is +33.3)');
}
{
  // (b) a talking huddle: the next speaker's turn opens between still frames → its mouth moves on that vsync
  const w = makeWorld(60), hero = body({ id: 'h' }), mate = body({ id: 'm', px: 220 });
  w.sb.agent = hero; w.sb.crew = [mate];
  const S = K.TALK_SLOT_MS, SP = K.TALK_SPEAK_MS;
  let setupAt = null;
  w.sb.scene = { step(now) {
    w.env.draws.push(now);
    if (setupAt == null && now >= 500) {   // the encounter settles into its hold: slot 0's mouth time is already over
      setupAt = now;
      w.sb.socialBeat = { startedAt: now - SP - 10, until: now + 1e6, lastArrivalAt: now - SP - 10 };
      for (const [i, bd] of [hero, mate].entries()) bd.social = { phase: 'hold', kind: 'huddle', holdAt: now - SP - 10, holdLen: 1e6, seat: i };
    }
    const sbt = w.sb.socialBeat;
    if (sbt) for (const bd of [hero, mate]) {   // talkTurn: seat k talks for the first SPEAK ms of every k-th slot
      const e = now - sbt.startedAt, k = Math.floor(e / S);
      bd.talking = bd.speaking = (k % 2) === bd.social.seat && e - k * S < SP;
      if (bd.talking && bd.talkFrom == null) bd.talkFrom = now;
    }
  } };
  w.W.frame(0); w.runUntil(900);
  const open = w.sb.socialBeat.startedAt + S;   // slot 1 (the mate's) opens here
  A.ok(open > 900 && hero.talkFrom == null && mate.talkFrom == null, 'the huddle sits in the silence between turns (slot 1 opens at ' + open.toFixed(1) + ')');
  A.ok(w.W.st().stillNow, '...and the silence is still');
  w.runUntil(open + 100);
  A.ok(Math.abs(mate.talkFrom - w.firstVsyncAtOrAfter(open)) < 0.01, "the mate's mouth moves on the first vsync of its turn (+" + (mate.talkFrom - open).toFixed(1) + ' ms after the slot opens)');
}
{
  // (c) a decision frame: the encounter is DECIDED on a due vsync (only goal + plan change); stepSocial paths it on the NEXT tick
  const w = makeWorld(60), b = body({ goal: null });
  w.sb.agent = b;
  let last = 0, decidedAt = null;
  w.sb.scene = { step(now) {
    w.env.draws.push(now);
    const dt = last ? now - last : 0; last = now;
    if (b.state === 'walk') b.px += 0.03 * dt;
    if (b.goal === 'social' && b.social.phase === 'walk' && b.state !== 'walk') { b.state = 'walk'; b.target = { x: 400, y: 150 }; b.walkFrom = now; }
    if (b.goal == null && now >= b.idleUntil) { b.goal = 'social'; b.social = { phase: 'walk' }; b.idleUntil = Infinity; decidedAt = now; }
  } };
  w.W.frame(0); w.runUntil(1000);
  const L = w.toNextDraw();
  b.idleUntil = L + 45;
  const x0 = b.px;
  w.runUntil(L + 300);
  A.ok(Math.abs(decidedAt - (L + 50)) < 0.01, 'the encounter is decided on the first vsync after its clock (+' + (decidedAt - L).toFixed(1) + ' ms)');
  A.ok(Math.abs(b.walkFrom - (decidedAt + 1000 / 60)) < 0.01, '...and the walk it starts is drawn the very next vsync (+' + (b.walkFrom - decidedAt).toFixed(1) + ' ms after the decision; the still tick is +33.3)');
  const firstStep = w.env.draws.find(t => t > b.walkFrom);
  A.ok(Math.abs((firstStep - b.walkFrom) - 1000 / 60) < 0.01, '...at the normal pace from its first step (' + (firstStep - b.walkFrom).toFixed(1) + ' ms, so no step covers two ticks of ground)');
  A.ok(b.px > x0, '(the body really walked)');
}

// ---- 5. a wake from outside the frame (input, a harness event, a World API call) lands on the next vsync ------------
{
  const w = makeWorld(60), b = body();
  w.sb.agent = b; walkerScene(w, b);
  w.W.frame(0);
  w.runUntil(1000);
  const L = w.toNextDraw();
  w.at(L + 5, () => { b.state = 'walk'; w.W.motionWake(); });   // e.g. World.setActivity → the body walks, from outside the frame
  w.runUntil(L + 100);
  const next = w.env.draws.find(t => t > L);
  A.ok(Math.abs(next - (L + 1000 / 60)) < 0.01, 'a wake 5 ms into a still interval is drawn on the very next vsync (+' + (next - L).toFixed(1) + ' ms)');
  A.eq(w.W.st().stillWhy, 'body', '...and the floor stays at the normal pace while the body walks');

  const w2 = makeWorld(60), b2 = body();
  w2.sb.agent = b2; walkerScene(w2, b2);
  w2.W.frame(0); w2.runUntil(1000);
  const L2 = w2.toNextDraw();
  w2.at(L2 + 3, () => w2.W.userActive());   // a pointermove on the window
  w2.runUntil(L2 + 100);
  const next2 = w2.env.draws.find(t => t > L2);
  A.ok(Math.abs(next2 - (L2 + 1000 / 60)) < 0.01, 'a hand on the window wakes a still floor on the next vsync');
  A.eq(w2.W.st().stillWhy, 'input', '...and holds the normal pace while the hand is there (hover tags, glances)');
  w2.runUntil(L2 + w2.W.consts.INPUT_HOLD_MS + 300);
  A.eq(w2.W.renderPace().mode, 'still', '...and the floor goes still again once the hand has been away INPUT_HOLD_MS');
}

// ---- 6. the caller cap and the budget keep their meaning ------------------------------------------------------------
{
  const w = makeWorld(60), b = body();
  w.sb.agent = b; walkerScene(w, b);
  w.W.frame(0); w.runUntil(1000);
  w.sb.frameCapMs = 48;
  A.eq(w.W.paceMs(w.env.now), 48, "a caller's frame cap (HUD widget) is its stated intent: the still tier never overrides it");
  A.eq(w.W.renderPace().mode, 'capped', "...and renderPace says 'capped'");
  w.sb.frameCapMs = 0;
  for (let i = 0; i < 80; i++) w.W.noteDrawCost(40);
  A.ok(Math.abs(w.W.paceMs(w.env.now) - 40 / 0.7) < 0.5, 'a slow floor stretches past the still pace by its budget (the budget still wins)');
  A.eq(w.W.renderPace().mode, 'budget', "...and renderPace says 'budget'");
  w.W.resetBudget();
}

// ---- 7. every motion source flips the still flag; ambient ones do not ---------------------------------------------------
{
  const w = makeWorld(60), sb = w.sb, W = w.W;
  const hero = body({ id: 'hero' }), mate = body({ id: 'mate', px: 300 });
  sb.agent = hero; sb.crew = [mate];
  let now = 5000;
  const verdict = (inFrame) => { W.stillBegin(); if (inFrame) inFrame(); W.stillVerdict(now); return W.st(); };
  const settle = () => { verdict(); return verdict(); };
  A.ok(settle().stillNow, 'a settled scene with two idle bodies is still');
  const flip = (why, label, mutate, revert, inFrame) => {
    mutate();
    const s = verdict(inFrame);
    A.ok(!s.stillNow && s.stillWhy === why, label + ' → not still (' + why + ')' + (s.stillWhy !== why ? ' [got ' + s.stillWhy + ']' : ''));
    if (revert) revert();
    now += 2000;   // past every hold window
    A.ok(settle().stillNow, '...and still again once it stops (' + label + ')');
  };
  const calm = (label, mutate, revert) => {
    mutate();
    const s = settle();
    A.ok(s.stillNow, label + ' → still (ambient)' + (s.stillNow ? '' : ' [got ' + s.stillWhy + ']'));
    if (revert) revert();
    settle();
  };
  // wake
  flip('wake', 'motionWake during the frame (a bus event, a World API call)', () => {}, null, () => W.motionWake());
  // camera
  flip('camera', 'a pan', () => { sb.panX += 7; });
  flip('camera', 'a zoom', () => { sb.scale *= 1.1; });
  flip('camera', 'a focus ease running', () => { sb.camLerp = { scale: 3, panX: 0, panY: 0 }; }, () => { sb.camLerp = null; });
  flip('camera', 'a scripted camera move', () => { sb.camAnim = { t: 0 }; }, () => { sb.camAnim = null; });
  flip('camera', 'the hand hold after a drag', () => { sb.performance.now = () => now; W.cameraMoved(); }, null);
  // input
  flip('input', 'a hand on the window', () => { W.userActive(); }, null);
  flip('input', "the hero's mic listening", () => { sb.Voice = { isListening: () => true, isSpeaking: () => false }; }, () => { delete sb.Voice; });
  flip('speech', "the hero's voice speaking", () => { sb.Voice = { isListening: () => false, isSpeaking: () => true }; }, () => { delete sb.Voice; });
  // bodies (hero and crew alike)
  flip('body', 'a body walking', () => { mate.state = 'walk'; }, () => { mate.state = 'idle'; });
  flip('body', 'a body moved', () => { hero.px += 1; });
  flip('body', 'a body turned', () => { mate.dir = 'west'; });
  flip('body', 'a body changed pose (a blink)', () => { hero._pose = 'set.blink.south'; });
  flip('body', 'a body changed drawn frame', () => { mate._renderFrame = 1; });
  flip('body', 'a body pivoting', () => { hero._rW = 3; }, () => { hero._rW = 0; });
  flip('body', 'a pose dissolving', () => { mate._renderPoseFade = 0.4; }, () => { mate._renderPoseFade = null; });
  flip('body', 'a body working (typing; its desk shows the run)', () => { hero.working = true; }, () => { hero.working = false; });
  flip('body', 'a body speaking', () => { mate.speaking = true; }, () => { mate.speaking = false; });
  flip('body', 'a body talking (silent exchange)', () => { mate.talking = true; }, () => { mate.talking = false; });
  flip('body', 'a wake ripple', () => { mate.wakeAt = now; });
  flip('body', 'a level-up surge', () => { mate.levelUpAt = now; });
  flip('body', 'a summoned worker glowing', () => { mate.workUntil = now + 900; });
  flip('body', "a body's drawn geometry moving on the clock (the idle bob, a planted body's breath: _renderLive)", () => { mate._renderLive = true; }, () => { mate._renderLive = false; });
  flip('body', 'a decision: the goal changed (what it starts shows next tick)', () => { mate.goal = 'inspect'; });
  flip('body', 'a decision: the state changed', () => { hero.state = 'social'; }, () => { hero.state = 'idle'; });
  flip('body', 'a body holding a walk target (about to step)', () => { mate.target = { x: 1, y: 1 }; }, () => { mate.target = null; });
  flip('body', 'a social plan still to walk (stepSocial paths it next tick)', () => { mate.social = { phase: 'walk' }; }, () => { mate.social = null; });
  flip('body', 'a gather plan still to walk (stepGather paths it next tick)', () => { mate.gather = { arrived: false }; }, () => { mate.gather = null; });
  flip('body', 'a chase due to repath toward the cursor', () => { mate.chase = { phase: 'pursue', repathAt: now - 1 }; }, () => { mate.chase = null; });
  flip('body', "the hero's glance roll pending (maybeGlance rolls every tick once glanceCd lapses)", () => { hero.glanceCd = now - 1; }, () => { hero.glanceCd = Infinity; });
  flip('body', "the hero at a prop with its fidget lapsed", () => { hero.goal = 'use'; hero.glanceCd = 0; hero.nextFidget = now - 1; }, () => { hero.goal = null; hero.glanceCd = Infinity; hero.nextFidget = 0; });
  flip('speech', 'a peer-chatter line', () => { mate.chatter = { until: now + 800 }; }, () => { mate.chatter = null; });
  // the floor's movers
  flip('crate', 'a crate riding', () => { sb.convey = { boxCount: () => 1 }; }, () => { sb.convey = null; });
  flip('crate', 'a ghost projection riding', () => { sb.geo = { belts: [] }; sb.ghost = { nextChange: n => n }; }, () => { sb.ghost = null; sb.geo = null; });
  flip('crate', 'a hand-off box in flight', () => { sb.handoffBoxes.push({}); }, () => { sb.handoffBoxes.length = 0; });
  flip('crate', 'a SEND TO crate in flight', () => { sb.sendCrates.push({ t0: now, born: now - 100 }); }, () => { sb.sendCrates.length = 0; });
  flip('crate', 'a queue jam bobbing (drawQueueJam)', () => {}, null, () => W.stillMove('crate'));
  flip('prop', 'a prop with live content (the prop pass)', () => {}, null, () => W.stillMove('prop'));
  flip('prop', "a drawn prop whose art moves on its clock (PropSprites.clockNext: a native draw, fish, a screen's sweep)", () => { sb.PropSprites = { clockNext: () => now }; }, () => { delete sb.PropSprites; });
  flip('prop', 'a harness pulse decaying (a tool-fire surge, a connector packet: PropSprites.pulsing)', () => { sb.PropSprites = { pulsing: () => true, clockNext: () => Infinity }; }, () => { delete sb.PropSprites; });
  flip('sky', 'a meteor crossing the sky (SpaceBG.nextChange)', () => { sb.SpaceBG = { nextChange: n => n }; }, () => { delete sb.SpaceBG; });
  flip('belt', 'an energized belt in frame (no plan: every tile live)', () => { sb.geo = { belts: [{ x: 4, y: 4 }] }; sb.beltLiveSet = null; }, () => { sb.geo = null; });
  flip('belt', 'an energized belt in frame (on the compiled live route)', () => { sb.geo = { belts: [{ x: 4, y: 4 }, { x: 5, y: 4 }] }; sb.beltLiveSet = { '5,4': true }; }, () => { sb.geo = null; sb.beltLiveSet = null; });
  // canvas overlays and ceremonies
  flip('fx', 'the CRT roll bar sweeping (drawCRT)', () => {}, null, () => W.stillMove('fx'));
  flip('fx', 'a desk flash', () => { sb.deskFlash.set('a', { at: now }); }, () => sb.deskFlash.clear());
  flip('fx', 'a dock flash', () => { sb.dockFlashes.set('p', now); }, () => sb.dockFlashes.clear());
  flip('fx', 'the pin flourish', () => { sb.pinFlourishAt = now; });
  flip('fx', 'the FIRST SHIP pulse', () => { sb.firstShipPulse = { at: now }; }, () => { sb.firstShipPulse = null; });
  flip('fx', 'the awakening', () => { sb.awakeFrozen = true; }, () => { sb.awakeFrozen = false; });
  flip('fx', 'the arrival', () => { sb.arrivalScene = {}; }, () => { sb.arrivalScene = null; });
  flip('fx', 'the kindling', () => { sb.kindleArmed = true; }, () => { sb.kindleArmed = false; });
  flip('fx', 'the flood', () => { sb.floodAt = now; }, () => { sb.floodAt = 0; });
  flip('fx', 'the dawn veil easing', () => { sb.wakeDark = 0.4; }, () => { sb.wakeDark = 0; });
  flip('fx', 'the dawn bloom', () => { sb.dawnAt = now; });
  flip('fx', 'the ignition spark', () => { sb.sparkAt = now; });
  flip('fx', 'color-into-being', () => { sb.bornAt = now; });
  flip('fx', 'a truth flare', () => { sb.truthPulseAt = now; });
  flip('fx', "the hero's wake ripple", () => { sb.wakeAt = now; });
  flip('fx', "the hero's level surge", () => { sb.levelUpAt = now; });
  // ambient — none of these is motion
  calm('a body nudged by float dust (< 0.01 px)', () => { hero.px += 0.001; });
  calm('a body walking OFF screen', () => { mate.px = -5000; mate.state = 'walk'; }, () => { mate.state = 'idle'; mate.px = 300; });
  calm('a cold belt (not on the live route)', () => { sb.geo = { belts: [{ x: 4, y: 4 }] }; sb.beltLiveSet = { '9,9': true }; }, () => { sb.geo = null; sb.beltLiveSet = null; });
  calm('an energized belt out of frame', () => { sb.geo = { belts: [{ x: 400, y: 400 }] }; sb.beltLiveSet = null; }, () => { sb.geo = null; });
  calm('a ghost waiting to spawn', () => { sb.geo = { belts: [] }; sb.ghost = { nextChange: () => now + 2500 }; }, () => { sb.ghost = null; sb.geo = null; });
  calm('a desk flash that has run its course (its pass skipped: overlays off)', () => { sb.deskFlash.set('a', { at: now - 5000 }); sb.dockFlashes.set('p', now - 5000); sb.firstShipPulse = { at: now - 5000 }; }, () => { sb.deskFlash.clear(); sb.dockFlashes.clear(); sb.firstShipPulse = null; });
  calm('a static speech bubble', () => { hero.say = { text: 'hello', until: now + 3000 }; }, () => { hero.say = null; });
  calm('every drawn prop static, alpha-only glow or frozen (clockNext Infinity, no pulse)', () => { sb.PropSprites = { clockNext: () => Infinity, pulsing: () => false }; }, () => { delete sb.PropSprites; });
  calm('a sky with nothing crossing (drift and twinkle are ambient)', () => { sb.SpaceBG = { nextChange: () => Infinity }; }, () => { delete sb.SpaceBG; });
  calm('a meteor on a LANDED station (no sky is drawn there)', () => { sb.SpaceBG = { nextChange: n => n }; sb.Terrain = { active: () => true }; }, () => { delete sb.SpaceBG; delete sb.Terrain; });
  calm('a meteor during a still render (no sky in it)', () => { sb.SpaceBG = { nextChange: n => n }; sb.stillPass = { fill: '#000' }; }, () => { delete sb.SpaceBG; sb.stillPass = null; });
  calm("an asleep hero with its glance cooldown lapsed (maybeGlance skips sleep)", () => { hero.goal = 'sleep'; hero.glanceCd = 0; }, () => { hero.goal = null; hero.glanceCd = Infinity; });
  calm('a crew body with its glance cooldown lapsed (crew have no maybeGlance)', () => { mate.glanceCd = 0; }, () => { mate.glanceCd = Infinity; });
  calm('a talk encounter in the silence between turns', () => {
    sb.socialBeat = { startedAt: now - K.TALK_SPEAK_MS - 100, until: now + 1e6, lastArrivalAt: now - 5000 };
    mate.social = { phase: 'hold', kind: 'huddle', holdAt: now - 5000, holdLen: 1e6 };
  }, () => { sb.socialBeat = null; mate.social = null; });

  // ---- the changes the frame can see coming: stillDue -------------------------------------------------------------
  const due = (label, mutate, at, revert, inFrame) => {
    mutate();
    verdict(inFrame); const s = verdict(inFrame);
    A.ok(s.stillNow && Math.abs(s.stillDue - at) < 1e-6, label + ' sets stillDue (+' + (s.stillDue - now).toFixed(0) + ' ms' + (s.stillNow ? '' : ', got motion: ' + s.stillWhy) + ')');
    if (revert) revert();
    settle();
  };
  due("an idle body's next decision (idleUntil)", () => { mate.idleUntil = now + 700; }, now + 700, () => { mate.idleUntil = Infinity; });
  due('a glance cooldown ending (glanceCd)', () => { hero.glanceCd = now + 450; }, now + 450, () => { hero.glanceCd = Infinity; });
  due("a glance turning back", () => { hero.glance = { until: now + 380, dir: 'west' }; }, now + 380, () => { hero.glance = null; });
  due("a body's next fidget (nextFidget)", () => { mate.nextFidget = now + 640; }, now + 640, () => { mate.nextFidget = 0; });
  due("the hero at a prop: its fidget, not its lapsed glance cooldown", () => { hero.goal = 'use'; hero.glanceCd = 0; hero.nextFidget = now + 820; }, now + 820, () => { hero.goal = null; hero.glanceCd = Infinity; hero.nextFidget = 0; });
  due("the hero watching a belt: THE LOOK-UP's floor (lookCd), not its lapsed glance cooldown", () => { hero.goal = 'watch'; hero.glanceCd = 0; hero.lookCd = now + 930; }, now + 930, () => { hero.goal = null; hero.glanceCd = Infinity; hero.lookCd = 0; });
  due("the next blink / clock-driven pose frame (drawBody's _renderNextAt)", () => { mate._renderNextAt = now + 120; }, now + 120, () => { mate._renderNextAt = 0; });
  due('a speech bubble vanishing', () => { mate.say = { text: 'ok', until: now + 2600 }; }, now + 2600, () => { mate.say = null; });
  due('an encounter hold ending (from the last arrival)', () => {
    sb.socialBeat = { until: now + 1e6, lastArrivalAt: now - 100 };
    mate.social = { phase: 'hold', kind: 'watch', holdAt: now - 400, holdLen: 900 };
  }, now + 800, () => { sb.socialBeat = null; mate.social = null; });
  due('the next talk turn opening (talkTurn slots)', () => {
    const s0 = now - K.TALK_SLOT_MS - (K.TALK_SPEAK_MS + 150);   // slot 1, past its mouth time: slot 2 opens next
    sb.socialBeat = { startedAt: s0, until: now + 1e6, lastArrivalAt: s0 };
    mate.social = { phase: 'hold', kind: 'huddle', holdAt: s0, holdLen: 1e6 };
  }, now + K.TALK_SLOT_MS - K.TALK_SPEAK_MS - 150, () => { sb.socialBeat = null; mate.social = null; });
  due('a chase stare ending', () => { mate.chase = { phase: 'stare', until: now + 900, endAt: now - 1, hardUntil: now + 5000, repathAt: now - 1 }; }, now + 900, () => { mate.chase = null; });
  due('a chase between repaths', () => { mate.chase = { phase: 'pursue', endAt: now + 3000, hardUntil: now + 9000, repathAt: now + 600 }; }, now + 600, () => { mate.chase = null; });
  due('the cursor going stale under a chase', () => { sb.lastCursor = { wx: 0, wy: 0, t: now - K.CURSOR_FRESH_MS + 300 }; mate.chase = { phase: 'pursue', endAt: now + 3000, hardUntil: now + 9000, repathAt: now + 600 }; }, now + 300, () => { mate.chase = null; sb.lastCursor = { wx: 0, wy: 0, t: -1e9 }; });
  due('a mimic ending', () => { mate.mimic = { until: now + 450 }; }, now + 450, () => { mate.mimic = null; });
  due('a held SEND TO crate releasing at its grace', () => { sb.sendCrates.push({ t0: 0, born: now - 1000 }); }, now + 7000, () => { sb.sendCrates.length = 0; });
  due('a ghost spawn', () => { sb.geo = { belts: [] }; sb.ghost = { nextChange: () => now + 2500 }; }, now + 2500, () => { sb.ghost = null; sb.geo = null; });
  due("a drawn prop's next stepped frame (an occupied screen's beam)", () => { sb.PropSprites = { clockNext: () => now + 210 }; }, now + 210, () => { delete sb.PropSprites; });
  due('the next meteor', () => { sb.SpaceBG = { nextChange: () => now + 2222 }; }, now + 2222, () => { delete sb.SpaceBG; });
  due("a draw pass's own due change (drawCRT: the static grain's next step)", () => {}, now + 66, null, () => W.noteDue(now + 66, now));
  due('the cinecam re-cast', () => { sb.camLock = { id: 'a', source: 'cine' }; sb.cineHoldUntil = now + 900; }, now + 900, () => { sb.camLock = null; });
  due("the cinecam's 3 s still-subject grace", () => { sb.cineWalkAt = now - 1000; }, now + 2000, () => { sb.cineWalkAt = -1e9; });
  due('an encounter ending', () => { sb.socialBeat = { until: now + 1500 }; }, now + 1500, () => { sb.socialBeat = null; });
  due('an assembly converging', () => { sb.gathering = { phase: 'converge', convergeUntil: now + 700, until: now + 1e6 }; }, now + 700, () => { sb.gathering = null; });
  due("the overseer's next line (an assembly holding, between lines)", () => {
    sb.gathering = { phase: 'hold', holdFrom: now - K.GATHER_SPEAK_MS - 400, holdLen: 1e6, until: now + 1e6 };
  }, now + K.GATHER_GAP_MS - 400, () => { sb.gathering = null; });
  due('an assembly breaking up (the overseer leaves last)', () => { sb.gathering = { phase: 'breaking', scatterAt: now - 100, until: now + 1e6 }; }, now + K.OVERSEER_BREAK_MS - 100, () => { sb.gathering = null; });
  due('the next gathering roll (maybeGather, every tick)', () => { sb.gatherRollAt = now + 1234; }, now + 1234, () => { sb.gatherRollAt = -1e9; });
  due('the station going quiet long enough to gather', () => { sb.stationBusyAt = now - K.GATHER_QUIET_MS + 500; }, now + 500, () => { sb.stationBusyAt = -1e9; });
  due('the COMMS stare going cold', () => { sb.chatFocusId = 'hero'; sb.chatWarmUntil = now + 1500; }, now + 1500, () => { sb.chatFocusId = null; sb.chatWarmUntil = -1e9; });
  due('the link going stale (LINK DOWN)', () => { sb.lastSseEventAt = now - K.LINK_STALE_MS + 777; }, now + 777, () => { sb.lastSseEventAt = 0; });
  calm('an off-screen body\'s clock (invisible: it re-enters through the pad)', () => { mate.px = -5000; mate.idleUntil = now + 300; }, () => { mate.px = 300; mate.idleUntil = Infinity; });
  calm('gathering gates under reduced motion (no assembly ever rolls)', () => { sb.rmOn = true; sb.gatherRollAt = now + 50; }, () => { sb.rmOn = false; sb.gatherRollAt = -1e9; });
  A.ok(settle().stillDue === Infinity || settle().stillDue > now, 'past clocks are never due');
}

// ---- 8. the wiring in the real world.js ---------------------------------------------------------------------------
const bodySrc = A.fnBody(code, 'function frameBody(now)');
A.ok(/^\s*function frameBody\(now\) \{\s*stillBegin\(\);/.test(bodySrc), 'frameBody judges itself: stillBegin() is its first act');
A.ok(/drawScene\(now, dt, slices\);\s*stillVerdict\(now\);\s*\}$/.test(bodySrc.trim()), '...and stillVerdict(now) its last, after the scene drew');
A.ok(/if \(!cache\) \{[\s\S]{0,400}return;/.test(bodySrc) && bodySrc.indexOf('stillBegin()') < bodySrc.indexOf('if (!cache)'),
  'a frame with no bake (the early return) is never judged still');
A.ok(/function stillBegin\(\) \{[^}]*stillDueAcc = Infinity;/.test(code) && !/function stillVerdict\(now\) \{[\s\S]*?stillDueAcc = Infinity/.test(A.fnBody(code, 'function stillVerdict(now)')),
  "the due accumulator is cleared at the TOP of the frame, so a draw pass's noteDue survives to the verdict");
const sceneSrc = A.fnBody(code, 'function drawScene(now, dt, slices)');
A.ok(/^function drawScene\(now, dt, slices\) \{\s*if \(!slices\) slices = \[\[dt, now\]\];\s*if \(typeof PropSprites !== 'undefined' && PropSprites\.clockBegin\) PropSprites\.clockBegin\(\);/.test(sceneSrc),
  "every scene pass starts the props' clock readout afresh (PropSprites.clockBegin)");
A.ok(/if \(!stillMark && \(\(work && !\(leisureProps\.has\(p\.id\) && restingOn\(p\)\)\) \|\| \(live && \(live\.heat > 0 \|\| live\.prog != null \|\| live\.scanning\)\)\)\s*&& propOnScreen\(p\)\) stillMove\('prop'\);/.test(sceneSrc),
  'the prop pass marks an on-screen prop with live content (work, heat, a progress strip, a scan) as motion');
A.ok(/stillMove\('crate'\);[^\n]*\n\s*for \(let i = 0; i < shown; i\+\+\) drawWaitCrate/.test(A.fnBody(code, 'function drawQueueJam(now)')), 'a standing queue jam (its crates bob) marks the frame moving');
{
  const crt = A.fnBody(code, 'function drawCRT(now)');
  A.ok(/const PER = 16800, SWEEP = 2600, t = now % PER;\s*if \(t < SWEEP\) stillMove\('fx'\); else noteDue\(now - t \+ PER, now\);/.test(crt), "the CRT roll bar is motion while it sweeps, and its next sweep is due");
  A.ok(/const fi = reduceMotion\(\) \? 0 : Math\.floor\(now \/ 66\);\s*if \(!reduceMotion\(\)\) noteDue\(\(fi \+ 1\) \* 66, now\);/.test(crt), "the CRT static's next 66 ms step is due (it lands on its own vsync)");
}
A.ok(/if \(!geom && !\(typeof SPRITES !== 'undefined' && SPRITES\.loading\)\) drawFallback\(now, who\);\s*if \(!geom\) who\._renderLive = !who\.sitting;/.test(A.fnBody(code, 'function drawAgent(now, who)')),
  'a procedural fallback body (it bobs while it stands) reports itself live');
A.ok(/if \(now - pinCheckAt < 400\) \{ if \(\(count \| 0\) > pinnedCount\) noteDue\(pinCheckAt \+ 400, now\); return; \}/.test(A.fnBody(code, 'function maybePinProposal(now, count)')),
  "a pin walk waiting on maybePinProposal's 400 ms re-check is due at it");
A.ok(/if \(typeof U\.bus\.tap === 'function'\) U\.bus\.tap\(motionWake\);/.test(A.fnBody(code, 'function connectChannelBridge()')), 'every harness event on U.bus wakes a still floor');
A.ok(/function setActivityFor\(agentId, kind\) \{\s*motionWake\(\);/.test(code), 'a body summoned or released by the floor itself (a reconcile, the TTL sweep) wakes it');
A.ok(/return wakeOnCall\(\{ init, rebake,/.test(code), 'the World API is returned through the STILL WAKE wrapper');
{
  const m = world.match(/const WAKE_API = new Set\(\[([\s\S]*?)\]\);/);
  const names = m ? m[1].match(/'[^']+'/g).map(s => s.slice(1, -1)) : [];
  const api = code.slice(code.indexOf('return wakeOnCall({'));
  const missing = names.filter(n => !new RegExp('[{,\\s]' + n + '\\s*[,:(]').test(api));
  A.ok(names.length > 30 && !missing.length, 'every WAKE_API name is a real export (' + names.length + ' names' + (missing.length ? '; missing: ' + missing.join(', ') : '') + ')');
  for (const n of ['say', 'setActivity', 'setActivityFor', 'focusAgent', 'focusBody', 'lockBody', 'spawnAgent', 'despawnAgent', 'pulseLevelUp', 'loadStation'])
    A.ok(names.includes(n), 'World.' + n + ' wakes a still floor');
  for (const n of ['renderPace', 'cameraState', 'cameraDbg', 'dbg', 'getActivity', 'crewFrames', 'planStatus'])
    A.ok(!names.includes(n), 'World.' + n + ' is a read: polling it never keeps a still floor at full pace');
}

// ---- 8b. THE CLOCK RATCHET: every clock the frame clock is compared against in world.js is due in the verdict, or exempt for
// a stated reason. A gate the verdict does not know is up to 33 ms of latency on every change it gates — so a NEW one fails
// here until it is classified. Gates are `now|fnow <op> X` and `X <op> now|fnow` (X a field path, `X || 0` included), and
// object-qualified: a body field (agent/self/b/body/me/other/who/obs) reads as `body.<field>`, a nested one as `<obj>.<field>`.
{
  const vsrc = strip(world.slice(vFrom, vTo));
  let gcode = world;
  for (const [a, b] of [['  const PACE_VISIBLE_MS', '  function renderPace()'], ['  /* STILL VERDICT', '  // ---- end STILL VERDICT']]) {
    const i = gcode.indexOf(a), j = gcode.indexOf(b, i); gcode = gcode.slice(0, i) + gcode.slice(j);
  }
  gcode = strip(gcode);
  const PATHRE = '[A-Za-z_$][\\w$]*(?:\\.[A-Za-z_$][\\w$]*|\\.get\\([^)]*\\))*', OPRE = '(?:>=|<=|<|>)';
  const BODY = /^(agent|self|b|body|me|other|who|obs|to)$/;
  const keys = new Set();
  const add = p => {
    if (/^(now|fnow|t|Math|Infinity)$/.test(p)) return;
    const parts = p.replace(/\.get\([^)]*\)/g, '.get').split('.');
    if (parts.length === 1) { keys.add(parts[0]); return; }
    const obj = parts[parts.length - 2], f = parts[parts.length - 1];
    keys.add((BODY.test(obj) && parts.length === 2 ? 'body' : obj) + '.' + f);
  };
  for (const m of gcode.matchAll(new RegExp('\\b(?:now|fnow)\\s*' + OPRE + '\\s*\\(?\\s*(' + PATHRE + ')', 'g'))) add(m[1]);
  for (const m of gcode.matchAll(new RegExp('(' + PATHRE + ')\\s*(?:\\|\\|\\s*0\\s*)?\\)?\\s*' + OPRE + '\\s*(?:now|fnow)\\b', 'g'))) add(m[1]);
  const clocks = new Set(makeWorld(60).W.consts.BODY_CLOCKS);
  // tracked: the verdict must name it (RegExp over the verdict's source)
  const TRACKED = {
    'glance.until': /b\.glance\.until/, 'say.until': /b\.say\.until/, 's.until': /b\.say\.until/, 'chatter.until': /b\.chatter\.until/,
    'ch.until': /noteDue\(ch\.until, now\)|b\.chatter\.until/, 'pl.until': /noteDue\(ch\.until, now\)[\s\S]*noteDue\(b\.mimic\.until, now\)/,
    'pl.endAt': /noteDue\(ch\.endAt, now\)/, 'pl.hardUntil': /noteDue\(ch\.hardUntil, now\)/, 'pl.repathAt': /ch\.repathAt > now[\s\S]*noteDue\(ch\.repathAt, now\)/,
    'holdFrom': /socialBeat\.lastArrivalAt\) \|\| pl\.holdAt \|\| 0\) \+ \(pl\.holdLen \|\| 0\)/,
    'socialBeat.until': /noteDue\(socialBeat\.until, now\)/, 'gathering.until': /noteDue\(gathering\.until, now\)/,
    'gathering.convergeUntil': /noteDue\(gathering\.convergeUntil, now\)/, 'gathering.holdFrom': /noteDue\(h0 \+ \(gathering\.holdLen \|\| 0\), now\)/,
    'gatherGateUntil': /noteDue\(gatherGateUntil, now\)/, 'gatherRollAt': /noteDue\(gatherRollAt, now\)/, 'chatWarmUntil': /noteDue\(chatWarmUntil, now\)/,
    'cineHoldUntil': /noteDue\(cineHoldUntil, now\)/, 'motionUntil': /now < motionUntil/,
  };
  // exempt: why the verdict need not know it
  const DECISION = 'read only inside a decision that a body clock (BODY_CLOCKS) or an event triggers — it starts nothing by itself';
  const EXEMPT = {
    'body.ackScanAt': 'the acknowledgement re-scan gap: it acts only on a body walking past in view — motion already',
    'emote.until': 'a dev readout (World.bodies), never a gate', 'attn.until': DECISION, 'beltWatch.until': DECISION, 'socialPairCd.get': DECISION,
    'socialGateUntil': DECISION, 'crewBeatGateUntil': DECISION, 'chaseGateUntil': DECISION, 'placeCd': DECISION, 'postCd': DECISION, 'lastUntil': DECISION,
    'userReturnUntil': "raises THE LOOK-UP's chance inside maybeGlance, whose pending roll is motion (heroGlanceAt)",
    'plan.until': 'a traffic plan for a body holding a walk target — motion already', 'trafficRetry.get': 'a traffic retry for a body holding a walk target — motion already',
    'forgetAt': 'habituation decay: it changes later decisions, nothing drawn', 'mournCd': 'gates a grief beat that a prop edit queues (an input / World API wake)',
  };
  const unknown = [], stale = [];
  for (const k of keys) {
    if (k.startsWith('body.') && clocks.has(k.slice(5))) continue;
    if (TRACKED[k]) { if (!TRACKED[k].test(vsrc)) stale.push(k); continue; }
    if (EXEMPT[k]) continue;
    unknown.push(k);
  }
  A.ok(keys.size > 60, 'the ratchet found the inner life\'s gates (' + keys.size + ' clocks)');
  A.ok(!unknown.length, 'every clock world.js gates on is due in the verdict or exempt for a reason' + (unknown.length ? ' — unclassified: ' + unknown.sort().join(', ') : ''));
  A.ok(!stale.length, 'every clock classified as tracked really is read by the verdict' + (stale.length ? ' — not found: ' + stale.join(', ') : ''));
  const unused = Object.keys(EXEMPT).concat(Object.keys(TRACKED)).filter(k => !keys.has(k));
  A.ok(!unused.length, 'the ratchet table names no clock world.js no longer has' + (unused.length ? ' — remove: ' + unused.join(', ') : ''));
  const bodyUnused = [...clocks].filter(n => !keys.has('body.' + n) && !['hardUntil', 'convergeUntil', 'spokeUntil', 'lastFunUntil', 'barJoinUntil'].includes(n));
  A.ok(!bodyUnused.length, 'every BODY_CLOCKS name is a body clock world.js gates on' + (bodyUnused.length ? ' — not gated: ' + bodyUnused.join(', ') : ''));
}
// ambient stays ambient: the verdict never reads the light map, dust, glows or the backdrop's draw — only the sky's
// one allocation-free readout (SpaceBG.nextChange: a meteor, the bolide, the belt's shower)
{
  const vsrc = strip(world.slice(vFrom, vTo));
  A.ok(!/drawDust|drawGlows|drawNavLights|cache\.flickers|sceneRenderer|drawAtmosphere|SpaceBG\.draw/.test(vsrc), 'the verdict never treats the starfield, glows, dust or nav lights as motion');
  A.ok((vsrc.match(/SpaceBG\.\w+/g) || []).every(s => s === 'SpaceBG.nextChange'), '...and reads the sky only through SpaceBG.nextChange');
  A.ok(!/getImageData|\.slice\(|\.map\(|\.filter\(|\[agent, \.\.\.crew\]|new (?:Map|Set|Array)\(/.test(vsrc.replace(/const BODY_CLOCKS[\s\S]*?\]\);/, '').replace(/const REST_USE[^\n]*/, '')),
    'the verdict reads state, never pixels, and allocates nothing per frame');
}

// ---- 9. the readouts it reads (the prop / sky / remaster ones: test/render-still-readouts.test.js) ---------------------
A.ok(/b\._renderNextAt = clockNext;/.test(assets), "SPRITES.drawBody publishes when a body's drawn frame next changes on the clock (_renderNextAt)");
A.ok(/clockNext = Math\.min\(clockNext, nowMs \+ \(bt < 130 \? 130 - bt : 3300 - bt\)\)/.test(assets), '...the blink edge (eyes open / next shut)');
A.ok(/const q = nowMs \/ \(1000 \/ fps\) \+ aph;\s*clockNext = Math\.min\(clockNext, nowMs \+ \(Math\.floor\(q\) \+ 1 - q\) \* \(1000 \/ fps\)\);/.test(assets),
  '...and the next frame of a clock-driven track, from the same phase the frame index uses');
A.ok(/idx = fixedIdx != null[\s\S]{0,500}: Math\.floor\(nowMs \/ \(1000 \/ fps\) \+ aph\);/.test(assets), '(the frame index really is floor(now / (1000 / fps) + aph))');
{
  // _renderLive: published right after the bob, the breath and the speech accent are final, from exactly those three
  const i = assets.indexOf('b._renderLive = bob !== 0 || breath !== 0 || speech !== 0;');
  A.ok(i > 0 && i > assets.indexOf('if (reduced || planted) bob = 0;') && i > assets.indexOf('const breath = planted && !reduced'),
    "SPRITES.drawBody publishes _renderLive from the final bob, breath and speech accent (a breathing body is motion)");
}
{
  // ghostline.nextChange: the projection's motion and its next spawn, from its own clock
  const sb = { console, Conveyor: undefined };
  vm.createContext(sb);
  vm.runInContext(ghostline + '\nthis.GL = GhostLine;', sb);
  const g = sb.GL.create();
  A.eq(g.nextChange(1000), Infinity, 'an idle ghost projection reports nothing due');
  A.ok(/function nextChange\(nowMs\) \{\s*if \(\(engine && engine\.boxCount\(\) > 0\) \|\| notes\.length \|\| pendingChain\) return nowMs;\s*return cur && nextSpawnAt > 0 \? nextSpawnAt : Infinity;/.test(ghostline),
    'a riding ghost, a fading caption or a pending chain is motion now; otherwise the next spawn is due');
}
{
  // U.bus.tap: fires after an emit that reached a listener, never for one that reached nobody
  const sb = { console, window: {}, document: {}, navigator: {}, setTimeout, clearTimeout };
  vm.createContext(sb);
  vm.runInContext(util + '\nthis.U = U;', sb);
  const seen = [];
  sb.U.bus.tap(ev => seen.push(ev));
  sb.U.bus.on('agent.run.start', () => seen.push('handler'));
  sb.U.bus.emit('agent.run.start', {});
  sb.U.bus.emit('nobody.listens', {});
  A.eq(seen.join(','), 'handler,agent.run.start', 'U.bus.tap runs after the listeners of an emitted event, and not for an event nobody hears');
  sb.U.bus.tap(() => { throw new Error('tap boom'); });
  const err = console.error; console.error = () => {};
  try { A.notThrows(() => sb.U.bus.emit('agent.run.start', {}), 'a throwing tap never breaks the emit'); } finally { console.error = err; }
}

A.report('render still tier (Andrew 2026-10-21)');
