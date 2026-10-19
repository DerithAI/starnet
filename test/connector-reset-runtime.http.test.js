"use strict";
const assert = require('node:assert/strict'), fs = require('node:fs'), path = require('node:path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const { makeConnectorVault } = require('../sidecar/connector-vault.js');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
(async () => {
  const keyHex = '39'.repeat(32);
  const app = SidecarFixture.create({ prefix: 'starnet-credential-recovery-', entry: path.join(__dirname, 'helpers/connector-reset-host.cjs'), env: { STARNET_DESKTOP_SHELL: '1', STARNET_CONNECTOR_ENCRYPTION_KEY: keyHex } });
  const file = path.join(app.workspace, 'connectors/state.json');
  const marker = name => path.join(app.workspace, name);
  const set = (name, value = '1') => fs.writeFileSync(marker(name), value);
  const clear = name => { try { fs.unlinkSync(marker(name)); } catch (_) {} };
  const disk = () => makeConnectorVault({ fs, path, keyHex }).load(file);
  const config = { id: 'live-fixture', transport: 'http', url: 'https://audit.example.com/mcp', token: 'SYNTHETIC_ORIGINAL', enabled: true };
  const oauthConfig = { id: 'oauth-fixture', transport: 'http', url: 'https://audit.example.com/mcp', oauth: true, enabled: false };
  const fresh = () => app.json('POST', '/api/connectors/storage/start-fresh', { confirm: true });
  const wait = async predicate => { const deadline = Date.now() + 10000; while (!predicate()) { assert.ok(Date.now() < deadline, 'fixture response deadline'); await sleep(20); } };
  let serial = 0;
  async function probe() {
    set('manager-probe.json', JSON.stringify({ serial: ++serial }));
    let result;
    await wait(() => { try { result = JSON.parse(fs.readFileSync(marker('manager-result.json'))); return result.serial === serial; } catch (_) { return false; } });
    return result;
  }
  const start = attemptId => app.json('POST', '/api/connectors/oauth/start', { id: 'oauth-fixture', attemptId });
  const callback = url => app.json('GET', '/api/connectors/oauth/callback?code=synthetic&state=' + new URL(url).searchParams.get('state'));
  async function lock() {
    set('credential-fault.json', JSON.stringify({ mode: 'read' }));
    assert.equal((await app.json('POST', '/api/connectors', config)).status, 500);
    assert.equal((await app.json('GET', '/api/connectors')).body.credentialStorage.reason, 'unreadable');
    clear('credential-fault.json');
  }
  try {
    await app.start();
    const saved = await app.json('POST', '/api/connectors', config);
    assert.equal(saved.body.connected, true, JSON.stringify(saved.body));
    assert.ok((await probe()).result, 'live manager tool works before fault');
    await app.json('POST', '/api/connectors', oauthConfig);
    const pending = await start('pending_reset_1');
    assert.equal(pending.status, 200, JSON.stringify(pending.body));
    const github = await app.json('POST', '/api/connectors/oauth/start', { id: 'github', attemptId: 'github_reset_1' });
    assert.equal(github.status, 200, JSON.stringify(github.body));
    await lock();
    const original = [file, file + '.bak'].map(p => fs.readFileSync(p));
    set('credential-fault.json', JSON.stringify({ mode: 'write' }));
    assert.equal((await fresh()).status, 500, 'failed durable reset is reported');
    clear('credential-fault.json');
    [file, file + '.bak'].forEach((p, i) => assert.deepEqual(fs.readFileSync(p), original[i]));
    assert.ok((await probe()).result, 'failed reset keeps the original live client/tool');
    assert.equal((await app.json('POST', '/api/connectors/oauth/device/poll', { attemptId: 'github_reset_1' })).body.state, 'pending', 'failed reset preserves pending device flow');
    set('exchange-hold');
    const exchanging = callback(pending.body.url); exchanging.catch(() => {});
    await wait(() => fs.existsSync(marker('exchange-started')));
    assert.equal((await fresh()).status, 200);
    const reset = await probe();
    assert.deepEqual(reset.rows, [], 'successful START FRESH removes all runtime clients/tools');
    assert.ok(reset.error && !reset.result, 'old tool cannot be called after successful reset');
    assert.deepEqual(disk().configs, []);
    assert.equal((await app.json('POST', '/api/connectors/oauth/device/poll', { attemptId: 'github_reset_1' })).body.state, 'error', 'successful reset cancels device flow');
    set('exchange-release');
    assert.match((await exchanging).text, /Sign-in cancelled/);
    assert.deepEqual(disk().oauth.byId, {}, 'late code exchange cannot restore a grant');
    assert.deepEqual(disk().configs, [], 'late code exchange cannot restore a connector');
    clear('exchange-hold'); clear('exchange-started'); clear('exchange-release');
    // An ordinary settings reset uses the same invalidation and cancels pending links.
    assert.equal((await app.json('POST', '/api/connectors', config)).body.connected, true);
    await app.json('POST', '/api/connectors', oauthConfig);
    const unopened = await start('pending_reset_2');
    assert.equal(unopened.status, 200);
    const beforeOrdinaryReset = fs.readFileSync(file);
    set('credential-fault.json', JSON.stringify({ mode: 'write' }));
    assert.equal((await app.json('POST', '/api/config/reset', { section: 'connectors' })).status, 500);
    clear('credential-fault.json');
    assert.deepEqual(fs.readFileSync(file), beforeOrdinaryReset);
    assert.ok((await probe()).result, 'failed ordinary reset keeps the live client');
    assert.equal((await app.json('POST', '/api/config/reset', { section: 'connectors' })).status, 200);
    assert.match((await callback(unopened.body.url)).text, /Sign-in expired/);
    assert.deepEqual((await probe()).rows, []);
    // Discovery/registration started before reset cannot cache a client or publish a new link afterward.
    await app.json('POST', '/api/connectors', config);
    await app.json('POST', '/api/connectors', oauthConfig);
    set('register-hold');
    const discovering = start('pending_reset_3'); discovering.catch(() => {});
    await wait(() => fs.existsSync(marker('register-started')));
    await lock();
    assert.equal((await app.json('POST', '/api/config/reset', { section: 'connectors' })).status, 200, 'settings locked reset shares START FRESH cleanup');
    set('register-release');
    assert.notEqual((await discovering).status, 200);
    assert.deepEqual(disk().oauth.clients, {}, 'late registration cannot repopulate reset client cache');
    assert.deepEqual((await probe()).rows, []);
    assert.equal((await app.json('POST', '/api/connectors', { ...config, token: 'SYNTHETIC_RECONNECTED' })).body.connected, true);
    await app.restart();
    assert.equal(disk().configs.find(c => c.id === config.id).token, 'SYNTHETIC_RECONNECTED');
    assert.equal((await app.json('POST', '/api/connectors/refresh', { id: config.id })).status, 200);
    assert.ok((await probe()).result, 'new credential reconnects after process restart');
    // A refresh response from the old generation cannot overwrite a new connection with the same id.
    await app.stop();
    makeConnectorVault({ fs, path, keyHex }).write(file, { version: 2, configs: [{ ...oauthConfig, enabled: false }], oauth: { clients: {}, byId: { 'oauth-fixture': {
      accessToken: 'SYNTHETIC_EXPIRED', refreshToken: 'SYNTHETIC_REFRESH', expiresAt: 1,
      tokenEndpoint: 'https://audit.example.com/token', clientId: 'SYNTHETIC_CLIENT'
    } } } });
    await app.start();
    set('exchange-hold');
    const refreshing = app.json('POST', '/api/connectors', { ...oauthConfig, enabled: true }); refreshing.catch(() => {});
    await wait(() => fs.existsSync(marker('exchange-started')));
    await lock();
    assert.equal((await fresh()).status, 200);
    assert.equal((await app.json('POST', '/api/connectors', { ...config, id: 'oauth-fixture', token: 'SYNTHETIC_SUCCESSOR' })).body.connected, true);
    set('exchange-release');
    await refreshing;
    assert.deepEqual(disk().oauth.byId, {}, 'late refresh cannot restore the removed grant');
    assert.equal(disk().configs.find(c => c.id === 'oauth-fixture').token, 'SYNTHETIC_SUCCESSOR');
    const rows = (await app.json('GET', '/api/connectors')).body.connectors;
    assert.equal(rows.find(c => c.id === 'oauth-fixture').state, 'up', 'old refresh cannot replace the new manager client');
    console.log('connector-reset-runtime HTTP: PASS (live tool revoked only after durable reset; failed reset preserves files/client/pending sign-in; late OAuth refused; reconnect survives restart)');
  } finally { await app.dispose(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
