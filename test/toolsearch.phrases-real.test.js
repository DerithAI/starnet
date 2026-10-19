'use strict';
/* node test/toolsearch.phrases-real.test.js — tool.search's PHRASE score, measured on the REAL shelf (review, 10-14).

   The rc walk's lead searched "station builder - create assembly lines and workflows" and got app.create: "create" is a
   whole tool name, and the builder's descriptions carried "station builder" only as two weak words. A phrase score fixed
   that, but scored ANYWHERE in a description it broke real queries: "every assembly line" in station.layout's text hid the
   builder from "build an assembly line", and "previous page" revealed the 13 KB station.plan beside browser.back. A phrase
   now scores only in a description's LEADING LABEL ("STATION BUILDER, step 2:"). Every case here runs against the real tool
   descriptions (browser, station, station control, apps, loops, routines) with the capability registry's real deferred
   split, never fakes — a description edit anywhere on the shelf is what these cases are for. */
const A = require('./_assert.js');
const { makeToolSearchTool } = require('../sidecar/tools/builtin/toolsearch.js');
const { makeBrowserTools } = require('../sidecar/tools/builtin/browser.js');
const { makeStationTools } = require('../sidecar/tools/builtin/station.js');
const { makeStationControlTools } = require('../sidecar/tools/builtin/station-control.js');
const { makeStationShowTool } = require('../sidecar/tools/builtin/station-show.js');
const { makeAppTools } = require('../sidecar/tools/builtin/apps.js');
const { makeLoopTools } = require('../sidecar/tools/builtin/loops.js');
const { makeRoutineTools } = require('../sidecar/tools/builtin/routines.js');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');

const reg = new Map(), add = t => { if (t && t.name) reg.set(t.name, t); }, into = { register: add };
makeBrowserTools({ session: {} }).tools.forEach(add);
makeStationTools({ station: { request: async () => ({ ok: false, error: 'no page' }) }, now: () => 1, planMemo: new Map(),
  lineMenu: () => [{ id: 'revision_loop', roles: ['Writer', 'Reviewer'] }], styleMenu: () => [], roomMenu: () => [], kitMenu: () => [], presetMenu: () => [] }).register(into);
makeStationControlTools({}).register(into);
{ const s = makeStationShowTool({}); add(s.tool || s); }
(makeAppTools({ apps: {} }).defs || []).forEach(add);
makeLoopTools({}).register(into);
makeRoutineTools({}).register(into);

const deferred = new Set(), granted = new Set();
for (const rows of Object.values(CAP_REGISTRY)) for (const g of rows) { granted.add(g.tool); if (g.deferred) deferred.add(g.tool); }
const pool = [...reg.keys()].filter(n => deferred.has(n)).sort();
const advertised = ['tool.search'].concat([...reg.keys()].filter(n => granted.has(n) && !deferred.has(n)).sort());
A.ok(pool.indexOf('station.plan') >= 0 && pool.indexOf('browser.detach') >= 0 && advertised.indexOf('station.layout') >= 0 && advertised.indexOf('browser.back') >= 0,
  'fixture: the real shelf (builder and browser extras hidden; station.layout and browser.back listed): ' + pool.length + ' hidden, ' + advertised.length + ' listed');

const search = makeToolSearchTool({ registry: { get: n => reg.get(n) || null } }).toolSearchTool;
const ask = async q => {
  const r = await search.run({ query: q }, { deferred: pool, advertised });
  const listed = ((String(r.content).split('Now available')[0].match(/^· (\S+)/gm)) || []).map(l => l.slice(2));
  return { shown: (r.control && r.control.revealTools) || [], listed, content: String(r.content) };
};
const BUILDER = ['station.map', 'station.plan', 'station.build', 'station.make_prop', 'station.test_line', 'station.start_line'];

(async () => {
  // the walker's searches find the whole builder (the label phrase "station builder" scores like a name)
  for (const q of ['station builder - create assembly lines and workflows', 'station builder create assembly line workflow', 'station builder']) {
    const r = await ask(q);
    A.ok(['station.map', 'station.plan', 'station.build'].every(n => r.shown.indexOf(n) >= 0), '"' + q + '" reveals station.map, station.plan and station.build: ' + JSON.stringify(r.shown));
  }
  // a phrase inside a sentence of a description scores nothing: "every assembly line" (station.layout) no longer hides the builder
  for (const q of ['build an assembly line', 'add an assembly line', 'assembly line builder']) {
    const r = await ask(q);
    A.ok(r.shown.some(n => BUILDER.indexOf(n) >= 0), '"' + q + '" still reveals a builder tool (was: none, only station.layout): ' + JSON.stringify(r));
  }
  /* a revealed later step of a numbered family brings the earlier steps (the fix round's live run searched "build an assembly
     line or workflow on the station", got station.build alone, and spent a second search on plan and map); a builder tool
     with no step number (test_line, start_line) brings nothing, so a plain test never carries the 13 KB station.plan */
  const whole = await ask('build an assembly line or workflow on the station');
  A.ok(['station.map', 'station.plan', 'station.build'].every(n => whole.shown.indexOf(n) >= 0), 'the live run\'s first search reveals map, plan and build at once: ' + JSON.stringify(whole.shown));
  const add = await ask('add an assembly line');
  A.ok(add.shown.indexOf('station.plan') >= 0, '"add an assembly line" reveals station.plan (its first sentence names assembly lines): ' + JSON.stringify(add.shown));
  const test = await ask('test the line');
  A.ok(test.shown.indexOf('station.test_line') >= 0 && test.shown.indexOf('station.plan') < 0, '"test the line" reveals station.test_line and never drags station.plan along: ' + JSON.stringify(test.shown));
  // a browser query never drags the builder along (the 13 KB station.plan declaration would ride every later turn)
  const back = await ask('go back to the previous page');
  A.ok(back.listed.indexOf('browser.back') >= 0 && !back.shown.some(n => /^station\./.test(n)) && back.shown.indexOf('browser.detach') < 0, '"go back to the previous page" names browser.back and reveals no station tool: ' + JSON.stringify({ shown: back.shown, listed: back.listed }));
  const tab = await ask('open a new tab');
  A.ok(tab.shown.indexOf('browser.tabs') >= 0 && !tab.shown.some(n => /^station\./.test(n)), '"open a new tab" reveals browser.tabs: ' + JSON.stringify(tab.shown));
  const type = await ask('type text into an input field');
  A.ok(type.listed.indexOf('browser.type') >= 0 && !type.shown.some(n => /^station\./.test(n)), '"type text into an input field" names browser.type: ' + JSON.stringify({ shown: type.shown, listed: type.listed }));
  const setting = await ask('change a station setting');
  A.eq(setting.shown[0], 'station.settings', '"change a station setting" reveals station.settings first');
  const app = await ask('create an app dashboard');
  A.eq(app.shown[0], 'app.create', 'a query with no label phrase finds what it names first');
  A.report('toolsearch.phrases-real');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
