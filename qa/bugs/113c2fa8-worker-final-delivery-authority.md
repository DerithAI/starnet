---
fingerprint: 113c2fa8
slug: worker-final-delivery-authority
title: Worker recovery can publish raw output before structured repair
surface: sessions
severity: P1
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: a69664135e4983fe624ec11bea6b2bd4666ee651
origin: audit
---

# Worker recovery can publish raw output before structured repair

## Symptom

Raw invalid output can appear as the completed answer before bounded structured repair finishes, and later recovery can reintroduce execution output.

## Repro

Dispatch a session-scoped worker with a result schema; return invalid text, block its repair, reconcile runs, then complete repair and reopen the session.

## Evidence

Regression anchors: test/e2e.dispatch-session.test.js, test/runstore.test.js, test/station-commands.test.js, test/delegated-threads.test.js. The frozen 09e6afba0 candidate sent dispatch_end before validation; its immediate recovery filed raw text and rejected later repaired delivery as already delivered. Source changes separate provisional execution from finalized delivery and preserve exact-run inspection.

## Verdict

Source fixed in a69664135e4983fe624ec11bea6b2bd4666ee651. Final focused/HTTP/live evidence: qa/evidence/thread-ux-1012/regression-verification.json. No full-gate, integration, installed-app or customer recovery claim.
