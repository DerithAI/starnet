'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const localVoice = require('../sidecar/local-voice.js');

// Offline speech needs `@huggingface/transformers` + `kokoro-js`, which the shipped desktop bundle does
// NOT carry (Tauri ships sidecar/ frontend/ shared/ and no node_modules). So this test may not assume
// either environment: it independently decides whether the packages are on disk and then holds the module
// to the matching contract. The previous version asserted `available === true` unconditionally and never
// touched an import, so it stayed green on a machine with the packages absent — the exact state of every
// installed build — while the panel told users the capability was there.
function packageOnDisk(name) {
  const parts = name.split('/');
  let dir = path.resolve(__dirname, '..');
  for (;;) {
    if (fs.existsSync(path.join(dir, 'node_modules', ...parts, 'package.json'))) return true;
    const parent = path.dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

(async () => {
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(localVoice.transcribe(Buffer.alloc(16000), {signal:cancelled.signal}), {name:'AbortError'},
    'a cancelled preview is rejected before checking or loading speech models');
  const expected = packageOnDisk('@huggingface/transformers') && packageOnDisk('kokoro-js');
  const status = localVoice.status();

  assert.equal(
    status.available, expected,
    `status().available must match whether the model packages are actually installed (expected ${expected})`
  );
  assert.equal(typeof status.cacheRoot, 'string');
  assert.ok(status.cacheRoot.length > 3);
  assert.ok(
    !/[\\/]node_modules[\\/]/.test(status.cacheRoot),
    'downloaded weights live in the per-user data root, never inside the checkout'
  );
  assert.equal(status.asrBusy, 0);
  assert.equal(status.lastAsrMs, null);
  assert.equal(status.ttsBusy, 0);
  assert.equal(status.lastTtsMs, null);

  {
    const policies = [];
    localVoice._hardenSharpImageDecoders({ block: policy => policies.push(policy) });
    assert.deepEqual(policies, [{ operation: [
      'VipsForeignLoadNsgif',
      'VipsForeignLoadTiff',
      'VipsForeignLoadVips'
    ] }], 'offline voice blocks the vulnerable Sharp/libvips image loaders before Transformers imports');
    assert.throws(
      () => localVoice._hardenSharpImageDecoders({}),
      /image-decoder hardening is unavailable/,
      'offline voice fails closed when the Sharp mitigation cannot be applied'
    );
  }

  // Payload validation runs before anything else, installed or not.
  await assert.rejects(() => localVoice.transcribe(Buffer.alloc(3)), /invalid 16 kHz/);

  if (expected) {
    assert.equal(status.reason, '');
    assert.equal(status.asr, 'cold');
    assert.equal(status.tts, 'cold');
    const silence = await localVoice.transcribe(Buffer.alloc(16000 * 4));
    assert.equal(silence, '', 'digital silence is rejected before Whisper can hallucinate');
  } else {
    // The honest-refusal contract: no state that implies a warm-up is coming, and a reason the UI can print.
    assert.equal(status.asr, 'unavailable');
    assert.equal(status.tts, 'unavailable');
    assert.match(status.reason, /not installed in this build/);
    assert.match(status.error, /not installed in this build/);
    // Silence must NOT resolve to '' here — an empty transcript reads as "you said nothing", which is a
    // claim this build cannot make.
    await assert.rejects(
      () => localVoice.transcribe(Buffer.alloc(16000 * 4)),
      error => error && error.unavailable === true && /not installed in this build/.test(error.message)
    );
    await assert.rejects(() => localVoice.warm(), error => error && error.unavailable === true);
    await assert.rejects(() => localVoice.synthesize('hello'), error => error && error.unavailable === true);
  }

  /* ---- THE SHIPPED FALLBACK IDENTITY: every catalogue voice maps to a real Edge neural ------------------
     An installed build carries no node_modules, so the Kokoro engine can never load there. Before this
     mapping, /api/tts silently fell through to the KEYED provider voice — the picker was inert and the
     station spoke with a different identity than the one chosen (found by ear, 2026-07-30). The mapping
     lives ON the catalogue row precisely so this test can refuse any future voice added without one. */
  {
    const voices = localVoice.voices();
    assert.ok(voices.length >= 18, 'the catalogue did not shrink');
    const EDGE_NAME = /^en-(US|GB)-[A-Za-z]+Neural$/;
    for (const v of voices) {
      assert.match(String(v.edge || ''), EDGE_NAME, v.id + ' carries a shipped Edge fallback voice');
      assert.equal(localVoice.edgeVoiceFor(v.id), v.edge, v.id + ' resolves through edgeVoiceFor');
      // identity honesty: the fallback keeps WHO the voice is — a male pick must never ship female, and a
      // British pick must never ship American. (Coarser within sex+accent is honest; the wrong person is not.)
      const MALE = new Set(['en-US-ChristopherNeural', 'en-US-GuyNeural', 'en-US-RogerNeural', 'en-US-EricNeural', 'en-US-SteffanNeural', 'en-GB-RyanNeural', 'en-GB-ThomasNeural']);
      const FEMALE = new Set(['en-US-JennyNeural', 'en-US-AriaNeural', 'en-US-MichelleNeural', 'en-US-AnaNeural', 'en-GB-SoniaNeural', 'en-GB-LibbyNeural', 'en-GB-MaisieNeural']);
      assert.ok((v.sex === 'male' ? MALE : FEMALE).has(v.edge), v.id + ' (' + v.sex + ') maps to a ' + v.sex + ' Edge voice, got ' + v.edge);
      assert.ok(v.edge.indexOf(v.accent === 'British' ? 'en-GB-' : 'en-US-') === 0, v.id + ' keeps its ' + v.accent + ' accent in the fallback');
    }
    // unknown/empty picks resolve through the DEFAULT voice — always a real name, never undefined and never
    // some other provider's identity.
    const def = voices.find(v => v.id === 'am_onyx').edge;
    assert.equal(localVoice.edgeVoiceFor(''), def, 'an empty pick maps through the default voice');
    assert.equal(localVoice.edgeVoiceFor('not-a-voice'), def, 'an unknown pick maps through the default voice');
  }

  /* ---- the kill-switch: STARNET_LOCAL_VOICE=0 forces the installed-build shape on a dev checkout --------
     This is how tests (and users opting out of on-disk models) reproduce the environment the keyed-
     fallthrough bug only showed on. Dynamic, so a spawned server's env always wins. */
  {
    const before = process.env.STARNET_LOCAL_VOICE;
    process.env.STARNET_LOCAL_VOICE = '0';
    try {
      const off = localVoice.status();
      assert.equal(off.available, false, 'STARNET_LOCAL_VOICE=0 forces the engine unavailable');
      await assert.rejects(() => localVoice.synthesize('hello'), error => error && error.unavailable === true, 'synthesis refuses under the kill-switch');
    } finally {
      if (before === undefined) delete process.env.STARNET_LOCAL_VOICE; else process.env.STARNET_LOCAL_VOICE = before;
    }
    assert.equal(localVoice.status().available, expected, 'clearing the switch restores the probed truth');
  }

  /* ---- NATURAL SPEECH ASSEMBLY (engine-free: a stub model stands in for Kokoro) -------------------------
     Kokoro reads at most 510 phoneme tokens per call and silently drops the rest, so a long chunk lost its
     back half. renderSpeech must speak EVERY word, one sentence-sized piece at a time, joined by the pause
     its punctuation calls for — never cut a number apart, never pass a piece over the cap. */
  {
    const pieces = localVoice._speechPieces;
    assert.deepEqual(pieces('Version 0.13.2 is out. It ships today!'), ['Version 0.13.2 is out. It ships today!'],
      'short sentences share one piece and a version number is never split at its dots');
    const long = Array.from({ length: 14 }, (_, i) => `Sentence number ${i + 1} carries a fair amount of ordinary words, like a real reply would.`).join(' ');
    const cut = pieces(long);
    assert.ok(cut.length > 1, 'a long reply is cut into several pieces');
    assert.ok(cut.every(p => p.length <= 300), 'no piece passes the 300-character cap (Kokoro truncates past ~510 tokens)');
    assert.equal(cut.join(' '), long, 'every word survives the cut, in order');
    const runOn = 'word '.repeat(180).trim() + ', and then a final clause.';
    const runCut = pieces(runOn);
    assert.ok(runCut.every(p => p.length <= 300) && runCut.join(' ') === runOn, 'a single over-long sentence is split without losing words');
    assert.deepEqual(pieces('   '), [], 'blank text has nothing to say');

    const calls = [];
    const RATE = 24000;
    const stub = {
      async generate(text, opts) {
        calls.push({ text, opts });
        // 50 ms silence + 200 ms of "voice" + 300 ms silence, like an engine's padded output
        const a = new Float32Array(Math.round(RATE * 0.55));
        for (let i = Math.round(RATE * 0.05); i < Math.round(RATE * 0.25); i++) a[i] = 0.3 * Math.sin(i / 6);
        return { audio: a, sampling_rate: RATE };
      }
    };
    const wav = await localVoice._renderSpeech(stub, long, { voice: 'am_michael', speed: 0.9 });
    assert.equal(calls.length, cut.length, 'one engine call per piece — the whole reply is synthesized');
    assert.ok(calls.every(c => c.opts.voice === 'am_michael' && c.opts.speed === 0.9), 'every piece keeps the chosen voice and pace');
    assert.equal(wav.toString('ascii', 0, 4), 'RIFF');
    assert.equal(wav.readUInt16LE(20), 1, 'PCM');
    assert.equal(wav.readUInt16LE(34), 16, '16-bit samples');
    assert.equal(wav.readUInt32LE(24), RATE);
    const seconds = (wav.length - 44) / 2 / RATE;
    // per piece: 200 ms voice + 30 ms lead + 50 ms tail + a 240 ms sentence pause — the 350 ms of engine
    // padding is gone, the punctuation pause is there.
    const expectS = cut.length * (0.2 + 0.03 + 0.05 + 0.24);
    assert.ok(Math.abs(seconds - expectS) < 0.02, `edges trimmed and sentence pauses inserted (${seconds.toFixed(3)}s vs ${expectS.toFixed(3)}s)`);
    calls.length = 0;
    await localVoice._renderSpeech(stub, 'hello', { voice: 'not-a-voice' });
    assert.equal(calls[0].opts.voice, 'am_onyx', 'an unknown voice id speaks in the default voice');

    const before = process.env.STARNET_KOKORO_DTYPE;
    delete process.env.STARNET_KOKORO_DTYPE;
    // a throwaway model cache, never the real per-user one (that may hold either copy on a dev machine)
    const cache = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'starnet-kokoro-cache-'));
    const onnx = path.join(cache, 'transformers-kokoro', 'onnx-community', 'Kokoro-82M-v1.0-ONNX', 'onnx');
    try {
      assert.deepEqual(localVoice._kokoroDtypes(cache), ['fp32', 'q4'], 'full precision first, q4 only as the fallback');
      assert.equal(localVoice._kokoroCached(cache), false, 'an empty cache means the first load is a download');
      fs.mkdirSync(onnx, { recursive: true });
      fs.writeFileSync(path.join(onnx, 'model_q4.onnx'), 'q4');
      assert.deepEqual(localVoice._kokoroDtypes(cache), ['q4', 'fp32'], 'an install that already holds only q4 speaks from it (no surprise ~326 MB download)');
      assert.equal(localVoice._kokoroCached(cache), true, 'the q4 copy on disk counts as cached (it loads first)');
      fs.writeFileSync(path.join(onnx, 'model.onnx'), 'fp32');
      assert.deepEqual(localVoice._kokoroDtypes(cache), ['fp32', 'q4'], 'once fp32 is on disk it is preferred again');
      assert.equal(localVoice._kokoroCached(cache), true, 'fp32 on disk counts as cached');
      process.env.STARNET_KOKORO_DTYPE = 'q4';
      assert.deepEqual(localVoice._kokoroDtypes(cache), ['q4'], 'STARNET_KOKORO_DTYPE pins one precision');
      process.env.STARNET_KOKORO_DTYPE = 'q8';
      assert.equal(localVoice._kokoroCached(cache), false, 'a pinned precision with no file of its own is a download');
      assert.equal(typeof localVoice.ttsCached(), 'boolean', 'the station voice can ask without a root');
    } finally {
      if (before === undefined) delete process.env.STARNET_KOKORO_DTYPE; else process.env.STARNET_KOKORO_DTYPE = before;
      fs.rmSync(cache, { recursive: true, force: true });
    }
    assert.equal(localVoice.status().ttsPrecision, '', 'no precision is reported before one has actually loaded');
  }

  console.log(`local-voice.test.js: ok (models ${expected ? 'installed' : 'absent'})`);
})().catch(error => {
  console.error(error);
  process.exit(1);
});
