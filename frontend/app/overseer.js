'use strict';

// Reuse existing sessions and transcript reconciliation; never change chat focus.
const Overseer = (() => {
  let busy = false, lastDeliveries = '', last = null;   // last = the latest /api/overseer answer (Delegated reads it)
  // whether that answer is still CURRENT: the latest poll failed (sidecar down), this ask is slow or past its deadline, or
  // the ledger is too old (below), and it can no longer vouch for a worker still running. snapshot() stays readable for
  // finished and failed rows; anything that says "working" must read fresh() first: the rail's crew lamp and the
  // delegation card's stateOf (delegated.js) both do, so neither ticks a running row through an outage (app-shell-ui-05)
  const BEAT = 2500;
  let okAt = 0, okAtWall = 0, failing = false;
  /* THE BEAT RUNS THROUGH POLLGATE (idle CPU piece 3, 2026-10-20): 2.5 s while the station can be seen, a 30 s floor while
     the Commander is away, and a catch-up read the moment they are back.
     WHAT THE RAIL MAY SAY (fix round 3, 2026-10-20) — two questions, each answered only from what the page has SEEN:
       · unreachable(): the station is not answering. The latest read failed, or THIS ask ran past its deadline (ASK_MS,
         the abort below) — nothing else; a clock read on its own never proves it. A reader running right after the page's
         own event loop was busy (a long task) found "this ask is 5 s old" while the station's answer sat queued behind
         that very reader, and the rail said "station unreachable" though the station had answered. The deadline is a timer
         the page has to live through, so an answer queued ahead of it lands first; and a deadline the page saw LATE (its
         timer fired more than LATE_FIRE_MS after it was due: the page was held up, or asleep, not the station) gives the
         ask one more beat before it is called hung.
       · BOTH VERDICTS ARE TIMERS THE PAGE MUST LIVE THROUGH ON TIME (fix round 4): slow at two beats and the deadline at
         ASK_MS. Either one seen late, or one that finds the station's answer already in (its headers: only the body is
         still being read, on a task of its own), gives the ask one more beat, once. Round 3 graced only the deadline: a
         page stalled past the 5 s mark ran the slow timer ahead of an answer queued behind that stall, and a reader in
         between said "checking the station"; a late deadline that found the body still being read aborted it, and the rail
         said "station unreachable" for an answer the station had given in time.
       · fresh(): the last ledger can still vouch for a worker at work. Not when unreachable; not once THIS ask has been
         out two beats by the page's own timer (slow: the station is sitting on it — 7.5 s from an on-time answer, as
         before); and not when the ledger is older than three of the cadence that produced it plus LATE_GRACE. The grace
         is the page's own late beat (a busy event loop, a throttled timer): the station answered every ask it was given,
         so a ledger a stall left 10 s old is still its latest word and the rail never flips to unknown and back over it.
         A ledger older than that (a sleep, a frozen page) is never current — an ask in flight or not — until the catch-up
         read answers; the rail then says it is checking, never that the station is unreachable.
     AN AWAY STRETCH IS NOT STALENESS (fix round 2): an answer PollGate went away after (PollGate.lastAwayAt() >= okAt) is
     measured against the 30 s floor that was due to replace it, so it stays current through the catch-up read on return.
     Every age is measured on the monotonic clock (performance.now when present), so a backward wall-clock step can never
     make an old ledger current. Where performance.now stands still while the machine sleeps — macOS and Linux (WKWebView,
     WebKitGTK: the OS monotonic clocks under them stop in a sleep) — the age is the LONGER of it and the wall clock, so a
     pre-sleep ledger is never current after the sleep. On Windows (WebView2: QueryPerformanceCounter) performance.now
     counts the sleep itself, and the wall clock is not read (fix round 4): there it only let a forward wall step (a
     w32time correction, the Commander setting the clock) make a ledger 0.1 s old read stale, and the rail said "checking
     the station" though the station had answered every ask. Nothing here displays these times. */
  const ASK_MS = 8000;          // an ask's deadline: past it the read is aborted and the station is not answering
  const LATE_GRACE = 15000;     // how long past its window a ledger the page's own late beat left old stays current
  const LATE_FIRE_MS = 1000;    // a deadline timer this late was held up by the page (busy, asleep), not by the station
  let loop = null, okCadence = BEAT, askCadence = BEAT;
  let asking = false, slow = false, expired = false;   // an ask is out · it has been out two beats · it ran past its deadline
  const mono = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? () => performance.now() : () => Date.now();
  const gateCadence = () => { try { return loop ? loop.interval() : BEAT; } catch (_) { return BEAT; } };
  const monoCountsSleep = (() => {
    try {
      const n = typeof navigator !== 'undefined' && navigator ? navigator : {};
      return /\bWin(dows|32|64)\b/.test(String(n.userAgent || '') + ' ' + String(n.platform || '') + ' ' + String((n.userAgentData && n.userAgentData.platform) || ''));
    } catch (_) { return false; }   // unknown: read the wall clock too (a stale ledger is the safe side)
  })();
  const ageOf = (at, atWall) => (monoCountsSleep ? mono() - at : Math.max(mono() - at, Math.max(0, Date.now() - atWall)));
  // the gate went away after this answer landed: its replacement was due on the away floor, not the visible beat
  const awayCover = () => (typeof PollGate !== 'undefined' && PollGate.lastAwayAt && PollGate.lastAwayAt() >= okAt) ? (PollGate.AWAY_MS || 30000) : 0;
  const fresh = () => !!last && !failing && !(asking && (slow || expired))
    && ageOf(okAt, okAtWall) <= 3 * Math.max(BEAT, okCadence, awayCover()) + LATE_GRACE;
  // Readable BEFORE the first answer, when snapshot() is still null: the delegation card says "checking…" while that first
  // read is on its way and "station unreachable" once it failed or ran past its deadline — never a worker state the ledger
  // has not given (delegated.js ledgerRead)
  const unreachable = () => failing || (asking && expired);
  async function refresh() {
    if (busy || typeof Workstreams === 'undefined' || !Workstreams.generalId()) return;
    busy = true; asking = true; slow = false; expired = false; askCadence = gateCadence();
    const controller = new AbortController();
    let responded = false;   // the station's answer is in (its headers): any wait from here on is the page's own
    // a verdict against the station, drawn only by a timer the page lived through on time with no answer in; seen late
    // (more than LATE_FIRE_MS past due) or with the answer in, it gives the ask one more beat — once
    const verdict = (ms, act) => {
      let graced = false, id = 0;
      const arm = wait => {
        const due = mono() + wait;
        id = setTimeout(() => {
          if (!asking) return;
          if (!graced && (responded || mono() - due > LATE_FIRE_MS)) { graced = true; arm(BEAT); return; }
          act();
        }, wait);
      };
      arm(ms);
      return () => clearTimeout(id);
    };
    const endSlow = verdict(2 * BEAT, () => { slow = true; });
    const endDeadline = verdict(ASK_MS, () => { expired = true; controller.abort(); });
    let data = null;
    try {
      const response = await fetch('/api/overseer', { signal: controller.signal });
      responded = true;
      if (!response.ok) throw new Error('Delegation synchronization unavailable');
      data = await response.json();
      if (!data || typeof data !== 'object') throw new Error('Delegation synchronization answered no ledger');
    } catch (error) {
      // Existing connection UI owns outages. Retry reconciliation after recovery.
      lastDeliveries = ''; reconcileAgain = true;
      failing = true;
      if (typeof Delegated !== 'undefined' && Delegated.repaint) Delegated.repaint();   // at once, so a row that reads fresh() drops its live claim
      console.debug('[overseer sync]', error.message);
      return;
    } finally { endSlow(); endDeadline(); busy = false; asking = false; }
    /* THE STATION ANSWERED (fix round 4). Only the read above — a failed fetch, a refused or empty answer — says it is
       not answering. What follows is the page's own work on the answer: adopting thread metadata, saving, repainting,
       starting a delivery reconcile. It sat inside the read's try, so a throw there set failing and the rail said
       "station unreachable" though /api/overseer had answered; now it is logged as before and the ledger stays current. */
    last = data; okAt = mono(); okAtWall = Date.now(); okCadence = askCadence; failing = false;
    try {
      let adopted = false;
      for (const row of data.threads || []) {
        if (!row.parentStreamId || !Workstreams.get(row.parentStreamId)) continue;
        const local = Workstreams.get(row.id);
        const before = local && [local.parentStreamId, local.worker, local.projectRoot];
        // Reconciliation may have filed the result first. The store adopts its missing thread
        // metadata and invalidates delegated participation before CREW or search reads it.
        const adoptedRow = Workstreams.adopt(row);
        if (adoptedRow && (!before || before[0] !== adoptedRow.parentStreamId || before[1] !== adoptedRow.worker || before[2] !== adoptedRow.projectRoot)) adopted = true;
      }
      if (adopted) { App.persist(); App.refreshRail(); }
      if (typeof Delegated !== 'undefined' && Delegated.repaint) Delegated.repaint();   // the parent's DELEGATED card follows the ledger
      const deliveries = JSON.stringify([(data.workers || []).map(w => [w.runId, w.status]),
        (data.reviews || []).map(r => [r.reviewRunId, r.status])]);
      if ((adopted || deliveries !== lastDeliveries) && typeof StationCommands !== 'undefined') reconcileDeliveries(deliveries, adopted);
    } catch (error) {
      lastDeliveries = '';   // retry the reconcile on the next answer, as before
      console.debug('[overseer sync] applying the answer', error.message);
    }
  }
  /* A DELIVERY RECONCILE NEVER HOLDS THE LEDGER BEAT (fix round 4). The beat awaited StationCommands.reconcile() — a
     /api/runs read of its own — while it held `busy`: one the sidecar accepted and never answered held every later beat
     off (each returned on busy), /api/overseer was never asked again, and the rail said "checking the station" for good
     with nothing being checked. It runs beside the beat now, one at a time. Once it is over, lastDeliveries is the ledger
     it ran for, so the next answer compares against that, as when the beat waited for it; an adoption or a failed read
     while it ran (reconnect reconciles) forces another on the next answer. */
  let reconcileOut = false, reconcileAgain = false;
  function reconcileDeliveries(deliveries, adopted) {
    if (reconcileOut) { if (adopted) reconcileAgain = true; return; }
    reconcileOut = true; reconcileAgain = false;
    let pass;
    try { pass = Promise.resolve(StationCommands.reconcile()); } catch (error) { pass = Promise.reject(error); }
    pass.then(() => true, error => { console.debug('[overseer reconcile]', error && error.message); return false; })
      .then(done => { reconcileOut = false; lastDeliveries = done && !reconcileAgain ? deliveries : ''; });
  }
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    if (typeof PollGate !== 'undefined' && PollGate.every) loop = PollGate.every(refresh, { ms: BEAT });
    else { refresh(); setInterval(refresh, BEAT); }
  });
  return { refresh, snapshot: () => last, fresh, unreachable };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Overseer;
