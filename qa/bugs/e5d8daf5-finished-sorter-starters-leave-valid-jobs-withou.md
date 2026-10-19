---
fingerprint: e5d8daf5
slug: finished-sorter-starters-leave-valid-jobs-withou
title: Finished sorter starters leave valid jobs without an OUTBOX
surface: world
severity: P2
status: fixed
found: 2026-10-12
lane: conveyor-caps-1012
fix: 9ac0faeec
origin: audit
affected: 0.13.2 source a20ffa71f
---

# Finished sorter starters leave valid jobs without an OUTBOX

## Symptom

The Sorting Office and Code Foundry starters could finish a valid job but report that the line never reached its OUTBOX. Sorting Office had no OUTBOX; Code Foundry's general-work branch ended at its bay.

## Repro

1. Stamp Sorting Office or Code Foundry into a room large enough for its declared dimensions and crew every bay.
2. Send a general job through its INBOX and have the chosen agent complete a real tool action and return a result.
3. Before the repair, POST /api/routing/sample returned HTTP 502 with ok:false and delivered:null despite a durable done run. Inspect the stamped output lanes: Sorting Office has no OUTBOX, and the Code Foundry generalist has no output belt.
4. Run test/blueprint-completion.test.js to repeat the real model/compiler/router/executor coverage for code, research and general branches.

## Evidence

The baseline sidecar probe at source a20ffa71f observed done plus a valid deliverable note for both general branches, then HTTP 502 with delivered:null. After the repair, actual local sidecar samples for code and general on both templates returned HTTP 200, ok:true and the correct delivering agent. Code Foundry's code sample ran both its developer and reviewer; its general sample ran the generalist. The local provider was deterministic and incurred no paid service usage.

frontend/app/worldmodel.js now gives both Sorting Office branches output belts and OUTBOX doors inside an expanded 13-by-5 stamp; Code Foundry's general branch gains an OUTBOX without changing its 19-by-7 dimensions. Their descriptions match the branch roles. Existing SEND TO and handoff fixtures now use the recipe's own door instead of constructing a missing one.

Focused tests passed: test/blueprint-completion.test.js, test/blueprints.test.js (2346 assertions), test/station-builder.test.js (5556), test/line-sendto.test.js (92), test/routing.handoff.test.js (75 at this lane's base). The completion regression compiles the actual stamp, executes every content branch through the real chain runner, checks terminal shipping authority, validates separate branch doors, and repeats after serialization.

## Verdict

Source-fixed with actual-sidecar successful-job proof. Each starter branch now has a complete physical route to an OUTBOX. This receipt does not assert installation or publication of a new desktop build; combined gates and browser review are owned by the integration lane.
