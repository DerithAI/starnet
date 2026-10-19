/* test/build-hand.test.js — THE HAND (2026-10-10, Andrew: "fully polish and integrate this into starnet" — his build-mode prototype).
   Building a line is DRAGGING: drag a machine and the belt follows the pointer (connect / re-route / merge into a belt / empty
   floor → pick what goes there), drag a belt's middle and it branches, a junction held over a belt goes ON it, right-click
   removes, R flips the corner, Alt shows every setting, and every undo says UNDID · <WHAT> where it happened.
   Locked here:
     A. the model gestures (worldmodel.js) — every preview is PURE (the doc and its edit counter never move), every gesture is
        ONE undo, the preview IS the commit (same route, the corner flip included), a junction never lands where it would take
        the line apart, and the compile stays clean (a FILTER keeps its EVERYTHING ELSE lane, a LOOP its DONE lane);
     B. undo / redo hand back what they took back (a label + the rects) — read off the two snapshots, never guessed;
     C. Pipeline.lineStages counts what LINE_TOO_LONG counts (the Alt view's n/max is the compiler's own number);
     D. the build.js wiring (source locks — build.js is the DOM-bound REFIT module): the hand is a sub-state of SELECT, the
        hotbar keys only while the Conveyors tab is up, Alt never reaches the browser menu and never sticks, the ghost is drawn
        geometry (never a second convey.drawBelts), previews are memoized per edit + tile + corner, right-click removes only
        with nothing held. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');

const plan = s => P.compileRoutingPlan(s.projectGeometry());
const codes = s => plan(s).errors.filter(e => e.code !== 'UNBOUND_BAY').map(e => e.code);
function fresh() { const s = WM.create(); s.projectGeometry(); s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 70, y2: 30 } }); return s; }
const add = (s, t, x, y) => { const big = t === 'bay' || t === 'intake' || t === 'outbox'; return s.addProp({ t, x, y, w: big ? 2 : 1, h: big ? 2 : 1, block: big }).id; };
const pathKey = p => (p || []).map(q => q.x + ',' + q.y).join(' ');
const linkOf = (s, a, b) => (s.links() || []).find(l => l.from.prop === a && l.to.prop === b);
// INBOX → BAY → BAY → OUTBOX along y=4, crewed
function line(s) {
  const I = add(s, 'intake', 32, 4), B1 = add(s, 'bay', 40, 4), B2 = add(s, 'bay', 48, 4), O = add(s, 'outbox', 58, 4);
  s.assignPropAgent(B1, 'a'); s.assignPropAgent(B2, 'b');
  for (const [a, b] of [[I, B1], [B1, B2], [B2, O]]) A.ok(s.connectBelt(a, b).ok, 'line laid ' + a + '→' + b);
  return { I, B1, B2, O };
}
const frozen = s => JSON.stringify(s.serialize()) + '|' + s.getSeq() + '|' + s.canUndo();

/* ---------- A. the model gestures ---------- */
{
  const s = fresh(), L = line(s);
  A.eq(codes(s), [], 'the line compiles clean');
  const before = frozen(s);
  // PURE previews: nothing a drag asks writes to the doc or moves the edit counter
  const mid = linkOf(s, L.B1, L.B2).path[3];
  const pvs = [
    s.previewBeltTo(L.B2, { x: 45, y: 16 }), s.previewBeltTo(L.I, { x: mid.x, y: mid.y }), s.previewBranch({ x: mid.x, y: mid.y }, { x: 50, y: 18 }),
    s.previewBranch({ x: mid.x, y: mid.y }, L.O), s.previewRelink(linkOf(s, L.B1, L.B2).id, L.O), s.junctionOnBeltRefusal(mid.x, mid.y),
    s.probeDrop(L.B2, { x: 45, y: 16 }, [{ t: 'bay', w: 2, h: 2, block: true }, { t: 'filter', w: 1, h: 1, block: false }])
  ];
  A.eq(frozen(s), before, 'every preview (belt-to-tile, branch, re-route, the drop probe) leaves the doc, its edit counter and the undo stack untouched');
  A.ok(pvs[0].ok && pvs[0].mode === 'floor' && pvs[0].path.length > 2, 'a machine dragged to empty floor previews a route there');
  A.ok(pvs[2].ok && pvs[2].mode === 'branchfloor', 'a belt dragged from its middle previews a branch');
  A.ok(pvs[6].length === 2 && pvs[6].every(q => q.ok), 'the drop probe says which pieces fit (asked of a probe copy)');

  // a junction never lands where it takes the line apart
  const l1 = linkOf(s, L.I, L.B1);
  A.eq(s.junctionOnBeltRefusal(l1.path[0].x, l1.path[0].y).error, 'BELT_END', 'never on a belt\'s FIRST tile (it belongs to the machine there)');
  A.eq(s.junctionOnBeltRefusal(l1.path[l1.path.length - 1].x, l1.path[l1.path.length - 1].y).error, 'BELT_END', '…nor its LAST');
  A.eq(s.junctionOnBeltRefusal(36, 20).error, 'NO_BELT', 'a tile with no belt is not a belt');
  A.ok(!!s.junctionOnBeltRefusal(l1.path[1].x, l1.path[1].y) === false, 'a middle tile takes one');

  // FILTER / LOOP on a belt: the lane it already runs on becomes EVERYTHING ELSE / DONE — the line keeps flowing, one undo
  const ft = l1.path[2], fr = s.junctionOnBelt(ft.x, ft.y, 'filter');
  A.ok(fr.ok && s.propById(fr.id).def === ft.d, 'a FILTER put on a belt takes that lane as its default (EVERYTHING ELSE)');
  A.eq(codes(s), [], '…so the floor compiles clean (no FILTER_NO_DEFAULT)');
  A.ok(linkOf(s, L.I, fr.id) && linkOf(s, fr.id, L.B1), '…and the belt it sits on became two links through it');
  A.ok(!!s.junctionOnBeltRefusal(l1.path[1].x, l1.path[1].y), 'never right beside another junction (the tile next to it ends a link now)');
  const u1 = s.undo();
  A.ok(u1.ok && u1.label === 'FILTER' && u1.rects.some(r => r.x1 === ft.x && r.y1 === ft.y), 'ONE undo takes it back — and says UNDID · FILTER over its tile');
  A.ok(linkOf(s, L.I, L.B1), '…the belt is whole again');
  s.redo();
  const lt = linkOf(s, L.B2, L.O).path[3], lr = s.junctionOnBelt(lt.x, lt.y, 'loop', { cfg: { maxIter: 3, when: 'APPROVED', done: 'W' } });
  A.ok(lr.ok && s.propById(lr.id).done === lt.d && s.propById(lr.id).maxIter === 3 && s.propById(lr.id).when === 'APPROVED', 'a LOOP keeps the belt\'s lane as DONE and carries passes + verdict from the hand — never a compass lane from elsewhere');
  // removing a 1-in / 1-out junction rejoins the belt it sat on (the floor's own reconcile)
  A.ok(s.removeProp(lr.id).ok && linkOf(s, L.B2, L.O), 'removing a junction that sat on one belt rejoins that belt');
  // a SPLIT THE JOB splitter picked up (Q) and clicked onto a belt — the normal way a splitter goes down — keeps dividing
  // (final floor lane M16 / R22: the PICK UP key promises "its settings … too")
  const sp = linkOf(s, L.B1, L.B2), st = sp.path[Math.floor(sp.path.length / 2)], sr = s.junctionOnBelt(st.x, st.y, 'splitter', { cfg: { divide: true, bufferSize: 3 } });
  A.ok(sr.ok && s.propById(sr.id).divide === true && s.propById(sr.id).bufferSize === 3, 'a SPLIT THE JOB splitter in hand keeps its divide mode on a belt — ' + JSON.stringify(sr.ok ? s.propById(sr.id) : sr));
  const plain = s.junctionOnBelt(linkOf(s, L.B2, L.O).path[3].x, linkOf(s, L.B2, L.O).path[3].y, 'splitter', { cfg: { divide: 'yes' } });
  A.ok(plain.ok && !s.propById(plain.id).divide, '…and only a literal true divides (the held value stays sanitized)');
}

/* ---------- A2. connect / merge / branch / re-route / drop: one undo each, the preview IS the commit ---------- */
{
  const s = fresh(), L = line(s);
  const B3 = add(s, 'bay', 40, 20); s.assignPropAgent(B3, 'c');
  // MERGE: B3 dragged onto the B1→B2 belt
  const mt = linkOf(s, L.B1, L.B2).path[3], pv = s.previewBeltTo(B3, mt);
  A.ok(pv.ok && pv.mode === 'merge', 'a machine dragged onto a belt previews a MERGE');
  const n0 = s.props().length, mr = s.mergeBelt(B3, mt);
  A.ok(mr.ok && s.propById(mr.id).t === 'merger' && s.props().length === n0 + 1, 'the release lands a MERGER on that tile');
  A.eq(pathKey(linkOf(s, B3, mr.id).path), pathKey(pv.path), 'the belt laid is the belt previewed');
  A.eq(codes(s), ['BAY_NOT_FED'], 'and the floor compiles clean (B3 itself is fed by nothing yet — the one honest finding)');
  A.ok(Object.values(plan(s).junctions).some(j => j.kind === 'merge'), '…with a real MERGE junction on the line');
  const um = s.undo();
  A.ok(um.label === 'MERGER' && s.props().length === n0 && !linkOf(s, B3, mr.id), 'ONE undo takes the merger AND its belt back (UNDID · MERGER)');
  s.redo();
  // RE-ROUTE: B3's one exit (into the merger) laid again to the OUTBOX — same link id, same port
  const ex = s.links().find(l => l.from.prop === B3), rp = s.previewRelink(ex.id, L.O);
  A.ok(rp.ok, 're-route previews');
  const rr = s.relinkTo(ex.id, L.O);
  const nl = s.links().find(l => l.id === ex.id);
  A.ok(rr.ok && nl && nl.to.prop === L.O && nl.from.prop === B3, 'RE-ROUTE keeps the link (its id) and hands it to the new machine');
  A.eq(pathKey(nl.path), pathKey(rp.path), 'the re-route laid is the re-route previewed');
  A.eq(s.undo().label, 'RE-ROUTE', 'one undo — UNDID · RE-ROUTE');
  // BRANCH: drag off the middle of I→B1 onto empty floor, pick a BAY
  const bt = linkOf(s, L.I, L.B1).path[3], bp = s.previewBranch({ x: bt.x, y: bt.y }, { x: 36, y: 16 });
  A.ok(bp.ok && bp.mode === 'branchfloor', 'branch to empty floor previews');
  const br = s.branchBelt({ x: bt.x, y: bt.y }, { x: 36, y: 16 }, { place: { t: 'bay', w: 2, h: 2, block: true } });
  A.ok(br.ok && s.propById(br.id).t === 'splitter' && s.propById(br.made).t === 'bay', 'the release lands a SPLITTER on the belt and the picked BAY at the pin, belted');
  A.ok(linkOf(s, br.id, br.made) && linkOf(s, L.I, br.id) && linkOf(s, br.id, L.B1), 'the splitter feeds both the old line and the new branch');
  A.ok(!codes(s).includes('SPLIT_ONE_LANE'), 'a split never shows with one lane (both lanes laid in ONE transact)');
  A.eq(s.undo().label, 'SPLITTER', 'one undo takes the branch back');
  A.ok(linkOf(s, L.I, L.B1), '…whole');
  // BRANCH onto another belt = SPLITTER + MERGER
  const t1 = linkOf(s, L.I, L.B1).path[3], t2 = linkOf(s, L.B2, L.O).path[4];
  const bm = s.branchBelt({ x: t1.x, y: t1.y }, { x: t2.x, y: t2.y });
  A.ok(bm.ok && s.propById(bm.id).t === 'splitter' && s.propById(bm.made).t === 'merger', 'a belt dragged onto another belt lands a SPLITTER and a MERGER');
  s.undo();
  // EMPTY-FLOOR DROP from a machine: the piece stands at the pin and is belted, one undo
  const d0 = s.props().length, dr = s.dropFrom(B3, { x: 52, y: 22 }, { t: 'outbox', w: 2, h: 2, block: true });
  A.ok(dr.ok && s.propById(dr.id).t === 'outbox' && linkOf(s, B3, dr.id), 'a drop on empty floor stands the picked piece there and belts it');
  A.eq(s.undo().label, 'OUTBOX', '…one undo (UNDID · OUTBOX)');
  A.eq(s.props().length, d0, '…and it is gone again');
  // REMOVE A WHOLE BELT (right-click): the link and every tile no other link rides, one undo
  const kill = linkOf(s, L.I, L.B1), kt = kill.path[2], belts0 = s.belts().length;
  const rl = s.removeLinkAt(kt.x, kt.y);
  A.ok(rl.ok && !s.links().some(l => l.id === kill.id) && s.belts().length === belts0 - kill.path.length, 'right-click on a belt removes its WHOLE link');
  const ur = s.undo();
  A.ok(ur.label === 'BELT' && s.belts().length === belts0 && s.links().some(l => l.id === kill.id), '…one undo puts it back (UNDID · BELT)');
}

/* ---------- A3. R flips the corner — and the commit lays what the flipped preview drew ---------- */
{
  const s = fresh();
  const C = add(s, 'bay', 48, 14);
  let differs = 0, last = null;
  for (const [x, y] of [[35, 3], [60, 3], [35, 25], [60, 25]]) {
    const T = last = add(s, 'bay', x, y);
    const a = s.previewBelt(C, T), b = s.previewBelt(C, T, { flip: true });
    A.ok(a.ok && b.ok && a.path.length === b.path.length, 'flipped or not, the route is a shortest one (' + x + ',' + y + ')');
    if (pathKey(a.path) !== pathKey(b.path)) differs++;
  }
  A.eq(differs, 4, 'on every diagonal the flip turns the corner the other way');
  const T = last, pv = s.previewBelt(C, T, { flip: true }), r = s.connectBelt(C, T, { flip: true });
  A.ok(r.ok && pathKey(linkOf(s, C, T).path) === pathKey(pv.path), 'connect with the flip lays exactly the flipped preview');
}

/* ---------- A4. repair 2026-10-11: a junction on a belt never re-wires the floor; a drop's ghost belt is the belt it lays ---------- */
{
  /* two fuzz-found floors (trimmed): the junction's tile, or the tile before / after it, sat in the 1-tile ring of a machine that was
     not that end of the belt, and the floor's reconcile handed the run to that machine (a p4<->p5 cycle, the line cut in two) while
     the refusal said yes and the floor chimed PUT ON THE LINE */
  const fx = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'hand-junction-rewire.json'), 'utf8'));
  for (const [name, doc, x, y] of [['ring', fx.ring, 61, 22], ['bothEnds', fx.bothEnds, 69, 9]]) {
    const s = WM.create(JSON.parse(JSON.stringify(doc))), before = frozen(s);
    const no = s.junctionOnBeltRefusal(x, y);
    A.ok(no && no.error === 'NEAR_MACHINE' && no.short === 'TOO CLOSE TO ANOTHER MACHINE', name + ': the refusal names the machine beside the cut (the ghost goes red)');
    const r = s.junctionOnBelt(x, y, 'splitter');
    A.ok(!r.ok && frozen(s) === before, name + ': …and the commit agrees — nothing laid, nothing re-wired, no undo slot');
    const tgt = s.props().find(p => p.t === 'bay' && !(s.links() || []).some(l => l.from.prop === p.id || l.to.prop === p.id)) || s.props()[0];
    A.ok(!s.previewBranch({ x, y }, tgt.id, {}).ok && !s.branchBelt({ x, y }, tgt.id, {}).ok && frozen(s) === before, name + ': a branch from that tile is refused the same way');
  }
  // the commit's own judge (a backstop the refusal mirrors): every other link keeps its ends, the cut link becomes exactly start→J→end
  const wm = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'worldmodel.js'), 'utf8');
  const job = wm.slice(wm.indexOf('function junctionOnBelt('), wm.indexOf('// a stand-in machine for an end'));
  A.ok(/fail\('WOULD_REWIRE'/.test(job) && /fresh\.length === 2/.test(job) && /const kept = was\.every\(/.test(job), 'junctionOnBelt checks the floor reconcile after the split and refuses a re-wire inside its transact (rolled back)');
  // ordinary tiles still take a junction (the rule only bites beside a THIRD machine, or a tile beside both ends)
  const s = fresh(), L = line(s), lk = linkOf(s, L.B1, L.B2), mid = lk.path[Math.floor(lk.path.length / 2)];
  A.eq(s.junctionOnBeltRefusal(mid.x, mid.y), null, 'the middle of a plain belt still takes a junction');

  // PICK WHAT GOES HERE: each piece that fits carries the belt IT gets and where it stands — a 2x2 stands where the 1x1 stand-in's
  // route ended, so its belt is a tile shorter (the dock's ghost draws this one; the stand-in's ran a tile under the new machine)
  const s2 = fresh(), I = add(s2, 'intake', 32, 4), B = add(s2, 'bay', 40, 4);
  A.ok(s2.connectBelt(I, B).ok, 'a BAY fed by an INBOX');
  const before2 = frozen(s2), tile = { x: 36, y: 20 };
  const pv = s2.previewBeltTo(B, tile, {});
  const opts = s2.probeDrop(B, tile, [{ t: 'bay', w: 2, h: 2, block: true }, { t: 'splitter', w: 1, h: 1, block: false }], {});
  A.eq(frozen(s2), before2, 'probing the drop never touches the floor');
  const bay = opts.find(q => q.t === 'bay'), spl = opts.find(q => q.t === 'splitter');
  A.ok(bay.ok && Array.isArray(bay.path) && bay.path.length && bay.rect && bay.rect.x2 - bay.rect.x1 === 1, 'a BAY that fits says its belt and its 2x2 footprint');
  const under = bay.path.some(q => q.x >= bay.rect.x1 && q.x <= bay.rect.x2 && q.y >= bay.rect.y1 && q.y <= bay.rect.y2);
  A.ok(!under, 'its belt never runs under the machine it feeds');
  A.ok(spl.ok && pathKey(spl.path) === pathKey(pv.path), 'a 1x1 piece gets exactly the stand-in route the drag showed');
  const r = s2.dropFrom(B, tile, { t: 'bay', w: 2, h: 2, block: true }, {});
  const laid = r.ok && linkOf(s2, B, r.id);
  A.ok(laid && pathKey(laid.path) === pathKey(bay.path), 'the BAY drop lays exactly the belt its option carried (the ghost IS the commit)');
}

/* ---------- B. undo / redo say what they did, and where ---------- */
{
  const s = fresh();
  const id = add(s, 'bay', 40, 10);
  const u = s.undo();
  A.ok(u.ok && u.label === 'BAY' && u.rects.length === 1 && u.rects[0].x1 === 40 && u.rects[0].y2 === 11, 'an undo hands back its word (read off the diff) and the footprint it took back');
  const r = s.redo();
  A.ok(r.ok && r.label === 'BAY' && s.propById(id), 'redo says the same');
  const t = s.transact(() => s.addProp({ t: 'plant', x: 45, y: 10, w: 1, h: 1 }), 'A PLANT');
  A.ok(t.ok && s.undo().label === 'A PLANT', 'a transact may name its own slot');
  let n = 0; while (s.undo().ok && n < 200) n++;
  A.ok(n > 0 && n < 200, 'older slots without a name still undo (' + n + ')');
  A.eq(s.undo().ok, false, 'nothing left to undo is a plain refusal');
}

/* ---------- C. the stage count the Alt view shows is the compiler's ---------- */
{
  const s = fresh();
  const I = add(s, 'intake', 31, 4); let prev = I;
  const at = [[37, 4], [43, 4], [49, 4], [55, 4], [61, 4], [61, 16], [55, 16], [49, 16]];
  for (let i = 0; i < at.length; i++) { const b = add(s, 'bay', at[i][0], at[i][1]); s.assignPropAgent(b, 'ag' + i); A.ok(s.connectBelt(prev, b).ok, 'stage ' + (i + 1) + ' laid'); prev = b; }
  const p = plan(s), rec = p.lines.find(l => l.intakes.includes(I)), ls = P.lineStages(p, rec.lineId), e = p.errors.find(q => q.code === 'LINE_TOO_LONG');
  A.ok(ls && e && ls.stages === e.stages && ls.max === e.maxHops + 1, 'lineStages counts what LINE_TOO_LONG counts (' + (ls && ls.stages) + '/' + (ls && ls.max) + ')');
  const s2 = fresh(), L = line(s2), p2 = plan(s2), r2 = p2.lines.find(l => l.intakes.includes(L.I));
  A.eq(P.lineStages(p2, r2.lineId), { stages: 2, worst: 2, max: 7, maxHops: 6 }, '…and a line under budget too (2 of 7)');
  A.ok(!JSON.stringify(P.compileRoutingPlan(s2.projectGeometry())).includes('lineStages'), 'it is a reader, never a plan field (the hash and the posted plan are untouched)');
}

/* ---------- D. the build.js wiring (source locks) ---------- */
{
  const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
  const fn = name => { const i = build.indexOf('function ' + name + '('); if (i < 0) return ''; const j = build.indexOf('\n  }\n', i); return build.slice(i, j + 4); };
  A.ok(/const HOTBAR = \['bay', 'intake', 'outbox', 'splitter', 'merger', 'joiner', 'filter', 'loop'\];/.test(build), 'the hotbar holds the eight conveyor pieces, in the order the lane decided');
  A.ok(/let hand = null;/.test(build) && !/id: 'hand'/.test(build), 'the hand is state, not an eleventh tool');
  A.ok(/if \(next && tool !== 'select'\) selectTool\('select'/.test(fn('setHand')) && !/selectTool\('prop'/.test(fn('setHand')), 'arming a piece puts you in SELECT with it in hand (never the PROP tool)');
  A.ok(/hand = null; touchArm = null; dropPick = null;/.test(fn('selectTool')), 'arming any tool puts down what was held');
  const key = fn('onKey');
  A.ok(/if \(buildGroup === 'workflow' && \/\^\[1-8\]\$\/\.test\(ev\.key\)/.test(key) && key.indexOf("buildGroup === 'workflow' && /^[1-8]$/") < key.indexOf("const map = { '0': 'select'"), 'keys 1–8 pick hotbar pieces only while the Conveyors tab is up — the other tabs keep their tool keys');
  A.ok(/if \(ev\.key === 'Alt'\) \{ ev\.preventDefault\(\); altHeld = true; return; \}/.test(key), 'Alt is the ALT VIEW — preventDefault, so the browser menu bar never takes the focus');
  A.ok(/if \(ev\.key === 'Alt'\) \{ ev\.preventDefault\(\); altHeld = false; \}/.test(build) && /function onBlur\(\)[^\n]*spaceHeld = false; altHeld = false;/.test(build), '…let go on keyup, and on blur (Alt+Tab never leaves it stuck on)');
  A.ok(/drag && HAND_PLAN_MODES\[drag\.mode\]\) \{ ev\.preventDefault\(\); flipCorner\(\); return; \}/.test(key) && key.indexOf('flipCorner()') < key.indexOf('turnUnderCursor('), 'R mid-drag flips the corner (before R turns a prop)');
  A.ok(/if \(!drag && \(hand \|\| touchArm \|\| dropPick\)\) \{ setHand\(null\); return; \}/.test(key), 'Esc puts down what is held (or the unanswered picker)');
  const down = fn('onDown');
  A.ok(/const held = !!\(drag \|\| connectFrom \|\| connectTo \|\| dupe \|\| hand \|\| touchArm \|\| dropPick \|\| tool !== 'select'\);/.test(down) && /if \(!held && removeAt\(ev\)\) return;/.test(down), 'right-click removes ONLY with nothing held, armed or live — otherwise it puts down / deselects as before');
  A.ok(/if \(station\.beltAt\(w\.tx, w\.ty\)\) \{ drag = \{ mode: 'beltpress'/.test(down), 'a press on a belt can become a branch (the belt card waits for the release)');
  // (SELECT MOVES, 10-11: a SELECTED machine dragged moves — only an unselected one lays a belt)
  A.ok(/drag\.mode=\(!drag\.add&&!drag\.sel&&beltSource\(drag\.propId\)\)\?'handbelt':'propmove';/.test(build), 'an unselected workflow machine dragged lays a belt; selected, with Shift (or any other prop) it moves');
  A.ok(/if \(d\.mode === 'beltpress'\) return openBeltCard\(/.test(fn('onUp') + fn('upCommit')), 'a belt CLICKED still opens its card');   // (onUp hands the release to upCommit, then re-says the cursor)
  const rm = fn('removeAt');
  A.ok(/if \(p && isConveyorPiece\(p\)\)/.test(rm) && /if \(p\) return false;/.test(rm) && /return removeBeltAt\(w\.tx,w\.ty,ev\)/.test(rm) && /station\.removeLinkAt\(w\.tx, w\.ty\)/.test(build), 'right-click removes a conveyor piece or a whole belt — never furniture');
  const hp = fn('handPlan');
  A.ok(/const k = geoVer \+ '\|' \+ src \+ '\|' \+ d\.cur\.tx \+ ',' \+ d\.cur\.ty \+ '\|' \+ \(flipPref \? 1 : 0\);/.test(hp) && /if \(k === handPvKey\) return handPvMemo;/.test(hp), 'the drag ghost is memoized per (edit, tile, corner) — the planner never runs per frame (H9)');
  const plan2 = fn('planHandGesture');
  A.ok(!/\.(connectBelt|mergeBelt|branchBelt|relinkTo|dropFrom|addProp|removeProp|junctionOnBelt)\(/.test(plan2), 'planning a drag never mutates the doc (previews only, H9)');
  A.ok(/typeof station\.setSendTo === 'function'/.test(plan2), 'an OUTBOX onto another line\'s INBOX is SEND TO only when the station can (feature-detected)');
  const ghost = fn('drawHandGhost');
  A.ok(/drawBeltPreview\(t, \{ path: plan\.path \}, col\)/.test(ghost) && !/convey\.drawBelts/.test(ghost), 'the ghost belt is drawn geometry — never a second convey.drawBelts (the atlas law, H9)');
  A.ok(/voiceSay\('activeFlow', box, box,/.test(ghost), '…and its one caption speaks through the arbiter');
  A.ok(/drawLayer\('hand', \(\) => drawHandGhost\(t, now\)\);/.test(build) && /drawLayer\('altView', \(\) => drawAltView\(t\)\);/.test(build), 'the hand ghost and the Alt view each draw in their own guarded layer');
  const alt = fn('drawAltView');
  A.ok(/if \(alt\) for \(const p of \(cacheGeo\.props \|\| \[\]\)\)/.test(alt) && /\(!alt && !st\.over\)/.test(alt), 'at rest only an over-budget INBOX says n/max; junction settings and SEND TO arcs wait for Alt (one-voice law)');
  // fix wave 10-11 (#5/#21): Alt never paints a SEND TO off the doc pointer — the one arc per SEND TO is drawSendLinks', coloured by the
  // COMPILED plan (valPlan.sendTo), and Alt only makes every arc speak (green SENDS TO X, red SEND TO X IS OFF)
  A.ok(!/\.sendTo\b/.test(alt) && !/drawSendArc\(/.test(alt), 'the Alt view draws no second SEND TO arc off the doc pointer (it painted green for a SEND TO the compiler dropped)');
  const sl = fn('drawSendLinks');
  A.ok(/const near = altOn\(\) \|\| \[hoverPropId, selectedPropId\]/.test(sl) && /strokeSendArc\(arc, s\.live \? '#57bd8b' : '#d2684c'/.test(sl) && /s\.live \? 'SENDS TO ' \+ s\.name : 'SEND TO ' \+ s\.name \+ ' IS OFF'/.test(sl)
    && /live: !!\(valPlan && valPlan\.sendTo && valPlan\.sendTo\[p\.id\]\)/.test(fn('sendLinks')), '…Alt makes every SEND TO arc say its words, live or OFF exactly as the compiled plan has it');
  const ajt = fn('altJunctionText');
  A.ok(!/[×→▸]/.test(ajt), 'the Alt texts are ASCII (VT323 has no × or arrows)');
  A.ok(/floatHistory\(r, ev\.shiftKey \? 'REDID' : 'UNDID'\)/.test(key) && /undoBtn\.onclick = \(\) => \{ dropPickOff\(\); const r = station\.undo\(\); sfx\(r\.ok \? 'click' : 'bad'\); floatHistory\(r, 'UNDID'\); \};/.test(build)
    && /redoBtn\.onclick = \(\) => \{ dropPickOff\(\); const r = station\.redo\(\);/.test(build), 'Ctrl+Z / Ctrl+Y and the UNDO / REDO keys float UNDID · / REDID · <WHAT>');
  // final floor lane M21 / R55: undo / redo close only PICK WHAT GOES HERE (its options were probed on the floor before the undo) and
  // keep the piece in THE HAND — placing BAYs from the hotbar, a Ctrl+Z on a misplaced one leaves the BAY still held
  const zKey = key.slice(key.indexOf("(ev.key === 'z' || ev.key === 'Z')"), key.indexOf("if (ev.key === '/')"));
  A.ok(zKey.length > 0 && !/setHand\(null/.test(zKey) && (zKey.match(/dropPickOff\(\);/g) || []).length === 2, 'Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y put down only the picker, never the held piece');
  A.ok(!/(undo|redo)Btn\.onclick = \(\) => \{ setHand\(null/.test(build), '…and so do the UNDO / REDO keys');
  A.ok(/const dropPickOff = \(\) => \{ if \(dropPick\) \{ dropPick = null; renderSelection\(\); setHint\(\); \} \};/.test(build), 'dropPickOff closes an open picker (and only that)');
  A.ok(/if\(dropPick\)\{host\.hidden=false;root\.classList\.add\('has-selection'\);return renderDropPick\(host\);\}/.test(build), 'PICK WHAT GOES HERE docks where the selection card does (windows dock from the bottom — never a popover at the pointer)');
  const od = fn('openDropPick');
  A.ok(/station\.probeDrop\(/.test(od) && !/probeDrop/.test(hp + plan2), 'the fit probe runs once on RELEASE, never per frame');
  A.ok(/propType = c\.id;\s*setHand\(\{ t: c\.id \}, \{ silent: true \}\);/.test(fn('machinePalette')), 'the MACHINES shelf puts its pick in the same hand');
  A.ok(/data-handkey|dataset\.handkey = id/.test(build) && /key\('remove', 'REMOVE', 'R-CLICK'/.test(build) && /key\('pipette', 'PICK UP', 'Q'/.test(build) && /key\('corner', 'CORNER', 'R'/.test(build) && /key\('alt', 'ALT VIEW', 'ALT'/.test(build), 'touch gets a dock key for each gesture a finger lacks (right-click, Q, R, Alt)');
  A.ok(!/b\.title = /.test(fn('hotbarEl')) && /b\.dataset\.tip = /.test(fn('hotbarEl')), 'the hotbar explains itself in the station tooltip (no native title), never in sentences under the tiles');
  A.ok(/agentHere\(held\.agentId\)/.test(fn('commitPropStamp')) && /if \(agentHere\(p\.agentId\)\) h\.agentId = p\.agentId;/.test(fn('handFromProp')), 'a pipetted crew travels only when that agent is on this station');
  /* ---- repair pass 2026-10-11 ---- */
  A.ok(/const CLICK_SLOP = 12;/.test(build) && /const slipped = drag\.cx == null \|\| Math\.hypot\(ev\.clientX - drag\.cx, ev\.clientY - drag\.cy\) >= CLICK_SLOP;/.test(fn('onMove'))
    && /if\(drag\.mode==='selectpress'&&drag\.moved&&slipped\)/.test(fn('onMove')) && /if\(drag\.mode==='beltpress'&&drag\.moved&&slipped\)drag\.mode='handbranch';/.test(fn('onMove'))
    && /mode:'selectpress',propId:p\.id,start:w,cur:w,moved:false,add:ev\.shiftKey,cx:ev\.clientX,cy:ev\.clientY,sel:p\.id===selectedPropId/.test(down) && /mode: 'beltpress', start: w, cur: w, moved: false, from: \{ x: w\.tx, y: w\.ty \}, cx: ev\.clientX, cy: ev\.clientY/.test(down),
    'a press becomes a belt / branch / move only past 12 screen px — a click that drifts across a tile edge stays a click');
  A.ok(/hand = null; touchArm = null; dropPick = null; selBelts = null; flipPref = false; altHeld = false; altLatched = false; floaters\.length = 0;/.test(fn('open')), 'a reopened BUILD MODE holds nothing: no piece, no armed REMOVE, no stale PICK WHAT GOES HERE, no box belts, no flipped corner');
  const lso = fn('lineStagesOf');
  A.ok(/if \(stagesPlan !== valPlan\) \{ stagesPlan = valPlan; stagesMemo = new Map\(\); \}/.test(lso) && /else if \(!rest\) \{/.test(lso) && /lineStagesOf\(rec, !alt\)/.test(alt), 'the stage count is walked once per compiled plan — and at rest (no Alt) never walked (H9: compile nothing per frame)');
  A.ok(/voiceSay\('float', /.test(fn('drawFloaters')) && !/captionPlate\(ctx, /.test(fn('drawFloaters')) && /float: 4\.5, hover: 4/.test(build)
    && build.indexOf("drawLayer('floats'") < build.indexOf("drawLayer('voices'"), 'REMOVED / UNDID / SELECTED floats speak through the one-voice arbiter (registered before the flush — never a second label on the hovered piece)');
  A.ok(/const snapped = junctionSnap\(propType, px, py\);/.test(fn('commitPropStamp')) && /const sn = junctionSnap\(propType, tx, ty\), gx = sn \? sn\.x : tx, gy = sn \? sn\.y : ty;/.test(build), 'a junction held beside a belt: the hover ghost stands where the click will snap it, judged as the click will judge it');
  A.ok(/const shadowed = \/\^\[1-8\]\$\/\.test\(t\.key\) && BUILD_GROUPS\.some\(g => g\[0\] === 'workflow'/.test(build) && /btn\.title = t\.hint \+ \(shadowed \? '' : /.test(build), 'BELT (shown only in the Conveyors tab, where 1–8 pick hotbar pieces) wears no key number');
  A.ok(!/PROP tool \(6\)|MOVE \(4\) relocates/.test(build), 'no tip names a tool by a number the hotbar may own');
  A.ok(/hot\.path \? hot\.path : dropPick\.path/.test(ghost) && /dp\.hot = on \? q\.t :/.test(fn('renderDropPick')) && /const laid = newId && \(station\.links\(\) \|\| \[\]\)\.find\(l => l\.to && l\.to\.prop === newId\);/.test(fn('commitDropPick')), 'PICK WHAT GOES HERE draws the pointed piece\u2019s own belt and footprint, and flashes the belt it really got');
  const art = fn('guideStepArt');
  A.ok(!/the clicks: one per machine/.test(art) && /the stroke, dragged to the BAY/.test(art), 'the quick guide\u2019s CONNECT picture draws a drag, never the old click-click');
  const tut = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'tutorial.js'), 'utf8'), qs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'quests.js'), 'utf8');
  A.ok(/In the <b>Conveyors<\/b> tab, <kbd>1<\/kbd>–<kbd>8<\/kbd> pick a conveyor piece from its hotbar instead/.test(tut) && !/press <kbd>1<\/kbd> and drag out a room\. Press <kbd>6<\/kbd>/.test(tut), 'the Field Manual says 1–8 pick hotbar pieces in the Conveyors tab (and its mission names tabs, not numbers)');
  A.ok(!/drag a BELT \(7\)/.test(qs) && /drag from the INBOX onto the BAY to lay a belt/.test(qs), 'the belt quest teaches the drag, not key 7');
  // the hand × SEND TO join (integration merge 10-11): dragging an OUTBOX onto another line's INBOX asks the ONE SEND TO verdict
  // (worldmodel sendToRefusal via sendToPv) before the ghost goes green — never green for a loop / no-line drop setSendTo refuses
  const sendAt = build.indexOf("kind: 'send', to: T");
  const sendBranch = build.slice(build.lastIndexOf("if (A.t === 'outbox' && T.t === 'intake'", sendAt), sendAt);
  A.ok(sendAt > 0 && /const sv = sendToPv\(A\.id, T\.id\);/.test(sendBranch) && /if \(sv && sv\.ok === false\) return \{ ok: false, to: T, why: sv\.short/.test(sendBranch),
    'the hand’s SEND TO ghost reads sendToRefusal (loop, no line) — the ghost is the commit');
}
{
  // and the verdict it reads refuses the loop the ghost must show red: A sends to B, so B's OUTBOX may not send back to A
  const s = fresh();
  const IA = add(s, 'intake', 32, 4), BA = add(s, 'bay', 40, 4), OA = add(s, 'outbox', 48, 4);
  const IB = add(s, 'intake', 32, 14), BB = add(s, 'bay', 40, 14), OB = add(s, 'outbox', 48, 14);
  for (const [a, b] of [[IA, BA], [BA, OA], [IB, BB], [BB, OB]]) A.ok(s.connectBelt(a, b).ok, 'line belt ' + a + '→' + b);
  A.ok(s.setSendTo(OA, IB).ok, 'LINE A sends to LINE B');
  const back = s.sendToRefusal(OB, IA);
  A.ok(back && back.error === 'SEND_LOOP' && /LOOP/.test(back.short || ''), 'B → A is refused as a loop, with a floor caption the ghost shows');
  A.ok(s.sendToRefusal(OB, IB) && s.sendToRefusal(OB, IB).error === 'SAME_LINE', 'an OUTBOX onto its own line’s INBOX is refused');
}

A.report('build-hand.test');
