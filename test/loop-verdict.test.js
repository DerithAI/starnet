/* test/loop-verdict.test.js — "loop until APPROVED" (2026-08-22): the pure VERDICT parser (sidecar/routing/verdict.js)
   and the chain runner's verdict-keyed LOOP gate, driven through the REAL compiler + REAL router (same rig as
   test/chain.join-loop.test.js). Fake harness, fake clock — no provider. */
'use strict';
const A = require('./_assert.js');
const V = require('../sidecar/routing/verdict.js');
const { makeChainRunner } = require('../sidecar/routing/chain.js');
const { makeRouter } = require('../sidecar/routing/router.js');
const P = require('../frontend/app/pipeline.js');

/* ---- 1. the parser ---- */
A.eq(V.parseVerdict('Looks fine.\nVERDICT: approved'), 'approved', 'plain last line');
A.eq(V.parseVerdict('Looks fine.\n\n**Verdict: Approved.**\n\n'), 'approved', 'markdown bold, case, trailing period, trailing blank lines');
A.eq(V.parseVerdict('- verdict — REVISE'), 'revise', 'bullet + em-dash separator');
A.eq(V.parseVerdict('> VERDICT: rejected'), 'revise', 'a synonym maps to the canonical word');
A.eq(V.parseVerdict('VERDICT: approve\nbut actually\nVERDICT: revise'), 'revise', 'the LAST verdict line wins');
A.eq(V.parseVerdict('VERDICT: approved\nline\nline\nline\nline'), null, 'a verdict buried above the tail does not count (quoting the word is not passing the work)');
A.eq(V.parseVerdict('no verdict here'), null, 'no line = null');
A.eq(V.parseVerdict('VERDICT: maybe'), null, 'an unknown word is not a verdict');
A.eq(V.parseVerdict(''), null); A.eq(V.parseVerdict(null), null);
A.ok(V.isVerdictWord('approved') && V.isVerdictWord('REVISE') && !V.isVerdictWord('code') && !V.isVerdictWord(null), 'isVerdictWord: the two words, any case; never a classifier tag');
A.ok(/"VERDICT: approved"/.test(V.verdictBrief('approved')) && /"VERDICT: revise"/.test(V.verdictBrief('approved')) && /no VERDICT line is treated as "revise"/.test(V.verdictBrief('approved')), 'the reviewer brief names both words and what silence means');
A.eq(V.verdictBrief('code'), '', 'a classifier-tag gate gets no verdict brief');
// R1 (2026-09-27 audit): the VERDICT line is the gate's control signal — it is stripped from the work that leaves an approved gate
const NL = String.fromCharCode(10);
A.eq(V.stripVerdict(['Here is the post.', '', 'VERDICT: approved'].join(NL)), 'Here is the post.', 'the verdict line comes off the work');
A.eq(V.stripVerdict(['post', '**VERDICT: Approved.**', ''].join(NL)), 'post', 'dressed verdicts too');
A.eq(V.stripVerdict('no verdict'), 'no verdict', 'a text without one is unchanged');
const quoted = ['VERDICT: approved', 'line', 'line', 'line', 'line'].join(NL);
A.eq(V.stripVerdict(quoted), quoted, 'a verdict quoted above the tail is not stripped');
A.ok(/lead with the finished work itself/.test(V.verdictBrief('approved')), 'the reviewer is told its approving reply is what moves on');

// the handoff prompt carries the brief as its own paragraph, and is byte-identical without it
const base = P.handoffPrompt('req', 'writer', 'draft', 1, 'be picky');
A.eq(P.handoffPrompt('req', 'writer', 'draft', 1, 'be picky', ''), base, 'an empty verdict brief changes nothing');
A.ok(P.handoffPrompt('req', 'writer', 'draft', 1, 'be picky', V.verdictBrief('approved')).indexOf('be picky\n\nYOUR VERDICT DECIDES') > 0, 'the verdict instruction rides after the standing brief');

/* ---- 2. the gate ---- */
const geo = (props, belts) => ({ props, belts });
const belt = (x, y, dir) => ({ x, y, dir });
let T = 0; const clock = () => (T += 10);
// INBOX -> writer -> reviewer -> LOOP gate -> (done E -> publisher | back N -> writer)
function loopFloor(gateCfg, donePropOverride) {
  const belts = [belt(1, 4, 'E'), belt(2, 4, 'E'), belt(5, 4, 'E'), belt(6, 4, 'E'), belt(7, 4, 'E'), belt(10, 4, 'E'), belt(11, 4, 'E'), belt(12, 4, 'E'),
    belt(13, 4, 'E'), belt(14, 4, 'E'), belt(12, 3, 'N'), belt(12, 2, 'N'), belt(12, 1, 'W')];
  for (let x = 11; x >= 6; x--) belts.push(belt(x, 1, 'W'));
  belts.push(belt(5, 1, 'S'), belt(5, 2, 'S'));
  return geo(
    [{ id: 'p1', t: 'intake', x: 0, y: 4, w: 1, h: 1 },
     { id: 'p2', t: 'bay', x: 3, y: 3, w: 2, h: 2, agentId: 'writer' },
     { id: 'p3', t: 'bay', x: 8, y: 3, w: 2, h: 2, agentId: 'reviewer' },
     Object.assign({ id: 'p5', t: 'loop', x: 12, y: 4, w: 1, h: 1, done: 'E' }, gateCfg || {}),
     donePropOverride || { id: 'p6', t: 'bay', x: 15, y: 3, w: 2, h: 2, agentId: 'publisher' }],
    belts
  );
}
function rig(floor, script, opts) {
  const router = makeRouter();
  const plan = P.compileRoutingPlan(floor);
  const set = router.setPlan(plan);
  if (!set.ok) throw new Error('plan refused: ' + JSON.stringify(plan.errors));
  const log = [];
  const runAgent = async ({ agentId, text, hop, from }) => {
    log.push({ agentId, hop, from, text });
    const r = script[agentId];
    return typeof r === 'function' ? r(text, log) : (r || { text: agentId + ' output', usd: 0.01 });
  };
  const c = makeChainRunner(Object.assign({
    nextAgent: (a, ctx) => router.chainNext(a, ctx),
    stepAgent: (a, ctx) => router.chainStep(a, ctx),
    fanSiblings: (a) => router.fanSiblings(a),
    lineOfAgent: (a) => router.lineOfAgent(a),
    loopGateAfter: (a, l) => router.loopGateAfter(a, l),
    getTag: () => 'general',
    runAgent, emit: () => {}, now: clock, setTimer: () => 0
  }, opts || {}));
  return { c, router, plan, log, lineId: P.lineOf(plan, plan.bays[0].agentId) };
}
const handedText = (entry) => (entry.text.split('produced:\n')[1] || '').split('\n')[0];

(async () => {
  /* revise x2 then approved -> 3 review passes, exits on DONE, no exhaustion mark */
  {
    const verdicts = ['VERDICT: revise', 'VERDICT: revise', 'VERDICT: approved']; let n = 0;
    const R = rig(loopFloor({ maxIter: 5, when: 'approved' }), {
      writer: (t) => ({ text: 'draft ' + (t.match(/pass (\d)/) ? +t.match(/pass (\d)/)[1] + 1 : 1), usd: 0.01 }),
      reviewer: () => ({ text: 'review notes\n\n' + verdicts[n++], usd: 0.01 }),
      publisher: (t) => ({ text: 'published:' + t, usd: 0.01 })
    });
    const g = R.router.loopGateAfter('reviewer', R.lineId);
    A.ok(g && g.when === 'approved', 'router.loopGateAfter: the reviewer lane meets the verdict gate');
    A.eq(R.router.loopGateAfter('writer', R.lineId), null, 'the writer lane meets the reviewer first — no gate');
    const res = await R.c.advance({ agentId: 'writer', text: 'draft 1', originalText: 'write a post', lineId: R.lineId, runId: 'v1' });
    A.eq(res.stopped, null, 'ran to its end (' + res.stopped + ')');
    A.eq(res.hops.map(h => h.agentId).join(','), 'reviewer,writer,reviewer,writer,reviewer,publisher', 'exactly 3 review passes (2 back round), then DONE');
    A.ok(!res.loopExhausted, 'approved = not exhausted');
    A.ok(!/exhausted/.test(res.text), 'the done-lane handoff carries no exhaustion mark');
    A.ok(R.log.filter(l => l.agentId === 'reviewer').every(l => /YOUR VERDICT DECIDES[\s\S]*"VERDICT: approved"/.test(l.text)), 'every reviewer turn is told to end with the verdict line');
    A.ok(R.log.filter(l => l.agentId !== 'reviewer').every(l => !/YOUR VERDICT DECIDES/.test(l.text)), 'the writer and publisher are not');
    A.ok(/\[LOOP — pass 2 of 5/.test(R.log[3].text), 're-entries are numbered');
  }
  /* never approved -> exits on DONE at MAX with the exhaustion marker */
  {
    const R = rig(loopFloor({ maxIter: 2, when: 'approved' }), {
      writer: { text: 'draft', usd: 0.01 },
      reviewer: { text: 'meh\nVERDICT: revise', usd: 0.01 },
      publisher: (t) => ({ text: t, usd: 0.01 })
    });
    const res = await R.c.advance({ agentId: 'writer', text: 'draft', originalText: 'go', lineId: R.lineId, runId: 'v2' });
    A.eq(res.stopped, null, 'ran to its end (' + res.stopped + ')');
    A.eq(res.hops.map(h => h.agentId).join(','), 'reviewer,writer,reviewer,writer,reviewer,publisher', '2 passes back round, then DONE regardless');
    A.ok(res.loopExhausted === true, 'out.loopExhausted is set');
    A.ok(/^\[LOOP — exhausted: 2 passes round the gate at [\d,]+ without VERDICT: approved — leaving on DONE unapproved\]/.test(handedText(R.log[5])), 'the downstream handoff is marked EXHAUSTED (' + handedText(R.log[5]) + ')');
  }
  /* a reviewer that emits NO verdict line is treated as not-approved (goes round), and the DONE lane can be an OUTBOX */
  {
    let k = 0;
    const R = rig(loopFloor({ maxIter: 3, when: 'approved' }, { id: 'p6', t: 'outbox', x: 15, y: 3, w: 2, h: 2 }), {
      writer: { text: 'draft', usd: 0.01 },
      reviewer: () => ({ text: (++k < 2) ? 'no verdict at all' : 'fine\nverdict: APPROVED', usd: 0.01 })
    });
    const res = await R.c.advance({ agentId: 'writer', text: 'draft', originalText: 'go', lineId: R.lineId, runId: 'v3' });
    A.eq(res.stopped, null, 'ran to its end (' + res.stopped + ')');
    A.eq(res.hops.map(h => h.agentId).join(','), 'reviewer,writer,reviewer', 'silence = round again; approval = out');
    // R1 (2026-09-27 audit): what ships never carries the VERDICT line — the line is the gate's control signal. And (2026-10-18) an
    // approval that did not restate the work ("fine") ships THE WORK IT APPROVED: the OUTBOX product is what the channel, the
    // routine and SEND TO deliver, and a bare "fine" there was the line's whole result.
    A.ok(res.text === 'draft' && !res.loopExhausted, 'the delivered answer is the approved work, never the bare approval (' + JSON.stringify(res.text) + ')');
  }
  /* when = revise: the mirror — round while the verdict is not "revise" */
  {
    let k = 0;
    const R = rig(loopFloor({ maxIter: 4, when: 'revise' }), {
      writer: { text: 'd', usd: 0.01 }, reviewer: () => ({ text: (++k < 3) ? 'VERDICT: approved' : 'VERDICT: revise', usd: 0.01 }), publisher: { text: 'p', usd: 0.01 }
    });
    const res = await R.c.advance({ agentId: 'writer', text: 'd', originalText: 'w', lineId: R.lineId, runId: 'v4' });
    A.eq(res.hops.map(h => h.agentId).join(','), 'reviewer,writer,reviewer,writer,reviewer,publisher', 'when=revise exits the moment the verdict says revise');
  }
  /* classifier-tag loops behave exactly as before: round WHILE the tag matches */
  {
    let k = 0;
    const R = rig(loopFloor({ maxIter: 5, when: 'code' }), {
      writer: { text: 'd', usd: 0.01 }, reviewer: { text: 'VERDICT: revise', usd: 0.01 }, publisher: { text: 'p', usd: 0.01 }
    }, { getTag: (t) => (/VERDICT/.test(t) && ++k <= 2) ? 'code' : 'general' });   // the classifier sees EVERY stage's output; only the reviewer's reads as code, twice
    const res = await R.c.advance({ agentId: 'writer', text: 'd', originalText: 'w', lineId: R.lineId, runId: 'v5' });
    A.eq(res.hops.map(h => h.agentId).join(','), 'reviewer,writer,reviewer,writer,reviewer,publisher', 'tag=code twice = 2 passes back, then general leaves on DONE — the verdict line is ignored by a tag gate');
    A.ok(!res.loopExhausted && !/exhausted/.test(res.text), 'a tag gate that stopped matching is not exhausted');
    A.ok(R.log.filter(l => l.agentId === 'reviewer').every(l => !/YOUR VERDICT DECIDES/.test(l.text)), 'a tag gate sends no verdict brief');
  }
  /* a tag gate that matches through MAX is marked exhausted too (the `when` was never unmet) */
  {
    const R = rig(loopFloor({ maxIter: 1, when: 'code' }), { writer: { text: 'd', usd: 0.01 }, reviewer: { text: 'r', usd: 0.01 }, publisher: (t) => ({ text: t, usd: 0.01 }) }, { getTag: () => 'code' });
    const res = await R.c.advance({ agentId: 'writer', text: 'd', originalText: 'w', lineId: R.lineId, runId: 'v6' });
    A.eq(res.hops.map(h => h.agentId).join(','), 'reviewer,writer,reviewer,publisher');
    A.ok(res.loopExhausted && /while the output still read as code/.test(res.text), 'exhaustion mark names the tag');
  }

  /* ---- A TERSE APPROVAL HANDS ON THE WORK IT APPROVED (2026-10-18). Hops no longer replay the line's transcript (resumeSeed:false,
          10-17), so a reviewer that approves without restating the work ("Looks good.") used to hand the next stage ONLY its
          approval — a designer after researcher ▸ reviewer ▸ LOOP got no research — and a gate that ships straight out delivered
          the approval as the line's result. A reviewer that DID restate the work (R1: its fixes become the work) is unchanged. ---- */
  const RESEARCH = 'Three findings on rooftop solar:\n1. Installs grew 34% in 2025 (source: SEIA).\n2. Battery attach rates passed 50% in California.\n3. Permitting delays remain the top soft cost.';
  const upstreamOf = (entry) => (entry.text.split('produced:\n')[1] || '').split('\n\nDo YOUR part')[0];
  const outboxDone = { id: 'p6', t: 'outbox', x: 15, y: 3, w: 2, h: 2 };
  {
    const R = rig(loopFloor({ maxIter: 3, when: 'approved' }), {
      writer: { text: RESEARCH, usd: 0.01 }, reviewer: { text: 'Looks good.\nVERDICT: approved', usd: 0.01 }, publisher: { text: 'the design', usd: 0.01 }
    });
    const res = await R.c.advance({ agentId: 'writer', text: RESEARCH, originalText: 'research rooftop solar', lineId: R.lineId, runId: 'v7' });
    A.eq(res.hops.map(h => h.agentId).join(','), 'reviewer,publisher', 'terse approval: approved on the first pass');
    const handed = upstreamOf(R.log.find(l => l.agentId === 'publisher'));
    A.ok(handed.indexOf(RESEARCH) >= 0, 'terse approval: the next stage is handed the work the reviewer approved (' + JSON.stringify(handed.slice(0, 120)) + ')');
    A.ok(/\nREVIEW:\nLooks good\.$/.test(handed) && !/VERDICT/.test(handed), 'terse approval: ...with the approval notes after it, never the VERDICT line');
    A.ok(!res.loopExhausted && !/exhausted/.test(handed), 'terse approval: nothing is marked exhausted');
  }
  {
    const shippedRecs = [];
    const R = rig(loopFloor({ maxIter: 3, when: 'approved' }, outboxDone), {
      writer: { text: RESEARCH, usd: 0.01 }, reviewer: { text: 'Looks good.\nVERDICT: approved', usd: 0.01 }
    }, { lastStage: (a) => a === 'reviewer', onShipped: (r) => shippedRecs.push(r) });
    const res = await R.c.advance({ agentId: 'writer', text: RESEARCH, originalText: 'research rooftop solar', lineId: R.lineId, runId: 'v8' });
    await new Promise(r => setImmediate(r));
    A.eq(res.stopped, null, 'terse approval to the OUTBOX: ran to its end (' + res.stopped + ')');
    A.eq(res.text, RESEARCH, 'terse approval to the OUTBOX: the line delivers the approved work, never the bare approval');
    A.eq(shippedRecs.length === 1 && shippedRecs[0].text, RESEARCH, 'terse approval to the OUTBOX: SEND TO hands the next line the work too');
  }
  {
    // a SHORT work (one line) beside an approval about as long as it: the reply still does not carry the work
    const TWEET = 'Launch day: StarNet ships review gates.';
    const R = rig(loopFloor({ maxIter: 3, when: 'approved' }, outboxDone), {
      writer: { text: TWEET, usd: 0.01 }, reviewer: { text: 'Great hook, ship it.\nVERDICT: approved', usd: 0.01 }
    });
    const res = await R.c.advance({ agentId: 'writer', text: TWEET, originalText: 'write a launch tweet', lineId: R.lineId, runId: 'v9' });
    A.eq(res.text, TWEET, 'a short work approved tersely ships the work (' + JSON.stringify(res.text) + ')');
  }
  {
    // the reviewer RESTATED the work with its fix applied (what the verdict brief asks for): its reply alone moves on, the work once
    const FIXED = RESEARCH.replace('34%', '34 percent') + '\n\nNotes: spelled out one unit.';
    const R = rig(loopFloor({ maxIter: 3, when: 'approved' }), {
      writer: { text: RESEARCH, usd: 0.01 }, reviewer: { text: FIXED + '\nVERDICT: approved', usd: 0.01 }, publisher: { text: 'the design', usd: 0.01 }
    });
    await R.c.advance({ agentId: 'writer', text: RESEARCH, originalText: 'research rooftop solar', lineId: R.lineId, runId: 'v10' });
    A.eq(upstreamOf(R.log.find(l => l.agentId === 'publisher')), FIXED, 'restated approval: the next stage gets the reviewer\'s version alone, minus its VERDICT line (no second copy)');
    const R2 = rig(loopFloor({ maxIter: 3, when: 'approved' }, outboxDone), { writer: { text: RESEARCH, usd: 0.01 }, reviewer: { text: FIXED + '\nVERDICT: approved', usd: 0.01 } });
    const res2 = await R2.c.advance({ agentId: 'writer', text: RESEARCH, originalText: 'research rooftop solar', lineId: R2.lineId, runId: 'v11' });
    A.eq(res2.text, FIXED, 'restated approval to the OUTBOX: the reviewer\'s version ships, as before');
  }
  A.report('loop-verdict');
})();
