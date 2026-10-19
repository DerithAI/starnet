/* Layout and type-scale locks from the 0.13.5 world walk (walk 10-14). Each block names the seam it closes and reads the
   shipped stylesheet's real rules (comments stripped), so a rule that regresses fails here before Andrew sees it. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const path = require('node:path');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const rulesOf = file => {
  const css = read(file).replace(/\/\*[\s\S]*?\*\//g, '');
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(m => ({ sels: m[1].split(/,(?![^()]*\))/).map(s => s.trim().replace(/\s+/g, ' ')), body: m[2] }));
};
const decl = (rules, sel, prop) => {
  let v = null;
  for (const r of rules) if (r.sels.includes(sel)) { const m = r.body.match(new RegExp('(?:^|;)\\s*' + prop + '\\s*:\\s*([^;]+)')); if (m) v = m[1].trim(); }
  return v;
};
const px = v => { const m = String(v || '').match(/(\d+(?:\.\d+)?)px/); return m ? +m[1] : 0; };

/* #7 AGENT DOSSIER › CONFIG › MODEL: the model select was 418px in a 242px column (an inline-flex wrap sized to the widest
   catalog entry) and the EFFORT select sat fully outside the window, unreachable. */
{
  const dossier = rulesOf('frontend/css/agent-dossier.css');
  A.eq(decl(dossier, '.agent-dossier .mp-wrap', 'display'), 'flex', 'the dossier picker is a block flex row (inline-flex took the catalog\'s width)');
  A.eq(decl(dossier, '.agent-dossier .mp-wrap', 'width'), '100%', 'the picker is exactly its card\'s width');
  A.eq(decl(dossier, '.agent-dossier .mp-wrap .mp-model', 'min-width'), '0', 'the model select can shrink below its longest model name');
  A.eq(decl(dossier, '.agent-dossier .mp-wrap .mp-model', 'width'), '0', 'its width comes from the row, never its options');
  A.ok(/^1 1 /.test(decl(dossier, '.agent-dossier .mp-wrap .mp-model', 'flex') || ''), 'the model select fills the line and gives way to the effort select');
  A.eq(decl(dossier, '.agent-dossier .mp-wrap .mp-effort', 'max-width'), '100%', 'the effort select never runs past the card');
  A.eq(decl(rulesOf('frontend/css/app.css'), '.mp-wrap', 'flex-wrap'), 'wrap', 'when both do not fit one line the effort select drops under the model select');
}

/* #14 tiny text. SETTINGS › PERMISSIONS: a reach chip's house name at 9px, the per-agent mode and the posture state at
   10px, the per-agent state cut at "returns to FU…"; QUESTS › Goals "nothing passed" at 9px; the OUTBOX "1 pending" world
   tag at 3px (~5px on screen). */
{
  const rd = rulesOf('frontend/css/readability.css');
  const floor = rd.find(r => r.sels.some(s => s.startsWith('body #terms :is(') && s.includes('.pc-rh')));
  A.ok(!!floor && /font-size:\s*var\(--sn-type-meta\)\s*!important/.test(floor.body), 'the permissions/quests small print has a 14px floor rule');
  const roles = floor ? floor.sels.join(',') : '';
  for (const c of ['.pc-rh', '.pa-mode', '.pa-state', '.pp-state', '.pp-who', '.q-outcome'])
    A.ok(roles.includes(c), c + ' reads at the 14px floor');
  A.eq(decl(rd, 'body #terms .perm-crew-row .pc-head .pa-state', 'white-space'), 'normal', 'the per-agent state line wraps whole instead of "returns to FU…"');
  /* A FLOOR NEVER SHRINKS (review 10-14): the !important floor beat every context rule, so it also pulled the AGENT DOSSIER
     section titles (.agent-dossier .gx-title, 18px) and the QUESTS overview tags (.q-progress-overview .gx-tag, 16px) DOWN
     to 14px. A class may sit in the floor only while no stylesheet sets it larger than the floor anywhere. */
  const allRules = fs.readdirSync(path.join(__dirname, '..', 'frontend/css')).filter(f => f.endsWith('.css') && f !== 'readability.css')
    .flatMap(f => rulesOf('frontend/css/' + f).map(r => Object.assign(r, { file: f })));
  const floorClasses = roles.match(/\.[a-z][\w-]*/gi) || [];
  for (const c of floorClasses) {
    const bigger = allRules.filter(r => r.sels.some(s => new RegExp('\\' + c + '(?![\\w-])').test(s)))
      .map(r => ({ r, size: px((r.body.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/) || [])[1]) })).filter(x => x.size > 14);
    A.ok(!bigger.length, c + ' is in the !important 14px floor but is set larger elsewhere (the floor would shrink it): ' + bigger.map(x => x.r.file + ' ' + x.r.sels.join(',') + ' ' + x.size + 'px').join(' | '));
  }
  // the gx-* titles and tags meet 14px from their own base rules, so the larger context rules still win
  const app = rulesOf('frontend/css/app.css');
  for (const sel of ['.gx-title', '.gx-tag']) A.ok(/var\(--sn-type-meta/.test(decl(app, sel, 'font-size') || ''), sel + ' base size is the 14px meta role, got ' + decl(app, sel, 'font-size'));
  // …and every context rule that sizes them meets it too (the QUESTS section-header count chips were 9.5px under the floor)
  for (const c of ['.gx-title', '.gx-tag']) {
    const small = allRules.filter(r => r.sels.some(s => new RegExp('\\' + c + '(?![\\w-])').test(s)))
      .map(r => ({ r, v: (r.body.match(/(?:^|;)\s*font-size\s*:\s*([^;]+)/) || [])[1] })).filter(x => x.v && !/var\(--sn-type-meta/.test(x.v) && px(x.v) < 14);
    A.ok(!small.length, c + ' is never set under 14px: ' + small.map(x => x.r.file + ' ' + x.r.sels.join(',') + ' ' + x.v).join(' | '));
  }
  const dossier = rulesOf('frontend/css/agent-dossier.css');
  A.eq(px(decl(dossier, '.agent-dossier .gx-title', 'font-size')), 18, 'the dossier section titles stay 18px');
  A.ok(/var\(--sn-type-meta/.test(decl(dossier, '.agent-dossier .gx-tag', 'font-size') || ''), 'the dossier tags read at 14px from their own rule');
  A.eq(px(decl(rulesOf('frontend/css/motion.css'), '.q-progress-overview .gx-tag', 'font-size')), 16, 'the QUESTS overview tags stay 16px');
  A.ok(!/\.gx-(?:title|tag)/.test(read('frontend/css/readability.css').replace(/\/\*[\s\S]*?\*\//g, '')), 'no readability !important role names a gx-* title or tag');
  const pm = read('frontend/app/propremaster.js');
  const body = pm.slice(pm.indexOf('function approvedState('), pm.indexOf('function approvedState(') + 1400);
  const m = body.match(/ctx\.font=["'](\d+(?:\.\d+)?)px/);
  A.ok(!!m && +m[1] >= 7, 'the OUTBOX / board / case world tag is set at a world-tag size (>= 7 world px like RUN and NO FEED), got ' + (m && m[1]));
}

/* #15 the Workflow panel diagram: a 1-step line whose joins carry labels ("the job", "the finished result") ran its OUTBOX
   tile past the panel's right edge at 1440x900 — the strip was min-width:max-content and no join could give way. */
{
  const wp = rulesOf('frontend/css/workflow-panel.css');
  A.eq(decl(wp, '.wf-strip', 'min-width'), 'min-content', 'the strip is the panel\'s width while its parts fit at their narrowest; it scrolls only past that');
  A.ok(/^0 1 /.test(decl(wp, '.wf-belt', 'flex') || ''), 'a join gives way (shrinks) toward its floor before the strip overflows');
  A.ok(decl(wp, '.wf-belt', 'width') !== 'max-content', 'a join is not width:max-content (that made its min-content its widest label, so the strip never let it give way)');
  A.eq(decl(wp, '.wf-belt', 'min-width'), '60px', 'a join keeps its 60px floor (Andrew\'s diagram law: belts >= 60)');
  A.ok(parseFloat(decl(wp, '.wf-belt .carry', 'max-height') || '0') >= 3.3, 'a narrowed join\'s label keeps three short lines');
  A.ok(/class="carry" data-tip="' \+ esc\(carry\)/.test(read('frontend/app/workflowpanel.js')), 'and its whole label is the join\'s hover tip');
}

/* #13 a WOULD-caption stays ON the station (review 10-14): the first cut held it inside the bounding box of every room, which
   on a cross-shaped station is mostly empty space between the wings, and clamped it so far it could sit beside another
   machine than the one its "HERE" names. Runs world.js's real captionInStation on a T-shaped station: a wing (A) over a
   stem (B), with nothing at all left of the stem. */
{
  const world = read('frontend/app/world.js');
  const a = world.indexOf('  function captionInStation('), b = world.indexOf('  // the floor rectangle of the room a local tile sits in');
  A.ok(a > 0 && b > a && b - a < 6000, 'world.js has one bounded caption layout block');
  const T = 12, rects = [{ x1: 0, y1: 0, x2: 9, y2: 4 }, { x1: 3, y1: 5, x2: 6, y2: 12 }];   // A: 10x5 wing · B: 4x8 stem
  const lwRoomBox = (tx, ty) => { const r = rects.find(q => tx >= q.x1 && tx <= q.x2 && ty >= q.y1 && ty <= q.y2); return r ? { x: r.x1 * T + 2, y: r.y1 * T + 2, w: (r.x2 - r.x1 + 1) * T - 4, h: (r.y2 - r.y1 + 1) * T - 4 } : null; };
  const GhostLine = require('../frontend/app/ghostline.js');
  const make = (pan = { x: 0, y: 100 }) => new Function('geo', 'T', 'StationBake', 'panX', 'panY', 'scale', 'cv', 'nagLabelBoxes', 'routingPlan', 'bayPlateBox', 'lwRoomBox', 'GhostLine',
    world.slice(a, b) + '; return captionInStation;')({ allRects: rects }, T, { WALL: { up: 30 } }, pan.x, pan.y, 1, { width: 2000, height: 2000 }, [], null, () => ({}), lwRoomBox, GhostLine);
  const fit = make();
  const capAt = (tx, ty, w, below) => ({ box: { x: (tx + 0.5) * T - w / 2, y: below ? (ty + 1) * T + 3 : ty * T - 3 - 10, w, h: 10 }, n: { x: tx, y: ty, text: 'X' } });
  // a caption wider than the narrow stem, on a stem tile: the stem cannot hold it and left of the stem is open space
  let c = capAt(3, 8, 60); A.eq(fit(c.box, c.n, []), null, 'a caption that would hang over the empty space beside the stem is refused (the bounding box let it through)');
  // a caption that fits the stem is held inside it, beside its own tile
  c = capAt(3, 8, 30); const r1 = fit(c.box, c.n, []);
  A.ok(!!r1 && r1.x >= 3 * T + 2 && r1.x + r1.w <= 7 * T - 2, 'a caption that fits its room is held inside that room across');
  // under the wing's bottom row, left of the stem, there is no station at all
  c = capAt(1, 4, 20, true); A.eq(fit(c.box, c.n, []), null, 'a caption under a bottom-row tile with space below is refused, so it takes the other side');
  // under the wing's bottom row ABOVE the stem it sits on the stem's wall face: still the station
  c = capAt(4, 4, 20, true); A.ok(!!fit(c.box, c.n, []), 'a caption under a tile with the next room below it is kept');
  // at the wing's right wall a wide caption slides in, and still overlaps the machine it names
  c = capAt(9, 2, 40); const r2 = fit(c.box, c.n, []);
  A.ok(!!r2 && r2.x + r2.w <= 10 * T - 2 && r2.x + r2.w > 9 * T, 'a caption at the wall slides into its room and still overlaps its own tile');
  // above the wing's top row is its north wall face (30px): kept; a plate higher than that is in space
  c = capAt(5, 0, 20); A.ok(!!fit(c.box, c.n, []), 'a caption on the top row\'s north wall face is kept');
  c = { box: { x: 50, y: -50, w: 20, h: 10 }, n: { x: 4, y: 0 } }; A.eq(fit(c.box, c.n, []), null, 'a caption above the wall face, in space, is refused');
  // the stage: a caption the stage edge would push off its own tile is refused, never parked beside another machine
  const fitPanned = make({ x: -100, y: 100 });   // the stage's left edge is at x 104
  c = capAt(5, 2, 40); A.eq(fitPanned(c.box, c.n, []), null, 'a caption the stage edge would slide off its own machine is refused');
}

/* #14 the OUTBOX / board / case world tag (review 10-14): at its 8px world size "1 pending" is wider than a 2-tile OUTBOX,
   and drawn centred with no clamp a long tag could run past the hull. world.js hands each tagged prop its room out to the
   hull's outer face (tagRoom); the tag is drawn inside it, and stays centred under its prop wherever that already holds. */
{
  const pm = read('frontend/app/propremaster.js');
  const a = pm.indexOf('  function approvedState('), b = pm.indexOf('  const ready=(async()=>{');
  A.ok(a > 0 && b > a, 'propremaster.js has approvedState');
  const approvedState = new Function('DENSITY', pm.slice(a, b) + '; return approvedState;')(2);
  const drawn = [];
  const ctx = { font: '', textAlign: 'center', textBaseline: 'top', fillStyle: '', globalAlpha: 1, measureText: t => ({ width: String(t).length * 4 }),
    fillText(t, x, y) { const w = String(t).length * 4; drawn.push({ t, left: ctx.textAlign === 'left' ? x : ctx.textAlign === 'right' ? x - w : x - w / 2, w }); }, drawImage() {} };
  const e = { spec: { footprint: { w: 2, h: 2 }, activity: null }, box: { x: 0, y: 0, width: 24, height: 24 }, frame: { x: 0, y: 0 }, body: { width: 0, height: 0 } };
  // an OUTBOX at x 96..120 against a room whose floor ends at x 118 (the hull wall's inner edge)
  approvedState(ctx, 'outbox', e, 96, 40, { crates: 1, tagRoom: { x: 2, y: 2, w: 116, h: 100 } });
  A.eq(drawn.length, 1, 'the tag is drawn');
  A.ok(drawn[0] && drawn[0].left + drawn[0].w <= 118 + 0.01, 'the "1 pending" tag stays inside its room\'s floor at the wall (right edge ' + (drawn[0] && drawn[0].left + drawn[0].w) + ' <= 118)');
  A.ok(drawn[0] && drawn[0].left < 120 && drawn[0].left + drawn[0].w > 96, '…and still sits under its own OUTBOX');
  drawn.length = 0;
  approvedState(ctx, 'outbox', e, 40, 40, { crates: 1, tagRoom: { x: 2, y: 2, w: 116, h: 100 } });
  A.ok(drawn[0] && Math.abs(drawn[0].left + drawn[0].w / 2 - 52) < 0.01, 'away from a wall the tag stays centred under its prop');
  drawn.length = 0;
  approvedState(ctx, 'outbox', e, 96, 40, { crates: 1 });
  A.ok(drawn[0] && Math.abs(drawn[0].left + drawn[0].w / 2 - 108) < 0.01, 'with no room known (BUILD MODE, the catalog) it is centred as before');
  const world = read('frontend/app/world.js');
  A.ok(/tagRoom: tagRoomOf\(p\)/.test(world) && /const side = \(\(typeof StationBake !== 'undefined' && StationBake\.WALL && StationBake\.WALL\.side\) \|\| 0\) \+ 2;/.test(world), 'world.js hands a tagged prop its room, side walls included');
  A.ok(/tagRoom: f\.tagRoom \|\| null/.test(read('frontend/app/propsprites.js')), 'propsprites passes it to the prop\'s drawn state');
}

A.report('ui-layout-fit.test');
