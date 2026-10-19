'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { inspect } = require('../scripts/qa/installation-integrity.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-integrity-'));
const installed = path.join(root, 'installed'), reference = path.join(root, 'reference');
const shell = 'sidecar/tools/builtin/shell.js';
const put = (dir, rel, bytes) => { const file = path.join(dir, rel); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, bytes); };
const run = options => inspect({ installation: installed, reference, files: [shell], ...options });
const snapshot = dir => Object.fromEntries(fs.readdirSync(dir, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => {
  const file = path.join(e.parentPath || e.path, e.name); return [path.relative(dir, file), { bytes: fs.readFileSync(file).toString('hex'), mtime: fs.statSync(file).mtimeMs }];
}));
try {
  const marker = path.join(root, 'EXECUTED');
  const moduleText = 'require("node:fs").writeFileSync(' + JSON.stringify(marker) + ', "bad");\r\n';
  put(installed, shell, moduleText); put(reference, shell, moduleText);
  put(installed, 'profiles/customer/station.json', 'PRIVATE_STATION_SENTINEL');
  let report = run();
  assert.equal(report.files[0].comparison, 'match');
  assert.equal(report.files[0].installed.bytes, Buffer.byteLength(moduleText));
  assert.match(report.files[0].installed.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.disk.state, 'observed'); assert.ok(BigInt(report.disk.availableBytes) >= 0n);
  assert.equal(fs.existsSync(marker), false, 'supplied JS was not executed');
  assert.equal(run({ reference: undefined }).files[0].comparison, 'unverified');
  assert.equal(run({ reference: path.join(root, 'absent') }).files[0].reference.state, 'missing');
  assert.equal(run({ reference: path.join(root, 'absent') }).files[0].comparison, 'unverified');
  put(reference, shell, ''); assert.equal(run().files[0].reference.state, 'empty'); assert.equal(run().files[0].comparison, 'unverified');
  put(reference, shell, moduleText.replace(/\r\n/g, '\n'));
  assert.equal(run().files[0].comparison, 'mismatch', 'compares extracted bytes, not Git-normalized lines');
  put(installed, shell, 'corrupted'); assert.equal(run().files[0].comparison, 'mismatch');
  put(installed, shell, ''); report = run(); assert.equal(report.files[0].comparison, 'empty'); assert.equal(report.files[0].installed.bytes, 0);
  fs.unlinkSync(path.join(installed, shell)); assert.equal(run().files[0].comparison, 'missing');
  fs.mkdirSync(path.join(installed, shell)); assert.equal(run().files[0].installed.error, 'NOT_REGULAR_FILE'); fs.rmdirSync(path.join(installed, shell));
  put(installed, shell, moduleText); put(reference, shell, moduleText);
  const originalOpen = fs.openSync;
  try {
    fs.openSync = function(file, ...args) { if (file === path.join(installed, shell)) { const e = new Error('private path omitted'); e.code = 'EACCES'; throw e; } return originalOpen.call(this, file, ...args); };
    report = run(); assert.equal(report.files[0].comparison, 'unverified'); assert.equal(report.files[0].installed.error, 'EACCES');
    assert.ok(!JSON.stringify(report).includes('private path omitted'));
  } finally { fs.openSync = originalOpen; }
  const originalRead = fs.readSync; let mutated = false;
  try {
    fs.readSync = function(...args) { const n = originalRead.apply(this, args); if (n && !mutated) { mutated = true; fs.appendFileSync(path.join(installed, shell), 'changed during read'); } return n; };
    assert.equal(run().files[0].installed.error, 'FILE_CHANGED_DURING_READ');
  } finally { fs.readSync = originalRead; put(installed, shell, moduleText); }
  for (const file of ['../secret.js', 'sidecar/../../secret.js', 'profiles/customer/station.json', '/sidecar/index.js', 'C:\\secret.js', 'sidecar/link/file.json']) assert.throws(() => run({ files: [file] }), /Unsupported/);
  assert.throws(() => run({ reference: installed }), /separate/);
  // a mistyped --installation is an invalid invocation, never a report that every file is "missing"
  assert.throws(() => run({ installation: path.join(root, 'absent') }), /not an existing directory/);
  assert.throws(() => run({ installation: path.join(installed, shell) }), /not an existing directory/);
  assert.throws(() => run({ signature: true }), /requires --installer/);
  const linkRoot = path.join(root, 'linked'); fs.mkdirSync(linkRoot);
  fs.symlinkSync(path.join(installed, 'sidecar'), path.join(linkRoot, 'sidecar'), process.platform === 'win32' ? 'junction' : 'dir');
  try { assert.equal(run({ installation: linkRoot }).files[0].installed.error, 'LINK_REFUSED'); }
  finally { fs.unlinkSync(path.join(linkRoot, 'sidecar')); }
  const packageFile = path.join(root, 'package with space.exe'); fs.writeFileSync(packageFile, 'fixture installer bytes, never executable');
  const absentInstaller = run({ installer: path.join(root, 'absent.exe') });
  assert.equal(absentInstaller.installer.state, 'missing');
  if (process.platform === 'win32') {
    const signed = run({ installer: packageFile, signature: true });
    assert.equal(signed.installer.signature.state, 'observed');
    assert.ok(['NotSigned', 'UnknownError'].includes(signed.installer.signature.status), 'non-PE fixture cannot be certified valid');
  }
  // Cargo/NSIS ship this basename; inspect bytes without attempting native execution.
  for (const binary of ['skynet-desktop.exe', 'skynet-desktop']) {
    put(installed, binary, 'synthetic native executable bytes');
    put(reference, binary, 'synthetic native executable bytes');
  }
  const before = snapshot(root);
  const cli = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/qa/installation-integrity.cjs'), '--installation', installed, '--reference', reference, '--file', shell, '--installer', packageFile], { encoding: 'utf8', windowsHide: true });
  assert.equal(cli.status, 0, cli.stderr); report = JSON.parse(cli.stdout);
  assert.equal(report.files.length, 1); assert.equal(report.summary.match, 1);
  assert.equal(report.installer.state, 'present'); assert.match(report.installer.sha256, /^[a-f0-9]{64}$/);
  assert.equal(report.installer.signature.state, 'unverified');
  assert.ok(!cli.stdout.includes('PRIVATE_STATION_SENTINEL'));
  const nativeCli = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/qa/installation-integrity.cjs'), '--installation', installed, '--reference', reference, '--file', 'skynet-desktop.exe', '--file', 'skynet-desktop'], { encoding: 'utf8', windowsHide: true });
  assert.equal(nativeCli.status, 0, nativeCli.stderr);
  const nativeReport = JSON.parse(nativeCli.stdout);
  assert.deepEqual(nativeReport.files.map(row => row.relativePath), ['skynet-desktop.exe', 'skynet-desktop']);
  assert.equal(nativeReport.summary.match, 2);
  assert.deepEqual(snapshot(root), before, 'all fixture/profile bytes and mtimes untouched');
  assert.equal(fs.existsSync(marker), false);
  const bad = spawnSync(process.execPath, [path.resolve(__dirname, '../scripts/qa/installation-integrity.cjs'), '--installation'], { encoding: 'utf8', windowsHide: true });
  assert.equal(bad.status, 2);
  console.log('installation-integrity: PASS (exact bytes, missing/empty/corrupt/reference absence, read errors, links, scoped CLI and untouched data)');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
