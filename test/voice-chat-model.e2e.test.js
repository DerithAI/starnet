'use strict';
/* SETTINGS › Models › VOICE CHAT MODEL, end to end: the real sidecar, the real OpenRouter adapter and run host,
   a loopback upstream and a synthetic key. Proves on the wire what test/voice-chat-route.test.js proves on paper:
   a voice turn runs on the saved voice model with reasoning off; a typed turn never moves; the setting survives a
   restart; a failing voice model hands the turn back to the agent's model; a conversation too big for the voice
   model and a signed-out voice provider both stay on the agent's model and say why on agent.run.start. */
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

(async () => {
  const calls = [];
  const key = 'synthetic-voice-chat-key';
  const MAIN = 'heavy/main-model', FAST = 'fast/voice-model', BROKEN = 'fast/broken-model';
  const upstream = http.createServer((req, res) => {
    let raw = ''; req.on('data', b => raw += b); req.on('end', () => {
      if (req.method !== 'POST') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [
          { id: MAIN, name: 'Heavy', context_length: 200000, supported_parameters: ['tools', 'reasoning'] },
          { id: FAST, name: 'Fast', context_length: 64000, supported_parameters: ['tools', 'reasoning'] },
          { id: BROKEN, name: 'Broken', context_length: 200000, supported_parameters: ['tools'] }
        ] }));
      }
      const body = JSON.parse(raw);
      const last = (body.messages || []).filter(m => m.role === 'user').pop();
      const text = typeof (last && last.content) === 'string' ? last.content : JSON.stringify(last && last.content);
      const tag = (/\[(T\d+)\]/.exec(text) || [])[1] || '';
      calls.push({ tag, model: body.model, reasoning: body.reasoning || null });
      if (body.model === BROKEN) {
        res.writeHead(503, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ error: { message: 'upstream overloaded', code: 503 } }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Sure.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 12, completion_tokens: 2, cost: 0.0001 } }) + '\n\ndata: [DONE]\n\n');
    });
  });
  await new Promise(r => upstream.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + upstream.address().port;
  const fixture = SidecarFixture.create({ timeoutMs: 20000, env: {
    SKYNET_SCOUT: '0', SKYNET_SKILL_REVIEW: '0', SKYNET_SKILL_CURATOR: '0', SKYNET_THREAD_MINE: '0',
    OPENROUTER_KEY: key, OPENROUTER_API_KEY: key, SKYNET_OPENROUTER_BASE: base + '/router',
    SKYNET_FALLBACK_MODELS: '', SKYNET_FULL_ACCESS: '0', STARNET_FULL_ACCESS: '0'
  } });
  let n = 0;
  async function run(voiceTurn, pad) {
    const tag = 'T' + (++n);
    const r = await fixture.json('POST', '/api/run', {
      provider: 'openrouter', model: MAIN, reasoningEffort: 'high', agentId: 'agent', isTask: false, streamId: 'voice-e2e',
      messages: [{ role: 'user', content: '[' + tag + '] say hi' + (pad || '') }], ...(voiceTurn ? { voiceTurn: true } : {})
    });
    assert.equal(r.status, 200, r.text);
    const events = r.text.trim().split('\n').filter(Boolean).map(x => JSON.parse(x));
    return { tag, events, start: events.find(e => e.name === 'agent.run.start')?.payload, end: events.findLast(e => e.name === 'agent.run.end')?.payload, mine: calls.filter(c => c.tag === tag) };
  }
  try {
    await fixture.start();

    // the default: a voice turn stays on the agent's model, reasoning off; a typed turn keeps its effort
    let st = await fixture.json('GET', '/api/voice/chat-model');
    assert.equal(st.status, 200, st.text);
    assert.deepEqual(JSON.parse(st.text).setting, { provider: '', model: '', reasoningEffort: 'none' });
    let v = await run(true);
    assert.equal(v.end.reason, 'done');
    assert.equal(v.mine[0].model, MAIN, 'default: the agent answers the spoken turn');
    assert.notEqual(v.mine[0].reasoning && v.mine[0].reasoning.effort, 'high', 'default: reasoning is not the typed effort on a voice turn');
    let t = await run(false);
    assert.equal(t.mine[0].model, MAIN);
    assert.equal(t.mine[0].reasoning && t.mine[0].reasoning.effort, 'high', 'a typed turn keeps its effort');
    assert.equal(t.start.voiceRoute, undefined, 'a typed turn carries no voice route');

    // save a voice model: the spoken turn moves, the typed one does not
    const saved = await fixture.json('POST', '/api/voice/chat-model', { provider: 'openrouter', model: FAST, reasoningEffort: 'none' });
    assert.equal(saved.status, 200, saved.text);
    assert.equal(JSON.parse(saved.text).configured, true, 'its provider can run');
    for (let boot = 0; boot < 2; boot++) {
      if (boot) await fixture.restart();
      v = await run(true);
      assert.equal(v.end.reason, 'done', JSON.stringify(v.end));
      assert.equal(v.mine[0].model, FAST, 'the voice model answers the spoken turn' + (boot ? ' after a restart' : ''));
      assert.equal(v.start.model, FAST, 'agent.run.start names the model that answers');
      assert.equal(v.start.voiceRoute.used, true);
      assert.equal(v.start.voiceRoute.reasoningEffort, 'none');
      t = await run(false);
      assert.equal(t.mine[0].model, MAIN, 'the next typed turn is back on the agent\'s model');
    }

    // never compacts to fit: a conversation bigger than the voice model's window stays on the agent's model
    v = await run(true, ' ' + 'lorem ipsum dolor sit amet '.repeat(7000));
    assert.equal(v.mine[0].model, MAIN, 'too large for the voice model');
    assert.equal(v.start.voiceRoute.used, false);
    assert.equal(v.start.voiceRoute.reason, 'too_large');
    assert.equal(v.start.voiceRoute.wanted.model, FAST);

    // a failing voice model hands the turn back to the agent's model (an ordinary fallback receipt)
    await fixture.json('POST', '/api/voice/chat-model', { provider: 'openrouter', model: BROKEN, reasoningEffort: 'none' });
    v = await run(true);
    assert.equal(v.end.reason, 'done', JSON.stringify(v.end));
    const tried = v.mine.map(c => c.model);
    assert.equal(tried[0], BROKEN, 'the voice model is tried first');
    assert.equal(tried[tried.length - 1], MAIN, 'the agent\'s model answers after it fails: ' + tried.join(' > '));
    assert.ok(tried.slice(0, -1).every(m => m === BROKEN), 'nothing else in between (the 503 retry ladder runs on the voice model)');
    assert.ok(v.events.some(e => e.name === 'provider.fallback'), 'the hand-back is a visible fallback');

    // a voice provider with no credential: stays on the agent's model and says why
    const anth = await fixture.json('POST', '/api/voice/chat-model', { provider: 'anthropic', model: 'claude-haiku-5-5' });
    assert.equal(JSON.parse(anth.text).configured, false, 'the slot reports its provider is not connected');
    v = await run(true);
    assert.equal(v.mine[0].model, MAIN);
    assert.equal(v.start.voiceRoute.reason, 'not_configured');

    // clear: back to the shipped default
    st = await fixture.json('POST', '/api/voice/chat-model', { clear: true });
    assert.deepEqual(JSON.parse(st.text).setting, { provider: '', model: '', reasoningEffort: 'none' });
    assert.equal(JSON.parse(st.text).saved, false);

    // a save that cannot be written says so and keeps the previous choice (sidecar-index-11): it used to answer
    // saved:true, run on the new model until a restart, then silently fall back to the default
    const vfile = path.join(fixture.workspace, 'voice-chat.json');
    fs.rmSync(vfile, { force: true }); fs.rmSync(vfile + '.bak', { force: true });
    fs.mkdirSync(vfile);   // deterministic: the store's final rename target is a directory
    try {
      const failed = await fixture.json('POST', '/api/voice/chat-model', { provider: 'openrouter', model: FAST, reasoningEffort: 'none' });
      assert.equal(failed.status, 507, failed.text);
      assert.match(JSON.parse(failed.text).error, /could not be saved/);
      st = await fixture.json('GET', '/api/voice/chat-model');
      assert.deepEqual(JSON.parse(st.text).setting, { provider: '', model: '', reasoningEffort: 'none' }, 'the previous (default) choice is kept');
      assert.equal(JSON.parse(st.text).saved, false);
      v = await run(true);
      assert.equal(v.mine[0].model, MAIN, 'a voice turn does not run on a model that was never saved');
    } finally { fs.rmSync(vfile, { recursive: true, force: true }); }
    console.log('voice-chat-model.e2e: PASS (voice turn routes, typed turn stays, restart, too-large, fallback, unconfigured, clear)');
  } finally { await fixture.dispose(); await new Promise(r => upstream.close(r)); }
})().catch(e => { console.error(e); process.exitCode = 1; });
