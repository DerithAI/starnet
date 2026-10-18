/* node test/ollama-wait-truth.test.js — #99: an Ollama turn stuck on "Working…" must say WHY, early, and a cancel must
   record what it was waiting on.

   Reported 2026-10-17 (Windows, qwen3 8B Q4 on a 6 GB GTX 1660, Ollama 0.33.3, StarNet 0.13.3): COMMS turns sat on
   Working for 45-712 s until the user cancelled; the run rows said only `cancelled`; Ollama's log showed ~3.5k and
   ~26.7k-token prompts at a 32k window. Ollama's /api/chat sends NO response headers until its first token, so the
   whole model load + prompt read is one silent pending fetch. The adapter already knew where the model ran (/api/ps)
   but only said so inside the error thrown at the 300 s connect ceiling — an error the ladder retries, so the user
   never saw it before cancelling.

   Locked here:
     · adapter: a native /api/chat request still unanswered after `waitNoteMs` yields ONE { type:'waiting',
       phase:'connect', note } built from /api/ps (placement + window + prompt estimate — never a guessed stage),
       then { type:'waiting', phase:'streaming' } once the stream opens, then the turn exactly as before
     · adapter: a request answered before `waitNoteMs` yields no waiting event and reads /api/ps no extra time
     · adapter: a cancel while unanswered stops the probe and ends quietly (no stray /api/ps read)
     · loop: an adapter note beats at once as agent.waiting { phase:'connect', note } and rides every later beat
     · loop: a cancel mid-wait returns cancelledWhile { phase, waitedMs, note? }; a cancel after visible output does not
     · runstore: cancelledWhile round-trips, bounded; absent on every other row */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeOpenAICompatibleProvider } = require('../sidecar/providers/openai-compatible.js');
const { makeRunStore } = require('../sidecar/runstore.js');
const { makeDiagnostics } = require('../sidecar/diagnostics.js');
const factory = require('../sidecar/providers/factory.js');
const registry = require('../sidecar/providers/registry.js');

const flush = async (n) => { for (let i = 0; i < (n || 5); i++) await new Promise(r => setImmediate(r)); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const ndjson = rows => new Response(rows.map(r => JSON.stringify(r)).join('\n') + '\n', { status: 200, headers: { 'Content-Type': 'application/x-ndjson' } });
const SHOW = () => new Response(JSON.stringify({ model_info: { 'qwen3.context_length': 40960 }, capabilities: ['completion', 'tools'] }), { status: 200 });
// What the reporter's card looked like: an 8B model at a 32k window, 45% of it in VRAM.
const PS = { models: [{ name: 'qwen3:8b', model: 'qwen3:8b', size: 10e9, size_vram: 4.5e9, context_length: 32768 }] };

function mockOllama(opts) {
  const o = opts || {};
  const s = { psReads: 0, chats: 0, release: null };
  const answered = new Promise(r => { s.release = r; });
  s.fetch = async (url, init) => {
    if (url.endsWith('/api/show')) return SHOW();
    if (url.endsWith('/api/ps')) { s.psReads++; return new Response(JSON.stringify(o.ps === undefined ? PS : o.ps), { status: 200 }); }
    if (url.endsWith('/api/chat')) {
      s.chats++;
      if (!o.immediate) {
        // Ollama withholds the headers until its first token: the fetch itself stays pending (abortable).
        await new Promise((resolve, reject) => {
          answered.then(resolve);
          init.signal.addEventListener('abort', () => reject(init.signal.reason || Object.assign(new Error('aborted'), { name: 'AbortError' })), { once: true });
        });
      }
      return ndjson([{ message: { role: 'assistant', content: 'hi' }, done: false }, { message: { role: 'assistant', content: '' }, done: true, done_reason: 'stop', prompt_eval_count: 5, eval_count: 2 }]);
    }
    return new Response('{"data":[]}', { status: 200 });
  };
  return s;
}

(async () => {
  // ---- 1. adapter: an unanswered native request names where the model runs, early ----
  {
    const s = mockOllama();
    const p = makeOpenAICompatibleProvider({ fetch: s.fetch, baseUrl: 'http://127.0.0.1:11591/v1', nativeOllama: true, waitNoteMs: 20 });
    const it = p.stream({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'x'.repeat(108000) }], isTask: false })[Symbol.asyncIterator]();
    const first = await Promise.race([it.next(), sleep(1500).then(() => ({ timedOut: true }))]);
    A.ok(!first.timedOut, 'the unanswered request produced an event before its answer arrived');
    const ev = first.value || {};
    A.eq([ev.type, ev.phase], ['waiting', 'connect'], 'it is a connect-phase waiting event (headers still pending)');
    A.ok(/45% on GPU, 55% on CPU/.test(ev.note || ''), 'the note states the /api/ps placement share: ' + ev.note);
    A.ok(/32k window/.test(ev.note || ''), 'and the window Ollama holds it at: ' + ev.note);
    A.ok(/~2\dk-token prompt/.test(ev.note || ''), 'and the size of the prompt it was sent: ' + ev.note);
    A.ok(!/reading|loading/i.test(ev.note || ''), '/api/ps proves placement, not a stage: no "reading"/"loading" claim');
    A.ok(/^~2\dk-token prompt · Ollama has it/.test(ev.note || ''), 'a loopback server is plain "Ollama", facts first: ' + ev.note);
    s.release();
    const rest = [];
    for (;;) { const n = await it.next(); if (n.done) break; rest.push(n.value); }
    A.eq(rest.map(e => e.type + (e.phase ? ':' + e.phase : '')), ['waiting:streaming', 'text', 'usage', 'done'], 'the stream opening clears the wait, then the turn streams exactly as before');
    A.eq(rest[1].delta, 'hi', 'with the model text intact');
  }

  // ---- 2. adapter: a prompt answer that beats the note threshold gets no waiting event, no extra /api/ps read ----
  {
    const s = mockOllama({ immediate: true });
    const p = makeOpenAICompatibleProvider({ fetch: s.fetch, baseUrl: 'http://127.0.0.1:11592/v1', nativeOllama: true, waitNoteMs: 5000 });
    const out = [];
    for await (const e of p.stream({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hello' }], isTask: false })) out.push(e.type);
    A.eq(out, ['text', 'usage', 'done'], 'a prompt answer streams byte-identically (no waiting event)');
    A.eq(s.psReads, 1, '/api/ps read once (the first-use loaded-window check), never by the wait probe');
  }

  // ---- 3. adapter: a cancel while unanswered stops the probe and ends quietly ----
  {
    const s = mockOllama();
    const ac = new AbortController();
    const p = makeOpenAICompatibleProvider({ fetch: s.fetch, baseUrl: 'http://127.0.0.1:11593/v1', nativeOllama: true, waitNoteMs: 15 });
    const seen = [];
    const run = (async () => { for await (const e of p.stream({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'x' }], signal: ac.signal })) seen.push(e.type); })();
    await sleep(80);
    ac.abort();
    let threw = null;
    try { await run; } catch (e) { threw = e; }
    A.eq(threw, null, 'a cancel ends the stream quietly');
    A.eq(seen, ['waiting'], 'only the wait note arrived');
    const readsAtCancel = s.psReads;
    await sleep(120);
    A.eq(s.psReads, readsAtCancel, 'no /api/ps probe fires after the cancel');
  }

  // ---- 3a. a turn queued behind the host's own background call says so (live: the boot quest call was still open) ----
  {
    const s = mockOllama();
    const base = 'http://127.0.0.1:11595/v1';
    const bg = makeOpenAICompatibleProvider({ fetch: s.fetch, baseUrl: base, nativeOllama: true });
    const turn = makeOpenAICompatibleProvider({ fetch: s.fetch, baseUrl: base, nativeOllama: true, waitNoteMs: 20 });
    const bgRun = (async () => { for await (const e of bg.stream({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'quest' }] })) void e; })();
    await sleep(30);
    const it = turn.stream({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hello' }], isTask: false })[Symbol.asyncIterator]();
    const first = await Promise.race([it.next(), sleep(1500).then(() => ({ timedOut: true }))]);
    A.ok(/ · 1 other StarNet call still open there \(background\)$/.test((first.value && first.value.note) || ''), 'the turn names the open background call: ' + (first.value && first.value.note));
    s.release();
    for (;;) { const n = await it.next(); if (n.done) break; }
    await bgRun;
    const s2 = mockOllama();
    const lone = makeOpenAICompatibleProvider({ fetch: s2.fetch, baseUrl: base, nativeOllama: true, waitNoteMs: 20 });
    const it2 = lone.stream({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'again' }], isTask: false })[Symbol.asyncIterator]();
    const again = await Promise.race([it2.next(), sleep(1500).then(() => ({ timedOut: true }))]);
    A.ok(!/other StarNet call/.test((again.value && again.value.note) || 'x'), 'once those calls ended, nothing else is counted: ' + (again.value && again.value.note));
    s2.release();
    for (;;) { const n = await it2.next(); if (n.done) break; }
  }

  // ---- 3b. the OLLAMA card itself carries the probe (registry waitNoteMs, SKYNET_OLLAMA_WAIT_NOTE_MS overrides) ----
  {
    const s = mockOllama();
    const prev = process.env.SKYNET_OLLAMA_WAIT_NOTE_MS;
    process.env.SKYNET_OLLAMA_WAIT_NOTE_MS = '25';
    let p;
    try { p = factory.selectProvider({ provider: 'ollama', baseUrl: 'http://127.0.0.1:11594/v1', fetch: s.fetch }); }
    finally { if (prev === undefined) delete process.env.SKYNET_OLLAMA_WAIT_NOTE_MS; else process.env.SKYNET_OLLAMA_WAIT_NOTE_MS = prev; }
    const it = p.stream({ model: 'qwen3:8b', messages: [{ role: 'user', content: 'hi' }], isTask: false })[Symbol.asyncIterator]();
    const first = await Promise.race([it.next(), sleep(1500).then(() => ({ timedOut: true }))]);
    A.eq(first.value && first.value.type, 'waiting', 'a factory-built OLLAMA provider names an unanswered request too');
    s.release();
    for (;;) { const n = await it.next(); if (n.done) break; }
    A.eq(registry.getProviderProfile('ollama').waitNoteMs, 20000, 'the OLLAMA card waits 20 s before the first note');
  }

  // ---- 4. loop: the adapter's note beats at once and rides later beats; a cancel records the wait ----
  function harness() {
    const bus = A.makeBus();
    const seq = A.collectBus(bus, events.names());
    const dropped = [];
    const emit = makeEmitter(bus, e => dropped.push(e));
    let T = 7000000;
    const clock = { now: () => T };
    const armed = new Set();
    const waitTicker = beat => { armed.add(beat); return () => armed.delete(beat); };
    const ac = new AbortController();
    const base = { messages: [{ role: 'user', content: 'x' }], emit, cost: makeCostEngine({ priceOf: () => ({ in: 0, out: 0 }) }), model: 'qwen3:8b', agentId: 'a', runId: 'r', clock, waitTicker, random: () => 0.5, signal: ac.signal };
    return { seq, dropped, ac, advance: ms => { T += ms; }, tick: ms => { T += ms; for (const b of Array.from(armed)) b(); }, opts: p => Object.assign({}, base, { provider: p }) };
  }
  const waits = seq => seq.filter(e => e.name === 'agent.waiting').map(e => e.payload);
  const untilAbort = signal => new Promise(r => { if (signal.aborted) r(); else signal.addEventListener('abort', r, { once: true }); });
  {
    const h = harness();
    const note = '~27k-token prompt · Ollama has it 45% on GPU, 55% on CPU at a 32k window';
    const provider = { stream: async function* (req) { h.advance(20000); yield { type: 'waiting', phase: 'connect', note }; await untilAbort(req.signal); } };
    const done = runAgentLoop(h.opts(provider));
    await flush();
    A.eq(waits(h.seq), [{ agentId: 'a', runId: 'r', phase: 'connect', sinceMs: 20000, model: 'qwen3:8b', note }], 'the note beats at once (not at the next tick), as phase connect');
    h.tick(15000);
    A.eq(waits(h.seq)[1], { agentId: 'a', runId: 'r', phase: 'connect', sinceMs: 35000, model: 'qwen3:8b', note }, 'and rides every later beat');
    h.advance(5000);
    h.ac.abort();
    const res = await done;
    A.eq(res.reason, 'cancelled', 'the user cancel ends the run cancelled');
    A.eq(res.cancelledWhile, { phase: 'connect', waitedMs: 40000, note }, 'and records what the run was waiting on, for how long');
    A.eq(h.dropped.length, 0, 'every heartbeat passed the event contract');
  }
  // a wait with no adapter note still records its phase and duration
  {
    const h = harness();
    const provider = { stream: async function* (req) { await untilAbort(req.signal); } };
    const done = runAgentLoop(h.opts(provider));
    await flush();
    h.tick(15000);
    A.eq(waits(h.seq), [{ agentId: 'a', runId: 'r', phase: 'first_byte', sinceMs: 15000, model: 'qwen3:8b' }], 'a plain first-byte beat carries no note field');
    h.advance(1000);
    h.ac.abort();
    const res = await done;
    A.eq(res.cancelledWhile, { phase: 'first_byte', waitedMs: 16000 }, 'a cancel before any reply records the first-byte wait');
  }
  // a cancel after the user saw output is an ordinary stop: nothing to explain
  {
    const h = harness();
    const provider = { stream: async function* (req) { yield { type: 'text', delta: 'Working on it' }; await untilAbort(req.signal); } };
    const done = runAgentLoop(h.opts(provider));
    await flush();
    h.ac.abort();
    const res = await done;
    A.eq(res.reason, 'cancelled', 'cancelled');
    A.eq('cancelledWhile' in res, false, 'no wait is recorded once visible output arrived');
  }

  // ---- 5. runstore: cancelledWhile round-trips, bounded; absent elsewhere ----
  {
    const lines = [];
    const io = { readAll: () => lines.slice(), append: e => lines.push(e) };
    const s = makeRunStore({ io, clock: { now: () => 1 } });
    const row = s.record({ runId: 'c1', reason: 'cancelled', cancelledWhile: { phase: 'connect', waitedMs: 712000.4, note: 'n'.repeat(900), extra: 'x' } });
    A.ok(row.cancelledWhile, 'a cancelled run keeps what it was waiting on');
    if (!row.cancelledWhile) { A.report('ollama-wait-truth.test'); return; }
    A.eq(row.cancelledWhile.phase, 'connect', 'the phase is kept');
    A.eq(row.cancelledWhile.waitedMs, 712000, 'the wait is whole milliseconds');
    A.eq(row.cancelledWhile.note.length, 240, 'the note is bounded');
    A.eq(Object.keys(row.cancelledWhile).sort(), ['note', 'phase', 'waitedMs'], 'nothing else rides along');
    A.eq(s.record({ runId: 'c2', reason: 'cancelled', cancelledWhile: { phase: 'nonsense' } }).cancelledWhile, undefined, 'an unknown phase is dropped');
    A.eq('cancelledWhile' in s.record({ runId: 'd1', reason: 'done' }), false, 'a row without it stays byte-identical');
    const reloaded = makeRunStore({ io, clock: { now: () => 2 } }).list(null, { limit: 5 }).find(r => r.runId === 'c1');
    A.eq(reloaded && reloaded.cancelledWhile && reloaded.cancelledWhile.waitedMs, 712000, 'and it survives a reload from disk');
  }

  // ---- 6. diagnostics: the pasted "Last run" line says what the cancel interrupted ----
  {
    const diag = makeDiagnostics({ redact: s => s });
    const note = '~27k-token prompt · Ollama has it 45% on GPU, 55% on CPU at a 32k window';
    const out = diag.assemble({ lastRun: { runId: 'run-99', status: 'cancelled', ts: 1760000000000, cancelledWhile: { phase: 'connect', waitedMs: 712000, note } } });
    A.eq(out.report.lastRun.cancelledWhile, { phase: 'connect', waitedMs: 712000, note }, 'the report carries the interrupted wait');
    const line = out.text.split('\n').find(l => l.startsWith('Last run:'));
    A.ok(line.includes('run-99 — cancelled with no reply from the model yet for 11m 52s (' + note + ')'), 'and the line reads it in words: ' + line);
    const plain = diag.assemble({ lastRun: { runId: 'run-1', status: 'done', ts: 1760000000000 } });
    A.eq('cancelledWhile' in plain.report.lastRun, false, 'a run without one keeps the old shape');
    A.ok(/^Last run:\s+run-1 — done @ /m.test(plain.text), 'and the old line');
  }

  A.report('ollama-wait-truth.test');
})();
