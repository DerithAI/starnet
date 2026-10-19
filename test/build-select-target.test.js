/* test/build-select-target.test.js — SELECT MOVES refine (10-11): ONE GESTURE, THE TARGET DECIDES.
   The review's trap: clicking a machine (to crew it in its Workflow panel) leaves it selected, and the next drag — meant to lay a
   belt — MOVED it instead. The fix makes the obvious gesture work: a SELECTED lone conveyor machine dragged onto ANOTHER conveyor
   machine (or a belt the hand would merge into) is THE HAND's belt / SEND TO — the same plan, ghost and commit as an unselected
   drag — and over open floor it stays a MOVE. Shift held = a move, always; furniture and groups never belt.
   Driven for real: build.js's own onMove / onUp / upCommit / the hand's planner and commits run in a VM against a live WorldModel
   (the drag object is the one onDown makes for a press on a piece), so the modes, the plans and the floor after the release are the
   real ones — never a re-implementation. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const vm = require('vm');
const WM = require('../frontend/app/worldmodel.js');

const src = fs.readFileSync(require.resolve('../frontend/app/build.js'), 'utf8');
const between = (start, end) => {
  const i = src.indexOf(start), j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error('build.js seam moved: ' + start + ' … ' + end);
  return src.slice(i, j);
};
const line1 = re => { const m = src.match(re); if (!m) throw new Error('build.js line moved: ' + re); return m[0] + '\n'; };
const CODE = line1(/const CONNECT_TYPES = [^\n]+/) + line1(/const JUNCTION_TAG_TYPES = [^\n]+/) + line1(/const CLICK_SLOP = [^\n]+/)
  + line1(/const isWorkflowType = [^\n]+/) + line1(/const propRect = [^\n]+/)
  + between('function onMove(ev) {', 'function onCancel()')                         // onMove · onUp · upCommit
  + between('function commitPropMove(d, ev) {', 'function commitPaint(d, ev) {')
  + between('const HAND_PLAN_MODES', '// R mid-drag: the corner turns')             // beltSource · selectedDragAims · handPlan · planHandGesture
  + between('const pathRects = path =>', '/* PICK WHAT GOES HERE')                 // commitHandGesture
  + between('function beltsLeftBehind(', 'function ghostInfo()')                    // beltsLeftBehind · moveMsg
  + between('let sendPvKey = null', '// a line as the floor names it')              // sendToPv (the one SEND TO verdict)
  + (src.indexOf('function intakeAt(') >= 0 ? between('function intakeAt(', 'function commitSendTo(') : '')   // (intakeAt is gone with the propmove SEND TO — build-13)
  + between('function commitSendTo(', '// the arc from an OUTBOX')                    // commitSendTo
  + between('function releaseDrag() {', 'let dupe = null;');                         // releaseDrag (every non-release way out of a drag)

function rig() {
  const s = WM.create(); s.projectGeometry();
  s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 70, y2: 30 } });
  const add = (t, x, y) => { const big = t === 'bay' || t === 'intake' || t === 'outbox'; return s.addProp({ t, x, y, w: big ? 2 : 1, h: big ? 2 : 1, block: big }).id; };
  // line 1: INBOX → BAY → BAY → OUTBOX along y=4; line 2: INBOX → BAY → OUTBOX along y=24; two loose BAYs between them
  const I = add('intake', 32, 4), B1 = add('bay', 40, 4), B2 = add('bay', 48, 4), O = add('outbox', 58, 4);
  const I2 = add('intake', 32, 24), B4 = add('bay', 40, 24), O2 = add('outbox', 48, 24);
  for (const [a, b] of [[I, B1], [B1, B2], [B2, O], [I2, B4], [B4, O2]]) A.ok(s.connectBelt(a, b).ok, 'rig: belt ' + a + '→' + b);
  const B3 = add('bay', 40, 13), B5 = add('bay', 52, 13), SP = add('splitter', 60, 13), CH = s.addProp({ t: 'chair', x: 36, y: 16, w: 1, h: 1 }).id;
  const said = [];
  const ctx = {
    station: s, geoVer: 1, flipPref: false, drag: null, dragPid: null, lastClient: { x: 0, y: 0 },
    tool: 'select', hand: null, touchArm: null, dropPick: null, selectedPropId: null, groupIds: [], selectedRoomId: null,
    hoverHandle: -1, hoverPropId: null, hoverRoomId: null, hoverTile: null, panX: 0, panY: 0,
    cv: { style: { cursor: '' }, releasePointerCapture() {} },
    NO_ROUTE: {}, machineName: id => id, propLabel: t => String(t).toUpperCase(), lineOfProp: () => null, sendName: id => 'LINE ' + id,
    linkedFloor: () => !!s.isLinked(), toWorldTile: ev => ({ tx: ev.tx, ty: ev.ty }), toCanvas: () => ({ x: 0, y: 0 }),
    snapTick() {}, setCursor() {}, rasterTo() {}, roomHandleAt: () => null, propAtEvent: () => null, cursorFor: () => 'default',
    showPropCard() {}, hidePropCard() {}, hideTip() {}, sfx() {}, paintHandKeys() {}, pushFlash() {}, landProps() {}, renderSelection() {},
    setSelection(ids) { ctx.selectedPropId = ids[0] || null; },
    flashTip: (ev, msg, ok) => said.push((ok ? 'OK ' : 'NO ') + msg),
    feedback: (res, ev, okMsg) => said.push(res && res.ok ? 'OK ' + okMsg : 'NO ' + ((res && (res.msg || res.error)) || 'refused')),
    openDropPick: () => said.push('PICK'), onInspect() {}, toggleInSelection() {}, openBeltCard() {}, commitGroupMove() {},
    clickEmptyFloor() {}, commitBox() {}, commitRoomResize() {}, commitDraw() {}, commitMove() {}, commitPropStamp() {}, commitBeltRun() {}, commitPaint() {}, commitReclaim() {}
  };
  vm.createContext(ctx);
  vm.runInContext(CODE, ctx);
  return { s, ctx, said, I, B1, B2, O, I2, B4, O2, B3, B5, SP, CH };
}
const pos = (s, id) => { const p = s.propById(id); return p.x + ',' + p.y; };
const links = s => (s.links() || []).map(l => l.from.prop + '>' + l.to.prop).sort().join(' ');
const tileOf = (s, id) => { const p = s.propById(id); return [p.x, p.y]; };
/* press on piece `id` (as onDown makes it: sel = it is THE selected piece, add = Shift), move through `tiles`, let go on the last */
function drag(R, id, tiles, o) {
  const { ctx } = R, [tx, ty] = tileOf(R.s, id), shift = !!(o && o.shift);
  ctx.geoVer++;   // (build.js bumps geoVer on every edit; the memo keys read it)
  ctx.drag = { mode: 'selectpress', propId: id, start: { tx, ty }, cur: { tx, ty }, moved: false, add: shift, cx: tx * 100, cy: ty * 100, sel: id === ctx.selectedPropId };
  const modes = [], plans = [];
  for (const [x, y] of tiles) {
    ctx.onMove({ tx: x, ty: y, clientX: x * 100, clientY: y * 100, shiftKey: shift });
    modes.push(ctx.drag.mode);
    plans.push(ctx.drag.mode === 'handbelt' ? ctx.handPlan(ctx.drag) : null);
  }
  if (!(o && o.hold)) { const [x, y] = tiles[tiles.length - 1]; ctx.onUp({ tx: x, ty: y, clientX: x * 100, clientY: y * 100, pointerId: 1 }); }
  return { modes, plans };
}

/* 1. the trap, fixed: a SELECTED BAY (just clicked to crew it) dragged across open floor onto the next BAY — the ghost is the MOVE over
      the floor and THE HAND's belt over the BAY; the release lays the belt, the BAY never moved, one undo takes it back */
{
  const R = rig(), { s, ctx } = R;
  ctx.selectedPropId = R.B3;
  const before = links(s), at = pos(s, R.B3);
  const g = drag(R, R.B3, [[45, 13], [52, 13]]);
  A.eq(g.modes, ['propmove', 'handbelt'], 'over open floor the selected BAY moves; over the next BAY the drag is THE HAND');
  A.ok(g.plans[1] && g.plans[1].ok && g.plans[1].kind === 'connect', 'the ghost is the hand\'s green CONNECT verdict');
  A.eq(pos(s, R.B3), at, 'the selected BAY did not move');
  A.ok(links(s) === before + ' ' + R.B3 + '>' + R.B5 || links(s).split(' ').includes(R.B3 + '>' + R.B5), 'the belt BAY → next BAY is laid');
  A.ok(/^OK CONNECTED TO /.test(R.said[R.said.length - 1]), 'the floor says CONNECTED (the hand\'s own words)');
  A.eq(ctx.selectedPropId, R.B3, 'it stays selected (its Workflow panel keeps its BAY)');
  s.undo();
  A.eq(links(s), before, 'ONE undo takes the belt back');
  A.eq(pos(s, R.B3), at, '…and the BAY is where it always was');
}
/* 2. preview == commit, selected or not: the selected drag's plan IS the unselected drag's plan, tile for tile */
{
  const R1 = rig(), R2 = rig();
  R1.ctx.selectedPropId = R1.B3;
  const sel = drag(R1, R1.B3, [[45, 13], [52, 13]], { hold: true }), un = drag(R2, R2.B3, [[45, 13], [52, 13]], { hold: true });
  A.eq(un.modes, ['handbelt', 'handbelt'], 'an UNSELECTED BAY is the hand the moment it moves (unchanged)');
  A.eq(JSON.stringify(sel.plans[1]), JSON.stringify(un.plans[1]), 'over the BAY the selected drag shows exactly the unselected drag\'s plan');
}
/* 3. over open floor it stays a MOVE — and its belts ride along */
{
  const R = rig(), { s, ctx } = R;
  ctx.selectedPropId = R.B1;
  const before = links(s);
  const g = drag(R, R.B1, [[40, 9], [44, 9]]);
  A.eq(g.modes, ['propmove', 'propmove'], 'a selected BAY over open floor is a MOVE all the way');
  A.eq(pos(s, R.B1), '44,9', 'let go on open floor: it moved');
  A.eq(links(s), before, '…with the same belts, re-laid (nothing lost, nothing new)');
}
/* 4. Shift held = a move, always (a red move ghost over the BAY, refused, nothing laid) */
{
  const R = rig(), { s, ctx } = R;
  ctx.selectedPropId = R.B3;
  const before = links(s), at = pos(s, R.B3);
  const g = drag(R, R.B3, [[45, 13], [52, 13]], { shift: true });
  A.eq(g.modes, ['propmove', 'propmove'], 'Shift+drag of the selected BAY never turns into a belt');
  A.eq(pos(s, R.B3), at, 'the move onto the other BAY is refused (overlap) — it stays');
  A.eq(links(s), before, 'and no belt was laid');
}
/* 5. furniture never belts, and a group never takes the single-machine rule */
{
  const R = rig(), { s, ctx } = R;
  ctx.selectedPropId = R.CH;
  const g = drag(R, R.CH, [[38, 16], [40, 13]], { hold: true });
  A.eq(g.modes, ['propmove', 'propmove'], 'a selected chair dragged onto a BAY is a move (red), never a belt');
  ctx.groupIds = [R.B3, R.B5];
  A.eq(ctx.selectedDragAims({ propId: R.B3 }, { tx: 40, ty: 24 }, false), false, 'a member of a selected group: the group moves (groupmove), never the hand');
  ctx.groupIds = [];
  A.eq(ctx.selectedDragAims({ propId: R.B3 }, { tx: 40, ty: 24 }, false), true, '…the same machine alone over another BAY: the hand');
  A.eq(ctx.selectedDragAims({ propId: R.B3 }, { tx: 41, ty: 14 }, false), false, 'over its own footprint: still the move');
}
/* 6. OUTBOX → another line's INBOX = SEND TO, selected or not; and the loop is refused in the SEND TO verdict's own words */
{
  const R = rig(), { s, ctx } = R;
  ctx.selectedPropId = R.O2;
  const g = drag(R, R.O2, [[44, 20], [32, 4]]);
  A.eq(g.modes, ['propmove', 'handbelt'], 'the selected OUTBOX moves over the floor and aims over the INBOX');
  A.ok(g.plans[1] && g.plans[1].ok && g.plans[1].kind === 'send', 'the ghost is the SEND TO verdict');
  A.eq(s.propById(R.O2).sendTo, R.I, 'let go: line 2 sends its finished work to line 1');
  A.eq(pos(s, R.O2), '48,24', '…and the OUTBOX stayed where it stands');
  // now line 1's OUTBOX onto line 2's INBOX would send work round in a circle
  ctx.selectedPropId = R.O;
  const at = pos(s, R.O), before = JSON.stringify(s.serialize());
  const h = drag(R, R.O, [[56, 10], [32, 24]]);
  A.eq(h.modes[1], 'handbelt', 'over the INBOX the selected OUTBOX is the hand');
  A.ok(h.plans[1] && h.plans[1].ok === false && /A LOOP/.test(h.plans[1].why), 'the ghost goes RED with the loop refusal: ' + (h.plans[1] && h.plans[1].why));
  A.eq(JSON.stringify(s.serialize()), before, 'let go on the red verdict: nothing changes');
  A.eq(pos(s, R.O), at, '…the OUTBOX did not move');
  A.ok(/^NO A LOOP/.test(R.said[R.said.length - 1]), 'the floor says why, in the same words');
}
/* 7. a belt the hand would MERGE into counts as a target; a junction's move onto a line stays its own move */
{
  const R = rig(), { s, ctx } = R;
  const l = (s.links() || []).find(x => x.from.prop === R.B1 && x.to.prop === R.B2), mid = l.path[Math.floor(l.path.length / 2)];
  ctx.selectedPropId = R.B3;
  ctx.geoVer++;
  const pv = ctx.handPlan({ mode: 'handbelt', propId: R.B3, moved: true, cur: { tx: mid.x, ty: mid.y } });
  A.ok(pv && pv.ok && pv.kind === 'merge', 'rig: the hand would merge B3 into the line\'s belt at ' + mid.x + ',' + mid.y);
  const g = drag(R, R.B3, [[45, 10], [mid.x, mid.y]]);
  A.eq(g.modes, ['propmove', 'handbelt'], 'the selected BAY over a belt it would merge into is the hand');
  A.ok(links(s).split(' ').some(k => k.startsWith(R.B3 + '>')), 'let go: merged (B3 belts into the MERGER that landed on the belt)');
  ctx.selectedPropId = R.SP;
  A.eq(ctx.selectedDragAims({ propId: R.SP }, { tx: l.path[1].x, ty: l.path[1].y }, false), false, 'a selected SPLITTER over a belt keeps its move (a junction goes ON a line)');
}
/* 9. NO CIRCLE BUT A LOOP'S (found live on this lane: BAY p20 onto BAY p19, which feeds it, went green and laid the belt): the hand's
      ghost goes RED with the circle's words — selected or not, connect or re-route — and the release lays nothing */
{
  const R = rig(), { s, ctx } = R;
  A.ok(s.connectBelt(R.B3, R.B5).ok, 'rig: B3 → B5');
  const words = 'A CIRCLE — THAT BAY ALREADY HANDS WORK BACK TO THIS BAY · USE A LOOP TO SEND WORK BACK';
  for (const sel of [false, true]) {
    ctx.selectedPropId = sel ? R.B5 : null;
    const before = links(s), at = pos(s, R.B5), tag = sel ? ' (selected)' : ' (unselected)';
    const g = drag(R, R.B5, [[46, 13], [40, 13]]);
    A.eq(g.modes[1], 'handbelt', 'over the BAY that feeds it the drag is the hand' + tag);
    A.ok(g.plans[1] && g.plans[1].ok === false && g.plans[1].why === words, 'the ghost is RED with the circle\'s words' + tag + ': ' + (g.plans[1] && g.plans[1].why));
    A.eq(links(s), before, 'let go: no belt laid' + tag);
    A.eq(pos(s, R.B5), at, '…nothing moved' + tag);
    A.eq(R.said[R.said.length - 1], 'NO ' + words, 'the floor says why, in the ghost\'s words' + tag);
  }
  // RE-ROUTE: line 1's last BAY (its one exit is the OUTBOX) dragged back onto the BAY that feeds it
  ctx.selectedPropId = null;
  const before = links(s);
  const h = drag(R, R.B2, [[45, 9], [40, 4]]);
  A.ok(h.plans[1] && h.plans[1].ok === false && h.plans[1].why === words, 'a re-route that would close a circle is red too: ' + (h.plans[1] && h.plans[1].why));
  A.eq(links(s), before, '…and lays nothing');
}
/* 10. an OLD SAVE's OUTBOX → INBOX belt (final floor lane M20): the hand's ghost says what the BELT tool and setSendTo say —
       CONVERT THE OLD BELT TO SEND TO — never "THAT INBOX STARTS THIS SAME LINE" (the old belt makes the two one component) */
{
  const LE = require('../frontend/app/lineedit.js');
  const s0 = WM.create(); s0.projectGeometry(); s0.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 120, y2: 60 } });
  const pl = [0, 1].map(i => { const r = LE.placeBlueprint(s0, 'research_line', { x: 50, y: 8 + i * 14 }); if (!r.ok) throw Error(JSON.stringify(r)); const of = t => r.ids.filter(id => s0.propById(id).t === t); return { I: of('intake')[0], O: of('outbox')[0] }; });
  const d = JSON.parse(JSON.stringify(s0.serialize()));
  for (const p of d.props) if (p.id === pl[0].O || p.id === pl[1].I) p.t = 'bay';
  const ob = WM.deserialize(d); A.ok(ob.connectBelt(pl[0].O, pl[1].I).ok, 'rig: the old pre-SEND TO belt');
  const saved = JSON.parse(JSON.stringify(ob.serialize())); for (const p of saved.props) { if (p.id === pl[0].O) p.t = 'outbox'; if (p.id === pl[1].I) p.t = 'intake'; }
  const s = WM.deserialize(saved);
  A.eq(s.oldHandoffBelts(pl[0].O).length, 1, 'rig: the old OUTBOX → INBOX belt is on the floor');
  const ctx = { station: s, geoVer: 1, flipPref: false, NO_ROUTE: {}, machineName: id => id, propLabel: t => String(t).toUpperCase(),
    lineOfProp: () => ({ key: 'one-component' }), sendName: id => 'LINE ' + id, linkedFloor: () => !!s.isLinked() };
  vm.createContext(ctx); vm.runInContext(CODE, ctx);
  const O = s.propById(pl[0].O), I = s.propById(pl[1].I);
  const pv = ctx.handPlan({ mode: 'handbelt', propId: O.id, moved: true, cur: { tx: I.x, ty: I.y } });
  A.ok(pv && pv.ok === false && pv.why === 'CONVERT THE OLD BELT TO SEND TO', 'the hand ghost over the old belt\'s INBOX offers the conversion — ' + JSON.stringify(pv && pv.why));
  A.eq(pv.why, s.sendToRefusal(O.id, I.id).short, '…in the words setSendTo and the BELT tool use');
}
/* 8. the source wiring: one line in onMove, the old "deselect first" teaching gone */
{
  const mv = between('function onMove(ev) {', 'function onUp(ev) {');
  A.ok(/if \(drag\.sel && !drag\.add && \(drag\.mode === 'propmove' \|\| drag\.mode === 'handbelt'\)\) drag\.mode = selectedDragAims\(drag, w, ev\.shiftKey\) \? 'handbelt' : 'propmove';/.test(mv)
    && mv.indexOf('selectedDragAims(drag') > mv.indexOf("if(drag.mode==='selectpress'&&drag.moved&&slipped)") && mv.indexOf('selectedDragAims(drag') < mv.indexOf("cv.style.cursor = 'move'"),
    'the target is asked on every move, after the press becomes a drag and before the cursor is said');
  const all = src + fs.readFileSync(require.resolve('../frontend/app/tutorial.js'), 'utf8') + fs.readFileSync(require.resolve('../frontend/app/workflowpanel.js'), 'utf8');
  A.ok(!/ORPHAN_SOURCE_SELECTED|DESELECT, THEN DRAG|deselect it first|deselect the SPLITTER|it was selected, so the drag MOVED it|lay a belt \(if unselected\)|DRAG ON FROM IT, THEN CLICK/.test(all),
    'no copy tells the user to deselect before belting any more');
}

/* ---------- wave 2 (release review, floor lane) ---------- */
/* 11. build-20: a click on a GROUP member that drifts across a tile edge is still a click (it moved the whole line one tile) */
{
  const R = rig(), { s, ctx } = R;
  const moved = [], looked = [];
  ctx.commitGroupMove = d => moved.push(d.cur.tx - d.start.tx);
  ctx.onInspect = p => looked.push(p && p.id);
  ctx.groupIds = [R.B1, R.B2];
  const [tx, ty] = tileOf(s, R.B1);
  // the press as onDown makes it (source lock below): where the pointer went down rides along
  ctx.drag = { mode: 'grouppress', propId: R.B1, start: { tx, ty }, cur: { tx, ty }, moved: false, add: false, cx: 1000, cy: 1000 };
  ctx.onMove({ tx: tx + 1, ty, clientX: 1004, clientY: 1001, shiftKey: false });
  A.eq(ctx.drag.mode, 'grouppress', 'a 4 px jitter across a tile seam is not a group move');
  ctx.onUp({ tx: tx + 1, ty, clientX: 1004, clientY: 1001, pointerId: 1 });
  A.eq([moved, looked], [[], [R.B1]], '…let go: the BAY is focused, nothing moved, no undo slot spent');
  ctx.drag = { mode: 'grouppress', propId: R.B1, start: { tx, ty }, cur: { tx, ty }, moved: false, add: false, cx: 1000, cy: 1000 };
  ctx.onMove({ tx: tx + 1, ty, clientX: 1006, clientY: 1000, shiftKey: false });
  ctx.onMove({ tx: tx + 2, ty, clientX: 1030, clientY: 1000, shiftKey: false });
  A.eq(ctx.drag.mode, 'groupmove', 'past the 12 px slop it is the group move');
  ctx.onUp({ tx: tx + 2, ty, clientX: 1030, clientY: 1000, pointerId: 1 });
  A.eq(moved, [2], '…by the full tile delta from the press');
  const down = between('function onDown(ev) {', 'const CLICK_SLOP');
  A.eq((down.match(/mode: ?'grouppress',[^}]*cx: ?ev\.clientX, ?cy: ?ev\.clientY/g) || []).length, 2, 'both group presses onDown makes carry where the pointer went down');
  A.ok(/if\(drag\.mode==='grouppress'&&drag\.moved&&slipped\)drag\.mode='groupmove';/.test(between('function onMove(ev) {', 'function onUp(ev) {')), '…and onMove asks the slop before a group moves');
}
/* 12. build-16: a Ctrl+press on a belt is a press — a click opens its card, only a real drag reshapes */
{
  const R = rig(), { s, ctx } = R;
  const cards = [];
  ctx.openBeltCard = (x, y) => cards.push(x + ',' + y);
  const l = (s.links() || []).find(x => x.from.prop === R.B1 && x.to.prop === R.B2), t = l.path[2];
  const before = JSON.stringify(s.links()), undo = s.canUndo();
  const press = () => ({ mode: 'reshapepress', linkId: l.id, from: { x: t.x, y: t.y }, start: { tx: t.x, ty: t.y }, cur: { tx: t.x, ty: t.y }, moved: false, cx: t.x * 100, cy: t.y * 100 });
  ctx.drag = press();
  ctx.onMove({ tx: t.x, ty: t.y + 1, clientX: t.x * 100, clientY: t.y * 100 + 5, shiftKey: false });
  A.eq(ctx.drag.mode, 'reshapepress', 'a Ctrl+click that drifts 5 px across a tile edge stays a press');
  ctx.onUp({ tx: t.x, ty: t.y + 1, clientX: t.x * 100, clientY: t.y * 100 + 5, pointerId: 1 });
  A.eq(cards, [t.x + ',' + t.y], '…let go: the belt card opens');
  A.ok(JSON.stringify(s.links()) === before && s.canUndo() === undo, '…and no RESHAPE BELT was committed (no undo slot)');
  ctx.drag = press();
  ctx.onMove({ tx: t.x, ty: t.y + 2, clientX: t.x * 100, clientY: t.y * 100 + 40, shiftKey: false });
  A.eq(ctx.drag.mode, 'beltreshape', 'past the slop it is the reshape');
  ctx.drag = null;
  const down = between('function onDown(ev) {', 'const CLICK_SLOP');
  A.ok(/mode:'reshapepress',linkId:matches\[0\]\.id/.test(down) && /if\(matches\.length>1\)\{sfx\('bad'\);flashTip\(ev,'THIS TILE CARRIES '\+matches\.length\+' BELTS — CTRL\+DRAG A TILE ONLY ONE BELT RIDES TO RESHAPE IT',false\);return;\}/.test(down)
    && /if\(matches\.length===1\)\{/.test(down), 'a Ctrl+press on a loose / unlinked belt falls through to the belt card (it said THIS TILE CARRIES 0 BELTS); two belts on the tile say how to pick one');
  A.ok(/\['Ctrl \+ drag a belt', 'reshape it'\]/.test(src) && /Ctrl\+drag reshapes it/.test(src), 'the gesture is on the key list and on the belt card');
}
/* 13. build-10: R's corner flip belongs to the drag it was pressed in — every way that drag ends consumes it */
{
  const R = rig(), { s, ctx } = R;
  A.ok(s.connectBelt(R.B3, R.B5).ok, 'rig: B3 → B5');
  ctx.flipPref = true;
  const g = drag(R, R.B5, [[46, 13], [40, 13]]);
  A.ok(g.plans[1] && g.plans[1].ok === false, 'rig: let go on a red verdict (a circle)');
  A.eq(ctx.flipPref, false, 'a refused release consumes the flip (the next drag started flipped)');
  ctx.flipPref = true;
  drag(R, R.B3, [[46, 16], [40, 13]]);   // out over the floor and back onto the machine it left: let go where it started
  A.eq(ctx.flipPref, false, 'a drag let go where it started consumes it too');
  ctx.flipPref = true;
  ctx.drag = { mode: 'handbelt', propId: R.B3, start: { tx: 40, ty: 13 }, cur: { tx: 46, ty: 16 }, moved: true };
  ctx.releaseDrag();   // Esc / right-click / pointercancel / blur
  A.eq(ctx.flipPref, false, '…and so does a hand drag dropped any other way');
  ctx.flipPref = true;
  ctx.drag = { mode: 'propmove', propId: R.CH, start: { tx: 36, ty: 16 }, cur: { tx: 38, ty: 16 }, moved: true };
  ctx.releaseDrag();
  A.eq(ctx.flipPref, true, 'a dropped MOVE leaves the CORNER key armed for the next belt drag (it never used it)');
}
/* 13b. build-10 (wave 2 repair): a SELECTED piece's drag that was a belt when R was pressed and turned back into a MOVE before the
   release (the target decides, tile by tile) still uses the flip up — the MOVE's commit never reset it, so CORNER stayed lit and the
   next, unrelated belt drag turned its corner the flipped way */
{
  const R = rig(), { s, ctx } = R;
  const press = () => {
    const [tx, ty] = tileOf(s, R.B3);
    ctx.selectedPropId = R.B3; ctx.geoVer++;
    ctx.drag = { mode: 'selectpress', propId: R.B3, start: { tx, ty }, cur: { tx, ty }, moved: false, add: false, cx: tx * 100, cy: ty * 100, sel: true };
  };
  const over = (x, y) => ctx.onMove({ tx: x, ty: y, clientX: x * 100, clientY: y * 100, shiftKey: false });
  ctx.flipPref = false;
  press(); over(52, 13);
  A.eq(ctx.drag.mode, 'handbelt', 'rig: the selected BAY over the next BAY lays a belt');
  ctx.flipPref = true;   // R pressed there (flipCorner runs only in a hand mode)
  over(45, 19);
  A.eq(ctx.drag.mode, 'propmove', 'rig: …over open floor it is a MOVE again');
  ctx.onUp({ tx: 45, ty: 19, clientX: 4500, clientY: 1900, pointerId: 1 });
  A.eq(pos(s, R.B3), '45,19', 'the MOVE lands');
  A.eq(ctx.flipPref, false, 'the flip pressed while it was a belt drag is used up by the MOVE it ended as');
  press(); over(52, 13); ctx.flipPref = true; over(56, 20);
  A.eq(ctx.drag.mode, 'propmove', 'rig: belt, R, then a MOVE again');
  ctx.releaseDrag();   // Esc / right-click / pointercancel / blur
  A.eq(ctx.flipPref, false, '…and so does that drag dropped any other way');
  ctx.flipPref = true;
  press(); over(56, 20); ctx.onUp({ tx: 56, ty: 20, clientX: 5600, clientY: 2000, pointerId: 1 });
  A.eq(ctx.flipPref, true, 'a selected piece\'s plain MOVE (never a belt) leaves the CORNER key armed for the next belt drag');
}
/* 14. build-13 d: Shift let go over another line's INBOX before the release — the ghost was a plain (refused) MOVE, so is the release */
{
  const R = rig(), { s, ctx } = R;
  ctx.selectedPropId = R.O2;
  const [tx, ty] = tileOf(s, R.O2), before = JSON.stringify(s.serialize());
  ctx.geoVer++;
  ctx.drag = { mode: 'selectpress', propId: R.O2, start: { tx, ty }, cur: { tx, ty }, moved: false, add: false, cx: tx * 100, cy: ty * 100, sel: true };
  for (const [x, y] of [[44, 20], [32, 4]]) ctx.onMove({ tx: x, ty: y, clientX: x * 100, clientY: y * 100, shiftKey: true });
  A.eq(ctx.drag.mode, 'propmove', 'Shift held over the INBOX: a MOVE');
  ctx.onUp({ tx: 32, ty: 4, clientX: 3200, clientY: 400, pointerId: 1, shiftKey: false });   // Shift up, no pointer move, then the release
  A.eq(s.propById(R.O2).sendTo, undefined, 'the release never SENDS TO (the old propmove path did, against its own ghost)');
  A.eq(JSON.stringify(s.serialize()), before, '…nothing changed (the move onto the INBOX is refused)');
}

A.report('build-select-target.test');
