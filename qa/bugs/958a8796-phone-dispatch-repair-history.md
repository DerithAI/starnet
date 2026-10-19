---
fingerprint: 958a8796
slug: phone-dispatch-repair-history
title: Phone conversation and previews expose internal worker repair dialogue
surface: sessions
severity: P2
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 18c1ec59f094775ada818175d927e9c4ffc845d8
origin: audit
---

# Phone conversation and previews expose internal worker repair dialogue

## Symptom

The phone adapter bypassed the desktop accepted-answer projection. Explicit dispatch into a visible session could expose rejected raw output and repair instructions in phone history, chat previews, and follow-up model context.

## Repro

Use the real sealed phone client to read a visible session with a repaired dispatch, list its preview, continue the conversation, then restart and read again.

## Evidence

Source candidate d7d865f21 had the divergent adapter. test/remote.e2e.test.js now proves acceptedCount=1 and rawEvidenceVisible=false before and after restart, clean previews, and clean continuation context. The combined suite records 108 passing assertions and two unrelated missing-art failures. Evidence: qa/evidence/thread-ux-1012/large-output-verification.json.

## Verdict

Source fixed in 18c1ec59f094775ada818175d927e9c4ffc845d8. Desktop and phone share conversationTranscript. Preview indexing excludes pending/internal content; legacy closed preview metadata without visibility provenance is omitted until rebuilt without scanning conversation bodies. No integration, installed-app or customer acceptance claim.
