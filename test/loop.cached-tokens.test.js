/* node test/loop.cached-tokens.test.js — A RUN REPORTS HOW MUCH OF ITS INPUT CAME FROM CACHE (token-burn audit 2026-10-17).

   runAgentLoop's `tokens` counts every input token at full weight, cache reads included, so a run row could never show
   whether prompt caching worked (0 of 668 real rows carried a cached count). The loop now totals the provider's own
   cached_tokens beside it and returns result.cachedTokens, which the host writes to the run row and the ledger. */
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeCostEngine } = require('../sidecar/cost.js');

test('result.cachedTokens totals the cache-served input of every model call in the run', async () => {
  let calls = 0;
  const usages = [
    { prompt_tokens: 20000, completion_tokens: 30, total_tokens: 20030, prompt_tokens_details: { cached_tokens: 0 } },
    { prompt_tokens: 21000, completion_tokens: 40, total_tokens: 21040, prompt_tokens_details: { cached_tokens: 19500 } }
  ];
  const provider = { async *stream() {
    const u = usages[calls++];
    if (calls === 1) {
      yield { type: 'tool_start', index: 0, id: 'c1', name: 'fs_read' };
      yield { type: 'tool_args', index: 0, chunk: '{"path":"a.txt"}' };
      yield { type: 'tool_done', index: 0 };
      yield { type: 'usage', usage: u };
      yield { type: 'done', finishReason: 'tool_calls' };
    } else {
      yield { type: 'text', delta: 'The file has 3 lines.' };
      yield { type: 'usage', usage: u };
      yield { type: 'done', finishReason: 'stop' };
    }
  } };
  const result = await runAgentLoop({
    messages: [{ role: 'user', content: 'count the lines in a.txt' }], provider,
    emit: () => {}, cost: makeCostEngine(), model: 'text/model', agentId: 'a', runId: 'r',
    signal: new AbortController().signal, limits: { maxIters: 4 },
    capCtx: { canRun: () => true, canUse: () => ({ ok: true }), agentId: 'a' },
    dispatch: async () => ({ ok: true, content: 'alpha\nbeta\ngamma', summary: 'read' })
  });
  assert.equal(calls, 2, 'two model calls');
  assert.equal(result.tokens, 20030 + 21040, 'tokens still counts every input token at full weight (unchanged)');
  assert.equal(result.cachedTokens, 19500, 'cachedTokens is the provider-reported cache-served input, summed across calls');
});
