'use strict';
/* Connector credential storage when the desktop shell has no OS-keychain key (2026-10-11 user report: Higgsfield
   "connector credentials locked" with no way out). Real sidecar, hermetic workspace:
   1. fresh install, no key  -> NOT locked: labelled unencrypted fallback, the shell's reason shown, saves work;
   2. next launch WITH a key -> the fallback store is sealed;
   3. key changed under it   -> locked with reason key-mismatch + canStartFresh; sign-in refused; START FRESH
      keeps the old files aside byte-for-byte, writes a new sealed store, and the lock is gone after restart;
   4. Settings' connector reset of a locked store also starts fresh instead of failing forever;
   5. an interrupted START FRESH locks as reset-interrupted, and START FRESH finishes it when its record checks out. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const { FORMAT } = require('../sidecar/connector-vault.js');

(async () => {
  const K1 = 'ab'.repeat(32), K2 = 'cd'.repeat(32);
  const REASON = 'the system credential store is locked or refused access (Platform secure storage failure: test)';
  const app = SidecarFixture.create({ env: { STARNET_DESKTOP_SHELL: '1', STARNET_CONNECTOR_KEY_ERROR: REASON }, timeoutMs: 30000 });
  const file = path.join(app.workspace, 'connectors/state.json');
  const storage = async () => (await app.json('GET', '/api/connectors')).body.credentialStorage;
  let busyApp = null;
  try {
    await app.start();
    let s = await storage();
    assert.equal(s.error, null, 'a fresh install without a key is not "locked"');
    assert.equal(s.fallback, true);
    assert.equal(s.encrypted, false, 'never claims encryption it does not have');
    assert.match(s.notice, /WITHOUT encryption/);
    assert.ok(s.notice.includes(REASON) && s.keyError === REASON, 'the shell reason reaches the panel');
    const saved = await app.json('POST', '/api/connectors', { id: 'audit-fixture', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: false });
    assert.equal(saved.status, 200, 'saving a connector works in fallback: ' + JSON.stringify(saved.body));
    assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).configs.some(c => c.id === 'audit-fixture'), 'fallback store is plaintext and holds the save');
    await app.stop();

    await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K1, STARNET_CONNECTOR_KEY_ERROR: '' });
    s = await storage();
    assert.equal(s.encrypted, true);
    assert.equal(s.fallback, false);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).format, FORMAT, 'the first keyed launch seals the fallback store');
    assert.ok((await app.json('GET', '/api/connectors')).body.connectors.some(c => c.id === 'audit-fixture'), 'and keeps the connector');
    await app.stop();

    await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K2, STARNET_CONNECTOR_KEY_ERROR: '' });
    s = await storage();
    assert.match(s.error, /locked/);
    assert.equal(s.reason, 'key-mismatch');
    assert.equal(s.canStartFresh, true);
    assert.match(s.error, /START FRESH/, 'the message names the exit');
    const sealed = fs.readFileSync(file, 'utf8');
    const refused = await app.json('POST', '/api/connectors/oauth/start', { id: 'higgsfield' });
    assert.equal(refused.status, 503);
    assert.equal(refused.body.code, 'connector_storage_locked');
    assert.equal((await app.json('POST', '/api/connectors/storage/start-fresh', {})).status, 400, 'START FRESH needs explicit confirmation');
    const fresh = await app.json('POST', '/api/connectors/storage/start-fresh', { confirm: true });
    assert.equal(fresh.status, 200, JSON.stringify(fresh.body));
    assert.ok(fresh.body.moved.includes('state.json'));
    assert.equal(fs.readFileSync(path.join(fresh.body.movedTo, 'state.json'), 'utf8'), sealed, 'the unreadable store is kept byte-for-byte');
    assert.equal(fresh.body.credentialStorage.error, null);
    assert.equal(fresh.body.credentialStorage.encrypted, true);
    assert.equal((await app.json('POST', '/api/connectors/storage/start-fresh', { confirm: true })).status, 409, 'nothing to start fresh from once unlocked');
    await app.stop();
    await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K2, STARNET_CONNECTOR_KEY_ERROR: '' });
    s = await storage();
    assert.equal(s.error, null, 'the new store opens after restart');
    assert.equal(s.encrypted, true);
    await app.stop();

    await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K1, STARNET_CONNECTOR_KEY_ERROR: '' });
    assert.equal((await storage()).reason, 'key-mismatch');
    const reset = await app.json('POST', '/api/config/reset', { section: 'connectors' });
    assert.equal(reset.status, 200, 'Settings reset of a locked store starts fresh: ' + JSON.stringify(reset.body));
    assert.equal((await storage()).error, null);
    await app.stop();
    // Interrupted reset recovery remains visible after a real sidecar restart, even with a readable active file.
    const savedBytes = fs.readFileSync(file, 'utf8');
    fs.writeFileSync(file + '.reset-pending', JSON.stringify({ movedTo: path.join(app.workspace, 'connectors/unreadable-interrupted') }));
    await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K1, STARNET_CONNECTOR_KEY_ERROR: '' });
    assert.equal((await storage()).reason, 'reset-interrupted', 'incomplete reset cannot boot as an empty store');
    assert.equal((await storage()).canStartFresh, false, 'a reset START FRESH cannot finish is not offered START FRESH (the by-hand steps speak)');
    // a record this build never writes (no file list) cannot be checked: refuse, change nothing, name the way out
    const incomplete = await app.json('POST', '/api/connectors/storage/start-fresh', { confirm: true });
    assert.equal(incomplete.status, 500);
    assert.match(incomplete.body.error, /cannot finish the earlier interrupted attempt/);
    assert.ok(incomplete.body.error.includes('unreadable-interrupted'), 'the refusal names the recovery folder');
    assert.ok(!incomplete.body.error.includes('nothing was changed'), 'failure message does not claim a rollback it did not prove');
    assert.equal(fs.readFileSync(file, 'utf8'), savedBytes, 'retry leaves the active recovery data unchanged');
    await app.stop();
    // security-storage-04: a crash during the copy phase (originals in place, the record lists them) used to lock the
    // store as "damaged" forever, and every START FRESH refused. It now says what happened and START FRESH finishes it.
    fs.writeFileSync(file + '.reset-pending', JSON.stringify({ movedTo: path.join(app.workspace, 'connectors/unreadable-crashed'), sources: ['state.json', 'state.json.bak'] }));
    await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K1, STARNET_CONNECTOR_KEY_ERROR: '' });
    s = await storage();
    assert.equal(s.reason, 'reset-interrupted');
    assert.equal(s.canStartFresh, true);
    assert.match(s.error, /START FRESH was interrupted.*Press START FRESH to finish it/, 'the lock says what happened: ' + s.error);
    assert.doesNotMatch(s.error, /damaged|newer StarNet/, 'and does not call intact files damaged');
    assert.ok(s.error.includes('unreadable-crashed'), 'the lock names the folder that holds the copies: ' + s.error);
    const finished = await app.json('POST', '/api/connectors/storage/start-fresh', { confirm: true });
    assert.equal(finished.status, 200, 'START FRESH finishes an interrupted reset: ' + JSON.stringify(finished.body));
    assert.ok(!fs.existsSync(file + '.reset-pending'), 'the recovery marker is cleared');
    assert.ok((finished.body.previous || []).some(p => p.includes('unreadable-crashed')), 'the answer still names the earlier folder: ' + JSON.stringify(finished.body.previous));
    assert.equal(fs.readFileSync(path.join(finished.body.movedTo, 'state.json'), 'utf8'), savedBytes, 'the old store is kept in the new folder');
    assert.equal((await storage()).error, null, 'and the store is open');
    await app.stop();
    // sidecar-index-07: an older credential file that cannot be removed (held by another program; here a directory
    // stands where its backup would be) used to lock every connector with no START FRESH and a reset that failed. The
    // sealed store is written and verified first, so this is a warning to retry, never a lock.
    const legacyBak = path.join(app.workspace, 'connectors', 'connectors.json.bak');
    fs.mkdirSync(legacyBak);
    try {
      await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K1, STARNET_CONNECTOR_KEY_ERROR: '' });
      s = await storage();
      assert.equal(s.error, null, 'a leftover older file does not lock the store: ' + s.error);
      assert.equal(s.encrypted, true, 'the store it reads is still sealed');
      // its own field: the page heads every `notice` 'not encrypted', which a sealed store is not, and it claims nothing
      // about the leftover file beyond what StarNet knows
      assert.match(String(s.migrationNotice || ''), /could not be removed/, 'the panel is told, in plain words: ' + s.migrationNotice);
      assert.doesNotMatch(String(s.migrationNotice || ''), /sealed/, 'no claim about a file StarNet could not remove');
      assert.equal(s.notice, null, 'not reported as an unencrypted store');
      const kept = await app.json('POST', '/api/connectors', { id: 'after-leftover', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: false });
      assert.equal(kept.status, 200, 'saving still works: ' + JSON.stringify(kept.body));
      await app.stop();
    } finally { fs.rmSync(legacyBak, { recursive: true, force: true }); }
    await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K1, STARNET_CONNECTOR_KEY_ERROR: '' });
    s = await storage();
    assert.equal(s.error, null);
    assert.equal(s.migrationNotice, null, 'the notice is gone once the old file is gone');
    assert.equal(s.notice, null);
    await app.stop();
    // security-storage-05: antivirus, backup or sync holding state.json at boot (EBUSY) used to lock every sign-in as
    // "damaged or from a newer StarNet" and steer the user to START FRESH, which sets an intact store aside. It is now
    // a 'busy' lock that names the read error and a restart first, keeps START FRESH as the exit for a file that is
    // still locked after one, and the store opens untouched once the file is free.
    busyApp = SidecarFixture.create({ prefix: 'starnet-credential-recovery-', entry: path.join(__dirname, 'helpers/connector-recovery-fault-host.cjs'),
      env: { STARNET_DESKTOP_SHELL: '1', STARNET_CONNECTOR_ENCRYPTION_KEY: K1, STARNET_CONNECTOR_KEY_ERROR: '' }, timeoutMs: 30000 });
    const busyFile = path.join(busyApp.workspace, 'connectors/state.json'), busyControl = path.join(busyApp.workspace, 'credential-fault.json');
    const busyStorage = async () => (await busyApp.json('GET', '/api/connectors')).body;
    await busyApp.start();
    assert.equal((await busyApp.json('POST', '/api/connectors', { id: 'held-fixture', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: false })).status, 200);
    await busyApp.stop();
    const heldBytes = fs.readFileSync(busyFile, 'utf8');
    fs.writeFileSync(busyControl, JSON.stringify({ mode: 'busy' }));
    await busyApp.start();
    s = (await busyStorage()).credentialStorage;
    assert.equal(s.reason, 'busy', 'a held file is a busy lock: ' + JSON.stringify(s));
    assert.ok(String(s.error).includes('EBUSY'), 'the lock names the read error: ' + s.error);
    assert.match(s.error, /Restart StarNet to try again\. If it is still locked after a restart, START FRESH/, 'a restart first, START FRESH after: ' + s.error);
    assert.doesNotMatch(s.error, /damaged|newer StarNet/, 'and does not call an intact file damaged');
    assert.equal(s.canStartFresh, true, 'START FRESH stays the exit for a file that is still locked after a restart');
    assert.equal(fs.readFileSync(busyFile, 'utf8'), heldBytes, 'the held store is not touched');
    await busyApp.stop();
    fs.unlinkSync(busyControl);
    await busyApp.start();
    const freed = await busyStorage();
    assert.equal(freed.credentialStorage.error, null, 'a restart once the file is free opens the store');
    assert.ok(freed.connectors.some(c => c.id === 'held-fixture'), 'with the saved connector still there');
    console.log('connector-storage-start-fresh.http: PASS (fresh-install fallback + reason, seal on keyed launch, key-mismatch lock, confirmed START FRESH keeps old files, restart, Settings reset exit, busy file waits for a restart)');
  } finally { await app.dispose(); if (busyApp) await busyApp.dispose(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
