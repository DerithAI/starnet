#!/usr/bin/env node
'use strict';

/* "Help names screens that exist" holds for the release notes too: any AGENT DOSSIER tab RELEASE_NOTES.md sends a
   reader to is a tab the dossier really renders. The tab list is read from the one array stationui.js hands
   mountConsole for the dossier (BRIEF · GROWTH · RECORD · MEMORY · CONFIG at the time of writing), so a renamed or
   folded tab fails here instead of in a reader's hands. Notes that name no dossier tab pass. */

const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const ROOT = path.join(__dirname, '..');
const notes = fs.readFileSync(path.join(ROOT, 'RELEASE_NOTES.md'), 'utf8');
const ui = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'stationui.js'), 'utf8');

const start = ui.indexOf("mountConsole(body, 'agents', [");
const end = start < 0 ? -1 : ui.indexOf('], {', start);
A.ok(start >= 0 && end > start, "stationui.js still builds the AGENT DOSSIER with mountConsole(body, 'agents', [...])");
const tabs = start >= 0 && end > start ? [...ui.slice(start, end).matchAll(/\blabel: '([^']+)'/g)].map(m => m[1]) : [];
A.ok(tabs.length >= 3, 'read the dossier tab labels (' + tabs.join(', ') + ')');

const NAME = "([A-Z][A-Z0-9&+ -]*[A-Z0-9])";
const named = [
  ...notes.matchAll(new RegExp('\\bthe ' + NAME + ' tab of the AGENT DOSSIER\\b', 'g')),
  ...notes.matchAll(new RegExp("\\bAGENT DOSSIER(?:'s|’s) " + NAME + ' tab\\b', 'g')),
  ...notes.matchAll(new RegExp('\\bAGENT DOSSIER › ' + NAME, 'g'))
].map(m => m[1]);
for (const t of named) A.ok(tabs.includes(t), 'RELEASE_NOTES.md sends readers to an AGENT DOSSIER tab that does not exist: "' + t + '" (tabs: ' + tabs.join(', ') + ')');

A.report();
