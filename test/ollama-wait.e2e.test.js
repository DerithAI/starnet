'use strict';
// #99: actual seeded sidecar, a local Ollama that withholds its /api/chat headers (no first token), a COMMS-style run.
// Reported on a 6 GB GTX 1660 (qwen3 8B, 32k window, 45% on the GPU): the turn sat on "Working…" for up to 712 s and
// the run row said only `cancelled`. Proven here end to end: the run's own stream says where Ollama has the model
// before any reply, the user cancel aborts the pending request, and the run record + pasted diagnostics say what the
// cancel interrupted.
const assert = require('node:assert/strict');
const path = require('node:path');
const http = require('node:http');
const { spawnSync } = require('node:child_process');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
(async () => {
  const MODEL = 'qwen3-wait99:latest';
  const chats = [];   // every /api/chat the sidecar sent: { body, closedEarly }
  const upstream = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    res.setHeader('Content-Type', 'application/json');
    if (req.url.endsWith('/api/show')) return res.end(JSON.stringify({ model_info: { 'qwen3.context_length': 40960 }, capabilities: ['completion', 'tools'] }));
    if (req.url.endsWith('/api/ps')) return res.end(JSON.stringify({ models: [{ name: MODEL, model: MODEL, size: 10e9, size_vram: 4.5e9, context_length: 32768 }] }));
    if (req.url.endsWith('/api/chat')) {
      // Ollama writes nothing — not even headers — until its first token. Hold the request open, never answer.
      const row = { body: JSON.parse(raw || '{}'), closedEarly: false };
      chats.push(row);
      res.on('close', () => { if (!res.writableEnded) row.closedEarly = true; });
      return;
    }
    return res.end(JSON.stringify({ data: [{ id: MODEL }] }));
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + upstream.address().port + '/v1';
  const fixture = SidecarFixture.create({
    entry: path.resolve(__dirname, '../dev/seed.js'), timeoutMs: 45000,
    env: { SKYNET_DEFAULT_MODEL: MODEL, SKYNET_OPENROUTER_KEY: '', OPENROUTER_KEY: '', OPENROUTER_API_KEY: '', OLLAMA_BASE_URL: baseUrl,
      SKYNET_WAIT_HEARTBEAT_MS: '1000', SKYNET_OLLAMA_WAIT_NOTE_MS: '300' }
  });
  fixture.args = ['--keep', '--workspace', fixture.workspace];
  try {
    await fixture.start();
    const response = await fixture.request('/api/run', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: 'ollama', baseUrl, model: MODEL, agentId: 'agent', isTask: false,
        messages: [{ role: 'user', content: 'hello' }] })
    });
    assert.equal(response.status, 200);
    const reader = response.body.getReader();
    const dec = new TextDecoder();
    const events = [];
    let buf = '';
    let reading = null;   // ONE outstanding read: a raced read() that loses to the idle timer still owns the next chunk
    async function until(pred, ms, what) {
      const deadline = Date.now() + ms;
      for (;;) {
        const hit = events.find(pred);
        if (hit) return hit;
        if (Date.now() > deadline) throw new Error('timed out waiting for ' + what + '; saw ' + JSON.stringify(events.map(e => e.name)));
        if (!reading) reading = reader.read();
        const next = await Promise.race([reading, new Promise(r => setTimeout(() => r({ idle: true }), 250))]);
        if (next.idle) continue;
        reading = null;
        if (next.done) throw new Error('stream ended before ' + what + '; saw ' + JSON.stringify(events.map(e => e.name)));
        buf += dec.decode(next.value, { stream: true });
        let nl;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
          if (line) events.push(JSON.parse(line));
        }
      }
    }
    const start = await until(e => e.name === 'agent.run.start', 15000, 'agent.run.start');
    const runId = start.payload.runId;
    const noted = await until(e => e.name === 'agent.waiting' && e.payload.note, 15000, 'a wait note');
    assert.equal(noted.payload.runId, runId);
    assert.equal(noted.payload.phase, 'connect', 'headers still pending reads as the connect phase');
    assert.match(noted.payload.note, /Ollama has it 45% on GPU, 55% on CPU at a 32k window/, 'the stream itself says where Ollama has the model');
    assert.equal(events.some(e => e.name === 'agent.token'), false, 'and nothing pretended to be a reply');
    assert.equal(chats.length, 1, 'one native request is pending');
    assert.equal(chats[0].body.options.num_ctx, 32768, 'the request rides the window Ollama already holds the model at');
    const later = await until(e => e.name === 'agent.waiting' && e.payload.note && e.payload.sinceMs >= 1000, 15000, 'a heartbeat after the note');
    assert.equal(later.payload.note, noted.payload.note, 'the ordinary heartbeat keeps carrying the note');

    const cancel = await fixture.json('POST', '/api/cancel', { runId });
    assert.equal(cancel.status, 200);
    assert.equal(cancel.body.stopped, true, 'the cancel reached the live run');
    const end = await until(e => e.name === 'agent.run.end', 15000, 'agent.run.end');
    assert.equal(end.payload.reason, 'cancelled');
    const t0 = Date.now();
    while (!chats[0].closedEarly && Date.now() - t0 < 5000) await new Promise(r => setTimeout(r, 50));
    assert.equal(chats[0].closedEarly, true, 'the pending /api/chat was aborted, not left running on the GPU');

    let diag = null;
    for (let i = 0; i < 40; i++) {   // the run row lands as the run settles, just after agent.run.end
      diag = (await fixture.json('GET', '/api/diagnostics')).body;
      if (diag.report.lastRun && diag.report.lastRun.runId === runId) break;
      await new Promise(r => setTimeout(r, 100));
    }
    assert.equal(diag.report.lastRun.runId, runId);
    assert.equal(diag.report.lastRun.status, 'cancelled');
    const cw = diag.report.lastRun.cancelledWhile;
    assert.ok(cw && cw.phase === 'connect' && cw.waitedMs > 0, 'the record names the interrupted wait: ' + JSON.stringify(cw));
    assert.match(cw.note, /45% on GPU, 55% on CPU at a 32k window/);
    assert.match(diag.text, new RegExp('Last run:\\s+' + runId + ' — cancelled with no reply from the model yet for [1-9]\\d*s \\('), 'and the pasted report says it in words');
    const runs = (await fixture.json('GET', '/api/runs?limit=5')).body;
    const row = (Array.isArray(runs) ? runs : (runs.runs || [])).find(r => r.runId === runId);
    assert.ok(row && row.cancelledWhile && row.cancelledWhile.phase === 'connect', 'the run history row carries it too');
    assert.ok(!/unhandledRejection|uncaughtException/.test(fixture.output()), 'no process-level failure');
    console.log('ollama-wait.e2e: OK ' + JSON.stringify({ runId, note: noted.payload.note, cancelledWhile: cw, chats: chats.length }));
  } finally {
    if (process.platform === 'win32' && fixture.child && fixture.child.exitCode === null) {
      spawnSync('taskkill', ['/pid', String(fixture.child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' });
    }
    await fixture.dispose();
    upstream.closeAllConnections();
    await new Promise(resolve => upstream.close(resolve));
  }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
