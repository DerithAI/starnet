---
fingerprint: 4a66278b
slug: worker-final-output-durability
title: Worker completion can outlive the only complete answer
surface: sessions
severity: P1
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 18c1ec59f094775ada818175d927e9c4ffc845d8
origin: audit
---

# Worker completion can outlive the only complete answer

## Symptom

The final run patch previously preceded the full projection write. A failed projection left the answer unrecoverable after restart, while offline delivery replaced the failure diagnostic with a durability claim.

## Repro

Inject projection append failure, then separately inject final run patch failure. Restart after each and inspect canonical output, final metadata, diagnostics, execution count and spend.

## Evidence

Source candidate a69664135 had this confirmed defect. Follow-up evidence: qa/evidence/thread-ux-1012/large-output-verification.json. Anchors: test/e2e.dispatch-session.test.js, test/transcript.test.js, test/transcript-history-v2.test.js, test/station-commands.test.js, test/thread-ux-regressions.test.js.

## Verdict

The full accepted projection precedes final status. Projection failure stays pending and truthful; interrupted final patches recover from verified persisted content on startup without rerunning work. Changed same-run retries are rejected. Source fixed in 18c1ec59f094775ada818175d927e9c4ffc845d8. This is source audit evidence, not full-gate, integration, installed-app or customer acceptance.
