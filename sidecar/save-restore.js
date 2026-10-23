/* sidecar/save-restore.js — bring a preserved window save's sessions back into the station (support report 2026-10-21).

   A refused save leaves the window's whole station beside the station file (<agent>.save-conflict-<client>.json).
   Nothing in the app could bring that work back: "Reload current station" drops it from view and "Download" only
   exports it. This restores its SESSIONS into the current station and never takes anything away:

     • a session the station does not have is added (unless the station deleted it on purpose: its tombstone wins);
     • a session the preserved save continued (the station's turns are the start of its turns) is replaced by the
       longer one;
     • a session both sides changed differently is kept as it is, and the preserved one is added beside it as a
       "(restored copy)", so no turn from either side is lost;
     • everything else — the roster, the floor, settings, the station's other sessions — stays the station's.

   The preserved save's General stream is the station's General (a window that booted without the station minted
   its own id for it), so it is compared with the station's General, never added as a second one.

   Pure: no I/O, no clock. plan(current, preserved) -> { doc, added, extended, copied } where doc is a new station
   save (the input objects are not modified) and the three lists hold session ids. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.saveRestore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COPY_SUFFIX = '~restored';

  function list(doc) { return doc && Array.isArray(doc.workstreams) ? doc.workstreams.filter(w => w && typeof w === 'object' && typeof w.id === 'string' && w.id) : []; }
  function turns(w) { return Array.isArray(w && w.history) ? w.history.map(t => JSON.stringify(t)) : []; }
  function startsWith(longer, shorter) {
    if (shorter.length > longer.length) return false;
    for (let i = 0; i < shorter.length; i++) if (longer[i] !== shorter[i]) return false;
    return true;
  }

  function plan(current, preserved) {
    const doc = JSON.parse(JSON.stringify(current || {}));
    const out = list(doc);
    const byId = new Map(out.map(w => [w.id, w]));
    const deleted = new Set(Array.isArray(doc.deletedIds) ? doc.deletedIds : []);
    const fromGeneral = preserved && preserved.generalId, toGeneral = doc.generalId;
    const mapId = id => (fromGeneral && toGeneral && id === fromGeneral) ? toGeneral : id;
    const added = [], extended = [], copied = [];
    for (const raw of list(preserved)) {
      const w = JSON.parse(JSON.stringify(raw));
      w.id = mapId(w.id);
      if (w.parentStreamId) w.parentStreamId = mapId(w.parentStreamId);
      if (deleted.has(w.id)) continue;
      const have = byId.get(w.id);
      if (!have) {
        if (w.title == null && w.id !== toGeneral) w.title = 'Restored session';   // a null title means General
        out.push(w); byId.set(w.id, w); added.push(w.id);
        continue;
      }
      const mine = turns(have), theirs = turns(w);
      if (mine.length === theirs.length && startsWith(mine, theirs)) continue;        // the same conversation
      if (startsWith(mine, theirs)) continue;                                          // the station already has more
      if (startsWith(theirs, mine)) { out[out.indexOf(have)] = w; byId.set(w.id, w); extended.push(w.id); continue; }
      const copyId = w.id + COPY_SUFFIX;
      if (byId.has(copyId) || deleted.has(copyId)) continue;                           // restored (or dismissed) before
      const copy = Object.assign(w, { id: copyId, title: String(have.title || raw.title || 'General').slice(0, 64) + ' (restored copy)' });
      out.push(copy); byId.set(copyId, copy); copied.push(copyId);
    }
    doc.workstreams = out;
    return { doc, added, extended, copied };
  }

  // how many sessions plan() would bring back — what a notice may honestly offer
  function restorable(current, preserved) {
    const r = plan(current, preserved);
    return r.added.length + r.extended.length + r.copied.length;
  }

  return { plan, restorable, COPY_SUFFIX };
});
