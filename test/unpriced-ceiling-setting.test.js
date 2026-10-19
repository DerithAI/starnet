/* node test/unpriced-ceiling-setting.test.js — issue #135: a model StarNet has no price for (a custom provider's
   deepseek-ai/deepseek-v4.1-flash-1107) stopped every run at a hardcoded 2,000,000 tokens. The only override was the
   STARNET_MAX_UNPRICED_TOKENS environment variable; the Runtime limits row a user found (CLAUDE CODE TOKEN CEILING) is
   the Claude-subscription ceiling and never touched it, so setting it to 5M or 0 changed nothing.

   GENUINE (the real sidecar/index.js knob code, run in a vm against a temp runtime.knobs.json — never the sidecar):
     • SAVE: POST /api/runtime/knobs { maxUnpricedTokens } persists, reports it, and is bounds-checked like its sibling;
     • RESTART: the boot reader keeps the saved value and CAPS.maxUnpricedTokens resolves to it (applies after a restart,
       exactly like CLAUDE CODE TOKEN CEILING — CAPS is read at boot);
     • env still wins (the row is env-locked, a write is ignored);
     • the loop (sidecar/loop.js, real) stops at the saved ceiling, and 0 = no ceiling.
   SOURCE-LOCKED: the run seam hands CAPS.maxUnpricedTokens to the loop; the Settings row sits in the existing Runtime
   limits list with the sidecar's bounds; limits.set (station.power) carries every Runtime limits key; every surface's
   stop message names the setting. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const part = (s, a, b) => { const i = s.indexOf(a), j = s.indexOf(b, i + a.length); if (i < 0 || j < 0) throw new Error('slice ' + a); return s.slice(i, j); };
const side = read('sidecar/index.js');

// the real knob code: the boot reader + resolver, the CAPS line, the defs/status, and the POST handler
const BOOT = part(side, 'let runtimeKnobs = (function loadRuntimeKnobsAtBoot() {', '\n// maxIters: optional per-run tool-turn ceiling.');
const CAPS_LINE = part(side, 'const CAPS = {', '\n');
const DEFS = part(side, 'const RUNTIME_KNOB_DEFS = [', 'function handleRuntimeKnobsGet(');
const SET = part(side, 'async function handleRuntimeKnobsSet(req, res) {', '\nfunction setProviderRuntimeConfig(');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'unpriced-ceiling-'));
const FILE = path.join(dir, 'runtime.knobs.json');

// one "sidecar boot": a fresh context reads the knob file and builds CAPS, exactly as index.js does at start
function boot(env) {
  const ctx = vm.createContext({
    fs, console: { warn: () => {} }, Object, Number, String, JSON, Math, isFinite,
    RUNTIME_KNOBS_FILE: FILE,
    ENV: suffix => (env || {})[suffix],
    CONSENT_TIMEOUT_MS: 120000, CONSENT_ACK_EXTEND_MS: 600000,
    saveResilient: (file, value) => fs.writeFileSync(file, JSON.stringify(value)),
    readBody: async req => req.body
  });
  vm.runInContext(BOOT + '\n' + CAPS_LINE + '\n' + DEFS + '\n' + SET +
    '\n;this.CAPS = CAPS; this.status = runtimeKnobsStatus; this.set = handleRuntimeKnobsSet;', ctx);
  return ctx;
}
async function post(ctx, body) {
  let code = 0, out = null;
  const res = { writeHead: c => { code = c; }, end: s => { out = JSON.parse(s); } };
  await ctx.set({ body: JSON.stringify(body) }, res);
  return { code, json: out };
}

// the loop, really run: an unpriced metered model burning `perTurn` tokens a turn until maxIters
function setup() {
  const bus = A.makeBus();
  const seq = A.collectBus(bus, events.names());
  return { seq, emit: makeEmitter(bus, () => {}) };
}
const noopTool = [{ type: 'function', function: { name: 'noop', parameters: { type: 'object', properties: {} } } }];
function runUnpriced(maxUnpricedTokens, perTurn, maxIters) {
  const s = setup();
  const provider = {
    priceOf: () => null, contextLimit: () => 0,
    stream: async function* () {
      yield { type: 'tool_start', index: 0, id: 'c1', name: 'noop' };
      yield { type: 'tool_args', index: 0, chunk: '{}' };
      yield { type: 'usage', usage: { prompt_tokens: perTurn, completion_tokens: 0, total_tokens: perTurn } };
      yield { type: 'done', finishReason: 'tool_calls' };
    }
  };
  return runAgentLoop({
    messages: [{ role: 'user', content: 'x' }], provider, emit: s.emit, cost: makeCostEngine({ priceOf: () => null }),
    dispatch: async () => ({ ok: true, content: 'ok' }), tools: noopTool, model: 'deepseek-ai/deepseek-v4.1-flash-1107', agentId: 'a', runId: 'r' + Math.random(),
    limits: { maxCostUsd: 1.00, maxIters, grace: false, maxUnpricedTokens }
  }).then(res => ({ res, end: s.seq.find(e => e.name === 'agent.run.end') }));
}

(async () => {
  try {
    // ---- the shipped default: 2,000,000, reported as a Runtime limits field ----
    let ctx = boot();
    A.eq(ctx.CAPS.maxUnpricedTokens, 2000000, 'no saved value: the built-in 2,000,000-token ceiling');
    const f0 = ctx.status().fields.maxUnpricedTokens;
    A.ok(!!f0, 'GET /api/runtime/knobs reports maxUnpricedTokens');
    A.eq(f0 && [f0.effective, f0.default, f0.saved, f0.envLocked, f0.min, f0.max], [2000000, 2000000, null, false, 0, 100000000], 'default 2,000,000, nothing saved, editable, the sibling\'s bounds');

    // ---- SAVE 5,000,000 → it persists and is reported ----
    let r = await post(ctx, { maxUnpricedTokens: 5000000 });
    A.eq(r.code, 200, 'POST maxUnpricedTokens 5,000,000 → 200');
    A.eq(r.json && r.json.fields && r.json.fields.maxUnpricedTokens && [r.json.fields.maxUnpricedTokens.effective, r.json.fields.maxUnpricedTokens.saved], [5000000, 5000000], 'the reply reports it saved and effective');
    A.eq(JSON.parse(fs.readFileSync(FILE, 'utf8')).knobs.maxUnpricedTokens, 5000000, 'runtime.knobs.json holds it');
    A.eq(ctx.CAPS.maxUnpricedTokens, 2000000, 'the RUNNING sidecar keeps its boot ceiling (applies after a restart, like CLAUDE CODE TOKEN CEILING)');

    // ---- RESTART → the boot reader keeps it, CAPS resolves to it, and the loop honours it ----
    ctx = boot();
    A.eq(ctx.CAPS.maxUnpricedTokens, 5000000, 'after a restart CAPS.maxUnpricedTokens is the saved 5,000,000');
    const five = await runUnpriced(ctx.CAPS.maxUnpricedTokens, 1500000, 10);
    A.eq(five.res.reason, 'budget', 'the run stops on the token ceiling');
    A.eq(five.res.turns, 4, 'not at 2,000,000 — it ran until it crossed 5,000,000 (4 × 1.5M)');
    A.eq(five.end && five.end.payload.unpricedCapTokens, 5000000, 'agent.run.end names the saved ceiling');
    A.ok(/UNPRICED MODEL TOKEN CEILING/.test(five.res.budgetNote) && /Runtime limits/.test(five.res.budgetNote), 'the loop\'s budget note names the setting: ' + five.res.budgetNote);

    // ---- 0 = no ceiling ----
    r = await post(ctx, { maxUnpricedTokens: 0 });
    A.eq(r.code, 200, 'POST 0 → 200');
    ctx = boot();
    A.eq(ctx.CAPS.maxUnpricedTokens, 0, 'after a restart the saved 0 survives the boot reader (not dropped to the default)');
    const off = await runUnpriced(ctx.CAPS.maxUnpricedTokens, 1500000, 4);
    A.eq(off.res.reason, 'max_iters', '0 = no ceiling: 6,000,000 unpriced tokens and no token stop');

    // ---- bounds + clear, same style as the sibling ----
    A.eq((await post(ctx, { maxUnpricedTokens: -1 })).code, 400, 'a negative ceiling → 400');
    A.eq((await post(ctx, { maxUnpricedTokens: 100000001 })).code, 400, 'above 100,000,000 → 400');
    r = await post(ctx, { maxUnpricedTokens: null });
    A.eq(r.json && r.json.fields && r.json.fields.maxUnpricedTokens ? r.json.fields.maxUnpricedTokens.saved : 'missing', null, 'null clears the override');
    A.eq(boot().CAPS.maxUnpricedTokens, 2000000, 'and the next boot is back on the default');

    // ---- an environment variable still wins ----
    await post(ctx, { maxUnpricedTokens: 3000000 });
    const envCtx = boot({ MAX_UNPRICED_TOKENS: '7000000' });
    A.eq(envCtx.CAPS.maxUnpricedTokens, 7000000, 'STARNET_MAX_UNPRICED_TOKENS beats the saved value');
    A.eq((envCtx.status().fields.maxUnpricedTokens || {}).envLocked, true, 'and the row reports it env-locked');
    await post(envCtx, { maxUnpricedTokens: 9000000 });
    A.eq(JSON.parse(fs.readFileSync(FILE, 'utf8')).knobs.maxUnpricedTokens, 3000000, 'an env-locked knob ignores a write');
  } finally { try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {} }

  // ---- the run seam hands CAPS.maxUnpricedTokens to the loop (metered runs; OAuth/unmetered stay exempt) ----
  A.ok(/maxUnpricedTokens: \(providerUnmetered \|\| usingCodex \|\| usingDeviceOAuth\) \? Infinity : CAPS\.maxUnpricedTokens,/.test(side), 'a run\'s loop limit is CAPS.maxUnpricedTokens');
  A.ok(/maxUnpricedTokens: fbUnmetered \? Infinity : CAPS\.maxUnpricedTokens \}\);/.test(side), 'and so is a metered fallback\'s');

  // ---- the Settings row: in the existing Runtime limits list, the sidecar's bounds, says 0 and restart ----
  const ui = read('frontend/app/stationui.js');
  const uc = vm.createContext({});
  vm.runInContext(part(ui, '  const ADV_FIELDS = [', '\n  ];') + '\n  ];\n;this.F = ADV_FIELDS;', uc);
  const row = uc.F.find(f => f.key === 'maxUnpricedTokens');
  const sib = uc.F.find(f => f.key === 'maxSubscriptionTokens');
  A.ok(!!row, 'Runtime limits has a maxUnpricedTokens row');
  A.eq(row && row.label, 'UNPRICED MODEL TOKEN CEILING', 'labelled for what it is');
  A.eq(row && [row.min, row.max, row.step], sib && [sib.min, sib.max, sib.step], 'same bounds and step as CLAUDE CODE TOKEN CEILING');
  A.ok(row && /0 = no ceiling/.test(row.hint) && /restart/.test(row.hint) && /price/.test(row.hint), 'the hint says what it governs, 0 = no ceiling, and when it applies: ' + (row && row.hint));
  A.eq(uc.F.length, 6, 'one new row, nothing else added');

  // ---- limits.set (station.power) carries every Runtime limits key ----
  const { makeStationControlTools, cardFor } = require('../sidecar/tools/builtin/station-control.js');
  const routes = [];
  const tools = makeStationControlTools({ station: { request: async () => ({ ok: true }) }, route: async (m, u, b) => { routes.push({ m, u, b }); return { status: 200, json: { ok: true } }; }, surface: 'interactive', later: () => {} });
  const args = {}; uc.F.forEach((f, i) => { args[f.key] = f.min + i; });
  const done = await tools.powerTool.run({ action: 'limits.set', args });
  A.ok(!/^REFUSED/.test(done.content), 'limits.set runs');
  A.eq(routes.length && Object.keys(routes[0].b).sort(), Object.keys(args).sort(), 'limits.set sends every Runtime limits key the Settings list has');
  A.ok(/maxUnpricedTokens UNLIMITED/.test(cardFor({ action: 'limits.set', args: { maxUnpricedTokens: 0 } })), 'its card names 0 as UNLIMITED');

  // ---- every stop message names the setting ----
  const x = { unpricedModel: 'deepseek-ai/deepseek-v4.1-flash-1107', unpricedCapTokens: 2000000 };
  const sentence = require('../sidecar/stop-reason.js').stopSentence('budget', x);
  A.ok(/UNPRICED MODEL TOKEN CEILING/.test(sentence) && /SETTINGS › APP & BACKUP › Runtime limits/.test(sentence) && /restart/.test(sentence), 'routines/loops/channels: ' + sentence);
  const note = require('../sidecar/channels/hub.js').endNote('budget', Object.assign({ budgetScope: 'run' }, x));
  A.ok(/UNPRICED MODEL TOKEN CEILING/.test(note), 'channel reply note: ' + note);
  const chat = read('frontend/app/chat.js');
  const cc = vm.createContext({ Number, isFinite });
  vm.runInContext(part(chat, '  function budgetStopLine(', '  // the budget stop\'s door') + '\n;this.line = budgetStopLine;', cc);
  const line = cc.line('run', null, false, { model: x.unpricedModel, capTokens: 2000000 });
  A.ok(/UNPRICED MODEL TOKEN CEILING/.test(line) && /SETTINGS › APP & BACKUP › Runtime limits/.test(line) && /restart/.test(line), 'COMMS: ' + line);

  A.report('unpriced-ceiling-setting.test');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
