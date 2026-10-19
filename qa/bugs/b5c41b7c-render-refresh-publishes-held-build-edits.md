---
fingerprint: b5c41b7c
slug: render-refresh-publishes-held-build-edits
title: Render refresh publishes unfinished edits while Build remains open
surface: world
severity: P1
status: fixed
found: 2026-10-12
lane: agent/session-handoff-1011
fix: f90409837a5a69faf32ca3bf2e918bed8c508d4a
origin: audit
installer: unverified
recovery: unconfirmed
---

# Render refresh publishes unfinished edits while Build remains open

## Symptom

A late artwork or lighting refresh could send an unfinished Build floor to the real router and remove its pending-edit status. Full and cropped still reads shared the implicit recompilation path. This is source finding R24, not a confirmed customer incident cause.

## Repro

Run node test/station-layout.e2e.test.mjs. It holds the real artwork manifest response, opens Build, removes a Bay agent, then releases artwork readiness. It checks the router publication count and pending floor before and after the actual callback and still reads. The original pending-layout assertion is retained.

## Evidence

qa/evidence/customer-release-1011/build-render-publication.json pins before/fixed sources, original failing logs, callback stack and source hashes. At ccd24082bedef13422740e011728ceecdfe59a38, late PropRemaster.ready called frontend/app/propsprites.js:11954; World.rebake rederived and POSTed hash ed111928 while Build remained open, replacing fb92ca7f. The modified-source live run passes all recorded assertions, including explicit sync and Build-close router confirmation.

## Verdict

Source repaired and independently reviewed at f90409837a5a69faf32ca3bf2e918bed8c508d4a. Render-only entrypoints defer dirty Build geometry while retaining visual invalidation. Explicit syncPlan and closing Build still publish. Full new-candidate gates and exact installed acceptance remain pending. The original full-suite failure did not retain its callback, so its exact trigger remains unproven.

## Regression

The real browser fixture covers delayed artwork, lighting-style refresh, full/cropped still reads, unchanged publication count, explicit sync and close. test/refit-bake-reuse.test.js also covers held, clean, Build-closed and missing-Build bootstrap boundaries. test/plan-poster.test.js and test/world-texture-ready.test.js pass with existing assertions.
