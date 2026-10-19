---
fingerprint: 4c0efd8c
slug: saved-station-opening-is-blocked-despite-a-reach
title: Saved station opening is blocked despite a reachable engine
surface: sessions
severity: P2
status: open
found: 2026-10-12
lane: release-0135-prep
fix:
origin: customer
report: support-2026-10-08-saved-station-save-net
affected: Reported StarNet 0.13.1 Windows, build e0a36dcd3; exact installer artifact unverified
family: saved-station-load
installer: unverified
recovery: unconfirmed
---

# Saved station opening is blocked despite a reachable engine

## Symptom

Opening an existing station stops at SAVE-NET / SAVE REQUEST LOST. The customer reports that the app loaded and GET /api/health answered, but the saved-station request did not return and GET /api/diagnostics returned nothing. Workspace files remain visible. This does not establish data loss or file integrity.

## Repro

Customer-reported operation, not a local causal reproduction:
1. Open the affected saved station in the reported Windows installation.
2. Preserve the SAVE-NET state and correlate the exact saved-station request, status, timing and native startup/auth context.
3. On a disposable copy only, verify successful open, restart and reopen while preserving station bytes.
Do not reset or reinstall away the evidence; a health response alone does not prove saved-state loading.

## Evidence

Original October 8, 2026 7:59 p.m. America/New_York report was cross-checked against retained private intake on October 12. The customer names build e0a36dcd3 and source-tree marker 63fcf3973231, a reachable health endpoint, no page errors, and no saved-station response. Installation on another drive is context, not a demonstrated cause. Attachments were not independently inspected in this reconciliation. The residual audit found no later recovery reply in its targeted search; that is not proof of continuing failure.

Deduplicated against lane HEAD e1bf891de and coordinator 003a8b6c5. Records 25de9a74 and 34c58f4f concern related save-integrity paths; neither establishes this cause. The engine-before-listening startup incident 85f602c4 is distinct. More accurate health reporting in 0.13.2 is not proof of recovery.

Investigation anchors: frontend/app/app.js, test/cloudsave-timeout.test.js and test/save-unreadable.http.test.js. These locate recovery/request boundaries, not a passing customer reproduction. Missing evidence includes the failed request status and timing, exact workspace/resource paths, correlated logs, current-build retest and artifact hash. No source fix or installed/customer recovery is claimed.

## Verdict

Re-triaged P1 to P2 for the 0.13.5 cut: waiting on reporter data; not reproduced locally and no source defect is proven. Reopen at P1 when the reporter's data shows a defect. Andrew approved this disposition for the 0.13.5 cut (10-15).

## Regression



## Sibling coverage



## October 12 scoped investigation

Compared the save path at lane base e3e6c2ad with coordinator bbe1aa1; relevant app, cloud-save and server files matched. A seeded live browser reproduced a narrower diagnostic defect: after SAVE-NET, an explicit unreadable response changed the status text but left the screenshot code and copied report context at SAVE-NET. The repair refreshes the diagnosis on each unknown retry while preserving engine-degraded code precedence. It does not change saved-state loading, deadlines, authorization, migration or reset semantics.

Live server fixtures stalled initial GET headers and response bodies while health returned 200 and diagnostics failed. Saved bytes remained unchanged during blocked states. After a readable response, retry opened NOVA; restarting the same isolated service and loading a fresh page reopened NOVA. This demonstrates bounded synthetic recovery, not the cause or recovery of the customer installation. The canonical incident remains open, installer unverified and recovery unconfirmed.

Evidence: [before](../evidence/e09-save-recovery-1012/before.json), [after](../evidence/e09-save-recovery-1012/after.json), [verification](../evidence/e09-save-recovery-1012/verification.json), and [replay](../evidence/e09-save-recovery-1012/live-probe.mjs). The first before-run restart observation was excluded because it raced page navigation. Registered gate behavior coverage is test/save-recovery-diagnosis.test.js; test/cloudsave-timeout.test.js now includes initial GET header/body stalls and successful retry. Adjacent unreadable-file, diagnostics, link recovery, unknown-save and fresh-start checks passed; the full integration gate was outside this lane scope.

Follow-up: the measured degraded code/reason now also updates the copied page-side report, including changed reasons and clearing degradation. Browser proof exercised the actual report button, Diag.copy and clipboard-denied selectable fallback, with literal markup-like reason text. See [degraded copy verification](../evidence/e09-save-recovery-1012/degraded-copy-verification.json). This adjacent diagnostic repair does not close the customer loading incident.

## October 12 original attachment review

Both original PNG attachments were retrieved and visually inspected. The recovery screenshot confirms SAVE-NET / SAVE REQUEST LOST and automatic retries at attempt 8. A partial Explorer view shows `%APPDATA%/ai.skynet.harness/workspaces` with migration/schema markers, journal, ownership, connectors and transcript folders. It does not prove the active backend resource root, save integrity, a missing save or successful migration. Neither image contains the failed-request trace or artifact hash. The attachment-inspection gap is now closed; cause and recovery remain unverified. See [sanitized attachment evidence](../evidence/customer-release-1011/e09-attachment-review.json).
