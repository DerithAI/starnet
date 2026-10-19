#!/usr/bin/env node
'use strict';

/* The public release notes never describe a security mechanism the code itself records as still open (memory law:
   never describe an unfixed security gap in public notes; docs/releases/next/NOTES_DRAFT.md "Security": other
   security fixes are described only in general terms).

   sidecar/lsp-manager.js records an open item for the TypeScript language server; while it does, RELEASE_NOTES.md
   (the GitHub release body and the UPDATE CENTER text) must not name that server. */

const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const ROOT = path.join(__dirname, '..');
const notes = fs.readFileSync(path.join(ROOT, 'RELEASE_NOTES.md'), 'utf8');
const lsp = fs.readFileSync(path.join(ROOT, 'sidecar', 'lsp-manager.js'), 'utf8');

A.ok(/id: 'typescript'/.test(lsp), 'lsp-manager.js still declares the TypeScript language server (the guard reads the real entry)');
const noteOpen = /Closing that needs tsserver\.path pinned/.test(lsp);
const pinned = /tsserver\s*:\s*\{[^}]*\bpath\b/.test(lsp);
const gapOpen = noteOpen || !pinned;

if (gapOpen) {
  const named = /\bTypeScript\b[^.\n]*\b(?:language server|server)\b|typescript-language-server|tsserver/i.exec(notes);
  A.ok(!named, 'RELEASE_NOTES.md names the TypeScript language server while lsp-manager.js records an open item for it: "' + (named ? named[0] : '') + '"');
}
// No wording pin beyond that: each release writes its own Security paragraph (release-bump starts the file over),
// so a phrase this one happens to use is never required of the next.

A.report();
