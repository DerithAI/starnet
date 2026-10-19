---
fingerprint: 6548b94d
slug: delegated-approval-disclosure
title: Worker approvals hide the proposed request and lose parallel attention
surface: safecell
severity: P1
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 09e6afba0179fe4aa6930fa5fe5b68a433d4934d
origin: audit
---

# Worker approvals hide the proposed request and lose parallel attention

## Symptom

Worker approvals hide the proposed request and lose parallel attention.

## Repro

Open a delegated worker approval with a long shell command, then answer a sibling question or let another worker update.

## Evidence

Previously no complete request inspector was present on the delegated row. Live proof now preserves full payload tail, open disclosure, focused summary, failed-answer retry and a sibling bell notification.

Regression anchors: test/consent-full-request.test.js; test/thread-ux-regressions.test.js.

Recorded in `qa/evidence/thread-ux-1012/verification.json` under `live-approval.json`.

## Verdict

Source fixed in `09e6afba0179fe4aa6930fa5fe5b68a433d4934d`. This audit record does not claim complete gate, installer, or customer recovery acceptance.
