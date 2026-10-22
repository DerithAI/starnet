---
fingerprint: d3a76db3
slug: the-per-run-dollar-cap-does-not-bound-team-spawn
title: The PER RUN dollar cap does not bound team.spawn workers, so a 5-cent cap ran 24 cents
surface: providers
severity: P1
status: fixed
found: 2026-10-20
lane: sweep/providers
fix: 4439b14ee
origin: audit
---

# The PER RUN dollar cap does not bound team.spawn workers, so a 5-cent cap ran 24 cents

## Symptom

SETTINGS › SPENDING LIMITS promises PER RUN is a "Hard ceiling for a single agent run. The run stops the moment it would exceed this." With PER RUN at $0.05, one Commander request that delegates to clones spent $0.24 (lead $0.08 + four workers at $0.04 each), plus $0.08 of post-run aux passes. Each spawned worker carries its own full PER RUN ceiling, and the lead itself finished at $0.08, past its $0.05 cap, reason "done".

## Repro

1. Boot with `SKYNET_BUDGET_PER_RUN=0.05` (or set PER RUN to 0.05).
2. Give the lead the orchestrator object and a model that answers its first turn with `team.spawn` of 4 tasks; every model call costs $0.04 (`usage.cost`).
3. Send one message; read every agent.run.end, the ledger and /api/budget/status.

## Evidence

Live on the sweep rig (sidecar on :9711 from the sweep-providers worktree, mock OpenRouter on an ephemeral port, SKYNET_OPENROUTER_BASE pointed at it) (mock/team-lead, cost 0.04 per call): `caps {"perRun":0.05,…}`; `lead end {"reason":"done","usd":0.08}`; `all ends [sub-…a834 done 0.04, sub-…dabc done 0.04, sub-…6cf4 done 0.04, sub-…055f done 0.04, agent done 0.08]`; ledger `TOTAL 0.3200` (incl. two $0.04 aux rows for `agent`); `budget day {"usd":0.3323}`; mock saw 8 POSTs `["L","W","W","W","W","L+","W","W"]`.

Mechanism: `sidecar/tools/builtin/orchestration.js:926` and `:1189` start each worker/clone with `maxCostUsd: perWorker`, and `perWorker` is `ORCH_PER_WORKER = num(ENV('BUDGET_PER_WORKER'), 0)` (`sidecar/index.js:871`) — 0 means each worker falls back to the full per-run cap (`sidecar/index.js:20382`). Nothing charges worker spend against the lead's run tally. The lead overshoot is the cap being checked between turns. The PER RUN hint is `frontend/app/stationui.js` "Hard ceiling for a single agent run. The run stops the moment it would exceed this."

- Regression: `test/run-cap-bounds-spawn.e2e.test.js` (in test/http.list: the REAL sidecar booted hermetically, mock OpenRouter billing $0.04 per call via `usage.cost`, PER RUN $0.05, the lead answers with `team_spawn` of 4 tasks). RED before the fix, reproducing the sweep exactly: `lead=done $0.08 workers=[done $0.04, done $0.04, done $0.04, done $0.04] total=$0.2400 calls=["lead","worker","worker","worker","worker","lead+"]`. GREEN after: `lead=budget/run cap=0.05 $0.04 workers=[budget $0, budget $0, budget $0, done $0.04] total=$0.0800 calls=["lead","worker"]`, `/api/budget/status` day spend within cap + one call; with PER RUN $1 all four workers and the lead's synthesis turn still run (`total=$0.2400`, lead `done`).
- Unit: `test/run-spend-pool.test.js` (fast.list) — the pool's decisions, and that `orchestration.js` hands the lead's pool to foreground and background `team.dispatch`, `team.spawn`, the structured-result repair and `team.resume`; RED before the orchestration change (9 problems), GREEN after (56 assertions).

_Found by the `sweep/providers` lane, 2026-10-20._

## Verdict

Fixed: a run and every worker it starts now share ONE per-run cap. `runOnce` gives each run a spend pool at its own per-run cap (`sidecar/run-spend-pool.js`) and puts it on the host-minted tool ctx; `orchestration.js` passes `ctx.spendPool` into every worker, clone, structured-repair and resumed-worker run, which joins it (a request body can never carry one). The run's budget check asks the pool before each paid call: once the family's booked spend reaches the cap — or the calls other members already have in flight (each counted at the largest single call booked so far) would take what is left — that member stops with reason `budget`, scope `run` and the LEAD run's cap, so the COMMS stop line names the cap the Commander set. Each member's reconciled costs reach the pool as they are booked (a worker starting mid-turn sees the lead's latest call) and its final spend at run end. A run that never delegates is decided by its loop's own check exactly as before (a one-member pool decides nothing), so a family now passes the cap by at most one in-flight call — the same bound a single run already had (the lead's own between-turn overshoot noted above is that pre-existing single-run bound, unchanged). A flat-subscription lead (no $ cap of its own) bounds the metered crew it starts by PER RUN. Not examined in this fix: the two post-run aux rows the sweep also saw ($0.08 for `agent`) — the regression runs with aux passes off and made no aux call; `BUDGET_PER_WORKER` still lowers a single worker's own ceiling on top of the shared cap. Proven live through the booted sidecar with a mock provider only; no paid-provider run. Fix: `4439b14ee`.
