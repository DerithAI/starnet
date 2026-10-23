/* node test/provider-403-upstream-refusal.test.js — a provider refusing ONE request is not a rejected key, and the
   failure review never re-sends refused content to the provider that refused it (xai-403-1023).

   Live (StarNet Cloud proxy logs 2026-10-23 03:38-04:47 UTC): 26 managed completions failed with
   {"status":403,"type":"upstream_error","provider":"xAI","message":"Provider returned error"}, in pairs 1-2 s apart.
   · The app filed every 403 as `auth` (a rejected credential): a StarNet-credits user, who has no key, was told
     "The provider rejected the API key — check it, or paste a new one under SETTINGS → AI & MODELS".
     A router that rejects OUR credential answers 401 with no provider named; a 403 that NAMES the upstream provider
     means our key got through and the upstream (xAI's safety check, typically) refused this request.
   · The second request of each pair was the failure review: it sends the end of the same conversation to the same
     provider and model that had just refused it, and its cooldown only arms on a saved lesson, so it repeats after
     every failed run.
   Pinned through the REAL adapters (managed openai-compatible + direct OpenRouter), on both friendlyerror paths
   (browser = loaded without require), on the pure fail-review predicate, and on the gate that consumes it. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { classifyApiError } = require('../sidecar/providers/errorClass.js');
const { makeOpenAICompatibleProvider } = require('../sidecar/providers/openai-compatible.js');
const { makeOpenRouterProvider } = require('../sidecar/providers/openrouter.js');
const Failreview = require('../sidecar/failreview.js');
const NodeFriendly = require('../frontend/app/friendlyerror.js');
const BrowserFriendly = (() => {
  const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'friendlyerror.js'), 'utf8'), ctx);
  return ctx.Friendly;
})();
const both = [['browser', BrowserFriendly], ['node', NodeFriendly]];

const jsonFetch = (status, body) => async (url, init) => {
  if (!init || !init.body) return new Response('{"data":[]}', { status: 200 });
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
};
async function thrown(p, req) {
  try { for await (const _ of p.stream(req)) { /* drain */ } } catch (e) { return e; }
  return null;
}
const REQ = { model: 'x-ai/grok-4.1-fast', messages: [{ role: 'user', content: 'hi' }], preStreamRetries: 0 };
// what the StarNet Cloud proxy answers (safeUpstreamFailure keeps message/type/code/provider only)
const MANAGED_403 = { error: { status: 403, type: 'upstream_error', code: 403, provider: 'xAI', message: 'Provider returned error' } };
const mkManaged = body => makeOpenAICompatibleProvider({ key: 'fixture-link-token', baseUrl: 'https://managed.example.test/v1', fetch: jsonFetch(403, body) });
const mkOpenRouter = body => makeOpenRouterProvider({ key: 'sk-or-v1-fixture', baseUrl: 'https://or.test/api/v1', fetch: jsonFetch(403, body) });
const REJECTED = /rejected the API key/i;

(async () => {
  // ---- 1. the managed (StarNet credits) 403 naming xAI: not auth — the model refused this request ----
  const managedErr = await thrown(mkManaged(MANAGED_403), REQ);
  A.ok(managedErr && managedErr.status === 403, 'managed: the 403 throws with its status');
  A.ok(/^openai-compatible http 403 - \[[^\]]*provider xAI\] Provider returned error/.test(String(managedErr && managedErr.message)),
    'managed: the adapter sentence names the upstream provider (' + (managedErr && managedErr.message) + ')');
  {
    const cls = classifyApiError(managedErr, { model: REQ.model });
    A.eq(cls.reason, 'model_not_found', 'managed xAI 403: the upstream refused this request, not our key (got ' + cls.reason + ')');
    A.eq(cls.retryable, false, 'managed xAI 403: never re-sent');
    A.eq(cls.shouldRotateCredential, false, 'managed xAI 403: the credential is not rotated');
    A.eq(cls.shouldFallback, true, 'managed xAI 403: a configured fallback model may answer');
  }
  // the classifier reads each structured signal on its own: err.upstreamProvider, error.provider, metadata.provider_name
  {
    const bare = m => Object.assign(new Error(m), { status: 403 });
    A.eq(classifyApiError(Object.assign(bare('openai-compatible http 403 - denied'), { upstreamProvider: 'xAI' }), {}).reason, 'model_not_found', 'err.upstreamProvider alone names the upstream');
    A.eq(classifyApiError(Object.assign(bare('openai-compatible http 403 - denied'), { body: { error: { message: 'denied', provider: 'xAI' } }, ownMessage: true }), {}).reason, 'model_not_found', 'error.provider alone names the upstream');
    A.eq(classifyApiError(Object.assign(bare('openai-compatible http 403 - denied'), { body: { error: { message: 'denied', metadata: { provider_name: 'xAI' } } }, ownMessage: true }), {}).reason, 'model_not_found', 'metadata.provider_name alone names the upstream');
    A.eq(classifyApiError(Object.assign(bare('openai-compatible http 403 - denied'), { body: { error: { message: 'denied', metadata: { provider_name: null } } }, ownMessage: true }), {}).reason, 'auth', 'a null provider_name names nobody: still auth');
  }

  // ---- 2. the direct OpenRouter provider: the same refusal, with and without xAI's own safety words ----
  {
    const err = await thrown(mkOpenRouter({ error: { message: 'Provider returned error', code: 403, metadata: { provider_name: 'xAI' } } }), REQ);
    A.eq(classifyApiError(err, { model: REQ.model }).reason, 'model_not_found', 'OpenRouter xAI 403 without a reason: model_not_found, never auth');
    const safety = await thrown(mkOpenRouter({ error: { message: 'Provider returned error', code: 403, metadata: { provider_name: 'xAI', raw: 'Content violates usage guidelines. Failed check: SAFETY_CHECK_TYPE_BIO' } } }), REQ);
    A.eq(classifyApiError(safety, { model: REQ.model }).reason, 'content_policy_blocked', 'OpenRouter xAI 403 naming its safety check: content_policy_blocked');
  }

  // ---- 3. what the Commander reads, on BOTH friendlyerror paths ----
  const managedRaw = String(managedErr && managedErr.message);
  for (const [label, F] of both) {
    const v = F.friendlyError(managedRaw);
    A.eq(v.kind, 'model_not_found', label + ': managed xAI 403 is not auth (got ' + v.kind + ')');
    A.ok(!REJECTED.test(v.userMessage), label + ': never "the provider rejected the API key" (' + v.userMessage + ')');
    A.ok(/xAI/.test(v.userMessage) && /refused this request/.test(v.userMessage), label + ': names the provider that refused this request (' + v.userMessage + ')');
    A.ok(!/Provider returned error|upstream_error|\[request/.test(v.userMessage), label + ': no raw upstream text in the headline (' + v.userMessage + ')');
    const or = F.friendlyError('openrouter http 403 — Provider returned error');
    A.eq(or.kind, 'model_not_found', label + ': OpenRouter "Provider returned error" 403 is not auth (got ' + or.kind + ')');
    A.ok(!REJECTED.test(or.userMessage) && /refused this request/.test(or.userMessage), label + ': OpenRouter upstream 403 says the request was refused (' + or.userMessage + ')');
  }

  // ---- 4. neighbours keep their verdicts: a real bad key, a key limit, a region refusal ----
  A.eq(classifyApiError(Object.assign(new Error('openrouter http 401 — User not found.'), { status: 401 }), {}).reason, 'auth', 'a 401 with no provider named stays auth');
  A.eq(classifyApiError(Object.assign(new Error('anthropic http 403 — permission_error: this key cannot use this model'), { status: 403 }), {}).reason, 'auth', 'a 403 naming no upstream stays auth');
  A.eq(classifyApiError(Object.assign(new Error('openrouter http 403 — Key limit exceeded (total limit).'), { status: 403 }), {}).reason, 'billing', 'OpenRouter key limit stays billing');
  for (const [label, F] of both) {
    A.eq(F.friendlyError('openrouter http 401 — User not found.').kind, 'auth', label + ': 401 User not found stays auth');
    A.ok(REJECTED.test(F.friendlyError('openai-compatible http 403 - Forbidden').userMessage), label + ': a provider-less 403 still reads as a rejected key');
    const region = F.friendlyError('openrouter http 403 — Provider returned error — {"error":{"code":"unsupported_country_region_territory","message":"Country, region, or territory not supported"}}');
    A.eq(region.kind, 'model_not_found', label + ': region refusal stays model_not_found');
    A.ok(/isn't available/.test(region.userMessage), label + ': region refusal keeps the model-unavailable copy (' + region.userMessage + ')');
  }

  // ---- 5. the failure review skips a run the provider refused (the second request of each pair) ----
  const PS = 'provider_stream';
  for (const code of ['auth', 'billing', 'quota_exhausted']) {
    A.ok(Failreview.providerRefused({ failureStage: PS, failureCode: code }), code + ': the account/credential refused — no review on it');
    A.ok(Failreview.providerRefused({ failureStage: PS, failureCode: code }, { separateModel: true }), code + ': a separate aux model rides the same credential — still no review');
  }
  for (const code of ['content_policy_blocked', 'model_not_found']) {
    A.ok(Failreview.providerRefused({ failureStage: PS, failureCode: code }), code + ': the same model would refuse the same content — no review');
    A.ok(!Failreview.providerRefused({ failureStage: PS, failureCode: code }, { separateModel: true }), code + ': a separate aux model may read it — the review may run');
  }
  for (const code of ['format_error', 'rate_limit', 'server_error', 'timeout', 'unknown', 'provider_failure', '']) {
    A.ok(!Failreview.providerRefused({ failureStage: PS, failureCode: code }), code + ': not a refusal the review would repeat');
  }
  A.ok(!Failreview.providerRefused({ failureStage: 'tool_boundary', failureCode: 'auth' }), 'a tool-side auth failure is not a provider refusal');
  A.ok(!Failreview.providerRefused(null) && !Failreview.providerRefused({}), 'no failure facts: not a refusal');

  // ...and the run-end gate consumes it (index.js cannot be required: it boots a sidecar)
  {
    const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    const at = src.indexOf('const _gateFailReview = ');
    A.ok(at > 0, 'the fail-review gate exists');
    const gate = src.slice(at, src.indexOf(';\n', at));
    A.ok(/!Failreview\.providerRefused\(\{\s*failureStage: execution\.failureStage\(\), failureCode: execution\.failureCode\(\)\s*\}, \{ separateModel: !!reflectModel \}\)/.test(gate),
      'the gate skips a provider refusal, with the aux tier as the separate model (' + gate.slice(0, 120) + '…)');
  }

  A.report('provider-403-upstream-refusal.test');
})().catch(e => { console.error(e); process.exit(1); });
