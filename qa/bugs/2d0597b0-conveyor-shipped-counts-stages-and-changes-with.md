---
fingerprint: 2d0597b0
slug: conveyor-shipped-counts-stages-and-changes-with
title: Conveyor SHIPPED counts stages and changes with floor edits
surface: autonomy
severity: P1
status: fixed
found: 2026-10-12
lane: agent/conveyor-stats-1012
fix: c342c7ae7
origin: audit
---

# Conveyor SHIPPED counts stages and changes with floor edits

## Symptom

A COPY/JOINER line could count several shipped jobs when its branches completed one job. Removing its OUTBOX could then erase past shipments from today's count.

## Repro

Stamp PARALLEL CREW, crew each bay, and swap its MERGER for a JOINER. Complete a productive job across all three branches. Read SHIPPED, then remove the OUTBOX and read it again. The three branch runs represent one shipment, and an edit cannot undo that historical event. The executable regression is test/line-stats.test.js.

## Evidence

Against source a20ffa71f, the real WorldModel blueprint/compiler/router combination counted three productive branch rows as three shipments, then zero after removing its OUTBOX. The repaired fold returns one before and after. Production records a durable receipt only at the chain's actual terminal OUTBOX callback, keyed by exact line and entry run, after confirming clean productive run evidence. It never invents receipts for old runs.

Focused verification: line-stats 96 assertions, routing.handoff 76, chain-audit-1010 43, splitter-divide 67, channels.hub 163, cron.chain 67, existing real-sidecar routing.linestats 23. Backend determinism and changed-file syntax passed. test/routing.handoff.e2e.test.js passed through the real sidecar: talk-only SHIPPED=0; an actual fs.write job SHIPPED=1; removing its OUTBOX leaves SHIPPED=1; restarting the sidecar retains SHIPPED=1. The fixture uses a local deterministic provider and no paid service.

## Regression

The old implementation incremented per successful productive run if the current router said its dock reached an OUTBOX. The fix folds persisted terminal-job receipts instead. Regression coverage includes joined branches, repeated loop-stage rows, idempotent callbacks, adjacent channel jobs with identical timestamps, absent historical evidence, unclean/test/workless runs, save failure, bounded run-list history, changed topology and real restart.

## Sibling coverage

{
  "adapters": [{"target":"shared chain runner","state":"covered","test":"test/routing.handoff.test.js","scenario":"exact entry-run identity on terminal callback","gate":"fast"}],
  "entrypoints": [{"target":"sample and SEND TO","state":"covered","test":"test/routing.handoff.e2e.test.js","scenario":"productive file job and downstream routing","gate":"http"},{"target":"scheduled chain","state":"covered","test":"test/cron.chain.test.js","scenario":"exact entry-run identity reaches chain","gate":"fast"},{"target":"channel chain","state":"covered","test":"test/channels.hub.test.js","scenario":"routed entry and downstream stages remain compatible","gate":"fast"},{"target":"Run Now","state":"blocked","reason":"Identity is wired from its existing runId; dedicated productive shipment UI acceptance remains for combined verification."}],
  "displays": [{"target":"routing statistics endpoint","state":"covered","test":"test/routing.linestats.e2e.test.js","scenario":"run/failure counts and window semantics remain intact","gate":"http"},{"target":"native installed floor/panel","state":"blocked","reason":"Source repair only; installer acceptance belongs to the release lane."}],
  "lifecycle": [{"target":"restart and floor edits","state":"covered","test":"test/routing.handoff.e2e.test.js","scenario":"remove OUTBOX and restart without changing past shipment count","gate":"http"},{"target":"failed storage and callback replay","state":"covered","test":"test/line-stats.test.js","scenario":"durable-save failure does not publish a count and duplicate callbacks are idempotent","gate":"fast"}]
}

## Verdict

Source-fixed and real-sidecar verified. Existing history without terminal receipts is not reconstructed from today's geometry. Follow-up storage review found that a failed initial receipt read could cache an empty history and overwrite it after recovery. The regression failed five assertions before the repair; load status is now checked, failed loads remain retryable, and writes fail closed until existing receipts are readable. Real-sidecar fault proof returned an error rather than zero for an invalid envelope, completed work without overwriting it, and recovered the saved count on the next poll after restoration. Combined fast/HTTP gates, UI acceptance and installer verification remain separate; no publication claim.

## Receipt authority follow-up (2026-10-12)

A later fault review found three related history-loss paths: (1) a durable main-file replacement succeeded but read-back failed, leaving an old receipt cache that the next job overwrote; (2) permissive normalization dropped semantically invalid/conflicting receipt rows before the next save; (3) the generic corruption diagnostic renamed an unrecoverable main file, so a second poll mistook its absence for a new empty history.

The actual-domain-store read-back regression failed four assertions before the repair: stale zero while unreadable, durable A lost after B, A absent after restart, and a later duplicate A rewrite. The repair invalidates the cache after any ambiguous save failure and requires an authoritative reload. Persisted receipt validation rejects invalid IDs/rows and conflicting copies of the same job, permits only identical duplicate copies, and preserves exact IDs. Shipment-specific diagnostics preserve corrupt bytes in place. An absent new store can still initialize normally; unreadable/invalid/corrupt evidence never authorizes an empty replacement.

Focused after-proof: test/line-stats.test.js passes 166 assertions, including actual host store initialization with real temporary files, repeated unavailable polls, refused productive callbacks, unchanged forensic bytes, restoration and old+new retention, plus durable A+B retention after an actual durable-write/read-back failure and a fresh ledger load. test/domain-store.test.js passes 10 assertions; changed JavaScript syntax and git diff --check pass. The parent lane independently reproduced all three paths in a running sidecar before this repair, then passed the unchanged --expect-fixed replay on integration candidate 11c0daf5f containing source fix c342c7ae7. Initial stats returned HTTP 200 / SHIPPED 0. Job A reached durable disk (one receipt); injected EIO armed only after its main-file rename succeeded caused stats to return HTTP 500 with no count. Restoring reads and completing productive job B returned HTTP 200 / SHIPPED 2 with A retained, and restart retained 2. A semantically invalid receipt row returned HTTP 500; productive job C preserved the exact invalid bytes; restoring valid history recovered 2. A corrupt main with no backup returned HTTP 500 on both repeated polls; productive job D preserved the exact corrupt bytes; restoration recovered 2. This proof used a private fixture and local provider with actual fs_list tool work; no paid provider or user store was involved. Portable before/after HTTP evidence is owned by the integration lane. No broad gate or installed-app claim is made here.

## Tooltip regression follow-up (2026-10-12)

Combined diagnostic test1110/1145 still required the old literal plain-answer sentence. The accepted source73ff656b4 preserves that meaning and explicitly excludes deliveries without saved shipment records, as the existing live-hover receipt proves. Test-only commitfcb6feb8d evaluates the actual todayTip helper and checks recorded productive delivery, excluded unrecorded history, plain-answer delivery without shipment credit, per-stage RUNS and daily time/spend scope, plus the existing escaped rendering wire. conveyor-ease now passes75 assertions; product text and counting behavior are unchanged.

## Runtime audit follow-up (2026-10-12, agent/conveyor-final-runtime)

Two behaviors above changed on this lane. (1) Retention, 1f3037d64: line-shipments.json grew forever and every shipment rewrote and re-validated the whole history inside chain.advance (the audit's harness measured 0.4-2 s per job at 50,000 receipts). record() now keeps the last 7 days (SHIPMENT_KEEP_MS) when it saves, only after a validated read, so unreadable, corrupt or invalid history still refuses every write; the stats route never reads a window older than that. Regression: test/line-stats.test.js (500 receipts past the window plus two from today; today's SHIPPED +1 after one record). (2) Unreadable history, 5c74929f0: it no longer answers HTTP 500 for the whole LINE WATCH route. The route answers 200 with SHIPPED null on every line plus shippedUnknown (the reason), and RUNS, FAILED, $ against the cap, the median, tests and bay lamps keep counting. The page shows "?" SHIPPED with a tip saying why, holds the OUTBOX pallet, and clears its numbers on any HTTP failure instead of keeping stale ones. The invalid bytes are still never overwritten, and restoring them recovers the count on the next poll. test/routing.handoff.e2e.test.js now asserts the 200/null answer and keeps the byte-identical and recovery assertions. Live on an isolated station with a real model: runtime-live-evidence.json and m10/m31 screenshots in C:\Users\andro\gen-trees\_final-shots\runtime\.

## Runtime repair follow-up (2026-10-12, agent/conveyor-final-runtime)

93f7dbe0b. (1) The history was still bounded by age alone, so a busy line could keep ~50,000 receipts in the window. A save now keeps the last 48 hours and at most the newest 5,000 receipts (~60 ms per save at the cap, measured with the real domain store); when the cap cuts into a stats window, SHIPPED is reported as a lower bound (shippedAtLeast, N+ on the page and to the lead). (2) A productive job that shipped while the history was unreadable was dropped for good, while the ? tip promised the count comes back. Its receipt is now held in memory and written by the first read after a validated load, never over the unreadable bytes; the tip says a restart before then loses it. Regressions: test/line-stats.test.js (count bound at high volume, held then counted, hold bound, partial refusal; two recovery assertions updated from the dropped-for-good behavior, reasons in the commit), conveyor-ease, station-layout. Live on the isolated station: invalid history, a real productive job shipped under ? SHIPPED, the invalid bytes untouched, restoring the file wrote the held receipt and the panel read SHIPPED 2; a seeded 5,003-receipt history read 5002+ SHIPPED with the lower-bound tip (repair-m31-held-job-counted-shipped-2.jpg, repair-m9-shipped-lower-bound-5002plus.jpg).
