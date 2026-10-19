# StarNet v0.13.5

**Before you update:** if you might ever go back to 0.13.3 or older, save a station backup first (SETTINGS › APP & BACKUP › STATION BACKUP). Older versions don't know SEND TO or SPLIT THE JOB and delete those settings the next time they save your station. If agents are working when you install, choose WAIT FOR AGENTS.

The big one. 0.13.3 was security only; this is the feature update that was promised with it, polished end to end. Your agents can bring crew into a chat and hand work to each other, conveyor lines can hand finished jobs to other lines, building is drag-and-drop, the station draws smoothly even when StarNet isn't focused, and Claude Code runs are faster and cheaper. The whole app also got an organization pass: one place for each job, one name for each thing, and plain, true wording wherever people got stuck. Plus a long list of fixes from walking the whole app as one product.

## Agents & chat

- **Bring crew into a conversation by asking.** Say "add FORGE to this chat" and your lead adds them. They join the moment its reply ends, or the chat says why they couldn't. ADD AGENTS shows each agent's portrait.
- **Delegated work has its own home.** Work your lead hands off gets its own threads, folded under the conversation that asked, and one live card in that conversation: who is doing what, Stop while it runs, Approve once or Deny when a worker asks, and See work to unfold each worker's answer and what it did.
- **Workers build on each other.** When workers run one after another, the next one starts from what the earlier ones returned and the files they saved, and can open those files.
- **NEEDS YOU is one list of everything waiting on you.** It sits at the top of SESSIONS, and NOTIFICATIONS › NEEDS YOU shows the same list. It holds approvals and questions from your conversations, group chats that need you, delegated work and routine runs that failed, an agent waiting at STEP-IN, extensions to approve, builds to keep or discard, quests an agent says are done and goal-loop results to review. Each one is a row in one quiet NEEDS YOU panel, and an agent's builds share one row with their count: click a row to go where it waits (a build opens its own session, where you keep or discard it), and the keys to answer, retry or dismiss sit right on the row.
- **Asking your lead to hand work to a named crew member now does it.**
- **Naming a file doesn't cost your lead its crew.** A file name like notes.md or main.py is no longer mistaken for a website, so your lead can still hand the job off and search the web.
- **Group chats:** the lead can build and change lines from the group, each agent keeps its own room's gear (a researcher can search the web there), replies show their tool calls like one-on-one chats, and the bottom strips share one tray.
- **Question and approval cards read at a glance.** The question comes first, long ones fold behind "Show the whole question", answers are full-width keys with the agent's ★ suggestion lit, and the reasoning folds last. A one-time grant reads "Approve once" on every approval card in the app. When an agent asks for the same tool again in a chat, the card says what Always does.
- **An answer that can't land says so.** If a worker's approval on the DELEGATED card already expired or was answered somewhere else, its row says the approval is no longer waiting and your answer wasn't applied, instead of doing nothing.
- **SEND NOW.** A message you type while an agent works still waits its turn. Each waiting message now has a send now key that hands it to the running task, so the agent reads it before its next step. If the agent hadn't read it yet when you press STOP, reload or restart StarNet, it comes back to the message box.
- **STOP gives your words back.** Messages waiting behind a stopped run go back into the message box instead of disappearing, and so does one you sent now that the agent hadn't read yet. Open approval cards say "the run ended before an answer — nothing was approved".
- **Typing an answer answers.** A reply typed in COMMS while the lead is asking you something answers that question instead of starting the job over.
- **The first message after a restart goes through.** It waits for the conversation to load and sends once, instead of being refused. If the station answers with an error or never answers, you're told, and your message stays in the conversation with a Try again key.
- **A goal breakdown never covers your work.** When an agent offers to break your goal into steps after a run, the panel sits above the message box and steps aside when an approval or a question arrives. Esc means not now, and one Esc closes only the thing it was pressed on.
- **COMMS says which conversation you're in.** The title reads "COMMS ·" and the session's name, and two untitled sessions read "New session · NOVA" and "New session · MIRA" instead of looking the same.
- **Fewer empty sessions.** An agent your lead or a workflow hires doesn't get an empty session until you pick it ON THE LINE in COMMS, and a starter idea fills the blank chat you're in. When an agent is busy somewhere else, the chat says where ("NOVA IS BUSY IN …").
- **Keys say what they do.** In a group chat the stop key says "Stop every agent in this chat", and an @ from General says it opens a group chat beside General.
- **/goal is a session goal, and says so.** It works while StarNet is open and stays through a reload, a GOAL LOOPS key sits right there for goals that should last, and each step shows as a station message, not as words you typed. /loop, /routine, /cron and /away answer with a key into the right AUTOMATE tab.
- **RECRUIT speaks one language.** RECRUIT NOVA adds a new agent; RE-SPEC MIRA INSTEAD changes the one you have.
- **The AGENT DOSSIER says where each setting lives,** and switches that change every agent say so ("for every agent", "all agents"). An agent's PURPOSE and house rules say only that agent follows them; your standing orders say every agent does.
- **Autonomy says what will happen, not what unlocks.** You read "While you're away I'll do up to 3 small jobs a day", the dial says SMALL JOBS, and REACH says LOCAL ONLY for work that never leaves this machine.
- **Moving PACE or REACH no longer lifts an E-STOP,** and any settings click that does lift one says what runs again.
- **A worker running in the background keeps its approval open** after the lead's turn ends, instead of being denied a second later where you couldn't see it.
- **Telegram, Discord and other chat apps:** in a direct chat, a plain follow-up joins the running task instead of cancelling it. "stop" or /stop still stops it.
- **CONNECT and RESUME work with long agent instructions.** Telegram, Discord and the other chat apps no longer fail with "Failed to fetch" when an agent's instructions are long, and CHANNELS says in words when a request got no answer.
- **Long chats keep your earlier instructions.** Messages that no longer fit the model's window are carried forward in your own words, instructions first, instead of silently disappearing.
- **Memory tells the truth.** Remembered notes carry the date they were saved and the newer one wins when two disagree. An agent that says it saved something without saving it is told to, and the "remembered" receipt lists only this run's saves. Forgotten memories stay forgotten when you restore a backup. "Never mind" and other passing remarks no longer become standing orders; "remember that…" still does.
- **Approvals carry into the next design.** Approving work, including ★ KEEP THIS STYLE, records what was actually made (files, colours, fonts, image prompt) and the whole crew draws on it. Image generation can use an approved image as a reference on OpenRouter, the ChatGPT plan and the OpenAI Images API, and says so where a connection can't.
- **Skill changes wait for you.** A skill an agent creates or changes becomes a proposal in CONNECT › ABILITIES › AGENT SKILLS. It needs a passing evaluation and your approval before it's used; the current version keeps working meanwhile.
- **Spoken turns can use their own model.** Pick it under Voice chat model in SETTINGS › AI & MODELS. It answers COMMS with the speaker on and Telegram voice notes, without changing your typed-chat model.
- **The "Speech interrupted" note goes away when the speaker turns off:** by its key, by /voice off, or when ending Local Live or hands-free mutes it again.
- **API jobs run hands-off.** After an agent reads a response from a web API, it can keep calling that same API with the keys it already used there, without an approval card for every call. Reading anything else still locks commands for that run, as before.
- **Chats from before this update count as unverified when an agent looks them up.** StarNet can't prove those old messages came only from you, so a run that recalls one works like a run that read a web page: in a chat you're watching it asks before running commands, and an unattended run skips them. FULL POWER runs you start yourself aren't affected. Chats from this version on are stamped and recall normally.
- **Coming back** is your lead's own report of what happened, with a way into the delegated work. A reload or restart doesn't count as being away.
- **Replies read properly everywhere.** Markdown answers render in DELIVERABLES, TO REVIEW and WORKFLOWS as they do in COMMS, *italics* included, and a text or markdown file the crew made opens as a readable page.

## Build mode & conveyors

- **Building is drag-and-drop.** Drag one machine onto another to lay a belt. Drag a machine onto empty floor to pick what goes there, or drag a belt's middle to branch it. Ctrl+drag a belt (Cmd+drag on Mac) to bend it through a tile.
- **Select to move.** The MOVE tool is retired. Click a piece to select it, then drag it onto open floor. Shift+drag moves any piece.
- **Copy whole lines.** Drag a box (it picks up the belts it crosses) or double-click a machine to select its whole line. Ctrl+C / X / V / D (Cmd on Mac) copy, cut, paste or duplicate it with its belts, settings, briefs, budgets and crew. Right-click removes a machine or belt. On the Conveyors tab, keys 1-8 pick pieces.
- **SEND TO.** Drop a line's OUTBOX on another line's INBOX. Every job that finishes cleanly in that OUTBOX is handed on, and the next line works it with its own crew, job record and budget, so a real job on one line can start paid work on the next. A job crosses at most 4 lines. Old belts that joined two lines offer MAKE IT A SEND TO.
- **SPLIT THE JOB.** A SPLITTER can split one job into parts, one per branch, next to COPY TO EACH and TAKE TURNS. Branches that each feed one JOINER run at the same time and share the line's budget.
- **TOO LONG is shown before you pay.** A line longer than its budget is flagged on its INBOX, and the Workflow panel offers a key that raises the budget.
- **No circles.** A belt that would hand work back upstream is refused, except a LOOP's back lane. An OUTBOX never belts into an INBOX; that's what SEND TO is for.
- **Agents build lines in a few steps.** Ask for a line and the agent lays it out, routes and staffs it, then tells you anything it left unstaffed. BUILD YOUR OWN LINE hands you an INBOX to place. When an agent tests a line, it reports only the SEND TO of the OUTBOX the job really reached.
- **SHIPPED counts saved job records.** Older deliveries with no saved record aren't counted, so the number can be lower than before.
- **BUILD MODE is much faster.** Placing pieces, undo, belts and renames no longer redraw the whole station, room edits redraw far less, and SAVE & EXIT hands the floor straight back.
- **WORKFLOWS and the Workflow panel use the same words:** ▶ SEND A JOB, ✓ DELIVERED, ✎ NEEDS CHANGES, ★ KEEP THIS STYLE, ↻ SEND IT AGAIN. On the example and TEST cards the paid key reads SEND A REAL JOB, so a real run never looks like a free test.
- **A workflow's page says how it starts** ("STARTS: by hand or every day at 9:00 AM") with a MAKE IT AUTOMATIC key, or CHANGE STARTS once it has one. An empty LAST JOBS says where scheduled runs are filed.
- **Saving a schedule follows one rule.** Your first saved schedule turns scheduling on. If you turned scheduling off, a save keeps it off and says so, and a save never lifts an E-STOP. The switch has one name, TURN SCHEDULING ON / OFF, and a new schedule's "Run by" can pick a whole workflow.
- **SET IT UP FOR ME picks from every ready-made workflow,** not just the 4 starters, and NEW WORKFLOW leads with the one that fits your goal. The Conveyors tab's LINES shelf opens on FOR YOUR GOAL and ANY JOB, with the other shelves one click away.
- **Click a floor OUTBOX to see that line's result,** with its rating right there. Results land in the line's OUTBOX and are filed in DELIVERABLES, and rating a job in WORKFLOWS takes it off TO REVIEW.

## Look & feel

- **ROOM LIGHT is a 0-100 slider** in SETTINGS › LOOK & SOUND. Ctrl/Cmd + and − change TEXT SIZE, and Ctrl/Cmd 0 resets it.
- **Built-in voices sound natural** instead of always going through the machine effect, and no longer drop the end of long replies. Pick AUTO, NATURAL, COMMS or MACHINE under VOICE EFFECT in LOOK & SOUND.
- **One look for the SESSIONS rail.** Routines and sessions share one row style, with NEEDS YOU as one panel above them. It shows the waits that fit your TEXT SIZE and rail width, and folds the rest into "N more", which counts every wait it folds. A routine is one row, its newest run, with an "N runs" key that folds its older runs out under it. Group rows read whole names ("ULTRON, CYPHER +3"), crew cards fit their rail, and delegated work wears the same glass as approval cards.
- **COMMS menus fit.** On a short COMMS the model picker, the / menu and the agent menu fit the room they have and scroll inside it instead of sliding under the agent header, and the model picker no longer runs off a narrow screen.
- **Menus and toasts stay out of the way.** Dock menus open above every window, and a toast never covers an open dock menu.
- **CONNECT and RECRUIT are in the dock from day one.** AUTOMATE and STEP-IN still show up when you need them.
- **The first screens count what they ask.** Quick setup says how many questions it asks and numbers them, each pace choice says how deep it goes, and the dock hint no longer talks over the arrival, the tour or the setup conversation.
- **MY WORK opens on DELIVERABLES the first time,** then on the tab you used last.
- **DELIVERABLES can be cleared when you're done.** ✓ DONE · CLEAR and CLEAR ALL take items out of the library, can be undone, and leave the files on disk.
- **Find your files.** Each file row in DELIVERABLES ends with a folder key and a copy-path key. REFRESH and the cleanup key fold behind MORE, and the kind chips read FILES, WORKFLOW JOBS and so on.
- **TO REVIEW says what it holds:** away runs and workflow jobs waiting for your rating (chats are rated in COMMS). It folds, and its clear key now reads MARK ALL REVIEWED with the number of runs in it (for example "MARK ALL 3 REVIEWED"), because it never deleted anything.
- **AI & MODELS has one key box per provider:** add a key on the provider's card. ✎ ENDPOINT URL, ↻ SPARE KEYS and FALLBACK MODELS say what they are, and other services are pointed to CONNECT › ABILITIES: SAVED API CONNECTIONS for a key, CATALOG for Gmail, Notion and other sign-ins.
- **Help names screens that exist.** The FIELD MANUAL, the glossary and the agents' own manual point at the real windows, like SETTINGS › AI & MODELS for model keys and NEEDS YOU for what's waiting.
- **QUESTS › PROGRESS shows the station's XP once,** as STATION XP, with OPEN THE TROPHY CASE on its milestones row. QUESTS tabs read in caps like every other tab strip.
- **Starter-room machines say what they are** when you hover them (INTEL CAB · FILES, DISH · WEB).
- **Station messages in COMMS sit in one quiet column,** with their keys in one row under them.
- **New crew skins.**

## Speed & cost

- **The station draws smoothly whether or not StarNet has focus**: up to 60 frames a second while it's on screen, faster while you move the camera, nothing while minimized. The idle camera never takes over while you're working.
- **Leaner prompts.** The fixed part of every prompt now stays the same from turn to turn so providers can cache it, and a lead with no crew carries a shorter tool list. Fewer tokens per turn.
- **Claude Code runs are faster and cheaper.** One Claude Code process stays open for the whole run and gets only the new messages each turn, and turns reuse the prompt cache.
- **Claude Code runs have a token ceiling.** A subscription turn costs $0, so the $ limits never stopped a runaway one. Each run now stops at 2,000,000 tokens by default (cache re-reads count 1/10); change it under CLAUDE CODE TOKEN CEILING in SETTINGS › APP & BACKUP › Runtime limits.
- **Background thinking costs less.** The station's own self-talk and after-run learning passes use the lowest reasoning effort the model offers.
- **Less freezing on busy stations.** Most prop edits no longer rebuild the whole station image, and a struggling computer draws less crew detail to stay responsive.
- **Closed windows let go.** SETTINGS, CONNECT, CHANNELS, MY WORK and AUTOMATE no longer stay in memory after you close them.
- **Web search doesn't hang on a dead station browser.** It's passed over in seconds and named in the answer.

## Reliability

- **Fewer silent stops.** An agent that says "I'll build that" and then does nothing is pushed to continue, an empty reply is retried once, and a file write too big for the output limit says to split it. Every stop says what happened and what to do, in COMMS (still there after a reload) and on Telegram and Discord.
- **Errors take you to the fix.** A key or credit error's key reads OPEN AI & MODELS and lands on that provider's card. SIGN IN and RECONNECT really start the sign-in, a billing error names the provider, and a used-up ChatGPT, Grok or Kimi plan says it resets on its own schedule instead of telling you to top up.
- **Claude Code never throws away a finished turn.** A reply that was already done is delivered instead of being counted as a timeout and run again.
- **A delegated answer is kept whole.** When a worker finishes, its full answer is saved to the conversation before the hand-off counts as done, so a reload or restart can't lose it or swap it for a shortened preview.
- **STOP frees the conversation right away.** It ends a retry wait at once instead of sleeping it out, and on a message still waiting its turn it also stops the automatic report on delegated work that was holding the chat, so your next message doesn't sit on connecting.
- **Reconnecting is more dependable.** When the station drops in the middle of a reply in the Windows app, COMMS now notices and starts recovery. A station that stops answering no longer leaves COMMS stuck on reconnecting, and COMMS says recovery is under way only once it really is.
- **StarNet starts after a crash** even when Windows has given the crashed station's process number to another program.
- **A delegated report that finished while StarNet was closed shows once,** not twice.
- **The DELEGATED card no longer says "stopped" before the station has answered.** It reads checking… until it knows, or status unknown if the station can't be reached.
- **A question an agent asked in a conversation you weren't looking at shows in NEEDS YOU** until you open that conversation.
- **/goal no longer stalls silently** behind an optional curiosity card. If it really has to wait, it says what for.
- **+NEW no longer makes a second blank session.** It opens the blank one already in your list.
- **A damaged spending record no longer blocks every capped run.** It's listed as DAMAGED RECORD in SETTINGS › SPENDING LIMITS, where you settle it; capped work waits until you do.
- **Interrupted runs that never recorded how they were billed** say BILLING SOURCE UNKNOWN instead of pointing you to your provider's dashboard.
- **Skills you approved and shared reach every crew member,** including workers that had drafted their own version.
- **A graphics reset keeps your station's art.** Props keep their current artwork and the floor recovers, instead of falling back to old art.
- **Local models:** Ollama models with strict chat templates, such as Qwen, no longer fail with "System message must be at the beginning" (#102). An Ollama model that runs out of memory stops retrying and can hand the turn to a fallback you set up on another server, and an Ollama server on another machine is named by its host. An OLLAMA card pointed at LM Studio now says so and sends you to the CUSTOM card instead of an empty reply or a vague error, and a CUSTOM connection that only looked like Ollama falls back to its /v1 address by itself (#111).
- **CUSTOM connections take their endpoint URL** when you add them (#113), and clicking a provider that isn't set up opens its setup instead of switching your agents to it.
- **Switching to the Gemini connection keeps working** when a model is still saved in OpenRouter spelling (google/gemini-…, including :free and :thinking): it reaches the right Gemini model instead of failing (#98).
- **ChatGPT plan images:** when ChatGPT refuses the model StarNet uses to make an image, StarNet tries once more with a model your account lists, and says why if there's none to try (#118).
- **browser.upload picks the right file** (#104): the one in your current project. It refuses ambiguous inputs and says the file was selected, not that the site received it.
- **A file patch that doesn't match the file is refused** before anything is written, instead of overwriting the wrong code. Windows line endings are kept.
- **Restore points keep saving.** Checkpoint cleanup no longer gets skipped, a cleanup that runs out of time no longer leaves temporary files behind or runs again every turn (#107), and a checkpoint step that was cut off no longer stops every later restore point. Old checkpoints are kept until their replacement is saved. If restore points stop saving, RESTORE POINTS on the AGENT DOSSIER's RECORD tab says RESTORE POINTS ARE NOT SAVING, names the project folder or agent workspace where it failed, and says what a restore there can and can't undo.
- **ERASE EVERYTHING stays erased** (#101). Automatic recovery no longer brings an old station back after you erase or start fresh.
- **Station changes keep saving when browser storage is full** (#121). A long-used station could outgrow its window's browser storage and quietly stop saving, so a restart brought back an older station. Now every change still goes to the station file on disk, the ● save light says whether your latest change is confirmed there, and an update waits until it is. Changes that never reached the station file under an older version can't be brought back.
- **A locked connector store says why and offers START FRESH**, which sets the old files aside instead of deleting them.
- **Discord and Signal connect more reliably.** The Discord bot no longer needs the privileged message-content setting; pair it in a DM. A Signal bridge linked to your own number works through Note to Self.
- **No more stray system folders on Windows** from computer control, MCP servers and language servers.
- **The Update Center remembers an available update across restarts,** SKIP VERSION stays skipped, and with CHECK AUTOMATICALLY on, opening it checks for a newer version.

## Removed

- **SYSTEM › FIND and its Ctrl+K / Cmd+K shortcut are gone.**

## Security

Everything from 0.13.3 is included, plus more local hardening. When an agent answers a group on a chat app, or someone other than you messaging your bots, it searches only that conversation. Update to get these fixes.
