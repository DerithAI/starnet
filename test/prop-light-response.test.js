/* Integer RGBA raster adapter exercises real canonical prop pixels and overlay
   composition. It is not a substitute for the integrated CRT/world visual check. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/app/propsprites.js'), 'utf8');
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const color = value => {
  if (value.startsWith('#')) {
    let hex = value.slice(1); if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
    const n = parseInt(hex, 16); return [n >>> 16, (n >>> 8) & 255, n & 255, 1];
  }
  const channels = value.match(/[\d.]+/g).map(Number); return channels.length === 3 ? [...channels, 1] : channels;
};
const multiply = (a, b) => [a[0]*b[0]+a[2]*b[1],a[1]*b[0]+a[3]*b[1],a[0]*b[2]+a[2]*b[3],a[1]*b[2]+a[3]*b[3],a[0]*b[4]+a[2]*b[5]+a[4],a[1]*b[4]+a[3]*b[5]+a[5]];
class Canvas {
  constructor(env, width = 0, height = 0) { this.env = env; this.listeners = new Map(); this.width = width; this.height = height; }
  set width(w) { this._w = w; this.reset(); } get width() { return this._w; }
  set height(h) { this._h = h; this.reset(); } get height() { return this._h; }
  reset() { this.pixels = new Uint8ClampedArray((this._w || 0) * (this._h || 0) * 4); this.ctx = new Context(this); }
  getContext() { return this.ctx; }
  addEventListener(name, fn) { this.listeners.set(name, fn); }
  lose(dispatch = true) { this.ctx.lost = true; if (dispatch && this.listeners.has('contextlost')) this.listeners.get('contextlost')(); }
}
class Context {
  constructor(canvas) {
    this.canvas = canvas; this.matrix = [1,0,0,1,0,0]; this.stack = []; this.draws = [];
    this.fillStyle = '#000000'; this.globalAlpha = 1; this.globalCompositeOperation = 'source-over'; this.imageSmoothingEnabled = true;
  }
  state() { return { matrix: this.matrix.slice(), fillStyle: this.fillStyle, globalAlpha: this.globalAlpha,
    globalCompositeOperation: this.globalCompositeOperation, imageSmoothingEnabled: this.imageSmoothingEnabled }; }
  save() { this.stack.push(this.state()); } restore() { Object.assign(this, this.stack.pop()); }
  transform(...m) { this.matrix = multiply(this.matrix, m); }
  translate(x, y) { this.transform(1,0,0,1,x,y); } scale(x, y) { this.transform(x,0,0,y,0,0); }
  setTransform(...m) { this.matrix = m; }
  blend(x, y, rgba) {
    if (x < 0 || y < 0 || x >= this.canvas.width || y >= this.canvas.height) return;
    const i = (y * this.canvas.width + x) * 4, out = this.canvas.pixels;
    const s = Math.max(0, Math.min(1, rgba[3] * this.globalAlpha)), d = out[i + 3] / 255;
    if (this.globalCompositeOperation === 'source-in') {
      for (let c = 0; c < 3; c++) out[i+c] = rgba[c]; out[i+3] = Math.round(s*d*255); return;
    }
    assert.equal(this.globalCompositeOperation, 'source-over', 'raster supports the actual blend modes used here');
    const a = s + d * (1-s); if (!a) return;
    for (let c = 0; c < 3; c++) out[i+c] = Math.round((rgba[c]*s + out[i+c]*d*(1-s)) / a);
    out[i+3] = Math.round(a*255);
  }
  fillRect(x, y, w, h) {
    if (!(w > 0 && h > 0)) return;
    const m = this.matrix, pt = (x,y) => [m[0]*x+m[2]*y+m[4],m[1]*x+m[3]*y+m[5]];
    const points = [pt(x,y),pt(x+w,y),pt(x,y+h),pt(x+w,y+h)], xs = points.map(p=>p[0]), ys = points.map(p=>p[1]);
    const rgba = color(this.fillStyle);
    for (let yy = Math.max(0, Math.floor(Math.min(...ys))); yy < Math.min(this.canvas.height, Math.max(...ys)); yy++)
      for (let xx = Math.max(0, Math.floor(Math.min(...xs))); xx < Math.min(this.canvas.width, Math.max(...xs)); xx++) this.blend(xx, yy, rgba);
  }
  clearRect(x, y, w, h) {
    for (let yy = y; yy < y+h; yy++) for (let xx = x; xx < x+w; xx++) this.canvas.pixels.fill(0, (yy*this.canvas.width+xx)*4, (yy*this.canvas.width+xx)*4+4);
  }
  drawImage(image, x, y) {
    if (this.failDraw) throw Error('draw unavailable');
    this.draws.push({ image, x, y, state: this.state() });
    assert.equal(arguments.length, 3, 'light responses are native-size blits');
    const m = this.matrix;
    for (let yy = 0; yy < image.height; yy++) for (let xx = 0; xx < image.width; xx++) {
      const i = (yy*image.width+xx)*4;
      this.blend(Math.round(m[0]*(x+xx)+m[2]*(y+yy)+m[4]),Math.round(m[1]*(x+xx)+m[3]*(y+yy)+m[5]),[...image.pixels.slice(i,i+3),image.pixels[i+3]/255]);
    }
  }
  getImageData() {
    if (this.canvas.env.failRead) throw Error('readback unavailable');
    this.canvas.env.reads++; return { data: this.canvas.pixels.slice() };
  }
  createImageData(w, h) { return { data: new Uint8ClampedArray(w*h*4) }; }
  putImageData(image) { this.canvas.pixels.set(image.data); }
  isContextLost() { return !!this.lost; }
  beginPath() {} closePath() {} moveTo() {} lineTo() {} arc() {} ellipse() {} rect() {} fill() {} stroke() {} clip() {} fillText() {}
  measureText() { return { width: 0 }; }
  createLinearGradient() { return { addColorStop() {} }; }
}
function harness() {
  const env = { reads: 0, canvases: [] };
  const document = { createElement(tag) { assert.equal(tag, 'canvas'); const cv = new Canvas(env); env.canvases.push(cv); return cv; } };
  const context = vm.createContext({ module: { exports: {} }, document, console, U: { hash, shade: c => c } });
  vm.runInContext(source, context);
  const props = context.module.exports, target = new Canvas(env, 220, 180);
  props.setCtx(target.ctx); props.setNow(1400);
  return { props, target, env };
}
const f = extra => ({ t: 'crate', x: 5, y: 7, w: 2, h: 1, id: 'freight', ...extra });
const east = { color: [128,192,240], strength: .75, dx: 1, dy: 0 };

test('optional response paints inside the actual rigid prop without altering its draw or own hues', () => {
  const { props, target, env } = harness(), prop = f(), input = JSON.stringify(prop);
  props.draw(prop, false); const before = target.pixels.slice();
  const state = target.ctx.state();
  assert.equal(props.drawLightResponse(prop, east), true);
  assert.deepEqual(target.ctx.state(), state); assert.equal(JSON.stringify(prop), input);
  let changed = 0, maxDelta = 0;
  for (let i = 0; i < before.length; i += 4) {
    if (!before[i+3]) assert.equal(target.pixels[i+3], 0, 'response cannot grow art into empty pixels');
    assert.equal(target.pixels[i+3], before[i+3], 'overlay preserves actual native coverage');
    for (let c = 0; c < 3; c++) { const delta = Math.abs(target.pixels[i+c]-before[i+c]); if (delta) changed++; maxDelta = Math.max(maxDelta, delta); }
  }
  assert.ok(changed > 100, 'existing furniture visibly receives the supplied practical light');
  assert.ok(maxDelta <= 42, 'low-alpha treatment preserves authored local colour');
  assert.equal(env.reads, 1, 'one native-mask readback on a cold response');
  assert.equal(props.lightResponseStats().draws, 1);
});

test('direction changes the lit side and every bright edge stays one native pixel inside opaque casing', () => {
  const { props, target, env } = harness();
  props.drawLightResponse(f(), east); const right = target.ctx.draws.at(-1).image;
  const mask = env.canvases[0], alpha = mask.pixels, solid = (x,y) => x>=0&&y>=0&&x<mask.width&&y<mask.height&&alpha[(y*mask.width+x)*4+3]>=250;
  let bright = 0;
  for (let y = 0; y < right.height; y++) for (let x = 0; x < right.width; x++) {
    const a = right.pixels[(y*right.width+x)*4+3];
    if (!solid(x,y)) assert.equal(a, 0, 'translucent bloom/contact pixels receive no second halo');
    if (a > 32) { bright++; assert.equal(solid(x+1,y), false, 'bright rim is on the source-facing one-pixel edge'); }
    assert.ok(a <= 42, 'even the lit edge stays restrained');
  }
  assert.ok(bright > 0);
  props.drawLightResponse(f(), { ...east, dx: -1 }); const left = target.ctx.draws.at(-1).image;
  const energy = (cv, side) => {
    let sum = 0; for (let y=0;y<cv.height;y++) for (let x=0;x<cv.width;x++) if (side === (x >= cv.width/2)) {
      const i=(y*cv.width+x)*4; sum+=(cv.pixels[i]+cv.pixels[i+1]+cv.pixels[i+2])*cv.pixels[i+3];
    } return sum;
  };
  assert.ok(energy(right,true)>energy(left,true), 'east light brightens the east-facing furniture side');
  assert.ok(energy(left,false)>energy(right,false), 'west light brightens the west-facing furniture side');
});

test('quantized static responses reuse native overlays across instances, mount height and minor sample jitter', () => {
  const { props, target, env } = harness(); props.drawLightResponse(f(), east);
  const base = target.ctx.draws.at(-1), allocated = env.canvases.length;
  props.drawLightResponse(f({ x: -2, y: 4, mount: 'surface' }), { color: [130,190,241], strength: .76, dx: 1, dy: .01 });
  const mounted = target.ctx.draws.at(-1);
  assert.equal(mounted.image, base.image); assert.equal(env.canvases.length, allocated); assert.equal(env.reads, 1);
  assert.deepEqual([mounted.x,mounted.y], [-2*12-16,4*12-48-8], 'existing eight-pixel surface lift applied exactly once');
  assert.equal(mounted.state.imageSmoothingEnabled, false);
  assert.equal(props.lightResponseStats().hits, 1);
});

test('decals, dynamic silhouettes, missing samples and oversized footprints have zero response cost', () => {
  const { props, target, env } = harness();
  assert.equal(props.canLightResponse(f()), true);
  for (const t of ['rug','cablerun','hazardpad','outbox','bunk','holopet','unknown']) {
    assert.equal(props.canLightResponse(f({ t })), false, 'caller can skip sampling ' + t);
    assert.equal(props.drawLightResponse(f({ t }), east), false, t);
  }
  for (const light of [null, {}, { ...east, strength: 0 }, { ...east, strength: NaN }, { ...east, color: [NaN,2,3] }]) assert.equal(props.drawLightResponse(f(), light), false);
  for (const invalid of [{ w: 1000 }, { h: -1 }, { x: Infinity }, { w: 1.5 }]) assert.equal(props.drawLightResponse(f(invalid), east), false);
  assert.equal(env.canvases.length, 0); assert.equal(target.ctx.draws.length, 0); assert.equal(props.lightResponseStats().bytes, 0);
});

// Budget-agnostic (2026-10-20): one response per frame, past whatever maxEntries/maxPixels currently are. A frame never
// evicts what it already drew, so the old "130 draws in one frame" form stopped evicting once the budget grew.
test('entry and pixel budgets evict old responses while steady repeats remain cached', () => {
  const { props } = harness();
  const cap = props.lightResponseStats().maxEntries;
  for (let i=0;i<cap+34;i++) { props.setNow(1400+i); props.drawLightResponse(f(), { ...east, color: [(i%16)*16,(Math.floor(i/16)%16)*16,Math.floor(i/256)*16] }); }
  let stats = props.lightResponseStats(); assert.ok(stats.evictions > 0); assert.ok(stats.entries <= stats.maxEntries); assert.ok(stats.pixels <= stats.maxPixels);
  assert.equal(stats.bytes, stats.pixels*4); assert.ok(stats.bytes <= stats.maxBytes);
  for (let i=0;i<40;i++) { props.setNow(9000+i); props.drawLightResponse(f({ w: 30, h: 3 }), { ...east, color: [(i%16)*16,64,Math.floor(i/16)*16] }); }
  stats = props.lightResponseStats(); assert.ok(stats.pixels <= stats.maxPixels, 'large authored footprints obey the pixel budget too');
  const builds = stats.builds; props.drawLightResponse(f({ w: 30, h: 3 }), { ...east, color: [(39%16)*16,64,Math.floor(39/16)*16] });
  assert.equal(props.lightResponseStats().builds, builds);
  props.invalidateLightResponse(); stats = props.lightResponseStats(); assert.equal(stats.entries, 0); assert.equal(stats.bytes, 0);
});

// THE LRU CLIFF (2026-10-20): a frame's on-screen props are a cyclic working set. Past the old 96-entry / 256 Ki px LRU
// every lookup missed, every frame: 80 distinct responses cost 80 overlay builds AND 80 mask readbacks per frame.
test('a frame working set past the old budget is built once, then reused every frame with one mask readback', () => {
  const { props, target, env } = harness(); target.ctx.drawImage = () => {};   // the blit itself is covered above
  const N = 80, crates = Array.from({ length: N }, (_, i) => f({ x: 1 + (i % 10) * 3, y: 1 + Math.floor(i / 10) * 2, id: 'c' + i }));
  const light = i => ({ ...east, color: [(i%16)*16,(Math.floor(i/16)%16)*16,128] });
  const perFrame = [];
  for (let fr = 0; fr < 6; fr++) {
    props.setNow(1000 + fr * 16.7);
    const builds = props.lightResponseStats().builds, reads = env.reads;
    for (let i = 0; i < N; i++) assert.equal(props.drawLightResponse(crates[i], light(i)), true);
    perFrame.push([props.lightResponseStats().builds - builds, env.reads - reads]);
  }
  assert.ok(props.lightResponseStats().pixels > 262144, '(setup: this working set is past the old 256 Ki px budget)');
  assert.deepEqual(perFrame[0], [N, 1], 'a cold frame builds each response, reading the shared mask back once');
  assert.deepEqual(perFrame.slice(1), Array(5).fill([0, 0]), 'every later frame rebuilds nothing and reads nothing back');
  assert.equal(props.lightResponseStats().skipped, 0);
});

test('a working set past the budget skips the same overlays every frame instead of thrashing', () => {
  const { props, target, env } = harness(); target.ctx.drawImage = () => {};
  const bigs = [], big = i => bigs[i] || (bigs[i] = f({ w: 30, h: 3, id: 'big' + i }));   // one object per prop, as world.js draws
  const light = i => ({ ...east, color: [(i%16)*16,64,Math.floor(i/16)*16] });
  const frame = (fr, from, n) => {
    props.setNow(2000 + fr * 16.7);
    const s0 = props.lightResponseStats(), lit = [];
    for (let i = from; i < from + n; i++) lit.push(props.drawLightResponse(big(i), light(i)) ? 1 : 0);
    const s1 = props.lightResponseStats();
    return { builds: s1.builds - s0.builds, skipped: s1.skipped - s0.skipped, evictions: s1.evictions - s0.evictions, lit: lit.join('') };
  };
  const frames = [0, 1, 2, 3].map(fr => frame(fr, 0, 40));
  let stats = props.lightResponseStats();
  assert.ok(40 * stats.pixels / stats.entries > stats.maxPixels, '(setup: 40 of these overlays exceed the pixel budget)');
  assert.ok(frames[0].skipped > 0 && frames[0].builds === stats.entries, 'past the budget the newcomers go without an overlay');
  for (const later of frames.slice(1)) {
    assert.equal(later.builds, 0, 'a steady frame rebuilds nothing');
    assert.equal(later.evictions, 0, 'and evicts nothing it drew');
    assert.equal(later.lit, frames[0].lit, 'the same props skip on every frame: nothing flickers');
  }
  assert.ok(stats.pixels <= stats.maxPixels); assert.equal(env.reads, 1, 'one readback for the shared mask, ever');
  // The view jumped: twenty new responses, none of the old ones on screen. The old ones were drawn LAST frame, so this
  // frame cannot tell them from props still on screen and drawn later: the newcomers wait one frame, then replace them.
  const jumped = frame(4, 100, 20), moved = frame(5, 100, 20);
  assert.deepEqual([jumped.builds, jumped.evictions, jumped.skipped], [0, 0, 20], 'a frame never evicts what the frame before drew');
  assert.deepEqual([moved.builds, moved.skipped, moved.lit], [20, 0, '1'.repeat(20)], 'what left the screen is evicted for what arrived');
  stats = props.lightResponseStats(); assert.ok(stats.pixels <= stats.maxPixels);
});

// THE PAN CASCADE (2026-10-20, review round 3). world.js draws y-sorted, so a pan brings newcomers in AHEAD of props that
// stay on screen. Evicting "not drawn yet this frame" then evicted a prop still on screen, which missed and evicted the
// next: every pan frame rebuilt the whole cache (275 overlays of these crates), and lit props went dark and back.
// Builds per frame must be bounded by what the camera reveals; a prop lit on screen stays lit.
test('a camera moving over a working set past the budget builds only what it reveals, and nothing on screen goes dark', () => {
  const { props, target, env } = harness(); target.ctx.drawImage = () => {};
  const N = 48, COLS = 20, ROWS = 15, crates = [];   // 20 x 15 = 300 visible 2x1 crates, each its own light; 275 fit
  for (let r = 0; r < N; r++) for (let c = 0; c < N; c++) crates.push({ prop: f({ x: 1 + c * 3, y: 1 + r * 2, id: 'g' + r + '_' + c }), c, r,
    light: { ...east, color: [(c % 16) * 16, (r % 16) * 16, ((c >> 4) * 3 + (r >> 4)) * 16] } });
  const view = (cx, cy) => crates.filter(p => p.c + 1 > cx && p.c < cx + COLS && p.r + 1 > cy && p.r < cy + ROWS)
    .sort((a, b) => a.prop.y - b.prop.y || a.prop.x - b.prop.x);   // world.js order: y ascending
  const path = [], hold = (n, x, y) => { for (let k = 0; k < n; k++) path.push(['still', x, y]); };
  hold(4, 10, 20);
  for (let k = 1; k <= 24; k++) path.push(['pan up (newcomers drawn first)', 10, 20 - k * .5]);
  for (let k = 1; k <= 20; k++) path.push(['pan left', 10 - k * .4, 8]);
  for (let k = 1; k <= 24; k++) path.push(['pan down-right', 2 + k * .5, 8 + k * .5]);
  for (let k = 1; k <= 40; k++) path.push(['cinecam circle', 9 + 5 * Math.cos(k / 6), 20 + 5 * Math.sin(k / 6)]);
  hold(4, 9 + 5 * Math.cos(40 / 6), 20 + 5 * Math.sin(40 / 6));
  let t = 3000, older = new Set(), last = new Set(), lit = new Map();
  const left = (a, b) => [...a].filter(p => !b.has(p)).length;
  path.forEach(([name, cx, cy], k) => {
    props.setNow(t += 16.7);
    const s0 = props.lightResponseStats(), reads = env.reads, shown = view(cx, cy), now = new Set(shown), nowLit = new Map();
    for (const p of shown) nowLit.set(p, props.drawLightResponse(p.prop, p.light));
    const builds = props.lightResponseStats().builds - s0.builds;
    const churn = left(now, last) + left(last, now) + left(last, older) + left(older, last);   // entered or left, in two frames
    if (k) {   // (the cold frame fills the budget)
      assert.ok(builds <= churn, name + ' (frame ' + k + '): ' + builds + ' builds while ' + churn + ' crates entered or left the view in two frames');
      assert.equal(env.reads, reads, name + ': no readback once the mask is known');
      for (const p of shown) assert.ok(!(lit.get(p) && !nowLit.get(p)), name + ' (frame ' + k + '): a lit crate still on screen went dark');
    }
    older = last; last = now; lit = nowLit;
  });
  const stats = props.lightResponseStats();
  assert.ok(stats.skipped > 0 && stats.evictions > 0, '(setup: the view is past the budget, and the moves evict)');
  assert.ok(stats.pixels <= stats.maxPixels && stats.entries <= stats.maxEntries);
});

test('a newcomer drawn ahead of cached responses past the budget evicts nothing still on screen', () => {
  for (const thumbnails of [false, true]) {   // build.js thumbnails call setNow(0) between (and inside) world frames
    const { props, target } = harness(); target.ctx.drawImage = () => {};
    const bigs = [], big = i => bigs[i] || (bigs[i] = f({ w: 30, h: 3, id: 'big' + i })), light = i => ({ ...east, color: [(i%16)*16,64,Math.floor(i/16)*16] });
    const frame = (fr, order) => {
      if (thumbnails) props.setNow(0);
      props.setNow(5000 + fr * 16.7);
      const s0 = props.lightResponseStats(), lit = [];
      order.forEach((i, n) => {
        if (thumbnails && n === 20) { props.setNow(0); props.setNow(5000 + fr * 16.7); }
        lit.push(props.drawLightResponse(big(i), light(i)) ? 1 : 0);
      });
      const s1 = props.lightResponseStats();
      return { builds: s1.builds - s0.builds, evictions: s1.evictions - s0.evictions, lit: lit.join('') };
    };
    const base = Array.from({ length: 40 }, (_, i) => i), first = frame(0, base), steady = frame(1, base);
    assert.equal(steady.builds, 0);
    for (let fr = 2; fr < 7; fr++) {
      const r = frame(fr, [100, ...base]);   // one new response, drawn before the forty that stay on screen
      assert.deepEqual([r.builds, r.evictions], [0, 0], 'thumbnails ' + thumbnails + ' frame ' + fr + ': nothing on screen is evicted or rebuilt');
      assert.equal(r.lit.slice(1), first.lit, 'the forty keep exactly the overlays they had');
    }
  }
});

test('a light key that flips frame to frame keeps its prop lit past the budget, for at most one build a frame', () => {
  const setup = () => {
    const { props, target } = harness(); target.ctx.drawImage = () => {};
    const bigs = [], big = i => bigs[i] || (bigs[i] = f({ w: 30, h: 3, id: 'big' + i }));   // one object per prop
    const light = i => ({ ...east, color: [(i%16)*16,128,Math.floor(i/16)*16] });
    // two props of interest first (in the given order), then 38 others: 40 distinct responses, 29 fit
    const frame = (k, first) => { props.setNow(7000 + k * 16.7); const s0 = props.lightResponseStats();
      const lit = [...first, ...Array.from({ length: 38 }, (_, i) => [i + 10, light(i + 10)])].map(([i, l]) => props.drawLightResponse(big(i), l));
      const s1 = props.lightResponseStats(); return { lit, builds: s1.builds - s0.builds, skipped: s1.skipped - s0.skipped, held: s1.held - s0.held }; };
    return { frame, light };
  };
  const edge = k => ({ ...east, color: [0,64,0], strength: k % 2 ? .625 : .75 });   // a screen's flicker on a quantization edge
  const scenarios = {
    'its own key': (k, light) => [[0, edge(k)], [1, light(1)]],
    'key shared with a steady prop drawn after it': k => [[0, edge(k)], [1, edge(0)]],
    'key shared with a steady prop drawn before it': k => [[1, edge(0)], [0, edge(k)]],
    'two props flipping together': k => [[0, edge(k)], [1, edge(k)]],
  };
  for (const [name, first] of Object.entries(scenarios)) {
    const { frame, light } = setup();
    for (let k = 0; k < 12; k++) {
      const r = frame(k, first(k, light));
      if (!k) continue;   // (the cold frame fills the budget)
      assert.ok(r.skipped > 0, '(setup: past the budget)');
      assert.deepEqual(r.lit.slice(0, 2), [true, true], name + ' (frame ' + k + '): both props stay lit');
      assert.ok(r.builds <= 1, name + ' (frame ' + k + '): ' + r.builds + ' builds');
    }
  }
  // Holding the overlay a prop already shows indefinitely is for a light on a quantization edge only. A shared light
  // that really changes shows its old colour for one frame at most (round 4: the frame it cannot yet tell whether the
  // props it shares with changed too), then the prop goes without until there is room.
  const { frame, light } = setup(), red = { ...east, color: [240,0,0] };
  frame(0, [[0, light(0)], [1, light(0)]]); frame(1, [[0, light(0)], [1, light(0)]]);
  const changed = frame(2, [[0, red], [1, light(0)]]), after = [3, 4, 5].map(k => frame(k, [[0, red], [1, light(0)]]));
  assert.deepEqual([changed.lit.slice(0, 2), changed.held], [[true, true], 0], 'the changed prop keeps its old overlay one frame');
  for (const r of after) assert.deepEqual([r.lit.slice(0, 2), r.held], [[false, true], 0], 'then it skips; the steady one keeps its overlay');
});

/* WORLD.JS'S OWN CALL PATH (2026-10-20, review round 4). world.js's drawLitProp, renderStill and renderStillOfTiles run
   here as written, around a stand-in for drawScene that does what drawScene does for a prop: setNow(now), then
   drawLitProp of the copy world.js makes for a table-top or stacked prop (`Object.assign({}, p, { mount })`, a new
   object every frame). Only the prop's own art draw is stubbed (the light response does not read it). */
const { fnBody } = require('./_assert');
function worldHarness() {
  const h = harness(), world = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
  let W = null;
  class StillCanvas extends Canvas { reset() { super.reset(); this.ctx.drawImage = image => { W.shown = image; }; } }
  h.target.ctx.drawImage = image => { W.shown = image; };
  W = vm.createContext({
    PropSprites: Object.assign({}, h.props, { draw() {} }), T: 12, console,
    sceneRenderer: { sampleLight: () => W.light },
    document: { createElement: tag => { assert.equal(tag, 'canvas'); return new StillCanvas(h.env); } },
    performance: { now: () => W.clock },
    scene: [], out: [], shown: null, light: null, clock: 90000,
    // renderStill's world: a station that has drawn, nothing playing over it
    station: {}, geo: { origin: { tx: 0, ty: 0 } }, geoDirty: false, bakeDirty: false, cache: { baseCv: { width: 300, height: 200 } },
    cv: h.target, ctx: h.target.ctx, scale: 2, panX: 0, panY: 0, overlaysOn: true, camAnim: null, kindleArmed: false,
    arrivalScene: null, wakeDark: 0, agent: null, crew: [], StationBake: { WALL: { up: 24 } },
    buildHoldsFloor: () => false, rederive() {}, rebake() {}, bodyPosX: () => 0, bodyPosY: () => 0,
  });
  const fns = ['drawLitProp', 'renderStill', 'renderStillOfTiles'].map(n => fnBody(world, 'function ' + n + '('));
  for (const body of fns) assert.ok(body.length > 40 && body.length < 9000, '(world.js function found)');
  vm.runInContext('var stillPass = null;\n' + fns.join('\n') + `
    function drawScene(now) {
      PropSprites.setCtx(ctx); PropSprites.setNow(now); out = [];
      for (const [p, l] of scene) { light = l; shown = null; drawLitProp(p.mount ? Object.assign({}, p, { mount: p.mount }) : p, false); out.push(shown); }
    }`, W);
  // one live frame of the stage: the frame loop's drawScene(now) on the live canvas; returns the overlay each prop showed
  const live = (now, scene) => { W.scene = scene; W.ctx = h.target.ctx; W.drawScene(now); return W.out; };
  return Object.assign(h, { W, live });
}
const surface = (id, extra) => ({ t: 'crate', x: 5, y: 7, w: 30, h: 3, id, mount: 'surface', ...extra });

test('table-top props handed over as a fresh object every frame never flicker past the budget, over 60 frames', () => {
  const { props, live } = worldHarness();
  const edge = (k, color) => ({ ...east, color, strength: k % 2 ? .625 : .75 });   // a screen's flicker on a quantization edge
  const L = { ...east, color: [240,0,0] }, M = { ...east, color: [0,0,240] };   // a shared light that really changes
  const filler = i => ({ ...east, color: [(i%16)*16,128,Math.floor(i/16)*16] });
  const scene = k => [
    [surface('solo'), edge(k, [0,64,0])],                                   // its own key, flipping every frame
    [surface('pairA'), edge(k, [0,64,64])], [surface('pairB'), edge(k, [0,64,64])],   // two flipping together
    [surface('steady'), edge(0, [64,0,64])], [surface('rider'), edge(k, [64,0,64])],   // flips on a key a steady prop shares
    ...['g0', 'g1', 'g2'].map(id => [surface(id), k < 30 ? L : M]),         // three sharing one overlay; its light changes at 30
    ...Array.from({ length: 36 }, (_, i) => [surface('fill' + i), filler(i)]),   // a working set past the budget
  ];
  const ids = scene(0).map(([p]) => p.id), shows = ids.map(() => []);
  let builds = [];
  for (let k = 0; k < 60; k++) {
    const b0 = props.lightResponseStats().builds;
    live(10000 + k * 16.7, scene(k)).forEach((image, i) => shows[i].push(image));
    builds.push(props.lightResponseStats().builds - b0);
  }
  const stats = props.lightResponseStats(), at = id => shows[ids.indexOf(id)];
  assert.ok(stats.skipped > 0 && 44 * stats.pixels / stats.entries > stats.maxPixels, '(setup: past the budget)');
  for (const id of ['solo', 'pairA', 'pairB', 'steady', 'rider', 'g0', 'g1', 'g2'])
    at(id).forEach((image, k) => assert.ok(image, id + ' (frame ' + k + '): an overlay every frame'));
  for (const id of ['steady', 'pairA', 'pairB', 'rider'])
    assert.ok(at(id).every(image => image === at(id)[0]), id + ': the identical overlay every frame (a quantum edge holds)');
  for (const id of ['g0', 'g1', 'g2']) {
    const g = at(id);
    assert.ok(g.slice(0, 31).every(image => image === g[0]), id + ': the old overlay until the change, and for one frame after it');
    assert.ok(g[31] !== g[0] && g.slice(31).every(image => image === g[31]), id + ': the new light from the next frame on, steady');
  }
  assert.ok(at('g0')[31] === at('g1')[31] && at('g1')[31] === at('g2')[31], 'the group shares the one new overlay');
  for (let i = 0; i < 36; i++) {
    const s = at('fill' + i).slice(1);
    assert.ok(s.every(image => image === s[0]), 'fill' + i + ': the same overlay (or none) on every frame after the cold one');
  }
  assert.ok(builds.slice(1).every((n, k) => n <= (k + 1 === 31 ? 2 : 1)), 'builds per frame: ' + builds.join(','));
});

test('a still drawn between live frames (renderStill, renderStillOfTiles) never ages the live cache', () => {
  for (const which of ['renderStill', 'renderStillOfTiles']) {
    const { props, W, live, target } = worldHarness();
    const solo = k => ({ ...east, color: [0,64,0], strength: k % 2 ? .625 : .75 }), light = i => ({ ...east, color: [(i%16)*16,64,Math.floor(i/16)*16] });
    const stage = (k, extra) => [...(extra || []), [surface('solo'), solo(k)], ...Array.from({ length: 40 }, (_, i) => [surface('big' + i), light(i)])];
    let last = null;
    for (let k = 0; k < 4; k++) last = live(20000 + k * 16.7, stage(k));
    const before = props.lightResponseStats();
    // the phone's picture (or a builder's LOOK at one room): its own clock, its own canvas, a part of the station
    W.clock = 20100; W.scene = stage(4).slice(20);
    const still = which === 'renderStill' ? W.renderStill(320) : W.renderStillOfTiles({ x1: 2, y1: 2, x2: 8, y2: 6 }, 320);
    assert.ok(still && still.canvas, which + ': a still was drawn');
    assert.ok(W.out.length === 21 && W.out.every(Boolean), which + ': a still shows every overlay, past the budget too');
    const after = props.lightResponseStats();
    assert.deepEqual([after.entries, after.pixels, after.evictions, after.skipped, after.builds], [before.entries, before.pixels, before.evictions, before.skipped, before.builds],
      which + ': the still leaves the live cache as it was');
    assert.ok(after.stillBuilds - before.stillBuilds > 0 && after.stillBuilds - before.stillBuilds <= 21, which + ': what the cache lacks is built for the still alone');
    assert.equal(W.ctx, target.ctx, '(renderStill restored the stage canvas)');
    // the next live frames: a newcomer drawn first, then the stage as it was; the solo prop's light keeps flipping
    for (let k = 4; k < 8; k++) {
      const s0 = props.lightResponseStats(), shown = live(20000 + k * 16.7, stage(k, [[surface('newcomer'), { ...east, color: [240,240,240] }]]));
      const s1 = props.lightResponseStats();
      assert.ok(shown[1], which + ' frame ' + k + ': the flipping prop stays lit after the still');
      assert.ok(s1.builds - s0.builds <= 1 && s1.evictions - s0.evictions <= 1, which + ' frame ' + k + ': only the flipping prop rebuilds (' +
        (s1.builds - s0.builds) + ' builds, ' + (s1.evictions - s0.evictions) + ' evictions)');
      shown.slice(2).forEach((image, i) => assert.equal(image, last[i + 1], which + ' frame ' + k + ': big' + i + ' keeps the overlay it had (or none)'));
    }
  }
});

test('lost overlay and native mask contexts are rebuilt, and lost main context skips safely', () => {
  const { props, target, env } = harness(); props.drawLightResponse(f(), east);
  const first = target.ctx.draws.at(-1).image; first.lose();
  assert.equal(props.lightResponseStats().entries, 0); assert.equal(props.lightResponseStats().bytes, 0);
  assert.equal(props.drawLightResponse(f(), east), true); assert.notEqual(target.ctx.draws.at(-1).image, first);
  const second = target.ctx.draws.at(-1).image, mask = env.canvases[0]; mask.lose(false);
  assert.equal(props.drawLightResponse(f(), east), true); assert.notEqual(target.ctx.draws.at(-1).image, second);
  const builds = props.lightResponseStats().builds; target.lose();
  assert.equal(props.drawLightResponse(f(), east), false); assert.equal(props.lightResponseStats().builds, builds);
});

test('optional readback/blit failure never poisons the authoritative prop context or later draws', () => {
  const { props, target, env } = harness();
  const before = target.ctx.state(); env.failRead = true;
  assert.equal(props.drawLightResponse(f(), east), false); assert.deepEqual(target.ctx.state(), before);
  env.failRead = false; assert.equal(props.drawLightResponse(f(), east), true);
  target.ctx.failDraw = true; assert.equal(props.drawLightResponse(f(), east), false); assert.deepEqual(target.ctx.state(), before);
  target.ctx.failDraw = false; assert.doesNotThrow(() => props.draw(f(), true, { heat: .6, prog: .2 }));
  assert.equal(props.lightResponseStats().failures, 2);
});

test('cached silhouette lighting leaves real workstation heat and progress content live on every draw', () => {
  const { props, env } = harness(), desk = f({ t: 'desk' });
  const frame = (time, heat, prog) => {
    const cv = new Canvas(env, 220, 180); props.setCtx(cv.ctx); props.setNow(time);
    props.draw(desk, true, { heat, prog });
    assert.equal(props.drawLightResponse(desk, east), true);
    return cv;
  };
  const first = frame(400, .2, .25), builds = props.lightResponseStats().builds;
  const second = frame(1200, .8, .75);
  assert.equal(props.lightResponseStats().builds, builds, 'light cache does not become an animated-art cache');
  assert.notDeepEqual(first.pixels, second.pixels, 'real heat/progress still repaint the canonical desk');
  const i = ((desk.y*12-5)*second.width + desk.x*12+10)*4;
  assert.ok(second.pixels[i+1] > first.pixels[i+1], 'the newly published progress strip remains visibly current');
});
