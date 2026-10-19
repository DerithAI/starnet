---
fingerprint: f2ac6356
slug: google-drive-authorization-is-hard-blocked-for-a
title: Google Drive authorization is hard blocked for a fresh personal account
surface: onboarding
severity: P2
status: open
found: 2026-10-12
lane: release-0135-prep
fix:
origin: customer
report: support-2026-10-09-drive-oauth-hard-block
affected: Reported StarNet 0.13.1; operating system and exact installer artifact unverified
family: google-drive-oauth-block
installer: unverified
recovery: unconfirmed
---

# Google Drive authorization is hard blocked for a fresh personal account

## Symptom

Google Drive authorization stops at Google's This app is blocked error. The customer explicitly selected a newly created personal Google account and encountered the same hard block.

## Repro

Customer-reported operation, not a locally reproduced Google rejection:
1. In the affected signed build, start Google Drive connection and select the intended personal account.
2. Record the exact shipped OAuth client, requested scopes and Google error privately.
3. If a supported authorization succeeds, verify a bounded permitted Drive read, then quit/restart and verify continued access.
Keep Selected Google files access separate from broad Drive scopes; do not bypass Google policy or assume a different account resolves the rejection.

## Evidence

Original October 9, 2026 12:54 a.m. America/New_York report was cross-checked against retained private intake on October 12. The report includes a specific OAuth client, openid/userinfo.email/drive.readonly/drive.file scopes and a loopback connector callback. The exact client and private report remain outside this tracked record. The Google page supplied no further diagnostic detail. The residual audit found no later recovery reply in a targeted search.

Deduplicated against lane HEAD e1bf891de and coordinator 003a8b6c5. e5d4b743 concerns the earlier developer-credential form; this is a distinct external authorization hard block. The October 2 Gmail report is separate. A Gmail app-password route is neither a Drive solution nor proof of OAuth recovery.

Investigation anchors: sidecar/mcp/google-client.js, sidecar/mcp/catalog.js and test/google-early-access.e2e.test.js. Current early-access routing and requested Drive scopes do not prove Google publisher approval or deployment state. Verification status, user caps, client settings and policy are unproven hypotheses. Missing evidence is the current exact Google rejection/client context, publisher configuration and signed-build consent/restart acceptance. No external account action or source fix was performed.

## Verdict

Re-triaged P1 to P2 (external): Google Drive authorization is blocked by Google app verification, outside StarNet code; tracked until Google verifies the app. Andrew approved this disposition for the 0.13.5 cut (10-15).

## Regression



## Sibling coverage


