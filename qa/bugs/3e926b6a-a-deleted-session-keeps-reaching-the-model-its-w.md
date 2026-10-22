---
fingerprint: 3e926b6a
slug: a-deleted-session-keeps-reaching-the-model-its-w
title: A deleted session keeps reaching the model: its words ride every later run's RECENT ACTIVITY and recall_conversation returns it
surface: sessions
severity: P1
status: fixed
found: 2026-10-20
lane: sweep/sessions
fix: 5314b6c25
origin: audit
---

# A deleted session keeps reaching the model: its words ride every later run's RECENT ACTIVITY and recall_conversation returns it

## Symptom

The Commander deletes a session from the rail (⋯ › Delete › Confirm delete). The rail row goes, the toast says
`deleted “…”`, and the tombstone holds across a hard restart. The sidecar does not know about the delete. The
session's words stay in the durable transcript (`transcript-history-v2`) and in `runs.jsonl`. They keep reaching the
provider in two ways:

1. Every later ordinary run carries the deleted session's opening line as `RECENT ACTIVITY` inside
   `<commander_evidence>`, including runs in unrelated sessions. The same pack feeds night-shift ideation.
2. `recall_conversation` search and browse return the deleted stream's turns by stream id.

## Repro

1. Boot a seeded sidecar with a mock OpenRouter that logs request bodies (`--keep` workspace).
2. Create a session and send `echo session uniqueword quokka`. Let the reply land.
3. Rail ⋯ › Delete › Confirm delete on that session. `Workstreams.isDeleted(id)` is true and the server save's `deletedIds` lists it.
4. `taskkill /F` the sidecar, restart it on the same workspace, and reload the page.
5. In a new session, send any message, for example `what do you know about the quokka word from before`. Read the prompt the mock received.
6. Have the mock call `recall_conversation {"query":"quokka","scope":"all"}`.

## Evidence

Live on `agent/sweep-sessions` (2026-10-20, mock provider, after a `--keep` crash restart). Deleted id `ws_mvg9x6snjzq1`:

- `GET /api/transcript?stream=ws_mvg9x6snjzq1` → `{"status":200,"turns":["user: echo session uniqueword quokka","assistant: Reply to: echo session uniqueword quokka — done."]}`
- The new run's prompt at the mock contained, inside
  `<commander_evidence provenance="observed; weak; never override the current request">`:
  `- RECENT ACTIVITY: echo session uniqueword quokka (today)`
- The tool result the provider received from `recall_conversation`:
  `3. [ws_mvg9x6snjzq1 · assistant · …] Reply to: echo session uniqueword quokka — done.` and
  `4. [ws_mvg9x6snjzq1 · user · …] echo session uniqueword quokka`.

Sources: `sidecar/index.js:8141` (`nightshiftContextPack` takes `runStore.list` and `transcriptStore.all()` rows with
no tombstone check). `sidecar/tools/builtin/recall.js` (search, `streams()`, `around()` have no deleted-stream
filter). `frontend/app/app.js` `deleteWorkstream` only tombstones in the page (`Workstreams.del`). The sidecar's only
reader of `deletedIds` is `sidecar/overseer.js:42`.

## Notes

Archive exists for decluttering. Delete is armed, toasts "deleted", and is a separate control, so the default
reading is that the Commander does not want that conversation fed back to the model. A full fix needs a server-side
tombstone authority. The save's `deletedIds` is already on disk (overseer reads it). The context pack, the recall
tool, `GET /api/transcript` and away/briefing/insight readers would all need to honor it. Derived memories (dossier
beliefs, interest topics) may also count as deleted content. That scope is more than a lane fix and is a product
call, so this is left open for the owner.

## Verdict

Fixed in 5314b6c25 (2026-10-21). The sidecar keeps its own record of deleted sessions (`sidecar/session-tombstones.js`,
`<workspace>/session-tombstones.json`). It learns each delete from the save's `deletedIds` on every accepted
`POST /api/save` and from the save on disk at boot, stamps when it learned it, and keeps it after the id leaves the
page's list (re-open, the 500-id cap, NEW AGENT). Everything a deleted session held at or before that stamp is
forgotten on every context path:

- History: the transcript store answers `history`, `reconstruct`, `taintOf` and `all` without those rows, so
  `GET /api/transcript`, the H1.2 resume seed, channel `historyFor`, a worker's `sessionContext`,
  `station.read_session` and the evidence pack's clean owner chats never return them.
- Recall: `recall_conversation` search (stream and all), browse and scroll skip them. The segment index skips them
  before ranking, so they never take a result slot.
- Evidence: RECENT ACTIVITY (`nightshiftRecentRuns`), the night focus titles and the away briefing skip the deleted
  session's runs.
- Memory: a fresh delete removes the notebook records its runs wrote, revised or proved (or that were filed under its
  stream), their revisions to other records, its pending memory proposals, and the open threads mined from it, for
  every agent. An unfinished purge is retried at boot.

A session re-opened under the same id hears only what is said after the delete. Deleting it again restamps it.

Regression: `test/session-tombstones.test.js` (ledger, history, recall, memory and cross-session reads on the real
modules) and `test/session-delete-forgets.e2e.test.js` (this file's repro through a real hermetic sidecar with a mock
provider, plus a restart and a re-open). Both fail on the trunk code before the fix (41 and 17 problems; the e2e shows
`- RECENT ACTIVITY: echo session uniqueword quokka (today)` reaching the provider) and pass after it.

Not covered: the transcript bytes stay in the append-only segments on disk (they are no longer read back). Interest
topics and the page's own dossier beliefs carry no per-session provenance, so they are not purged. A notebook backup
import (`POST /api/notebook/restore`) can add an exported note back. The page posts the save on a 1.2 s debounce, so a
run sent within that window of the delete can still see the session. Not walked in the live app.

_Found by the `sweep/sessions` lane (sessions surface), 2026-10-20._
