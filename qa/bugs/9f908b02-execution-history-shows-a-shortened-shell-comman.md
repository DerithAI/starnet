---
fingerprint: 9f908b02
slug: execution-history-shows-a-shortened-shell-comman
title: Execution history shows a shortened shell command instead of the full redacted command
surface: safecell
severity: P2
status: open
found: 2026-10-15
lane: release-0135-prep
fix:
origin: customer
report: support-2026-10-08-to-09-shell-request-visibility
affected: Same two reporters as 082ee8e5 (reported 0.13.1 Windows, Ask on, Full Access off); split out when the approvals half closed for 0.13.5
family: shell-consent-history-visibility
installer: unverified
recovery: unconfirmed
---

# Execution history shows a shortened shell command instead of the full redacted command

## Symptom

After a long shell command runs, its row in the run history shows only a shortened form of the command. The approval card now shows and copies the whole redacted request (082ee8e5, fixed for 0.13.5), but once the call has run there is no way to see or copy the full command from history.

## Repro

1. Ask mode on, Full Access off, a fresh station.
2. Ask an agent to run a harmless shell command longer than 240 characters with distinct beginning, middle and end text.
3. Approve it on the card (the card shows the whole command).
4. Open the run history / tool chip for that call: only the first part is shown and copyable; the end is gone.

## Evidence

The run record keeps a capped summary: `argsSummary: argsRaw.slice(0, 240)` at sidecar/index.js:22089 (agent.tool_call emit), and the history chip parses that capped string (frontend/app/chat.js:3093, "The sidecar CAPS argsSummary"). Bytes never retained cannot be shown later, so the fix needs a bounded, redacted full command stored in the run record: a wire change. Split from 082ee8e5 (customer intake E06) when its approvals half was closed for 0.13.5; planned for 0.13.6. Andrew approved this split on 10-15.

## Verdict

_Filled in when the bug leaves the backlog: what was true, and why it is closed._
