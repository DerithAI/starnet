'use strict';
/* test/cli-launcher.test.js — bin/starnet (the macOS/Linux launcher) finds the app's OWN node in each platform's bundle:
   one folder up (a portable layout), StarNet.app/Contents/MacOS/node from Contents/Resources/bin, and usr/bin/node from a
   Linux package's usr/lib/StarNet/bin — else node on PATH. Each layout is built in a temp folder with a stub node that
   says which one ran. Needs a POSIX sh (Git for Windows ships one); without it the test says so and passes. */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const A = require('./_assert.js');

const SRC = path.join(__dirname, '..', 'bin', 'starnet');
const probe = spawnSync('sh', ['-c', 'echo ok'], { encoding: 'utf8' });
if (probe.error || probe.stdout.trim() !== 'ok') {
  console.log('cli-launcher.test: no POSIX sh on this machine — skipped');
  process.exit(0);
}
A.ok(!/\r/.test(fs.readFileSync(SRC, 'utf8')), 'the launcher has LF line endings (a CR breaks sh on macOS)');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-launcher-'));
const layouts = {
  mac: ['StarNet.app/Contents/Resources/bin', 'StarNet.app/Contents/MacOS/node'],
  linux: ['usr/lib/StarNet/bin', 'usr/bin/node'],
  flat: ['StarNet/bin', 'StarNet/node']
};
try {
  for (const [name, [bin, node]] of Object.entries(layouts)) {
    const b = path.join(root, name, bin), n = path.join(root, name, node);
    fs.mkdirSync(b, { recursive: true }); fs.mkdirSync(path.dirname(n), { recursive: true });
    fs.copyFileSync(SRC, path.join(b, 'starnet'));
    fs.writeFileSync(path.join(b, 'starnet.js'), '');
    fs.writeFileSync(n, '#!/bin/sh\necho "' + name + ' node: $(basename "$1") $2"\n'); fs.chmodSync(n, 0o755);
    const r = spawnSync('sh', [path.join(b, 'starnet'), '--version'], { encoding: 'utf8' });
    A.eq((r.stdout || '').trim(), name + ' node: starnet.js --version', name + ': the launcher runs the bundle\'s own node, arguments passed through' + (r.stderr ? ' (' + r.stderr.trim() + ')' : ''));
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
A.report('cli-launcher.test');
