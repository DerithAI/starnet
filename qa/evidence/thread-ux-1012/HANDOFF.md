# Thread UX handoff — 2026-10-12

Frozen source/test candidate: 7dd049d134b61262baedca859f6cfb9e1671d327 (product source unchanged from fcd8007ca473d52488986537e304370c37f7f9a0) on agent/thread-ux-review-1011, based on trunk a20ffa71f. All product edits are isolated. No trunk merge. This includes the saved-history correction after 18c1ec59f, background response ownership in 049e6ff7e, and confirmed spoken approvals in fcd8007ca and supersedes a69664135, which had confirmed large-output truncation and final-write ordering defects.

## User-facing changes

- Worker approvals show the full redacted request; questions use Answer and retain independent sibling attention. Failed submissions remain retryable, including concurrent phone answers.
- Worker files retain agent/project ownership, group attachments retain the message's version, and agent filters find delegated participation.
- Opening older work preserves reading position and draft. Recovery preserves existing message nodes, disclosures, focus and selection; narrow cards have no horizontal overflow.
- Worker outcomes retain verified reasons; older recovery cannot settle a newer retry. Delayed assignments produce one parent report.
- Repaired structured answers become the authoritative conversation result. Exact-run inspection keeps original/repair execution evidence separate.
- Complete accepted answers persist before final status. Recovery verifies final identity, exact length and SHA256. Truncation/corruption remains retryable without reserving delivery IDs. A saved answer whose status write was interrupted finalizes on restart without a model rerun or duplicate spend. A failed answer write retains its failure diagnostic, including while the page is offline.
- Saved rejected output is superseded only by a canonical final with the same explicit run ownership. Duplicate copies preserve their attachments and taint; previous failure flags remain separate evidence. Newly delivered replies keep run/conversation identity, so reopening does not duplicate them.
- Desktop and phone history/continuation share the same accepted-answer projection. Phone previews exclude repair instructions. Old closed indexes without preview provenance omit their preview until normal rebuild; the underlying history remains accessible.

## Final voice fixture correction

The combined candidate baa58078b5784670e4dd199549b8ac6b6b8b58f7 stopped at fast step311 because its appended voice test still called the old eager fallback contract. The exact candidate fixture was reproduced in this isolated tree: line316 expected a Harness call but observed none. It omitted Chat, so the current controller correctly took its cannot-submit branch. The fixture also lacked module submission/call state, asserted synchronous effects, and returned an array length rather than an acknowledgement.

Test-only commit 7dd049d134b61262baedca859f6cfb9e1671d327 executes the real approvalCommand and Chat.answerConsent with real Channels and awaited acknowledgements. It retains the complete existing test prefix and original three-decision routing, sibling, elapsed-time and pause-close assertions, plus negative controls for in-flight/deduplication, refusal/rejection/retry, stamped run ownership, applied denial, questions, call generation/rebinding and a remote answer winning local failure. Production code did not change; desktop and website voice source are identical to the reported combined candidate.

[Voice fixture verification](voice-fixture-verification.json) records exact before/after blobs and source identity. Voice UI passes, bell34 and useful-notifications46 pass, and thread UX passes16 cases. Syntax/diff checks pass. No full gates, seeded runtime, microphone or installed acceptance were run for this test-only correction. Release coordination owns the final combined gates. If merging the appended fixture conflicts, preserve its full behavioral block rather than restoring the eager fallback test; any newer unrelated test additions still belong to their owner.

## Latest response-ownership follow-up

The combined gate exposed three stale fixtures and one real background-prompt defect. Source commit 049e6ff7e7c92b7b0f38ab34ce1eeb9ae30c7833 fixes known remote responses leaving background/delegated prompts pending. It also replaces stale file-replay and eager-notification source assertions with executable behavioral tests and negative controls. No file-rendering production change was needed.

Adjacent source audit commit fcd8007ca473d52488986537e304370c37f7f9a0 routes spoken approvals through confirmed Chat.answerConsent rather than clearing sibling prompts optimistically. It guards duplicate submissions, actual applied outcomes, call/chat rebinding, and a remote response winning a failed local request. These are separate, reviewable commits; no original customer causality is inferred.

[Response ownership verification](response-ownership-verification.json) binds all eight changed JavaScript files and served chat/voice bytes to fcd8007ca. Replay 27, useful notifications 46, bell 34, remote sessions 30, voice UI and 35 UX/consent cases pass. Both website mirrors match. Five replay mutation controls reject missing sort, missing trailing files, wrong workspace ownership, duplicate incremental files and missing exception cleanup.

Live seeded proof: no consent cards were mounted in the viewed chat; two worker prompts belonged to a background parent. The first remote response left only the second worker pending and waiting in the bell; duplicate/unknown responses changed nothing; the last response cleared the original parent bell. A different conversation's prompt remained. Replayed files appeared before/after their associated reply, the clicked link navigated to the original Mira workspace/path, and incremental insertion retained exactly two file rows. Zero page exceptions. Model/permission events and file contents were controlled fixtures. No microphone/live voice-call acceptance was tested.

Canonical records: 402ce8f7 for background prompt ownership and 35c720c1 for the adjacent spoken-approval issue. Customer record 082ee8e5 remains OPEN. No full gates or root mutations were performed; release coordination owns the combined gates and fast.list union.

## Saved-history verification

[Saved-history verification](saved-history-verification.json) is bound to 4c3d9c3019f8475eae283c62757d7e94a9296fdc. Eight focused suites pass 518 assertions, and UX/consent passes 34 cases. All nine JavaScript files changed since 18c1ec59f pass syntax checks; desktop/website bundles and desktop/phone reconciliation match. The diff is whitespace-clean.

The live seeded browser proves that save/reload retains one accepted answer, both attachments, and the historical status line; rejected output is absent. Obsolete failure flags remain separate evidence, with no error styling or stale retry state on the accepted answer. The actual next-send request contains the accepted answer exactly once and no rejected output or system marker. Both changed frontend files match served bytes; zero page exceptions. Canonical data and follow-up responses are synthetic fixtures; save, reload, rendering and request construction are real app paths.

Real sealed-phone HTTP on that candidate passes 112 assertions, including previously saved rejected rows, restart, and actual follow-up provider context. The only two failures are existing portrait/animation checks because the sparse tree lacks frontend/assets. No shared asset links or copies were created.

## Prior large-output verification

[Large-output verification](large-output-verification.json) remains bound to 18c1ec59f094775ada818175d927e9c4ffc845d8. Real-sidecar HTTP: 154 assertions pass, including 250,030-character repaired Unicode JSON, full tail/hash after restart, original/repair distinction, failed projection writes, failed final run patches, and repeated restart. Focused tests include 31 UX/consent cases and thirteen component suites: station 306, delegated 107, Workstreams 212, tickets 54, transcript 112, segmented history 50, runstore 148, per-turn 33, torn-tail 16, taint 69, orchestration 342, remote core 76, remote sessions 30. All 22 JavaScript files changed since a696 pass syntax checks; the diff is whitespace-clean.

Real sealed-phone end-to-end: 108 assertions pass, including accepted history, safe previews, follow-up model context, and restart. Two existing portrait/animation assertions fail because this sparse checkout has no frontend/assets. No links or copies of shared assets were created. The prior HTTP suites ran on 5513ad487; 18c1ec59f added only a corrected test expectation that phone answers clear their exact prompt.

The exact 1,048,576-character structured-result boundary survives a greater-than-4-MiB escaped disk row and restart with full content/hash. Oversize final persistence is rejected explicitly. Ordinary raw execution transcripts retain their existing 200,000-character inspection cap.

Live seeded browser: both chat and See work recover 210,026-character JSON with identical SHA256 and complete tails. Truncated and altered output show retry; neither reserves delivery deduplication, and correct retry delivers once. All nine changed frontend files match served bytes; zero page exceptions. These edge fixtures supply synthetic run/delivery responses; actual backend endpoints and persistence/restart are tested separately through real-sidecar HTTP.

Earlier reader-state proof and approval/file/filter/navigation results remain bound to their original candidates in [regression-verification.json](regression-verification.json) and [verification.json](verification.json). They are retained as prior observations, not relabeled as new runs.

## Integration limits

Full fast is NOT green: the last broad attempt passed 293/1140 steps, then failed Skill Market catalog checks because the sparse checkout lacks license/signature/zip fixtures. Full HTTP is NOT green: the last broad attempt passed 48/209 steps, then failed station-layout's offered-tool assertion. Auxiliary request selection is suspected; baseline causality is unproven. Those broad attempts preceded the final fixes; complete combined gates remain required before integration.

Phone presentation retains its existing 20,000-character per-turn display cap; no claim of full large-answer phone rendering.

Import the full candidate, including sidecar/dispatch-delivery.js, transcript/run storage, startup recovery and delivery=1 route. Preserve newer coordination changes when merging; do not reset or rebase over them.

Coordination handoff: the release coordinator reports combining phone 9e3b371c7 and desktop 4c3d9c301, with complete-fixture phone HTTP 114/114 and eight focused suites passing. These are coordinator-reported observations, not additional runs in this tree. Preserve its fast.list union registering remote-dispatch-history.test.js (reported 1154 entries), newer preview-provenance changes, and other lanes. The coordinator owns complete combined gates. This source lane is frozen at the candidate above; only evidence follows.

Customer record 082ee8e5 remains OPEN. Original reported request acceptance, installed-build behavior and customer recovery are separate and unverified. No installer, full-product or release-readiness claim.
