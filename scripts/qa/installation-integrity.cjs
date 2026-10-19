#!/usr/bin/env node
'use strict';
// Offline file evidence only: never require/import inspected files or enumerate profiles.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const DEFAULT_FILES = ['node.exe', 'sidecar/index.js', 'sidecar/loop.js', 'sidecar/tools/builtin/shell.js'];

function noLinks(file) {
  const absolute = path.resolve(file), parsed = path.parse(absolute);
  let current = parsed.root;
  for (const part of absolute.slice(parsed.root.length).split(path.sep).filter(Boolean)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) {
      const error = new Error('Refusing symbolic link or junction'); error.code = 'LINK_REFUSED'; throw error;
    }
  }
}
function readFileEvidence(file) {
  let fd;
  try {
    noLinks(file);
    if (!fs.lstatSync(file).isFile()) return { state: 'unverified', error: 'NOT_REGULAR_FILE' };
    fd = fs.openSync(file, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd);
    if (!before.isFile()) return { state: 'unverified', error: 'NOT_REGULAR_FILE' };
    const hash = crypto.createHash('sha256'), buffer = Buffer.alloc(65536);
    let count, bytes = 0;
    while ((count = fs.readSync(fd, buffer, 0, buffer.length, null)) > 0) { hash.update(buffer.subarray(0, count)); bytes += count; }
    const after = fs.fstatSync(fd);
    noLinks(file);
    const named = fs.statSync(file);
    if (bytes !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs ||
        after.ctimeMs !== before.ctimeMs || named.ino !== after.ino || named.size !== after.size || named.mtimeMs !== after.mtimeMs) {
      return { state: 'unverified', error: 'FILE_CHANGED_DURING_READ' };
    }
    return { state: bytes === 0 ? 'empty' : 'present', bytes, sha256: hash.digest('hex') };
  } catch (error) {
    return { state: error.code === 'ENOENT' ? 'missing' : 'unverified', error: error.code || 'READ_ERROR' };
  } finally { if (fd !== undefined) fs.closeSync(fd); }
}
function selectedPath(value) {
  // Explicit application files only; no arbitrary profile/config files or traversal.
  const rel = String(value).replace(/\\/g, '/');
  if (!/^(?:node(?:\.exe)?|StarNet\.exe|skynet-desktop(?:\.exe)?|sidecar\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.(?:js|cjs|mjs))$/.test(rel)) {
    throw new Error('Unsupported application file: ' + value);
  }
  return rel;
}
function diskEvidence(root) {
  try {
    noLinks(root);
    if (!fs.statSync(root).isDirectory()) return { state: 'unverified', error: 'NOT_DIRECTORY' };
    const stat = fs.statfsSync(root, { bigint: true });
    return { state: 'observed', totalBytes: String(stat.blocks * stat.bsize), availableBytes: String(stat.bavail * stat.bsize), freeBytes: String(stat.bfree * stat.bsize) };
  } catch (error) { return { state: 'unverified', error: error.code || 'DISK_QUERY_ERROR' }; }
}
function signatureEvidence(file) {
  if (process.platform !== 'win32') return { state: 'unverified', reason: 'Authenticode is available only on Windows' };
  // Literal path comes through an environment value, never interpolated shell code.
  const shell = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const command = "$ErrorActionPreference='Stop'; $s=Get-AuthenticodeSignature -LiteralPath $env:STARNET_INTEGRITY_INSTALLER; [pscustomobject]@{status=[string]$s.Status; signatureType=[string]$s.SignatureType; signerSubject=$s.SignerCertificate.Subject; signerThumbprint=$s.SignerCertificate.Thumbprint; timestampSubject=$s.TimeStamperCertificate.Subject} | ConvertTo-Json -Compress";
  const result = spawnSync(shell, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', command], {
    env: { ...process.env, PSModulePath: path.join(path.dirname(shell), 'Modules'), STARNET_INTEGRITY_INSTALLER: file }, encoding: 'utf8', windowsHide: true, timeout: 15000, maxBuffer: 65536
  });
  if (result.error || result.status !== 0) return { state: 'unverified', error: result.error?.code || 'SIGNATURE_QUERY_FAILED' };
  try { return { state: 'observed', ...JSON.parse(result.stdout.trim()) }; }
  catch { return { state: 'unverified', error: 'SIGNATURE_RESPONSE_INVALID' }; }
}
function inspect({ installation, reference, installer, signature = false, files = DEFAULT_FILES }) {
  if (!installation) throw new Error('--installation is required');
  if (signature && !installer) throw new Error('--signature requires --installer');
  if (!files.length) throw new Error('Select at least one application file');
  const root = path.resolve(installation), ref = reference ? path.resolve(reference) : null;
  if (ref && (process.platform === 'win32' ? ref.toLowerCase() === root.toLowerCase() : ref === root)) throw new Error('Reference must be a separate extracted directory');
  // a mistyped --installation is an invalid invocation (exit 2), never a report that every selected file is "missing"
  const disk = diskEvidence(root);
  if (disk.state !== 'observed' && ['ENOENT', 'ENOTDIR', 'NOT_DIRECTORY'].includes(disk.error)) throw new Error('--installation is not an existing directory: ' + root);
  const rows = [...new Set(files.map(selectedPath))].map(relativePath => {
    const installed = readFileEvidence(path.join(root, relativePath));
    const expected = ref ? readFileEvidence(path.join(ref, relativePath)) : { state: 'unverified', error: 'REFERENCE_NOT_PROVIDED' };
    let comparison = 'unverified';
    if (installed.state === 'missing') comparison = 'missing';
    else if (installed.state === 'empty') comparison = 'empty';
    else if (installed.state === 'present' && expected.state === 'present') comparison = installed.sha256 === expected.sha256 ? 'match' : 'mismatch';
    return { relativePath, installed, reference: expected, comparison };
  });
  let packageEvidence = null;
  if (installer) {
    const file = path.resolve(installer), evidence = readFileEvidence(file);
    let sig = { state: 'unverified', reason: 'Signature query not requested' };
    if (signature && evidence.state === 'present') {
      sig = signatureEvidence(file);
      const after = readFileEvidence(file);
      if (after.state !== 'present' || after.sha256 !== evidence.sha256) sig = { state: 'unverified', error: 'INSTALLER_CHANGED_DURING_SIGNATURE_QUERY' };
    }
    packageEvidence = { path: file, ...evidence, signature: sig };
  }
  return {
    schema: 'starnet.installation-integrity.v1', observedAt: new Date().toISOString(), installation: root, reference: ref,
    scope: 'Selected files only; exact bytes from an explicitly extracted reference. No modules executed, profiles searched, repair attempted, or root cause inferred. This is not a full-tree or atomic snapshot.',
    files: rows, disk, installer: packageEvidence,
    summary: rows.reduce((counts, row) => { counts[row.comparison] = (counts[row.comparison] || 0) + 1; return counts; }, {})
  };
}
function main(argv) {
  const options = {}, files = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') { console.log('node scripts/qa/installation-integrity.cjs --installation DIR [--reference EXTRACTED_DIR] [--file RELATIVE_APP_FILE ...] [--installer FILE] [--signature]\nWrites JSON to stdout only. --file replaces defaults; --signature explicitly requests Windows Authenticode metadata.'); return; }
    if (arg === '--signature') { options.signature = true; continue; }
    if (!['--installation', '--reference', '--installer', '--file'].includes(arg) || !argv[i + 1] || argv[i + 1].startsWith('--')) throw new Error('Unknown option or missing value: ' + arg);
    const value = argv[++i];
    if (arg === '--file') files.push(value);
    else { const key = arg.slice(2); if (options[key]) throw new Error('Duplicate option: ' + arg); options[key] = value; }
  }
  if (files.length) options.files = files;
  const report = inspect(options);
  console.log(JSON.stringify(report, null, 2));
  // A diagnostic finding is a valid report, not a failed inspection invocation.
}
if (require.main === module) { try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = 2; } }
module.exports = { inspect, readFileEvidence, selectedPath, DEFAULT_FILES };
