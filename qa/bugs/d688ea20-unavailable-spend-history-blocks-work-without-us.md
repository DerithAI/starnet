---
fingerprint: d688ea20
slug: unavailable-spend-history-blocks-work-without-us
title: Unavailable spend history blocks work without usable recovery
surface: providers
severity: P1
status: fixed
found: 2026-10-11
lane: release-0135-prep
fix: 80eadd838
origin: customer
report: support-2026-10-01-to-09-spend-history-seven-reports
affected: Seven independent reports; Windows x64 and Intel or Apple Silicon Mac; 0.12.5 through 0.13.1 where specified
family: spend-history-blocking
installer: unverified
recovery: persists
recoveryEvidence: One Apple Silicon customer updated to 0.13.1 on October 7 and repeated the same Run Now failure on October 9; other reports have individual outcomes below.
---

# Unavailable spend history blocks work without usable recovery

## Symptom

Interactive agents, specialists and scheduled work refuse to run because spend history is unavailable or unknown. Some scheduled failures show zero current spend or a budget-exhausted message, while customers cannot find a usable supported recovery action. Seven threads share this symptom, not a proven common cause.

## Repro

Customer-reported sequences, not locally reproduced:
1. On an affected installation, attempt the originally blocked entry point: interactive agent, specialist, Run Now or night shift.
2. Preserve the refusal, exact build/provider and relevant unsettled receipt state before changing anything.
3. Exercise the supported review/settlement path only with verified amounts, then retry and restart.
Do not reset ledgers, manufacture zero historical spend or weaken unknown-spend admission guards. A funded account or a working provider health probe does not prove historical spend is known.

## Evidence

Intake E04 groups seven independent threads; follow-up replies are not additional reports:

- SH01, October 6-9: Apple Silicon M4 Mac, initially 0.12.5/OpenRouter; scheduled work after downtime fails immediately. Updated to 0.13.1 October 7; Run Now still fails, reiterated October 9.
- SH02, October 9: 0.13.1 Windows x64; all agents fail despite a replacement OpenRouter key and a reported successful Doctor roundtrip. Restart does not help. Support suggested 0.13.2; no subsequent retest.
- SH03, October 9: 0.13.1 Windows x64 managed; funded balance reported, repeated history refusal. Recovery unconfirmed.
- SH04, October 7: specialist work blocked; customer describes an interrupted run without settlement, spendUnknown and billing lookup HTTP 401. Platform/build unspecified. This receipt is evidence for this report only.
- SH05, October 6: 0.13.1 Windows x64/Anthropic; previously working, then fails overnight. Restart, reinstall and an additional key reportedly did not help.
- SH06, October 2-3: 0.12.5 Intel Mac/DeepSeek direct, other providers also fail; restart during a hung run. Customer was already on the version support recommended. Recovery remains unconfirmed after subsequent source changes.
- SH07, October 1: history-unavailable refusal; build/platform unspecified. No verified recovery.

Dedup: 1746d326 is the opposite safety defect (unknown history granting headroom), not a customer recovery record. Related sources 0893f19cb, d5af7c27f, 353fd91fe, eed3c5c4a and f24467d49 cover different receipt, settlement and display paths. Do not infer a shared mechanism or delivered repair from ancestry. No exact symptom record found on a20ffa71f or cbbf376dad.

Investigation anchors: test/spend-authority.test.js and test/spend-authority.http.test.js. These identify the authority boundary, not proof that any affected customer recovered. Exact installer acceptance and per-report recovery remain outstanding.

## Verdict

Source repair 80eadd838 is in the 0.13.5 candidate: a damaged spend-ledger line is one named unknown charge the Commander can settle, not a block on all work (see Regression). Fixed in source only; customer retest pending. Andrew approved this disposition for the 0.13.5 cut (10-15).

## Regression

Before the fix, one torn or glued line in ledger.jsonl made the strict reader report the whole spend history as unreadable. To show this I took the candidate 42805ac7c (exported to scratch) and reversed the product changes from all three spend-lane commits: 80eadd838, copy follow-up 55b50e088 and glued-row follow-up fb98537f6. All three reversed cleanly. I then ran the candidate's four tests against that tree, and all four failed.
- test/ledger-damaged-line.http.test.js exited 1 at line 41. `assert.equal(st.accounting.readError, 'UNSETTLED_SPEND', 'one unknown line, not an unreadable logbook')` got 'ledger_read_failed'.
- test/spend-authority.test.js passed its first 4 of 6 sections, then exited 1 at line 132. The deepStrictEqual got [false,'UNSETTLED_SPEND',1,undefined] where [...,1] was expected, because damagedLines does not exist before the fix.
- test/settle-managed-copy.test.js exited 1 at line 109. The row read 'INTERRUPTED — unreadable spend record line (run old-a) · … · BILLING SOURCE UNKNOWN' instead of /^DAMAGED RECORD — /.
- test/friendlyerror.test.js reported '1 problem(s), 461 ok'. The FAIL was 'the damaged cause is never called an interrupted run': the refusal got the generic spend-unknown headline.

The same pattern shows on the literal parent. The fix commit's own versions of these tests fail on 80eadd838^ at the same assertions: HTTP line 36 'ledger_read_failed', spend-authority line 132, settle-managed-copy line 109, friendlyerror '1 problem(s), 359 ok'. On 80eadd838 itself they all pass: HTTP 12 s, spend-authority 6/6 sections, settle-managed-copy PASS, friendlyerror 'OK (360 assertions)'.

A scratch probe confirms the customer symptom of "no recourse" on the pre-fix tree. With a glued line, two boots returned readError ledger_read_failed, 0 items to settle, no spend floor, resume 409 and settle 404, and the ledger was untouched. The candidate on the same ledger listed 1 damaged item with a $0.95 floor.

After the fix, on the candidate worktree (29aa4af68 = 42805ac7c plus bug-register edits; git status clean before and after), all four pass:
- the HTTP test passes in 20 s, covering listed-not-bricked, settled once, record preserved, journaled torn tail, glued row counted once, and restart;
- spend-authority passes all 6 PASS sections;
- settle-managed-copy prints PASS;
- friendlyerror prints 'OK (462 assertions)'.

Each run used a temporary APPDATA/LOCALAPPDATA. The same four tests also passed in an untouched scratch export of the candidate, which shows the scratch setup does not cause failures by itself. This is source-level proof only. No customer has retested, no installer was exercised, and none of the seven reports is shown to have this damaged-line cause.

## Sibling coverage

{"adapters":[{"target":"ledger.jsonl reader (sidecar ledgerIo.readAll), glued middle line","state":"covered","test":"test/ledger-damaged-line.http.test.js","scenario":"a fragment glued to a whole row is one DAMAGED unsettled item (fragment's own run/agent/model, no borrowed time) instead of ledger_read_failed; the glued whole row counts in the floor (0.95), then in the exact total after a $0.30 settlement (1.25), with resolvesLine = sha256 of the line","gate":"http"},{"target":"ledger.jsonl reader, torn tail and glued-row variants","state":"covered","test":"test/ledger-damaged-line.http.test.js","scenario":"journaled torn tail recovered without asking (counted once, two boots); torn tail with no journal is unknown and listed; glued row also in the journal or in a later clean copy is counted once; whitespace/BOM before a row records no charge; two whole rows on one line","gate":"http"},{"target":"pure ledger and budget modules","state":"covered","test":"test/spend-authority.test.js","scenario":"health reports damagedLines; unknownCause is 'damaged' only when every open item is a damaged line (a mix keeps 'unsettled'); settleUnsettled writes resolvesLine; history is complete and B.check returns null after settlement; an ordinary row can never claim resolvesLine","gate":"fast"},{"target":"provider adapters (OpenRouter, Anthropic, DeepSeek, managed credits)","state":"not-applicable","reason":"No provider adapter changed. The damaged-line mechanism is in the shared ledger reader and applies whichever provider wrote the row."}],"entrypoints":[{"target":"run-loop paid-call admission (runAgentLoop budget check)","state":"covered","test":"test/spend-authority.test.js","scenario":"cause 'damaged' refuses before any paid call (0 provider calls), failureCode spend_history_unavailable, message names the damaged line and SETTINGS › SPENDING LIMITS, never 'interrupted'","gate":"fast"},{"target":"POST /api/budget/resume and POST /api/budget/settle","state":"covered","test":"test/ledger-damaged-line.http.test.js","scenario":"resume 409 while spend is unknown; settle in limit mode 400 (no cap to count at); settle $0.30 returns 200; a second settle returns 404","gate":"http"},{"target":"night shift, routine/Run Now, station one-shot and aux pre-dispatch checks (budget.check(null, …) in sidecar/index.js)","state":"blocked","reason":"These checks share budget.check, which the unit test shows clears after settlement. No test boots a damaged ledger and drives each of these entry points before and after settling."}],"displays":[{"target":"SETTINGS › SPENDING LIMITS damaged row and headline","state":"covered","test":"test/settle-managed-copy.test.js","scenario":"row labeled DAMAGED RECORD, never INTERRUPTED or BILLING SOURCE UNKNOWN; tooltip names the model and says the damaged line is kept untouched; no COUNT AS; a blank charge is never booked as $0; one-sentence headline; 'damaged record line settled' toast; mixed-item wording","gate":"fast"},{"target":"run refusal copy (friendlyError)","state":"covered","test":"test/friendlyerror.test.js","scenario":"the loop's damaged-line message maps to spend_unknown, names the damaged line and the SETTLE door, and never says 'earlier run'","gate":"fast"},{"target":"real panel rendered in a running station","state":"blocked","reason":"The record cites a manual check on an isolated station (port 9716). No registered test renders the real panel, and that check was not repeated for this proof."}],"lifecycle":[{"target":"sidecar restart before and after settlement","state":"covered","test":"test/ledger-damaged-line.http.test.js","scenario":"the damaged line keeps the same identity across a restart; after settling, history stays complete with the exact total across two restarts; the damaged line stays byte-identical and nothing is rewritten","gate":"http"},{"target":"installed builds (0.12.5–0.13.1, Windows x64, Intel/Apple Silicon Mac) and the seven customer reports","state":"blocked","reason":"No installer was exercised, no customer has retested, and none of the seven reports is shown to have the damaged-line cause."}]}

## Narrow legacy-receipt guidance repair

A disposable current-app reproduction found that old pending receipts without billing metadata were projected as managed=false and directed to a provider dashboard, including a synthetic old managed run. The repair preserves explicit true/false metadata and exposes absent provenance as null. The settlement panel visibly labels that case BILLING SOURCE UNKNOWN and asks for a verified charge without assuming a provider or inventing a historical cap. No attempt is made to infer billing from the current account/provider configuration.

Live before/after and restart evidence: qa/evidence/legacy-spend-recovery-1011/before.json and qa/evidence/legacy-spend-recovery-1011/after.json. Registered regressions: test/settle-managed-copy.test.js, test/spend-authority.test.js and test/legacy-spend-provenance.http.test.js. The latter checks real API projection, no-limit refusal, untouched ledger, unknown totals and the unchanged resume guard over two boots.

This is a source-level recovery-guidance improvement only. It neither establishes the receipt cause for all seven customer reports nor reconciles their historical charges. The report stays open, installer unverified, and per-customer recovery unchanged. The funded-account October 8 recurrence a5060cc3 remains unresolved and outside this repair. Full focused validation details, including the initial spend HTTP failure, are retained in qa/evidence/legacy-spend-recovery-1011/verification.json.

## Damaged record line repair — 2026-10-14

A second source mechanism with no recovery: one unreadable line in ledger.jsonl (a torn or glued row, which appends before 2026-09-22 could leave after a crash and the old reader skipped) made the strict reader report the whole history as unreadable. With a limit the Commander chose, every paid run was refused, restart and reinstall read the same bytes, and SPENDING LIMITS had nothing to settle. Reproduced on the candidate before the fix: `readError` was `ledger_read_failed` for a ledger with one glued line.

Source repair (commit 80eadd838, copy follow-up 55b50e088): the damaged line is one unknown charge, never $0. Capped work stays refused, the line is listed as DAMAGED RECORD in SETTINGS › SPENDING LIMITS, and the Commander settles it with the verified charge in an attested row that names the line's sha256 (`resolvesLine`). The line is never rewritten or removed. A torn fragment of a row the settlement journal replays whole is recovered without asking. Refusals name a damaged line, never an interrupted run.

Regressions: test/ledger-damaged-line.http.test.js (listed, refused resume, restart identity, settle once, bytes preserved, journaled torn tail, unjournaled torn tail), test/spend-authority.test.js (cause, resolvesLine, loop refusal before any paid call), test/settle-managed-copy.test.js and test/friendlyerror.test.js (copy). Live isolated station on port 9716 with a seeded glued line: the panel showed the DAMAGED RECORD row and headline, SETTLE through the real panel gave "✓ damaged record line settled", spentToday 0.8 and complete accounting, and both held after a sidecar restart with the damaged line byte-identical.

This does not establish which mechanism affected each of the seven customers, and no installer or customer recovery is claimed. The report stays open.

### Glued line follow-up — 2026-10-14

Review found that the first repair treated a glued line (a torn fragment followed by one whole row the next append wrote) as one unknown item: the whole row's recorded charge was left out, and once the fragment was settled the panel read complete history without it. The item also showed the glued row's time beside the fragment's run.

Follow-up repair: a whole row glued onto a torn line is read and counted exactly once. It must be byte-identical to what an append writes, and it is skipped when the settlement journal or a clean copy elsewhere in the file holds the same row (same entryId, or same bytes). Only the fragment is the unknown charge; the DAMAGED RECORD item names what the fragment itself says (run, agent, model, time) and shows "time unknown" when the fragment has no time. The item keeps the sha256 of the whole line as its identity. Whitespace before a whole row (for example a byte-order mark) records no charge.

Regression: test/ledger-damaged-line.http.test.js now asserts the glued row in the floor before settling (0.95) and in the exact total after settling (1.25, across two restarts), the fragment's own run and no borrowed time, a glued row also held by the settlement journal (counted once, nothing appended twice), a glued row with a later clean copy (counted once), a BOM before a row, and two whole rows sharing one line. It failed first on the borrowed timestamp. Live isolated station (port 9716, fresh workspace): before settling the panel read "At least $0.70 today" and the row read "… (run old-a) · time unknown"; after SETTLE at $0.30 it read "SPENT TODAY $1.00 · LIFETIME $1.00 (3 runs)", and a sidecar restart kept spentToday 1 with complete accounting and the damaged line byte-identical.
