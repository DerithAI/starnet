# Organization pass (0.13.5) — agent/org-pass-1014

Andrew 2026-10-14: one last usability/organization pass on top of the 0.13.5 candidate — condense StarNet as it is,
based on what users ask, remove confusion, no new surfaces, nothing removed.

- `census.json` — 7 surface census areas (every label/door/vocabulary clash), customer usability asks, locked laws + history.
- `plan.json` — synthesized plan after a 3-lens adversarial check (laws, code truth + final-* lane collisions, new user):
  31 proposals (P01–P33, 3 killed), core jobs → one front door, one-word-per-thing vocabulary.
- `plain.json` — the plain-language line per proposal shown to Andrew.
- Decision page (Andrew passes/strikes each line): https://claude.ai/artifact/DfrGcX17RYYpxybogdYjA4 — decisions live in its
  `decisions` collection (doc id = proposal id, `state` yes|no|later|open, `note`).

Build rule: only lines Andrew passed, serially in this lane, after the final-* lanes merge into agent/rc-final-1013.
