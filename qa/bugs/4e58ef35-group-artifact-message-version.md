---
fingerprint: 4e58ef35
slug: group-artifact-message-version
title: Group file links choose the wrong author or saved version
surface: sessions
severity: P1
status: fixed
found: 2026-10-12
lane: thread-ux-review-1011
fix: 09e6afba0179fe4aa6930fa5fe5b68a433d4934d
origin: audit
---

# Group file links choose the wrong author or saved version

## Symptom

Group file links choose the wrong author or saved version.

## Repro

Publish the same path in two runs by one author and in a third run by another author; open each original message.

## Evidence

Resolver binds to the message author and run or publication order, keeps explicit attachment identity, and refuses ambiguous basename guesses. Hyperlink and image behavior are tested against the actual production resolver.

Regression anchors: test/thread-flow-navigation.test.js.

Recorded in `qa/evidence/thread-ux-1012/verification.json`.

## Verdict

Source fixed in `09e6afba0179fe4aa6930fa5fe5b68a433d4934d`. This audit record does not claim complete gate, installer, or customer recovery acceptance.
