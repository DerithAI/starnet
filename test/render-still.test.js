/* node test/render-still.test.js — the STILL tier of RENDER PACING (world.js).

   Andrew, 2026-10-21 (approved): "draw 30/s while nothing on screen moves, snap back to 60 the instant anything moves
   (144 while panning)". The installed 0.13.5 idled at 178% of a core, 96% of it DRAWING an unchanged station 60x a second.
   The contract this file locks:
     1. a still scene is redrawn 30x a second, waiting in a timer (no per-vsync rAF spin) — and mode 'still' says so;
     2. anything that moves is drawn at the normal pace from the very next vsync: 60, or 144 while the hand pans;
     3. motion that STARTS between still frames never waits out the 33 ms tick — a body whose idle clock comes due
        mid-interval, and a wake from outside the frame (input, a harness event, a World API call), both land on the
        next vsync;
     4. every motion source the frame knows about flips the still flag, and the ambient ones (off-screen bodies, float
        dust, a static speech bubble, a cold belt) do not.
   The world is a browser IIFE: the pacer block, the verdict block and frame() are lifted out of the source and run in a vm
   sandbox on a fake vsync clock — behaviour, not prose. */
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
A.ok(vFrom > pTo && vTo > vFrom && vTo - vFrom < 12000, 'world.js carries the STILL VERDICT block after renderPace()');
const renderPaceSrc = A.fnBody(world, '  function renderPace()');
const frameSrc = A.fnBody(code, 'function frame(now, force)');
A.ok(renderPaceSrc && frameSrc && frameSrc.length < 3000, 'renderPace() and the paced frame(now, force) are found');

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
var bodyPosX = b => b ? (b.seated ? b.seatPx : b.px) : 0, bodyPosY = b => b ? (b.seated ? b.seatPy : b.py) : 0;
var propUse = p => (p && p.use) || null;
var scene = { step() {} };
function drawRenderFault() {}
function frameBody(now) { stillBegin(); scene.step(now); stillVerdict(now); }
`;
const EXPOSE = `
this.W = { paceMs, scheduleFrame, paceWake, motionWake, userActive, cameraMoved, renderPace, stillBegin, stillVerdict, stillMove, frame,
  noteDrawCost, resetBudget: () => { drawCostMs = 0; },
  st: () => ({ stillNow, stillWhy, stillDue, paceTimer, inputAt, motionUntil, vsyncMs }),
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
  return { sb, W, env, P, runUntil, toNextDraw, at: (t, fn) => actions.push({ at: t, fn }) };
}
const count = (arr, a, b) => arr.filter(t => t >= a && t < b).length;

// a body the scene sim moves: idle until its clock comes due, then walks 30 world px/s; drawBody's readouts held constant
function body(over) {
  return Object.assign({ id: 'a', px: 200, py: 150, dir: 'south', state: 'idle', idleUntil: Infinity, _pose: 'set.rot.south', _renderFrame: 0 }, over || {});
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
  flip('speech', 'a peer-chatter line', () => { mate.chatter = { until: now + 800 }; }, () => { mate.chatter = null; });
  // the floor's movers
  flip('crate', 'a crate riding', () => { sb.convey = { boxCount: () => 1 }; }, () => { sb.convey = null; });
  flip('crate', 'a ghost projection riding', () => { sb.geo = { belts: [] }; sb.ghost = { nextChange: n => n }; }, () => { sb.ghost = null; sb.geo = null; });
  flip('crate', 'a hand-off box in flight', () => { sb.handoffBoxes.push({}); }, () => { sb.handoffBoxes.length = 0; });
  flip('crate', 'a SEND TO crate in flight', () => { sb.sendCrates.push({ t0: now, born: now - 100 }); }, () => { sb.sendCrates.length = 0; });
  flip('crate', 'a queue jam bobbing (drawQueueJam)', () => {}, null, () => W.stillMove('crate'));
  flip('prop', 'a prop with live content (the prop pass)', () => {}, null, () => W.stillMove('prop'));
  flip('belt', 'an energized belt in frame (no plan: every tile live)', () => { sb.geo = { belts: [{ x: 4, y: 4 }] }; sb.beltLiveSet = null; }, () => { sb.geo = null; });
  flip('belt', 'an energized belt in frame (on the compiled live route)', () => { sb.geo = { belts: [{ x: 4, y: 4 }, { x: 5, y: 4 }] }; sb.beltLiveSet = { '5,4': true }; }, () => { sb.geo = null; sb.beltLiveSet = null; });
  // canvas overlays and ceremonies
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

  // ---- the changes the frame can see coming: stillDue -------------------------------------------------------------
  const due = (label, mutate, at, revert) => {
    mutate();
    const s = settle();
    A.ok(s.stillNow && Math.abs(s.stillDue - at) < 1e-6, label + ' sets stillDue (+' + (s.stillDue - now).toFixed(0) + ' ms)');
    if (revert) revert();
    settle();
  };
  due("an idle body's next decision (idleUntil)", () => { mate.idleUntil = now + 700; }, now + 700, () => { mate.idleUntil = Infinity; });
  due('a glance cooldown ending (glanceCd)', () => { hero.glanceCd = now + 450; }, now + 450, () => { hero.glanceCd = 0; });
  due("a glance turning back", () => { hero.glance = { until: now + 380, dir: 'west' }; }, now + 380, () => { hero.glance = null; });
  due("the next blink / clock-driven pose frame (drawBody's _renderNextAt)", () => { mate._renderNextAt = now + 120; }, now + 120, () => { mate._renderNextAt = 0; });
  due('a speech bubble vanishing', () => { mate.say = { text: 'ok', until: now + 2600 }; }, now + 2600, () => { mate.say = null; });
  due('a held SEND TO crate releasing at its grace', () => { sb.sendCrates.push({ t0: 0, born: now - 1000 }); }, now + 7000, () => { sb.sendCrates.length = 0; });
  due('a ghost spawn', () => { sb.geo = { belts: [] }; sb.ghost = { nextChange: () => now + 2500 }; }, now + 2500, () => { sb.ghost = null; sb.geo = null; });
  due('the cinecam re-cast', () => { sb.camLock = { id: 'a', source: 'cine' }; sb.cineHoldUntil = now + 900; }, now + 900, () => { sb.camLock = null; });
  due("the cinecam's 3 s still-subject grace", () => { sb.cineWalkAt = now - 1000; }, now + 2000, () => { sb.cineWalkAt = -1e9; });
  due('an encounter ending', () => { sb.socialBeat = { until: now + 1500 }; }, now + 1500, () => { sb.socialBeat = null; });
  calm('an off-screen body\'s clock (invisible: it re-enters through the pad)', () => { mate.px = -5000; mate.idleUntil = now + 300; }, () => { mate.px = 300; mate.idleUntil = Infinity; });
  A.ok(settle().stillDue === Infinity || settle().stillDue > now, 'past clocks are never due');
}

// ---- 8. the wiring in the real world.js ---------------------------------------------------------------------------
const bodySrc = A.fnBody(code, 'function frameBody(now)');
A.ok(/^\s*function frameBody\(now\) \{\s*stillBegin\(\);/.test(bodySrc), 'frameBody judges itself: stillBegin() is its first act');
A.ok(/drawScene\(now, dt, slices\);\s*stillVerdict\(now\);\s*\}$/.test(bodySrc.trim()), '...and stillVerdict(now) its last, after the scene drew');
A.ok(/if \(!cache\) \{[\s\S]{0,400}return;/.test(bodySrc) && bodySrc.indexOf('stillBegin()') < bodySrc.indexOf('if (!cache)'),
  'a frame with no bake (the early return) is never judged still');
const sceneSrc = A.fnBody(code, 'function drawScene(now, dt, slices)');
A.ok(/if \(!stillMark && \(\(work && !\(leisureProps\.has\(p\.id\) && restingOn\(p\)\)\) \|\| \(live && \(live\.heat > 0 \|\| live\.prog != null \|\| live\.scanning\)\)\)\s*&& propOnScreen\(p\)\) stillMove\('prop'\);/.test(sceneSrc),
  'the prop pass marks an on-screen prop with live content (work, heat, a progress strip, a scan) as motion');
A.ok(/stillMove\('crate'\);[^\n]*\n\s*for \(let i = 0; i < shown; i\+\+\) drawWaitCrate/.test(A.fnBody(code, 'function drawQueueJam(now)')), 'a standing queue jam (its crates bob) marks the frame moving');
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
// a clock the inner life waits on that the verdict does not know is ≤33 ms of latency on every decision it gates: ratchet
{
  const props = new Set((code.match(/\.[a-z][A-Za-z]*(?:Until|Cd)\b/g) || []).map(s => s.slice(1)));
  const clocks = new Set(makeWorld(60).W.consts.BODY_CLOCKS);
  const unknown = [...props].filter(p => !clocks.has(p));
  A.ok(props.size > 20 && !unknown.length, 'every *Until / *Cd clock world.js sets is in BODY_CLOCKS (' + props.size + (unknown.length ? '; unknown: ' + unknown.join(', ') : '') + ')');
}
// ambient stays ambient: the verdict never reads the backdrop, the light map or the decor clocks
{
  const vsrc = strip(world.slice(vFrom, vTo));
  A.ok(!/SpaceBG|drawDust|drawGlows|drawNavLights|cache\.flickers|sceneRenderer/.test(vsrc), 'the verdict never treats the starfield, glows, dust or nav lights as motion');
  A.ok(!/getImageData|\.slice\(|\.map\(|\.filter\(|\[agent, \.\.\.crew\]|new (?:Map|Set|Array)\(/.test(vsrc.replace(/const BODY_CLOCKS[\s\S]*?\]\);/, '').replace(/const REST_USE[^\n]*/, '')),
    'the verdict reads state, never pixels, and allocates nothing per frame');
}

// ---- 9. the readouts it reads ---------------------------------------------------------------------------------------
A.ok(/b\._renderNextAt = clockNext;/.test(assets), "SPRITES.drawBody publishes when a body's drawn frame next changes on the clock (_renderNextAt)");
A.ok(/clockNext = Math\.min\(clockNext, nowMs \+ \(bt < 130 \? 130 - bt : 3300 - bt\)\)/.test(assets), '...the blink edge (eyes open / next shut)');
A.ok(/const q = nowMs \/ \(1000 \/ fps\) \+ aph;\s*clockNext = Math\.min\(clockNext, nowMs \+ \(Math\.floor\(q\) \+ 1 - q\) \* \(1000 \/ fps\)\);/.test(assets),
  '...and the next frame of a clock-driven track, from the same phase the frame index uses');
A.ok(/idx = fixedIdx != null[\s\S]{0,500}: Math\.floor\(nowMs \/ \(1000 \/ fps\) \+ aph\);/.test(assets), '(the frame index really is floor(now / (1000 / fps) + aph))');
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
