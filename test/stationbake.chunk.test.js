'use strict';

const A = require('./_assert.js');

global.U = {
  hash(s) {
    let h = 2166136261;
    s = String(s);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
    return h >>> 0;
  },
  shade(c) { return c; }
};

const canvases = [];
function styleHash(style) {
  if (style && typeof style === 'object' && style.__styleId) return style.__styleId;
  const s = String(style == null ? '' : style);
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function fakeGradient(...args) {
  const stops = [];
  return {
    get __styleId() { return styleHash('gradient:' + args.join(',') + ':' + stops.join('|')); },
    addColorStop(off, color) { stops.push(off + '=' + color); }
  };
}
function makeCanvas() {
  const c = { _width: 0, _height: 0, _pixels: new Uint32Array(0), getContext() { return fakeCtx(c); } };
  Object.defineProperty(c, 'width', {
    get() { return c._width; },
    set(v) {
      c._width = Math.max(0, Math.floor(v || 0));
      c._pixels = new Uint32Array(c._width * c._height);
    }
  });
  Object.defineProperty(c, 'height', {
    get() { return c._height; },
    set(v) {
      c._height = Math.max(0, Math.floor(v || 0));
      c._pixels = new Uint32Array(c._width * c._height);
    }
  });
  return c;
}
function fakeCtx(canvas) {
  const state = {
    tx: 0, ty: 0, fillStyle: '', strokeStyle: '', lineWidth: 1, font: '', textAlign: '',
    textBaseline: '', globalCompositeOperation: 'source-over', imageSmoothingEnabled: false
  };
  const stack = [];
  const writeRect = (x, y, w, h, val) => {
    x = Math.floor(x + state.tx); y = Math.floor(y + state.ty);
    w = Math.ceil(w); h = Math.ceil(h);
    const x0 = Math.max(0, x), y0 = Math.max(0, y);
    const x1 = Math.min(canvas.width, x + w), y1 = Math.min(canvas.height, y + h);
    for (let yy = y0; yy < y1; yy++) {
      const off = yy * canvas.width;
      for (let xx = x0; xx < x1; xx++) canvas._pixels[off + xx] = val;
    }
  };
  const fillValue = () => state.globalCompositeOperation === 'destination-out' ? 0 : styleHash(state.fillStyle);
  const strokeValue = () => styleHash(state.strokeStyle);
  return {
    canvas,
    get fillStyle() { return state.fillStyle; }, set fillStyle(v) { state.fillStyle = v; },
    get strokeStyle() { return state.strokeStyle; }, set strokeStyle(v) { state.strokeStyle = v; },
    get lineWidth() { return state.lineWidth; }, set lineWidth(v) { state.lineWidth = v; },
    get font() { return state.font; }, set font(v) { state.font = v; },
    get textAlign() { return state.textAlign; }, set textAlign(v) { state.textAlign = v; },
    get textBaseline() { return state.textBaseline; }, set textBaseline(v) { state.textBaseline = v; },
    get globalCompositeOperation() { return state.globalCompositeOperation; }, set globalCompositeOperation(v) { state.globalCompositeOperation = v; },
    get imageSmoothingEnabled() { return state.imageSmoothingEnabled; }, set imageSmoothingEnabled(v) { state.imageSmoothingEnabled = v; },
    beginPath() {}, rect() {}, moveTo() {}, lineTo() {}, arc() {}, ellipse() {}, closePath() {},
    clip() {},
    save() { stack.push({ ...state }); },
    restore() { if (stack.length) Object.assign(state, stack.pop()); },
    translate(x, y) { state.tx += x; state.ty += y; },
    setTransform(a, b, c, d, e, f) { state.tx = e || 0; state.ty = f || 0; },
    fill() {},
    stroke() {},
    fillRect(x, y, w, h) { writeRect(x, y, w, h, fillValue()); },
    clearRect(x, y, w, h) { writeRect(x, y, w, h, 0); },
    strokeRect(x, y, w, h) {
      const v = strokeValue(), lw = Math.max(1, Math.ceil(state.lineWidth || 1));
      writeRect(x, y, w, lw, v); writeRect(x, y + h - lw, w, lw, v);
      writeRect(x, y, lw, h, v); writeRect(x + w - lw, y, lw, h, v);
    },
    drawImage(src, x, y) {
      x = Math.floor(x + state.tx); y = Math.floor(y + state.ty);
      for (let sy = 0; sy < src.height; sy++) {
        const dy = y + sy;
        if (dy < 0 || dy >= canvas.height) continue;
        for (let sx = 0; sx < src.width; sx++) {
          const dx = x + sx;
          if (dx < 0 || dx >= canvas.width) continue;
          const v = src._pixels[sy * src.width + sx];
          if (v || state.globalCompositeOperation !== 'destination-over') canvas._pixels[dy * canvas.width + dx] = v;
        }
      }
    },
    fillText(s, x, y) { writeRect(x, y - 7, Math.max(1, String(s || '').length * 4), 7, fillValue()); },
    measureText(s) { return { width: String(s || '').length * 7 }; },
    getTransform() { return { a: 1, b: 0, c: 0, d: 1, e: state.tx, f: state.ty }; },
    createRadialGradient: fakeGradient
  };
}
global.document = {
  createElement(tag) {
    if (tag !== 'canvas') throw new Error('unexpected element ' + tag);
    const c = makeCanvas();
    canvases.push(c);
    return c;
  }
};

const StationBake = require('../frontend/app/stationbake.js');

function composeLayer(baked, layer) {
  const c = document.createElement('canvas');
  c.width = baked.W; c.height = baked.H;
  const ctx = c.getContext('2d');
  if (layer === 'base') StationBake.drawBase(ctx, baked, 0, 0);
  else StationBake.drawLight(ctx, baked, 0, 0);
  return c;
}
function pixelDiff(a, b) {
  if (a.width !== b.width || a.height !== b.height) return Infinity;
  let diff = 0;
  for (let i = 0; i < a._pixels.length; i++) if (a._pixels[i] !== b._pixels[i]) diff++;
  return diff;
}

function makeGeo() {
  const TILE = 12, COLS = 75, ROWS = 52;
  const zoneGrid = new Array(COLS * ROWS).fill(null);
  const idx = (x, y) => y * COLS + x;
  for (let y = 2; y <= 40; y++) for (let x = 2; x <= 60; x++) zoneGrid[idx(x, y)] = 'r1';
  return {
    TILE, COLS, ROWS, W: 900, H: 650, origin: { tx: 0, ty: 0 },
    allRects: [{ z: 'r1', x1: 2, y1: 2, x2: 60, y2: 40 }],
    zones: { r1: { x1: 2, y1: 2, x2: 60, y2: 40 } },
    ROOM_IDS: ['r1'], chamfers: [], windows: [], doorDefs: [], zoneGrid, idx,
    isCorridor: () => false,
    canStep: (x1, y1, x2, y2) => zoneGrid[idx(x1, y1)] === zoneGrid[idx(x2, y2)],
    baseColorOf: () => '#30343a',
    nameOf: () => 'HAB-01',
    kindOf: () => 'hab',
    FLOOR_STYLES: { hull: { base: '#30343a' } }
  };
}

// World II's architectural shade is a single coverage field, so adding the
// perpendicular wall cannot multiply several independent bands into black.
const shadeGeo = makeGeo(), shadeBefore = shadeGeo.zoneGrid.slice();
const shadeOptions = { edgeAO: 1, wallShadow: .5, cornerAO: .55, southFoot: 0, wallUp: 30, corUp: 30 };
const shadeEdge = (x, y, side, extra = {}) => ({ x, y, side, z: 'r1', room: true, ...extra });
const shadeEdges = [shadeEdge(31, 2, 'n'), shadeEdge(32, 2, 'n'), shadeEdge(33, 2, 'n'),
  shadeEdge(31, 2, 'w'), shadeEdge(33, 2, 'e')];
const shadeViewport = { x: 360, y: 20, w: 60, h: 44 };
const shade = (edges = shadeEdges, v = shadeViewport, opts = shadeOptions, g = shadeGeo) =>
  StationBake.wallFloorShadow(g, edges, v, opts);
const coverageAt = (field, x, y) => field.alpha[(y - field.y) * field.width + x - field.x];
const combinedShade = shade();
A.ok(combinedShade.alpha.some(a => a > 0), 'wall floor shade keeps real contact depth');
A.ok(Math.max(...combinedShade.alpha) <= 70, 'default corner coverage stays below 28 percent before the spatial light map');
A.eq(shade(shadeEdges.concat(shadeEdges)).alpha, combinedShade.alpha, 'duplicate wall feet do not multiply coverage');
A.eq(shade(shadeEdges.slice().reverse()).alpha, combinedShade.alpha, 'wall ordering does not change corner coverage');
const stressedShade = shade(shadeEdges, shadeViewport, { ...shadeOptions, edgeAO: 100, wallShadow: 100, cornerAO: 100 });
A.ok(Math.max(...stressedShade.alpha) <= 87, 'extreme depth controls still cannot exceed the architectural coverage cap');
const northOnly = shade([shadeEdge(32, 2, 'n')]);
const northProfile = Array.from({ length: 17 }, (_, y) => coverageAt(northOnly, 390, 33 + y));
A.ok(northProfile.every((a, i) => !i || a <= northProfile[i - 1]), 'north cast shade fades monotonically toward the deck');
A.ok(new Set(northProfile.filter(a => a > 0)).size > 8, 'north falloff resolves more than eight native pixel levels instead of four flat bands');
A.ok(northProfile.every((a, i) => !i || northProfile[i - 1] - a <= 8), 'adjacent falloff rows avoid abrupt broad band steps');
A.eq(northProfile.slice(14), [0, 0, 0], 'wall cast falloff ends cleanly at its shortened reach');
for (const v of [{ x: 379, y: 27, w: 39, h: 23 }, { x: 384, y: 33, w: 24, h: 17 }]) {
  const cropped = shade(shadeEdges, v);
  A.ok(cropped.alpha.every((a, i) => a === coverageAt(combinedShade, v.x + i % v.w, v.y + Math.floor(i / v.w))),
    'native shadow falloff is an exact crop across tile and 384px chunk boundaries at ' + v.x);
}
A.ok(shade(shadeEdges, shadeViewport, { ...shadeOptions, edgeAO: 0, wallShadow: 0, cornerAO: 0 }).alpha.every(a => a === 0),
  'turning off architectural depth controls leaves the floor untouched');
for (const excluded of [{ door: true }, { open: true }])
  A.ok(shade(shadeEdges.map(e => ({ ...e, ...excluded }))).alpha.every(a => a === 0), 'openings never acquire invented wall shade');
const roomBoundary = makeGeo();
for (let x = 31; x <= 33; x++) roomBoundary.zoneGrid[roomBoundary.idx(x, 3)] = x === 32 ? null : 'other-room';
const clippedShade = shade(shadeEdges, shadeViewport, shadeOptions, roomBoundary);
A.ok(Array.from({ length: 36 * 12 }, (_, i) => coverageAt(clippedShade, 372 + i % 36, 36 + Math.floor(i / 36))).every(a => a === 0),
  'falloff cannot enter void or another room even when the wall reaches beyond its tile');
const shiftedShadeGeo = { ...shadeGeo, origin: { tx: -4, ty: -6 }, zoneGrid: Array(shadeGeo.zoneGrid.length).fill(null) };
for (let y = 0; y < shadeGeo.ROWS - 6; y++) for (let x = 0; x < shadeGeo.COLS - 4; x++)
  shiftedShadeGeo.zoneGrid[shiftedShadeGeo.idx(x + 4, y + 6)] = shadeGeo.zoneGrid[shadeGeo.idx(x, y)];
A.eq(shade(shadeEdges.map(e => ({ ...e, x: e.x + 4, y: e.y + 6 })),
  { ...shadeViewport, x: shadeViewport.x + 48, y: shadeViewport.y + 72 }, shadeOptions, shiftedShadeGeo).alpha,
  combinedShade.alpha, 'signed-origin frame growth preserves physical shadow coverage');
A.eq(shadeGeo.zoneGrid, shadeBefore, 'shadow coverage cannot mutate geometry or its zone ownership');

// a chunk bake may allocate intermediates up to one skirt-margin taller than the chunk
// (the hull extrusion's silhouette canvases carry WALL.skirt+4 of vertical margin on each
// side so a footprint ending just outside the viewport still drops its skirt into it) —
// but never anything approaching full-world size.
const CHUNK_BOUND_H = StationBake.CHUNK_PX + 2 * (Math.round(StationBake.WALL.skirt) + 4);
const boundedCanvas = c => c.width <= StationBake.CHUNK_PX && c.height <= CHUNK_BOUND_H;

const geo = makeGeo();
canvases.length = 0;
const first = StationBake.bakeIncremental(geo, null, null);
A.ok(first.chunked, 'large bake uses the chunk cache');
A.eq(first.stats.chunkCount, 6, '900x650 bake splits into a 3x2 chunk grid');
A.eq(first.stats.rebakedChunks, 6, 'cold bake renders every chunk once');
A.ok(canvases.every(boundedCanvas),
  'chunk bake never allocates a full-world canvas');

const mono = StationBake.bake(geo);
A.eq(first.flickers.length, mono.flickers.length, 'chunked bake deduplicates flicker anchors to monolithic count');
A.eq(pixelDiff(composeLayer(first, 'base'), mono.baseCv), 0,
  'full chunk base composite matches the monolithic bake baseline');
A.eq(pixelDiff(composeLayer(first, 'light'), mono.lightCv), 0,
  'full chunk light composite matches the monolithic bake baseline');

const reusedBefore = new Map(first.chunkMap);
canvases.length = 0;
const second = StationBake.bakeIncremental(geo, first, [{ x1: 10, y1: 10, x2: 10, y2: 10 }]);
A.eq(second.stats.fullReset, false, 'same bounds/origin allow incremental reuse');
A.eq(second.stats.dirtyChunks, ['0,0'], 'single tile edit maps to the exact dirty chunk');
// a rect that names its own reach (a room's name plate: only the text's pixels change) is not padded by the wall reach
A.eq(StationBake.dirtyChunks(geo, [{ x1: 28, y1: 20, x2: 30, y2: 20 }]).map(d => d.key), ['0,0', '1,0'], 'a tile edit near a chunk edge reaches the next chunk');
A.eq(StationBake.dirtyChunks(geo, [{ x1: 28, y1: 20, x2: 30, y2: 20, pad: 0 }]).map(d => d.key), ['0,0'], '…a pad-0 rect there re-bakes only the chunk it lies in');
A.eq(second.stats.rebakedChunks, 1, 'single tile edit rebakes one chunk');
A.eq(second.stats.reusedChunks, 5, 'single tile edit reuses untouched chunks');
A.ok(second.chunkMap.get('1,0') === reusedBefore.get('1,0'), 'untouched chunk object is reused');
A.ok(canvases.every(boundedCanvas),
  'incremental rebake remains bounded to chunk-sized canvases');

const visible = StationBake.visibleChunks(first, { x: 384, y: 0, w: 384, h: 384 });
A.eq(visible.map(c => c.key), ['1,0'], 'visible chunk query returns only chunks intersecting the viewport');
A.eq(StationBake.missingVisibleChunks(first, { x: 384, y: 0, w: 384, h: 384 }), [],
  'complete cache reports no missing visible chunks');

const drawn = [];
const drawCtx = { drawImage(cv, x, y) { drawn.push({ cv, x, y }); } };
StationBake.drawBase(drawCtx, first, 0, 0, { x: 384, y: 0, w: 384, h: 384 });
A.eq(drawn.length, 1, 'drawBase culls chunked composites to the visible viewport');
A.eq(drawn[0].x, 384, 'drawBase preserves chunk world offset when culling');

const fullDrawn = [];
StationBake.drawBase({ drawImage(cv, x, y) { fullDrawn.push({ cv, x, y, w: cv.width, h: cv.height }); } }, first, 0, 0);
// every chunk is a whole CHUNK_PX square, the edge ones too (past the floor's edge it is transparent): a floor that grows
// or shrinks there never changes a chunk's size, so it never re-bakes a chunk its rects do not reach
A.eq(fullDrawn.map(d => [d.x, d.y, d.w, d.h]), [
  [0, 0, 384, 384], [384, 0, 384, 384], [768, 0, 384, 384],
  [0, 384, 384, 384], [384, 384, 384, 384], [768, 384, 384, 384]
], 'full chunk composite covers the station without gaps, overlaps, or seam offsets');

canvases.length = 0;
const visibleCold = StationBake.bakeIncremental(geo, null, null, {
  visibleRect: { x: 384, y: 0, w: 384, h: 384 },
  maxRetainedChunks: 2
});
A.eq(visibleCold.stats.chunkCount, 1, 'cold visible bake renders only requested chunks');
A.eq(visibleCold.stats.dirtyChunks, ['1,0'], 'cold visible bake reports the rendered visible chunk');
A.eq(visibleCold.stats.evictedChunks, 0, 'cold visible bake does not evict when under the retention cap');
A.eq(StationBake.missingVisibleChunks(visibleCold, { x: 768, y: 0, w: 132, h: 384 }), ['2,0'],
  'visible-only cache reports newly exposed chunks after panning');
const panned = StationBake.bakeIncremental(geo, visibleCold, null, {
  visibleRect: { x: 768, y: 0, w: 132, h: 384 },
  maxRetainedChunks: 2,
  onlyMissingVisible: true
});
A.eq(panned.stats.dirtyChunks, [], 'pan-only visible fill does not dirty the whole station');
A.eq(panned.stats.rebakedChunks, 1, 'pan-only visible fill bakes only the newly exposed chunk');
A.ok(panned.chunkMap.has('2,0'), 'pan-only visible fill caches the newly exposed chunk');

const retained = StationBake.bakeIncremental(geo, first, [{ x1: 4, y1: 4, x2: 4, y2: 4 }], {
  visibleRect: { x: 384, y: 0, w: 384, h: 384 },
  maxRetainedChunks: 2
});
A.eq(retained.stats.chunkCount, 2, 'LRU retention bounds the cached chunk count');
A.ok(retained.chunkMap.has('0,0'), 'dirty chunk is retained even when outside the visible viewport');
A.ok(retained.chunkMap.has('1,0'), 'visible chunk is retained for the current frame');
A.ok(retained.stats.evictedChunks >= 4, 'LRU retention evicts older non-required chunks');

const shiftedGeo = makeGeo();
shiftedGeo.origin = { tx: 1, ty: 0 };
canvases.length = 0;
const reset = StationBake.bakeIncremental(shiftedGeo, first, [{ x1: 10, y1: 10, x2: 10, y2: 10 }], {
  visibleRect: { x: 0, y: 0, w: 384, h: 384 },
  maxRetainedChunks: 2
});
A.eq(reset.stats.fullReset, true, 'origin changes reset chunk metadata instead of reusing stale chunks');
A.eq(reset.stats.chunkCount, 1, 'origin reset can rebuild only the visible chunk');
A.ok(canvases.every(boundedCanvas),
  'origin reset does not allocate full-world base/light canvases');

/* THE FLOOR GREW, THE FRAME DID NOT MOVE (2026-10-13): a room stamped past the south edge changes H, not the origin —
   the chunks it cannot reach are kept (the same objects), the reshaped edge row re-bakes, and the composite is still
   pixel-identical to a monolithic bake of the grown floor. */
function roomsGeo(rooms, ROWS, chamfer) {
  const TILE = 12, COLS = 75, zoneGrid = new Array(COLS * ROWS).fill(null), idx = (x, y) => y * COLS + x, zones = {};
  for (const r of rooms) { zones[r.z] = r; for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) zoneGrid[idx(x, y)] = r.z; }
  return {
    TILE, COLS, ROWS, W: COLS * TILE, H: ROWS * TILE, origin: { tx: 0, ty: 0 },
    allRects: rooms.slice(), zones, ROOM_IDS: rooms.map(r => r.z), windows: [], doorDefs: [], zoneGrid, idx,
    chamfers: chamfer ? rooms.flatMap(r => [[r.x1, r.y1, 'tl'], [r.x2, r.y1, 'tr'], [r.x1, r.y2, 'bl'], [r.x2, r.y2, 'br']]) : [],
    isCorridor: () => false,
    canStep: (x1, y1, x2, y2) => zoneGrid[idx(x1, y1)] === zoneGrid[idx(x2, y2)],
    baseColorOf: () => '#30343a', nameOf: z => z.toUpperCase(), kindOf: () => 'hab',
    FLOOR_STYLES: { hull: { base: '#30343a' } }
  };
}
const northRoom = { z: 'r1', x1: 2, y1: 2, x2: 60, y2: 20 }, southRoom = { z: 'r2', x1: 4, y1: 44, x2: 30, y2: 60 };
const before = roomsGeo([northRoom], 52), beforeBake = StationBake.bakeIncremental(before, null, null);
const grownGeo = roomsGeo([northRoom, southRoom], 66);
const grownBake = StationBake.bakeIncremental(grownGeo, beforeBake, [southRoom]);
A.eq(grownBake.stats.fullReset, false, 'a floor that grew south keeps its frame');
A.ok(grownBake.chunkMap.get('0,0') === beforeBake.chunkMap.get('0,0') && grownBake.chunkMap.get('2,0') === beforeBake.chunkMap.get('2,0'),
  'chunks the new room cannot reach are kept, not re-baked');
A.ok(grownBake.chunkMap.get('0,1') !== beforeBake.chunkMap.get('0,1'), 'the edge chunk the new room reaches is re-baked');
A.ok(grownBake.chunkMap.get('2,1') === beforeBake.chunkMap.get('2,1'), '…and the edge chunk it does not reach is kept: the new size reshapes no chunk');
const grownMono = StationBake.bake(grownGeo);
A.eq(pixelDiff(composeLayer(grownBake, 'base'), grownMono.baseCv), 0, 'the kept + re-baked composite is the grown floor, pixel for pixel');
A.eq(pixelDiff(composeLayer(grownBake, 'light'), grownMono.lightCv), 0, '…its light too');
const shrunk = StationBake.bakeIncremental(before, grownBake, [southRoom]);
A.eq(pixelDiff(composeLayer(shrunk, 'base'), StationBake.bake(before).baseCv), 0, 'removing it again composes the original floor');
const movedOrigin = roomsGeo([northRoom], 52); movedOrigin.origin = { tx: -3, ty: 0 };
A.eq(StationBake.bakeIncremental(movedOrigin, beforeBake, [northRoom]).stats.fullReset, true, 'an origin move still resets every chunk');
// an edit with no rects re-bakes the station: only what is on screen bakes now, the rest as it pans into view
const everything = StationBake.bakeIncremental(before, beforeBake, [], { visibleRect: { x: 0, y: 0, w: 384, h: 384 } });
A.eq(everything.stats.rebakedChunks, 1, 'a station-wide edit bakes the visible chunk, not all six');
A.eq(everything.stats.chunkCount, 1, '…and drops the stale others');
A.eq(StationBake.missingVisibleChunks(everything, { x: 384, y: 0, w: 384, h: 384 }), ['1,0'], '…which the pan path re-bakes on sight');
/* THE WORLD'S BAKE IS ALREADY THE FLOOR (2026-10-13): BUILD MODE's first edit starts from the live world's WHOLE-station
   bake. The chunks the edit cannot reach are cut from it (never re-baked) and the composite is still the edited floor. */
const wholeBefore = StationBake.bake(before);
const firstSame = StationBake.bakeIncremental(before, wholeBefore, [{ x1: 10, y1: 5, x2: 12, y2: 6 }]);
A.eq(firstSame.stats.fullReset, false, 'a first edit keeps the frame of the whole-station bake');
A.eq(firstSame.chunkMap.size, 6, '…every chunk of the floor is present');
A.eq(firstSame.stats.rebakedChunks, 1, '…and only the one the edit reaches is baked');
A.eq(pixelDiff(composeLayer(firstSame, 'base'), wholeBefore.baseCv), 0, 'cut chunks compose the whole-station bake exactly');
A.eq(pixelDiff(composeLayer(firstSame, 'light'), wholeBefore.lightCv), 0, '…its light too');
A.eq(firstSame.lamps.length, wholeBefore.lamps.length, '…and every lamp');
/* (the floor here ends on a chunk row: this canvas mock has no readback, so its hull pass paints its band over every
   transparent pixel of a chunk, beyond the floor too, which a real canvas masks away — a chunk cut from a whole-station bake
   ends at that bake's edge. The real-canvas cut of a part-row edge chunk is stationbake.plate-parity's south room.) */
const before768 = roomsGeo([northRoom], 64), whole768 = StationBake.bake(before768);
const southRoom768 = { z: 'r2', x1: 4, y1: 70, x2: 30, y2: 76 }, grown768 = roomsGeo([northRoom, southRoom768], 80), grownMono768 = StationBake.bake(grown768);
const firstGrown = StationBake.bakeIncremental(grown768, whole768, [southRoom768]);
A.eq(firstGrown.stats.fullReset, false, 'a first edit that grows the floor south keeps the frame too');
A.eq(firstGrown.stats.reusedChunks, 4, '…cutting every chunk of the old floor the new room cannot reach');
A.eq(pixelDiff(composeLayer(firstGrown, 'base'), grownMono768.baseCv), 0, '…and the composite is the grown floor, pixel for pixel');
A.eq(pixelDiff(composeLayer(firstGrown, 'light'), grownMono768.lightCv), 0, '…its light too');
A.eq(StationBake.bakeIncremental(movedOrigin, wholeBefore, [northRoom]).stats.fullReset, true, 'an origin move still bakes every chunk');
/* THE LIGHTS ARE THE FLOOR'S NOW (2026-10-13): every chunk lists the whole station's lamps as they stood when it baked —
   removing a room in-frame must take its lamps out of the cache, even from chunks the edit never reached. */
const sideRoom = { z: 'r3', x1: 4, y1: 30, x2: 14, y2: 40 };
const twoRooms = StationBake.bakeIncremental(roomsGeo([northRoom, sideRoom], 52), null, null);
const oneRoomGeo = roomsGeo([northRoom], 52), freshOne = StationBake.bakeIncremental(oneRoomGeo, null, null);
A.ok(twoRooms.lamps.length > freshOne.lamps.length, 'the second room has lamps of its own');
const roomGone = StationBake.bakeIncremental(oneRoomGeo, twoRooms, [sideRoom]);
A.ok(roomGone.stats.reusedChunks > 0, 'removing it keeps the chunks it never reached');
A.eq([roomGone.lamps.length, roomGone.flickers.length], [freshOne.lamps.length, freshOne.flickers.length], '…and its lamps and flickers go with it');
A.eq(StationBake.bakeIncremental(oneRoomGeo, roomGone, null, { visibleRect: { x: 0, y: 0, w: 384, h: 384 }, onlyMissingVisible: true }).lamps.length,
  freshOne.lamps.length, 'a pan that bakes nothing carries the lists over unchanged');

/* BUILD MODE HANDS ITS FLOOR BACK (2026-10-13): a chunk set that covers the floor stitches into the whole-station bake the
   live world takes on SAVE & EXIT, pixel for pixel; one with holes, or from another frame, is refused (the world bakes). */
const handedBack = StationBake.stitchWhole(before, firstSame);
A.ok(handedBack && handedBack.stitched, 'a complete chunk set stitches into one whole-station bake');
A.eq(pixelDiff(handedBack.baseCv, wholeBefore.baseCv), 0, '…its base is the whole-station bake');
A.eq(pixelDiff(handedBack.lightCv, wholeBefore.lightCv), 0, '…and so is its light');
A.eq([handedBack.W, handedBack.H, handedBack.lamps.length, handedBack.doorOccluders.length],
  [wholeBefore.W, wholeBefore.H, wholeBefore.lamps.length, wholeBefore.doorOccluders.length], '…with the same frame, lamps and door occluders');
const grownHandedBack = StationBake.stitchWhole(grown768, firstGrown);
A.ok(grownHandedBack && pixelDiff(grownHandedBack.baseCv, grownMono768.baseCv) === 0, 'a grown floor hands back its grown whole bake');
const holes = StationBake.bakeIncremental(before, null, [], { visibleRect: { x: 0, y: 0, w: 384, h: 384 } });
A.eq(StationBake.stitchWhole(before, holes), null, 'a chunk set with holes is refused');
A.eq(StationBake.stitchWhole(grownGeo, firstSame), null, '…and so is one baked in another frame');

// A CHUNK PAINTS ONLY WHAT CAN REACH IT: far-apart rounded rooms, chunked == monolithic
const spread = roomsGeo([{ z: 'a', x1: 2, y1: 3, x2: 12, y2: 12 }, { z: 'b', x1: 52, y1: 3, x2: 70, y2: 14 }, { z: 'c', x1: 20, y1: 36, x2: 40, y2: 48 }], 52, true);
const spreadMono = StationBake.bake(spread), spreadChunks = StationBake.bakeIncremental(spread, null, null);
A.eq(pixelDiff(composeLayer(spreadChunks, 'base'), spreadMono.baseCv), 0, 'culled chunks compose the monolithic base exactly');
A.eq(pixelDiff(composeLayer(spreadChunks, 'light'), spreadMono.lightCv), 0, 'culled chunks compose the monolithic light exactly');
A.eq(spreadChunks.lamps.length, spreadMono.lamps.length, 'every lamp survives the cull');

/* Deck MATERIAL selection rides the same chunk path as everything above; the per-material
   pixel work is asserted in stationbake.materials.test.js instead. It can't be asserted HERE:
   this file's canvas mock resolves a gradient fillStyle to a single value, so the room-lighting
   pass flattens the whole footprint and every floor mark under it becomes invisible. */
const matGeo = mat => { const g = makeGeo(); g.matOf = () => mat; return g; };
for (const mat of ['grate', 'hex', 'plank', 'turf', 'alloy']) {
  const g = matGeo(mat);
  A.eq(pixelDiff(composeLayer(StationBake.bakeIncremental(g, null, null), 'base'), StationBake.bake(g).baseCv), 0,
    mat + ' deck bakes identically chunked and monolithic');
}

// Regression: growing either room axis must add distributed, weaker fixtures.
// Actual coverage is checked by dev/room-lighting-even-proof.mjs; this canvas
// mock cannot represent gradients.
for (const [w, h] of [[9, 7], [14, 9], [15, 14], [18, 18], [24, 16], [12, 24], [40, 30]]) {
  const g = makeGeo(), r = { z: 'r1', x1: 2, y1: 2, x2: w + 1, y2: h + 1 };
  g.allRects = [r]; g.zones.r1 = r; g.zoneGrid.fill(null);
  for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) g.zoneGrid[g.idx(x, y)] = 'r1';
  const lamps = StationBake.bake(g).lamps;
  const cols = Math.ceil(w / 8), rows = Math.ceil(h / 8);
  A.eq(lamps.length, cols * rows, w + 'x' + h + ' distributes fixtures on both axes');
  A.eq(new Set(lamps.map(l => l.x)).size, cols, w + 'x' + h + ' covers the full width');
  A.eq(new Set(lamps.map(l => l.y)).size, rows, w + 'x' + h + ' covers the full height');
  A.ok(lamps.every(l => l.gain > 0 && l.gain <= .25), w + 'x' + h + ' keeps fixture accents below the diffuse fill');

}

// Raised corner faces are part of the interior, including the portion above
// the footprint. The receiver must follow both corner shapes without lighting
// the crown or the void above it.
const savedUp = StationBake.WALL.up, savedN = StationBake.SHAPE.cornerN;
for (const n of [1, 2]) {
  StationBake.SHAPE.cornerN = n;
  const g = makeGeo(), r = {z:'r1',x1:4,y1:6,x2:18,y2:17};
  g.allRects=[r];g.zones.r1=r;g.zoneGrid.fill(null);
  for(let y=r.y1;y<=r.y2;y++)for(let x=r.x1;x<=r.x2;x++)g.zoneGrid[g.idx(x,y)]='r1';
  g.chamfers=[[r.x1,r.y1,'tl'],[r.x2,r.y1,'tr'],[r.x1,r.y2,'bl'],[r.x2,r.y2,'br']];
  for(const up of [14,30,50]) {
    StationBake.WALL.up=up;
    const b=StationBake.bake(g),mask=b.interiorCv;
    const y=r.y1*12-Math.min(10,up-10); // below the crown even on the shallow 14px wall
    for(const x of [r.x1*12+6,(r.x2+1)*12-6]) {
      A.ok(mask._pixels[y*mask.width+x]!==0,'corner '+n+' height '+up+' raised face receives light at '+x);
      A.eq(mask._pixels[(r.y1*12-up-10)*mask.width+x],0,'corner '+n+' height '+up+' leaves sky outside the receiver');
    }
    if(up===30) {
      const chunks=StationBake.bakeIncremental(g,null,null);
      A.eq(pixelDiff(composeLayer(chunks,'light'),b.lightCv),0,'corner '+n+' raised wall lighting matches across chunk and full bake');
    }
  }
}
StationBake.WALL.up=savedUp;StationBake.SHAPE.cornerN=savedN;

// A complete bake must carry the same selected material and paint to the north
// face, side strip and curved corners. Geometry remains owned by StationBake.
global.WorldSurface = require('../frontend/app/worldsurface.js');
function textureGeo(material, base) {
  const TILE = 12, COLS = 27, ROWS = 27, zoneGrid = Array(COLS * ROWS).fill(null);
  const idx = (x, y) => y * COLS + x, r = { z: 'r1', x1: 4, y1: 6, x2: 20, y2: 18 };
  for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) zoneGrid[idx(x, y)] = 'r1';
  return { TILE, COLS, ROWS, W: COLS * TILE, H: ROWS * TILE, origin: { tx: -13, ty: -17 },
    allRects: [r], zones: { r1: r }, ROOM_IDS: ['r1'], windows: [], doorDefs: [], zoneGrid, idx,
    chamfers: [[r.x1, r.y1, 'tl'], [r.x2, r.y1, 'tr'], [r.x1, r.y2, 'bl'], [r.x2, r.y2, 'br']],
    isCorridor: () => false, canStep: (x, y, nx, ny) => zoneGrid[idx(x, y)] === zoneGrid[idx(nx, ny)],
    baseColorOf: () => '#30343a', wallBaseOf: () => base, wallMatOf: () => material,
    nameOf: () => 'MATERIAL FIXTURE', kindOf: () => 'hab' };
}
const declinedGeo = textureGeo('panelled', '#476a91');
const nativeTextureBase = StationBake.bake(declinedGeo).baseCv;
const wallArtCalls = [], stripArtCalls = [], patchArtCalls = [], detailCanvases = [];
let acceptStrip = false, denseStrip = false;
global.IndustrialTextures = {
  enabled: () => true, detailContext: ctx => { detailCanvases.push(ctx.canvas); return ctx; }, floor: () => false, shell: () => false,
  shellPlate: () => false, drawBase: () => false,
  wall(ctx, x, y, w, h, tx, material, base, opts) {
    wallArtCalls.push({ material, base, opts, tx }); return false;
  },
  wallPatch(ctx, x, y, w, h, strip, map) { patchArtCalls.push({ x, y, w, h, ...map(x + w / 2, y + h / 2) }); },
  wallStrip(h, material, base, opts) {
    stripArtCalls.push({ material, base, opts, h });
    if (!acceptStrip) return null;
    const d = new Uint8ClampedArray(48 * h * 4), n = parseInt(base.slice(1), 16);
    for (let i = 0; i < d.length; i += 4) { d[i] = n >>> 16; d[i + 1] = (n >>> 8) & 255; d[i + 2] = n & 255; d[i + 3] = 255; }
    return { d, w: 48, h, x0: 0, ...(denseStrip ? { hi: {} } : {}) };
  }
};
A.eq(pixelDiff(StationBake.bake(declinedGeo).baseCv, nativeTextureBase), 0,
  'unavailable texture strip preserves the complete native bake and selected wall colour');
acceptStrip = true;
for (const mat of WorldSurface.WALLS) {
  for (const color of ['#476a91', '#946747']) {
    wallArtCalls.length = 0; stripArtCalls.length = 0;
    const tg = textureGeo(mat, color), previousGrid = tg.zoneGrid.slice();
    const result = StationBake.bake(tg);
    A.ok(wallArtCalls.length > 0 && wallArtCalls.every(c => c.material === mat && c.base === color), mat + ' north face retains the selected paint');
    A.ok(stripArtCalls.length > 4 && stripArtCalls.every(c => c.material === mat && c.base === color && c.opts.detail === StationBake.DEPTH.wallDetail), mat + ' side walls and all four corners request that same selected finish');
    A.eq(tg.zoneGrid, previousGrid, mat + ' atlas selection never changes station geometry');
    A.eq([result.W, result.H], [tg.W, tg.H], mat + ' atlas selection keeps station proportions');
  }
}
for (const mat of ['viewport', 'wainscot', 'hedge']) {
  stripArtCalls.length = 0; wallArtCalls.length = 0;
  StationBake.bake(textureGeo(mat, '#476a91'));
  A.eq(stripArtCalls.length, 0, mat + ' specialized corners are never replaced by the generic atlas');
  A.eq(wallArtCalls.length, 0, mat + ' specialized straight faces keep their own native geometry');
}

// Signed physical coordinates must survive a west/north bounds expansion for
// every projection of the wall, including fractional high-detail corner samples.
global.IndustrialTextures.isRemaster = () => true;
denseStrip = true;
function movedTextureGeo(dx, dy) {
  const g = textureGeo('bulkhead', '#476a91'), r = g.allRects[0];
  g.origin.tx -= dx; g.origin.ty -= dy;
  r.x1 += dx; r.x2 += dx; r.y1 += dy; r.y2 += dy;
  g.zoneGrid.fill(null);
  for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) g.zoneGrid[g.idx(x, y)] = 'r1';
  g.chamfers = [[r.x1, r.y1, 'tl'], [r.x2, r.y1, 'tr'], [r.x1, r.y2, 'bl'], [r.x2, r.y2, 'br']];
  return g;
}
function wallAddresses(g) {
  wallArtCalls.length = 0; patchArtCalls.length = 0;
  StationBake.bake(g);
  return { straight: wallArtCalls.map(c => c.tx), projected: patchArtCalls.map(c => ({
    x: c.x + g.origin.tx * 12, y: c.y + g.origin.ty * 12, w: c.w, h: c.h,
    a: Math.round(c.a * 1e6) / 1e6, d: Math.round(c.d * 1e6) / 1e6
  })) };
}
const oldWallAddresses = wallAddresses(movedTextureGeo(0, 0));
A.ok(oldWallAddresses.straight.some(x => x < 0), 'remaster north faces receive signed physical tile coordinates');
A.ok(oldWallAddresses.projected.length > 100, 'side and all curved wall faces use the shared high-detail strip');
A.ok(oldWallAddresses.projected.some(p => p.w < 1 || p.h < 1), 'remaster corner surface is sampled below the old whole-pixel grid');
A.eq(wallAddresses(movedTextureGeo(3, 2)), oldWallAddresses, 'growing station bounds preserves every straight, side and corner texture address');

// Door occluders keep their exact old depth/clip geometry, while capturing the
// same high-detail plate used by the adjacent wall instead of a blurred copy.
const doorGeo = textureGeo('bulkhead', '#476a91');
const hall = { z: 'hall', x1: 10, x2: 12, y1: 2, y2: 5 };
doorGeo.allRects.push(hall); doorGeo.zones.hall = hall;
for (let y = hall.y1; y <= hall.y2; y++) for (let x = hall.x1; x <= hall.x2; x++) doorGeo.zoneGrid[doorGeo.idx(x, y)] = 'hall';
doorGeo.isCorridor = z => z === 'hall';
doorGeo.canStep = (x, y, nx, ny) => doorGeo.zoneGrid[doorGeo.idx(x, y)] != null && doorGeo.zoneGrid[doorGeo.idx(nx, ny)] != null;
detailCanvases.length = 0;
const revealCalls=[];
global.IndustrialTextures.doorReturn=(ctx,...args)=>{revealCalls.push(args);return true;};
const remasterDoors = StationBake.bake(doorGeo).doorOccluders;
A.ok(revealCalls.length>0 && revealCalls.length%2===0,'authored doorway path paints paired reveals');
for(let i=0;i<revealCalls.length;i+=2) {
  const left=revealCalls[i],right=revealCalls[i+1];
  A.eq(left.slice(1,4),right.slice(1,4),'paired jambs share height and splay');
  A.ok(right[0]-left[0]-2*(left[3]+1)>=6,'authored jambs preserve an open centre');
}

A.ok(remasterDoors.length > 0, 'real corridor throat produces a depth-sorted door occluder');
A.ok(remasterDoors.every(d => detailCanvases.includes(d.image)), 'each remaster door occluder captures the dense art plate');
global.IndustrialTextures.isRemaster = () => false;
const classicDoors = StationBake.bake(doorGeo).doorOccluders;
const doorGeometry = d => ({ x: d.x, y: d.y, w: d.w, h: d.h, sortY: d.sortY });
A.eq(remasterDoors.map(doorGeometry), classicDoors.map(doorGeometry), 'remaster preserves every door occluder footprint and depth anchor');

/* ONE PLATE GRID, ONE SET OF PIXELS (2026-10-14, the busy-station walk: BUILD MODE's kept bake disagreed with a fresh one by
   0.8-1.1 M dense-plate pixels after a rename or a room past the south/east edge, and a room past the east edge left 9 chunks
   at the wrong plate size). With the industrial plate on, a floor wider than 682px paints at a fractional density. */
function gridGeo(COLS, ROWS, rooms) {
  const TILE = 12, zoneGrid = new Array(COLS * ROWS).fill(null), idx = (x, y) => y * COLS + x, zones = {};
  for (const r of rooms) { zones[r.z] = r; for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) zoneGrid[idx(x, y)] = r.z; }
  return { TILE, COLS, ROWS, W: COLS * TILE, H: ROWS * TILE, origin: { tx: 0, ty: 0 }, allRects: rooms.slice(), zones,
    ROOM_IDS: rooms.map(r => r.z), windows: [], doorDefs: [], zoneGrid, idx, chamfers: [], isCorridor: () => false,
    canStep: (x1, y1, x2, y2) => zoneGrid[idx(x1, y1)] === zoneGrid[idx(x2, y2)],
    baseColorOf: () => '#30343a', nameOf: z => z.toUpperCase(), kindOf: () => 'hab', FLOOR_STYLES: { hull: { base: '#30343a' } } };
}
const gridRooms = [{ z: 'a', x1: 2, y1: 2, x2: 30, y2: 14 }, { z: 'b', x1: 40, y1: 4, x2: 70, y2: 20 }, { z: 'c', x1: 6, y1: 24, x2: 36, y2: 34 }];
{
  // every dense scratch layer the bake folds back into a plate lands on that plate's pixel grid, 1:1 — its size and its offset
  // in the canvas it folds into are whole plate pixels (a fractional one resamples the hull skirts differently per canvas)
  const plated = new Set(), folds = [], dc = global.IndustrialTextures.detailContext;
  global.IndustrialTextures.detailContext = (ctx, ref) => {
    const s = ref && ref.scale;
    plated.add(ctx.canvas);
    return new Proxy(ctx, {
      get(target, key) {
        const v = target[key];
        if (key === 'drawImage') return (img, x, y, ...rest) => {
          if (plated.has(img) && s) { const m = target.getTransform(); folds.push({ s, w: img.width, h: img.height, x: x + m.e, y: y + m.f }); }
          return v.apply(target, [img, x, y, ...rest]);
        };
        return typeof v === 'function' ? v.bind(target) : v;
      },
      set(target, key, value) { target[key] = value; return true; }
    });
  };
  StationBake.bakeIncremental(gridGeo(84, 40, gridRooms), null, null);
  global.IndustrialTextures.detailContext = dc;
  const whole = n => Math.abs(n - Math.round(n)) < 1e-9;
  A.ok(folds.length > 0 && folds.every(f => f.s === 4.0625), 'a 1008px floor paints its plate at 4.0625x and folds hull layers into it (' + folds.length + ')');
  const off = folds.filter(f => !whole(f.w * f.s) || !whole(f.h * f.s) || !whole(f.x * f.s) || !whole(f.y * f.s));
  A.eq(off.length, 0, 'every hull scratch layer folds into the plate 1:1 on its pixel grid' + (off.length ? ' (first off-grid: ' + JSON.stringify(off[0]) + ')' : ''));
}
{
  const narrow = gridGeo(75, 40, gridRooms), wide = gridGeo(84, 40, gridRooms), tall = gridGeo(75, 50, gridRooms);
  const before = StationBake.bakeIncremental(narrow, null, null);
  const east = StationBake.bakeIncremental(wide, before, [{ x1: 76, y1: 2, x2: 82, y2: 8 }]);
  A.eq([east.stats.fullReset, east.stats.reusedChunks], [true, 0], 'a floor that grew east past a plate density step keeps no chunk painted at the old density');
  const south = StationBake.bakeIncremental(tall, before, [{ x1: 2, y1: 42, x2: 9, y2: 47 }]);
  A.ok(!south.stats.fullReset && south.stats.reusedChunks > 0, '…while one that grew without moving the density keeps its unreached chunks');
  const stitched = StationBake.bake(narrow);
  A.ok(stitched.stitched, 'a station wider than one chunk bakes AS its chunks, stitched — the world, the cut chunks and the re-baked ones are one set of pixels');
  A.ok(!StationBake.bake(textureGeo('bulkhead', '#476a91')).stitched, '…a one-chunk station bakes whole');
  const cut = StationBake.bakeIncremental(narrow, stitched, [{ x1: 10, y1: 5, x2: 12, y2: 6 }]);
  A.ok(!cut.stats.fullReset && cut.stats.reusedChunks > 0, 'BUILD MODE\'s first edit cuts its unreached chunks from that stitched bake');
  const monolithic = Object.assign({}, stitched, { stitched: false });
  A.eq(StationBake.bakeIncremental(narrow, monolithic, [{ x1: 10, y1: 5, x2: 12, y2: 6 }]).stats.fullReset, true,
    '…but never from a whole-canvas bake of a larger floor, which is not made of chunk pixels');
}

delete global.IndustrialTextures;
delete global.WorldSurface;

A.report('stationbake.chunk');
