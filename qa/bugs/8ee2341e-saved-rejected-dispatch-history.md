---
fingerprint: 8ee2341e
slug: saved-rejected-dispatch-history
title: Saved rejected worker output survives accepted answer reconciliation
surface: sessions
severity: P2
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 4c3d9c3019f8475eae283c62757d7e94a9296fdc
origin: audit
---

# Saved rejected worker output survives accepted answer reconciliation

## Symptom

A desktop save with RAW_REJECTED under an original sourceRunId retains that prose after the canonical final answer arrives. Both desktop and phone may show it and send it as the most recent assistant turn. Obsolete error flags on a replaced row can also hide the accepted answer from desktop follow-up context.

## Repro

Save a visible user request and rejected assistant output with explicit original run identity. Reconcile a canonical accepted assistant row with dispatchState final and the same identity. Save/reload and send a follow-up. Include duplicate saved copies, attachments, a system status, and stale failure flags.

## Evidence

qa/evidence/thread-ux-1012/saved-history-verification.json binds source 4c3d9c3019f8475eae283c62757d7e94a9296fdc. Desktop merge passes 33 assertions, phone merge 25, and delivery 308. Live seeded save/reload/send shows one accepted answer, both attachments, retained system status, no raw output or stale error styling, and one accepted answer in follow-up context. Real sealed-phone HTTP passes saved-history and provider follow-up checks before/after restart; its two remaining failures require absent sprite fixtures.

## Verdict

Source fixed by canonical final supersession with explicit compatible run/agent/stream identity. Unrelated, unattributed, and unfinalized prose remains. Attachments and taint survive; obsolete failure flags move to separate supersededStatus evidence. New deliveries stamp ownership to avoid duplicate restoration. No trunk, installed-build, or customer acceptance claim. Customer record 082ee8e5 remains OPEN.
