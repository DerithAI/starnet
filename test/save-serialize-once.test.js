/* node test/save-serialize-once.test.js — one persist serializes the save once for the cache and reuses that string
   (idle CPU piece 3, 2026-10-20).

   THE COST. Every persist burst re-serialized the WHOLE save (Andrew's: 3.75 MB) again and again: Save.write stringified it,
   CloudSave.push cloned it with parse(stringify), the debounced flush stringified it for the POST, and the ACK re-parsed the
   cache and stringified BOTH sides to compare them before stringifying again for setItem — 6 whole-save stringifies and
   2 parses, a 50-200 ms main-thread stall each time on a big station.

   NOW: Save.write hands its string to push (one parse to clone), and an ACK whose cache still holds that exact string marks
   it clean with one stringify — 3 stringifies and 1 parse. THE BYTES DO NOT CHANGE: every cache write here is compared
   against the old algorithm's output (re-implemented below from the trunk code) byte for byte.

   GENUINE (executed): the real save.js and cloudsave.js run in one vm context with a JSON that counts whole-save calls,
   a Map localStorage and a fake /api/save that acknowledges. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const BIG = 500 * 1024;
function station() {
  let bigStringify = 0, bigParse = 0, ack = { ok: true, revision: 7, updatedAt: 1760000000123 }, posted = null;
  const cache = new Map();
  const counting = {
    stringify: (...a) => { const out = JSON.stringify(...a); if (out && out.length > BIG) bigStringify++; return out; },
    parse: (s, ...r) => { if (typeof s === 'string' && s.length > BIG) bigParse++; return JSON.parse(s, ...r); }
  };
  const ctx = vm.createContext({
    JSON: counting, console: { warn() {}, info() {}, log() {}, debug() {} }, Math, Date, Number, Object, Array, String, Promise, Error, Map, Set, WeakMap,
    setTimeout, clearTimeout, AbortController, crypto: { randomUUID: () => 'client-1' },
    module: { exports: {} }, require: () => require('../frontend/app/cloudsavecore.js'),
    localStorage: { getItem: k => (cache.has(k) ? cache.get(k) : null), setItem: (k, v) => cache.set(k, String(v)), removeItem: k => cache.delete(k) },
    fetch: async (url, opts) => { posted = opts && opts.body; return { ok: true, status: 200, json: async () => Object.assign({}, ack) }; }
  });
  vm.runInContext(read('frontend/app/save.js'), ctx, { filename: 'save.js' });
  vm.runInContext(read('frontend/app/cloudsave.js') + '\nthis.CloudSave = CloudSave;', ctx, { filename: 'cloudsave.js' });
  vm.runInContext('this.Save = Save;', ctx);
  return { Save: ctx.Save, CloudSave: ctx.CloudSave, cache, posted: () => posted, setAck: a => { ack = a; },
    counts: () => ({ stringify: bigStringify, parse: bigParse }), reset: () => { bigStringify = 0; bigParse = 0; } };
}
// a ~1 MB save shaped like a real one (the workstreams carry the bulk)
function bigState() {
  const workstreams = Array.from({ length: 60 }, (_, i) => ({ id: 'ws' + i, title: 'Session ' + i, agentId: 'agent', kind: 'chat', lane: 'active',
    history: Array.from({ length: 24 }, (_, j) => ({ role: j % 2 ? 'assistant' : 'user', content: ('message ' + i + '.' + j + ' ').repeat(40), ts: 1000 + j })) }));
  return { _saveDirty: true, _saveRevision: 0, agent: { id: 'agent', name: 'NOVA' }, usage: { tokens: 1, cost: 0, calls: 1 }, workstreams, activeId: 'ws0', generalId: 'ws0' };
}
// THE OLD ACK (trunk cloudsave.js), for the byte comparison: parse the cache, compare payloads, stamp + stringify
function oldAck(cachedRaw, sentDoc, revision, body) {
  const cached = JSON.parse(cachedRaw);
  const payload = d => JSON.stringify({ ...d, _saveClient: undefined, _saveRevision: undefined });
  if (!(cached && payload(cached) === payload(sentDoc))) return cachedRaw;
  cached._saveRevision = revision; cached._saveDirty = false;
  if (Number.isFinite(body.updatedAt)) cached.updatedAt = body.updatedAt;
  return JSON.stringify(cached);
}
// persist() as app.js does it: Save.write, then push the same envelope with the string the write produced
function persistLike(s, state) {
  const envelope = s.Save.envelope(state);
  const doc = s.Save.write(envelope);
  const raw = s.Save.takeWriteRaw();
  s.CloudSave.push(doc || envelope, { cacheFailed: !doc, cacheError: null, raw });
  return raw;
}

(async () => {
  A.ok(/const raw = Save\.takeWriteRaw \? Save\.takeWriteRaw\(\) : null;/.test(read('frontend/app/app.js')) && /CloudSave\.push\(doc \|\| envelope, \{[^}]*raw \}\)/.test(read('frontend/app/app.js')),
    'app.js persist() hands Save.write\'s string to CloudSave.push');

  /* one persist + flush + ACK on a ~1 MB save */
  {
    const s = station();
    s.reset();
    const raw = persistLike(s, bigState());
    A.ok(raw.length > BIG, 'fixture: the save is big (' + Math.round(raw.length / 1024) + ' KB)');
    A.eq(s.cache.get('starnet.save'), raw, 'the cache holds exactly the string Save.write produced');
    const sent = JSON.parse(raw); sent._saveRevision = 0; sent._saveClient = 'client-1';
    const expected = oldAck(raw, sent, 7, { updatedAt: 1760000000123 });
    A.eq(await s.CloudSave.flush({ force: true }), true, 'the station acknowledges the write');
    const c = s.counts();
    A.ok(c.stringify <= 3, 'one persist burst stringifies the whole save at most 3 times (was 6): ' + c.stringify);
    A.ok(c.parse <= 1, 'and parses it at most once (was 2): ' + c.parse);
    A.eq(s.cache.get('starnet.save'), expected, 'the cache bytes after the ACK are EXACTLY what the old compare path wrote');
    const landed = JSON.parse(s.cache.get('starnet.save'));
    A.ok(landed._saveDirty === false && landed._saveRevision === 7 && landed.updatedAt === 1760000000123, 'the cached save is clean, at the acknowledged revision and time');
    A.eq(JSON.stringify({ ...JSON.parse(s.posted()), _saveClient: undefined, _saveRevision: undefined }), JSON.stringify({ ...JSON.parse(raw), _saveRevision: undefined }), 'the POSTed save is the same save');
  }

  /* an ACK without updatedAt keeps the cache's own stamp — same bytes as before */
  {
    const s = station();
    s.setAck({ ok: true, revision: 3 });
    const raw = persistLike(s, bigState());
    const sent = JSON.parse(raw); sent._saveRevision = 0; sent._saveClient = 'client-1';
    const expected = oldAck(raw, sent, 3, {});
    await s.CloudSave.flush({ force: true });
    A.eq(s.cache.get('starnet.save'), expected, 'no updatedAt in the ACK: the same bytes the old path wrote');
  }

  /* the cache moved on (another window / a later write) before the ACK: the compare path decides, as before */
  {
    const s = station();
    const raw = persistLike(s, bigState());
    const other = JSON.parse(raw); other.workstreams[0].title = 'edited elsewhere';
    const otherRaw = JSON.stringify(other);
    s.cache.set('starnet.save', otherRaw);
    s.reset();
    await s.CloudSave.flush({ force: true });
    A.eq(s.cache.get('starnet.save'), otherRaw, 'a cache that holds a different save is left alone (the old compare path)');
    A.ok(s.counts().parse >= 1, 'that case still parses and compares, exactly as before');
  }

  /* a push without raw (any other caller): the old clone and the old compare path, the same bytes */
  {
    const s = station();
    const envelope = s.Save.envelope(bigState());
    const doc = s.Save.write(envelope); s.Save.takeWriteRaw();
    const raw = s.cache.get('starnet.save');
    s.CloudSave.push(doc, { cacheFailed: false });
    const sent = JSON.parse(raw); sent._saveRevision = 0; sent._saveClient = 'client-1';
    const expected = oldAck(raw, sent, 7, { updatedAt: 1760000000123 });
    await s.CloudSave.flush({ force: true });
    A.eq(s.cache.get('starnet.save'), expected, 'without raw: the old path, the same bytes');
  }

  /* a queued newer save while one is in flight: only the newest becomes clean (the existing rule) */
  {
    const s = station();
    persistLike(s, bigState());
    const first = s.CloudSave.flush({ force: true });
    const st2 = bigState(); st2.workstreams[1].title = 'newer';
    const raw2 = persistLike(s, st2);
    await first;
    A.eq(s.cache.get('starnet.save'), raw2, 'an ACK for an older save never touches the newer cached save');
    await s.CloudSave.flush({ force: true });
    const landed = JSON.parse(s.cache.get('starnet.save'));
    A.ok(landed._saveDirty === false && landed.workstreams[1].title === 'newer', 'the newest save becomes clean on its own ACK');
  }

  /* Save.write keeps its contract: the doc (or null), the same bytes in the cache */
  {
    const s = station();
    const env = s.Save.envelope({ agent: { id: 'agent' } });
    const doc = s.Save.write(env);
    A.eq(s.cache.get('starnet.save'), JSON.stringify(doc), 'Save.write caches JSON.stringify(doc), as before');
    A.eq(s.Save.takeWriteRaw(), s.cache.get('starnet.save'), 'takeWriteRaw is that same string');
    A.eq(s.Save.takeWriteRaw(), null, '…handed over once');
  }

  A.report('save-serialize-once.test');
})().catch(e => { console.error(e); process.exit(1); });
