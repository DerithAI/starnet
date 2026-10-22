---
fingerprint: 41b2d015
slug: chosen-away-autonomy-waits-for-runs-or-dossier-a
title: Chosen away autonomy waits for runs or dossier areas before acting (usage unlock on the onboarding path)
surface: autonomy
severity: P1
status: open
found: 2026-10-20
lane: sweep/onboarding
fix:
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

OPEN: waiting on the owner's ruling. The two locked decisions still conflict, and this record is not closed until Andrew rules: keep the hold as a safety floor with an override, or `wontfix`.

Partial work on agent/p1-41b2d015, not merged and not walked live. a5152c59e moved the act floor from "goals + 4 dossier areas, or 4 recent runs" to one fresh grounded aim or one recent user run (`frontend/app/autopilot.js` `HOT_MIN` / `ACTIVITY_HOT_MIN` = 1). On review, that commit also let one `seed` goals belief make the station hot: the canned "Code & build" chip (`onboarding.js:120`) or a thin run's synthesis, while the same snapshot's shared V3 verdict said `no-direction`. The follow-up 9f9ade258 restores the trust line (AUTONOMY_DRIVER_PLAN §2 "only confirmed beliefs cross the acting line"; `dossier.js` WEIGHTS). `Autopilot.readiness` now counts the goals keystone only from its non-seed beliefs, and freshness comes from their own stamps. A seed-only goals area is warm, so the idle EARN branch still fires there.

What a new Commander sees now: if they answer the awakening in their own words, or confirm a synthesis of them, the chosen "Quietly do small jobs" / "Run free" posture acts with zero runs. If they tap a quick-setup chip or give a thin run, the hold stays: "I’ll start once I know what you want help with, or I’ve seen one of your runs." Whether the chosen posture may lift even that remaining hold is the open question.

`test/nightshift-chosen-autonomy.test.js` drives the real DossierStore snapshot, the real `commanderPosture` / `nightshiftPrecheck` / `nightshiftReadinessView` from `sidecar/index.js`, and the real driver. Chip and doc seeds stand down pre-spend; synth and stated aims fire. Before 9f9ade258 there were 11 failures (the chip fired); after, it is OK. `test/autopilot.test.js` pins the seed rule: 4 failures before, OK after.
