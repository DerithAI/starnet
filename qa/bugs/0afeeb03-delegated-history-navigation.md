---
fingerprint: 0afeeb03
slug: delegated-history-navigation
title: Opening old worker work snaps back to the newest chat message
surface: sessions
severity: P2
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 09e6afba0179fe4aa6930fa5fe5b68a433d4934d
origin: audit
---

# Opening old worker work snaps back to the newest chat message

## Symptom

Opening old worker work snaps back to the newest chat message.

## Repro

Append 45 later messages, switch away, then open the old worker result through App.openWorkstream.

## Evidence

Before: row moved from top 471 to -7189 after the load pin. After 700 ms: row top 471.984375 inside log bounds 200.890625..810.140625; original draft retained while switching.

Regression anchors: test/thread-ux-regressions.test.js; test/comms-history-pin.test.js.

Recorded in `qa/evidence/thread-ux-1012/verification.json` under `live-navigation.json`.

## Verdict

Source fixed in `09e6afba0179fe4aa6930fa5fe5b68a433d4934d`. This audit record does not claim complete gate, installer, or customer recovery acceptance.
