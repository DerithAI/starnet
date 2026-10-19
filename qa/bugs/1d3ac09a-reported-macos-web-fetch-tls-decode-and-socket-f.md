---
fingerprint: 1d3ac09a
slug: reported-macos-web-fetch-tls-decode-and-socket-f
title: Reported macOS web fetch TLS decode and socket failures
surface: providers
severity: P2
status: open
found: 2026-10-03
lane: release-0135-prep
fix:
origin: customer
report: support-macos-fetch-2026-10-03
affected: v0.12.5 e70324eb7ae4f0fa53f8758c4edc34074a31acda darwin arm64 Node v22.23.2
family: outbound-transport
installer: unverified
recovery: unconfirmed
---

# Reported macOS web fetch TLS decode and socket failures

## Symptom

Customer reports web_fetch fails before an HTTP response, including for https://example.com. A complete quit/relaunch did not recover it. Diagnostics list ERR_SSL_TLSV1_ALERT_DECODE_ERROR and UND_ERR_SOCKET; no proxy environment variables are configured. These run-level entries are not a proven tool-level cause.

## Repro

1. On the affected v0.12.5 Mac, request one web_fetch of https://example.com.
2. Expand the actual tool result; record its cause code and whether an HTTP status exists.
3. Compare `curl -I --max-time 20 https://example.com` in Terminal on that Mac/network.
4. Capture fresh diagnostics. The error tail persists across app restarts, so old timestamps are not proof of a new failure.

These are customer reproduction steps, not a successful local reproduction of the TLS alerts. The investigation host is Windows x64; the affected Mac is unavailable.

## Evidence

Sanitized report received 2026-10-03: affected build above, TLS/socket error timestamps October 2-3 UTC. No customer identifiers, raw diagnostics, credentials or transcript contents are stored here.

Source investigation at 67850c57a and the reported commit:

- sidecar/tools/builtin/web.js:442 creates an Undici Agent for each direct-fetch hop and closes it after reading the response. There is no persistent direct-fetch pool to clear between calls. The hostname is retained for Host/SNI.
- sidecar/index.js:1410 records agent.run.error into the diagnostic tail. Provider calls can emit these errors too. The reported last run completed; the most recent pasted TLS error predates that run.
- web_fetch uses local Undici independently of the selected model provider. Optional Jina extraction requires its own configured key. The credits error is a separate run failure and cannot explain a TLS alert from a direct public-page request.
- Comparing e70324eb to v0.13.0/current source shows no direct-fetch transport repair. The web.js difference concerns web_request stored-key refusal text. Bundled Node remains v22.23.2 and Undici remains 6.28.1.
- The live GitHub release API reports v0.13.0 published 2026-10-03T23:08:55Z (7:08 p.m. America/New_York), after the pasted diagnostics capture, with an Apple Silicon DMG. Release notes do not claim a TLS fix: https://github.com/androoAGI/starnet-releases/releases/tag/v0.13.0 .
- Public issue searches for TLS/fetch failures and local transport history did not identify a correlated macOS TLS repair. This is a bounded search, not proof no other report exists.

A live-network module probe with bundled Windows Node v22.23.2 and Undici 6.28.1 found a DIFFERENT defect, ERR_INVALID_IP_ADDRESS. See audit record 051f8c3b. Correcting that defect must not close this TLS report without correlated evidence.

## Verdict

Re-triaged P1 to P2 for the 0.13.5 cut: waiting on reporter data; not reproduced locally and no source defect is proven. Reopen at P1 when the reporter's data shows a defect. Andrew approved this disposition for the 0.13.5 cut (10-15).

## Regression

TLS/socket failure has not been reproduced locally or retested on the affected installer. No production code changed; no source-fix, installer-verification or recovery claim.

## Sibling coverage

{"adapters":[{"target":"direct Undici web_fetch and optional Jina extraction","state":"blocked","reason":"Affected Mac and endpoint-level evidence unavailable; local failure has a different signature."},{"target":"Codex and managed model-provider fetch","state":"blocked","reason":"Run errors do not identify the destination; no customer provider call made."}],"entrypoints":[{"target":"interactive web_fetch and web_request","state":"blocked","reason":"Transport traced; original tool result and affected installer unavailable."}],"displays":[{"target":"diagnostics and COMMS tool result","state":"blocked","reason":"Source distinguishes run errors from tool results; no affected-Mac UI inspection."}],"lifecycle":[{"target":"quit/relaunch","state":"blocked","reason":"Customer reports persistence; no local Mac restart verification."}]}

## Historical record recovery on October 12, 2026

Recovered the exact existing fingerprint and original investigation from commit 17c3aeb9253b88bb5dcae60a55b7af819415031d (October 3, 2026). The October 11 email intake E23 had missed that earlier record; the October 12 residual audit recovered the Git object after the old worktree was no longer present. This is a chronological evidence correction, not a new incident or source fix. The original investigation above remains historical: its source/release observations are not claims about the current tree.

The report remains open, installer unverified and customer recovery unconfirmed. Later host/cause diagnostics or DNS callback repairs do not establish recovery of the reported Mac TLS/socket symptom. Still missing are a newly failed expanded tool result and the same-Mac/network comparison.

## Related diagnostic improvement on October 12, 2026

A separate registered-tool reproduction showed post-header decoding/socket errors losing their cause code and hostname when serialized as `terminated`. The source now appends bounded code/final-hop host while preserving the original error classification, cancellation, TLS and SSRF policy. Real loopback registered-tool checks cover malformed gzip, after-header socket loss, redirects and metadata redaction; 88 assertions plus 49 SSRF and 36 calm-fetch assertions pass. See `qa/evidence/customer-release-1011/web-body-diagnostics.json`.

This repairs support diagnostics, not the customer's unidentified macOS TLS failure. The report remains open with installer unverified and recovery unconfirmed; fresh expanded tool evidence and a same-Mac/network comparison are still required.
