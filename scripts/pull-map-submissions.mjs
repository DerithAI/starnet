#!/usr/bin/env node
/* scripts/pull-map-submissions.mjs — bring APPROVED community maps into the gallery (2026-10-18).

   Players share a station layout from build mode on a linked station; the operator approves or sends each back in
   account.starnetos.com/admin/maps. Approving publishes nothing: the gallery is signed on this PC, so approved maps
   come here.

     node scripts/pull-map-submissions.mjs              pull every approved map into maps-catalog/maps/<slug>/, then
                                                        build + sign the gallery (scripts/build-map-catalog.mjs)
     node scripts/pull-map-submissions.mjs --dry-run    show what would be pulled; write nothing
     node scripts/pull-map-submissions.mjs --mark-live  AFTER the website deploy: tell the cloud which maps the LIVE
                                                        gallery now lists, so their authors see LIVE

   Then commit maps-catalog/ and website/ (the build output), deploy the website (website-deploy), and run --mark-live.

   Every build is re-cleaned with the app's own BuildShare cleaner before anything is written; a build that still
   carries crew, instructions or made props is skipped. Refused, never overwritten: a name another author's map holds
   (the cloud's owner key must match the folder's). An update to an author's own map is a new version.

   Config: SKILL_REVIEW_TOKEN (or ~/.starnet-keys/skill-review.token — the same review token as skills),
   STARNET_CLOUD_URL (default https://account.starnetos.com), STARNET_MAPS_URL (default the live gallery index). */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync, statSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadCleaner, publishedVersions } from './build-map-catalog.mjs';

const require = createRequire(import.meta.url);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const fmt = require(join(ROOT, 'sidecar/maps/maps-format.js'));

const CLOUD = String(process.env.STARNET_CLOUD_URL || 'https://account.starnetos.com').replace(/\/+$/, '');
const LIVE_INDEX = process.env.STARNET_MAPS_URL || 'https://starnetos.com/.well-known/starnet-maps.json';
const TOKEN_FILE = join(homedir(), '.starnet-keys', 'skill-review.token');
const MAPS_DIR = process.env.STARNET_MAPS_SRC || join(ROOT, 'maps-catalog', 'maps');

const str = (v) => (v == null ? '' : String(v));
// a credit as it may appear on a card: plain text only (the cloud already refuses markup; this is the second lock)
export function plainCredit(s) { return str(s).replace(/[<>[\]()|`{}\\*_#\r\n]/g, '').replace(/https?:\/*|www\./gi, '').replace(/\s+/g, ' ').trim().slice(0, fmt.LIMITS.credit); }

/**
 * planPull(submissions, ctx) -> { pulls: [{ sub, slug, version, meta, buildText, still, update }], skipped: [{ id, slug, why }],
 *                                 waiting: [{ id, slug }] }
 *   submissions: the cloud's metadata, each with .build (text) and .still (Buffer) fetched on their own
 *   ctx: { clean(text, name) (build-map-catalog loadCleaner), readMeta(slug) -> map.json | null,
 *          published(slug) -> [versions already in website/maps/<slug>/] }
 * Pure apart from the cleaner: decides, never writes. Every refusal says why, for the operator. A map this PC already
 * pulled (same submission id), still waiting for a deploy and --mark-live, is `waiting`, not pulled again.
 */
export function planPull(submissions, ctx) {
  const pulls = [], skipped = [], waiting = [], seen = new Set();
  for (const s of submissions || []) {
    const slug = str(s && s.slug);
    const skip = (why) => skipped.push({ id: str(s && s.id), slug, why });
    if (!fmt.nameOk(slug)) { skip('bad name'); continue; }
    if (seen.has(slug)) { skip('two approved maps of the same name in one pull; pull again after this one is live'); continue; }
    if (!/^mp_[A-Za-z0-9_-]{6,40}$/.test(str(s.id)) || !/^[0-9a-f]{24}$/.test(str(s.owner))) { skip('the cloud sent no submission id / owner key'); continue; }
    const prior = ctx.readMeta(slug);
    if (prior && prior.submission && prior.submission.id === s.id) { waiting.push({ id: s.id, slug }); continue; }
    const buildText = str(s.build);
    const still = Buffer.isBuffer(s.still) ? s.still : Buffer.from(str(s.still), 'base64');
    if (!buildText || !fmt.pngSize(still)) { skip('the cloud sent no build or no picture'); continue; }
    if (fmt.cloudDigest(buildText, still) !== str(s.digest)) { skip('the map does not match the digest the reviewer approved'); continue; }
    const c = ctx.clean(buildText, s.title);
    if (!c.ok) { skip('the app\'s cleaner refuses it: ' + c.message); continue; }
    if (c.dropped && (c.dropped.work || c.dropped.made)) { skip('it still carries crew, instructions or made props'); continue; }
    if (prior && !(prior.submission && prior.submission.owner === s.owner)) { skip('another author\'s map already holds this name'); continue; }
    // the next version follows every version ever published, taken-down ones included (their folders stay on the site)
    const versions = (ctx.published ? ctx.published(slug) : []).concat(prior ? [Number(prior.version) || 0] : []);
    const version = (versions.length ? Math.max(...versions) : 0) + 1;
    const meta = {
      slug, version, title: fmt.cleanText(s.title, fmt.LIMITS.title), description: fmt.cleanText(s.description, fmt.LIMITS.description),
      credit: plainCredit(s.credit) || 'StarNet player', license: fmt.LICENSE, stats: c.stats,
      submission: { id: s.id, owner: s.owner, digest: s.digest }
    };
    try { fmt.buildEntry(meta, Buffer.from(c.text, 'utf8'), still); } catch (e) { skip(str(e && e.message)); continue; }
    seen.add(slug);
    pulls.push({ sub: s, slug, version, meta, buildText: c.text, still, update: !!prior });
  }
  return { pulls, skipped, waiting };
}

function reviewToken() {
  const env = str(process.env.SKILL_REVIEW_TOKEN).trim();
  if (env) return env;
  if (existsSync(TOKEN_FILE)) return readFileSync(TOKEN_FILE, 'utf8').trim();
  throw new Error('no review token: set SKILL_REVIEW_TOKEN or put it in ' + TOKEN_FILE + ' (the same value as the cloud secret SKILL_REVIEW_TOKEN)');
}
async function getJson(url, opts) {
  const res = await fetch(url, Object.assign({ signal: AbortSignal.timeout(60000) }, opts));
  const text = await res.text();
  let body = null; try { body = JSON.parse(text); } catch (_) { /* not json */ }
  if (!res.ok) throw new Error(url + ' answered ' + res.status + (body && body.reason ? ' (' + body.reason + ')' : ''));
  if (!body) throw new Error(url + ' did not answer JSON');
  return body;
}
function readMeta(slug) {
  const p = join(MAPS_DIR, slug, 'map.json');
  return existsSync(p) ? JSON.parse(readFileSync(p, 'utf8')) : null;
}
function snapshot(dir) {
  if (!existsSync(dir)) return null;
  return readdirSync(dir).filter((n) => statSync(join(dir, n)).isFile()).map((n) => ({ name: n, bytes: readFileSync(join(dir, n)) }));
}
function restore(dir, snap) {
  rmSync(dir, { recursive: true, force: true });
  if (!snap) return;
  mkdirSync(dir, { recursive: true });
  for (const f of snap) writeFileSync(join(dir, f.name), f.bytes);
}

async function getBytes(url, token) {
  const res = await fetch(url, { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(url + ' answered ' + res.status);
  return Buffer.from(await res.arrayBuffer());
}

async function pull({ dryRun }) {
  const token = reviewToken();
  // the list is metadata; each map's build and picture come on their own, so no answer holds the whole backlog
  const body = await getJson(CLOUD + '/v1/map-submissions/approved', { headers: { authorization: 'Bearer ' + token } });
  const subs = [];
  for (const s of body.submissions || []) {
    const prior = readMeta(str(s.slug));
    if (prior && prior.submission && prior.submission.id === s.id) { subs.push(s); continue; }   // already pulled: no download
    const file = (which) => CLOUD + '/v1/map-submissions/file?id=' + encodeURIComponent(str(s.id)) + '&which=' + which;
    try { subs.push(Object.assign({}, s, { build: (await getBytes(file('build'), token)).toString('utf8'), still: await getBytes(file('still'), token) })); }
    catch (e) { subs.push(Object.assign({}, s, { build: '', still: Buffer.alloc(0) })); console.log('  could not download ' + s.slug + ': ' + str(e && e.message)); }
  }
  const plan = planPull(subs, { clean: loadCleaner(), readMeta, published: (slug) => publishedVersions(slug) });
  for (const s of plan.skipped) console.log('  skipped ' + (s.slug || s.id) + ': ' + s.why);
  for (const w of plan.waiting) console.log('  already pulled, waiting for a deploy and --mark-live: ' + w.slug);
  if (!plan.pulls.length) { console.log('pull-map-submissions: nothing new to pull (' + (body.submissions || []).length + ' approved, ' + plan.waiting.length + ' already pulled, ' + plan.skipped.length + ' skipped)'); return plan.skipped.length ? 1 : 0; }
  for (const p of plan.pulls) console.log('  ' + (dryRun ? 'would pull ' : 'pulling ') + p.slug + ' v' + p.version + (p.update ? ' (update)' : '') + ' by ' + p.meta.credit + ' · ' + p.meta.stats.rooms + ' rooms, ' + p.meta.stats.props + ' props');
  if (dryRun) return 0;
  const snaps = new Map(plan.pulls.map((p) => [p.slug, snapshot(join(MAPS_DIR, p.slug))]));
  try {
    for (const p of plan.pulls) {
      const dir = join(MAPS_DIR, p.slug);
      rmSync(dir, { recursive: true, force: true });
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, fmt.BUILD_FILE), p.buildText);
      writeFileSync(join(dir, fmt.STILL_FILE), p.still);
      writeFileSync(join(dir, 'map.json'), JSON.stringify(p.meta, null, 2) + '\n');
    }
    const build = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build-map-catalog.mjs')], { cwd: ROOT, encoding: 'utf8', env: process.env });
    process.stdout.write(build.stdout || '');
    if (build.status !== 0) throw new Error('the gallery build refused: ' + str(build.stderr || build.stdout).trim());
  } catch (e) {
    // all or nothing: every folder goes back the way it was
    for (const [slug, snap] of snaps) restore(join(MAPS_DIR, slug), snap);
    throw e;
  }
  console.log('pull-map-submissions: pulled ' + plan.pulls.length + ' — commit maps-catalog/ and website/, deploy the website, then run --mark-live');
  return 0;
}

async function markLive() {
  const token = reviewToken();
  const live = fmt.readCatalog(await getJson(LIVE_INDEX, {}));
  const bySlug = new Map(live.maps.map((e) => [e.slug, e]));
  const published = [];
  for (const slug of existsSync(MAPS_DIR) ? readdirSync(MAPS_DIR) : []) {
    const meta = readMeta(slug);
    if (!meta || !meta.submission) continue;
    const l = bySlug.get(slug);
    const local = existsSync(join(MAPS_DIR, slug, fmt.BUILD_FILE)) ? fmt.sha256hex(readFileSync(join(MAPS_DIR, slug, fmt.BUILD_FILE))) : '';
    // live means: the deployed gallery lists this exact build (same version AND build sha256 as the local source)
    if (l && l.version === meta.version && l.build.sha256 === local) published.push({ id: meta.submission.id, version: String(meta.version) });
    else console.log('  not live yet: ' + slug + ' v' + meta.version);
  }
  if (!published.length) { console.log('pull-map-submissions: no shared map is live yet'); return 0; }
  const res = await getJson(CLOUD + '/v1/map-submissions/published', {
    method: 'POST', headers: { authorization: 'Bearer ' + token, 'content-type': 'application/json' }, body: JSON.stringify({ published })
  });
  console.log('pull-map-submissions: ' + (res.marked || []).length + ' newly marked live (' + published.length + ' shared maps listed live)');
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  (args.includes('--mark-live') ? markLive() : pull({ dryRun: args.includes('--dry-run') }))
    .then((code) => process.exit(code || 0))
    .catch((e) => { console.error('pull-map-submissions: ' + str(e && e.message || e)); process.exit(1); });
}
