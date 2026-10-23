# StarNet v0.14.0

**Before you update:** save a station backup first (SETTINGS › APP & BACKUP › STATION BACKUP). If agents are working when you install, choose WAIT FOR AGENTS.

The lighter, sharper update. StarNet does far less work you never see: the background work that ran every few seconds is nearly gone, pulsing lights no longer redraw the whole window at full speed, and a station where nothing moves draws half as often. Agents got a round of fixes for the things that made them look worse than the model behind them. The QUEST LOG becomes a battle pass, StarNet comes to the terminal with its own CLI, and there is a long list of fixes.

## Lighter on your PC

- **A still station draws 30 times a second instead of 60.** The moment anything moves (an agent walking or typing, a crate on a belt, the camera, your mouse) it goes straight back to 60, and 144 while you pan. Minimized or in the tray it still draws nothing.
- **The idle camera settles.** When the camera has finished a move it stops instead of creeping, so the floor's shadows and belts stop redrawing every frame.
- **Pulsing lights no longer redraw the whole window.** A blinking cursor, a failed session's dot or the dock's glow used to make the entire window, frosted glass and all, redraw at your screen's full refresh rate, all day long. They now pulse in small steps, and the window only redraws when a step changes.
- **Background work is almost gone.** An idle station used to re-read and re-parse your whole station file dozens of times a minute. It now reads from memory: on a large station the background process went from about 10–30% of a CPU core to under 1%, and the short freezes that came with it are gone.
- **Polls slow down while you're away.** When the window is hidden or you've stepped away, StarNet checks for updates every 30 seconds instead of every second, and catches up the instant you're back. What you see on screen keeps its normal pace.
- **Less waste per frame:** lighting, the starfield, walking paths and the review crates no longer rebuild work they already did.
- **Memory stays flat.** A slow memory leak in the chat-app connections is fixed, the local voice cache is cleaned up, and old run records and browser handles are released.
- **One huge command output can no longer crash StarNet.** A command that prints gigabytes keeps its first and last parts, and the agent is told the middle was cut.

## Agents

- **Edits are never silently lost.** If a file changed on disk since the agent last read it (another agent, another run, or you), the edit is refused and the agent is told to read it again, instead of writing over the change and reporting success.
- **File contents arrive exactly as written.** A repair step for slightly broken tool calls could remove commas inside the text an agent was writing (`[1, 2, 3,]`, regex character classes, shell patterns). It now only touches the call's own structure.
- **Agents use their model's real memory.** Gemini, Claude, Ollama, LM Studio, vLLM, DeepSeek and other providers that report a context window now get that window, instead of a 131k guess. A 1M-token Gemini no longer starts forgetting at 85k, and a small local model no longer overflows.
- **Spreadsheets read correctly.** A sheet with blank cells keeps every value in its own column.
- **Clarifying answers aren't lost.** If the run that should use your answer fails before it starts, the agent still has your original task when you retry.
- **Signing out stays signed out,** even if a sign-in refresh was in flight.
- **An agent without the right gear says exactly what's missing** and which room it needs to be placed in, instead of guessing.
- **A terse "Looks good." at a review step hands on the work it approved,** not just those two words.
- **The per-run spending cap now covers workers an agent spins up,** so a 5¢ cap can't turn into 24¢.
- **A deleted conversation stays deleted.** It no longer reaches an agent through history or recall.
- **Faster streaming.** Long tool calls and long replies are no longer re-scanned from the start on every token.
- **Skills are never lost** when the skills log grows large.

## New

- **The QUEST LOG is a battle pass:** an ASCII tier track, rank titles, a daily streak, a season and weekly challenges aimed at your real goal.
- **StarNet in the terminal.** `starnet` opens a dashboard of your station: your crew, live runs, approvals with an always-allow key, slash commands and your skills, and it works in the folder you launched it from (asking first if that folder isn't trusted). `starnet -p "…"` runs one task headlessly, now with the agent's full tools.
- **The CLI works with your mouse:** click an agent to open its chat, and move between STAT, CREW, COMMS, WORK and SKILLS from the tab line.
- **The CLI has the station's terminal look:** a tab line under the logo that shows where you are, your crew grouped as NEEDS YOU, WORKING and STANDING BY, and a stat bar along the bottom with your station's level and XP, the crew, spend and the clock.
- **Agents can show you pictures in COMMS.** An image an agent made or found appears as the picture, not a link.
- **Scheduled routines can make images** when you turn on ▣ ALLOW IMAGES, and a chat-bound routine's reply carries its images and files to Telegram.
- **Your own /commands work in group chats** as /command@yourbot and appear in Telegram's "/" menu, and also on Discord, Slack, Matrix and Signal.
- **Group chats on Telegram:** the paired owner sends /allow in a group to let StarNet answer there, and /deny to close it.
- **KEYS can hold a 1Password reference** (op://…), read with the 1Password CLI and kept in memory only.
- **Dossier and tagline fields show their character counts.**
- **EXPORT STATION** saves to Downloads and says exactly where.

## Fixes

- With many conversations waiting on approvals at once, Approve/Deny, new runs and NEEDS YOU no longer stall.
- BUILD only lights up for a station gap you haven't seen yet, and SESSIONS and PROJECTS switch cleanly (no phantom + key, readable paths).
- A new chat's first message runs in that chat and survives a restart.
- If StarNet crashes while answering a phone message, it doesn't repeat what the agent already did; it tells you the run was interrupted.
- Away autonomy you chose at setup acts on what you told it, instead of waiting for runs first.
- An empty station file is rebuilt from the default station instead of refusing every save.
- A fresh install no longer lands in Recovery Mode.
- A CUSTOM provider keeps your exact vendor and model id.
- A slow local Ollama turn says where the model is, and a cancel records what it interrupted.
- Denied calls read "denied", not "failed", and a denied run proposes no memories.
- Unpriced runs are labelled as unpriced instead of booked as $0, and a 403 is no longer called "key rejected".
- A routine killed mid-run reads interrupted, nothing counts down while scheduling is off or E-STOPped, and the autumn clock change no longer fires a routine twice.
- A cut voice stream is a failure, never a half clip saved forever.
- The workflow reader loads on older Mac Safari (before 16.4).
- An installer update checks its signature properly, and a refused or interrupted update says nothing was installed.
- Many smaller wording and layout fixes across COMMS, SESSIONS, onboarding and the dossier.
