'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { makeConnectorVault, FORMAT, lockMessage } = require('../sidecar/connector-vault.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-vault-'));
const file = path.join(root, 'state.json');
const legacy = path.join(root, 'oauth.json');
const keyHex = 'a1'.repeat(32);
const state = { version: 2, configs: [{ id: 'gmail' }], oauth: { byId: { gmail: { accessToken: 'ACCESS_CANARY', refreshToken: 'REFRESH_CANARY' } }, clients: {} } };
const make = extra => makeConnectorVault({ fs, path, keyHex, ...extra });
try {
  fs.writeFileSync(file, JSON.stringify(state));
  fs.writeFileSync(file + '.bak', JSON.stringify(state));
  fs.writeFileSync(legacy, JSON.stringify(state.oauth));
  fs.writeFileSync(legacy + '.bak', JSON.stringify(state.oauth));
  const broken = make({ writeDurable() { throw Error('disk full'); } });
  assert.throws(() => broken.migrate(file, state, [legacy]));
  assert.equal(JSON.parse(fs.readFileSync(legacy)).byId.gmail.refreshToken, 'REFRESH_CANARY');
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), state, 'failed migration preserves original main and legacy files');
  const vault = make();
  vault.migrate(file, state, [legacy]);
  assert.ok(!fs.existsSync(legacy) && !fs.existsSync(legacy + '.bak'));
  for (const f of [file, file + '.bak']) {
    const raw = fs.readFileSync(f, 'utf8');
    assert.equal(JSON.parse(raw).format, FORMAT);
    assert.ok(!raw.includes('CANARY') && !raw.includes(keyHex));
  }
  assert.deepEqual(make().load(file), state, 'same key opens after restart');
  const sanitize = require('../sidecar/station-recovery.js')._internals.sanitizeManagedJson;
  assert.throws(() => sanitize('connectors/state.json', fs.readFileSync(file)), /unlocked OS credential store/, 'portable backup cannot silently discard encrypted connector settings');
  const portable = sanitize('connectors/state.json', fs.readFileSync(file), { readConnectorState: () => make().load(file) });
  const portableState = JSON.parse(portable.data.toString());
  assert.equal(portableState.configs.length, state.configs.length, 'portable export keeps connector inventory');
  assert.deepEqual(portableState.oauth, { byId: {}, clients: {} }, 'portable export excludes decrypted OAuth credentials');
  const before = fs.readFileSync(file, 'utf8');
  assert.throws(() => vault.write(file, {}), /Invalid connector state/);
  assert.equal(fs.readFileSync(file, 'utf8'), before);
  for (const [supplied, reason] of [['', 'key-unavailable'], ['b2'.repeat(32), 'key-mismatch']]) {
    for (const required of [false, true]) {
      const missing = make({ keyHex: supplied, required });
      assert.throws(() => missing.load(file), /locked/);
      assert.equal(missing.lockReason, reason, 'the lock names why: ' + reason);
      assert.throws(() => missing.write(file, {}), /locked/);
      assert.equal(fs.readFileSync(file, 'utf8'), before, 'wrong or absent key cannot overwrite ciphertext');
    }
  }
  assert.match(lockMessage('key-unavailable', 'Platform secure storage failure: denied'), /locked.*Reason: Platform secure storage failure: denied\..*START FRESH/, 'the shell reason reaches the message');
  assert.match(lockMessage('key-mismatch'), /no longer has.*START FRESH/);
  const tampered = JSON.parse(before); tampered.tag = '00'.repeat(16);
  fs.writeFileSync(file, JSON.stringify(tampered));
  { const v = make(); assert.throws(() => v.load(file), /locked/, 'authentication failure is not an empty store or silent rollback'); assert.equal(v.lockReason, 'key-mismatch'); }
  fs.writeFileSync(file, '{');
  assert.deepEqual(make().load(file), state, 'torn JSON recovers encrypted backup');
  fs.writeFileSync(file, before);
  for (const invalid of [null, [], false, 0, 'unexpected']) {
    const bytes = JSON.stringify(invalid);
    fs.writeFileSync(file, bytes);
    const backup = fs.readFileSync(file + '.bak', 'utf8');
    const invalidVault = make();
    assert.throws(() => invalidVault.load(file), /locked/, 'present non-object state cannot authorize empty migration');
    assert.throws(() => invalidVault.migrate(file, state, [legacy]), /locked/);
    assert.equal(fs.readFileSync(file, 'utf8'), bytes, 'invalid authority is preserved');
    assert.equal(fs.readFileSync(file + '.bak', 'utf8'), backup, 'last-good backup is preserved');
  }
  fs.writeFileSync(file, before);
  const lockedFs = Object.create(fs);
  lockedFs.readFileSync = (target, ...args) => { if (target === file) throw Object.assign(Error('busy'), { code: 'EACCES' }); return fs.readFileSync(target, ...args); };
  assert.throws(() => make({ fs: lockedFs }).load(file), /locked/, 'unreadable main cannot roll back to backup');
  const clean = { version: 2, configs: [], oauth: { byId: {}, clients: {} } };
  vault.write(file, clean, { removal: true });
  assert.deepEqual(make().load(file), clean);
  fs.unlinkSync(file);
  assert.deepEqual(make().load(file), clean, 'removal also purges recovery copy');
  // Desktop expected a key but the OS store was unreachable, and NOTHING is sealed yet: work unencrypted,
  // say so (fallback), and seal it on the next launch that has the key (2026-10-11 user report: every sign-in
  // was refused on a fresh install).
  const fresh = path.join(root, 'new.json');
  const required = make({ keyHex: '', required: true });
  assert.equal(required.load(fresh), undefined, 'no saved data is honestly empty, not locked');
  assert.equal(required.fallback, true, 'missing desktop key is reported as an unencrypted fallback');
  assert.equal(required.protected, false);
  required.write(fresh, state);
  assert.deepEqual(JSON.parse(fs.readFileSync(fresh, 'utf8')), state, 'fallback store is plaintext JSON (and reported as such)');
  assert.equal(make({ required: true }).fallback, false, 'a real key is never a fallback');
  make().migrate(fresh, make().load(fresh), []);
  assert.equal(JSON.parse(fs.readFileSync(fresh, 'utf8')).format, FORMAT, 'the next keyed launch seals the fallback store');
  assert.ok(!fs.readFileSync(fresh + '.bak', 'utf8').includes('CANARY'), 'and its backup');
  const sealedAgain = make({ keyHex: '', required: true });
  assert.throws(() => sealedAgain.load(fresh), /locked/, 'once sealed, a missing key locks again instead of writing plaintext over it');
  assert.equal(sealedAgain.lockReason, 'key-unavailable');

  // START FRESH: every copy moves aside (never deleted), a new empty store is written, the lock clears.
  const legacyFresh = path.join(root, 'legacy.json');
  fs.writeFileSync(legacyFresh, '{"connectors":[]}');
  const sealedBytes = fs.readFileSync(fresh, 'utf8');
  const wrong = make({ keyHex: 'c3'.repeat(32) });
  assert.throws(() => wrong.load(fresh), /locked/);
  const out = wrong.startFresh(fresh, [legacyFresh], { stamp: '2026-10-11T12:00:00.000Z' });
  assert.deepEqual(out.moved.sort(), ['legacy.json', 'new.json', 'new.json.bak']);
  assert.equal(fs.readFileSync(path.join(out.movedTo, 'new.json'), 'utf8'), sealedBytes, 'the unreadable store is kept byte-for-byte');
  assert.ok(!fs.existsSync(legacyFresh), 'legacy copies moved too');
  assert.equal(wrong.locked, false);
  assert.deepEqual(make({ keyHex: 'c3'.repeat(32) }).load(fresh), { version: 2, configs: [], oauth: { byId: {}, clients: {} } }, 'new store opens with the current key after restart');
  assert.equal(JSON.parse(fs.readFileSync(fresh + '.bak', 'utf8')).format, FORMAT, 'new store has a sealed recovery copy');
  const clash = make({ keyHex: 'd4'.repeat(32) });
  assert.throws(() => clash.load(fresh), /locked/);
  fs.mkdirSync(path.join(root, 'unreadable-same'), { recursive: true });
  fs.writeFileSync(path.join(root, 'unreadable-same', 'new.json'), 'older');
  const clashBytes = fs.readFileSync(fresh, 'utf8');
  assert.throws(() => clash.startFresh(fresh, [], { stamp: 'same' }), /could not keep/);
  assert.equal(fs.readFileSync(fresh, 'utf8'), clashBytes, 'a blocked move changes nothing');
  assert.equal(clash.locked, true, 'and the vault stays locked');
  // START FRESH must remain locked and preserve the old copies through partial filesystem failures.
  function failedReset(label, inject) {
    const f = path.join(root, label + '.json');
    make().write(f, state);
    const originals = [f, f + '.bak'].map(p => [p, fs.readFileSync(p, 'utf8')]);
    const extra = inject(f);
    const v = make({ keyHex: 'e5'.repeat(32), ...extra });
    assert.throws(() => v.load(f), /locked/);
    assert.throws(() => v.startFresh(f, [], { stamp: label }), /failed|disk full|busy/);
    assert.equal(v.locked, true, label + ': failed reset stays locked');
    for (const [p, bytes] of originals) assert.equal(fs.readFileSync(p, 'utf8'), bytes, label + ': original restored');
    assert.deepEqual(make().load(f), state, label + ': original account can recover after restart');
  }
  failedReset('second-move', f => {
    const brokenFs = Object.create(fs);
    brokenFs.unlinkSync = target => { if (target === f + '.bak') throw Error('busy'); return fs.unlinkSync(target); };
    return { fs: brokenFs };
  });
  failedReset('copy-readback', f => {
    const corruptFs = Object.create(fs);
    corruptFs.copyFileSync = (from, to, flags) => {
      fs.copyFileSync(from, to, flags);
      if (to.includes('unreadable-copy-readback')) fs.writeFileSync(to, 'corrupt copy');
    };
    return { fs: corruptFs };
  });
  failedReset('new-write', f => ({ writeDurable(io, target, data) {
    if (target === f + '.bak') throw Error('disk full');
    fs.writeFileSync(target, data);
  } }));
  const stuckFile = path.join(root, 'rollback-blocked.json');
  make().write(stuckFile, state);
  const stuckBytes = fs.readFileSync(stuckFile, 'utf8');
  const stuckFs = Object.create(fs);
  stuckFs.copyFileSync = (from, to, flags) => { if (from.includes('unreadable-rollback-blocked')) throw Error('restore busy'); return fs.copyFileSync(from, to, flags); };
  const stuck = make({ keyHex: 'e5'.repeat(32), fs: stuckFs, writeDurable(io, target, data) {
    if (target === stuckFile) throw Error('disk full');
    fs.writeFileSync(target, data);
  } });
  assert.throws(() => stuck.load(stuckFile), /locked/);
  assert.throws(() => stuck.startFresh(stuckFile, [], { stamp: 'rollback-blocked' }), /did not fully restore/);
  assert.equal(fs.readFileSync(path.join(root, 'unreadable-rollback-blocked', 'rollback-blocked.json'), 'utf8'), stuckBytes, 'failed rollback preserves the original in recovery');
  assert.throws(() => make().load(stuckFile), /locked/, 'failed rollback stays locked across restart');
  // security-storage-04: a retry RESUMES the unfinished reset instead of refusing forever. While the disk still
  // fails it fails again and stays locked; once the disk works, START FRESH finishes and the copies stay put.
  assert.equal(make().lockReason, '', 'a fresh vault starts unlocked');
  { const v = make(); assert.throws(() => v.load(stuckFile), /locked/); assert.equal(v.lockReason, 'reset-interrupted', 'the lock names the interrupted reset, not a damaged file'); }
  assert.throws(() => stuck.startFresh(stuckFile, [], { stamp: 'retry' }), /START FRESH failed/, 'a retry on a still-failing disk fails again');
  assert.ok(fs.existsSync(stuckFile + '.reset-pending'), 'and keeps the recovery marker');
  assert.equal(fs.readFileSync(path.join(root, 'unreadable-rollback-blocked', 'rollback-blocked.json'), 'utf8'), stuckBytes, 'and the earlier recovery copy');
  const finished = make().startFresh(stuckFile, [], { stamp: 'retry-ok' });
  assert.deepEqual(finished.previous, [path.join(root, 'unreadable-rollback-blocked')], 'the finished reset reports where the earlier copies are');
  assert.ok(!fs.existsSync(stuckFile + '.reset-pending'), 'a finished reset clears the marker');
  assert.deepEqual(make().load(stuckFile), { version: 2, configs: [], oauth: { byId: {}, clients: {} } }, 'and opens as a new empty store');
  assert.equal(fs.readFileSync(path.join(root, 'unreadable-rollback-blocked', 'rollback-blocked.json'), 'utf8'), stuckBytes, 'the earlier recovery copy is never touched');
  // A successful readback can be served from the page cache. Recovery files and their directory
  // entries must be flushed before the first original is removed; rollback has the same barrier.
  function tracedResetFs(recovery, { failFlush = () => false, failUnlink = () => false } = {}) {
    const traced = Object.create(fs), descriptors = new Map(), events = [];
    let directoryFd = -100;
    traced.openSync = (target, ...args) => {
      const directory = target === root || target === recovery;
      // Model a filesystem that supports directory flush even on Windows, where Node cannot open it.
      const fd = directory ? directoryFd-- : fs.openSync(target, ...args);
      descriptors.set(fd, { target, directory });
      return fd;
    };
    traced.fsyncSync = fd => {
      const row = descriptors.get(fd);
      if (failFlush(row.target, row.directory)) throw Object.assign(Error('flush failed'), { code: 'EIO' });
      if (!row.directory) fs.fsyncSync(fd);
      events.push(['flush', row.target]);
    };
    traced.closeSync = fd => {
      const row = descriptors.get(fd);
      descriptors.delete(fd);
      if (!row.directory) fs.closeSync(fd);
    };
    traced.copyFileSync = (from, to, flags) => { fs.copyFileSync(from, to, flags); events.push(['copy', to, flags]); };
    traced.readFileSync = (target, ...args) => { const data = fs.readFileSync(target, ...args); events.push(['read', target]); return data; };
    traced.unlinkSync = target => {
      events.push(['unlink', target]);
      if (failUnlink(target)) throw Error('busy');
      return fs.unlinkSync(target);
    };
    return { fs: traced, events };
  }
  function resetFixture(label) {
    const f = path.join(root, label + '.json'), recovery = path.join(root, 'unreadable-' + label);
    make().write(f, state);
    return { f, recovery, originals: [f, f + '.bak'].map(p => [p, fs.readFileSync(p)]) };
  }
  {
    const { f, recovery, originals } = resetFixture('flush-order');
    const trace = tracedResetFs(recovery);
    make({ fs: trace.fs }).startFresh(f, [], { stamp: 'flush-order' });
    const firstDelete = trace.events.findIndex(e => e[0] === 'unlink' && originals.some(([p]) => e[1] === p));
    for (const [original] of originals) {
      const saved = path.join(recovery, path.basename(original));
      const copied = trace.events.findIndex(e => e[0] === 'copy' && e[1] === saved && e[2] === fs.constants.COPYFILE_EXCL);
      const read = trace.events.findIndex((e, i) => i > copied && e[0] === 'read' && e[1] === saved);
      const flushed = trace.events.findIndex(e => e[0] === 'flush' && e[1] === saved);
      assert.ok(copied >= 0 && read > copied && flushed > read && flushed < firstDelete, 'exclusive, verified recovery copy is durable before any original deletion');
    }
    const recoveryFlush = trace.events.findIndex(e => e[0] === 'flush' && e[1] === recovery);
    const parentFlush = trace.events.findIndex((e, i) => i > recoveryFlush && e[0] === 'flush' && e[1] === root);
    assert.ok(recoveryFlush >= 0 && parentFlush > recoveryFlush && parentFlush < firstDelete, 'recovery entries and their parent are flushed before originals disappear');
  }
  for (const failure of ['file', 'directory', 'parent']) {
    const label = 'flush-fail-' + failure, { f, recovery, originals } = resetFixture(label);
    let recoveryWasFlushed = false;
    const trace = tracedResetFs(recovery, { failFlush(target, directory) {
      if (target === recovery) recoveryWasFlushed = true;
      return failure === 'file' ? !directory && target === path.join(recovery, path.basename(f) + '.bak')
        : failure === 'directory' ? target === recovery : target === root && recoveryWasFlushed;
    } });
    const v = make({ fs: trace.fs });
    assert.throws(() => v.startFresh(f, [], { stamp: label }), /START FRESH failed/);
    assert.equal(v.locked, true, failure + ' flush failure leaves the in-memory vault locked');
    assert.ok(!trace.events.some(e => e[0] === 'unlink' && originals.some(([p]) => e[1] === p)), failure + ' flush failure never attempts deletion of an original');
    for (const [original, bytes] of originals) assert.deepEqual(fs.readFileSync(original), bytes);
    assert.deepEqual(make().load(f), state, failure + ' flush failure preserves the last good state across restart');
  }
  for (const restoreFailure of ['none', 'file', 'directory']) {
    const label = 'restore-flush-' + restoreFailure, { f, recovery, originals } = resetFixture(label);
    let restoring = false;
    const trace = tracedResetFs(recovery, {
      failUnlink: target => { if (target === f + '.bak') { restoring = true; return true; } return false; },
      failFlush: target => restoring && (restoreFailure === 'file' ? target === f : restoreFailure === 'directory' && target === root)
    });
    const v = make({ fs: trace.fs });
    assert.throws(() => v.startFresh(f, [], { stamp: label }), /START FRESH failed/);
    assert.equal(v.locked, true);
    const marker = f + '.reset-pending';
    if (restoreFailure !== 'none') {
      assert.ok(fs.existsSync(marker), 'rollback flush failure retains the durable recovery marker');
      assert.ok(!trace.events.some(e => e[0] === 'unlink' && e[1] === marker), 'unflushed rollback never attempts to clear the marker');
      assert.throws(() => make().load(f), /locked/, 'rollback flush failure stays locked after restart');
    } else {
      const copied = trace.events.findIndex(e => e[0] === 'copy' && e[1] === f);
      const flushed = trace.events.findIndex((e, i) => i > copied && e[0] === 'flush' && e[1] === f);
      const dirFlushed = trace.events.findIndex((e, i) => i > flushed && e[0] === 'flush' && e[1] === root);
      const clear = trace.events.findIndex(e => e[0] === 'unlink' && e[1] === marker);
      assert.ok(copied >= 0 && flushed > copied && dirFlushed > flushed && clear > dirFlushed, 'restored bytes and location are durable before clearing the marker');
      assert.deepEqual(make().load(f), state);
    }
    for (const [original, bytes] of originals) {
      assert.deepEqual(fs.readFileSync(original), bytes);
      assert.deepEqual(fs.readFileSync(path.join(recovery, path.basename(original))), bytes, 'durable recovery bytes survive rollback errors');
    }
  }
  // A process may terminate after parking both copies. The persisted marker prevents an empty-store boot.
  const interrupted = path.join(root, 'interrupted.json');
  fs.writeFileSync(interrupted + '.reset-pending', JSON.stringify({ movedTo: path.join(root, 'unreadable-interrupted') }));
  const restarted = make();
  assert.throws(() => restarted.load(interrupted), /locked/, 'unfinished recovery never looks like a new empty store');
  assert.equal(restarted.lockReason, 'reset-interrupted');
  // security-storage-05: antivirus/backup holding the file at boot is not "damaged", and START FRESH is not the fix
  {
    const f = path.join(root, 'busy.json');
    make().write(f, state);
    const heldFs = code => Object.assign(Object.create(fs), { readFileSync(target, ...args) {
      if (target === f) throw Object.assign(Error(code + ': resource busy or locked'), { code });
      return fs.readFileSync(target, ...args);
    } });
    const held = make({ fs: heldFs('EBUSY') });
    assert.throws(() => held.load(f), /locked/);
    assert.equal(held.lockReason, 'busy', 'a file another program holds is locked as busy');
    assert.deepEqual(held.lockDetail, { readCode: 'EBUSY' }, 'and keeps the read error for the message');
    const msg = lockMessage('busy', '', held.lockDetail);
    assert.match(msg, /could not read the saved file \(EBUSY\).*antivirus.*safe and unchanged.*Restart StarNet/, msg);
    assert.doesNotMatch(msg, /damaged/, 'it is not called damaged');
    // restart comes first; START FRESH stays a named exit for a file that is still locked after a restart (a
    // persistent EPERM), so the vault never locks with no way out — and never steers to it before a restart
    assert.match(msg, /Restart StarNet to try again\. If it is still locked after a restart, START FRESH/, msg);
    { const v = make({ fs: heldFs('EPERM') }); assert.throws(() => v.load(f), /locked/); assert.equal(v.lockReason, 'busy', 'EPERM (Windows sharing/access denial) is busy too'); }
    { const v = make({ fs: heldFs('EIO') }); assert.throws(() => v.load(f), /locked/); assert.equal(v.lockReason, 'unreadable', 'a disk I/O error stays unreadable'); }
    { const v = make({ fs: heldFs('EACCES') }); assert.throws(() => v.load(f), /locked/); assert.equal(v.lockReason, 'unreadable', 'POSIX EACCES is not a passing hold (the credential-recovery fault hosts rely on it)'); }
    assert.deepEqual(make().load(f), state, 'once the file is free the same store opens');
  }
  // security-storage-04: an interrupted reset says so, names the folder, and START FRESH finishes it.
  assert.match(lockMessage('reset-interrupted', '', { movedTo: path.join(root, 'unreadable-x') }), /START FRESH was interrupted.*not deleted.*unreadable-x.*START FRESH to finish/);
  assert.doesNotMatch(lockMessage('reset-interrupted'), /damaged|newer StarNet/, 'an interrupted reset is not called a damaged file');
  // ...but only promises START FRESH finishes it when START FRESH can: a marker that cannot be checked gets the
  // by-hand steps instead of a button that will always refuse
  {
    assert.match(restarted.lockDetail.unfinishable || '', /does not list the files it moved/, 'the lock knows the record cannot be checked');
    const msg = lockMessage('reset-interrupted', '', restarted.lockDetail);
    assert.match(msg, /cannot be finished automatically, because its record does not list the files it moved.*unreadable-interrupted.*restart StarNet/, msg);
    assert.doesNotMatch(msg, /Press START FRESH to finish/, 'it does not promise a finish that START FRESH would refuse');
  }
  // a marker this build never writes (no sources list) cannot be checked: refuse, name the marker, change nothing
  assert.throws(() => restarted.startFresh(interrupted, [], { stamp: 'no-sources' }), e => {
    assert.match(e.message, /interrupted\.json\.reset-pending/, 'the refusal names the marker');
    assert.match(e.message, /unreadable-interrupted/, 'and the recovery folder');
    assert.doesNotMatch(e.message, /Restore the original files before retrying/, 'and never gives advice that cannot clear the marker');
    return true;
  });
  assert.ok(fs.existsSync(interrupted + '.reset-pending') && !fs.existsSync(path.join(root, 'unreadable-no-sources')), 'a refused resume changes nothing');
  // crash during the copy phase: every original still in place, the recovery folder only partly written
  {
    const f = path.join(root, 'crash-copy.json'), old = path.join(root, 'unreadable-crash-copy');
    make().write(f, state);
    const bytes = [f, f + '.bak'].map(p => fs.readFileSync(p));
    fs.mkdirSync(old);
    fs.writeFileSync(path.join(old, 'crash-copy.json'), 'partial');
    fs.writeFileSync(f + '.reset-pending', JSON.stringify({ movedTo: old, sources: ['crash-copy.json', 'crash-copy.json.bak'] }));
    const v = make();
    assert.throws(() => v.load(f), /locked/);
    assert.equal(v.lockReason, 'reset-interrupted');
    assert.deepEqual(v.lockDetail, { movedTo: old }, 'the lock carries the folder for the message');
    const r = v.startFresh(f, [], { stamp: 'crash-copy-2' });
    const fresh = path.join(root, 'unreadable-crash-copy-2');
    assert.equal(r.movedTo, fresh);
    assert.deepEqual(r.previous, [old]);
    assert.deepEqual([f, f + '.bak'].map(p => fs.readFileSync(path.join(fresh, path.basename(p)))), bytes, 'the originals are kept in the new folder');
    assert.equal(fs.readFileSync(path.join(old, 'crash-copy.json'), 'utf8'), 'partial', 'the earlier folder is left as it was');
    assert.ok(!fs.existsSync(f + '.reset-pending'), 'the marker is cleared');
    assert.equal(v.locked, false);
    assert.deepEqual(make().load(f), { version: 2, configs: [], oauth: { byId: {}, clients: {} } }, 'and the store opens empty after restart');
  }
  // a marker whose listed files are in neither place cannot be finished safely: refuse and name both paths
  {
    const f = path.join(root, 'lost.json'), old = path.join(root, 'unreadable-lost');
    fs.writeFileSync(f + '.reset-pending', JSON.stringify({ movedTo: old, sources: ['lost.json'] }));
    const v = make();
    assert.throws(() => v.load(f), /locked/);
    assert.match(v.lockDetail.unfinishable || '', /lost\.json is in neither/, 'the lock names the missing file');
    assert.doesNotMatch(lockMessage('reset-interrupted', '', v.lockDetail), /Press START FRESH to finish/, 'and does not promise a finish');
    assert.throws(() => make().startFresh(f, [], { stamp: 'lost-2' }), e => /lost\.json\.reset-pending/.test(e.message) && /unreadable-lost/.test(e.message));
    assert.ok(fs.existsSync(f + '.reset-pending'), 'the marker stays, so the store stays locked');
  }
  console.log('connector-vault: PASS (AES-GCM, restart, tampering, missing/wrong key + reasons, migration failure, recovery, removal, labelled fallback, durable START FRESH + fail-closed rollback)');
} finally { fs.rmSync(root, { recursive: true, force: true }); }
