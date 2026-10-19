'use strict';
/* test/dev-seed-preflight.test.js — dev/seed.js's model pre-flight checks the catalog the sidecar will call
   (review docs-claims-13). checkModelInCatalog reads SKYNET_OPENROUTER_BASE (STARNET_ first, like the sidecar's ENV),
   so a preview's mock /models answers it and no false 'first runs WILL fail' box is printed; with no override it still
   checks the public openrouter.ai catalog. Pure: the two functions run in a vm with a stubbed fetch (no network, and
   dev/seed.js is never required or spawned, so no sidecar boots). */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { fnBody } = require('./_assert.js');
const entry = path.resolve(__dirname, '../dev/seed.js');

(async () => {
  const src = fs.readFileSync(entry, 'utf8');
  const body = fnBody(src, 'function warnBox(') + '\n' + fnBody(src, 'async function checkModelInCatalog(');
  assert.ok(body.length > 200 && body.length < src.length / 2, 'dev/seed.js has warnBox + checkModelInCatalog');
  const preflight = async (env, ids) => {
    const seen = { urls: [], errors: [] };
    const ctx = { AbortController, setTimeout, clearTimeout, process: { env },
      console: { error: (...xs) => seen.errors.push(xs.join(' ')) },
      fetch: async url => { seen.urls.push(String(url)); return { ok: true, json: async () => ({ data: ids.map(id => ({ id })) }) }; } };
    vm.createContext(ctx);
    vm.runInContext(body + '\nthis.check = checkModelInCatalog;', ctx);
    await ctx.check('test/model');
    return seen;
  };
  const mock = await preflight({ SKYNET_OPENROUTER_BASE: 'http://127.0.0.1:9/api/v1/' }, ['test/model']);
  assert.deepEqual(mock.urls, ['http://127.0.0.1:9/api/v1/models'], 'the pre-flight asks the configured base, not openrouter.ai');
  assert.equal(mock.errors.join('\n'), '', 'a model the configured catalog lists prints no warning');
  const dead = await preflight({ SKYNET_OPENROUTER_BASE: 'http://127.0.0.1:9/api/v1' }, ['other/model']);
  assert.match(dead.errors.join('\n'), /not on http:\/\/127\.0\.0\.1:9\/api\/v1\/models/, 'the warning names the catalog it checked');
  const pub = await preflight({}, ['test/model']);
  assert.deepEqual(pub.urls, ['https://openrouter.ai/api/v1/models'], 'no override keeps the public catalog');
  const starnet = await preflight({ STARNET_OPENROUTER_BASE: 'http://127.0.0.1:8/v1', SKYNET_OPENROUTER_BASE: 'http://127.0.0.1:9/v1' }, ['test/model']);
  assert.deepEqual(starnet.urls, ['http://127.0.0.1:8/v1/models'], 'STARNET_OPENROUTER_BASE wins, as in the sidecar');
  assert.equal(require('./_assert.js').fails(), 0, 'shared assertion helpers have no pending failures');
  console.log('dev-seed-preflight.test: OK (7 assertions)');
})().catch(err => { console.error(err); process.exit(1); });
