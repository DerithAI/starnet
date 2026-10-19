/* test/build-new-line-hand.test.js — NEW LINE = AN INBOX IN HAND (Andrew, 2026-10-13: "When the user clicks on 'create a new line',
   it should open the menu and automatically choose for the user to place an inbox, where they can click wherever they want to
   place it. Not automatically place it for the user").

   BUILD YOUR OWN LINE used to lay INBOX → BAY → OUTBOX itself near the middle of the view (LineEdit's newLine) and open its panel.
   Now the key only puts an INBOX in THE HAND; nothing lands until the Commander clicks. Driven for real: build.js's own setHand /
   startNewLine / paintHandKeys / setHint / commitPropStamp and the landing clock run in a VM against a live WorldModel, so the
   hand, the hint, the lit key, the placement and the floor after the click are the real ones — never a re-implementation.
     · the key puts an INBOX in hand and places NOTHING (no prop, no link, no undo slot); the key and the hotbar's INBOX slot light;
       the hint says what the click does;
     · putting it down (what Esc and right-click do with a piece held) places nothing;
     · a click on clear floor places exactly ONE INBOX on THAT tile — no BAY, no OUTBOX, no belt — one undo; the hand empties, so
       the next drag from the INBOX lays its belt (PICK WHAT GOES HERE offers the next piece); the floor says so where it landed;
     · a click on a machine inspects it and a click off the deck is refused with its reason — nothing placed, the INBOX still held;
     · the hotbar's own INBOX (key 2) keeps its multi-place hand: only NEW LINE is one-shot;
     · the INBOX that lands is DRAWN: its landing never hides it once the frame clock passes the click, and settles to a plain
       draw in LAND_MS; and the frame's draw list (propDrawOrder, memoized per edit) holds every prop the model holds, so a prop
       can never be outlined (the panel's gold mark reads the model) yet left undrawn. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const vm = require('vm');
const WM = require('../frontend/app/worldmodel.js');

const src = fs.readFileSync(require.resolve('../frontend/app/build.js'), 'utf8').replace(/\r\n/g, '\n');
const between = (start, end) => {
  const i = src.indexOf(start), j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error('build.js seam moved: ' + start + ' … ' + end);
  return src.slice(i, j);
};
const line1 = re => { const m = src.match(re); if (!m) throw new Error('build.js line moved: ' + re); return m[0] + '\n'; };
const CODE = line1(/const CONNECT_TYPES = [^\n]+/) + line1(/const JUNCTION_TAG_TYPES = [^\n]+/) + line1(/const HAND_CFG_KEYS = [^\n]+/)
  + line1(/const WORKSTATION_TYPES = [^\n]+/) + line1(/const CAMERA_KEYS = [^\n]+/)
  + between('  function setHand(h, o) {', '  // THE HOTBAR: the conveyor pieces')        // setHand · toggleHand · startNewLine
  + between('  function paintHandKeys() {', '  function propTile(')
  + between('  function setHint(msg) {', '  function setCursor() {')
  + between('  function commitPropStamp(d, ev) {', '  /* DRAG TO LAY A ROW')
  + between('  const landings = new Map();', '  const vanishing = [];');                // landProps · landState (the landing clock)

const el = cls => { const c = new Set(cls); return { classList: { contains: k => c.has(k), toggle: (k, on) => { if (on) c.add(k); else c.delete(k); } }, attrs: {}, setAttribute(k, v) { this.attrs[k] = v; } }; };
function rig() {
  const s = WM.create(); s.projectGeometry();
  s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 70, y2: 30 } });
  const B = s.addProp({ t: 'bay', x: 50, y: 10, w: 2, h: 2, block: true }).id;
  const own = el(['bb', 'refit-ownline']), slot = Object.assign(el(['refit-hotslot']), { dataset: { hot: 'intake' } });
  const said = [], inspected = [], landed = [], hint = { html: '' };
  const root = {
    dataset: {},
    querySelectorAll: sel => sel === '.refit-ownline' ? [own] : sel === '.refit-hotslot' ? [slot] : [],
    querySelector: () => null
  };
  const ctx = {
    console, Math, Object, Array, String, Number, JSON, Map, Set, performance: { now: () => ctx.__now },
    __now: 1000, station: s, root, tool: 'select', buildGroup: 'workflow', hand: null, touchArm: null, dropPick: null, dupe: null, paintTarget: 'deck',
    selectedPropId: null, groupIds: [], selBelts: null, propHoverMemo: null, propType: 'chair', propRot: 0, propMir: 0, deskOwner: null, flipPref: false, altLatched: false,
    hintEl: { classList: { toggle() {} }, set innerHTML(v) { hint.html = v; }, get innerHTML() { return hint.html; } },
    TOOLS: [], esc: v => String(v), catalog: () => [], rowable: () => false, canTurn: () => false, canFlip: () => false,
    propFacing: () => 0, propFlipOn: () => 0, propLabel: t => ({ intake: 'INBOX', bay: 'BAY' }[t] || String(t).toUpperCase()), agentLabel: a => a,
    propBox: t => (t === 'intake' || t === 'bay' || t === 'outbox') ? { w: 2, h: 2 } : { w: 1, h: 1 }, propSpec: () => ({ blocks: true }),
    selectTool(id) { ctx.tool = id; }, renderSelection() {}, hideTip() {}, setCursor() {}, sfx() {}, sfxLand() {}, hidePropCard() {},
    rowSpots: () => null, commitRow() {}, junctionSnap: () => null, agentHere: () => false, linkedFloor: () => !!s.isLinked(), beltUnderFoot: () => null,
    addOwnedDesk() { throw new Error('not a desk'); }, placementReason: x => (x.rects && x.v && x.v.msg) || 'blocked', pushFlash() {},
    isEditableProp: () => true, renderEquipmentInfo() {}, flashTip: (ev, msg, ok) => said.push((ok ? 'OK ' : 'NO ') + msg),
    feedback: (res, ev, okMsg) => said.push(res && res.ok ? 'OK ' + okMsg : 'NO ' + ((res && res.msg) || 'blocked')),
    onInspect: p => inspected.push(p.id), WorldModel: undefined
  };
  vm.createContext(ctx);
  vm.runInContext(CODE + '\nthis.__api = { setHand, toggleHand, startNewLine, commitPropStamp, landProps, landState, LAND_MS, landings, paintHandKeys };', ctx);
  const real = ctx.__api.landProps;
  ctx.landProps = (ids, st) => { landed.push(...ids); return real(ids, st); };
  vm.runInContext('landProps = this.landProps;', ctx);
  const press = (x, y) => ctx.__api.commitPropStamp({ start: { tx: x, ty: y }, cur: { tx: x, ty: y }, moved: false, cx: 0, cy: 0 }, { clientX: 0, clientY: 0 });
  const machines = () => s.props().filter(p => ['intake', 'bay', 'outbox'].includes(p.t)).map(p => p.t + '@' + p.x + ',' + p.y).sort();
  return { s, B, ctx, api: ctx.__api, own, slot, said, inspected, landed, hint, press, machines };
}
const verbOf = h => { const m = /<span class="refit-hint-verb">([^<]*)<\/span>/.exec(h.html); return m ? m[1] : ''; };

/* ---------- 1. the key: an INBOX in hand, nothing placed ---------- */
{
  const r = rig(), before = r.machines(), undo0 = r.s.canUndo(), links0 = (r.s.links() || []).length;
  r.api.startNewLine();
  A.eq(r.ctx.hand && r.ctx.hand.t, 'intake', 'BUILD YOUR OWN LINE puts an INBOX in hand');
  A.ok(r.ctx.hand && r.ctx.hand.newLine === true, '…marked as a NEW LINE (one-shot)');
  A.eq(r.machines(), before, '…and places NOTHING: no INBOX, no BAY, no OUTBOX laid for them');
  A.eq((r.s.links() || []).length, links0, '…no belt');
  A.eq(r.s.canUndo(), undo0, '…and no undo slot (nothing happened to the floor)');
  A.eq(r.ctx.propType, 'intake', 'the ghost the pointer carries is the INBOX (propType)');
  A.eq(r.ctx.root.dataset.hand, 'intake', 'the floor knows a piece is held');
  A.ok(r.own.classList.contains('active') && r.own.attrs['aria-pressed'] === 'true', 'the BUILD YOUR OWN LINE key is lit (aria-pressed) while its INBOX is held');
  A.ok(r.slot.classList.contains('active'), '…and so is the hotbar\'s INBOX slot (it IS the hand)');
  A.ok(/Click where your line starts/.test(verbOf(r.hint)) && /Esc cancels/.test(verbOf(r.hint)), 'the hint says what the click does and how to back out: ' + verbOf(r.hint));
  A.ok(verbOf(r.hint).length <= 45, 'the hint fits the dock\'s hint bar (≤ 45 characters, no ellipsis): ' + verbOf(r.hint).length);

  // putting it down (Esc / right-click both call setHand(null) with a piece held — locked below) places nothing
  r.api.setHand(null, { silent: true });
  A.eq(r.ctx.hand, null, 'putting it down empties the hand');
  A.eq(r.machines(), before, '…with nothing placed');
  A.ok(!r.own.classList.contains('active') && !r.slot.classList.contains('active'), '…and the key and the slot go dark');
}

/* ---------- 2. a click on clear floor: ONE INBOX, on that tile, then the hand's way on ---------- */
{
  const r = rig(), before = r.machines(), links0 = (r.s.links() || []).length;
  r.api.startNewLine();
  r.press(36, 20);
  const made = r.machines().filter(m => !before.includes(m));
  A.eq(made, ['intake@36,20'], 'one click places exactly ONE INBOX, on the tile clicked — no BAY, no OUTBOX: ' + JSON.stringify(made));
  A.eq((r.s.links() || []).length, links0, '…and no belt is laid for them');
  A.eq(r.ctx.hand, null, 'the hand empties once it lands (one INBOX per NEW LINE) — the next drag FROM it lays its belt');
  A.ok(!r.own.classList.contains('active'), '…the key goes dark');
  A.ok(r.said.some(m => m === 'OK INBOX PLACED · DRAG FROM IT TO LAY YOUR LINE'), 'the floor says what comes next where it landed: ' + JSON.stringify(r.said));
  const id = r.s.props().find(p => p.t === 'intake' && p.x === 36 && p.y === 20).id;
  A.ok(r.landed.includes(id), 'it lands with the placement drop (landProps on its id)');
  A.ok(r.s.canUndo() && r.s.undo().ok && !r.machines().includes('intake@36,20'), 'ONE undo takes it back');

  // the landing never hides it: from the frame after the click it is drawn (alpha ≥ .35, full by a third of the drop) and it settles
  r.api.landProps([id]);
  const t0 = r.ctx.__now, L = r.api.LAND_MS;
  const at = dt => r.api.landState(id, t0 + dt);
  A.ok(at(0) && at(0).a >= 0.35, 'the frame of the click draws it (alpha ' + (at(0) && at(0).a) + ')');
  A.ok(at(L * 0.35) && at(L * 0.35).a === 1, '…fully opaque a third of the way through the drop');
  A.eq(at(L + 1), null, '…and after LAND_MS it is a plain draw (the landing is over and forgotten)');
  A.ok(!r.api.landings.has(id), '…its landing entry is gone, so nothing can hold it in the air');
}

/* ---------- 3. what a click that cannot place does: nothing placed, the INBOX still held ---------- */
{
  const r = rig(), before = r.machines();
  r.api.startNewLine();
  r.press(50, 10);   // on the BAY: CLICK-ON-MACHINE WINS
  A.eq(r.inspected, [r.B], 'a click on a machine inspects it (never stacks an INBOX on it)');
  A.eq(r.machines(), before, '…nothing placed');
  A.ok(r.ctx.hand && r.ctx.hand.newLine, '…and the INBOX is still in hand');
  r.press(80, 40);   // off the deck
  A.eq(r.machines(), before, 'a click off the deck places nothing');
  A.ok(r.said.some(m => /^NO /.test(m)), '…and says why: ' + JSON.stringify(r.said));
  A.ok(r.ctx.hand && r.ctx.hand.newLine, '…the INBOX still in hand, to click somewhere it fits');
  r.press(40, 22);
  A.ok(r.machines().includes('intake@40,22') && r.ctx.hand === null, 'then a click on clear floor places it there and empties the hand');
}

/* ---------- 4. the hotbar's own INBOX keeps its multi-place hand (only NEW LINE is one-shot) ---------- */
{
  const r = rig(), before = r.machines();
  r.api.toggleHand('intake');
  A.ok(r.ctx.hand && r.ctx.hand.t === 'intake' && !r.ctx.hand.newLine, 'key 2 / the hotbar slot holds a plain INBOX');
  A.ok(!r.own.classList.contains('active'), '…which never lights BUILD YOUR OWN LINE');
  r.press(36, 20);
  A.ok(r.ctx.hand && r.ctx.hand.t === 'intake', '…and it stays in hand after a placement (PLACEMENT FLOW: furnish without re-picking)');
  A.eq(r.machines().filter(m => !before.includes(m)), ['intake@36,20'], '…having placed one INBOX');
}

/* ---------- 5. every prop the model holds is in the draw list (the frame's own propDrawOrder) ---------- */
{
  // the memo is per edit (geoVer); the gold outline reads the model directly — so a prop the model gained without the version moving
  // must still be drawn (and picked): the memo answers only while it is the model's own list at the model's own length
  const s = WM.create(); s.projectGeometry();
  s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 70, y2: 30 } });
  s.addProp({ t: 'bay', x: 50, y: 10, w: 2, h: 2, block: true });
  const ctx = { station: s, geoVer: 7, mountVer: 0, mountOrder: null, mountMap: null, Map, PropSprites: { spec: () => null, TILE: 12 } };
  vm.createContext(ctx);
  vm.runInContext(between('  let mountList = null, mountLen = -1;', '  // conveyor — belts (floor machinery)') + '\nthis.__order = propDrawOrder;', ctx);
  const ids = () => ctx.__order(s.props()).map(p => p.t + '@' + p.x + ',' + p.y);
  A.eq(ids(), ['bay@50,10'], 'the draw list holds the floor\'s props');
  const first = ctx.__order(s.props());
  A.ok(ctx.__order(s.props()) === first, '…memoized: an unchanged floor re-uses the same sorted list (no per-frame sort)');
  s.addProp({ t: 'intake', x: 36, y: 20, w: 2, h: 2, block: true });   // the model gains an INBOX; geoVer is NOT bumped
  A.ok(ids().includes('intake@36,20'), 'a prop the model gained without the edit version moving is still in the next frame\'s draw list');
  s.undo();   // the model hands in a new props array (restore)
  A.eq(ids(), ['bay@50,10'], '…and one the model let go of is not');
}

/* ---------- 6. the wiring: the key, Esc and right-click ---------- */
const own = between('        /* BUILD YOUR OWN (conveyor-links phase D)', '        const grid = document.createElement(\'div\'); grid.className = \'refit-linegrid\';');
A.ok(/own\.onclick = \(\) => startNewLine\(\);/.test(own), 'the BUILD YOUR OWN LINE key runs startNewLine');
A.ok(!/lineEditRun\(|LineEdit\.|openWorkflowPanel\(/.test(own), '…and never lays a line or opens a panel itself');
A.ok(/className = 'bb refit-ownline' \+ \(hand && hand\.newLine \? ' active' : ''\)/.test(own), '…a re-rendered library keeps the key lit while its INBOX is held');
A.ok(/if \(!drag && \(hand \|\| touchArm \|\| dropPick\)\) \{ setHand\(null\); return; \}/.test(src), 'Esc with a piece held puts it down');
A.ok(/if \(ev\.button === 2\) \{[\s\S]{0,400}if \(hand \|\| touchArm \|\| dropPick\) setHand\(null, \{ silent: true \}\);/.test(src), 'right-click with a piece held puts it down');
A.ok(/if \(hand\) \{ drag = \{ mode: 'propstamp'/.test(src) && /if \(d\.mode === 'propstamp'\) return commitPropStamp\(d, ev\);/.test(src), 'a press with a piece in hand is the placement stamp (commitPropStamp)');
const css = fs.readFileSync(require.resolve('../frontend/css/refit-polish.css'), 'utf8');
A.ok(/\.refit-overlay \.refit-ownline\.active \{[^}]*\}/.test(css), 'the lit key has its own matte state (no glow)');
A.ok(!/\.refit-ownline\.active \{[^}]*(text-shadow|blur\()/.test(css), '…drawn with an edge, never a glow');

A.report('build-new-line-hand.test');
