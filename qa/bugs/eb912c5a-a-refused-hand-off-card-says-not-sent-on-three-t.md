---
fingerprint: eb912c5a
slug: a-refused-hand-off-card-says-not-sent-on-three-t
title: A refused hand-off card says not sent on three times
surface: world
severity: P2
status: fixed
found: 2026-10-12
lane: conveyor-final-runtime
fix: a49b5b96e
origin: audit
---

# A refused hand-off card says not sent on three times

## Symptom

On E-STOP the target line's job window read "LINE A tried to send its result on to this line — it was not sent on, so nothing ran here." and then "not sent on: automation is stopped (E-STOP) — nothing was sent on": three "not sent on"s in one card; the sender read "NOT sent on to LINE B — automation is stopped (E-STOP) — nothing was sent on."

## Repro

1. LINE A SEND TO LINE B; press E-STOP.
2. Send LINE A a job; open both jobs in WORKFLOWS.
3. Before a49b5b96e the reason carried its own suffix (`'automation is stopped (E-STOP) — nothing was sent on'` in `sidecar/routing/handoff-runner.js`) and `frontend/app/windows/workflows.js` showed the record's "not sent on: " prefix again.
Regressions: `test/routing.handoff.test.js` (3 failures before), `test/workflows-window.test.js` (3 failures before).

## Evidence

Fix a49b5b96e: bare reasons at the source and the window shows a refused record's reason without the prefix, capitalized; website mirror synced. Live on the isolated station: E-STOP, two Line Q1 jobs; Line Q2 card reads "Automation is stopped (E-STOP). (2 hand-offs from LINE Q1 were refused like this — the last just now)" and the sender "NOT sent on to LINE Q2 — automation is stopped (E-STOP)." C:\Users\andro\gen-trees\_final-shots\wave2-runtime\b09-estop-refusal-card-says-not-sent-on-once.jpg, b09-estop-sender-card.jpg.

## Verdict

Fixed in source on agent/conveyor-final-runtime (a49b5b96e).
