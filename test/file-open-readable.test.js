/* node test/file-open-readable.test.js — a file the crew made opens as something to READ, never raw text on a white tab
   (live walk 10-14: OPEN on a worker's tagline.md, from the delegation card, landed on /api/file raw text in a white,
   unstyled browser tab). In a browser — where the station cannot hand a file to the OS — every door that opens a TEXT
   deliverable (the delegation card's Open key and COMMS file links through Chat.openFile / wireFileOpen, the
   DELIVERABLES library's OPEN, and the desktop shell's fallback when the OS open fails) asks the jailed file route for
   its readable document view (?view=doc, sidecar/file-response.js). The two lists of text formats never drift. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const F = require('../sidecar/file-response.js');

const chat = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');
const dlv = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'deliverables.js'), 'utf8');

const reSrc = (/const TEXT_DOC_RE = (\/[^\n]+\/i);/.exec(chat) || [])[1];
A.ok(!!reSrc, 'chat.js names the text formats that open as documents');
const RE = eval(reSrc);   // eslint-disable-line no-eval
const readable = new Function('TEXT_DOC_RE', A.fnBody(chat, 'function readableUrl(url, filePath)') + '\nreturn readableUrl;')(RE);
A.eq(readable('/api/file?agent=copywriter&path=tagline.md&ticket=t', 'tagline.md'), '/api/file?agent=copywriter&path=tagline.md&ticket=t&view=doc', 'a markdown deliverable opens as the readable document');
A.eq(readable('/api/file?agent=a&path=x.png&ticket=t', 'x.png'), '/api/file?agent=a&path=x.png&ticket=t', 'an image keeps the plain bytes');
A.eq(readable('/api/file?agent=a&path=a.zip&ticket=t', 'a.zip'), '/api/file?agent=a&path=a.zip&ticket=t', 'a binary keeps the plain bytes');
A.eq(readable('/api/file?agent=a&path=d%2Fnotes.TXT&ticket=t&project=C%3A%2Fp', 'd/notes.TXT'), '/api/file?agent=a&path=d%2Fnotes.TXT&ticket=t&project=C%3A%2Fp&view=doc', 'a project file is read in its project, as a document');

// the two lists are ONE list: every server text format is a frontend text format and nothing else
const probe = ['.md', '.markdown', '.txt', '.text', '.csv', '.tsv', '.log', '.json', '.yaml', '.yml', '.toml', '.ini', '.cfg', '.conf', '.py', '.ts', '.tsx', '.jsx', '.css', '.scss', '.sh', '.ps1', '.bat', '.sql', '.rb', '.go', '.rs', '.java', '.kt', '.c', '.h', '.cpp', '.cs', '.php',
  '.html', '.htm', '.js', '.mjs', '.svg', '.png', '.jpg', '.mp4', '.mp3', '.pdf', '.zip', '.docx', '.xml', '.exe', ''];
const drift = probe.filter(ext => RE.test('f' + ext) !== F.isTextDocument('f' + ext));
A.eq(drift.join(','), '', 'frontend and sidecar agree on every format');

// every door asks for it
const openFile = A.fnBody(chat, 'function openFile(path, agentId, projectRoot)');
const wire = A.fnBody(chat, 'function wireFileOpen(a, title, agentId, projectRoot)');
A.ok(/readableUrl\(fileUrl\(rel, aid, root\), rel\)/.test(openFile), 'the delegation card\'s Open (Chat.openFile) opens the readable view');
A.ok((wire.match(/readableUrl\(/g) || []).length >= 3, 'a COMMS file link\'s href, its re-minted href and the desktop fallback all open the readable view');
A.ok(/readable/.test(A.fnBody(dlv, 'async function openDesktop(r, f, href, say)')) || /openHref\(f\)/.test(dlv), 'the library\'s desktop fallback opens the readable view');
A.ok(/function openHref\(f\)/.test(dlv) && /href="' \+ esc\(openHref\(f\)\)/.test(dlv), 'the library\'s OPEN link is the readable view');
A.ok(/fetch\(fileHref\(f\)/.test(dlv), 'the library\'s in-card preview still reads the plain bytes it renders itself');

A.report('file-open-readable');
