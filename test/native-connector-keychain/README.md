# Native connector credential component acceptance

Prepared for customer report e7b2ffcd; this is **component acceptance**, not installed-app or customer recovery. Windows execution is still owed. No local build, native credential access, workflow dispatch, app/browser process, dependency install, broad gate or HTTP test was performed for this change.

## Scope and safety

The harness includes production `credentials.rs`. The production `connector_encryption_key()` wrapper retains `ai.skynet.harness` / `connectors:encryption:v1` and exactly the existing creation/readback/malformed-value policy. A narrow internal Entry adapter shares that policy. Acceptance never calls the production wrapper: it derives `ai.skynet.harness.acceptance.<run>` / `connectors:acceptance:<run>` from a fresh 32-hex run id.

All native phases require the compiled Windows/macOS platform to match RUNNER_OS, GITHUB_ACTIONS=true, RUNNER_ENVIRONMENT=github-hosted, STARNET_DISPOSABLE_KEYCHAIN=1, a valid STARNET_ACCEPTANCE_RUN_ID and an absolute existing RUNNER_TEMP. Do not spoof these variables to run on a personal machine. No existing OS or provider account is created or changed. The macOS disposable-keychain setup, interactive-prompt suppression, actual locked-keychain refusal, unlock and recovery remain in the workflow. Windows does not simulate a real native lock or denial claim.

`migrate` requires native NoEntry and a nonexistent run directory before creating anything. It creates an exclusive non-secret ownership receipt, generates/reads back the key through production policy, and seals synthetic connector state with the production JS vault. It leaves the entry and evidence intact on failure. A second `migrate` must refuse the now-existing entry; later decryption proves its bytes were not replaced.

`recover` runs as a separate native process, refuses an absent/inaccessible key, rereads it through the shared policy, and uses that key to decrypt the same main/backup files. Its receipt requires a different PID from the sealing process. The key is passed to the short-lived vault-check child through its environment and removed from that child's environment immediately; it is never written to receipts or arguments.

`malformed` first proves this exact owned key decrypts this run's vault, seeds an invalid synthetic value, checks production policy refuses and leaves it intact, then attempts restoration even if a check failed. It records restoration success/failure without key contents and decrypts again. Only `cleanup`, after ownership and decryption checks, deletes the exact derived entry and verifies native NoEntry. Cleanup runs only after successful workflow acceptance; failures preserve receipts and vaults and leave the synthetic entry for disposal with the GitHub-hosted runner. No namespace enumeration or broad cleanup exists. Symlinks/reparse points are refused on owned paths. This is not a claim of hostile same-user isolation.

## Future command plan (not executed locally)

Use the existing `connector-keychain-acceptance` workflow from the reviewed source revision. Do not dispatch it without coordinator approval. It runs Windows on windows-latest plus the existing macOS matrix. On those disposable hosted runners only:

1. `cargo build --locked --manifest-path test/native-connector-keychain/Cargo.toml`
2. `cargo test --locked --manifest-path test/native-connector-keychain/Cargo.toml connector_key_policy`
3. `cargo test --locked --manifest-path test/native-connector-keychain/Cargo.toml acceptance_guards`
4. Allocate a fresh UUID without hyphens; the workflow supplies the opt-in and run id. The Windows opt-out probe must fail before native entry access.
5. Invoke the compiled harness in separate processes: `migrate`; repeated `migrate` (must fail); `recover`; `malformed`; `recover`; `cleanup`. macOS additionally locks its disposable keychain, runs `unavailable`, unlocks and runs `recover` before cleanup.
6. Retain workflow output and upload the run-specific directory from RUNNER_TEMP on success or failure. `owner.json` records source SHA, platform and first PID; `sealed.json`, `recovered-<pid>.json`, `malformed.json`, `cleanup.json` and failure receipts qualify each claim. The expected repeated-migrate refusal also produces a failure receipt; it is a deliberate negative control.

Never run the ignored `connector_keychain_roundtrip` production-entry test or pass `--ignored`. The named `connector_key_policy*` tests use injected closures only: existing/malformed-value preservation, generation only on NoEntry, mismatched readback, simulated initial-read/write/readback refusal. Those simulated errors prove policy branches, **not actual Windows OS-denial behavior**. `acceptance_guards` is pure input validation with no Entry or process calls.

## Pure policy tests: run by fast-gate on every trunk push and PR

`connector_key_policy*` (the `#[cfg(test)]` block in `src-tauri/src/credentials.rs`) and `acceptance_guards` (`src/main.rs`) touch no keychain entry and start no process, so they are safe on any machine. The `rust-policy` job in `.github/workflows/fast-gate.yml` runs both filters on every trunk push and pull request, on ubuntu with keyring's mock store: no `--ignored` and no native phase. It fails if either filter ran no test, so a renamed test can't pass by matching nothing. A policy regression (for example, regenerating over a malformed existing key, which would orphan every sealed connector credential) or a `credentials.rs` compile error turns that job red. The `connector-keychain-acceptance` workflow above runs on manual dispatch only. To run the same two filters locally, when the machine has RAM to spare (not during another gate):

    cargo test --locked --manifest-path test/native-connector-keychain/Cargo.toml connector_key_policy
    cargo test --locked --manifest-path test/native-connector-keychain/Cargo.toml acceptance_guards

Never pass `--ignored`; without it the production-entry `connector_keychain_roundtrip` test stays skipped. The minimum compile check for the app itself is `cargo check --tests --manifest-path src-tauri/Cargo.toml`.

## Validation status and acceptance gaps

Bounded checks passed: production policy branch-body equivalence after substituting the injected read/write calls, absence of production-wrapper/entry calls in the harness, workflow YAML parsing with both jobs present, and git diff --check. On 2026-10-13 both pure filters were compiled and run locally on Windows (x86_64-pc-windows-msvc, `--locked --offline`): `connector_key_policy` 3 passed, `acceptance_guards` 1 passed, no warnings; `cargo check --tests --target aarch64-apple-darwin` also passed. The first run of the ubuntu `rust-policy` job is still owed, as are the Windows native phases and macOS regression execution on the reviewed hosted job. No dependency or lockfile changes are needed.

Even a future passing job proves only native Windows component persistence across two processes with a synthetic entry. It does not prove the exact signed installer, Tauri app-data isolation or launch environment, actual application quit/relaunch, Windows account/session changes, Higgsfield connectivity, real credential-store denial, or customer recovery. Report e7b2ffcd stays open until that separate evidence exists; startup report 85f602c4 remains separate.
