/* sidecar/run-spend-pool.js — ONE PER RUN CAP FOR A RUN AND EVERY WORKER IT STARTS (bug d3a76db3).

   SETTINGS › SPENDING LIMITS promises PER RUN is a "Hard ceiling for a single agent run". A run that delegates
   (team.spawn / team.dispatch / team.resume, foreground or background) used to start each worker with its OWN
   full PER RUN ceiling, and nothing charged worker spend against the run that started it: a $0.05 cap ran $0.24.
   The run host now gives every run a pool; a worker run JOINS the pool of the run that started it (handed over by
   orchestration.js from the host-minted tool ctx, never from tool arguments), so the lead and its whole crew draw
   from one cap and are stopped by it.

   The loop's own per-run check (loop.js: spent >= maxCostUsd, before every paid call) is the per-run guarantee for
   ONE run: it stops at the first call boundary after the cap, so it can pass the cap by at most the call already in
   flight. A run AND its workers call in PARALLEL, so the pool also counts the calls OTHER members have in flight:
     • spent  — what every member has booked (its loop's own tally at each check, plus each reconciled cost the
       member books in between, so a worker that starts while its lead is mid-turn sees the lead's latest call);
     • a member's next call is admitted only while spent < cap AND the calls its fellow members have IN FLIGHT
       leave room under the cap. Each in-flight call is counted at THAT member's own cost, never at someone else's:
         – a member that has booked a call: its own largest call so far;
         – a member with nothing booked yet: the price of the call it sent, as its loop measured it before sending
           (admit's third argument: the prompt by the local ruler at the model's catalog INPUT price — output can't
           be known before the call), and never less than the largest first call a fellow worker has booked.
     A STOP is decided only on those counts. But a first call's input price says nothing of its output, and workers
     billed mostly for output (long answers, reasoning) all fired together on it (review of 9d4fc52b5). So while NO
     worker has booked a call yet, the pool also counts each such first call in flight at no less than the lead's
     largest turn — the only measure of a call in this family there is — and when THAT would not fit, the member is
     HELD, not stopped: admit returns { hold } and the member is not in flight; its loop waits until a call in flight
     settles, then asks again, and the worker's real booked cost decides (the fellow-worker floor above). A hold
     never stops a call on the lead's turn (the lead's spawning turn carries its whole conversation; a clone's first
     call does not), so cheap clones behind a costly lead turn are only delayed by one call, never stopped on a guess.
   So four $0.04 workers that start together under a $0.05 cap with $0.04 left do not all fire: the first one goes,
   the others wait for its real cost and stop with reason 'budget' (scope 'run', the lead run's cap) at their call
   boundary, as the lead does at its next one. THE BOUND: once a worker has booked, a family passes the cap by at most
   the call admitted last (a call is not counted against itself — the single-run bound above) plus what the calls in
   flight with it cost beyond the fellow worker's booked first call they were counted at. Before any worker has
   booked, the first wave is admitted only while its calls in flight fit, each counted at the larger of its input
   price and the lead's largest turn, so it passes the cap only by what those calls cost beyond that. A lead with no
   booked turn (a flat subscription lead books $0) gives no such measure: its crew's first wave is counted at input
   prices alone.

   A stop the pool makes because of calls still IN FLIGHT is a projection, not a cap that was hit: it carries
   projected:true, which loop.js puts on agent.run.end (budgetProjected) so every stop line says the run stopped
   BEFORE it would pass the cap, never that it hit it.

   A pool with one member decides nothing (admit always proceeds): a run that never delegates is governed by its
   loop's own check exactly as before. An ungoverned cap (0 / Infinity / missing) never blocks.

   PURE: no clock, no IO, no emit. The host feeds it from the run's budget check, its agent.cost / agent.tool_call
   events and its run-end settle (sidecar/index.js). */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).runSpendPool = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const usd = v => (typeof v === 'number' && isFinite(v) && v > 0) ? v : 0;

  function makeRunSpendPool(opts) {
    const o = opts || {};
    const cap = (typeof o.capUsd === 'number' && isFinite(o.capUsd) && o.capUsd > 0) ? o.capUsd : Infinity;
    // runId -> { spent, inFlight, callFrom, callUsd, calls, largest, first }. callUsd = the pre-call price of the call
    // in flight. calls/largest/first count only calls that booked a cost (a call stopped before it went out books
    // nothing, and is no evidence of what a call costs).
    const members = new Map();
    let leadKey = null;          // the run that created the pool joins first: the lead

    function member(runId) {
      const k = String(runId == null ? '' : runId);
      let m = members.get(k);
      if (!m) {
        m = { spent: 0, inFlight: false, callFrom: 0, callUsd: 0, calls: 0, largest: 0, first: 0 };
        members.set(k, m);
        if (leadKey === null) leadKey = k;
      }
      return m;
    }
    function closeCall(m) {
      if (!m.inFlight) return;
      m.inFlight = false;
      const c = m.spent - m.callFrom;   // the model call + what the member booked before its next boundary
      if (c > 0) { m.calls++; m.largest = Math.max(m.largest, c); if (m.calls === 1) m.first = c; }
      settled();
    }
    function spent() { let t = 0; for (const m of members.values()) t += m.spent; return t; }

    // what member `id`'s call in flight is counted at (see the header): its own cost, never another member's.
    //   low  — what the pool KNOWS it costs at least (a stop is decided on this): its own largest booked call, or for a
    //          first call its pre-call price, never below a fellow worker's booked first call;
    //   high — the same, except a first call with no booked worker call to measure it by is counted at no less than
    //          the lead's largest turn (a hold is decided on this: it only ever delays a call, never stops one).
    function estimate(id, m) {
      if (m.calls > 0) return { low: m.largest, high: m.largest };
      let fellow = 0;
      for (const [j, w] of members) if (j !== id && j !== leadKey && w.calls > 0) fellow = Math.max(fellow, w.first);
      const low = Math.max(m.callUsd, fellow);
      if (fellow > 0) return { low, high: low };
      const lead = members.get(leadKey);
      return { low, high: Math.max(low, (lead && id !== leadKey) ? lead.largest : 0) };
    }
    // a HOLD waits for the next call in flight to settle (booked, idle or run end): its cost is the evidence
    let wake = null;
    function settled() { if (wake) { const w = wake; wake = null; w.resolve(); } }
    function nextSettle() {
      if (!wake) { let resolve; const p = new Promise(r => { resolve = r; }); wake = { p, resolve }; }
      return wake.p;
    }

    // a run takes part in this pool (idempotent). The run that created the pool joins first.
    function join(runId) { member(runId); return api; }

    /* The run's budget check, before each paid call: spentUsd is the member's own running tally (authoritative for
       itself); callUsd is the price of the call it is about to send, as its loop measures it before sending (a number,
       or a function the pool calls only when it decides — a family of two or more under a real cap; missing = $0).
       Returns null to proceed (the call is now IN FLIGHT), a stop — the shape loop.js stopForSpend already turns into
       end('budget', { budgetScope, budgetCapUsd, budgetProjected }) — or a hold:
         { scope:'run', usd, cap }                                  the family's booked spend reached the cap;
         { scope:'run', usd, cap, committedUsd, projected:true }    the calls in flight already take what is left;
         { hold: Promise }                                          the calls in flight fit at what is known of them,
           but not with a first call nobody has measured counted at the lead's turn: the member is NOT in flight, and
           asks again once the promise resolves (the next call in flight settled). Every hold waits on a call that
           IS in flight, so it always ends. */
    function admit(runId, spentUsd, callUsd) {
      const k = String(runId == null ? '' : runId);
      const m = member(k);
      if (usd(spentUsd) > m.spent) m.spent = usd(spentUsd);
      closeCall(m);   // reaching a new boundary means the previous call has settled
      const open = (priced) => {
        m.inFlight = true; m.callFrom = m.spent;
        m.callUsd = priced ? usd(typeof callUsd === 'function' ? callUsd() : callUsd) : 0;
        return null;
      };
      if (cap === Infinity || members.size < 2) return open(false);   // a lone run is never decided here: no price asked
      const total = spent();
      if (total >= cap) return { scope: 'run', usd: total, cap };
      let committed = 0, unmeasured = 0;
      for (const [id, other] of members) {
        if (id === k || !other.inFlight) continue;
        const e = estimate(id, other);
        committed += e.low; unmeasured += e.high;
      }
      if (committed > 0 && total + committed >= cap) return { scope: 'run', usd: total, cap, committedUsd: committed, projected: true };
      if (total + unmeasured >= cap) return { hold: nextSettle() };
      return open(true);
    }
    // a reconciled cost the member booked (its model call, a tool's own paid pass): counted now, and it settles the call
    function booked(runId, amount) {
      const m = member(runId);
      m.spent += usd(amount);
      closeCall(m);
    }
    // the member's call ended without a booked cost (it moved on to tools, or another guard stopped it)
    function idle(runId) { closeCall(member(runId)); }
    // the member's run ended: its final spend (never lowers what it already booked)
    function settle(runId, finalUsd) {
      const m = member(runId);
      if (usd(finalUsd) > m.spent) m.spent = usd(finalUsd);
      closeCall(m);
    }
    function status() {
      let inFlight = 0, largest = 0;
      for (const m of members.values()) { if (m.inFlight) inFlight++; largest = Math.max(largest, m.largest); }
      return { capUsd: cap, spentUsd: spent(), members: members.size, inFlight, largestCallUsd: largest };
    }

    const api = { join, admit, booked, idle, settle, status, capUsd: cap };
    return api;
  }

  // a pool the HOST minted (orchestration hands it to runOnce); anything else — a JSON body field — is not one
  function isRunSpendPool(p) {
    return !!(p && typeof p === 'object' && typeof p.admit === 'function' && typeof p.join === 'function'
      && typeof p.booked === 'function' && typeof p.idle === 'function' && typeof p.settle === 'function');
  }

  return { makeRunSpendPool, isRunSpendPool };
});
