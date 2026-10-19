/* Checkpoint Git commands share the foreground process supervisor: timeout/abort must stop the whole
   owned tree before another checkpoint starts. execFile's timeout only killed git, leaving pack-objects.
   Capture streams separately because rev-parse/log parse stdout as data, never diagnostic stderr. */
'use strict';
const { runProcess } = require('./environment.js');
const { StringDecoder } = require('node:string_decoder');
function makeCheckpointGitRunner(deps) {
  const d = deps || {};
  return async function runGitCheckpoint(args, opts) {
    let stdout = '', stderr = '';
    // A per-call bound wins over the runner default: shadow-repo maintenance (gc, the re-init add/commit) needs
    // longer than a snapshot's add. Ignoring it killed every gc at the default and left its tmp_pack behind (#107).
    const perCall = Number(opts && opts.timeoutMs);
    const timeoutMs = perCall > 0 && isFinite(perCall) ? perCall : (d.timeoutMs || 15000);
    const maxBytes = d.maxBytes || (8 << 20);
    const controller = new AbortController();
    let outBytes = 0, errBytes = 0, overflow = false;
    const externalSignal = opts && opts.signal;
    const abort = () => controller.abort();
    if (externalSignal) {
      if (externalSignal.aborted) abort();
      else externalSignal.addEventListener('abort', abort, { once: true });
    }
    const decOut = new StringDecoder('utf8'), decErr = new StringDecoder('utf8');
    const appendOut = data => { outBytes += Buffer.byteLength(data); stdout = (stdout + (typeof data === 'string' ? data : decOut.write(data))).slice(0, maxBytes); if (outBytes > maxBytes) { overflow = true; abort(); } };
    const appendErr = data => { errBytes += Buffer.byteLength(data); stderr = (stderr + (typeof data === 'string' ? data : decErr.write(data))).slice(0, maxBytes); if (errBytes > maxBytes) { overflow = true; abort(); } };
    const spawn = function (file, argv, options) {
      const child = d.spawn(file, argv, options);
      if (file === (d.file || 'git')) {
        if (child.stdout) child.stdout.on('data', appendOut);
        if (child.stderr) child.stderr.on('data', appendErr);
      }
      return child;
    };
    try {
      const result = await runProcess({ spawn, file: d.file || 'git', args, timeoutMs,
        maxBytes, captureFullOut: false, clock: d.clock, ledger: d.ledger, ledgerCmd: d.file || 'git',
        signal: controller.signal,
        spawnOptions: { cwd: opts && opts.cwd || d.cwd, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] } });
      stdout = (stdout + decOut.end()).slice(0, maxBytes);
      stderr = (stderr + decErr.end()).slice(0, maxBytes);
      if (result.timedOut) stderr += '\ncheckpoint Git process tree timed out';
      if (overflow) stderr += '\ncheckpoint Git output limit exceeded';
      else if (result.aborted) stderr += '\ncheckpoint Git process tree aborted';
      return { code: overflow ? -1 : result.exitCode, stdout, stderr, truncated: overflow, timedOut: result.timedOut, aborted: result.aborted };
    } catch (e) { return { code: 1, stdout, stderr: stderr + String(e && e.message || e) }; }
    finally { if (externalSignal) externalSignal.removeEventListener('abort', abort); }
  };
}
module.exports = { makeCheckpointGitRunner };
