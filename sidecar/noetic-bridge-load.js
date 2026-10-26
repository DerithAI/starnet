/* sidecar/noetic-bridge-load.js — opt-in load of sidecar/noetic_bridge.js.

   The bridge file is a static localhost map (Ollama, LUMEN, LUMEN MEGA, Command Center,
   overseer, specialists, rooms). It is not a second station and it does not pick a
   provider. The sidecar requires it only when STARNET_NOETIC_BRIDGE is explicitly on
   (1 / true / yes / on). SKYNET_NOETIC_BRIDGE is the legacy alias. A present STARNET_
   name wins even when empty, matching ENV() in index.js.

   Off (the default): this module returns null and does not require the config file.
   On: it returns that module's exports. Callers must not treat the map as a provider
   default. The beginner OpenAI card stays where the app left it. */
'use strict';

const FLAG = 'NOETIC_BRIDGE';

function flagValue(env) {
  const source = env || {};
  const star = 'STARNET_' + FLAG;
  if (Object.prototype.hasOwnProperty.call(source, star)) return source[star];
  return source['SKYNET_' + FLAG];
}

function bridgeRequested(env) {
  const raw = flagValue(env);
  return /^(1|true|yes|on)$/i.test(String(raw == null ? '' : raw).trim());
}

function loadNoeticBridge(opts) {
  opts = opts || {};
  const env = opts.env || process.env;
  if (!bridgeRequested(env)) return null;
  const requireBridge = typeof opts.requireBridge === 'function'
    ? opts.requireBridge
    : () => require('./noetic_bridge.js');
  const config = requireBridge();
  if (!config || typeof config !== 'object' || Array.isArray(config) || !config.station || typeof config.station !== 'object') {
    throw new Error('NOETIC bridge config is missing a station block');
  }
  return config;
}

function bootLine(config) {
  const station = (config && config.station) || {};
  const name = String(station.name || 'NOETIC');
  const ollama = String(station.ollama_url || '');
  const specialists = Array.isArray(config && config.specialists) ? config.specialists.length : 0;
  const rooms = config && config.rooms && typeof config.rooms === 'object' && !Array.isArray(config.rooms)
    ? Object.keys(config.rooms).length : 0;
  return '  · NOETIC bridge config loaded (' + name
    + (ollama ? '; ollama ' + ollama : '')
    + '; ' + specialists + ' specialists, ' + rooms + ' rooms). Default provider unchanged.';
}

module.exports = { loadNoeticBridge, bridgeRequested, bootLine };
