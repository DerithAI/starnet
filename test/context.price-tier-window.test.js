/* node test/context.price-tier-window.test.js — a long run never crosses its model's long-context PRICE TIER
   (context-cost-1023).

   0.13.5 sized every run from a cold catalog: the Anthropic adapter answered 200000 for every model, Gemini and the
   OpenAI-compatible adapters the cold 131072 guess. 0.14.0 reads the REAL window (1M on Gemini Pro, 2M on grok) and
   folds at 65% of it, so a long session sent 200k-650k-token turns — past the prompt size where Gemini Pro and grok
   bill a higher rate (200k) and Haiku 5.5 bills 5x (100K), which prices.js does not price: the cost meter and every
   spend cap under-reported. Locked here:
     A. prices.promptTierTokens names exactly the tier boundaries prices.js documents, on any route, and 0 elsewhere;
     B. makeContext's windowCeiling caps the working window (threshold + tail), read LIVE so a fallback's model brings
        its own ceiling; a smaller real window (a local model) and a linear-priced 1M model keep their real window;
     C. through the real loop, a 1M-window Gemini Pro run with the ceiling folds before any request reaches 200k
        tokens (without it the same run sends a request past 200k);
     D. index.js builds the run's context manager with the live ceiling. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const prices = require('../sidecar/providers/prices.js');
const { makeContext, RUN_CONTEXT_DEFAULTS } = require('../sidecar/context.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeCostEngine } = require('../sidecar/cost.js');

(async () => {
  // ---- A. the documented tier boundaries ----
  {
    const T = prices.promptTierTokens;
    A.eq(typeof T, 'function', 'prices.js exports promptTierTokens');
    for (const id of ['claude-haiku-5-5', 'claude-haiku-5.5', 'claude-haiku-5-5-20261001', 'anthropic/claude-haiku-5.5']) {
      A.eq(T(id), 100000, 'Haiku 5.5 bills 5x above a 100K prompt: ' + id);
    }
    for (const id of ['gemini-2.5-pro', 'gemini-3-pro-preview', 'gemini-3.1-pro', 'models/gemini-2.5-pro', 'google/gemini-2.5-pro', 'gemini-pro-latest']) {
      A.eq(T(id), 200000, 'Gemini Pro bills a higher rate above a 200k prompt: ' + id);
    }
    for (const id of ['grok-4.6', 'grok-4.20-0309-reasoning', 'grok-build', 'x-ai/grok-4.5']) {
      A.eq(T(id), 200000, 'grok bills 2x at a 200k+ prompt: ' + id);
    }
    // linear-priced models, models with no documented tier, local models: no ceiling (their real window is kept)
    for (const id of ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-opus-5-5', 'claude-haiku-4-5', 'gemini-2.5-flash', 'gemini-3.5-flash',
      'gpt-5.4', 'llama3.1:8b', 'qwen3:8b', 'deepseek-v4-pro', '', null, undefined]) {
      A.eq(T(id), 0, 'no documented tier -> no ceiling: ' + JSON.stringify(id));
    }
    // every boundary named here is one the price table documents in its own row comments (never invented)
    const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'providers', 'prices.js'), 'utf8');
    A.ok(/claude-haiku-5\[-\.\]5\/i,\s+\{ in: 0\.10, out: 0\.50 \}\],\s+\/\/ prompts <= 100K tokens/.test(src), 'the Haiku 5.5 row documents its 100K tier');
    A.ok(/gemini-3\\\.1-pro\/i,\s+\{ in: 2\.00, out: 12\.00 \}\],\s+\/\/ <=200k prompt tier/.test(src), 'the Gemini 3.1 Pro row documents its 200k tier');
    A.ok(/gemini-2\\\.5-pro\/i,\s+\{ in: 1\.25, out: 10\.00 \}\],\s+\/\/ base tier; >200k prompt bills higher/.test(src), 'the Gemini 2.5 Pro row documents its 200k tier');
    A.ok(/<200k-prompt tier \(the >=200k tier bills 2x/.test(src), 'the xAI table documents its 200k tier');
  }

  // ---- B. the manager's window ceiling ----
  {
    const D = RUN_CONTEXT_DEFAULTS;
    const gem = makeContext(Object.assign({ contextLimit: 1048576, windowCeiling: 200000 }, D));
    A.eq(gem.contextLimit, 200000, 'a 1M Gemini Pro run works in a 200k window');
    A.eq(gem.thresholdTokens(), 130000, 'it folds at 65% of 200k (130k), not of 1M (681k)');
    A.eq(gem.tailBudgetTokens(), 40000, 'its verbatim tail is 20% of 200k (40k), not 210k');
    A.eq(gem.shouldCompact({ prompt_tokens: 140000 }), true, 'a 140k prompt is due a fold');
    const haiku = makeContext(Object.assign({ contextLimit: 200000, windowCeiling: 100000 }, D));
    A.eq([haiku.contextLimit, haiku.thresholdTokens()], [100000, 65000], 'Haiku 5.5 works in 100K and folds at 65K');
    const local = makeContext(Object.assign({ contextLimit: 32768, windowCeiling: 200000 }, D));
    A.eq(local.contextLimit, 32768, 'a smaller real window (a local model) is kept: the ceiling only ever lowers');
    const linear = makeContext(Object.assign({ contextLimit: 1000000, windowCeiling: 0 }, D));
    A.eq(linear.contextLimit, 1000000, 'no tier (Opus / Sonnet 4.6+, linear price): the real 1M window is kept');
    const unset = makeContext(Object.assign({ contextLimit: 1000000 }, D));
    A.eq(unset.contextLimit, 1000000, 'no ceiling passed: every legacy caller is unchanged');
    const unknown = makeContext(Object.assign({ contextLimit: 0, windowCeiling: 200000 }, D));
    A.eq(unknown.contextLimit, 0, 'an unknown window stays unknown (the ceiling never invents one)');
    const broken = makeContext(Object.assign({ contextLimit: 1000000, windowCeiling: () => { throw new Error('boom'); } }, D));
    A.eq(broken.contextLimit, 1000000, 'a throwing ceiling never wedges the run');

    // LIVE: a fallback swaps the model, then the loop re-resolves the window with setContextLimit
    let model = 'gemini-2.5-pro';
    const live = makeContext(Object.assign({ contextLimit: 1048576, windowCeiling: () => prices.promptTierTokens(model) }, D));
    A.eq(live.contextLimit, 200000, 'live: Gemini Pro starts in 200k');
    model = 'claude-sonnet-4-6';
    A.eq(live.setContextLimit(1000000), 1000000, 'live: a fallback to a linear-priced 1M model gets its real window');
    A.eq(live.contextLimit, 1000000, 'live: and exposes it');
    model = 'claude-haiku-5-5';
    A.eq(live.setContextLimit(200000), 100000, 'live: a fallback to Haiku 5.5 is held under its 100K tier');
    A.eq(live.thresholdTokens(), 65000, 'live: and folds at 65K');
  }

  // ---- C. the real loop: a long 1M-window Gemini Pro run stays under its 200k tier ----
  async function longRun(windowCeiling) {
    const ctx = makeContext(Object.assign({ contextLimit: 1048576, windowCeiling }, RUN_CONTEXT_DEFAULTS));
    const sent = [];
    let turn = 0;
    const provider = { priceOf: () => null, contextLimit: () => 1048576, stream: async function* (req) {
      turn++;
      const est = ctx.estimateMessages(req.messages);
      sent.push(est);
      if (turn <= 16) {
        yield { type: 'tool_start', index: 0, id: 'c' + turn, name: 'read' }; yield { type: 'tool_args', index: 0, chunk: '{}' };
        yield { type: 'usage', usage: { prompt_tokens: est, completion_tokens: 2, total_tokens: est + 2 } }; yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }
      yield { type: 'text', delta: 'REPORT' }; yield { type: 'usage', usage: { prompt_tokens: est, completion_tokens: 2, total_tokens: est + 2 } }; yield { type: 'done', finishReason: 'stop' };
    } };
    const compacts = [];
    const res = await runAgentLoop({
      messages: [{ role: 'system', content: 'You are an auditor.' }, { role: 'user', content: 'Read every file and report.' }],
      provider, cost: makeCostEngine({ priceOf: () => null }), context: ctx, contextLimit: 1048576,
      tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object', properties: {} } } }],
      dispatch: async (c) => ({ ok: true, content: 'file ' + c.id + ' ' + 'x'.repeat(60000) }),   // ~15k tokens a turn
      emit: (nm, p) => { if (nm === 'agent.compact') compacts.push(p); },
      summarize: async () => ({ summary: '## Active Task\nRead files.', usd: 0, tokens: 0 }),
      microCompaction: false, model: 'gemini-2.5-pro', agentId: 'a', runId: 'r', limits: { maxIters: 30 }
    });
    return { res, sent, compacts, max: Math.max.apply(null, sent) };
  }
  {
    const without = await longRun(0);
    A.eq(without.res.reason, 'done', 'setup: the run without a ceiling completes');
    A.ok(without.max > 200000, 'setup: without the ceiling the same run sends a request past the 200k tier (' + without.max + ' tokens)');
    const capped = await longRun(() => prices.promptTierTokens('gemini-2.5-pro'));
    A.eq(capped.res.reason, 'done', 'with the ceiling the run completes');
    A.ok(capped.compacts.length >= 1, 'with the ceiling the run folded (' + capped.compacts.length + ' folds)');
    A.ok(capped.max < 200000, 'with the ceiling no request reached the 200k tier (largest ' + capped.max + ' tokens)');
  }

  // ---- D. index.js builds the run's context manager with the live ceiling (the run site boots a sidecar: source lock) ----
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    A.ok(/const \{ promptTierTokens \} = require\('\.\/providers\/prices\.js'\);/.test(src), 'index.js imports promptTierTokens');
    A.ok(src.indexOf('const runWindowCeiling = () => providerUnmetered ? 0 : promptTierTokens(model);') > 0,
      'the ceiling reads the run\'s live model (swapped by onFallback); an unmetered run (subscription / local: no $ caps) keeps its real window');
    const ceilAt = src.indexOf('const runWindowCeiling = ');
    A.ok(ceilAt > src.indexOf('let providerUnmetered = ') && src.indexOf('if (typeof next.unmetered === \'boolean\') providerUnmetered = next.unmetered;') > ceilAt,
      'providerUnmetered is the run\'s live binding (declared before the ceiling, swapped by onFallback after it)');
    A.ok(src.indexOf('const ctxMgr = makeContext(Object.assign({ contextLimit: CONTEXT_LIMIT_OVERRIDE || knownRunWindow || COLD_CATALOG_CONTEXT_TOKENS, windowCeiling: runWindowCeiling }, RUN_CONTEXT_DEFAULTS));') > 0,
      'the run\'s context manager is built with the ceiling');
  }

  A.report('context.price-tier-window.test');
})().catch(e => { console.log('FAIL: context.price-tier-window.test threw -- ' + (e && e.stack || e)); process.exit(1); });
