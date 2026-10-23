/* node test/cron.delivery-backlog.test.js — the first boot after an upgrade never floods a chat with stale routine results.

   0.13.x sent a routine's reply as ONE message. Every digest past Telegram's 4096 characters was refused ("message is
   too long") on the fire and on every retry, so it stayed `pending` in cron.jobs.json for good, and each later fire
   queued another one behind it (up to 100 per routine). 0.14 splits long replies, so ALL of them became deliverable at
   once: the first boot sent weeks of old digests, several routines' parts interleaved in one chat.

   This loads a 0.13.5-shaped cron.jobs.json (the exact receipt shape 0.13.5's markRun/markDelivery wrote) into the
   real driver and proves, off the deliveries the host is asked to make:
     1. a routine's backlog for one chat collapses to its NEWEST result, delivered once, carrying how many earlier
        results it replaces; the older receipts are closed as superseded and never sent;
     2. a routine the Commander PAUSED sends nothing until it is resumed — then one result, not its backlog;
     3. a completed one-shot (not paused) still delivers its result;
     4. a result whose send is already in flight is never superseded (it may already have landed);
     5. a supersede that cannot reach disk sends nothing (retried on a later pass). */
'use strict';
const A = require('./_assert.js');
const { makeClock } = require('../shared/clock-rng.js');
const cron = require('../sidecar/cron.js');
const cronStore = require('../sidecar/cron-store.js');
const { makeCronDriver } = require('../sidecar/cron-driver.js');

const DAY = 86400000;
const T0 = Date.parse('2026-10-23T09:00:00.000Z');
const iso = ms => new Date(ms).toISOString();
const flush = () => new Promise(r => setImmediate(r));
const LONG = n => 'DIGEST ' + n + '\n' + Array.from({ length: 160 }, (_, i) => 'item ' + i + ' of the overnight digest with its details').join('\n');

// One receipt exactly as 0.13.5 left it after weeks of "message is too long".
function receipt(jobId, runId, daysAgo, origin) {
  return {
    id: runId + ':final', runId: runId, state: 'pending', outcome: 'ok', result: LONG(runId), error: null, usd: 0.02,
    deliver: 'origin', origin: origin,
    deliveryContext: { name: jobId, prompt: 'digest', agentId: 'agent', noAgent: false, attachToSession: false },
    destination: 'origin', committedAt: iso(T0 - daysAgo * DAY), attempts: 40,
    deliveredAt: null, lastError: 'Bad Request: message is too long', deliveredTargets: [],
    nextAttemptAt: iso(T0 - daysAgo * DAY + 900000)
  };
}
function job(id, backlog, extra) {
  const base = cronStore.makeJob({ id, name: id, prompt: 'digest', agentId: 'agent', schedule: cron.parseSchedule('0 9 * * *', T0 - 40 * DAY), deliver: 'origin', origin: CHAT }, { id, now: T0 - 40 * DAY });
  const all = backlog.slice();
  return Object.assign(base, { deliveryBacklog: all.slice(0, -1), finalization: all[all.length - 1] || null, lastDeliveryOk: false, lastDeliveryError: 'Bad Request: message is too long' }, extra || {});
}
const CHAT = { target: null, channel: 'telegram', chatId: '777', threadId: null, sessionId: null, streamId: null, sessionTitle: null };

function seed() {
  const jobs = [
    job('daily', [receipt('daily', 'd-21', 21, CHAT), receipt('daily', 'd-14', 14, CHAT), receipt('daily', 'd-1', 1, CHAT)]),
    job('market', [receipt('market', 'm-9', 9, CHAT), receipt('market', 'm-2', 2, CHAT)]),
    job('paused', [receipt('paused', 'p-30', 30, CHAT), receipt('paused', 'p-29', 29, CHAT)], { enabled: false, state: 'paused', disabledReason: 'paused', nextRunAt: null }),
    job('once', [receipt('once', 'o-5', 5, CHAT)], { schedule: cron.parseSchedule('in 1m', T0 - 6 * DAY), enabled: false, state: 'completed', nextRunAt: null, lastRunAt: iso(T0 - 5 * DAY) })
  ];
  // through the real envelope round trip, the way the sidecar boots it off disk
  return cronStore.loadEnvelope(JSON.stringify({ version: 1, jobs })).jobs;
}

function setup(jobs, opts) {
  opts = opts || {};
  const clock = makeClock(T0);
  let store = jobs.slice();
  let failPersist = false;
  const sent = [];
  const driver = makeCronDriver({
    getJobs: () => store,
    setJobs: (j) => { if (failPersist) return false; store = j; return true; },
    runOnce: () => Promise.resolve(),
    emit: () => {}, newId: () => 'run-x', newAbort: () => new AbortController(), now: () => clock.now(),
    getKey: () => 'sk-test', defaultModel: 'test/model', persona: 'PERSONA',
    deliverResult: opts.deliverResult || ((j, result) => { sent.push({ jobId: j.name, runId: result.runId, superseded: result.superseded, text: result.text }); return { ok: true, deliveredTargets: ['@origin'] }; })
  });
  return { driver, clock, sent, getJob: id => cronStore.getJob(store, id), setStore: fn => { store = fn(store); }, setFailPersist: v => { failPersist = v; } };
}

(async function () {
  // ---- 1-3. the upgrade boot: one current result per routine, paused routines wait ----
  {
    const s = setup(seed());
    await s.driver.recoverFinalizations(); await flush();
    const byJob = id => s.sent.filter(x => x.jobId === id);
    A.eq(byJob('daily').map(x => x.runId), ['d-1'], 'a routine with three stuck digests delivers only its newest one');
    A.eq(byJob('daily')[0] && byJob('daily')[0].superseded, 2, 'and that delivery knows two earlier results are not coming');
    A.eq(byJob('market').map(x => x.runId), ['m-2'], 'a second routine to the same chat also delivers only its newest result');
    A.eq(byJob('market')[0] && byJob('market')[0].superseded, 1, 'naming the one it replaces');
    A.eq(byJob('once').map(x => x.runId), ['o-5'], 'a completed one-shot (not paused) still delivers its result');
    A.eq(byJob('once')[0] && byJob('once')[0].superseded, 0, 'with nothing superseded');
    A.eq(byJob('paused').length, 0, 'a routine the Commander paused sends nothing on boot');
    A.eq(s.sent.length, 3, 'three sends in total, not one per stuck digest (' + s.sent.length + ')');

    const daily = s.getJob('daily');
    A.eq(cronStore.pendingDeliveries(daily).length, 0, 'the daily routine has nothing left to deliver');
    A.eq(daily.deliveryBacklog.length, 0, 'its superseded receipts leave the outbox');
    A.eq(daily.finalization.state, 'delivered', 'the newest receipt is durably delivered');
    A.eq(cronStore.pendingDeliveries(s.getJob('paused')).length, 2, 'the paused routine keeps both of its results');

    // later passes (every scheduler tick) send nothing more
    s.clock.set(T0 + 3600000);
    await s.driver.recoverFinalizations(); await flush();
    A.eq(s.sent.length, 3, 'later recovery passes send nothing more');

    // the Commander resumes the paused routine: one result, not its backlog
    s.setStore(jobs => cronStore.resumeJob(jobs, 'paused', { now: s.clock.now() }));
    await s.driver.recoverFinalizations(); await flush();
    A.eq(byJob('paused').map(x => x.runId), ['p-29'], 'a resumed routine delivers only its newest held result');
    A.eq(byJob('paused')[0] && byJob('paused')[0].superseded, 1, 'naming the earlier one');
  }

  // ---- 1b. the direct path: a NEW run settling over an old backlog replaces it, never queues behind it ----
  {
    const s = setup(seed().filter(j => j.id === 'daily'));
    s.driver.leases.set('daily', { runId: 'fresh', startedAt: T0, heartbeatAt: T0, ac: new AbortController(), isOnce: false });
    s.driver.settleRun('daily', 'fresh', { reason: 'done', buf: 'fresh digest' }, null);
    await flush(); await flush();
    A.eq(s.sent.map(x => x.runId), ['fresh'], 'the fresh result is the only delivery');
    A.eq(s.sent[0] && s.sent[0].superseded, 3, 'and it says three earlier results are not coming');
    A.eq(cronStore.pendingDeliveries(s.getJob('daily')).length, 0, 'nothing stale stays queued');
  }

  // ---- 4. a result whose send is in flight is never superseded ----
  {
    const seen = [], releases = [];
    const hang = (j, result) => { seen.push(result.runId); return new Promise(r => { releases.push(r); }); };
    // the OLDER receipt is due while a newer one waits out its backoff: the older one is superseded, never sent
    const s = setup(seed().filter(j => j.id === 'market'), { deliverResult: hang });
    s.setStore(js => js.map(j => Object.assign({}, j, { finalization: Object.assign({}, j.finalization, { nextAttemptAt: iso(T0 + DAY) }) })));
    await s.driver.deliverFinalization(s.getJob('market'), s.getJob('market').deliveryBacklog[0]);
    A.eq(seen, [], 'an older idle result is superseded before it sends');
    A.eq(s.getJob('market').deliveryBacklog.length, 0, 'superseded, it leaves the outbox');

    // the older send is ALREADY in flight (it started before the newer result existed): it must not be superseded
    const s2 = setup(seed().filter(j => j.id === 'market'), { deliverResult: hang });
    s2.setStore(js => js.map(j => Object.assign({}, j, { finalization: null, deliveryBacklog: [j.deliveryBacklog[0]] })));
    const first = s2.driver.deliverFinalization(s2.getJob('market'), s2.getJob('market').deliveryBacklog[0]);
    await flush();
    A.eq(seen, ['m-9'], 'the older result is sending');
    s2.setStore(js => js.map(j => Object.assign({}, j, { finalization: receipt('market', 'm-2', 2, CHAT) })));
    const pass = s2.driver.recoverFinalizations(); await flush();
    A.eq(cronStore.pendingDeliveries(s2.getJob('market')).map(f => f.runId), ['m-9', 'm-2'], 'an in-flight send is never superseded');
    for (const r of releases) r({ ok: true });
    await first; await flush();
    for (const r of releases) r({ ok: true });
    await pass; await flush();
  }

  // ---- 5. a supersede that cannot reach disk sends nothing ----
  {
    const s = setup(seed().filter(j => j.id === 'daily'));
    s.setFailPersist(true);
    await s.driver.recoverFinalizations(); await flush();
    A.eq(s.sent.length, 0, 'no send while the collapse is not durable');
    A.eq(cronStore.pendingDeliveries(s.getJob('daily')).length, 3, 'the backlog is untouched');
    s.setFailPersist(false);
    await s.driver.recoverFinalizations(); await flush();
    A.eq(s.sent.map(x => x.runId), ['d-1'], 'the next pass collapses and sends the newest once');
  }

  // ---- the pure reducer: one destination's backlog never supersedes another destination's result ----
  {
    const other = Object.assign({}, CHAT, { chatId: '888' });
    const jobs = [job('split', [receipt('split', 's-3', 3, CHAT), receipt('split', 's-2', 2, other), receipt('split', 's-1', 1, CHAT)])];
    const next = cronStore.supersedeDeliveries(jobs, 'split', { now: T0 });
    A.eq(cronStore.pendingDeliveries(next[0]).map(f => f.runId), ['s-2', 's-1'], 'each chat keeps its own newest result');
    A.eq(next[0].finalization.superseded, 1, 'the newest for chat 777 replaces only chat 777\'s older one');
    A.ok(cronStore.supersedeDeliveries(next, 'split', { now: T0 }) === next, 'nothing left to collapse returns the same store');
    const again = [Object.assign({}, next[0], { deliveryBacklog: next[0].deliveryBacklog.concat([next[0].finalization]), finalization: receipt('split', 's-0', 0, CHAT) })];
    A.eq(cronStore.supersedeDeliveries(again, 'split', { now: T0 })[0].finalization.superseded, 2, 'a result superseded again hands on the count it carried');
    A.eq(cronStore.deliveriesHeld({ enabled: false, state: 'paused' }), true, 'paused by the Commander holds');
    A.eq(cronStore.deliveriesHeld({ enabled: false, state: 'error', disabledReason: 'consecutive-failures' }), false, 'an auto-paused routine still tells the Commander');
    A.eq(cronStore.deliveriesHeld({ enabled: false, state: 'completed' }), false, 'a completed one-shot still delivers');
  }

  A.report('cron.delivery-backlog');
})().catch(e => { console.error(e); process.exit(1); });
