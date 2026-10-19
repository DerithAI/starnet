---
fingerprint: dd9a34df
slug: delegated-run-outcomes
title: Capped and recovered worker runs overwrite current completion truth
surface: sessions
severity: P1
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 09e6afba0179fe4aa6930fa5fe5b68a433d4934d
origin: audit
---

# Capped and recovered worker runs overwrite current completion truth

## Symptom

Capped and recovered worker runs overwrite current completion truth.

## Repro

End a foreground worker at budget or iteration limit; recover an older failed result while a newer run is recorded or active.

## Evidence

State now retains verified reason, shows capped/stopped outcomes, refuses stale ledger authority, and keeps a newer live retry active. Reconciliation inserts older attempts chronologically without replacing the newest outcome.

Regression anchors: test/station-commands.test.js; test/workstreams.test.js; test/delegated-threads.test.js.

Recorded in `qa/evidence/thread-ux-1012/verification.json`.

## Verdict

Source fixed in `09e6afba0179fe4aa6930fa5fe5b68a433d4934d`. This audit record does not claim complete gate, installer, or customer recovery acceptance.
