---
fingerprint: e7b2ffcd
slug: connector-sign-in-is-lost-after-credential-store
title: Connector sign-in is lost after credential-store recovery
surface: providers
severity: P2
status: open
found: 2026-10-11
lane: release-0135-prep
fix:
origin: customer
report: support-2026-10-10-connector-credential-persistence
affected: Reported 0.13.2 Windows 10 x64 under a standard user account; artifact unverified
family: connector-credential-persistence
installer: unverified
recovery: persists
recoveryEvidence: October 10-11 report describes a temporary Higgsfield connection after renaming app data, followed by disconnection after quitting and reopening.
---

# Connector sign-in is lost after credential-store recovery

## Symptom

Higgsfield reports locked credentials and asks for the original OS user or unlocked credential store. Reboot and an administrator attempt do not recover access. Renaming app data temporarily allows connection, but quitting and reopening loses the connection; restoring the folder does not resolve it.

## Repro

Customer-reported sequence, not locally reproduced:
1. Open the affected standard-user installation and inspect connector storage status.
2. Attempt the supported sign-in flow and restart the app under the same OS account.
3. Check whether the connection survives and record the storage reason without exposing credentials.
The customer's folder rename is historical evidence, not a recommended reproduction step. Preserve existing sealed data; do not wipe or switch account context to force success.

## Evidence

October 10-11 sanitized customer report, intake E03. The customer explicitly reports restart failure after temporary recovery and requests a safe recovery path.

Related source 2982146cd improves locked-store reasons and recovery; audit record 50c75ec3 / source abd291449 concerns interrupted START FRESH preservation. Neither proves the cause or resolution of this original persistence incident. No exact customer record was found on trunk a20ffa71f or candidate cbbf376dad.

Investigation anchors: test/connector-vault.test.js and test/connector-storage-start-fresh.http.test.js. Correlate OS account, native key availability and connector persistence with the exact installed build. No installed retest or successful customer recovery is available.

## Verdict

Re-triaged P1 to P2 for the 0.13.5 cut: waiting on reporter data; not reproduced locally and no source defect is proven. Reopen at P1 when the reporter's data shows a defect. Andrew approved this disposition for the 0.13.5 cut (10-15).

## Regression



## Sibling coverage


