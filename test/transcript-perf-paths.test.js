/* node test/transcript-perf-paths.test.js — what one transcript row and one transcript read cost (perf review 2026-10-19:
   #4, #5, "Away briefing N+1", "Lifetime search", the `constructor` query).

   A user said StarNet "eats my PC's resources". Every transcript row opened its segment three times (tail byte, append,
   read-back: a Defender rescan each, on a file growing to 4 MB) and SHA-256'd the whole ~1 MB active index, which nothing
   reads until a manifest write. Every history() read re-read and re-parsed whole segments, even for a stream the RAM
   mirror held completely — 2-4 times per run, and every 3 s per desk screen. A recall re-read and re-hashed every closed
   index, and a recall containing the word "constructor" threw on any closed index (Object.prototype), silently
   dropping recall to the RAM tail.

   GENUINE: the REAL segmented io and the REAL store on a temp dir, through an fs that counts what each call costs. The
   index.js seams (transcriptRunSince + serveTranscript, awayBriefingInputs) are the REAL source sliced out of
   sidecar/index.js (never required: that boots a sidecar) and run against the real store. Durability stays the same:
   one fsync and one read-back proof per row, every row readable by a fresh process. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const history = require('../sidecar/transcript-history.js');
const transcriptStoreModule = require('../sidecar/transcriptstore.js');
const { makeSegmentedTranscriptIo } = history;
const { makeTranscriptStore } = transcriptStoreModule;

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-tx-perf-'));
let dirs = 0;
const freshDir = () => path.join(base, 'h' + (++dirs));
const opened = [];
let finished = false;
const track = io => { opened.push(io); return io; };

// an fs that counts opens, fsyncs, and which segment/index files are read
function countingFs() {
  const c = { open: 0, fsync: 0, jsonl: [], index: 0 };
  const f = Object.create(fs);
  f.openSync = (...a) => { c.open++; return fs.openSync(...a); };
  f.fsyncSync = (...a) => { c.fsync++; return fs.fsyncSync(...a); };
  f.readFileSync = (file, ...rest) => {
    const name = path.basename(String(file));
    if (/\.jsonl$/.test(name)) c.jsonl.push(name); else if (/\.index\.json$/.test(name)) c.index++;
    return fs.readFileSync(file, ...rest);
  };
  c.reset = () => { c.open = 0; c.fsync = 0; c.jsonl = []; c.index = 0; };
  return { fs: f, c };
}
// sha256 digests taken through node:crypto (the module the io hashes with)
let hashes = 0;
const realCreateHash = crypto.createHash;
crypto.createHash = function (alg, ...rest) { if (String(alg).toLowerCase() === 'sha256') hashes++; return realCreateHash.call(this, alg, ...rest); };

try {
  // ---- 1. a row on an open segment costs no open and no index hash; still one fsync, still readable after restart ----
  {
    const { fs: cfs, c } = countingFs();
    const root = freshDir();
    const io = track(makeSegmentedTranscriptIo({ fs: cfs, path, root }));
    const store = makeTranscriptStore({ io, clock: { now: () => 1000 } });
    store.append({ streamId: 'w', role: 'user', content: 'the first row creates the segment', taint: null });
    c.reset(); hashes = 0;
    const N = 40;
    for (let i = 0; i < N; i++) store.append({ streamId: 'w', role: i % 2 ? 'assistant' : 'user', content: 'row ' + i + ' ' + 'lorem ipsum dolor '.repeat(30), taint: null });
    A.eq(c.open, 0, 'appending to an open segment opens no file (was 3 opens a row: tail byte, append, read-back)');
    A.eq(hashes, 0, 'appending never hashes the active index (was one sha256 of the whole index a row)');
    A.eq(c.fsync, N, 'durability unchanged: exactly one fsync per row');
    const reread = makeSegmentedTranscriptIo({ fs, path, root }).history('w', { limit: 100 });
    A.eq(reread.length, N + 1, 'every row is on disk for a fresh process view');
    A.eq(reread[N].content, store.history('w', { limit: 1 })[0].content, 'the newest row reads the same from disk and from the store');
  }

  // ---- 2. the manifest still persists the checksum a per-row hash would have written; closed checksums still verify ----
  {
    const root = freshDir();
    const io = track(makeSegmentedTranscriptIo({ fs, path, root, segmentBytes: 900 }));
    for (let i = 0; i < 14; i++) io.appendDurable({ streamId: 'm', role: 'user', content: 'checksum row ' + i + ' ' + 'z'.repeat(60), ts: i + 1 }, { saveManifest: i === 13 });
    const persisted = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    const warnings = [];
    const fresh = track(makeSegmentedTranscriptIo({ fs, path, root, segmentBytes: 900, onWarning: m => warnings.push(m) }));
    const active = s => s.segments.find(x => x.number === s.activeSegment);
    A.ok(persisted.segments.length >= 3, 'the rows rolled through several segments (' + persisted.segments.length + ')');
    A.ok(/^[a-f0-9]{64}$/.test(String(active(persisted).indexHash)), 'the mid-segment manifest write carries a real active checksum');
    A.eq(active(persisted).indexHash, active(fresh.status()).indexHash, 'that checksum is the one a fresh boot computes from exactly those rows');
    A.eq(fresh.search('m', 'checksum', { scope: 'all', limit: 50 }).length, 14, 'every closed segment index verifies and answers');
    A.ok(!warnings.some(w => /checksum mismatch/.test(w)), 'no closed index fails its checksum (' + warnings.join(' | ') + ')');
  }

  // ---- 3. history() answers from RAM when RAM holds the whole stream — the same rows the segments return ----------
  {
    const root = freshDir();
    let t = 1;
    const clock = { now: () => t++ };
    const w = countingFs();
    const io = track(makeSegmentedTranscriptIo({ fs: w.fs, path, root, segmentBytes: 2000 }));
    const writer = makeTranscriptStore({ io, clock });
    for (let i = 0; i < 30; i++) writer.append({ streamId: i % 3 ? 'busy' : 'small', role: i % 2 ? 'assistant' : 'user', content: 'turn ' + i + ' ' + 'q'.repeat(80), sourceRunId: 'run' + (i % 4), taint: null });
    A.ok(io.status().segments.length >= 2, 'the conversation spans closed and active segments');
    const asks = [['small', { limit: 1200 }], ['small', { limit: 3 }], ['busy', { limit: 3000 }], ['busy', { limit: 5, sourceRunId: 'run1' }], ['nobody', {}]];
    // the reference: a fresh process view that parses every closed segment from disk
    const reference = track(makeSegmentedTranscriptIo({ fs, path, root, segmentBytes: 2000, cacheBytes: 0 }));
    const disk = asks.map(([s, o]) => reference.history(s, Object.assign({ limit: 400 }, o)));
    A.eq(disk[2].length, 20, 'the reference reads the whole busy stream');
    w.c.reset();
    A.eq(asks.map(([s, o]) => writer.history(s, o)), disk, 'same process: the RAM answer is exactly the durable answer (order, fields, filters, limits)');
    A.eq(w.c.jsonl.length, 0, 'same process: history of streams RAM holds whole reads no segment (was a full read + parse a call)');
    const r = countingFs();
    const restarted = makeTranscriptStore({ io: track(makeSegmentedTranscriptIo({ fs: r.fs, path, root, segmentBytes: 2000 })), clock });
    r.c.reset();
    A.eq(asks.map(([s, o]) => restarted.history(s, o)), disk, 'after restart: the RAM answer is exactly the durable answer');
    A.eq(r.c.jsonl.length, 0, 'after restart: history of streams RAM holds whole reads no segment');
    // RAM that cannot vouch for a stream is never trusted: a trimmed stream reads its lifetime from disk
    const small = makeTranscriptStore({ io: track(makeSegmentedTranscriptIo({ fs, path, root, segmentBytes: 2000 })), clock, ramPerStream: 4 });
    A.eq(small.history('busy', { limit: 50 }).length, 20, 'a stream RAM trimmed to 4 rows still answers all 20 from disk');
    // a fail-open append that never reached disk is never served as history
    const flaky = track(makeSegmentedTranscriptIo({ fs, path, root: freshDir() }));
    const realAppend = flaky.appendDurable;
    flaky.append = flaky.appendDurable = function (entry, opts) { if (entry.content === 'lost') throw new Error('EIO: simulated'); return realAppend.call(flaky, entry, opts); };
    const fstore = makeTranscriptStore({ io: flaky, clock });
    for (const content of ['kept', 'lost', 'kept again']) fstore.append({ streamId: 'f', role: 'user', content, taint: null });
    A.eq(fstore.history('f').map(r => r.content), ['kept', 'kept again'], 'a stream whose append failed answers from disk, never from the RAM-only row');
    // strict reads keep proving the bytes on disk (a damaged line naming the run fails closed)
    const strictRoot = freshDir();
    const sio = track(makeSegmentedTranscriptIo({ fs, path, root: strictRoot }));
    const sstore = makeTranscriptStore({ io: sio, clock });
    sstore.appendStrict({ streamId: 's', role: 'assistant', content: 'answer', sourceRunId: 'R1', taint: null });
    fs.appendFileSync(path.join(strictRoot, 'segment-000001.jsonl'), '{"streamId":"s","sourceRunId":"R1","con\n');
    A.throws(() => sstore.history('s', { sourceRunId: 'R1', strict: true }), 'a strict read still sees a damaged line written behind the cache');
    A.eq(sstore.history('s', { sourceRunId: 'R1' }).length, 1, 'an ordinary read still isolates it');
  }

  // ---- 4. a stream longer than RAM: a repeated read re-parses no segment (closed parses are immutable) ---------------
  {
    const { fs: cfs, c } = countingFs();
    const root = freshDir();
    let t = 1;
    const io = track(makeSegmentedTranscriptIo({ fs: cfs, path, root, segmentBytes: 1500, cacheBytes: 1500 * 6 }));
    const store = makeTranscriptStore({ io, clock: { now: () => t++ }, ramPerStream: 5 });
    for (let i = 0; i < 40; i++) store.append({ streamId: 'long', role: i % 2 ? 'assistant' : 'user', content: 'long ' + i + ' ' + 'r'.repeat(90), taint: null });
    A.ok(io.status().segments.length >= 4, 'the stream spans several closed segments (' + io.status().segments.length + ')');
    c.reset();
    const first = store.history('long', { limit: 25 });
    const firstReads = c.jsonl.length;
    c.reset();
    const second = store.history('long', { limit: 25 });
    A.eq(first.length, 25, 'RAM holds 5 rows; the durable segments answer all 25');
    A.eq(second, first, 'a repeated read gives the same rows');
    A.ok(firstReads > 0, 'the first read loaded the closed segments it needed (' + firstReads + ')');
    A.eq(c.jsonl.length, 0, 'the repeated read re-reads no segment (was every segment again, each call)');
    // an append keeps the active parse exact: the newest row is served without a re-read
    store.append({ streamId: 'long', role: 'user', content: 'newest', taint: null });
    c.reset();
    A.eq(store.history('long', { limit: 26 }).slice(-1)[0].content, 'newest', 'a row appended after the cache filled is in the next read');
    A.eq(c.jsonl.length, 0, 'and that read needed no segment read either');
  }

  // ---- 4b. a lifetime search over more segments than the caches hold never empties them -----------------------------
  {
    const { fs: cfs, c } = countingFs();
    const root = freshDir();
    let t = 1;
    // room for 2 closed segment parses and roughly 2 closed indexes
    const io = track(makeSegmentedTranscriptIo({ fs: cfs, path, root, segmentBytes: 1500, cacheBytes: 3000, indexCacheBytes: 3000 }));
    const store = makeTranscriptStore({ io, clock: { now: () => t++ }, ramPerStream: 3 });
    for (let i = 0; i < 80; i++) store.append({ streamId: 'deep', role: i % 2 ? 'assistant' : 'user', content: 'deep ' + i + ' beacon ' + 'd'.repeat(90), taint: null });
    const closed = io.status().segments.length - 1;
    A.ok(closed >= 6, 'the stream spans more closed segments than the cache holds (' + closed + ')');
    store.history('deep', { limit: 12 });   // the newest closed segment(s) a conversation reads
    c.reset();
    store.history('deep', { limit: 12 });
    A.eq(c.jsonl.length, 0, 'the conversation\'s newest segments are cached');
    io.search('deep', 'beacon', { scope: 'all', limit: 5 });
    const firstIndexReads = c.index;
    c.reset();
    store.history('deep', { limit: 12 });
    A.eq(c.jsonl.length, 0, 'a search across every segment left the conversation\'s cached segments in place');
    io.search('deep', 'beacon', { scope: 'all', limit: 5 });
    A.ok(c.index > 0 && c.index < firstIndexReads, 'a repeated search re-reads only the indexes that did not fit (' + c.index + ' of ' + firstIndexReads + ')');

    // a conversation whose read needs ONE closed segment more than the cache holds re-reads only that one, every time
    // (least-recently-used evicted the segment the same read needed next, so every read re-read all three)
    const segs = io.status().segments;
    const at = k => segs[segs.length - 1 - k];
    const r = countingFs();
    const exact = track(makeSegmentedTranscriptIo({ fs: r.fs, path, root, segmentBytes: 1500, cacheBytes: at(1).bytes + at(2).bytes }));
    const reader = makeTranscriptStore({ io: exact, clock: { now: () => t++ }, ramPerStream: 3 });
    const limit = at(0).rows + at(1).rows + at(2).rows + at(3).rows;   // the active segment and the 3 newest closed ones
    reader.history('deep', { limit });
    for (let i = 0; i < 3; i++) {
      r.c.reset();
      A.eq(reader.history('deep', { limit }).length, limit, 'read ' + i + ' returns every row asked for');
      A.eq(r.c.jsonl, [at(3).file], 'read ' + i + ' re-reads only the one closed segment that does not fit');
    }
  }

  // ---- 5. lifetime search: "constructor" works, and a repeated recall re-reads and re-hashes no closed index ---------
  {
    const root = freshDir();
    const writer = track(makeSegmentedTranscriptIo({ fs, path, root, segmentBytes: 400 }));
    for (let i = 0; i < 10; i++) writer.appendDurable({ streamId: 'c', role: 'user', content: (i === 3 ? 'call the constructor first ' : 'plain words ') + i + ' ' + 'x'.repeat(60), ts: i + 1 });
    const { fs: cfs, c } = countingFs();
    const io = track(makeSegmentedTranscriptIo({ fs: cfs, path, root, segmentBytes: 400, cacheBytes: 1 << 20, indexCacheBytes: 1 << 20 }));
    A.ok(io.status().segments.length >= 3, 'the history spans several closed, JSON-loaded indexes (' + io.status().segments.length + ')');
    let hits = null;
    A.notThrows(() => { hits = io.search('c', 'constructor', { scope: 'all' }); }, 'a recall for "constructor" no longer throws on a closed index loaded from JSON');
    A.eq((hits || []).map(h => h.content.slice(0, 26)), ['call the constructor first'], 'it finds exactly the row that says it');
    const store = makeTranscriptStore({ io, clock: { now: () => 99 } });
    const mixed = store.search('c', 'constructor plain', { scope: 'all', limit: 20 });
    A.eq(mixed.length, 10, 'a recall mixing "constructor" with other words answers from lifetime history, not the RAM fallback');
    A.ok(mixed.every(h => typeof h.score === 'number'), 'every score is a number (the fallback scored "1000function Object()...")');
    c.reset(); hashes = 0;
    A.eq(io.search('c', 'plain', { scope: 'all', limit: 20 }).length, 9, 'a repeated recall gives the same answer');
    A.eq(c.index, 0, 'a repeated recall re-reads no closed index (was every index, every recall)');
    A.eq(hashes, 0, 'and re-hashes none');
    A.eq(c.jsonl.length, 0, 'and re-reads no closed segment body');
    // an index that falls out of a full cache is re-read but never re-hashed while its file is unchanged
    const { fs: cfs2, c: c2 } = countingFs();
    const tight = track(makeSegmentedTranscriptIo({ fs: cfs2, path, root, segmentBytes: 400, indexCacheBytes: 0 }));
    tight.search('c', 'plain', { scope: 'all' });
    c2.reset(); hashes = 0;
    tight.search('c', 'plain', { scope: 'all' });
    A.ok(c2.index > 0, 'with no index cache the indexes are read again (' + c2.index + ')');
    A.eq(hashes, 0, 'but a checksum that already matched is not recomputed');
    // a rewritten index file is checked again
    const idx1 = path.join(root, history._internals.indexName(1));
    const doc = JSON.parse(fs.readFileSync(idx1, 'utf8'));
    doc.terms.plain = [];
    fs.writeFileSync(idx1, JSON.stringify(doc));
    const warnings = [];
    const tampered = track(makeSegmentedTranscriptIo({ fs, path, root, segmentBytes: 400, indexCacheBytes: 0, onWarning: m => warnings.push(m) }));
    A.eq(tampered.search('c', 'plain', { scope: 'all', limit: 20 }).length, 9, 'a tampered closed index is rebuilt from its JSONL');
    A.ok(warnings.some(w => /checksum mismatch/.test(w)), 'and the mismatch is reported');
    // RAM fallback search (a host without lifetime search) had the same object-literal bug
    const ramOnly = makeTranscriptStore({ io: { readAll: () => [], append() {} }, clock: { now: () => 1 } });
    ramOnly.append({ streamId: 'r', role: 'user', content: 'nothing relevant here' });
    ramOnly.append({ streamId: 'r', role: 'user', content: 'call the constructor first' });
    const r = ramOnly.search('r', 'constructor');
    A.eq(r.map(h => h.content), ['call the constructor first'], 'RAM recall matches only the row that says it (every row "matched" before)');
    A.ok(r.every(h => typeof h.score === 'number'), 'with a numeric score');
  }

  // ---- 6. the tokenizer fast path tokenizes exactly as the per-character walk did -----------------------------------
  {
    const wordTokens = history._internals.wordTokens;
    A.ok(typeof wordTokens === 'function', 'the io exposes its tokenizer for this check');
    const cjk = /^(?:\p{Script=Han}|\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul})$/u;
    const reference = v => {   // the previous implementation, verbatim in behavior
      const out = [];
      for (const word of (String(v == null ? '' : v).normalize('NFKC').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])) {
        let run = '';
        for (const char of word) { if (!cjk.test(char)) { run += char; continue; } if (run) { out.push(run); run = ''; } out.push(char); }
        if (run) out.push(run);
      }
      return out.filter(t => t.length <= 64);
    };
    const samples = ['plain ascii words 123', 'Привет командир', '東京計画 and abc東京def', 'ＡＢＣ１２３ full width', 'mixed한국어text', 'ひらがなカタカナ漢字', 'x'.repeat(70) + ' short', '', null, 'emoji 🚀 rocket', 'çå déjà-vu naïve', 'a1b2東c3'];
    if (typeof wordTokens === 'function') for (const s of samples) A.eq(wordTokens(s), reference(s), 'same tokens for ' + JSON.stringify(s));
  }

  // ---- 7. serveTranscript: a runId read is bounded to the segments since the run started ------------------------------
  {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    const sinceSrc = A.fnBody(idx, 'function transcriptRunSince(');
    const serveSrc = A.fnBody(idx, 'function serveTranscript(');
    A.ok(serveSrc.length > 200 && serveSrc.length < 5000, 'serveTranscript sliced out of sidecar/index.js');
    const { fs: cfs, c } = countingFs();
    const root = freshDir();
    const DAY = 24 * 60 * 60 * 1000, START = 1000 + 10 * DAY;
    let t = 1000;
    const io = track(makeSegmentedTranscriptIo({ fs: cfs, path, root, segmentBytes: 700 }));
    // RAM holds 3 rows of 'global', so the read must go to the segments (the case the bound exists for)
    const transcriptStore = makeTranscriptStore({ io, clock: { now: () => t++ }, ramPerStream: 3 });
    for (let i = 0; i < 24; i++) transcriptStore.append({ streamId: 'global', role: 'assistant', content: 'old global chatter ' + i + ' ' + 'o'.repeat(80), ts: 1000 + i, taint: null });
    const oldSegments = io.status().segments.filter(s => s.number !== io.status().activeSegment).map(s => s.file);
    for (const run of ['live1', 'done1']) for (let i = 0; i < 3; i++) transcriptStore.append({ streamId: 'global', role: i ? 'assistant' : 'user', content: run + ' turn ' + i, sourceRunId: run, ts: START + i, taint: null });
    A.ok(oldSegments.length >= 3, 'years of global history sit in closed segments before the runs (' + oldSegments.length + ')');
    const runsMeta = new Map([['live1', { agentId: 'agent', startedAt: START, source: 'interactive' }]]);
    const runStore = { latest: id => (id === 'done1' ? { runId: id, startedAt: START, ts: START + 5000 } : null) };
    let sent = null;
    const deps = {
      URL, crypto, runsMeta, runStore, transcriptStore, transcriptStoreModule, transcriptLiveRuns: new Set(),
      isAgentId: id => /^[A-Za-z0-9_-]{1,40}$/.test(String(id)), failNote: () => {},
      respondJson: (res, code, obj) => { sent = { code, obj }; }, readRouteFailure: (n, e) => ({ error: String(e && e.message) }),
      conversationTranscript: () => []
    };
    const names = Object.keys(deps);
    const serveTranscript = new Function(...names, "'use strict';\n" + sinceSrc + '\n' + serveSrc + '\nreturn serveTranscript;')(...names.map(n => deps[n]));
    for (const run of ['live1', 'done1']) {
      c.reset(); sent = null;
      serveTranscript({ url: '/api/transcript?agent=agent&stream=global&runId=' + run + '&limit=80' }, {});
      A.eq(sent && sent.code, 200, run + ': the route answers');
      A.eq(((sent && sent.obj.turns) || []).map(r => r.content), [run + ' turn 0', run + ' turn 1', run + ' turn 2'], run + ': exactly the run\'s own rows');
      A.ok(!oldSegments.some(f => c.jsonl.includes(f)), run + ': no segment that ended before the run is read (read: ' + c.jsonl.join(',') + ')');
    }
    // a run the station cannot place reads every segment, as before (never a wrong empty answer)
    c.reset();
    serveTranscript({ url: '/api/transcript?agent=agent&stream=global&runId=nobody-knows&limit=80' }, {});
    A.eq(sent.obj.turns.length, 0, 'an unknown run still answers (empty)');
  }

  // ---- 8. away briefing: one transcript read per briefed stream, not one per run --------------------------------------
  {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    const src = A.fnBody(idx, 'async function awayBriefingInputs(');
    A.ok(src.length > 200 && src.length < 8000, 'awayBriefingInputs sliced out of sidecar/index.js');
    let t = 1;
    const real = makeTranscriptStore({ io: track(makeSegmentedTranscriptIo({ fs, path, root: freshDir() })), clock: { now: () => t++ } });
    real.append({ streamId: 'loop-L1', role: 'user', content: 'keep the site green', taint: null });
    real.append({ streamId: 'loop-L1', role: 'assistant', content: 'Fixed the hero section build.', taint: null });
    real.append({ streamId: 'cron-c1', role: 'assistant', content: 'Three unread invoices.', taint: null });
    let reads = 0;
    const transcriptStore = { reconstruct: (sid, o) => { reads++; return real.reconstruct(sid, o); } };
    const runs = [];
    for (let i = 0; i < 6; i++) runs.push({ runId: 'loop-run-' + i, streamId: 'loop-L1', reason: 'done', endedAt: 100 + i });
    runs.push({ runId: 'c1', streamId: 'cron-c1', cronJobId: 'inbox', reason: 'done', endedAt: 200 });
    runs.push({ runId: 'c2', streamId: 'cron-c2', cronJobId: 'inbox', reason: 'done', endedAt: 300 });
    const deps = {
      runStore: { list: () => runs.map(r => Object.assign({}, r)) }, AwayBriefing: require('../sidecar/away-briefing.js'), transcriptStore,
      failNote: () => {}, workshopAgentIds: () => [], workshopStore: { read: () => ({ backlog: [] }) }, validateWorkshopManifest: async () => null,
      workshopBuiltAtOf: () => 0, nightshiftDrafts: [], cronJobs: [], loopJobs: [], currentInitiative: () => 'off', nightFocusState: null,
      overseer: { threads: () => [] }
    };
    const names = Object.keys(deps);
    const awayBriefingInputs = new Function(...names, "'use strict';\n" + src + '\nreturn awayBriefingInputs;')(...names.map(n => deps[n]));
    awayBriefingInputs(0, 1000, 0).then(inputs => {
      A.eq(reads, 3, 'one transcript read per briefed stream (loop-L1, cron-c1, cron-c2), not one per run (was 8)');
      A.eq(inputs.runs.filter(r => r.streamId === 'loop-L1').map(r => r.deliveryText), new Array(6).fill('Fixed the hero section build.'), 'every loop iteration still carries its stream\'s last words');
      A.eq(inputs.runs.find(r => r.runId === 'c1').deliveryText, 'Three unread invoices.', 'a routine carries its own stream\'s words');
      A.ok(!('deliveryText' in inputs.runs.find(r => r.runId === 'c2')), 'a stream with no words leaves the run as it was');
    }).catch(e => A.ok(false, 'awayBriefingInputs threw: ' + (e && e.stack || e))).finally(finish);
  }
} catch (e) {
  A.ok(false, 'test body threw: ' + (e && e.stack || e));
  finish();
}

function finish() {
  if (finished) return;
  finished = true;
  for (const io of opened) { try { if (io && typeof io.close === 'function') io.close(); } catch (_) { /* release only */ } }
  crypto.createHash = realCreateHash;
  fs.rmSync(base, { recursive: true, force: true });
  A.report('transcript-perf-paths.test');
}
