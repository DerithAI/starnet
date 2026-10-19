/* node test/managed-cache.test.js — STARNET MANAGED CACHES A CLAUDE PICK (token-burn audit 2026-10-17).

   The managed (credits) profile rides the openai-compatible adapter, which never sent cache_control, while the cloud proxy
   forwards the body to OpenRouter untouched — so every managed Claude call re-billed the whole prompt as fresh input on the
   user's credits. The profile now names explicitCache:'openrouter' and the adapter applies OpenRouter's own breakpoints.
   Driven through the REAL factory (registry profile -> factory wiring -> adapter body), zero network. */
'use strict';
const A = require('./_assert.js');
const factory = require('../sidecar/providers/factory.js');

function capture() {
  const bodies = [];
  const fetchImpl = async (url, init) => {
    if (init && init.body) bodies.push(JSON.parse(init.body));
    const sse = 'data: ' + JSON.stringify({ choices: [{ delta: { content: 'ok' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }) + '\n\ndata: [DONE]\n\n';
    return new Response(sse, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
  return { bodies, fetchImpl };
}
async function drive(providerId, model, extra) {
  const c = capture();
  const p = factory.selectProvider(Object.assign({ provider: providerId, key: 'k', baseUrl: 'http://127.0.0.1:9/v1', fetch: c.fetchImpl }, extra || {}));
  const stable = 'You are the overseer. ' + 'stable prefix. '.repeat(20);
  for await (const _ of p.stream({ model, cacheSystemPrefix: stable, messages: [{ role: 'system', content: stable + 'tail' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: 'yo' }, { role: 'user', content: 'again' }] })) { /* drain */ }
  return c.bodies[0];
}
const marks = body => JSON.stringify(body.messages).split('"cache_control"').length - 1;

(async () => {
  const claude = await drive('starnet', 'anthropic/claude-sonnet-4.6');
  A.ok(claude && marks(claude) >= 2, 'a managed Claude pick carries cache breakpoints (system prefix + conversation tail): ' + (claude ? marks(claude) : 'no body'));
  const sys = claude.messages[0];
  A.ok(Array.isArray(sys.content) && sys.content[0].cache_control && sys.content[0].text.indexOf('You are the overseer.') === 0, 'the stable system prefix is its own cached block');

  const gpt = await drive('starnet', 'openai/gpt-5.5');
  A.eq(marks(gpt), 0, 'a managed non-Claude pick is unchanged (no cache_control on the wire)');
  A.eq(typeof gpt.messages[0].content, 'string', '...its system message stays a plain string');

  const openai = await drive('openai', 'gpt-5.5');
  A.eq(marks(openai), 0, 'another openai-compatible profile (OpenAI API) never gets breakpoints');

  A.report('managed-cache.test');
})().catch(e => { console.error(e); process.exit(1); });
