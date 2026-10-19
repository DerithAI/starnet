#!/usr/bin/env node
/* scripts/build-map-catalog.mjs — build the community maps gallery into website/ (2026-10-18).

   Sources (written by scripts/pull-map-submissions.mjs, committed):
     maps-catalog/maps/<slug>/map.json                    { slug, version, title, description, credit, license, stats, submission }
     maps-catalog/maps/<slug>/build.starnet-build.json    the layout, already re-cleaned by the app's own BuildShare
     maps-catalog/maps/<slug>/still.png                   the picture the reviewer approved
   Output (served by starnetos.com, Cloudflare Pages):
     website/.well-known/starnet-maps.json      the index (sidecar/maps/maps-format.js)
     website/.well-known/starnet-maps.json.sig  an Ed25519 signature over it, byte for byte (the Skill Market's keys)
     website/maps/<slug>/<version>/<files>      one immutable folder per published version

   Every build is cleaned AGAIN here with frontend/app/buildshare.js, and the build fails if that changes a byte: what
   the gallery publishes is exactly what every importing station's cleaner would keep. A published version can never
   change: to update a map, the pull bumps its version. To take a map down, delete its folder and rebuild.

   SIGNING: a build that changes the index bumps its serial and re-signs, which needs the private key
   (STARNET_SKILL_MARKET_KEY, else ~/.starnet-keys/skill-market.key). --check needs only the public keys.

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
// the keys a station trusts: the app's own, plus any a station adds for its own gallery (STARNET_SKILL_MARKET_KEYS)
const KEYS = signing.TRUSTED_KEYS.concat(signing.keysFromEnv(process.env.STARNET_SKILL_MARKET_KEYS));

/* the app's own cleaner, loaded the way test/build-share.test.js loads it */
export function loadCleaner() {
  const M = require(join(ROOT, 'frontend/app/worldmodel.js'));
  const Sprites = require(join(ROOT, 'frontend/app/propsprites.js'));
  const B = require(join(ROOT, 'frontend/app/buildshare.js'));
  M.setPropRules(t => { const s = Sprites.spec(t); return s ? { mount: s.mount || null, stack: !!s.stack, surface: !!s.surface, flat: !!s.flat } : null; });
  /* clean(text, name) -> { ok, text, stats, dropped } | { ok:false, message }: read through the importer's cleaner,
     then written back by the exporter, so the file is byte-stable however it arrived */
  return function clean(text, name) {
    const r = B.readBuild(text, M, 1);
    if (!r.ok) return { ok: false, message: r.message };
    const out = B.exportBuild(r.doc, M, { name: name || r.name });
    if (out.error) return { ok: false, message: 'the cleaned build could not be written (' + out.error + ')' };
    return { ok: true, text: out.text, stats: out.stats, dropped: r.dropped };
  };
}

export function buildCatalog() {
  const clean = loadCleaner();
  const folders = existsSync(SRC) ? readdirSync(SRC).filter(n => statSync(join(SRC, n)).isDirectory()).sort() : [];
  const built = [];
  for (const slug of folders) {
    const base = join(SRC, slug);
    for (const f of ['map.json', fmt.BUILD_FILE, fmt.STILL_FILE]) if (!existsSync(join(base, f))) throw new Error(slug + ': missing ' + f);
    const meta = JSON.parse(readFileSync(join(base, 'map.json'), 'utf8'));
    if (meta.slug !== slug) throw new Error(slug + ': map.json slug must match its folder');
    const buildText = readFileSync(join(base, fmt.BUILD_FILE), 'utf8');
    const c = clean(buildText, meta.title);
    if (!c.ok) throw new Error(slug + ': ' + c.message);
    if (c.text !== buildText) throw new Error(slug + ': the build is not exactly what the app\'s cleaner keeps; re-pull it instead of editing it');
    if (c.dropped && (c.dropped.work || c.dropped.made)) throw new Error(slug + ': the build still carries crew, instructions or made props');
    const still = readFileSync(join(base, fmt.STILL_FILE));
    built.push({ entry: fmt.buildEntry(Object.assign({}, meta, { stats: c.stats }), Buffer.from(buildText, 'utf8'), still), buildBytes: Buffer.from(buildText, 'utf8'), still });
  }
  const entries = built.map(b => b.entry);
  const prior = existsSync(INDEX) ? JSON.parse(readFileSync(INDEX, 'utf8')) : null;
  const priorSerial = fmt.serialOf(prior);
  const bodyOf = doc => { const copy = Object.assign({}, doc); delete copy.serial; return JSON.stringify(copy); };
  const unchanged = priorSerial && bodyOf(prior) === bodyOf(fmt.catalogDocument(entries, { serial: priorSerial }));
  const serial = !priorSerial ? 1 : unchanged ? priorSerial : priorSerial + 1;
  return { index: fmt.catalogDocument(entries, { serial }), built };
}

function main() {
  const check = process.argv.includes('--check');
  const result = buildCatalog();
  const writes = [];
  for (const b of result.built) {
    writes.push({ path: join(OUT, ...b.entry.build.path.split('/')), bytes: b.buildBytes, immutable: true, label: b.entry.build.path });
    writes.push({ path: join(OUT, ...b.entry.still.path.split('/')), bytes: b.still, immutable: true, label: b.entry.still.path });
  }
  const indexBytes = Buffer.from(JSON.stringify(result.index, null, 2) + '\n', 'utf8');
  writes.push({ path: INDEX, bytes: indexBytes, immutable: false, label: '.well-known/starnet-maps.json' });
  const problems = [];
  for (const w of writes) {
    const exists = existsSync(w.path);
    if (exists && Buffer.compare(readFileSync(w.path), w.bytes) === 0) continue;
    if (exists && w.immutable) { problems.push(w.label + ' was already published with different bytes; a new version gets a new folder'); continue; }
    if (check) { problems.push(w.label + (exists ? ' is out of date' : ' is missing')); continue; }
    mkdirSync(dirname(w.path), { recursive: true });
    writeFileSync(w.path, w.bytes);
  }
  const sigPath = INDEX + '.sig';
  let sigOk = false;
  try { sigOk = existsSync(sigPath) && !!signing.verify(indexBytes, readFileSync(sigPath, 'utf8'), KEYS); } catch (_) { sigOk = false; }
  if (!sigOk) {
    if (check) problems.push('.well-known/starnet-maps.json.sig ' + (existsSync(sigPath) ? 'does not verify over the published bytes' : 'is missing'));
    else if (!problems.length) {
      if (!existsSync(SIGNING_KEY)) throw new Error('the gallery changed, so it must be re-signed, and there is no signing key at ' + SIGNING_KEY + ' (set STARNET_SKILL_MARKET_KEY to its path)');
      writeFileSync(sigPath, signing.sign(indexBytes, readFileSync(SIGNING_KEY, 'utf8'), KEYS));
    }
  }
  if (problems.length) {
    console.error('build-map-catalog: ' + problems.length + ' problem(s):\n  ' + problems.join('\n  ') + (check ? '\nRun: node scripts/build-map-catalog.mjs' : ''));
    process.exit(1);
  }
  console.log('build-map-catalog: ' + (check ? 'up to date' : 'wrote') + ' — ' + result.index.maps.length + ' maps, serial ' + result.index.serial + ', signed');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try { main(); } catch (e) { console.error('build-map-catalog: ' + (e && e.message || e)); process.exit(1); }
}
