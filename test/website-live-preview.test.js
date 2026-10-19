/* The homepage "watch it work" console (2026-10-19) plays RECORDINGS of the real renderer. Each chapter in
   website/station-chapters.js is played once through the real app (website/app booted from the crew save in
   demo-boot.js) by scripts/record-station-demo.mjs, which emits the harness's own bus events through
   demo-boot's StarnetDemoBridge and records the station canvas. The page plays the clip and prints the same
   chapter's trace on the video clock. These pins keep four promises: the room is still the product's own
   starter, every chapter has its clip, the recorder drives the app only through the bridge, and the page
   says it is a replay. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const js = read('website', 'station-demo.js');
const chapters = read('website', 'station-chapters.js');
const recorder = read('scripts', 'record-station-demo.mjs');
const css = read('website', 'home.css');
const html = read('website', 'index.html');
const demo = read('website', 'app', 'demo-boot.js');

// ---- the page: a recorded clip, never the whole app ----
A.ok(/<video id="crew-video" muted playsinline preload="auto" poster="assets\/station\/delegate\.jpg/.test(html),
  'the console is a muted inline video with the first chapter poster');
A.eq(/<iframe[^>]*crew-app|app\/embed\.htm/.test(html), false, 'the homepage no longer boots the whole app in an iframe');
A.ok(/station-chapters\.js\?v=\d+"><\/script>\s*<script src="station-demo\.js\?v=\d+">/.test(html), 'the chapter data loads before the player');
A.eq(/live-preview\.js/.test(html), false, 'the retired starter-preview crop script is gone');
A.eq(/sch-flow|cp-crew|data-term=/.test(html), false, 'the retired SVG capability schematics are gone (the replay chapters replace them)');
A.ok(/Recorded from the actual StarNet renderer/.test(html) && /scripted replay/i.test(html) && /no model is running on this page/.test(html),
  'the console says plainly that it is a recording of a scripted replay and no model runs');
A.ok(/id="station"/.test(html), 'the generator-owned PRODUCT nav link (#station) still lands on the console');
A.ok(/\.stage-clip video\{/.test(css) && /aspect-ratio:890 \/ 702/.test(css), 'the clip fills the room window at the recorded aspect');

// ---- every chapter has its clip and poster ----
const g = {}; vm.runInNewContext(chapters, { window: g });
const C = g.StarnetChapters;
A.eq(C.ORDER, ['delegate', 'flow', 'tools', 'away', 'ledger'], 'five chapters, in tab order');
for (const key of C.ORDER) {
  const mp4 = path.join(ROOT, 'website', 'assets', 'station', key + '.mp4');
  A.ok(fs.existsSync(mp4) && fs.statSync(mp4).size < 4 * 1024 * 1024, key + ' has a recorded clip under 4 MB');
  A.ok(fs.existsSync(path.join(ROOT, 'website', 'assets', 'station', key + '.jpg')), key + ' has a poster frame');
  A.ok(fs.existsSync(path.join(ROOT, 'website', 'assets', 'station', key + '.webm')), key + ' has a VP9 twin for browsers without H.264');
  A.ok(html.includes('data-chapter="' + key + '"'), key + ' has a tab');
}

// ---- the player follows the video clock; the recorder drives the app through the bridge only ----
A.ok(/video\.currentTime \* 1000 - C\.LEAD_MS/.test(js), 'trace lines are printed on the video clock');
A.ok(/IntersectionObserver/.test(js) && /visibilitychange/.test(js), 'the clip pauses off screen and in hidden tabs');
for (const ev of ['workitem.placed', 'agent.run.start', 'agent.run.end', 'agent.tool_call', 'agent.tool_result', 'shell.exec', 'verify.result', 'agent.token'])
  A.ok(chapters.includes("'" + ev + "'"), 'a recording drives the renderer with the real ' + ev + ' event');
A.ok(/StarnetDemoBridge\.emit\(n, p\)/.test(recorder) && /StarnetChapters\.perform\(/.test(recorder),
  'the recorder plays the shared chapter script through the embed bridge');
A.ok(/captureStream\(30\)/.test(recorder) && /crop=\$\{CROP\.w\}:\$\{CROP\.h\}/.test(recorder), 'the recorder captures the station canvas and crops it to the room');

// ---- demo-boot: starter room + crew, bridge is emit-only ----
A.ok(/function scopeTextures\(\)/.test(demo) && /ROOM_PROPS = \/\^\(desk\|war_intelcab\|gigs_servercart\|comms_dish\|workbench\|studio\|plant\|intake\|bay\|outbox\)/.test(demo),
  'the embed downloads only the textures this room draws (the full catalogue was ~240 MB)');
A.ok(/World\.setFrameCap\(1000 \/ 30\)/.test(demo),
  'the embed caps its own draw rate: an iframe is never focused, so the 5 fps blur pace would otherwise apply');
A.ok(/window\.StarnetDemoBridge = \{\s*crew: function\(\)[\s\S]*?emit: function\(name, payload\)\{ U\.bus\.emit\(name, payload\); \}\s*\};/.test(demo),
  'the bridge exposes exactly a crew count and an emit onto the app bus');

function bootDemo(initial) {
  const rows = Object.assign({}, initial || {});
  const localStorage = {
    getItem: (key) => Object.prototype.hasOwnProperty.call(rows, key) ? rows[key] : null,
    setItem: (key, value) => { rows[key] = String(value); }
  };
  vm.runInNewContext(demo, { window: {}, localStorage, setInterval: () => 1, clearInterval: () => {}, console });
  return rows;
}

const upgraded = bootDemo({ 'starnet.save': '{"retired":"station"}' });
const save = JSON.parse(upgraded['starnet.save']);
const starter = require('../frontend/app/worldmodel.js').starterDoc();
starter.meta.createdAt = 0;
const starterRevision = 'starter-' + require('crypto').createHash('sha256').update(JSON.stringify(starter)).digest('hex').slice(0, 16);

A.eq(save.station.rooms, starter.rooms, 'the room and its materials come from the current product starter factory');
for (const p of starter.props) {
  const got = save.station.props.find(q => q.id === p.id);
  A.ok(got && got.t === p.t && got.x === p.x && got.y === p.y, 'starter prop ' + p.id + ' (' + p.t + ') is kept in place');
}
const ids = new Set(save.station.props.map(p => p.id));
A.eq(ids.size, save.station.props.length, 'the crew scene adds props without colliding with starter ids');
A.ok(save.station._nid > Math.max(...save.station.props.map(p => Number(String(p.id).slice(1)) || 0)), 'the next prop id stays ahead of every placed prop');

const crew = (save.agents || []).map(a => a.id).sort();
A.eq(crew, ['forge', 'quill', 'scout'], 'the scene seeds the three crew agents the replay drives');
for (const id of crew) {
  const desk = save.station.props.find(p => p.t === 'desk' && p.agentId === id);
  A.ok(desk, id + ' has its own desk, so its bay has compute (no NO COMPUTE nag)');
}
const bays = save.station.props.filter(p => p.t === 'bay').map(p => p.agentId).sort();
A.eq(bays, ['quill', 'scout'], 'the conveyor line has SCOUT and QUILL bays');
A.ok(save.station.props.some(p => p.t === 'intake') && save.station.props.some(p => p.t === 'outbox'), 'the line has an INBOX and an OUTBOX');
A.ok(Object.keys(save.station.belts).length >= 10, 'one belt runs the length of the floor');
A.eq(save.station.props.find(p => p.t === 'desk' && p.id === 'p2').agentId, save.agent.id, 'the starter desk belongs to the overseer');

A.eq(upgraded['starnet.website.demo.rev'], starterRevision + '+crew1',
  'a layout-derived revision (plus the crew-scene marker) moves returning visitors off obsolete saves');
const already = bootDemo({ 'starnet.website.demo.rev': starterRevision + '+crew1', 'starnet.save': '{"preserved":true}' });
A.eq(already['starnet.save'], '{"preserved":true}', 'the demo revision migrates once instead of overwriting storage on every load');

A.report('website-live-preview.test');
