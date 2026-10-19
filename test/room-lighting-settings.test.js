'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const src = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');
const start = src.indexOf('  // ROOM LIGHT is a 0–100 slider');
const end = src.indexOf('  // TEXT SIZE steps', start);
assert.ok(start >= 0 && end > start);
const bake = require('../frontend/app/stationbake.js');
const original = { ...bake.LIGHT };
// The live renderer's knobs: IndustrialTextures.lighting (pool cut + KEY light) and World.crt.film.
const tex = { cut: 1, key: 0, keyReach: .5, shadeCool: 0 };
const texOriginal = { ...tex };
let rebakes = 0;
const timers = [];
const fakeTimeout = (fn, ms) => { const t = { fn, ms, live: true }; timers.push(t); return t; };
const fakeClear = t => { if (t) t.live = false; };
const flush = () => { for (const t of timers.splice(0)) if (t.live) t.fn(); };
const world = { crt: { film: .38, scan: .1 }, rebake() { rebakes++; } };
const build = (w, t) => new Function('StationBake', 'World', 'IndustrialTextures', 'setTimeout', 'clearTimeout', src.slice(start, end) +
  '\nreturn { resolve: resolveRoomLighting, knobs: roomLightingKnobs, apply: applyRoomLighting, commit: commitRoomLighting };')(bake, w, t, fakeTimeout, fakeClear);
const api = build(world, { lighting: tex });

// 0 (and anything unreadable) is the approved station, byte for byte.
for (const value of [undefined, null, '', 'future-mode', {}, NaN, 0, '0', 'low', -40]) {
  assert.equal(api.resolve(value), 0, String(value));
  api.apply(value);
  assert.deepEqual(bake.LIGHT, original, 'old, invalid or zero settings retain the approved look');
  assert.deepEqual(tex, texOriginal);
  assert.equal(world.crt.film, .38);
}
assert.equal(rebakes, 0, 'unrelated settings do not trigger unnecessary rebakes');
// Old chip saves keep a sensible place on the slider; numbers clamp and round.
assert.equal(api.resolve('medium'), 15);
assert.equal(api.resolve('high'), 30);
assert.equal(api.resolve(250), 100);
assert.equal(api.resolve('42.6'), 43);

// 10-10 player report: the old HIGH changed only LIGHT.ambient and measured +3% on screen. Every stage
// that sets on-screen room brightness must move as the slider rises: a thinner deck film, a wider
// pool cut, more KEY light, and a lighter CRT density film.
let prev = { ambient: original.ambient, cut: tex.cut, key: tex.key, film: world.crt.film };
for (const level of [25, 50, 75, 100]) {
  api.apply(level);
  assert.ok(bake.LIGHT.ambient < prev.ambient, level + ': thinner deck film');
  assert.ok(tex.cut > prev.cut, level + ': pools open further');
  assert.ok(tex.key > prev.key, level + ': key light puts light on surfaces');
  assert.ok(world.crt.film < prev.film, level + ': lighter density film');
  prev = { ambient: bake.LIGHT.ambient, cut: tex.cut, key: tex.key, film: world.crt.film };
  assert.deepEqual({ ...bake.LIGHT, ambient: original.ambient }, original,
    'fixture layout, falloff, warmth and glow remain unchanged');
  assert.deepEqual({ ...tex, cut: 1, key: 0 }, texOriginal, 'only cut and key move');
  assert.equal(world.crt.scan, .1, 'only the film moves on the CRT');
  const count = rebakes;
  api.apply(level);
  assert.equal(rebakes, count, 'the same value does not rebake again');
}
assert.equal(rebakes, 4, 'every committed change reaches the renderer');
assert.deepEqual(api.knobs(100), { ambient: 0.3, cut: 2.4, key: 2, film: 0.26 }, '100 is the brightest tuned look');

// A DRAG never rebakes: World.rebake is a full StationBake (~2.5 s frozen on a big station), so even a pause
// mid-drag must not pay it. Film and ambient move at once; the release pays the one rebake the drag owed
// (review finding world-render-07).
rebakes = 0;
for (let v = 99; v >= 60; v--) api.apply(v, true);
assert.equal(rebakes, 0, 'no rebake during the drag');
assert.equal(bake.LIGHT.ambient, api.knobs(60).ambient, 'ambient follows the drag live');
assert.equal(world.crt.film, +(0.38 * api.knobs(60).film).toFixed(4), 'film follows the drag live');
assert.equal(timers.filter(t => t.live).length, 0, 'a drag arms no rebake timer');
flush();
assert.equal(rebakes, 0, 'a pause mid-drag does not rebake');
api.apply(55, true);
api.apply(55);   // release lands the owed rebake now
assert.equal(rebakes, 1, 'the release rebakes exactly once');
api.apply(55);
assert.equal(rebakes, 1, 'nothing is owed after the release');
// The slider's change event fires on every arrow-key step: a burst commits once, 150 ms after the last step.
for (const v of [54, 53, 52]) { api.apply(v, true); api.commit(() => v); }
assert.equal(rebakes, 1, 'a commit waits for the burst to end');
assert.deepEqual(timers.filter(t => t.live).map(t => t.ms), [150], 'one commit is queued for the burst');
flush();
assert.equal(rebakes, 2, 'one rebake for the whole burst');
assert.equal(bake.LIGHT.ambient, api.knobs(52).ambient, 'the burst lands its last value');
// A direct apply (chat control, a restored backup) supersedes a queued commit: no older value lands later.
api.apply(51, true); api.commit(() => 51); api.apply(70);
assert.equal(rebakes, 3);
flush();
assert.equal(rebakes, 3, 'the superseded commit does not rebake again');
assert.equal(bake.LIGHT.ambient, api.knobs(70).ambient, 'the newest value stays');
// A drag that ends on the value it started from fires no change event and owes no bake: the station is already
// baked with those knobs. The next unrelated applySettings (a hue tick, a theme chip, setLook from chat) applies
// the same level and must not pay a full StationBake for it.
for (const v of [80, 75, 70]) api.apply(v, true);
api.apply(70);
assert.equal(rebakes, 3, 'a drag back to the baked value leaves no rebake owed');
api.apply(72, true); api.apply(72);
assert.equal(rebakes, 4, 'a drag that moved still pays its one rebake');

api.apply(0);
assert.deepEqual(bake.LIGHT, original, '0 restores the exact approved light controls');
assert.deepEqual(tex, texOriginal, '0 restores the approved pool cut and key');
assert.equal(world.crt.film, .38, '0 restores the approved film');
// The classic world has no film and no IndustrialTextures: brightening must not invent either.
const classic = { crt: { film: 0 }, rebake() {} };
const capi = build(classic, undefined);
capi.apply(100);
assert.equal(classic.crt.film, 0);
capi.apply(0);
assert.equal(bake.LIGHT.ambient, original.ambient);

// Review finding world-render-08: a 0.13.2 save holding 'high' must read back as the level the station applies
// (30), so lookNow / setLook's `now` never report a chip value next to the '0-100' options.
{
  const loadStart = src.indexOf('  function defaults() {'), loadEnd = src.indexOf('  let store = load();');
  assert.ok(loadStart >= 0 && loadEnd > loadStart);
  const saved = { 'starnet.station.v1': JSON.stringify({ v: 1, settings: { roomLighting: 'high', theme: 'amber' } }) };
  const localStorage = { getItem: k => (k in saved ? saved[k] : null) };
  const loadSettings = new Function('localStorage', 'KEY', 'window', src.slice(loadStart, loadEnd) + '\nreturn load;')(localStorage, 'starnet.station.v1', {});
  assert.equal(loadSettings().settings.roomLighting, 30, 'a legacy HIGH save loads as its 0-100 level');
  saved['starnet.station.v1'] = JSON.stringify({ v: 1, settings: { roomLighting: 'medium' } });
  assert.equal(loadSettings().settings.roomLighting, 15, 'a legacy MEDIUM save loads as 15');
  saved['starnet.station.v1'] = JSON.stringify({ v: 1, settings: { roomLighting: 64 } });
  assert.equal(loadSettings().settings.roomLighting, 64, 'a numeric save is kept');
  // A restored backup from before the slider carries the same strings into the live store.
  assert.match(src, /Object\.assign\(store\.settings, b\.settings\); store\.settings\.roomLighting = resolveRoomLighting\(store\.settings\.roomLighting\);/,
    'a restored backup converts a legacy room light value too');
}

assert.match(src, /roomLighting: 0, textScale/, 'default is the approved station');
assert.match(src, /applyRoomLighting\(s\.roomLighting\);\n/, 'applySettings applies the saved level');
assert.match(src, /roomLighting: resolveRoomLighting\(store\.settings\.roomLighting\)/, 'backup includes lighting');
assert.match(src, /id="set-room-light"[^>]*min="0" max="100"/, 'Settings shows the 0–100 slider');
assert.match(src, /applyRoomLighting\(s\.roomLighting, true\)/, 'dragging applies live');
assert.match(src, /commitRoomLighting\(\(\) => store\.settings\.roomLighting\); save\(\)/, 'release commits the current value and persists');
assert.match(src, /else if \(k === 'roomLighting'\) num\(k, 0, 100\)/, 'chat control takes the same 0–100 range');
assert.equal(src, fs.readFileSync(path.join(__dirname, '../website/app/app/stationui.js'), 'utf8'));
console.log('room-lighting-settings: 0–100 slider drives film/cut/key/CRT film, drag debounce, legacy saves, classic and mirror passed');
