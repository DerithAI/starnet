---
fingerprint: f702f2f6
slug: approved-skill-is-withheld-from-autonomous-worke
title: Approved skill is withheld from autonomous workers
surface: skills
severity: P1
status: fixed
found: 2026-10-11
lane: release-0135-prep
fix: df73589b8
origin: customer
report: support-2026-10-11-approved-skill-worker
affected: Reported 0.13.0 macOS; exact installer artifact unverified
family: skill-approval-worker
installer: unverified
recovery: persists
recoveryEvidence: October 11 report repeats the denial with a fresh autonomous worker after fully quitting and reopening the app.
---

# Approved skill is withheld from autonomous workers

## Symptom

A saved skill displays Active and approved. The watched lead can load its full body, but an autonomous worker requesting the same skill receives a guard denial requiring Commander approval in ABILITIES > SKILLS. Work stops before image generation; the customer reports zero image calls and no output.

## Repro

Customer-reported sequence, not locally reproduced:
1. Save and approve a skill, then confirm that a watched lead can read it.
2. Ask an autonomous worker to load the identical skill.
3. Fully quit and reopen the app and retry with a fresh worker; the customer reports the same denial.
Capture skill content digest, approval scope, worker identity and guard decision without bypassing the guard.

## Evidence

October 11 sanitized customer report, intake E02. The saved skill and queue were preserved. Restart plus a fresh worker did not restore access.

Dedup: c70f8965 concerns skill hydration changing stored content and approval digests. That is a possible neighboring mechanism, not a demonstrated cause here; no exact customer record was found on trunk a20ffa71f or candidate cbbf376dad.

Investigation anchors: test/skills.review-approval.test.js and sidecar/tools/builtin/skills.js. Existing coverage is not proof of this report's resolution. Compare lead and worker approval scope/content version before attributing the failure. No source fix, installer acceptance or customer recovery is claimed.

## Verdict

Source repair df73589b8 is in the 0.13.5 candidate: a worker's own pending same-name proposal no longer hides the Commander-approved shared skill (see Regression). Fixed in source only; customer retest pending, and the 0.13.0 mechanism the customer hit was never reproduced. Andrew approved this disposition for the 0.13.5 cut (10-15).

## Regression

Fix df73589b8 changes one product file: viewAccessible() in sidecar/skillstore.js. It adds one test, test/skills.worker-shared-approval.test.js, which is listed in the candidate's test/fast.list at line 316. Between df73589b8 and candidate 42805ac7c, that test, skillstore.js, sidecar/skills/, sidecar/tools/builtin/skills.js and test/_assert.js are byte-identical. Worktree 29aa4af68 differs from 42805ac7c only under qa/bugs/ and qa/BUGS.md, and its git status stayed clean after every run. BEFORE THE FIX: I ran the candidate's test file against the parent's source (df73589b8^ = 80eadd838), built only in scratch under C:/Users/andro/.claude-scratch/release-0135/regress/f702f2f6/, in two layouts. In (a) the candidate's sidecar/ and shared/ come from git archive with only sidecar/skillstore.js replaced by the parent version; a diff confirmed the only difference is the fix hunk. In (b) the whole parent sidecar/ and shared/ tree is used. Both runs exited 1 with "skills.worker-shared-approval: 6 problem(s), 17 ok". The six failures: (1) and (3) "boot 0" and "boot 1: the approved station skill still reaches the worker" each failed with expected "loaded Image Gen", got "pending". In both, the worker was told the skill is a proposal awaiting the Commander's evaluation and approval in ABILITIES > SKILLS, which is the reported denial. (2) and (4) "it is the approved body, never the proposal" failed. (5) "a preload resolves to the approved station skill" failed. (6) "two shared owners: never an arbitrary pick" failed with expected "not found", got "pending". AFTER THE FIX: on the candidate the same test passes with "OK (23 assertions)" and exit 0. Each test ran alone as node test/<file> with a temporary APPDATA/LOCALAPPDATA. Neighboring tests on the candidate also pass: skills.review-approval (306), skills.gate (117), skills.test (172), skills.on-demand (79) and skills.trust-origin (30). skills.review-approval also passes all 306 on the pre-fix layout (a), so the older tests never caught this bug; the new test is the one that detects it. This is a source-level proof of one seam that matches the symptom, not proof of the customer's actual cause. The record says the report was not reproduced as filed: 0.13.0 had no skill sharing, so the exact denial path in that build is unknown. There is no installer acceptance and no customer retest; the customer's worker id, skill owner and denial text are still needed.

## Sibling coverage

{"adapters":[{"target":"lookup order: the asker's own pending-only proposal vs a Commander-approved, station-shared skill of the same name","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"worker nova drafts a same-name background-review proposal; skill.view still returns the approved station body, never the proposal (failed 4 assertions before the fix)","gate":"fast"},{"target":"the asker's own ACTIVE skill still wins over a shared one","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"mira writes her own active Image Gen; skill.view returns her body","gate":"fast"},{"target":"two other owners share the same name while the asker holds only a proposal","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"kai also shares Image Gen; the worker gets 'not found', never an arbitrary pick and never 'pending' (failed before the fix)","gate":"fast"},{"target":"named crew worker and team.spawn helper ids reach an approved shared skill","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"agent, nova and sub-0f3a9c each load the approved body after allow-route-style digest approval","gate":"fast"},{"target":"project-scoped (projectRoot) shared skill shadowed by the asker's own proposal","state":"blocked","reason":"The test exercises station scope only; project-scope sharing with a same-name proposal is not asserted, although it runs through the same viewAccessible branch."}],"entrypoints":[{"target":"skill.view tool (sidecar/tools/builtin/skills.js)","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"real makeSkillTools viewTool.run with gate and guard, approved vs pending vs not found","gate":"fast"},{"target":"store.viewAccessible preload lookup","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"viewAccessible('nova','Image Gen') resolves to the agent-owned approved skill, not the pendingCandidate (failed before the fix)","gate":"fast"},{"target":"runOnce /skill preload wiring in sidecar/index.js (~line 22426)","state":"blocked","reason":"The test calls the store lookup that runOnce uses but does not drive a real run, because requiring sidecar/index.js boots a sidecar. The bytes of a worker brief reaching the provider are not asserted."},{"target":"skill.view with explicit ownerAgentId, and the review-context pendingView short-circuit","state":"not-applicable","reason":"The changed branch runs only when ownerAgentId is absent, and a review run viewing its own proposal goes through pendingView before viewAccessible. Both paths are unchanged by df73589b8."}],"displays":[{"target":"worker skill index (runtime.composeIndex)","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"the approved skill is not marked WITHHELD for any asker; the worker's own proposal is still listed as 'Image Gen [WITHHELD: proposed skill'","gate":"fast"},{"target":"answer for a lone proposal","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"'Only Mine' with nothing else behind the name still answers 'pending'","gate":"fast"},{"target":"ABILITIES > SKILLS panel and the denial text a live worker shows the customer","state":"blocked","reason":"No frontend or live-station run; only tool and store responses are asserted."}],"lifecycle":[{"target":"restart persistence of proposals and approvals","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"the store is rebuilt from the same journal and package root (boot 0 and boot 1); the approved skill still reaches the worker (both boots failed before the fix)","gate":"fast"},{"target":"before vs after Commander approval","state":"covered","test":"test/skills.worker-shared-approval.test.js","scenario":"the worker gets 'withheld' before approval and 'loaded' after a digest-bound allow","gate":"fast"},{"target":"installed macOS app full quit and reopen with a fresh autonomous worker (the customer's sequence)","state":"blocked","reason":"No installer acceptance and no customer retest; the restart is simulated in-process, and the 0.13.0 mechanism was never reproduced."}]}

## Shadowing proposal repair — 2026-10-14

Not reproduced as reported (0.13.0 had no skill sharing, so a worker with a different agent id could not read another agent's skill at all; the exact denial path for that build is unknown). On the candidate, real store, package mirror, guard, gate and skill tools show an approved, station-shared skill loads identically for the lead, a named crew worker and a team.spawn helper.

One candidate seam matched the symptom: a worker whose background review had drafted a same-name proposal asked for the approved station skill and was told it awaited the Commander's evaluation and approval in ABILITIES > SKILLS, across restarts, because the lookup prefers the asker's own record and a pending-only proposal counted as one. Source repair df73589b8: a proposal is not an active skill, so the shared skill answers; the proposal stays named as withheld; the asker's own active skill still wins; a lone proposal still says it awaits approval; two other owners stay ambiguous. Regression: test/skills.worker-shared-approval.test.js (failed 6 assertions before the fix).

No installer or customer recovery is claimed; the customer's exact worker id, skill owner and denial text are still needed. The report stays open.
