'use strict';
// Hermetic credential fault seam. Never run against a real profile or credential store.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(process.env.STARNET_WORKSPACES || '');
if (path.dirname(root) !== path.resolve(os.tmpdir()) || !path.basename(root).startsWith('starnet-credential-recovery-')) throw Error('Requires isolated credential-recovery fixture');
const control = path.join(root, 'credential-fault.json'), state = path.join(root, 'connectors/state.json');
const read = fs.readFileSync.bind(fs), open = fs.openSync.bind(fs);
function mode() { try { return JSON.parse(read(control, 'utf8')).mode; } catch (_) { return ''; } }
fs.readFileSync = function(file, ...args) {
  const m = mode();
  if (m === 'read' && path.resolve(String(file)) === state) throw Object.assign(Error('Synthetic credential read refused'), { code: 'EACCES' });
  // 'busy': the sharing violation Windows reports while antivirus, backup or sync holds the file
  if (m === 'busy' && path.resolve(String(file)) === state) throw Object.assign(Error('EBUSY: synthetic resource busy or locked'), { code: 'EBUSY' });
  return read(file, ...args);
};
fs.openSync = function(file, flags, ...args) {
  const target = path.resolve(String(file));
  if (mode() === 'write' && target.startsWith(state + '.') && !target.startsWith(state + '.bak') && target.endsWith('.tmp') && String(flags).includes('w')) throw Object.assign(Error('Synthetic credential write refused'), { code: 'ENOSPC' });
  return open(file, flags, ...args);
};
require('../../sidecar/index.js');
