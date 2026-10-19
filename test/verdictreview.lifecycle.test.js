'use strict';
const assert = require('node:assert/strict');
const { makeVerdictReview } = require('../sidecar/verdictreview.js');
const { buildLearningEvidence } = require('../sidecar/learningevidence.js');
const clone = value => JSON.parse(JSON.stringify(value));
async function main() {
  let time = 1000, disk = [], timers = [];
  const opts = { now: () => time, graceMs: 5000, retryMs: 100, maxAttempts: 3,
    setTimeout: (fn, ms) => { const h = { fn, ms, live: true }; timers.push(h); return h; },
    clearTimeout: h => { if (h) h.live = false; },
    onChange: rows => { disk = clone(rows); } };
  const runTimers = async () => { const jobs = timers; timers = []; for (const h of jobs) if (h.live) h.fn(); await Promise.resolve(); await Promise.resolve(); };
  const packet = { agentId: 'a', learningEvidence: { version: 1, source: 'host', tainted: true }, messages: [] };
  const longCorrection = 'Always use CSV. ' + 'x'.repeat(700) + ' Correction: use JSON instead.';
  const a = makeVerdictReview(opts);
  a.stash('r1', packet); a.arm('r1', 'miss', () => { throw new Error('old process must not launch'); }, longCorrection);
  assert.equal(disk[0].state, 'held');
  assert.equal(disk[0].correctionTruncated, true);
  assert.equal(disk[0].correctionOriginalChars, longCorrection.length);
  assert.equal(disk[0].packet.learningEvidence.correction.durableInstructionEligible, false);
  const saved = clone(disk); timers = []; time += 2000;
  const fired = [], b = makeVerdictReview(opts);
  assert.equal(b.restore(saved), 1); assert.equal(b.holding('r1'), true);
  assert.equal(b.resumeHeld(job => { fired.push(job); }), 1);
  assert.equal(timers[0].ms, 3000, 'remaining grace is retained across restart');
  time += 3000; await runTimers();
  assert.equal(fired.length, 1); assert.equal(fired[0].restored, true);
  assert.equal(buildLearningEvidence(fired[0]).correction.durableInstructionEligible, false, 'restored truncated prefix never becomes a complete correction');
  assert.equal(b.holding('r1'), false);
  const completedSnapshot = clone(disk), c = makeVerdictReview(opts);
  assert.equal(c.restore(completedSnapshot), 0, 'persisted completion does not relaunch after restart');
  const corrected = [];
  b.stash('r2', packet); b.arm('r2', 'miss', job => corrected.push(job));
  assert.equal(b.correct('r2', longCorrection, true, 'message').fired, true);
  assert.equal(buildLearningEvidence(corrected[0]).correction.durableInstructionEligible, false, 'correct() preserves late reversal truncation evidence too');
  b.stash('retry', packet);
  let calls = 0;
  b.arm('retry', 'miss', async () => { calls++; return calls > 1; });
  time += 5000; await runTimers();
  assert.equal(calls, 1); assert.equal(b.holding('retry'), true);
  assert.equal(disk.find(r => r.runId === 'retry').reviewStatus, 'pending');
  const retrySnapshot = clone(disk); timers = [];
  const d = makeVerdictReview(opts); d.restore(retrySnapshot);
  assert.equal(d.resumeHeld(() => { calls++; return true; }), 1);
  time += 100; await runTimers();
  assert.equal(calls, 2); assert.equal(d.holding('retry'), false, 'failed launcher retained and resumed exactly once after restart');
  const e = makeVerdictReview(opts); e.stash('exhaust', packet); let attempts = 0;
  e.arm('exhaust', 'miss', () => { attempts++; return false; });
  for (let i = 0; i < 4; i++) { time += 5000; await runTimers(); }
  assert.equal(attempts, 3); assert.equal(disk.find(r => r.runId === 'exhaust').reviewStatus, 'retry-exhausted');
  const many = buildLearningEvidence({ learningEvidence: { version: 1, source: 'host', tainted: true,
    trustedUserMessages: Array.from({ length: 70 }, (_, i) => ({ source: 'interactive-owner', index: i, content: i === 69 ? 'Correction: use JSON.' : 'earlier instruction ' + i })) } });
  assert.equal(many.directives[0].messageIndex, 0);
  assert.equal(many.directives.at(-1).messageIndex, 69);
  assert.equal(many.directives.at(-1).durableInstructionEligible, true);
  assert.ok(many.omissions.directives > 0);
  const mixed = buildLearningEvidence({ learningEvidence: { version: 1, source: 'host', trustedUserMessages: Array.from({ length: 70 }, (_, i) => ({ source: 'interactive-owner', index: i, content: 'trusted-' + i })) },
    messages: Array.from({ length: 100 }, (_, i) => ({ role: 'user', content: 'unattributed-' + i })) });
  assert.equal(mixed.directives.at(-1).text, 'trusted-69', 'unattributed messages cannot evict the newest host correction');
  // A failed state save retries persistence before any provider dispatch.
  timers = [];
  let savesFail = false, failedSaves = 0, recoveredLaunches = 0, recoveryDisk = [];
  const recovery = makeVerdictReview({ ...opts, maxPersistenceAttempts: 3, onChange: rows => {
    if (savesFail) { failedSaves++; throw new Error('expected temporary persistence failure'); }
    recoveryDisk = clone(rows);
  } });
  recovery.stash('recover', packet);
  recovery.arm('recover', 'miss', () => {
    assert.equal(recoveryDisk.find(r => r.runId === 'recover').reviewStatus, 'running');
    recoveredLaunches++; return true;
  });
  savesFail = true; time += 5000; await runTimers();
  assert.equal(recoveredLaunches, 0);
  assert.equal(recovery.snapshot()[0].attempts, 0, 'persistence failure does not consume a model attempt');
  assert.equal(timers.filter(h => h.live).length, 1, 'temporary storage failure keeps a bounded retry scheduled');
  savesFail = false; time += 100; await runTimers();
  assert.equal(recoveredLaunches, 1, 'recovery launches only after a durable running acknowledgment');
  assert.equal(recovery.holding('recover'), false);
  assert.equal(failedSaves, 1);
  timers = []; failedSaves = 0;
  recovery.stash('blocked', packet); recovery.arm('blocked', 'miss', () => { recoveredLaunches++; return true; });
  savesFail = true;
  for (let i = 0; i < 8; i++) { time += 5000; await runTimers(); }
  assert.equal(failedSaves, 3, 'persistent storage failure stops after three save attempts');
  assert.equal(recoveredLaunches, 1, 'persistent failure dispatches no review');
  assert.equal(timers.filter(h => h.live).length, 0, 'no runaway retry timer remains');
  assert.equal(recovery.snapshot()[0].persistenceBlocked, true);
  savesFail = false;
  assert.equal(recovery.correct('blocked', 'Use verified output.', true, 'message').fired, true, 'an explicit new correction can retry after storage recovery');
  assert.equal(recoveredLaunches, 2);
  // Completion persistence retries save only the receipt, never rerun the model.
  timers = []; let completionFailure = true, completionLaunches = 0;
  const completing = makeVerdictReview({ ...opts, onChange: rows => {
    if (rows.some(r => r.runId === 'complete-save' && r.reviewStatus === 'completed') && completionFailure) throw new Error('expected completion persistence failure');
  } });
  completing.stash('complete-save', packet); completing.arm('complete-save', 'miss', () => { completionLaunches++; return true; });
  time += 5000; await runTimers();
  assert.equal(completionLaunches, 1); assert.equal(completing.holding('complete-save'), true);
  completionFailure = false; time += 100; await runTimers();
  assert.equal(completionLaunches, 1); assert.equal(completing.holding('complete-save'), false);
  // A run end parks one packet: it must not recompact (and re-scrub) every other parked packet on each save, and a
  // stash/take save says nothing waits on its acknowledgement, so the host may batch it (skills-eval-09).
  {
    const { compactPacket } = require('../sidecar/verdictreview.js');
    let scrubs = 0; const acks = []; let lastRows = [];
    const countScrub = t => { scrubs++; return String(t).replace(/sk-live-\w+/g, '[redacted]'); };
    const run = i => ({ agentId: 'a', model: 'm/x', reason: 'done', messages: [
      { role: 'user', content: 'export report ' + i },
      { role: 'assistant', content: '', tool_calls: [{ id: 'c' + i, type: 'function', function: { name: 'fs.write', arguments: JSON.stringify({ path: 'r' + i + '.json', content: 'sk-live-abc' }) } }] },
      { role: 'tool', tool_call_id: 'c' + i, content: 'Saved r' + i + '.json' },
      { role: 'assistant', content: 'Done ' + i } ] });
    const lean = makeVerdictReview({ ...opts, redact: countScrub, onChange: (rows, meta) => { lastRows = clone(rows); acks.push(meta && meta.ack); } });
    for (let i = 0; i < 6; i++) lean.stash('lean' + i, run(i));
    scrubs = 0; compactPacket(run(6), countScrub); const one = scrubs;
    scrubs = 0; lean.stash('lean6', run(6));
    assert.ok(one > 0 && scrubs === one, 'parking a 7th packet compacts only that packet (' + scrubs + ' scrubs, one packet = ' + one + ')');
    assert.deepEqual(lastRows.map(r => r.packet), [0, 1, 2, 3, 4, 5, 6].map(i => clone(compactPacket(run(i), countScrub))), 'the saved rows are exactly the compacted packets');
    assert.deepEqual(acks.slice(-1), [false], 'a stash save is not acknowledged work');
    lean.arm('lean0', 'miss', () => true, 'Use JSON.');
    assert.equal(acks.at(-1), true, 'arming waits on a verified save');
    const heldRow = lastRows.find(r => r.runId === 'lean0');
    const fresh = compactPacket(Object.assign({}, run(0), { runId: 'lean0', verdict: 'miss', correction: 'Use JSON.', correctionOriginalChars: 9,
      correctionTruncated: false, correctionSource: 'verdict', firedBy: 'snapshot', reviewAttempt: 0 }), countScrub);
    assert.deepEqual(heldRow.packet, clone(fresh), 'a held row persists the same evidence a fresh compaction gives');
    assert.equal(lean.correct('lean0', 'Bullets only.', false, 'chip').ok, true);
    assert.equal(lastRows.find(r => r.runId === 'lean0').packet.learningEvidence.correction.text, 'Use JSON. · Bullets only.', 'a later correction reaches the saved held row');
    assert.ok(lean.take('lean1', 'ok')); assert.equal(acks.at(-1), false, 'a take save is not acknowledged work');
  }
  // The cached compaction must not freeze redaction at stash time: redact() also scrubs the exact secrets the station
  // holds, read live, so a token stored to the station after its run ended leaves every saved row at the next save.
  {
    const { compactPacket } = require('../sidecar/verdictreview.js');
    const known = new Set(); let gen = 0, scrubs = 0, lastRows = [];
    const scrub = t => { scrubs++; let s = String(t); for (const k of known) s = s.split(k).join('[redacted-secret]'); return s; };
    const late = makeVerdictReview({ ...opts, redact: scrub, redactGeneration: () => gen, onChange: rows => { lastRows = clone(rows); } });
    const leaked = 'plainTokenNoPrefix42';
    const run = id => ({ agentId: 'a', model: 'm/x', reason: 'done', messages: [{ role: 'user', content: 'call the api with ' + leaked + ' ' + id }, { role: 'assistant', content: 'Done with ' + leaked }] });
    late.stash('late-parked', run('p')); late.stash('late-held', run('h')); late.arm('late-held', 'miss', () => true, 'Use JSON.');
    assert.ok(JSON.stringify(lastRows).includes(leaked), 'the token is not a known secret yet');
    known.add(leaked); gen++;
    late.stash('late-next', run('n'));
    assert.equal(lastRows.length, 3);
    assert.ok(!JSON.stringify(lastRows).includes(leaked), 'a secret stored after the run is scrubbed from every saved row at the next save');
    scrubs = 0; compactPacket(run('x'), scrub); const one = scrubs;
    scrubs = 0; late.stash('late-quiet', run('q'));
    assert.ok(one > 0 && scrubs === one, 'an unchanged secret generation still compacts only the new packet (' + scrubs + ' scrubs, one packet = ' + one + ')');
  }
  // A storage block is not carried into a fresh boot: a held row on disk proves a later save worked, so the
  // restarted station reviews the run instead of leaving it parked until the TTL (skills-eval-19).
  {
    timers = []; let diskFull = false, launches = 0, saved = [];
    const sick = makeVerdictReview({ ...opts, maxPersistenceAttempts: 3, onChange: rows => { if (diskFull) throw new Error('expected disk-full save failure'); saved = clone(rows); } });
    sick.stash('sick', packet); sick.arm('sick', 'miss', () => { launches++; return true; });
    diskFull = true;
    for (let i = 0; i < 8; i++) { time += 5000; await runTimers(); }
    assert.equal(launches, 0); assert.equal(sick.snapshot()[0].persistenceBlocked, true);
    diskFull = false; sick.stash('later', packet);
    assert.equal(saved.find(r => r.runId === 'sick').persistenceBlocked, true, 'a later save writes the blocked held row');
    timers = [];
    const rebooted = makeVerdictReview(opts);
    assert.equal(rebooted.restore(saved), 2);
    assert.equal(rebooted.resumeHeld(() => { launches++; return true; }), 1, 'the restored held review is scheduled');
    time += 100; await runTimers();
    assert.equal(launches, 1, 'the run is reviewed exactly once after the restart');
    assert.equal(rebooted.holding('sick'), false);
  }
  console.log('verdictreview.lifecycle: held snapshot/restart, remaining grace, late reversal, launcher retry/restart, bounded attempts, latest host correction PASS');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
