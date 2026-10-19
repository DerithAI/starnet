/* test/conveyor-no-handoff.test.js — A BELT NEVER RUNS OUT OF AN OUTBOX OR INTO AN INBOX (2026-10-09 P0; SEND TO 2026-10-10).

   A belt never hands work between lines (dispatch never routes THROUGH an OUTBOX; an INBOX is where a line starts) — lines hand
   work on by SEND TO, a pointer on the OUTBOX (test/line-sendto.test.js), never a belt. A real user
   lost three days to the floor accepting a belt from one line's OUTBOX into the next line's INBOX: it chimed "CONNECTED · N belts
   laid themselves" and fused the two lines into one jumbled line. Locked here, on a real station:
     THE BELT TOOL   — connectBelt refuses OUTBOX → anything and anything → INBOX: a code, a plain reason that says what to do
                       instead, nothing laid, no undo slot used; the lane preview (previewBelt) refuses the same, with the floor
                       caption; connectRefusal answers the BELT tool's clicks (an OUTBOX may be armed: its one destination,
                       another line's INBOX, is a SEND TO — never a belt).
     A HAND-DRAWN RUN — placeBeltRun / canPlaceBeltRun (the ghost) refuse a run the floor would read as a link out of an OUTBOX
                       or into an INBOX; a run between two steps is still laid.
     THE WIRING      — REFIT says it where the click was (first click, hover caption, the drag ghost). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const P = require('../frontend/app/pipeline.js');
const WM = require('../frontend/app/worldmodel.js');
const LE = require('../frontend/app/lineedit.js');

const FROM_OUTBOX = 'An OUTBOX ends its line — no belt leaves it. To hand this line’s finished work to another line, drag the OUTBOX onto that line’s INBOX (SEND TO).';
const INTO_INBOX = 'An INBOX is where a line starts — no belt runs into it. To feed it another line’s finished work, drag that line’s OUTBOX onto it (SEND TO).';

function twoLines() {
  const d = WM.starterDoc();
  for (const id in d.rooms) for (const r of d.rooms[id].rects) { r.x2 = 40; r.y2 = 30; }
  const st = WM.create(d);
  const a = LE.placeBlueprint(st, 'research_line', { x: 8, y: 4 }), b = LE.placeBlueprint(st, 'research_line', { x: 8, y: 16 });
  if (!a.ok || !b.ok) throw new Error('placeBlueprint ' + JSON.stringify([a, b]));
  for (const p of st.props()) if (p.t === 'bay' && !p.agentId) st.assignPropAgent(p.id, 'ag_' + p.id);
  const of = (ids, t) => ids.filter(id => st.propById(id).t === t);
  return { st, A: { intake: of(a.ids, 'intake')[0], bays: of(a.ids, 'bay'), outbox: of(a.ids, 'outbox')[0] }, B: { intake: of(b.ids, 'intake')[0], bays: of(b.ids, 'bay'), outbox: of(b.ids, 'outbox')[0] } };
}
const snap = st => JSON.stringify({ props: st.props(), belts: st.belts(), links: st.links() });

/* ---------- THE BELT TOOL ---------- */
{
  const { st, A: a, B: b } = twoLines();
  A.ok(Array.isArray(st.links()), 'the floor builds by links (the live case)');
  const s0 = snap(st), undo0 = st.canUndo();
  const cases = [
    ['OUTBOX → the next line\'s INBOX (the live case)', a.outbox, b.intake, 'FROM_OUTBOX', FROM_OUTBOX],
    ['OUTBOX → the next line\'s first BAY', a.outbox, b.bays[0], 'FROM_OUTBOX', FROM_OUTBOX],
    ['the last BAY → the next line\'s INBOX', a.bays[a.bays.length - 1], b.intake, 'INTO_INBOX', INTO_INBOX],
    ['a BAY → its own line\'s INBOX', a.bays[0], a.intake, 'INTO_INBOX', INTO_INBOX]
  ];
  for (const [label, from, to, code, msg] of cases) {
    const r = st.connectBelt(from, to);
    A.ok(r && r.ok === false && r.error === code, label + ': refused ' + code + ' — ' + JSON.stringify(r));
    A.eq(r && r.msg, msg, label + ': …in words that say what to do instead');
    const pv = st.previewBelt(from, to);
    A.ok(pv && pv.ok === false && pv.error === code && pv.msg === msg && typeof pv.short === 'string' && pv.short.length > 10, label + ': the lane preview refuses the same, with a floor caption — ' + JSON.stringify(pv));
  }
  A.eq(snap(st), s0, 'nothing was laid: props, belts and links exactly as before');
  A.eq(st.canUndo(), undo0, 'and no undo slot was used');
  A.eq(st.connectRefusal(a.outbox, null), null, 'the BELT tool\'s FIRST click may arm an OUTBOX (its second click on another line\'s INBOX is a SEND TO)');
  A.eq(st.connectRefusal(a.outbox, b.intake), null, '…and that INBOX is a fine SEND TO (never a belt: connectBelt above still refuses it)');
  A.eq((st.connectRefusal(a.outbox, b.bays[0]) || {}).error, 'FROM_OUTBOX', '…but an OUTBOX to a BAY is refused at the second click');
  A.eq(st.connectRefusal(a.bays[0], null), null, '…a BAY is a fine start');
  A.eq((st.connectRefusal(a.bays[0], b.intake) || {}).error, 'INTO_INBOX', '…and an INBOX is never a destination');
  // a plain step-to-step belt is still laid (the refusal is only about OUTBOX-out / INBOX-in). It is NOT the way to chain two
  // lines: a BAY → BAY belt across lines FUSES them into one line, one lineId, one budget (the 10-09 P0 shape) — SEND TO is.
  const ok = st.connectBelt(a.bays[a.bays.length - 1], b.bays[0]);
  A.ok(ok && ok.ok === true && ok.count > 0, 'a BAY → BAY belt is still laid (it makes ONE line of the two — chaining lines is SEND TO) — ' + JSON.stringify(ok));
}

/* ---------- A HAND-DRAWN RUN ---------- */
{
  const d = WM.starterDoc();
  for (const id in d.rooms) for (const r of d.rooms[id].rects) { r.x2 = 40; r.y2 = 30; }
  const st = WM.create(d);
  const r0 = LE.run(st, null, 'newLine', { role: 'WRITER' }, { near: { x: 6, y: 4 } });
  A.ok(r0.ok, 'a line: INBOX → WRITER → OUTBOX');
  const ob = st.props().find(p => p.t === 'outbox'), bay = st.props().find(p => p.t === 'bay');
  // a lone BAY east of the OUTBOX, a lone INBOX south of the WRITER
  const lb = st.addProp({ t: 'bay', x: ob.x + ob.w + 4, y: ob.y, w: 2, h: 2 });
  const li = st.addProp({ t: 'intake', x: bay.x, y: bay.y + bay.h + 4, w: 2, h: 2 });
  A.ok(lb.ok && li.ok, 'a lone BAY and a lone INBOX stand on the floor');
  const s0 = snap(st);
  // a straight run from the tile beside the OUTBOX's east side, into the lone BAY: the floor would read OUTBOX → BAY
  const run1 = [{ tx: ob.x + ob.w, ty: ob.y }, { tx: ob.x + ob.w + 3, ty: ob.y }];
  const g1 = st.canPlaceBeltRun(run1[0], run1[1]), p1 = st.placeBeltRun(run1[0], run1[1]);
  A.ok(g1.ok === false && g1.error === 'FROM_OUTBOX' && g1.msg === FROM_OUTBOX && !!g1.short, 'the drag ghost refuses a run out of an OUTBOX — ' + JSON.stringify(g1));
  A.ok(p1.ok === false && p1.error === 'FROM_OUTBOX', '…and so does the drop: ' + JSON.stringify(p1));
  // a run down from the WRITER's south side into the lone INBOX: the floor would read WRITER → INBOX
  const run2 = [{ tx: bay.x, ty: bay.y + bay.h }, { tx: bay.x, ty: bay.y + bay.h + 3 }];
  const g2 = st.canPlaceBeltRun(run2[0], run2[1]), p2 = st.placeBeltRun(run2[0], run2[1]);
  A.ok(g2.ok === false && g2.error === 'INTO_INBOX' && g2.msg === INTO_INBOX, 'the drag ghost refuses a run into an INBOX — ' + JSON.stringify(g2));
  A.ok(p2.ok === false && p2.error === 'INTO_INBOX', '…and so does the drop');
  A.eq(snap(st), s0, 'nothing was laid');
  // a run from the WRITER's south side into the lone BAY below it is still laid (a step handing to a step)
  st.removeProp(li.id);
  const lb2 = st.addProp({ t: 'bay', x: bay.x, y: bay.y + bay.h + 4, w: 2, h: 2 });
  A.ok(lb2.ok, 'a lone BAY below the WRITER');
  const p3 = st.placeBeltRun(run2[0], run2[1]);
  A.ok(p3.ok === true && p3.count === 4, 'a hand-drawn run from a step into a step is laid — ' + JSON.stringify(p3));
  A.ok(st.links().some(l => l.from.prop === bay.id && l.to.prop === lb2.id), '…and the floor reads it as WRITER → the new BAY');
}

/* ---------- A NEWER BAY INTO AN OLDER ONE A TILE AWAY: never a lane on a tile both rings share ----------
   A tile two bays both hook belongs to the later one in the floor's order; a belt from the newer bay into the older one that ran
   on such a tile made the older bay read its own way IN as a way OUT — the two handed work to each other (CHAIN_CYCLE, routing off
   for the whole station) while the BELT tool chimed CONNECTED. Every spot round an existing step, both ways round. */
{
  let connects = 0, refused = 0;
  const bad = [];
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const d = WM.starterDoc();
    for (const id in d.rooms) for (const r of d.rooms[id].rects) { r.x2 = 30; r.y2 = 24; }
    const st = WM.create(d);
    if (!LE.run(st, null, 'newLine', { role: 'WRITER' }, { near: { x: 12, y: 10 } }).ok) continue;
    const old = st.props().find(p => p.t === 'bay');
    const nb = st.addProp({ t: 'bay', x: old.x + dx, y: old.y + dy, w: 2, h: 2 });
    if (!nb.ok) continue;
    for (const p of st.props()) if (p.t === 'bay' && !p.agentId) st.assignPropAgent(p.id, 'ag_' + p.id);
    const c = st.connectBelt(nb.id, old.id);
    if (!c.ok) { refused++; if (c.error !== 'TOO_CLOSE' && c.error !== 'NO_PATH' && c.error !== 'FROM_BLOCKED' && c.error !== 'TO_BLOCKED') bad.push(dx + ',' + dy + ' refused ' + c.error); continue; }
    connects++;
    const plan = P.compileRoutingPlan(st.projectGeometry());
    const nNext = (plan.dockChains[nb.id] || { next: [] }).next, oNext = (plan.dockChains[old.id] || { next: [] }).next;
    if (plan.errors.some(e => e.code === 'CHAIN_CYCLE') || nNext.indexOf(old.id) < 0 || oNext.indexOf(nb.id) >= 0) bad.push(dx + ',' + dy + ' ' + JSON.stringify({ nNext, oNext }));
  }
  A.ok(connects > 40, 'a new BAY is belted into an older one from ' + connects + ' spots round it (' + refused + ' refused)');
  A.eq(bad, [], 'every one hands work one way — the new BAY to the old — never back (no CHAIN_CYCLE); a lane that cannot avoid the shared tiles is refused TOO CLOSE');
}

/* ---------- THE WIRING: REFIT says it where the click was ---------- */
{
  const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
  A.ok(/const no = station\.connectRefusal \? station\.connectRefusal\(pid, null\) : null;\s*if \(no\) \{ sfx\('bad'\); flashTip\(ev, no\.msg, false\); return; \}/.test(build), 'the BELT tool\'s first click asks connectRefusal and says any refusal at the click, in the refusal\'s own words (an OUTBOX may be armed: its second click on an INBOX is a SEND TO)');
  A.ok(/\(pv && !pv\.ok\) \? \(pv\.short \|\| 'NO ROUTE — '/.test(build), 'hovering an INBOX mid-connect captions the refusal, not "NO ROUTE"');
  A.ok(/if \(g\.v && g\.v\.short\) return g\.v\.short;/.test(build), 'a hand-drawn run\'s ghost carries the refusal\'s caption');
  A.ok(/else \{ sfx\('bad'\); flashTip\(ev, \(res && res\.msg\) \|\| 'no clear route between those machines', false\); \}/.test(build), 'a refused second click says the refusal\'s words (and never chimes)');
}

A.report('conveyor-no-handoff.test');
