# Qwen allocation failure and station graphics recovery

Source repair: `agent/qwen-render-loss-1012`, based on `a20ffa71f`.
Graphics changes end at `bc5ed0c6e`; the tested graphics candidate is `bb380c04720083c31eb5f84b6cb1c36ddfc5e6a5`. The subsequent run-postmortem integration fix is `0b49c64a0c96568adbc59d6a13af56857177d84e`, documented below.
Integration and installer verification remain pending. This lane has not merged, rebuilt or replaced the installed app.

Frozen candidate path map (`a20ffa71f..bb380c047`):

```text
frontend/app/friendlyerror.js
frontend/app/propremaster.js
frontend/app/world.js
qa/BUGS.md
qa/bugs/0db3e69c-gpu-loss-replaces-authored-props-with-legacy-art.md
sidecar/providers/errorClass.js
sidecar/providers/openai-compatible.js
test/canvas-loss-recovery.test.js
test/fast.list
test/friendlyerror.test.js
test/projection-depth-rendering.test.js
test/prop-recovery-live.e2e.test.mjs
test/prop-remaster-recovery.test.js
test/provider.ollama-native.test.js
website/app/app/friendlyerror.js
website/app/app/propremaster.js
website/app/app/world.js
```

`qa/BUGS.md` is generated and should be regenerated after combining bug records. Independent source review's two live-test evidence recommendations are included in `74c8e0ff2`. Integration review subsequently found an allocation failure in supported service/content/machine modes (not the current default approved-art manifest); `bc5ed0c6e` fixes that guarded CPU composition path. Its independent final review found no material defect and independently passed all 13 pixel scenarios.

## Incident and cause

The owner reported that every prop glitched and older artwork became visible after a Qwen conversation. The two owner screenshots also show missing floor/wall surfaces and a disconnected station.

Local evidence from installed 0.13.1 connects the failure to memory pressure: an internal session-recommendation request loaded Llama 3.1 8B and finished at 23:59:48 EDT; Qwen 3 8B started at 23:59:55 with an 8192-token context. Its 4643.78 MiB CUDA allocation failed at 00:00:04. Windows recorded low virtual memory at 00:00:05, followed by the WebView GPU-process exit and a sidecar restart at 00:00:10. A later 40960-token task context also failed allocation, but that was after the initial collapse.

Two source defects made lost graphics persist: PropRemaster treated a lost authored canvas as a permanent draw failure, exposing the legacy procedural renderer; the floor watchdog permanently disabled itself after transient readback errors. The old renderer remains intentionally present for classic review and saved custom-footprint compatibility. Normal authored props now retain their own artwork during loss.

## Repair

- Retain bounded CPU snapshots of authored bodies, foregrounds and idle-screen state; preserve geometry, picking and pure status overlays while rebuilding from source images.
- Rebuild through a deduplicated queue with at most four active jobs. Reject empty replacements, stale runtime-art replacements and unbounded retry loops. Global canvas recovery also restores authored props.
- Use guarded CPU composition for service/content/machine recovery. Pure service/content overlays remain live when CPU composition is available; if it also fails, retain the authored body and limit composition allocation retries to once per three seconds.
- Keep transient floor-probe errors recoverable. Use an actual occupied tile as a witness so sparse layouts do not trigger repeated false recoveries. Permanent security taint remains terminal.
- Treat adapter-proven Ollama allocation errors as terminal for that run, including native, streaming and compatible fallback paths. Explain the memory failure and open the model picker instead of inviting another automatic retry.
- Keep the desktop and website copies of all three changed frontend modules byte-identical.

## Verified evidence

| Check | Result |
| --- | --- |
| Original renderer in the live seeded app | Reproduces: authored alpha 128578 becomes 0, draw=false permanently after loss |
| Final renderer in the live seeded app | Pass: same authored alpha 75029 before, during and after loss (supply-cart view); synchronous immediate paint reports lost=1; completed reconstruction reports lost=0/recovering=0 |
| Floor after live cache loss | Pass: occupied-tile probe `(42,42)`, probeOff=false, blank=false; no uncaught browser exceptions |
| Graphics gate through the hermetic test runner | 5/5 suites pass, including 13/13 real-pixel lifecycle scenarios, 44 canvas-loss and 35 stage-loss assertions |
| Native Ollama, error classification and friendly UI | Pass: 168, 284 and 330 assertions respectively; broader fast gate also passed these before its release-audit blocker |
| Full fast gate | Blocked at step 357/1140, `test/qa-product-perfect-claims.test.js`; saved release source differs in friendlyerror.js, propremaster.js and world.js |
| Full HTTP gate | Pass: all 209 steps green, including native/compatible Ollama and the previously ENOSPC-blocked sample-provider case |

The release audit was read without modifying its shared ledger. Exact returned source lock: `1df52b78574a6ba00758bdeefd10392de14346b5`; inspected candidate: `0a474ec9a5c0271288a9d7a31438c31b32113457`. The integration owner must refresh the final candidate's release-source evidence and rerun the full gate. These expected mismatches are not a green gate.

The HTTP run began before the final frontend-only compositor addendum; the sidecar source stayed identical throughout. The final `bb380c047` renderer and tests were then exercised through the separate five-suite graphics gate. This receipt does not claim that a complete combined gate ran against one frozen final revision.

Owning worktree logs: `.dogfood/render-baseline.log`, `.dogfood/graphics-gate-composition-final.log`, `.dogfood/render-composition-final.log`, `.dogfood/full-fast-hydrated.log`, `.dogfood/release-claims-blocker.log`, `.dogfood/full-http-final.log`.

Focused reproduction command:

```text
node scripts/run-fast-tests.mjs prop-remaster-recovery prop-recovery-live projection-depth-rendering canvas-loss-recovery stage-context-loss
```

The browser test uses a real isolated seeded sidecar and headless Chromium with deliberate canvas-loss injection. It does not exhaust memory or reproduce a physical GPU-driver reset. It waits up to 15 seconds for proven floor pixels instead of a fixed sleep under software-rendering load.

## Remaining limits

The source fix does not guarantee prevention of the first OS/GPU exhaustion. Recommendation generation captures the currently selected provider/model; the evidence does not prove accidental model routing. The prior Llama request was already complete when Qwen began, so cancellation alone would not remove its resident model. No existing safe memory-admission or unload guard was found. Automatic unload and fixed context caps would change model-management policy and could interrupt valid sessions.

The installed 0.13.1 binary remains unchanged and owner recovery is unconfirmed. The durable P1 remains open at `qa/bugs/0db3e69c-gpu-loss-replaces-authored-props-with-legacy-art.md` pending integration/release acceptance.

Storage constraints also affected verification: an earlier customer-journey run stopped at step 2 because its isolated recovery journal could not be persisted (ENOSPC). The sparse checkout now explicitly retains only its independently checked-out runtime asset subset; it does not contain all historical asset/evidence archives. A failed browser rerun after cherry-pick exposed that excluded assets were pruned by Git; retaining the subset fixed the fixture failure, and the final five-suite graphics gate passed. No shared asset directory was modified for this repair.

## Integration follow-up: explicit memory postmortem

The integration owner reported that combined candidate `6f7361a721bbd932d14f23e5a28117e120b4ebf4` passed its first 598 fast steps, then failed `test/slag-known-error-kinds.test.js` because the new Friendly kind lacked a decided postmortem bucket. This lane independently reproduced the missing-kind failure before editing.

Source fix `0b49c64a0c96568adbc59d6a13af56857177d84e` changes only `frontend/app/slaglog.js`, its exact website mirror `website/app/app/slaglog.js`, and `test/slag-known-error-kinds.test.js`. `local_model_memory` is now NAMED: title remains `errored out`, and the actual Friendly guidance is preserved. Its specific cause states that the model could not allocate enough memory and directs freeing memory or choosing a smaller model. It never claims that no earlier work occurred. Unknown errors and timeouts keep their existing generic behavior; provider loading/placement logic is unchanged.

Focused gate passed all four suites: native Ollama 168 assertions, Friendly 330, SlagLog 37, exhaustive known-kind/stalled-build contract 153. The new coverage exercises a two-turn allocation failure through actual Friendly and SlagLog, preserves unknown/timeout reporting, and drives the real WorkQuestStore event-to-notification path. Independent read-only review found no concrete defect.

Live visible proof used a fresh seeded sidecar and browser profile with injected `agent.run.start`, explicit allocation `agent.run.error`, and two-turn `agent.run.end` events. The real World postmortem retained the specific allocation cause. The visible stalled-build notification said to close competing local models/apps or choose a smaller model in COMMS, with conditional restart guidance; it did not substitute generic reporting advice. The toast was on-screen at `(11, 301)` with size `409 × 278`; browser exceptions were empty. No real model request or installed-app mutation occurred. Evidence: `.dogfood/slag-before.log`, `.dogfood/slag-focused.log`, `.dogfood/slag-live.log`, `.dogfood/slag-memory-live.png`; reproducible isolated probe `.dogfood/slag-memory-live.mjs`.

No further broad gate ran in this lane. The integration owner must include this source commit in the next frozen candidate and rerun the required combined gates; the installed incident remains open.

## Integration follow-up: authored picking during loss

The owner's diagnostic continuation of the unchanged combined candidate found a second outdated contract at original step 1018: `test/remaster-physical-fit.test.js` expected lost authored caches to return null from picking. That expectation belongs to the removed permanent native-fallback behavior. It was independently reproduced here before updating the test.

Test-only commit `7504418c559b58371911c30573c565eb56575a61` replaces that single expectation with the complete 16-pixel authored silhouette before/after loss, unchanged retained alpha bytes, and unchanged fitted box/crop/footprint returned by real `viewGeometry`. It refuses any lost GPU-canvas read. Opaque crown/foot pixels stay selectable; clipped corners and open leg gaps remain unselectable; custom footprints still return null for their existing native contract. No production code or unrelated fallback assertion changed.

Both targeted suites pass: physical-fit/save/selection regressions and all 13 actual RGBA recovery scenarios. Logs: `.dogfood/physical-fit-before.log` and `.dogfood/physical-fit-after.log`. Command: `node scripts/run-fast-tests.mjs remaster-physical-fit prop-remaster-recovery`. The related-test review found no additional stale loss expectation in remaster/prop/authored tests. This targeted result does not claim a green combined full gate.
