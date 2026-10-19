'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const { makeConnectorVault } = require('../sidecar/connector-vault.js');
(async () => {
  const K1 = '17'.repeat(32), K2 = '28'.repeat(32);
  const app = SidecarFixture.create({ prefix: 'starnet-credential-recovery-', entry: path.join(__dirname, 'helpers/connector-recovery-fault-host.cjs'), env: { STARNET_DESKTOP_SHELL: '1', STARNET_CONNECTOR_ENCRYPTION_KEY: K1 }, timeoutMs: 30000 });
  const file = path.join(app.workspace, 'connectors/state.json'), control = path.join(app.workspace, 'credential-fault.json');
  const config = token => ({ id: 'recovery-fixture', transport: 'http', url: 'http://127.0.0.1:1/mcp', enabled: false, token });
  const decoded = keyHex => makeConnectorVault({ fs, path, keyHex }).load(file);
  const token = () => decoded(K2).configs.find(c => c.id === 'recovery-fixture').token;
  const storage = async () => (await app.json('GET', '/api/connectors')).body.credentialStorage;
  try {
    await app.start();
    assert.equal((await app.json('POST', '/api/connectors', config('OLD_SYNTHETIC_TOKEN'))).body.saved, true);
    await app.stop();
    const original = [file, file + '.bak'].map(p => fs.readFileSync(p));
    await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K2 });
    assert.equal((await storage()).reason, 'key-mismatch');
    assert.equal((await app.json('POST', '/api/connectors', config('MUST_NOT_SAVE'))).status, 500);
    [file, file + '.bak'].forEach((p, i) => assert.deepEqual(fs.readFileSync(p), original[i]));
    const fresh = await app.json('POST', '/api/connectors/storage/start-fresh', { confirm: true });
    assert.equal(fresh.status, 200);
    const retained = ['state.json', 'state.json.bak'].map(n => path.join(fresh.body.movedTo, n));
    retained.forEach((p, i) => assert.deepEqual(fs.readFileSync(p), original[i]));
    const saved = await app.json('POST', '/api/connectors', config('NEW_SYNTHETIC_TOKEN'));
    assert.equal(saved.status, 200); assert.equal(saved.body.saved, true); assert.equal(saved.body.connected, false, 'disabled fixture never claims provider connection');
    await app.stop(); await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K2 });
    assert.equal(token(), 'NEW_SYNTHETIC_TOKEN', 'resaved credential survives process quit/restart');
    assert.equal((await storage()).error, null);
    await app.stop();
    const beforeMissingKey = [file, file + '.bak'].map(p => fs.readFileSync(p));
    await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: '', STARNET_CONNECTOR_KEY_ERROR: 'Synthetic native key unavailable' });
    assert.equal((await storage()).reason, 'key-unavailable');
    assert.equal((await app.json('POST', '/api/connectors', config('MUST_NOT_SAVE'))).status, 500);
    [file, file + '.bak'].forEach((p, i) => assert.deepEqual(fs.readFileSync(p), beforeMissingKey[i]));
    await app.stop(); await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K2, STARNET_CONNECTOR_KEY_ERROR: '' });
    assert.equal(token(), 'NEW_SYNTHETIC_TOKEN', 'restored key reopens original credentials');
    const beforeWrite = fs.readFileSync(file);
    fs.writeFileSync(control, JSON.stringify({ mode: 'write' }));
    const failedWrite = await app.json('POST', '/api/connectors', config('REJECTED_TOKEN'));
    assert.equal(failedWrite.status, 500); assert.equal(failedWrite.body.saved, false);
    assert.deepEqual(fs.readFileSync(file), beforeWrite);
    assert.equal((await storage()).reason, null, 'a write-only failure is not falsely labelled a locked vault');
    assert.equal(token(), 'NEW_SYNTHETIC_TOKEN');
    fs.unlinkSync(control); await app.stop(); await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K2 });
    assert.equal(token(), 'NEW_SYNTHETIC_TOKEN', 'write failure preserves prior credential across restart');
    for (const mutation of ['save', 'remove']) {
      const beforeRead = [file, file + '.bak'].map(p => fs.readFileSync(p));
      fs.writeFileSync(control, JSON.stringify({ mode: 'read' }));
      const failedRead = mutation === 'save'
        ? await app.json('POST', '/api/connectors', config('REJECTED_TOKEN'))
        : await app.json('POST', '/api/connectors/remove', { id: 'recovery-fixture' });
      assert.equal(failedRead.status, 500); assert.equal(failedRead.body.saved, false);
      const locked = await storage();
      assert.equal(locked.reason, 'unreadable', mutation + ': live locked vault is visible to the connector panel');
      assert.ok(locked.error); assert.equal(locked.encrypted, false);
      [file, file + '.bak'].forEach((p, i) => assert.deepEqual(fs.readFileSync(p), beforeRead[i]));
      fs.unlinkSync(control);
      assert.equal((await app.json('POST', '/api/connectors', config('STILL_REFUSED'))).status, 500, 'removing fault does not silently unlock the running vault');
      await app.stop(); await app.start({ STARNET_CONNECTOR_ENCRYPTION_KEY: K2 });
      assert.equal((await storage()).error, null);
      assert.equal(token(), 'NEW_SYNTHETIC_TOKEN');
    }
    retained.forEach((p, i) => assert.deepEqual(fs.readFileSync(p), original[i], 'all original recovery bytes survive every restart/fault'));
    const publicState = JSON.stringify((await app.json('GET', '/api/connectors')).body);
    assert.ok(!publicState.includes('SYNTHETIC_TOKEN'));
    console.log('connector-recovery-reconnect HTTP: PASS (locked originals, resaved credentials across quit/restart, absent/restored key, failed writes/reads, preserved recovery copies; no native keychain or provider sign-in)');
  } finally { await app.dispose(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
