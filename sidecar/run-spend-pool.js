/* sidecar/run-spend-pool.js — ONE PER RUN CAP FOR A RUN AND EVERY WORKER IT STARTS (bug d3a76db3).

   SETTINGS › SPENDING LIMITS promises PER RUN is a "Hard ceiling for a single agent run". A run that delegates
   (team.spawn / team.dispatch / team.resume, foreground or background) used to start each worker with its OWN
   full PER RUN ceiling, and nothing charged worker spend against the run that started it: a $0.05 cap ran $0.24.
   The run host now gives every run a pool; a worker run JOINS the pool of the run that started it (handed over by
   orchestration.js from the host-minted tool ctx, never from tool arguments), so the lead and its whole crew draw
   from one cap and are stopped by it.

   The loop's own per-run check (loop.js: spent >= maxCostUsd, before every paid call) is the per-run guarantee for
   ONE run: it stops at the first call boundary after the cap, so it can pass the cap by at most the call already in
   flight. The pool extends that same guarantee to a run AND its workers, which call in PARALLEL:
     • spent  — what every member has booked (its loop's own tally at each check, plus each reconciled cost the
       member books in between, so a worker that starts while its lead is mid-turn sees the lead's latest call);
     • a member's next call is admitted only while spent < cap AND the calls its fellow members have IN FLIGHT
       leave room under the cap. Each in-flight call is counted at THAT member's own cost, never at someone else's:
         – a member that has booked a call: its own largest call so far;
         – a worker with nothing booked yet: the largest first call a fellow worker has booked;
         – a worker with nothing booked when no fellow worker has booked either: $0 — the lead's own turn is no
           measure of a worker's call (the lead's spawning turn carries its whole conversation; a clone's first call
           does not) — EXCEPT when what is left under the cap is already less than one such lead turn: then that turn
           is the only evidence there is, and it says a parallel call would carry the family past the cap.
   So four workers that start together with $0.01 left do not all fire a $0.04 call: one does, and the others stop
   with reason 'budget' (scope 'run', the lead run's cap) at their call boundary, as the lead does at its next one.
   And a lead whose spawning turn cost $0.18 under a $0.50 cap does not stop its $0.02 clones on a guess.

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
    // runId -> { spent, inFlight, callFrom, calls, largest, first }. calls/largest/first count only calls that booked
    // a cost (a call stopped before it went out books nothing, and is no evidence of what a call costs).
    const members = new Map();
    let leadKey = null;          // the run that created the pool joins first: the lead

    function member(runId) {
      const k = String(runId == null ? '' : runId);
      let m = members.get(k);
      if (!m) {
        m = { spent: 0, inFlight: false, callFrom: 0, calls: 0, largest: 0, first: 0 };
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
    }
    function spent() { let t = 0; for (const m of members.values()) t += m.spent; return t; }

    // what member `id`'s call in flight is counted at (see the header): its own cost, never another member's
    function estimate(id, m, headroom) {
      if (m.calls > 0) return m.largest;
      let fellow = 0;
      for (const [j, w] of members) if (j !== id && j !== leadKey && w.calls > 0) fellow = Math.max(fellow, w.first);
      if (fellow > 0) return fellow;
      const lead = members.get(leadKey);
      const leadCall = (lead && id !== leadKey) ? lead.largest : 0;
      return (leadCall > 0 && headroom < leadCall) ? leadCall : 0;
    }

    // a run takes part in this pool (idempotent). The run that created the pool joins first.
    function join(runId) { member(runId); return api; }

    /* The run's budget check, before each paid call: spentUsd is the member's own running tally (authoritative for
       itself). Returns null to proceed (the call is now IN FLIGHT) or a stop — the shape loop.js stopForSpend
       already turns into end('budget', { budgetScope, budgetCapUsd, budgetProjected }):
         { scope:'run', usd, cap }                                  the family's booked spend reached the cap;
         { scope:'run', usd, cap, committedUsd, projected:true }    the calls in flight already take what is left. */
    function admit(runId, spentUsd) {
      const k = String(runId == null ? '' : runId);
      const m = member(k);
      if (usd(spentUsd) > m.spent) m.spent = usd(spentUsd);
      closeCall(m);   // reaching a new boundary means the previous call has settled
      const open = () => { m.inFlight = true; m.callFrom = m.spent; return null; };
      if (cap === Infinity || members.size < 2) return open();
      const total = spent();
      if (total >= cap) return { scope: 'run', usd: total, cap };
      let committed = 0;
      for (const [id, other] of members) if (id !== k && other.inFlight) committed += estimate(id, other, cap - total);
      if (committed > 0 && total + committed >= cap) return { scope: 'run', usd: total, cap, committedUsd: committed, projected: true };
      return open();
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
