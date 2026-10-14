/* The homepage "watch it work" console (2026-10-14) embeds the REAL frontend (website/app) booted from
   the website-only crew save in demo-boot.js, and station-demo.js drives it ONLY by emitting harness
   events onto the app's own bus through demo-boot's StarnetDemoBridge. These pins keep three promises:
   the room is still the product's own starter (never a second handwritten station), the replay never
   reaches into the app any other way (the /app/* CSP forbids eval), and the page says it is a replay. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(ROOT, ...p), 'utf8');
const js = read('website', 'station-demo.js');
const css = read('website', 'home.css');
const html = read('website', 'index.html');
const demo = read('website', 'app', 'demo-boot.js');

// ---- the page: one embed, cache-busted, honestly captioned ----
A.ok(/<iframe id="crew-app" src="app\/embed\.htm\?v=20261014-crew1"/.test(html),
  'the homepage embeds the dashboard-upload-safe app document, cache-busted for the crew scene');
A.ok(/station-demo\.js\?v=20261014-crew1/.test(html), 'the homepage loads the replay driver');
A.eq(/live-preview\.js|home\.js/.test(html), false, 'the retired starter-crop and starfield/console scripts are gone');
A.ok(/scripted replay/.test(html) && /no model is running on this page/.test(html),
  'the console says plainly that it is a scripted replay and no model runs');
A.ok(/id="station"/.test(html), 'the generator-owned PRODUCT nav link (#station) still lands on the console');

// ---- the driver: bus events through the bridge, nothing else ----
A.ok(/StarnetDemoBridge/.test(js), 'the replay reaches the app only through the embed bridge');
A.eq(/\beval\(|new Function|contentWindow\.(World|U|App)\b/.test(js), false,
  'the replay never evals or reaches app globals directly (the /app/* CSP forbids eval)');
for (const ev of ['workitem.placed', 'agent.run.start', 'agent.run.end', 'agent.tool_call', 'agent.tool_result', 'shell.exec', 'verify.result', 'agent.token'])
  A.ok(js.includes("'" + ev + "'"), 'the replay drives the renderer with the real ' + ev + ' event');
A.ok(/IntersectionObserver/.test(js) && /visibilitychange/.test(js), 'the replay pauses off screen and in hidden tabs');
A.ok(/aspect-ratio:var\(--stage-aspect/.test(css) && /scale\(var\(--k/.test(css), 'the stage crop consumes the driver geometry');

// ---- demo-boot: starter room + crew, bridge is emit-only ----
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
