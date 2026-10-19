/* test/finish-line-card-truth.test.js — the FINISH THE LINE card answers to what STARTS a line and to a real shipment, never to a
   crate or a run that came by (agent lane repair pass, 2026-10-12; conveyor-final merge, decision c).

   • ② WHAT STARTS THIS LINE is ticked only by what starts THIS line: its own configured start (lineStartsHere — WorkflowLine.lineStarts
     over the server's start facts: a routine that runs it from its entry step, a connected channel answering as its first step, an
     armed folder / webhook trigger of its own) or another line's SEND TO into it (named by the floor's one line name). A start
     somewhere else on the station (the floor-wide feed flag; a channel answering into ANOTHER line's entry) does not tick it, and a
     line that only ever ran sample/test jobs keeps ② open (M7).
   • the card used to retire FOR GOOD the moment any product crate sank at the line's chute — and a direct COMMS order to the line's
     last agent rides one too — so an unfed line lost its ② for ever while the floor still said NO FEED. Now nothing at a chute
     books anything, and even a line that really SHIPPED keeps its card while a step is left to do; ✕ still quiets it for good.

   (conveyor-final merge: this test asserted the agent lane's rule — a floor-wide start ticked ② on EVERY line, and the card rendered
   ② from finFeedText(st). The merge kept the floor lane's per-line rule, decision c: the fixture now gives line A a real start of its
   own where it means "a start exists", and a floor-wide feed alone is asserted NOT to tick an unrelated line.)

   Runs the REAL build.js finRead / finState / lineStartsHere / finFeedText / finPick (a source slice in a vm) over a real WorldModel
   station, its real compiled plan and the real WorkflowLine start reader. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs'), path = require('path'), vm = require('vm');
const WM = require('../frontend/app/worldmodel.js'), P = require('../frontend/app/pipeline.js'), LE = require('../frontend/app/lineedit.js');
const WL = require('../frontend/app/workflowline.js');
const build = fs.readFileSync(path.join(__dirname, '../frontend/app/build.js'), 'utf8');
const world = fs.readFileSync(path.join(__dirname, '../frontend/app/world.js'), 'utf8');
const slice = (src, from, to) => { const a = src.indexOf(from), b = src.indexOf(to, a + 1); A.ok(a >= 0 && b > a, 'source slice ' + from.trim().slice(0, 40)); return src.slice(a, b); };

const s = WM.create(); s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 90, y2: 40 } });
const a = LE.placeBlueprint(s, 'research_line', { x: 40, y: 4 }), b = LE.placeBlueprint(s, 'research_line', { x: 40, y: 22 });
A.ok(a.ok && b.ok, 'fixture: two lines');
for (const p of s.props()) if (p.t === 'bay') s.assignPropAgent(p.id, 'ag_' + p.id);
const crew = s.props().filter(p => p.t === 'bay').map(p => ({ id: 'ag_' + p.id, name: 'Crew ' + p.id }));
const of = (r, t) => r.ids.find(id => s.propById(id).t === t);

let feed = { known: true, fed: false };
let facts = null;   // the server's start facts ({ chans, cron, lt }) world.js read — what starts ONE line (WorkflowLine.lineStarts)
const store = {};
const ctx = vm.createContext({ station: s, valPlan: null, cacheGeo: null, Pipeline: P, WorkflowLine: WL, stationKeyOf: () => 'test', renderFinCard: () => {},
  opts: { getStation: () => s, agents: () => crew, world: {
    feedState: () => feed,
    startFacts: () => facts,
    // the world's own accessor (knownFedLines): the compiled hand-offs — the stats with runs below are what M7 stopped reading
    fedLines: plan => P.fedLineIds(plan, { known: true, byLine: { [lineKey('a')]: { runs: 4, tests: 2 }, [lineKey('b')]: { runs: 1 } } }),
    schedOffFor: () => false } },
  localStorage: { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); } } });
function lineKey(which) { const r = which === 'a' ? a : b; return P.lineComponents(s.projectGeometry()).find(c => c.outboxes.includes(of(r, 'outbox'))).key; }
vm.runInContext(slice(build, '  const FIN_KEY = st =>', '  /* ---------- STARTER GEAR')
  + '; globalThis.setComps = v => { valComps = v; finKeySel = null; }; globalThis.finState = finState; globalThis.feedText = finFeedText; globalThis.pick = finPick; globalThis.mark = (k, f) => finMark(station, k, f); globalThis.focus = k => { finKeySel = k; };', ctx);
function compile() {
  const geo = s.projectGeometry();
  ctx.valPlan = P.compileRoutingPlan(geo);
  ctx.cacheGeo = geo;
  ctx.setComps(P.lineComponents(geo));
  const comps = P.lineComponents(geo);
  return { A: comps.find(c => c.outboxes.includes(of(a, 'outbox'))), B: comps.find(c => c.outboxes.includes(of(b, 'outbox'))) };
}
// the senders the card names (renderFinCard: Pipeline.lineSenders over the plan, by the floor's one line name)
const sendersOf = c => [...new Set(P.lineSenders(ctx.valPlan, c.key).map(id => s.lineName(id)).filter(Boolean))];
const entryAgent = c => WL.entryAgentsOf(WL.lineFlow(ctx.valPlan, c, P, s.projectGeometry().props))[0];
const webhookOf = key => ({ lt: { triggers: [{ id: 't-' + key, lineId: key, kind: 'webhook', enabled: true, blockedBy: null }] } });

/* ---- 1. ② in words (M7 + decision c) ---- */
let L = compile();
const t = c => ctx.feedText(ctx.finState(c), sendersOf(c));
A.eq(t(L.A), '② CHOOSE WHAT STARTS THIS LINE', 'a line that only ran sample/test jobs (runs in the stats) still has ② to do');
A.eq(ctx.finState(L.A).todo, true, '…and something left to do');
feed = { known: false, fed: false };
A.eq(t(L.A), '② CHECKING WHAT STARTS THIS LINE…', 'an unanswered feed check claims nothing either way');
feed = { known: true, fed: false };
A.ok(s.setSendTo(of(a, 'outbox'), of(b, 'intake')).ok, 'fixture: LINE A sends to LINE B');
L = compile();
const nameA = s.lineName(L.A.key);
A.ok(/^LINE \S/.test(nameA || ''), 'fixture: the sending line has a floor name — ' + nameA);
A.eq(t(L.B), '✓ FED BY ' + nameA, 'a SEND TO into a line ticks ② naming the sender by the floor\'s one line name');
A.eq(ctx.feedText(ctx.finState(L.B)), '✓ ANOTHER LINE SENDS IT WORK', '…(with no named sender, finFeedText still says only that another line sends it work)');
A.eq(t(L.A), '② CHOOSE WHAT STARTS THIS LINE', '…while the sending line still has nothing that starts it');
feed = { known: true, fed: true };   // something on the station starts SOME line — a channel, an armed routine, a folder, a webhook
A.eq([t(L.A), t(L.B)], ['② CHOOSE WHAT STARTS THIS LINE', '✓ FED BY ' + nameA], 'a floor-wide start alone does not tick ② on a line it does not start (decision c); the line another line feeds stays fed');
const entryA = entryAgent(L.A), entryB = entryAgent(L.B);
A.ok(entryA && entryB && entryA !== entryB, 'fixture: each line has its own entry agent');
facts = { chans: { telegram: { configured: true, connected: true, agentName: crew.find(x => x.id === entryB).name } } };
A.eq(t(L.A), '② CHOOSE WHAT STARTS THIS LINE', 'a connected channel that answers into ANOTHER line\'s entry does not start this one');
facts = { chans: { telegram: { configured: true, connected: true, agentName: crew.find(x => x.id === entryA).name } } };
A.eq(t(L.A), '✓ AUTOMATIC START CONFIGURED', 'a connected channel that answers as THIS line\'s first step starts it');
facts = webhookOf(L.B.key);
A.eq(t(L.A), '② CHOOSE WHAT STARTS THIS LINE', 'another line\'s armed webhook does not start this one');
facts = webhookOf(L.A.key);
A.eq([t(L.A), t(L.B)], ['✓ AUTOMATIC START CONFIGURED', '✓ FED BY ' + nameA], 'a start of THIS line\'s own ticks its ②; the fed line still names its sender');
A.ok(/const feedTxt = finFeedText\(st, senders\);/.test(build), 'the card renders ② from finFeedText(st, senders)');

/* ---- 2. what the card answers to (review: a crate at a chute retired it for good) ---- */
A.ok(s.setSendTo(of(a, 'outbox'), null).ok, 'fixture: no SEND TO');
feed = { known: true, fed: false }; facts = null;
L = compile();
// nothing a crate can call books anything (world.js onWorkitemDeliver; see first-ship-receipt for the source lock) — so after a
// direct order's crate sank at A's chute, A's card is exactly as it was
A.ok(!/noteLineDelivered/.test(build) && !/Build\.noteLine|Build\.markLine/.test(slice(world, '  function onWorkitemDeliver(bx) {', '\n  }\n')), 'a crate at a chute has no way to retire the card');
A.eq(ctx.pick() && ctx.pick().key, L.A.key, 'an unfed line\'s card is up');
ctx.mark(L.A.key, 'shipped');   // the line REALLY shipped (noteLineShipped / markLineShipped) — and nothing starts it yet
ctx.setComps(P.lineComponents(s.projectGeometry()));
A.eq(ctx.pick() && ctx.pick().key, L.A.key, 'a line that shipped but has nothing that starts it keeps its card (② stays in view)');
feed = { known: true, fed: true }; facts = webhookOf(L.B.key);
ctx.focus(L.A.key);
A.eq(ctx.pick() && ctx.pick().key, L.A.key, '…a start of ANOTHER line does not stand it down (its ② is still open)');
facts = webhookOf(L.A.key);
ctx.focus(L.A.key);
A.ok(!(ctx.pick() && ctx.pick().key === L.A.key), 'once a start of THIS line exists the shipped line stands down, even focused');
ctx.focus(L.B.key);
A.eq(ctx.pick() && ctx.pick().key, L.B.key, '…while a line that never shipped still shows its card when you touch it (③ is still to run)');
A.eq(ctx.finState(L.B).todo, true, '(fixture: LINE B still has ② to do — nothing starts it)');
ctx.mark(L.B.key, 'dis'); ctx.focus(L.B.key);
A.eq(ctx.pick(), null, '✕ quiets a line for good — even one with a step left to do');

/* ---- 3. an older build's `done` (a crate retired the card for good) is read as shipped: the card returns while ② is open ---- */
for (const k of Object.keys(store)) delete store[k];
store['starnet.refit.finline.test'] = JSON.stringify({ [L.A.key]: { done: 1 } });
// (the upgrade runs once per station per session: a fresh slice is a fresh session)
const ctx2 = vm.createContext(Object.assign({}, ctx));
vm.runInContext(slice(build, '  const FIN_KEY = st =>', '  /* ---------- STARTER GEAR')
  + '; globalThis.setComps = v => { valComps = v; finKeySel = null; }; globalThis.pick = finPick;', ctx2);
ctx2.valPlan = ctx.valPlan; ctx2.cacheGeo = ctx.cacheGeo; ctx2.setComps(P.lineComponents(s.projectGeometry()));
feed = { known: true, fed: false }; facts = null;
A.eq(ctx2.pick() && ctx2.pick().key, L.A.key, 'a line an older build retired for a crate gets its card back while nothing starts it');
A.eq(JSON.parse(store['starnet.refit.finline.test'])[L.A.key].shipped, 1, '…its `done` now reads as shipped (its FIRST SHIP spent)');
feed = { known: true, fed: true }; facts = webhookOf(L.A.key);
A.ok(!(ctx2.pick() && ctx2.pick().key === L.A.key), '…and it stands down once a start of its own exists');

A.report('finish-line-card-truth');
