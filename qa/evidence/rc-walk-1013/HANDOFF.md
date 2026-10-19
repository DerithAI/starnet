# HANDOFF — 0.13.5 release polish (rc-walk lane) · 2026-10-13

For the next session (Andrew is switching accounts). Read this whole file, then `FINDINGS.md` beside it.

## 1. Paste this to start the new session

> You are continuing the StarNet 0.13.5 release-polish lane. Work ONLY in the worktree
> `C:\Users\andro\gen-trees\rc-walk-1013` (branch `agent/rc-walk-1013`). First invoke the Skill `starnet-task-doctrine`,
> then read `qa/evidence/rc-walk-1013/HANDOFF.md` and `FINDINGS.md` in that worktree. Andrew's bar for this release:
> "everything interconnected perfectly — no gaps, no bugs, no UX issues, cohesive, smooth, easy — built on my vision and
> every customer complaint." The release IS the new features, polished — never propose freezing features. Never push,
> tag, publish or merge to trunk without Andrew's explicit go. Continue from §6 (next steps).

## 2. Where everything is

| What | Where |
|---|---|
| Worktree | `C:\Users\andro\gen-trees\rc-walk-1013` |
| Branch | `agent/rc-walk-1013` — head after the handoff commit (`git log --oneline -1`); code head `607d655cf` (`git log --oneline -1`) |
| Built from | `agent/release-review-1012` (the 0.13.5 candidate) + trunk `feat/harness-backend`, both merged in — **0 behind each at handoff** |
| Findings (59 seams + status) | `qa/evidence/rc-walk-1013/FINDINGS.md` |
| This file | `qa/evidence/rc-walk-1013/HANDOFF.md` (committed) |
| Memory | `~/.claude/projects/C--Users-andro-Desktop-gen/memory/rc-walk-1013.md` and `release-is-the-new-features-polished.md` (indexed in MEMORY.md under NEWEST). If the new account uses a different `CLAUDE_CONFIG_DIR`, that memory is NOT visible — this file is the source of truth. |
| Isolated test stations | `.claude/launch.json` in `C:\Users\andro\Desktop\gen` has `rc-walk-seeded` (port 9471, `dev/seed.js --keep --workspace ~/.claude-scratch/rc-walk-1013/seeded`, Ask mode, haiku-4.5 via OpenRouter key from `dev/.env.dev`) and `rc-walk-fresh` (port 9472, `dev/onboard-fresh.js`, first-run). Start with the Browser tool `preview_start {name}`. They run THIS worktree's code and never touch Andrew's real station. |

Nothing from this lane is merged to trunk or pushed. Trunk itself is also unpushed (see §7).

## 3. Gate status at handoff

- `npm run test:fast` on `fb6045605`: **OK — 1167 step(s) green** (log read, not exit code).
- `npm run test:http` — **all 216 steps green, assembled from runs on the same code**: steps 1–190 green on `fb6045605`; step 191
  `payload.budget` was a REAL failure (tool schemas 122 bytes over budget from the longer `team.dispatch` description) → fixed in
  `607d655cf`; steps 191–202 + 204–216 then green on `607d655cf` via a resumed list; step 203 `remote.e2e` failed once on a port
  another process held ("expected 53771, got 64983") and passed alone (114 assertions); `acp.e2e` (reads the same description)
  re-run alone on `607d655cf`: OK. Not one uninterrupted run — a clean single pass is still worth doing when the machine is quiet.
- Earlier HTTP runs also tripped load-flaky steps that pass alone: `station-control.e2e.test.mjs` ("no station page answered")
  and `questrefresh.e2e.test.js` ("boot timeout") — the known boot-timeout-under-load class; other sessions' gates were
  competing for RAM (0.2–2.4 GB free).
- If a step flakes, resume from it instead of rerunning all 216: copy `test/http.list` from the failing step onward into a
  temp list and run `node scripts/run-test-list.mjs <that list>` (the runner spawns node per step — never a shell loop).
- ⛔ Never commit in this worktree while a gate is running. ⛔ Read the LOG's last `OK — N step(s) green` / `FAILED at step` line; the
  background wrapper's exit code lies.

## 4. What was done (all on `agent/rc-walk-1013`)

Method: live walkthrough with a real model on isolated stations → 59 seams logged → 3 read-only investigators traced every seam
to file:line → fixes with tests that lock each seam → live re-verification.

**Fixed + verified LIVE (real model):**
- Workers hand work on (`sidecar/tools/builtin/orchestration.js` earlierHandoff / pausableSlice, `sidecar/pathtrust.js` readGrants,
  `sidecar/index.js` handoffFiles/grantReads). Copywriter: 25 web steps / 4:32 / $0.08 / no email → **3 reads of the researcher's
  files / 15 s / $0.03 / delivered**. Lead now reads workers' files at real paths (no guessed `/tmp/...`). Same family as GitHub #77/#88.
- CREW card shows a foreground worker working / "needs your OK" (foreground dispatch runs join `hostLiveRuns`); DELEGATED row
  clock counts (`elapsedOf` needed `now`).
- One duration per run: `RUN COMPLETE · 242.8s · 115.5s waiting on you` = receipt `242.8s`.
- Worker report keeps headings/paragraphs (`frontend/css/beat-cards.css` `.dg-work-answer .md-*`).
- "Approve once" everywhere a one-call grant is offered.
- GitHub **#113**: CUSTOM provider add forms take the endpoint URL (key optional, local hosts → http://).
- Clicking an unconfigured provider no longer switches the station's brain (it had silently broken the test station).
- An approval on screen doesn't toast; STOP mid-approval retires the card ("■ the run ended before an answer — nothing was approved", 0 live keys).
- COMMS header law (no run state on top of COMMS) — locked by new `test/comms-header-no-run-state.test.js`.

**Fixed + unit/regression-tested (live re-check still worth doing):** human Deny reaches the model as a decline (not "outside
content"); host-written URL refusals (`hostAuthored`) never taint and the row says why; verify-before-done skips standalone
HTML pages; hiring (`team.summon` `briefExempt`) is never held behind the Task Brief; an unlisted ★ recommendation is dropped
instead of rejecting the question (no double-asked question); **a reply typed in the COMMS box answers the open question**
(`askAnswerers` in chat.js) instead of queueing a duplicate that later restarted the whole job; Enter sends in the question
card; "hire RESEARCH (researcher) onto the crew" (no raw JSON); unattended runs deliver content instead of explaining
approval rules; the user never sees the lead's `[STOPPED …]` note; the 4-docks hint shows once per page; the DELEGATED row
reads CREW's clock (`window.CrewClock`).

**Merged in from other sessions and reconciled by hand (watch these):** trunk's readable question/approval cards
(`f01d52868`, `ac0f80fbd`) collided with this lane's chat.js/taskconversation.js — resolved as the union (trunk layout +
`askAnswerers` + Enter keys + release-branch `plugin.submit`/receipt labels + trunk key titles). FIND (Ctrl+K) was removed
on trunk (`ac508b90a`) — Andrew's decision #52 is therefore DONE.

## 5. Open — not yet done

**Known seams (details + evidence in FINDINGS.md):**
- #60 page reload mid-approval cancels the run (record `cancelled`) and the transcript never says so — "stops without saying why".
- #30 line panel `SHIPPED 0` beside `✓ DELIVERED` (SHIPPED needs a tool/file; text-only answers don't count — needs a per-job
  `shipped` bit from the sidecar, `sidecar/routing/line-stats.js:87-92`, `frontend/app/workflowpanel.js:~1965`).
- #2 approval says "change" for a NEW file — needs an additive `creates` field on `permission.prompt` in owned `shared/events.js`
  (request it from the cortex-memory owner; don't edit it).
- #48 DELIVERABLES previews show raw markdown and "the agent did not name this one"; #44 "Delegated to RESEARCH, COPY and COPY";
  duplicate "General" session titles; #29 a toast covers an open dock menu; #9 deliverable frame renders white in the preview
  pane (check in the desktop app); #41 lead's final answer lists files instead of showing the deliverable; 48 console 404s on
  load (unidentified — check they are optional asset probes).
- World "RUN x:42" label clock never excludes approval waits (`frontend/app/world.js:~8001`) — CREW and the row now agree, the world label doesn't.

**Open customer P1s (not touched — from `qa/bugs/` + `qa/evidence/customer-release-1011/` on release-review):**
- `d688ea20` "Spend history unavailable" blocks all work (7 reports).
- `a5060cc3` funded account says out of credits after a workaround (E05/E58).
- `e7b2ffcd` Higgsfield sign-in lost after restart (E03).
- `85f602c4` Windows 0.13.2 won't start (empty shell.js); antivirus quarantine (E62) is a separate lead.
- `f702f2f6` an approved skill is refused to a background worker (E02).
- `082ee8e5` shell approvals/history hide the full command (E06; source fix 4c89890bc exists — verify).
- `0db3e69c` GPU loss → floors vanish / props fall back to legacy art — source fix is in this candidate; matches public GitHub
  **#114** ("after 0.13.3 my flooring disappeared… laggy"). Never verified on an installed build.
- GitHub #111 LM Studio timeout, #99 Ollama stuck on "Working…", #106 API keys not working, #90 connecting Claude, #98 Gemini
  routes through OpenRouter — open, untracked in qa/bugs.
- Unnamed "delegate to the others" works ~half the time on qwen3:8b (named delegation fixed).

**Never walked live yet:** voice, Telegram/Discord/Signal channels, routines / AUTOMATE, SEND TO + SPLITTER + THE HAND gestures,
memory/taste (rate → KEEP THIS STYLE → later run), Quests, performance on a big station, the installed desktop build (Windows + mac).

## 6. Next steps (suggested order)

1. Re-sync trunk + release-review (other sessions keep landing work), then one uninterrupted `test:fast` + `test:http` on the merged head.
2. Fix #60 (silent cancel on reload) and the customer P1s above — reproduce each live on `rc-walk-seeded` first (starnet-debugging skill).
3. Walk the unwalked areas the same way (log seams in FINDINGS.md, investigate, fix with a locking test, re-verify live).
4. Re-sync with trunk + release-review before every gate (other sessions keep landing work — see §7), gate the MERGED tree.
5. Report to Andrew; merge to trunk only on his explicit go (starnet-merge-ritual skill).

## 7. Context from other sessions (as of handoff)

- Another session was actively committing to `agent/release-review-1012` (render pacing: "under 5 FPS when the window isn't
  focused"); it once left the website mirror unsynced (fixed here by `npm run sync:website`). Never edit that branch — merge it in.
- A desktop build of 0.13.5 was being made in `gen-trees/_build-0135` by another session. Don't touch it.
- Public: **v0.13.3** (security hotfix). **0.13.4 recall hotfix is HELD** (`agent/hotfix-0134`) — Andrew: a release may contain ONLY
  what he approved. Trunk is unpushed. Website restamp, cloud deploy, GitHub/email replies are owed and need Andrew's go.

## 8. Product calls waiting on Andrew

1. Default working style is ASK → one delegated job = 4–9 approval prompts for a new user (#16 #55). Keep, or change the default / batch approvals?
2. Onboarding autonomy copy (#57): "set REACH to SANDBOX under FINE-TUNE… it knows 1 of 4 areas and has 0 of 4 recent runs; reaching
   either lets it act" — reads as an unlock ladder, and "SANDBOX" means the opposite of his sandbox.
3. Three places for "my work": MY WORK › TASKS (empty after real work), DELIVERABLES, TO REVIEW (only line jobs) (#45 #46 #47).
4. Auto-created sessions: one per hire ("RESEARCH", "COPY"), per quest/starter click, "While you were away" (#18 #19).
5. Conveyors tab opens on 39 preset lines + 8 machines + 4 tools (#32); NO FEED plate on a hand-fed line (#39); "ALSO RUNNING IN" banner.
6. First run: "Connect a brain" opens on OpenAI (not START WITH STARNET); OpenRouter defaults to Claude Opus 4.8 (#53 #54).

## 9. Traps hit in this lane (don't repeat)

- Shell escapes: a `\b` inside a heredoc/template literal became a literal BACKSPACE byte in chat.js; `\'` lost its backslash;
  `sed -i` with escaped regex silently didn't match. Build splices with the Write tool; after any scripted edit, scan touched files
  for control bytes vs the base commit.
- A `frontend/` change owes `npm run sync:website`, a commit, THEN a claims re-lock commit
  (`node scripts/qa/product-perfect/claims.mjs --refresh-surface --candidate <HEAD>` → write `releaseSurface` → commit → bare run prints PASS).
  `qa/product-perfect/claims.json` conflicts on every merge: take ours, then re-lock.
- Several tests lift functions out of chat.js into a vm sandbox (consent-full-request, notifications-useful, ask-cards-readable):
  a new module-level helper used inside `clarifyRow`/`permissionRow` must be added to their sandbox ctx.
- `comms-presence.test.js` pins distances (`catch (e)` → `persistPartial` within 1500 chars) — keep insertions in that block short.
- The Browser pane being hidden throttles the page (rAF ~900 ms) and key presses fail: drive the page via `javascript_tool`
  (`Chat.sendOrQueue`, button `.click()`). A blanket `/TRY AGAIN/` click hit the voice panel — target buttons precisely.
- `git log --format=%an` on every merge range before merging to trunk (sole-contributor law) — this lane's range is all "andro".
