/* node test/output-capture.test.js — a command's full output is captured BOUNDED (head + tail), never unbounded.

   Before: shell.js runCommand and environment.js runProcess both did `fullOut += chunk` with no cap (the
   maxBytes check only guarded the preview `out`). A chatty build or a `cat` of a huge log grew one string until
   V8's max string length (~536M chars), where `+=` throws a RangeError inside the child's 'data' listener: an
   uncaughtException that exits the whole station with every run in flight. Below that, every byte was copied
   again by stripAnsi / parseMarker / redact.

   Laws under test:
     • under the cap the capture is byte-identical to plain concatenation;
     • over the cap it keeps the first quarter and the last three quarters, drops the middle, and NAMES how many
       characters it dropped; it never splits a surrogate pair;
     • both production routes (shell.js runCommand, environment.js runProcess) are bounded, and captureFullOut:false
       still captures nothing;
     • through a REAL shell, the exit-code/cwd marker (printed last) survives the cap, so a huge output still
       reports its real exit code and cwd. */
'use strict';
const A = require('./_assert.js');
const cp = require('child_process');
const { makeFullCapture, DEFAULT_FULL_OUT_MAX } = require('../sidecar/output-capture.js');
const { runCommand, buildMarkedCmd, parseMarker } = require('../sidecar/tools/builtin/shell.js');
const { runProcess } = require('../sidecar/environment.js');

const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;

// A fake child that streams `chunks` then closes with `code`.
function streamingSpawn(chunks, code) {
  const spawn = function () {
    const h = {}, child = { pid: 777, stdout: { on: (ev, fn) => { if (ev === 'data') child._out = fn; } }, stderr: { on() {} },
      on: (ev, fn) => { (h[ev] = h[ev] || []).push(fn); }, kill() {}, unref() {} };
    setImmediate(() => {
      for (const c of chunks) child._out(Buffer.from(c, 'utf8'));
      (h.exit || []).forEach(f => f(code));
      (h.close || []).forEach(f => f(code));
    });
    return child;
  };
  return spawn;
}

(async () => {
  // ---- 1. under the cap: identical to concatenation ----
  {
    const cap = makeFullCapture(1000);
    const parts = ['alpha ', 'beta\n', '', null, 'gamma'];
    for (const p of parts) cap.push(p);
    A.eq(cap.value(), 'alpha beta\ngamma', 'under the cap the value is exactly the concatenation');
    A.eq(cap.elided(), 0, 'nothing elided under the cap');
  }

  // ---- 2. over the cap: head quarter + tail three quarters, the drop is named exactly ----
  {
    const cap = makeFullCapture(100);
    let all = '';
    for (let i = 0; i < 50; i++) { const s = String(i).padStart(3, '0') + '|'; cap.push(s); all += s; }
    cap.push('<<END-MARKER>>'); all += '<<END-MARKER>>';
    const v = cap.value();
    A.eq(cap.elided(), all.length - 100, 'exactly (total - max) characters are dropped');
    A.ok(v.startsWith(all.slice(0, 25)), 'the first quarter is kept verbatim');
    A.ok(v.endsWith(all.slice(-75)), 'the last three quarters are kept verbatim (the marker printed last survives)');
    A.ok(v.includes('characters of output elided here') && v.includes(String(all.length - 100)), 'the elision is named in-band with its size');
  }

  // ---- 3. never splits a surrogate pair at either edge ----
  {
    const emoji = '\u{1F600}';   // 2 UTF-16 units
    for (let max = 8; max <= 40; max++) {
      const cap = makeFullCapture(max);
      for (let i = 0; i < 30; i++) cap.push(emoji + 'a');
      A.ok(!LONE_SURROGATE.test(cap.value()), 'no lone surrogate at max=' + max);
    }
  }

  // ---- 4. a huge stream stays bounded by the default cap ----
  {
    const cap = makeFullCapture();
    const chunk = 'x'.repeat(65536);
    for (let i = 0; i < 640; i++) cap.push(chunk);   // ~42M chars, 5x the cap
    const v = cap.value();
    A.ok(v.length <= DEFAULT_FULL_OUT_MAX + 200, 'the default capture is bounded (' + v.length + ' chars for ' + (640 * 65536) + ' pushed)');
    A.eq(cap.elided(), 640 * 65536 - DEFAULT_FULL_OUT_MAX, 'the default capture names its drop');
  }

  // ---- 5. shell.js runCommand is bounded ----
  {
    const chunks = Array.from({ length: 40 }, (_, i) => 'line-' + i + '-' + 'y'.repeat(100) + '\n');
    const res = await runCommand({ spawn: streamingSpawn(chunks, 0), cmd: 'big', cwd: '.', timeoutMs: 5000, isWin: true, maxBytes: 64, fullOutMax: 1000 });
    A.ok(res.truncated, 'runCommand: the preview is truncated');
    A.ok(res.fullOut.length < 1200 && res.fullOut.length > 900, 'runCommand: fullOut is bounded by fullOutMax (' + res.fullOut.length + ')');
    A.ok(res.fullOut.startsWith('line-0-') && res.fullOut.trimEnd().endsWith('line-39-' + 'y'.repeat(100)), 'runCommand: fullOut keeps the start and the very end');
  }

  // ---- 6. environment.js runProcess is bounded; captureFullOut:false still captures nothing ----
  {
    const chunks = Array.from({ length: 40 }, (_, i) => 'row-' + i + '-' + 'z'.repeat(100) + '\n');
    const res = await runProcess({ spawn: streamingSpawn(chunks, 0), file: 'big', args: null, spawnOptions: {}, timeoutMs: 5000, maxBytes: 64, isWin: true, fullOutMax: 1000 });
    A.ok(res.fullOut.length < 1200 && res.fullOut.length > 900, 'runProcess: fullOut is bounded by fullOutMax (' + res.fullOut.length + ')');
    A.ok(res.fullOut.trimEnd().endsWith('row-39-' + 'z'.repeat(100)), 'runProcess: fullOut keeps the very end');
    const off = await runProcess({ spawn: streamingSpawn(chunks, 0), file: 'big', args: null, spawnOptions: {}, timeoutMs: 5000, maxBytes: 64, isWin: true, captureFullOut: false });
    A.eq(off.fullOut, '', 'captureFullOut:false captures nothing');
  }

  // ---- 7. REAL shell: the exit-code/cwd marker survives a capped huge output ----
  {
    const isWin = process.platform === 'win32';
    const node = JSON.stringify(process.execPath);
    const cmd = node + ' -e "process.stdout.write(\'q\'.repeat(300000)); process.exitCode = 3"';
    const res = await runCommand({ spawn: cp.spawn, cmd: buildMarkedCmd(cmd, isWin), cwd: process.cwd(), timeoutMs: 60000, isWin, maxBytes: 1000, fullOutMax: 20000 });
    const pm = parseMarker(res.fullOut);
    A.ok(res.fullOut.length < 20500, 'real shell: fullOut is capped (' + res.fullOut.length + ' chars of ~300k)');
    A.eq(pm.ec, 3, 'real shell: the real exit code is recovered from the marker past the cap');
    A.ok(!!pm.cwd, 'real shell: the cwd is recovered from the marker past the cap');
  }

  A.report('output-capture.test');
})().catch(e => { console.error(e); process.exit(1); });
