# Readiness investigation — 2026-10-11

This is a dated investigation, not a READY receipt. The canonical `qa:ready` snapshot in this directory targets trunk `a20ffa71f` and is RED. New source/record changes require new final-candidate gates.

## Layout receipt mismatch

The Guardian run ending 2026-10-12T02:27:07Z observed `pendingEdits:true` with the truthful unconfirmed routing note. The failing assertion in `test/station-layout.e2e.test.mjs` requires “running the floor as last sent” wording; it does not require a state named pending. `completeLayout` in `sidecar/tools/builtin/station.js` replaces the page's note if the held router hash differs from the page hash. The original failure did not capture both hashes or the publication timeline, so its cause is unresolved.

Coordination ran one isolated instrumented copy of that live fixture on application source equivalent to `a20ffa71f` (coordination commit `2e43c147d` adds documentation only). It used a local mock provider, disposable station and browser, with all normal assertions retained. Routing POSTs/responses, raw page acknowledgements and before/after `World.planStatus()` were recorded privately. All checks passed: the pending request retained the same published plan hash, `pendingEdits:true`, `confirmed:true`, and disclosed the missing drawn-floor agent. No product guard or assertion was weakened. This successful replay does not explain or erase the earlier failure. Retain captured timeline instrumentation if the final combined gate reproduces it.

## Deliverables visual baseline

A fresh `npm run golden` capture on review commit `57fc7f8c4` passed all 16 capture actions and flagged only `work-deliverables`, difference 1.51 against unchanged threshold 1.5. Independent review of the earlier Guardian image and coordination review of the fresh image found the intentional MY WORK introduction/toolbar change already present in October 5 source (`13cefae02`); the stored baseline predates it.

Only the `work-deliverables` 64x40 signature was refreshed from the reviewed image. All 15 other signatures, dimensions and threshold were preserved and programmatically compared. This verifies the shown empty-state layout, not a complete populated-workflow or accessibility audit. The original capture/manifest/report remain in the coordination worktree's private `.uigolden` directory.

## Detector findings and other gates

Three machine-local P1 detector findings remain distinct from tracked customer bugs. Exact-a20 journey runs at 01:00 and 02:00 both passed 139 assertions, including the relevant reload/toggle scenarios. Earlier J3 negative-card output is an exception sentinel after a CDP read failure, not a measured negative card count; the J2 check also substitutes a failure value if reading fails. Those facts support investigation, not a fabricated repair or permanent suppression. No detector evidence was deleted or dismissed by this review.

The beginner receipt and installed smoke previously inspected target older sources; installed smoke identifies 0.12.5. Fresh exact-candidate installed first use, upgrade/data continuity, lifecycle and required product acceptance remain owed. A customer-confirmed recovery is recorded separately and is not inferred from gate success.

## October 12 observation and artifact follow-up

The three retained machine P1s were read independently. `7f25ecb7` records a CDP evaluation timeout; `fd87bfd9` is its subsequent `-1` fallback, not a measured stuck-card count. `dd2fd9c0` conflates a failed evaluation with busy state, while its next parity observation shows no busy or RUNNING rows. Later a20 journey passes do not establish their original cause or a current-candidate repair. No finding was closed or suppressed.

The coordinator now records evaluation failure separately from measured state in the affected J2/J3 checks and retains the actual idle-wait result. Fourteen negative controls pass; the isolated seeded J2c/J3 replay passes 35/35 with idle observed. [Revision and method receipt](journey-observation-diagnostics.json). This focused replay does not replace full final-candidate journeys, Guardian or installed acceptance.

Read-only inspection of the exact signed public Windows 0.13.2 installer found three nonempty source-equivalent modules; see [artifact receipt](windows-0132-artifact.json). Customer installation identity, installed bytes/path, full stack and startup recovery remain unknown.

## October 12 native acceptance preflight

A bounded read-only inspection at source `baa58078b` found no candidate binary in the checked release/build locations. The present installed app and retained native receipts are historical; none attests this candidate. Full private receipt: `.handoff/release-preflight-baa58078b.json`, SHA-256 `cac07ee8284ace955f1a96e70bf1263fb7ca6351eafa1b8bba945936e8e9af6a`. No build, installation, native launch or workflow dispatch was performed.

Native storage uses Tauri app-data resolution (`src-tauri/src/main.rs`); environment overrides alone do not establish profile isolation. The packaged lifecycle driver’s `--app-data` redirects driver files, and cleanup can terminate other StarNet shell processes. Use disposable Windows CI/VM without unrelated StarNet processes. The shortest prepared route is a private `desktop-build.yml` (`publish-test=false`), exact source/artifact identity plus valid Authenticode, then `t0-clean-install-proof.yml` with the build run, installer SHA and verified baseline upgrade. The private T0 path requires signing even though an internal desktop build can emit unsigned artifacts.

Local disk headroom was about 0.87 GB and no usable VM was established. Apple native acceptance still needs the appropriate platform, and attended first-value/real-account/real-provider checks require their own evidence. This operational preflight is not a readiness pass or authorization to publish.

## October 12 full-gate follow-up

Full fast on ccd24082 passed all 1,154 suites. Both complete HTTP attempts failed: step184 had WORKSPACE_OWNER_UNAVAILABLE plus a secondary ENOSPC; the monitored rerun failed step49 after a Build edit lost pending state. Original logs and hashes are retained in source-gates.json. A focused startup replay passed but does not establish the original storage failure cause.

The controlled delayed artwork callback proved and repaired render-triggered publication of unfinished Build edits; [revision-bound live proof](build-render-publication.json) records source f90409837a5a69faf32ca3bf2e918bed8c508d4a. The exact original full-suite callback was not recorded. This production repair makes the earlier full-fast result historical; both complete gates and the source campaign must restart. The scheduled trunk Guardian runs hourly and must be serialized with broad candidate gates. Installed/customer/platform/Whop gaps remain unchanged.


## October 12 reporting, intake and release ordering

Complete fast on `9350db92` failed at 922/1,154 on the shared-helper settlement lint. The affected file already used throwing Node assertions; importing only fnBody caused a static classification mismatch. One-line strict counter settlement `513cf8817` is independently source-reviewed, with original assertions and lint unchanged. Runtime controls and both full gates remain owed; HTTP and the campaign did not start. The lease drained its processes and released cleanly before the 13:00Z scheduled Guardian began.

A bounded email/GitHub delta adds no defect or recovery evidence. A setup question led to independently reviewed workflow, model and account documentation through `080c1f50c`; see the [sanitized delta](intake-delta-1012.json). Review corrected agent workstation placement and distinguished explicitly configured spending limits from the shipped soft daily limit. Direct Whop access, installed Mac setup, real-account transitions and multi-agent store outcomes remain unverified.

Read-only release ordering at `9350db92` found all five version pins still 0.13.2. Pre-bump preflight requires READY, including a current-trunk exact-SHA/tree installed receipt. The existing protocol therefore needs a private pre-bump acceptance build before the final version bump and build; do not bypass READY. A bump, notes or claims commit changes source identity, and rebuilding or signing changes artifact identity. Each final candidate must earn its own applicable gates and artifact acceptance.

Full accessible release listings (28 source-repository and 34 artifact-repository records) and v0.14 tag-prefix queries showed no v0.14 reservation at 12:58Z; no version was chosen. Refresh collision evidence before acting. Private review receipt: `.handoff/release-ordering-9350db92-125848.json`, SHA-256 `2afad471ac7b56ad3c28dd5400299443473e25fe7df2e548100d44faad4a3c08`. No build, dispatch, ref push, publication or signing-secret inspection occurred.


## 2026-10-12 follow-up: capacity and native acceptance

Exact 4e56787f passed seven reporting controls, documentation navigation (1,375 assertions / 1,134 internal links), and the read-only website stage check. Its complete fast run failed at step 284 during measured volume exhaustion: available bytes fell from 798,736,384 to zero. The original browser-install fixture is tiny and does not launch Chrome; the storage consumer and failing filesystem operation are not established. The guard recorded no owned descendants remaining and released its lease; supervisor receipt creation failed with ENOSPC. Missing evidence remains missing. HTTP and the source campaign never started. [Revision-bound receipts](source-gates.json).

Prepared source 52cdb7fd adds isolated Windows CredentialManager persistence acceptance and retains the existing macOS jobs. Both independent source reviews accepted it, and nine in-memory guard controls passed. Compilation, Rust tests, native execution, installed Tauri lifecycle and affected-customer recovery remain open. This source slice addresses a coverage gap tied to e7b2ffcd; it does not establish that incident's cause. [Acceptance boundaries](native-credential-acceptance.json).

The old 4e-only retry was never launched and is superseded by the source change. Restore substantial capacity, reprepare an exact-candidate runner and serialize full source gates before trunk integration. Preserve direct Whop and platform/real-account gaps. No release, account or customer-contact action occurred.
