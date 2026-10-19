'use strict';
const assert = require('node:assert/strict');
const R = require('../frontend/app/worldrenderer.js');
const queue = [
  { id: 'quilt', y: 24.75 }, { id: 'bed', y: 24 }, { id: 'body', y: 24.5 },
  { id: 'desk', y: 36 }, { id: 'mounted', y: 36.5 }, { id: 'same-row', y: 36 }
];
assert.deepEqual(R.sortedItems(queue).map(x => x.id), ['bed', 'body', 'quilt', 'desk', 'same-row', 'mounted']);
assert.equal(queue[0].id, 'quilt', 'sorting never mutates a caller-owned display list');
assert.deepEqual(R.visibleRect({ scale: 2, panX: -20, panY: 14, width: 800, height: 400 }), { x: 10, y: -7, w: 400, h: 200 });
assert.ok(R.intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 12, y: 0, w: 1, h: 1 }, 3), 'raised art margins remain visible');
assert.ok(!R.intersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 12, y: 0, w: 1, h: 1 }, 0));
assert.equal(R.percentile([], .95), null, 'no fabricated performance before sampling');
const packed = (r,g=r,b=r,a=255) => ((a<<24)|(b<<16)|(g<<8)|r)>>>0;
const flat = new Uint32Array(9).fill(packed(67,91,113));
assert.equal(R.sharpenSample(flat,4,3,3,.6),flat[4],'sharpening adds no brightness or tint to a flat surface');
const edge = new Uint32Array([packed(0),packed(40),packed(160),packed(0),packed(130),packed(160),packed(0),packed(40),packed(160)]);
assert.ok((R.sharpenSample(edge,4,3,3,.28)&255)>130,'a soft edge gains local definition');
assert.equal(R.sharpenSample(edge,4,3,3,0),edge[4],'zero strength is pixel-identical');
for(let i=0;i<edge.length;i++) {
  const result=R.sharpenSample(edge,i,3,3,.6);
  assert.ok((result&255)<=160,'clipping prevents overshoot beyond the existing bright edge');
  assert.equal(result>>>24,255,'opaque coverage survives sharpening');
}
const quiet = new Uint32Array(9).fill(packed(40)); quiet[4]=packed(43);
assert.equal(R.sharpenSample(quiet,4,3,3,.6),quiet[4],'faint gradients and noise are below the detail threshold');
const border = new Uint32Array([packed(40),packed(200),packed(40),packed(40)]);
assert.equal(R.sharpenSample(border,2,2,2,.6),border[2],'neighbour taps never wrap across image rows');
const renderer = R.create();
assert.equal(renderer.stats().renderMedianMs, null);
const calls = [];
renderer.begin({ now: 1, geo: { TILE: 12 }, cache: {} });
renderer.drawEntities({}, [{ y: 2, draw: () => calls.push('front') }, { y: 1, draw: () => calls.push('back') }]);
renderer.finish();
assert.deepEqual(calls, ['back', 'front']);
assert.equal(renderer.stats().frames, 1);
assert.equal(renderer.stats().entities, 2);
assert.equal(renderer.drawLight({}, [], {}), false, 'legacy fallback is explicit when lighting engine is absent');
assert.equal(renderer.prepareLight([], {}), false);
assert.equal(renderer.sampleLight(12, 12), null, 'missing light engine retains the native sprite/shadow path');
renderer.dispose();
assert.equal(renderer.stats().samples, 0);

// A physical source disappearing must affect the body in that very depth pass.
// Preparing light after drawing the body leaves a one-frame false work glow.
const vm = require('node:vm');
const fs = require('node:fs');
let prepared = null;
const sequence = [];
const fakeLight = {
  setGeometry() { prepared = null; },
  prepare(frame) { prepared = frame; sequence.push('prepare'); },
  sample(x, y) { return { x, y, sources: prepared.lights.length }; },
  drawGrounding() { sequence.push('ground:' + prepared.lights.length); },
  render() { sequence.push('composite:' + prepared.lights.length); return true; },
  dispose() { prepared = null; }
};
const scope = { module: { exports: {} }, WorldLight: { create: () => fakeLight } };
vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/app/worldrenderer.js'), 'utf8'), scope);
const live = scope.module.exports.create();
const geo = { TILE: 12 }, cache = { W: 48, H: 48, lamps: [{ x: 12 }], wallFixtures: [{ x: 24 }] };
live.begin({ now: 10, geo, cache });
assert.equal(live.sampleLight(10, 10), null, 'never samples stale sources before preparation');
live.prepareLight([{ x: 12, y: 12 }], { emission: .9 });
assert.equal(prepared.fixtures.length, 2, 'both physical fixture collections reach the same sample');
live.drawGrounding({}, [{}]);
live.drawEntities({}, [{ y: 1, draw: () => sequence.push('body:' + live.sampleLight(12, 12).sources) }]);
live.drawLight({}, []);
assert.deepEqual(sequence, ['prepare', 'ground:1', 'body:1', 'composite:1']);
live.begin({ now: 20, geo, cache });
assert.equal(live.sampleLight(12, 12), null);
live.prepareLight([], {});
assert.equal(live.sampleLight(12, 12).sources, 0, 'stopped work removes illumination before the next sprite');
live.dispose();
assert.equal(live.sampleLight(12, 12), null);
// A projection lighting profile may rebalance existing sources, never add or
// relocate fixtures or mutate the authoritative bake shared by other consumers.
scope.PropRemaster = { isProjection: () => true };
const shaped = scope.module.exports.create();
const roomGeo = { TILE: 12, kindOf: id => id === 'bridge' ? 'bridge' : 'quarters' };
const roomBake = { W: 120, H: 120, lamps: [{ x: 20, y: 30, r: 50, gain: .22 }],
  wallFixtures: [{ x: 40, y: 12, r: 60, gain: .82, zone: 'bridge' }, { x: 80, y: 12, r: 60, zone: 'quarters' }] };
const savedBake = JSON.stringify(roomBake);
shaped.begin({ now: 30, geo: roomGeo, cache: roomBake });shaped.prepareLight([], {});
assert.equal(prepared.fixtures.length, 3);
assert.deepEqual(Array.from(prepared.fixtures, l => [l.x, l.y]), [[20,30],[40,12],[80,12]]);
assert.ok(prepared.fixtures[0].gain < prepared.fixtures[1].gain, 'physical housing is the key, room samples the fill');
assert.notEqual(prepared.fixtures[1].rgb, prepared.fixtures[2].rgb, 'command and lounge keep different light temperatures');
assert.equal(JSON.stringify(roomBake), savedBake, 'bake source geometry is unchanged');
assert.equal(prepared.lights.length, 0, 'room lighting does not invent active prop lights');
shaped.dispose();
const classicScope = { module: { exports: {} }, URLSearchParams, location: { search: '?world=classic' },
  WorldLight: { create() { throw new Error('classic must not initialize replacement light'); } } };
vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/app/worldrenderer.js'), 'utf8'), classicScope);
const classic = classicScope.module.exports.create();
classic.begin({ now: 10, geo, cache });
assert.equal(classic.prepareLight([{ x: 12 }]), false);
assert.equal(classic.sampleLight(12, 12), null, 'classic has no replacement shadow and must use the legacy body appearance');
classic.drawGrounding({}, [{}]);
assert.equal(classic.drawLight({}, [], {}), false);
console.log('worldrenderer: depth order, camera geometry, lifecycle and measured-only statistics passed');

// A PROPS-ONLY EDIT KEEPS THE LIGHT MODEL (review world-render-05). The floor re-bakes only when rooms, walls or doors change
// (a new cache object); turning a stool hands begin() a fresh geo with the SAME cache. Resetting the WorldLight there threw away
// its wall segments, visibility/kernel caches and light canvases for nothing — a visible hitch per edit on weak machines.
{
  const counts = { create: 0, setGeometry: 0, configure: 0 };
  const countingLight = { setGeometry() { counts.setGeometry++; }, configure() { counts.configure++; }, prepare() {}, sample: () => null, dispose() {} };
  const s = { module: { exports: {} }, WorldLight: { create: () => { counts.create++; return countingLight; } },
    IndustrialTextures: { enabled: () => true, lighting: { key: 1 } } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/app/worldrenderer.js'), 'utf8'), s);
  const r = s.module.exports.create();
  const bake1 = { W: 48, H: 48, lamps: [{ x: 12 }] }, bake2 = { W: 48, H: 48, lamps: [{ x: 24 }] };
  r.begin({ now: 1, geo: { TILE: 12 }, cache: bake1 });
  assert.deepEqual(counts, { create: 1, setGeometry: 1, configure: 1 }, 'the first frame builds the light model');
  r.begin({ now: 2, geo: { TILE: 12, props: ['a turned stool'] }, cache: bake1 });
  assert.deepEqual(counts, { create: 1, setGeometry: 1, configure: 1 }, 'a props-only edit (new geo, same bake) keeps the light model and its caches');
  r.begin({ now: 3, geo: { TILE: 12 }, cache: bake2 });
  assert.deepEqual(counts, { create: 1, setGeometry: 2, configure: 2 }, 'a re-bake (rooms, walls or doors changed) resets the light model');
  r.dispose();
}
console.log('worldrenderer: a props-only edit keeps the light model passed');

// A ROOM LIGHT DRAG PREVIEWS THE POOLS WITHOUT A BAKE (review world-render-07). stationui.js rebakes the station only on
// release; the pool cut and key are WorldLight's own knobs (StationBake never reads them), so begin() hands a changed cut
// or key to lighting.configure on the next frame, over the SAME bake, and never rebuilds the light model's geometry.
{
  const counts = { setGeometry: 0, configure: 0 }, seen = [];
  const light = { setGeometry() { counts.setGeometry++; }, configure(t) { counts.configure++; seen.push(t.cut + ',' + t.key); }, prepare() {}, sample: () => null, dispose() {} };
  let enabled = true;
  const tex = { cut: 1, key: 0, keyReach: .5 };
  const s = { module: { exports: {} }, WorldLight: { create: () => light },
    IndustrialTextures: { enabled: () => enabled, lighting: tex } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../frontend/app/worldrenderer.js'), 'utf8'), s);
  const r = s.module.exports.create();
  const geo = { TILE: 12 }, bake1 = { W: 48, H: 48, lamps: [] }, bake2 = { W: 48, H: 48, lamps: [] };
  r.begin({ now: 1, geo, cache: bake1 });
  r.begin({ now: 2, geo, cache: bake1 });
  assert.deepEqual(counts, { setGeometry: 1, configure: 1 }, 'an unchanged frame never reconfigures the light model');
  tex.cut = 2.1; tex.key = 1.4;
  r.begin({ now: 3, geo, cache: bake1 });
  assert.deepEqual(counts, { setGeometry: 1, configure: 2 }, 'a dragged cut/key reaches WorldLight on the next frame, with no rebuild of its geometry');
  assert.equal(seen[seen.length - 1], '2.1,1.4', 'with the dragged values');
  r.begin({ now: 4, geo, cache: bake1 });
  assert.equal(counts.configure, 2, 'once per change, not once per frame');
  tex.cut = 2.4; tex.key = 2;
  r.begin({ now: 5, geo, cache: bake2 });
  assert.deepEqual(counts, { setGeometry: 2, configure: 3 }, 'the release re-bake configures once');
  r.begin({ now: 6, geo, cache: bake2 });
  assert.equal(counts.configure, 3, 'and the frame after it owes nothing more');
  enabled = false; tex.cut = 1;
  r.begin({ now: 7, geo, cache: bake2 });
  assert.equal(counts.configure, 3, 'the classic textures never take the industrial pool knobs');
  r.dispose();
}
console.log('worldrenderer: a ROOM LIGHT drag previews the pool cut and key without a bake passed');

const hudGeo = { TILE: 12, COLS: 4, ROWS: 2, W: 48, zoneGrid: ['a','a','b','b','a','a','b','b'], nameOf: id => ({a:'COMMAND',b:'FABRICATION'})[id] };
const hudView = {x:0,y:0,w:20,h:20};
assert.equal(R.cameraReadout({geo:hudGeo,viewport:hudView,linked:true}).label,'CAM · COMMAND');
assert.equal(R.cameraReadout({geo:hudGeo,viewport:{...hudView,w:48},linked:true}).label,'CAM · STATION OVERVIEW');
assert.equal(R.cameraReadout({geo:hudGeo,viewport:hudView,subject:{px:30,py:12,name:'EMBER'},linked:true}).label,'CAM · FABRICATION · EMBER');
assert.equal(R.cameraReadout({geo:hudGeo,viewport:{...hudView,x:-100},linked:true}).label,'CAM · STATION VIEW');
assert.equal(R.cameraReadout({linked:false}).feed,'FEED: RECONNECTING');
assert.equal(R.cameraReadout({linked:true,paused:true}).state,'paused');
assert.equal(R.cameraReadout({linked:true}).indicator,'● LIVE');
console.log('worldrenderer: camera room, subject and connection readouts passed');
