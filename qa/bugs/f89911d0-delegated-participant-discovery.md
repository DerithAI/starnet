---
fingerprint: f89911d0
slug: delegated-participant-discovery
title: Agent filters hide conversations containing delegated work
surface: sessions
severity: P2
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 09e6afba0179fe4aa6930fa5fe5b68a433d4934d
origin: audit
---

# Agent filters hide conversations containing delegated work

## Symptom

Agent filters hide conversations containing delegated work.

## Repro

Filter sessions by MIRA after MIRA works under a NOVA conversation; search for text from that handoff.

## Evidence

Live MIRA membership is true and the search result remains General. Store tests cover cache invalidation, polling adoption, archive/delete and exact-worker ask routing.

Regression anchors: test/thread-flow-navigation.test.js.

Recorded in `qa/evidence/thread-ux-1012/verification.json` under `live-filter.json`.

## Verdict

Source fixed in `09e6afba0179fe4aa6930fa5fe5b68a433d4934d`. This audit record does not claim complete gate, installer, or customer recovery acceptance.
