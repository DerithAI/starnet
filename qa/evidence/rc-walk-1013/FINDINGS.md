# RC walkthrough — live seams (2026-10-13)

Candidate: `agent/rc-walk-1013` = `agent/release-review-1012` @6d6ac864a + trunk @03fefe9ee (4baf4adaf, claims re-locked).
Station: isolated `dev/seed.js` workspace `~/.claude-scratch/rc-walk-1013/seeded`, Ask mode (SEED_FULL_ACCESS=0), real model anthropic/claude-haiku-4.5 via OpenRouter, 1440x900.

Severity: **S1** = a user gets stuck / the app says something false · **S2** = confusing, inconsistent, or noisy · **S3** = polish.

## STATUS (2026-10-13, end of pass 1) — branch `agent/rc-walk-1013`, NOT merged, NOT pushed

Gates on the fixed tree: `npm run test:fast` **1166/1166 green** (log read); `npm run test:http` — see commit after this one.

**FIXED + live-verified on the isolated seeded station (real model):**
- #25 #37 #40 workers hand work on (copywriter: 25 web steps / 4:32 / $0.08 / no email → **3 reads of the researcher's files / 15 s / $0.03 / delivered**); lead reads workers' files at their real paths (no more guessed /tmp paths)
- #17 #26 CREW shows a working worker ("3:04 · working", "needs your OK"), the DELEGATED row clock counts ("Working · 4:04")
- #6 one duration: `RUN COMPLETE · 242.8s · 115.5s waiting on you` matches the receipt `242.8s`
- #24 a worker's report keeps its headings/paragraphs on their own lines
- #28 "Approve once" on worker rows
- #43 STOP mid-approval: the card reads "■ the run ended before an answer — nothing was approved", 0 live keys (first attempt missed the STOP path; fixed in stopActive's confirmed-abort hook)
- #1 an approval on screen: NEEDS YOU lists it, no "needs approval" toast
- #49 #113 CUSTOM add forms take the endpoint URL (key optional); #51 a click on an unconfigured provider opens its setup and keeps the brain ("Your agents stay on OPENROUTER") — this one had silently broken the whole test station
- #13 #20 COMMS header class is hidden for every run state (`status-approval` on "awaiting your approval…")

**FIXED + unit/regression-tested (live re-check pending):** #3 verify-before-done skips standalone pages · #4 failed rows say why ("not a web address (file://)") · #5 a host refusal never taints; a human Deny reaches the model as a decline · #10 hiring is brief-exempt; refusal reads "paused — settling the task first" · #11 #42 a composer reply answers the open question (no queued duplicate that restarts the job) · #12 Enter sends in the question card · #14 an unlisted recommendation drops its ★ instead of rejecting (no double-asked question) · #15 "hire RESEARCH (researcher) onto the crew" · #31 unattended runs deliver content instead of explaining approval rules · #38 the Commander never sees the lead's [STOPPED …] note · #7 #22 the 4-docks hint shows once per page · #50 add-key copy no longer claims a ChatGPT sign-in · worker slices pause while waiting on the Commander

**FIXED, live re-check pending:** #21 #27 the DELEGATED row reads CREW's clock (approval waits excluded) — window.CrewClock

**OPEN — fixable, not yet done:** #60 (found after the trunk sync) reloading the page while a run waits on an approval cancels the run (run record: `cancelled`) and the transcript never says so — the run just vanishes, the "stops without saying why" complaint again · #30 SHIPPED 0 beside ✓ DELIVERED (needs a per-job "shipped" bit from the sidecar) · #2 "change" vs "create" (needs an additive field in the owned shared/events.js) · #48 raw markdown / "the agent did not name this one" in DELIVERABLES · #44 "RESEARCH, COPY and COPY" · #9 deliverable frame renders white in the preview pane (verify in the desktop app) · duplicate "General" session titles · #29 toast over an open dock menu

**NEEDS ANDREW'S CALL (product decisions, not bugs):** #52 SYSTEM › FIND (Ctrl+K) — remove? · #55 #16 default ASK mode = 4–9 approval prompts for one delegated job · #57 onboarding autonomy copy (REACH / SANDBOX / "it knows 1 of 4 areas… reaching either lets it act" reads as an unlock ladder) · #23 the dock "grows as it is used" · #53 #54 first-run provider page opens on OpenAI, OpenRouter defaults to Opus 4.8 · #45 #46 TASKS vs DELIVERABLES vs TO REVIEW (three places for "my work") · #18 #19 auto-created sessions (one per hire, per quest/starter click, "While you were away") · #32 39 preset lines on first open · #39 NO FEED plate on a hand-fed line · ALSO RUNNING IN banner

## J1 — First task (COMMS → approval → deliverable)

| # | Sev | Seam | Evidence |
|---|-----|------|----------|
| 1 | S2 | One approval is announced in 7 places with 3 vocabularies: CREW card "needs your OK", NEEDS YOU card (Review/Deny), session row "Approval needed", COMMS card (Approve once/Always/Full access/Deny), toast, world bubble "WAITING APPROVAL", SYSTEM dock badge "1" | screenshot 4:16 |
| 2 | S3 | Approval for a NEW file says "wants to **change** launch-countdown.html" | COMMS card |
| 3 | S1 | After its reply + "Done.", NOVA kept working: `browser.navigate file://…` ✗, `browser.test.navigate file://…` ✗, then asked PowerShell `Get-Content` to read its own file (it has fs.read). Its answer is no longer at the bottom of COMMS (law: reply readable at the bottom) | transcript 4:16 |
| 4 | S1 | Failed tool rows say only "✗ error" — no reason anywhere | browser.navigate row expanded |
| 5 | S1 | A FAILED local `file://` navigation taints the run (`[learning] … tainted=true`); after I denied shell, NOVA told the user "I can't execute shell commands on this run because I've already navigated to external content" — false on both counts | sidecar log + transcript 4:17 |
| 6 | S2 | One run, two durations: `RUN COMPLETE · 89.1s` vs receipt `49.3s` | transcript |
| 7 | S2 | The "Everything you run lives in these 4 docks… GOT IT" hint re-pops 4+ times, overlapping the CREW dock and stacking on the approval toast | screenshots |
| 8 | S3 | Starter "Build a working tool" dumps a 70-word prompt-engineering paragraph into the composer and pre-creates a session titled with the starter name | composer value |
| 9 | ? | Deliverable link opened a BROWSER window ~50 s later, frame rendered white. File serves 200 + valid HTML; may be capture artefact of the sandboxed frame — VERIFY IN DESKTOP APP | /view/~t/… fetch |

## J2 — Build a team + delegate

| # | Sev | Seam | Evidence |
|---|-----|------|----------|
| 10 | S1 | "Get me a researcher and a copywriter…" → both `team.summon` refused by `✗ task-brief-gate` (raw internal name shown); NOVA never says the hire failed, asks a product question instead | transcript 4:18 |
| 11 | S1 | Typing the answer in the main composer does NOT answer the question — it queues as a chip; the run stays "awaiting your context…". The real answer box ("LET'S SHAPE THIS") is below the fold. The queued chip later re-sends as a duplicate | 4:19–4:21 |
| 12 | S2 | Enter sends in the composer; Enter adds a line in the question card (Ctrl+Enter sends) | card hint |
| 13 | S1-LAW | COMMS header shows run state + timer: "awaiting your context… 43s" (NO RUN-STATE IN THE COMMS HEADER law) | heading text |
| 14 | S2 | NOVA asked the same question twice in prose + once as a card | transcript |
| 15 | S2 | Hire approval card shows raw JSON: `({"specId": "researcher", "name": "Research"})` | COMMS + NEEDS YOU |
| 16 | S2 | One explicit request = 4 approvals in Ask mode (write, hire, hire, hand off) | — |
| 17 | S1 | Truth conflict: CREW panel says RESEARCH/COPY "idle" while the DELEGATED card says RESEARCH "Working · 0:00" (timer frozen at 0:00 for 30 s+) | 4:21–4:22 |
| 18 | S2 | Every hired agent gets an empty home session ("RESEARCH", "COPY") in the list beside the real (folded) worker thread | /api/overseer threads |
| 19 | S2 | Picking a starter / quest action instantly CREATES a session and switches COMMS away from the running conversation (nothing sent yet) — empty sessions pile up, the user loses their place | "quest: Explore…" session, toast "Conversation prepared" |
| 20 | S1-LAW | COMMS header again carries run state: "online · also running in Build Product Launch Countdown Timer" + an ALSO RUNNING banner | 4:24 |
| 21 | S1 | Same run, two clocks: world label "RUN 6:05" vs CREW card "3:43" | zoom 4:25 |
| 22 | S2 | The 4-docks hint covers the bottom of the WORK dock menu (QUESTS row hidden behind it) | 4:23 |
| 24 | S2 | A worker's report preview loses its line breaks/headings: "Here's what I found:3 Competitor Launch Emails - Desktop AI Agent SpaceI've sourced…" | RESEARCH row, 4:27 |
| 25 | **S1-CORE** | Workers don't hand work to each other. NOVA dispatched RESEARCH and COPY **in parallel**; COPY's task is literally "Wait for the researcher to provide 3 competitor…". COPY never reads RESEARCH's saved `competitor-launch-emails.md` — it re-runs the research itself (9+ web searches, 1 site opened). Duplicate work + spend; the "manager delegates across the workforce" promise breaks at the seam | COPY "WHAT COPY DID", 4:29 |
| 26 | S1 | CREW panel keeps RESEARCH/COPY "idle" the whole time they work, ask for approval, and finish; delegated rows show "Working · 0:00" frozen | 4:21–4:30 |
| 27 | S2 | Three clocks for one run: CREW 5:22, session row/working strip 5:01, world label RUN x:42 | 4:28 |
| 28 | S2 | Worker approval rows offer Approve/Deny; lead approval cards offer Approve once/Always/Full access/Deny | 4:26 |
| 29 | S3 | Approval toast lands on top of the open BUILD dock menu (CONNECT / NEW APP rows) | 4:26 |
| 37 | **S1-CORE** | The delegation FAILED end to end: COPY spent its whole wall-clock slice redoing research (25 steps, 4:32, $0.08) and was cut off as it began writing; its fs.write approval was likely still pending on the human (I was in BUILD MODE) when the clock ran out. After 9 min, ~$0.22 and 5 approvals the user had no launch email. NOVA then re-dispatched COPY (6th approval) — this time WITH the research in the brief ("You have the competitor launch email analysis…"): the lead can hand work on, but only after a paid failure | DELEGATED card 4:34 |
| 38 | S1 | Harness instruction to the model shown to the user verbatim in the delegated card: "[STOPPED — this worker used up its 272s slice of the dispatch wall clock; the text above is its PARTIAL work. Do not present it as complete: either re-dispatch this subtask alone, or tell the Commander this part is unfinished.]" | COPY row |
| 39 | S2 | The line's INBOX shows a "NO FEED" plate on the floor right after it was fed a job and delivered | world 4:35 |
| 40 | S1 | After both workers finished, NOVA invented paths and asked to `web.request file:///tmp/researcher/competitor-launch-emails.md` and `file:///tmp/copywriter/launch-email-draft.md` (approvals #8, #9, raw JSON titles). The lead cannot read its workers' files, so it guesses — same root as #25 | 4:32–4:34 |
| 41 | S2 | Final answer never shows the deliverable the user asked for (the launch email); it lists file names and asks "Want me to pull the actual email draft text?" | final NOVA message |
| 42 | **S1** | The queued composer chip from #11 ("It's a desktop app… Go ahead.") fired as a NEW message ~15 min later, after the run ended — NOVA restarted the entire delegation from scratch (new brief, new dispatch). Real money burned on a duplicate the user never intended | 4:34, stopped by me |
| 43 | S2 | After STOP, the stopped run's COMMS approval card keeps live, enabled Approve once / Always / Full access / Deny buttons (NEEDS YOU and toast cleared) | button state 6 s after stop |
| 44 | S3 | Delegated card header "Delegated to RESEARCH, COPY and COPY" (a re-dispatch repeats the name) | card header |

**J2 totals:** ~12 min, 9 approval prompts, 1 failed worker, 1 duplicate run; deliverable reached the user only as two file cards.

## J3 — Build a line (BUILD MODE → Conveyors → preset → assign → send a job)

Flow itself is good: preset → click floor → "1 TO FIX — BAY 1 NEEDS AN AGENT" → pick NOVA → READY TO RUN → SEND IT A JOB → DELIVERED in ~27 s ($0.04).

| # | Sev | Seam | Evidence |
|---|-----|------|----------|
| 30 | S1 | Line stats contradict the result: `RUNS 1 · SHIPPED 0 · FAILED 0` while the panel says `✓ DELIVERED · 1 step · $0.0405 · in the OUTBOX` | stats row text 4:32 |
| 31 | S2 | Delivered result opens with internal policy: "This is an unattended run, so file saves require explicit approval. However…" — the user just pressed SEND and is watching | THE RESULT |
| 32 | S2 | Conveyors tab = 8 machine types + 4 tools + 39 preset lines + Lines/Machines toggle on first open; a beginner meets ~15 new nouns before placing anything | Conveyors tab |
| 33 | ? | Header object count fell 19 → 13 when the preset line was placed — verify nothing was removed | header "13 OBJECTS" |
| 34 | S2 | In BUILD MODE, NEEDS YOU / COMMS are hidden; a worker approval (COPY wants to change launch-email-draft.txt) only shows as a corner toast | 4:33 |
| 35 | S3 | "$ TODAY (UTC)" — UTC is jargon in a beginner stats row | stats row |
| 36 | S3 | Bay picker shows RESEARCH/COPY as "free" while COPY is mid-delegation | Who works here? |

## J4 — Where finished work lives (WORK → MY WORK)

| # | Sev | Seam | Evidence |
|---|-----|------|----------|
| 45 | S2 | TASKS says "NO TASKS" after 3 COMMS jobs + 1 line job — COMMS work never becomes a task; two separate work systems | MY WORK › TASKS |
| 46 | S2 | DELIVERABLES › TO REVIEW holds only the line job; the COMMS deliverables (countdown, research, email) never ask for a verdict there — two review rules | DELIVERABLES |
| 47 | S2 | 17 filter/clear controls (ALL / NEEDS A DECISION / DONE / KEPT / IMPLEMENTED / FAILED / DISCARDED / REFRESH / CLEAR ALL / CLEAN OLD RECORDS / ALL KINDS / FILE / PAGE / WORKFLOW / ALL WORK / UNFILED / TODAY / CLEAR TODAY) for 4 items | DELIVERABLES |
| 48 | S3 | Previews show raw markdown (`**TEASER 1:**`) and worker files read "the agent did not name this one"; all 4 items "UNFILED" though the header says "filed by project" | DELIVERABLES |

## J5 — SYSTEM / Settings

| # | Sev | Seam | Evidence |
|---|-----|------|----------|
| 49 | **S1-CUSTOMER** | GitHub #113 confirmed on the RC: Settings › AI & MODELS › CUSTOM tile reads "any /v1 base URL · bring your endpoint", but selecting it shows only "paste CUSTOM key…" — no Base URL field anywhere | visible inputs after selecting CUSTOM |
| 50 | S2 | CUSTOM key copy says "Add a CUSTOM key while keeping your ChatGPT sign-in connected." on a station with no ChatGPT sign-in (Claude Code + OpenRouter) | API KEYS block |
| 51 | S2 | Clicking a provider tile to look at it SELECTS it ("selected CUSTOM provider" toast) | toast 4:36 |
| 52 | DECISION | SYSTEM › FIND (Ctrl+K) — the agent-invented palette Andrew never approved (memory no-unrequested-ui-features) is still in the RC and shipped in 0.13.2 | SYSTEM menu |

## J0 — Fresh first run (dev/onboard-fresh.js, port 9472)

Works: title → Create your Overseer → Connect a brain → arrival ceremony → get-acquainted → station built → first task box.

| # | Sev | Seam | Evidence |
|---|-----|------|----------|
| 53 | S2 | "Connect a brain" opens straight on the OpenAI detail page (sign in with ChatGPT / key), skipping the chooser whose top card is START WITH STARNET (the vision's headline on-ramp). WAKE then errors "sign in with ChatGPT below, or enter your OPENAI API key"; that red text stays after picking another provider. (May be dev-env influenced — verify on a clean install) | 4:38 |
| 54 | S2 | OpenRouter's default model for a brand-new user is Claude Opus 4.8 ($5/$25 per M) | Connect a brain |
| 55 | S2 | Default working style is ASK FOR APPROVAL → the 9-prompt delegation in J2 is the default new-user experience | Create your Overseer |
| 56 | S2 | The 4-docks nav hint appears during the get-acquainted interview, telling the user to "talk to your agent up in COMMS" while COMMS is covered by the interview | 4:39 |
| 57 | S2 | Autonomy follow-up is jargon + a ladder: "drafts only — set REACH to SANDBOX under FINE-TUNE in SETTINGS › AUTONOMY; still learning you — it knows 1 of 4 areas and has 0 of 4 recent runs; reaching either lets it act." ("SANDBOX" here = restricted; Andrew's sandbox = no ceiling) | 4:40 |
| 58 | S3 | "Quick setup — two questions" asks a third ("one more question: which station…") and then needs 4 Continue clicks; one screen says "give me one task" with no box, only Continue | 4:40–4:41 |
| 59 | S2 | Onboarding hands off with a menu path ("WORK › AUTOMATE › WORKFLOWS walks you through who works each step") instead of a button, for a line that needs crew the user doesn't have | 4:41 |
| 23 | ? | Dock "grows as it is used" (`nav-coach-all` SHOW EVERYTHING, systems.js) — progressive reveal; check against the NO GATING law | index.html comment |
