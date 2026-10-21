/* node test/shellbg-spill-batched.test.js — a background process's durable log costs one fsync per BATCH, not per chunk,
   and the log is capped; every receipt that says "durably appended" still describes fsynced, read-back-verified bytes.

   The bug (perf review 10-19, shellbg.js:255): each stdout/stderr chunk of a background process ran
   output-artifacts.append() — mkdir, stat, open, write, FSYNC, stat, open, read-back — about 21-54 ms of synchronous
   I/O on the sidecar's only thread. A chatty dev server saturated the loop near 48 chunks/s, and the spill file had
   no cap at all.

   Proves with the REAL output-artifacts store (temp dir) wired exactly as index.js wires it (spill + spillWriter) and
   the REAL shell.bg.status / shell.bg.read tools, over a fake child:
     (1) 200 chunks cost at most a couple of fsyncs (was 200), and every byte is on disk at the path immediately;
     (2) status commits before it answers: outputSpillVerified + the exact byte count, and the receipt text is the
         same "[full output: N bytes durably appended to …]" line;
     (3) read() commits too; a quiet stream is committed by the timer with no view at all;
     (4) the log stops at maxSpillBytes and the receipt says so instead of claiming the full output was saved;
     (5) a failed commit (read-back mismatch) is reported, never verified, and rolls the file back to the last
         committed boundary;
     (6) a closed process commits its last batch and its writer bookkeeping is released. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { makeShellBg } = require('../sidecar/shellbg.js');
const { makeOutputArtifacts } = require('../sidecar/output-artifacts.js');
const { makeShellTool } = require('../sidecar/tools/builtin/shell.js');

function makeFakeSpawn() {
  const spawn = function (cmd, opts) {
    let dataCb = null, closeCb = null;
    const child = {
      cmd, opts, pid: 4000 + spawn.children.length, unrefed: false,
      stdout: { on: (ev, fn) => { if (ev === 'data') dataCb = fn; } },
      stderr: { on: () => {} },
      on: (ev, fn) => { if (ev === 'close') closeCb = fn; },
      unref() { this.unrefed = true; },
      _emit: (s) => { if (dataCb) dataCb(Buffer.from(String(s))); },
      _close: (code) => { if (closeCb) closeCb(code); }
    };
    spawn.children.push(child);
    return child;
  };
  spawn.children = [];
  return spawn;
}
// the real fs, with fsyncSync counted (and readSync optionally corrupted)
function countingFs() {
  const c = { fsyncs: 0, corruptRead: false };
  c.fs = new Proxy(fs, { get(target, prop) {
    if (prop === 'fsyncSync') return function (fd) { c.fsyncs++; return target.fsyncSync(fd); };
    if (prop === 'readSync') return function (fd, buf, off, len, pos) {
      const n = target.readSync(fd, buf, off, len, pos);
      if (c.corruptRead && n > 0) buf[off] = buf[off] ^ 0xff;
      return n;
    };
    const v = target[prop]; return typeof v === 'function' ? v.bind(target) : v;
  } });
  return c;
}
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
let T = 1000; const clock = { now: () => T };

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-bg-spill-'));
  try {
    const c = countingFs();
    const artifacts = makeOutputArtifacts({ fsp, fs: c.fs, pathMod: path, root, crypto });
    const spawn = makeFakeSpawn();
    // wired exactly like index.js: the per-chunk verified append AND the streaming writer
    const bg = makeShellBg({ spawn, clock, isWin: true, spill: e => artifacts.append(e), spillWriter: artifacts, spillCommitMs: 60 });
    const tools = makeShellTool({ spawn, fs, pathMod: path, root, clock, bg, platform: 'win32' });
    const ctx = { agentId: 'a1' };

    // ---- (1) 200 chunks ----
    A.ok(bg.start({ agentId: 'a1', cmd: 'npm run dev', cwd: root }).ok, 'started');
    const child = spawn.children[0];
    let want = '';
    const before = c.fsyncs;
    for (let i = 0; i < 200; i++) { const line = 'compiled module ' + i + ' of 200 in 12ms λ\n'; want += line; child._emit(line); }
    const chunkFsyncs = c.fsyncs - before;
    A.ok(chunkFsyncs <= 2, '200 output chunks cost ' + chunkFsyncs + ' fsync(s) (was one per chunk = 200)');
    const file = path.join(root, 'a1', '.output', 'shell-bg-bg_1.txt');
    A.eq(fs.readFileSync(file, 'utf8'), want, 'every chunk is written through to the log at once (readable + crash-safe before any commit)');

    // ---- (2) status commits, then answers ----
    const st = bg.status('a1', 'bg_1');
    A.eq(st.outputSpillVerified, true, 'status reports a verified spill');
    A.eq(st.outputBytes, Buffer.byteLength(want), 'status reports the exact committed byte count');
    A.eq(st.outputPath, '.output/shell-bg-bg_1.txt', 'status names the recoverable log path');
    const receipt = await tools.bgStatusTool.run({ id: 'bg_1' }, ctx);
    A.ok(receipt.content.indexOf('\n[full output: ' + Buffer.byteLength(want) + ' bytes durably appended to .output/shell-bg-bg_1.txt]') >= 0, 'the status receipt keeps its exact wording');

    // ---- (3) read commits; the timer commits a quiet stream ----
    child._emit('one more line\n'); want += 'one more line\n';
    const f0 = c.fsyncs;
    const page = bg.read('a1', 'bg_1', { offset: -1 });
    A.eq(c.fsyncs - f0, 1, 'read() committed the staged chunk (one fsync)');
    A.eq(page.outputBytes, Buffer.byteLength(want), 'read reports the committed total');
    A.eq(page.outputSpillVerified, true, 'read reports a verified spill');
    child._emit('quiet tail\n'); want += 'quiet tail\n';
    const f1 = c.fsyncs;
    await sleep(200);
    A.eq(c.fsyncs - f1, 1, 'with no view at all, the commit timer made the quiet chunk durable');
    A.eq(bg.status('a1', 'bg_1').outputBytes, Buffer.byteLength(want), 'and the next status needed no further commit');

    // ---- (6) close commits the last batch and releases the writer bookkeeping ----
    child._emit('bye\n'); want += 'bye\n';
    const f2 = c.fsyncs;
    child._close(0);
    A.eq(c.fsyncs - f2, 1, 'close committed the last batch');
    A.eq(fs.readFileSync(file, 'utf8'), want, 'the log holds every byte in order');
    A.eq(artifacts._internals.spools.size, 0, 'the closed stream released its writer bookkeeping');
    A.eq(bg.status('a1', 'bg_1').outputSpillVerified, true, 'a finished process still reports its verified log');

    // ---- (4) the cap ----
    const capSpawn = makeFakeSpawn();
    const capBg = makeShellBg({ spawn: capSpawn, clock, isWin: true, spill: e => artifacts.append(e), spillWriter: artifacts, maxSpillBytes: 1000 });
    capBg.start({ agentId: 'a3', cmd: 'yes', cwd: root });
    const line = 'y'.repeat(99) + '\n';
    for (let i = 0; i < 25; i++) capSpawn.children[0]._emit(line);
    const cs = capBg.status('a3', 'bg_1');
    const capFile = path.join(root, 'a3', '.output', 'shell-bg-bg_1.txt');
    A.eq(fs.statSync(capFile).size, 1000, 'the log stopped growing at the cap (10 whole 100-byte chunks fit in 1000)');
    A.eq(cs.outputSpillVerified, false, 'a capped log is not reported as the full output');
    A.ok(/1000-byte cap/.test(String(cs.outputSpillError)) && /memory ring/.test(String(cs.outputSpillError)), 'the receipt says the log hit its cap and where the rest lives');
    A.ok(cs.tail.indexOf('y'.repeat(20)) >= 0, 'output past the cap still reaches the memory ring');
    const capReceipt = await makeShellTool({ spawn: capSpawn, fs, pathMod: path, root, clock, bg: capBg, platform: 'win32' }).bgStatusTool.run({ id: 'bg_1' }, { agentId: 'a3' });
    A.ok(/\[full-output spill failed: the durable log stopped at its 1000-byte cap/.test(capReceipt.content), 'the status receipt names the cap');

    // ---- (5) a failed commit ----
    const failSpawn = makeFakeSpawn();
    const failBg = makeShellBg({ spawn: failSpawn, clock, isWin: true, spill: e => artifacts.append(e), spillWriter: artifacts });
    failBg.start({ agentId: 'a2', cmd: 'node server.js', cwd: root });
    failSpawn.children[0]._emit('first\n');
    A.eq(failBg.status('a2', 'bg_1').outputSpillVerified, true, 'first batch verified');
    const failFile = path.join(root, 'a2', '.output', 'shell-bg-bg_1.txt');
    failSpawn.children[0]._emit('second\n');
    c.corruptRead = true;
    const fv = failBg.status('a2', 'bg_1');
    c.corruptRead = false;
    A.eq(fv.outputSpillVerified, false, 'a read-back mismatch is never reported as verified');
    A.ok(/read-back mismatch/.test(String(fv.outputSpillError)), 'the receipt names the failure');
    A.eq(fs.readFileSync(failFile, 'utf8'), 'first\n', 'the log rolled back to the last committed boundary');
    failSpawn.children[0]._emit('third\n');
    const rv = failBg.status('a2', 'bg_1');
    A.eq(rv.outputSpillVerified, true, 'the next verified batch reports verified again (append() semantics)');
    A.eq(fs.readFileSync(failFile, 'utf8'), 'first\nthird\n', 'and lands after the committed boundary');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
  A.report('shellbg-spill-batched.test');
})().catch(e => { console.error(e); process.exit(1); });
