/* node test/run-spend-pool.test.js — bug d3a76db3: one PER RUN cap for a run and every worker it starts.

   A $0.05 PER RUN cap ran $0.24 because each team.spawn worker started with its own full ceiling and nothing charged
   worker spend to the run that started it. Two halves are locked here (the live proof through the real sidecar is
   test/run-cap-bounds-spawn.e2e.test.js):
     1. sidecar/run-spend-pool.js decides like the loop's own per-run check, extended to parallel members: a lone run
        is never decided by it; a family stops once its booked spend reaches the cap, and a member's call is not
        admitted while its fellow members' in-flight calls already take what is left.
     2. orchestration.js hands the HOST-minted ctx.spendPool to every run it starts — dispatch (foreground and
        background), spawn, the structured-result repair, and resume — and never invents one. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeRunSpendPool, isRunSpendPool } = require('../sidecar/run-spend-pool.js');
const { makeOrchestrationTools } = require('../sidecar/tools/builtin/orchestration.js');
const { makeSubagentManager } = require('../sidecar/subagents.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeReplayProvider } = require('../sidecar/providers/replay.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');
const { makeContext } = require('../sidecar/context.js');

const near = (a, b) => Math.abs(a - b) < 1e-9;
const counter = () => { let n = 0; return () => 'child_' + (++n); };
const tick = () => new Promise(resolve => setImmediate(resolve));

(async () => {

// ---- 1a. a run that never delegates is never decided by its pool (its loop's own check governs, as before) ----
{
  const pool = makeRunSpendPool({ capUsd: 0.05 }).join('lead');
  A.eq(pool.admit('lead', 0), null, 'lone run: first call proceeds');
  pool.booked('lead', 0.04);
  A.eq(pool.admit('lead', 0.04), null, 'lone run: a second call under the cap proceeds');
  pool.booked('lead', 0.04);
  A.eq(pool.admit('lead', 0.08), null, 'lone run: even past the cap the pool stays out of it (loop.js stops it on its own maxCostUsd)');
  A.ok(near(pool.status().spentUsd, 0.08), 'lone run: the pool still tallies what the run booked');
}

// ---- 1b. an ungoverned cap (0 / Infinity / missing) never blocks a family ----
for (const capUsd of [0, Infinity, undefined, NaN, -1]) {
  const pool = makeRunSpendPool({ capUsd }).join('lead');
  pool.booked('lead', 5);
  pool.join('w1');
  A.eq(pool.admit('w1', 0), null, 'ungoverned cap ' + String(capUsd) + ': a worker is never stopped');
  A.eq(pool.capUsd, Infinity, 'ungoverned cap ' + String(capUsd) + ' reads as Infinity');
}

// ---- 1c. the repro: $0.05 cap, the lead spent $0.04, four workers start together ----
{
  const pool = makeRunSpendPool({ capUsd: 0.05 }).join('lead');
  A.eq(pool.admit('lead', 0), null, 'the lead\'s first call proceeds');
  pool.booked('lead', 0.04);   // its reconciled cost lands BEFORE its team.spawn runs (loop.js books, then dispatches)
  pool.idle('lead');           // agent.tool_call: the lead is running tools now, not calling the model
  for (const w of ['w1', 'w2', 'w3', 'w4']) pool.join(w);
  A.eq(pool.admit('w1', 0), null, 'the first worker\'s call fits: $0.04 booked, nothing else in flight');
  const w2 = pool.admit('w2', 0);
  A.ok(w2 && w2.scope === 'run' && w2.cap === 0.05, 'a second worker is stopped with scope run at the LEAD\'s $0.05 cap: ' + JSON.stringify(w2));
  A.ok(w2 && near(w2.usd, 0.04) && near(w2.committedUsd, 0.04), 'the stop is the in-flight worker call taking the headroom ($0.04 booked + $0.04 in flight): with $0.01 left, less than one lead turn, that turn is the only evidence of what a call costs');
  A.ok(w2 && w2.projected === true, 'a stop on calls still in flight is a PROJECTION (the cap was not hit yet): ' + JSON.stringify(w2));
  A.ok(pool.admit('w3', 0) && pool.admit('w4', 0), 'the other two are stopped too');
  pool.booked('w1', 0.04);
  pool.settle('w1', 0.04);
  for (const w of ['w2', 'w3', 'w4']) pool.settle(w, 0);
  const lead = pool.admit('lead', 0.04);
  A.ok(lead && lead.scope === 'run' && near(lead.usd, 0.08) && lead.cap === 0.05, 'the lead stops at its next call boundary: the family spent $0.08 of $0.05');
  A.ok(lead && lead.projected !== true, 'a stop at a cap the family really reached is a hit, not a projection');
  A.ok(near(pool.status().spentUsd, 0.08), 'the family spent $0.08 — the cap plus one call, not $0.24');
  A.eq(pool.status().inFlight, 0, 'nothing is left in flight');
}

// ---- 1d. room under the cap: parallel workers all proceed; nothing booked yet reserves nothing ----
{
  const pool = makeRunSpendPool({ capUsd: 1 }).join('lead');
  for (const w of ['a', 'b', 'c', 'd']) pool.join(w);
  for (const w of ['a', 'b', 'c', 'd']) A.eq(pool.admit(w, 0), null, 'with nothing booked yet, worker ' + w + '\'s first call is never refused on a guess');
  A.eq(pool.status().inFlight, 4, 'all four calls are in flight');
  for (const w of ['a', 'b', 'c', 'd']) pool.booked(w, 0.04);
  for (const w of ['a', 'b', 'c', 'd']) A.eq(pool.admit(w, 0.04), null, 'a $1 cap has room for every second call');
  A.ok(near(pool.status().largestCallUsd, 0.04), 'the largest call seen is the $0.04 one');
}

// ---- 1e. a member's own tally is authoritative; settle never lowers what was booked; idle frees the reservation ----
{
  const pool = makeRunSpendPool({ capUsd: 0.10 }).join('lead').join('w');
  pool.admit('lead', 0);
  pool.booked('lead', 0.03);
  pool.admit('lead', 0.05);   // the loop also folded a $0.02 summarizer pass the pool had no event for
  A.ok(near(pool.status().spentUsd, 0.05), 'the loop\'s own running tally raises the member to $0.05');
  pool.idle('lead');          // tools now — the call is over; the $0.03 call is the largest one so far
  A.ok(near(pool.status().largestCallUsd, 0.03), 'the largest call seen is the $0.03 one');
  A.eq(pool.admit('w', 0), null, 'nothing in flight: the worker proceeds');
  A.eq(pool.admit('lead', 0.05), null, 'lead: $0.05 booked + the worker\'s first call in flight (no worker has booked yet: counted at $0 while a whole $0.03 lead call still fits in the $0.05 left) proceeds');
  pool.settle('lead', 0.01);
  A.ok(near(pool.status().spentUsd, 0.05), 'a lower final figure never un-books spend');
  pool.settle('w', 0.06);
  A.ok(near(pool.status().spentUsd, 0.11), 'the worker\'s final spend is counted');
  A.ok(pool.admit('lead', 0.05) && pool.admit('w', 0.06), 'and once the family reached $0.10 every member stops');
}

// ---- 1f. MIXED CALL COSTS (review of d3a76db3): each in-flight call is counted at ITS member's own cost ----
// The first fix counted every fellow member's open call at the costliest call anyone had booked — in team.spawn the
// lead's large-context spawning turn — so cheap clones were stopped with the family well under the cap, where trunk
// would have finished the whole job inside it.
{
  // probe A: cap $0.50, the lead's spawning turn $0.18, four clones join and call together
  const pool = makeRunSpendPool({ capUsd: 0.50 }).join('lead');
  pool.admit('lead', 0); pool.booked('lead', 0.18); pool.idle('lead');
  for (const w of ['w1', 'w2', 'w3', 'w4']) pool.join(w);
  for (const w of ['w1', 'w2', 'w3', 'w4']) A.eq(pool.admit(w, 0), null, 'mixed: clone ' + w + '\'s first call is admitted — the lead\'s $0.18 turn is no measure of a clone\'s call while $0.32 is left');
  for (const w of ['w1', 'w2', 'w3', 'w4']) pool.booked(w, 0.02);
  for (const w of ['w1', 'w2', 'w3', 'w4']) A.eq(pool.admit(w, 0.02), null, 'mixed: and its second call too ($0.26 booked, the clones\' own $0.02 calls in flight)');
  for (const w of ['w1', 'w2', 'w3', 'w4']) { pool.booked(w, 0.02); pool.settle(w, 0.04); }
  A.ok(near(pool.status().spentUsd, 0.34), 'mixed: the family spent $0.34 of its $0.50 cap');
}
{
  // the simulation: cap $1, lead $0.18, four clones x five turns x $0.03 — the whole job needs $0.78 and fits
  const pool = makeRunSpendPool({ capUsd: 1 }).join('lead');
  pool.admit('lead', 0); pool.booked('lead', 0.18); pool.idle('lead');
  const ws = ['w1', 'w2', 'w3', 'w4'];
  const spentBy = {}, stops = [];
  for (const w of ws) { pool.join(w); spentBy[w] = 0; }
  for (let turn = 0; turn < 5; turn++) {
    for (const w of ws) { const stop = pool.admit(w, spentBy[w]); if (stop) stops.push(w + ':' + JSON.stringify(stop)); }
    for (const w of ws) { spentBy[w] += 0.03; pool.booked(w, 0.03); pool.idle(w); }
  }
  A.eq(stops, [], 'simulation: no clone is stopped while the whole job fits under the cap');
  A.ok(near(pool.status().spentUsd, 0.78), 'simulation: all four clones finished all five turns: the family spent $0.78 of $1');
}
{
  // a fresh worker in flight is counted at a FELLOW WORKER's first call once one is booked, never at the lead's turn
  const pool = makeRunSpendPool({ capUsd: 0.30 }).join('lead');
  pool.admit('lead', 0); pool.booked('lead', 0.18); pool.idle('lead');
  for (const w of ['w1', 'w2', 'w3']) pool.join(w);
  A.eq(pool.admit('w1', 0), null, 'w1 calls');
  pool.booked('w1', 0.02);   // its first call: $0.02
  A.eq(pool.admit('w2', 0), null, 'w2 calls (nothing in flight)');
  A.eq(pool.admit('w3', 0), null, 'w3 calls: w2\'s first call in flight is counted at w1\'s $0.02 first call ($0.20 + $0.02 under $0.30), not the lead\'s $0.18');
  pool.booked('w2', 0.02);
  A.eq(pool.admit('w1', 0.02), null, 'w1: w3\'s first call in flight is counted at $0.02 too ($0.22 + $0.02)');
}
{
  // a member with a costly call of its own is counted at it: the reservation still bounds the family
  const pool = makeRunSpendPool({ capUsd: 0.25 }).join('lead');
  pool.admit('lead', 0); pool.booked('lead', 0.02); pool.idle('lead');
  for (const w of ['big', 'small']) pool.join(w);
  pool.admit('big', 0); pool.booked('big', 0.12);   // big's first call cost $0.12
  A.eq(pool.admit('big', 0.12), null, 'big makes its second call');
  const small = pool.admit('small', 0);
  A.ok(small && small.projected === true && near(small.usd, 0.14) && near(small.committedUsd, 0.12),
    'a call in flight is counted at its OWN member\'s largest call: $0.14 booked + big\'s $0.12 in flight leaves no room under $0.25 for small: ' + JSON.stringify(small));
}
{
  // a call stopped before it went out (a day/global pool refused it; index.js idles it) is no evidence of what a call costs
  const pool = makeRunSpendPool({ capUsd: 0.05 }).join('lead');
  pool.admit('lead', 0); pool.booked('lead', 0.04); pool.idle('lead');
  for (const w of ['w1', 'w2']) pool.join(w);
  pool.admit('w1', 0); pool.idle('w1');   // w1's first call never went out
  A.eq(pool.admit('w1', 0), null, 'w1 tries again (nothing in flight)');
  const w2 = pool.admit('w2', 0);
  A.ok(w2 && w2.projected === true && near(w2.committedUsd, 0.04), 'w1 is still a worker with nothing booked — counted at the lead\'s turn (only $0.01 left), not as a $0 call: ' + JSON.stringify(w2));
}

// ---- 1h. a member with nothing booked is counted at ITS OWN pre-call price (review of d42189a18) ----
// d42189a18 counted such a call in flight at $0 whenever at least one lead turn was left, so behind a cheap lead turn
// every worker that started together was admitted at once: cap $0.05, lead $0.01, four $0.04 clones spent $0.17.
// admit's third argument is the price the member's own loop measured for the call it is about to send.
{
  const pool = makeRunSpendPool({ capUsd: 0.05 }).join('lead');
  let asked = 0;
  A.eq(pool.admit('lead', 0, () => { asked++; return 9; }), null, 'price: a lone run proceeds');
  A.eq(asked, 0, 'price: a lone run is never decided by the pool, so its call is never priced');
  pool.booked('lead', 0.01); pool.idle('lead');
  for (const w of ['w1', 'w2', 'w3', 'w4']) pool.join(w);
  A.eq(pool.admit('w1', 0, () => 0.03), null, 'price: w1\'s $0.03 call goes out (nothing else in flight)');
  A.eq(pool.admit('w2', 0, 0.03), null, 'price: w2 goes out — $0.01 booked + w1\'s $0.03 in flight leaves room under $0.05');
  const w3 = pool.admit('w3', 0, 0.03);
  A.ok(w3 && w3.projected === true && near(w3.usd, 0.01) && near(w3.committedUsd, 0.06),
    'price: w3 stops BEFORE the cap — w1 and w2 in flight, each at its own $0.03 price, take what is left: ' + JSON.stringify(w3));
  A.ok(pool.admit('w4', 0, 0.03) !== null, 'price: and w4 too');
  for (const w of ['w1', 'w2']) { pool.booked(w, 0.04); pool.settle(w, 0.04); }
  for (const w of ['w3', 'w4']) pool.settle(w, 0);
  const lead = pool.admit('lead', 0.01, 0.001);
  A.ok(lead && lead.projected !== true && near(lead.usd, 0.09), 'price: the lead stops on a real hit: $0.09, the cap plus the call admitted last, not $0.17: ' + JSON.stringify(lead));
}
{
  // cheap clones stay cheap: their own small prices never stop them behind the lead's costly spawning turn
  const pool = makeRunSpendPool({ capUsd: 0.50 }).join('lead');
  pool.admit('lead', 0); pool.booked('lead', 0.18); pool.idle('lead');
  for (const w of ['w1', 'w2', 'w3', 'w4']) pool.join(w);
  for (const w of ['w1', 'w2', 'w3', 'w4']) A.eq(pool.admit(w, 0, 0.015), null, 'price: clone ' + w + ' at its own $0.015 price is admitted under $0.50 after the lead\'s $0.18 turn');
}
{
  // a price never lowers the evidence: a fellow worker's booked first call still floors a fresh worker's count
  const pool = makeRunSpendPool({ capUsd: 0.30 }).join('lead');
  pool.admit('lead', 0); pool.booked('lead', 0.18); pool.idle('lead');
  for (const w of ['w1', 'w2', 'w3', 'w4']) pool.join(w);
  pool.admit('w1', 0, 0.001); pool.booked('w1', 0.05);   // w1's first call really cost $0.05
  A.eq(pool.admit('w2', 0, 0.001), null, 'floor: w2 goes out (nothing in flight)');
  A.eq(pool.admit('w3', 0, 0.001), null, 'floor: w3 goes out — w2 in flight counted at w1\'s $0.05 first call ($0.23 + $0.05 under $0.30)');
  const w4 = pool.admit('w4', 0, 0.001);
  A.ok(w4 && w4.projected === true && near(w4.committedUsd, 0.10), 'floor: w4 stops — w2 and w3 in flight at $0.05 each, never at their $0.001 prices: ' + JSON.stringify(w4));
}

// ---- 1g. only a pool the host minted is one ----
A.ok(isRunSpendPool(makeRunSpendPool({ capUsd: 1 })), 'a minted pool is recognized');
A.ok(!isRunSpendPool({ admit: 'x', join: 'y', booked: 1, idle: 2, settle: 3 }), 'a JSON-shaped object (a request body) is not a pool');
A.ok(!isRunSpendPool(null) && !isRunSpendPool(undefined) && !isRunSpendPool('pool'), 'nothing else is a pool');

// ---- 2. orchestration hands the lead's pool to every run it starts ----
const fakeRunOnce = (impl) => {
  const calls = [];
  const fn = async (o) => { calls.push(o); return impl ? impl(o) : { reason: 'done', messages: [{ role: 'assistant', content: 'ok' }], usd: 0.01 }; };
  fn.calls = calls;
  return fn;
};
const roster = new Map([['researcher', { system: 'R' }], ['analyst', { system: 'A' }]]);
{
  const pool = makeRunSpendPool({ capUsd: 1 }).join('lead_run');
  const ro = fakeRunOnce();
  const { dispatchTool } = makeOrchestrationTools({ runOnce: ro, roster: () => roster, key: 'k', model: 'm', newId: counter() });
  await dispatchTool.run({ workers: [{ agentId: 'researcher', prompt: 'find X' }, { agentId: 'analyst', prompt: 'analyze Y' }] },
    { agentId: 'agent', runId: 'lead_run', emit: () => {}, spendPool: pool });
  A.eq(ro.calls.length, 2, 'dispatch: two workers ran');
  A.ok(ro.calls.every(c => c.spendPool === pool), 'dispatch: every worker run is handed the lead run\'s own pool');
}
{
  const ro = fakeRunOnce();
  const { dispatchTool } = makeOrchestrationTools({ runOnce: ro, roster: () => roster, key: 'k', model: 'm', newId: counter() });
  await dispatchTool.run({ workers: [{ agentId: 'researcher', prompt: 'find X' }] }, { agentId: 'agent', emit: () => {} });
  A.ok(!('spendPool' in ro.calls[0]), 'dispatch: a ctx with no pool adds no spendPool option (the run host mints its own)');
  const ro2 = fakeRunOnce();
  const t2 = makeOrchestrationTools({ runOnce: ro2, roster: () => roster, key: 'k', model: 'm', newId: counter() });
  await t2.dispatchTool.run({ workers: [{ agentId: 'researcher', prompt: 'find X' }] }, { agentId: 'agent', emit: () => {}, spendPool: { admit: 1 } });
  A.ok(!('spendPool' in ro2.calls[0]), 'dispatch: a ctx value that is not a pool is never passed on');
}
{
  // a schema-failing first answer takes the bounded repair run, which draws from the same pool
  const pool = makeRunSpendPool({ capUsd: 1 }).join('lead_run');
  const ro = fakeRunOnce(o => ({ reason: 'done', messages: [{ role: 'assistant', content: o.outputOnly ? '{"ok":true}' : 'not json' }], usd: 0.01 }));
  const { dispatchTool } = makeOrchestrationTools({ runOnce: ro, roster: () => roster, key: 'k', model: 'm', newId: counter() });
  await dispatchTool.run({ workers: [{ agentId: 'researcher', prompt: 'report', resultSchema: { type: 'object', required: ['ok'], properties: { ok: { type: 'boolean' } } } }] },
    { agentId: 'agent', runId: 'lead_run', emit: () => {}, spendPool: pool });
  const repair = ro.calls.find(c => c.outputOnly === true);
  A.ok(repair, 'dispatch: the structured-result repair ran');
  A.ok(repair && repair.spendPool === pool, 'dispatch: the repair run draws from the lead run\'s pool too');
}
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-run-spend-pool-'));
try {
  {
    const subagents = makeSubagentManager({ fs, pathMod: path, file: path.join(root, 'bg.json'), clock: { now: () => 1000 }, emit: () => {}, newId: counter() });
    const pool = makeRunSpendPool({ capUsd: 1 }).join('lead_run');
    const ro = fakeRunOnce();
    const { dispatchTool } = makeOrchestrationTools({ runOnce: ro, roster: () => roster, key: 'k', model: 'm', newId: counter(), subagents });
    await dispatchTool.run({ workers: [{ agentId: 'researcher', prompt: 'watch the feed' }], background: true }, { agentId: 'agent', runId: 'lead_run', emit: () => {}, spendPool: pool });
    for (let i = 0; i < 5 && !ro.calls.length; i++) await tick();
    A.ok(ro.calls.length === 1 && ro.calls[0].spendPool === pool, 'background dispatch: a worker that outlives the lead\'s turn still draws from its run\'s pool');
  }
  {
    const subagents = makeSubagentManager({ fs, pathMod: path, file: path.join(root, 'spawn.json'), clock: { now: () => 1000 }, emit: () => {}, newId: counter() });
    const pool = makeRunSpendPool({ capUsd: 1 }).join('lead_run');
    const ro = fakeRunOnce();
    const { spawnTool } = makeOrchestrationTools({ runOnce: ro, roster: () => new Map(), key: 'k', model: 'm', selfSystem: 'S', newId: counter(), subagents });
    await spawnTool.run({ tasks: [{ prompt: 'part 1' }, { prompt: 'part 2' }, { prompt: 'part 3' }] }, { agentId: 'agent', runId: 'lead_run', emit: () => {}, spendPool: pool });
    A.eq(ro.calls.length, 3, 'spawn: three clones ran');
    A.ok(ro.calls.every(c => c.spendPool === pool), 'spawn: every clone is handed the lead run\'s pool (the d3a76db3 path)');
  }
  {
    const subagents = makeSubagentManager({ fs, pathMod: path, file: path.join(root, 'resume.json'), clock: { now: () => 1000 }, emit: () => {}, newId: counter() });
    const first = subagents.start({ leadId: 'agent', agentId: 'researcher', prompt: 'retry', runId: 'run_a' }, async () => new Promise(() => {}));
    await tick();
    subagents.interrupt(first.id, 'agent');
    const reloaded = makeSubagentManager({ fs, pathMod: path, file: path.join(root, 'resume.json'), clock: { now: () => 1001 }, emit: () => {}, newId: counter() });
    const pool = makeRunSpendPool({ capUsd: 1 }).join('resuming_run');
    const ro = fakeRunOnce();
    const { resumeTool } = makeOrchestrationTools({ runOnce: ro, roster: () => roster, key: 'k', model: 'm', newId: counter(), subagents: reloaded });
    await resumeTool.run({ id: first.id }, { agentId: 'agent', runId: 'resuming_run', emit: () => {}, spendPool: pool });
    for (let i = 0; i < 5 && !ro.calls.length; i++) await tick();
    A.ok(ro.calls.length === 1 && ro.calls[0].spendPool === pool, 'resume: a resumed worker draws from the RESUMING run\'s pool');
  }
  {
    // the whole seam with the real pool: a fake run host that joins the pool and checks it before its one call
    const subagents = makeSubagentManager({ fs, pathMod: path, file: path.join(root, 'sim.json'), clock: { now: () => 1000 }, emit: () => {}, newId: counter() });
    const pool = makeRunSpendPool({ capUsd: 0.05 }).join('lead_run');
    pool.admit('lead_run', 0); pool.booked('lead_run', 0.04); pool.idle('lead_run');
    let paidCalls = 0;
    const ro = fakeRunOnce(async (o) => {
      o.spendPool.join(o.runId);
      const stop = o.spendPool.admit(o.runId, 0);
      if (stop) { o.spendPool.settle(o.runId, 0); return { reason: 'budget', messages: [], usd: 0 }; }
      await tick();   // the call is in flight while its siblings reach their own boundary
      paidCalls++; o.spendPool.booked(o.runId, 0.04); o.spendPool.settle(o.runId, 0.04);
      return { reason: 'done', messages: [{ role: 'assistant', content: 'part done' }], usd: 0.04 };
    });
    const { spawnTool } = makeOrchestrationTools({ runOnce: ro, roster: () => new Map(), key: 'k', model: 'm', selfSystem: 'S', newId: counter(), subagents });
    const out = await spawnTool.run({ tasks: [1, 2, 3, 4].map(i => ({ prompt: 'part ' + i })) }, { agentId: 'agent', runId: 'lead_run', emit: () => {}, spendPool: pool });
    const rows = JSON.parse(out.content);
    A.eq(paidCalls, 1, 'four clones started with $0.01 left: one paid call went out, not four');
    A.eq(rows.filter(r => r.reason === 'budget').length, 3, 'the other three come back to the lead as stopped by the spending cap');
    A.ok(pool.admit('lead_run', 0.04) !== null, 'and the lead itself is stopped at its next call boundary');
    A.ok(near(pool.status().spentUsd, 0.08), 'family spend $0.08 for a $0.05 cap (cap + one call), not $0.24');
  }

  // ---- 3. THE REAL LOOP: a lead run's team.spawn family through loop.js + orchestration.js + the pool ----
  // The run host is wired exactly as sidecar/index.js runOnceCore wires it (that module boots a sidecar, so it is
  // never required here): mint-or-join the pool, the loop's budget check asks pool.admit, agent.cost books, the first
  // agent.tool_call ends the call, the run end settles. Every event goes through the real validating emitter.
  const turnText = (text, usd) => [{ type: 'text', delta: text }, { type: 'usage', usage: { prompt_tokens: 40, completion_tokens: 8, total_tokens: 48, cost: usd } }, { type: 'done', finishReason: 'stop' }];
  const turnSpawn = (n, usd) => [{ type: 'tool_start', index: 0, id: 'spawn_1', name: 'team_spawn' },
    { type: 'tool_args', index: 0, chunk: JSON.stringify({ tasks: Array.from({ length: n }, (_, i) => ({ prompt: 'part ' + (i + 1), label: 'part ' + (i + 1) })) }) },
    { type: 'usage', usage: { prompt_tokens: 4000, completion_tokens: 400, total_tokens: 4400, cost: usd } }, { type: 'done', finishReason: 'tool_calls' }];
  // a catalog price for the priced families ($10 / $30 per million): a clone's first call is priced from its own prompt
  const PRICED = [{ id: 'replay/model', context_length: 200000, max_completion_tokens: 4096, pricing: { prompt: '0.00001', completion: '0.00003' }, supportsTools: true }];
  async function family(label, capUsd, leadUsd, workerUsd, opt) {
    const { models, selfSystem } = opt || {};
    const ends = [], invalid = [];
    const newId = counter();
    async function hostRun(o) {
      const pool = isRunSpendPool(o.spendPool) ? o.spendPool : makeRunSpendPool({ capUsd });
      pool.join(o.runId);
      const bus = A.makeBus();
      const seq = A.collectBus(bus, events.names());
      const valid = makeEmitter(bus, e => invalid.push(e));
      const emit = (name, payload) => {
        if (payload && payload.runId === o.runId) {
          if (name === 'agent.cost') pool.booked(o.runId, Number(payload.usd) || 0);
          else if (name === 'agent.tool_call') pool.idle(o.runId);
        }
        return valid(name, payload);
      };
      const provider = makeReplayProvider({ turns: o.turns, models });
      // as index.js: the run's system prompt leads its messages, the context manager is the loop's ruler, and the
      // budget check hands the loop's pre-call price (its second argument) to the pool
      const msgs = (o.system ? [{ role: 'system', content: o.system }] : []).concat(o.messages || [{ role: 'user', content: 'go' }]);
      const ctxMgr = makeContext({ contextLimit: 200000 });
      const res = await runAgentLoop({ messages: msgs, provider, emit, cost: makeCostEngine({ priceOf: provider.priceOf }),
        model: 'replay/model', agentId: o.agentId, runId: o.runId, limits: { maxCostUsd: capUsd, maxIters: 6, grace: false },
        budget: { check: (spent, nextCallUsd) => pool.admit(o.runId, spent, nextCallUsd) },
        context: ctxMgr, approxTokens: ctxMgr.estimateMessages(msgs),
        tools: o.tools || [], dispatch: o.dispatch, capCtx: { canRun: () => true, canUse: () => ({ ok: true }), agentId: o.agentId, room: 'office' } });
      pool.settle(o.runId, res.usd);
      const end = seq.find(e => e.name === 'agent.run.end');
      ends.push({ agentId: o.agentId, end: end && end.payload });
      return res;
    }
    const subagents = makeSubagentManager({ fs, pathMod: path, file: path.join(root, label + '.json'), clock: { now: () => 1000 }, emit: () => {}, newId });
    const runOnce = (o) => hostRun({ runId: o.runId, agentId: o.agentId || 'sub', spendPool: o.spendPool, system: o.system, messages: o.messages, turns: [turnText('part done', workerUsd)] });
    const { spawnTool } = makeOrchestrationTools({ runOnce, roster: () => new Map(), key: 'k', model: 'replay/model', selfSystem: selfSystem || 'S', newId, subagents });
    const leadPool = makeRunSpendPool({ capUsd });   // index.js mints the lead's pool and puts it on its tool ctx
    const reg = makeRegistry();
    reg.register({ name: 'team_spawn', schema: spawnTool.schema, run: async (args) => (await spawnTool.run(args, { agentId: 'agent', runId: 'lead', emit: () => {}, spendPool: leadPool })).content });
    await hostRun({ runId: 'lead', agentId: 'agent', spendPool: leadPool, turns: [turnSpawn(4, leadUsd), turnText('combined brief', leadUsd)],
      tools: [{ type: 'function', function: { name: 'team_spawn', parameters: spawnTool.schema } }], dispatch: (c, ctx) => reg.dispatch(c, ctx) });
    const lead = ends.find(e => e.agentId === 'agent');
    const workers = ends.filter(e => /^sub-/.test(e.agentId));
    return { lead: lead && lead.end, workers: workers.map(w => w.end), invalid, spentUsd: leadPool.status().spentUsd };
  }
  const { endNote: channelNote } = require('../sidecar/channels/hub.js');
  const { endNote: acpNote } = require('../sidecar/acp/core.js')._internals;
  const commsLine = new Function(A.fnBody(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8'), 'function budgetStopLine(') + '\nreturn budgetStopLine;')();
  {
    // MIXED COSTS: the lead's spawning turn $0.18, its clones $0.02 each, PER RUN $0.50 — the job fits, so it all runs
    const f = await family('mixed', 0.50, 0.18, 0.02);
    A.eq(f.invalid, [], 'mixed: every event the family emitted passed the event contract');
    A.eq(f.workers.length, 4, 'mixed: four clones ran');
    A.eq(f.workers.map(w => w && w.reason), ['done', 'done', 'done', 'done'], 'mixed: all four clones finished — none stopped on the lead\'s $0.18 turn as a guess');
    A.eq(f.lead && f.lead.reason, 'done', 'mixed: the lead took its synthesis turn and finished');
    A.ok(near(f.spentUsd, 0.44), 'mixed: the family spent $0.44 ($0.18 + 4 x $0.02 + $0.18) inside its $0.50 cap: $' + f.spentUsd);
  }
  {
    // THE REPRO (d3a76db3): every call $0.04, PER RUN $0.05 — one clone's call fits, the others stop BEFORE the cap
    const f = await family('repro', 0.05, 0.04, 0.04);
    A.eq(f.invalid, [], 'repro: every event (budgetProjected included) passed the event contract');
    const stopped = f.workers.filter(w => w && w.reason === 'budget');
    A.eq([f.workers.filter(w => w && w.reason === 'done').length, stopped.length], [1, 3], 'repro: one clone ran, three stopped');
    A.ok(stopped.every(w => w.budgetScope === 'run' && w.budgetCapUsd === 0.05 && w.budgetProjected === true && w.usd === 0),
      'repro: each stopped clone names the lead\'s $0.05 cap AND says the stop was projected (it spent $0): ' + JSON.stringify(stopped));
    A.ok(f.lead && f.lead.reason === 'budget' && f.lead.budgetScope === 'run' && f.lead.budgetCapUsd === 0.05 && f.lead.budgetProjected === undefined,
      'repro: the lead stops at the $0.05 cap the family really reached — a hit, no projected flag: ' + JSON.stringify(f.lead));
    A.ok(near(f.spentUsd, 0.08), 'repro: the family spent $0.08 for a $0.05 cap (the cap plus one call), not $0.24');
    // and every surface says what happened: a projected stop never reads as a cap that was hit
    const w = stopped[0], l = f.lead;
    A.eq(commsLine(w.budgetScope, w.budgetCapUsd, w.budgetCapIsBalance === true, null, null, w.budgetProjected === true),
      'stopped before it would pass the $0.05 per-run spend cap — raise it in SETTINGS › SPENDING LIMITS', 'COMMS: a projected stop says it stopped BEFORE the cap');
    A.ok(/^hit the \$0\.05 per-run spend cap — raise it in /.test(commsLine(l.budgetScope, l.budgetCapUsd, l.budgetCapIsBalance === true, null, null, l.budgetProjected === true)), 'COMMS: the lead\'s real hit still says hit');
    A.eq(channelNote('budget', w), '\n\n(stopped before it would pass the $0.05 per-run spend cap — raise it in the app under SETTINGS › SPENDING LIMITS.)', 'channels: a projected stop says it stopped BEFORE the cap');
    A.ok(/\(hit the \$0\.05 per-run spend cap/.test(channelNote('budget', l)), 'channels: the lead\'s real hit still says hit');
    A.ok(/stopped before it would pass its per-run spend cap/.test(acpNote('budget', false, true)) && !/hit/.test(acpNote('budget', false, true)), 'ACP: a projected stop never says hit');
  }
  // PRICED FAMILIES (review of d42189a18): each clone's first call in flight counts at its own pre-call price — its
  // prompt by the ruler at the model's input price — so a cheap lead turn no longer lets every clone fire at once.
  // A clone's prompt here is the lead's own identity (selfSystem, ~3,000 tokens = ~$0.03 of input at $10/M).
  const identity = n => 'You are the station lead. '.repeat(Math.ceil(n / 25)).slice(0, n);
  {
    // THE CHEAP-LEAD CASE: PER RUN $0.05, the lead's spawning turn $0.01, four $0.04 clones. d42189a18 spent $0.17.
    const f = await family('cheapLead', 0.05, 0.01, 0.04, { models: PRICED, selfSystem: identity(12000) });
    A.eq(f.invalid, [], 'cheap lead: every event passed the event contract');
    const stopped = f.workers.filter(w => w && w.reason === 'budget');
    A.eq([f.workers.filter(w => w && w.reason === 'done').length, stopped.length], [2, 2], 'cheap lead: two clones ran, two stopped — not all four at once');
    A.ok(stopped.every(w => w.budgetScope === 'run' && w.budgetCapUsd === 0.05 && w.budgetProjected === true && w.usd === 0),
      'cheap lead: each stopped clone stopped BEFORE the lead\'s $0.05 cap, at $0: ' + JSON.stringify(stopped));
    A.ok(f.lead && f.lead.reason === 'budget' && f.lead.budgetCapUsd === 0.05 && f.lead.budgetProjected === undefined, 'cheap lead: the lead stops at its next boundary on a real hit: ' + JSON.stringify(f.lead));
    A.ok(near(f.spentUsd, 0.09), 'cheap lead: the family spent $0.09 — the cap plus the call admitted last — not $0.17: $' + f.spentUsd);
  }
  {
    // EXPENSIVE CLONES: PER RUN $0.50, the lead $0.05, four $0.20 clones (~$0.16 of input each). d42189a18 spent $0.85.
    const f = await family('bigClones', 0.50, 0.05, 0.20, { models: PRICED, selfSystem: identity(64000) });
    A.eq(f.invalid, [], 'big clones: every event passed the event contract');
    A.eq(f.workers.map(w => w && w.reason).sort(), ['budget', 'done', 'done', 'done'], 'big clones: three clones ran, the fourth stopped before the cap');
    A.ok(near(f.spentUsd, 0.65), 'big clones: the family spent $0.65 — under the cap plus the call admitted last — not $0.85: $' + f.spentUsd);
  }
  {
    // cheap clones stay cheap when priced: lead $0.18, four $0.02 clones (~$0.015 of input each), PER RUN $0.50
    const f = await family('mixedPriced', 0.50, 0.18, 0.02, { models: PRICED, selfSystem: identity(6000) });
    A.eq(f.invalid, [], 'mixed priced: every event passed the event contract');
    A.eq(f.workers.map(w => w && w.reason), ['done', 'done', 'done', 'done'], 'mixed priced: all four clones finished — their own small prices never stop them');
    A.eq(f.lead && f.lead.reason, 'done', 'mixed priced: the lead took its synthesis turn and finished');
    A.ok(near(f.spentUsd, 0.44), 'mixed priced: the family spent $0.44 inside its $0.50 cap: $' + f.spentUsd);
  }

} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* temp dir */ }
}

A.report('run-spend-pool.test');
})().catch(e => { console.log('FAIL: run-spend-pool.test threw - ' + (e && e.stack || e)); process.exit(1); });
