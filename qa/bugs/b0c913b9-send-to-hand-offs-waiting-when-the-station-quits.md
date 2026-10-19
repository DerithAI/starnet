---
fingerprint: b0c913b9
slug: send-to-hand-offs-waiting-when-the-station-quits
title: SEND TO hand-offs waiting when the station quits vanish without a record
surface: world
severity: P2
status: fixed
found: 2026-10-12
lane: conveyor-final-runtime
fix: 9ccd2ba42
origin: audit
---

# SEND TO hand-offs waiting when the station quits vanish without a record

## Symptom

A line whose OUTBOX sends on (SEND TO) to a busy line queues its hand-offs in memory. When the station quit or updated, the waiting hand-offs vanished: the sending jobs read DELIVERED with no "sent on" and no "NOT sent on", and the target line had no record of them.

## Repro

1. LINE A SEND TO LINE B; keep B busy with one hand-off while more A jobs finish.
2. Stop the station WITHOUT an E-STOP first: SIGTERM/SIGINT, the IPC/CLI stop, a bare POST /api/lifecycle/quit, or the desktop shell's ExitRequested path (`stop_sidecar_gracefully`, which posts /api/lifecycle/quit alone). The desktop tray Quit and a full window-close quit go through `drain_and_kill_sidecar` (src-tauri/src/main.rs), which POSTs /api/halt FIRST: handleHalt already ran `handoffRunner.haltAll()` (fix-runtime 24), so on that path the waiting hand-offs were said as "automation is stopped (E-STOP)" before and after f6df7d11f, because that Quit really sends an E-STOP.
3. Restart and open both lines in WORKFLOWS. Before f6df7d11f only the running hand-off's interrupted record existed on those paths: `sidecar/index.js` gracefulShutdown never called `handoffRunner.haltAll`.
4. Wave 2 review: the drain covered only the queue at the moment of quit. Hub-driven jobs (RUN ONE REAL JOB, triggers, hand-offs, channel chats) keep running through the ~3 s shutdown window; one that shipped meanwhile queued a NEW hand-off (onShipped passed preflight: halted() has no shutdown term) and process.exit dropped it with no record on either line.
Regression: `test/routing.handoff.test.js` quit block (4 failures before).
Regression: `test/routing.handoff.e2e.test.js` second test (real sidecar, quit with one running and two waiting; failed before).

## Evidence

Fix f6df7d11f: gracefulShutdown drops each waiting hand-off through the refusal path before the runs are aborted (line-jobs saves synchronously). The new e2e passes 2/2. Live on the isolated station (a bare POST /api/lifecycle/quit, no E-STOP first): Line Q1 SEND TO Line Q2, one hand-off running and one waiting; the shutdown log says "[handoff] p57 → p60 refused: the station stopped before this hand-off ran — send the job again"; after the restart Q2 shows IT DIDN'T RUN with that reason, the running one INTERRUPTED, and the Q1 job reads NOT sent on to LINE Q2 with why. C:\Users\andro\gen-trees\_final-shots\wave2-runtime\b03-b09-queued-handoff-said-after-quit-target-card.jpg, b03-sender-card-not-sent-on-after-quit.jpg.

Wave 2 repair 9ccd2ba42: gracefulShutdown calls `haltAll(why, { close: true })`, which also closes admission (handoff-runner preflight refuses every later hand-off with the same reason; an E-STOP drain never closes it). routing.handoff 109, routing.handoff.e2e 2/2 OK. Live: a Line Q1 job ("Reply with exactly the word: ready") was riding the line when POST /api/lifecycle/quit landed and shipped INSIDE the shutdown window; after the restart Q1 reads DONE and "NOT sent on to LINE Q2 — the station stopped before this hand-off ran — send the job again", and Line Q2 has the IT DIDN'T RUN record from LINE Q1 with that reason (job-d5b07422dadc / job-5e32f1e431b1). C:\Users\andro\gen-trees\_final-shots\wave2-runtime-r2\r2-quit-window-live.json, r2-quit-window-sender-card-not-sent-on.jpg, r2-quit-window-target-card-refusal-recorded.jpg.

## Verdict

Fixed in source on agent/conveyor-final-runtime (f6df7d11f, shutdown window 9ccd2ba42) for every graceful stop that sends no E-STOP; the desktop Quit says E-STOP because it sends one (changing that needs the shell to call lifecycle/quit before /api/halt, or a quitting reason on handleHalt). A hard kill (TerminateProcess, a crash) still skips the graceful path: that needs a durable queued marker on the sending job, a larger follow-up.
