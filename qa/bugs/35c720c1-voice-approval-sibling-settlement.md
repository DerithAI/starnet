---
fingerprint: 35c720c1
slug: voice-approval-sibling-settlement
title: Spoken approvals clear sibling waits before confirmation
surface: sessions
severity: P2
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: fcd8007ca473d52488986537e304370c37f7f9a0
origin: audit
---

# Spoken approvals clear sibling waits before confirmation

## Symptom

The spoken approval fallback could submit without awaiting acknowledgement, clear every pending prompt in the conversation, and announce success even when the request failed. Delegated worker controls do not match the ordinary approval-button selector, so they reach this fallback.

## Repro

Run the exact prompt ownership and submission regression in test/bell-settles.test.js and test/thread-ux-regressions.test.js with two workers pending in one conversation and a third prompt in another.

## Evidence

Production-function tests execute voice approvalCommand with actual Chat.answerConsent and Channels. Failed requests preserve both siblings and emit no success; repeated commands issue one in-flight request; acknowledgement clears only the target. Tests also cover applied denial, questions excluded from approval commands, ended/rebound calls, and a remote answer winning before local failure. No microphone session or installed voice acceptance was tested.

Source-bound evidence: qa/evidence/thread-ux-1012/response-ownership-verification.json. Focused suites: replay 27, useful notifications 46, bell 34, remote sessions 30; voice UI passes; combined UX/consent passes 35 cases. No full gates run in this follow-up.

## Verdict

Spoken approval uses the shared confirmed exact-prompt path. Feedback follows the applied decision and remains bound to its original call and conversation. A local failure only says the prompt is waiting if that exact prompt still exists. This adjacent source audit is separate from the integration fixture failures and customer record 082ee8e5. No trunk merge, installer or customer acceptance claim.
