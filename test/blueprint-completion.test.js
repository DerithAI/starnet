'use strict';
/* Finished shelf recipes must deliver every supported input type to an OUTBOX, not merely compile clean.
   The old sorter had no output doors, and CODE FOUNDRY's generalist had an open belt end. */
const assert = require('node:assert/strict');
const WM = require('../frontend/app/worldmodel.js');
const P = require('../frontend/app/pipeline.js');
const { makeRouter } = require('../sidecar/routing/router.js');
const { makeChainRunner } = require('../sidecar/routing/chain.js');

(async () => {
  for (const id of ['sorting_office', 'code_foundry']) {
    const s = WM.create();
    assert.ok(s.addRoom({ kind: 'hab', rect: { x1: 30, y1: 0, x2: 69, y2: 14 } }).ok);
    assert.ok(s.stampBlueprint(id, 32, 2).ok);
    s.props().filter(p => p.t === 'bay').forEach((b, i) => s.assignPropAgent(b.id, 'crew' + i));
    const plan = P.compileRoutingPlan(s.projectGeometry());
    assert.deepEqual(plan.errors, []);
    const router = makeRouter();
    assert.ok(router.setPlan(plan).ok);
    const shipped = [];
    const chain = makeChainRunner({
      nextAgent: (a, c) => router.chainNext(a, c),
      stepDock: (d, c) => router.chainStepDock(d, c),
      entryDockOf: a => router.entryDockOf(a),
      lineOfAgent: (a, d) => router.lineOfAgent(a, d),
      lastStage: (a, d) => router.chainShipsToOutbox(a, d),
      onShipped: r => shipped.push(r)
    });
    const outs = {};
    for (const tag of ['code', 'general', 'research']) {
      const entry = router.resolveDock({ tag });
      const lineId = router.lineOriginFor(entry.agentId, entry.dockId);
      const result = await chain.advance({ ...entry, lineId,
        text: 'Entry result.\nVERDICT: approved', originalText: 'Make the result.',
        runAgent: async () => ({ text: 'Reviewed result.\nVERDICT: approved' }) });
      assert.equal(result.stopped, null, id + '/' + tag + ' completes');
      assert.ok(result.outboxId, id + '/' + tag + ' reaches an actual OUTBOX');
      assert.ok(router.chainShipsToOutbox(result.agentId, result.dockId), id + '/' + tag + ' meets the sample completion rule');
      assert.equal(shipped.at(-1).outboxId, result.outboxId, 'SEND TO is notified of the actual result door');
      outs[tag] = result.outboxId;
    }
    assert.notEqual(outs.code, outs.general, id + ': code and generalist outputs retain separate doors');
    assert.equal(outs.general, outs.research, id + ': the default lane also finishes research input');
    // A saved or copied template keeps its finished lanes, not just the original in-memory object.
    const restored = WM.create(s.serialize());
    assert.equal(P.compileRoutingPlan(restored.projectGeometry()).outs.length, 2, id + ': both doors survive save/readback');
  }
  console.log('blueprint-completion: OK — code, general and research jobs reach each finished starter OUTBOX');
})().catch(e => { console.error(e); process.exitCode = 1; });
