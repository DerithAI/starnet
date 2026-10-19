# Credential recovery investigation — October 12, 2026

Customer report e7b2ffcd remains OPEN and customer recovery unverified. The sanitized E03 record describes Windows 10 / reported 0.13.2, locked Higgsfield credentials, temporary recovery after a historical folder rename, and loss again after quit/reopen. No real credential store, customer profile, account, installer or provider was accessed in this investigation. No native OS account was created or changed. Folder renaming is not a recommended recovery step.

Baseline: bbe1aa106 (coordinated source, fast-forwarded into this isolated lane; no trunk changes or rebase). Existing connector-vault START FRESH preservation and native key read-back fixes were retained, not reimplemented.

## Reproduced narrower defect and repair

After a successful boot, a temporary EACCES reading connectors/state.json during save causes the vault to lock itself with reason unreadable. The API correctly rejects the save, but its separately cached connectorStorageError/connectorStorageReason remain empty. GET /api/connectors therefore presents no storage lock and can still mark storage encrypted/available. The new real-sidecar test failed on unchanged source with actual reason null, expected unreadable. This is a reproduced runtime-status flaw, NOT a demonstrated cause of the original customer losing sign-in.

The patch synchronizes the existing public lock state after a failed credential save or removal only when connectorVault.locked is true. It keeps the vault's actual reason. A write-only ENOSPC refusal is not falsely labelled a locked store. No encryption format, key generation, credential migration or recovery deletion changes. The follow-up reset correction below invalidates runtime connections only after the durable reset succeeds.

## Focused proof

- test/connector-recovery-reconnect.http.test.js: actual production sidecar processes with isolated temporary workspace/profile roots and synthetic keys. Eight boots exercise wrong-key refusal, explicit START FRESH, saving a new synthetic token, quit/restart, absent/restored key, ENOSPC write refusal, and EACCES during save/removal. Original primary and backup recovery copies remain byte-for-byte unchanged. Refused reads preserve active main/backup bytes; write failure preserves the prior token across restart. Public connector state does not contain synthetic token values.
- The reconnect fixture is a disabled loopback configuration: saved credential persistence is proven; it never claims a successful Higgsfield handshake, OAuth refresh, browser sign-in, or native keychain operation.
- test/helpers/connector-recovery-fault-host.cjs limits injected faults to exact connector state paths under the fixture-created starnet-credential-recovery-* temporary root. The control file is synthetic and no real profile is inspected.
- Existing connector-vault unit suite passed. The focused HTTP runner passed all three selected suites: connector-vault-invalid, connector-storage-start-fresh, connector-recovery-reconnect. Syntax checks passed. No broad gate was run.
- Raw before/after receipts remain private in .dogfood/credential-recovery-e7b2ffcd/{before,after,vault,focused-http}.log. The registered test is the reproducible receipt; no credentials or customer transcript are committed.

## START FRESH review blocker and follow-up

Review of fd368c510 identified a newly reachable case: a healthy running connector can discover an unreadable vault during a later save, then use START FRESH. On fd368c510, the durable reset succeeded but the actual manager still reported the old client up, with a token and fixture_tool available. test/connector-reset-runtime.http.test.js reproduced that failure in a running production sidecar, using only a synthetic provider and temporary profile. The before receipt is .dogfood/credential-recovery-e7b2ffcd/runtime-before.log.

Successful START FRESH and ordinary connector settings reset now share runtime invalidation. After durable replacement succeeds, they advance a reset generation, cancel discovery and GitHub device attempts, discard pending callback links and refresh bookkeeping, and remove every manager client before returning success. Generation checks fence delayed registration, code exchange, account lookup, refresh, and asynchronous configuration so old work cannot repopulate the new store. Old refresh completion cannot delete a newer refresh flight. Failed durable reset does not advance that generation or remove clients or pending sign-ins.

The new registered HTTP regression verifies:

- A healthy connector completes a real manager tool call before an injected EACCES exposes the runtime vault lock.
- Failed START FRESH restores byte-identical primary/backup files, keeps the old tool callable, and preserves the pending OAuth/device attempts. Failed ordinary reset also preserves durable data and the live client.
- Successful START FRESH removes runtime rows/tools; the same manager tool call then fails. A code exchange held across that reset returns cancelled and cannot recreate its grant or connector. Device polling is cancelled.
- Ordinary settings reset invalidates an unopened callback link. Settings reset of a locked store cancels registration already in progress; its late response cannot recreate the cached client.
- A newly saved credential connects, survives process quit/restart, and can call the synthetic tool. An expired-token refresh held across another reset cannot overwrite a newly connected successor with the same connector id.

The provider and manager probe are test-only, guarded to the same temporary-root prefix as the existing fault host. The production manager, client, vault, routes and persistence run unchanged apart from this repair. Provider acceptance is simulated; no real provider account, installed native keychain, customer profile or native launch is covered. This is live sidecar/API evidence, not a UI or installed-app acceptance claim. In-flight remote effects cannot be undone by local reset.

Follow-up validation passed: syntax checks for every changed JavaScript file; git diff --check; two selected fast-list suites (connector-vault and github-device); seven selected HTTP suites (connector-oauth-refresh-race, github-device.http, google-signin.e2e, connector-vault-invalid, connector-storage-start-fresh, connector-recovery-reconnect, connector-reset-runtime).

Raw follow-up receipts: .dogfood/credential-recovery-e7b2ffcd/{runtime-before,runtime-after,reset-unit,reset-focused-http}.log. Broad gates and integration belong to the coordinator; no trunk changes were made. The original customer issue remains OPEN.

## Native seam and remaining acceptance

src-tauri/src/credentials.rs reads the connectors:encryption:v1 key and creates it only on NoEntry; creation requires successful storage and exact read-back. A malformed or unavailable existing value is not deliberately replaced. src-tauri/src/main.rs clears the inherited canonical key and forwards either the native key or a non-secret error to the sidecar. The Windows keyring backend is enabled. Source inspection does not prove the customer's credential backend persists between native launches.

The existing native acceptance harness is guarded for a disposable CI keychain and the ignored production-key test would access the real StarNet service entry. Neither was invoked. No isolated Windows standard-user acceptance account was established as available, and creating one was out of scope. Disk pressure also ruled out a new native build/installer campaign.

Required next evidence: exact customer artifact/version and program-file integrity; whether the same OS account and native key entry are used on both launches; non-secret native key availability/error and connectorStorage reason on each launch; whether sign-in was acknowledged saved versus connected; controlled read/write/quit timing. Never request or log the key or token. Use a disposable pre-existing Windows test account/profile and synthetic connector credentials for future native launch/relaunch acceptance. Preserve original sealed files and recovery copies; do not reset the customer store to manufacture success.

## Windows native component acceptance preparation (not executed)

Merged live coordination 4e56787fda05c2bfdcc3a6127a293eeb7eafba4f into this registered lane without rebase. The lightweight native harness and existing workflow now prepare Windows Credential Manager acceptance in a unique synthetic service/account, with absence-before-create, exclusive ownership receipts, separate sealing/recovery process IDs, exact vault decryption, owned malformed-value preservation/restore, refusal controls and exact-entry cleanup. macOS retains its disposable keychain, interaction suppression, lock/unlock refusal and recovery checks. Production namespace and policy behavior remain unchanged; the narrow supplied-Entry seam lets acceptance use that policy without invoking the production wrapper.

[Command plan, guards and limitations](../../../test/native-connector-keychain/README.md). Static checks passed for unchanged policy branch bodies after injected I/O substitution, no harness production-entry calls, workflow YAML parsing and whitespace. No Cargo build/test, native entry operation, ignored production test, dependency installation, app/browser launch, HTTP/broad gate or workflow dispatch occurred. Compile validation and both OS acceptance jobs remain owed. Simulated refusal controls are not Windows OS-denial evidence. This prepared source does not prove exact installer/Tauri app-data isolation, real app quit/relaunch, Higgsfield sign-in or customer recovery; e7b2ffcd remains OPEN.

## Separate startup incident 85f602c4

The Windows 0.13.2 package-startup gap remains open. This host's read-only installation evidence was version 0.13.1 with nonempty shell.js (89,158 bytes); it is not the customer's installation. Exact public 0.13.2 package bytes were not downloaded or extracted because no trusted NSIS-capable extractor was found. Artifact preflight and host evidence remain under .dogfood/installation-integrity-85f602c4/. This credential patch does not resolve that acceptance gap.
