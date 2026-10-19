---
fingerprint: c68d5c40
slug: delegated-file-provenance
title: Worker result links open another workspace
surface: sessions
severity: P1
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 09e6afba0179fe4aa6930fa5fe5b68a433d4934d
origin: audit
---

# Worker result links open another workspace

## Symptom

Worker result links open another workspace.

## Repro

Have VEX return a relative file link while NOVA owns the parent conversation; place different content at the same relative path in each workspace.

## Evidence

Before: inline link used agent=agent. After: live file route returned HTTP 200 with agent=vex and VEX_WORKSPACE_PROOF. Receipt provenance also overrides a later project binding.

Regression anchors: test/thread-ux-regressions.test.js.

Recorded in `qa/evidence/thread-ux-1012/verification.json` under `live-file.json`.

## Verdict

Source fixed in `09e6afba0179fe4aa6930fa5fe5b68a433d4934d`. This audit record does not claim complete gate, installer, or customer recovery acceptance.
