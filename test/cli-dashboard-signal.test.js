'use strict';
/* test/cli-dashboard-signal.test.js — the `starnet` dashboard gives the terminal back when it is told to stop.

   The dashboard takes the terminal over: the alternate screen, a hidden cursor, bracketed paste and mouse reporting.
   It used to undo that only on process 'exit', which a SIGTERM (the desktop app's boot reaper on macOS, a `kill`, an
   update) or a SIGHUP never reaches — node just dies, and the terminal is left on a blank screen where every click types
   escape garbage until `reset`. Now SIGTERM / SIGHUP restore the terminal, then the dashboard ends with the signal's
   conventional exit code (128 + its number). This drives the REAL runDashboard with in-memory terminal streams and a
   station that never answers (the screen is up, the roster still loading), then sends the signal as an event. */
const os = require('os');
const { PassThrough } = require('stream');
const A = require('./_assert.js');
const { runDashboard } = require('../bin/lib/dashboard.js');
const mouse = require('../bin/lib/mouse.js');

function fakeTerminal() {
  const out = new PassThrough();
  out.isTTY = true; out.columns = 100; out.rows = 30;
  let text = '';
  out.on('data', d => { text += d; });
  const inp = new PassThrough();
  inp.isTTY = true;
  return { out, inp, text: () => text };
}
const never = () => new Promise(() => {});   // a station that never answers: the dashboard sits with its screen up
const station = { mode: 'attached', workspace: '', child: null, client: { base: 'http://127.0.0.1:1', host: '127.0.0.1', port: 1, request: never, token: () => 't' } };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  for (const sig of ['SIGTERM', 'SIGHUP']) {
    const t = fakeTerminal();
    const before = process.listenerCount(sig);
    const exited = runDashboard(station, { stdout: t.out, stdin: t.inp, env: { STARNET_LOGO: 'plain', NO_COLOR: '1' } });
    await sleep(150);
    A.ok(t.text().indexOf('\x1b[?1049h') >= 0 && t.text().indexOf(mouse.ENABLE) >= 0, sig + ': the dashboard took the screen (alternate screen, mouse reporting)');
    A.ok(process.listenerCount(sig) > before, sig + ': the dashboard listens for ' + sig + ' while its screen is up');
    const at = t.text().length;
    process.emit(sig, sig);
    const code = await Promise.race([exited, sleep(2000).then(() => 'still running')]);
    const after = t.text().slice(at);
    A.eq(code, 128 + os.constants.signals[sig], sig + ': the dashboard ends with the signal\'s exit code');
    A.ok(after.indexOf('\x1b[?1049l') >= 0, sig + ': the alternate screen is left');
    A.ok(after.indexOf(mouse.DISABLE) >= 0, sig + ': mouse reporting is off');
    A.ok(after.indexOf('\x1b[?2004l') >= 0, sig + ': bracketed paste is off');
    A.ok(after.indexOf('\x1b[?25h') >= 0, sig + ': the cursor is back');
    A.eq(process.listenerCount(sig), before, sig + ': the listener is gone once the dashboard has stopped');
  }
  A.report('cli-dashboard-signal.test');
  setTimeout(() => process.exit(process.exitCode || 0), 50).unref();
})().catch(e => { console.error(e); process.exit(1); });
