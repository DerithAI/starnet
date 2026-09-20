#!/usr/bin/env node
/**
 * verify-brief.js — self-check a repo brief against the real repository.
 *
 * Reads a markdown brief (BRIEF.md or any generated brief) plus a repo root,
 * then checks every claim the brief makes against the filesystem:
 *   - cited files/dirs exist (backticked paths, relative markdown links,
 *     and obvious plain-text file mentions like `DEP-AUDIT.md`)
 *   - every run command resolves: `npm run X` / `npm test` / `npm start`
 *     scripts exist in package.json, and their `node <file>` targets exist
 *     (resolved one level deep, including nested `npm run` chains)
 *   - no section is empty (blank or HTML-comment-only body)
 *
 * Prints a per-section PASS/FAIL drift report; with --out also writes it.
 * Exit code: 0 = brief is clean, 1 = drift found, 2 = bad arguments/input.
 *
 *   node verify-brief.js [brief.md] [repo-root] [--out report.md]
 *
 * Defaults: brief.md = ./BRIEF.md, repo-root = current directory.
 * OS-neutral: uses only Node's fs APIs — never `ls`, `find` or any shell
 * command — so it behaves identically on Windows, macOS and Linux.
 * Zero dependencies, no install.
 */
'use strict';

const fs = require('fs');
const path = require('path');

// ---- tiny filesystem helpers ----------------------------------------------

function readText(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch (e) { return null; }
}
function exists(p) {
  try { fs.statSync(p); return true; } catch (e) { return false; }
}

// ---- argument parsing ------------------------------------------------------

function parseArgs(argv) {
  const args = { brief: './BRIEF.md', root: '.', out: null, positional: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out') { args.out = argv[++i]; continue; }
    if (a === '--help' || a === '-h') { usage(); process.exit(0); }
    args.positional.push(a);
  }
  if (args.positional[0]) args.brief = args.positional[0];
  if (args.positional[1]) args.root = args.positional[1];
  return args;
}

function usage() {
  process.stdout.write(
    'verify-brief.js — check a repo brief against the real repo\n' +
    '\n' +
    '  node verify-brief.js [brief.md] [repo-root] [--out report.md]\n' +
    '\n' +
    'Checks that cited files exist, run commands resolve (npm scripts and\n' +
    'their node targets), and no section is empty. Exits 0 when clean,\n' +
    '1 when drift is found.\n'
  );
}

// ---- token classification ---------------------------------------------------

const VERSION_LIKE = /^v?\d+(\.\d+){1,4}$/;      // 1.1.0, v0.10.12
const DATE_LIKE = /^\d{4}-\d{2}-\d{2}$/;          // 2026-08-30
const SCOPED_PKG = /^@[\w-]+\/[\w.-]+$/;          // @huggingface/transformers
const ENV_LIKE = /^[A-Z][A-Z0-9_]*$/;             // PORT, SKYNET_PORT
const HAS_EXT = /\.[A-Za-z0-9]{1,5}$/;            // README.md, package.json
const BARE_NAME = /^[\w-]+$/;                     // starnet-harness, KEYS

/**
 * Classify one trimmed token (from a backtick or a command line).
 * Returns { type } in: file | npm | node | soft | skip | ignore
 *  - file:   repo-relative path to check for existence
 *  - npm:    an npm invocation (script names checked against package.json)
 *  - node:   a `node <file>` command (target file checked)
 *  - soft:   version/date-like token — checked only when it is a hard citation
 *  - skip:   env vars, URLs, package names, bare prose words — never checked
 *  - ignore: known non-repo commands (git clone, cd, curl, docker...)
 */
function classifyToken(t) {
  if (/^npm\s/.test(t)) return { type: 'npm' };
  if (/^node\s/.test(t)) return { type: 'node' };
  if (/^(git|cd|curl|wget|npx|pnpm|yarn|docker|brew|pip)\s/.test(t)) return { type: 'ignore' };
  if (ENV_LIKE.test(t)) return { type: 'skip' };
  if (/^https?:\/\//.test(t) || t.includes('://') || t.startsWith('mailto:')) return { type: 'skip' };
  if (SCOPED_PKG.test(t)) return { type: 'skip' };
  if (VERSION_LIKE.test(t) || DATE_LIKE.test(t)) return { type: 'soft' };
  if (BARE_NAME.test(t)) return { type: 'skip' };          // no dot, no slash
  if (!/^[\w./\\\-]+$/.test(t)) return { type: 'skip' };    // spaces, quotes, punct
  return { type: 'file' };
}

// ---- checks -----------------------------------------------------------------

/**
 * ctx = { section, root, pkg, seen:Set, pass(name,text), fail(name,text) }
 */

function checkTarget(raw, ctx, label) {
  let t = raw.trim().replace(/^["']|["']$/g, '').replace(/^\.\/(, '');
  if (!t || /^[\w-]+:\/\//.test(t) || SCOPED_PKG.test(t)) return;
  if (exists(path.join(ctx.root, t))) ctx.pass(ctx.section, `${label} — \`${t}\` exists`);
  else ctx.fail(ctx.section, `${label} — \`${t}\` MISSING`);
}

function checkNpmScript(name, ctx) {
  const key = 'npm:' + name;
  if (ctx.seen.has(key)) return;
  ctx.seen.add(key);
  const pkg = ctx.pkg;
  if (!pkg || !pkg.scripts) {
    ctx.fail(ctx.section, `run command \`npm run ${name}\` — package.json missing or has no scripts`);
    return;
  }
  const body = pkg.scripts[name];
  if (!body) {
    ctx.fail(ctx.section, `run command \`npm run ${name}\` — not in package.json scripts`);
    return;
  }
  ctx.pass(ctx.section, `run command \`npm run ${name}\` — script exists → \`${body}\``);
  for (const m of body.matchAll(/node\s+([^\s&|]+)/g)) {
    checkTarget(m[1], ctx, `npm run ${name} → node ${m[1]}`);
  }
  for (const m of body.matchAll(/npm\s+run\s+([\w:-]+)/g)) {
    checkNpmScript(m[1], ctx);
  }
}

function handleNpmInvocation(s, ctx) {
  s = s.trim();
  if (!/^npm\b/.test(s)) return;
  const mRun = /^npm\s+run\s+([\w:-]+)/.exec(s);
  if (mRun) { checkNpmScript(mRun[1], ctx); return; }
  const mBare = /^npm\s+(test|start|build)\b/.exec(s);
  if (mBare) { checkNpmScript(mBare[1], ctx); return; }
  // npm ci / npm install / npm i — no repo-relative target to check
}

function checkFile(cit, ctx, source, hard) {
  let t = cit.replace(/^`+|`+$/g, '').trim();
  if (!t) return;
  if (/^npm\s/.test(t)) {                            // `npm ci && npm run desktop:dev`
    for (const part of t.split('&&')) handleNpmInvocation(part.trim(), ctx);
    return;
  }
  if (/^node\s/.test(t)) {                           // `node sidecar/index.js`
    const m = /^node\s+(\S+)/.exec(t);
    if (m) checkTarget(m[1], ctx, `command \`${t}\``);
    return;
  }
  t = t.split(/\s+/)[0];                             // `dev/seed.js --keep` → dev/seed.js
  t = t.replace(/^\.\/(, '').replace(/\/+$/, '');
  if (!t) return;
  const kind = classifyToken(t);
  if (kind.type === 'skip' || kind.type === 'ignore') return;
  if (kind.type === 'soft') {
    if (exists(path.join(ctx.root, t))) ctx.pass(ctx.section, `${source} \`${t}\` — exists`);
    else if (hard) ctx.fail(ctx.section, `${source} \`${t}\` — MISSING`);
    return; // soft + missing + prose = version string, not drift
  }
  // type 'file'
  if (exists(path.join(ctx.root, t))) {
    ctx.pass(ctx.section, `${source} \`${t}\` — exists`);
    ctx.hardChecked.add(t);
    return;
  }
  // Not at repo root: try resolving relative to a dir cited earlier in the
  // same section (e.g. `app/world.js` under the `frontend/` table row).
  for (let i = ctx.sectionDirs.length - 1; i >= 0; i--) {
    const d = ctx.sectionDirs[i];
    if (exists(path.join(ctx.root, d, t))) {
      ctx.pass(ctx.section, `${source} \`${t}\` — exists (resolved via \`${d}\`)`);
      ctx.hardChecked.add(d + t);
      return;
    }
  }
  if (hard) ctx.fail(ctx.section, `${source} \`${t}\` — MISSING`);
}

// ---- brief parsing -----------------------------------------------------------

function parseSections(text) {
  const lines = text.replace(/\r\n/g, '\n').split('\n');
  const sections = [];
  let current = null;
  for (const line of lines) {
    const m = /^#{2,4}\s+(.+)$/.exec(line);
    if (m) {
      if (current) sections.push(current);
      current = { heading: m[1].trim().replace(/`/g, ''), lines: [] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) sections.push(current);
  return sections;
}

function isEmptySection(s) {
  const body = s.lines.join('\n').replace(/<!--[\s\S]*?-->/g, '').replace(/\s+/g, '');
  return body === '';
}

function extractFences(body) {
  const fences = [];
  const re = /```[^\n]*\n([\s\S]*?)```/g;
  let m;
  while ((m = re.exec(body)) !== null) fences.push(m[1]);
  return { fences, rest: body.replace(re, '') };
}

function scanFenceLines(fence, ctx) {
  for (const raw of fence.split('\n')) {
    let line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    let comment = '';
    const ci = line.indexOf(' #');
    if (ci !== -1) { comment = line.slice(ci + 2); line = line.slice(0, ci).trim(); }
    const mNode = /^node\s+(\S+)/.exec(line);
    if (mNode) checkTarget(mNode[1], ctx, `command \`${line}\``);
    const all = line + ' ' + comment;
    for (const mm of all.matchAll(/npm\s+run\s+([\w:-]+)/g)) checkNpmScript(mm[1], ctx);
    for (const mm of all.matchAll(/npm\s+(test|start|build)\b/g)) {
      const n = mm[1];
      if (!/npm\s+run/.test(all.slice(0, mm.index + n.length + 1))) checkNpmScript(n, ctx);
    }
  }
}

function scanSection(section, ctx) {
  ctx.section = section.heading;
  ctx.sectionDirs = [];
  if (isEmptySection(section)) {
    ctx.fail(section.heading, 'empty section — no content between heading and next');
    return;
  }
  const body = section.lines.join('\n');
  const { fences, rest } = extractFences(body);
  for (const f of fences) scanFenceLines(f, ctx);

  for (const m of rest.matchAll(/`([^`]+)`/g)) {
    const tok = m[1].trim();
    if (/^[\w./\\\-]+\/$/.test(tok)) ctx.sectionDirs.push(tok.replace(/\/+$/, ''));
    checkFile(tok, ctx, 'cited', true);
  }

  for (const m of rest.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
    const dest = m[1].trim();
    if (/^https?:\/\//.test(dest) || dest.startsWith('#') || dest.startsWith('mailto:')) continue;
    checkFile(dest, ctx, 'link', true);
  }

  // plain-text file mentions (no backticks): PASS if the file exists,
  // silent if it does not — prose is not a hard citation.
  for (const m of rest.matchAll(/[\w][\w./\\\-]*\.[A-Za-z0-9]{1,5}(?![\w.-])/g)) {
    const t = m[0];
    if (t.includes('://') || SCOPED_PKG.test(t) || ENV_LIKE.test(t)) continue;
    if (ctx.hardChecked.has(t)) continue;            // already checked via backticks
    const kind = classifyToken(t);
    if (kind.type === 'file' && exists(path.join(ctx.root, t.replace(/^\.\/(, '').replace(/\/+$/, '')))) {
      ctx.pass(section.heading, `cited (prose) \`${t}\` — exists`);
    }
  }
}

// ---- report -------------------------------------------------------------------

function makeReport(args, sections, rows) {
  const lines = [];
  lines.push('# Brief verification report', '');
  lines.push(`- Brief: ${path.resolve(args.brief)}`);
  lines.push(`- Repo root: ${path.resolve(args.root)}`);
  lines.push(`- Run: ${new Date().toISOString()}`, '');
  let bySection = new Map();
  for (const r of rows) {
    if (!bySection.has(r.section)) bySection.set(r.section, []);
    bySection.get(r.section).push(r);
  }
  for (const s of sections) {
    lines.push(`## ${s.heading}`, '');
    const rs = bySection.get(s.heading) || [];
    if (!rs.length) {
      lines.push('- [PASS] prose section — no citations, no commands, not empty', '');
      continue;
    }
    for (const r of rs) lines.push(`- [${r.status}] ${r.text}`);
    lines.push('');
  }
  const passed = rows.filter(r => r.status === 'PASS').length;
  const failed = rows.filter(r => r.status === 'FAIL').length;
  lines.push('## Summary', '');
  lines.push(`- ${rows.length} checks across ${sections.length} sections — ${passed} passed, ${failed} failed`);
  lines.push(failed ? `- Result: FAIL — ${failed} drift item(s) (exit 1)` : '- Result: PASS (exit 0)');
  return lines.join('\n');
}

// ---- main ----------------------------------------------------------------------

function main() {
  const args = parseArgs(process.argv.slice(2));
  const briefText = readText(args.brief);
  if (briefText === null) {
    console.error(`verify-brief: cannot read brief: ${args.brief}`);
    process.exit(2);
  }
  if (!exists(args.root) || !fs.statSync(args.root).isDirectory()) {
    console.error(`verify-brief: not a directory: ${args.root}`);
    process.exit(2);
  }
  const pkg = readText(path.join(args.root, 'package.json'));
  const sections = parseSections(briefText);
  const rows = [];
  const ctx = {
    root: args.root,
    pkg: pkg ? JSON.parse(pkg) : null,
    seen: new Set(),
    hardChecked: new Set(),
    pass(section, text) { rows.push({ section, status: 'PASS', text }); },
    fail(section, text) { rows.push({ section, status: 'FAIL', text }); }
  };
  // The preamble (everything before the first ## heading) is a section too —
  // briefs often put their "verified against: <files>" claim there.
  const preamble = (() => {
    const out = [];
    for (const l of briefText.replace(/\r\n/g, '\n').split('\n')) {
      if (/^#{2,4}\s/.test(l)) break;
      if (/^#\s/.test(l)) continue;
      out.push(l);
    }
    return out;
  })();
  const ps = { heading: 'preamble', lines: preamble };
  const allSections = preamble.join('\n').trim() ? [ps].concat(sections) : sections;
  if (preamble.join('\n').trim()) {
    scanSection(ps, ctx);
  }
  for (const s of sections) scanSection(s, ctx);
  const report = makeReport(args, allSections, rows);
  process.stdout.write(report + '\n');
  if (args.out) {
    fs.writeFileSync(args.out, report + '\n');
    console.log(`\nverify-brief: wrote ${path.resolve(args.out)}`);
  }
  process.exit(rows.some(r => r.status === 'FAIL') ? 1 : 0);
}

main();