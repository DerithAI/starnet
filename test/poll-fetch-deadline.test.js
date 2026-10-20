/* node test/poll-fetch-deadline.test.js — the two PollGate beats that returned a bare fetch now give it a 15 s deadline
   (idle CPU piece 3 fix round, 2026-10-20).

   world.js pollFeedState (the NO FEED intake nag + BUILD MODE start facts, every 60 s) and windows/loops.js watch() (the
   AUTOMATE badge / NEEDS YOU loop-review notifier, every 25 s) read the sidecar with no signal. One request the sidecar
   accepted and never answered (harness.js: "a socket the sidecar accepted and never answered") held the beat's promise
   open for good. PollGate now abandons such a beat at its own deadline (test/pollgate.test.js); these reads also abort at
   15 s like every other bounded poll (emergency-control, widgets, Harness.api), so an abandoned read never keeps a
   connection slot to the sidecar either.

   GENUINE (executed): world.js's REAL pollFeedState (A.fnBody) and the REAL windows/loops.js run in vm contexts whose
   fetch never answers unless its signal aborts; U.timeoutSignal is the deadline helper they share. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const drain = async () => { for (let n = 0; n < 40; n++) await Promise.resolve(); };

// a station that accepts every read and never answers it — unless the read's signal aborts
function hangingStation() {
  const asked = [], deadlines = [];
  const fetch = (url, opts) => {
    asked.push({ url: String(url), signal: opts && opts.signal });
    return new Promise((_, reject) => {
      const s = opts && opts.signal;
      if (s) s.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'TimeoutError' })));
    });
  };
  const U = { timeoutSignal(ms) { const c = new AbortController(); deadlines.push({ ms, fire: () => c.abort() }); return c.signal; } };
  return { fetch, U, asked, deadlines };
}

(async () => {
  /* ---- world.js pollFeedState ---- */
  {
    const src = A.fnBody(read('frontend/app/world.js'), 'function pollFeedState(');
    A.ok(src.length > 200 && src.length < 6000, 'fixture: pollFeedState sliced from world.js (' + src.length + ' chars)');
    const st = hangingStation();
    const ctx = vm.createContext({ fetch: st.fetch, U: st.U, apiUrl: u => u, Promise, Object, Array,
      feedState: { known: false, fed: false, schedOff: false, offJobs: [] }, startFacts: null, routingNags: null, buildRoutingNags: () => [] });
    vm.runInContext(src + '\nthis.pollFeedState = pollFeedState;', ctx, { filename: 'world.js#pollFeedState' });
    let settled = false;
    const p = ctx.pollFeedState();
    A.ok(p && typeof p.then === 'function', 'pollFeedState returns its read (PollGate awaits it)');
    p.then(() => { settled = true; }, () => { settled = true; });
    await drain();
    A.eq(st.asked.length, 3, 'it asks the station for channels, cron and routing triggers');
    A.ok(st.asked.every(a => a.signal), 'every one of those reads carries a deadline signal (they had none)');
    A.eq(st.deadlines.map(d => d.ms).join(','), '15000,15000,15000', 'each deadline is 15 s, like the other bounded polls');
    A.eq(settled, false, 'fixture: the station never answers');
    st.deadlines.forEach(d => d.fire());
    await drain();
    A.eq(settled, true, 'at the deadline the read gives up and the beat settles (it stayed open for good)');
    A.eq(ctx.feedState.known, false, 'nothing answered: the last known feed truth is kept, never guessed');
  }

  /* ---- windows/loops.js watch() ---- */
  {
    const st = hangingStation();
    const later = [], gated = [];
    const ctx = vm.createContext({
      PollGate: { every(fn, o) { gated.push({ fn, ms: o.ms }); return { stop() {} }; } },
      window: { __STARNET_API_TOKEN__: 'tok' }, console, U: st.U, fetch: st.fetch,
      localStorage: { getItem: () => null, setItem() {} },
      document: { querySelector: () => null, createElement: () => ({}) },
      StationUI: { h: { present: [], sel: 0, esc: s => String(s), sfx() {}, notify() {}, fmtRel: () => '', consoleSection: {} } },
      AutomationWindow: { registerLane() {} },
      setTimeout: (fn, ms) => { later.push({ fn, ms }); return later.length; }, clearTimeout() {},
      setInterval: () => 0, clearInterval() {},
      JSON, Math, Number, Object, Array, Set, Map, String, Promise, Error, isFinite, AbortController
    });
    vm.runInContext(read('frontend/app/windows/loops.js'), ctx, { filename: 'windows/loops.js' });
    const boot = later.find(t => t.ms === 6000);
    A.ok(boot, 'fixture: the watcher arms its first sweep 6 s after boot');
    boot.fn();   // the first sweep, and the 25 s PollGate beat behind it
    await drain();
    const beat = gated.find(g => g.ms === 25000);
    A.ok(beat, 'fixture: the watcher runs through PollGate every 25 s');
    st.asked.length = 0; st.deadlines.length = 0;
    let settled = false;
    const p = beat.fn();   // exactly the promise PollGate awaits
    p.then(() => { settled = true; }, () => { settled = true; });
    await drain();
    const mine = st.asked.filter(a => /\/api\/loops$/.test(a.url));
    A.eq(mine.length, 1, 'the watcher beat reads /api/loops');
    A.ok(mine[0].signal, 'that read carries a deadline signal (it had none)');
    A.eq(st.deadlines.map(d => d.ms).join(','), '15000', 'a 15 s deadline');
    A.eq(settled, false, 'fixture: the station never answers');
    st.deadlines.forEach(d => d.fire());
    await drain();
    A.eq(settled, true, 'at the deadline the beat settles (it stayed open for good); the abort takes the watcher\'s quiet "station offline" path');
  }

  A.report('poll-fetch-deadline.test');
})().catch(e => { console.error(e); process.exit(1); });
