/* test/build-move-settle.test.js — the move / reshape ghost judges the ROUTE once the pointer rests (final floor lane M13).

   A conveyor piece's full move verdict (canMoveProp / canMoveProps / canReshapeLink) copies the floor and compiles its route —
   60-170 ms a tile on a big station, and a drag asked it on every tile it crossed. Driven for real: build.js's own settle helper,
   moveVerdict / groupMoveVerdict and handPlan run in a VM against a live WorldModel, with a clock the test moves. Locked:
     - a conveyor piece crossing a tile gets the footprint verdict only: red where the footprint is refused (already the truth),
       else ok + checking (drawn amber CHECKING THE ROUTE — never green for what was not judged) — and NO route compile;
     - resting SETTLE_MS on the tile asks the full verdict (the same one the release commits by);
     - furniture is judged at once (its verdict compiles nothing);
     - a reshape drag shows CHECKING THE ROUTE until it rests, and the release (force) always judges for real. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const vm = require('vm');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');

const src = fs.readFileSync(require.resolve('../frontend/app/build.js'), 'utf8');
const between = (start, end) => {
  const i = src.indexOf(start), j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error('build.js seam moved: ' + start + ' … ' + end);
  return src.slice(i, j);
};
const line1 = re => { const m = src.match(re); if (!m) throw new Error('build.js line moved: ' + re); return m[0] + '\n'; };
const CODE = line1(/const CONNECT_TYPES = [^\n]+/) + line1(/const JUNCTION_TAG_TYPES = [^\n]+/)
  + between('const HAND_PLAN_MODES', '// R mid-drag: the corner turns')       // isConveyorPiece · settled · handPlan · planHandGesture
  + between('function moveVerdict(', 'function ghostInfo()');                  // moveVerdict · groupMoveVerdict

const s = WM.create(); s.projectGeometry();
s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 90, y2: 40 } });
const add = (t, x, y) => { const big = t === 'bay' || t === 'intake' || t === 'outbox'; return s.addProp({ t, x, y, w: big ? 2 : 1, h: big ? 2 : 1, block: big }).id; };
const I = add('intake', 32, 4), B1 = add('bay', 42, 4), O = add('outbox', 58, 4), PL = add('plant', 40, 20), PL2 = add('plant', 41, 20);
for (const [a, b] of [[I, B1], [B1, O]]) A.ok(s.connectBelt(a, b).ok, 'rig: belt ' + a + '→' + b);
let clock = 1000;
const ctx = { station: s, geoVer: 1, flipPref: false, performance: { now: () => clock }, NO_ROUTE: {}, machineName: id => id, propLabel: t => String(t).toUpperCase(),
  lineOfProp: () => null, linkedFloor: () => !!s.isLinked(), groupFit: () => ({ ok: true }) };
vm.createContext(ctx); vm.runInContext(CODE, ctx);
const SETTLE_MS = Number((src.match(/const SETTLE_MS = (\d+);/) || [])[1]);
A.ok(typeof ctx.settled === 'function' && SETTLE_MS > 0 && SETTLE_MS <= 200, 'the settle wait is short (' + SETTLE_MS + ' ms)');

const real = P.compileRoutingPlan; let n = 0;
P.compileRoutingPlan = function () { n++; return real.apply(this, arguments); };
try {
  const bay = s.propById(B1);
  // crossing tiles: footprint only, never a compile, never green-unproven
  s.links(); n = 0;
  const v1 = ctx.moveVerdict(bay, 42, 9, 0, 5);
  A.ok(v1.ok === true && v1.checking === true, 'a BAY crossing a clear tile: ok + checking (amber), not a judged green — ' + JSON.stringify(v1));
  clock += 30; const v2 = ctx.moveVerdict(bay, 42, 10, 0, 6);
  A.ok(v2.checking === true, '…the next tile it crosses too');
  A.eq(n, 0, '…and crossing compiled nothing');
  const blocked = ctx.moveVerdict(bay, 40, 20, -2, 16);
  A.ok(blocked.ok === false && !blocked.checking, 'a footprint the floor refuses is red at once (the cheap verdict is already the truth)');
  // resting: the full verdict
  clock += 10; ctx.moveVerdict(bay, 42, 10, 0, 6); clock += SETTLE_MS + 1;
  const rest = ctx.moveVerdict(bay, 42, 10, 0, 6);
  A.ok(rest.ok === true && !rest.checking, 'resting on the tile asks the full route verdict — ' + JSON.stringify(rest));
  A.ok(n > 0, '…which is the one that compiles');
  A.eq(rest, s.canMoveProp(B1, 42, 10), '…the same verdict the model gives');
  // furniture: judged at once, no compile
  n = 0; const pv = ctx.moveVerdict(s.propById(PL), 40, 22, 0, 2);
  A.ok(pv.ok === true && !pv.checking && n === 0, 'a plant is judged at once and compiles nothing');
  const gv = ctx.groupMoveVerdict([s.propById(PL), s.propById(PL2)], 0, 3);
  A.ok(gv.ok === true && !gv.checking && n === 0, 'a group of plants too');
  const gb = ctx.groupMoveVerdict([s.propById(PL), s.propById(B1)], 0, 3);
  A.ok(gb.ok === true && gb.checking === true, 'a group holding a BAY waits to judge the route');
  // reshape: CHECKING THE ROUTE until it rests; the release judges for real
  const l = s.links().find(q => q.from.prop === B1);
  const d = { mode: 'beltreshape', linkId: l.id, moved: true, cur: { tx: 50, ty: 10 } };
  n = 0; const r1 = ctx.handPlan(d);
  A.ok(r1 && r1.checking === true && r1.why === 'CHECKING THE ROUTE' && n === 0, 'a reshape crossing a tile says CHECKING THE ROUTE and compiles nothing — ' + JSON.stringify(r1));
  const forced = ctx.handPlan(d, true);
  A.ok(forced && !forced.checking && forced.kind === 'reshape' && forced.ok === s.canReshapeLink(l.id, 50, 10).ok, 'the release (force) judges for real');
  ctx.geoVer++; const d2 = { mode: 'beltreshape', linkId: l.id, moved: true, cur: { tx: 50, ty: 11 } };
  ctx.handPlan(d2); clock += SETTLE_MS + 1;
  const r2 = ctx.handPlan(d2);
  A.ok(r2 && !r2.checking && r2.kind === 'reshape', 'resting on a reshape tile judges it — ' + JSON.stringify(r2 && { ok: r2.ok, why: r2.why }));
} finally { P.compileRoutingPlan = real; }

// the ghost draws the unjudged fit amber with the words, never green
A.ok(/const warn = !!\(ok && \(links \|\| g\.leftBehind \|\| \(g\.v && g\.v\.checking\)\)\);/.test(src), 'drawGhost: a checking verdict is amber');
A.ok(/if \(ok && g\.v && g\.v\.checking\) lines\.push\(CHECKING_ROUTE\);/.test(src), '…and says CHECKING THE ROUTE');
A.ok(/plan\.checking \? '#ffd24a'/.test(src), 'the hand ghost of a reshape still checking is amber');
A.ok(/function commitHandGesture\(d, ev\) \{\s*const plan = handPlan\(d, true\);/.test(src), 'the release always judges for real');
A.report('build-move-settle.test');
