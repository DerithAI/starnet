/* node test/session-tombstones.test.js — A DELETED SESSION IS FORGOTTEN (qa/bugs/3e926b6a, P1 privacy).

   The Commander deletes a session from the rail. Before this fix the sidecar never learned it: the durable transcript
   kept serving the deleted words to resume, recall_conversation searched and listed them, and memories written there
   rode later prompts. This proves each context path on the real modules (temp dirs, real fs):

     1. THE LEDGER (session-tombstones.js) learns deletes from the save's deletedIds, stamps when, survives a reload,
        keeps a delete after the id leaves the page's list (a re-open, the 500 cap, NEW AGENT), restamps a second delete,
        and ignores a save that carries no list.
     2. HISTORY — transcriptstore history/reconstruct/taintOf/all forget the deleted session (in-memory io and the real
        segmented io), and a session re-opened under the same id hears only what was said after the delete.
     3. RECALL — the real recall_conversation tool's search (stream + all), browse and scroll never return a deleted row,
        and the segment index ranks among the rows it may return (a deleted session never takes a slot).
     4. MEMORY — forgetSessionMemory removes the notebook records, revisions, pending proposals and open threads the
        deleted session's runs left, over the real memory-store and threads-store, and keeps everyone else's.
     5. CROSS-SESSION READS — a read of the deleted session by id (station.read_session's transcript read, a worker's
        sessionContext, the away briefing's last words) comes back empty; other sessions read as before.
     6. THE HOST WIRING (sidecar/index.js, static): the store reads through the ledger, every accepted station save and
        the boot save feed it, and the run-history readers that quote titles to a model skip a deleted session's runs. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./_assert.js');
const { makeSessionTombstones, forgetSessionMemory, _internals } = require('../sidecar/session-tombstones.js');
const { makeTranscriptStore } = require('../sidecar/transcriptstore.js');
const { makeSegmentedTranscriptIo } = require('../sidecar/transcript-history.js');
const { makeRecallTool } = require('../sidecar/tools/builtin/recall.js');
const { makeMemoryStore, appendPending, listPending } = require('../sidecar/memory-store.js');
const { makeThreadsStore } = require('../sidecar/threads-store.js');

function temp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-tomb-' + name + '-')); }
function remove(dir) { fs.rmSync(dir, { recursive: true, force: true }); }
const clockAt = start => { let t = start; return { now: () => t, set: v => { t = v; } }; };

(async () => {
  // ---------------- 1. the ledger ----------------
  {
    const dir = temp('ledger');
    try {
      const clock = clockAt(1000);
      const file = path.join(dir, 'session-tombstones.json');
      let t = makeSessionTombstones({ fs, path, file, now: clock.now });
      A.eq(t.status(), 'absent', 'a fresh station has no ledger yet');
      A.eq(t.deletedAt('ws_a'), 0, 'a session nobody deleted has no stamp');
      A.eq(t.observe(undefined), [], 'a save with no deletedIds teaches nothing');
      A.eq(t.observe(['ws_a', 'ws_b', '../escape', '', null, 'ws_a']), ['ws_a', 'ws_b'], 'each valid id is stamped once; a bad id is ignored');
      A.eq(t.deletedAt('ws_a'), 1000, 'the stamp is when the sidecar learned the delete');
      A.ok(t.forgotten('ws_a', 999) && t.forgotten('ws_a', 1000) && t.forgotten('ws_a', 0), 'a row stamped at or before the delete (or unstamped) is forgotten');
      A.ok(!t.forgotten('ws_a', 1001) && !t.forgotten('ws_c', 5), 'a later row, or another session, is not');
      clock.set(2000);
      A.eq(t.observe(['ws_a', 'ws_b']), [], 'the same list again is not a new delete');
      A.eq(t.deletedAt('ws_a'), 1000, '…and keeps the first stamp');
      A.eq(t.observe('not-a-list'), [], 'a malformed list teaches nothing');
      A.ok(t.list().every(e => e.live), '…and never reads as "every delete was undone"');
      // the page re-opens ws_a (revive) or drops it past its 500 cap: it leaves the list, the delete stands
      clock.set(3000);
      A.eq(t.observe(['ws_b']), [], 'an id leaving the list is no new delete');
      A.eq(t.deletedAt('ws_a'), 1000, 'what was deleted stays deleted after the id leaves the page\'s list');
      // reload from disk
      t = makeSessionTombstones({ fs, path, file, now: clock.now });
      A.eq(t.status(), 'ok', 'the ledger is durable');
      A.eq([t.deletedAt('ws_a'), t.deletedAt('ws_b')], [1000, 1000], 'both stamps survive a restart');
      A.eq(t.list().find(e => e.id === 'ws_a').live, false, 'ws_a is remembered as no longer in the page list');
      // the re-opened ws_a is deleted AGAIN: a fresh delete, stamped now
      clock.set(4000);
      A.eq(t.observe(['ws_b', 'ws_a']), ['ws_a'], 'a second delete of a re-opened session is a fresh delete');
      A.eq(t.deletedAt('ws_a'), 4000, '…stamped at the second delete, so what it said since the first is forgotten too');
      // NEW AGENT clears the page list: nothing is undeleted
      A.eq(t.observe([]), [], 'an empty list stamps nothing');
      A.eq([t.deletedAt('ws_a'), t.deletedAt('ws_b')], [4000, 1000], 'a reset page list never brings a deleted session back');
      // purge bookkeeping
      A.eq(t.unpurged().map(e => e.id), ['ws_b', 'ws_a'], 'every stamp starts unpurged, oldest first');
      t.markPurged([{ id: 'ws_b', at: 1000 }, { id: 'ws_a', at: 1 }]);
      A.eq(t.unpurged().map(e => e.id), ['ws_a'], 'a purge is recorded only for the stamp it ran against');
      t = makeSessionTombstones({ fs, path, file, now: clock.now });
      A.eq(t.unpurged().map(e => e.id), ['ws_a'], 'an unfinished purge is retried after a restart');
      // cap: the oldest stamps go first past MAX_STREAMS
      const many = { streams: {} };
      for (let i = 0; i < _internals.MAX_STREAMS + 5; i++) many.streams['s' + i] = { at: i + 1, live: false };
      const capped = _internals.normalizeState(many);
      A.eq(Object.keys(capped.streams).length, _internals.MAX_STREAMS, 'the ledger is bounded');
      A.ok(!capped.streams.s0 && !!capped.streams['s' + (_internals.MAX_STREAMS + 4)], '…dropping the oldest stamps first');
    } finally { remove(dir); }
  }

  // ---------------- 2 + 3 + 5. history, recall, cross-session reads ----------------
  async function storePaths(label, makeIo) {
    const dir = temp('store-' + label);
    try {
      const clock = clockAt(100);
      const ledger = makeSessionTombstones({ fs, path, file: path.join(dir, 'tomb.json'), now: clock.now });
      const io = makeIo(dir);
      const store = makeTranscriptStore({ io, clock, deletedAt: id => ledger.deletedAt(id) });
      const say = (streamId, role, content, extra) => { clock.set(clock.now() + 10); return store.append(Object.assign({ streamId, agentId: 'agent', role, content, taint: null }, extra || {})); };
      say('ws_gone', 'user', 'echo session uniqueword quokka');
      say('ws_gone', 'assistant', 'Reply to: echo session uniqueword quokka — done.', { taint: 'web page example.com' });
      say('ws_keep', 'user', 'the platypus plan with quokka mentioned once');
      say('ws_keep', 'assistant', 'Platypus plan noted.');
      for (let i = 0; i < 12; i++) say('ws_gone', 'user', 'quokka filler line ' + i + ' quokka quokka');   // would crowd a top-N
      const before = store.search('ws_keep', 'quokka', { scope: 'all', limit: 3 });
      A.ok(before.some(h => h.streamId === 'ws_gone'), label + ': before the delete the deleted session is searchable (the bug)');

      clock.set(clock.now() + 10);
      A.eq(ledger.observe(['ws_gone']), ['ws_gone'], label + ': the page\'s save deletes ws_gone');
      clock.set(clock.now() + 10);

      // HISTORY
      A.eq(store.history('ws_gone').length, 0, label + ': history() forgets the deleted session');
      A.eq(store.reconstruct('ws_gone', { limit: 80 }).length, 0, label + ': reconstruct() (resume / a worker\'s sessionContext) hands a model nothing');
      A.eq(store.taintOf('ws_gone', [{ role: 'user', content: 'echo session uniqueword quokka' }]), null, label + ': a forgotten row taints nothing');
      A.ok(!store.all().some(r => r.streamId === 'ws_gone'), label + ': all() (the evidence pack\'s clean owner chats) forgets it');
      A.eq(store.history('ws_keep').map(r => r.content), ['the platypus plan with quokka mentioned once', 'Platypus plan noted.'], label + ': another session reads exactly as before');

      // RECALL through the real tool
      const tool = makeRecallTool({ transcriptStore: store, ownStreamOnly: () => false }).recallTool;
      const ctx = { streamId: 'ws_fresh' };
      const all = await tool.run({ query: 'quokka', scope: 'all', limit: 10 }, ctx);
      A.ok(!/uniqueword|filler|ws_gone/.test(all.content), label + ': recall search (scope all) returns no deleted row: ' + all.content.slice(0, 200));
      A.ok(/ws_keep/.test(all.content), label + ': …and still finds the live session\'s mention');
      const top = store.search('ws_keep', 'quokka', { scope: 'all', limit: 1 });
      A.eq(top.map(h => h.streamId), ['ws_keep'], label + ': a deleted session never takes a top-N slot (12 stronger deleted rows, limit 1)');
      const local = await tool.run({ query: 'uniqueword' }, { streamId: 'ws_gone' });
      A.ok(!/uniqueword quokka/.test(local.content) && /No messages/.test(local.content), label + ': a search from the deleted session\'s own id finds nothing');
      const browse = await tool.run({}, ctx);
      A.ok(!/ws_gone/.test(browse.content) && /ws_keep/.test(browse.content), label + ': recall browse no longer lists the deleted session: ' + browse.content.slice(0, 200));
      A.ok(!store.streams({ limit: 100 }).some(s => s.streamId === 'ws_gone'), label + ': streams() drops it');
      const deletedRow = before.find(h => h.streamId === 'ws_gone');
      const scroll = await tool.run({ around: deletedRow.ts, stream: 'ws_gone' }, ctx);
      A.ok(!/uniqueword|filler/.test(scroll.content), label + ': recall scroll around a deleted moment reads nothing: ' + scroll.content.slice(0, 160));
      if (deletedRow.rowId) {
        const anchored = await tool.run({ anchor: 'tx-' + deletedRow.rowId, stream: 'ws_gone' }, ctx);
        A.ok(!/uniqueword|filler/.test(anchored.content), label + ': a stable tx- anchor to a deleted row reads nothing');
      }

      // RE-OPENED under the same id: only what is said after the delete
      say('ws_gone', 'user', 'a new beginning with kangaroo');
      say('ws_gone', 'assistant', 'Kangaroo acknowledged.');
      A.eq(store.history('ws_gone').map(r => r.content), ['a new beginning with kangaroo', 'Kangaroo acknowledged.'], label + ': a re-opened session hears only what was said after the delete');
      A.eq(store.reconstruct('ws_gone').map(m => m.role), ['user', 'assistant'], label + ': its resume replays only those turns');
      const listed = store.streams({ limit: 100 }).find(s => s.streamId === 'ws_gone');
      A.ok(listed && listed.turns === 2 && /kangaroo/.test(listed.preview), label + ': browse lists the re-opened session from its new turns only: ' + JSON.stringify(listed));
      A.ok(!/uniqueword/.test(JSON.stringify(store.search('ws_gone', 'quokka uniqueword kangaroo', { scope: 'all', limit: 50 }))), label + ': search still never returns the old turns');
      return store;
    } finally { remove(dir); }
  }
  await storePaths('ram', () => ({ readAll() { return []; }, append() {} }));
  await storePaths('segmented', dir => makeSegmentedTranscriptIo({ fs, path, root: path.join(dir, 'history'), segmentBytes: 700, recentPerStream: 4 }));

  // a stream RAM has trimmed is answered from disk: the disk answer forgets too (segmented io, tiny RAM window)
  {
    const dir = temp('store-trimmed');
    try {
      const clock = clockAt(10);
      const ledger = makeSessionTombstones({ fs, path, file: path.join(dir, 'tomb.json'), now: clock.now });
      const io = makeSegmentedTranscriptIo({ fs, path, root: path.join(dir, 'history'), segmentBytes: 400, recentPerStream: 2 });
      const store = makeTranscriptStore({ io, clock, deletedAt: id => ledger.deletedAt(id), ramPerStream: 2, ramMax: 4 });
      for (let i = 0; i < 9; i++) { clock.set(clock.now() + 5); store.append({ streamId: 'ws_long', role: i % 2 ? 'assistant' : 'user', content: 'secret line ' + i, taint: null }); }
      A.eq(store.history('ws_long').length, 9, 'a trimmed stream reads its full history from disk before the delete');
      clock.set(clock.now() + 5); ledger.observe(['ws_long']); clock.set(clock.now() + 5);
      A.eq(store.history('ws_long').length, 0, 'a trimmed stream\'s disk answer forgets the deleted rows too');
      const reloaded = makeTranscriptStore({ io: makeSegmentedTranscriptIo({ fs, path, root: path.join(dir, 'history'), segmentBytes: 400, recentPerStream: 2 }), clock,
        deletedAt: id => makeSessionTombstones({ fs, path, file: path.join(dir, 'tomb.json'), now: clock.now }).deletedAt(id) });
      A.eq(reloaded.history('ws_long').length + reloaded.search('x', 'secret', { scope: 'all' }).length, 0, 'after a restart (fresh io + reloaded ledger) the session stays forgotten');
    } finally { remove(dir); }
  }

  // ---------------- 4. memory ----------------
  {
    const dir = temp('memory');
    try {
      const store = makeMemoryStore({ fs, path, workspaces: dir });
      const threads = makeThreadsStore({ fs, path, workspaces: dir });
      const at = 5000;
      const runs = [
        { runId: 'run_gone_1', streamId: 'ws_gone', ts: 4000 },
        { runId: 'run_gone_2', streamId: 'ws_gone', ts: 4500 },
        { runId: 'run_keep', streamId: 'ws_keep', ts: 4200 },
        { runId: 'run_gone_after', streamId: 'ws_gone', ts: 9000 }   // a re-opened session's later run: not the deleted one
      ];
      await store.update('notebook:agent', () => [
        { id: 'note_1', title: 'Quokka', body: 'The quokka codeword is Wallaby-Seven', scope: 'stream', streamId: 'ws_gone', sourceRunId: 'run_gone_1', createdAt: 4000 },
        { id: 'note_2', title: 'Pet', body: 'The Commander keeps a pet quokka', scope: 'global', streamId: null, sourceRunId: 'run_gone_2', createdAt: 4500 },
        { id: 'note_3', title: 'Corrected', body: 'revised in the deleted chat', scope: 'global', sourceRunId: 'run_keep', updatedSourceRunId: 'run_gone_2', createdAt: 100 },
        { id: 'note_4', title: 'Stated', body: 'always reply tersely', scope: 'global', sourceRunId: 'run_x', statedBy: { runId: 'run_gone_1', quote: 'always reply tersely' }, createdAt: 100 },
        { id: 'note_5', title: 'Kept', body: 'The platypus plan ships Friday', scope: 'global', sourceRunId: 'run_keep', createdAt: 4200,
          history: [{ body: 'an older text the deleted chat wrote', sourceRunId: 'run_gone_1' }, { body: 'the original', sourceRunId: 'run_keep' }] },
        { id: 'note_6', title: 'After', body: 'said after the re-open', scope: 'stream', streamId: 'ws_gone', sourceRunId: 'run_gone_after', createdAt: 9000 },
        { id: 'note_7', title: 'Feedback', origin: 'feedback', body: 'Loved the quokka draft', scope: 'global', sourceRunId: 'run_gone_1', confirmation: 'user-confirmed', createdAt: 4100 }
      ]);
      await store.update('notebook:scribe', () => [{ id: 'note_1', title: 'Scribe saw it', body: 'quokka relayed', scope: 'global', sourceRunId: 'run_gone_2', createdAt: 4500 }]);
      await appendPending(store, 'agent', 'run_gone_1', [{ id: 'p1', content: 'Commander SSN-shaped secret from the deleted chat' }], 4000);
      await appendPending(store, 'agent', 'run_keep', [{ id: 'p1', content: 'a pending proposal from the kept chat' }], 4200);
      await threads.add({ id: 'th_gone', title: 'Build a quokka tracker', spec: 'quokka', sourceRef: { streamId: 'ws_gone', runId: 'run_gone_1', date: 4000 } }, 4000);
      await threads.add({ id: 'th_keep', title: 'Ship the platypus plan', spec: 'platypus', sourceRef: { streamId: 'ws_keep', runId: 'run_keep', date: 4200 } }, 4200);
      await threads.add({ id: 'th_dated', title: 'Another deleted idea about wombats', spec: 'x', sourceRef: { streamId: 'ws_gone', date: 4600 } }, 4600);

      const counts = await forgetSessionMemory({ store, threads, agentIds: ['agent', 'scribe', '../bad'], deleted: [{ id: 'ws_gone', at }], runs });
      A.eq(counts, { notes: 6, revisions: 1, pending: 1, threads: 2 }, 'the purge reports what it removed');
      const left = store.get('notebook:agent').map(r => r.id);
      A.eq(left, ['note_5', 'note_6'], 'the notebook keeps only records the deleted session did not write, revise or prove (and the re-opened session\'s later note)');
      A.eq(store.get('notebook:agent').find(r => r.id === 'note_5').history.map(h => h.body), ['the original'], 'a kept record loses the revision text the deleted session wrote');
      A.eq(store.get('notebook:scribe'), [], 'another agent\'s notebook loses what the deleted session\'s run wrote there');
      A.eq(listPending(store, 'agent').map(p => p.runId), ['run_keep'], 'a pending proposal from the deleted session never waits for a Keep');
      A.eq(threads.list().map(t => t.id), ['th_keep'], 'open threads mined from the deleted session are gone (by run and by stream + date)');
      A.ok(threads.isDeclined('Build a quokka tracker') === false, 'forgetting is not declining: the denylist is untouched');
      const again = await forgetSessionMemory({ store, threads, agentIds: ['agent', 'scribe'], deleted: [{ id: 'ws_gone', at }], runs });
      A.eq(again, { notes: 0, revisions: 0, pending: 0, threads: 0 }, 'the purge is idempotent (a boot retry removes nothing twice)');
      A.eq(await forgetSessionMemory({ store, threads, agentIds: ['agent'], deleted: [], runs }), { notes: 0, revisions: 0, pending: 0, threads: 0 }, 'nothing deleted, nothing touched');
      // a store failure is reported, so the host records nothing as purged and retries
      let threw = false;
      try { await forgetSessionMemory({ store: { update: () => Promise.reject(new Error('disk gone')) }, agentIds: ['agent'], deleted: [{ id: 'ws_gone', at }], runs }); }
      catch (e) { threw = /disk gone/.test(e.message); }
      A.ok(threw, 'a failing store throws (the host retries the purge on the next boot)');
    } finally { remove(dir); }
  }

  // ---------------- 6. host wiring (static: sidecar/index.js is never required here) ----------------
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    const ledgerAt = src.indexOf('const sessionTombstones = SessionTombstones.makeSessionTombstones(');
    const storeAt = src.indexOf('const transcriptStore = makeTranscriptStore(');
    A.ok(ledgerAt > 0 && storeAt > ledgerAt, 'the ledger is built before the transcript store reads anything');
    A.ok(/const transcriptStore = makeTranscriptStore\(\{[^\n]*deletedAt: id => sessionTombstones\.deletedAt\(id\)/.test(src), 'the transcript store reads through the ledger');
    const saveWrite = src.slice(src.indexOf('async function handleSaveWrite('), src.indexOf('async function handleGrowthRatings('));
    A.ok(/result\.ok === true && agentId === 'agent'\) observeDeletedSessions\(body\.deletedIds\)/.test(saveWrite), 'every accepted station save feeds its deletedIds to the ledger');
    A.ok(/saveStore\.loadState\('agent'\)[\s\S]{0,200}observeDeletedSessions\(bootSave\.doc && bootSave\.doc\.deletedIds\)/.test(src), 'the save on disk feeds the ledger at boot');
    A.ok(/if \(fresh\.length\) forgetDeletedSessionMemory\(\)/.test(src) && /if \(sessionTombstones\.unpurged\(\)\.length\) forgetDeletedSessionMemory\(\)/.test(src), 'a fresh delete purges memory, and an unfinished purge is retried at boot');
    const recent = src.slice(src.indexOf('function nightshiftRecentRuns()'), src.indexOf('function nightshiftContextPack('));
    A.ok(/!sessionRunForgotten\(r\)/.test(recent), 'RECENT ACTIVITY skips a deleted session\'s runs');
    const away = src.slice(src.indexOf('async function awayBriefingInputs('), src.indexOf('function tzOffsetOf('));
    A.ok(/filter\(r => !sessionRunForgotten\(r\)\)/.test(away), 'the away briefing never reports a deleted session\'s runs');
    const focus = src.slice(src.indexOf('function nightFocusInputs()'), src.indexOf('function nightFocusInputs()') + 2000);
    A.ok(/!sessionRunForgotten\(r\)/.test(focus), 'the night focus never counts a deleted session\'s titles');
  }

  A.report('session-tombstones');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
