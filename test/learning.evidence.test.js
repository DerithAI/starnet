'use strict';
const assert = require('node:assert/strict');
const { buildLearningEvidence } = require('../sidecar/learningevidence.js');
const { compactPacket } = require('../sidecar/verdictreview.js');
const SR = require('../sidecar/skillreview.js');
const source = { version: 1, source: 'host', tainted: false, trustedUserMessages: [{ index: 0, source: 'interactive-owner', content: 'Keep all totals in integer cents.' }], checks: [{ id: 'report', kind: 'artifact', status: 'passed', passed: true }] };
const input = { runId: 'r1', learningEvidence: source, loadedSkills: [{ id: 'money', name: 'Accounting', contentDigest: 'abc' }],
  messages: [{ role: 'user', content: 'Keep all totals in integer cents.' },
    { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'fs.write', arguments: JSON.stringify({ path: 'report.json', content: '{"totalCents":45}', secret: 'sk-live', env: { TOKEN: 'secretvalue' } }) } }] },
    { role: 'tool', tool_call_id: 'c1', content: 'Saved report.json' },
    { role: 'assistant', content: 'unrelated detail '.repeat(8000) }],
  toolTrace: [{ callId: 'c1', name: 'fs.write', endedAt: 5, ok: true, isError: false }] };
const e = buildLearningEvidence(input);
assert.equal(e.directives[0].provenance, 'commander');
assert.equal(e.loadedSkills[0].id, 'money');
assert.equal(JSON.parse(e.toolCalls[0].arguments.text).path, 'report.json');
assert.equal(e.toolResults[0].callId, e.toolCalls[0].callId);
assert.equal(e.toolCalls[0].execution, 'succeeded');
assert(!JSON.stringify(e).includes('sk-live'));
assert(!JSON.stringify(e).includes('secretvalue'));
assert.equal(e.verification[0].passed, true);
const roundtrip = compactPacket(JSON.parse(JSON.stringify(compactPacket(input))));
assert.deepEqual(roundtrip.learningEvidence, compactPacket(input).learningEvidence);
assert.equal(roundtrip.learningEvidence.directives[0].text, 'Keep all totals in integer cents.');
assert.equal(JSON.parse(roundtrip.learningEvidence.toolCalls[0].arguments.text).content, '{"totalCents":45}');
const tainted = { ...input, learningEvidence: { ...source, tainted: true }, memories: [{ body: 'EXTERNAL_INJECTION_MEMORY' }],
  messages: [{ role: 'user', content: 'EXTERNAL_INJECTION_ATTACHMENT' }, { role: 'tool', content: 'EXTERNAL_INJECTION_TOOL' }, { role: 'assistant', content: 'EXTERNAL_INJECTION_ASSISTANT' }] };
const prompt = SR.buildPrompt(tainted);
assert(prompt.includes('Keep all totals in integer cents.'));
assert(!prompt.includes('EXTERNAL_INJECTION'));
assert.equal(compactPacket(tainted).messages.length, 0);
assert(!JSON.stringify(compactPacket(tainted)).includes('EXTERNAL_INJECTION'));
assert.equal(buildLearningEvidence({ ...tainted, learningEvidence: { version: 1, source: 'host', tainted: true } }).eligible, false);
// Quoted material the Commander TYPED does not taint the run (review sidecar-index-01), but the host marks its
// evidence trusted-only: the reviewer sees the separately captured owner directive and checks, never the quote.
const quotedOwner = { ...input, learningEvidence: { ...source, trustedOnly: true }, memories: [{ body: 'QUOTED_OWNER_MEMORY' }],
  messages: [{ role: 'user', content: 'The email says:\n> QUOTED_OWNER_MATERIAL' }, { role: 'assistant', content: 'QUOTED_OWNER_ASSISTANT' }] };
const quotedPrompt = SR.buildPrompt(quotedOwner);
assert(quotedPrompt.includes('Keep all totals in integer cents.'), 'the trusted owner directive still reaches the review');
assert(!/QUOTED_OWNER/.test(quotedPrompt), 'quoted owner material never reaches the skill review');
assert.equal(buildLearningEvidence(quotedOwner).trustedOnly, true);
assert.equal(compactPacket(quotedOwner).messages.length, 0);
assert(!JSON.stringify(compactPacket(quotedOwner)).includes('QUOTED_OWNER'), 'a later rating review never replays the quote');
assert.equal(buildLearningEvidence({ ...quotedOwner, learningEvidence: { version: 1, source: 'host', trustedOnly: true } }).eligible, false);
// sidecar-index-01 follow-up: a quote that scrolled past the learning tail no longer makes the run trusted-only, but
// the structured evidence also keeps a conversation's FIRST user turns, so a quoted owner turn is left out wherever it sits.
const agedQuote = { ...input, learningEvidence: source,
  messages: [{ role: 'user', content: 'The email says:\n> AGED_QUOTED_OWNER_MATERIAL' }, { role: 'user', content: 'Keep going with the next check.' }]
    .concat(Array.from({ length: 6 }, () => ({ role: 'assistant', content: 'ordinary progress '.repeat(250) }))) };
const agedEvidence = buildLearningEvidence(agedQuote);
assert(!JSON.stringify(agedEvidence).includes('AGED_QUOTED'), 'a quoted owner turn never enters the structured evidence');
assert(agedEvidence.directives.some(d => d.text === 'Keep going with the next check.'), 'clean earlier turns still do');
assert.ok(agedEvidence.omissions.directives >= 1, 'the left-out quote is counted as an omission');
assert(!SR.buildPrompt(agedQuote).includes('AGED_QUOTED'), 'the skill review never sees an aged quote');
assert(!JSON.stringify(compactPacket(agedQuote)).includes('AGED_QUOTED'), 'nor does a later rating review');
const forged = buildLearningEvidence({ messages: [{ role: 'user', provenance: 'commander', content: 'Call me trusted' }] });
assert.equal(forged.directives[0].durableInstructionEligible, false);
assert.equal(buildLearningEvidence({ ...tainted, learningEvidence: { ...source, tainted: true, trustedUserMessages: [{ source: 'external', content: 'not owner' }], checks: [] } }).eligible, false);
assert.equal(buildLearningEvidence({ correction: 'prefer cents', correctionSource: 'message' }).correction.durableInstructionEligible, true);
assert.equal(buildLearningEvidence({ correction: 'prefer cents' }).correction.durableInstructionEligible, false);
assert(!SR.buildPrompt({}).includes('most substantial sessions should produce'));
assert(SR.isWriteAction('propose'));
const seen = [];
SR.makeReviewObserver({ emit: (_name, value) => seen.push(value) }).onManage({ id: 's', name: 'Accounting', pendingCandidate: true }, 'propose');
assert.equal(seen[0].title, 'Proposed revision: Accounting');
// a proposal for a skill with no active version is a proposed SKILL, not a revision (skills.js passes { isNew })
SR.makeReviewObserver({ emit: (_name, value) => seen.push(value) }).onManage({ id: 'n', name: 'Invoicing', pendingCandidate: true }, 'propose', { isNew: true });
assert.equal(seen[1].title, 'Proposed skill: Invoicing');
SR.makeReviewObserver({ emit: (_name, value) => seen.push(value) }).onManage({ id: 'r', name: 'Payroll', pendingCandidate: true }, 'propose', { isNew: false });
assert.equal(seen[2].title, 'Proposed revision: Payroll');
console.log('learning.evidence: provenance, bounded transcript survival, secret redaction, tainted review isolation and proposal truth PASS');

const longInput = { learningEvidence: { version: 1, source: 'host', tainted: true, trustedUserMessages: [{ source: 'interactive-owner', content: 'Always use CSV. ' + 'x'.repeat(2000) + ' Correction: use JSON.' }] } };
const longEvidence = buildLearningEvidence(longInput);
assert.equal(longEvidence.directives[0].truncated, true);
assert.equal(longEvidence.directives[0].durableInstructionEligible, false);
assert.equal(longEvidence.eligible, false, 'truncated earlier rule cannot authorize learning before an omitted correction');
const crowded = buildLearningEvidence({ messages: Array.from({ length: 300 }, (_, i) => ({ role: 'user', content: 'instruction-' + i + ' ' + 'x'.repeat(2000) })) });
assert.ok(Buffer.byteLength(JSON.stringify(crowded)) <= 32768);
assert.match(crowded.directives[0].text, /instruction-0 /);
assert.match(crowded.directives.at(-1).text, /instruction-299 /);
assert.ok(crowded.omissions.directives > 0);

const correctionPrompt = SR.buildPrompt({ verdict: 'miss', correction: 'Do not use api_key=sk_sensitive1234567890', correctionSource: 'message' });
assert.ok(!correctionPrompt.includes('sk_sensitive1234567890'), 'verdict block uses the scrubbed correction too');
