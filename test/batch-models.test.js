/* node test/batch-models.test.js — fix lane batch-models-1023: a batch-only model id (OpenRouter's '<id>:batch')
   is never offered for chat, and an id an older build saved runs on its base model.

   THE DEFECT (StarNet Cloud proxy log 2026-10-23, three runs 45 minutes apart): a station sent
   'anthropic/claude-haiku-4.5:batch' to the managed proxy and got 404 "… cannot be used with the chat/completions
   endpoint (adapter AnthropicBatchAdapter)". OpenRouter's /models lists 75 such rows beside their base rows at half
   the price, the managed /v1/models passes them through, and nothing in the app filtered them, so every picker, the
   CLI's model question and the channel /model suggestions offered them, and a saved one failed every run.

   Locked here by executing the REAL code: provider.js's rule, the sidecar's model-list route and catalog snapshots
   (sliced out of index.js into a vm), the run seam's mapping (source lock: runOnceCore is not sliceable), the model
   dock (modeldock.js required against stub globals) and Harness.listModels (sliced out of harness.js). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const provider = require('../sidecar/providers/provider.js');

// A slice of the real 2026-10-23 OpenRouter catalog shape: base rows, their batch rows, a ':free' variant.
const CATALOG = [
  { id: 'anthropic/claude-haiku-4.5', name: 'Anthropic: Claude Haiku 4.5', supported_parameters: ['tools'] },
  { id: 'anthropic/claude-haiku-4.5:batch', name: 'Anthropic: Claude Haiku 4.5 (batch)', supported_parameters: ['tools'] },
  { id: 'openai/gpt-6-sol', name: 'OpenAI: GPT-6 Sol', supported_parameters: ['tools'] },
  { id: 'openai/gpt-6-sol:batch', name: 'OpenAI: GPT-6 Sol (batch)', supported_parameters: ['tools'] },
  { id: 'meta-llama/llama-5-8b:free', name: 'Meta: Llama 5 8B (free)', supported_parameters: ['tools'] }
];
const ids = list => list.map(m => m.id);

/* function a top-level function of index.js, cut at the next top-level `}` line */
function sliceTop(src, marker, label) {
  const start = src.indexOf(marker);
  A.ok(start >= 0, 'index.js still contains ' + label);
  const end = src.indexOf('\n}\n', start);
  A.ok(end > start, label + ' has a locatable end');
  return src.slice(start, end + 3);
}

module.exports = (async () => {
  /* ---------- 1. the rule itself (provider.js) ---------- */
  {
    A.eq(typeof provider.isBatchOnlyModel, 'function', 'provider.js exports isBatchOnlyModel');
    A.eq(typeof provider.chatModelId, 'function', 'provider.js exports chatModelId');
    A.ok(provider.isBatchOnlyModel('openrouter', 'anthropic/claude-haiku-4.5:batch'), 'an OpenRouter :batch row is batch-only');
    A.ok(provider.isBatchOnlyModel('starnet', 'anthropic/claude-haiku-4.5:batch'), 'a managed (StarNet) :batch row is batch-only');
    A.ok(!provider.isBatchOnlyModel('openrouter', 'anthropic/claude-haiku-4.5'), 'the base row is a chat model');
    A.ok(!provider.isBatchOnlyModel('openrouter', 'meta-llama/llama-5-8b:free'), 'a :free variant still runs on chat/completions');
    A.ok(!provider.isBatchOnlyModel('ollama', 'mymodel:batch'), 'an Ollama tag that happens to read :batch is a local model, untouched');
    A.ok(!provider.isBatchOnlyModel('custom', 'x/y:batch'), 'a custom endpoint keeps its own ids');
    A.eq(provider.chatModelId('starnet', 'anthropic/claude-haiku-4.5:batch'), 'anthropic/claude-haiku-4.5', 'a saved managed :batch id runs on its base model');
    A.eq(provider.chatModelId('openrouter', 'openai/gpt-6-sol:batch'), 'openai/gpt-6-sol', 'a saved OpenRouter :batch id runs on its base model');
    A.eq(provider.chatModelId('openrouter', 'openai/gpt-6-sol'), 'openai/gpt-6-sol', 'a chat id passes through unchanged');
    A.eq(provider.chatModelId('ollama', 'mymodel:batch'), 'mymodel:batch', 'another provider\'s id passes through unchanged');
    A.eq(provider.chatModelId('openrouter', ''), '', 'an empty id stays empty');
  }

  /* ---------- 2. the sidecar's model-list route + catalog snapshots (sliced out of index.js) ---------- */
  const index = read('sidecar', 'index.js');
  {
    const region = sliceTop(index, 'async function listModelsForProvider(providerId, opts) {', 'listModelsForProvider');
    const listed = providerId => vm.runInNewContext(region + '\nlistModelsForProvider(' + JSON.stringify(providerId) + ', {});', {
      normalizeProvider: p => String(p || 'openrouter'),
      getProviderProfile: () => ({}),
      providerRuntimeBaseUrl: () => 'https://example.invalid/v1',
      providerRuntimeKey: () => 'k',
      providerRequiresKey: () => false,
      providerRequiresBaseUrl: () => false,
      providerCredentialError: () => 'not configured',
      extraAccountProviderFor: () => null,
      providerUsesCodex: () => false,
      providerUsesDeviceOAuth: () => false,
      selectProvider: () => ({ listModels: async () => CATALOG.map(m => Object.assign({}, m)).concat([{ id: 'mymodel:batch' }]) }),
      ImageTask: require('../sidecar/image-task.js'),
      isBatchOnlyModel: provider.isBatchOnlyModel
    });
    const managed = await listed('starnet');
    A.ok(!ids(managed).some(id => /:batch$/.test(id)), 'GET /api/models/starnet offers no :batch row: ' + ids(managed).join(', '));
    A.ok(ids(managed).indexOf('anthropic/claude-haiku-4.5') >= 0 && ids(managed).indexOf('meta-llama/llama-5-8b:free') >= 0, 'base rows and :free variants stay offered');
    const routed = await listed('openrouter');
    A.ok(!ids(routed).some(id => /\/.*:batch$/.test(id)), 'GET /api/models/openrouter offers no :batch row (the pickers and the CLI read this route)');
    const local = await listed('ollama');
    A.ok(ids(local).indexOf('mymodel:batch') >= 0, 'a local provider keeps a model tagged :batch');
  }
  {
    const region = sliceTop(index, 'function warmModelCatalog() {', 'warmModelCatalog') +
      sliceTop(index, 'async function warmModelCatalogSet() {', 'warmModelCatalogSet');
    const sandbox = {
      orModelCatalogIds: [], _modelCatalogWarming: false,
      makeOpenRouterProvider: () => ({ listModels: async () => CATALOG.map(m => Object.assign({}, m)) }),
      providerRuntimeBaseUrl: () => '', OPENROUTER_BASE: 'https://openrouter.ai/api/v1',
      isBatchOnlyModel: provider.isBatchOnlyModel
    };
    vm.runInNewContext('var orModelCatalogIds = [], _modelCatalogWarming = false;\n' + region + '\nthis.warmModelCatalog = warmModelCatalog; this.warmModelCatalogSet = warmModelCatalogSet; this.snap = () => orModelCatalogIds;', sandbox);
    await sandbox.warmModelCatalog();
    const snap = sandbox.snap();
    A.ok(snap.length > 0 && !snap.some(id => /:batch$/.test(id)), 'the channel /model catalog (validation + "did you mean") holds no :batch id: ' + snap.join(', '));
    const set = await sandbox.warmModelCatalogSet();
    A.ok(set && set.has('openai/gpt-6-sol') && !set.has('openai/gpt-6-sol:batch'), 'the fallback-chain validation catalog holds no :batch id, so saving one warns');
  }

  /* ---------- 3. the run seam: a saved :batch id runs on its base model (source lock — runOnceCore is huge) ---------- */
  {
    A.ok(/const \{[^}]*\bchatModelId\b[^}]*\} = require\('\.\/providers\/provider\.js'\)/.test(index), 'index.js imports chatModelId from provider.js');
    const at = index.indexOf("let model = String((o && o.model) || '').trim() || (rosterIdent && rosterIdent.model");
    A.ok(at >= 0, 'runOnceCore still resolves its model in one place');
    const after = index.slice(at, at + 1600);
    A.ok(/\n  model = chatModelId\(providerId, model\);/.test(after), 'runOnceCore maps a batch-only id to its base model right after resolving it (before any event names it)');
    A.ok(after.indexOf('model = chatModelId(providerId, model)') < after.indexOf("emit('agent.run.start'") || after.indexOf("emit('agent.run.start'") < 0, 'the mapping happens before the run announces its model');
    const fb = index.indexOf('const fallbackModels = (Array.isArray(o.fallbackModels) ? o.fallbackModels : effectiveFallbackChain())');
    A.ok(fb >= 0, 'the run still builds its fallback chain in one place');
    A.ok(/chatModelId\(/.test(index.slice(fb, fb + 400)), 'a saved fallback chain\'s :batch id runs on its base model too');
  }

  /* ---------- 4. the model dock (modeldock.js, executed) ---------- */
  const dockPath = path.join(root, 'frontend', 'app', 'modeldock.js');
  function loadDock(opts) {
    let prov = opts.provider || 'starnet', model = opts.model || '', revision = 0;
    const el = id => ({ id, hidden: true, textContent: '', innerHTML: '', style: {}, dataset: {}, isConnected: true,
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false }, setAttribute() {}, getAttribute: () => null,
      removeAttribute() {}, addEventListener() {}, appendChild() {}, querySelector: () => null, querySelectorAll: () => [], focus() {}, contains: () => false });
    const els = { 'model-dock': el('model-dock'), 'model-dock-toggle': el('model-dock-toggle') };
    const old = { document: global.document, localStorage: global.localStorage, Harness: global.Harness, U: global.U };
    global.document = { getElementById: id => els[id] || null, querySelector: () => null, addEventListener() {}, createElement: () => el(''), createDocumentFragment: () => ({ appendChild() {} }) };
    global.localStorage = { getItem: () => '1', setItem() {} };
    global.U = { esc: s => String(s) };
    global.Harness = {
      getSelectionRevision: () => revision,
      getProv: () => prov, setProv: v => { revision++; prov = v; },
      getModel: () => model, setModel: v => { revision++; model = v; },
      getReasoningEffort: () => 'medium', setReasoningEffort() {}, normalizeReasoningEffort: v => String(v || 'medium'),
      configured: p => p === prov, getKey: () => '', getBaseUrl: () => '', listModels: async () => [],
      apiFetch: async url => url === '/api/models/' + prov
        ? new Response(JSON.stringify({ provider: prov, models: opts.catalog }), { status: 200 })
        : new Response(JSON.stringify({ models: [], error: 'not configured', connected: false }), { status: 200 })
    };
    delete require.cache[require.resolve(dockPath)];
    const dock = require(dockPath);
    return { dock, state: () => ({ provider: prov, model }), restore: () => { delete require.cache[require.resolve(dockPath)]; Object.assign(global, old); } };
  }
  {
    const t = loadDock({ catalog: CATALOG });
    try {
      const keep = t.dock._internals.isAgentModel;
      A.ok(!keep({ id: 'anthropic/claude-haiku-4.5:batch', provider: 'starnet' }), 'the dock never offers a managed :batch row');
      A.ok(!keep({ id: 'openai/gpt-6-sol:batch', provider: 'openrouter' }), 'the dock never offers an OpenRouter :batch row');
      A.ok(keep({ id: 'anthropic/claude-haiku-4.5', provider: 'starnet' }) && keep({ id: 'meta-llama/llama-5-8b:free', provider: 'openrouter' }), 'base rows and :free variants stay offered');
      A.ok(keep({ id: 'mymodel:batch', provider: 'ollama' }), 'a local model tagged :batch stays offered');
      const eqv = t.dock._internals.catalogEquivalent;
      const offered = CATALOG.filter(m => keep(Object.assign({ provider: 'starnet' }, m)));
      A.eq(eqv('anthropic/claude-haiku-4.5:batch', 'starnet', offered), 'anthropic/claude-haiku-4.5', 'a saved :batch id maps to its base row when the catalog lists it');
      A.eq(eqv('anthropic/claude-haiku-9:batch', 'starnet', offered), '', 'never a base the catalog lacks');
      A.eq(eqv('mymodel:batch', 'ollama', [{ id: 'mymodel' }]), '', 'a local tag is never rewritten');
    } finally { t.restore(); }
  }
  {
    // A 0.13.x station whose dock model is the batch row: the confirmed catalog moves it to the base row (persisted
    // as a catalog_reconcile), never clears it to "no model".
    const t = loadDock({ model: 'anthropic/claude-haiku-4.5:batch', catalog: CATALOG });
    const applied = [];
    try {
      t.dock.init({ apply: c => applied.push(c), identity: () => 'agent' });
      for (let i = 0; i < 100 && !applied.length; i++) await sleep(5);
      A.eq(t.state().model, 'anthropic/claude-haiku-4.5', 'the saved :batch dock model becomes its base model');
      A.eq(applied[0] && applied[0].reason, 'catalog_reconcile', 'it is a reconcile with the old id named, never catalog_unavailable');
      A.eq(applied[0] && applied[0].previousModel, 'anthropic/claude-haiku-4.5:batch', 'the reconcile names the id it replaced');
    } finally { t.restore(); }
  }

  /* ---------- 5. Harness.listModels (sliced out of harness.js, like ctx-model-catalog.test.js) ---------- */
  {
    const source = read('frontend', 'app', 'harness.js');
    const fnRegion = (label, marker) => {
      const start = source.indexOf(marker);
      A.ok(start >= 0, 'harness.js still contains ' + label);
      const end = source.indexOf('\n  }\n', start);
      return source.slice(start, end + 4);
    };
    const stateStart = source.indexOf('  let totals = { tokens: 0, cost: 0, calls: 0 };');
    const stateEnd = ['  /* CONTEXT OCCUPANCY IS PER CONVERSATION', '  // Per-agent context-window occupancy'].map(a => source.indexOf(a)).find(i => i >= 0);
    A.ok(stateStart >= 0 && stateEnd > stateStart, 'the harness catalog state region can be isolated');
    const region = fnRegion('normalizeProviderId', '  function normalizeProviderId(provider) {') + source.slice(stateStart, stateEnd) +
      fnRegion('listModels', '  async function listModels(provider) {');
    let direct = false;
    const sandbox = {
      console: { warn() {}, log() {} }, OR: 'https://openrouter.ai/api/v1', getProv: () => 'openrouter', getBaseUrl: () => '',
      fetchModelCatalog: async url => {
        if (url.indexOf('/api/models/') === 0) { if (direct) throw new Error('station unreachable'); return CATALOG.map(m => Object.assign({}, m)); }
        return CATALOG.map(m => Object.assign({}, m));   // the direct OpenRouter fallback: the raw upstream list
      }
    };
    const api = vm.runInNewContext(region + '\n({ listModels });', sandbox);
    A.ok(!ids(await api.listModels('starnet')).some(id => /:batch$/.test(id)), 'Harness.listModels(starnet) offers no :batch row');
    direct = true;
    const raw = ids(await api.listModels('openrouter'));
    A.ok(raw.length > 0 && !raw.some(id => /:batch$/.test(id)), 'the direct OpenRouter fallback (sidecar unreachable) offers no :batch row either: ' + raw.join(', '));
  }
  A.report('batch-models.test');
})().catch(e => { console.error(e); process.exitCode = 1; });
