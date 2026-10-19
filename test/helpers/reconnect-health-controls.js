/* Reconnect health-probe controls (#116 link-down hang): the production probeReconnect + armReconnectWatch are
   extracted from chat.js and run against fake fetch/abort/timers only. No app, network or provider. */
'use strict';
module.exports = async function verifyReconnectHealth(A, chat) {
  A.ok(chat.includes('let reconnectProbeInFlight = false;'), 'production declares the single-flight guard');
  const source = A.fnBody(chat, 'async function probeReconnect');
  const armSource = A.fnBody(chat, 'function armReconnectWatch');
  A.ok(source.length > 1000 && source.length < 6500 && !source.includes('function armReconnectWatch'), 'bounded probe extraction');
  A.ok(armSource.length > 100 && armSource.length < 1300 && !armSource.includes('function vanish'), 'bounded arm extraction');
  const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
  const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
  function fixture(noAbort = false) {
    let nextTimer = 0, recoverCalls = 0;
    const timers = new Map(), requests = [], signals = [], lines = [], window = {};
    const recovery = deferred();
    class FakeAbortController { constructor() { this.signal = { aborted: false }; signals.push(this.signal); } abort() { this.signal.aborted = true; } }
    const api = new Function('fetch', 'AbortController', 'setTimeout', 'clearTimeout', 'window', 'Harness', 'toolLine', 'recoverSafeRun', `
      const interruptedStreams = new Set(['one']); let activeWs = {id:'one'};
      let reconnectTimer = 0, reconnectProbeInFlight = false, lastDegradedLine = '';
      ${source}\n${armSource}
      return { probe: probeReconnect, arm: armReconnectWatch,
        interrupt: () => { interruptedStreams.add('one'); armReconnectWatch(); },
        clear: () => interruptedStreams.clear(),
        snapshot: () => ({ busy: reconnectProbeInFlight, count: interruptedStreams.size, timer: reconnectTimer, reason: lastDegradedLine }) };
    `)(
      (url, options) => { const d = deferred(); requests.push({ url, options, ...d }); return d.promise; },
      noAbort ? undefined : FakeAbortController,
      (fn, delay) => { const id = ++nextTimer; timers.set(id, { fn, delay }); return id; }, id => timers.delete(id),
      window, { canRestartEngine: () => true }, text => lines.push(text),
      () => { recoverCalls++; return recovery.promise; }
    );
    window.addEventListener = (name, fn) => { window[name] = fn; };
    function fire(delay) {
      const choices = [...timers].filter(([, t]) => t.delay === delay);
      A.eq(choices.length, 1, 'exactly one timer at ' + delay);
      if (choices.length !== 1) throw Error('unexpected timers');
      const [id, t] = choices[0]; timers.delete(id); return t.fn();
    }
    return { api, requests, signals, lines, timers, recovery, window, fire, recoverCalls: () => recoverCalls,
      delays: () => [...timers.values()].map(t => t.delay) };
  }
  {
    // HEADERS NEVER ARRIVE (#116 link-down hang): a stalled sidecar holds /api/health open. The probe must give up
    // on its own budget and leave the next poll armed; before the deadline the one probe awaited forever, nothing
    // re-armed, and COMMS sat on reconnecting until a reload. Checked without awaiting first, so a hang FAILS here.
    const f = fixture();
    f.api.arm();
    const first = f.fire(2000); await flush();
    A.eq(f.delays(), [4000], 'headers never arrive: the probe arms its own 4 s deadline');
    if (f.delays().length === 1 && f.delays()[0] === 4000) {
      for (let round = 0; round < 2; round++) {
        const running = round ? f.fire(3000) : first;
        if (round) { await flush(); A.eq(f.delays(), [4000], 'headers never arrive: retry ' + round + ' arms a fresh deadline'); }
        f.fire(4000); await running;
        A.eq(f.delays(), [3000], 'headers never arrive: the poll re-arms on its 3 s cadence (round ' + round + ')');
        A.eq(f.signals[round].aborted, true, 'headers never arrive: the stalled request is aborted (round ' + round + ')');
        A.eq(f.api.snapshot().busy, false, 'headers never arrive: the single-flight guard is released (round ' + round + ')');
      }
      A.eq(f.requests.length, 2, 'headers never arrive: one request per poll, none piled up');
      A.eq(f.lines, [], 'headers never arrive: a timeout claims neither health nor a degraded reason');
      A.eq(f.recoverCalls(), 0, 'headers never arrive: a timeout never starts recovery');
    }
  }
  for (const mode of ['headers-late-ok', 'headers-late-503', 'body-late-503', 'no-abort']) {
    const f = fixture(mode === 'no-abort');
    f.api.arm(); f.api.arm();
    A.eq(f.delays(), [2000], mode + ': original initial delay, single arm');
    const running = f.fire(2000);
    A.eq(f.requests.length, 1, mode + ': one request');
    A.eq(f.requests[0].url, '/api/health', mode + ': same health endpoint');
    A.eq(f.requests[0].options.cache, 'no-store', mode + ': no cached health');
    await f.api.probe(); f.api.arm(); f.window.online();
    A.eq(f.requests.length, 1, mode + ': direct/arm/online cannot overlap pending probe');
    A.eq(f.delays(), [4000], mode + ': one whole-request budget');
    let cancelCalls = 0, textCalls = 0;
    const body = deferred();
    const response = { ok: mode === 'headers-late-ok', status: mode === 'headers-late-ok' ? 200 : 503,
      text() { textCalls++; return body.promise; }, body: { cancel() { cancelCalls++; return Promise.reject(Error('locked or cancelled')); } } };
    if (mode === 'body-late-503') { f.requests[0].resolve(response); await flush(); A.eq(textCalls, 1, '503 body read pending'); }
    f.fire(4000); await running;
    A.eq(f.delays(), [3000], mode + ': exactly one original-cadence retry after timeout');
    A.eq(f.lines, [], mode + ': timeout does not invent health/degraded output');
    A.eq(f.recoverCalls(), 0, mode + ': timeout cannot begin recovery');
    A.eq(f.api.snapshot().busy, false, mode + ': logical probe released');
    if (mode !== 'no-abort') A.eq(f.signals[0].aborted, true, mode + ': underlying request abort requested');
    const retryBeforeLate = mode === 'headers-late-ok' ? f.fire(3000) : null;
    if (mode !== 'body-late-503') f.requests[0].resolve(response);
    await flush(); body.resolve('degraded: too late'); await flush();
    A.eq(cancelCalls, 1, mode + ': timed-out response body cancellation attempted once');
    A.eq(f.lines, [], mode + ': late headers/body produce no stale notice');
    A.eq(f.recoverCalls(), 0, mode + ': late OK cannot start recovery');
    A.eq(f.delays(), retryBeforeLate ? [4000] : [3000], mode + ': late settlement cannot alter newer deadline or retry');
    A.eq(f.api.snapshot().busy, !!retryBeforeLate, mode + ': late answer cannot alter current guard');
    const retry = retryBeforeLate || f.fire(3000);
    A.eq(f.requests.length, 2, mode + ': retry starts one new logical probe');
    f.requests[1].resolve({ ok: true, status: 200 }); await flush();
    A.eq(f.recoverCalls(), 1, mode + ': eventual timely success reaches recovery once');
    f.recovery.resolve('none'); await retry;
    A.eq(f.delays(), [], mode + ': success clears watchdog and does not rearm');
    A.eq(f.lines, ['connection restored — no safe automatic continuation was available; use Try again.'], mode + ': original truthful fallback wording');
  }
  {
    const f = fixture();
    for (let i = 0; i < 2; i++) {
      const run = i ? f.fire(3000) : f.api.probe();
      f.requests[i].resolve({ ok: false, status: 503, text: async () => 'degraded: owner hold' }); await run;
      A.eq(f.delays(), [3000], 'degraded probe rearms once');
    }
    A.eq(f.lines, ['station service degraded: owner hold — restart it from LINK DOWN at the top.'], 'same degraded reason announced once');
    A.eq(f.recoverCalls(), 0, 'degraded never healthy');
    const run = f.fire(3000); f.requests[2].resolve({ ok: true, status: 200 }); await flush();
    f.api.interrupt(); // arrives while successful health awaits continuation preparation
    A.eq(f.delays(), [2000], 'new interruption keeps its initial cadence even while recovery is pending');
    const newerProbe = f.fire(2000);
    A.eq(f.requests.length, 4, 'new health probe starts without waiting for old recovery');
    A.eq(f.api.snapshot().busy, true, 'new health owns the single-flight guard');
    f.recovery.resolve('started'); await run;
    A.eq(f.api.snapshot().busy, true, 'settling old recovery cannot release newer health guard');
    A.eq(f.delays(), [4000], 'settling old recovery cannot change newer health deadline');
    await f.api.probe(); f.api.arm(); f.window.online();
    A.eq(f.requests.length, 4, 'newer pending health still excludes duplicate probes');
    f.requests[3].resolve({ ok: false, status: 500 }); await newerProbe;
    A.eq(f.api.snapshot().reason, '', 'timely health resets degraded once-guard');
    A.eq(f.delays(), [3000], 'new failed health owns exactly one retry');
  }
  for (const response of [null, { ok: false, status: 500 }, { ok: false, status: 503, text: async () => 'not a degraded reason' }]) {
    const f = fixture(), run = f.api.probe(); f.requests[0].resolve(response); await run;
    A.eq(f.recoverCalls(), 0, 'non-OK health cannot become healthy');
    A.eq(f.lines, [], 'unclassified failure creates no invented degraded reason');
    A.eq(f.delays(), [3000], 'non-OK retries once');
  }
  {
    const f = fixture(), run = f.api.probe();
    f.requests[0].resolve({ ok: false, status: 503, text: async () => { throw Error('body failed'); } }); await run;
    A.eq(f.delays(), [3000], '503 body rejection clears deadline and rearms once');
    A.eq(f.lines, [], 'failed body does not invent degraded details');
    A.eq(f.recoverCalls(), 0, 'failed body is not healthy');
  }
  {
    const f = fixture(), run = f.api.probe(); f.requests[0].reject(Error('offline')); await run;
    A.eq(f.delays(), [3000], 'fetch rejection clears deadline and retries once');
    f.api.clear(); await f.fire(3000);
    A.eq(f.requests.length, 1, 'cleared interruption needs no further fetch');
    A.eq(f.delays(), [], 'no retry without interrupted streams');
  }
};
