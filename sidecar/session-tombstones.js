/* sidecar/session-tombstones.js — THE SIDECAR'S OWN RECORD OF DELETED SESSIONS (qa/bugs/3e926b6a, P1 privacy).

   The Commander deletes a session from the rail (⋯ › Delete › Confirm delete). The page drops the row and keeps its
   id in the save's `deletedIds`, so the row never re-forms. The sidecar kept every word of it: the durable transcript
   still served it to resume, recall_conversation still searched it, the evidence pack still quoted its first line as
   RECENT ACTIVITY in unrelated runs, and memories written in it still rode later prompts. Delete is armed, toasts
   "deleted", and is a separate control from Archive, so the reading is plain: that conversation is not fed back to a
   model again.

   The page's list cannot be the authority on its own: it holds the newest 500 ids, NEW AGENT clears it, and a
   deliberate re-open (Workstreams.adopt revive:true) takes an id back out. So this ledger learns each deletion from
   the save the page writes (POST /api/save, and the save on disk at boot), stamps WHEN it learned it, and keeps it:

     streams: { [streamId]: { at, live, purged } }
       at     — when the sidecar first saw the id in the save's deletedIds (ms). Everything that session held at or
                before `at` is FORGOTTEN: every reader that hands conversation to a model answers as if it were gone.
       live   — the id is in the save's deletedIds right now. An id that left the list (a re-open, the 500 cap, a NEW
                AGENT reset) keeps its `at`: what was deleted stays deleted. A re-opened session starts clean — only
                what is said after the delete is heard — and if it is deleted again (back in the list after leaving
                it), that is a fresh delete and `at` moves to then.
       purged — the `at` whose derived memory (notebook records, open threads, pending proposals) has been removed;
                a crash between the stamp and the purge is retried on the next boot.

   forgotten(streamId, ts) is the one predicate every reader shares. deletedAt(streamId) answers 0 for a session that
   was never deleted. Pure over an injected fs (makeDomainStore: durable write + read-back proof), no ambient clock.

   forgetSessionMemory() is the purge of what a deleted session left in memory, pure over the injected stores. A
   record is the session's when it was written in it: bound to its stream, or written, revised or stated by one of its
   runs. A record another session owns keeps only its revision history from elsewhere. */
'use strict';

const { makeDomainStore } = require('./domain-store.js');

const SID_RE = /^[A-Za-z0-9_-]{1,64}$/;   // the workstream grammar transcriptstore.js and index.js validate
const MAX_STREAMS = 20000;                 // a long-lived station's deletes; the oldest stamps drop first past this

function num(v) { const n = Number(v); return Number.isFinite(n) ? n : 0; }

function normalizeState(value) {
  const src = value && typeof value === 'object' && value.streams && typeof value.streams === 'object' ? value.streams : {};
  const rows = [];
  for (const id of Object.keys(src)) {
    const e = src[id];
    if (!SID_RE.test(id) || !e || typeof e !== 'object' || !(num(e.at) > 0)) continue;
    rows.push([id, { at: num(e.at), live: e.live === true, purged: num(e.purged) }]);
  }
  rows.sort((a, b) => a[1].at - b[1].at || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const streams = {};
  for (const [id, e] of rows.slice(-MAX_STREAMS)) streams[id] = e;
  return { streams };
}

function makeSessionTombstones(deps) {
  const d = deps || {};
  const now = typeof d.now === 'function' ? d.now : () => 0;
  const store = makeDomainStore({ fs: d.fs, path: d.path, file: d.file, writeDurable: d.writeDurable,
    defaults: () => ({ streams: {} }), normalize: normalizeState, onIssue: d.onIssue });
  const loaded = store.load();
  let state = loaded.value;
  const status = loaded.status;

  function commit(next) {
    const saved = store.save(next);
    state = saved.value;
  }

  /* observe(deletedIds) — fold the save's current list in. Returns the ids this call stamped (fresh deletes), oldest
     first. A value that is not an array teaches nothing: an older page that never wrote the list must not read as
     "every deletion was undone". The new state is held in memory even when the durable write fails, so this
     process never serves a deleted session; the throw tells the caller the stamp is not on disk yet. */
  function observe(deletedIds) {
    if (!Array.isArray(deletedIds)) return [];
    const want = new Set(deletedIds.map(x => String(x == null ? '' : x)).filter(id => SID_RE.test(id)));
    const at = Math.max(1, num(now()));
    const next = { streams: Object.assign({}, state.streams) };
    const fresh = [];
    let changed = false;
    for (const id of want) {
      const e = next.streams[id];
      if (e && e.live) continue;
      next.streams[id] = { at, live: true, purged: 0 };
      fresh.push(id);
      changed = true;
    }
    for (const id of Object.keys(next.streams)) {
      const e = next.streams[id];
      if (e.live && !want.has(id)) { next.streams[id] = Object.assign({}, e, { live: false }); changed = true; }
    }
    if (!changed) return fresh;
    state = normalizeState(next);
    commit(state);
    return fresh;
  }

  function deletedAt(streamId) {
    const id = String(streamId == null ? '' : streamId);
    const e = Object.prototype.hasOwnProperty.call(state.streams, id) ? state.streams[id] : null;
    return e ? e.at : 0;
  }
  // true for a row (or record, or run) of a deleted session stamped at or before its delete; a missing stamp is old
  function forgotten(streamId, ts) {
    const at = deletedAt(streamId);
    return at > 0 && num(ts) <= at;
  }
  // the deletions whose derived memory has not been purged for their current stamp: [{ id, at }], oldest first
  function unpurged() {
    return Object.keys(state.streams).map(id => ({ id, at: state.streams[id].at, purged: state.streams[id].purged }))
      .filter(e => e.purged !== e.at).sort((a, b) => a.at - b.at).map(e => ({ id: e.id, at: e.at }));
  }
  function markPurged(list) {
    const next = { streams: Object.assign({}, state.streams) };
    let changed = false;
    for (const it of Array.isArray(list) ? list : []) {
      const e = it && next.streams[it.id];
      if (!e || e.at !== it.at || e.purged === it.at) continue;
      next.streams[it.id] = Object.assign({}, e, { purged: it.at });
      changed = true;
    }
    if (changed) commit(normalizeState(next));
    return changed;
  }
  function list() {
    return Object.keys(state.streams).map(id => Object.assign({ id }, state.streams[id]));
  }
  return { observe, deletedAt, forgotten, unpurged, markPurged, list, status: () => status, file: store.file };
}

/* ---- what a deleted session left in memory ---- */

// deleted: [{ id, at }]; runs: the run history rows ({ runId, streamId, ts }). The runs a deleted session held are the
// ones filed under its stream at or before its delete.
function deletedScope(deleted, runs) {
  const at = new Map();
  for (const e of Array.isArray(deleted) ? deleted : []) if (e && SID_RE.test(String(e.id)) && num(e.at) > 0) at.set(String(e.id), num(e.at));
  const runIds = new Set();
  for (const r of Array.isArray(runs) ? runs : []) {
    const when = r && at.get(String(r.streamId || ''));
    if (when && r.runId && num(r.ts) <= when) runIds.add(String(r.runId));
  }
  return { at, runIds };
}
function streamBound(scope, streamId, ts) {
  const when = streamId ? scope.at.get(String(streamId)) : 0;
  return !!when && num(ts) <= when;
}
function runBound(scope, runId) { return !!runId && scope.runIds.has(String(runId)); }

// a notebook record is the session's when it was filed under its stream, or when one of its runs wrote it, last revised
// it, or proved it with the Commander's words there
function notebookRecordBound(r, scope) {
  if (!r || typeof r !== 'object') return false;
  return streamBound(scope, r.streamId, r.createdAt || r.ts)
    || runBound(scope, r.sourceRunId) || runBound(scope, r.updatedSourceRunId)
    || runBound(scope, r.statedBy && r.statedBy.runId);
}
function pendingBound(p, scope) {
  if (!p || typeof p !== 'object') return false;
  return runBound(scope, p.runId) || runBound(scope, p.sourceRunId) || streamBound(scope, p.streamId, p.createdAt || p.at);
}
function threadBound(ref, scope) {
  if (!ref || typeof ref !== 'object') return false;
  return runBound(scope, ref.runId) || streamBound(scope, ref.streamId, ref.date);
}

/* forgetSessionMemory({ store, threads?, agentIds, deleted, runs }) — remove what the deleted sessions left in memory.
     store    — the memory KV (memory-store.js: update(key, mutator) under its per-key lock)
     threads  — the thread ledger (threads-store.js: forgetSources(match))
     agentIds — every agent whose notebook / pending queue may hold one
   Returns { notes, revisions, pending, threads } — the counts removed. A store that fails throws after the others ran,
   so the caller records nothing as purged and retries. */
async function forgetSessionMemory(deps) {
  const d = deps || {};
  const scope = deletedScope(d.deleted, d.runs);
  const out = { notes: 0, revisions: 0, pending: 0, threads: 0 };
  if (!scope.at.size) return out;
  let failure = null;
  for (const agentId of Array.isArray(d.agentIds) ? d.agentIds : []) {
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(String(agentId))) continue;
    try {
      await d.store.update('notebook:' + agentId, (stored) => {
        if (!Array.isArray(stored)) return undefined;
        let changed = false;
        const next = [];
        for (const r of stored) {
          if (notebookRecordBound(r, scope)) { out.notes++; changed = true; continue; }
          if (r && Array.isArray(r.history) && r.history.some(h => h && runBound(scope, h.sourceRunId))) {
            const history = r.history.filter(h => !(h && runBound(scope, h.sourceRunId)));
            out.revisions += r.history.length - history.length;
            next.push(Object.assign({}, r, { history }));
            changed = true;
            continue;
          }
          next.push(r);
        }
        return changed ? next : undefined;
      });
    } catch (e) { failure = failure || e; }
    try {
      await d.store.update('pending:' + agentId, (stored) => {
        if (!Array.isArray(stored)) return undefined;
        const next = stored.filter(p => !pendingBound(p, scope));
        out.pending += stored.length - next.length;
        return next.length === stored.length ? undefined : next;
      });
    } catch (e) { failure = failure || e; }
  }
  if (d.threads && typeof d.threads.forgetSources === 'function') {
    try { out.threads = await d.threads.forgetSources(ref => threadBound(ref, scope)); }
    catch (e) { failure = failure || e; }
  }
  if (failure) throw failure;
  return out;
}

module.exports = { makeSessionTombstones, forgetSessionMemory, _internals: { normalizeState, deletedScope, notebookRecordBound, pendingBound, threadBound, SID_RE, MAX_STREAMS } };
