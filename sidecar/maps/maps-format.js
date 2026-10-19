/* sidecar/maps/maps-format.js — the community maps gallery's catalog format (2026-10-18).

   A community map is a station LAYOUT a player shared from build mode (frontend/app/buildshare.js, the same cleaner on
   export and import) plus a picture of that station. Players share on their linked station; a person approves each
   one on account.starnetos.com; the publisher's PC re-cleans the build, signs the gallery and deploys it with the
   website (scripts/pull-map-submissions.mjs → scripts/build-map-catalog.mjs). Stations and the website read:

     https://starnetos.com/.well-known/starnet-maps.json        the index (this format), signed like the Skill Market
     https://starnetos.com/.well-known/starnet-maps.json.sig    (sidecar/skills/market-signing.js, the same keys)
     https://starnetos.com/maps/<slug>/<version>/build.starnet-build.json   immutable, pinned by sha256 in the index
     https://starnetos.com/maps/<slug>/<version>/still.png                  immutable, pinned by sha256 in the index

   A map is only ever DATA: a station builds it through BuildShare.readBuild, which strips anything that is not layout,
   then through the same confirm, backup and undo a preset gets. There is nothing to install and nothing to revoke —
   a map taken out of the sources simply stops being listed.

   Pure: no network, no clock, no fs. */
'use strict';

const crypto = require('node:crypto');

const FORMAT = 'starnet-maps/v1';
const LICENSE = 'CC-BY-4.0';
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const BUILD_FILE = 'build.starnet-build.json';
const STILL_FILE = 'still.png';
const MAX_MAPS = 2000;
const MAX_BUILD_BYTES = 2 * 1024 * 1024;
// under the guarded fetcher's 4,000,000-byte ceiling (sidecar/skills/exchange-fetch.js), above the cloud's 3.75 MiB
const MAX_STILL_BYTES = 3990000;
const LIMITS = Object.freeze({ title: 40, description: 200, credit: 40 });
// each map is a folder named after it, and Windows cannot have a folder with these names (git cannot add one)
const RESERVED_RE = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])$/;
const nameOk = slug => SLUG_RE.test(slug) && slug.length <= 48 && !RESERVED_RE.test(slug);

const str = v => (v == null ? '' : String(v));
const sha256hex = b => crypto.createHash('sha256').update(b).digest('hex');
const isObj = x => x != null && typeof x === 'object' && !Array.isArray(x);
const whole = (v, lo, hi) => Number.isSafeInteger(v) && v >= lo && v <= hi;
// display text from the catalog: printable, one line, capped (the cloud already refused markup in credits)
function cleanText(s, max) {
  let out = '';
  for (const ch of str(s)) { const c = ch.codePointAt(0); out += (c < 32 || (c >= 127 && c < 160) || c === 0x2028 || c === 0x2029) ? ' ' : ch; }
  return out.replace(/\s+/g, ' ').trim().slice(0, max);
}

/* pngSize(bytes) -> { width, height } from a PNG's IHDR, or null when the bytes are not a PNG */
function pngSize(bytes) {
  const b = Buffer.isBuffer(bytes) ? bytes : Buffer.from(bytes || []);
  const SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (b.length < 24 || SIG.some((v, i) => b[i] !== v) || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  const width = b.readUInt32BE(16), height = b.readUInt32BE(20);
  return width > 0 && height > 0 ? { width, height } : null;
}

/* cloudDigest(buildText, png) -> the digest starnet-cloud src/mapsubs.js mapDigest records at upload, so the PC can
   prove it is building exactly the map the reviewer approved */
function cloudDigest(buildText, png) {
  const head = Buffer.from('build\u0000' + sha256hex(Buffer.from(str(buildText), 'utf8')) + '\nstill\u0000');
  return sha256hex(Buffer.concat([head, Buffer.from(sha256hex(png))]));
}

const filePath = (slug, version, name) => 'maps/' + slug + '/' + version + '/' + name;

/* buildEntry(meta, buildBytes, stillBytes) -> the index entry for one published map version. Throws a sentence. */
function buildEntry(meta, buildBytes, stillBytes) {
  const slug = str(meta && meta.slug);
  if (!nameOk(slug)) throw new Error((slug || 'a map') + ': bad name');
  if (!whole(meta.version, 1, 100000)) throw new Error(slug + ': version must be a whole number from 1');
  const title = cleanText(meta.title, LIMITS.title);
  if (!title) throw new Error(slug + ': no title');
  const credit = cleanText(meta.credit, LIMITS.credit);
  if (!credit) throw new Error(slug + ': no credit');
  if (meta.license !== LICENSE) throw new Error(slug + ': every community map is ' + LICENSE);
  const b = Buffer.isBuffer(buildBytes) ? buildBytes : Buffer.from(str(buildBytes), 'utf8');
  if (!b.length || b.length > MAX_BUILD_BYTES) throw new Error(slug + ': the build is empty or too large');
  const s = Buffer.isBuffer(stillBytes) ? stillBytes : null;
  const size = s && pngSize(s);
  if (!size || s.length > MAX_STILL_BYTES) throw new Error(slug + ': the picture is not a PNG, or is too large');
  const st = isObj(meta.stats) ? meta.stats : {};
  const count = v => (whole(v, 0, 100000) ? v : 0);
  return {
    slug, version: meta.version, title, description: cleanText(meta.description, LIMITS.description), credit, license: LICENSE,
    stats: { rooms: count(st.rooms), props: count(st.props), belts: count(st.belts), lines: count(st.lines), steps: count(st.steps) },
    build: { path: filePath(slug, meta.version, BUILD_FILE), sha256: sha256hex(b), bytes: b.length },
    still: { path: filePath(slug, meta.version, STILL_FILE), sha256: sha256hex(s), bytes: s.length, width: size.width, height: size.height }
  };
}

/* catalogDocument(entries, { serial }) -> the index document, newest-first is the website's choice, so entries are
   kept in a stable order (by slug) here and the serial carries change */
function catalogDocument(entries, opts) {
  const maps = (entries || []).slice().sort((a, b) => (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  return { format: FORMAT, serial: (opts && opts.serial) || 1, license: LICENSE, maps };
}

function serialOf(doc) { return doc && Number.isSafeInteger(doc.serial) && doc.serial > 0 ? doc.serial : 0; }

/* readCatalog(doc) -> { serial, maps } with every entry re-checked; malformed entries are dropped, an unsupported
   document throws. What a station or the website may show comes only from here. */
function readCatalog(doc) {
  if (!isObj(doc) || doc.format !== FORMAT || !serialOf(doc) || !Array.isArray(doc.maps)) throw new Error('the community maps gallery returned an unsupported catalog');
  const maps = [], seen = new Set();
  for (const e of doc.maps.slice(0, MAX_MAPS)) {
    if (!isObj(e) || !nameOk(str(e.slug)) || seen.has(e.slug) || !whole(e.version, 1, 100000)) continue;
    const file = (f, name) => isObj(f) && f.path === filePath(e.slug, e.version, name) && /^[0-9a-f]{64}$/.test(str(f.sha256)) && whole(f.bytes, 1, name === BUILD_FILE ? MAX_BUILD_BYTES : MAX_STILL_BYTES);
    if (!file(e.build, BUILD_FILE) || !file(e.still, STILL_FILE)) continue;
    const title = cleanText(e.title, LIMITS.title), credit = cleanText(e.credit, LIMITS.credit);
    if (!title || !credit) continue;
    const st = isObj(e.stats) ? e.stats : {};
    const count = v => (whole(v, 0, 100000) ? v : 0);
    seen.add(e.slug);
    maps.push({
      slug: e.slug, version: e.version, title, credit, description: cleanText(e.description, LIMITS.description), license: LICENSE,
      stats: { rooms: count(st.rooms), props: count(st.props), belts: count(st.belts), lines: count(st.lines), steps: count(st.steps) },
      build: { path: e.build.path, sha256: e.build.sha256, bytes: e.build.bytes },
      still: { path: e.still.path, sha256: e.still.sha256, bytes: e.still.bytes, width: whole(e.still.width, 1, 8192) ? e.still.width : 0, height: whole(e.still.height, 1, 8192) ? e.still.height : 0 }
    });
  }
  return { serial: doc.serial, maps };
}

module.exports = { FORMAT, LICENSE, SLUG_RE, nameOk, BUILD_FILE, STILL_FILE, MAX_BUILD_BYTES, MAX_STILL_BYTES, LIMITS, sha256hex, cleanText, pngSize, cloudDigest, buildEntry, catalogDocument, serialOf, readCatalog };
