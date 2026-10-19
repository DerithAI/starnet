/* node test/walk-consistency-1014.test.js — three small inconsistencies the live walk of 10-14 found (seam 17), each locked by
   executing the shipped code:
     · TODAY's $ is the station's one money format: a $0.0001 job reads $0.0001 on the Workflow panel's TODAY row and the floor
       plate, as the job row says it (util.js U.usd), never '$0.000';
     · a room undo names what it took back — UNDID · ROOM / ROOM NAME / FLOOR / WALLS, floated over that room — never a generic
       UNDID · EDIT;
     · closing the COMMS agent dropdown plays the docks' close() cue, not the press. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

/* ---------- #17 TODAY's $ is the station's one money format ---------- */
{
  const util = rd('frontend/js/util.js');
  const U = vm.runInNewContext(util + ';U', { AbortSignal: {}, AbortController, DOMException, setTimeout() {} });
  global.U = U;
  const LW = require('../frontend/app/linewatch.js');
  const row = LW.statsRow({ runs: 2, shipped: 0, failed: 0, usdToday: 0.0001, capUsdPerDay: null, medianMs: 5000 });
  A.eq(row.find(c => /^\$ TODAY/.test(c[0])), ['$ TODAY', U.usd(0.0001) + ' · no cap'], 'TODAY says $0.0001 — the job row’s own format');
  A.eq(U.usd(0.0001), '$0.0001', '(the canonical sub-dime form)');
  A.eq(LW.plateLines({ runs: 1, shipped: 0, failed: 0, usdToday: 0.0125, capUsdPerDay: 5, medianMs: null })[1], '$0.0125 / $5.00 TODAY', 'the floor plate says the same');
  delete global.U;
}

/* ---------- #17 a room undo names the room ---------- */
{
  const WM = require('../frontend/app/worldmodel.js');
  const s = WM.create(); s.projectGeometry();
  const r = s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 50, y2: 20 } });
  A.ok(r.ok, 'a room is stamped');
  const u = s.undo();
  A.ok(u.ok && u.label === 'ROOM', 'undoing a stamped room says UNDID · ROOM (got ' + u.label + ')');
  A.ok(u.rects.some(q => q.x1 === 30 && q.y1 === 0 && q.x2 === 50 && q.y2 === 20), 'and floats over that room');
  A.eq(s.redo().label, 'ROOM', 'redo says the same');
  A.ok(s.renameRoom(r.id, 'LAB').ok, 'renamed');
  A.eq(s.undo().label, 'ROOM NAME', 'a rename undoes as ROOM NAME');
  A.ok(s.setFloor(r.id, 'teal').ok, 're-floored');
  A.eq(s.undo().label, 'FLOOR', 'a re-floor undoes as FLOOR');
  A.ok(s.setWalls(r.id, { mat: WM.WALL_ORDER[1] }).ok, 're-clad');
  A.eq(s.undo().label, 'WALLS', 'a wall change undoes as WALLS');
  const p = s.addProp({ t: 'plant', x: 34, y: 4, w: 1, h: 1 });
  A.ok(p.ok, 'a piece inside it');
  A.ok(s.removeRoom(r.id).ok, 'the room (and its piece) removed');
  A.eq(s.undo().label, 'ROOM', 'putting a room back with its pieces still says ROOM');
  const q = s.addProp({ t: 'plant', x: 36, y: 6, w: 1, h: 1 });
  s.undo();
  A.ok(q.ok, 'a lone piece');
  const keep = s.addProp({ t: 'plant', x: 36, y: 6, w: 1, h: 1 }); A.ok(keep.ok, 'placed again');
  A.ok(!/ROOM/.test(s.undo().label), 'a piece undo still names the piece, not the room');
}

/* ---------- #17 closing the COMMS agent dropdown plays close() ---------- */
{
  const gc = rd('frontend/app/glass-comms.js');
  const toggle = A.fnBody(gc, '  function toggle()');
  A.ok(toggle.length > 20 && toggle.length < 1000, 'glass-comms.js has toggle()');
  const cues = [], calls = [];
  const menu = { hidden: true };
  const ctx = vm.createContext({ menu, SFX: { close: () => cues.push('close'), open: () => cues.push('open') }, open: () => { calls.push('open'); menu.hidden = false; }, close: () => { calls.push('close'); menu.hidden = true; } });
  const t = vm.runInContext(toggle + '\ntoggle;', ctx);
  t(); A.eq([calls, cues], [['open'], []], 'opening leaves the press to the delegated COMMS cue');
  t(); A.eq([calls, cues], [['open', 'close'], ['close']], 'closing plays the docks’ close() (which the delegate then yields to)');
  A.ok(/button\.addEventListener\('click',toggle\)/.test(gc), 'the agent key toggles through toggle()');
}

A.report();
