/* STARNET — pollgate.js : the ONE owner of "is anyone looking?" for the browser's background polls.

   IDLE CPU PIECE 3 (2026-10-20, "it eats my PC's resources"). Every module armed its own setInterval / setTimeout chain at
   boot or when a window opened, and only /api/halt, the group list, NEEDS YOU and the apps dock looked at document.hidden.
   Everything else — the 1 s station tick, the overseer ledger (2.5 s), journey (4 s), connectors + spotify (5 s), the rail
   widgets, the loops watcher, the open group chat — kept full cadence while the window was minimized: ~160 /api requests a
   minute with nobody looking, each parsed on the UI thread.

   THE RULE. A poll registered here runs at its own cadence (unchanged) while the page can be seen, and slows to a 30 s floor
   while the Commander is AWAY. It never stops: a loop that stops is a claim nobody can check, and some embedded webviews
   report document.hidden while still on screen (world.js cinecamTick). So AWAY means BOTH: the document says hidden AND
   there has been no input (pointer, key, wheel, focus) for 10 s — input proves the page is on screen whatever `hidden` says.
   Coming back (visible again, window focus, or the first input after being away) runs every loop that is overdue against
   its own live cadence at once, then fires onWake callbacks, so nothing on screen is older than it was before.

   API
     PollGate.away()                         → true while hidden with no input in the last 10 s
     PollGate.every(fn, { ms, awayMs, immediate })
        ms: number | () => number            the visible cadence (a function is read live)
        awayMs: the floor while away (30000)  immediate: run fn now (true) or after the first ms (false)
        → { stop, runNow, lastRunAt(), cadence(), interval() }
        A setTimeout chain that never overlaps: a run that returns a promise is awaited before the next is scheduled; a
        throw or rejection is swallowed and the chain carries on. cadence() is the interval in force when the last run
        started; interval() is the one in force now.
     PollGate.onWake(cb) → unsubscribe      cb runs when the Commander comes back after the gate was away
   Callers fall back to their old timers when PollGate is undefined (single-file node tests load them without it).
   Dependency-free and browser-global, with injection seams for node tests (module.exports). */
'use strict';
const PollGate = (() => {
  const AWAY_MS = 30000;          // the slowest any registered poll runs while nobody is looking
  const INPUT_GRACE_MS = 10000;   // input this recent proves the page is on screen, whatever document.hidden says
  const MIN_MS = 16;              // a misconfigured cadence can never become a busy loop

  let now = () => Date.now();
  let setT = (fn, ms) => setTimeout(fn, ms);
  let clearT = id => clearTimeout(id);
  let doc = typeof document !== 'undefined' ? document : null;
  let lastInputAt = 0;
  let awaySeen = false;           // a due-check (or a caller) saw the gate away since the last wake
  const loops = new Set();
  const wakers = new Set();

  function away() {
    let hidden = false;
    try { hidden = !!(doc && doc.hidden); } catch (_) { hidden = false; }
    const out = hidden && now() - lastInputAt >= INPUT_GRACE_MS;
    if (out) awaySeen = true;
    return out;
  }

  function every(fn, opts) {
    const o = opts || {};
    const msOf = typeof o.ms === 'function' ? o.ms : () => o.ms;
    const awayMs = Number(o.awayMs) > 0 ? Number(o.awayMs) : AWAY_MS;
    const liveMs = () => { let v = 0; try { v = Number(msOf()); } catch (_) { v = 0; } return Math.max(MIN_MS, Number.isFinite(v) ? v : 0); };
    const interval = () => { const ms = liveMs(); return away() ? Math.max(ms, awayMs) : ms; };
    const l = { stopped: false, running: false, timer: 0, lastRunAt: now(), cadence: 0 };
    function schedule() {
      if (l.stopped || l.running) return;
      if (l.timer) clearT(l.timer);
      l.timer = setT(due, Math.max(0, l.lastRunAt + interval() - now()));
    }
    function due() {
      l.timer = 0;
      if (l.stopped || l.running) return;
      const iv = interval();
      if (now() - l.lastRunAt < iv) { schedule(); return; }
      run(iv);
    }
    function settle() { l.running = false; schedule(); }
    function run(iv) {
      if (l.stopped || l.running) return;
      if (l.timer) { clearT(l.timer); l.timer = 0; }
      l.running = true; l.lastRunAt = now(); l.cadence = iv;
      let p = null;
      try { p = fn(); } catch (_) { p = null; }   // one failed beat never ends the chain
      if (p && typeof p.then === 'function') p.then(settle, settle); else settle();
    }
    l.catchUp = () => {
      if (l.stopped || l.running) return;
      if (now() - l.lastRunAt >= liveMs()) run(interval()); else schedule();
    };
    const handle = {
      stop() { l.stopped = true; if (l.timer) { clearT(l.timer); l.timer = 0; } loops.delete(l); },
      runNow() { run(interval()); },
      lastRunAt: () => l.lastRunAt,
      cadence: () => l.cadence || interval(),
      interval
    };
    loops.add(l);
    if (o.immediate === false) schedule(); else run(interval());
    return handle;
  }

  function onWake(cb) {
    if (typeof cb !== 'function') return () => {};
    wakers.add(cb);
    return () => wakers.delete(cb);
  }

  // back after being away: overdue loops run now, then the wake callbacks (each isolated from the others)
  function wake() {
    if (!awaySeen || away()) return;
    awaySeen = false;
    for (const l of Array.from(loops)) { try { l.catchUp(); } catch (_) { /* one loop cannot block the rest */ } }
    for (const cb of Array.from(wakers)) { try { cb(); } catch (_) { /* one consumer cannot block the rest */ } }
  }
  const onInput = () => { lastInputAt = now(); if (awaySeen) wake(); };
  const onVisibility = () => { if (doc && !doc.hidden) wake(); };

  let bound = null;
  function bind(d, w) {
    if (bound) {
      try { if (bound.d) bound.d.removeEventListener('visibilitychange', onVisibility); } catch (_) { /* a fake doc may lack it */ }
      try { if (bound.w) for (const ev of ['focus', 'pointerdown', 'pointermove', 'keydown', 'wheel']) bound.w.removeEventListener(ev, onInput, true); } catch (_) { /* same */ }
    }
    doc = d || null;
    bound = { d: doc, w: w || null };
    if (doc && doc.addEventListener) doc.addEventListener('visibilitychange', onVisibility);
    if (w && w.addEventListener) for (const ev of ['focus', 'pointerdown', 'pointermove', 'keydown', 'wheel']) w.addEventListener(ev, onInput, { passive: true, capture: true });
  }
  if (typeof document !== 'undefined' && typeof window !== 'undefined') bind(document, window);

  return {
    away, every, onWake, AWAY_MS, INPUT_GRACE_MS,
    _setDocForTest(d, w) { bind(d, w); },
    _setClockForTest(fn) { now = fn; },
    _setTimersForTest(setFn, clearFn) { setT = setFn; clearT = clearFn; },
    _resetForTest() {
      for (const l of Array.from(loops)) { l.stopped = true; if (l.timer) clearT(l.timer); }
      loops.clear(); wakers.clear(); lastInputAt = 0; awaySeen = false;
    },
    _debug: () => ({ loops: loops.size, wakers: wakers.size, awaySeen, lastInputAt })
  };
})();

if (typeof module !== 'undefined' && module.exports) module.exports = PollGate;
