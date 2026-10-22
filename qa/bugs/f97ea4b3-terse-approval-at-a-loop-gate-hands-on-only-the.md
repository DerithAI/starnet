---
fingerprint: f97ea4b3
slug: terse-approval-at-a-loop-gate-hands-on-only-the
title: A terse approval at a LOOP gate hands on only the approval, never the work it approved
surface: world
severity: P1
status: fixed
found: 2026-10-18
lane: lines/terse-approval
fix: 6471f0ade
origin: audit
---

# A terse approval at a LOOP gate hands on only the approval, never the work it approved

## Symptom

On a line with a review step (researcher > reviewer > LOOP until approved), a reviewer that approved without restating the work ("Looks good.\nVERDICT: approved") handed on nothing but "Looks good.". When the gate's DONE lane ran to the OUTBOX, "Looks good." was the line's whole result: the channel reply, the routine result, the job record and SEND TO all carried it instead of the research (in v0.13.5 too). When the DONE lane ran to another dock, that stage (a designer) was handed the approval and no research, because hops no longer replay the line's transcript (trunk only).

## Repro

1. Build INBOX > writer > reviewer > LOOP (until approved, DONE to the OUTBOX). The writer answers with three research findings; the reviewer answers "Looks good." then "VERDICT: approved".
2. RUN ONE REAL JOB (or STEP THROUGH).
3. Before 6471f0ade the job delivers "Looks good.": `sidecar/routing/chain.js` loopDecision handed on `Verdict.stripVerdict(text)`, the reviewer's reply minus its VERDICT line, whatever the reviewer had been handed. With the DONE lane to a dock, that dock's handoff carries "Looks good." alone.
Regression: `test/loop-verdict.test.js` terse-approval blocks (6 failures on the old chain.js), `test/chain.join-loop.test.js` (8), `test/routing.steptest.test.js` (2), `test/chain-audit-1010.test.js` (2).
4. Review of 6471f0ade: a reviewer that returned the finished version with its corrections, reworded past half the draft's three-word runs (the Creative Studio preset reviewer's fixture keeps 6 of 21), had its version swapped back for the draft it corrected at the OUTBOX, and a dock was told the reviewer "passed the work on without restating it". `sidecar/routing/chain.js:128` carriesWork now also counts a reply that keeps two thirds of the work's distinct words as the work.
Regression: `test/loop-verdict.test.js` edited-approval block (2 failures on 6471f0ade alone).

## Evidence

Fix 6471f0ade (cherry-picked onto trunk 20124fa18 from the terse-approval lane, no conflicts) and 85a881356. Each new block fails on the code before it and passes after: loop-verdict 6 problems then OK (55 assertions with both commits), chain.join-loop 8 problems then OK (132), routing.steptest 2 problems then OK (192), chain-audit-1010 2 problems then OK (167). Also OK on the same tree: chain, chain.limits, chain.multibay, channels.hub, channels.multibay, conveyor-ease, conveyor-results, cron.chain, joined-product-truth, line-hop-stop, line-too-long, linefix, loop-unapproved-truth, routing.handoff, routing.steptest.multibay, sendto-entry-verdicts, splitter-divide, station-builder-lineops, station-layout, step-brief, steptest-restart-spend, trigger-polish, workflow-line, blueprint-completion, failopen-ratchet. The original lane's live A/B (a real sidecar with a mock model): REVISION LOOP delivered "Looks good." on trunk and the research with 6471f0ade; THE CRUCIBLE's SHIPPER was handed "Looks good." on trunk and the research with it. Not re-run live on the integrated tree; the fast and HTTP gates were not run here.

## Verdict

Fixed in source on agent/terse-approval-fix (6471f0ade, with 85a881356 for the reworded-approval case). An approval that does not carry the work hands on the work it approved: to a dock framed with the approval as its review, out of the line the work alone, unclipped. A reply that restated the work, or returned it with corrections, stays the work. Combined fast/HTTP gates are owned by the coordinator.
