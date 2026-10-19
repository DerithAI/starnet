---
fingerprint: abb287e8
slug: worker-recovery-reader-state
title: Worker recovery rebuilds an unrelated conversation and loses reader state
surface: sessions
severity: P2
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: a69664135e4983fe624ec11bea6b2bd4666ee651
origin: audit
---

# Worker recovery rebuilds an unrelated conversation and loses reader state

## Symptom

A worker finishing elsewhere can rebuild the conversation being read, closing its disclosure and moving its reading position.

## Repro

Read old messages with an open approval inspector, selected text and a draft. Recover an empty failed worker in another conversation, then recover an earlier answer in the current conversation.

## Evidence

Regression anchors: test/station-commands.test.js and test/thread-ux-regressions.test.js. Live .dogfood/thread-ux-fix/live-recovery-reader.json: hidden recovery topDelta=0; earlier insertion topDelta=0.28125 after 700 ms at scaled UI, same nodes/open inspector/focus/selection/draft preserved, validated answer once, raw invalid absent, zero page exceptions.

## Verdict

Source fixed in a69664135e4983fe624ec11bea6b2bd4666ee651. Final focused/HTTP/live evidence: qa/evidence/thread-ux-1012/regression-verification.json. No full-gate, integration, installed-app or customer recovery claim.
