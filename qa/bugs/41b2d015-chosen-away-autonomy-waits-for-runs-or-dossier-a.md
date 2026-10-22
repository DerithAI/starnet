---
fingerprint: 41b2d015
slug: chosen-away-autonomy-waits-for-runs-or-dossier-a
title: Chosen away autonomy waits for runs or dossier areas before acting (usage unlock on the onboarding path)
surface: autonomy
severity: P1
status: fixed
found: 2026-10-20
lane: sweep/onboarding
fix: a5152c59e
origin: audit
---

# Chosen away autonomy waits for runs or dossier areas before acting (usage unlock on the onboarding path)

## Symptom

At the awakening's "while you're away, how much should i run on my own?" a new Commander picks "Quietly do small jobs" (or "Run free"). The station answers: "While you're away I'll do up to 3 small jobs a day… I'll start once I've seen a few of your runs or learned a little more about you." The setting they chose stays off until the station has 4 recent runs or 4 known dossier areas. There is no setting that lifts the hold. The onboarding lane brief (state 5) says any grind, unlock or usage requirement found on this path is filed as P1 even when it looks deliberate.

## Repro

1. Fresh station, WAKE, deep or short conversation; answer briefly.
2. At "while you're away…" pick "Quietly do small jobs — each one a new session".
3. Read the next line, then `GET /api/nightshift/status` (readiness tier cold).

## Evidence

Live (station ORBIT, 2026-10-20): `While you’re away I’ll do up to 3 small jobs a day; each arrives as a new session in your rail. I’ll start once I’ve seen a few of your runs or learned a little more about you.`

Source: `frontend/app/nightreport.js:286` readinessPlain; the bar is `frontend/app/autopilot.js:44` `const HOT_MIN = 4` and `frontend/app/autopilot.js:71` `const ACTIVITY_HOT_MIN = 4`, surfaced by `sidecar/index.js:8297`.

This is a deliberate design: `docs/AUTONOMY_DRIVER_PLAN.md` §2 "Earn context, then act" (locked with Andrew). `docs/DECISIONS.md` also locks "full power from minute one, and no grind/unlock/usage walls". The two locked decisions conflict here, so this needs the owner's ruling (keep the hold as a safety floor with an override, or `wontfix`). The copy is truthful; the question is only whether the hold is allowed.

## Verdict

The no-usage-walls law wins (a5152c59e): the act floor is now grounding, not usage — a current aim (the awakening always authors purpose.md, which seeds goals) or one recent user run (`frontend/app/autopilot.js` `HOT_MIN` / `ACTIVITY_HOT_MIN` = 1, was goals + 4 areas or 4 runs). "Earn context, then act" still holds when there is nothing to cite (no aims, no runs: pre-spend `readiness` stand-down), and every job still has to pass the grounding veto, `MIN_ACT_SCORE` and the self-critique. The status readiness view adds `goalsStale`; the panel line and the awakening readout name the aims or one run, never an area counter. `test/nightshift-chosen-autonomy.test.js` drives the real DossierStore snapshot after the awakening's purpose answer, the real `commanderPosture` / `nightshiftPrecheck` / `nightshiftReadinessView` sliced from `sidecar/index.js`, and the real driver: before, the "build"/"free" pick declined with binding `readiness` and the line ended "I'll start once I've seen a few of your runs…" (29 failures); after, the away tick fires and the line is only "While you're away I'll do up to 3 small jobs a day; each arrives as a new session in your rail." Not walked live in the app (no sidecar boot in this lane).
