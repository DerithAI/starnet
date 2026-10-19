---
fingerprint: 402ce8f7
slug: background-worker-response-pending
title: Background worker responses leave answered prompts pending
surface: sessions
severity: P2
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 049e6ff7e7c92b7b0f38ab34ce1eeb9ae30c7833
origin: audit
---

# Background worker responses leave answered prompts pending

## Symptom

With no mounted approval card, two background workers wait in one parent conversation. A remote response updates the notification helper but leaves its Channels record pending. After responses to both prompts, the bell advertises the first answered worker again and both channel prompts remain.

## Repro

Run the exact prompt ownership and submission regression in test/bell-settles.test.js and test/thread-ux-regressions.test.js with two workers pending in one conversation and a third prompt in another.

## Evidence

On 3679f61f, executing actual Channels and complete production prompt helpers leaves pending [mira, rook] after both responses, with notifications [rook, mira] and no final settlement. The fixed seeded app uses actual Chat.send background permission callbacks and renders the notification panel with no mounted consent cards. The first response leaves only rook pending, a duplicate and unknown response change nothing, and the second clears the original parent bell. Another conversation's prompt remains untouched.

Source-bound evidence: qa/evidence/thread-ux-1012/response-ownership-verification.json. Focused suites: replay 27, useful notifications 46, bell 34, remote sessions 30; voice UI passes; combined UX/consent passes 35 cases. No full gates run in this follow-up.

## Verdict

Known prompt ownership now clears the exact original channel/prompt before choosing remaining sibling attention. Existing card cleanup stays idempotent. The canonical audit is independent of customer record 082ee8e5; original customer causality is not established. No trunk merge, installer or customer acceptance claim.
