/* sidecar/maps/community.js — the station's side of the community maps gallery (2026-10-18).

   READ: the gallery index on starnetos.com is fetched through the Skill Market's SSRF-guarded document fetcher and
   believed only when its detached Ed25519 signature verifies with a key the app trusts (sidecar/skills/market-
   signing.js) and its serial is not lower than one this station already saw. A map's build file and picture are
   believed only when they hash to the sha256 the signed index pins. The page then builds a map through BuildShare.
   readBuild (layout only) and the presets' own confirm, backup and undo; nothing here touches the floor.

   SHARE: build mode hands over a cleaned build (BuildShare.exportBuild) and a still of the station; this forwards
   them to the linked StarNet account (starnet-cloud POST /v1/maps/submit, the device token) and reports exactly
   what the cloud answered. A share is a request for review, never a publication.

   Pure factory (lint-determinism): every IO is injected. index.js composes it.

   makeCommunityMaps({ fetchDocument, signing, trustedKeys, catalogUrl: () => url|'', cloud: () => ({ url, token }),
                       fetch, now }) -> { catalog({ refresh }), file(slug, version, which), share(body), mine() } */
'use strict';

const fmt = require('./maps-format.js');

const INDEX_MAX = 2 * 1024 * 1024;
const CACHE_MS = 5 * 60 * 1000;
const SHARE_TIMEOUT_MS = 60000;
const MINE_TIMEOUT_MS = 15000;

function makeCommunityMaps(deps) {
  const { fetchDocument, signing, trustedKeys, catalogUrl, cloud, fetch, now } = deps;
  let cached = null, cachedAt = 0, highestSerial = 0;

  function indexUrl() { const u = String((catalogUrl && catalogUrl()) || '').trim(); return u; }
  function fileUrl(base, path) { return new URL('/' + String(path).replace(/^\/+/, ''), base).href; }

  async function catalog(opts) {
    const url = indexUrl();
    if (!url) return { ok: false, off: true, error: 'The community gallery is switched off on this station.' };
    if (cached && !(opts && opts.refresh) && now() - cachedAt < CACHE_MS) return cached;
    const [doc, sig] = await Promise.all([
      fetchDocument(url, { maxBytes: INDEX_MAX, label: 'the community gallery' }),
      fetchDocument(signing.sigUrl(url), { maxBytes: 8192, label: 'the gallery signature' })
    ]);
    signing.verify(doc.bytes, sig.text, trustedKeys);   // throws a sentence on a forged or unsigned gallery
    let parsed;
    try { parsed = JSON.parse(doc.text); } catch (_) { throw new Error('the community gallery is not readable'); }
    const out = fmt.readCatalog(parsed);
    // a signed but OLDER gallery (a replayed copy) is refused for the life of this sidecar
    if (out.serial < highestSerial) throw new Error('the community gallery is older than one this station already read');
    highestSerial = out.serial;
    cached = { ok: true, serial: out.serial, maps: out.maps, base: url };
    cachedAt = now();
    return cached;
  }

  /* file(slug, version, 'build'|'still') -> { bytes, type } — only the exact bytes the signed index pins */
  async function file(slug, version, which) {
    const c = await catalog({});
    if (!c.ok) throw new Error(c.error);
    const entry = c.maps.find(m => m.slug === String(slug) && m.version === Number(version));
    if (!entry) throw new Error('That map is not in the community gallery.');
    const f = which === 'still' ? entry.still : entry.build;
    const got = await fetchDocument(fileUrl(c.base, f.path), { maxBytes: which === 'still' ? fmt.MAX_STILL_BYTES : fmt.MAX_BUILD_BYTES, label: which === 'still' ? 'the map picture' : 'the map' });
    if (fmt.sha256hex(got.bytes) !== f.sha256) throw new Error(which === 'still' ? 'The map picture does not match the gallery.' : 'The map file does not match the gallery, so it was not opened.');
    return { bytes: got.bytes, type: which === 'still' ? 'image/png' : 'application/json' };
  }

  function linked() {
    const c = (cloud && cloud()) || {};
    return c.url && c.token ? { url: String(c.url).replace(/\/+$/, ''), token: String(c.token) } : null;
  }
  async function call(method, path, body, timeoutMs) {
    const c = linked();
    if (!c) return { ok: false, status: 401, linked: false, error: 'Link this station to a StarNet account to share maps.' };
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let res, text = '';
    try {
      res = await fetch(c.url + path, {
        method, signal: ctrl.signal,
        headers: Object.assign({ authorization: 'Bearer ' + c.token }, body ? { 'content-type': 'application/json' } : {}),
        body: body ? JSON.stringify(body) : undefined
      });
      text = await res.text();
    } catch (e) {
      return { ok: false, status: 0, linked: true, error: ctrl.signal.aborted ? 'StarNet did not answer in time. Nothing was shared; try again.' : 'Could not reach StarNet. Nothing was shared.' };
    } finally { clearTimeout(timer); }
    let json = null;
    try { json = JSON.parse(text); } catch (_) { json = null; }
    if (res.ok && json && json.ok) return Object.assign({ ok: true, status: res.status, linked: true }, json);
    const msg = json && json.error && (json.error.message || json.error);
    return { ok: false, status: res.status, linked: res.status !== 401, error: typeof msg === 'string' && msg ? msg : 'StarNet refused the map (HTTP ' + res.status + ').' };
  }

  /* share({ title, description, credit, agree, build, still }) -> what the cloud answered, verbatim */
  async function share(b) {
    const body = {
      title: String(b && b.title || ''), description: String(b && b.description || ''), credit: String(b && b.credit || ''),
      agree: !!(b && b.agree === true), build: String(b && b.build || ''), still: String(b && b.still || '')
    };
    return call('POST', '/v1/maps/submit', body, SHARE_TIMEOUT_MS);
  }
  function mine() { return call('GET', '/v1/maps/mine', null, MINE_TIMEOUT_MS); }

  return { catalog, file, share, mine, linked: () => !!linked() };
}

module.exports = { makeCommunityMaps };
