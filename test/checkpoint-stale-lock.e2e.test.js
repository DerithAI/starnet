'use strict';
/* A killed checkpoint Git command's stale lock, through a REAL seeded sidecar (no model/network work).
   The lock a killed `git add -A` leaves (test/checkpoint-stale-lock.test.js kills a real one) used to refuse every
   later snapshot for that agent: the authenticated workspace write kept answering snapshot:null and the RESTORE
   lane kept listing the old points as if the net worked. Here: a stale index.lock is cleared and the write gets its
   restore point; a lock that cannot be removed makes the write report no snapshot, GET /api/checkpoint report
   health.ok:false with a path-free reason, and a restore refuse with the failing step; once it clears, health is ok
   and the earlier restore point restores. */
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path');
const { spawnSync } = require('node:child_process');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const fixture = SidecarFixture.create({ entry: path.resolve(__dirname, '../dev/seed.js'), timeoutMs: 60000,
  env: { SKYNET_DEFAULT_MODEL: 'checkpoint-local-fixture', SKYNET_OPENROUTER_KEY: '', OPENROUTER_KEY: '', OPENROUTER_API_KEY: '' } });
fixture.args = ['--keep', '--workspace', fixture.workspace];
function killOwnedLauncher() { if (process.platform === 'win32' && fixture.child && fixture.child.exitCode === null) spawnSync('taskkill', ['/pid', String(fixture.child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); }
(async () => { try {
  await fixture.start();
  const write = content => fixture.json('POST', '/api/autonomy/write', { agentId: 'agent', path: 'lock-proof.txt', content });
  const list = () => fixture.json('GET', '/api/checkpoint?agent=agent');
  const gitDir = path.join(fixture.workspace, '.checkpoints', 'agent', 'git');
  const lock = path.join(gitDir, 'index.lock');
  const file = path.join(fixture.workspace, 'agent', 'lock-proof.txt');

  const fresh = await list();
  assert.equal(fresh.status, 200, fresh.text);
  assert.equal(fresh.body.health, null, 'nothing attempted since boot: health is unknown (null), never ok');

  const first = await write('baseline');
  assert.equal(first.status, 200, first.text); assert.ok(first.body.snapshot, 'fixture: the first write gets a restore point');
  assert.ok(fs.existsSync(path.join(gitDir, 'HEAD')), 'fixture: the shadow repo exists');

  // what a killed add leaves behind
  fs.writeFileSync(lock, '');
  const second = await write('second');
  assert.equal(second.status, 200, second.text);
  assert.ok(second.body.snapshot, 'the write after a killed add gets its restore point (was snapshot:null on every later write)');
  assert.equal(fs.existsSync(lock), false, 'the stale index.lock was removed');
  assert.ok(/checkpoint\.staleLock/.test(fixture.output()), 'the sidecar noted the removal');
  const healthy = await list();
  assert.equal(healthy.body.health && healthy.body.health.ok, true, 'health is ok');
  assert.ok(healthy.body.snapshots.some(s => s.id === second.body.snapshot), 'the restore point is listed');

  // a lock that cannot be removed: no restore point, and every surface says so
  fs.mkdirSync(lock);
  const blocked = await write('third');
  assert.equal(blocked.status, 200, blocked.text);
  assert.equal(blocked.body.snapshot, null, 'the write reports that it has no restore point');
  const down = await list();
  const h = down.body.health;
  assert.equal(h && h.ok, false, 'GET /api/checkpoint says the last restore point was not saved: ' + down.text);
  assert.ok(/add/i.test(h.lastFailure.reason) && /index\.lock/.test(h.lastFailure.reason), 'the reason names the step and the blocker: ' + h.lastFailure.reason);
  assert.equal(h.lastFailure.kind, 'workspace', 'the failure names the root that is not saving: the agent workspace');
  assert.deepEqual((h.roots || []).map(r => [r.kind, r.workTree, r.ok]), [['workspace', '', false]], 'the per-root record rides through the route: ' + JSON.stringify(h.roots));
  assert.ok(!h.lastFailure.reason.toLowerCase().includes(fixture.workspace.toLowerCase().replace(/\\/g, '/'))
    && !h.lastFailure.reason.toLowerCase().includes(fixture.workspace.toLowerCase()), 'the reason does not print the station directory');
  const refused = await fixture.json('POST', '/api/checkpoint/restore', { agentId: 'agent', snapshotId: second.body.snapshot });
  assert.equal(refused.status, 500, refused.text);
  assert.ok(/could not be saved as an undo point first/.test(refused.body.error) && /index\.lock/.test(refused.body.error), 'the refused restore names why: ' + refused.body.error);
  assert.equal(fs.readFileSync(file, 'utf8'), 'third', 'a refused restore leaves the workspace untouched');

  fs.rmdirSync(lock);
  const fourth = await write('fourth');
  assert.ok(fourth.body.snapshot, 'once the blocker is gone the next write gets its restore point');
  const back = await list();
  assert.equal(back.body.health.ok, true, 'health recovers');
  assert.ok(back.body.health.lastFailure && back.body.health.failures === 1, 'the missed restore point stays on record');
  const restore = await fixture.json('POST', '/api/checkpoint/restore', { agentId: 'agent', snapshotId: second.body.snapshot });
  assert.equal(restore.status, 200, restore.text);
  assert.equal(fs.readFileSync(file, 'utf8'), 'baseline', 'the restore point taken after the stale lock restores its bytes');
  const fsck = spawnSync('git', ['--git-dir', gitDir, 'fsck', '--full', '--no-progress'], { encoding: 'utf8', windowsHide: true });
  assert.equal(fsck.status, 0, 'shadow repo fsck clean: ' + fsck.stdout + fsck.stderr);
  console.log('checkpoint-stale-lock.e2e: OK ' + JSON.stringify({ staleCleared: true, blockedHealth: h.ok, reason: h.lastFailure.reason, refusedStatus: refused.status, restoreStatus: restore.status }));
} finally { killOwnedLauncher(); await fixture.dispose(); } })().catch(e => { console.error(e.stack || e); console.error(fixture.output().slice(-4000)); process.exitCode = 1; });
