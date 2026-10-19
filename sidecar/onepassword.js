/* sidecar/onepassword.js — 1Password secret references for the KEYS tab.

   A KEYS entry may hold `op://vault/item/[section/]field` instead of a pasted key (servicekeys.js stores ONLY the
   reference, `ref`). This module reads the value with the 1Password CLI (`op read`) when it is needed and keeps it
   in MEMORY only — never on disk, never on the bus, never in an /api response. The agent still sees the env-var
   NAME only, exactly as for a pasted key.

   Two parts, both dependency-injected (no ambient clock, no ambient child_process):
     makeOpReader({ execFile, env, platform, exists, join })
       read(ref, { timeoutMs }) -> Promise<{ ok:true, value } | { ok:false, code, message }>
       `op` runs with an EXPLICIT minimal environment (the OS basics it needs to start plus the user's own OP_*
       variables — OP_SERVICE_ACCOUNT_TOKEN, OP_ACCOUNT, OP_CONNECT_*), never the sidecar's process.env, so no
       station secret reaches it. Codes: not-installed · locked · not-found · timeout · bad-value · failed.
     makeRefCache({ reader, now, sleep, refreshMs, retryMs, onChange })
       live(list)                 -> the list every key SPENDER reads: a ref row carries the value last read (or none,
                                     plus refError), and refReadAt for the panel. Pure; never mutates `list`.
       refresh(record, { timeoutMs }) -> one read now (deduped per row while in flight)
       ensureFresh(list, { surface, waitMs, timeoutMs }) -> before a run: reads the rows that run may spend and has no
                                     value for (waits at most waitMs); re-reads a stale value in the background
       drop(id) / clear()          -> forget a removed row / everything (a reset)
   A failed re-read KEEPS the last good value (a locked 1Password must not pull a key that worked ten minutes ago)
   and reports the failure next to it. Unattended surfaces only touch rows carrying the unattended grant. */
'use strict';
const { swallow } = require('./failopen.js');
const { validateOpRef, KEY_MAX } = require('./servicekeys.js');

const REFRESH_MS = 15 * 60 * 1000;   // a value older than this is re-read in the background before the next run
const RETRY_MS = 60 * 1000;          // after a failed first read, runs in this window do not wait on 1Password again
const OUTPUT_MAX = 64 * 1024;

// What `op` needs to start and to reach the 1Password app (named pipe / socket under the user's profile). Matched
// case-insensitively: Windows spells PATH as Path.
const BASE_ENV = ['PATH', 'PATHEXT', 'SYSTEMROOT', 'WINDIR', 'COMSPEC', 'HOME', 'USERPROFILE', 'HOMEDRIVE', 'HOMEPATH',
  'APPDATA', 'LOCALAPPDATA', 'PROGRAMDATA', 'TEMP', 'TMP', 'TMPDIR', 'USER', 'USERNAME', 'LOGNAME', 'LANG', 'LC_ALL',
  'XDG_CONFIG_HOME', 'XDG_RUNTIME_DIR', 'DBUS_SESSION_BUS_ADDRESS'];
function opChildEnv(env) {
  const src = env || {};
  const want = new Set(BASE_ENV);
  const out = {};
  for (const k of Object.keys(src)) {
    const v = src[k];
    if (v == null) continue;
    if (want.has(k.toUpperCase()) || /^OP_/i.test(k)) out[k] = String(v);
  }
  return out;
}

// The CLI's absolute path, or ''. PATH first; then the places the installers put it, because an app started from
// Finder / the Start menu does not see a shell's PATH (Homebrew's /opt/homebrew/bin is the usual miss on a Mac).
function findOp({ env, platform, exists, join }) {
  const e = env || {};
  const win = platform === 'win32';
  const name = win ? 'op.exe' : 'op';
  const pathVar = Object.keys(e).find(k => k.toUpperCase() === 'PATH');
  const dirs = String((pathVar && e[pathVar]) || '').split(win ? ';' : ':').map(d => d.trim().replace(/^"|"$/g, '')).filter(Boolean);
  if (win) {
    const local = e.LOCALAPPDATA || e.LocalAppData || '';
    const pf = e.ProgramFiles || e.PROGRAMFILES || '';
    if (local) dirs.push(join(local, 'Microsoft', 'WinGet', 'Links'));
    if (pf) dirs.push(join(pf, '1Password CLI'));
  } else {
    dirs.push('/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/snap/bin');
  }
  for (const d of dirs) {
    const p = join(d, name);
    let hit = false;
    try { hit = !!exists(p); } catch (e) { swallow('onepassword.find')(e); }
    if (hit) return p;
  }
  return '';
}

const MSG = {
  'not-installed': 'the 1Password CLI (op) is not installed. Install it, then in the 1Password app turn on Settings → Developer → Integrate with 1Password CLI',
  locked: '1Password did not answer: open and unlock the 1Password app, then approve StarNet when it asks (unattended runs need a 1Password service account: set OP_SERVICE_ACCOUNT_TOKEN before starting StarNet)',
  timeout: '1Password did not answer in time: open and unlock the 1Password app, then approve StarNet when it asks',
  'bad-value': 'that 1Password field is not a single-line key (it is empty, has spaces or line breaks, or is too long). Point the reference at the field that holds the API key',
};
// `op` prints "[ERROR] 2026/10/18 12:00:00 <message>". Keep the message, one line, bounded.
function opMessage(stderr) {
  const line = String(stderr || '').split(/\r?\n/).map(s => s.trim()).find(Boolean) || '';
  return line.replace(/^\[ERROR\]\s*(\d{4}\/\d{2}\/\d{2}\s+\d{2}:\d{2}:\d{2}\s*)?/i, '').slice(0, 240);
}
function classify(err, stderr) {
  if (err && err.code === 'ENOENT') return { code: 'not-installed', message: MSG['not-installed'] };
  if (err && (err.killed || err.signal === 'SIGTERM' || err.code === 'ETIMEDOUT')) return { code: 'timeout', message: MSG.timeout };
  const said = opMessage(stderr) || String((err && err.message) || 'op failed').slice(0, 240);
  if (/isn'?t (an item|a vault|a field)|could not find (an? )?(item|vault|field|section)|(item|vault|field) .*not found|does not have a field|no such (item|vault|field)|invalid secret reference/i.test(said)) {
    return { code: 'not-found', message: '1Password has no such vault, item or field: ' + said };
  }
  if (/signed in|sign ?in|authori[sz]|prompt dismissed|desktop app|unlock|locked|session expired|unauthori[sz]ed|\b401\b|service account/i.test(said)) {
    return { code: 'locked', message: MSG.locked + ' (1Password said: ' + said + ')' };
  }
  return { code: 'failed', message: '1Password could not read it: ' + said };
}

function makeOpReader(deps) {
  const d = deps || {};
  const platform = d.platform || 'linux';
  return {
    read(ref, opts) {
      const v = validateOpRef(ref);
      if (!v.ok) return Promise.resolve({ ok: false, code: 'not-found', message: v.error });
      const bin = findOp({ env: d.env, platform, exists: d.exists, join: d.join });
      if (!bin) return Promise.resolve({ ok: false, code: 'not-installed', message: MSG['not-installed'] });
      const timeoutMs = Math.max(1000, Number(opts && opts.timeoutMs) || 60000);
      return new Promise(resolve => {
        let child = null;
        try {
          // argv, never a shell: the reference starts with op:// so it cannot be read as a flag
          child = d.execFile(bin, ['read', '--no-newline', v.ref], {
            env: opChildEnv(d.env), timeout: timeoutMs, maxBuffer: OUTPUT_MAX, windowsHide: true, encoding: 'utf8'
          }, (err, stdout, stderr) => {
            if (err) return resolve(Object.assign({ ok: false }, classify(err, stderr)));
            const value = String(stdout || '').replace(/\r?\n$/, '');
            if (!value || value.length > KEY_MAX || /[^!-~]/.test(value)) return resolve({ ok: false, code: 'bad-value', message: MSG['bad-value'] });
            resolve({ ok: true, value: value });
          });
        } catch (e) { resolve(Object.assign({ ok: false }, classify(e, ''))); }
        if (child && child.stdin && typeof child.stdin.end === 'function') child.stdin.end();   // op never waits on a prompt here
      });
    }
  };
}

function makeRefCache(deps) {
  const d = deps || {};
  const reader = d.reader;
  const now = typeof d.now === 'function' ? d.now : () => 0;
  const sleep = typeof d.sleep === 'function' ? d.sleep : (() => new Promise(() => {}));
  const refreshMs = Number.isFinite(d.refreshMs) ? d.refreshMs : REFRESH_MS;
  const retryMs = Number.isFinite(d.retryMs) ? d.retryMs : RETRY_MS;
  const onChange = typeof d.onChange === 'function' ? d.onChange : () => {};
  const slots = new Map();   // row id -> { ref, value, readAt, error, failedAt, inflight }

  // a changed reference starts a fresh slot: a value read for the old item is never served for the new one
  function slotFor(r) {
    let s = slots.get(r.id);
    if (!s || s.ref !== r.ref) { s = { ref: r.ref, value: '', readAt: 0, error: '', failedAt: 0, inflight: null }; slots.set(r.id, s); }
    return s;
  }
  function refresh(record, opts) {
    if (!record || !record.ref || !record.id) return Promise.resolve(null);
    const s = slotFor(record);
    if (s.inflight) return s.inflight;
    s.inflight = Promise.resolve()
      .then(() => reader.read(record.ref, { timeoutMs: opts && opts.timeoutMs }))
      .then(res => {
        s.inflight = null;
        if (slots.get(record.id) !== s) return null;   // removed or re-pointed while 1Password was answering
        if (res && res.ok) {
          const changed = s.value !== res.value;
          s.value = res.value; s.readAt = now(); s.error = ''; s.failedAt = 0;
          if (changed) onChange();
        } else {
          s.error = String((res && res.message) || '1Password could not be read'); s.failedAt = now();
        }
        return { ok: !!(res && res.ok), error: s.error, readAt: s.readAt };
      }, e => {
        s.inflight = null;
        s.error = '1Password could not be read: ' + String((e && e.message) || e).slice(0, 200); s.failedAt = now();
        return { ok: false, error: s.error, readAt: s.readAt };
      });
    return s.inflight;
  }
  // The rows THIS run may spend: enabled, and on an unattended surface only those carrying the unattended grant.
  function eligible(list, surface) {
    const unattended = surface && surface !== 'interactive';
    return (Array.isArray(list) ? list : []).filter(r => r && r.ref && r.id && r.enabled !== false &&
      (!unattended || (r.autonomous === true && r.unattendedSupported !== false)));
  }
  async function ensureFresh(list, opts) {
    const o = opts || {};
    const waits = [];
    for (const r of eligible(list, o.surface)) {
      const s = slotFor(r);
      if (s.value) {
        if (now() - s.readAt >= refreshMs && !s.inflight) refresh(r, { timeoutMs: o.timeoutMs }).catch(swallow('onepassword.refresh'));
        continue;
      }
      if (s.inflight) { waits.push(s.inflight); continue; }
      if (s.failedAt && now() - s.failedAt < retryMs) continue;   // it just failed: this run is told why, not held again
      waits.push(refresh(r, { timeoutMs: o.timeoutMs }));
    }
    if (!waits.length) return false;
    await Promise.race([Promise.all(waits), sleep(Math.max(0, Number(o.waitMs) || 0))]);
    return true;
  }
  function live(list) {
    return (Array.isArray(list) ? list : []).map(r => {
      if (!r || !r.ref || !r.id) return r;
      const s = slots.get(r.id);
      const fresh = s && s.ref === r.ref ? s : null;
      const value = fresh ? fresh.value : '';
      const error = !fresh ? 'not read yet: StarNet reads it from 1Password when an agent needs it'
        : (value ? (fresh.error ? 'the latest re-read failed: ' + fresh.error : '')
          : (fresh.error || (fresh.inflight ? 'reading from 1Password…' : 'not read yet: StarNet reads it from 1Password when an agent needs it')));
      return Object.assign({}, r, { key: value, refReadAt: fresh ? fresh.readAt : 0, refError: error });
    });
  }
  function drop(id) { slots.delete(String(id || '')); }
  function clear() { slots.clear(); }
  return { refresh, ensureFresh, live, drop, clear, eligible };
}

module.exports = { REFRESH_MS, RETRY_MS, opChildEnv, findOp, classify, opMessage, makeOpReader, makeRefCache };
