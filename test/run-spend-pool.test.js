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
  A.ok(w2 && near(w2.usd, 0.04) && near(w2.committedUsd, 0.04), 'the stop is the in-flight worker call taking the headroom ($0.04 booked + $0.04 in flight)');
  A.ok(pool.admit('w3', 0) && pool.admit('w4', 0), 'the other two are stopped too');
  pool.booked('w1', 0.04);
  pool.settle('w1', 0.04);
  for (const w of ['w2', 'w3', 'w4']) pool.settle(w, 0);
  const lead = pool.admit('lead', 0.04);
  A.ok(lead && lead.scope === 'run' && near(lead.usd, 0.08) && lead.cap === 0.05, 'the lead stops at its next call boundary: the family spent $0.08 of $0.05');
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
  A.eq(pool.admit('lead', 0.05), null, 'lead: $0.05 booked + the worker\'s call in flight (counted at $0.03) still fits under $0.10');
  pool.settle('lead', 0.01);
  A.ok(near(pool.status().spentUsd, 0.05), 'a lower final figure never un-books spend');
  pool.settle('w', 0.06);
  A.ok(near(pool.status().spentUsd, 0.11), 'the worker\'s final spend is counted');
  A.ok(pool.admit('lead', 0.05) && pool.admit('w', 0.06), 'and once the family reached $0.10 every member stops');
}

// ---- 1f. only a pool the host minted is one ----
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
} finally {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) { /* temp dir */ }
}

A.report('run-spend-pool.test');
})().catch(e => { console.log('FAIL: run-spend-pool.test threw - ' + (e && e.stack || e)); process.exit(1); });
