/* node test/vision-input.test.js — images never ride to a model the catalog says cannot see them (2026-10-23).

   Evidence (StarNet Cloud proxy logs, 2026-10-23 04:15-06:24 UTC): 14 managed completions in two bursts were refused by
   OpenRouter with 404 "No endpoints found that support image input". A StarNet app sent image content parts (a COMMS
   photo, a channel photo or a browser screenshot) to a text-only model, and because the image stays in the
   conversation, every later turn of that conversation carried it again and failed the same way.

   Pinned here, zero network:
     1. provider.imageInputOf reads the catalog: OpenRouter's architecture.input_modalities (relayed verbatim by the
        StarNet Cloud /v1/models), an explicit supportsImages, else null (unknown).
     2. provider.withoutImageParts swaps every image part for a short text note the model can act on, and returns a
        transcript with no image part by IDENTITY.
     3. The OpenRouter adapter and the OpenAI-compatible adapter (the StarNet managed route) send NO image part to a
        text-only model, keep them for a vision model, and keep them for a model the catalog says nothing about.
     4. The 404 itself: one request (no retry), non-retryable, a message that names the fix — and the adapter
        remembers it, so the next request to that model goes without the image instead of failing again.
     5. The Commander's copy on BOTH friendlyerror paths (browser mirror and node) names the fix: a vision model. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const provider = require('../sidecar/providers/provider.js');
const { classifyApiError } = require('../sidecar/providers/errorClass.js');
const { makeOpenRouterProvider } = require('../sidecar/providers/openrouter.js');
const { makeOpenAICompatibleProvider } = require('../sidecar/providers/openai-compatible.js');
const NodeFriendly = require('../frontend/app/friendlyerror.js');

function browserFriendly() {
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'friendlyerror.js'), 'utf8');
  const ctx = {}; ctx.globalThis = ctx; vm.createContext(ctx); vm.runInContext(src, ctx);
  return ctx.Friendly;
}
const BrowserFriendly = browserFriendly();

const PNG = 'data:image/png;base64,iVBORw0KGgo=';
const CATALOG = [
  { id: 'vendor/text-only', name: 'Text Only', context_length: 64000, architecture: { modality: 'text->text', input_modalities: ['text'], output_modalities: ['text'] }, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools'] },
  { id: 'vendor/sees', name: 'Sees', context_length: 64000, architecture: { modality: 'text+image->text', input_modalities: ['text', 'image'], output_modalities: ['text'] }, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools'] },
  { id: 'vendor/silent', name: 'Silent', context_length: 64000, pricing: { prompt: '0.000001', completion: '0.000002' }, supported_parameters: ['tools'] }
];
const SSE_OK = 'data: {"choices":[{"delta":{"content":"ok"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n';
const IMAGE_404 = { error: { message: 'No endpoints found that support image input', type: 'upstream_error', code: '404', request_id: 'req-1' } };

function convo() {
  return [
    { role: 'system', content: 'you are a test' },
    { role: 'user', content: [{ type: 'text', text: 'what is in this picture?' }, { type: 'image_url', image_url: { url: PNG } }] },
    { role: 'assistant', content: 'let me look' },
    { role: 'user', content: 'and now?' }
  ];
}
function imagePartsIn(body) {
  let n = 0;
  for (const m of (body && body.messages) || []) if (Array.isArray(m.content)) for (const p of m.content) if (p && (p.type === 'image_url' || p.type === 'input_image' || p.type === 'image')) n++;
  return n;
}
function textIn(body) { return JSON.stringify((body && body.messages) || []); }
// one fake endpoint: /models answers the catalog, a POST answers `chat(body)` -> { status, body } (or the stream)
function fakeFetch(posts, chat) {
  return async (url, init) => {
    if (!init || !init.body) return new Response(JSON.stringify({ data: CATALOG }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    const body = JSON.parse(init.body);
    posts.push(body);
    const r = chat ? chat(body) : null;
    if (r) return new Response(JSON.stringify(r.body), { status: r.status, headers: { 'Content-Type': 'application/json' } });
    return new Response(SSE_OK, { status: 200, headers: { 'Content-Type': 'text/event-stream' } });
  };
}
async function drain(p, req) {
  try { for await (const _ of p.stream(req)) { /* drain */ } } catch (e) { return e; }
  return null;
}

(async () => {
  // ---- 1. the catalog read ----
  {
    const f = provider.imageInputOf;
    A.eq(typeof f, 'function', 'provider.imageInputOf exists');
    if (typeof f === 'function') {
      A.eq(f(CATALOG[0]), false, 'input_modalities [text] = text-only');
      A.eq(f(CATALOG[1]), true, 'input_modalities [text,image] = sees images');
      A.eq(f(CATALOG[2]), null, 'no modality data = unknown (null), never false');
      A.eq(f({ id: 'x', architecture: { modality: 'text+image->text' } }), true, 'the older architecture.modality string is read too');
      A.eq(f({ id: 'x', architecture: { modality: 'text->text' } }), false, 'a text->text modality string = text-only');
      A.eq(f({ id: 'x', architecture: { input_modalities: [] } }), null, 'an empty modality list says nothing (unknown)');
      A.eq(f({ id: 'x', supportsImages: false }), false, 'a normalized row\'s own supportsImages wins');
      A.eq(f(null), null, 'no row = unknown');
    }
  }

  // ---- 2. the transcript rewrite ----
  {
    const f = provider.withoutImageParts;
    A.eq(typeof f, 'function', 'provider.withoutImageParts exists');
    if (typeof f === 'function') {
      const plain = [{ role: 'user', content: 'hi' }, { role: 'user', content: [{ type: 'text', text: 'x' }] }];
      A.ok(f(plain, 'vendor/text-only') === plain, 'a transcript with no image part returns by identity');
      const before = convo();
      const snapshot = JSON.stringify(before);
      const out = f(before, 'vendor/text-only');
      A.eq(JSON.stringify(before), snapshot, 'the caller\'s transcript is never mutated');
      A.eq(imagePartsIn({ messages: out }), 0, 'every image part is gone');
      const note = out[1].content.map(p => p.text || '').join(' ');
      A.ok(/image omitted/i.test(note) && /vendor\/text-only/.test(note) && /vision/i.test(note), 'the note says an image was omitted, names the model and the fix (' + note + ')');
      A.eq(out[1].content[0], { type: 'text', text: 'what is in this picture?' }, 'the typed text stays first, untouched');
      A.ok(out[0] === before[0] && out[3] === before[3], 'messages without images keep their identity');
      const many = f([{ role: 'user', content: [{ type: 'image_url', image_url: { url: PNG } }, { type: 'image_url', image_url: { url: PNG } }, { type: 'text', text: 'look' }] }], 'm');
      A.eq(many[0].content.length, 2, 'a run of images becomes ONE note (not one per image)');
      A.ok(/2 images omitted/i.test(many[0].content[0].text), 'the note counts them (' + many[0].content[0].text + ')');
    }
  }

  // ---- 3a. OpenRouter adapter ----
  {
    const posts = [];
    const p = makeOpenRouterProvider({ key: 'sk-or-v1-fixture', baseUrl: 'https://or.vision.test/api/v1', fetch: fakeFetch(posts) });
    await p.listModels();
    A.eq(typeof p.supportsImages, 'function', 'openrouter: supportsImages(model) is part of the seam');
    if (typeof p.supportsImages === 'function') {
      A.eq([p.supportsImages('vendor/text-only'), p.supportsImages('vendor/sees'), p.supportsImages('vendor/silent'), p.supportsImages('vendor/unlisted')], [false, true, null, null], 'openrouter: false / true / null / null from the catalog');
    }
    for (const [model, keep] of [['vendor/text-only', false], ['vendor/sees', true], ['vendor/silent', true], ['vendor/unlisted', true]]) {
      posts.length = 0;
      const err = await drain(p, { model, messages: convo() });
      A.ok(!err, 'openrouter ' + model + ': the turn streams (' + (err && err.message) + ')');
      A.eq(imagePartsIn(posts[0]), keep ? 1 : 0, 'openrouter ' + model + ': ' + (keep ? 'keeps' : 'drops') + ' the image part');
      if (!keep) A.ok(/image omitted/i.test(textIn(posts[0])), 'openrouter ' + model + ': the model is told an image was omitted');
    }
  }

  // ---- 3b. the StarNet managed route (OpenAI-compatible adapter over the cloud's relayed OpenRouter catalog) ----
  {
    const posts = [];
    const p = makeOpenAICompatibleProvider({ key: 'fixture-only', baseUrl: 'https://managed.vision.test/v1', fetch: fakeFetch(posts) });
    await p.listModels();
    A.eq(typeof p.supportsImages, 'function', 'managed: supportsImages(model) is part of the seam');
    if (typeof p.supportsImages === 'function') {
      A.eq([p.supportsImages('vendor/text-only'), p.supportsImages('vendor/sees'), p.supportsImages('vendor/silent')], [false, true, null], 'managed: false / true / null from the catalog');
    }
    for (const [model, keep] of [['vendor/text-only', false], ['vendor/sees', true], ['vendor/silent', true], ['vendor/unlisted', true]]) {
      posts.length = 0;
      const err = await drain(p, { model, messages: convo() });
      A.ok(!err, 'managed ' + model + ': the turn streams (' + (err && err.message) + ')');
      A.eq(imagePartsIn(posts[0]), keep ? 1 : 0, 'managed ' + model + ': ' + (keep ? 'keeps' : 'drops') + ' the image part');
      if (!keep) A.ok(/image omitted/i.test(textIn(posts[0])), 'managed ' + model + ': the model is told an image was omitted');
    }
  }

  // ---- 4. the 404 itself (a model the catalog says nothing about), on both adapters ----
  for (const [label, make] of [
    ['managed', fetch => makeOpenAICompatibleProvider({ key: 'fixture-only', baseUrl: 'https://managed.refuse.test/v1', fetch })],
    ['openrouter', fetch => makeOpenRouterProvider({ key: 'sk-or-v1-fixture', baseUrl: 'https://or.refuse.test/api/v1', fetch })]
  ]) {
    const posts = [];
    const model = 'vendor/refuses-' + label;
    const p = make(fakeFetch(posts, body => imagePartsIn(body) ? { status: 404, body: IMAGE_404 } : null));
    const err = await drain(p, { model, messages: convo() });
    A.ok(err, label + ' 404: the refusal surfaces');
    A.eq(posts.length, 1, label + ' 404: ONE request, never a retry ladder (got ' + posts.length + ')');
    const cls = classifyApiError(err, { model });
    A.eq(cls.retryable, false, label + ' 404: not retryable');
    A.ok(/vision/i.test(cls.message) && /image/i.test(cls.message), label + ' 404: the run error names the fix (' + cls.message + ')');
    A.ok(/No endpoints found that support image input/.test(cls.message), label + ' 404: the provider\'s own words stay in the message');
    if (typeof p.supportsImages === 'function') A.eq(p.supportsImages(model), false, label + ' 404: the adapter now knows this model is text-only');
    posts.length = 0;
    const again = await drain(p, { model, messages: convo() });
    A.ok(!again, label + ' 404: the next request to that model goes through (' + (again && again.message) + ')');
    A.eq(imagePartsIn(posts[0]), 0, label + ' 404: ...without the image part');
  }

  // ---- 5. errorClass + the Commander's copy ----
  {
    const raw = 'openai-compatible http 404 - [request req-1; type upstream_error; code 404] No endpoints found that support image input';
    const cls = classifyApiError(Object.assign(new Error(raw), { status: 404 }), {});
    A.eq(cls.retryable, false, 'errorClass: the image-input 404 is not retryable');
    A.ok(/vision/i.test(cls.message), 'errorClass: the message names a vision model as the fix (' + cls.message + ')');
    A.ok(cls.message.indexOf(raw) === 0, 'errorClass: the adapter label + status stay first (the UI routes on them)');
    const plain404 = classifyApiError(Object.assign(new Error('openai-compatible http 404 - model not found'), { status: 404 }), {});
    A.ok(!/vision/i.test(plain404.message), 'errorClass: an ordinary 404 is not rewritten');
    for (const [label, F] of [['browser', BrowserFriendly], ['node', NodeFriendly]]) {
      for (const text of [raw, cls.message]) {
        const v = F.friendlyError(text);
        A.eq(v.retryable, false, label + ' copy: no ↻ Try again');
        A.ok(/image/i.test(v.userMessage) && /vision/i.test(v.userMessage), label + ' copy: says the model cannot see images and to pick a vision model (' + v.userMessage + ')');
        A.eq(v.action, 'settings', label + ' copy: the door is the model picker');
      }
      const other = F.friendlyError('openai-compatible http 404 - model not found');
      A.ok(!/vision/i.test(other.userMessage), label + ' copy: an ordinary 404 keeps its own copy');
    }
  }

  A.report('vision-input.test');
})().catch(e => { console.log('FAIL: vision-input.test threw -- ' + (e && e.stack || e)); process.exit(1); });
