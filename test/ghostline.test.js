/* test/ghostline.test.js — the GHOST PROJECTION's route-truth contract (guided workflows Phase 3).

   Under lock (headless — the REAL modules: conveyor.js engine + pipeline.js compiler + ghostline.js):
     1. ROUTE TRUTH: the ghost's dock == Pipeline.resolveTarget for the same plan + tag — the
        projection can never show a routing the dispatcher wouldn't perform.
     2. TAG ALTERNATION: loop passes cycle the line's real filter tags deterministically, so every
        filter lane gets shown over time (no RNG).
     3. CHAIN TRUTH: the continuation ghost's next dock == Pipeline.chainNext; the final ghost ends
        at the OUTBOX mouth ("WOULD SHIP OUT"), and a dock never consumes its own handoff.
     4. UNCREWED DOCKS: the ghost is consumed at an UNBOUND dock's hookup (where a real crate WOULD
        stop once crewed) and captions it by ROLE, in WOULD-language only.
     5. STOP/RESUME: blocked (coaching / real crates) clears the projection the same tick; a
        complete-and-fed line projects nothing; incompleteness resumes it.
     6. DETERMINISM: two identical runs produce identical logs + trajectories (injected clock only). */
'use strict';
const A = require('./_assert.js');
global.U = global.U || { shade: c => c, hash: s => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0; return h; } };
global.Conveyor = require('../frontend/app/conveyor.js');
const P = require('../frontend/app/pipeline.js');
const GhostLine = require('../frontend/app/ghostline.js');

const belt = (x, y, dir) => ({ x, y, dir });
const jmapOf = plan => new Map(Object.entries(plan.junctions || {}));

/* drive a ghost over a floor: fixed 16ms ticks, sampling trajectories — returns { g, log, traj } */
function run(geo, opt) {
  const plan = P.compileRoutingPlan(geo);
  const comps = P.lineComponents(geo);
  const g = GhostLine.create();
  g.setContext({ plan, comps, offset: { tx: 0, ty: 0 } });
  const jm = jmapOf(plan);
  const traj = [];
  let now = 0;
  const steps = (opt && opt.steps) || 2500;
  for (let i = 0; i < steps; i++) {
    now += 16;
    g.tick(16, now, geo.belts, jm, { blocked: opt && opt.blocked ? opt.blocked(i) : false, feed: (opt && opt.feed) || { known: true, fed: false } });
    if (i % 10 === 0) for (const b of g.peek().boxes) traj.push([i, b.x, b.y, b.dir, +b.prog.toFixed(4)]);
  }
  return { g, plan, comps, log: g.peek().log, traj };
}

/* ---- floor 1: intake -> FILTER (code -> S, default E) -> two BOUND bays ---- */
const geoFilter = {
  props: [
    { id: 'i1', t: 'intake', x: 0, y: 0, w: 1, h: 1 },
    { id: 'f1', t: 'filter', x: 3, y: 0, w: 1, h: 1, routes: { code: 'S' }, def: 'E' },
    { id: 'bA', t: 'bay', x: 6, y: 0, w: 1, h: 1, agentId: 'alice' },
    { id: 'bB', t: 'bay', x: 3, y: 3, w: 1, h: 1, agentId: 'bob' },
  ],
  belts: [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'), belt(4, 0, 'E'), belt(5, 0, 'E'), belt(3, 1, 'S'), belt(3, 2, 'S')],
};

/* ---- 1+2. route truth per tag + deterministic lane alternation ---- */
{
  const { plan, log } = run(geoFilter, { steps: 3000 });
  A.ok(P.ok(plan), 'filter floor compiles deployable');
  A.eq(P.resolveTarget(plan, { tag: 'code' }), 'bob', 'dispatch truth: code routes to bob');
  A.eq(P.resolveTarget(plan, { tag: 'general' }), 'alice', 'dispatch truth: general routes to alice');
  const spawns = log.filter(e => e.kind === 'spawn');
  const docks = log.filter(e => e.kind === 'dock');
  A.ok(spawns.length >= 2 && docks.length >= 2, 'the ghost looped at least two passes (' + spawns.length + '/' + docks.length + ')');
  A.eq(spawns[0].tag, 'code', 'pass 0 rides the first filter tag (sorted — deterministic)');
  A.eq(spawns[1].tag, 'general', 'pass 1 rides the default lane tag');
  for (const d of docks) {
    A.eq(d.owner, P.resolveTarget(plan, { tag: d.tag }), 'ghost dock == resolveTarget for tag "' + d.tag + '"');
  }
  const owners = {}; for (const d of docks) owners[d.owner] = 1;
  A.ok(owners.alice && owners.bob, 'both filter lanes are shown across passes');
  const sorts = log.filter(e => e.kind === 'sort');
  A.ok(sorts.length >= 2 && sorts[0].tile.x === 3 && sorts[0].tile.y === 0, 'the filter decision is captioned at the junction tile');
}

/* ---- 6. determinism: two identical runs -> identical logs + trajectories ---- */
{
  const a = run(geoFilter, { steps: 1500 });
  const b = run(geoFilter, { steps: 1500 });
  A.eq(JSON.stringify(a.log), JSON.stringify(b.log), 'two identical runs produce the identical event log');
  A.eq(JSON.stringify(a.traj), JSON.stringify(b.traj), 'two identical runs produce the identical trajectory');
  A.ok(a.traj.length > 0, 'the trajectory sample actually saw riding boxes');
}

/* ---- floor 2: intake -> bay(up) -> bay(down) -> OUTBOX (the chain) ---- */
const geoChain = bound => ({
  props: [
    { id: 'i1', t: 'intake', x: 0, y: 0, w: 1, h: 1 },
    { id: 'bX', t: 'bay', x: 4, y: 0, w: 1, h: 1, agentId: bound ? 'up' : null, role: 'RESEARCHER' },
    { id: 'bY', t: 'bay', x: 7, y: 0, w: 1, h: 1, agentId: bound ? 'down' : null, role: 'WRITER' },
    { id: 'o1', t: 'outbox', x: 9, y: 0, w: 1, h: 1 },
  ],
  belts: [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(3, 0, 'E'), belt(5, 0, 'E'), belt(6, 0, 'E'), belt(8, 0, 'E')],
});

/* ---- 3. chain truth on a BOUND two-stage line (feed-incomplete keeps it projecting) ---- */
{
  const { plan, log, g } = run(geoChain(true), { steps: 2200 });
  A.ok(P.ok(plan), 'chain floor compiles deployable');
  A.eq(P.resolveTarget(plan, { tag: 'general' }), 'up', 'dispatch truth: inbound work runs at the up dock');
  // work belongs to a line (2026-08-07): the ctx carries the line the work ENTERED on — which for the
  // GHOST is by definition this line's own trigger, since the ghost is a projection of THIS line running.
  A.eq(P.chainNext(plan, 'up', { tag: 'general', lineId: P.lineOf(plan, 'up') }), 'down', 'dispatch truth: up hands off to down');
  A.eq(P.chainNext(plan, 'up', { tag: 'general' }), null, 'and a run that did NOT come in through this line advances nothing');
  const kinds = log.filter(e => e.kind !== 'sort' && e.kind !== 'split').map(e => e.kind + (e.owner ? ':' + e.owner : ''));
  const firstPass = kinds.slice(0, 4).join(' ');
  A.eq(firstPass, 'spawn dock:up dock:down out', 'one pass = arrive, run at up, hand off to down, ship out (got: ' + firstPass + ')');
  const boxes = g.peek().boxes;
  A.ok(boxes.every(b => b.payload && b.payload.ghost === true), 'every riding projection is payload-flagged ghost');
}

/* ---- 4. UNCREWED docks consume the ghost; captions speak role + WOULD only ---- */
{
  const geo = geoChain(false);
  const { plan, log, g } = run(geo, { steps: 2200, feed: { known: false, fed: false } });
  A.eq(P.resolveTarget(plan, { tag: 'general' }), null, 'dispatch has no target yet (docks uncrewed)');
  const docks = log.filter(e => e.kind === 'dock');
  A.ok(docks.length >= 2, 'the ghost is consumed at the uncrewed docks (' + docks.length + ')');
  A.eq(docks[0].owner, 'g#bX', 'first stop: where a real crate WOULD stop once bX is crewed');
  A.eq(docks[1].owner, 'g#bY', 'second stop: the handoff dock');
  A.ok(log.some(e => e.kind === 'out'), 'the pass still ends at the OUTBOX mouth');
  // captions: WOULD-language only, role-named — never a claim that anything ran
  const texts = [];
  {
    // re-run a short pass and harvest captions live (notes expire; peek mid-ride)
    const g2 = GhostLine.create();
    g2.setContext({ plan, comps: P.lineComponents(geo), offset: { tx: 0, ty: 0 } });
    const jm = jmapOf(plan);
    let now = 0;
    for (let i = 0; i < 2200; i++) { now += 16; g2.tick(16, now, geo.belts, jm, { feed: { known: false, fed: false } }); for (const n of g2.peek().notes) if (texts.indexOf(n.text) < 0) texts.push(n.text); }
  }
  A.ok(texts.length >= 3, 'captions landed (' + texts.length + ')');
  A.ok(texts.every(t => t.indexOf('WOULD') >= 0), 'every caption speaks WOULD-language: ' + JSON.stringify(texts));
  A.ok(texts.some(t => t.indexOf('RESEARCHER') >= 0), 'the uncrewed dock is captioned by its ROLE');
  A.ok(g.peek().notes.every(n => n.text.indexOf('WOULD') >= 0), 'no caption ever claims work ran');
}

/* ---- 5. stop/resume: blocked clears the ride the same tick; complete-and-fed projects nothing ---- */
{
  const geo = geoFilter;
  const plan = P.compileRoutingPlan(geo);
  const comps = P.lineComponents(geo);
  const g = GhostLine.create();
  g.setContext({ plan, comps, offset: { tx: 0, ty: 0 } });
  const jm = jmapOf(plan);
  let now = 0, sawRide = false;
  for (let i = 0; i < 400 && !sawRide; i++) { now += 16; g.tick(16, now, geo.belts, jm, { feed: { known: true, fed: false } }); if (g.peek().boxes.length) sawRide = true; }
  A.ok(sawRide, 'the ghost rides an incomplete (unfed) line');
  now += 16; g.tick(16, now, geo.belts, jm, { blocked: true, feed: { known: true, fed: false } });
  A.eq(g.peek().boxes.length, 0, 'BLOCKED (coaching / a real crate) clears the projection the same tick');
  A.eq(g.peek().projecting, false, 'projecting reads false while blocked');
  // unblock -> it resumes
  let resumed = false;
  for (let i = 0; i < 800 && !resumed; i++) { now += 16; g.tick(16, now, geo.belts, jm, { feed: { known: true, fed: false } }); if (g.peek().boxes.length) resumed = true; }
  A.ok(resumed, 'the projection resumes once unblocked');
  // line completes (crewed + fed) -> stands down; goes incomplete again -> resumes
  now += 16; g.tick(16, now, geo.belts, jm, { feed: { known: true, fed: true } });
  A.eq(g.peek().boxes.length, 0, 'a complete-and-fed line projects NOTHING (real telemetry owns the belt)');
  A.eq(g.peek().projecting, false, 'projecting reads false on a complete line');
  let back = false;
  for (let i = 0; i < 800 && !back; i++) { now += 16; g.tick(16, now, geo.belts, jm, { feed: { known: true, fed: false } }); if (g.peek().boxes.length) back = true; }
  A.ok(back, 'incompleteness returning resumes the projection');
}

/* ---- pre-spawn truth: eligibility is pending, not yet projecting ---- */
{
  const geo = geoChain(false);
  const plan = P.compileRoutingPlan(geo);
  const g = GhostLine.create();
  g.setContext({ plan, comps: P.lineComponents(geo), offset: { tx: 0, ty: 0 } });
  const jm = jmapOf(plan);
  let now = 16;
  g.tick(16, now, geo.belts, jm, { feed: { known: false, fed: false } });
  let p = g.peek();
  A.eq(p.projecting, false, 'the 900ms pre-spawn delay does not claim a projection is riding');
  A.eq(p.pending, true, 'the scheduled pre-spawn state is reported explicitly as pending');
  A.eq(p.boxes.length + p.notes.length + p.log.length, 0,
    'pending means no box, caption, or projection event exists yet');
  while (!g.peek().log.length && now < 2000) {
    now += 16;
    g.tick(16, now, geo.belts, jm, { feed: { known: false, fed: false } });
  }
  p = g.peek();
  A.ok(p.log.length > 0 && (p.boxes.length > 0 || p.notes.length > 0),
    'the projection eventually begins with observable evidence');
  A.eq(p.projecting, true, 'projecting flips true only when that evidence begins');
  A.eq(p.pending, false, 'pending clears once the projection begins');
}

/* ---- inter-pass truth: terminal delivery clears projecting on that exact tick ---- */
{
  const geo = geoChain(false);
  const plan = P.compileRoutingPlan(geo);
  const g = GhostLine.create();
  g.setContext({ plan, comps: P.lineComponents(geo), offset: { tx: 0, ty: 0 } });
  const jm = jmapOf(plan);
  let now = 0, terminal = null, sawOut = false;
  for (let i = 0; i < 2500 && !terminal; i++) {
    now += 16;
    g.tick(16, now, geo.belts, jm, { feed: { known: false, fed: false } });
    const p = g.peek();
    if (p.log.some(e => e.kind === 'out')) sawOut = true;
    if (sawOut && p.boxes.length === 0 && !p.pendingChain) terminal = p;
  }
  A.ok(terminal, 'the proof observed the first pass fully leave the OUTBOX');
  A.eq(terminal && terminal.boxes.length, 0, 'no projection crate remains on the terminal tick');
  A.eq(terminal && terminal.pendingChain, false, 'no chain continuation remains after the OUTBOX');
  A.eq(terminal && terminal.projecting, false, 'terminal delivery clears projecting on the same tick');
  A.eq(terminal && terminal.pending, true, 'the next loop is explicitly pending during the inter-pass pause');
}

/* ---- a non-deployable plan (belt CYCLE) projects nothing ---- */
{
  const geo = {
    props: [{ id: 'i1', t: 'intake', x: 0, y: 0, w: 1, h: 1 }, { id: 'bA', t: 'bay', x: 4, y: 2, w: 1, h: 1 }],
    belts: [belt(1, 0, 'E'), belt(2, 0, 'E'), belt(2, 1, 'S'), belt(1, 1, 'W')].map((b, i) => i === 1 ? belt(2, 0, 'S') : b),
  };
  // 4-tile loop: (1,0)E -> (2,0)S -> (2,1)W ... make it a real cycle
  geo.belts = [belt(1, 0, 'E'), belt(2, 0, 'S'), belt(2, 1, 'W'), belt(1, 1, 'N')];
  const plan = P.compileRoutingPlan(geo);
  A.ok(!P.ok(plan), 'the loop floor is non-deployable');
  const g = GhostLine.create();
  g.setContext({ plan, comps: P.lineComponents(geo), offset: { tx: 0, ty: 0 } });
  let now = 0;
  for (let i = 0; i < 400; i++) { now += 16; g.tick(16, now, geo.belts, jmapOf(plan), { feed: { known: true, fed: false } }); }
  A.eq(g.peek().boxes.length, 0, 'a non-deployable plan projects nothing (a ghost may never ride a loop)');
}

/* ---- 7. captions are LAID OUT, never piled (walk 10-14 #13): two captions printed on top of each other on the busy
   station, and one crossed the hull into space. draw() places each caption where no caption drawn this frame sits,
   asks the caller's fit (keep it on the station; null = that spot is taken) at each spot it tries, and leaves out a
   caption with no clear spot. ---- */
{
  const geo = geoChain(false);
  const plan = P.compileRoutingPlan(geo), g = GhostLine.create();
  g.setContext({ plan, comps: P.lineComponents(geo), offset: { tx: 0, ty: 0 } });
  const jm = jmapOf(plan);
  let plates = [];
  const target = { fillStyle: '', measureText: t => ({ width: String(t).length * 4 }), getTransform: () => ({ a: 1 }),
    fillRect(x, y, w, h) { if (target.fillStyle === 'rgba(4,6,8,0.86)') plates.push({ x, y, w, h }); } };
  const ctx = new Proxy(target, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const over = (a, b) => a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
  let now = 0, crowded = 0, piled = 0, outside = 0, oneSpot = 0, refused = 0, moved = 0, below = 0;
  const room = { x: -30, y: -40, w: 180, h: 60 };
  const keepIn = b => { b.x = Math.max(room.x, Math.min(room.x + room.w - b.w, b.x)); return b; };
  for (let i = 0; i < 2600; i++) {
    now += 16; g.tick(16, now, geo.belts, jm, { feed: { known: false, fed: false } });
    const notes = g.peek().notes;
    if (notes.length < 2) continue;
    crowded++;
    plates = []; g.draw(ctx, now, 12, 8, null, keepIn);
    for (let a = 0; a < plates.length; a++) for (let b = a + 1; b < plates.length; b++) if (over(plates[a], plates[b])) piled++;
    for (const p of plates) if (p.x < room.x - 0.01 || p.x + p.w > room.x + room.w + 0.01) outside++;
    plates = []; g.draw(ctx, now, 12, 8, null, b => ({ x: 0, y: 0, w: b.w, h: b.h }));   // every spot is the same spot
    if (plates.length === 1) oneSpot++;
    plates = []; g.draw(ctx, now, 12, 8, null, () => null);                            // every spot is taken by something real
    if (plates.length === 0) refused++;
    // the newest caption is laid out first; refuse ONLY its own first spot and it must land on its next one
    const first = notes[notes.length - 1], isDock = / WOULD RUN IT$/.test(first.text), firstSpot = (first.y + 1) * 12 + 3;   // a dock caption hangs under its tile
    if (isDock) {
      below++;
      plates = []; g.draw(ctx, now, 12, 8, null, (b, n) => (n && n.text === first.text && n.x === first.x && b.y === firstSpot) ? null : b);
      if (plates.length && plates[0].y !== firstSpot && Math.abs(plates[0].y - (first.y * 12 - 3 - 8 * 1.36)) < 8) moved++;
    }
  }
  A.ok(crowded > 0, 'the chain line shows two captions at once at some point (' + crowded + ' frames)');
  A.eq(piled, 0, 'no two captions drawn in one frame overlap');
  A.eq(outside, 0, 'every caption stays inside the box the caller keeps it in (the station, never space)');
  A.eq(oneSpot, crowded, 'when every candidate spot is the same spot, ONE caption is drawn there, never a pile');
  A.eq(refused, crowded, 'a caption whose every spot is taken by something real sits the pass out');
  A.ok(below > 0 && moved === below, 'a dock caption refused under its tile goes over it instead (' + moved + '/' + below + ' frames)');
  A.ok(/if \(!b\) continue;/.test(require('fs').readFileSync(require('path').join(__dirname, '../frontend/app/ghostline.js'), 'utf8')), 'draw() leaves out a caption with no clear spot');
}

/* ---- 8. a caption the caller's arbiter DECLINES holds no spot (review 10-14): `say` answering false means "not painted",
   so the next caption may take that spot; an arbiter that paints later (BUILD MODE's voice queue answers nothing) keeps
   the spot reserved, so its queue never receives two piled plates. ---- */
{
  const geo = geoChain(false);
  const plan = P.compileRoutingPlan(geo), g = GhostLine.create();
  g.setContext({ plan, comps: P.lineComponents(geo), offset: { tx: 0, ty: 0 } });
  const jm = jmapOf(plan);
  let plates = [];
  const target = { fillStyle: '', measureText: t => ({ width: String(t).length * 4 }), getTransform: () => ({ a: 1 }),
    fillRect(x, y, w, h) { if (target.fillStyle === 'rgba(4,6,8,0.86)') plates.push({ x, y, w, h }); } };
  const ctx = new Proxy(target, { get: (o, k) => (k in o ? o[k] : () => {}), set: (o, k, v) => { o[k] = v; return true; } });
  const sameSpot = b => ({ x: 0, y: 0, w: b.w, h: b.h });
  let now = 0, crowded = 0, twoLive = 0, tookFreedSpot = 0, deferredOffers = 0, deferredOnce = 0;
  for (let i = 0; i < 2600; i++) {
    now += 16; g.tick(16, now, geo.belts, jm, { feed: { known: false, fed: false } });
    if (g.peek().notes.length < 2) continue;
    crowded++;
    // how many captions are live in draw this frame (every spot distinct, so each is offered once)
    let live = 0, far = 0;
    plates = []; g.draw(ctx, now, 12, 8, (b, paint) => { live++; return true; }, b => ({ x: (far++) * 1000, y: 0, w: b.w, h: b.h }));
    // the arbiter declines the first caption it is offered and paints the rest
    let offered = 0;
    plates = []; g.draw(ctx, now, 12, 8, (b, paint) => { if (offered++ === 0) return false; paint(); return true; }, sameSpot);
    if (live === 2) { twoLive++; if (offered === 2 && plates.length === 1) tookFreedSpot++; }   // (a caption that expires inside draw is never offered)
    // an arbiter that queues (paints after draw returns) keeps the first caption's spot: the second is never offered onto it
    const queued = [];
    plates = []; g.draw(ctx, now, 12, 8, (b, paint) => { queued.push(paint); }, sameSpot);
    deferredOffers += queued.length; if (queued.length === 1) deferredOnce++;
  }
  A.ok(crowded > 0, 'the chain line shows two captions at once at some point (' + crowded + ' frames)');
  A.ok(twoLive > 0, 'two captions are live inside draw on ' + twoLive + ' frames');
  A.eq(tookFreedSpot, twoLive, 'a declined caption frees its spot: the next caption is offered it and painted there');
  A.eq(deferredOnce, crowded, 'a queueing arbiter is offered ONE caption per spot, never a pile (' + deferredOffers + ' offers)');
}

/* ---- 9. BUILD MODE's caption fit refuses a bay's name plate (review 10-14): its fit only slid a caption onto the glass,
   so a dock caption whose spot under its tile was taken went OVER the tile — onto the gantry plate naming the agent. ---- */
{
  const fs = require('fs'), path = require('path');
  const build = fs.readFileSync(path.join(__dirname, '../frontend/app/build.js'), 'utf8');
  A.ok(/ghost\.draw\(ctx, now, t, capFs\(\), \(box, paint\) => voiceSay\('ghostCaption', box, box, paint\), ghostCaptionFit\)/.test(build), 'BUILD MODE lays its WOULD-captions out with ghostCaptionFit');
  const src = (build.match(/function ghostCaptionFit\(box, n\) \{[\s\S]*?\n  \}/) || [''])[0];
  A.ok(!!src, 'ghostCaptionFit is defined in build.js');
  // one room, tiles 0..11 x 0..7 (px 0..144 x 0..96, its north wall face 30px above), and a bound bay at tiles 5-6 x 3
  const rooms = GhostLine.roomBoxes([{ x1: 0, y1: 0, x2: 11, y2: 7 }], 12, 0, 0, 30);
  const fit = src ? new Function('captionFit', 'T', 'frameBayLabels', 'GhostLine', 'buildRoomBoxes', src + '; return ghostCaptionFit;')(b => b, () => 12, [{ x: 5, y: 3, w: 2, agentId: 'nova', t: 'bay' }], GhostLine, () => rooms) : () => ({});
  const bay = { x: 5, y: 3, text: '◇ NOVA WOULD RUN IT' };
  // the plate: centred on the 2-wide bay (x 60..84 -> 60.5..83.5), straddling its top edge (y 31.5..42.5)
  A.eq(fit({ x: 50, y: 22, w: 40, h: 11 }, bay), null, 'a caption over the bay\'s name plate is refused');
  A.ok(!!fit({ x: 50, y: 60, w: 40, h: 11 }, bay), 'a caption under the bay is kept');
  A.ok(!!fit({ x: 50, y: 44, w: 40, h: 11 }, bay), 'a caption just clear of the plate is kept');
  // …and it keeps the live floor's on-station law (GhostLine.onStation): in its room, never past the hull into space
  const wide = fit({ x: 120, y: 60, w: 60, h: 11 }, { x: 11, y: 4, text: 'X' });
  A.ok(!!wide && wide.x + wide.w <= 142 + 0.01, 'a caption at the hull wall slides back into its room (it ran past the hull in BUILD MODE)');
  A.eq(fit({ x: 50, y: 100, w: 40, h: 11 }, { x: 5, y: 7, text: 'X' }), null, 'a caption under the last floor row (the hull\'s skirt, then space) is refused, so it takes its other side');
  const ps = fs.readFileSync(path.join(__dirname, '../frontend/app/propsprites.js'), 'utf8');
  A.ok(/const width = Math\.max\(12,\(p\.w \|\| 1\)\*TILE-1\)/.test(ps) && /const x=\(p\.x\+\(p\.w\|\|1\)\/2\)\*TILE,anchor=p\.y\*TILE-surfaceLift\(p\)\+1,h=11;/.test(ps), 'the plate it refuses is the one PropSprites.drawBayNames paints (same width, centre, top edge, 11px)');
}

A.report('ghostline');
