/* node test/webkit-floor-syntax.test.js — every script the station page loads PARSES on an older Mac web engine.

   On macOS the app window is the SYSTEM WebKit, which only updates with Safari / macOS (an Intel Mac on macOS 11-13 can
   sit on Safari 15.x/16.0-16.3 WebKit for years). A classic <script> carrying syntax that engine lacks is a SyntaxError
   for the WHOLE file: its global is never defined, every other script keeps running, and each caller's
   `typeof X === 'undefined'` guard turns the loss into a quiet "not loaded" — the boot guard only counts it.

     2026-09-18 (qa/bugs/5308fc67): a regex lookbehind at app/chat.js:559 killed Chat on a customer Mac.
     2026-10-18 (#136, macOS Intel, 0.13.5): ONE lookbehind at app/workflowline.js:797 (suggestLineFor's "pressure-test is
       not QA" rule, in since 2026-09-29 / v0.13.0) killed WorkflowLine — SET UP RESEARCH STATION said "The workflow reader
       is not loaded", DIRECTOR's station.layout was REFUSED, the Workflow panel said "Unnamed line — CONNECT IT TO A LINE",
       and diagnostics said only "page errors: 1 uncaught error(s)". It was the only lookbehind left in the page.

   This is the class-wide ratchet for parse-time syntax newer than that engine (WebKit 16.4 = Safari 16.4 / macOS 13.3):
     - regex lookbehind  (?<=  (?<!          — a literal is a parse error; a `new RegExp` string throws where it runs
     - class static initialization blocks    — `static {` inside a class body
   Lexical on purpose (the repo ships no JS parser, and the gate must stay cheap): a match preceded by an odd run of
   backslashes is an escaped "(" — `\(?<=` matches a literal paren — and is not flagged; a named group `(?<name>` is
   Safari 11.1 and never matched. The one deliberate use — the boot guard's own feature probe, inside try/catch — is
   allowlisted by its exact text. Run-time APIs are NOT checked here (a missing API breaks one call, not a whole file). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const ENTRIES = ['frontend/index.html', 'frontend/agent-station-demo.html'];

/* ---- the scanner ---- */
const RULES = [
  { name: 'regex lookbehind (Safari 16.4+)', re: /\(\?<[=!]/g },
  { name: 'class static block (Safari 16.4+)', re: /\bstatic\s*\{/g }
];
// exact text of the deliberate uses: file -> [snippets]. A match inside one of these snippets is allowed.
const ALLOW = {
  'frontend/app/bootguard.js': ["try { new RegExp('(?<=a)b'); } catch (_) { return true; }"]   // the outdated-engine probe
};
function escapedAt(src, i) { let n = 0; while (i - n - 1 >= 0 && src[i - n - 1] === '\\') n++; return n % 2 === 1; }
function allowedAt(src, i, snippets) {
  return (snippets || []).some(s => { const at = src.lastIndexOf(s, i); return at >= 0 && i < at + s.length; });
}
function scan(src, file) {
  const hits = [];
  for (const r of RULES) {
    r.re.lastIndex = 0;
    let m;
    while ((m = r.re.exec(src))) {
      if (escapedAt(src, m.index) || allowedAt(src, m.index, ALLOW[file])) continue;
      const line = src.slice(0, m.index).split('\n').length;
      hits.push(file + ':' + line + ' — ' + r.name + ': ' + src.split('\n')[line - 1].trim().slice(0, 120));
    }
  }
  return hits;
}

/* ---- 0. the scanner itself: it catches the reported construct and nothing it should not ---- */
A.eq(scan("const re = /(?<!pressure.?)\\btest\\b/i;", 'x.js').length, 1, 'a lookbehind regex literal is flagged');
A.eq(scan("new RegExp('(?<=a)b')", 'x.js').length, 1, 'a lookbehind in a RegExp string is flagged (it throws where it runs)');
A.eq(scan('class K { static { init(); } }', 'x.js').length, 1, 'a class static block is flagged');
A.eq(scan('const re = /\\(?<=/;', 'x.js').length, 0, 'an escaped paren `\\(?<=` is a literal "(", not a lookbehind');
A.eq(scan('const re = /(?<year>\\d{4})/;', 'x.js').length, 0, 'a named capture group is not a lookbehind');
A.eq(scan('const statics = { a: 1 }; x.static = 2;', 'x.js').length, 0, 'the word "static" alone is not a static block');

/* ---- 1. every script the station page (and the website demo) loads ---- */
const files = new Set();
for (const entry of ENTRIES) {
  const html = fs.readFileSync(path.join(ROOT, entry), 'utf8');
  for (const m of html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g)) {
    const src = m[1].replace(/[?#].*$/, '');
    if (/^[a-z]+:\/\//i.test(src)) continue;   // never a remote script (none today)
    files.add(src.startsWith('/') ? src.replace(/^\/+/, '') : path.posix.join(path.posix.dirname(entry), src));
  }
}
A.ok(files.size > 200, 'the page loads its full module set (' + files.size + ' scripts)');
A.ok(files.has('frontend/app/workflowline.js') && files.has('frontend/app/chat.js') && files.has('shared/specialties.js'), 'the reported modules are in the scanned set');

const hits = [];
for (const f of files) {
  const abs = path.join(ROOT, f);
  if (!fs.existsSync(abs)) { A.ok(false, 'a page script exists on disk: ' + f); continue; }
  hits.push(...scan(fs.readFileSync(abs, 'utf8'), f));
}
A.eq(hits, [], 'no page script uses syntax an older Mac WebKit cannot parse (one such line drops its whole module)');

/* ---- 2. the allowlisted probe is still the only use, and still guarded ---- */
const bg = fs.readFileSync(path.join(ROOT, 'frontend/app/bootguard.js'), 'utf8');
A.ok(bg.includes(ALLOW['frontend/app/bootguard.js'][0]), 'the boot guard probe is the exact allowlisted try/catch (a moved probe must be re-reviewed)');

A.report();
