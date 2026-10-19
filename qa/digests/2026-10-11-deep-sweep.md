# Deep sweep since StarNet 0.13.2 — 11 October 2026

All 48 open GitHub issues were reconciled against current source, existing Claude work and the repository behavior contract. This sweep adds repairs for ten independently recorded defects; it does not close all 48 issues or establish customer recovery.

## Source and alignment

Published 0.13.2 source: `54899e5ff3f2b002b457757916b3977818db6fc1`. Aligned local trunk: `a20ffa71fd04691805ea55c7d08165438dd7ac6f` (299 commits, 409 changed paths, 140 changed core application paths since release). Tested candidate: `a75a09e3ebc588ec087de195d420fccef4d6ee7b` on `agent/issue-triage-1011`. The candidate has 141 changed core application paths; the additional path is the voice consent controller. The inventory is paired with targeted behavior checks and explicit untested boundaries.

Current SEND TO authority, SELECT MOVES/THE HAND behavior, one-job builder lending, worker sessions, memory provenance and truthful telemetry remain in force. Twenty-one of 27 selected pending branch heads were included in the aligned baseline; the six remaining heads were examined separately. Equivalent security work was recognized by source even where its commit ancestry differed.

## Repaired findings

| Severity | Finding | Source fix |
| --- | --- | --- |
| P1 | [Crew directives promote negation and upstream data to owner intent](../bugs/5929d898-crew-directives-promote-negation-and-upstream-da.md) | `86e617e46` |
| P1 | [Local peer ownership can match an unrelated loopback socket](../bugs/1df2d6f8-peer-owner-matches-unrelated-loopback-sockets.md) | `f7553cd3e` |
| P1 | [Token overlap attests inverted memory as owner instruction](../bugs/ecd03ee7-token-overlap-attests-inverted-memory-as-owner-i.md) | `05618ec62` |
| P2 | [Answering one prompt clears other parallel approvals](../bugs/47c3a845-answering-one-clarification-clears-other-paralle.md) | `ced84e2f0` |
| P2 | [Remembered update bypasses retry backoff after a failed native check](../bugs/ab2fdd8c-remembered-update-bypasses-retry-backoff-after-a.md) | `927ffb908` |
| P2 | [A named-file search also returns nested files with the same name](../bugs/abc6edf6-named-file-search-returns-nested-namesakes.md) | `15c01f97b` |
| P2 | [Kept style masks a later real rejection after unkeep](../bugs/db8f361d-kept-style-masks-a-later-real-rejection-after-un.md) | `2ce225f88` |
| P2 | [Design references assert requested image properties as observed](../bugs/436ab17d-design-references-assert-requested-image-propert.md) | `2e9c7ffb4` |
| P2 | [Revoked or replaced speech synthesis can publish stale audio](../bugs/4fca711c-revoked-speech-synthesis-publishes-stale-audio.md) | `1d1a89980` |
| P2 | [Workflow style undo can be overwritten by a delayed keep](../bugs/1ee46ab1-workflow-style-undo-can-be-overwritten-by-a-dela.md) | `bf756e00e` |

The parallel-prompt record also includes phone permission settlement (`ced84e2f0`) and voice fallback (`52dc95fff`). Before/after focused tests and controlled seeded Chromium proof are preserved. Phone events and private voice-handler instrumentation do not prove physical phone, microphone, STT or TTS behavior.

## Verification

- `fast`: PASS — 1,139 steps.
- `http`: PASS — 210 steps.
- `journeys`: PASS — 139/139 assertions, no excused failures.
- `beginner`: PASS — UI-only, 6 steps in 39,173 ms; no real-provider task proof.

Earlier fast attempts are retained: one exposed a stale generated bug index, another an outdated remote-answer source assertion. Investigating the latter found and repaired the phone/voice sibling state-loss paths. The earlier HTTP endurance boot timeout and stall transport error remain unexplained; later successful runs do not prove their cause.

Machine readiness: NOT READY. NOT PRODUCT PERFECT.
- 1. Green Guardian last cycle: no guardian cycle recorded — run `npm run qa:guardian`
- 2. Journey corps last run: journeys did not run on the exact current trunk (a75a09e3 vs a20ffa71)
- 3. Beginner Run last result: Beginner Run did not run on the exact current trunk (a75a09e3 vs a20ffa71)
- 4. Installed-exe smoke: installed app unverified — no installed-exe smoke stamp (the rc-soak runner has not written qa/installed/last-smoke.json)

## Remaining work

- Installed data preservation and erase/restart acceptance, macOS checkpoint soak, and the native security matrix. Issues [#107](https://github.com/androoAGI/starnet/issues/107), [#101](https://github.com/androoAGI/starnet/issues/101), [#91](https://github.com/androoAGI/starnet/issues/91).
- Exact sanitized financial/provider incident reproduction; no refund or customer-recovery claim from source fixes alone. Issues [#53](https://github.com/androoAGI/starnet/issues/53), [#106](https://github.com/androoAGI/starnet/issues/106), [#98](https://github.com/androoAGI/starnet/issues/98), [#99](https://github.com/androoAGI/starnet/issues/99).
- Original Etsy attachment and Telegram/delegation/Drive receipt chains. Issues [#104](https://github.com/androoAGI/starnet/issues/104), [#57](https://github.com/androoAGI/starnet/issues/57), [#28](https://github.com/androoAGI/starnet/issues/28).
- Measured provider/CLI efficiency, PR103 reconciliation before duplication, and installed overnight WebView2 soak. Issues [#105](https://github.com/androoAGI/starnet/issues/105), [#68](https://github.com/androoAGI/starnet/issues/68), [#69](https://github.com/androoAGI/starnet/issues/69).
- Durable webhook lifecycle and explicit remaining feature/product decisions. Issues [#97](https://github.com/androoAGI/starnet/issues/97), [#77](https://github.com/androoAGI/starnet/issues/77), [#46](https://github.com/androoAGI/starnet/issues/46).

Native Linux/macOS ownership, actual Windows foreign-user/PID-reuse scenarios, a new signed installer and upgrade, Qwen/WSL, overnight WebView2 performance, original customer accounts and reporter recovery remain unverified. Windows native owner checks passed; adversarial ownership cases were injected. No real subscription cost measurements or customer refund conclusions are claimed.

No issue closure, remote push, release or external customer message was performed. Repairs remain in the isolated candidate; the shared integration checkout was not feature-edited.

## Evidence

- [Readable sweep report, all 48 issue dispositions and next actions](../evidence/deep-sweep-2026-10-11/deep-sweep.html)
- [Machine-readable source inventory, findings, gate receipts and limits](../evidence/deep-sweep-2026-10-11/deep-sweep.json)
- [Provider review](../evidence/provider-deep-sweep-2026-10-11.json)
- [Runtime review](../evidence/runtime-sweep-2026-10-11/coverage.json)
- [Frontend review](../evidence/frontend-deep-sweep-2026-10-11/coverage.json)

Full local raw logs are preserved under `.bugloops/deep-sweep-2026-10-11/`; prior campaign scratch was moved into that owned directory without deletion. Durable report receipts retain exact source IDs and verification boundaries.
