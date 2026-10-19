/* test/build-room-delete-sendto.test.js — deleting a room that holds a SEND TO target (final floor lane M15).

   The warning says "THIS CUTS 1 SEND TO FROM LINE A — repeat DELETE / REMOVE to continue", but the room was deselected BEFORE
   the warning fired, so the "repeat" Delete did nothing (and a slower re-select warned and deselected again). Driven for real:
   build.js's own deleteSelectedRoom / doDeleteRoom / warnSendCuts run in a VM against a live WorldModel. Locked:
     - Delete, Delete = the cut warning, and the room STAYS selected and armed;
     - the next Delete deletes it (the warning passes through, the selection clears);
     - a room with no SEND TO in it deletes on the second Delete, as before;
     - a refused delete (the spawn room guard aside) leaves the room selected — it still stands. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const vm = require('vm');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');

const src = fs.readFileSync(require.resolve('../frontend/app/build.js'), 'utf8');
const between = (start, end) => {
  const i = src.indexOf(start), j = src.indexOf(end, i);
  if (i < 0 || j < 0) throw new Error('build.js seam moved: ' + start + ' … ' + end);
  return src.slice(i, j);
};
const CODE = between('const cutArmFor = ', 'function deleteSelected(ev)')
  + between('function doDeleteRoom(', 'function openDoorPicker(')
  + between('function deleteSelectedRoom(', 'function nudgeRoom(');

function rig() {
  const s = WM.create(); s.projectGeometry();
  const ra = s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 70, y2: 12 } }), rb = s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 14, x2: 70, y2: 26 } });
  A.ok(ra.ok && rb.ok, 'rig: two rooms');
  const add = (t, x, y) => s.addProp({ t, x, y, w: 2, h: 2, block: true }).id;
  const a = [add('intake', 32, 4), add('bay', 42, 4), add('outbox', 56, 4)], b = [add('intake', 32, 18), add('bay', 42, 18), add('outbox', 56, 18)];
  for (const L of [a, b]) for (let i = 1; i < 3; i++) A.ok(s.connectBelt(L[i - 1], L[i]).ok, 'rig: belt');
  A.ok(s.setSendTo(a[2], b[0]).ok, 'rig: LINE A sends to the line in room B');
  let clock = 1000;
  const said = [];
  const ctx = {
    station: s, Pipeline: P, performance: { now: () => clock }, selectedRoomId: null, roomDelArmedAt: 0, sendCutArm: null,
    lineOfProp: () => null, lineNameOf: () => null, keepsHalls: fn => fn(), pushFlash() {}, vanishProp() {}, flashUndo() {},
    flashTip: (ev, msg) => said.push(String(msg)), sfx() {}, renderSelection() {}, setHint() {}
  };
  vm.createContext(ctx); vm.runInContext(CODE, ctx);
  return { s, ctx, said, ra: ra.id, rb: rb.id, tick: ms => { clock += ms; } };
}
{
  const R = rig(), { s, ctx, said } = R;
  ctx.selectedRoomId = R.rb;
  ctx.deleteSelectedRoom({}); R.tick(300);
  A.ok(/press Delete again/.test(said[said.length - 1]), 'the first Delete arms');
  ctx.deleteSelectedRoom({}); R.tick(300);
  A.ok(/THIS CUTS 1 SEND TO/.test(said[said.length - 1]) && / — DELETE AGAIN TO CONTINUE · UNDO RESTORES THEM$/.test(said[said.length - 1]), 'the second warns that a SEND TO is cut — ' + said[said.length - 1]);
  A.ok(!!s.roomById(R.rb), '…the room still stands');
  A.eq(ctx.selectedRoomId, R.rb, '…and STAYS selected, so "repeat DELETE" can mean the next Delete');
  R.tick(1500);   // (the warning re-armed the room: the next Delete inside the 2.5 s arm confirms)
  ctx.deleteSelectedRoom({});
  A.ok(!s.roomById(R.rb), 'the repeated Delete deletes the room');
  A.eq(ctx.selectedRoomId, null, '…and only then the selection clears');
  A.ok(/deleted/.test(said[said.length - 1]), '…saying so');
  A.ok(s.undo().ok && !!s.roomById(R.rb), '(one undo brings it back)');
}
{
  const R = rig(), { s, ctx } = R;
  A.ok(s.setSendTo(s.props().find(p => p.t === 'outbox' && p.sendTo).id, null).ok, 'no SEND TO into room B any more');
  ctx.selectedRoomId = R.rb;
  ctx.deleteSelectedRoom({}); R.tick(300); ctx.deleteSelectedRoom({});
  A.ok(!s.roomById(R.rb) && ctx.selectedRoomId === null, 'a room no SEND TO points into deletes on the second Delete, as before');
}
{
  // LIVE-FOUND (final floor lane, 2026-10-12 CDP run): reading the warning took ~4 s, and the "repeat DELETE" re-armed with
  // "press Delete again" — the room arm (2.5 s) ran out inside the SEND TO cut window (6 s). The repeat confirms anywhere in it.
  const R = rig(), { s, ctx, said } = R;
  ctx.selectedRoomId = R.rb;
  ctx.deleteSelectedRoom({}); R.tick(300); ctx.deleteSelectedRoom({});
  A.ok(/THIS CUTS 1 SEND TO/.test(said[said.length - 1]), 'the cut warning');
  R.tick(4200);   // the Commander reads it
  ctx.deleteSelectedRoom({});
  A.ok(!s.roomById(R.rb) && ctx.selectedRoomId === null, 'a repeat DELETE 4 s after the warning deletes the room — ' + said[said.length - 1]);
  const R2 = rig();
  R2.ctx.selectedRoomId = R2.rb;
  R2.ctx.deleteSelectedRoom({}); R2.tick(300); R2.ctx.deleteSelectedRoom({}); R2.tick(7000); R2.ctx.deleteSelectedRoom({});
  A.ok(!!R2.s.roomById(R2.rb) && /press Delete again/.test(R2.said[R2.said.length - 1]), 'past the 6 s window the warning has lapsed: Delete arms afresh (never a silent delete)');
}
{
  // REPAIR: the 6 s window belongs to the room the cut warning was FOR. An old, unconfirmed warning (a prop whose delete would cut
  // a SEND TO) stretched every later room's 2.5 s confirm: a second Delete 4 s later deleted a room it should have re-armed.
  const R = rig(), { s, ctx, said } = R;
  const target = s.props().find(p => p.t === 'intake' && s.props().some(o => o.t === 'outbox' && o.sendTo === p.id));
  A.ok(ctx.warnSendCuts([target.id], {}), 'a prop delete warns that it cuts a SEND TO — and is never confirmed');
  ctx.selectedRoomId = R.ra;   // room A: no SEND TO points into it
  R.tick(300); ctx.deleteSelectedRoom({});
  A.ok(/press Delete again/.test(said[said.length - 1]), 'room A arms');
  R.tick(4000); ctx.deleteSelectedRoom({});
  A.ok(!!s.roomById(R.ra) && /press Delete again/.test(said[said.length - 1]), 'a Delete 4 s later re-arms room A (its own 2.5 s confirm) — never a delete on an unrelated warning\'s window — ' + said[said.length - 1]);
  R.tick(500); ctx.deleteSelectedRoom({});
  A.ok(!s.roomById(R.ra), '…and the next quick Delete deletes it, as for any room');
}
{
  // …and a room's OWN cut warning still gets its 6 s window when another room was warned first
  const R = rig(), { s, ctx } = R;
  ctx.selectedRoomId = R.ra; ctx.deleteSelectedRoom({}); R.tick(300);   // room A armed, never confirmed
  ctx.selectedRoomId = R.rb; ctx.roomDelArmedAt = 0;
  ctx.deleteSelectedRoom({}); R.tick(300); ctx.deleteSelectedRoom({});   // room B: arm, then the cut warning
  R.tick(4200); ctx.deleteSelectedRoom({});
  A.ok(!s.roomById(R.rb), 'room B\'s own warning: the repeat 4 s later deletes it');
}
{
  // build-15 (wave 2): the warning names the gesture that armed it (Ctrl+X, a right-click / REMOVE tap, Delete), in one case — and
  // the confirm is that same gesture: "repeat DELETE / REMOVE" told a Ctrl+X user to repeat a key they never pressed
  const R = rig(), { s, ctx, said } = R;
  const target = s.props().find(p => p.t === 'intake' && s.props().some(o => o.t === 'outbox' && o.sendTo === p.id));
  A.ok(ctx.warnSendCuts([target.id], {}, null, 'CUT (CTRL+X)'), 'Ctrl+X on it warns');
  const m = said[said.length - 1];
  A.ok(/ — CUT \(CTRL\+X\) AGAIN TO CONTINUE · UNDO RESTORES THEM$/.test(m) && m === m.toUpperCase(), 'the cut warning asks for Ctrl+X again, in one case — ' + m);
  A.ok(ctx.warnSendCuts([target.id], {}, null, 'RIGHT-CLICK / REMOVE'), 'a different gesture is not the confirm: it warns in its own words');
  A.ok(/RIGHT-CLICK \/ REMOVE AGAIN TO CONTINUE/.test(said[said.length - 1]), '…' + said[said.length - 1]);
  A.eq(ctx.warnSendCuts([target.id], {}, null, 'RIGHT-CLICK / REMOVE'), false, '…and repeating THAT gesture confirms');
  A.ok(ctx.warnSendCuts([target.id], {}), 'Delete warns');
  A.ok(/ — DELETE AGAIN TO CONTINUE/.test(said[said.length - 1]), '…asking for DELETE again (the default) — ' + said[said.length - 1]);
  const src2 = src.slice(src.indexOf('function deleteLine('), src.indexOf('function deleteLine(') + 900);
  A.ok(/const cut = verb === 'CUT'[^\n]*\n[^\n]*warnSendCuts\(m\.ids, ?ev, ?null, ?cut \? 'CUT \(CTRL\+X\)' : undefined\)/.test(src2) || /cut = verb === 'CUT';[\s\S]{0,200}warnSendCuts\(m\.ids,\s*ev,\s*null,\s*cut \? 'CUT \(CTRL\+X\)' : undefined\)/.test(src2),
    'a whole-line Ctrl+X warns in CUT words (cut is known before the warning)');
  A.ok(/warnSendCuts\(\[p\.id\],\s*ev,\s*null,\s*'RIGHT-CLICK \/ REMOVE'\)/.test(src), 'a right-click / REMOVE tap warns in its own words');
}
A.report('build-room-delete-sendto.test');
