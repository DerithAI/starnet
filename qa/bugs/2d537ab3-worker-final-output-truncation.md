---
fingerprint: 2d537ab3
slug: worker-final-output-truncation
title: Large accepted worker output can be silently truncated
surface: sessions
severity: P1
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 18c1ec59f094775ada818175d927e9c4ffc845d8
origin: audit
---

# Large accepted worker output can be silently truncated

## Symptom

A valid result longer than 200,000 characters was persisted with its tail removed and then accepted by recovery as complete.

## Repro

Dispatch a schema-bound result with 210,026 characters; repair it, restart, and compare the complete accepted JSON and SHA256 in canonical history, delivery=1, chat, and the worker receipt.

## Evidence

Source candidate a69664135 had this confirmed defect. Follow-up evidence: qa/evidence/thread-ux-1012/large-output-verification.json. Anchors: test/e2e.dispatch-session.test.js, test/transcript.test.js, test/transcript-history-v2.test.js, test/station-commands.test.js, test/thread-ux-regressions.test.js.

## Verdict

Full finalized projection persistence supports the structured validator limit. Oversize output is refused explicitly; exact length/hash validation prevents previews or corrupt projections from reserving delivery IDs. Source fixed in 18c1ec59f094775ada818175d927e9c4ffc845d8. This is source audit evidence, not full-gate, integration, installed-app or customer acceptance.
