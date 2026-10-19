---
fingerprint: 2da05ff7
slug: delegated-report-batching
title: A delayed assignment splits one handoff into redundant lead reports
surface: sessions
severity: P2
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 09e6afba0179fe4aa6930fa5fe5b68a433d4934d
origin: audit
---

# A delayed assignment splits one handoff into redundant lead reports

## Symptom

A delayed assignment splits one handoff into redundant lead reports.

## Repro

Dispatch worker A, let it finish, wait beyond a poll interval while the lead is busy, then dispatch worker B under the same lead.

## Evidence

The report collects membership after acquiring the parent turn and refreshes queued membership. Real isolated sidecar proof covers one two-worker report, empty waitingOn and restart without another report.

Regression anchors: test/e2e.overseer.test.js; test/overseer-batch.test.js.

Recorded in `qa/evidence/thread-ux-1012/verification.json`.

## Verdict

Source fixed in `09e6afba0179fe4aa6930fa5fe5b68a433d4934d`. This audit record does not claim complete gate, installer, or customer recovery acceptance.
