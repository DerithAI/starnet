# StarNet v0.13.5 (draft)

DRAFT updated 2026-10-13 for **v0.13.5**. v0.13.3 was a published security-only hotfix on top of v0.13.2, and a v0.13.4 recall hotfix is held, so this is the big feature release that v0.13.3's notes promised as "coming next". It describes the review candidate on `agent/release-review-1012`; it is not a published or installed-verified release. Reconcile the final candidate before copying these notes. `release:bump` replaces root `RELEASE_NOTES.md` with a scaffold; keep the current public release notes intact until the cut.

Do not re-announce what v0.13.3 already shipped (stricter local access checks, outside content can't change routines or skills, credential folders off-limits to file tools, curated config imports, project path checks, Rust language server only for watched projects, the browser page running only its own scripts). Users updating from v0.13.3 already have those.

## Update Center summary draft

The Update Center shows only the first 520 characters of RELEASE_NOTES.md, heading included, as plain text. So the paste-ready notes below OPEN with exactly this:

```
# StarNet v0.13.5

**Before you update:** if you might ever go back to an older version, save a station backup first (SETTINGS › APP & BACKUP › STATION BACKUP). Older versions don't know SEND TO or SPLIT THE JOB and drop them when they save.

**SEND TO can start paid work** on the next line, on that line's own budget, even from RUN ONE REAL JOB. **MOVE is gone:** drag a selected piece to move it, Shift+drag moves anything. On the Conveyors tab keys 1-8 pick pieces.
```

Measured with node (`String.length`, the unit `frontend/app/updates.js` shortNotes cuts by): **469 characters**, `# StarNet v0.13.5` heading and both blank lines included, under the 520 limit. Re-measure if the opening changes.

## Release notes draft (paste over the `release:bump` scaffold at the cut)

Written in the public RELEASE_NOTES voice. Everything below the version heading `release:bump` sets is meant to be pasted, starting with the two opening paragraphs. Reconcile it against the final candidate's change inventory and drop any line whose acceptance did not land.

**Before you update:** if you might ever go back to an older version, save a station backup first (SETTINGS › APP & BACKUP › STATION BACKUP). Older versions don't know SEND TO or SPLIT THE JOB and drop them when they save.

**SEND TO can start paid work** on the next line, on that line's own budget, even from RUN ONE REAL JOB. **MOVE is gone:** drag a selected piece to move it, Shift+drag moves anything. On the Conveyors tab keys 1-8 pick pieces.

The big update v0.13.3 promised. Lines hand finished work to each other, a SPLITTER can split one job into parts, building is drag-and-drop, and everything waiting on you sits in one list. Plus fixes across chat, recall, voice, delegated work, local models and recovery.

### Behavior changes

- **MOVE is gone.** Click a piece to select it, then drag it onto open floor to move it. Shift+drag moves any piece. Dragging a machine you haven't selected lays a belt from it instead; drop it on another machine to belt the two. Outside the Conveyors tab key 4 is free now; on that tab it picks the SPLITTER.
- **On the Conveyors tab, keys 1-8 pick pieces:** BAY, INBOX, OUTBOX, SPLITTER, MERGER, JOINER, FILTER, LOOP. ROOM, HALLWAY, SURFACE, DELETE, PROPS, BELT and COPY keep their keys on the other tabs. 0 (SELECT) and 9 (CONVEYOR LINES) work everywhere.
- **Right-click removes** a machine or a belt, or drops the piece in your hand.
- **Del on a whole selected line deletes the line,** every machine and belt of it. Ctrl+Z brings it all back.
- **No more belts out of an OUTBOX or into an INBOX.** Lines chain with SEND TO instead. A save with an old OUTBOX-to-INBOX belt shows MAKE IT A SEND TO in that OUTBOX's Workflow panel.
- **A belt can't close a circle** unless it is a LOOP's back lane.
- **SEND TO can start paid work.** When a line sends its result on, the next line's crew works it at that line's own cost and budget. That includes a job you start with RUN ONE REAL JOB.
- **NO FEED clears only when something can start work.** A sample job or a test no longer clears NO FEED or ticks "what starts this line" on the finish card. A channel, an armed routine, a watched folder or a webhook on the station clears it on every line. A SEND TO into a line clears it for that line.
- **SHIPPED counts jobs with a saved shipment record.** Older deliveries aren't counted, so the number can be lower than before.
- **A follow-up joins the running task.** In a direct chat on any connected chat app, a message you send while an agent is still working steers that task instead of replacing it. In a group chat, or with media or a forwarded message, a new message still replaces the running task. A plain "stop" or "cancel" from you in a direct chat now works like /stop.
- **Recalling a chat from before this update now asks before running commands, because older history carries no trust stamp.**
- **Group chats and chats with other people can no longer recall your other chats.** They only search their own conversation.
- **FIND (Ctrl+K) is gone,** with its SYSTEM › FIND button. To find a conversation, use the search box at the top of SESSIONS in COMMS. To find a window or a setting, the FIELD MANUAL names where each one lives, or ask your agent to open it for you.
- **Old ROOM LIGHT settings carry over.** LOW, MEDIUM and HIGH become 0, 15 and 30 on the new slider.

### New

- **SEND TO.** Drag a line's OUTBOX onto another line's INBOX, or pick the line under SEND TO in the OUTBOX's Workflow panel, and every job that finishes cleanly is sent on to it, worked by that line's own crew under its own budget. A job that doesn't finish cleanly isn't sent on, and neither is one the next line can't take (no agent on its first step, or its daily limit spent). The job says why. Each job says where it came FROM and where it was SENT ON TO, in WORKFLOWS and in DELIVERABLES › TO REVIEW. A circle is refused before anything is saved.
- **SPLIT THE JOB.** A SPLITTER can split one job into parts, one per branch, next to COPY TO EACH and TAKE TURNS. Put a PLANNER step before the splitter: it writes the parts, each branch does only its own part, and a JOINER puts them back together.
- **NEEDS YOU.** One list at the top of SESSIONS gathers every approval, question and failure on the station, each with its action right there.
- **Delegated work shows up where you asked.** When your lead hands work to the crew, one live card in that conversation shows who is doing what, with Stop while it runs, Approve or Deny when a worker asks, and See work for each worker's answer.
- **The hand.** Pick a piece with 1-8, or Q for a copy of the piece under the pointer. Drag from a machine to lay a belt (R flips the corner). Drag a belt's middle to branch it (a SPLITTER goes where you pressed). Let a belt go on another belt to merge them (a MERGER lands there). Ctrl+drag a placed belt to reshape it. Hold Alt to see every setting and SEND TO on the floor.
- **Select, copy, paste.** Drag a box on empty floor, double-click a machine for its whole line, Shift-click to add or drop one. Ctrl+C / X / V / D copy, cut, paste and duplicate; R turns a paste before you drop it. A whole line's card has COPY LINE and DELETE LINE, and a pasted line comes with its own name, crew, instructions, budget and jobs.
- **Your lead can build lines too.** It can chain lines with SEND TO, copy a line and take a line up. Every one of those is spelled out on the approval card before anything moves, and one UNDO takes the whole plan back.

### Fixed

#### Conveyors

- **Long lines say why they stop.** A line longer than its stage budget shows TOO LONG — RAISE THE LINE BUDGET, and its Workflow panel offers ▲ ALLOW N STAGES.
- **A BAY that isn't on a line says so** (NOT ON A LINE — BELT INTO IT) and offers JOIN A LINE.
- **SHIPPED is a real count:** clean jobs that did real work (a tool call or a file) and reached the OUTBOX, once each. A job that only answers in words reaches the OUTBOX but isn't counted. Branches and loops don't inflate it, and it survives restarts and floor edits.
- **FIRST SHIP only fires when a line really ships its first job.**
- **The finish-the-line card keeps "what starts this line" until something does.**
- **JOINER lines never lose or double a finished job,** even when one branch finishes long after the other or the same completion arrives twice.
- **An exhausted LINE BUDGET stops a line before it spends,** whether the job came from a sample, Run Now, a schedule or a restart.
- **Parallel and JOINER lines explain why whole-line STEP THROUGH isn't available,** and single-step tests still work.
- **SORTING OFFICE and CODE FOUNDRY route every tag** instead of failing after the work was already done.
- **Hand-offs name the line the way the floor does.** A line without a name reads LINE C in WORKFLOWS, in TO REVIEW and on the crate that carries its work over, never "another line".
- **Lead-built floors:** asking the lead to take up one line in a room no longer removes the whole room. A SEND TO made by connecting an OUTBOX to an INBOX always shows on the approval card. The lead can turn an old belt between two lines into a SEND TO, and a copied line's card says where it really landed and how many belts it has.

#### Everything else

- **Delegated work is easier to follow.** Finished worker answers survive failed writes and restarts.
- **Chat:** long conversations keep your messages and the current task when they're compacted, recall reaches older conversations, file and review trays keep their context, and the stop reason stays visible after a reload.
- **Files:** a file edit that doesn't match the file exactly is refused before anything is written, and edits keep the file's line endings.
- **Voice:** a better local voice, a separate model for spoken turns, and spoken approvals that wait for you to confirm.
- **Local models:** Ollama works with strict system-message templates, and timeouts say what StarNet actually saw.
- **Skills:** a proposed change stays separate from the approved skill until you approve it. If an evaluation finishes every case, every case passes on the new version and nothing gets worse, you can approve the change even when it measured no improvement.
- **Connectors, channels and spending:** a locked connector store is told apart from an empty one, Discord and Signal setup covers more cases, and an old receipt with no recorded billing source says BILLING SOURCE UNKNOWN instead of guessing.
- **Update Center:** an available update is remembered across restarts, opening the panel checks again, and SKIP VERSION now stays skipped. Only CHECK NOW shows a skipped version again.
- **Display:** ROOM LIGHT in SETTINGS is a 0-100 slider, text size works from the keyboard, and scenes that haven't changed draw less.

### Security

- **Recall is stricter:** group chats and chats with other people only search their own conversation, and recalling a chat from before this update asks before running commands (see Behavior changes).
- v0.13.3's security fixes are included.

## User-facing changes included in source

- **Setup guidance.** The provider reference explains account pairing, per-agent models, reasoning effort and account plans. The first-workflow guide uses current controls, distinguishes preview from real jobs and asks users to check readiness and final output. Unknown billing receipts remain explicitly unresolved.
- **Conveyors and onward work.** Build lines by dragging between machines. SEND TO passes an OUTBOX's finished job to another line's INBOX while preserving the producing workspace and the target line's own crew, job record and budget. SPLIT THE JOB is new in this release: a PLANNER step before a dividing SPLITTER writes numbered parts and each branch receives only its own part; COPY TO EACH and TAKE TURNS keep their routing.
- **Conveyor completion and budgets.** Parallel/JOINER lines explain why whole-line STEP THROUGH is unavailable; individual-step tests remain available. Entry paths respect exhausted daily line budgets. SHIPPED counts recorded productive OUTBOX jobs once, survives restart and floor edits, and reports unavailable history when durable records cannot be read. Duplicate completion events retain the original joined work.
- **Pending floor edits.** Late artwork, lighting refreshes and still-image reads preserve unpublished BUILD MODE edits. Closing BUILD MODE, or running a real job from its ▶ TEST view, publishes them.
- **Floor editing.** Box-select or double-click a whole line; copy, cut, paste and duplicate with Ctrl+C/X/V/D. Line cards include COPY LINE and DELETE LINE. R flips a belt corner, Q copies the piece under the pointer, and Alt shows settings.
- **Agent-built floors.** Agents can plan onward connections, line copies and whole-line removal. Plans disclose removed connections, repeated templates receive distinct line names, and readiness follows the published floor.
- **Delegated work and NEEDS YOU.** A parent conversation shows each lead run's dispatched workers on one live card, with their work, reports and requests that need you. NEEDS YOU, pinned at the top of SESSIONS, lists every open approval, question and failure. Worker files keep their project identity. Scoped builder lending lets an approved worker carry out its assigned floor-building job.
- **Recovered worker answers.** Completed delegated answers are kept in full (secrets still redacted) and recover after failed writes or restart. Saved desktop and paired-device conversations replace superseded worker drafts with the accepted answer once, preserve attachments and historical status, and use the accepted answer for follow-up context. Answers lost before this update cannot be brought back.
- **Conversation files and review.** File and review trays retain context, completed items can be cleared and restored, and unresolved items remain visible. Streaming scroll, long composer behavior and image loading receive fixes. Stop reasons remain visible after reload.
- **Channel follow-ups.** In any connected channel's direct chat, a follow-up steers the running task. Group chats, media and forwarded messages still replace the running task. A plain "stop" or "cancel" from the owner in a direct chat works like /stop.
- **Voice and paired devices.** Local speech uses an improved synthesis/effect path with saved choices. A separate spoken-turn model can be selected without changing typed-chat routing. Spoken approvals wait for confirmation and preserve other pending requests. Paired-device audio transport receives reliability improvements.
- **Display controls and rendering.** Lighting has a persistent 0-100 control; saved LOW/MEDIUM/HIGH settings read back as 0/15/30. Keyboard text-size controls are available, and unchanged or offscreen scene work is reduced. No universal performance or memory-usage guarantee is implied.
- **Graphics recovery.** Authored prop pixels remain available during canvas loss, repair retries are bounded, and floor read failures can recover. Explicit local-model allocation failures stop blind retries and show the observed error; this does not resolve every local-model startup delay.
- **Memory and conversation history.** Long-conversation fixes retain owner messages and the current task during compaction. Recall searches older conversations even when the current chat has a weak match and recognizes more common paraphrases. Standing and pinned preferences remain bounded. Saved-memory handling distinguishes owner intent from inverted relations and upstream instructions. A group or non-owner run, and any worker it delegates to, recalls only its own chat. Recalled history without a provenance stamp counts as unverified outside content, so the run asks before commands.
- **Trusted learning and sharing.** Trusted owner preferences survive research and restart with explicit sharing boundaries. Uploaded, quoted and internal activity is excluded from trusted owner history. Repeated-work suggestions bind each request to its original occurrence. Older inferred topic summaries remain stored but need new attributable evidence before influencing suggestions.
- **Skill review and approval.** Proposed changes stay separate from the active approved skill through evaluation and rejection; promotion requires owner approval. A complete evaluation where every candidate case passes and nothing regresses can be approved with an explicit "no measured improvement" confirmation; failed, regressed and incomplete evaluations cannot. Larger skill libraries have a searchable overflow index. Reviews retain structured correction and outcome evidence and resume durable pending work after restart. Evaluation charges follow the selected budget policy. Evaluation on Ollama or a Codex, Grok or Kimi sign-in is booked as unmetered at $0, even when it fails, times out or is cancelled, and does not count toward dollar caps. Every other provider is metered, including a Custom endpoint such as a local LM Studio or vLLM server: an unknown charge there, such as usage with no published price, leaves an unsettled receipt, which blocks paid runs under strict caps until the Commander settles it.
- **Approved design references.** Saved approved work and style references retain their file identity, can be supplied to image-capable providers, and support reversible keep/undo feedback. Requested properties that were not observed are not presented as reference facts.
- **Connectors and channels.** Connector storage distinguishes locked encrypted data from an empty fallback store; starting fresh preserves verified recovery copies and revokes old live clients and pending sign-ins after the durable reset succeeds. Discord and Signal setup guidance covers additional failure and private-recipient cases.
- **Local models.** Ollama request formatting accommodates strict system-message templates. Unfinished HTTP error bodies remain cancellable and use the existing idle watchdog. Timeout messages describe what StarNet observed. The separately reported long wait before an Ollama chat request is still under investigation.
- **Web diagnostics.** Post-header decoding and socket failures retain bounded cause codes and hostnames without including page contents or URL secrets.
- **Files and child tools.** Browser uploads resolve the current project's file and verify what was selected. Ambiguous file patches are refused before writing; Windows child tools retain their required runtime environment. Selecting an upload is not proof that the destination website accepted it.
- **Spending review.** Old pending receipts whose billing source was not recorded now say BILLING SOURCE UNKNOWN. Recorded managed and BYOK receipts retain their distinct guidance. Historical charges, caps and billing sources are not guessed; unresolved spending can block work under explicitly configured spending limits.
- **Update Center.** A known available update survives restart; with automatic checks on, opening the panel checks again (at most every 15 minutes), and the last check is shown separately from whether an update is available. A skipped version stays skipped on every automatic path; only CHECK NOW shows it again, and a critical release is never skippable.
- **Fresh start and recovery.** Automatic legacy recovery respects an explicit erase/fresh start while preserving deliberate restore options.
- **Saved-station diagnostics.** Recovery codes and copied fallback reports follow the latest retry and measured engine failure. These changes preserve save bytes and improve support evidence.
- **Checkpoint maintenance.** Maintenance also runs for unchanged snapshots, supervises Git work, and preserves recoverable history during replacement.

## Security

v0.13.3 already published the local-security hotfix; do not list those fixes again as new. The public notes for v0.13.5 name only the two recall changes above, which are fixed in this candidate. Any other security fix accepted in the signed candidate is described only in general terms, and never before the corrected build is available.

## Heads-up for upgrades

- MOVE is retired: click to select, then drag onto open floor to move. Shift+drag moves any piece. On the Conveyors tab, 1-8 pick pieces instead of the old tool shortcuts.
- Right-click removes a machine or belt. Delete on a whole-line selection removes that line; Undo restores it.
- An OUTBOX hands work to an INBOX through SEND TO, never through a belt. A belt cannot close a circle except a LOOP's valid back lane.
- RUN ONE REAL JOB can start downstream paid jobs when SEND TO is set. The target line has its own cost and budget.
- SHIPPED excludes older deliveries without saved shipment records; it is not a reconstructed lifetime total.
- Recalling a chat from before this update asks before running commands; group and non-owner chats recall only their own conversation.
- Keep a station backup before downgrading: older builds do not understand SEND TO or SPLIT THE JOB.

## Before the cut

- The version is **0.13.5**: 0.13.3 is published, 0.13.4 is held. Release only what Andrew approved, and only on his explicit go.
- Resolve the explicit acceptance gaps from the reviewed issue batch and email/GitHub intake; complete the still-missing Whop intake. The Windows 0.13.2 packaged-backend startup report `85f602c4` remains open; no repair or customer recovery is claimed.
- Complete exact-candidate source gates, Guardian/readiness, installed first use and upgrade/data continuity (from 0.13.3, and from 0.13.2), native lifecycle, and the required product acceptance waves. Current source test passes do not authorize release.
- Compile and run the newly prepared isolated Windows/macOS native credential acceptance. Source review and nine mocked refusal controls do not establish native persistence, installed reconnect/relaunch or affected-customer recovery.
- Verify physical companion audio, real connector accounts and affected provider/platform cases where those claims are included; retain explicit limits otherwise.
- Open limits moved out of the user-facing bullets (do not claim these in public notes until accepted): skill review and evaluation billing still need candidate-bound installed acceptance; the web diagnostics change does not establish a fix for the reported Mac transport incident; the spending-review guidance does not reconcile affected customer accounts; the saved-station diagnostics do not establish the cause of the original customer loading report; the original customer's multi-hour macOS checkpoint disk-growth scenario still needs affected-platform acceptance.
- Run the ordered release cut, move all five pins together and re-lock source claims. Replace the scaffold with reviewed notes only at that point, and re-measure the Update Center opening.
- Ship website documentation with the matching app release. Do not deploy these unreleased instructions independently.

Internal evidence: [complete integrated change inventory](../../../qa/evidence/customer-release-1011/change-inventory.json), [product coverage](../../../qa/evidence/customer-release-1011/product-coverage.json), [customer process analysis](../../../qa/evidence/customer-process-1011/report.md), and the current queue in [NEXT](../../NEXT.md). These are review aids, not customer release notes.
