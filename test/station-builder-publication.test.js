/* The real station.build page command must publish its mutation before claiming run readiness.
   Exercise bridge acks, a held publication, refusal/failure/timeout and read-only siblings. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('../frontend/app/stationcommands.js'), 'utf8');
const LIVE = { hash: 'floor', lastHash: 'floor|caps', refusedHash: null, pendingHash: null, inflight: false, retryPending: false, stale: false, errors: [] };
const line = () => ({ ok: true, summary: 'Build SHIP IT', line: { name: 'SHIP IT' }, where: 'HOME', lineKey: 'p12', steps: [], ready: true, blocking: [], recruited: [] });
function boot(options = {}) {
  let applies = 0, syncs = 0, seq = 0;
  const acks = [], timers = new Map(), storage = new Map();
  const st = { serialize: () => ({ revision: applies }), transact() {}, roomSpots() {}, doc: () => ({ meta: { createdAt: 1 } }) };
  const result = options.result || line();
  const world = {
    syncPlan: () => { syncs++; return options.sync ? options.sync() : Promise.resolve(Object.assign({}, LIVE, options.state)); },
    planStatus: () => Object.assign({ station: true, pending: false }, LIVE, options.state, typeof options.current === 'function' ? options.current() : options.current)
  };
  const context = {
    App: Object.assign({ station: () => st, agents: () => [], heroId: () => null }, options.persist ? { persist: options.persist } : {}),
    WorldModel: {}, Pipeline: {}, WorkflowLine: {}, Build: { isOpen: () => false },
    CloudSave: options.cloud,
    World: options.noWorld ? undefined : world,
    StationBuilder: {
      plan: () => ({ ok: true, plan: { spec: { kind: 'line' }, summary: 'Build SHIP IT', ready: true } }),
      apply: () => { applies++; return result; }, sigOf: options.sigOf || (() => 'sig-' + applies),
      // the receipt's body is the builder's own (the page answers station.build with it), so the real one shapes it here too
      receipt: require('../frontend/app/stationbuilder.js').receipt,
      lineRef: () => ({ ok: true, lineId: 'p12', name: 'SHIP IT', steps: [], crewed: true }),
      mapOf: () => ({ ok: true, map: { rooms: [] } })
    },
    localStorage: { getItem: k => storage.get(k) || null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) },
    document: { addEventListener() {} }, console,
    setTimeout: (fn, ms) => { const id = ++seq; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id),
    fetch: async (url, options) => { if (url === '/api/station/ack') acks.push(JSON.parse(options.body)); return { ok: true }; }
  };
  vm.createContext(context);
  const commands = vm.runInContext(source + '\nStationCommands;', context);
  async function call(verb, args) { await commands.run('r' + (++seq), verb, args); return acks.at(-1); }
  async function plan() { return (await call('station.plan_line', {})).result.planId; }
  return { call, plan, acks, timers, storage, counts: () => ({ applies, syncs }) };
}
(async () => {
  let release;
  const held = boot({ sync: () => new Promise(resolve => { release = resolve; }) });
  const id = await held.plan();
  await held.call('station.line_ref', { line: 'SHIP IT' });
  await held.call('station.map', {});
  A.eq(held.counts(), { applies: 0, syncs: 0 }, 'planning and read-only queries do not apply or publish');
  const before = held.acks.length, pending = held.call('station.build', { planId: id });
  await Promise.resolve(); await Promise.resolve();
  A.eq(held.counts(), { applies: 1, syncs: 1 }, 'one mutation starts one publication');
  A.eq(held.acks.length, before, 'build ack waits while publication is held');
  if (release) release(LIVE);
  const ack = await pending;
  A.ok(ack.ok && ack.result.built && ack.result.ready, 'confirmed publication keeps the structurally ready line ready');
  A.ok(ack.result.routing && ack.result.routing.published && ack.result.routing.hash === 'floor', 'build receipt names confirmed routing hash');
  A.ok(![...held.timers.values()].some(t => t.ms > 700), 'settled publication clears its deadline');
  const again = await held.call('station.build', { planId: id });
  A.ok(!again.ok && held.counts().applies === 1, 'a consumed plan cannot duplicate a build');

  let offered = LIVE;
  const superseded = { sync: () => Promise.resolve().then(() => {
    offered = Object.assign({}, LIVE, { hash: 'newfloor', lastHash: 'newfloor|newcaps' }); return offered;
  }), current: () => offered };
  let caps = LIVE;
  const changedCaps = { sync: () => Promise.resolve().then(() => {
    caps = Object.assign({}, LIVE, { lastHash: 'floor|changedcaps' }); return caps;
  }), current: () => caps };
  const failures = [
    ['newer floor acknowledged during await', superseded],
    ['capabilities changed during await', changedCaps],
    ['stale', { state: { stale: true } }], ['inflight', { state: { inflight: true } }],
    ['retry', { state: { retryPending: true } }], ['pending delivery', { state: { pendingHash: 'next' } }],
    ['refused', { state: { refusedHash: LIVE.lastHash } }],
    ['compiler finding', { state: { errors: [{ code: 'CYCLE' }] } }],
    ['missing proof', { sync: () => null }], ['missing world', { noWorld: true }],
    ['synchronous exception', { sync: () => { throw new Error('post failed'); } }],
    ['rejection', { sync: () => Promise.reject(new Error('network failed')) }],
    ['unpublished hash', { state: { lastHash: null } }],
    ['different acknowledged floor', { state: { lastHash: 'older|caps' } }],
    ['changed while awaiting', { current: { pending: true } }]
  ];
  for (const [name, options] of failures) {
    const b = boot(options), pid = await b.plan();
    const a = await b.call('station.build', { planId: pid }), r = a.result || {};
    A.ok(a.ok && r.built === true && r.ready === false, name + ': retain successful floor mutation but refuse readiness');
    A.ok(r.routing && r.routing.published === false && r.routing.reason && r.blocking.includes(r.routing.reason), name + ': concrete publication reason is on the receipt');
    A.eq(b.counts().applies, 1, name + ': no repeat or rollback of successful mutation');
    const retry = await b.call('station.build', { planId: pid });
    A.ok(!retry.ok && b.counts().applies === 1, name + ': failed publication still consumes the applied plan');
  }
  const timeout = boot({ sync: () => new Promise(() => {}) });
  const timed = timeout.call('station.build', { planId: await timeout.plan() });
  await Promise.resolve(); await Promise.resolve();
  const deadline = [...timeout.timers.values()].find(t => t.ms > 700 && t.ms < 6000);
  A.ok(!!deadline, 'publication has a deadline below the six-second bridge timeout');
  if (deadline) deadline.fn();
  const timedAck = await timed;
  A.ok(timedAck.ok && timedAck.result.built && timedAck.result.ready === false, 'held network returns truthful built/not-ready through the bridge');

  const multi = boot({ state: { stale: true }, result: { ok: true, rooms: [], lines: [{ lineId: 'p1', ready: true, blocking: [] }, { lineId: 'p2', ready: false, blocking: ['needs crew'] }] } });
  const multiple = (await multi.call('station.build', { planId: await multi.plan() })).result;
  A.ok(multiple.built && multiple.ready === false && multiple.lines.every(l => !l.ready && l.blocking.length), 'whole-floor builds downgrade every line when publication fails');
  A.ok(multiple.lines[1].blocking.includes('needs crew'), 'publication failure preserves existing floor blockers');
  const unready = boot({ result: Object.assign(line(), { ready: false, blocking: ['needs crew'] }) });
  const unreadyResult = (await unready.call('station.build', { planId: await unready.plan() })).result;
  A.ok(unreadyResult.ready === false && unreadyResult.routing && unreadyResult.routing.published, 'successful publication does not promote a structurally unready line');
  const invalid = boot({ result: { ok: false, error: 'floor changed' } });
  const invalidAck = await invalid.call('station.build', { planId: await invalid.plan() });
  A.ok(!invalidAck.ok && invalid.counts().syncs === 0, 'failed floor application never posts or reports built');

  /* #121 (I121-4): a build is reported SAVED only when the station file holds it. Like station.update_agent: queue the
     live save, flush it, read the station file back and compare the floor; otherwise durable:false with a reason. */
  A.ok(ack.result.durable === false && /station file has not confirmed/.test(ack.result.durability || ''), 'without durable storage on the page a build is never reported saved');
  const order = [];
  const sigOf = doc => JSON.stringify(doc);
  const durableCase = (cloud) => boot({ sigOf, persist: () => { order.push('persist'); return false; }, cloud });
  {
    const b = durableCase({ flush: async o => { order.push('flush:' + !!(o && o.force)); return true; }, pull: async () => { order.push('pull'); return { station: { revision: 1 } }; } });
    const r = (await b.call('station.build', { planId: await b.plan() })).result;
    A.ok(r.built === true && r.durable === true && !r.durability, 'a build the station file reads back is reported durable');
    A.eq(order, ['persist', 'flush:true', 'pull'], 'the live save is queued, force-flushed, then read back from the station file');
  }
  for (const [name, cloud] of [
    ['refused flush', { flush: async () => false, pull: async () => ({ station: { revision: 1 } }) }],
    ['read-back shows the old floor', { flush: async () => true, pull: async () => ({ station: { revision: 0 } }) }],
    ['read-back has no station', { flush: async () => true, pull: async () => null }],
    ['flush throws', { flush: async () => { throw new Error('network'); }, pull: async () => null }]
  ]) {
    const b = durableCase(cloud);
    const a = await b.call('station.build', { planId: await b.plan() });
    A.ok(a.ok && a.result.built === true && a.result.durable === false && /could revert after a restart/.test(a.result.durability || ''), name + ': the build stands but is reported durable:false with the reason');
    A.eq(b.counts().applies, 1, name + ': an unconfirmed save never undoes or repeats the build');
  }
  {
    const hung = durableCase({ flush: () => new Promise(() => {}), pull: async () => null });
    const pending = hung.call('station.build', { planId: await hung.plan() });
    for (let i = 0; i < 6; i++) await Promise.resolve();
    const wait = [...hung.timers.values()].find(t => t.ms === 3000);
    A.ok(!!wait, 'the station-file proof has its own deadline inside the six-second bridge timeout');
    if (wait) wait.fn();
    const a = await pending;
    A.ok(a.ok && a.result.built && a.result.durable === false, 'a hung station file answers durable:false through the bridge');
    A.ok(![...hung.timers.values()].some(t => t.ms === 3000), 'the proof clears its deadline once settled');
  }
  A.report();
})().catch(e => { console.error(e); process.exit(1); });
