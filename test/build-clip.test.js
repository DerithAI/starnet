/* test/build-clip.test.js — THE HAND, part 2 (2026-10-11, Andrew: "fully polish and integrate this into starnet" — his build-mode
   prototype): BOX SELECT takes belts too, a double-click takes a WHOLE LINE, and a piece of floor goes in your hand — Ctrl+C / X / V /
   D, COPY LINE, DELETE LINE — with its belts, its junction settings, its names, briefs, budgets and crew.
   Locked here:
     A. the clip (worldmodel.copyLines) carries what makes each machine THAT machine (a LOOP's passes / verdict / lanes — the
        piece the old copy lost — a BAY's role, crew, brief and hand-off, an INBOX's name and budget), every belt between its
        machines and the belt under each junction; never a connector bind, a project folder, crew from another station, or a
        SEND TO pointing outside it (counted);
     B. pasteLines lays it EXACTLY: one undo, a new line (its own INBOX, its own line id, its name numbered), the compile as
        clean as the original's, every belt tile on clear floor (never over another belt), the floor's own reconcile as the
        judge; checkPaste is pure and reports every bad spot; probePaste never touches the doc;
     C. rotateClip turns it a quarter turn (belt headings, junction lanes and all) and a turned paste still compiles clean;
        SEND TO inside a copy is re-pointed at the copy's own INBOX;
     D. the fallback: a clip laid out by the layout engine near the spot (pasteLinesLaid) — one undo, the extras kept;
     E. DELETE LINE (removeLine) and a selection's belts (removeLinks): one undo each, SEND TO into a deleted line let go;
     F. the build.js wiring (source locks). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');
const LE = require('../frontend/app/lineedit.js');

const plan = s => P.compileRoutingPlan(s.projectGeometry());
const codes = s => plan(s).errors.filter(e => e.code !== 'UNBOUND_BAY').map(e => e.code).sort();
function fresh() { const s = WM.create(); s.projectGeometry(); s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 90, y2: 40 } }); return s; }
const add = (s, t, x, y) => { const big = t === 'bay' || t === 'intake' || t === 'outbox'; return s.addProp({ t, x, y, w: big ? 2 : 1, h: big ? 2 : 1, block: big }).id; };
const linkOf = (s, a, b) => (s.links() || []).find(l => l.from.prop === a && l.to.prop === b);
const frozen = s => JSON.stringify(s.serialize()) + '|' + s.getSeq() + '|' + s.canUndo();
// INBOX → BAY → LOOP → BAY → OUTBOX along y=4, crewed, named, briefed, budgeted
function line(s) {
  const I = add(s, 'intake', 32, 4), B1 = add(s, 'bay', 40, 4), B2 = add(s, 'bay', 50, 4), O = add(s, 'outbox', 58, 4);
  s.assignPropAgent(B1, 'nova'); s.assignPropAgent(B2, 'atlas');
  for (const [a, b] of [[I, B1], [B1, B2], [B2, O]]) A.ok(s.connectBelt(a, b).ok, 'line laid ' + a + '→' + b);
  s.setPropLabel(I, 'RESEARCH'); s.setPropLimits(I, { maxHops: 5, maxUsdPerMessage: 0.5, maxUsdPerDay: 3 });
  s.setPropRole(B1, 'RESEARCHER'); s.setPropBrief(B1, 'Find three sources.'); s.setPropHands(B1, 'hand on the sources');
  const lt = linkOf(s, B1, B2).path[3], lr = s.junctionOnBelt(lt.x, lt.y, 'loop', { cfg: { maxIter: 4, when: 'APPROVED' } });
  A.ok(lr.ok, 'a LOOP stands on the B1→B2 belt');
  return { I, B1, B2, O, LOOP: lr.id };
}
const lineOfIntake = (s, id) => plan(s).lines.find(l => l.intakes.includes(id));

/* ---------- A. the clip carries the machine, not just its box ---------- */
{
  const s = fresh(), L = line(s);
  A.eq(codes(s), ['LOOP_NO_BACK'], 'the original line compiles with its one honest finding (the LOOP has no BACK lane yet)');
  const before = frozen(s);
  const m = s.lineMembers(L.B2);
  A.ok(m && m.ids.length === 5 && m.links.length === 4, 'lineMembers names the whole line from any of its machines (5 machines, 4 belts)');
  const c = s.copyLines(m.ids, { agent: id => id === 'nova', turns: () => false });
  A.eq(frozen(s), before, 'copying never touches the floor, its edit counter or the undo stack');
  A.ok(c.ok && c.clip.n === 5 && c.clip.nb === 4, 'the clip holds 5 machines and the 4 belts between them');
  const node = oid => c.clip.nodes.find(n => n.oid === oid);
  A.ok(node(L.LOOP).cfg && node(L.LOOP).cfg.maxIter === 4 && node(L.LOOP).cfg.when === 'APPROVED' && !!node(L.LOOP).cfg.done, 'a LOOP keeps its passes, its verdict and its DONE lane (the old copy lost all three)');
  A.ok(node(L.I).label === 'RESEARCH' && node(L.I).limits && node(L.I).limits.maxHops === 5, 'an INBOX keeps its line\'s name and budget');
  A.ok(node(L.B1).role === 'RESEARCHER' && node(L.B1).brief === 'Find three sources.' && node(L.B1).hands === 'hand on the sources', 'a BAY keeps its role, brief and hand-off');
  A.ok(node(L.B1).agentId === 'nova' && !node(L.B2).agentId && c.clip.crewLeft === 1, 'crew travels only when the caller says that agent is on this station (atlas left behind, counted)');
  A.ok(c.clip.belts.some(b => b.x === node(L.LOOP).x && b.y === node(L.LOOP).y), 'the belt under the junction comes too');
  const all = c.clip.nodes.every(n => n.x >= 0 && n.y >= 0 && n.x + n.w <= c.clip.w && n.y + n.h <= c.clip.h) && c.clip.belts.every(b => b.x >= 0 && b.y >= 0 && b.x < c.clip.w && b.y < c.clip.h);
  A.ok(all, 'everything is relative to the clip\'s top-left, inside its box');
  // a half selection: links with only one end selected stay behind
  const half = s.copyLines([L.I, L.B1]);
  A.ok(half.ok && half.clip.nb === 1 && half.clip.n === 2, 'only belts whose two ends are both in it travel');
  A.eq(s.copyLines([]).ok, false, 'copying nothing is a plain refusal');
}

/* ---------- B. paste: exact, one undo, a new line, the floor as judge ---------- */
{
  const s = fresh(), L = line(s);
  const c = s.copyLines(s.lineMembers(L.I).ids).clip;
  const before = frozen(s);
  // checkPaste is pure and paints every bad spot
  const onTop = s.checkPaste(c, c.x0, c.y0);
  A.ok(!onTop.ok && onTop.badNodes.length === 5 && onTop.badTiles.length > 0, 'over the original every machine and belt tile is a bad spot (reported, all of them)');
  const pr = s.probePaste(c, c.x0, c.y0 + 12);
  A.ok(pr.ok, 'twelve tiles down it fits (the probe says so)');
  A.eq(frozen(s), before, 'checkPaste and probePaste never touch the floor');
  const n0 = s.props().length, l0 = s.links().length;
  const r = s.pasteLines(c, c.x0, c.y0 + 12);
  A.ok(r.ok && r.ids.length === 5 && r.links.length === 4 && s.props().length === n0 + 5 && s.links().length === l0 + 4, 'the paste lays 5 machines and 4 belts');
  const I2 = r.map[L.I];
  A.eq(codes(s), ['LOOP_NO_BACK', 'LOOP_NO_BACK'], 'the floor compiles as it did — the copy brings its own LOOP finding and nothing new');
  const a = lineOfIntake(s, L.I), b = lineOfIntake(s, I2);
  A.ok(a && b && a.lineId !== b.lineId, 'the pasted INBOX starts a NEW line (its own line id)');
  A.eq(s.propById(I2).label, 'RESEARCH 2', 'its name is numbered — two lines never share one name');
  A.ok(s.propById(r.map[L.LOOP]).maxIter === 4 && s.propById(r.map[L.LOOP]).when === 'APPROVED', 'the pasted LOOP passes 4 times on APPROVED');
  A.ok(s.propById(r.map[L.B1]).agentId === 'nova' && s.propById(r.map[L.B1]).brief === 'Find three sources.', 'the pasted BAY is crewed and briefed');
  const pl = plan(s), jOld = Object.values(pl.junctions).filter(j => j.kind === 'loop').length;
  A.eq(jOld, 2, 'both lines have a real LOOP junction');
  const u = s.undo();
  A.ok(u.ok && u.label === 'PASTE' && s.props().length === n0 && s.links().length === l0, 'ONE undo takes the whole paste back (UNDID · PASTE)');
  s.redo();
  A.ok(s.props().length === n0 + 5, 'redo lays it again');
  // a paste never overwrites another belt: a belt across the spot refuses it, whole
  s.undo();
  A.ok(s.placeBeltRun({ tx: 34, ty: 19 }, { tx: 70, ty: 19 }).ok, 'a belt runs across the next spot');
  const c2 = s.checkPaste(c, c.x0, c.y0 + 14);
  A.ok(!c2.ok && (c2.error === 'ON_BELT' || c2.error === 'NEAR_JUNCTION' || c2.error === 'JUNCTION_TOUCH') && c2.badTiles.length + c2.badNodes.length > 0, 'a belt already there is a bad spot (' + c2.error + ')');
  const pc = s.pasteLines(c, c.x0, c.y0 + 14);
  A.ok(!pc.ok && s.props().length === n0, 'and the paste is refused whole — nothing half laid');
  const dupd = s.pasteLines(c, c.x0, c.y0 + 24, { label: 'DUPLICATE' });
  A.ok(dupd.ok && s.undo().label === 'DUPLICATE', 'a caller may name the slot (Ctrl+D: UNDID · DUPLICATE)');
  const off = s.checkPaste(c, 200, 200);
  A.ok(!off.ok && off.error === 'OFF_DECK' && off.short === 'PART OF IT IS OFF THE STATION FLOOR', 'off the station floor says so');
}

/* ---------- B2. review worldmodel-01: a paste whose belt runs right beside another line's belt is refused (never fused) ----------
   The compiler joins belts that touch into ONE line (Pipeline.lineComponents): a copy laid one row under LINE A's belt became
   LINE A — one line id, one LINE BUDGET, two INBOXes (the 10-09 P0 class). The floor's own reconcile kept every belt, so only
   the line check applyLineLayout already makes catches it. */
{
  const s = fresh();
  const IA = add(s, 'intake', 32, 10), BA = add(s, 'bay', 60, 10), OA = add(s, 'outbox', 70, 10);   // LINE A: its belt rides row 10
  const IB = add(s, 'intake', 36, 30), BB = add(s, 'bay', 46, 30), OB = add(s, 'outbox', 56, 30);   // LINE B: its belt rides row 30
  s.assignPropAgent(BA, 'nova'); s.assignPropAgent(BB, 'atlas');
  for (const [a, b] of [[IA, BA], [BA, OA], [IB, BB], [BB, OB]]) A.ok(s.connectBelt(a, b).ok, 'two-line floor laid ' + a + '→' + b);
  A.ok(linkOf(s, IA, BA).path.every(t => t.y === 10) && linkOf(s, IB, BB).path.every(t => t.y === 30), 'LINE A rides row 10, LINE B row 30');
  const lineA = lineOfIntake(s, IA).lineId;
  const c = s.copyLines(s.lineMembers(IB).ids).clip;
  const before = frozen(s), floor0 = JSON.stringify(s.serialize());
  // one row under LINE A's belt: every piece stands on clear floor, but the copy's belt touches A's the whole way along
  const ay = c.y0 - 19;
  A.ok(c.belts.some(b => s.belts().some(q => q.x === c.x0 + b.x && q.y === ay + b.y - 1)), 'the spot lays the copy\'s belt directly under LINE A\'s');
  const pr = s.probePaste(c, c.x0, ay);
  A.ok(!pr.ok && pr.error === 'JOINS_FLOOR' && pr.short === 'ANOTHER LINE IS TOO CLOSE', 'the ghost refuses it whole — ANOTHER LINE IS TOO CLOSE (' + (pr.error || 'ok') + ')');
  A.eq(frozen(s), before, 'the probe never touches the floor');
  const r = s.pasteLines(c, c.x0, ay);
  A.ok(!r.ok && r.error === 'JOINS_FLOOR', 'the paste is refused (' + (r.error || 'it laid') + ')');
  A.ok(JSON.stringify(s.serialize()) === floor0, '…and nothing of it is laid (all or nothing)');
  const a1 = lineOfIntake(s, IA);
  A.ok(a1.lineId === lineA && a1.intakes.length === 1, 'LINE A is still its own line, with its one INBOX (' + a1.intakes.length + ')');
  if (r.ok) s.undo();
  // one row further down the copy's belt no longer touches A's: it lays, as its own line with its own budget
  const ok = s.pasteLines(c, c.x0, ay + 1);
  A.ok(ok.ok, 'a row further down it lays');
  const a2 = lineOfIntake(s, IA), b2 = ok.ok && lineOfIntake(s, ok.map[IB]);
  A.ok(a2 && b2 && a2.lineId === lineA && b2.lineId !== lineA && a2.intakes.length === 1, 'the copy is a NEW line beside LINE A, never part of it');
}

/* ---------- C. a quarter turn, and SEND TO inside a copy ---------- */
{
  const s = fresh(), L = line(s);
  const c = s.copyLines(s.lineMembers(L.I).ids, { turns: () => false }).clip;
  A.ok(WM.clipTurns(c), 'a clip of square machines can turn');
  const r1 = WM.rotateClip(c);
  A.ok(r1.w === c.h && r1.h === c.w && r1.rot === 1, 'a turn swaps the clip\'s width and height');
  const r4 = WM.rotateClip(c, 4);
  A.eq(JSON.stringify(r4.nodes) + JSON.stringify(r4.belts), JSON.stringify(c.nodes) + JSON.stringify(c.belts), 'four turns are no turn');
  const back = WM.rotateClip(r1, 3);
  A.eq(JSON.stringify(back.links), JSON.stringify(c.links), 'one turn and three more come back to the start');
  const loop1 = r1.nodes.find(n => n.oid === L.LOOP), loop0 = c.nodes.find(n => n.oid === L.LOOP);
  A.eq(loop1.cfg.done, { E: 'S', S: 'W', W: 'N', N: 'E' }[loop0.cfg.done], 'a junction\'s lane turns with it');
  // turned, it still lays and compiles clean
  let laid = null;
  for (let y = 8; y <= 22 && !laid; y++) for (let x = 64; x <= 80 && !laid; x++) { const v = s.checkPaste(r1, x, y); if (v.ok && s.probePaste(r1, x, y).ok) laid = s.pasteLines(r1, x, y); }
  A.ok(laid && laid.ok, 'the turned line finds a spot and lays');
  A.eq(codes(s), ['LOOP_NO_BACK', 'LOOP_NO_BACK'], 'a turned paste compiles as the original does (nothing new)');
  const ln = lineOfIntake(s, laid.map[L.I]);
  A.ok(ln && ln.lineId !== lineOfIntake(s, L.I).lineId, '…as its own line');
  // non-square pieces never turn
  A.ok(!WM.clipTurns({ nodes: [{ t: 'desk', w: 2, h: 1 }] }) && WM.rotateClip({ w: 2, h: 1, nodes: [{ t: 'desk', x: 0, y: 0, w: 2, h: 1 }], links: [], belts: [] }).w === 2, 'a clip with a piece that is not square does not turn');

  // SEND TO (the SEND TO lane's OUTBOX field — feature-read): inside the copy it is re-pointed, outside it is left behind (counted)
  const s2 = fresh(), X = line(s2);
  const I2 = add(s2, 'intake', 32, 30), B9 = add(s2, 'bay', 42, 30), O2 = add(s2, 'outbox', 52, 30);
  s2.assignPropAgent(B9, 'kai'); s2.connectBelt(I2, B9); s2.connectBelt(B9, O2);
  s2.doc().props.find(p => p.id === X.O).sendTo = I2;   // LINE A sends on to LINE B
  const out = s2.copyLines(s2.lineMembers(X.I).ids).clip;
  A.ok(out.dropped === 1 && !out.nodes.find(n => n.oid === X.O).sendTo, 'a SEND TO pointing outside the copy is left behind, and counted');
  const both = s2.copyLines(s2.lineMembers(X.I).ids.concat(s2.lineMembers(I2).ids)).clip;
  A.ok(both.dropped === 0 && both.nodes.find(n => n.oid === X.O).sendTo === I2, '…one pointing inside it travels');
  let pb = null;
  for (let y = 0; y <= 40 && !pb; y++) for (let x = 30; x <= 90 && !pb; x++) { if (s2.checkPaste(both, x, y).ok) { const r = s2.pasteLines(both, x, y); if (r.ok) pb = r; } }
  A.ok(pb && s2.propById(pb.map[X.O]).sendTo === pb.map[I2], 'a pasted SEND TO points at the COPY\'s INBOX, never back at the original');
}

/* ---------- D. the fallback: laid out by the engine near the spot ---------- */
{
  const s = fresh(), L = line(s);
  const c = s.copyLines(s.lineMembers(L.I).ids, { agent: () => true }).clip;
  const g = s.clipGraph(c);
  A.ok(g.ok && g.graph.nodes.length === 5 && g.graph.links.length === 4 && g.graph.nodes.every(n => /^clip:/.test(n.id)), 'the clip as a graph: fresh node ids no prop can hold');
  A.eq(s.clipGraph({ nodes: [{ oid: 'x', t: 'desk', w: 2, h: 1 }], links: [] }).ok, false, 'furniture has no lane to lay out (refused)');
  const Lay = LE.layoutGraphNear(s, g.graph, { x: 50, y: 24 });
  A.ok(Lay && Lay.ok, 'the engine lays the copied line out near the spot');
  const n0 = s.props().length, r = s.pasteLinesLaid(c, Lay);
  A.ok(r.ok && r.ids.length === 5 && s.props().length === n0 + 5, 'pasteLinesLaid writes it');
  // M24 (2026-10-12): the laid copy reports the belts it laid, as the exact paste does (the lead's card said "0 belts")
  A.ok(Array.isArray(r.links) && r.links.length === c.links.length && r.links.every(id => s.links().some(l => l.id === id)), 'a laid-out paste returns the ids of the belts it laid (' + (r.links || []).length + ' of ' + c.links.length + ')');
  A.ok(s.propById(r.map[L.B1]).brief === 'Find three sources.' && s.propById(r.map[L.I]).label === 'RESEARCH 2' && s.propById(r.map[L.LOOP]).maxIter === 4, '…with its briefs, its name (numbered) and its LOOP passes');
  A.eq(codes(s), ['LOOP_NO_BACK', 'LOOP_NO_BACK'], '…and it compiles as the original does');
  A.eq(s.undo().label, 'PASTE', 'one undo (UNDID · PASTE)');
  A.eq(s.props().length, n0, '…takes it all back');
}

/* ---------- D2. repair 2026-10-11: a laid-out paste keeps every junction's compass ON the lanes the layout laid ---------- */
{
  const dirTo = (a, b) => (b.x > a.x ? 'E' : b.x < a.x ? 'W' : b.y > a.y ? 'S' : 'N');
  const laneOf = (s, J, l) => dirTo(J, (l.path && l.path[0]) || s.propById(l.to.prop));
  // a LOOP, turned 0-3 quarters in hand: its DONE compass is the lane its done link really leaves by (the clip's old compass
  // went back on over the layout's — and the next lane drawn out of it was labelled DONE: two DONE lanes, no BACK)
  for (const turns of [0, 1, 2, 3]) {
    const s = fresh(), L = line(s);
    const c = WM.rotateClip(s.copyLines(s.lineMembers(L.I).ids, { agent: () => true, turns: () => false }).clip, turns);
    const r = s.pasteLinesLaid(c, LE.layoutGraphNear(s, s.clipGraph(c).graph, { x: 50, y: 24 }));
    A.ok(r.ok, 'turned ' + turns + ': the copy lays out to fit');
    const J = s.propById(r.map[L.LOOP]), done = s.links().find(l => l.from.prop === J.id && l.from.port === 'done');
    A.ok(done && J.done === laneOf(s, J, done) && J.maxIter === 4 && J.when === 'APPROVED', 'turned ' + turns + ': the pasted LOOP DONE compass is the lane its done belt leaves by (' + J.done + '), its passes and verdict kept');
    A.ok(s.connectBelt(J.id, r.map[L.B1]).ok, 'turned ' + turns + ': its BACK lane is drawn to the BAY before it');
    const ports = s.links().filter(l => l.from.prop === J.id).map(l => l.from.port).sort();
    A.eq(ports, ['done', 'out'], 'turned ' + turns + ': …and it is a BACK lane (never a second DONE)');
  }
  // a FILTER: CODE down one lane, EVERYTHING ELSE down another — after a laid paste its routes / default match its links, and the
  // panel's next save (configureJunction from p.routes / p.def — what the FILTER card shows) leaves every tag where it was
  for (const turns of [0, 1, 3]) {
    const s = fresh();
    const I = add(s, 'intake', 32, 10), B1 = add(s, 'bay', 46, 10), B2 = add(s, 'bay', 46, 18);
    s.assignPropAgent(B1, 'nova'); s.assignPropAgent(B2, 'atlas');
    A.ok(s.connectBelt(I, B1).ok, 'filter line laid');
    const t = linkOf(s, I, B1).path[4], F = s.junctionOnBelt(t.x, t.y, 'filter');
    A.ok(F.ok && s.connectBelt(F.id, B2).ok, 'a FILTER on the belt, a second lane to BAY 2');
    const F0 = s.propById(F.id);
    s.configureJunction(F.id, { routes: { code: laneOf(s, F0, linkOf(s, F.id, B1)) }, def: laneOf(s, F0, linkOf(s, F.id, B2)) });
    const c = WM.rotateClip(s.copyLines(s.lineMembers(I).ids, { agent: () => true, turns: () => false }).clip, turns);
    const r = s.pasteLinesLaid(c, LE.layoutGraphNear(s, s.clipGraph(c).graph, { x: 60, y: 28 }));
    A.ok(r.ok, 'filter turned ' + turns + ': the copy lays out to fit');
    const NF = s.propById(r.map[F.id]), toB1 = linkOf(s, NF.id, r.map[B1]), toB2 = linkOf(s, NF.id, r.map[B2]);
    A.ok(toB1 && toB2 && (toB1.from.tags || []).includes('code') && toB2.from.else, 'filter turned ' + turns + ': the CODE lane still runs to the copy of BAY 1, EVERYTHING ELSE to BAY 2');
    A.ok(NF.routes && NF.routes.code === laneOf(s, NF, toB1) && NF.def === laneOf(s, NF, toB2), 'filter turned ' + turns + ': its routes / default ARE those lanes (' + JSON.stringify(NF.routes) + ' / ' + NF.def + ')');
    s.configureJunction(NF.id, { routes: Object.assign({}, NF.routes), def: NF.def });   // the panel's next save, from what it shows
    A.ok((linkOf(s, NF.id, r.map[B1]).from.tags || []).includes('code') && linkOf(s, NF.id, r.map[B2]).from.else, 'filter turned ' + turns + ': the panel next save re-tags nothing (CODE still reaches BAY 1)');
  }
}

/* ---------- E2. repair 2026-10-11: a selection's DELETE / CUT takes the belt under each junction it removes ---------- */
{
  // the model sequence deleteGroup runs (one transact): the selected belts with o.junctions, then every member
  const s = fresh(), L = line(s), m = s.lineMembers(L.I);
  const r = s.transact(() => { const rb = s.removeLinks(m.links, [], { junctions: [L.LOOP] }); if (!rb.ok) return rb; for (const id of m.ids) { const q = s.removeProp(id); if (!q.ok) return q; } return { ok: true }; });
  A.ok(r.ok && s.belts().length === 0, 'Del on a whole line by box leaves no belt where its LOOP stood (the loose tile it used to leave)');
  // CUT then paste back in place: the clip fits where it came from
  const s2 = fresh(), L2 = line(s2), m2 = s2.lineMembers(L2.I);
  const c = s2.copyLines(m2.ids, { agent: () => true }).clip;
  s2.transact(() => { s2.removeLinks(m2.links, [], { junctions: [L2.LOOP] }); for (const id of m2.ids) s2.removeProp(id); return { ok: true }; }, 'CUT');
  const v = s2.checkPaste(c, c.x0, c.y0);
  A.ok(v.ok, 'Ctrl+X then Ctrl+V in the same place fits (' + (v.short || 'ok') + ')');
  A.ok(s2.pasteLines(c, c.x0, c.y0).ok && codes(s2).join() === 'LOOP_NO_BACK', '…and lays the line back as it was');
  // a junction that KEEPS a belt keeps its tile (the belt it sat on rejoins): only one of its two links is taken
  const s3 = fresh(), L3 = line(s3), into = s3.links().find(l => l.to.prop === L3.LOOP), J = s3.propById(L3.LOOP);
  const r3 = s3.transact(() => { s3.removeLinks([into.id], [], { junctions: [L3.LOOP] }); return s3.removeProp(L3.LOOP); });
  A.ok(r3.ok && s3.belts().some(b => b.x === J.x && b.y === J.y), 'a junction whose other belt stays keeps the tile under it');
}

/* ---------- E. DELETE LINE and a selection's belts ---------- */
{
  const s = fresh(), L = line(s);
  const I2 = add(s, 'intake', 32, 30), B9 = add(s, 'bay', 42, 30), O2 = add(s, 'outbox', 52, 30);
  s.assignPropAgent(B9, 'kai'); s.connectBelt(I2, B9); s.connectBelt(B9, O2);
  s.doc().props.find(p => p.id === O2).sendTo = L.I;   // LINE B sends on to LINE A
  const n0 = s.props().length, b0 = s.belts().length;
  const r = s.removeLine(L.B1);
  A.ok(r.ok && r.ids.length === 5 && s.props().length === n0 - 5, 'DELETE LINE takes every machine of the line');
  A.ok(!s.links().some(l => r.links.includes(l.id)) && s.belts().length < b0, '…and every belt between them');
  A.ok(s.propById(I2) && linkOf(s, I2, B9), '…and never another line');
  A.ok(!s.propById(O2).sendTo, 'a SEND TO pointing into the deleted line is let go');
  const u = s.undo();
  A.ok(u.label === 'LINE' && s.props().length === n0 && s.belts().length === b0 && s.propById(O2).sendTo === L.I, 'ONE undo puts the line, its belts and the SEND TO back (UNDID · LINE)');
  // a selection's belts: links by id + loose tiles, one undo inside a transact
  const k = linkOf(s, L.I, L.B1);
  const t = s.transact(() => { s.removeLinks([k.id], []); return s.removeProp(L.I); }, '2 PIECES');
  A.ok(t.ok && !s.links().some(l => l.id === k.id) && !s.propById(L.I), 'a selected belt goes whole with the selection, in one transact');
  A.ok(!s.belts().some(b => k.path.some(q => q.x === b.x && q.y === b.y)), '…every tile of it');
  A.eq(s.undo().label, '2 PIECES', 'one undo');
  const rb = s.removeLinks([k.id]);
  A.ok(rb.ok && s.undo().label === 'BELT', 'outside a transact removeLinks takes its own undo slot (UNDID · BELT)');
}

/* ---------- E3. final floor lane M30: an OLD SAVE's OUTBOX → INBOX belt is never pasted back as a belt ----------
   (DECISIONS: a hand-off is SEND TO, never a belt — a pasted one fused the two copied lines into ONE line, one budget.) The copy
   carries it the way convertHandoffBelt would: as that OUTBOX's SEND TO, re-pointed at the copy's own INBOX. */
{
  const s0 = fresh();
  const pl = [0, 1].map(i => { const r = LE.placeBlueprint(s0, 'research_line', { x: 34, y: 2 + i * 10 }); if (!r.ok) throw Error(JSON.stringify(r)); const of = t => r.ids.filter(id => s0.propById(id).t === t); return { I: of('intake')[0], O: of('outbox')[0], ids: r.ids }; });
  const d = JSON.parse(JSON.stringify(s0.serialize()));
  for (const p of d.props) if (p.id === pl[0].O || p.id === pl[1].I) p.t = 'bay';
  const ob = WM.deserialize(d); A.ok(ob.connectBelt(pl[0].O, pl[1].I).ok, 'old-save fixture: the pre-SEND TO belt');
  const saved = JSON.parse(JSON.stringify(ob.serialize())); for (const p of saved.props) { if (p.id === pl[0].O) p.t = 'outbox'; if (p.id === pl[1].I) p.t = 'intake'; }
  const s = WM.deserialize(saved); for (const p of s.props()) if (p.t === 'bay' && !p.agentId) s.assignPropAgent(p.id, 'ag_' + p.id);
  A.eq(s.oldHandoffBelts(pl[0].O).length, 1, 'the old OUTBOX → INBOX belt is on the floor');
  const before = JSON.stringify(s.serialize());
  const c = s.copyLines(pl[0].ids.concat(pl[1].ids));
  A.ok(c.ok && !c.clip.links.some(l => { const f = c.clip.nodes.find(n => n.oid === l.from.node), t = c.clip.nodes.find(n => n.oid === l.to.node); return f && t && f.t === 'outbox' && t.t === 'intake'; }), 'the clip carries no OUTBOX → INBOX belt');
  A.eq((c.clip.nodes.find(n => n.oid === pl[0].O) || {}).sendTo, pl[1].I, '…it carries that hand-off as the OUTBOX\'s SEND TO');
  let r = null; for (let y = 22; y <= 30 && !r; y++) for (let x = 32; x <= 50 && !r; x++) if (s.checkPaste(c.clip, x, y).ok) { const q = s.pasteLines(c.clip, x, y); if (q.ok) r = q; }
  A.ok(!!r, 'the two lines paste');
  const newO = r.ids.find(id => s.propById(id).t === 'outbox' && s.propById(id).sendTo), newI = r.ids.find(id => s.propById(id).t === 'intake' && s.propById(newO).sendTo === id);
  A.ok(!!newO && !!newI, 'the pasted OUTBOX sends to the pasted INBOX (SEND TO, re-pointed inside the copy)');
  A.ok(!(s.links() || []).some(l => r.ids.includes(l.from.prop) && s.propById(l.from.prop).t === 'outbox' && r.ids.includes(l.to.prop) && s.propById(l.to.prop).t === 'intake'), 'no new OUTBOX → INBOX belt was laid');
  A.eq(s.oldHandoffBelts(newO), [], 'oldHandoffBelts(pasted OUTBOX) is empty');
  const pp = plan(s);
  A.ok(pp.lineOfProp[newO] && pp.lineOfProp[newI] && pp.lineOfProp[newO] !== pp.lineOfProp[newI], 'the two pasted lines are two lines (two lineIds, two budgets)');
  A.ok(pp.sendTo && pp.sendTo[newO] && pp.sendTo[newO].intakeId === newI, '…joined by a compiled SEND TO');
  A.ok(s.undo().ok && JSON.stringify(s.serialize()) === before, 'one undo; the original floor (old belt and all) is untouched');
}
/* ---------- E5. REPAIR (M30 follow-up): an old hand-off belt that runs THROUGH A JUNCTION is never pasted back either ----------
   OUTBOX → MERGER → INBOX on an old save: the copy kept OUTBOX>MERGER and MERGER>INBOX (only a direct OUTBOX → INBOX belt was
   caught) and the paste fused the two copied lines into ONE. Every link the clip carries is judged by the floor's own end rule
   (no belt out of an OUTBOX, none into an INBOX); the junction left with no way through stays behind; the hand-off travels as
   that OUTBOX's SEND TO. Old belts that reach two INBOXes cannot be one SEND TO: they are left out, and counted. */
{
  const big = () => { const s = WM.create(); s.projectGeometry(); s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 140, y2: 80 } }); return s; };
  const add2 = (s, t, x, y) => s.addProp({ t, x, y, w: 2, h: 2, block: true }).id;
  function oldSave(targets) {
    const s0 = big();
    const A0 = [add2(s0, 'intake', 32, 4), add2(s0, 'bay', 42, 4), add2(s0, 'bay', 56, 4)];
    const Bs = targets.map((_, k) => [add2(s0, 'bay', 32, 24 + k * 14), add2(s0, 'bay', 42, 24 + k * 14), add2(s0, 'outbox', 56, 24 + k * 14)]);
    for (const L of [A0].concat(Bs)) for (let i = 1; i < 3; i++) A.ok(s0.connectBelt(L[i - 1], L[i]).ok, 'old-save fixture: a belt');
    for (const B of Bs) A.ok(s0.connectBelt(A0[2], B[0]).ok, 'old-save fixture: the pre-SEND TO belt');
    const l = s0.links().find(q => q.from.prop === A0[2] && q.to.prop === Bs[0][0]), t = l.path[Math.floor(l.path.length / 2)];
    const j = s0.junctionOnBelt(t.x, t.y, targets.length > 1 ? 'splitter' : 'merger', {});
    A.ok(j.ok, 'old-save fixture: a ' + (targets.length > 1 ? 'SPLITTER' : 'MERGER') + ' stands on the old belt — ' + (j.error || ''));
    const d = JSON.parse(JSON.stringify(s0.serialize()));
    for (const p of d.props) { if (p.id === A0[2]) p.t = 'outbox'; if (Bs.some(B => B[0] === p.id)) p.t = 'intake'; }
    const s = WM.deserialize(d); for (const p of s.props()) if (p.t === 'bay') s.assignPropAgent(p.id, 'ag_' + p.id);
    return { s, O: A0[2], I0: A0[0], Is: Bs.map(B => B[0]), J: j.id };
  }
  const ty = (s, id) => (s.propById(id) || {}).t;
  {
    const { s, O, I0, Is, J } = oldSave([0]);
    A.ok(s.links().some(q => q.from.prop === O && q.to.prop === J) && s.links().some(q => q.from.prop === J && q.to.prop === Is[0]), 'the old save: OUTBOX → MERGER → INBOX');
    const before = JSON.stringify(s.serialize());
    const c = s.copyLines(s.props().filter(p => /intake|bay|outbox|merger/.test(p.t)).map(p => p.id));
    A.ok(c.ok, 'it copies');
    const node = oid => c.clip.nodes.find(n => n.oid === oid);
    A.ok(!c.clip.links.some(l => (node(l.from.node) || {}).t === 'outbox' || (node(l.to.node) || {}).t === 'intake'), 'the clip carries no belt out of an OUTBOX and none into an INBOX');
    A.ok(!node(J), '…the MERGER left with no way through stays behind');
    A.eq((node(O) || {}).sendTo, Is[0], '…and the hand-off travels as that OUTBOX\'s SEND TO');
    A.eq(c.clip.oldBelts, 0, '(nothing left out: the old belt reached exactly one INBOX)');
    let r = null; for (let y = 50; y <= 66 && !r; y += 2) for (let x = 32; x <= 70 && !r; x += 2) if (s.checkPaste(c.clip, x, y).ok) { const q = s.pasteLines(c.clip, x, y); if (q.ok) r = q; }
    A.ok(!!r, 'the copy pastes');
    const mine = new Set(r.ids);
    A.ok(!s.links().some(q => (mine.has(q.from.prop) && ty(s, q.from.prop) === 'outbox') || (mine.has(q.to.prop) && ty(s, q.to.prop) === 'intake')), 'no pasted belt leaves an OUTBOX or enters an INBOX');
    const nO = r.map[O], nI = r.map[Is[0]], nFirst = r.map[I0], pl = plan(s);
    A.ok(pl.lineOfProp[nFirst] && pl.lineOfProp[nI] && pl.lineOfProp[nFirst] !== pl.lineOfProp[nI], 'the two pasted lines are two lines (were fused: one lineId)');
    A.ok(s.propById(nO).sendTo === nI && pl.sendTo && pl.sendTo[nO] && pl.sendTo[nO].intakeId === nI, '…joined by a compiled SEND TO');
    A.ok(s.undo().ok && JSON.stringify(s.serialize()) === before, 'one undo; the original floor (old belt, merger and all) is untouched');
  }
  {
    const { s, O, Is, J } = oldSave([0, 1]);
    const c = s.copyLines(s.props().filter(p => /intake|bay|outbox|splitter/.test(p.t)).map(p => p.id));
    const node = oid => c.clip.nodes.find(n => n.oid === oid);
    A.ok(c.ok && !node(J) && !(node(O) || {}).sendTo, 'old belts from one OUTBOX that reach two INBOXes (one through a SPLITTER) cannot be one SEND TO: the copy sends nowhere, the SPLITTER stays behind');
    A.eq(c.clip.oldBelts, 1, '…and the clip counts the old hand-off it left out (said on the COPY toast and the lead\'s card)');
    A.ok(!c.clip.links.some(l => (node(l.from.node) || {}).t === 'outbox' || (node(l.to.node) || {}).t === 'intake'), '…and carries none of it as a belt');
    const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8'), sb = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationbuilder.js'), 'utf8');
    A.ok(/if \(c\.oldBelts\) notes\.push\(/.test(build) && /if \(c\.clip\.oldBelts\) left\.push\(/.test(sb), 'the COPY toast and the lead\'s copy card say it');
    void Is;
  }
}
/* ---------- E4. final floor lane M32 / R30: one line-name key — a paste never makes two lines that SHOW the same name ----------
   setPropLabel refused 'Alpha 2' next to 'Line Alpha 2' (both show LINE ALPHA 2), but the paste numbered by raw labels and made
   exactly that pair. Every naming path now compares what the floor SHOWS (Pipeline.lineWord). */
{
  const s = fresh(), X = line(s);
  const Y = add(s, 'intake', 32, 20), YB = add(s, 'bay', 40, 20), YO = add(s, 'outbox', 50, 20);
  s.assignPropAgent(YB, 'nova'); A.ok(s.connectBelt(Y, YB).ok && s.connectBelt(YB, YO).ok, 'a second line');
  A.ok(s.setPropLabel(X.I, 'Alpha').ok && s.setPropLabel(Y, 'Line Alpha 2').ok, 'lines named Alpha and Line Alpha 2');
  A.eq(s.setPropLabel(X.I, 'Alpha 2').error, 'DUPLICATE_NAME', 'renaming Alpha to Alpha 2 is refused (it would show LINE ALPHA 2 twice)');
  A.eq(s.setPropLabel(X.I, 'Line: Alpha 2').error, 'DUPLICATE_NAME', '…and so is "Line: Alpha 2" (the shown word drops any "line" prefix)');
  A.eq(s.setPropLabel(X.I, 'LINE—Alpha 2').error, 'DUPLICATE_NAME', '…and "LINE—Alpha 2"');
  const c = s.copyLines(s.lineMembers(X.I).ids).clip;
  let r = null; for (let y = 28; y <= 36 && !r; y++) for (let x = 32; x <= 50 && !r; x++) if (s.checkPaste(c, x, y).ok) { const q = s.pasteLines(c, x, y); if (q.ok) r = q; }
  A.ok(!!r, 'the line pastes');
  const shown = s.props().filter(p => p.t === 'intake').map(p => P.lineWord(p.label, 'LINE ' + s.lineLetter(p.id)));
  A.eq(new Set(shown).size, shown.length, 'every line SHOWS a different name — ' + JSON.stringify(shown));
  A.eq(s.propById(r.ids.find(id => s.propById(id).t === 'intake')).label, 'Alpha 3', '…the paste is numbered past the shown LINE ALPHA 2');
  // an unnamed line SHOWS its letter: no typed name may take it
  const Z = add(s, 'intake', 70, 4), ZB = add(s, 'bay', 78, 4); s.assignPropAgent(ZB, 'atlas'); A.ok(s.connectBelt(Z, ZB).ok, 'an unnamed line');
  const letter = s.lineLetter(Z);
  A.eq(s.setPropLabel(Y, letter).error, 'DUPLICATE_NAME', 'naming a line "' + letter + '" while an unnamed line shows LINE ' + letter + ' is refused');
  A.eq(s.setPropLabel(Y, 'Line ' + letter).error, 'DUPLICATE_NAME', '…"Line ' + letter + '" too');
  A.ok(s.setPropLabel(Z, letter).ok, 'the unnamed line itself may take its own letter as its name');
}
/* ---------- F. the build.js wiring (source locks) ---------- */
{
  const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
  const fn = name => { const i = build.indexOf('function ' + name + '('); if (i < 0) return ''; const j = build.indexOf('\n  }\n', i); return build.slice(i, j + 4); };
  A.ok(build.length > 0, 'build.js reads');
  // the box takes belts, memoized per edit + rect (never re-walked per frame)
  const bib = fn('beltsInBox');
  A.ok(/const key = \[geoVer, r\.x1, r\.y1, r\.x2, r\.y2, \(ids \|\| \[\]\)\.join\(','\)\]\.join\('\|'\);/.test(bib) && /if \(beltBoxMemo && beltBoxMemo\.key === key\) return beltBoxMemo\.v;/.test(bib), 'the belts a box takes are memoized per edit + rect');
  A.ok(/sel\.has\(l\.from\.prop\) && sel\.has\(l\.to\.prop\)/.test(bib) && /path\.some\(q => inR\(q\.x, q\.y\)\)/.test(bib), '…every link with a tile inside it, and every link whose two ends are selected');
  A.ok(/beltsInBox\(r, all\)/.test(fn('commitBox')) && /drawBeltCells\(t, bb\.cells, /.test(fn('drawSelectBox')), 'the box shows the belts it will take, and takes them');
  A.ok(/selBelts\.key !== selectionIds\(\)\.join\(','\)/.test(fn('beltSel')), 'the belts ride with exactly the selection that took them — another selection lets them go');
  A.ok(/if\(selBelts\)\{const bs=beltSel\(\);if\(bs\)drawBeltCells\(t,bs\.cells,/.test(fn('drawHover')), 'a selection\'s belts are drawn gold with it');
  // a whole line
  A.ok(/cv\.addEventListener\('dblclick', onDblClick\);/.test(build) && /selectWholeLine\(p\.id, ev\);/.test(fn('onDblClick')), 'a double-click on a conveyor piece takes its whole line');
  A.ok(/ev&&ev\.pointerType==='touch'&&CONNECT_TYPES\[p\.t\]/.test(fn('onInspect')) && /tNow-lastTap\.t<380/.test(fn('onInspect')), '…a double-TAP does the same (touch has no dblclick to rely on)');
  A.ok(/setSelection\(m\.ids, \{ links: m\.links, tiles: \[\] \}\);/.test(fn('selectWholeLine')), '…its machines AND its belts');
  const gc = fn('renderGroupCard');
  A.ok(/key\(line \? 'COPY LINE' : 'COPY', 'Ctrl\+C'/.test(gc) && /if \(line\) key\('DELETE LINE', 'Del', \(\) => deleteLine\(line\.id, orientEv\(\)\)/.test(gc) && /key\('CUT', 'Ctrl\+X'/.test(gc), 'the group card: COPY / CUT / DELETE — and for exactly one whole line, COPY LINE / DELETE LINE');
  A.ok(/station\.removeLine\(pid\)/.test(fn('deleteLine')), 'DELETE LINE is the model\'s removeLine (one undo; a SEND TO into it is let go)');
  A.ok(/addKey\('WHOLE LINE','dbl-click'/.test(fn('renderSelection')), 'a single conveyor piece\'s card has WHOLE LINE (the double-click, as a key — touch and discoverability)');
  // the clip
  A.ok(/station\.copyLines\(ids, \{ agent: agentHere, turns: t => canTurn\(t\) \}\)/.test(fn('clipOfSelection')), 'a clip carries only crew this station has (agentHere)');
  // (repair 2026-10-11: a whole line cuts through removeLine — the card's DELETE LINE, under a CUT undo slot)
  A.ok(/if \(cut && !\(whole \? deleteLine\(whole\.id, ev, 'CUT'\) : deleteGroup\(ev, 'CUT'\)\)\) return true;/.test(fn('copyClip')) && fn('copyClip').indexOf('clipOfSelection()') < fn('copyClip').indexOf("deleteGroup(ev, 'CUT')"), 'CUT copies first, then takes it up (one undo) — a refused cut holds nothing');
  const clb = fn('cutLeavesBehind');
  A.ok(/cutLeavesBehind\(ps\)/.test(fn('copyClip')) && /NOT CARRIED: /.test(fn('copyClip')) && /THE PROJECT FOLDER/.test(clb) && /ANY SCHEDULE OR WEBHOOK ON /.test(clb) && /CONNECTOR \/ PLUGIN BINDS/.test(clb) && /DESK OWNERS/.test(clb), 'a CUT says what its paste cannot bring back (project folder, schedules / webhooks, binds, desk owners) — never silent');
  const dg = fn('deleteGroup');
  A.ok(/station\.removeLinks\(liftIds, loose, \{ junctions: was\.filter\(p => JUNCTION_TAG_TYPES\[p\.t\]\)\.map\(p => p\.id\) \}\)/.test(dg), 'a selection DELETE / CUT takes the belt under each junction it removes');
  A.ok(/const liftIds = cut \? cutLinksOf\(was\.map\(p => p\.id\)\) : \(bs \? bs\.links : \[\]\), loose = cut \? \[\] : \(bs \? bs\.tiles : \[\]\);/.test(dg), 'a CUT takes up only the belts its clip carries — never a crossed belt it cannot bring back');
  A.ok(/if \(groupIds\.length\) return deleteGroupOrLine\(ev\);/.test(fn('deleteSelected')) && /return line \? deleteLine\(line\.id, ev\) : deleteGroup\(ev\);/.test(fn('deleteGroupOrLine')), 'Del on exactly one whole line IS the card DELETE LINE (removeLine: its belts, its junction tiles, a SEND TO into it)');
  A.ok(/line = lineSelectionOf\(ps\)/.test(fn('renderGroupCard')), '…and the card offers DELETE LINE for exactly that selection (a box that took another belt too is a group)');
  A.ok(/if \(p && dupe\.type !== 'lines'\) \{ onInspect\(p, ev\); return; \}/.test(fn('onDown')), 'a click with a CLIP in hand keeps the ghost promise (lays it out near here) even over a machine');
  const cg = fn('clipGhost');
  A.ok(/key = \[geoVer, dupe\.cid, dupe\.rot \| 0, ax, ay\]\.join\('\|'\)/.test(cg) && /if \(clipGhostMemo && clipGhostMemo\.key === key\) return clipGhostMemo\.g;/.test(cg), 'the paste ghost is memoized per edit + clip + turn + spot (H9)');
  A.ok(/if \(v && v\.ok\) \{ const pr = station\.probePaste\(/.test(cg), '…the probe (a clone) runs only where the pure check already said yes');
  const dcg = fn('drawClipGhost');
  A.ok(/drawBeltPreview\(t, \{ path: good \}, GOOD\)/.test(dcg) && !/convey\.drawBelts/.test(dcg) && !/station\./.test(dcg), 'the paste ghost is drawn geometry off the memo — never convey.drawBelts, never a model call per frame');
  A.ok(/if \(g\.clip\) \{ drawClipGhost\(t, now, g\); return; \}/.test(build) && /if \(dupe\.type === 'lines'\) return clipGhost\(tx, ty\);/.test(fn('dupeGhost')) && /if \(dupe\.type === 'lines'\) return pasteClipAt\(w, ev\);/.test(fn('stampDupe')), 'a clip rides the COPY tool\'s own stamp (dupe.type \'lines\')');
  const pca = fn('pasteClipAt');
  // (wave 2, build-04: the layout near the click is ONE function, layClipNear — the ghost's off-frame probe and the click both ask it,
  //  and the click lays the very answer the ghost showed when it has one)
  A.ok(/station\.pasteLines\(c, ax, ay, \{ agent: agentHere \}\)/.test(pca) && /lay = known \|\| layClipNear\(c, w\);/.test(pca) && /LineEdit\.layoutGraphNear\(station, gr\.graph, \{ x: at\.tx, y: at\.ty \}\)/.test(fn('layClipNear'))
    && /station\.pasteLinesLaid\(c, lay\.L, \{ agent: agentHere \}\)/.test(pca), 'a click lays it exactly — else laid out to fit near the click — else refused, said');
  const key = fn('onKey');
  A.ok(/tool === 'dupe' && dupe && dupe\.type === 'lines' && !\(ev\.ctrlKey \|\| ev\.metaKey\)\) \{ ev\.preventDefault\(\); turnClip\(ev\.shiftKey \? 3 : 1, orientEv\(\)\); return; \}/.test(key) && key.indexOf('turnClip(') < key.indexOf('turnUnderCursor('), 'R turns a clip in hand (before R turns a prop)');
  A.ok(/\(ev\.key === 'x' \|\| ev\.key === 'X'\)\) \{ ev\.preventDefault\(\); cutSelected\(orientEv\(\)\); return; \}/.test(key) && /if \(held\.type === 'lines'\) \{ holdClip\(held, orientEv\(\)\); return; \}/.test(key), 'Ctrl+X cuts; Ctrl+V picks a clip up again');
  A.ok(/if \(selBelts\) \{ setSelection\(\[\]\); return; \}/.test(key), 'Esc lets go of a selection of belts alone');
  A.ok(/\['Double-click', 'a whole line'\]/.test(build) && /\['Ctrl \+ C · X · V', 'copy · cut · paste'\]/.test(build), 'the Edit tab teaches the double-click and the clipboard');
  const tut = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'tutorial.js'), 'utf8');
  A.ok(/fmEntry\(null, 'Select, copy &amp; paste', /.test(tut) && /Double-click a conveyor piece to select its whole line/.test(tut), '…and so does the Field Manual');
}

A.report('build-clip.test');
