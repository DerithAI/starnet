'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const E = require('../sidecar/skillevaluation.js');
const R = require('../sidecar/skill-evaluation-runner.js');
const { makeReplayProvider } = require('../sidecar/providers/replay.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const clone = v => JSON.parse(JSON.stringify(v));
function store() { const rows = new Map(); return { get: k => clone(rows.get(k) || null), set: (k, v) => rows.set(k, clone(v)) }; }
const suite = { id: 'signed-totals', version: 1, skillName: 'Signed totals', cases: [
  { id: 'credit', prompt: 'Sum signed integer cents.', fixtures: { 'values.json': '[20,-5]' }, checks: [{ id: 'sum', kind: 'json_equal', expected: 15 }] },
  { id: 'held-out-negative', heldOut: true, prompt: 'Sum signed integer cents.', fixtures: { 'values.json': '[-7,2]' }, checks: [{ id: 'sum', kind: 'json_equal', expected: -5 }] }
] };
const baseline = { name: suite.skillName, body: 'values => values.filter(v => v > 0).reduce((a,b) => a+b,0)', state: 'active' };
const candidate = { ...baseline, body: 'values => values.reduce((a,b) => a+b,0)' };
const runnerIdentity = { implementation: 'isolated-javascript-sum', version: '1' };
const io = store();
const runCase = async ({ task, skill }) => {
  assert.equal(task.checks, undefined); assert.equal(task.heldOut, undefined);
  const context = vm.createContext({ values: JSON.parse(task.fixtures['values.json']) }, { codeGeneration: { strings: false, wasm: false } });
  const value = new vm.Script('(' + skill.body + ')(values)').runInContext(context, { timeout: 100 });
  return { reason: 'done', value };
};
async function main() {
  const options = { suites: [suite], runCase, io, evidenceClass: 'executable', runnerIdentity, clock: () => 10 };
  const service = E.makeSkillEvaluator(options);
  const receipt = await service.evaluate({ candidate, baseline, suiteId: suite.id });
  assert.equal(receipt.status, 'passed');
  const expected = { candidateDigest: E.digestSkill(candidate), baselineDigest: E.digestSkill(baseline) };
  assert.equal(service.verifyReceipt(receipt.receiptId, expected).ok, true);
  assert.equal(E.makeSkillEvaluator(options).verifyReceipt(receipt.receiptId, expected).ok, true, 'durable receipt survives service restart');
  const forgery = clone(receipt); forgery.cases[0].after.checks[0].observed = 100;
  assert.equal(service.verifyReceipt(forgery, expected).ok, false);
  assert.equal(service.verifyReceipt('eval-made-up', expected).ok, false);
  assert.equal(service.verifyReceipt(receipt, { ...expected, candidateDigest: E.digestSkill({ ...candidate, body: candidate.body + ' ' }) }).ok, false);
  assert.equal(service.verifyReceipt(receipt, { ...expected, baselineDigest: E.digestSkill(candidate) }).ok, false);
  const movedModel = E.makeSkillEvaluator({ ...options, runnerIdentity: { ...runnerIdentity, version: '2' } });
  assert.equal(movedModel.verifyReceipt(receipt, expected).ok, false);
  service.registerSuite({ ...suite, version: 2 });
  assert.equal(service.verifyReceipt(receipt, expected).ok, false);
  service.registerSuite(suite);
  const tie = await service.evaluate({ candidate, baseline: candidate, suiteId: suite.id });
  assert.equal(tie.status, 'insufficient_evidence');
  const tieExpected = { candidateDigest: expected.candidateDigest, baselineDigest: expected.candidateDigest };
  assert.equal(service.verifyReceipt(tie, tieExpected).ok, false);
  assert.match(service.verifyReceipt(tie, tieExpected).reason, /no measurable improvement/, 'a tie says plainly that nothing was shown to improve');
  // The honest exit: a complete, regression-free run where every candidate case passed may be
  // promoted only on the owner's explicit acknowledgement, and the result says it was acknowledged.
  assert.deepEqual(service.verifyReceipt(tie.receiptId, { ...tieExpected, acknowledgedNoImprovement: true }), { ok: true, receiptId: tie.receiptId, acknowledged: true });
  assert.equal(service.verifyReceipt(tie.receiptId, { ...tieExpected, acknowledgedNoImprovement: 'yes' }).ok, false, 'only an explicit true acknowledges');
  assert.equal(service.verifyReceipt(receipt.receiptId, { ...expected, acknowledgedNoImprovement: true }).acknowledged, undefined, 'a measured improvement is never recorded as merely acknowledged');
  assert.equal(service.verifyReceipt(tie.receiptId, { ...expected, acknowledgedNoImprovement: true }).ok, false, 'acknowledgement keeps the exact skill binding');
  const regression = await service.evaluate({ candidate: baseline, baseline: candidate, suiteId: suite.id });
  assert.equal(regression.status, 'regression');
  assert.equal(service.verifyReceipt(regression, { candidateDigest: E.digestSkill(baseline), baselineDigest: E.digestSkill(candidate), acknowledgedNoImprovement: true }).ok, false, 'acknowledgement never accepts a regression');
  const failed = await service.evaluate({ candidate: baseline, baseline, suiteId: suite.id });
  assert.equal(failed.status, 'failed');
  assert.equal(service.verifyReceipt(failed, { candidateDigest: E.digestSkill(baseline), baselineDigest: E.digestSkill(baseline), acknowledgedNoImprovement: true }).ok, false, 'acknowledgement never accepts a failing candidate');
  const halfRun = E.makeSkillEvaluator({ ...options, runCase: async args => { if (args.phase === 'before') throw new Error('baseline runner unavailable'); return runCase(args); } });
  const incomplete = await halfRun.evaluate({ candidate, baseline: candidate, suiteId: suite.id });
  assert.equal(incomplete.status, 'insufficient_evidence');
  assert.equal(incomplete.allCandidatePassed, true);
  assert.equal(halfRun.verifyReceipt(incomplete, { ...tieExpected, acknowledgedNoImprovement: true }).ok, false, 'acknowledgement never accepts an incomplete evaluation');
  assert.equal(halfRun.verifyReceipt(incomplete, { ...tieExpected, acknowledgedNoImprovement: true }).reason, 'not every evaluation run finished; evaluate again', 'an unfinished run is refused for what it is');
  const broken = E.makeSkillEvaluator({ ...options, runCase: async () => { throw new Error('runner unavailable'); } });
  assert.equal((await broken.evaluate({ candidate, baseline, suiteId: suite.id })).status, 'insufficient_evidence');
  const fixture = E.makeSkillEvaluator({ ...options, evidenceClass: 'fixture' });
  const fixtureReceipt = await fixture.evaluate({ candidate, baseline, suiteId: suite.id });
  assert.equal(fixtureReceipt.status, 'passed');
  assert.equal(fixture.verifyReceipt(fixtureReceipt, expected).ok, false, 'fixture pass cannot promote');
  const fixtureTie = await fixture.evaluate({ candidate, baseline: candidate, suiteId: suite.id });
  assert.equal(fixture.verifyReceipt(fixtureTie, { ...tieExpected, acknowledgedNoImprovement: true }).ok, false, 'fixture tie cannot promote even when acknowledged');
  assert.throws(() => E.validateSuite({ ...suite, cases: suite.cases.map(c => ({ ...c, heldOut: false })) }), /held-out/);
  assert.throws(() => E.validateSuite({ ...suite, cases: [{ ...suite.cases[0], checks: [{ id: 'bad', kind: 'contains_keyword', expected: 'great' }] }, suite.cases[1]] }), /invalid task check/);
  assert.equal(E.digestSkill(candidate), E.digestSkill({ ...candidate, updatedAt: 123, useCount: 9, id: 'other' }));
  assert.notEqual(E.digestSkill(candidate), E.digestSkill({ ...candidate, scope: 'project', projectRoot: 'C:/another' }));
  assert.notEqual(E.digestSkill(candidate), E.digestSkill({ ...candidate, state: 'archived' }));
  assert.equal(E.digestSkill(candidate), E.digestSkill({ ...candidate, state: 'stale' }), 'stale is the aging clock, not content: use must not orphan a revision');
  assert.notEqual(E.digestSkill({ ...candidate, state: 'stale' }), E.digestSkill({ ...candidate, state: 'archived' }), 'a stale skill is still distinct from a retired one');
  assert.notEqual(E.digestSkill(candidate), E.digestSkill({ ...candidate, files: [{ path: 'scripts/sum.js', content: 'different' }] }));
  // Real agent loop + replay transport proves tool observations and workspace isolation,
  // not model quality. The receipt classifier above prevents it authorizing promotion.
  const artifactSuite = R.createArtifactWorkflowSuite('Accounting');
  const task = artifactSuite.cases[0], report = JSON.stringify(task.checks[0].expected);
  const usage = { type: 'usage', usage: { prompt_tokens: 10, completion_tokens: 5, cost: 0 } };
  const turn = (id, name, args) => [{ type: 'tool_start', index: 0, id, name }, { type: 'tool_args', index: 0, chunk: JSON.stringify(args) }, usage, { type: 'done', finishReason: 'tool_calls' }];
  const provider = makeReplayProvider({ turns: [turn('outside', 'fs_write', { path: 'C:/outside.json', content: 'forbidden' }), turn('save', 'fs_write', { path: 'report.json', content: report }), turn('verify', 'fs_read', { path: 'report.json' }), [{ type: 'text', delta: 'Verified the report.' }, usage, { type: 'done', finishReason: 'stop' }]] });
  let recorded = 0;
  const run = R.makeAgentLoopCaseRunner({ provider, runIdPrefix: 'replay-test', model: 'replay/model', cost: makeCostEngine(), clock: { now: () => 1 }, onRun: ({ result }) => { assert.equal(result.accountingIncomplete, false); recorded++; } });
  const observation = await run({ task, skill: { name: 'Accounting', body: 'Use integer cents.' }, phase: 'after' });
  assert.equal(observation.reason, 'done');
  assert.equal(observation.artifacts['C:/outside.json'], undefined);
  assert.equal(observation.toolCalls[0].ok, false);
  assert.equal(E.assessCase(task, observation).pass, true);
  const staleVerification = clone(observation);
  staleVerification.toolCalls.push({ name: 'fs.write', arguments: { path: 'report.json', content: report }, ok: true });
  assert.equal(E.assessCase(task, staleVerification).pass, false, 'read before final write cannot verify the current saved output');
  assert.equal(recorded, 1);
  const denied = R.makeAgentLoopCaseRunner({ provider, runIdPrefix: 'denied-test', authorize: async () => false });
  assert.equal((await denied({ task, skill: candidate, phase: 'after' })).reason, 'policy-denied');
  const malformed = clone(receipt); delete malformed.cases[0].before.checks;
  assert.equal(E.validatePromotionReceipt(malformed, { ...expected, suite, runnerDigest: receipt.runnerDigest }).ok, false);
  const mutated = patch => { const value = clone(suite); patch(value); return value; };
  assert.throws(() => E.validateSuite(mutated(s => { s.cases[0].prompt = 'x'.repeat(16385); })), /invalid/);
  assert.throws(() => E.validateSuite(mutated(s => { s.cases[0].fixtures = { '../escape.json': '{}' }; })), /fixtures/);
  assert.throws(() => E.validateSuite(mutated(s => { s.cases[0].writablePaths = ['C:/escape.json']; })), /paths/);
  assert.throws(() => E.validateSuite(mutated(s => { s.cases[0].fixtures = JSON.parse('{"__proto__":"data"}'); })), /safe JSON/);
  assert.throws(() => E.validateSuite(mutated(s => { s.cases[0].fixtures = { 'input.json': 'x'.repeat(65537) }; })), /fixtures/);
  assert.throws(() => E.validateSuite(mutated(s => { s.cases[0].checks[0].expected = 'x'.repeat(8193); })), /bounded/);
  assert.throws(() => E.validateSuite(mutated(s => { s.extra = 'x'.repeat(262145); })), /bounded/);
  assert.throws(() => E.validateSuite(mutated(s => { s.cases[0].checks[0].path = ['constructor']; })), /safe JSON|path/);
  assert.equal(E.validateSuite(R.createTaskHandoffSuite('Skill with spaces')).skillName, 'Skill with spaces');
  assert.equal(E.assessCase(suite.cases[0], { reason: 'done', value: 'x'.repeat(524289) }).reason, 'observation-limit');
  assert.equal(JSON.stringify(receipt).includes('observedDigest'), true);
  assert.equal(Object.hasOwn(receipt.cases[0].after.checks[0], 'observed'), false, 'receipt excludes raw provider values');
  const runIds = [];
  const failing = R.makeAgentLoopCaseRunner({ provider, runIdPrefix: 'test-evaluation', runAgentLoop: async () => { throw new Error('transport failed after usage'); }, onRun: ({ result, runId }) => { assert.equal(result.accountingIncomplete, true); runIds.push(runId); } });
  assert.equal((await failing({ task, skill: candidate, phase: 'after' })).reason, 'runner-error');
  assert.equal((await failing({ task, skill: candidate, phase: 'after' })).reason, 'runner-error');
  assert.notEqual(runIds[0], runIds[1], 'repeated evaluation ledger run IDs must differ');
  assert.match(runIds[0], /^skill-eval-test-evaluation-/);
  assert.throws(() => R.makeAgentLoopCaseRunner({ provider }), /host runIdPrefix/);
  let dispatches = 0, settled = 0;
  const noDispatch = { provider, runIdPrefix: 'dispatch-test', runAgentLoop: async () => { dispatches++; return { reason: 'done', messages: [], usd: 0 }; }, onRun: async () => { settled++; } };
  const receiptRefused = R.makeAgentLoopCaseRunner({ ...noDispatch, beforeRun: async () => false });
  await assert.rejects(receiptRefused({ task, skill: candidate, phase: 'after' }), /dispatch receipt/);
  const receiptFailed = R.makeAgentLoopCaseRunner({ ...noDispatch, beforeRun: async () => { throw new Error('disk failure'); } });
  await assert.rejects(receiptFailed({ task, skill: candidate, phase: 'after' }), /disk failure/);
  assert.equal(dispatches, 0); assert.equal(settled, 0);
  let preparedId;
  const receiptAccepted = R.makeAgentLoopCaseRunner({ ...noDispatch, beforeRun: async ({ runId }) => { preparedId = runId; assert.equal(dispatches, 0); return true; }, onRun: async ({ runId }) => { assert.equal(runId, preparedId); settled++; } });
  await receiptAccepted({ task, skill: candidate, phase: 'after' });
  assert.equal(dispatches, 1); assert.equal(settled, 1);
  const overfull = store(); overfull.set('skill-evaluation-receipts', Array.from({ length: 30 }, (_, i) => ({ receiptId: 'old-' + i, data: 'x'.repeat(400000) })));
  await E.makeSkillEvaluator({ ...options, io: overfull }).evaluate({ candidate, baseline, suiteId: suite.id });
  assert.ok(Buffer.byteLength(JSON.stringify(overfull.get('skill-evaluation-receipts'))) <= 8388608, 'durable receipt history capped at 8 MiB');
  // The provider runner works in an isolated file workspace and never observes a process exit, so a process_exit
  // check could never pass there: refuse it before any paid run, and say why (skills-eval-16).
  {
    const exitSuite = clone(suite); exitSuite.id = 'owner:exit-code';
    exitSuite.cases[0].checks.push({ id: 'exit', kind: 'process_exit', executionId: 'npm-test', expected: 0 });
    let paid = 0;
    const providerEval = E.makeSkillEvaluator({ suites: [exitSuite], io: store(), evidenceClass: 'provider', runnerIdentity: { provider: 'openrouter', model: 'm/x' },
      runCase: async () => { paid++; return { reason: 'done', value: 15 }; } });
    await assert.rejects(providerEval.evaluate({ candidate, baseline, suiteId: exitSuite.id }), /process_exit checks need an executable runner/);
    assert.equal(paid, 0, 'no paid run for a check this runner cannot observe');
    assert.throws(() => providerEval.registerSuite(exitSuite), /process_exit checks need an executable runner/);
    assert.equal(E.makeSkillEvaluator({ ...options, suites: [exitSuite] }).listSuites()[0].id, 'owner:exit-code', 'an executable runner still takes the suite');
    // The suite-registration route validates without an evaluator: the same refusal is one exported call there.
    assert.throws(() => E.assertSuiteRunnable(E.validateSuite(exitSuite), 'provider'), error => error.message === E.PROCESS_EXIT_REFUSAL, 'the route refuses a process_exit suite for the provider runner');
    assert.equal(E.assertSuiteRunnable(E.validateSuite(exitSuite), 'executable').id, 'owner:exit-code', 'an executable runner can observe the exit');
    assert.equal(E.assertSuiteRunnable(E.validateSuite(suite), 'provider').id, suite.id, 'a suite without process_exit checks is runnable here');
    assert.throws(() => E.validateSuite({ ...suite, cases: [{ ...suite.cases[0], checks: [{ id: 'bad', kind: 'regex', expected: 'x' }] }, suite.cases[1]] }), /kind of json_equal, artifact_json_equal, artifact_sha256 or tool_call/);
  }
  console.log('skill.evaluation: exact executable improvement, held-out regression, restart, tamper/model/test/skill invalidation, fixture refusal, real loop fixture isolation PASS');
}
main().catch(e => { console.error(e); process.exitCode = 1; });
