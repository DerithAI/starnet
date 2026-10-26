/* node test/noetic-bridge-load.test.js — STARNET_NOETIC_BRIDGE loads sidecar/noetic_bridge.js
   from the sidecar boot path, and stays unloaded when the flag is off.

   The config is a localhost map. Loading it must not flip the beginner OpenAI card. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');
const { loadNoeticBridge, bridgeRequested, bootLine } = require('../sidecar/noetic-bridge-load.js');

const ROOT = path.join(__dirname, '..');
const BRIDGE_ID = require.resolve('../sidecar/noetic_bridge.js');

function freshEnv(extra) {
  return Object.assign({}, extra || {});
}

// ---- OFF: the config module is not required ----
{
  delete require.cache[BRIDGE_ID];
  const offValues = [undefined, '', '0', 'false', 'no', 'off', '2', 'yesplease'];
  for (const value of offValues) {
    let called = 0;
    const env = freshEnv();
    if (value !== undefined) env.STARNET_NOETIC_BRIDGE = value;
    const out = loadNoeticBridge({
      env,
      requireBridge() { called += 1; throw new Error('config required while the flag is off'); }
    });
    A.eq(out, null, 'flag ' + JSON.stringify(value) + ' leaves the bridge unloaded');
    A.eq(called, 0, 'flag ' + JSON.stringify(value) + ' does not require the config');
    A.eq(bridgeRequested(env), false, 'bridgeRequested is false for ' + JSON.stringify(value));
  }
  loadNoeticBridge({ env: {} });
  A.eq(require.cache[BRIDGE_ID], undefined, 'default off does not put noetic_bridge.js in the module cache');
}

// An empty STARNET_ name wins over a legacy SKYNET_ opt-in (ENV() membership, not truthiness).
{
  let called = 0;
  const env = { STARNET_NOETIC_BRIDGE: '', SKYNET_NOETIC_BRIDGE: '1' };
  const out = loadNoeticBridge({
    env,
    requireBridge() { called += 1; return { station: { name: 'should-not-load' } }; }
  });
  A.eq(out, null, 'empty STARNET_NOETIC_BRIDGE wins over SKYNET_NOETIC_BRIDGE=1');
  A.eq(called, 0, 'the legacy alias is not consulted once STARNET_NOETIC_BRIDGE is set');
}

// ---- ON: require happens, and the real file is the localhost map ----
{
  const fake = { station: { name: 'FIXTURE', ollama_url: 'http://127.0.0.1:9/v1' }, specialists: [], rooms: {} };
  let called = 0;
  const out = loadNoeticBridge({
    env: { STARNET_NOETIC_BRIDGE: ' Yes ' },
    requireBridge() { called += 1; return fake; }
  });
  A.eq(called, 1, 'an explicit on value requires the config once');
  A.eq(out, fake, 'the loader returns the required config object');
  A.eq(bridgeRequested({ SKYNET_NOETIC_BRIDGE: 'on' }), true, 'SKYNET_NOETIC_BRIDGE is the legacy alias');
  for (const value of ['1', 'true', 'TRUE', 'yes', 'on', 'On']) {
    A.eq(bridgeRequested({ STARNET_NOETIC_BRIDGE: value }), true, value + ' opts in');
  }
}

{
  const on = loadNoeticBridge({ env: { STARNET_NOETIC_BRIDGE: '1' } });
  A.ok(require.cache[BRIDGE_ID], 'flag on loads sidecar/noetic_bridge.js');
  A.eq(on.station.name, 'NOETIC MESH PRIME STATION', 'station name');
  A.eq(on.station.port, 8787, 'station port stays the sidecar port');
  A.eq(on.station.ollama_url, 'http://127.0.0.1:11434/v1', 'ollama is localhost only');
  A.eq(on.station.lumen_url, 'http://127.0.0.1:8002', 'LUMEN is localhost');
  A.eq(on.station.lumen_mega_url, 'http://127.0.0.1:3002', 'LUMEN MEGA is localhost');
  A.eq(on.station.command_center_url, 'http://127.0.0.1:19001', 'Command Center is localhost');
  A.eq(on.default_overseer.provider, 'openai-compatible', 'overseer names a provider; boot does not apply it');
  A.eq(on.specialists.length, 6, 'six specialists');
  A.eq(Object.keys(on.rooms).length, 7, 'seven rooms');
  A.ok(!/sk-|api[_-]?key|secret|Bearer /i.test(JSON.stringify(on)), 'the map has no secrets');
  const line = bootLine(on);
  A.ok(line.indexOf('NOETIC MESH PRIME STATION') >= 0, 'boot line names the station');
  A.ok(line.indexOf('http://127.0.0.1:11434/v1') >= 0, 'boot line names the ollama url');
  A.ok(line.indexOf('Default provider unchanged') >= 0, 'boot line says the default provider is unchanged');
}

{
  let threw = false;
  try {
    loadNoeticBridge({ env: { STARNET_NOETIC_BRIDGE: '1' }, requireBridge() { return { specialists: [] }; } });
  } catch (e) {
    threw = true;
    A.ok(/station block/.test(e.message), 'a map with no station block fails closed');
  }
  A.eq(threw, true, 'missing station block throws');
}

// ---- boot path: index.js loads through the flag and does not apply the map ----
{
  const index = fs.readFileSync(path.join(ROOT, 'sidecar', 'index.js'), 'utf8');
  A.ok(index.indexOf('loadNoeticBridge({ env: process.env })') >= 0, 'sidecar boot calls loadNoeticBridge');
  A.ok(index.indexOf('if (noeticBridge) console.log(noeticBridgeBootLine(noeticBridge))') >= 0, 'the boot line runs only when the config loaded');
  A.ok(index.indexOf('Does not assign a provider') >= 0, 'boot comment records that the map is not applied');
  A.eq(index.indexOf('noeticBridge.default_overseer'), -1, 'boot does not read the overseer into the station');
  A.eq(index.indexOf('noeticBridge.specialists'), -1, 'boot does not spawn the specialists');
  const front = fs.readFileSync(path.join(ROOT, 'frontend', 'app', 'app.js'), 'utf8');
  const site = fs.readFileSync(path.join(ROOT, 'website', 'app', 'app', 'app.js'), 'utf8');
  A.ok(/let pickedProvider = 'openai'/.test(front), 'beginner OpenAI card stays the frontend default');
  A.ok(/let pickedProvider = 'openai'/.test(site), 'website mirror stays on openai');
}

A.report('noetic-bridge-load');
