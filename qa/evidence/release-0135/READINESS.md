# StarNet 0.13.5 — release readiness (nothing published)

Prepared 2026-10-14 on `agent/rel-release-prep`, forked from the candidate `agent/rc-final-1013` @ 1d48e82e1.
Nothing was pushed, tagged, published or deployed. No station or browser was started (machine at its memory
limit); every check below is an offline read or a single test file run with node in a throwaway APPDATA.

The v0.13.5 notes are in `RELEASE_NOTES.md` (commit "release: write the v0.13.5 notes …" on this branch).

## (a) Notes: what the integrator still owes

- `RELEASE_NOTES.md` is in the claims surface, so this branch leaves the claims lock BLOCKED until the integrator
  re-locks (`claims.mjs --refresh-surface --candidate <sha>`, own commit).
- Every line was checked against the candidate's code or commits. Not covered yet, because they are not in the
  candidate: the org pass (`agent/org-pass-1014`). When it merges, these lines change:
  CLEAR ALL becomes MARK ALL REVIEWED (P12); NEEDS YOU becomes one list with NOTIFICATIONS and also covers builds,
  quests, goal loops and STEP-IN (P01); fewer empty sessions (P25); the COMMS title names the conversation (P26);
  CONNECT and RECRUIT in the dock from minute one (P10); the plain autonomy copy (P09); one key box per provider (P04);
  OPEN AI & MODELS on every model error (P03). Add an org-pass section then, and re-check the DELIVERABLES and NEEDS YOU lines.
- Style follows the published 0.13.2 / 0.13.3 notes (plain words, bold lead per line). The phone app's new icon is
  left out on purpose: phones only see it after a relay deploy.

## (b) 0.13.4 recall hotfix vs 0.13.5

Held hotfix: `agent/hotfix-0134`, fix 447812fcc (cherry of eb8073bba). Candidate fix: 6ef7d4e45, then c3c47cbe9,
f3e7d92d9, 14b97937b → 4c2de1095, acf1056f3 (recall.js) and the same `ownStreamOnly: () => tasteWithheld` wiring.
The `tasteWithheld` predicate is byte-identical in both trees.

Proof: the hotfix's own new test blocks (J = real `index.js` predicate and registration run in a vm, K = hostile and
malformed store adapters) were copied verbatim into a test file in this worktree and run against the candidate:
37 ok, 24 problems (same on 1d48e82e1 + the notes commit). Not committed (it does not apply as-is); to rebuild it,
take lines 1-13 and blocks J and K of `agent/hotfix-0134:test/recall.test.js`. Every problem falls in one of three groups:

| Group | Count | What it is | Security impact |
|---|---|---|---|
| Refusal wording | 21 | summary `limited to this chat` vs `limited`; browse text differs | none: refused the same way |
| Malformed stream id reaches storage | (inside the 21) + 2 read counts | hotfix refuses a malformed id (`not valid!`, `../owner`, 65 chars) before any read; candidate refuses only a missing id, reads, then drops every row whose stream is not exactly the run's own | none observed: extra probe against the REAL transcript store with secrets in `global`, a private stream and a malformed-id row, 5 malformed ids × 9 call shapes = 45/45 leak nothing |
| Owner search order | 1 | hotfix kept 0.13.3's local-first owner search; candidate's owner search deliberately merges this chat with older ones (15f06def5) | none: an owner run reading the owner's own chats |

Every disclosure assertion passed: no restricted run (group, non-owner channel sender, inherited `withholdTaste`,
unspecified-owner sender) returned the private canary, by search, `scope:"all"`, scroll, anchor or browse, and hostile
adapter rows (foreign, missing stream, null, non-array container) were dropped. The candidate also pins on
`ctx.connectorAuthority.withholdTaste` and stamps recall results with taint provenance, which the hotfix lacks.
The candidate's own `test/recall.test.js`: OK (136).

**Verdict: for confinement, 0.13.5 is a superset.** The only thing it lacks is the hotfix's defense-in-depth
refusal of a malformed stream id before any storage read. Today that path cannot leak (the store files a malformed id
under `global`, and the filter compares the raw id), and index.js validates ids upstream. Optional one-line port in
`sidecar/tools/builtin/recall.js`: `if (pinned && !streamId)` → `if (pinned && (!streamId || !/^[A-Za-z0-9_-]{1,64}$/.test(streamId)))`.
Further delegated-recall hardening built on top of the hotfix lives on unmerged lanes (`agent/recall-origin-*`,
`agent/ambient-*`) and is in neither 0.13.4 nor 0.13.5.

## (c) Release checks run offline: what fails a cut today

Ran: `release-preflight.mjs --version 0.13.5 --phase post-bump --allow-lane` (before and after the notes),
`release-ritual.mjs --version 0.13.5 --allow-lane --dry-run`, `qa/ready.mjs --json`, `bugs.mjs --list`,
`stage-website-deploy.mjs --check`, `lint-evidence-secrets.mjs`, and 23 release/website test files.

**Passing:** five version pins all 0.13.5 · tag v0.13.5 free locally, on origin and on starnet-releases · working
tree clean · website/app mirror in sync · updater signing key present · 23/23 test files green (release-assemble-manifest,
-bump, -contract-docs, -cut, -preflight, -ritual, -train-chrome-warmup, -train-macos-trust, -train-provenance,
-train-windows-trust, -installer-selection, opensource-readiness, source-release-mirror, t3-release-smoke, website-app-sync,
-deploy-staging, -docs-navigation, -live-preview, -pricing-hold, -skill-market, qa-ready, bundle-source-integrity,
frontend-dist-staging; re-run on this branch's head with recall.test.js: 24/24) · every v0.13.3 security fix is in the candidate (13 patch-identical; the two peer-owner commits
carry the same sidecar patch-id, tests differ) · authors: `origin/feat/harness-backend..agent/rc-final-1013` = 1449
commits, all `andro <nonfungiblefunyuns@gmail.com>`, committer andro, 0 Co-Authored-By; same for org-pass (204),
website-redo (6) and this branch (1) · open-source boundary: no pricing economics in tracked files or added lines
(the only margin-shaped hit is invented text in a dev delegation preview).

**Would fail a cut today, in order:**

1. ~~RELEASE_NOTES.md TODO scaffold~~ — fixed on this branch (row now PASS).
2. **Claims lock** — BLOCKED: "release surface bytes changed: RELEASE_NOTES.md". Re-lock owed by the integrator.
3. **No gate receipt at HEAD** (fast FAIL, http WARN). The last full pass (fast 1211/1211, http 220/220) was on
   7e1c8238a; the head has moved since (bake, icon, SEND NOW, notes, and org-pass to come). Full fast + http on the
   final head, then `release-ritual … --gates-proven-by gate-fast.log --gates-proven-by gate-http.log`.
4. **qa:ready NOT READY:**
   - 10 open P1 bug records (dispositions proposed in (f)).
   - Green Guardian: last cycle 2026-10-14 23:26Z on trunk 5dc59e490 = RED (http-e2e, saboteur, golden, audit,
     journeys red; fast green). Never run on the candidate. Needs a GREEN cycle on the exact final trunk head.
   - Journeys: last run 136/139 on trunk 5dc59e490 (fail). Beginner Run: PASS but on fa5a9ffdf (stale, >24 h by cut).
   - Installed smoke: `qa/installed/last-smoke.json` is from 2026-10-03 (f600afb1f). Owed against the final installer.
   - (Run from a worktree, all four machine-local stamps read MISSING; they live only in the integration tree.)
5. **Tag on trunk only.** The ritual stops on a lane by design: merge to trunk, re-run the ritual there to tag.
6. **Owed after the tag push, before Publish (blockers):** T0 clean-install and G1 packaged-lifecycle on the staged
   draft; the 48 h installed soak needs either evidence or Andrew's written waiver.
7. **Secret history unverified locally.** `npm run security:secrets` needs gitleaks, which is not installed. The CI
   job `secret-history.yml` scans the full history on the trunk push. A key-shape sweep over every added line in the
   1449 commits (13.9 MB) found one hit: a `ghp_` redaction fixture in test/context.test.js (1e018a72c, line 123) with
   the same value as an older fixture (line 136, 2026-06-16) that already passes the CI scan. `lint-evidence-secrets`
   on qa/docs/website is red only on files already public before 0.13.2 (CSS class names like `sk-lib-pl…` and
   09-10 probe logs); not a cut gate.
8. **The suite has never run on Linux for these 1449 commits.** The train's gate job is ubuntu (`test:fast` +
   `qa:customer-journeys`; every journey test is already in fast/http). 0.13.3 burned one train on a Linux-only path
   bug. See (d) step 2.

Not run: `release-cut.mjs` (legacy local cutter; it builds), any gate, any station.

## (d) Platform parity: ordered checklist

1. Freeze the final candidate (rc-final + org-pass + rel-* lanes), sync:website, re-lock claims, full fast + http on
   that exact head, rebuild + reinstall the Windows test build, Guardian / journeys / Beginner / installed smoke on it.
2. **Linux proof of the suite — Andrew picks one:** (A, recommended) a private CI mirror: push the candidate to a new
   private repo and run fast-gate.yml there; (B) install WSL Ubuntu here and run test:fast (system change, RAM-tight);
   (C) no pre-proof: push trunk + tag together and let the train gate be the proof. A red stops before any build or
   draft, so the tag can be fixed forward (0.13.3 precedent), but the security-fix commit subjects are public while
   no fixed build exists.
3. **gitleaks 8.30.1** (download needs Andrew's OK) → `npm run security:secrets` locally; add exact fingerprints for
   any reviewed fixture to `.gitleaksignore` before the push.
4. Merge to trunk, tag with the ritual, then **Andrew's go:** `git push origin feat/harness-backend v0.13.5`.
5. Train: gate (ubuntu) → build Windows x64 (Azure signing secrets) + macOS Apple Silicon + Intel (Developer ID +
   notarization; an Apple 403 means the developer agreement expired and Andrew signs it) → notarize → Intel macOS
   installed acceptance → latest.json → DRAFT on starnet-releases.
6. Check the draft's assets: `StarNet_0.13.5_x64-setup.exe` + `.sig`, `_aarch64.dmg`, `_x64.dmg`, `latest.json`, plus
   the mac updater tarballs + `.sig` (as on 0.13.3). No Linux file of any kind (the train has no Linux build leg).
   Windows and both Macs must all be there before Publish.
7. T0 clean-install + G1 packaged-lifecycle on the draft (blockers); soak evidence or waiver.
8. **Andrew clicks Publish** (all platforms in one moment) → `release:verify-host -- --expect-version 0.13.5` →
   canary → sync-source-release mirrors the installers to the source repo (runs every 15 min).
9. Ask Andrew: his 07-21 rule says only the current version stays downloadable, but 0.12.3–0.13.2 are still published
   on starnet-releases (and 0.13.1–0.13.3 on the source repo). Delete the old ones at this cut, or is that rule retired?

## (e) Website restamp for 0.13.5 (list only; nothing edited or deployed)

- `website/site.js`: `FALLBACK_VERSION = '0.13.1'` → `'0.13.5'` (already two releases behind; the live page shows the
  API's v0.13.3, the fallback only shows when the GitHub API call fails).
- `website/index.html`: `#ver-badge` (hero meta, line 71), `.ver` in the download sub-line (line 296), `#ver-foot`
  (line 410): v0.13.1 → v0.13.5. The file has mixed line endings: edit those lines exactly, never `sed -i` the file.
- `website/pricing.html`: `#ver-foot` (line 272).
- Download links: no edit. The three `.dl-btn[data-asset]` buttons (`x64-setup.exe`, `aarch64.dmg`, `x64.dmg`) resolve
  from `starnet-releases/releases/latest` and fall back to that page, so the 0.13.5 asset names must keep those suffixes.
- `website/app` (live demo embed): in sync with the candidate; re-run sync:website after the last frontend merge.
- Collision: `agent/website-redo-1014` (6 commits, rewrites index.html, home.css, home.js) is not in the candidate.
  Land or drop it first, then restamp on top of it.
- Timing: restamp after Publish, never before (the fallback would name a version nobody can download).
- Deploy on Andrew's go: `node scripts/stage-website-deploy.mjs`, then wrangler `pages deploy website-deploy` (never
  `website/`), and verify the version from the rendered DOM, not curl.

## (f) Calls waiting on Andrew before publish

Each line: the question → recommended answer → why.

1. **0.13.4: ship or supersede?** → Supersede if 0.13.5 publishes within about two days; otherwise ship 0.13.4 alone
   first (tag-only, like 0.13.3). → 0.13.5 carries the same confinement ((b)); a separate cut doubles the train and
   T0/G1 work, but 0.13.3 users in group and non-owner chats keep cross-chat recall until one of them ships.
2. **The parked thread-UX durability layer (dispatch delivery, verified finals, boot recovery, phone projection) is
   inside the candidate** (it came in with the review branch; trunk doesn't have it). Ship it? → Yes. → Its fail-closed
   bug (one torn transcript line blocked every final answer) is fixed (979006ebf), the gates cover it, and it has run in
   the installed test build since 10-14; pulling it out now is the riskier move.
3. **Workers may read files an earlier worker in the same hand-off saved** (pathtrust `readGrants`, also not on trunk).
   → Keep. → Read-only, scoped to that hand-off's saved files, and it fixed the 25-web-step copywriter failure.
4. **Strict recall: chats from before the update count as unverified when recalled.** → Keep, with the notes line
   (already in). → Fail-closed: old rows can't prove who wrote them; Full Power runs he starts are unaffected.
5. **Card controls** → Keep the readable-cards layout as shipped (Approve once lit, Always and Full access titled,
   keys above INSPECT; per-worker Stop / See work on delegated cards). → He kept "Full access" in the org deck. No
   lane record names a narrower open "card controls" question; if he meant something else, it needs his words.
6. **45 % group tray exception** (the tray may grow to fit a waiting question, back to 45 % once answered). → Keep. →
   At 1440×900 the 45 % strip hid the answer keys; it is never taller when nothing waits.
7. **Aux cadence** (study and thread-mine re-run while finding nothing; cooldowns can skip a preference turn). → No
   change in 0.13.5; back off empty passes in 0.13.6. → Learning frequency vs cost is his call; nothing is broken.
8. **North/west room growth still 0.7–1.3 s in BUILD MODE** (a progressive placeholder would hide it). → Ship as is,
   placeholder in 0.13.6. → Other edits are 2–3× faster and the bake is exact (GPU verify 0 px).
9. **Goal-arc offer after kickoff.** → Keep the candidate rule: it offers only on a run end with no delivery landing,
   and a delivery that lands sends an open panel aside. → The delivery stays readable and the feedback channel stays.
10. **Per-hire auto sessions.** → Already answered YES as org P25 (no empty session until you message the hire); lands
    with the org-pass merge.
11. **082ee8e5 full shell command in run history** (needs a bounded, redacted full command in the run record = wire
    change). → 0.13.6. → Approvals already show and copy the full command; the history half touches the run-record wire.
12. **#2 'create' vs 'change'** needs an additive `creates` field in `shared/events.js` (owned file). → Request it from
    the owner for 0.13.6. → Contract changes go through the owner; not a release blocker.
13. **pace-minimum-1013** (frame pacing under 60). → Keep it out. → His law: no frame cap below 60 on a visible window.
14. **The 10-14 ChatGPT-plan usage report.** → No fix claimed in 0.13.5; wait for the reporter's ROUTINES / AUTONOMY /
    LOGBOOK data; the likely product fix (a per-run brake for ChatGPT-plan runs like the new Claude Code ceiling) is
    0.13.6. → Not reproduced.
15. **The 10-14 delegated web-tools report.** → Wait for the reporter's data; claim nothing. → A hermetic repro gets
    every web tool on trunk and on 0.13.3.
16. **Open P1 records (qa:ready hard-fails on any).** → Approve these dispositions (each with its record's evidence):
    mark fixed with "customer retest pending": f702f2f6 approved skill withheld (df73589b8), d688ea20 spend history
    (80eadd838, one mechanism), 0db3e69c graphics reset (5c73343b9/bc5ed0c6e). Re-triage to P2 "waiting on reporter
    data": e7b2ffcd connector sign-in lost, a5060cc3 funded-account refusals, 1d3ac09a macOS web-fetch TLS, 4c0efd8c
    saved station blocked, 85f602c4 zero-byte backend module (build guard 08d7735de only). f2ac6356 Google Drive block →
    P2 external (Google app verification). 082ee8e5 → close the approvals half, open the history half as P2. → Source
    repairs are in; none is proven on a customer machine, and the 0.12.0 cut set the re-triage precedent.
17. **48 h installed soak.** → Written waiver (0.12.0 precedent) plus installed smoke on the final installer. → He has
    run the 0.13.5 test build since 10-14 12:55.
18. **Linux proof route** ((d) step 2). → A, a private CI mirror. → Proves Linux without publishing anything early.
19. **gitleaks download** ((d) step 3). → Yes. → Otherwise the first secret scan of 1449 commits happens in public CI.
20. **Unmerged hardening lanes** (`agent/ambient-*-1013`, `agent/recall-origin-*`; several commits marked unrun),
    Codex skill-promotion / skill-archive lanes, browser-crew UI, media-cost lane. → Keep all out of 0.13.5. →
    Ungated or unrun, and new UI needs his yes first.
21. **Open outside PRs that 0.13.5 now covers with its own code:** #103 (persistent Claude CLI session) and #109
    (Claude Code token limit). Verbatim overlap is 1 trivial line of 120 in claude-cli.js; the kill-switch env name
    `STARNET_CLAUDE_CLI_PERSIST` matches #103. → After publish, close both as superseded with a short reply in his
    voice. → Sole-contributor law: no outside code or author in the release, and the PRs shouldn't sit open.
22. **The earlier outside contributor already on the public Contributors list** (pushed 10-09; fix choice pending). →
    Decide before the trunk push. → The push adds no new outside author (all 1449 commits are andro), but it is the
    moment to act if he wants a different fix.
23. **rc-walk calls the org pass doesn't cover:** default ASK = 4–9 approvals per delegated job (#16/#55) → keep ASK
    as the default and rely on "Always" for repeats (safety first); first-run provider page opens on OpenAI and
    OpenRouter defaults to Opus 4.8 (#53/#54, not re-checked on the candidate) → open the chooser and default to a
    cheaper model; 39 preset lines on the first Conveyors open (#32) → collapse presets behind one PRESETS key in 0.13.6;
    NO FEED plate after a hand-fed job (#39) → re-check on the final build before claiming it fixed.
24. **After publish (each on his go):** website restamp + deploy, relay deploy (phone icon), cloud deploy, GitHub and
    email replies.
