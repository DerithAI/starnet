#!/usr/bin/env node
/* scripts/build-map-catalog.mjs — build the community maps gallery into website/ (2026-10-18).

   Sources (written by scripts/pull-map-submissions.mjs, committed):
     maps-catalog/maps/<slug>/map.json                    { slug, version, title, description, credit, license, stats, submission }
     maps-catalog/maps/<slug>/build.starnet-build.json    the layout, re-cleaned by the app's own BuildShare when pulled
     maps-catalog/maps/<slug>/still.png                   the picture the reviewer approved
   Output (served by starnetos.com, Cloudflare Pages):
     website/.well-known/starnet-maps.json      the index (sidecar/maps/maps-format.js)
     website/.well-known/starnet-maps.json.sig  an Ed25519 signature over it, byte for byte (the Skill Market's keys)
     website/maps/<slug>/<version>/<files>      one immutable folder per published version

   Every build is read AGAIN through frontend/app/buildshare.js: a source the importer's cleaner would refuse, or
   would have to strip anything from (crew, instructions, folders, made props), fails the build. A published version
   can never change: to update a map, the pull adds a new version. To TAKE A MAP DOWN, set "takenDown": true in its
   map.json (keep the folder, so its name and version history stay) and rebuild: it is no longer listed.

   NOTHING IS WRITTEN UNLESS EVERYTHING CHECKS OUT: every problem (an edited published version, a source the cleaner
   refuses, no signing key for a changed index) is found first, and then either all files are written or none.

   SIGNING: a build that changes the index bumps its serial and re-signs with the private key
   (STARNET_SKILL_MARKET_KEY, else ~/.starnet-keys/skill-market.key), and only ever with a key the APP trusts — a
   gallery signed with anything else is one every shipped station refuses. Tests add their own key with
   STARNET_MAPS_TEST_KEYS (never set it for a real build). --check needs only the public keys.

   node scripts/build-map-catalog.mjs          write (and sign) the gallery
   node scripts/build-map-catalog.mjs --check  exit 1 if website/ does not match the sources or the signature does not verify */
import { createRequire } from 'node:module';
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fmt = require(join(ROOT, 'sidecar/maps/maps-format.js'));
const signing = require(join(ROOT, 'sidecar/skills/market-signing.js'));

const SRC = process.env.STARNET_MAPS_SRC || join(ROOT, 'maps-catalog', 'maps');
const OUT = process.env.STARNET_MAPS_OUT || join(ROOT, 'website');
const INDEX = join(OUT, '.well-known', 'starnet-maps.json');
const SIGNING_KEY = process.env.STARNET_SKILL_MARKET_KEY || join(homedir(), '.starnet-keys', 'skill-market.key');
// the keys every shipped station trusts — and, for tests only, an extra key named by STARNET_MAPS_TEST_KEYS
const KEYS = signing.TRUSTED_KEYS.concat(signing.keysFromEnv(process.env.STARNET_MAPS_TEST_KEYS));

/* the app's own cleaner, loaded the way test/build-share.test.js loads it */
export function loadCleaner() {
  const M = require(join(ROOT, 'frontend/app/worldmodel.js'));
  const Sprites = require(join(ROOT, 'frontend/app/propsprites.js'));
  const B = require(join(ROOT, 'frontend/app/buildshare.js'));
  M.setPropRules(t => { const s = Sprites.spec(t); return s ? { mount: s.mount || null, stack: !!s.stack, surface: !!s.surface, flat: !!s.flat } : null; });
  /* clean(text, name) -> { ok, text, stats, dropped } | { ok:false, message }: read through the importer's cleaner,
     then written back by the exporter, so a pulled file is in the exporter's exact form */
  return function clean(text, name) {
    const r = B.readBuild(text, M, 1);
    if (!r.ok) return { ok: false, message: r.message };
    const out = B.exportBuild(r.doc, M, { name: name || r.name });
    if (out.error) return { ok: false, message: 'the cleaned build could not be written (' + out.error + ')' };
    return { ok: true, text: out.text, stats: out.stats, dropped: r.dropped };
  };
}

/* the highest version of <slug> already published in website/maps (a taken-down map keeps its folders there) */
export function publishedVersions(slug, out) {
  const dir = join(out || OUT, 'maps', slug);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter(n => /^[0-9]+$/.test(n) && statSync(join(dir, n)).isDirectory()).map(Number).sort((a, b) => a - b);
}

export function buildCatalog() {
  const clean = loadCleaner();
  const folders = existsSync(SRC) ? readdirSync(SRC).filter(n => statSync(join(SRC, n)).isDirectory()).sort() : [];
  const built = [], problems = [];
  for (const slug of folders) {
    const base = join(SRC, slug);
    if (!existsSync(join(base, 'map.json'))) { problems.push(slug + ': missing map.json'); continue; }
    const meta = JSON.parse(readFileSync(join(base, 'map.json'), 'utf8'));
    if (meta.slug !== slug) { problems.push(slug + ': map.json slug must match its folder'); continue; }
    if (meta.takenDown === true) continue;   // kept for its name and history, no longer listed
    for (const f of [fmt.BUILD_FILE, fmt.STILL_FILE]) if (!existsSync(join(base, f))) problems.push(slug + ': missing ' + f);
    if (problems.some(p => p.startsWith(slug + ':'))) continue;
    const buildText = readFileSync(join(base, fmt.BUILD_FILE), 'utf8');
    const c = clean(buildText, meta.title);
    if (!c.ok) { problems.push(slug + ': the app\'s cleaner refuses it: ' + c.message); continue; }
    if (c.dropped && (c.dropped.work || c.dropped.made)) { problems.push(slug + ': the build still carries crew, instructions or made props'); continue; }
    const still = readFileSync(join(base, fmt.STILL_FILE));
    try { built.push({ entry: fmt.buildEntry(Object.assign({}, meta, { stats: c.stats }), Buffer.from(buildText, 'utf8'), still), buildBytes: Buffer.from(buildText, 'utf8'), still }); }
    catch (e) { problems.push(String(e && e.message || e)); }
  }
  const entries = built.map(b => b.entry);
  const prior = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;
  const priorSerial = fmt.serialOf(prior);
  const bodyOf = doc => { const copy = Object.assign({}, doc); delete copy.serial; return JSON.stringify(copy); };
  const unchanged = priorSerial && bodyOf(prior) === bodyOf(fmt.catalogDocument(entries, { serial: priorSerial }));
  const serial = !priorSerial ? 1 : unchanged ? priorSerial : priorSerial + 1;
  return { index: fmt.catalogDocument(entries, { serial }), built, problems };
}

function main() {
  const check = process.argv.includes('--check');
  const result = buildCatalog();
  const problems = result.problems.slice();
  const writes = [];
  for (const b of result.built) {
    writes.push({ path: join(OUT, ...b.entry.build.path.split('/')), bytes: b.buildBytes, immutable: true, label: b.entry.build.path });
    writes.push({ path: join(OUT, ...b.entry.still.path.split('/')), bytes: b.still, immutable: true, label: b.entry.still.path });
  }
  const indexBytes = Buffer.from(JSON.stringify(result.index, null, 2) + '\n', 'utf8');
  writes.push({ path: INDEX, bytes: indexBytes, immutable: false, label: '.well-known/starnet-maps.json' });
  const pending = [];
  for (const w of writes) {
    const exists = existsSync(w.path);
    if (exists && Buffer.compare(readFileSync(w.path), w.bytes) === 0) continue;
    if (exists && w.immutable) { problems.push(w.label + ' was already published with different bytes; a new version gets a new folder'); continue; }
    if (check) { problems.push(w.label + (exists ? ' is out of date' : ' is missing')); continue; }
    pending.push(w);
  }
  const sigPath = INDEX + '.sig';
  let sigOk = false;
  try { sigOk = existsSync(sigPath) && !!signing.verify(indexBytes, readFileSync(sigPath, 'utf8'), KEYS); } catch (_) { sigOk = false; }
  let sigBytes = null;
  if (!sigOk) {
    if (check) problems.push('.well-known/starnet-maps.json.sig ' + (existsSync(sigPath) ? 'does not verify over the published bytes' : 'is missing'));
    else if (!existsSync(SIGNING_KEY)) problems.push('the gallery changed, so it must be re-signed, and there is no signing key at ' + SIGNING_KEY + ' (set STARNET_SKILL_MARKET_KEY to its path)');
    else {
      try { sigBytes = signing.sign(indexBytes, readFileSync(SIGNING_KEY, 'utf8'), KEYS); }
      catch (e) { problems.push('could not sign the gallery: ' + (e && e.message || e)); }
    }
  }
  if (problems.length) {
    console.error('build-map-catalog: ' + problems.length + ' problem(s), nothing written:\n  ' + problems.join('\n  ') + (check ? '\nRun: node scripts/build-map-catalog.mjs' : ''));
    process.exit(1);
  }
  // everything checked out: version folders first, the index and its signature last
  for (const w of pending) { mkdirSync(dirname(w.path), { recursive: true }); writeFileSync(w.path, w.bytes); }
  if (sigBytes) writeFileSync(sigPath, sigBytes);
  console.log('build-map-catalog: ' + (check ? 'up to date' : 'wrote') + ' — ' + result.index.maps.length + ' maps, serial ' + result.index.serial + ', signed');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error('build-map-catalog: ' + (e && e.message || e)); process.exit(1); }
}
