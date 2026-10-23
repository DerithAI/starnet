/* sidecar/save-restore.js — bring a preserved window save's sessions back into the station (support report 2026-10-21).

   A refused save leaves the window's whole station beside the station file (<agent>.save-conflict-<client>.json).
   Nothing in the app could bring that work back: "Reload current station" drops it from view and "Download" only
   exports it. This restores its SESSIONS into the current station and never takes anything away:

     • a session the station does not have is added (unless it was deleted on purpose: the station's deletedIds, or the
       sidecar's own uncapped deleted-session ledger passed in as opts.isDeleted — a tombstone always wins);
     • a session the preserved save continued (the station's turns are the start of its turns) gets ONLY the missing
       turns appended; every other field of the station's session (title, archived, pinned, lane, runIds, deliverables …)
       stays exactly as the station has it (review 10-23 #3b);
     • a station session that is EMPTY is not "behind" a preserved copy with turns when it may have been cleared (the
       Commander's Clear empties the history): it is left alone unless the preserved copy was active in it after the
       station last was, and never when the station's own clear checkpoint names it;
     • a session both sides changed differently is kept as it is, and the preserved one is added beside it as a
       "(restored copy)", so no turn from either side is lost;
     • everything else — the roster, the floor, settings, the station's other sessions — stays the station's.

   The preserved save's General stream is the station's General (a window that booted without the station minted
   its own id for it), so it is compared with the station's General, never added as a second one.

   Pure: no I/O, no clock. plan(current, preserved, opts) -> { doc, added, extended, copied } where doc is a new station
   save (the input objects are not modified; the station is copied shallowly, never deep-cloned) and the three lists hold
   session ids. restorable(current, preserved, opts) counts the same sessions without building a doc (review 10-23 #3d:
   the boot offer runs it on a multi-MiB station). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.SK = root.SK || {}; root.SK.saveRestore = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const COPY_SUFFIX = '~restored';

  function list(doc) { return doc && Array.isArray(doc.workstreams) ? doc.workstreams.filter(w => w && typeof w === 'object' && typeof w.id === 'string' && w.id) : []; }
  function hist(w) { return Array.isArray(w && w.history) ? w.history : []; }
  // one turn equal to another: the common shape (role + string content) without a stringify, anything else by its JSON
  function sameTurn(a, b) {
    if (a === b) return true;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return JSON.stringify(a) === JSON.stringify(b);
    if (a.role !== b.role) return false;
    if (typeof a.content === 'string' && typeof b.content === 'string' && a.content !== b.content) return false;
    return JSON.stringify(a) === JSON.stringify(b);
  }
  // the first `shorter.length` turns of `longer` are `shorter`
  function startsWith(longer, shorter) {
    if (shorter.length > longer.length) return false;
    for (let i = 0; i < shorter.length; i++) if (!sameTurn(longer[i], shorter[i])) return false;
    return true;
  }
  // the session ids the station's own clear checkpoint (Workstreams sessionUndo, kind 'clear') says were cleared
  function clearedIds(doc) {
    const cp = doc && doc.sessionUndo;
    const out = new Set();
    if (cp && typeof cp === 'object' && cp.kind === 'clear' && Array.isArray(cp.rows)) for (const r of cp.rows) if (r && typeof r.id === 'string') out.add(r.id);
    return out;
  }

  /* what one preserved session does to the station: null (nothing) or { kind: 'add'|'extend'|'copy', ... }. `ctx` holds the
     station's index and deleted predicates. Never modifies its inputs. */
  function decide(raw, ctx) {
    const id = ctx.mapId(raw.id);
    if (ctx.deleted(id)) return null;
    const have = ctx.byId.get(id);
    if (!have) return { kind: 'add', id };
    const mine = hist(have), theirs = hist(raw);
    if (startsWith(mine, theirs)) return null;                                          // the same, or the station has more
    if (mine.length === 0) {
      // an EMPTY station session may have been cleared on purpose (Clear stamps lastActiveAt). It takes the preserved turns
      // only when it provably never was active since it was created, or the preserved copy was active in it AFTER the
      // station last was — and never when the station's clear checkpoint names it
      const born = Number(have.createdAt), touched = Number(have.lastActiveAt);
      const untouched = born > 0 && touched > 0 && touched <= born;
      if (ctx.cleared.has(id) || !(untouched || Number(raw.lastActiveAt) > Number(have.lastActiveAt || 0))) return null;
      return { kind: 'extend', id, have, more: theirs };
    }
    if (startsWith(theirs, mine)) return { kind: 'extend', id, have, more: theirs.slice(mine.length) };
    if (ctx.cleared.has(id)) return null;                                                // the station cleared it: no copy of the old turns
    const copyId = id + COPY_SUFFIX;
    if (ctx.byId.has(copyId) || ctx.deleted(copyId)) return null;                        // restored (or dismissed) before
    return { kind: 'copy', id, have, copyId };
  }
  function context(current, preserved, opts) {
    const stationList = list(current);
    const byId = new Map(stationList.map(w => [w.id, w]));
    const deletedIds = new Set(Array.isArray(current && current.deletedIds) ? current.deletedIds : []);
    const isDeleted = opts && typeof opts.isDeleted === 'function' ? opts.isDeleted : null;
    const fromGeneral = preserved && preserved.generalId, toGeneral = current && current.generalId;
    return {
      stationList, byId, toGeneral, cleared: clearedIds(current),
      mapId: id => (fromGeneral && toGeneral && id === fromGeneral) ? toGeneral : id,
      deleted: id => deletedIds.has(id) || !!(isDeleted && isDeleted(id))
    };
  }

  function plan(current, preserved, opts) {
    const ctx = context(current, preserved, opts);
    const doc = Object.assign({}, current || {});
    const out = ctx.stationList.slice();
    const at = new Map(out.map((w, i) => [w.id, i]));
    const added = [], extended = [], copied = [];
    for (const raw of list(preserved)) {
      const d = decide(raw, ctx);
      if (!d) continue;
      if (d.kind === 'add') {
        const w = Object.assign({}, raw, { id: d.id });
        if (w.parentStreamId) w.parentStreamId = ctx.mapId(w.parentStreamId);
        if (w.title == null && w.id !== ctx.toGeneral) w.title = 'Restored session';   // a null title means General
        out.push(w); ctx.byId.set(w.id, w); at.set(w.id, out.length - 1); added.push(w.id);
      } else if (d.kind === 'extend') {
        // the station's session with the missing turns appended: every station-side field stays as the station has it
        const w = Object.assign({}, d.have, { history: hist(d.have).concat(d.more) });
        out[at.get(d.id)] = w; ctx.byId.set(d.id, w); extended.push(d.id);
      } else {
        const w = Object.assign({}, raw, { id: d.copyId, title: String(d.have.title || raw.title || 'General').slice(0, 64) + ' (restored copy)' });
        if (w.parentStreamId) w.parentStreamId = ctx.mapId(w.parentStreamId);
        out.push(w); ctx.byId.set(d.copyId, w); at.set(d.copyId, out.length - 1); copied.push(d.copyId);
      }
    }
    doc.workstreams = out;
    return { doc, added, extended, copied };
  }

  // how many sessions plan() would bring back — what a notice may honestly offer. Builds nothing.
  function restorable(current, preserved, opts) {
    const ctx = context(current, preserved, opts);
    let n = 0;
    for (const raw of list(preserved)) {
      const d = decide(raw, ctx);
      if (!d) continue;
      n++;
      // a later preserved session with the same id (or the copy's id) sees this one as present, exactly as plan() does
      if (d.kind === 'add') ctx.byId.set(d.id, raw);
      else if (d.kind === 'copy') ctx.byId.set(d.copyId, raw);
      else ctx.byId.set(d.id, { history: hist(d.have).concat(d.more) });
    }
    return n;
  }

  return { plan, restorable, COPY_SUFFIX };
});
