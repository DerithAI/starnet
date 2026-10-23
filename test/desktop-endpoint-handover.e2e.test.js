/* node test/desktop-endpoint-handover.e2e.test.js — the desktop app hands the station its saved endpoints (GitHub #137).

   #137: on the desktop app the OS keychain holds provider KEYS only; a CUSTOM base URL lived in the window's storage
   and the sidecar's memory. After any app restart (an update included) or a sidecar respawn the station had no
   endpoint, so chat worked (each run carries its baseUrl) while a scheduled routine / Run Now failed "no CUSTOM base
   URL is saved on this station for this scheduled routine".

   A REAL hermetic sidecar plus the REAL harness.js hand-over functions (lifted by source into a sandbox whose
   `invoke` does what the Rust shell's harness_store_provider_key does: the keychain only when a key is given, then
   POST /api/key with the per-launch IPC token):
     · before the hand-over a CUSTOM routine's Run Now is refused with the #137 sentence (the reproduction)
     · the boot hand-over pushes each saved endpoint WITHOUT a key (the keychain is never touched) and the routine runs
     · a sidecar respawn loses it again; the page's "no answer, then an answer" re-hands it and the routine runs
     · a browser page never uses this path (its endpoint rides the engine-key copy, #89) */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const http = require('http');
const path = require('path');
const vm = require('vm');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

const IPC = 'desktop-endpoint-handover-ipc-token-1234567890';
const harness = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'harness.js'), 'utf8');
const slice = (from, to) => {
  const a = harness.indexOf(from), b = harness.indexOf(to, a + 1);
  A.ok(a >= 0 && b > a, 'harness.js still has ' + from.trim().slice(0, 48));
  return harness.slice(a, b);
};
const helpers = slice('  function normalizeProviderId(provider) {', '  function providerNeedsKey(provider) {');
const handOver = slice('  /* #137 DESKTOP ENDPOINT HAND-OVER', '  // #62: no provider key contains whitespace');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function page(opts) {
  const store = new Map(Object.entries(opts.storage || {}));
  const invokes = [], warns = [];
  let settled = 0;
  const scope = {
    JSON, Promise, Map, Set, Array, String, Number, Object,
    DESKTOP: !!opts.desktop,
    LS: { key: 'starnet.byok.key', keyPool: 'starnet.byok.keyPool', baseUrl: 'starnet.byok.baseUrl', prov: 'starnet.byok.prov' },
    _configured: false, _configuredByProvider: {},
    getProv: () => 'custom',
    localStorage: {
      getItem: k => store.has(k) ? store.get(k) : null,
      setItem: (k, v) => { store.set(k, String(v)); },
      removeItem: k => { store.delete(k); },
      key: i => Array.from(store.keys())[i] || null,
      get length() { return store.size; }
    },
    invoke: async (cmd, args) => {
      invokes.push({ cmd, args: Object.assign({}, args) });
      try { return await opts.shell(cmd, args); } finally { settled++; }
    },
    console: { warn: m => warns.push(String(m)), log() {} }
  };
  const api = vm.runInNewContext(helpers + handOver + '\n({ pushDesktopEndpoints, noteStationReply, desktopEndpointsHeld })', scope);
  return { api, invokes, warns, settled: () => settled };
}

async function waitFor(fn, label) {
  for (let i = 0; i < 200; i++) { if (fn()) return; await sleep(25); }
  A.ok(false, 'timed out waiting: ' + label);
}

(async () => {
  // a strict loopback OpenAI-compatible upstream (the user's CUSTOM endpoint)
  const chats = [];
  const upstream = http.createServer((req, res) => {
    let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
      if (req.url.indexOf('/v1/models') === 0) { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ data: [{ id: 'local/model', context_length: 8000 }] })); }
      if (req.url.indexOf('/v1/chat/completions') !== 0) { res.writeHead(404); return res.end(); }
      chats.push(req.url);
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'ROUTINE DONE' }, finish_reason: 'stop' }], usage: { prompt_tokens: 4, completion_tokens: 2 } }) + '\n\n');
      res.end('data: [DONE]\n\n');
    });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const endpoint = 'http://127.0.0.1:' + upstream.address().port + '/v1';

  const env = { STARNET_IPC_TOKEN: IPC, STARNET_FULL_ACCESS: '1', STARNET_DEFAULT_MODEL: '', SKYNET_DEFAULT_MODEL: '' };
  // no ambient CUSTOM endpoint or key may stand in for the hand-over
  for (const name of ['CUSTOM_OPENAI_BASE_URL', 'OPENAI_COMPATIBLE_BASE_URL', 'CUSTOM_OPENAI_KEY', 'OPENAI_COMPATIBLE_KEY']) {
    env[name] = ''; env['STARNET_' + name] = ''; env['SKYNET_' + name] = '';
  }
  const fixture = SidecarFixture.create({ prefix: 'desktop-endpoint-handover-', env });
  // the Rust shell's harness_store_provider_key (main.rs): the keychain only when a key is given; then push_provider_config
  // posts { provider, key? , baseUrl? } to /api/key with the per-launch IPC token
  const keychainWrites = [];
  const shell = async (cmd, args) => {
    if (cmd !== 'harness_store_provider_key') throw new Error('unexpected ' + cmd);
    const payload = { provider: args.provider };
    if (args.key != null) { keychainWrites.push(args.provider); payload.key = args.key; }
    if (args.baseUrl != null) payload.baseUrl = args.baseUrl;
    const r = await fixture.request('/api/key', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StarNet-Token': IPC }, body: JSON.stringify(payload) });
    if (r.status !== 200) throw new Error('sidecar refused the push (HTTP ' + r.status + ')');
    return null;
  };
  try {
    await fixture.start();
    const agentId = 'routine-custom';
    A.eq((await fixture.json('POST', '/api/roster', { agents: [{ agentId, name: 'Custom', system: 'Answer briefly.', provider: 'custom', model: 'local/model' }], updatedAt: Date.now() })).status, 200, 'roster saved');
    await fixture.json('POST', '/api/cron/arm', { enabled: false });
    const made = await fixture.json('POST', '/api/cron', { name: 'Custom routine', prompt: 'Say the routine is done', schedule: 'every 1h', agentId, provider: 'custom', model: 'local/model', runsLine: false });
    A.eq(made.status, 200, 'routine created: ' + made.text);
    const jobId = made.body && made.body.job && made.body.job.id;
    const runNow = () => fixture.json('POST', '/api/cron/run', { id: jobId });
    const ranDone = r => r.status === 200 && /"name":"agent\.run\.end"[^\n]*"reason":"done"/.test(r.text);

    // the reproduction: the desktop station holds no endpoint after a launch
    const before = await runNow();
    A.eq(before.status, 400, 'a fresh desktop launch: Run Now is refused before the hand-over');
    A.ok(/no CUSTOM base URL is saved on this station/.test(String(before.body && before.body.error)), 'the refusal is the #137 sentence: ' + before.text);

    const storage = {
      'starnet.byok.prov': 'custom',
      'starnet.byok.baseUrl.custom': endpoint,
      'starnet.byok.baseUrl.ollama': 'http://192.168.1.50:11434',
      'starnet.byok.baseUrl.openai': '',              // an emptied endpoint is not handed over
      'starnet.byok.baseUrl.starnet': 'http://cloud.invalid'   // the linked account's endpoint is the sidecar's own
    };
    const desk = page({ desktop: true, storage, shell });

    // boot hand-over
    const out = await desk.api.pushDesktopEndpoints();
    A.eq(out.map(o => o.provider).sort(), ['custom', 'ollama'], 'the boot hand-over pushes every saved endpoint and nothing else');
    A.ok(out.every(o => o.ok), 'every push landed');
    A.ok(desk.invokes.every(c => c.cmd === 'harness_store_provider_key' && !Object.prototype.hasOwnProperty.call(c.args, 'key')), 'no push carries a key');
    A.eq(keychainWrites.length, 0, 'the keychain is never touched by the hand-over');
    A.eq(desk.invokes.find(c => c.args.provider === 'custom').args.baseUrl, endpoint, 'the CUSTOM push carries the saved endpoint');

    const after = await runNow();
    A.ok(ranDone(after), 'after the boot hand-over the CUSTOM routine runs to done: ' + after.text.slice(0, 400));
    A.ok(chats.length > 0, 'the routine reached the saved CUSTOM endpoint');

    // a sidecar respawn loses the in-memory endpoint again ...
    await fixture.restart();
    const respawned = await runNow();
    A.eq(respawned.status, 400, 'a respawned sidecar starts with no endpoint (memory only)');

    // ... an answer with no silence before it does not push; a silence then an answer re-hands it
    const pushes = desk.invokes.length;
    desk.api.noteStationReply(true);
    await sleep(50);
    A.eq(desk.invokes.length, pushes, 'an ordinary answer re-pushes nothing');
    desk.api.noteStationReply(false);
    desk.api.noteStationReply(false);
    A.eq(desk.invokes.length, pushes, 'nothing is pushed while the station is silent');
    desk.api.noteStationReply(true);
    await waitFor(() => desk.settled() === pushes + 2, 'the come-back hand-over');
    A.eq(desk.invokes.length, pushes + 2, 'the first answer after a silence re-hands each endpoint once');
    desk.api.noteStationReply(true);
    await sleep(50);
    A.eq(desk.invokes.length, pushes + 2, 'later answers do not push again');
    const back = await runNow();
    A.ok(ranDone(back), 'after the come-back hand-over the CUSTOM routine runs to done again');
    A.eq(keychainWrites.length, 0, 'the keychain is still untouched');

    // a failed push never rejects; it says what failed
    const broken = page({ desktop: true, storage: { 'starnet.byok.baseUrl.custom': endpoint }, shell: async () => { throw new Error('sidecar not up'); } });
    const failed = await broken.api.pushDesktopEndpoints();
    A.eq(failed, [{ provider: 'custom', ok: false }], 'a failed push resolves its failure');
    A.ok(broken.warns.some(w => /custom: could not hand the station its endpoint: sidecar not up/.test(w)), 'and is logged');

    // a browser page never takes this path
    const browser = page({ desktop: false, storage, shell });
    A.eq(await browser.api.pushDesktopEndpoints(), [], 'a browser page hands over nothing here (its copy rides /api/providers/engine-key)');
    browser.api.noteStationReply(false); browser.api.noteStationReply(true);
    await sleep(50);
    A.eq(browser.invokes.length, 0, 'a browser page never invokes the shell');
  } finally {
    await fixture.dispose();
    await new Promise(r => upstream.close(r));
  }

  // ---- wiring the sandbox can't see ----
  const initBody = harness.slice(harness.indexOf('  async function init() {'), harness.indexOf('  /* whether a key is set'));
  A.ok(/if \(!DESKTOP\) \{ syncEngineKeysOnBoot\(\); return; \}[^\n]*\n\s*pushDesktopEndpoints\(\);/.test(initBody), 'a desktop boot hands its endpoints over (not awaited)');
  A.ok(/rawFetch\(u, withApiToken\(init, t\)\)\.then\(res => \{\s*\n\s*noteStationReply\(true\);[\s\S]{0,400}if \(!\(e && e\.name === 'AbortError'\)\) noteStationReply\(false\);[^\n]*\n\s*throw e;/.test(harness),
    'the /api fetch wrapper reports each answer and each refused connection (never a caller abort), and still rethrows');
  A.ok(/\.then\(up => \{ if \(up\) pushDesktopEndpoints\(\); return up; \}\)/.test(harness), 'ENGINE RESTART re-hands the endpoints once the sidecar is back');
  A.report('desktop-endpoint-handover.e2e.test');
})().catch(e => { console.error('FATAL', e && e.stack || e); process.exit(1); });
