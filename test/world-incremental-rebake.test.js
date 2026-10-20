/* node test/world-incremental-rebake.test.js — INCREMENTAL STATIC BAKE (perf, 2026-10-20).

   A room edit outside BUILD MODE (a lead-builder station tool, an airlock seal) re-baked the whole station: ~2.5 s of
   frozen main thread on a large floor, though WorldModel names the tiles every edit reaches and BUILD MODE already
   re-bakes only those chunks. world.js now collects the edits' dirty rects and re-bakes just those chunks against its
   whole-station bake (StationBake.bakeIncremental + stitchWhole, BUILD MODE's own path). Every global or unknown case
   still bakes whole. This runs the real world.js decision — the floor subscription, rederive's bake verdict, rebake —
   against a counting StationBake. (Pixel parity of the result: world-incremental-rebake.parity.test.mjs.) */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const world = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
const fn = h => { const b = A.fnBody(world, h); A.ok(b && b.length < 6000, 'world.js carries ' + h.trim()); return b; };
const sub = /station\.onChange\((p => \{ geoDirty = true; if \(!p \|\| !p\.staticBakeUnchanged \|\| p\.global\) \{ bakeEditPending = true; noteBakeEdit\(p\); \} \})\)/.exec(world);
A.ok(sub, 'the floor subscription notes every bake edit it marks');
const red = fn('  function rederive() {');
const verdict = red.slice(red.indexOf('    const frameMoved = '), red.indexOf('geoDirty = false; bakeEditPending = false;'));
A.ok(verdict.length > 0 && verdict.length < 900 && /bakeEdits = null/.test(verdict), "rederive's bake verdict drops the rects for a moved frame or lamp anchor");
const decl = /\n  let bakeEdits = null;\n/.exec(world);
A.ok(decl, 'bakeEdits is module state');
A.ok(/return \{ init, rebake: rebakeWhole,/.test(world), 'the PUBLIC World.rebake is the whole bake');

// every OTHER site that dirties the bake (recovery, context loss, fonts, textures) drops the rects too: only an edit the
// floor subscription noted, with the verdict above, may re-bake by chunks
const allowed = [
  /^  let station = null, geo = null, cache = null, geoDirty = true, bakeDirty = true, unsub = null;$/,   // declaration
  /^    station = st; geo = null; cache = null; geoDirty = true; bakeDirty = true; fitNeeded = true;$/,     // loadStation (+ bakeEdits = null below)
  /^    if \(bakeEditPending \|\| frameMoved \|\| anchorMoved\) bakeDirty = true;/,                            // rederive's verdict
  /^    if \(buildHoldsFloor\(\)\) \{ bakeDirty = true; return; \}$/                                           // a deferral keeps what is pending
];
const sites = world.split('\n').filter(l => /bakeDirty = true/.test(l));
const bare = sites.filter(l => !/bakeEdits = null/.test(l) && !allowed.some(r => r.test(l)));
A.ok(sites.length >= 8, 'found the bake-dirtying sites (' + sites.length + ')');
A.eq(bare, [], 'every other bakeDirty = true site also drops the pending rects (bakes whole)');
A.ok(/station = st; geo = null; cache = null;[^\n]*\n(?:[^\n]*\n){0,24}\s*bakeEdits = null;/.test(world), 'loadStation starts every floor whole');

/* ---- the sandbox: a station whose geometry the test steers, and a StationBake that records every call ---- */
const calls = [];
let stitchRefuses = false, incThrows = false;
const SB = {
  LIGHT: { ambient: 0.82 }, WALL: { up: 30 }, DEPTH: { dither: 0.12 }, SHAPE: { cornerN: 1 }, HULL_EXPOSURE: 0.7,
  bake(g) { calls.push('bake'); return { tag: 'whole', stitched: sb.stitchedFloors, W: g.W, H: g.H, origin: g.origin, doorOccluders: [] }; },
  bakeIncremental(g, prev, rects) { calls.push('inc'); if (incThrows) throw new Error('boom'); return { chunked: true, prev, rects: rects.slice(), W: g.W, H: g.H, origin: g.origin }; },
  stitchWhole(g, baked) { calls.push('stitch'); return stitchRefuses ? null : { tag: 'stitched', stitched: true, from: baked, W: g.W, H: g.H, origin: g.origin, doorOccluders: [] }; }
};
const warns = [];
const sb = vm.createContext({ StationBake: SB, console: { warn: (...a) => warns.push(a.join(' ')) }, stitchedFloors: true,
  IndustrialTextures: { lighting: { cut: 1 }, enabled: () => true }, document: { documentElement: { dataset: { textureRevision: 'bridge-remaster' } } } });
vm.runInContext([
  'let station = null, geo = null, cache = null, geoDirty = true, bakeDirty = true, bakeEditPending = true, handedBake = null, bakedAnchorKey = null;',
  'let frame = { W: 2000, H: 1200, origin: { tx: -4, ty: -4 }, anchor: "a" };',
  decl[0],
  'function fixtureAnchorKey(g) { return g.anchor; }',
  'function recordBakeProbe() {}',
  'function rederive() { geo = { W: frame.W, H: frame.H, origin: { tx: frame.origin.tx, ty: frame.origin.ty }, anchor: frame.anchor };\n' + verdict + 'geoDirty = false; bakeEditPending = false; }',
  ['buildHoldsFloor', 'noteBakeEdit', 'bakeKnobs', 'bakeEditedChunks', 'rebakeWhole', 'rebake'].map(n => fn('  function ' + n + '(')).join('\n'),
  'const onEdit = ' + sub[1] + ';',
  // one frame of frameBody's head: derive, then bake if dirty
  'function frameHead() { if (geoDirty) rederive(); if (bakeDirty || !cache) rebake(); }',
  'this.W = { onEdit, frameHead, rebakeWhole, get cache() { return cache; }, frame: () => frame, station: () => station,',
  '  setStation(s) { station = s; }, offerHanded(b) { handedBake = { station, seq: station.getSeq(), bake: b }; } };'
].join('\n'), sb);
const W = sb.W;
let seq = 1;
W.setStation({ getSeq: () => seq });
const R = (x1, y1, x2, y2) => ({ x1, y1, x2, y2 });
const step = (label, fn) => { calls.length = 0; fn(); W.frameHead(); return calls.join(','); };

let got = step('boot', () => {});
A.eq(got, 'bake', 'boot bakes whole');
let before = W.cache;
got = step('a room edit', () => W.onEdit({ seq: ++seq, dirtyRects: [R(1, 1, 4, 4)] }));
A.eq(got, 'inc,stitch', 'a room edit with rects re-bakes only its chunks, stitched into one floor');
A.ok(W.cache.tag === 'stitched' && W.cache.from.prev === before && JSON.stringify(W.cache.from.rects) === JSON.stringify([R(1, 1, 4, 4)]),
  '…against the bake it had, with exactly the edit\'s rects');
before = W.cache;
got = step('two edits in one frame', () => { W.onEdit({ dirtyRects: [R(2, 2, 3, 3)] }); W.onEdit({ dirtyRects: [R(9, 9, 9, 9), R(10, 1, 12, 2)] }); });
A.ok(got === 'inc,stitch' && W.cache.from.prev === before && W.cache.from.rects.length === 3, 'two edits before a frame bake their rects together, once');
got = step('a props-only edit', () => W.onEdit({ dirtyRects: [R(5, 5, 5, 5)], staticBakeUnchanged: true }));
A.eq(got, '', 'a props-only edit keeps the deck (no bake at all)');
before = W.cache;
got = step('…then a room edit', () => W.onEdit({ dirtyRects: [R(6, 6, 7, 7)] }));
A.ok(got === 'inc,stitch' && W.cache.from.prev === before && W.cache.from.rects.length === 1, '…and the next room edit still re-bakes only its own chunks');

// every global or unknown case bakes whole
const whole = [
  ['a global edit (the hull)', () => W.onEdit({ dirtyRects: [R(1, 1, 2, 2)], global: true })],
  ['an edit with no rects', () => W.onEdit({ dirtyRects: [] })],
  ['an edit with no patch', () => W.onEdit(null)],
  ['a global edit after a rect edit in the same frame', () => { W.onEdit({ dirtyRects: [R(1, 1, 2, 2)] }); W.onEdit({ dirtyRects: [], global: true }); }],
  ['a rect edit that moved the origin', () => { W.frame().origin.tx--; W.onEdit({ dirtyRects: [R(-6, 0, -5, 3)] }); }],
  ['a rect edit that grew the floor', () => { W.frame().W += 64; W.onEdit({ dirtyRects: [R(40, 0, 44, 3)] }); }],
  ['a props-only edit that moved a lamp anchor', () => { W.frame().anchor = 'b'; W.onEdit({ dirtyRects: [R(5, 5, 5, 5)], staticBakeUnchanged: true }); }],
  ['a rect edit after a bake knob moved (ROOM LIGHT mid-drag)', () => { SB.LIGHT.ambient = 0.6; W.onEdit({ dirtyRects: [R(1, 1, 2, 2)] }); }],
  ['a rect edit after the texture pack changed', () => { sb.document.documentElement.dataset.textureRevision = 'native'; W.onEdit({ dirtyRects: [R(1, 1, 2, 2)] }); }],
  ['an outside World.rebake() with rects pending', () => { W.onEdit({ dirtyRects: [R(1, 1, 2, 2)] }); W.rebakeWhole(); }],
];
for (const [label, fn] of whole) {
  got = step(label, fn);
  A.eq(got, 'bake', label + ' → bakes whole');
}
got = step('a refused stitch', () => { stitchRefuses = true; W.onEdit({ dirtyRects: [R(1, 1, 2, 2)] }); });
A.eq(got, 'inc,stitch,bake', 'a stitch StationBake refuses falls back to the whole bake');
stitchRefuses = false;
got = step('a throwing chunk bake', () => { incThrows = true; W.onEdit({ dirtyRects: [R(1, 1, 2, 2)] }); });
A.ok(got === 'inc,bake' && warns.length === 1, 'a chunk bake that throws falls back to the whole bake, and says so');
incThrows = false;
sb.stitchedFloors = false; step('a one-chunk floor', () => W.rebakeWhole());
got = step('…and an edit on it', () => W.onEdit({ dirtyRects: [R(1, 1, 2, 2)] }));
A.eq(got, 'bake', 'a floor whose bake is not stitched (one chunk) bakes whole, as before');
sb.stitchedFloors = true; step('back to a stitched floor', () => W.rebakeWhole());
// BUILD MODE's handed floor becomes the base the next edit's chunks are cut from
const handed = { tag: 'handed', stitched: true, W: W.frame().W, H: W.frame().H, origin: Object.assign({}, W.frame().origin), doorOccluders: [] };
got = step('BUILD MODE hands its floor back', () => { W.onEdit({ seq: ++seq, dirtyRects: [R(3, 3, 4, 4)] }); W.offerHanded(handed); });
A.ok(got === '' && W.cache === handed, 'the handed floor is taken without baking');
got = step('…then a room edit', () => W.onEdit({ dirtyRects: [R(8, 8, 8, 8)] }));
A.ok(got === 'inc,stitch' && W.cache.from.prev === handed && W.cache.from.rects.length === 1, '…and the next edit re-bakes its chunks against the handed floor, with only its own rects');
// a StationBake without the chunk API (an old build) bakes whole
delete SB.bakeIncremental;
got = step('no chunk API', () => W.onEdit({ dirtyRects: [R(1, 1, 2, 2)] }));
A.eq(got, 'bake', 'a StationBake without bakeIncremental bakes whole');

A.report('world-incremental-rebake');
