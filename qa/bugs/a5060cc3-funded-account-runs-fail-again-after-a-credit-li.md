---
fingerprint: a5060cc3
slug: funded-account-runs-fail-again-after-a-credit-li
title: Funded account runs fail again after a credit-limit workaround
surface: providers
severity: P2
status: open
found: 2026-10-11
lane: release-0135-prep
fix:
origin: customer
report: support-2026-10-06-to-08-funded-account-recurrence
affected: Reported 0.13.1 Windows x86_64 managed account; installer artifact unverified
family: funded-account-run-refusal
installer: unverified
recovery: persists
recoveryEvidence: October 7 lower-limit workaround was reported working; October 8 follow-up reports renewed failures at several lower limits despite a funded balance.
---

# Funded account runs fail again after a credit-limit workaround

## Symptom

A customer reports an out-of-credits refusal despite a funded managed account. Lowering the per-run limit temporarily restores work, but the next day failures recur at multiple lower limits, including mid-run stops. The customer reports additional credit usage while retrying.

## Repro

Customer-reported sequence, not locally reproduced:
1. Correlate the affected linked account's authoritative available balance, held amounts and configured per-run limit with a failing run.
2. Retry the previously successful lower-limit configuration and preserve admission and mid-run refusal evidence separately.
3. Match any reported retry charges to actual receipts before attributing incorrect billing.
Do not assume the displayed balance, a cap mismatch or a generic error message alone establishes the mechanism.

## Evidence

Intake E05 timeline: October 6 funded account refusal; October 7 support suggested restart, then lowering a configured 100 per-run limit to 5. Customer reported restart/update had not helped, then said the lower-limit workaround worked. October 8 customer reported recurrence at limits 5, 10, 20 and 50, a funded balance, mid-run failure and credit costs on retries. The latest failure supersedes the transient recovery.

Dedup: 72af29f4 is a zero-credit warning while work still succeeds; this report includes blocked/interrupted work. Related sources 2c1d1a764, 0e49521c0 and f3f56b18d are investigation candidates, not demonstrated customer fixes. No exact record found on a20ffa71f or cbbf376dad.

Investigation anchors: test/managed-credit-held.test.js and test/managed-credit-refusal.e2e.test.js. No affected-account execution, billing reconciliation or installer acceptance was performed for this record.

## Verdict

Re-triaged P1 to P2 for the 0.13.5 cut: waiting on reporter data; not reproduced locally and no source defect is proven. Reopen at P1 when the reporter's data shows a defect. Andrew approved this disposition for the 0.13.5 cut (10-15).

## Regression



## Sibling coverage


