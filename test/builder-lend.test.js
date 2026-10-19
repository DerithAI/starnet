/* node test/builder-lend.test.js — THE LENT BUILDER (2026-10-11, the delegated Build Manager feature request).

   A lead that holds the station builder lends a SLICE of it — station.map / station.plan / station.build — to ONE
   dispatched worker for ONE job (team.dispatch workers:[{ builder: true }]). Locks:
     1. the slice is exactly those three tools (no prop maker, no line test/start, no settings), deferred, and cut
        from the orchestrator's capId so the TASK DELEGATION switch turns it off with the rest;
     2. a lend never widens: a lead whose own run cannot build gets that worker refused, not sent toolless;
     3. the lend rides foreground AND background workers, and a resumed worker keeps it;
     4. a delegated planner refuses BINDS (they grant live tools) and its page refuses RECRUITS, and a lent build
        names its real builder;
     5. a worker without builder:true is byte-identical to before (workbench only). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { CAP_REGISTRY } = require('../sidecar/capability/registry.js');
const { resolveTools } = require('../sidecar/capability/resolve.js');
const { composeOffice } = require('../sidecar/capability/office.js');
const { makeCapCtx } = require('../sidecar/capability/capGate.js');
const { makeOrchestrationTools } = require('../sidecar/tools/builtin/orchestration.js');
const { makeSubagentManager } = require('../sidecar/subagents.js');
const { makeStationTools, planSummaryFrom } = require('../sidecar/tools/builtin/station.js');

function fakeRunOnce() {
  const calls = [];
  const fn = async (o) => { calls.push(o); return { reason: 'done', messages: [{ role: 'assistant', content: 'out:' + o.agentId }], usd: 0.1 }; };
  fn.calls = calls;
  return fn;
}
const counter = () => { let n = 0; return () => 'id_' + (++n); };
const types = o => (o.extraObjects || []).map(x => x.objectType).sort();
// a lead's ctx exactly as the run host builds it: canUse answers from the lead's REAL resolved grants
const leadCtx = (objects, extra) => {
  const station = { agents: { lead: { id: 'lead', room: 'office' } }, rooms: { office: { id: 'office', objects } } };
  return Object.assign(makeCapCtx(resolveTools('lead', station)), { agentId: 'lead', emit: () => {} }, extra || {});
};
const LEAD = composeOffice({ surface: 'interactive', lead: true });
const WORKER_ONLY = composeOffice({ surface: 'autonomous', lead: false });

(async () => {

/* ---- 1. the slice ---- */
{
  const kit = CAP_REGISTRY.builder;
  A.ok(Array.isArray(kit), 'CAP_REGISTRY has a builder object');
  A.eq(kit.map(g => g.tool), ['station.map', 'station.plan', 'station.build'], 'the lent builder is exactly map, plan and build');
  A.ok(kit.every(g => g.capId === 'orchestrator' && g.deferred === true), 'cut from the orchestrator capId (one TASK DELEGATION switch) and deferred like the lead\'s');
  A.eq(kit.map(g => [g.scope, g.requiresConsent]), [['read', false], ['read', false], ['write', true]], 'map and plan change nothing; every build asks the Commander');
  const orch = new Map(CAP_REGISTRY.orchestrator.map(g => [g.tool, g]));
  for (const g of kit) A.eq([g.scope, g.requiresConsent, g.network], [orch.get(g.tool).scope, orch.get(g.tool).requiresConsent, orch.get(g.tool).network], g.tool + ' carries the SAME rules the lead\'s copy does');
  // a worker holding the lent kit resolves it, deferred (found by tool_search "station builder")
  const st = { agents: { w: { id: 'w', room: 'r' } }, rooms: { r: { id: 'r', objects: composeOffice({ surface: 'autonomous', extraObjects: [{ objectType: 'builder' }] }) } } };
  const r = resolveTools('w', st);
  A.ok(['station.map', 'station.plan', 'station.build'].every(t => r.tools.includes(t) && r.deferred.includes(t)), 'a lent worker resolves map/plan/build, deferred');
  A.ok(!['team.dispatch', 'station.make_prop', 'station.test_line', 'station.start_line', 'station.control', 'station.power'].some(t => r.tools.includes(t)), 'and nothing else of the lead\'s: no dispatch, prop maker, line test/start or settings');
  const off = resolveTools('w', st, undefined, { disabledCaps: new Set(['orchestrator']) });
  A.ok(!off.tools.includes('station.build'), 'the TASK DELEGATION switch turns the lent builder off too');
  // the lead holds the builder inside the orchestrator; a plain worker never does
  A.ok(leadCtx(LEAD).canUse({ name: 'station.build' }).ok, 'fixture: the lead can build');
  A.ok(!leadCtx(WORKER_ONLY).canUse({ name: 'station.build' }).ok, 'fixture: a run without the orchestrator cannot');
}

/* ---- 2/5. foreground dispatch: lend, refuse a lend that would widen, and leave the plain worker as it was ---- */
{
  const ro = fakeRunOnce();
  const roster = new Map([['builder', { system: 'B', name: 'BUILD MANAGER' }], ['scout', { system: 'S', name: 'SCOUT' }]]);
  const { dispatchTool } = makeOrchestrationTools({ runOnce: ro, roster: () => roster, key: 'k', model: 'm', perWorker: 1, newId: counter() });
  A.eq(dispatchTool.schema.properties.workers.items.properties.builder, { type: 'boolean' }, 'a worker takes builder: boolean');
  A.ok(/BUILDER: builder:true lends that worker your station\.map\/plan\/build for this job; builds follow your approval setting\./.test(dispatchTool.description), 'the dispatch tool says what builder:true lends');
  // review threads-backend-13: under Full Access or a cached grant a lent build shows no card, so never promise one
  A.ok(!/asks the Commander|approves each build/.test(dispatchTool.description), 'the dispatch tool never promises a card on every build');
  await dispatchTool.run({ workers: [{ agentId: 'builder', prompt: 'rebuild the lab', builder: true }, { agentId: 'scout', prompt: 'look around' }] }, leadCtx(LEAD));
  A.eq(ro.calls.length, 2, 'both workers ran');
  A.eq(types(ro.calls[0]), ['builder', 'workbench'], 'the Build Manager runs with the lent builder on top of the workbench');
  A.eq(types(ro.calls[1]), ['workbench'], 'a worker without builder:true is exactly as before (workbench only)');
  A.eq([ro.calls[0].delegatedBy, ro.calls[0].surface], ['lead', 'autonomous'], 'the lent run is still a delegated autonomous run (the lead\'s consent broker answers its builds)');

  const ro2 = fakeRunOnce();
  const t2 = makeOrchestrationTools({ runOnce: ro2, roster: () => roster, key: 'k', model: 'm', perWorker: 1, newId: counter() }).dispatchTool;
  const out = JSON.parse((await t2.run({ workers: [{ agentId: 'builder', prompt: 'x', builder: true }, { agentId: 'scout', prompt: 'y' }] }, leadCtx(WORKER_ONLY))).content);
  const rows = Array.isArray(out) ? out : (out.results || out.workers || []);
  const refused = rows.find(r => r.agentId === 'builder');
  A.ok(refused && refused.reason === 'error' && /builder:true needs the station builder in YOUR run/.test(refused.result), 'a lead that cannot build is refused the lend, by name: ' + JSON.stringify(refused));
  A.eq(ro2.calls.map(c => c.agentId), ['scout'], 'the refused worker never ran; its sibling did');
  A.ok(ro2.calls.every(c => !types(c).includes('builder')), 'and nobody got a builder the lead did not hold');
  // builder: "yes" (not exactly true) lends nothing
  const ro3 = fakeRunOnce();
  await makeOrchestrationTools({ runOnce: ro3, roster: () => roster, key: 'k', model: 'm', newId: counter() }).dispatchTool.run({ workers: [{ agentId: 'builder', prompt: 'x', builder: 'yes' }] }, leadCtx(LEAD));
  A.eq(types(ro3.calls[0]), ['workbench'], 'only builder: true lends (a truthy string does not)');
}

/* ---- 3. background: the lend rides the durable record, and team.resume restarts it with the same kit ---- */
{
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'builder-lend-'));
  try {
    const roster = new Map([['builder', { system: 'B', name: 'BUILD MANAGER' }]]);
    const file = path.join(root, 'subagents.json');
    const subagents = makeSubagentManager({ fs, pathMod: path, file, clock: { now: () => 1000 }, emit: () => {}, newId: counter() });
    let release;
    const gate = new Promise(r => { release = r; });
    const calls = [];
    const ro = async (o) => { calls.push(o); await gate; return { reason: 'done', messages: [{ role: 'assistant', content: 'ok' }], usd: 0 }; };
    const { dispatchTool } = makeOrchestrationTools({ runOnce: ro, roster: () => roster, key: 'k', model: 'm', newId: counter(), subagents });
    const started = JSON.parse((await dispatchTool.run({ workers: [{ agentId: 'builder', prompt: 'expand the station', builder: true }], background: true }, leadCtx(LEAD))).content);
    await new Promise(r => setImmediate(r));
    A.eq(types(calls[0]), ['builder', 'workbench'], 'a background Build Manager runs with the lent builder');
    const id = started[0].id;
    A.eq(subagents.get(id).builder, true, 'the durable record remembers the lend');
    A.eq(subagents.list().find(r => r.id === id).builder, true, 'and team.subagents shows it');
    release();
    await new Promise(r => setTimeout(r, 20));
    // a restart: the record is reloaded from disk, marked interrupted, and resumed by the lead
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    const recs = Array.isArray(raw) ? raw : (raw.records || raw.subagents || []);
    for (const r of recs) if (r.id === id) { r.status = 'interrupted'; r.canResume = true; }
    fs.writeFileSync(file, JSON.stringify(raw));
    const reloaded = makeSubagentManager({ fs, pathMod: path, file, clock: { now: () => 1001 }, emit: () => {}, newId: counter() });
    A.eq(reloaded.get(id).builder, true, 'the lend survives a sidecar restart');
    const rcalls = [];
    const ro2 = async (o) => { rcalls.push(o); return { reason: 'done', messages: [{ role: 'assistant', content: 'resumed' }], usd: 0 }; };
    const { resumeTool } = makeOrchestrationTools({ runOnce: ro2, roster: () => roster, key: 'k', model: 'm', newId: counter(), subagents: reloaded });
    await resumeTool.run({ id }, leadCtx(LEAD));
    await new Promise(r => setTimeout(r, 20));
    A.eq(types(rcalls[0]), ['builder', 'workbench'], 'team.resume restarts the Build Manager WITH its lent builder');
    // resumed by a lead that cannot build: the worker restarts without it (a lend never widens)
    for (const r of recs) if (r.id === id) { r.status = 'interrupted'; r.canResume = true; }
    fs.writeFileSync(file, JSON.stringify(raw));
    const again = makeSubagentManager({ fs, pathMod: path, file, clock: { now: () => 1002 }, emit: () => {}, newId: counter() });
    const rcalls2 = [];
    const ro3 = async (o) => { rcalls2.push(o); return { reason: 'done', messages: [{ role: 'assistant', content: 'resumed' }], usd: 0 }; };
    await makeOrchestrationTools({ runOnce: ro3, roster: () => roster, key: 'k', model: 'm', newId: counter(), subagents: again }).resumeTool.run({ id }, Object.assign(leadCtx(WORKER_ONLY), { agentId: 'lead' }));
    await new Promise(r => setTimeout(r, 20));
    A.eq(types(rcalls2[0]), ['workbench'], 'resumed by a run that cannot build, it restarts without the builder');
  } finally { fs.rmSync(root, { recursive: true, force: true }); }
}

/* ---- 4. the delegated planner: binds refused here, recruits refused by the page, and builds carry the builder ---- */
{
  const asked = [];
  const bridge = { request: async (verb, args) => {
    asked.push({ verb, args });
    if (verb === 'station.plan_edit' || verb === 'station.plan_line') return { ok: true, result: { planId: 'p1', summary: 'a plan', steps: [] } };
    if (verb === 'station.build') return { ok: true, result: { built: true, rooms: [{ name: 'LAB' }] } };
    return { ok: false, error: 'unknown verb' };
  } };
  const base = { station: bridge, now: () => 1000, planMemo: new Map(), lineMenu: () => [], styleMenu: () => [], roomMenu: () => [], kitMenu: () => [], presetMenu: () => [] };
  const lead = makeStationTools(base);
  const lent = makeStationTools(Object.assign({}, base, { agentId: 'builder', delegatedBy: 'lead', agentName: 'FORGE', lenderName: 'NOVA' }));
  const bind = { refit: [{ op: 'place', t: 'connector_portal', x: 3, y: 3, as: 'P' }, { op: 'bind', prop: 'P', connector: 'gmail' }] };

  const r1 = await lent.planTool.run(bind);
  A.ok(/^REFUSED: binding a connector portal or plugin terminal grants live tools, so it stays with NOVA, who lent you the builder/.test(r1.content), 'a lent planner refuses a bind, and names who holds it the way the crew knows them: ' + r1.content);
  A.eq(asked.length, 0, 'the refused bind never reached the page');
  const r1b = await lent.planTool.run({ refit: [{ op: ' BIND ', prop: 'P' }] });
  A.ok(/^REFUSED: binding/.test(r1b.content), 'the bind check reads the op the way the page does (case and spaces)');

  await lent.planTool.run({ refit: [{ op: 'place', t: 'plant', x: 2, y: 2 }] });
  A.eq(asked[0], { verb: 'station.plan_edit', args: { request: { refit: [{ op: 'place', t: 'plant', x: 2, y: 2 }] }, delegated: true } }, 'a lent plan reaches the page marked delegated (so the page refuses recruits)');
  await lent.planTool.run({ line: 'build_test', delegated: false });
  A.eq([asked[1].verb, asked[1].args.delegated, asked[1].args.request.delegated], ['station.plan_line', true, false], 'the model cannot unmark it: delegated is the host\'s, outside the request it writes');

  // the approval card's words: a lent plan names its builder and its lender on the first line; the lead's plan does not
  A.eq(planSummaryFrom(base.planMemo, 'p1').split('\n')[0], 'FORGE\'s plan, on the builder NOVA lent it: a plan', 'the card names whose plan it is and who lent the builder');

  await lead.planTool.run(bind);
  A.eq(planSummaryFrom(base.planMemo, 'p1').split('\n')[0], 'a plan', 'a plan the lead made itself reads exactly as before');
  A.eq(asked[2], { verb: 'station.plan_edit', args: { request: bind } }, 'the lead\'s own plan is byte-identical to before (binds allowed, no delegated flag)');

  await lent.buildTool.run({ planId: 'p1' });
  A.eq(asked[3], { verb: 'station.build', args: { planId: 'p1', by: 'builder' } }, 'a lent build names its builder for the page\'s toast');
  await lead.buildTool.run({ planId: 'p1' });
  A.eq(asked[4], { verb: 'station.build', args: { planId: 'p1' } }, 'the lead\'s build is unchanged');
}

/* ---- 4b. the page's planner: a delegated plan never recruits, and says who decides ---- */
{
  const M = require('../frontend/app/worldmodel.js'), P = require('../frontend/app/pipeline.js'), W = require('../frontend/app/workflowline.js');
  const SB = require('../frontend/app/stationbuilder.js'), Sprites = require('../frontend/app/propsprites.js');
  M.setPropRules(t => { const s = Sprites.spec(t); return s ? { mount: s.mount || null, stack: !!s.stack, surface: !!s.surface, flat: !!s.flat } : null; });
  const st = M.create(M.starterDoc()); st.ensureWorkstation('agent');
  const env = { WorldModel: M, Pipeline: P, WorkflowLine: W, crew: [{ id: 'agent', name: 'NOVA' }], heroId: 'agent' };
  const recruitEnv = Object.assign({}, env, { canRecruit: true, recruit: () => null });
  const ok = SB.plan(st.serialize(), { line: 'build_test', steps: [{ step: 2, agent: 'new' }] }, recruitEnv);
  A.ok(ok.ok && /a new recruit/.test(ok.plan.summary), 'fixture: the lead\'s page recruits on "new": ' + (ok.error || ''));
  const lentEnv = Object.assign({}, env, { canRecruit: false, recruitRefusal: 'Recruiting new crew stays with the lead who lent you the builder. Staff the step with a crew member, or leave agent out and name the role in your result.' });
  const no = SB.plan(st.serialize(), { line: 'build_test', steps: [{ step: 2, agent: 'new' }] }, lentEnv);
  A.ok(!no.ok && /^Recruiting new crew stays with the lead who lent you the builder\./.test(no.error), 'a delegated plan refuses "new" and says who decides: ' + no.error);
  const plain = SB.plan(st.serialize(), { line: 'build_test', steps: [{ step: 2, agent: 'new' }] }, env);
  A.ok(!plain.ok && /Recruiting is not available on this page/.test(plain.error), 'a page with no recruit seam keeps its old words');
  // the page module wires it: builderReady(a) turns recruiting off for a delegated request and passes the words
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationcommands.js'), 'utf8');
  A.ok(/canRecruit: !\(a && a\.delegated\) && /.test(src) && /recruitRefusal: a && a\.delegated \? 'Recruiting new crew stays with the lead who lent you the builder\./.test(src), 'stationcommands builderReady reads the delegated mark');
  for (const v of ['station.plan_line', 'station.plan_room', 'station.plan_build', 'station.plan_restyle', 'station.plan_edit'])
    A.ok(new RegExp("'" + v.replace('.', '\\.') + "': (?:async )?\\(a\\) => \\{\\n      const \\{ st, env \\} = builderReady\\(a\\);").test(src), v + ' passes its request to builderReady');
  A.ok(/const by = a && a\.by \? String\(a\.by\) : '', builder = \(env\.crew \|\| \[\]\)\.find\(x => x\.id === \(by \|\| env\.heroId\)\);/.test(src), 'the build toast names the builder the sidecar passed');
}

A.report('builder-lend.test');
})().catch(e => { console.error(e); process.exit(1); });
