/* node test/transcript-selftalk.test.js — THE STATION'S SELF-TALK IS NOT THE COMMANDER'S WORDS (bug 4dee26ba).

   The quiet title call (its prompt is the session's substantive user messages plus 200 characters of the reply), the
   goal judge, pitch, autopilot and every other reason-only internal call run with no workstream, so the sidecar filed
   their prompt and reply in the shared 'global' stream as ordinary user/assistant rows. recall_conversation then quoted
   them back as "you said …", and because they live in 'global' a DELETED session's opening lines survived there (the
   session tombstone filters by stream). This proves, on the real modules (temp dirs, real fs):

     1. WRITE — runOnce stamps a streamless internal run's rows dispatchState 'internal' on both transcript writers
        (static: the run-end append path and makeRunTranscript), and a stream-bound run keeps its exact stamp.
     2. READ — search (stream + all, in-memory and segmented io), the recall tool, and scroll never return an
        'internal' row; a real 'global' row is still found. Nothing is deleted: the rows stay on disk.
     3. ALREADY WRITTEN — rows a 0.13.5 station filed in 'global' before the stamp existed (the title prompt's
        "Assistant reply (context only):" tail, an "INTERNAL —" directive, the goal judge's prompt) are skipped by the
        same readers; the same words in a named session are the Commander's and are still found. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./_assert.js');
const { makeTranscriptStore, projectConversation } = require('../sidecar/transcriptstore.js');
const { makeSegmentedTranscriptIo } = require('../sidecar/transcript-history.js');
const { makeRecallTool } = require('../sidecar/tools/builtin/recall.js');

function temp(name) { return fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-selftalk-' + name + '-')); }
const clockAt = start => { let t = start; return { now: () => t, set: v => { t = v; } }; };

(async () => {
  // ---------------- 1. WRITE: the host stamps streamless self-talk 'internal' ----------------
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    const rule = src.match(/const transcriptState = \(o\.dispatchDelivery && o\.dispatchDelivery\.state\) \|\| \(internal && !o\.streamId \? 'internal' : undefined\);/);
    A.ok(!!rule, 'runOnce names ONE transcript state: the dispatch envelope\'s, else \'internal\' for streamless self-talk');
    const mk = src.indexOf('const runTranscript = makeRunTranscript({');
    A.ok(mk > 0 && rule && rule.index < mk && /dispatchState: transcriptState,/.test(src.slice(mk, mk + 400)), 'makeRunTranscript writes with that state');
    const endAt = src.indexOf("if (title && !retryDirective && !o.syntheticTrigger && !runTranscript.directiveWritten()) transcriptStore.append(");
    const endPath = endAt > 0 ? src.slice(endAt, endAt + 900) : '';
    A.ok(/content: title,[^\n]*dispatchState: transcriptState \}\);/.test(endPath), 'the run-end directive append writes with that state');
    A.ok(/transcriptStore\.appendNew\(o\.streamId, agentId, result\.messages, \{[^\n]*dispatchState: transcriptState \}\);/.test(endPath), 'the run-end turn append writes with that state');
    A.ok(!/dispatchState: o\.dispatchDelivery && o\.dispatchDelivery\.state/.test(endPath), 'no run-end writer keeps the envelope-only state');
  }

  // ---------------- 2 + 3. READ: search / recall / scroll skip self-talk ----------------
  async function readers(label, makeIo) {
    const dir = temp(label);
    try {
      const clock = clockAt(100);
      const store = makeTranscriptStore({ io: makeIo(dir), clock });
      const say = (streamId, role, content, extra) => { clock.set(clock.now() + 10); return store.append(Object.assign({ streamId, agentId: 'agent', role, content, taint: null }, extra || {})); };
      // what a 0.14.0 station writes for the quiet title call: both rows stamped internal (streamless → 'global')
      say(undefined, 'user', 'Plan the zebrafish aquarium rebuild\n\nAssistant reply (context only): Sure — zebrafish tanks need', { dispatchState: 'internal' });
      say(undefined, 'assistant', 'Zebrafish Aquarium Rebuild', { dispatchState: 'internal' });
      // what a 0.13.5 station already wrote: the same self-talk, unstamped, in 'global'
      say('global', 'user', 'Fix the walrus invoice export\n\nAssistant reply (context only): The walrus export fails because');
      say('global', 'user', 'INTERNAL — SELF-DIRECTED WORK. The Commander is away. Do not run any tools. walrus backlog');
      say('global', 'user', 'Goal:\nship the walrus importer\n\nAgent\'s most recent response:\nwalrus done\n\nIs the goal satisfied — done or continue?');
      // the Commander's own words: a real global row, and a named session that quotes the same shapes
      say('global', 'user', 'remember the walrus password rotation');
      say('ws_named', 'user', 'INTERNAL — walrus memo I wrote myself');
      say('ws_named', 'user', 'zebrafish tank notes for the named session');

      const allHits = store.search('ws_named', 'zebrafish walrus', { scope: 'all', limit: 50 });
      const said = allHits.map(h => h.content);
      A.ok(!said.some(c => /context only|Zebrafish Aquarium Rebuild|SELF-DIRECTED|Is the goal satisfied/.test(c)), label + ': search (scope all) returns no self-talk row: ' + JSON.stringify(said));
      A.ok(said.includes('remember the walrus password rotation'), label + ': a real global row is still found');
      A.ok(said.includes('INTERNAL — walrus memo I wrote myself') && said.includes('zebrafish tank notes for the named session'), label + ': a named session\'s words are the Commander\'s and are still found');
      const globalHits = store.search(undefined, 'walrus zebrafish', { limit: 50 }).map(h => h.content);
      A.eq(globalHits, ['remember the walrus password rotation'], label + ': search of the global stream itself finds only the real row');

      const tool = makeRecallTool({ transcriptStore: store, ownStreamOnly: () => false }).recallTool;
      const recalled = await tool.run({ query: 'zebrafish walrus', scope: 'all', limit: 20 }, { streamId: 'ws_named' });
      A.ok(!/context only|Aquarium Rebuild|SELF-DIRECTED|Is the goal satisfied/.test(recalled.content), label + ': recall_conversation never quotes self-talk as "you said": ' + recalled.content.slice(0, 300));
      A.ok(/password rotation/.test(recalled.content), label + ': …and still recalls the real global row');

      const realRow = store.search(undefined, 'password rotation', { limit: 1 })[0];
      const scroll = await tool.run({ around: realRow.ts, stream: 'global', limit: 20 }, { streamId: 'ws_named' });
      A.ok(/password rotation/.test(scroll.content) && !/context only|Aquarium Rebuild|SELF-DIRECTED|Is the goal satisfied/.test(scroll.content), label + ': scroll around a real global moment skips the self-talk beside it: ' + scroll.content.slice(0, 300));

      // never deleted: the rows stay on disk and in the raw stream read
      A.eq(store.history('global', { limit: 50 }).length, 6, label + ': every global row is still stored (filtering, not deletion)');
      // COMMS display already hides stamped rows (projectConversation); the stamp makes new self-talk vanish there too
      A.eq(projectConversation(store.history('global', { limit: 50 })).filter(r => r.dispatchState === 'internal').length, 0, label + ': the conversation projection shows no stamped self-talk');
    } finally { fs.rmSync(dir, { recursive: true, force: true }); }
  }
  await readers('ram', () => ({ readAll() { return []; }, append() {} }));
  await readers('segmented', dir => makeSegmentedTranscriptIo({ fs, path, root: path.join(dir, 'history'), segmentBytes: 600, recentPerStream: 3 }));

  A.report('transcript-selftalk');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
