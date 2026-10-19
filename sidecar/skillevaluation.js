/* Behavioral skill comparisons. Test manifests and runners are HOST inputs, never
   supplied by a candidate. Receipts grant no tool authority and approve nothing. */
'use strict';
const crypto = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');
const SCHEMA = 'starnet.skill-evaluation.v1';
const KEY = 'skill-evaluation-receipts';
const MAX_CASES = 12, MAX_CHECKS = 24, MAX_RECEIPTS = 200;
const MAX_SUITE_BYTES = 262144, MAX_OBSERVATION_BYTES = 524288, MAX_RECEIPT_BYTES = 524288, MAX_STORE_BYTES = 8388608;
const unsafeKeys = new Set(['__proto__', 'prototype', 'constructor']);
function jsonSize(value) { try { const json = JSON.stringify(value); return typeof json === 'string' ? Buffer.byteLength(json) : Infinity; } catch (_) { return Infinity; } }
function validJson(value, depth = 0) {
  if (depth > 16) return false;
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (!value || typeof value !== 'object') return false;
  if (Array.isArray(value)) return value.length <= 4096 && value.every(v => validJson(v, depth + 1));
  if (![Object.prototype, null].includes(Object.getPrototypeOf(value))) return false;
  return Object.keys(value).length <= 1024 && Object.keys(value).every(k => !unsafeKeys.has(k) && validJson(value[k], depth + 1));
}
function safePath(value) {
  return typeof value === 'string' && value.length > 0 && value.length <= 240 && !/[\\:\x00-\x1f]/.test(value) && !value.startsWith('/') &&
    value.split('/').every(part => part && part !== '.' && part !== '..' && !unsafeKeys.has(part));
}
function identifier(value) { return typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,119}$/.test(value); }
function nonemptyText(value, max) { return typeof value === 'string' && !!value.trim() && Buffer.byteLength(value) <= max; }
const clone = value => JSON.parse(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])]));
  return value;
}
function digest(value) { return crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex'); }
function digestSkill(skill) {
  if (!skill) return digest(null);
  const s = skill.skill || skill;
  const files = Array.isArray(s.files) ? s.files : Object.entries(s.files || {}).map(([path, f]) => ({ path, ...f }));
  return digest({
    name: s.name || '', summary: s.summary || '', description: s.description || s.summary || '', category: s.category || '',
    body: s.body || '', setup: s.setup || '', requires: s.requires || [], platforms: s.platforms || [],
    // stale is the aging clock, not behavior (the runner loads stale and active alike): using a stale skill flips it
    // active, and that must not orphan a pending revision or its receipt. archived stays distinct: it is content.
    state: s.state === 'stale' ? 'active' : (s.state || 'active'), absorbedInto: s.absorbedInto || '',
    scope: s.scope || 'agent', projectRoot: s.projectRoot || '',
    files: files.map(f => ({ path: f.path, encoding: f.encoding || 'utf8', content: f.content || '' })).sort((a, b) => a.path.localeCompare(b.path)),
    packageFiles: (s.packageFiles || []).map(f => ({ path: f.path, encoding: f.encoding || 'base64', content: f.content || '' })).sort((a, b) => a.path.localeCompare(b.path))
  });
}
function validateSuite(suite) {
  if (jsonSize(suite) > MAX_SUITE_BYTES || !validJson(suite)) throw new Error('evaluation suite must be bounded safe JSON');
  if (!suite || !nonemptyText(suite.id, 256) || /[\x00-\x1f]/.test(suite.id) || !nonemptyText(suite.skillName, 200)) throw new Error('evaluation suite must identify its task family and skillName');
  if (!Number.isInteger(suite.version) || suite.version < 1) throw new Error('evaluation suite requires a positive integer version');
  if (!Array.isArray(suite.cases) || suite.cases.length < 2 || suite.cases.length > MAX_CASES) throw new Error('evaluation needs 2 to 12 independently declared cases');
  if (!suite.cases.some(c => c && c.heldOut === true)) throw new Error('evaluation needs a held-out case');
  const ids = new Set();
  for (const c of suite.cases) {
    if (!c || !identifier(c.id) || ids.has(c.id) || !nonemptyText(c.prompt, 16384) || (c.heldOut != null && typeof c.heldOut !== 'boolean')) throw new Error('invalid or duplicate evaluation case');
    ids.add(c.id);
    if (c.fixtures != null && (!c.fixtures || Array.isArray(c.fixtures) || typeof c.fixtures !== 'object' || Object.keys(c.fixtures).length > 16 ||
      Object.entries(c.fixtures).some(([path, content]) => !safePath(path) || typeof content !== 'string' || Buffer.byteLength(content) > 65536))) throw new Error('invalid or oversized evaluation fixtures');
    if (c.writablePaths != null && (!Array.isArray(c.writablePaths) || c.writablePaths.length > 16 || c.writablePaths.some(path => !safePath(path)) || new Set(c.writablePaths).size !== c.writablePaths.length)) throw new Error('invalid evaluation writable paths');
    if (!Array.isArray(c.checks) || !c.checks.length || c.checks.length > MAX_CHECKS) throw new Error('each case needs bounded independent task checks');
    const checkIds = new Set();
    for (const check of c.checks) {
      if (!check || !identifier(check.id) || checkIds.has(check.id) || !['json_equal', 'artifact_json_equal', 'artifact_sha256', 'tool_call', 'process_exit'].includes(check.kind)) throw new Error('invalid task check (each needs a unique id and a kind of json_equal, artifact_json_equal, artifact_sha256 or tool_call)');
      checkIds.add(check.id);
      if (check.kind.endsWith('equal') && (!Object.hasOwn(check, 'expected') || jsonSize(check.expected) > 8192)) throw new Error('task equality check needs a bounded declared expected value');
      if (check.kind === 'json_equal' && check.path != null && (!Array.isArray(check.path) || check.path.length > 16 || check.path.some(p => !(typeof p === 'string' && p.length <= 120 && !unsafeKeys.has(p)) && !(Number.isInteger(p) && p >= 0)))) throw new Error('invalid JSON check path');
      if (check.kind.startsWith('artifact_') && !safePath(check.path)) throw new Error('invalid artifact check path');
      if (check.kind === 'artifact_sha256' && (typeof check.expected !== 'string' || !/^[a-f0-9]{64}$/.test(check.expected))) throw new Error('artifact check needs a SHA-256 digest');
      if (check.kind === 'process_exit' && (!Number.isInteger(check.expected) || !identifier(check.executionId))) throw new Error('process check needs a declared execution and exit code');
      if (check.afterLastWriteTo != null && (check.kind !== 'tool_call' || !safePath(check.afterLastWriteTo))) throw new Error('invalid verification ordering path');
      if (check.kind === 'tool_call' && (!identifier(check.name) || !check.arguments || Array.isArray(check.arguments) || typeof check.arguments !== 'object' || jsonSize(check.arguments) > 8192)) throw new Error('tool check needs bounded exact arguments');
    }
  }
  return clone(suite);
}
function getPath(value, parts) {
  let v = value;
  for (const part of (Array.isArray(parts) ? parts : [])) {
    if (!v || typeof v !== 'object' || !Object.hasOwn(v, part)) return undefined;
    v = v[part];
  }
  return v;
}
function assessCheck(check, observation) {
  let actual, present = true;
  if (check.kind === 'json_equal') actual = getPath(observation.value, check.path);
  else if (check.kind === 'artifact_json_equal' || check.kind === 'artifact_sha256') {
    const artifact = observation.artifacts && observation.artifacts[check.path];
    present = typeof artifact === 'string';
    if (present && check.kind === 'artifact_json_equal') {
      try { actual = JSON.parse(artifact); } catch (_) { present = false; }
    } else if (present) actual = crypto.createHash('sha256').update(artifact).digest('hex');
  } else if (check.kind === 'process_exit') {
    const execution = (observation.executions || []).find(e => e.id === check.executionId && e.completed === true);
    actual = execution && execution.exitCode; present = !!execution;
  } else if (check.kind === 'tool_call') {
    const calls = observation.toolCalls || [];
    const finalWrite = check.afterLastWriteTo ? calls.findLastIndex(call => call.name === 'fs.write' && call.ok === true && call.arguments && call.arguments.path === check.afterLastWriteTo) : -1;
    actual = (!check.afterLastWriteTo || finalWrite >= 0) && calls.some((call, i) => i > finalWrite && call.name === check.name && call.ok === true && isDeepStrictEqual(call.arguments, check.arguments));
    return { id: check.id, kind: check.kind, pass: actual, present: true, observedDigest: digest(actual), expectedDigest: digest(true) };
  }
  if (actual === undefined) present = false;
  return { id: check.id, kind: check.kind, pass: present && isDeepStrictEqual(actual, check.expected), observedDigest: present ? digest(actual) : null, expectedDigest: digest(check.expected), present };
}
function assessCase(c, observation) {
  if (!observation || observation.reason !== 'done') return { caseId: c.id, completed: false, pass: false, checks: [], reason: observation && observation.reason || 'missing-observation' };
  if (jsonSize(observation) > MAX_OBSERVATION_BYTES || !validJson(JSON.parse(JSON.stringify(observation)))) return { caseId: c.id, completed: false, pass: false, checks: [], reason: 'observation-limit' };
  try {
    const checks = c.checks.map(check => assessCheck(check, observation));
    return { caseId: c.id, completed: true, pass: checks.every(check => check.pass), checks };
  } catch (_) { return { caseId: c.id, completed: false, pass: false, checks: [], reason: 'invalid-observation' }; }
}
function compareCases(cases) {
  const incomplete = cases.some(c => !c.before.completed || !c.after.completed);
  // Detect check-level regression even when a case was already failing elsewhere.
  const regressions = cases.filter(c => c.before.checks.some((check, i) => check.pass && !(c.after.checks[i] && c.after.checks[i].pass))).map(c => c.caseId);
  const improvements = cases.filter(c => c.before.completed && c.after.completed && c.after.checks.some((check, i) => check.pass && !c.before.checks[i].pass)).map(c => c.caseId);
  const allCandidatePassed = cases.every(c => c.after.pass);
  const status = incomplete ? 'insufficient_evidence' : regressions.length ? 'regression' : !allCandidatePassed ? 'failed' : !improvements.length ? 'insufficient_evidence' : 'passed';
  return { status, regressions, improvements, allCandidatePassed };
}
function validatePromotionReceipt(receipt, options) {
  const o = options || {};
  if (jsonSize(receipt) > MAX_RECEIPT_BYTES || !validJson(receipt)) return { ok: false, reason: 'invalid or oversized evaluation receipt' };
  // insufficient_evidence is read on only so a complete tie can reach the owner-acknowledgement exit below.
  if (!receipt || receipt.schemaVersion !== SCHEMA || !['passed', 'insufficient_evidence'].includes(receipt.status)) return { ok: false, reason: 'behavioral evaluation has not passed' };
  if (!o.suite) return { ok: false, reason: 'trusted evaluation test set is unavailable' };
  let suite;
  try { suite = validateSuite(o.suite); } catch (_) { return { ok: false, reason: 'invalid evaluation test set' }; }
  if (receipt.candidateDigest !== o.candidateDigest || receipt.baselineDigest !== o.baselineDigest) return { ok: false, reason: 'skill contents changed after evaluation' };
  if (!o.runnerDigest || receipt.runnerDigest !== o.runnerDigest) return { ok: false, reason: 'evaluation runner or model changed' };
  if (receipt.testSetDigest !== digest(suite) || receipt.suiteId !== suite.id) return { ok: false, reason: 'evaluation test set changed' };
  if (!['provider', 'executable'].includes(receipt.evidenceClass)) return { ok: false, reason: 'fixture evidence cannot authorize promotion' };
  if (!Array.isArray(receipt.cases) || receipt.cases.length !== suite.cases.length) return { ok: false, reason: 'incomplete evaluation cases' };
  // An unfinished run has no checks to compare; refuse it for what it is before the check-level validation.
  if (receipt.status === 'insufficient_evidence' && receipt.cases.some(c => c && c.before && c.after && (c.before.completed !== true || c.after.completed !== true)))
    return { ok: false, reason: 'not every evaluation run finished; evaluate again' };
  const rebuilt = [];
  for (let i = 0; i < suite.cases.length; i++) {
    const c = suite.cases[i], saved = receipt.cases[i];
    if (!saved || saved.caseId !== c.id || saved.heldOut !== !!c.heldOut) return { ok: false, reason: 'evaluation case mismatch' };
    if (!saved.before || !saved.after || !Array.isArray(saved.before.checks) || !Array.isArray(saved.after.checks) || saved.before.checks.length !== c.checks.length || saved.after.checks.length !== c.checks.length) return { ok: false, reason: 'incomplete evaluation checks' };
    for (const phase of ['before', 'after']) {
      const result = saved[phase];
      for (let j = 0; j < c.checks.length; j++) {
        const expected = c.checks[j].kind === 'tool_call' ? true : c.checks[j].expected;
        const observed = result.checks[j];
        if (!observed || observed.id !== c.checks[j].id || observed.kind !== c.checks[j].kind || observed.expectedDigest !== digest(expected) || (observed.observedDigest !== null && !/^[a-f0-9]{64}$/.test(observed.observedDigest))) return { ok: false, reason: 'evaluation check mismatch' };
        const pass = observed.present === true && observed.observedDigest === digest(expected);
        if (observed.pass !== pass) return { ok: false, reason: 'evaluation check verdict mismatch' };
      }
      if (typeof result.completed !== 'boolean' || result.pass !== (result.completed && result.checks.every(check => check.pass))) return { ok: false, reason: 'evaluation case verdict mismatch' };
    }
    rebuilt.push(saved);
  }
  const comparison = compareCases(rebuilt);
  if (receipt.status === 'passed' && comparison.status === 'passed') return { ok: true, receiptId: receipt.receiptId };
  // The honest exit when a capable baseline leaves nothing to measure: every run finished, nothing regressed and
  // every candidate case passed. Only the owner's explicit acknowledgement accepts it, and the result says so;
  // failed, regressed and incomplete evaluations never qualify.
  const tie = receipt.status === 'insufficient_evidence' && comparison.status === 'insufficient_evidence' && !comparison.regressions.length &&
    comparison.allCandidatePassed && rebuilt.every(c => c.before.completed && c.after.completed);
  if (!tie) return { ok: false, reason: 'candidate did not improve without regression' };
  if (o.acknowledgedNoImprovement !== true) return { ok: false, reason: 'the evaluation showed no measurable improvement; approve it without measured improvement to accept it' };
  return { ok: true, receiptId: receipt.receiptId, acknowledged: true };
}
/* Only an executable runner observes a process exit. The provider and fixture runners work in an isolated file
   workspace, so a process_exit check there could never pass: refuse it before any run, and say why. Exported so the
   suite-registration route refuses it too (it validates without an evaluator). Returns the suite. */
const PROCESS_EXIT_REFUSAL = 'process_exit checks need an executable runner; this station evaluates in an isolated file workspace, so use json_equal, artifact_json_equal, artifact_sha256 or tool_call checks';
function assertSuiteRunnable(suite, evidenceClass) {
  if (evidenceClass !== 'executable' && suite.cases.some(c => c.checks.some(check => check.kind === 'process_exit'))) throw new Error(PROCESS_EXIT_REFUSAL);
  return suite;
}
function makeSkillEvaluator(options) {
  const o = options || {}, suites = new Map((o.suites || []).map(s => { const suite = validateSuite(s); return [suite.id, suite]; }));
  if (typeof o.runCase !== 'function' || !o.io || typeof o.io.get !== 'function' || typeof o.io.set !== 'function') throw new Error('evaluation needs a host runner and durable receipt store');
  const now = typeof o.clock === 'function' ? o.clock : () => 0;
  const evidenceClass = o.evidenceClass || 'fixture';
  const runnerIdentity = clone(o.runnerIdentity || { kind: 'fixture' });
  if (evidenceClass === 'provider' && (!runnerIdentity.provider || !runnerIdentity.model)) throw new Error('provider evaluation requires exact provider and model identity');
  if (evidenceClass === 'executable' && (!runnerIdentity.implementation || !runnerIdentity.version)) throw new Error('executable evaluation requires versioned runner identity');
  const runnerDigest = digest(runnerIdentity);
  const active = new Set();
  // Suites already stored still load above; one this runner cannot observe fails at evaluate, before any run.
  async function evaluate(input) {
    const p = input || {}, suite = suites.get(p.suiteId);
    if (!suite) throw new Error('unknown host evaluation suite');
    assertSuiteRunnable(suite, evidenceClass);
    if (!p.candidate) throw new Error('candidate required');
    const candidate = clone(p.candidate.skill || p.candidate), baseline = p.baseline ? clone(p.baseline.skill || p.baseline) : null;
    if (!candidate || candidate.name !== suite.skillName || (baseline && baseline.name !== candidate.name)) throw new Error('test set does not govern this skill');
    const candidateDigest = digestSkill(candidate), baselineDigest = digestSkill(baseline), testSetDigest = digest(suite);
    const key = candidateDigest + ':' + testSetDigest;
    if (active.has(key)) throw new Error('candidate evaluation already running');
    active.add(key);
    try {
      const cases = [];
      for (const c of suite.cases) {
        const row = { caseId: c.id, heldOut: !!c.heldOut };
        for (const [phase, skill] of [['before', baseline], ['after', candidate]]) {
          if (p.signal && p.signal.aborted) throw new Error('evaluation cancelled');
          // Checks, expected outputs, and held-out labels never enter the model input.
          const task = { id: c.id, prompt: c.prompt, fixtures: clone(c.fixtures || {}), writablePaths: clone(c.writablePaths || []) };
          let observation;
          try { observation = await o.runCase({ task, skill, phase, signal: p.signal }); }
          catch (_) { observation = { reason: 'runner-error' }; }
          row[phase] = assessCase(c, observation);
        }
        cases.push(row);
      }
      const comparison = compareCases(cases);
      const receipt = { schemaVersion: SCHEMA, suiteId: suite.id, skillName: candidate.name, candidateDigest, baselineDigest, testSetDigest,
        evidenceClass, runnerIdentity, runnerDigest, createdAt: now(), cases, ...comparison };
      if (jsonSize(receipt) > MAX_RECEIPT_BYTES) throw new Error('evaluation receipt exceeds the evidence size limit');
      receipt.receiptId = 'eval-' + digest(receipt).slice(0, 32);
      // Synchronous durable get/set keeps concurrent evaluations from losing receipts.
      const rows = o.io.get(KEY) || [];
      if (!Array.isArray(rows)) throw new Error('evaluation receipt store is invalid');
      const retained = rows.filter(r => r && r.receiptId !== receipt.receiptId && jsonSize(r) <= MAX_RECEIPT_BYTES).concat([receipt]).slice(-MAX_RECEIPTS);
      while (retained.length > 1 && jsonSize(retained) > MAX_STORE_BYTES) retained.shift();
      o.io.set(KEY, retained);
      return clone(receipt);
    } finally { active.delete(key); }
  }
  function getReceipt(id) { const rows = o.io.get(KEY); return Array.isArray(rows) ? clone(rows.find(r => r.receiptId === id) || null) : null; }
  function verifyReceipt(value, expected) {
    const supplied = typeof value === 'string' ? null : value;
    const id = typeof value === 'string' ? value : value && value.receiptId;
    if (!id) return { ok: false, reason: 'host evaluation receipt required' };
    const stored = getReceipt(id);
    if (!stored || (supplied && !isDeepStrictEqual(supplied, stored))) return { ok: false, reason: 'unknown or altered host evaluation receipt' };
    return validatePromotionReceipt(stored, { ...expected, runnerDigest, suite: suites.get(stored.suiteId) });
  }
  function registerSuite(value) {
    const suite = assertSuiteRunnable(validateSuite(value), evidenceClass);
    suites.set(suite.id, suite); return suite.id;
  }
  return { evaluate, verifyReceipt, getReceipt, registerSuite, listSuites: () => Array.from(suites.values()).map(s => ({ id: s.id, skillName: s.skillName, cases: s.cases.length })) };
}
module.exports = { SCHEMA, digestSkill, digestTestSet: digest, validateSuite, assertSuiteRunnable, PROCESS_EXIT_REFUSAL, assessCase, compareCases, validatePromotionReceipt, makeSkillEvaluator };
