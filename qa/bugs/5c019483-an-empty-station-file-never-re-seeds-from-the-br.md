---
fingerprint: 5c019483
slug: an-empty-station-file-never-re-seeds-from-the-br
title: An empty station file never re-seeds from the browser save and the banner blames another window
surface: sessions
severity: P1
status: fixed
found: 2026-10-20
lane: sweep/onboarding
fix: 00b4257d6
origin: audit
---

# An empty station file never re-seeds from the browser save and the banner blames another window

## Symptom

When the station's workspace is empty but the browser still holds the station's save (workspace folder deleted, moved or reset; a fresh install over an old WebView profile), the app resumes the old station from the browser copy and then can never back it up. Every autosave is refused as a conflict, and a banner says "Another window saved newer station changes. Your work from this window was preserved separately on the station." No other window exists and the station file is still empty. Pressing the banner's "Reload current station" deletes the browser copy and drops the Commander into a brand-new first-run onboarding. That onboarding silently reuses the old station's API key and per-station browser state: WAKE succeeded with an EMPTY key field because `starnet.byok.key` survived.

## Repro

1. Onboard a station on `node dev/onboard-fresh.js` (port 9761) in a browser profile; do some work (save `_saveRevision` reaches 23).
2. Stop the sidecar; restart `node dev/onboard-fresh.js` (wipes the workspace) with no server key; reload the same browser tab.
3. The old station (NOVA, its sessions) is back on screen; `GET /api/save` → `{"save":null,...}`; the workspace gets `agent.save-conflict-<uuid>.json` and no `agent.save.json`.
4. `CloudSave.health()` → `conflict:{ok:false,stale:true,conflict:true,revision:0}`; `#save-conflict-notice` shows the "Another window…" text.
5. Click "Reload current station" → splash/first-run. Pick OpenRouter, leave the key EMPTY, WAKE → enters the game; the mock provider logs valid-key chat calls.

## Evidence

Live, 2026-10-20: `{"h":{"consecutiveFailures":2,"conflict":{"ok":false,"stale":true,"conflict":true,"revision":0,"recovery":"agent.save-conflict-b8992ed2-….json","updatedAt":0}},"rev":23,"pull":"empty","localRev":23,"dirty":true}`; `GET /api/save` `200 {"save":null,...}`; banner text as quoted. After Reload: `{"screen":"screen-splash","hasLocal":false}`, localStorage still held `starnet.byok.key` (30 chars), `starnet.pitch.v1`, `starnet.tutorial.v1`, `starnet.queststate.v1`, `starnet.trust.v1` and others; WAKE with an empty key field → `screen-game`, mock `kind:"chat"` with `keyShape:"valid-mock"`.

Root cause: `frontend/app/cloudsave.js` reconcile, empty-remote branch: `revision = num(local && local._saveRevision); if (isSave(local)) push(local);` ("seed the server") pushes with the local revision (23), and `sidecar/savestore.js` save with `compareRevision` reads the missing prior as revision 0, `expected !== revision` → conflict file, never a seed. `frontend/app/stationui.js` refreshSaveDurability prints the multi-window text for every conflict. `CloudSave.reloadCurrent` removes only `starnet.save`.

The seed rule chosen (agent/p1-5c019483): `sidecar/savestore.js` save with `compareRevision` takes a copy based on a revision the file does not hold as the station file's FIRST revision only when there is truly nothing there (main AND `.bak` absent). A locked (unreadable), corrupt or `.bak`-recovered station file is not empty and keeps the old CAS conflict. The Erase Everything resurrection guard is the generation's own `.fresh-start.json` receipt (ERASE EVERYTHING and START FRESH both write it): a copy whose `agent.createdAt` is not later than the receipt's `at`, or a receipt that cannot be read, is refused as a conflict with `reset: true`. A brand-new station's first save (revision 0) is unchanged.

After the fix, `test/save-empty-station-seed.test.js` (real `cloudsave.js` in a vm over the real GET/POST `/api/save` handlers sliced from `sidecar/index.js` and the real savestore on a temp workspace): a browser copy at `_saveRevision` 23 over an empty station file → `flush` true, station file NOVA at revision 1, no `agent.save-conflict-*`, cache clean at revision 1, the next autosave lands at revision 2, a reload resumes at revision 2 with no conflict, and the save light notifies once "The station file on this computer was missing, so this window’s copy of your station was saved back to it." An erased generation (`at: "7000"`, copy founded at 5000) → conflict `reset:true, revision:0`, station file stays empty, copy kept aside, banner "This computer’s station was reset (erased, or set aside for a fresh start) after the station in this window was founded, so it was not restored…" with "Open the fresh station". RED before the fix: 25 problems (the conflict at revision 0, the "Another window…" banner, no seed).

## Verdict

An empty station file plus a browser copy now re-seeds the station file instead of refusing every autosave, so the banner, its "Reload current station" (which deleted the browser copy) and the first-run onboarding it led to are no longer reached in this case. A non-empty or recoverable station file is never overwritten, and a reset generation still refuses a station from before the reset, now saying so instead of blaming another window. Source fixed and test-proven; NOT walked live in the app (the lane ran no sidecar). Not changed: a reset-refusal "Open the fresh station" still enters first-run with whatever browser keys survived the reset (`starnet.byok.key` and the other per-station keys listed above).
