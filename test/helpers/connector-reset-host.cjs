"use strict";
// Test-only provider and manager probe; the fault host enforces an isolated temporary root.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(process.env.STARNET_WORKSPACES || '');
if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('starnet-credential-recovery-')) throw Error('Requires isolated credential-recovery fixture');
const marker = name => path.join(root, name);
const dns = require('node:dns'), lookup = dns.promises.lookup;
// github.com is faked too: the device-flow poll must never leave the machine (tests-03 — once 5 s passed under load,
// the poll sent the shipped client_id plus a synthetic device code to the real GitHub and the test went red).
const GITHUB = ['github.com', 'api.github.com'];
dns.promises.lookup = (host, options) => (host === 'audit.example.com' || GITHUB.includes(host)) ? Promise.resolve([{ address: '93.184.216.34', family: 4 }]) : lookup(host, options);
const realFetch = globalThis.fetch;
const json = body => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json' } });
async function held(name) {
  if (!fs.existsSync(marker(name + '-hold'))) return;
  fs.writeFileSync(marker(name + '-started'), '1');
  const deadline = Date.now() + 15000;
  while (!fs.existsSync(marker(name + '-release'))) {
    if (Date.now() > deadline) throw Error('Synthetic response release timed out');
    await new Promise(resolve => setTimeout(resolve, 20));
  }
}
globalThis.fetch = async (raw, opts = {}) => {
  const url = new URL(String(raw));
  if (url.hostname === 'github.com' && url.pathname === '/login/device/code') return json({ device_code: 'SYNTHETIC_DEVICE', user_code: 'ABCD-EFGH', verification_uri: 'https://github.com/login/device', expires_in: 600, interval: 5 });
  if (url.hostname === 'github.com' && url.pathname === '/login/oauth/access_token') return json({ error: 'authorization_pending' });
  if (GITHUB.includes(url.hostname)) throw Error('hermetic fixture: unexpected GitHub request ' + url.pathname);
  if (url.hostname !== 'audit.example.com') return realFetch(raw, opts);
  if (url.pathname.includes('oauth-protected-resource')) return json({ resource: 'https://audit.example.com/mcp', authorization_servers: ['https://audit.example.com'] });
  if (url.pathname.includes('oauth-authorization-server')) return json({ issuer: 'https://audit.example.com', authorization_endpoint: 'https://audit.example.com/authorize', token_endpoint: 'https://audit.example.com/token', registration_endpoint: 'https://audit.example.com/register', response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] });
  if (url.pathname === '/register') { await held('register'); return json({ client_id: 'SYNTHETIC_CLIENT' }); }
  if (url.pathname === '/token') { await held('exchange'); return json({ access_token: 'SYNTHETIC_LATE_GRANT', refresh_token: 'SYNTHETIC_REFRESH', token_type: 'Bearer', expires_in: 3600 }); }
  let msg = {}; try { msg = JSON.parse(opts.body); } catch (_) {}
  if (msg.id == null) return new Response(null, { status: 202 });
  const result = msg.method === 'initialize' ? { protocolVersion: '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'synthetic', version: '1' } }
    : msg.method === 'tools/list' ? { tools: [{ name: 'fixture_tool', description: 'Synthetic probe', inputSchema: { type: 'object', properties: {} } }] }
    : msg.method === 'tools/call' ? { content: [{ type: 'text', text: 'synthetic tool called' }] } : {};
  return json({ jsonrpc: '2.0', id: msg.id, result });
};
const mod = require('../../sidecar/mcp/manager.js'), make = mod.makeConnectorManager;
mod.makeConnectorManager = (...args) => {
  const manager = make(...args);
  let last;
  const timer = setInterval(async () => {
    let command; try { command = JSON.parse(fs.readFileSync(marker('manager-probe.json'), 'utf8')); } catch (_) { return; }
    if (command.serial === last) return;
    last = command.serial;
    let result, error;
    try { result = await manager.call('live-fixture', 'fixture_tool', {}); } catch (e) { error = e.message; }
    fs.writeFileSync(marker('manager-result.json'), JSON.stringify({ serial: command.serial, rows: manager.list(), result, error }));
  }, 20);
  timer.unref();
  return manager;
};
require('./connector-recovery-fault-host.cjs');
