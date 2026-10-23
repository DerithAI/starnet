'use strict';
// A STOP MID-ANSWER IS NOT A KNOWN $0 (bug 80de2a75). The provider had already streamed (and bills) the answer the
// Commander stopped, but no usage chunk ever arrived, so runs.jsonl and the spend ledger booked usd 0 as if proven.
// A real sidecar now records that run's spend as unknown (run row spendUnknown, ledger row a floor — unpriced), and a
// run that finished with its usage, or was stopped before anything streamed, keeps exactly its old row.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

let hold = false;
const held = [];
const server = http.createServer((req, res) => {
  let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
    if (req.method !== 'POST') { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 128000, pricing: { prompt: '0.000003', completion: '0.000015' }, supported_parameters: ['tools'] }] })); return; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    if (hold) {   // stream part of the answer, then hold: the usage chunk never comes
      res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'Here is the first half of a long answer' } }] }) + '\n\n');
      held.push(res);
      return;
    }
    res.end('data: ' + JSON.stringify({ choices: [{ delta: { content: 'A complete answer' }, finish_reason: 'stop' }], usage: { prompt_tokens: 1000, completion_tokens: 100 } }) + '\n\ndata: [DONE]\n\n');
  });
});

(async () => {
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const base = 'http://127.0.0.1:' + server.address().port;
  const fixture = SidecarFixture.create({ prefix: 'cancel-spend-', timeoutMs: 20000, env: {
    SKYNET_OPENROUTER_BASE: base, STARNET_OPENROUTER_BASE: base,
    SKYNET_OPENROUTER_KEY: 'fixture', STARNET_OPENROUTER_KEY: 'fixture',
    SKYNET_DEFAULT_MODEL: 'test/model', STARNET_DEFAULT_MODEL: 'test/model',
    SKYNET_CRON_ENABLED: '0', STARNET_CRON_ENABLED: '0'
  } });
  const body = (text) => JSON.stringify({ model: 'test/model', provider: 'openrouter', key: 'fixture', agentId: 'agent', streamId: 'cancel-spend', messages: [{ role: 'user', content: text }] });
  async function runRow(runId) { const r = await fixture.json('GET', '/api/runs?runId=' + encodeURIComponent(runId)); assert.equal(r.status, 200); return r.body.runs[0]; }
  function ledgerRow(runId) {
    const lines = fs.readFileSync(path.join(fixture.workspace, 'ledger.jsonl'), 'utf8').split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } });
    return lines.filter(r => r && r.runId === runId).pop();
  }
  // start a run, wait until the provider has streamed part of the answer, stop it, read the stream to its end
  async function stoppedMidAnswer(text) {
    const res = await fixture.request('/api/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body(text) });
    assert.equal(res.status, 200);
    const reader = res.body.getReader(); const dec = new TextDecoder();
    let buf = '', runId = '', sawToken = false, cancelled = false;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
        if (!line) continue;
        const ev = JSON.parse(line);
        if (ev.name === 'agent.run.start' && !runId) runId = ev.payload.runId;
        if (ev.name === 'agent.token') sawToken = true;
        if (runId && sawToken && !cancelled) {
          cancelled = true;
          const c = await fixture.json('POST', '/api/cancel', { runId });
          assert.equal(c.body.stopped, true, 'the stop reached the live run');
        }
      }
    }
    assert(runId && sawToken && cancelled, 'the run streamed part of its answer and was stopped');
    return runId;
  }
  try {
    await fixture.start();
    // a run that finishes with its usage keeps its priced row
    const ok = await fixture.json('POST', '/api/run', JSON.parse(body('answer fully')));
    const okId = String(ok.text).split('\n').filter(Boolean).map(JSON.parse).find(e => e.name === 'agent.run.start').payload.runId;
    const okRow = await runRow(okId);
    assert.equal(okRow.reason, 'done');
    assert(okRow.usd > 0 && okRow.spendUnknown !== true, 'a completed priced run keeps its known spend: ' + JSON.stringify({ usd: okRow.usd, spendUnknown: okRow.spendUnknown }));

    hold = true;
    const stopped = await stoppedMidAnswer('write a long answer');
    for (const r of held.splice(0)) { try { r.destroy(); } catch (_) {} }
    const row = await runRow(stopped);
    assert.equal(row.reason, 'cancelled');
    assert.equal(row.spendUnknown, true, 'a run stopped mid-answer records its spend as unknown, never a known $0: ' + JSON.stringify({ usd: row.usd, spendUnknown: row.spendUnknown }));
    const led = ledgerRow(stopped);
    assert(led, 'the ledger booked the stopped run');
    assert.equal(led.unpriced, true, 'the ledger row is a floor (unpriced), not a proven $0: ' + JSON.stringify(led));
    assert.notEqual(ledgerRow(okId).unpriced, true, 'the completed run\'s ledger row is unchanged');
    await fixture.restart();
    assert.equal((await runRow(stopped)).spendUnknown, true, 'the unknown spend survives a restart');
    console.log('cancel-spend-unknown: a stop mid-answer books unknown spend (run row + ledger floor), a completed run keeps its known spend, both survive restart PASS');
  } finally { await fixture.dispose(); server.closeAllConnections(); await new Promise(r => server.close(r)); }
})().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
