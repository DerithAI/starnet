/* node test/e2e.run-truth-1017.test.js — real-sidecar proof for three user reports against v0.13.5 (2026-10-17).

   1. releases#6 — A WIDGET REFRESH CAN PUBLISH ITS WIDGET. "Create & fetch" sends the refresh to the agent open in COMMS,
      on the widget's own conversation ('widget-<id>'), and tells it to publish with widget.set. widget.set rode only the
      NOTEBOOK prop + MEMORY switch, so a run without a placed notebook never held it: the agent searched for the tool for
      22 turns until stopped and the widget stayed empty. The run on a configured widget's own conversation now holds
      widget.get + widget.set; a run on any other conversation still does not.

   Boots the actual sidecar (hermetic fixture) on a scripted local model. ASK mode, no props placed (the interactive
   office is compute-only), exactly the station the report describes. */
'use strict';

const A = require('./_assert.js');
const http = require('http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const { userWords } = require('./helpers/host-notes.js');

const HOST = '127.0.0.1';

function startMockProvider() {
  const requests = [];
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 16000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') < 0) { res.writeHead(404); res.end(); return; }
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        let parsed = {};
        try { parsed = JSON.parse(body); } catch (_) {}
        const messages = parsed.messages || [];
        const toolNames = (parsed.tools || []).map(t => t && t.function && t.function.name);
        const lastUser = messages.map(m => m.role).lastIndexOf('user');
        const user = String(userWords(messages[lastUser] || {}) || '');
        const used = messages.slice(lastUser + 1).filter(m => m.role === 'assistant').flatMap(m => m.tool_calls || []).map(t => t.function && t.function.name);
        requests.push({ user, toolNames, aux: !parsed.tools || !parsed.tools.length });
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
        const call = (name, args) => {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: name + '_' + requests.length, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ finish_reason: 'tool_calls', delta: {} }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }) + '\n\n');
        };
        const say = text => {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 } }) + '\n\n');
        };
        const widgetId = (/using id="([a-z0-9-]+)"/.exec(user) || [])[1] || '';
        if (!parsed.tools || !parsed.tools.length) say('NONE');
        else if (toolNames.indexOf('brief_proceed') >= 0 && used.indexOf('brief_proceed') < 0) call('brief_proceed', { objective: 'Refresh the widget', deliverable: 'a published widget reading' });
        else if (/^Refresh my saved widget/.test(user)) {
          if (toolNames.indexOf('widget_set') < 0) say('NO_WIDGET_TOOL');
          else if (used.indexOf('widget_get') < 0) call('widget_get', { id: widgetId });
          else if (used.indexOf('widget_set') < 0) call('widget_set', { id: widgetId, version: 1, value: '$12.34', sub: 'this month' });
          else say('Published the AI spend widget.');
        } else say('ok');
        res.write('data: [DONE]\n\n');
        res.end();
      });
    });
    server.listen(0, HOST, () => resolve({ server, requests, base: 'http://' + HOST + ':' + server.address().port + '/api/v1' }));
  });
}

// POST /api/run and read its NDJSON to the end; onEvent may answer prompts
async function runTo(B, H, body, onEvent) {
  const res = await fetch(B + '/api/run', { method: 'POST', headers: H, body: JSON.stringify(Object.assign({ key: 'sk-or-v1-local-proof', model: 'test/model', agentId: 'agent', isTask: true, placed: [] }, body)) });
  A.eq(res.status, 200, 'POST /api/run streams');
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const events = [];
  let buf = '', runId = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line) continue;
      let ev; try { ev = JSON.parse(line); } catch (_) { continue; }
      if (ev.name === 'agent.run.start' && ev.payload && !runId) runId = ev.payload.runId;
      events.push(ev);
      if (onEvent) await onEvent(ev, runId);
    }
  }
  const end = events.find(e => e.name === 'agent.run.end' && e.payload && e.payload.runId === runId);
  return { runId, events, reason: end && end.payload.reason };
}

(async () => {
  const mock = await startMockProvider();
  const fixture = SidecarFixture.create({ prefix: 'sk-run-truth-', env: {
    SKYNET_OPENROUTER_BASE: mock.base, STARNET_OPENROUTER_BASE: mock.base,
    SKYNET_OPENROUTER_KEY: 'sk-or-v1-local-proof', STARNET_OPENROUTER_KEY: 'sk-or-v1-local-proof',
    SKYNET_DEFAULT_MODEL: 'test/model', STARNET_DEFAULT_MODEL: 'test/model',
    SKYNET_FULL_ACCESS: '', STARNET_FULL_ACCESS: ''
  } });
  try {
    await fixture.start();
    const B = fixture.baseUrl, token = fixture.token;
    const H = { 'Content-Type': 'application/json', 'X-StarNet-Token': token, Origin: B };
    const roster = await fetch(B + '/api/roster', { method: 'POST', headers: H, body: JSON.stringify({ agents: [{ agentId: 'agent', system: 'LEAD', name: 'NOVA', model: 'test/model' }] }) });
    A.eq(roster.status, 200, 'the agent is on the roster');

    /* ---------- 1. releases#6: the widget's own refresh run holds widget.set and publishes ---------- */
    {
      const id = 'w-runtruth1017';
      const made = await (await fetch(B + '/api/widgets/configure', { method: 'POST', headers: H, body: JSON.stringify({
        id, label: 'AI spend', request: 'total spend this month from the ledger', display: 'metric', source: { kind: 'agent', id: 'starnet' } }) })).json();
      A.ok(made.widget && made.widget.config && made.widget.config.version === 1, 'Connected apps > StarNet > Create: the widget is configured (version 1)');
      const ask = await (await fetch(B + '/api/widgets/request', { method: 'POST', headers: H, body: JSON.stringify({ id }) })).json();
      A.ok(/Publish the result with widget\.set/.test(ask.prompt || ''), 'the refresh instruction tells the agent to publish with widget.set');

      // the same instruction on an ordinary conversation: no notebook placed, so the tool is still not granted there
      const plain = await runTo(B, H, { streamId: 'ws_plain', messages: [{ role: 'user', content: ask.prompt }] });
      const plainReq = mock.requests.filter(r => !r.aux && /^Refresh my saved widget/.test(r.user));
      A.ok(plainReq.length > 0 && plainReq.every(r => r.toolNames.indexOf('widget_set') < 0), 'an ordinary conversation without a notebook still holds no widget.set (the grant is scoped)');
      A.eq(plain.reason, 'done', 'that run ends on its own');
      mock.requests.length = 0;

      // the widget's own conversation (frontend/app/widgets.js openWidgetTask: 'widget-' + id)
      const own = await runTo(B, H, { streamId: 'widget-' + id, messages: [{ role: 'user', content: ask.prompt }] });
      const ownReq = mock.requests.filter(r => !r.aux && /^Refresh my saved widget/.test(r.user));
      A.ok(ownReq.length > 0 && ownReq.every(r => r.toolNames.indexOf('widget_set') >= 0 && r.toolNames.indexOf('widget_get') >= 0), 'the refresh run on the widget\'s conversation advertises widget.get + widget.set');
      A.ok(!ownReq.some(r => r.toolNames.indexOf('notebook_write') >= 0), 'and only those two: no other notebook tool rides along');
      const results = own.events.filter(e => e.name === 'agent.tool_result').map(e => e.payload);
      A.ok(results.length >= 2 && results.every(p => !p.isError), 'widget.get and widget.set both ran: ' + JSON.stringify(results.map(p => p.summary)));
      A.eq(own.reason, 'done', 'the refresh run ends done (no tool hunt)');
      const list = await (await fetch(B + '/api/widgets', { headers: H })).json();
      const w = (list.widgets || []).find(x => x.id === id);
      A.ok(w && w.value === '$12.34' && w.sub === 'this month', 'the widget shows the published reading');
      A.eq(w && w.agentId, 'agent', 'attributed to the agent that actually published it');
      A.eq(w && w.runId, own.runId, 'and to the refresh run');
    }
  } catch (e) {
    e.message += '\nsidecar output (tail):\n' + fixture.output().slice(-4000);
    throw e;
  } finally {
    await fixture.dispose();
    if (mock.server.closeAllConnections) mock.server.closeAllConnections();
    await new Promise(r => mock.server.close(r));
  }
  A.report('e2e.run-truth-1017.test');
})().catch(e => { console.log('FAIL: e2e.run-truth-1017.test threw - ' + (e && e.stack || e)); process.exit(1); });
