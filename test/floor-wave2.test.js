/* test/floor-wave2.test.js — the final floor lane, wave 2 (2026-10-12 release review, "floor" items).

   Each section names its finding id and fails against the lane head it was written on (e3f83ee38). build.js is the DOM-bound
   REFIT module, so its pieces are sliced out of the shipped source and run in a VM against a live WorldModel (the modes, plans,
   words and the floor after the gesture are the real ones — never a re-implementation); where a piece only exists as wiring,
   a source lock pins it.
     build-01 / conveyor-ui-02  the Alt view's stage count never throws on a line with no INBOX
     build-04                   the paste ghost promises A CLICK LAYS IT OUT only once the layout engine said it fits
     build-06                   an orphan junction's nag names the gesture that works (BELT INTO IT), never the refused move
     build-08                   arming a tool closes PICK WHAT GOES HERE before the selection card repaints
     build-09                   REMOVE / PICK UP from the hotbar go back to SELECT (they did nothing under LINES / PROP)
     build-11                   the ALT VIEW latch shows only in the Conveyors tab (where its off switch is)
     build-12                   FINISH THE LINE says WHICH start it found (SEND TO / work arrived / automatic start)
     build-13                   the SEND TO re-aim leftovers are gone: no propmove SEND TO, one arc shape, the old arc hidden only
                                while the hand really re-aims
     build-17                   REMOVE BELT never guesses on a tile two belts share
     build-18                   a reopened BUILD MODE drops the old selection
     build-19                   a double-click elsewhere never selects the line of the machine clicked before
     build-22                   COPY says the box's belts it leaves out
     worldmodel-07              a stamped / laid / pasted / planned line name never repeats one the floor shows (one numbering rule)
     worldmodel-08              the sidecar says an unnamed line as the floor does (LINE <letter>), in the hand-off and its records
     worldmodel-09              a move whose belt can't follow says so (LINK_LOST), never "would change the route"
     worldmodel-11              undo names a SEND TO / NAME / SPLIT THE JOB edit
     worldmodel-12              placeNear takes no unused parameter
     conveyor-ui-09             the STEP THROUGH refusal names the BAY key that exists (TEST THIS STEP)
   (build-10 / build-13 d / build-16 / build-20 ride the gesture harness in build-select-target; build-15 rides
    build-room-delete-sendto.) */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');
const LE = require('../frontend/app/lineedit.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', ...f.split('/')), 'utf8');
const src = read('frontend/app/build.js');
const between = (start, end) => {
  const i = src.indexOf(start), j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error('build.js seam moved: ' + start + ' … ' + end);
  return src.slice(i, j);
};
const line1 = re => { const m = src.match(re); if (!m) throw new Error('build.js line moved: ' + re); return m[0] + '\n'; };
const fnOf = (text, name) => { const i = text.indexOf('function ' + name + '('); if (i < 0) return ''; const j = text.indexOf('\n  }\n', i); return text.slice(i, j + 4); };
const run = (code, ctx) => { vm.createContext(ctx); vm.runInContext(code, ctx); return ctx; };
const add = (s, t, x, y) => { const big = t === 'bay' || t === 'intake' || t === 'outbox'; const r = s.addProp({ t, x, y, w: big ? 2 : 1, h: big ? 2 : 1, block: big }); if (!r.ok) throw new Error('rig: ' + t + ' ' + x + ',' + y + ' ' + r.msg); return r.id; };
function hall(x2, y2) { const s = WM.create(); s.projectGeometry(); s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: x2 || 70, y2: y2 || 30 } }); return s; }
function line(s, y, label, x0) {
  const x = x0 == null ? 32 : x0;
  const I = add(s, 'intake', x, y), B1 = add(s, 'bay', x + 8, y), B2 = add(s, 'bay', x + 16, y), O = add(s, 'outbox', x + 26, y);
  s.assignPropAgent(B1, 'a'); s.assignPropAgent(B2, 'b');
  for (const [a, b] of [[I, B1], [B1, B2], [B2, O]]) if (!s.connectBelt(a, b).ok) throw new Error('rig: belt');
  if (label) s.setPropLabel(I, label);
  return { I, B1, B2, O };
}
const shown = s => P.compileRoutingPlan(s.projectGeometry()).lines.filter(l => l.intakes.length).map(l => s.lineName(l.lineId));

/* ---------- build-01 / conveyor-ui-02: Alt held over a floor with a line that has no INBOX ---------- */
{
  const s = hall();
  line(s, 4, 'Alpha');
  const B = add(s, 'bay', 40, 16), O = add(s, 'outbox', 50, 16);   // a BAY belted to an OUTBOX before its INBOX went down
  A.ok(s.connectBelt(B, O).ok, 'rig: an INBOX-less fragment');
  const valPlan = P.compileRoutingPlan(s.projectGeometry());
  const ctx = run(between('let stagesPlan = null, stagesMemo = null;', 'const LINE_HUES'), { valPlan, Pipeline: P });
  const out = [];
  let threw = null;
  for (const rec of valPlan.lines) { try { out.push([rec.intakes.length, ctx.lineStagesOf(rec, false)]); } catch (e) { threw = e; } }
  A.eq(threw && String(threw.message), null, 'the full (Alt) stage count never throws on a line with no INBOX — the plates of every later line used to vanish');
  const fed = out.find(([n]) => n > 0);
  A.ok(fed && fed[1] && fed[1].n === 2 && fed[1].max === 7 && fed[1].worst >= fed[1].n, 'the INBOX line still says its n/max (and its worst with loops) — ' + JSON.stringify(fed && fed[1]));
  A.ok(out.filter(([n]) => !n).every(([, v]) => !v), 'a line with no INBOX has no plate to show (null)');
}

/* ---------- build-04: the paste ghost's promise is the layout engine's answer ---------- */
function clipRig(full) {
  // full: a room that holds exactly one line (no clear floor for a copy anywhere); else a hall with room to spare
  let s;
  if (full) { const d = WM.starterDoc(); for (const id in d.rooms) d.rooms[id].rects = [{ x1: 0, y1: 1, x2: 31, y2: 2 }]; d.props = []; s = WM.create(d); s.projectGeometry(); }   // the station's one room, which one line fills
  else s = hall(110, 40);
  const L = full ? line(s, 1, 'Alpha', 2) : line(s, 4, 'Alpha');
  const ids = [L.I, L.B1, L.B2, L.O];
  const c = s.copyLines(ids, { agent: () => true }).clip;
  const timers = [], badges = [], said = [];
  const ctx = {
    station: s, LineEdit: LE, WorldModel: WM, geoVer: 1, running: true, dupe: { type: 'lines', clip: c, rot: 0, cid: 1, label: 'LINE ALPHA' },
    agentHere: () => true, hoverTile: null, CONNECT_TYPES: { intake: 1, bay: 1, outbox: 1, filter: 1, splitter: 1, merger: 1, joiner: 1, loop: 1 },
    setTimeout: fn => { timers.push(fn); return timers.length; }, clearTimeout() {},
    failNote() {}, sfx() {}, flashTip: (ev, m, ok) => said.push((ok ? 'OK ' : 'NO ') + m), pushFlash() {}, landProps() {}, floatAt: (at, m) => said.push('FLOAT ' + m), setHint() {},
    StationUI: undefined, Tutorial: undefined,
    ctx: { save() {}, restore() {}, fillRect() {} }, PropSprites: { setCtx() {}, setNow() {}, draw() {} },
    propRect: p => ({ x1: p.x, y1: p.y, x2: p.x + (p.w || 1) - 1, y2: p.y + (p.h || 1) - 1 }), drawPropSelection() {}, drawBeltPreview() {},
    ghostBadge: (t, lines) => badges.push(lines.slice())
  };
  run(between('const clipAnchor = ', '// R with a clip in hand') + between('function drawClipGhost(t, now, g) {', '// a group being dragged:'), ctx);
  return { s, L, ctx, timers, badges, said };
}
{
  const R = clipRig(true), { ctx } = R;
  const at = { tx: R.s.propById(R.L.B1).x, ty: R.s.propById(R.L.B1).y };   // over the line itself: the drawn copy cannot stand here
  ctx.hoverTile = at;
  ctx.drawClipGhost(16, 0, ctx.clipGhost(at.tx, at.ty));
  const first = R.badges[R.badges.length - 1].join(' | ');
  A.ok(!/LAYS IT OUT/.test(first), 'before the layout engine has answered, the ghost promises nothing — ' + first);
  for (let i = 0; i < 4 && R.timers.length; i++) R.timers.shift()();
  ctx.drawClipGhost(16, 0, ctx.clipGhost(at.tx, at.ty));
  const after = R.badges[R.badges.length - 1].join(' | ');
  A.ok(!/LAYS IT OUT/.test(after) && /NO CLEAR FLOOR/.test(after), 'where no layout fits, the ghost says why the layout cannot help — never A CLICK LAYS IT OUT — ' + after);
  ctx.pasteClipAt(at, {});
  A.ok(/^NO CAN’T PASTE HERE — THERE IS NO CLEAR FLOOR NEAR HERE/.test(R.said[R.said.length - 1]), 'the click\'s refusal names the layout\'s own reason — ' + R.said[R.said.length - 1]);
}
{
  const R = clipRig(false), { ctx } = R;
  const at = { tx: R.s.propById(R.L.B1).x, ty: R.s.propById(R.L.B1).y };
  ctx.hoverTile = at;
  ctx.drawClipGhost(16, 0, ctx.clipGhost(at.tx, at.ty));
  for (let i = 0; i < 4 && R.timers.length; i++) R.timers.shift()();
  ctx.drawClipGhost(16, 0, ctx.clipGhost(at.tx, at.ty));
  const after = R.badges[R.badges.length - 1].join(' | ');
  A.ok(/A CLICK LAYS IT OUT TO FIT NEARBY/.test(after), 'where the layout engine found room, the ghost says the click lays it out — ' + after);
  const n = R.s.props().length;
  ctx.pasteClipAt(at, {});
  A.ok(R.s.props().length === n + 4 && /LAID OUT TO FIT/.test(R.said.join(' ')), '…and the click keeps that promise — ' + R.said.join(' / '));
}

/* ---------- build-06: an orphan junction's nag names the gesture that works ---------- */
{
  const world = read('frontend/app/world.js');
  A.ok(/ORPHAN_JUNCTION: 'NOT ON A BELT — BELT INTO IT'/.test(src) && /ORPHAN_JUNCTION: 'NOT ON A BELT — BELT INTO IT'/.test(world), 'ORPHAN_JUNCTION says BELT INTO IT on both surfaces (moving a junction onto a belt is refused: ANOTHER BELT RUNS HERE)');
  A.ok(!/MOVE IT ONTO THE LINE|NOT ON A BELT — MOVE IT'/.test(src + world), '…and nothing still tells the Commander to move it onto the line');
  const why = src.slice(src.indexOf('const VAL_WHY = {'), src.indexOf('const valWhy ='));
  A.ok(/ORPHAN_JUNCTION: '[^']*drag from the machine[^']*'/i.test(why), 'the hover card\'s long form says the whole fix');
  // the fix it names really works: a machine belted into a beltless junction clears the finding
  const s = hall(); const L = line(s, 4); const S = add(s, 'splitter', 45, 12);
  A.ok(P.compileRoutingPlan(s.projectGeometry()).errors.some(e => e.code === 'ORPHAN_JUNCTION'), 'rig: a splitter on bare floor nags');
  A.ok(s.connectBelt(L.B1, S).ok && !P.compileRoutingPlan(s.projectGeometry()).errors.some(e => e.code === 'ORPHAN_JUNCTION'), 'belting a machine into it is the fix the nag names');
  const cpm = fnOf(src, 'commitPropMove');
  A.ok(!/JUNCTION SNAP on MOVE/.test(cpm) && !/okMsg/.test(cpm), 'commitPropMove carries no comment about the removed junction snap');
}

/* ---------- build-08: arming a tool (a tab switch, 0/9, BELT, Ctrl+V) closes PICK WHAT GOES HERE before the card repaints ---------- */
{
  const seen = [];
  const ctx = run(between('function selectTool(id, o) {', '/* FRAME THE GHOST.'), {
    tool: 'select', selBelts: null, selectedPropId: null, groupIds: [], selectedRoomId: null, drag: null, dragPid: null, connectFrom: null, connectTo: null, dupe: null,
    hand: null, touchArm: null, dropPick: { from: 'p3', tile: { x: 1, y: 1 }, opts: [] }, deskOwner: null, buildGroup: 'workflow', BUILD_GROUPS: [['workflow', 'CONVEYORS', ['select', 'belt']], ['props', 'PROPS', ['prop']]],
    root: { querySelectorAll: () => [] }, window: { matchMedia: () => ({ matches: false }) },
    renderSelection: () => seen.push(ctx.dropPick), releaseDrag() {}, hideTip() {}, hidePropCard() {}, toggleKit() {}, renderPalette() {}, repaintIcons() {}, setHint() {}, setCursor() {},
    fitCamera() {}, renderFinCard() {}, frameBlueprint() {}, sfx() {}
  });
  ctx.selectTool('belt');
  A.ok(seen.length > 0 && seen.every(d => d === null), 'the selection card repaints with the picker already put down (it stayed docked with dead tiles) — ' + JSON.stringify(seen.map(d => !!d)));
  A.eq(ctx.dropPick, null, '…and the picker is gone');
}

/* ---------- build-09: REMOVE / PICK UP under an armed LINES / PROP tool ---------- */
{
  const keys = {};
  const el = () => { const e = { dataset: {}, classList: { toggle() {} }, children: [], setAttribute() {}, append(...c) { e.children.push(...c); }, appendChild(c) { e.children.push(c); } }; return e; };
  const calls = [];
  const ctx = run(between('function hotbarEl() {', '// the lit state of the hotbar slots'), {
    document: { createElement: el }, HOTBAR: [], hand: null, touchArm: null, flipPref: false, altLatched: false, lastCopy: null, tool: 'line',
    catalog: () => [], machineStill: () => null, PALETTE_PURPOSE: {}, JUNCTION_TAG_TYPES: {}, esc: s => String(s),
    toggleHand() {}, holdClip() {}, orientEv: () => ({}), handPvKey: '',
    selectTool: (id, o) => { calls.push(id); ctx.tool = id; ctx.touchArm = null; ctx.hand = null; },
    setHand: () => { ctx.hand = null; ctx.touchArm = null; ctx.dropPick = null; },
    paintHandKeys() {}, setHint() {}, setCursor() {}, sfx() {}
  });
  const wrap = ctx.hotbarEl();
  for (const b of wrap.children[1].children) keys[b.dataset.handkey] = b;
  keys.remove.onclick();
  A.eq([ctx.tool, ctx.touchArm], ['select', 'remove'], 'REMOVE under the LINES tool goes back to SELECT and arms the next tap (it lit up and did nothing)');
  keys.remove.onclick();
  A.eq(ctx.touchArm, null, '…a second tap disarms it');
  ctx.tool = 'prop';
  keys.pipette.onclick();
  A.eq([ctx.tool, ctx.touchArm], ['select', 'pipette'], 'PICK UP under the PROP tool does the same');
}

/* ---------- build-11: the ALT VIEW latch belongs to the Conveyors tab ---------- */
{
  const ctx = run(line1(/const altOn = [^\n]+/) + 'this.altOn = altOn;', { altHeld: false, altLatched: true, buildGroup: 'workflow' });
  A.eq(ctx.altOn(), true, 'latched in the Conveyors tab: on');
  ctx.buildGroup = 'props';
  A.eq(ctx.altOn(), false, 'latched, then Props: off (its off switch is not on screen there)');
  ctx.altHeld = true;
  A.eq(ctx.altOn(), true, 'held Alt works in every tab');
}

/* ---------- build-12: FINISH THE LINE says which start it found ---------- */
function finCard(st, valPlan, names) {
  let html = '';
  const elm = () => ({ className: '', style: {}, set innerHTML(v) { html = v; }, get innerHTML() { return html; }, querySelector: () => ({ onclick: null, textContent: '' }) });
  const c = { key: 'LB', intakes: ['pB'], bays: [{ propId: 'b1', agentId: 'x' }] };
  // the card's own ② words (finFeedText) and ③'s SEND TO promise (finOnwardPromise, agent lane) ride the slice with it
  const ctx = run(fnOf(src, 'finFeedText') + fnOf(src, 'finOnwardPromise') + between('function renderFinCard() {', '// ① — center the camera'), {
    root: { appendChild() {} }, running: true, finEngaged: true, tool: 'belt', finCardEl: null, finSig: '', finComp: null, finSample: null, finSampleRes: null, valPlan,
    tutorialCoaching: () => false, ordersHide() {}, renderOrders() {}, bumpUi() {}, finPick: () => c, finState: () => st, lineNameOf: () => null,
    workflowReadout: () => ({ compact: '' }), agentLabelFor: a => a, document: { createElement: elm }, esc: s => String(s), finSampleHTML: () => '',
    finMark() {}, sfx() {}, currentPresetExample: () => null, openPresetExample() {}, openFlowCard() {}, openStepCard() {}, finFocusCrew() {}, finOpenFeed() {}, finRunSample() {},
    station: { lineName: k => names[k] || null }, Pipeline: P, WorkflowLine: require('../frontend/app/workflowline.js'), opts: { world: { lineName: k => names[k] || null } }
  });
  ctx.renderFinCard();
  const m = /data-act="feed"[^>]*>([^<]*)</.exec(html);
  return m ? m[1] : html;
}
{
  const base = { unbound: [], crewLeft: 0, hasIntake: true, schedOff: false, todo: false, feedDone: true };
  const sent = { sendTo: { pO: { intakeId: 'pB', fromLine: 'LA', toLine: 'LB' } } };
  A.eq(finCard(Object.assign({ feed: { known: true, fed: false } }, base), sent, { LA: 'LINE ALPHA' }), '✓ FED BY LINE ALPHA', 'a line fed by another line\'s SEND TO says so, naming the sender');
  A.eq(finCard(Object.assign({ feed: { known: true, fed: true }, autoStart: true }, base), {}, {}), '✓ AUTOMATIC START CONFIGURED', 'an automatic start of THIS line says so (it was unreachable)');
  // (conveyor-final merge, decision b: "fed" is a compiled SEND TO from a line that can run, NEVER a run count — so arrived work no
  // longer ticks ② and there is no WORK HAS ARRIVED; ② done with no named sender and no start of this line is the SEND TO fallback)
  A.eq(finCard(Object.assign({ feed: { known: true, fed: true }, autoStart: false }, base), {}, {}), '✓ ANOTHER LINE SENDS IT WORK', 'a station-wide feed flag is never this line\'s AUTOMATIC START (wave 2 repair)');
  A.ok(!/WORK HAS ARRIVED/.test(src), 'arrived work is no start: ② never says WORK HAS ARRIVED (a sample or a test run starts nothing)');
  A.eq(finCard(Object.assign({ feed: { known: true, fed: false } }, base, { feedDone: false }), {}, {}), '② CHOOSE WHAT STARTS THIS LINE', 'not fed: the step is still open');
  A.ok(!/A START IS CONFIGURED OR WORK HAS ARRIVED/.test(src), 'the X-OR-Y sentence is gone');
}

/* ---------- build-13: the SEND TO re-aim leftovers ---------- */
{
  const sl = fnOf(src, 'drawSendLinks'), hg = fnOf(src, 'drawHandGhost');
  A.ok(/drag\.mode === 'handbelt' && \(handPlan\(drag\) \|\| \{\}\)\.kind === 'send'/.test(sl), 'the old arc hides while the hand really re-aims the OUTBOX (it drew next to the new one) — the whole rule is driven in the wave 2 repair section');
  A.ok(/strokeSendArc\(sendArc\(t, A, plan\.to\), col, now, 0\.95\)/.test(hg) && !/function drawSendArc\(/.test(src), 'the re-aim ghost is the committed arc (same curve, same arrowhead) — no second arc shape');
  A.ok(!/function drawSendGhost\(/.test(src) && !/g\.sendTo/.test(src) && !/function intakeAt\(/.test(src), 'the unreachable propmove SEND TO ghost path is gone');
  A.ok(!/intakeAt|commitSendTo/.test(fnOf(src, 'commitPropMove')), 'a plain move never SENDS TO (THE HAND\'s plan is the one door)');
}

/* ---------- build-17: REMOVE BELT on a tile two belts share ---------- */
function legacyMerge() {
  // a pre-links save: two BAYs whose hand-laid belts meet and run on as ONE belt into a third (each derived link rides the shared run)
  const s0 = hall(); const A1 = add(s0, 'bay', 32, 4), A2 = add(s0, 'bay', 32, 10), C = add(s0, 'bay', 48, 7);
  const d = s0.serialize(); delete d.links; const s = WM.deserialize(d);
  for (const [a, b] of [[[34, 4], [39, 4]], [[40, 4], [40, 6]], [[34, 10], [39, 10]], [[40, 10], [40, 8]], [[40, 7], [47, 7]]]) A.ok(s.placeBeltRun({ tx: a[0], ty: a[1] }, { tx: b[0], ty: b[1] }).ok, 'rig: hand-laid run');
  const on = (s.links() || []).filter(l => l.path.some(q => q.x === 44 && q.y === 7));
  A.eq(on.length, 2, 'rig: two links share the merged run at 44,7');
  return { s, A1, A2, C };
}
{
  const R = legacyMerge(), s = R.s, said = [];
  const ctx = run(between('function removeBeltAt(tx,ty,ev) {', '// Q: pick up one like'), {
    station: s, linkedFloor: () => true, linksMemoed: () => s.links() || [], pushFlash() {}, flashUndo() {}, sfxVanish() {}, touchArm: null, openBeltCard() {},
    floatAt: (at, m) => said.push('FLOAT ' + m + ' @' + at.x + ',' + at.y), sfx() {}, flashTip: (ev, m) => said.push('NO ' + m)
  });
  const before = JSON.stringify(s.links().map(l => l.id));
  A.eq(ctx.removeBeltAt(44, 7, {}), true, 'the gesture is answered');
  A.eq(JSON.stringify(s.links().map(l => l.id)), before, 'REMOVE BELT on a shared tile takes nothing (it took whichever link came first)');
  A.ok(/THIS TILE CARRIES 2 BELTS/.test(said[said.length - 1]), '…and says why, and how to choose — ' + said[said.length - 1]);
  A.ok(typeof ctx.removeBeltLinks === 'function', 'the belt card has a per-connection remove');
  if (typeof ctx.removeBeltLinks === 'function') {
    const l2 = s.links().find(l => l.from.prop === R.A2);
    A.ok(ctx.removeBeltLinks([l2.id], {}), 'REMOVE <A2 ▸ C> takes that one connection');
    A.ok(!s.links().some(l => l.id === l2.id) && s.links().some(l => l.from.prop === R.A1), '…only that one: A1 still reaches C over the shared run');
    const f = said[said.length - 1], m = /@(\d+(?:\.\d+)?),(\d+)/.exec(f);
    A.ok(/REMOVED · BELT · CTRL\+Z/.test(f) && m && Number(m[2]) >= 8, 'the float rises over a tile the removed belt alone rode (not the shared run) — ' + f);
    A.ok(s.undo().ok && s.links().some(l => l.id === l2.id), 'one undo brings it back');
  }
  const card = fnOf(src, 'openBeltCard');
  A.ok(/data-rmlink/.test(card) && /removeBeltLinks\(/.test(card) && /'REMOVE ' \+/.test(card), 'a card naming two connections offers one REMOVE key per connection');
}

/* ---------- build-18 / build-19: no stale selection or double-click latch ---------- */
{
  const open = fnOf(src, 'open');
  A.ok(/selectedPropId = null; groupIds = \[\]; selectedRoomId = null; positionOpen = false; furnishOpen = false; roomDelArmedAt = 0;/.test(open)
    && open.indexOf('selectedPropId = null') > open.indexOf('if (running) return;'), 'a reopened BUILD MODE holds no selection (SELECT MOVES would drag the old one, Delete would remove it)');
  const down = fnOf(src, 'onDown');
  A.ok(/const p = pid && station\.propById\(pid\);\s*if \(!p\) clickMachine = null;/.test(down), 'a press off every machine lets the double-click latch go');
  const sel = [];
  const ctx = run(between('function onDblClick(ev) {', '// DELETE LINE:'), {
    tool: 'select', hand: null, touchArm: null, dropPick: null, drag: null, clearTimeout() {}, inspectTimer: 0, CLICK_SLOP: 12,
    performance: { now: () => 1000 }, clickMachine: { id: 'p4', t: 900, x: 100, y: 100 }, propAtEvent: () => null,
    station: { propById: id => ({ id, t: 'bay' }) }, CONNECT_TYPES: { bay: 1 }, selectWholeLine: id => sel.push(id)
  });
  ctx.onDblClick({ clientX: 420, clientY: 300, preventDefault() {} });
  A.eq(sel, [], 'a double-click on empty floor 0.1 s after clicking a BAY far away selects nothing');
  ctx.onDblClick({ clientX: 103, clientY: 101, preventDefault() {} });
  A.eq(sel, ['p4'], '…a double-click on that BAY (the press that selected it) still takes its whole line');
}

/* ---------- build-22: COPY says the belts the box took that the copy does not carry ---------- */
{
  const s = hall(), L = line(s, 4), said = [];
  const lk = (a, b) => s.links().find(l => l.from.prop === a && l.to.prop === b).id;
  const ctx = run(between('function cutLinksOf(ids) {', 'function deleteGroup(ev, verb) {') + between('function copyClip(ev, cut) {', 'function cutSelected(ev) {'), {
    station: s, linksMemoed: () => s.links(), selectionIds: () => [L.B1, L.B2], wholeLineOf: () => null,
    clipOfSelection: () => s.copyLines([L.B1, L.B2], { agent: () => true }).clip, clipSeq: 0, lastCopy: null,
    clipWord: c => c.n + ' PIECES · ' + c.nb + ' BELT', holdClip: (h, ev, m) => said.push(m), setHint() {}, sfx() {}, flashTip() {},
    beltSel: () => ({ links: [lk(L.I, L.B1), lk(L.B1, L.B2), lk(L.B2, L.O)], tiles: [] }), WORKSTATION_TYPES: {}
  });
  ctx.copyClip({}, false);
  A.ok(/2 BELTS LEFT OUT \(THEY RUN OUTSIDE THE COPY\)/.test(said[0] || ''), 'the box took 3 belts, the copy carries 1: COPY says the other 2 stay out — ' + said[0]);
}

/* ---------- worldmodel-07: one numbering rule; a stamped / laid shelf line never repeats a shown name ---------- */
{
  const s = hall(120, 80);
  A.ok(s.stampBlueprint('allowance_desk', 34, 2).ok && s.stampBlueprint('allowance_desk', 34, 30).ok, 'rig: ALLOWANCE DESK stamped twice');
  A.ok(LE.placeBlueprint(s, 'allowance_desk', { x: 80, y: 50 }).ok, '…and laid once by the layout engine');
  const names = shown(s);
  A.eq(new Set(names).size, names.length, 'three ALLOWANCE DESKs show three names — ' + JSON.stringify(names));
  A.ok(names.includes('LINE ALLOWANCE') && names.includes('LINE ALLOWANCE 2') && names.includes('LINE ALLOWANCE 3'), '…numbered on: ALLOWANCE, ALLOWANCE 2, ALLOWANCE 3');
  A.ok(s.undo().ok && s.undo().ok && shown(s).length === 1, 'each stamp is still one undo (the name rode in its snapshot)');
  A.eq(typeof P.uniqueLineName, 'function', 'Pipeline.uniqueLineName is the one numbering rule');
  if (typeof P.uniqueLineName === 'function') {
    const taken = new Set(['BATCH 7', 'BATCH 8', 'RESEARCH']);
    A.eq(P.uniqueLineName('BATCH 7', v => taken.has(v)), 'BATCH 9', 'a name ending in a number counts on from it (BATCH 7 → BATCH 9 past a taken 8)');
    A.eq(P.uniqueLineName('RESEARCH', v => taken.has(v)), 'RESEARCH 2', 'a bare name gets 2');
    A.eq(P.uniqueLineName('FREE', v => taken.has(v)), 'FREE', 'a free name is kept');
    A.ok(P.uniqueLineName('X'.repeat(48), () => true).length <= 48, 'every name taken: still never longer than 48 (this assertion could not fail — it ended in || true)');
    A.ok(P.uniqueLineName('X'.repeat(48), v => v === 'X'.repeat(48)).length <= 48, 'a numbered name stays within 48 characters');
  }
  // paste: 'BATCH 7' copied beside itself is BATCH 8 (it was 'BATCH 2': the stem dropped the 7)
  const t = hall(120, 40), L = line(t, 4, 'BATCH 7');
  const c = t.copyLines([L.I, L.B1, L.B2, L.O], { agent: () => true }).clip;
  const pr = t.pasteLines(c, 32, 20, { agent: () => true });
  A.ok(pr && pr.ok, 'rig: the copy pastes');
  const pin = pr && pr.ids.map(id => t.propById(id)).find(p => p.t === 'intake');
  A.eq(pin && pin.label, 'BATCH 8', 'a pasted BATCH 7 is BATCH 8');
  // the lead's plan numbers the same way
  const SB = require('../frontend/app/stationbuilder.js'), W = require('../frontend/app/workflowline.js'), S = require('../frontend/app/propsprites.js');
  WM.setPropRules(q => { const sp = S.spec(q); return sp ? { mount: sp.mount || null, stack: !!sp.stack, surface: !!sp.surface, flat: !!sp.flat } : null; });
  const env = { WorldModel: WM, Pipeline: P, WorkflowLine: W, LineEdit: LE, PropSprites: S, crew: [{ id: 'agent', name: 'NOVA' }], heroId: 'agent' };
  const st = WM.create(), z = st.rooms()[0].rects[0];
  A.ok(st.addRoom({ kind: 'hab', rect: { x1: z.x2 + 1, y1: z.y1, x2: z.x2 + 50, y2: z.y1 + 40 } }).ok, 'rig: a hall');
  const r = LE.run(st, null, 'newLine', { role: 'WRITER' }, { near: { x: z.x2 + 8, y: z.y1 + 4 } });
  const comp = P.lineComponents(st.projectGeometry()).find(k => k.props.includes(r.focus));
  A.ok(st.setPropLabel(comp.intakes[0], 'Batch 7').ok, 'rig: a line called Batch 7');
  const pl = SB.plan(st.serialize(), { line: 'research_line', name: 'Batch 7' }, env);
  A.ok(pl.ok && /Batch 8/.test(JSON.stringify(pl.plan)) && !/Batch 7 2/.test(JSON.stringify(pl.plan)), 'the lead\'s new line asked to be "Batch 7" is Batch 8 — the same rule as a paste (it was Batch 7 2)');
  WM.setPropRules(null);
}

/* ---------- worldmodel-08: the sidecar names an unnamed line as the floor does ---------- */
{
  const { makeHandoffRunner } = require('../sidecar/routing/handoff-runner.js');
  const LineJobs = require('../sidecar/routing/linejobs.js');
  const d = WM.starterDoc();
  for (const id in d.rooms) for (const rr of d.rooms[id].rects) { rr.x2 = 44; rr.y2 = 20; }
  const st = WM.create(d), L = [];
  for (let i = 0; i < 2; i++) {
    const r = LE.placeBlueprint(st, 'research_line', { x: 8, y: 4 + i * 6 });
    const of = q => r.ids.filter(id => st.propById(id).t === q);
    L.push({ intake: of('intake')[0], bays: of('bay'), outbox: of('outbox')[0] });
    st.setPropLabel(of('intake')[0], '');
  }
  for (const p of st.props()) if (p.t === 'bay' && !p.agentId) st.assignPropAgent(p.id, 'ag_' + p.id);
  A.ok(st.setSendTo(L[0].outbox, L[1].intake).ok, 'rig: an unnamed line sends to another');
  const plan = P.compileRoutingPlan(st.projectGeometry()), LA = plan.lineOfProp[L[0].intake], LB = plan.lineOfProp[L[1].intake];
  const wordA = st.lineName(LA), wordB = st.lineName(LB);
  A.ok(/^LINE [A-Z]+/.test(wordA) && wordA !== wordB, 'rig: the floor says ' + wordA + ' and ' + wordB);
  let jobs = { jobs: [] };
  const J = {
    byStream: x => LineJobs.byStream(jobs, x), start: x => { const y = LineJobs.start(jobs, x); if (y.job) jobs = y.state; return y.job; },
    finish: (id, x) => { const y = LineJobs.finish(jobs, id, x); if (y.job) jobs = y.state; return y.job; }, link: (id, to) => { const y = LineJobs.link(jobs, id, to); if (y.job) jobs = y.state; return y.job; },
    latest: line => LineJobs.latest(jobs, line), again: (id, at) => { const y = LineJobs.again(jobs, id, at); if (y.job) jobs = y.state; return y.job; }
  };
  const got = [];
  let halted = false, n = 0;
  const R = makeHandoffRunner({ makeHub: () => ({ onInbound: m => { got.push(m); return new Promise(() => {}); } }), plan: () => plan, jobs: J, emit() {}, runsFor: () => [],
    now: () => 1000, newId: () => 'id' + (++n) + 'abcdef0123456789', warn() {}, halted: () => halted, shipsToOutbox: () => true });
  const last = L[0].bays[L[0].bays.length - 1];
  const q = R.onShipped({ lineId: LA, agentId: 'ag_' + last, dockId: last, text: 'done', originalText: 'the job', streamId: 'sample-x1', since: 990 });
  A.ok(q.ok, 'rig: the hand-off is queued — ' + JSON.stringify(q));
  setTimeout(() => {
    const msg = got[0] && got[0].text;
    A.ok(msg && msg.indexOf('[HAND-OFF — ' + wordA + ' finished') === 0, 'LINE B\'s crew is told the job came from ' + wordA + ' (it said "the line before this one") — ' + String(msg).slice(0, 80));
    const yb = jobs.jobs.find(j => j.line === LB);
    A.ok(yb && yb.from && yb.from.name === wordA, 'B\'s record names the sender as the floor does — ' + JSON.stringify(yb && yb.from));
    halted = true;
    R.onShipped({ lineId: LA, agentId: 'ag_' + last, dockId: last, text: 'done', originalText: 'again', streamId: 'sample-x2', since: 995 });
    const refused = jobs.jobs.filter(j => j.line === LB && j.status === 'failed').pop();
    A.ok(refused && refused.name === wordB, 'a refused hand-off\'s record on the target line is named ' + wordB + ' (it was blank) — ' + JSON.stringify(refused && refused.name));
    finish();
  }, 30);
}

/* ---------- worldmodel-09: a belt that can't follow is said as such ---------- */
{
  const s = hall(), L = line(s, 4);
  for (let x = 48; x <= 52; x += 2) { add(s, 'bay', x, 18); add(s, 'bay', x, 22); }
  add(s, 'bay', 48, 20); add(s, 'bay', 52, 20);   // a walled 2x2 pocket at 50,20: a BAY fits there, its belts cannot reach it
  const at = JSON.stringify(s.serialize());
  const r = s.moveProp(L.B1, 50 - 40, 20 - 4);
  A.eq([r.ok, r.error, r.short], [false, 'LINK_LOST', 'ITS BELT CAN’T FOLLOW HERE'], 'the refusal names the real cause (it said THIS MOVE WOULD CHANGE THE ROUTE) — ' + JSON.stringify(r));
  A.ok(/belt finds no clear route/.test(r.msg || ''), '…in full: ' + r.msg);
  A.eq(JSON.stringify(s.serialize()), at, '…and nothing moved');
  const probe = s.canMoveProp(L.B1, 50, 20);
  A.eq(probe.short, 'ITS BELT CAN’T FOLLOW HERE', 'the drag ghost reads the same words (canMoveProp asks moveProp on a probe)');
  A.ok(!/ of its belts found no clear route and /.test(fnOf(src, 'moveMsg')), 'the unreachable "moved — its belts were taken up" message is gone');
}

/* ---------- worldmodel-11: undo names what it took back ---------- */
{
  const s = hall(70, 40), L1 = line(s, 4, 'Alpha'), L2 = line(s, 20, 'Beta');
  A.ok(s.setSendTo(L1.O, L2.I).ok, 'rig: SEND TO');
  A.eq(s.undo().label, 'SEND TO', 'undoing a SEND TO says UNDID · SEND TO (it said SETTINGS)');
  A.ok(s.redo().ok && s.setSendTo(L1.O, null).ok, 'rig: SEND TO set back to NOWHERE');
  A.eq(s.undo().label, 'SEND TO', '…and undoing NOWHERE says the same');
  A.ok(s.setPropLabel(L1.I, 'Gamma').ok, 'rig: a rename');
  A.eq(s.undo().label, 'NAME', 'undoing a rename says UNDID · NAME');
  const S = add(s, 'splitter', 60, 30);
  A.ok(s.setSplitDivide(S, true).ok, 'rig: SPLIT THE JOB on');
  A.eq(s.undo().label, 'SPLIT THE JOB', 'undoing SPLIT THE JOB says so');
  const sm = fnOf(src, 'setSplitMode');
  A.ok(/\}, mode === 'divide' \? 'SPLIT THE JOB' : 'SPLITTER'\);/.test(sm), 'the panel\'s SPLIT THE JOB switch labels its one transact (setSplitDivide\'s own snapshot is skipped inside it)');
}

/* ---------- worldmodel-12: placeNear's signature says what it uses ---------- */
{
  const wm = read('frontend/app/worldmodel.js');
  A.ok(/function placeNear\(spec, tile\) \{/.test(wm) && !/placeNear\([^)]*,[^)]*,[^)]*\)/.test(wm), 'placeNear(spec, tile) — no unused avoidId (no avoidance was ever applied)');
}

/* ---------- conveyor-ui-09: the STEP THROUGH refusal names the key the BAY card has ---------- */
{
  const s = WM.create(); s.projectGeometry(); s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 100, y2: 60 } });
  A.ok(LE.placeBlueprint(s, 'parallel_crew', { x: 50, y: 20 }).ok, 'rig: a parallel line');
  for (const b of s.props().filter(p => p.t === 'bay')) s.assignPropAgent(b.id, 'crew' + b.id);
  s.swapJoinerMerger(s.props().find(p => p.t === 'merger').id);
  const pl = P.compileRoutingPlan(s.projectGeometry()), why = P.stepTestRefusal(pl, pl.lines[0].lineId) || '';
  A.ok(/TEST THIS STEP/.test(why) && !/TRY THIS STEP/.test(why), 'the refusal says TEST THIS STEP (no key is called TRY THIS STEP) — ' + why);
  A.ok(/'TEST THIS STEP'/.test(read('frontend/app/workflowpanel.js')), '(the BAY card\'s key is TEST THIS STEP)');
}

/* ======================= WAVE 2 REPAIR (2026-10-12, the second review of this lane) =======================
   Each section fails against af2a6fd72 (the wave 2 head):
     build-17 a  one connection laid twice over a merged run: REMOVE BELT (and the card's one key) took nothing, forever
     build-17 b  the per-connection REMOVE keys could read the same; pointing at one now lights the belt it takes
     build-17 c  REMOVE armed (touch): a tap on a shared tile opens the belt card — the CLICK IT advice could not be followed
     build-12 a  a SEND TO from a fragment with no INBOX (it can never run) is no feed: no ✓, no FED BY ANOTHER LINE
     build-12 b  AUTOMATIC START CONFIGURED only for a start of THIS line (the Workflow panel's own reader), never the station flag
     build-13 a  the BELT tool's SEND TO re-aim hides the old arc while the new one is drawn (only THE HAND's re-aim did)
     build-13 b  a plain MOVE of an OUTBOX keeps its SEND TO arc (the propmove clause hid a live hand-off for the whole drag) */
const WL = require('../frontend/app/workflowline.js');
const rmCtx = (s, said, extra) => run(between('function removeBeltAt(tx,ty,ev) {', '// Q: pick up one like'), Object.assign({
  station: s, linkedFloor: () => true, linksMemoed: () => s.links() || [], pushFlash() {}, flashUndo() {}, sfxVanish() {}, touchArm: null,
  openBeltCard: (x, y) => said.push('CARD ' + x + ',' + y), floatAt: (at, m) => said.push('FLOAT ' + m), sfx() {}, flashTip: (ev, m) => said.push('NO ' + m)
}, extra || {}));
/* the belt card, driven: build.js's own openBeltCard + its REMOVE seams on a stub DOM that keeps each key's handlers */
function beltCard(s, tx, ty) {
  const said = [], els = {}, keys = [];
  let html = '';
  const el = () => ({ onclick: null, on: {}, dataset: {}, addEventListener(type, fn) { this.on[type] = fn; } });
  const peek = { on: false };
  const g = { className: '', parentNode: null, classList: { add() {}, toggle(c, on) { if (c === 'is-peek') peek.on = !!on; } }, addEventListener() {},
    set innerHTML(v) { html = v; const re = /<button[^>]*data-rmlink="(\d+)"[^>]*>([^<]*)<\/button>/g; let m; while ((m = re.exec(v))) { const b = el(); b.dataset.rmlink = m[1]; b.label = m[2]; keys.push(b); } },
    get innerHTML() { return html; },
    querySelector: q => (q === '#belt-remove' && !/id="belt-remove"/.test(html)) ? null : (els[q] = els[q] || el()),
    querySelectorAll: q => (q === '[data-rmlink]' ? keys : []) };
  const root = { appendChild(x) { x.parentNode = root; }, removeChild(x) { x.parentNode = null; } };
  const ctx = run(between('function openBeltCard(tx, ty, ev) {', 'function openJunctionEditor(') + between('function removeBeltAt(tx,ty,ev) {', '// Q: pick up one like'), {
    root, document: { createElement: () => g }, requestAnimationFrame: f => f(), cardCloseAll() {}, cardRegister() {}, workflowIntroHTML: () => '<div data-workflow-close></div>',
    station: s, cacheGeo: { origin: { tx: 0, ty: 0 } }, valPlan: null, linkedFloor: () => true, linksMemoed: () => s.links() || [], esc: x => String(x),
    agentLabelFor: a => String(a).toUpperCase(), lineWordOf: () => 'LINE ?', propLabel: t => String(t).toUpperCase(), geoVer: 1, touchArm: null, beltCardHot: null,
    pushFlash() {}, flashUndo() {}, sfxVanish() {}, sfx() {}, floatAt: (at, m) => said.push('FLOAT ' + m), flashTip: (ev, m) => said.push('NO ' + m), openBeltCard: null
  });
  ctx.openBeltCard(tx, ty, {});
  return { ctx, html, keys, one: /id="belt-remove"/.test(html) ? els['#belt-remove'] : null, said, peek };
}
function samePairMerge() {
  // a pre-links save: ONE BAY's two hand-laid runs (east, and down-east-up) meet and run on as one belt into the next BAY — the floor
  // derives two links, both A1 ▸ C, and both ride the shared tail
  const s0 = hall(); const A1 = add(s0, 'bay', 32, 7), C = add(s0, 'bay', 48, 7);
  const d = s0.serialize(); delete d.links; const s = WM.deserialize(d);
  for (const [a, b] of [[[34, 7], [39, 7]], [[33, 9], [33, 10]], [[33, 10], [39, 10]], [[40, 10], [40, 8]], [[40, 7], [47, 7]]]) A.ok(s.placeBeltRun({ tx: a[0], ty: a[1] }, { tx: b[0], ty: b[1] }).ok, 'rig: hand-laid run');
  const on = (s.links() || []).filter(l => l.path.some(q => q.x === 44 && q.y === 7));
  A.ok(on.length === 2 && on.every(l => l.from.prop === A1 && l.to.prop === C), 'rig: two links, both A1 ▸ C, share the run at 44,7');
  return { s, A1, C };
}

/* ---------- build-17 a: one connection laid twice — REMOVE BELT takes it ---------- */
{
  const R = samePairMerge(), s = R.s, said = [];
  const ctx = rmCtx(s, said);
  A.eq(ctx.removeBeltAt(44, 7, {}), true, 'the gesture is answered');
  A.eq(s.links().length, 0, 'REMOVE BELT on a tile only ONE connection rides (laid twice) takes that connection — it refused with THIS TILE CARRIES 2 BELTS');
  A.ok(/^FLOAT REMOVED · BELT · CTRL\+Z/.test(said[said.length - 1] || ''), '…and says so — ' + said[said.length - 1]);
  A.ok(s.undo().ok && s.links().length === 2, 'one undo brings it back, both runs');
}
{
  const R = samePairMerge(), s = R.s, B = beltCard(s, 44, 7);
  A.eq(B.keys.length, 0, 'one connection on the tile: no per-connection keys');
  A.ok(!!B.one, '…the one REMOVE BELT key');
  if (B.one) B.one.onclick();
  A.eq(s.links().length, 0, 'the card\'s REMOVE BELT takes the connection (it called the same refusal, and a click reopened the same card)');
}

/* ---------- build-17 b: every REMOVE key reads differently, and pointing at one lights the belt it takes ---------- */
for (const crew of [null, 'nova']) {
  const R = legacyMerge(), s = R.s;
  if (crew) { s.assignPropAgent(R.A1, crew); s.assignPropAgent(R.A2, crew); }
  const B = beltCard(s, 44, 7), labels = B.keys.map(k => k.label);
  A.eq(labels.length, 2, (crew ? 'two BAYs one agent crews' : 'two uncrewed BAYs') + ' merging: two REMOVE keys');
  A.eq(new Set(labels).size, 2, '…that read differently (both said REMOVE ' + (crew ? 'NOVA ▸ …' : 'AN EMPTY BAY ▸ AN EMPTY BAY') + ') — ' + JSON.stringify(labels));
  A.eq(labels.slice().sort(), ['REMOVE BELT FROM ▴ NORTH', 'REMOVE BELT FROM ▾ SOUTH'], '…each by the side its belt joins the shared run from (A1 comes down from the north, A2 up from the south; the sentences above name the machines)');
  const north = B.keys.findIndex(k => /FROM ▴ NORTH/.test(k.label)), n1 = north >= 0 && R.s.links().find(l => l.id === B.ctx.connsAt(44, 7)[north].ids[0]);
  A.ok(!!n1 && n1.from.prop === R.A1, '…and FROM ▴ NORTH is A1\'s connection');
  A.ok(/The belt from ▴ north runs from/.test(B.html) && /The belt from ▾ south runs from/.test(B.html), 'the card\'s sentences use the same words');
  const lit = B.keys.map(k => { if (k.on.pointerenter) k.on.pointerenter(); const h = B.ctx.beltCardHot, cells = h && h.cells ? h.cells.map(q => q.x + ',' + q.y) : []; if (k.on.pointerleave) k.on.pointerleave(); return cells; });
  const own = id => s.links().filter(l => l.from.prop === id).reduce((a, l) => a.concat(l.path.map(q => q.x + ',' + q.y)), []);
  A.ok(lit.every(c => c.length > 0) && lit[0].join() !== lit[1].join(), 'pointing at a key lights the tiles its belt alone rides — ' + JSON.stringify(lit));
  A.ok(lit.every(c => !c.includes('44,7')) && [R.A1, R.A2].every(id => lit.some(c => c.every(k => own(id).includes(k)))), '…its own run, never the shared tail');
  A.eq(B.ctx.beltCardHot, null, 'pointer gone: nothing lit');
  B.keys[0].on.pointerenter(); A.eq(B.peek.on, true, 'while a key is pointed at, the card lets the floor show through (its backdrop blurred the lit run away)'); B.keys[0].on.pointerleave(); A.eq(B.peek.on, false, '…and dims again after');
  A.ok(typeof B.keys[0].on.focus === 'function' && typeof B.keys[0].on.blur === 'function', 'a key reached by Tab answers too');
  B.keys[0].on.focus(); A.eq(JSON.stringify(B.ctx.beltCardHot.cells.map(q => q.x + ',' + q.y)), JSON.stringify(lit[0]), '…lighting the same belt');
  B.keys[0].on.blur(); A.eq(B.ctx.beltCardHot, null, '…and letting it go');
  B.keys[1].on.pointerenter(); B.keys[1].onclick();
  A.eq(B.ctx.beltCardHot, null, 'the card gone (its key took the belt): nothing left lit');
  A.eq(s.links().length, 1, '…and that key took exactly one connection');
}

{
  const s0 = hall(); const A1 = add(s0, 'bay', 36, 5), A2 = add(s0, 'bay', 40, 5), A3 = add(s0, 'bay', 44, 5), C = add(s0, 'bay', 48, 10);
  const d = s0.serialize(); delete d.links; const s = WM.deserialize(d);
  for (const [a, b] of [[[36, 7], [36, 9]], [[40, 7], [40, 9]], [[44, 7], [44, 9]], [[36, 10], [47, 10]]]) A.ok(s.placeBeltRun({ tx: a[0], ty: a[1] }, { tx: b[0], ty: b[1] }).ok, 'rig: hand-laid run');
  A.eq(s.links().filter(l => l.path.some(q => q.x === 46 && q.y === 10)).length, 3, 'rig: three uncrewed BAYs share the run at 46,10 (two join it from the north)');
  const labels = beltCard(s, 46, 10).keys.map(k => k.label);
  A.eq(labels, ['REMOVE BELT 1', 'REMOVE BELT 2', 'REMOVE BELT 3'], 'when the side words would repeat, the look-alikes are numbered (never two keys that read the same)');
  A.ok(/Belt 1 runs from/.test(beltCard(s, 46, 10).html), '…as their sentences are');
}
{
  // two groups of look-alikes on one tile (two uncrewed BAYs, two BAYs NOVA crews), each with a belt from the north: the short keys
  // would repeat across the groups, so those carry their machines
  const s0 = hall(); const A1 = add(s0, 'bay', 32, 4), A2 = add(s0, 'bay', 32, 10), N1 = add(s0, 'bay', 42, 2), N2 = add(s0, 'bay', 42, 11), C = add(s0, 'bay', 48, 7);
  s0.assignPropAgent(N1, 'nova'); s0.assignPropAgent(N2, 'nova');
  const d = s0.serialize(); delete d.links; const s = WM.deserialize(d);
  for (const [a, b] of [[[34, 4], [39, 4]], [[40, 4], [40, 6]], [[34, 10], [39, 10]], [[40, 10], [40, 8]], [[43, 4], [43, 6]], [[43, 10], [43, 8]], [[40, 7], [47, 7]]]) A.ok(s.placeBeltRun({ tx: a[0], ty: a[1] }, { tx: b[0], ty: b[1] }).ok, 'rig: hand-laid run');
  A.eq(s.links().filter(l => l.path.some(q => q.x === 45 && q.y === 7)).length, 4, 'rig: four BAYs share the run at 45,7');
  const labels = beltCard(s, 45, 7).keys.map(k => k.label);
  A.eq(labels.slice().sort(), ['REMOVE BELT FROM ▴ NORTH · AN EMPTY BAY ▸ AN EMPTY BAY', 'REMOVE BELT FROM ▴ NORTH · NOVA ▸ AN EMPTY BAY', 'REMOVE BELT FROM ▾ SOUTH · AN EMPTY BAY ▸ AN EMPTY BAY', 'REMOVE BELT FROM ▾ SOUTH · NOVA ▸ AN EMPTY BAY'], 'four keys, four different words — ' + JSON.stringify(labels));
}

/* ---------- build-17 c: REMOVE armed (touch) on a tile two connections share ---------- */
{
  const R = legacyMerge(), s = R.s, said = [], before = s.links().length;
  const ctx = rmCtx(s, said, { touchArm: 'remove' });
  A.eq(ctx.removeBeltAt(44, 7, {}), true, 'the tap is answered');
  A.eq(s.links().length, before, 'nothing goes without a pick');
  A.eq(said, ['CARD 44,7'], 'REMOVE armed: the tap opens the belt card with one REMOVE key per connection (it said CLICK IT, and the next tap only repeated that)');
  const mouse = [], m = rmCtx(s, mouse);
  m.removeBeltAt(44, 7, {});
  A.ok(mouse.length === 1 && /THIS TILE CARRIES 2 BELTS — CLICK IT TO PICK WHICH ONE GOES/.test(mouse[0]), 'right-click (SELECT, where a click opens the card) keeps the advice — ' + mouse[0]);
}

/* ---------- build-12 a + b: ② is done only on evidence about THIS line ---------- */
function finReal(s, intake, o) {
  const geo = s.projectGeometry(), valPlan = P.compileRoutingPlan(geo), c = P.lineComponents(geo).find(x => x.intakes.includes(intake));
  let html = '';
  const elm = () => ({ className: '', style: {}, set innerHTML(v) { html = v; }, get innerHTML() { return html; }, querySelector: () => ({ onclick: null, textContent: '' }) });
  const world = Object.assign({ feedState: () => ({ known: true, fed: false }), fedLines: pl => P.fedLineIds(pl), schedOffFor: () => false, startFacts: () => null }, (o && o.world) || {});
  const ctx = run(between('function finState(c) {', 'function finPick() {') + fnOf(src, 'finOnwardPromise') + between('function renderFinCard() {', '// ① — center the camera'), {
    opts: { world, agents: () => (o && o.agents) || [] }, Pipeline: P, WorkflowLine: WL, cacheGeo: geo, valPlan, finStartsMemo: null,
    root: { appendChild() {} }, running: true, finEngaged: true, tool: 'belt', finCardEl: null, finSig: '', finComp: null, finSample: null, finSampleRes: null,
    tutorialCoaching: () => false, ordersHide() {}, renderOrders() {}, bumpUi() {}, finPick: () => c, lineNameOf: () => null,
    workflowReadout: () => ({ compact: '' }), agentLabelFor: a => a, document: { createElement: elm }, esc: x => String(x), finSampleHTML: () => '',
    finMark() {}, sfx() {}, currentPresetExample: () => null, openPresetExample() {}, openFlowCard() {}, openStepCard() {}, finFocusCrew() {}, finOpenFeed() {}, finRunSample() {},
    station: s
  });
  ctx.renderFinCard();
  const m = /data-act="feed"[^>]*>([^<]*)</.exec(html);
  return m ? m[1] : html;
}
function fedRig() {
  const s = hall(70, 40);
  const I = add(s, 'intake', 32, 4), B1 = add(s, 'bay', 40, 4), O = add(s, 'outbox', 50, 4);
  s.assignPropAgent(B1, 'ava');
  A.ok(s.connectBelt(I, B1).ok && s.connectBelt(B1, O).ok, 'rig: line C (INBOX → BAY → OUTBOX)');
  return { s, I, B1, O };
}
{
  const R = fedRig(), s = R.s;
  const B2 = add(s, 'bay', 40, 16), O2 = add(s, 'outbox', 50, 16);   // a fragment: BAY → OUTBOX, its INBOX not laid yet
  A.ok(s.connectBelt(B2, O2).ok && s.setSendTo(O2, R.I).ok, 'rig: the fragment SENDS TO line C');
  const plan = P.compileRoutingPlan(s.projectGeometry()), toLine = plan.lineOfProp[R.I];
  A.ok(!!(plan.sendTo && plan.sendTo[O2]), 'rig: the compiled hand-off is there (it will run once the fragment has an INBOX)');
  A.ok(!P.fedLineIds(plan)[toLine], 'a SEND TO from a fragment with no INBOX feeds nothing: no job can ever start on it');
  A.eq(finReal(s, R.I), '② CHOOSE WHAT STARTS THIS LINE', 'FINISH THE LINE keeps ② open (it said ✓ FED BY ANOTHER LINE)');
  const I2 = add(s, 'intake', 32, 16);
  A.ok(s.connectBelt(I2, B2).ok, 'rig: the fragment gets its INBOX (unnamed)');
  const fromKey = P.compileRoutingPlan(s.projectGeometry()).lineOfProp[I2], word = s.lineName(fromKey);
  A.ok(/^LINE [A-Z]/.test(word || ''), 'rig: the sending line shows as LINE <letter> — ' + word);
  A.eq(finReal(s, R.I), '✓ FED BY ' + word, 'now it can run: ✓ FED BY ' + word + ', by the one line name (never ANOTHER LINE)');
  A.ok(!/'ANOTHER LINE'/.test(fnOf(src, 'renderFinCard')), 'no unnamed-sender fallback is left to say');
}
{
  const R = fedRig(), s = R.s, I = R.I;
  const lineKey = P.compileRoutingPlan(s.projectGeometry()).lineOfProp[I];
  const fedAll = { feedState: () => ({ known: true, fed: true }) };
  const facts = f => Object.assign({}, fedAll, { startFacts: () => f });
  A.eq(finReal(s, I, { world: fedAll }), '② CHOOSE WHAT STARTS THIS LINE', 'a channel or routine SOMEWHERE on the station is no start of this line (it said ✓ AUTOMATIC START CONFIGURED)');
  const job = (o2) => Object.assign({ id: 'j1', name: 'morning', agentId: 'ava', dockId: R.B1, runsLine: true, enabled: true, scheduleDisplay: 'daily 9:00' }, o2 || {});
  A.eq(finReal(s, I, { world: facts({ cron: { enabled: true, jobs: [job()] } }) }), '✓ AUTOMATIC START CONFIGURED', 'a routine that runs THIS line from its entry step: ✓ AUTOMATIC START CONFIGURED');
  A.eq(finReal(s, I, { world: facts({ cron: { enabled: true, jobs: [job({ agentId: 'zed', dockId: null })] } }) }), '② CHOOSE WHAT STARTS THIS LINE', 'a routine for an agent on no step of this line: still open');
  A.eq(finReal(s, I, { world: facts({ cron: { enabled: true, jobs: [job({ runsLine: false })] } }) }), '② CHOOSE WHAT STARTS THIS LINE', 'a routine that runs only its own step, not the line: still open');
  A.eq(finReal(s, I, { world: facts({ chans: { telegram: { configured: true, connected: true, agentName: 'Ava' } } }), agents: [{ id: 'ava', name: 'Ava' }] }), '✓ AUTOMATIC START CONFIGURED', 'a connected channel that answers as the first step: ✓');
  A.eq(finReal(s, I, { world: facts({ chans: { telegram: { configured: true, connected: true, agentName: 'Zed' } } }), agents: [{ id: 'ava', name: 'Ava' }, { id: 'zed', name: 'Zed' }] }), '② CHOOSE WHAT STARTS THIS LINE', 'a channel answering as someone else: still open');
  A.eq(finReal(s, I, { world: facts({ lt: { triggers: [{ id: 't1', lineId: lineKey, kind: 'webhook', enabled: true, blockedBy: null }] } }) }), '✓ AUTOMATIC START CONFIGURED', 'an armed webhook of this line: ✓');
  A.eq(finReal(s, I, { world: facts({ lt: { triggers: [{ id: 't1', lineId: lineKey, kind: 'webhook', enabled: true, blockedBy: 'E-STOP is on' }] } }) }), '② CHOOSE WHAT STARTS THIS LINE', 'a webhook the server holds back: still open');
  A.eq(finReal(s, I, { world: Object.assign({ schedOffFor: () => true }, facts({ cron: { enabled: false, jobs: [job()] } })) }), '② SCHEDULING IS OFF — TURN IT ON', 'this line\'s routine saved while scheduling is off says so, whatever else feeds the station (the station flag hid it)');
}

/* ---------- build-13 a + b: which SEND TO arcs draw while one is being re-aimed ---------- */
{
  const s = hall(70, 40), L1 = line(s, 4, 'Alpha'), L2 = line(s, 14, 'Beta'), L3 = line(s, 24, 'Gamma');
  A.ok(s.setSendTo(L1.O, L2.I).ok, 'rig: ALPHA SENDS TO BETA');
  const arcs = st => {
    const drawn = [], links = s.props().filter(p => p.t === 'outbox' && p.sendTo).map(p => ({ from: p, to: s.propById(p.sendTo), live: true, name: 'X' }));
    const ctx = run(fnOf(src, 'drawSendLinks'), Object.assign({
      station: s, sendLinks: () => links, sendArc: (t, a, b) => ({ a: a.id, b: b.id, ax: 0, ay: 0, mx: 0, my: 0, bx: 0, by: 0 }), strokeSendArc: arc => drawn.push(arc.a + '>' + arc.b),
      altOn: () => false, hoverPropId: null, selectedPropId: null, drag: null, handPlan: () => null, tool: 'select', connectFrom: null, connectTo: null, sendToPv: () => ({ ok: true }),
      ctx: { save() {}, restore() {}, measureText: () => ({ width: 10 }) }, VAL_FONT: () => '', zoom: 1, voiceSay() {}
    }, st || {}));
    ctx.drawSendLinks(16, 0);
    return drawn;
  };
  const one = [L1.O + '>' + L2.I];
  A.eq(arcs(), one, 'at rest: the arc');
  A.eq(arcs({ drag: { mode: 'propmove', propId: L1.O, moved: true } }), one, 'the OUTBOX moved (SELECT MOVES) keeps its SEND TO arc — nothing else drew it, and the hand-off stays after the move');
  A.eq(arcs({ drag: { mode: 'handbelt', propId: L1.O, moved: true }, handPlan: () => ({ ok: true, kind: 'send' }) }), [], 'THE HAND re-aiming it: the ghost draws the new arc, the old one is hidden');
  A.eq(arcs({ drag: { mode: 'handbelt', propId: L1.O, moved: true }, handPlan: () => ({ ok: true, kind: 'floor' }) }), one, 'the OUTBOX laying a belt keeps its arc');
  const belt = o => Object.assign({ tool: 'belt', connectFrom: L1.O, connectTo: null }, o);
  A.eq(arcs(belt({ hoverPropId: L3.I })), [], 'BELT armed on the OUTBOX over another line\'s INBOX: the prospective arc stands in for the old one (two arcs left one OUTBOX)');
  A.eq(arcs(belt({ hoverPropId: null })), one, '…armed, pointing at nothing: the OUTBOX still shows where it sends now');
  A.eq(arcs(belt({ hoverPropId: L2.I })), one, '…over the INBOX it already sends to: that arc');
  A.eq(arcs(belt({ hoverPropId: L3.I, sendToPv: () => ({ ok: false }) })), one, '…over an INBOX it may not send to: a click keeps the old SEND TO, so the old arc stays');
  A.eq(arcs(belt({ hoverPropId: L3.B1 })), one, '…over a BAY (no SEND TO there): the arc stays');
  A.eq(arcs(belt({ connectFrom: L2.O, hoverPropId: L3.I })), one, 'another OUTBOX armed: this arc is not the one re-aimed');
}

let done = false;
function finish() { if (done) return; done = true; A.report('floor-wave2'); }
