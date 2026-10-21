/* node test/fs.concurrent-mutations.test.js — TWO RUNS, ONE FILE: no edit is ever lost (2026-10-20).

   makeFsTools is built PER RUN, and team.dispatch runs its workers with Promise.all. Every fs mutation was
   read -> await the LSP baseline -> writeFile of a whole file composed from that read, so two runs editing one
   project file interleaved and the later writer erased the other's change. Both receipts still said
   read-back-verified (each read back its OWN bytes), so the lead told the Commander the work was done. Reproduced
   20/20 with a slow baseline, 5/5 without one; concurrent fs.append lost a line 9-10 runs out of 10.

   Real temp dirs, real fs, two real makeFsTools instances sharing one project (the shape index.js builds for a
   lead and its worker). The LSP stub only controls WHEN the baseline answers. */
'use strict';
const A = require('./_assert.js');
const fsp = require('fs/promises');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { makeFsTools } = require('../sidecar/tools/builtin/fs.js');

const ROOT = path.join(os.tmpdir(), 'starnet-fs-concurrent-' + process.pid);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const LSP_OK = { status: 'available', added: [], removed: [], addedCount: 0, removedCount: 0 };

// one "run": its own makeFsTools instance, an LSP stub whose baseline waits `beginEdit` (ms or a function)
function run(proj, beginEdit) {
  const pathTrust = async (abs) => ({ base: proj, abs });
  const editDiagnostics = beginEdit == null ? undefined : {
    beginEdit: async () => { if (typeof beginEdit === 'function') await beginEdit(); else await sleep(beginEdit); return { items: [] }; },
    finishEdit: async () => LSP_OK
  };
  return makeFsTools({ fsp, pathMod: path, root: ROOT, pathTrust, editDiagnostics });
}
// a baseline that parks until the test releases it, and says when it has been reached
function heldBaseline() {
  let reach, release;
  const reached = new Promise((r) => { reach = r; });
  const released = new Promise((r) => { release = r; });
  return { reached, release, wait: async () => { reach(); await released; } };
}
async function rejection(p) {
  try { await p; return null; } catch (e) { return e; }
}

(async () => {
  await fsp.mkdir(ROOT, { recursive: true });
  let n = 0;
  async function project(files) {
    const proj = path.join(ROOT, 'proj' + (n++));
    await fsp.mkdir(proj, { recursive: true });
    for (const [rel, text] of Object.entries(files)) await fsp.writeFile(path.join(proj, rel), text);
    return proj;
  }

  // ---- 1. two runs, concurrent fs.edit on different lines, a fast and a slow language server ----
  {
    let bothKept = 0, bothVerified = 0, driftNamed = 0;
    for (let i = 0; i < 10; i++) {
      const proj = await project({ 'a.js': 'const A = 1;\nconst B = 2;\n' });
      const lead = run(proj, 5), worker = run(proj, 60);
      const c1 = { agentId: 'lead', projectRoot: proj }, c2 = { agentId: 'worker', projectRoot: proj };
      await lead.readTool.run({ path: 'a.js' }, c1);
      await worker.readTool.run({ path: 'a.js' }, c2);
      const [x, y] = await Promise.allSettled([
        lead.editTool.run({ path: 'a.js', find: 'const A = 1;', replace: 'const A = 100;' }, c1),
        worker.editTool.run({ path: 'a.js', find: 'const B = 2;', replace: 'const B = 200;' }, c2)]);
      const final = await fsp.readFile(path.join(proj, 'a.js'), 'utf8');
      if (final === 'const A = 100;\nconst B = 200;\n') bothKept++;
      if (x.status === 'fulfilled' && y.status === 'fulfilled' && x.value.mutationReceipt.state === 'read-back-verified'
        && y.value.mutationReceipt.state === 'read-back-verified') bothVerified++;
      if (y.status === 'fulfilled' && /\[LSP unavailable: the file changed on disk while this edit was in flight/.test(y.value.content)) driftNamed++;
    }
    A.eq(bothKept, 10, 'concurrent fs.edit from two runs keeps BOTH edits every time (trunk lost one 20/20)');
    A.eq(bothVerified, 10, 'both receipts are read-back-verified, and now that is true of the file on disk');
    A.eq(driftNamed, 10, "the edit that landed on the other run's bytes says its LSP before/after comparison is unavailable, never 'no new diagnostics'");
  }

  // ---- 2. concurrent fs.append with no language server: no line is lost ----
  {
    let bothLines = 0;
    for (let i = 0; i < 10; i++) {
      const proj = await project({ 'log.md': '# log\n' });
      const a = run(proj), b = run(proj);
      const ctx = { agentId: 'ag', projectRoot: proj };
      const rs = await Promise.allSettled([
        a.appendTool.run({ path: 'log.md', content: 'worker A line\n' }, ctx),
        b.appendTool.run({ path: 'log.md', content: 'worker B line\n' }, ctx)]);
      const final = await fsp.readFile(path.join(proj, 'log.md'), 'utf8');
      if (rs.every((r) => r.status === 'fulfilled') && /worker A line\n/.test(final) && /worker B line\n/.test(final) && final.length === '# log\n'.length + 28) bothLines++;
    }
    A.eq(bothLines, 10, 'concurrent fs.append from two runs keeps both lines every time (trunk lost one 9-10/10)');
  }

  // ---- 3. fs.write over a file this run READ refuses when another run wrote it during the baseline ----
  {
    const proj = await project({ 'c.js': 'v1\n' });
    const held = heldBaseline();
    const a = run(proj, held.wait), b = run(proj);
    const ca = { agentId: 'lead', projectRoot: proj }, cb = { agentId: 'worker', projectRoot: proj };
    await a.readTool.run({ path: 'c.js' }, ca);
    await b.readTool.run({ path: 'c.js' }, cb);
    const pending = rejection(a.writeTool.run({ path: 'c.js', content: 'A rewrite from a stale read\n' }, ca));
    await held.reached;
    await b.editTool.run({ path: 'c.js', find: 'v1', replace: 'B edit' }, cb);
    held.release();
    const e = await pending;
    A.ok(e && /^stale write refused: c\.js changed on disk after you read it/.test(e.message), 'the stale whole-file write is refused with the existing stale-write error' + (e ? '' : ' (it was NOT refused)'));
    A.eq(e && e.precondition, { code: 'fresh_read_required', requiredTool: 'fs.read', requiredState: 'current_file_observed' }, 'same machine-readable precondition as the stale-write guard');
    A.eq(await fsp.readFile(path.join(proj, 'c.js'), 'utf8'), 'B edit\n', "the other run's edit survived");
    await a.readTool.run({ path: 'c.js' }, ca);
    const again = await a.writeTool.run({ path: 'c.js', content: 'merged\n' }, ca);
    A.ok(/^Wrote c\.js \(7 bytes\)\.\n\[mutation receipt: read-back-verified;/.test(again.content), 'one refusal per drift: the re-read re-arms it and the write lands');
  }

  // ---- 3b. fs.write arriving while another run is INSIDE its locked write: the stamp check waits for it ----
  {
    const proj = await project({ 'c.js': 'v1\n' });
    const old = new Date(Date.now() - 60000); await fsp.utimes(path.join(proj, 'c.js'), old, old);
    const slowFsp = new Proxy(fsp, { get(tg, p) {   // run B's disk: its writeFile takes 50 ms to land
      if (p === 'writeFile') return async (...a) => { await sleep(50); return tg.writeFile(...a); };
      return tg[p];
    } });
    const pathTrust = async (abs) => ({ base: proj, abs });
    const a = run(proj), b = makeFsTools({ fsp: slowFsp, pathMod: path, root: ROOT, pathTrust });
    const ca = { agentId: 'lead', projectRoot: proj }, cb = { agentId: 'worker', projectRoot: proj };
    await a.readTool.run({ path: 'c.js' }, ca);
    await b.readTool.run({ path: 'c.js' }, cb);
    const pb = b.editTool.run({ path: 'c.js', find: 'v1', replace: 'B edit' }, cb);
    await sleep(15);                                  // B holds the lock, its bytes not landed yet
    const ea = await rejection(a.writeTool.run({ path: 'c.js', content: 'A rewrite composed from v1\n' }, ca));
    const rb = await pb;
    A.eq(rb.mutationReceipt.state, 'read-back-verified', "the other run's edit is verified");
    A.ok(ea && /^stale write refused: c\.js changed on disk after you read it/.test(ea.message), 'the whole-file write composed from the older read is refused' + (ea ? '' : ' (it was NOT refused: it overwrote the edit)'));
    A.eq(await fsp.readFile(path.join(proj, 'c.js'), 'utf8'), 'B edit\n', "and the other run's verified edit survived");
  }

  // ---- 4. fs.patch whose source moved during the baseline refuses before writing anything ----
  {
    const proj = await project({ 'p.txt': 'alpha\nbeta\n' });
    const held = heldBaseline();
    const a = run(proj, held.wait), b = run(proj);
    const ca = { agentId: 'lead', projectRoot: proj }, cb = { agentId: 'worker', projectRoot: proj };
    await b.readTool.run({ path: 'p.txt' }, cb);
    const patch = '*** Begin Patch\n*** Update File: p.txt\n@@\n-alpha\n+ALPHA\n beta\n*** End Patch';
    const pending = rejection(a.patchTool.run({ patch }, ca));
    await held.reached;
    await b.editTool.run({ path: 'p.txt', find: 'beta', replace: 'BETA (worker)' }, cb);
    held.release();
    const e = await pending;
    A.ok(e && /^fs\.patch refused: p\.txt changed on disk while this patch was being prepared \(another agent or process wrote it\) — nothing was written\./.test(e.message), 'a patch built from a moved file refuses' + (e ? '' : ' (it was NOT refused)'));
    A.eq(await fsp.readFile(path.join(proj, 'p.txt'), 'utf8'), 'alpha\nBETA (worker)\n', "the file is exactly the other run's version");
  }

  // ---- 5. an edit whose "find" the other run removed refuses honestly instead of resurrecting the old text ----
  {
    const proj = await project({ 'r.js': 'let x = 1;\n' });
    const held = heldBaseline();
    const a = run(proj, held.wait), b = run(proj);
    const ca = { agentId: 'lead', projectRoot: proj }, cb = { agentId: 'worker', projectRoot: proj };
    await a.readTool.run({ path: 'r.js' }, ca);
    await b.readTool.run({ path: 'r.js' }, cb);
    const pending = rejection(a.editTool.run({ path: 'r.js', find: 'let x = 1;', replace: 'let x = 2;' }, ca));
    await held.reached;
    await b.writeTool.run({ path: 'r.js', content: 'const y = 3;\n' }, cb);
    held.release();
    const e = await pending;
    A.ok(e && /^"find" text not found in r\.js/.test(e.message), 'the drifted edit re-plans on the current bytes and refuses with the ordinary not-found error');
    A.eq(await fsp.readFile(path.join(proj, 'r.js'), 'utf8'), 'const y = 3;\n', "the other run's write survived");
  }

  // ---- 6. abort while queued behind another writer: AbortError, file untouched, the lock is not left stuck ----
  {
    const proj = await project({ 'q.js': 'one\n' });
    const t = run(proj);
    const ctx0 = { agentId: 'ag', projectRoot: proj };
    await t.readTool.run({ path: 'q.js' }, ctx0);
    const { withFileLocks, lockKey } = t._internals;
    let releaseHold;
    const hold = withFileLocks([lockKey(path.join(proj, 'q.js'))], null, () => new Promise((r) => { releaseHold = r; }));
    const ac = new AbortController();
    const pending = rejection(t.editTool.run({ path: 'q.js', find: 'one', replace: 'two' }, Object.assign({ signal: ac.signal }, ctx0)));
    await sleep(30);
    ac.abort();
    const e = await pending;
    A.ok(e && e.name === 'AbortError', 'an edit cancelled while it waits for the file rejects with AbortError' + (e ? ' (got ' + e.name + ': ' + e.message + ')' : ' (it resolved)'));
    releaseHold();
    await hold;
    await sleep(10);
    A.eq(await fsp.readFile(path.join(proj, 'q.js'), 'utf8'), 'one\n', 'the cancelled edit never wrote, not even after the holder let go');
    const ok = await t.editTool.run({ path: 'q.js', find: 'one', replace: 'three' }, ctx0);
    A.ok(/^Edited q\.js \(1 replacement\)/.test(ok.content), 'the next writer gets the file: an aborted waiter leaves no stuck lock');
  }

  // ---- 6b. a waiter aborted while queued must NOT open the lock: a third writer still waits for the holder ----
  {
    // the primitive: H holds, W queues and aborts, N arrives while H is still inside
    const t0 = run(await project({}));
    const { withFileLocks } = t0._internals;
    let inside = 0, maxInside = 0, releaseH;
    const enter = async (wait) => { inside++; maxInside = Math.max(maxInside, inside); await wait(); inside--; };
    const h = withFileLocks(['k6b'], null, () => enter(() => new Promise((r) => { releaseH = r; })));
    await sleep(5);
    const ac = new AbortController();
    const w = rejection(withFileLocks(['k6b'], ac.signal, () => enter(() => sleep(1))));
    await sleep(5); ac.abort();
    const we = await w;
    const nn = withFileLocks(['k6b'], null, () => enter(() => sleep(1)));
    await sleep(20);
    const overlapped = maxInside;
    releaseH(); await h; await nn;
    A.ok(we && we.name === 'AbortError', 'the queued waiter rejects with AbortError');
    A.eq(overlapped, 1, 'a newcomer after an aborted waiter waits for the live holder (it once ran beside it: 2 inside at once)');

    // end to end: run A's slow writeFile holds the lock, run W's append is cancelled while queued, run N appends
    const proj = await project({ 'log.txt': 'start\n' });
    let slowNext = false;
    const slowFsp = new Proxy(fsp, { get(tg, p) {
      if (p === 'writeFile') return async (...a) => { if (slowNext) { slowNext = false; await sleep(150); } return tg.writeFile(...a); };
      return tg[p];
    } });
    const pathTrust = async (abs) => ({ base: proj, abs });
    const A_ = makeFsTools({ fsp: slowFsp, pathMod: path, root: ROOT, pathTrust }), W_ = run(proj), N_ = run(proj);
    const ctx = { agentId: 'ag', projectRoot: proj };
    slowNext = true;
    const pa = A_.appendTool.run({ path: 'log.txt', content: 'A\n' }, ctx);
    await sleep(30);                                      // A is inside its locked, slow writeFile
    const ac2 = new AbortController();
    const pw = rejection(W_.appendTool.run({ path: 'log.txt', content: 'W\n' }, Object.assign({ signal: ac2.signal }, ctx)));
    await sleep(10); ac2.abort();
    const ew = await pw;
    const pn = N_.appendTool.run({ path: 'log.txt', content: 'N\n' }, ctx);
    const [ra, rn] = await Promise.all([pa, pn]);
    A.ok(ew && ew.name === 'AbortError', 'the cancelled append rejects with AbortError');
    A.eq([ra.mutationReceipt.state, rn.mutationReceipt.state], ['read-back-verified', 'read-back-verified'], 'both landed appends are verified');
    A.eq(await fsp.readFile(path.join(proj, 'log.txt'), 'utf8'), 'start\nA\nN\n', "the third writer's line survives (it was lost: \"start\\nA\\n\")");
  }

  // ---- 7. a multi-file patch racing one-file edits on both of its files: no deadlock, nothing lost ----
  {
    const proj = await project({ 'm1.txt': 'm1\nkeep1\n', 'm2.txt': 'm2\nkeep2\n' });
    const a = run(proj, 1), b = run(proj, 40), c = run(proj, 40);   // the patch locks both files while the edits wait on their baselines
    const ca = { agentId: 'lead', projectRoot: proj }, cb = { agentId: 'w1', projectRoot: proj }, cc = { agentId: 'w2', projectRoot: proj };
    await b.readTool.run({ path: 'm1.txt' }, cb);
    await c.readTool.run({ path: 'm2.txt' }, cc);
    const patch = '*** Begin Patch\n*** Update File: m2.txt\n@@\n-keep2\n+KEEP2\n*** Update File: m1.txt\n@@\n-keep1\n+KEEP1\n*** End Patch';
    const settled = await Promise.race([
      Promise.allSettled([a.patchTool.run({ patch }, ca),
        b.editTool.run({ path: 'm1.txt', find: 'm1\n', replace: 'M1\n' }, cb),
        c.editTool.run({ path: 'm2.txt', find: 'm2\n', replace: 'M2\n' }, cc)]),
      sleep(5000).then(() => 'deadlock')]);
    A.ok(Array.isArray(settled) && settled.every((r) => r.status === 'fulfilled'), 'a two-file patch + an edit on each file all complete (no deadlock): ' + JSON.stringify(Array.isArray(settled) ? settled.map((r) => r.status === 'fulfilled' ? 'ok' : r.reason.message) : settled));
    A.eq([await fsp.readFile(path.join(proj, 'm1.txt'), 'utf8'), await fsp.readFile(path.join(proj, 'm2.txt'), 'utf8')], ['M1\nKEEP1\n', 'M2\nKEEP2\n'], 'every mutation landed on both files');
  }

  // ---- 8. NO DRIFT, NO CHANGE: the ordinary single-writer receipt is byte-identical to trunk ----
  {
    const proj = await project({ 'x.js': 'hello world\n' });
    const t = run(proj), lsp = run(proj, 1);
    const ctx = { agentId: 'ag', projectRoot: proj };
    await t.readTool.run({ path: 'x.js' }, ctx);
    const r = await t.editTool.run({ path: 'x.js', find: 'world', replace: 'there' }, ctx);
    const sha = crypto.createHash('sha256').update('hello there\n').digest('hex');
    A.eq(r.content, 'Edited x.js (1 replacement).\n[mutation receipt: read-back-verified; attempted 12 bytes; written 12; verified 12; sha256 ' + sha + ']', 'single fs.edit content is exactly the historic receipt');
    await lsp.readTool.run({ path: 'x.js' }, ctx);
    const r2 = await lsp.editTool.run({ path: 'x.js', find: 'there', replace: 'world' }, ctx);
    A.ok(/\n\n\[LSP: no new diagnostics\]$/.test(r2.content), 'an undisturbed edit keeps its real LSP comparison');
    await t.readTool.run({ path: 'x.js' }, ctx);   // the other instance's edit moved the file past t's stamp
    const w = await t.writeTool.run({ path: 'x.js', content: 'abc' }, ctx);
    A.ok(/^Wrote x\.js \(3 bytes\)\.\n\[mutation receipt: read-back-verified; attempted 3 bytes; written 3; verified 3;/.test(w.content), 'single fs.write receipt unchanged');
    const ap = await t.appendTool.run({ path: 'x.js', content: 'd' }, ctx);
    A.ok(/^Appended to x\.js \(\+1 bytes, now 4\)\.\n\[mutation receipt: read-back-verified;/.test(ap.content), 'single fs.append receipt unchanged');
  }

  await fsp.rm(ROOT, { recursive: true, force: true });
  A.report('fs.concurrent-mutations.test');
})().catch(async (e) => {
  try { await fsp.rm(ROOT, { recursive: true, force: true }); } catch (_) { /* best-effort temp cleanup */ }
  console.log('FAIL: fs.concurrent-mutations.test threw -- ' + (e && e.stack || e));
  process.exit(1);
});
