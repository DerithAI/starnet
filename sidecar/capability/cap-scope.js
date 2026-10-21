/* sidecar/capability/cap-scope.js — WHERE a room-scoped agent's floor tools come from, so the capability note
   (capsummary.js) can tell the model the exact room to place missing gear in.

   An agent that owns a BAY draws its floor tools only from its CAPABILITY room: its desk's room, else its bay's
   (worldmodel agentRoomId, the remote-bay ruling). The note used to say "place a DISH" with no room, so a
   Researcher the lead seated in a new RESEARCH room (station.build with "new" recruits) told the Commander to place
   gear that was already standing in HOME, where it does not reach that agent. Pure: station-model reads only.

   capScope(station, agentId, dockId) -> null | { scoped:false } |
     { scoped:true, roomName, via:'desk'|'bay', placedTypes:[sorted floor types in that room], gearElsewhere:{ type:[room names] } }
   consistentScope(station, agentId, { dockId, grantedTypes }) -> the scope ONLY when the saved floor reproduces THIS
     run's exact floor grants (the truth guard: a stale or different floor names no room), else null.
   scopeForRun({ loadStation, agentId, runStation, extraObjects, interactive, floorless }) -> runOnce's one call:
     a bay-routed run (router.stationFor marks its station `floor`) compares that room's objects; an interactive run
     with no routed station compares the objects the page (or savedPlacement) sent; anything else names nothing.
   makeSavedFloor({ stamp, loadStamped }) -> () => the saved station model, re-validated only when the save changed. */
'use strict';

const { checkedStation } = require('./saved-placement.js');

// computer = the compute freebie; connector/plugin = per-instance projections. None is gear the note names
// (the same filter savedPlacement and World.heroCaps apply).
const NOT_GEAR = { computer: 1, connector: 1, plugin: 1 };

function floorTypes(objs) {
  const out = [];
  for (const o of Array.isArray(objs) ? objs : []) {
    const t = String((o && typeof o === 'object') ? (o.objectType || '') : (o || ''));
    if (t && !NOT_GEAR[t] && out.indexOf(t) < 0) out.push(t);
  }
  return out.sort();
}

// a room name rides the system prompt VERBATIM (accents, '/', '+', '#', any script): the note must name the room the
// Commander sees. A name it cannot carry as-is -- a control or format character, a line break, '<' or '>' (they could
// close the note's fence), or longer than renameRoom's 24 -- is never rewritten (that names a room that does not exist):
// it is '' instead, so the scope names no room and the note stays the old one.
function roomLabel(s) { const t = String(s == null ? '' : s).trim(); return (t.length > 24 || /[\p{C}\p{Zl}\p{Zp}<>]/u.test(t)) ? '' : t; }

function capScope(station, agentId, dockId) {
  if (!station || !agentId || typeof station.agentRoomId !== 'function') return null;
  const roomId = station.agentRoomId(agentId, dockId);
  if (!roomId) return { scoped: false };
  const nameOf = (id) => { const r = station.roomById(id); return roomLabel(r && r.name); };
  const props = station.props();
  // agentRoomId takes the desk's room when the agent has a desk (a workstation = a computer prop) in a room
  const desk = props.find(p => p && p.agentId === agentId && station.capForProp(p.t) === 'computer');
  const via = (desk && station.roomAt(desk.x, desk.y) === roomId) ? 'desk' : 'bay';
  const gearElsewhere = {};
  for (const p of props) {
    const t = p && station.capForProp(p.t);
    if (!t || NOT_GEAR[t]) continue;
    const r = station.roomAt(p.x, p.y);
    const nm = (r && r !== roomId) ? nameOf(r) : '';
    if (!nm) continue;
    const list = gearElsewhere[t] || (gearElsewhere[t] = []);
    if (list.indexOf(nm) < 0) list.push(nm);
  }
  return { scoped: true, roomName: nameOf(roomId), via, placedTypes: floorTypes(station.bayObjects(agentId, dockId)), gearElsewhere };
}

function consistentScope(station, agentId, o) {
  o = o || {};
  const s = capScope(station, agentId, o.dockId);
  if (!s || !s.scoped || !s.roomName) return null;
  return floorTypes(o.grantedTypes).join(',') === s.placedTypes.join(',') ? s : null;
}

function scopeForRun(o) {
  o = o || {};
  const rs = o.runStation;
  let granted, dockId;
  if (rs) {
    if (!rs.floor) return null;   // an explicit station that is not a routed floor room: nothing to name
    const a = rs.agents && rs.agents[o.agentId];
    const room = a && rs.rooms && rs.rooms[a.room];
    if (!room) return null;
    granted = room.objects;       // the routed room as the router built it, before any profile/host object is added
    dockId = rs.floor.dockId || undefined;
  } else if (o.interactive && !o.floorless && Array.isArray(o.extraObjects)) {
    granted = o.extraObjects;
  } else return null;             // the autonomous office is not a floor room
  const s = consistentScope(typeof o.loadStation === 'function' ? o.loadStation() : null, o.agentId, { dockId, grantedTypes: granted });
  return s ? Object.assign({}, s, { floorRouted: !!rs }) : null;
}

function makeSavedFloor(read) {
  let memo = null;
  return function savedFloor() {
    const now = String(read.stamp() || '');
    if (now && memo && memo.stamp === now) return memo.station;
    const r = read.loadStamped() || {};
    const station = checkedStation(r.doc);
    memo = r.stamp ? { stamp: String(r.stamp), station } : null;   // '' = an unclean read: never memoized
    return station;
  };
}

module.exports = { capScope, consistentScope, scopeForRun, makeSavedFloor, floorTypes };
