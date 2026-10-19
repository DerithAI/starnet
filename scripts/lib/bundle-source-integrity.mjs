/* scripts/lib/bundle-source-integrity.mjs — refuse to package an engine or frontend that is missing code.

   The desktop bundle copies sidecar/ and shared/ straight out of the working tree (src-tauri/tauri.conf.json
   `resources`), and the frontend through stage-frontend-dist.mjs. Nothing checked those trees before packaging,
   so a torn write, an interrupted checkout or a tool that truncated a file would ship a zero-byte module that only
   fails when an installed engine first requires it (customer report 85f602c4: "Cannot find module
   './tools/builtin/shell.js'" with a zero-byte shell.js; the public installer itself was inspected and is whole).

   Two rules, both structural:
     1. no CODE file (.js .cjs .mjs .json .html .css) under the bundled trees is zero bytes — none ever is on purpose;
     2. when git is available, every file git tracks WITH CONTENT under those trees exists on disk and is not empty.
   It never rewrites or restores anything: it names the files and the build stops. */
import { execFileSync } from 'node:child_process';
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

export const BUNDLED_TREES = Object.freeze(['sidecar', 'shared', 'frontend']);
const CODE = /\.(?:c?js|mjs|json|html?|css)$/i;
// generated/vendor folders inside a bundled tree that are not part of the shipped source
const SKIP_DIRS = new Set(['node_modules', '.git']);

function walk(root, rel, onFile) {
  let names;
  try { names = readdirSync(join(root, rel)); }
  catch (e) { if (e && e.code === 'ENOENT') return; throw e; }
  for (const name of names) {
    if (SKIP_DIRS.has(name)) continue;
    const r = rel ? rel + '/' + name : name;
    const st = statSync(join(root, r));
    if (st.isDirectory()) walk(root, r, onFile);
    else if (st.isFile()) onFile(r, st.size);
  }
}

/* Files git tracks under the bundled trees with their HEAD blob sizes, or null when git cannot answer
   (a source archive with no .git): the structural rule still runs and the receipt says git was not consulted. */
export function trackedBlobs(root) {
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '-l', '-z', 'HEAD', '--', ...BUNDLED_TREES], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, stdio: ['ignore', 'pipe', 'ignore'] });
    const rows = [];
    for (const rec of out.split('\0')) {
      const m = /^\d+ blob [0-9a-f]+\s+(\d+)\t(.+)$/.exec(rec);
      if (m) rows.push({ path: m[2], size: Number(m[1]) });
    }
    return rows;
  } catch (e) {
    console.warn('[bundle-integrity] git could not list tracked files (' + ((e && e.code) || (e && e.message) || e) + '); checking empty code files only');
    return null;
  }
}

export function checkBundleSources({ root, tracked } = {}) {
  if (!root) throw new Error('checkBundleSources needs a root');
  if (tracked === undefined) tracked = trackedBlobs(root);
  const problems = [];
  const seen = new Set();
  for (const tree of BUNDLED_TREES) {
    walk(root, tree, (rel, size) => {
      if (size === 0 && CODE.test(rel)) { problems.push({ path: rel, reason: 'empty (0 bytes)' }); seen.add(rel); }
    });
  }
  if (Array.isArray(tracked)) {
    for (const t of tracked) {
      const rel = String(t && t.path || '').split('\\').join('/');
      if (!rel || !(Number(t.size) > 0) || seen.has(rel)) continue;
      if (!BUNDLED_TREES.some(tree => rel === tree || rel.startsWith(tree + '/'))) continue;
      let st = null;
      try { st = statSync(join(root, rel)); }
      catch (e) { if (!e || e.code !== 'ENOENT') throw e; }
      if (!st || !st.isFile()) problems.push({ path: rel, reason: 'missing (git tracks ' + t.size + ' bytes)' });
      else if (st.size === 0) problems.push({ path: rel, reason: 'empty (0 bytes; git tracks ' + t.size + ')' });
    }
  }
  return { problems, gitChecked: Array.isArray(tracked) };
}

export function assertBundleSources(opts) {
  const r = checkBundleSources(opts);
  if (r.problems.length) {
    const list = r.problems.slice(0, 20).map(p => '  - ' + p.path + ': ' + p.reason).join('\n');
    throw new Error('refusing to stage the desktop bundle: ' + r.problems.length + ' engine/frontend file(s) are empty or missing\n' + list
      + (r.problems.length > 20 ? '\n  - …' : '') + '\nRestore them (git checkout -- <path>) and build again; a package built from this tree would fail to start.');
  }
  return r;
}
