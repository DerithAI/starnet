/* node test/fs.search-budget.test.js — fs.search's walk is budgeted, stoppable and cheap (2026-10-20).

   The pure-JS walker awaited one fsp.stat per file, in sequence, while it built the list (2.7-9.7 s for 6,000
   files, against 21-67 ms for the readdir-only walk), and the 8 s budget timer was armed only AFTER the walk
   returned, so a 20k-file tree reached the 20 s tool timeout. Nothing but the rg path checked ctx.signal: a
   search with an ALREADY-aborted signal still ran ~15 s and answered "(no matches)" — a false negative, since
   the text existed. Every assertion here COUNTS calls through an fsp proxy (no timing assertions), with
   rg:false so the guaranteed walker path is the one under test. */
'use strict';
const A = require('./_assert.js');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const { makeFsTools } = require('../sidecar/tools/builtin/fs.js');

const ROOT = path.join(os.tmpdir(), 'starnet-fs-search-budget-' + process.pid);
const WS = path.join(ROOT, 'ag');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// fsp with per-method call counters (and an optional per-call delay), every call still real
function counted(opts) {
  opts = opts || {};
  const calls = { readFile: [], stat: [], readdir: [] };
  const proxy = new Proxy(fsp, { get(target, prop) {
    if (prop === 'readFile' || prop === 'stat' || prop === 'readdir') {
      return async (...args) => {
        calls[prop].push(String(args[0]));
        if (opts.delay && opts.delay[prop]) await sleep(opts.delay[prop]);
        return target[prop](...args);
      };
    }
    return target[prop];
  } });
  return { fsp: proxy, calls };
}
const tools = (c, limits) => makeFsTools({ fsp: c.fsp, pathMod: path, root: ROOT, rg: false, limits });
async function rejection(p) { try { await p; return null; } catch (e) { return e; } }

(async () => {
  await fsp.rm(ROOT, { recursive: true, force: true });
  await fsp.mkdir(WS, { recursive: true });

  // ---- tree A: 200 files in 10 dirs, the needle in the LAST one ----
  for (let d = 0; d < 10; d++) {
    await fsp.mkdir(path.join(WS, 'a', 'd' + d), { recursive: true });
    for (let f = 0; f < 20; f++) await fsp.writeFile(path.join(WS, 'a', 'd' + d, 'f' + f + '.txt'), 'hello ' + d + ' ' + f + '\n');
  }

  // ---- 1. an already-aborted signal: AbortError, and not one file is read ----
  {
    const c = counted();
    const ac = new AbortController(); ac.abort();
    const e = await rejection(tools(c).searchTool.run({ query: 'hello 9 19', path: 'a' }, { agentId: 'ag', signal: ac.signal }));
    A.ok(e && e.name === 'AbortError', 'a search whose run was already cancelled rejects with AbortError (trunk walked, scanned and answered)' + (e ? '' : ' (it resolved)'));
    A.eq(c.calls.readFile.filter((p) => /\.txt$/.test(p)).length, 0, 'no file content is read for a cancelled search');
  }

  // ---- 2. abort DURING the scan: it stops reading ----
  {
    const ac = new AbortController();
    const c = counted({ delay: { readFile: 5 } });
    const pending = rejection(tools(c).searchTool.run({ query: 'hello 9 19', path: 'a' }, { agentId: 'ag', signal: ac.signal }));
    while (c.calls.readFile.filter((p) => /\.txt$/.test(p)).length < 20) await sleep(5);
    ac.abort();
    const e = await pending;
    const readsAtAbort = c.calls.readFile.filter((p) => /\.txt$/.test(p)).length;
    await sleep(50);
    A.ok(e && e.name === 'AbortError', 'a search cancelled mid-scan rejects with AbortError');
    A.ok(readsAtAbort < 200 && c.calls.readFile.filter((p) => /\.txt$/.test(p)).length === readsAtAbort, 'and launches no further reads (' + readsAtAbort + ' of 200 read)');
  }

  // ---- 3. the budget covers the WALK: a slow tree stops at the budget and says so ----
  {
    for (let d = 0; d < 30; d++) {
      await fsp.mkdir(path.join(WS, 'slow', 'd' + String(d).padStart(2, '0')), { recursive: true });
      await fsp.writeFile(path.join(WS, 'slow', 'd' + String(d).padStart(2, '0'), 'x.txt'), 'needle-' + d + '\n');
    }
    const c = counted({ delay: { readdir: 40 } });
    const r = await tools(c, { searchBudgetMs: 100 }).searchTool.run({ query: 'needle-29', path: 'slow' }, { agentId: 'ag' });
    const walked = c.calls.readdir.length;
    A.ok(/\[search stopped at the 0s budget — these are the matches found so far; narrow with file_glob or a more specific query\]/.test(r.content), 'a walk cut by the budget answers with the budget note, never a bare "(no matches)": ' + JSON.stringify(r.content.slice(0, 120)));
    A.ok(walked < 31, 'the walk stopped at the budget (' + walked + ' of 31 directories listed; trunk lists all of them before it even arms the timer)');
  }

  // ---- 4. a plain file costs no stat in the walk: a *.md glob over 300 .txt files stats only what it reads ----
  {
    await fsp.mkdir(path.join(WS, 'many'), { recursive: true });
    for (let f = 0; f < 300; f++) await fsp.writeFile(path.join(WS, 'many', 'n' + String(f).padStart(3, '0') + '.txt'), 'nothing\n');
    await fsp.writeFile(path.join(WS, 'many', 'readme.md'), 'the one doc\n');
    const c = counted();
    const r = await tools(c).searchTool.run({ query: 'one doc', path: 'many', file_glob: '*.md' }, { agentId: 'ag' });
    A.eq(r.content, 'many/readme.md:1: the one doc', 'the glob-filtered search finds the doc');
    A.ok(c.calls.stat.length <= 3, 'stat calls: ' + c.calls.stat.length + ' (trunk: one per file, 301+)');
    const c2 = counted();
    const f = await tools(c2).searchTool.run({ query: '*.md', target: 'files', path: 'many' }, { agentId: 'ag' });
    A.eq(f.content, 'many/readme.md', 'target:"files" finds the one hit');
    A.ok(c2.calls.stat.length <= 3, 'target:"files" stats only the glob hits: ' + c2.calls.stat.length + ' stat calls (trunk 301+)');
  }

  // ---- 5. results are unchanged: path order, context, counts, newest-first files, oversized files named ----
  {
    await fsp.mkdir(path.join(WS, 'same', 'b'), { recursive: true });
    await fsp.writeFile(path.join(WS, 'same', 'b', 'two.txt'), 'x\nalpha 2\ny\n');
    await fsp.writeFile(path.join(WS, 'same', 'a.txt'), 'alpha 1\nzzz\n');
    await fsp.writeFile(path.join(WS, 'same', 'c.txt'), 'no\n');
    const old = new Date(Date.now() - 3600000);
    await fsp.utimes(path.join(WS, 'same', 'a.txt'), old, old);
    const t = tools(counted());
    A.eq((await t.searchTool.run({ query: 'alpha', path: 'same' }, { agentId: 'ag' })).content, 'same/a.txt:1: alpha 1\nsame/b/two.txt:2: alpha 2', 'content hits in path order');
    A.eq((await t.searchTool.run({ query: 'alpha', path: 'same', output_mode: 'count' }, { agentId: 'ag' })).content, 'same/a.txt: 1\nsame/b/two.txt: 1', 'count mode');
    A.eq((await t.searchTool.run({ query: 'alpha', path: 'same', context: 1 }, { agentId: 'ag' })).content, 'same/a.txt\n  1: alpha 1\n  2- zzz\nsame/b/two.txt\n  1- x\n  2: alpha 2\n  3- y', 'context rows');
    A.eq((await t.searchTool.run({ query: '*.txt', target: 'files', path: 'same' }, { agentId: 'ag' })).content.split('\n').pop(), 'same/a.txt', 'target:"files" is still newest first (the old file sorts last)');
    await fsp.writeFile(path.join(WS, 'same', 'big.txt'), Buffer.alloc(8 * 1024 * 1024 + 10, 0x61));
    const big = await t.searchTool.run({ query: 'never-there', path: 'same' }, { agentId: 'ag' });
    A.ok(/\[NOT searched — over the 8 MB per-file search limit: same\/big\.txt\. Name one as "path" to search it \(up to 64 MB\)\.\]/.test(big.content), 'an oversized file is still named, now from the scan-time stat');
  }

  await fsp.rm(ROOT, { recursive: true, force: true });
  A.report('fs.search-budget.test');
})().catch(async (e) => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) { /* best-effort temp cleanup */ }
  console.log('FAIL: fs.search-budget.test threw -- ' + (e && e.stack || e));
  process.exit(1);
});
