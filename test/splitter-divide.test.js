/* test/splitter-divide.test.js — the splitter fixes of 2026-10-10 ("the splitter is bugged, I've tried everything"), driven
   through the REAL worldmodel + compiler + router + chain runner (fake harness, fake clock — no provider):
     1. a TAKE TURNS turn goes only to a branch whose bay has an agent (an empty branch used to swallow it, and the job left
        the line for the chat's own agent);
     2. PARALLEL CREW ships: its branches meet at a MERGER that reaches an OUTBOX;
     3. SPLIT THE JOB: the step before a dividing splitter is told to write n numbered parts, each branch is handed ONLY its
        own part, the JOINER combines them; fewer parts run on fewer branches and the joiner never waits for the rest;
     4. Pipeline.divideJob reads the parts back deterministically. */
'use strict';
const A = require('./_assert.js');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');
const LE = require('../frontend/app/lineedit.js');
const { makeRouter } = require('../sidecar/routing/router.js');
const { makeChainRunner } = require('../sidecar/routing/chain.js');

function stamp(id, crew) {
  const s = WM.create(), z = s.rooms()[0].rects[0];
  s.addRoom({ kind: 'hab', rect: { x1: z.x2 + 1, y1: z.y1, x2: z.x2 + 40, y2: z.y1 + 30 } });
  let ok = null;
  for (let y = z.y1; y < z.y1 + 25 && !ok; y++) for (let x = z.x1; x < z.x2 + 30 && !ok; x++) { const r = s.stampBlueprint(id, x, y); if (r.ok) ok = r; }
  A.ok(!!ok, 'fixture: ' + id + ' stamps');
  s.props().filter(p => p.t === 'bay').forEach((b, i) => { const a = crew ? crew(i, b) : 'a' + i; if (a) s.assignPropAgent(b.id, a); });
  return s;
}
const routerFor = s => { const r = makeRouter(), plan = P.compileRoutingPlan(s.projectGeometry()); const set = r.setPlan(plan); if (!set.ok) throw new Error('plan refused ' + JSON.stringify(plan.errors)); return { r, plan }; };

/* ---------- 1. an empty branch never takes a turn ---------- */
{
  const one = stamp('parallel_crew', i => (i === 0 ? 'nova' : null)), R1 = routerFor(one).r;
  const got = []; for (let i = 0; i < 6; i++) { const d = R1.resolveDock({ tag: 'general' }); got.push(d ? d.agentId : 'NONE'); }
  A.eq(got, ['nova', 'nova', 'nova', 'nova', 'nova', 'nova'], '1 of 3 crewed: every job stays on the line, at the crewed bay');
  const two = stamp('parallel_crew', i => (i < 2 ? 'a' + i : null)), R2 = routerFor(two).r;
  const g2 = []; for (let i = 0; i < 4; i++) g2.push(R2.resolveDock({ tag: 'general' }).agentId);
  A.ok(g2.every(Boolean) && new Set(g2).size === 2 && g2[0] !== g2[1] && g2[0] === g2[2], '2 of 3 crewed: the two crewed bays take turns (' + g2.join(',') + ')');
  const all = stamp('parallel_crew'), R3 = routerFor(all).r;
  const g3 = []; for (let i = 0; i < 3; i++) g3.push(R3.resolveDock({ tag: 'general' }).agentId);
  A.eq(new Set(g3).size, 3, 'all crewed: three jobs, three agents');
  const none = stamp('parallel_crew', () => null), plan0 = P.compileRoutingPlan(none.projectGeometry());
  A.eq(P.resolveDock(plan0, { tag: 'general' }, (k, n) => 0), null, 'none crewed: nobody, exactly as before');
}

/* ---------- 2. PARALLEL CREW ships ---------- */
{
  const s = stamp('parallel_crew'), plan = P.compileRoutingPlan(s.projectGeometry());
  A.eq(plan.errors.length, 0, 'PARALLEL CREW crewed compiles clean');
  const sk = Object.keys(plan.junctions).find(k => plan.junctions[k].kind === 'split');
  const lanes = P.rejoinOf(plan, sk).lanes;
  A.ok(lanes.length === 3 && lanes.every(l => l.kind === 'merge' && l.at === lanes[0].at), 'its three branches meet at one MERGER');
  const R = routerFor(s).r;
  A.ok(s.props().filter(p => p.t === 'bay').every(b => R.chainShipsToOutbox(b.agentId, b.id)), 'every branch ships to the OUTBOX');
}

/* ---------- 4. divideJob ---------- */
{
  A.eq(P.divideJob('Plan:\n1. alpha\n   more alpha\n2. beta\n3. gamma', 3), ['1. alpha\nmore alpha', '2. beta', '3. gamma'], 'a numbered list, continuation lines kept');
  A.eq(P.divideJob('1. a\n2. b\n3. c\n4. d\n5. e', 2), ['1. a\n2. b', '3. c\n4. d\n5. e'], 'more items than branches: contiguous groups');
  A.eq(P.divideJob('**Part 1:** one\n**Part 2:** two', 3), ['1. one', '2. two'], 'fewer items than branches: only what is there');
  A.eq(P.divideJob('1) x\n2) y\n\nThanks, hope that helps', 2), ['1. x', '2. y'], 'a blank line then prose ends the last part');
  A.eq(P.divideJob('1. old\n2. old\nthen\n1. new\n2. new\n3. new', 3), ['1. new', '2. new', '3. new'], 'the LAST numbered run wins');
  A.eq(P.divideJob('PART 1: a\nPART 2: b\n\n1. note\n2. note\n3. note', 3), ['1. a', '2. b'], 'PART lines win over any other list');
  // LIVE (2026-10-10, gemini flash lite): the planner did the job as a list, then added a list of remarks
  A.eq(P.divideJob('The facts:\n\n1. Octopus: x\n2. Crow: y\n3. Tardigrade: z\n\n1. CREW: I checked.\n2. CREW 2: fine.\n3. CREW 3: no file.', 3), ['1. Octopus: x', '2. Crow: y', '3. Tardigrade: z'], 'two lists of n: the first one, not the remarks after it');
  A.eq(P.divideJob('no list at all', 3), null, 'no list: null');
  A.eq(P.divideJob('1. only one', 3), null, 'one item: nothing to divide');
}

/* ---------- 3. SPLIT THE JOB, end to end ---------- */
(async () => {
  // RESEARCH SWARM + a PLANNER step in front of its splitter, and the splitter set to divide
  const s = stamp('swarm_synthesis', (i, b) => b.role === 'ANALYST' ? 'analyst' : 'r' + i);
  const intake = s.props().find(p => p.t === 'intake'), split = s.props().find(p => p.t === 'splitter');
  const ins = LE.run(s, intake.id, 'insertStep', { from: intake.id, to: split.id, role: 'PLANNER' }, { near: { x: split.x, y: split.y } });
  A.ok(ins && ins.ok, 'a PLANNER step goes in between the INBOX and the splitter (' + JSON.stringify(ins && (ins.error || ins.msg)) + ')');
  const planner = s.props().find(p => p.t === 'bay' && p.role === 'PLANNER');
  A.ok(!!planner, 'the PLANNER bay exists');
  s.assignPropAgent(planner.id, 'planner');
  const before = P.compileRoutingPlan(s.projectGeometry());
  const sk = Object.keys(before.junctions).find(k => before.junctions[k].kind === 'split');
  A.ok(before.junctions[sk].fanout && !before.junctions[sk].divide, 'a copying split before the switch');
  const sw = s.setSplitDivide(split.id, true);
  A.ok(sw.ok && sw.divide, 'setSplitDivide turns it on');
  const { r: router, plan } = routerFor(s);
  A.ok(plan.junctions[sk].divide === true && plan.junctions[sk].fanout === true, 'the compiled split divides');
  const brief = router.stageBrief('planner', planner.id);
  A.ok(/do NOT do it yourself\. 3 agents after you each take one part/.test(brief || '') && /PART 1: .*\nPART 2: .*\nPART 3: /.test(brief), 'the PLANNER is told to write exactly 3 PART lines, and not to do the work');
  A.ok(!/DIVIDE THE WORK/.test(router.stageBrief('r1') || ''), 'a branch is not told to divide');

  const log = [];
  const script = {
    planner: { text: 'Here is how to split it:\n1. Research pricing\n2. Research reviews\n3. Research competitors', usd: 0.01 },
    analyst: { text: 'combined answer', usd: 0.01 },
  };
  const runAgent = async ({ agentId, text }) => { log.push({ agentId, text }); return script[agentId] || { text: agentId + ' did ' + ((/YOUR PART \(\d of \d\):\n([^\n]*)/.exec(text) || [])[1] || '?'), usd: 0.01 }; };
  const c = makeChainRunner({
    nextAgent: (a, ctx) => router.chainNext(a, ctx), stepAgent: (a, ctx) => router.chainStep(a, ctx),
    stepDock: (d, ctx) => router.chainStepDock(d, ctx), entryDockOf: a => router.entryDockOf(a),
    fanSiblings: a => router.fanSiblings(a), fanSiblingsDock: d => router.fanSiblingsDock(d),
    lineOfAgent: (a, d) => router.lineOfAgent(a, d), stageBrief: (a, d) => router.stageBrief(a, d),
    runAgent, emit: () => {}, now: (() => { let t = 0; return () => (t += 10); })(), setTimer: () => 0
  });
  const lineId = router.lineOfAgent('planner', planner.id);
  const res = await c.advance({ agentId: 'planner', dockId: planner.id, text: script.planner.text, originalText: 'research the market for X', lineId, runId: 'd1' });
  A.eq(res.stopped, null, 'the divided line runs to its end (' + res.stopped + ')');
  A.eq(res.divided, 3, 'the job was divided into 3 parts');
  const branchTurns = log.filter(l => /^r\d$/.test(l.agentId));
  A.eq(branchTurns.length, 3, 'three branches ran');
  const parts = branchTurns.map(l => (/YOUR PART \(\d of \d\):\n([^\n]*)/.exec(l.text) || [])[1]).sort();
  A.eq(parts, ['1. Research pricing', '2. Research reviews', '3. Research competitors'].sort(), 'each branch got a DIFFERENT part — together, all of them');
  A.ok(branchTurns.every(l => /YOUR PART \(\d of 3\)/.test(l.text) && /Do ONLY your part/.test(l.text)), 'each is told to do only its part');
  // (no LAST-stage check here: this runner wires no lastStage and these branches feed a bound ANALYST, so it could never fail —
  //  the 2026-10-10 law "no divided branch is told it is the LAST stage" is pinned in test/chain-audit-1010.test.js section 4)
  A.ok(branchTurns.every(l => l.text.indexOf('YOUR PART') < l.text.indexOf('the whole request was')), 'its part comes first, the whole request only after, as context');
  const an = log.find(l => l.agentId === 'analyst');
  A.ok(an && /JOINED OUTPUT — 3 of 3 branches delivered/.test(an.text), 'the JOINER combined all three parts for the ANALYST');
  A.eq(res.text, 'combined answer', 'the analyst answer is the result');

  // the PLANNER wrote only two parts: two branches run, the joiner releases at two, nothing waits
  log.length = 0;
  script.planner = { text: '1. Research pricing\n2. Research reviews', usd: 0.01 };
  const res2 = await c.advance({ agentId: 'planner', dockId: planner.id, text: script.planner.text, originalText: 'research X', lineId, runId: 'd2' });
  A.eq(res2.stopped, null, 'two parts on three branches still runs to the end (' + res2.stopped + ')');
  A.eq(log.filter(l => /^r\d$/.test(l.agentId)).length, 2, 'only two branches ran — no part was invented');
  A.ok(/JOINED OUTPUT — 2 of 2 branches delivered/.test((log.find(l => l.agentId === 'analyst') || {}).text || ''), 'the joiner released at two');
  A.eq(c._barrier.size(), 0, 'nothing is left at the barrier');

  // no list at all: every branch has the whole job, and is told why
  log.length = 0;
  script.planner = { text: 'I think this is one job really.', usd: 0.01 };
  const res3 = await c.advance({ agentId: 'planner', dockId: planner.id, text: script.planner.text, originalText: 'do X', lineId, runId: 'd3' });
  A.eq(res3.divided, 0, 'not divided');
  const b3 = log.filter(l => /^r\d$/.test(l.agentId));
  A.ok(b3.length === 3 && b3.every(l => /gave no numbered parts — so every branch has the whole job/.test(l.text)), 'every branch works the whole job and is told why');

  // a branch fails: the others still run and the joiner sends on what came in
  log.length = 0;
  script.planner = { text: '1. a\n2. b\n3. c', usd: 0.01 };
  script.r2 = { error: 'provider down' };
  const res4 = await c.advance({ agentId: 'planner', dockId: planner.id, text: script.planner.text, originalText: 'do X', lineId, runId: 'd4' });
  A.eq(res4.stopped, null, 'a failed branch does not end the job (' + res4.stopped + ')');
  const an4 = log.find(l => l.agentId === 'analyst');
  A.ok(an4 && /2 of 3 branches delivered/.test(an4.text) && /1 branch failed and sent nothing/.test(an4.text), 'the joiner sends on 2 of 3, naming the failed one');
  delete script.r2;

  /* ---------- PARALLEL BRANCHES: with the non-advancing peek wired (as the sidecar wires it), branches that each hand straight
     to the JOINER run AT ONCE ---------- */
  {
    let inflight = 0, peak = 0; const plog = [];
    const slow = async ({ agentId, text }) => {
      plog.push({ agentId, text });
      if (agentId === 'analyst') return { text: 'combined', usd: 0.01 };
      if (/^r\d$/.test(agentId)) { inflight++; peak = Math.max(peak, inflight); await new Promise(r => setTimeout(r, 5)); inflight--; }
      return { text: agentId + ' did ' + ((/YOUR PART \(\d of \d\):\n([^\n]*)/.exec(text) || [])[1] || 'the job'), usd: 0.01 };
    };
    const mk = () => makeChainRunner({
      nextAgent: (a, ctx) => router.chainNext(a, ctx), stepAgent: (a, ctx) => router.chainStep(a, ctx),
      stepDock: (d, ctx) => router.chainStepDock(d, ctx), peekDock: (d, ctx) => router.chainPeekDock(d, ctx), entryDockOf: a => router.entryDockOf(a),
      fanSiblings: a => router.fanSiblings(a), fanSiblingsDock: d => router.fanSiblingsDock(d),
      lineOfAgent: (a, d) => router.lineOfAgent(a, d), stageBrief: (a, d) => router.stageBrief(a, d),
      runAgent: slow, emit: () => {}, now: (() => { let t = 0; return () => (t += 10); })(), setTimer: () => 0
    });
    const pc = mk();
    const rp = await pc.advance({ agentId: 'planner', dockId: planner.id, text: '1. a\n2. b\n3. c', originalText: 'do X', lineId, runId: 'p1' });
    A.eq(rp.stopped, null, 'the parallel divided line runs to its end (' + rp.stopped + ')');
    A.eq(peak, 3, 'all three branches were in flight at once');
    A.eq(plog.filter(l => /^r\d$/.test(l.agentId)).map(l => (/YOUR PART \(\d of \d\):\n([^\n]*)/.exec(l.text) || [])[1]).sort(), ['1. a', '2. b', '3. c'], 'each with its own part');
    const an = plog.find(l => l.agentId === 'analyst');
    A.ok(an && /JOINED OUTPUT — 3 of 3/.test(an.text), 'the joiner combined all three');
    A.eq(rp.hops.filter(h => /^r\d$/.test(h.agentId)).length, 3, 'three branch hops are recorded');
    A.ok(Math.abs(rp.usd - 0.04) < 1e-9, 'every branch is paid for once (' + rp.usd + ')');
    A.eq(pc._barrier.size(), 0, 'nothing is left at the barrier');

    // a failing branch in a parallel batch: the others deliver and the joiner names it
    peak = 0; plog.length = 0;
    const failing = async (c0) => (c0.agentId === 'r2' ? { error: 'boom' } : slow(c0));
    const pf = makeChainRunner({ nextAgent: (a, ctx) => router.chainNext(a, ctx),
      stepDock: (d, ctx) => router.chainStepDock(d, ctx), peekDock: (d, ctx) => router.chainPeekDock(d, ctx), entryDockOf: a => router.entryDockOf(a),
      fanSiblingsDock: d => router.fanSiblingsDock(d), lineOfAgent: (a, d) => router.lineOfAgent(a, d), stageBrief: (a, d) => router.stageBrief(a, d),
      runAgent: failing, emit: () => {}, now: () => 0, setTimer: () => 0
    });
    const rf = await pf.advance({ agentId: 'planner', dockId: planner.id, text: '1. a\n2. b\n3. c', originalText: 'do X', lineId, runId: 'p2' });
    A.eq(rf.stopped, null, 'a failed parallel branch does not end the job (' + rf.stopped + ')');
    const anf = plog.find(l => l.agentId === 'analyst');
    A.ok(anf && /2 of 3 branches delivered/.test(anf.text) && /r2 failed/.test(anf.text), 'the joiner sends on 2 of 3 and names r2');
    A.eq(pf._barrier.size(), 0, 'nothing stranded');

    // ENTRY fan-out (INBOX ▸ SPLITTER directly): the entry dock already ran; its siblings run at once
    const sw = stamp('swarm_synthesis', (i, b) => b.role === 'ANALYST' ? 'analyst' : 'r' + i);
    const { r: rr } = routerFor(sw);
    const entry = rr.resolveDock({ tag: 'general' });
    peak = 0; plog.length = 0;
    const pe = makeChainRunner({ nextAgent: (a, ctx) => rr.chainNext(a, ctx),
      stepDock: (d, ctx) => rr.chainStepDock(d, ctx), peekDock: (d, ctx) => rr.chainPeekDock(d, ctx), entryDockOf: a => rr.entryDockOf(a),
      fanSiblingsDock: d => rr.fanSiblingsDock(d), lineOfAgent: (a, d) => rr.lineOfAgent(a, d), stageBrief: (a, d) => rr.stageBrief(a, d),
      runAgent: slow, emit: () => {}, now: () => 0, setTimer: () => 0
    });
    const re = await pe.advance({ agentId: entry.agentId, dockId: entry.dockId, text: 'entry findings', originalText: 'research X', lineId: rr.lineOfAgent(entry.agentId, entry.dockId), runId: 'p3' });
    A.eq(re.stopped, null, 'the entry fan-out runs to its end (' + re.stopped + ')');
    A.eq(peak, 2, 'the two siblings ran at once');
    const ane = plog.find(l => l.agentId === 'analyst');
    A.ok(ane && /JOINED OUTPUT — 3 of 3/.test(ane.text), 'and the joiner combined all three');
    A.ok(plog.filter(l => /^r\d$/.test(l.agentId)).every(l => l.text === 'research X'), 'an entry sibling gets the original request, as before');
  }

  // turning it off restores COPY TO EACH
  A.ok(s.setSplitDivide(split.id, false).ok, 'off again');
  const plan2 = P.compileRoutingPlan(s.projectGeometry());
  A.ok(!plan2.junctions[sk].divide && plan2.junctions[sk].fanout, 'back to copying');
  s.undo();
  A.ok(P.compileRoutingPlan(s.projectGeometry()).junctions[sk].divide === true, 'one UNDO brings SPLIT THE JOB back');

  // a dividing split fed straight by the INBOX has nobody to write the parts: the compiler keeps it a plain copy
  const bare = stamp('swarm_synthesis');
  bare.setSplitDivide(bare.props().find(p => p.t === 'splitter').id, true);
  const bp = P.compileRoutingPlan(bare.projectGeometry()), bk = Object.keys(bp.junctions).find(k => bp.junctions[k].kind === 'split');
  A.ok(bp.junctions[bk].fanout && !bp.junctions[bk].divide, 'no step before the splitter: it copies (nothing to divide with)');

  // the flag survives a save round-trip
  const doc = JSON.parse(JSON.stringify(s.serialize()));
  const back = WM.create(doc);
  A.ok(back.props().find(p => p.t === 'splitter').divide === true, 'SPLIT THE JOB survives save + load');

  A.report('splitter-divide');
})().catch(e => { console.error(e); process.exit(1); });
