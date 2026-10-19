/* node test/bundle-source-integrity.test.js — a desktop package must never ship an empty or missing engine module.

   Customer report 85f602c4 (Windows 0.13.2): the local engine would not start, quoting
   "Cannot find module './tools/builtin/shell.js'" with the installed shell.js at zero bytes. The public installer's
   shell.js was inspected and is whole, so this guard does not claim to explain that install. What it closes is the
   build-side door: every bundle path (npm run desktop:build, desktop:dev and both CI workflows) copies sidecar/ and
   shared/ straight from the working tree, and nothing checked that tree. A torn or zero-byte module in the checkout
   a package is built from would ship as-is. The staging step now refuses to stage when an engine/frontend code file
   is empty, or when a file git tracks with content is missing or empty on disk. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('./_assert.js');

const ROOT = path.join(__dirname, '..');

(async () => {
  const mod = await import(require('node:url').pathToFileURL(path.join(ROOT, 'scripts', 'lib', 'bundle-source-integrity.mjs')).href);
  const { checkBundleSources, assertBundleSources } = mod;

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'bundle-integrity-'));
  const put = (rel, text) => { const f = path.join(tmp, rel); fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, text); };
  try {
    put('sidecar/index.js', 'require("./tools/builtin/shell.js");\n');
    put('sidecar/tools/builtin/shell.js', 'module.exports = {};\n');
    put('shared/events.js', 'module.exports = {};\n');
    put('frontend/app/app.js', 'window.App = {};\n');
    put('frontend/index.html', '<!doctype html>\n');
    put('frontend/assets/blank.png', '');   // an empty MEDIA file is not code: never a reason to refuse a build

    const clean = checkBundleSources({ root: tmp, tracked: null });
    A.eq(clean.problems, [], 'a whole tree stages');

    // the customer's shape: shell.js present but zero bytes
    put('sidecar/tools/builtin/shell.js', '');
    const empty = checkBundleSources({ root: tmp, tracked: null });
    A.eq(empty.problems.map(p => p.path), ['sidecar/tools/builtin/shell.js'], 'an empty engine module is refused by name');
    A.ok(/empty/.test(empty.problems[0].reason), 'the reason says it is empty: ' + empty.problems[0].reason);
    let threw = null;
    try { assertBundleSources({ root: tmp, tracked: null }); } catch (e) { threw = e; }
    A.ok(threw && /sidecar\/tools\/builtin\/shell\.js/.test(threw.message) && /refusing to stage/i.test(threw.message),
      'the build stops before packaging and names the file: ' + (threw && threw.message));

    // an empty shared contract or frontend script is the same failure
    put('sidecar/tools/builtin/shell.js', 'module.exports = {};\n');
    put('shared/schema.js', '');
    put('frontend/app/chat.js', '');
    A.eq(checkBundleSources({ root: tmp, tracked: null }).problems.map(p => p.path).sort(), ['frontend/app/chat.js', 'shared/schema.js'], 'shared/ and frontend code are checked too');
    put('shared/schema.js', 'module.exports = {};\n');
    put('frontend/app/chat.js', 'window.Chat = {};\n');

    // git-tracked content that is missing (or empty) on disk is refused even when it is not a .js file
    const tracked = [
      { path: 'sidecar/index.js', size: 40 },
      { path: 'sidecar/tools/builtin/shell.js', size: 21 },
      { path: 'sidecar/skills/catalog.json', size: 300 },
      { path: 'frontend/assets/blank.png', size: 0 },     // tracked empty stays allowed
      { path: 'docs/notes.md', size: 10 }                  // outside the bundled trees: not this guard's business
    ];
    const missing = checkBundleSources({ root: tmp, tracked });
    A.eq(missing.problems.map(p => p.path), ['sidecar/skills/catalog.json'], 'a tracked bundled file missing on disk is refused');
    A.ok(/missing/.test(missing.problems[0].reason), missing.problems[0].reason);
    put('sidecar/skills/catalog.json', '');
    A.eq(checkBundleSources({ root: tmp, tracked }).problems.map(p => p.path), ['sidecar/skills/catalog.json'], 'a tracked file emptied on disk is refused');
    put('sidecar/skills/catalog.json', '{}\n');
    A.eq(checkBundleSources({ root: tmp, tracked }).problems, [], 'restored: stages again');

    // no git (a source tarball build): the structural rule still runs, and the receipt says git was not consulted
    const nogit = checkBundleSources({ root: tmp, tracked: null });
    A.eq(nogit.gitChecked, false, 'the receipt never claims a git comparison it did not make');
    A.eq(checkBundleSources({ root: tmp, tracked }).gitChecked, true);
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }

  // WIRING: every bundle path runs stage-frontend-dist, and staging runs the guard first
  const stageSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'stage-frontend-dist.mjs'), 'utf8');
  A.ok(/assertBundleSources\(/.test(stageSrc), 'stage-frontend-dist calls the guard');
  A.ok(stageSrc.indexOf('assertBundleSources(') < stageSrc.lastIndexOf('stage();'), 'the guard runs before anything is staged');
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  for (const script of ['desktop:build', 'desktop:dev']) A.ok(/stage-frontend-dist\.mjs/.test(pkg.scripts[script]), script + ' stages through the guarded script');
  for (const wf of ['desktop-build.yml', 'release-train.yml']) {
    A.ok(/node scripts\/stage-frontend-dist\.mjs/.test(fs.readFileSync(path.join(ROOT, '.github', 'workflows', wf), 'utf8')), wf + ' stages through the guarded script');
  }

  // the real checkout this test runs in is whole
  const real = checkBundleSources({ root: ROOT });
  A.eq(real.problems, [], 'this checkout has no empty or missing bundled module');

  A.report('bundle-source-integrity');
})().catch(e => { console.error(e); process.exit(1); });
