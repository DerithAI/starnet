'use strict';

// Reuse existing sessions and transcript reconciliation; never change chat focus.
const Overseer = (() => {
  let busy = false, lastDeliveries = '', last = null;   // last = the latest /api/overseer answer (Delegated reads it)
  // whether that answer is still CURRENT: the latest poll failed (sidecar down) or one has hung past three beats, and the
  // ledger can no longer vouch for a worker still running. snapshot() stays readable for finished and failed rows;
  // anything that says "working" must read fresh() first: the rail's crew lamp and the delegation card's stateOf
  // (delegated.js) both do, so neither ticks a running row through an outage (review app-shell-ui-05)
  const BEAT = 2500;
  let okAt = 0, failing = false, askedAt = 0;
  /* THE BEAT RUNS THROUGH POLLGATE (idle CPU piece 3, 2026-10-20): 2.5 s while the station can be seen, a 30 s floor while
     the Commander is away, and a catch-up read the moment they are back. Freshness is therefore measured against the
     cadence that actually produced the answer, never a fixed 7.5 s from the last answer — or the catch-up read on return
     would be called unreachable just because the last answer is 30 s old:
       · hung: THIS ask has been out for two beats (three for the very first read, exactly as before);
       · fresh: not failing, not hung, and the answer is no older than three of the cadences in force (the one that asked
         for it, or the one in force now) — an ask on its way is fresh until it hangs.
     While visible both reduce to the old reading: a 2.5 s beat, a hang after ~5 s of the ask (7.5 s from the answer). */
  let loop = null, okCadence = BEAT, askCadence = BEAT;
  const gateCadence = () => { try { return loop ? loop.interval() : BEAT; } catch (_) { return BEAT; } };
  const hung = () => busy && Date.now() - askedAt > (okAt ? 2 : 3) * BEAT;
  const fresh = () => !!last && !failing && !hung() && (busy || Date.now() - okAt <= 3 * Math.max(BEAT, okCadence, gateCadence()));
  // the station is not answering the ledger read: the latest poll failed, or this one hangs (above). Readable BEFORE the
  // first answer, when snapshot() is still null: the delegation card says "checking…" while that first read is on its way
  // and "station unreachable" once it has failed — never a worker state the ledger has not given (delegated.js ledgerRead)
  const unreachable = () => failing || hung();
  async function refresh() {
    if (busy || typeof Workstreams === 'undefined' || !Workstreams.generalId()) return;
    busy = true; askedAt = Date.now(); askCadence = gateCadence();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8000);
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
      last = data; okAt = Date.now(); okCadence = askCadence; failing = false;
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
    } finally { clearTimeout(timeout); busy = false; }
  }
  if (typeof document !== 'undefined') document.addEventListener('DOMContentLoaded', () => {
    if (typeof PollGate !== 'undefined' && PollGate.every) loop = PollGate.every(refresh, { ms: BEAT });
    else { refresh(); setInterval(refresh, BEAT); }
  });
  return { refresh, snapshot: () => last, fresh, unreachable };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = Overseer;
