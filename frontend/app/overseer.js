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
       · fresh(): the last ledger can still vouch for a worker at work. Not when unreachable; not once THIS ask has been
         out two beats by the page's own timer (slow: the station is sitting on it — 7.5 s from an on-time answer, as
         before); and not when the ledger is older than three of the cadence that produced it plus LATE_GRACE. The grace
         is the page's own late beat (a busy event loop, a throttled timer): the station answered every ask it was given,
         so a ledger a stall left 10 s old is still its latest word and the rail never flips to unknown and back over it.
         A ledger older than that (a sleep, a frozen page) is never current — an ask in flight or not — until the catch-up
         read answers; the rail then says it is checking, never that the station is unreachable.
     AN AWAY STRETCH IS NOT STALENESS (fix round 2): an answer PollGate went away after (PollGate.lastAwayAt() >= okAt) is
     measured against the 30 s floor that was due to replace it, so it stays current through the catch-up read on return.
     Every age is the LONGER of two clocks: the monotonic one (performance.now when present), so a backward wall-clock step
     can never make an old ledger current; and the wall clock, because WebKit's performance.now (macOS WKWebView, Linux
     WebKitGTK) stands still while the machine sleeps. Windows' WebView2 counts the sleep on both. Nothing here displays
     these times. */
  const ASK_MS = 8000;          // an ask's deadline: past it the read is aborted and the station is not answering
  const LATE_GRACE = 15000;     // how long past its window a ledger the page's own late beat left old stays current
  const LATE_FIRE_MS = 1000;    // a deadline timer this late was held up by the page (busy, asleep), not by the station
  let loop = null, okCadence = BEAT, askCadence = BEAT;
  let asking = false, slow = false, expired = false;   // an ask is out · it has been out two beats · it ran past its deadline
  const mono = (typeof performance !== 'undefined' && performance && typeof performance.now === 'function') ? () => performance.now() : () => Date.now();
  const gateCadence = () => { try { return loop ? loop.interval() : BEAT; } catch (_) { return BEAT; } };
  const ageOf = (at, atWall) => Math.max(mono() - at, Math.max(0, Date.now() - atWall));
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
    const slowTimer = setTimeout(() => { if (asking) slow = true; }, 2 * BEAT);
    let timeout = 0, graced = false;
    const armDeadline = ms => {
      const due = mono() + ms;
      timeout = setTimeout(() => {
        if (!asking) return;
        if (!graced && mono() - due > LATE_FIRE_MS) { graced = true; armDeadline(BEAT); return; }   // seen late: one more beat
        expired = true; controller.abort();
      }, ms);
    };
    armDeadline(ASK_MS);
    try {
      const response = await fetch('/api/overseer', { signal: controller.signal });
      if (!response.ok) throw new Error('Delegation synchronization unavailable');
      const data = await response.json();
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
      last = data; okAt = mono(); okAtWall = Date.now(); okCadence = askCadence; failing = false; asking = false;
      if (adopted) { App.persist(); App.refreshRail(); }
      if (typeof Delegated !== 'undefined' && Delegated.repaint) Delegated.repaint();   // the parent's DELEGATED card follows the ledger
      const deliveries = JSON.stringify([(data.workers || []).map(w => [w.runId, w.status]),
        (data.reviews || []).map(r => [r.reviewRunId, r.status])]);
      if ((adopted || deliveries !== lastDeliveries) && typeof StationCommands !== 'undefined') {
        await StationCommands.reconcile(); lastDeliveries = deliveries;
      }
    } catch (error) {
      // Existing connection UI owns outages. Retry reconciliation after recovery.
      lastDeliveries = '';
      failing = true;
      if (typeof Delegated !== 'undefined' && Delegated.repaint) Delegated.repaint();   // at once, so a row that reads fresh() drops its live claim
      console.debug('[overseer sync]', error.message);
    } finally { clearTimeout(slowTimer); clearTimeout(timeout); busy = false; asking = false; }
  }
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    if (typeof PollGate !== 'undefined' && PollGate.every) loop = PollGate.every(refresh, { ms: BEAT });
    else { refresh(); setInterval(refresh, BEAT); }
  });
  return { refresh, snapshot: () => last, fresh, unreachable };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Overseer;
