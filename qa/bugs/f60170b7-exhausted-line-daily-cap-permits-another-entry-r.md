---
fingerprint: f60170b7
slug: exhausted-line-daily-cap-permits-another-entry-r
title: Exhausted line daily cap permits another entry run
surface: autonomy
severity: P1
status: fixed
found: 2026-10-11
lane: conveyor-finish-1012
fix: 43e48a086
origin: audit
---

# Exhausted line daily cap permits another entry run

## Symptom

A work line whose daily spending cap is already exhausted still starts its entry agent; a one-step line can spend again without hitting a later hop guard.

## Repro

1. Create a one-step line with a daily cap and a persisted ledger already at that cap.
2. Start a sample, Run Now, or scheduled line job.
3. Baseline makes one provider call. Repaired source ends with budget reason and makes zero provider calls.

## Evidence

test/routing.line-admission.e2e.test.js runs the real sidecar against a counted local provider. Before the patch the capped sample made 1 provider call instead of 0. After the patch all seven cases pass: sample, restart, Run Now, schedule, same-agent other-line isolation, direct order and daily rollover. Existing chain.limits (51), cron.chain (66), routing.handoff (75), and workflow-project-multibay HTTP checks passed at the source commit.

## Verdict

Source repaired in 43e48a086: runOnceCore checks host-derived workflowLine spending before script/provider dispatch. Existing reconciliation and per-hop checks are preserved. This enforces a known exhausted cap; it is not a new concurrent reservation system. Combined gates appear in the conveyor finish digest. No installer acceptance claimed.


## Regression

A terminal line never reached the old pre-hop check. Admission now happens at the shared entry point, before any model/script work.

## Sibling coverage

- Sample, Run Now, schedule, restart, line isolation, direct orders and UTC-day rollover: test/routing.line-admission.e2e.test.js (http).
- Subsequent-hop guards: test/chain.limits.test.js (fast).
- Channel/trigger/SEND TO share runOnceCore admission; dedicated display and installed-desktop acceptance remain unverified.
