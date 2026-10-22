/* node test/onepassword.test.js — 1Password secret references in the KEYS tab (sidecar/onepassword.js + the
   op:// half of sidecar/servicekeys.js).

   Proves:
     A. the reference grammar: op://vault/item/[section/]field, one line, bounded.
     B. the store keeps ONLY the reference (no key field ever), switches cleanly between a pasted key and a reference,
        and toPublic shows the reference + the host's last read, never a value or a last4 of it.
     C. the reader runs `op read --no-newline <ref>` as argv with an explicit minimal env (OP_* kept, station secrets
        and other API keys NOT), and turns every failure into a named, actionable code.
     D. the cache: a value is held in memory only, a failed re-read keeps the last good value and says so, a changed
        reference never serves the old item's value, unattended surfaces only touch granted rows, and a run does not
        wait twice on a 1Password that just failed.
     E. the spenders: resolveForRequest says "unresolved" (not "no such key"), promptBlock names an unreadable row with
        its reason instead of advertising it, and applyEnv/runEnv hand a read value to the shell. */
'use strict';
const A = require('./_assert.js');
const K = require('../sidecar/servicekeys.js');
const OP = require('../sidecar/onepassword.js');
const path = require('path');

const REF = 'op://Private/Stripe/credential';

// ---- A. reference grammar ----
{
  A.ok(K.isOpRef(REF), 'op:// is a reference');
  A.ok(!K.isOpRef('sk_live_abc'), 'a pasted key is not');
  A.ok(K.validateOpRef(REF).ok, 'vault/item/field');
  A.ok(K.validateOpRef('op://Dev Vault/Acme API/keys/credential').ok, 'spaces + a section are allowed');
  A.ok(K.validateOpRef('op://Private/Item/one-time password?attribute=otp').ok, 'a query attribute is allowed');
  A.ok(!K.validateOpRef('op://Private/Stripe').ok, 'vault/item without a field refused');
  A.ok(!K.validateOpRef('op://Private//credential').ok, 'an empty segment refused');
  A.ok(!K.validateOpRef('op://a/b/c/d/e').ok, 'too many segments refused');
  A.ok(!K.validateOpRef('op://Private/Stripe/cred\nx').ok, 'a line break refused');
  A.ok(!K.validateOpRef('op://' + 'a/'.repeat(300) + 'b').ok, 'an oversize reference refused');
  A.ok(K.validate({ name: 'Stripe', key: 'op://Dev Vault/Stripe/credential' }).ok, 'validate accepts a reference with spaces (a pasted key may not have them)');
  A.ok(!K.validate({ name: 'Stripe', key: 'op://Private/Stripe' }).ok, 'validate refuses a malformed reference');
}

// ---- B. the store keeps only the reference ----
{
  const r1 = K.upsert([], { name: 'Stripe', key: REF }, 1000);
  A.ok(!r1.error, 'a reference saves');
  A.eq(r1.record.ref, REF, 'the reference is stored');
  A.ok(!('key' in r1.record), 'a reference row has NO key field at all');
  A.eq(r1.record.envVar, 'STRIPE_API_KEY', 'same env var as a pasted key');
  A.eq(r1.record.autonomous, false, 'unattended grant still defaults OFF');

  const kept = K.upsert(r1.list, { name: 'Stripe', key: '' }, 2000);
  A.eq(kept.record.ref, REF, 'an empty key on update keeps the reference');
  const pasted = K.upsert(kept.list, { name: 'Stripe', key: 'sk_live_NEW1234' }, 3000);
  A.ok(!('ref' in pasted.record) && pasted.record.key === 'sk_live_NEW1234', 'a pasted key replaces the reference');
  const back = K.upsert(pasted.list, { name: 'Stripe', key: REF }, 4000);
  A.ok(!('key' in back.record) && back.record.ref === REF, 'a reference replaces a pasted key');
  A.eq(back.list.length, 1, 'still one row');

  const pub = K.toPublic(Object.assign({}, r1.record, { key: 'sk_live_SECRETVALUE', refReadAt: 5000, refError: '' }));
  A.eq(pub.source, '1password', 'source named');
  A.eq(pub.ref, REF, 'reference shown');
  A.eq(pub.last4, '', 'no last4 of a value read from the vault');
  A.eq(pub.refReady, true, 'ready when the live row holds a value');
  A.eq(pub.refReadAt, 5000, 'the host read time');
  A.ok(JSON.stringify(pub).indexOf('SECRETVALUE') < 0, 'toPublic never carries the value');
  A.eq(K.toPublic(r1.record).refReady, false, 'a persisted row (no value) is not ready');
  const plain = K.toPublic({ id: 'resend', name: 'Resend', envVar: 'RESEND_API_KEY', key: 'rk_abcd1234' });
  A.ok(!('source' in plain) && plain.last4 === '····1234', 'a pasted row keeps its exact old shape');
}

// ---- C. the reader ----
function fakeExec(script) {
  const calls = [];
  const execFile = (bin, args, opts, cb) => { calls.push({ bin, args, opts }); setImmediate(() => script(cb, args)); return { stdin: { end() {} } }; };
  return { execFile, calls };
}
const winEnv = { Path: 'C:\\tools;C:\\Windows', SYSTEMROOT: 'C:\\Windows', USERPROFILE: 'C:\\Users\\x', LOCALAPPDATA: 'C:\\Users\\x\\AppData\\Local',
  OP_SERVICE_ACCOUNT_TOKEN: 'ops_tok', OP_ACCOUNT: 'my', STARNET_API_TOKEN: 'station-secret', SKYNET_IPC_TOKEN: 'ipc', RESEND_API_KEY: 'rk_other', OPENAI_API_KEY: 'sk-x' };
const onPath = p => p === path.win32.join('C:\\tools', 'op.exe');

(async () => {
  {
    const ex = fakeExec(cb => cb(null, 'sk_live_FROMVAULT\n', ''));
    const reader = OP.makeOpReader({ execFile: ex.execFile, env: winEnv, platform: 'win32', exists: onPath, join: path.win32.join });
    const r = await reader.read(REF, { timeoutMs: 5000 });
    A.eq(r, { ok: true, value: 'sk_live_FROMVAULT' }, 'reads the value, trailing newline dropped');
    const c = ex.calls[0];
    A.eq(c.bin, 'C:\\tools\\op.exe', 'op found on PATH (Windows spells it Path)');
    A.eq(c.args, ['read', '--no-newline', REF], 'argv: read --no-newline <ref>');
    A.eq(c.opts.timeout, 5000, 'bounded by the timeout');
    A.ok(c.opts.env.OP_SERVICE_ACCOUNT_TOKEN === 'ops_tok' && c.opts.env.OP_ACCOUNT === 'my', 'the user\'s OP_* vars reach op');
    A.ok(c.opts.env.Path && c.opts.env.SYSTEMROOT && c.opts.env.USERPROFILE, 'the OS basics reach op');
    A.ok(!('STARNET_API_TOKEN' in c.opts.env) && !('SKYNET_IPC_TOKEN' in c.opts.env), 'no station secret reaches op');
    A.ok(!('RESEND_API_KEY' in c.opts.env) && !('OPENAI_API_KEY' in c.opts.env), 'no other API key reaches op');
  }
  {
    const reader = OP.makeOpReader({ execFile: () => { throw new Error('unused'); }, env: { PATH: '/nowhere' }, platform: 'linux', exists: () => false, join: path.posix.join });
    const r = await reader.read(REF, {});
    A.eq(r.code, 'not-installed', 'no op anywhere -> not-installed');
    A.ok(/Integrate with 1Password CLI/.test(r.message), 'the message says how to fix it');
  }
  {
    const seen = [];
    OP.findOp({ env: { PATH: '/usr/bin' }, platform: 'darwin', exists: p => { seen.push(p); return p === '/opt/homebrew/bin/op'; }, join: path.posix.join });
    A.ok(seen.indexOf('/opt/homebrew/bin/op') >= 0, 'a Mac app (no shell PATH) still finds Homebrew\'s op');
  }
  const failWith = async (err, stderr, out) => {
    const ex = fakeExec(cb => cb(err, out || '', stderr || ''));
    return OP.makeOpReader({ execFile: ex.execFile, env: winEnv, platform: 'win32', exists: onPath, join: path.win32.join }).read(REF, {});
  };
  A.eq((await failWith(Object.assign(new Error('spawn op ENOENT'), { code: 'ENOENT' }))).code, 'not-installed', 'ENOENT -> not-installed');
  A.eq((await failWith(Object.assign(new Error('killed'), { killed: true, signal: 'SIGTERM' }))).code, 'timeout', 'killed by the timeout -> timeout');
  const locked = await failWith(new Error('exit 1'), '[ERROR] 2026/10/18 12:00:00 You are not currently signed in. Please run `op signin --help` for instructions');
  A.eq(locked.code, 'locked', 'not signed in -> locked');
  A.ok(/unlock the 1Password app/.test(locked.message) && /not currently signed in/.test(locked.message), 'locked says what to do and what op said');
  A.ok(!/\[ERROR\]|2026\/10\/18/.test(locked.message), 'op\'s log prefix is stripped');
  A.eq((await failWith(new Error('exit 1'), '[ERROR] 2026/10/18 12:00:00 authorization prompt dismissed, please try again')).code, 'locked', 'dismissed approval -> locked');
  const nf = await failWith(new Error('exit 1'), '[ERROR] 2026/10/18 12:00:00 could not read secret \'op://Private/Strip/credential\': "Strip" isn\'t an item in the "Private" vault');
  A.eq(nf.code, 'not-found', 'unknown item -> not-found');
  A.eq((await failWith(new Error('exit 1'), 'something odd happened')).code, 'failed', 'anything else -> failed, with op\'s words');
  A.eq((await failWith(null, '', 'two words')).code, 'bad-value', 'a value with a space is not a key');
  A.eq((await failWith(null, '', 'line1\nline2')).code, 'bad-value', 'a multi-line field is not a key');
  A.eq((await failWith(null, '', '')).code, 'bad-value', 'an empty field is not a key');

  // ---- D. the cache ----
  {
    let clock = 1000;
    let answers = [];
    const reads = [];
    const reader = { read: (ref) => { reads.push(ref); const a = answers.shift() || { ok: false, code: 'locked', message: 'locked' }; return Promise.resolve(a); } };
    let changes = 0;
    const cache = OP.makeRefCache({ reader, now: () => clock, sleep: () => new Promise(() => {}), refreshMs: 600000, retryMs: 60000, onChange: () => { changes++; } });
    const row = { id: 'stripe', name: 'Stripe', envVar: 'STRIPE_API_KEY', ref: REF, enabled: true, autonomous: false };
    const list = [row, { id: 'resend', name: 'Resend', envVar: 'RESEND_API_KEY', key: 'rk_x', enabled: true }];

    let live = cache.live(list);
    A.eq(live[0].key, '', 'nothing read yet -> no value');
    A.ok(/^not read yet/.test(live[0].refError), 'and the row says it reads on use');
    A.eq(live[1], list[1], 'a pasted row passes through untouched');
    A.ok(!('key' in list[0]), 'live() never mutates the persisted list');

    answers.push({ ok: true, value: 'sk_live_ONE' });
    await cache.refresh(row, { timeoutMs: 1000 });
    live = cache.live(list);
    A.eq(live[0].key, 'sk_live_ONE', 'a read value is served live');
    A.eq(live[0].refReadAt, 1000, 'with the read time');
    A.eq(changes, 1, 'a new value fires onChange (the env is re-applied)');

    clock += 700000;   // stale
    answers.push({ ok: false, code: 'locked', message: '1Password did not answer' });
    A.eq(await cache.ensureFresh(list, { surface: 'interactive', waitMs: 10 }), false, 'a stale value does not hold the run');
    await new Promise(r => setImmediate(r));
    live = cache.live(list);
    A.eq(live[0].key, 'sk_live_ONE', 'a failed re-read KEEPS the last good value');
    A.ok(/latest re-read failed/.test(live[0].refError), 'and says the re-read failed');

    const moved = Object.assign({}, row, { ref: 'op://Private/Other/credential' });
    A.eq(cache.live([moved])[0].key, '', 'a changed reference never serves the old item\'s value');

    // unattended surface: a row without the grant is not even read
    const fresh = OP.makeRefCache({ reader, now: () => clock, sleep: () => Promise.resolve() });
    const before = reads.length;
    await fresh.ensureFresh([row], { surface: 'autonomous', waitMs: 10 });
    A.eq(reads.length, before, 'an unattended run does not read a row without the unattended grant');
    answers.push({ ok: true, value: 'sk_live_TWO' });
    await fresh.ensureFresh([Object.assign({}, row, { autonomous: true })], { surface: 'autonomous', waitMs: 10 });
    await new Promise(r => setImmediate(r));
    A.eq(reads.length, before + 1, 'a granted row is read for an unattended run');

    // a first read that fails is not retried by the next run inside the retry window
    const flaky = OP.makeRefCache({ reader, now: () => clock, sleep: () => Promise.resolve(), retryMs: 60000 });
    const n0 = reads.length;
    await flaky.ensureFresh([row], { surface: 'interactive', waitMs: 10 });
    await new Promise(r => setImmediate(r));
    await flaky.ensureFresh([row], { surface: 'interactive', waitMs: 10 });
    A.eq(reads.length, n0 + 1, 'a 1Password that just failed is not waited on again');
    A.ok(/locked/.test(flaky.live([row])[0].refError), 'the failure is what the row and the prompt report');
    clock += 61000;
    await flaky.ensureFresh([row], { surface: 'interactive', waitMs: 10 });
    A.eq(reads.length, n0 + 2, 'after the window it is tried again');

    // concurrent reads of one row share one op call
    const slowReads = [];
    const slow = OP.makeRefCache({ reader: { read: () => new Promise(res => slowReads.push(res)) }, now: () => clock });
    const p1 = slow.refresh(row); const p2 = slow.refresh(row);
    await new Promise(r => setImmediate(r));
    A.eq(slowReads.length, 1, 'one op call while a read is in flight');
    slowReads[0]({ ok: true, value: 'sk_live_X' });
    await Promise.all([p1, p2]);

    // a row removed while 1Password answers does not come back
    const gone = OP.makeRefCache({ reader: { read: () => Promise.resolve({ ok: true, value: 'sk_live_LATE' }) }, now: () => clock });
    const pending = gone.refresh(row); gone.drop('stripe'); await pending;
    A.eq(gone.live([row])[0].key, '', 'a dropped row never gets the late value');
  }

  // ---- E. the spenders ----
  {
    const unread = { id: 'stripe', name: 'Stripe', envVar: 'STRIPE_API_KEY', ref: REF, enabled: true, autonomous: true, key: '', refError: '1Password did not answer' };
    const r = K.resolveForRequest([unread], 'STRIPE_API_KEY', 'interactive');
    A.eq(r.reason, 'unresolved', 'an unread 1Password row is "unresolved", not "no such key"');
    A.ok(/did not answer/.test(r.detail), 'with the reason');
    const ready = Object.assign({}, unread, { key: 'sk_live_READY', refError: '' });
    A.eq(K.resolveForRequest([ready], 'STRIPE_API_KEY', 'interactive').value, 'sk_live_READY', 'a read row resolves like a pasted key');
    A.eq(K.resolveForRequest([Object.assign({}, ready, { autonomous: false })], 'STRIPE_API_KEY', 'autonomous').reason, 'unattended', 'the unattended grant still applies');

    const onlyUnread = K.promptBlock([unread]);
    A.ok(/kept in 1Password/.test(onlyUnread) && /did not answer/.test(onlyUnread), 'an unreadable row is named with its reason');
    A.ok(/none is in your environment/.test(onlyUnread), 'and NOT advertised as present');
    const mixed = K.promptBlock([unread, { id: 'resend', name: 'Resend', envVar: 'RESEND_API_KEY', key: 'rk_x', enabled: true }]);
    A.ok(/RESEND_API_KEY/.test(mixed) && /Not available for this run:\n- Stripe/.test(mixed), 'mixed: usable keys first, then the unreadable one');
    A.ok(mixed.indexOf('rk_x') < 0, 'still no value in the prompt');
    A.eq(K.promptBlock([Object.assign({}, unread, { enabled: false })]), '', 'a disabled reference adds nothing');
    A.eq(K.promptBlock([{ id: 'stripe', name: 'Stripe', envVar: 'STRIPE_API_KEY', ref: REF, enabled: true }]).length > 0, true, 'a persisted ref row (never read) is still named, as unreadable');

    const env = {};
    const owned = K.applyEnv([ready], env, {});
    A.eq(env.STRIPE_API_KEY, 'sk_live_READY', 'applyEnv hands a read value to the host env');
    A.eq(K.runEnv([ready], env, { surface: 'interactive' }), { STRIPE_API_KEY: 'sk_live_READY' }, 'and runEnv to the shell child');
    K.applyEnv([unread], env, owned);
    A.ok(!('STRIPE_API_KEY' in env), 'an unread row clears what was applied before');
  }

  A.report('onepassword.test');
})();
