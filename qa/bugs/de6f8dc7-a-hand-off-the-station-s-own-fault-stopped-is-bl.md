---
fingerprint: de6f8dc7
slug: a-hand-off-the-station-s-own-fault-stopped-is-bl
title: A hand-off the station's own fault stopped is blamed on E-STOP
surface: world
severity: P2
status: fixed
found: 2026-10-12
lane: conveyor-final-runtime
fix: 20134a0af
origin: audit
---

# A hand-off the station's own fault stopped is blamed on E-STOP

## Symptom

When an internal fault quiesced the station (process-fault containment), the surfaces blamed a stop nobody made: a handed-on job's record said "E-STOP stopped this job" and hand-offs refused afterwards said "automation is stopped (E-STOP)" (a trigger's blockedBy too); the wave 2 review found the siblings: a STEP THROUGH ended "E-STOP was pressed — the test stopped mid-run", RUN ONE REAL JOB's record and answer said "you stopped this job" (card: "You stopped this job."), every chat the containment killed was told "E-STOP was pressed in the station", and a stopped hand-off's card showed that chat notice under "What came out" (also after a real E-STOP).

## Repro

1. A SEND TO hand-off is running on LINE B.
2. An uncaught exception quiesces the station (quiesceForProcessFault sets processFaultQuiesced; halted() reads it).
3. Before af503416f `sidecar/routing/handoff-runner.js` wrote `err = 'E-STOP stopped this job'` for any halted() stop.
Regressions: `test/routing.handoff.test.js` fault block (2 failures before), `test/trigger-sweep.test.js` (1 failure before).
4. Wave 2 siblings: quiesceForProcessFault `killAll(...)`s the channel, step-test, trigger, hand-off and sample hub runs, which sets `rec.halted` (the E-STOP flag), and `contain('sample')` set `sampleInFlight.stopRequested` (the ■ STOP flag). The hand-off hub's send hook recorded the hub's "⏹ Stopped — E-STOP was pressed…" notice as the job's output.
Regressions: `test/halt.test.js`, `test/channels.hub.test.js`, `test/routing.steptest.test.js` (markFaulted absent before), `test/process-fault.test.js` (7 index.js pins, false on the previous head), `test/station-builder-lineops.test.js` (1 failure before), `test/routing.handoff.test.js` notice block (2 failures before), `test/workflows-window.test.js` (3 failures before).

## Evidence

Fix af503416f: both runners take a faulted() dep (processFaultQuiesced and not the Commander's E-STOP) that only picks the words. routing.handoff 82, trigger-sweep 47, routing.triggers 104, trigger-polish 30 OK.

Wave 2 repairs: 20134a0af (`sidecar/halt.js` markFaulted: the containment marks each hub run faulted right before the ordinary killAll; the hub's notice, the step test, the sample record/answer (stoppedBy: 'fault') and station.test_line name the fault), 9ccd2ba42 (the hand-off's send hook keeps nothing once the station is stopped), 7f40074fb (the card says a stored reason as a sentence and never "You stopped this job." over a fault). Live on the isolated station started with STARNET_UNCAUGHT_KEEP_SERVING=1: a Line Q1 → Q2 hand-off running on Q2, a STEP THROUGH running on Line S and RUN ONE REAL JOB running on Line A, then POST /api/dev/fault. Q2 record: stopped, "the station hit an internal fault and stopped this job", output "" (no ⏹ notice); Line A answer 502 {stopped:true, stoppedBy:"fault", error:"stopped — the station hit an internal fault and stopped this job before it reached the OUTBOX"}, its record the same words; STEP THROUGH: stopped, "the station hit an internal fault — the test stopped mid-run". After a normal restart the WORKFLOWS cards read "The station hit an internal fault and stopped this job. What already ran is counted." C:\Users\andro\gen-trees\_final-shots\wave2-runtime-r2\r4-fault-wording-live.json, r3-r5-fault-stopped-handoff-card-no-estop-notice.jpg, r4-r5-fault-stopped-sample-card-not-you-stopped.jpg. The chat notice wording is unit-proven only (no chat channel on the isolated station).

## Verdict

Fixed in source on agent/conveyor-final-runtime (af503416f; siblings 20134a0af, 9ccd2ba42, 7f40074fb). Live-proven on the hand-off, RUN ONE REAL JOB and STEP THROUGH surfaces.
