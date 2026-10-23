/* node test/loop.stream-cut.test.js — A STOP THAT CUT A CALL OFF MID-STREAM (bug 80de2a75).

   The provider bills a model call from its first streamed byte, but the call's full usage arrives only as its stream
   ends. A cancel that cuts an attempt off after it began streaming leaves that call booked short, so the loop returns
   `streamCut: true` on the cancelled result and the run record says its spend is a floor (index.js usageMissing), or
   unknown when nothing at all was booked. Locked here, against the loop alone (zero network):
     · a Stop while text streams, or after a usage-first (Anthropic message_start) chunk, or one the adapter answers by
       throwing AbortError: streamCut
     · usage arriving in the SAME chunk as the turn's last words (openai-compatible yields usage before text), then a
       Stop while the next call has sent no byte: NOT cut — every streamed call was booked
     · a Stop during a tool call, after the stream closed: NOT cut
     · a run that is not cancelled never carries the field */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeRegistry } = require('../sidecar/tools/registry.js');

const openCtx = (extra) => Object.assign({ canRun: () => true, canUse: () => ({ ok: true }), agentId: 'a', room: 'office' }, extra || {});
const priceOf = () => ({ in: 1, out: 2 });   // $1/$2 per million
function setup() {
  const bus = A.makeBus();
  const seq = A.collectBus(bus, events.names());
  return { seq, emit: makeEmitter(bus, () => {}) };
}
const abortErr = () => Object.assign(new Error('The operation was aborted'), { name: 'AbortError' });
const NOOP = { name: 'note_x', schema: { type: 'object', properties: { v: { type: 'string' } } } };
// calls: one generator factory per provider call, (ac) => async function* () {...}
async function run(calls, opts) {
  const o = opts || {};
  const { seq, emit } = setup();
  const ac = new AbortController();
  let n = 0;
  const provider = { stream: () => calls[Math.min(n++, calls.length - 1)](ac)(), priceOf, contextLimit: () => 0 };
  const reg = makeRegistry();
  reg.register({ name: NOOP.name, schema: NOOP.schema, run: async () => { if (o.abortInTool) ac.abort(); return 'noted'; } });
  const res = await runAgentLoop({
    messages: [{ role: 'user', content: 'go' }], provider, emit, cost: makeCostEngine({ priceOf }),
    model: 'm/model', agentId: 'a', runId: 'r', tools: [{ type: 'function', function: { name: NOOP.name, parameters: NOOP.schema } }],
    limits: { maxIters: 5, grace: false }, signal: ac.signal,
    dispatch: (c, ctx) => reg.dispatch(c, ctx), capCtx: openCtx({ signal: ac.signal }), clock: { now: () => Date.now() }
  });
  return { res, seq, calls: n };
}
const toolTurnUsageFirst = () => async function* () {
  yield { type: 'tool_start', index: 0, id: 'c0', name: NOOP.name };
  yield { type: 'tool_args', index: 0, chunk: '{"v":"x"}' };
  // openai-compatible emitFrom: a chunk carrying usage AND text yields the usage first
  yield { type: 'usage', usage: { prompt_tokens: 1000, completion_tokens: 100 } };
  yield { type: 'text', delta: 'Noting it.' };
  yield { type: 'done', finishReason: 'tool_calls' };
};

(async () => {
  // (1) Stop while the answer's text streams, no usage yet: cut, and nothing was booked
  {
    const { res } = await run([ac => async function* () {
      yield { type: 'text', delta: 'Here is the first half' };
      ac.abort();
      yield { type: 'text', delta: ' and the rest' };
      yield { type: 'usage', usage: { prompt_tokens: 1000, completion_tokens: 100 } };
      yield { type: 'done', finishReason: 'stop' };
    }]);
    A.eq(res.reason, 'cancelled', 'text stream: the run ends cancelled');
    A.eq(res.streamCut, true, 'text stream: a Stop mid-stream is a cut call');
    A.eq(res.usd, 0, 'text stream: nothing was booked (the usage never arrived)');
  }
  // (2) Anthropic shape: message_start usage (input) first, then text, then the Stop: cut, with the input booked
  {
    const { res } = await run([ac => async function* () {
      yield { type: 'usage', usage: { prompt_tokens: 1000, completion_tokens: 1 } };
      yield { type: 'text', delta: 'Partial' };
      ac.abort();
      yield { type: 'text', delta: ' more' };
    }]);
    A.eq(res.streamCut, true, 'usage-first stream: still a cut call (its output usage never arrived)');
    A.ok(res.usd > 0, 'usage-first stream: the input that was reported is booked: ' + res.usd);
  }
  // (3) the adapter answers the abort by throwing AbortError mid-stream: cut
  {
    const { res } = await run([ac => async function* () {
      yield { type: 'text', delta: 'Some words' };
      ac.abort();
      throw abortErr();
    }]);
    A.eq(res.reason, 'cancelled', 'thrown abort: the run ends cancelled');
    A.eq(res.streamCut, true, 'thrown abort: a cut call');
  }
  // (4) the adapter returns quietly on the abort (no throw, no more events): still cut
  {
    const { res } = await run([ac => async function* () {
      yield { type: 'text', delta: 'Some words' };
      ac.abort();
    }]);
    A.eq(res.reason, 'cancelled', 'quiet return: the run ends cancelled');
    A.eq(res.streamCut, true, 'quiet return: a cut call');
  }
  // (5) the reviewer's order: call 1's usage came before its last words and was booked; the Stop lands while call 2
  //     has sent no byte. Nothing was cut.
  {
    const { res, seq, calls } = await run([toolTurnUsageFirst, ac => async function* () {
      await new Promise(r => setTimeout(r, 5));
      ac.abort();
      throw abortErr();
    }]);
    A.eq(calls, 2, 'usage-first then silent: the second call went out');
    A.eq(res.reason, 'cancelled', 'usage-first then silent: the run ends cancelled');
    A.ok(res.usd > 0, 'usage-first then silent: call 1 was booked: ' + res.usd);
    A.ok(res.streamCut !== true, 'usage-first then silent: a Stop before the next call\'s first byte cut nothing');
    const names = seq.map(e => e.name);
    A.ok(names.indexOf('cost.estimate') >= 0 && names.indexOf('cost.estimate') < names.indexOf('agent.token'), 'the usage really did come before the text: ' + names.filter(x => /cost|token/.test(x)).join(','));
  }
  // (6) the Stop lands during a tool call, after the stream closed: nothing was cut
  {
    const { res } = await run([toolTurnUsageFirst, () => async function* () {
      yield { type: 'text', delta: 'done' }; yield { type: 'done', finishReason: 'stop' };
    }], { abortInTool: true });
    A.eq(res.reason, 'cancelled', 'Stop in a tool: the run ends cancelled');
    A.ok(res.streamCut !== true, 'Stop in a tool: no call was cut');
  }
  // (7) a run that is not cancelled never carries the field
  {
    const { res } = await run([() => async function* () {
      yield { type: 'text', delta: 'All of it' };
      yield { type: 'usage', usage: { prompt_tokens: 10, completion_tokens: 3 } };
      yield { type: 'done', finishReason: 'stop' };
    }]);
    A.eq(res.reason, 'done', 'a finished run is done');
    A.ok(!('streamCut' in res), 'a finished run has no streamCut field');
  }
  A.report('loop.stream-cut');
})().catch(e => { console.error(e); process.exit(1); });
