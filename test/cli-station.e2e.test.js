/* node test/cli-station.e2e.test.js — `starnet ls / approve / deny / watch / flow`, end to end, against a REAL sidecar.

   test/cli-dashboard.test.js locks the pure model and formatters. This spawns bin/starnet.js exactly as a shell does
   (no TTY) beside a run another client started the way the page does (POST /api/run on its own conversation), with a
   content-driven mock OpenRouter (zero spend) and a hermetic profile, and proves:
     1. `ls --json` sees that run's open ask as needs-you, naming what it wants to write;
     2. `approve` answers it: exit 0, the write LANDS, and the run's own stream (the page) was told the terminal
        answered; a second `approve` / `deny` with nothing waiting exits 6;
     3. `watch --json` streams the run's events (start with its prompt, the tool call, the end);
     4. `-p` marks a task (the model is offered tools) and talk as talk (none) — without isTask no tool was ever offered;
     5. `flow` on a station with no lines says so, exit 0; a bare `starnet` in a pipe prints usage, never a screen.
   Part of test:http. */
'use strict';

const A = require('./_assert.js');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

const HOST = '127.0.0.1';
const BIN = path.resolve(__dirname, '..', 'bin', 'starnet.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

function startMock(seen) {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 8000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
      }
      let body = '';
      req.on('data', d => { body += d; });
      req.on('end', () => {
        let p = {}; try { p = JSON.parse(body); } catch (_) {}
        const msgs = p.messages || [];
        const last = [...msgs].reverse().find(m => m && m.role === 'user');
        const text = String((last && last.content) || '');
        seen.push({ text: text.slice(-120), tools: (p.tools || []).length });
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const tool = (name, args) => {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c' + Date.now(), type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }) + '\n\n');
          res.end('data: [DONE]\n\n');
        };
        const say = (t) => {
          res.write('data: ' + JSON.stringify({ choices: [{ delta: { content: t } }] }) + '\n\n');
          res.write('data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } }) + '\n\n');
          res.end('data: [DONE]\n\n');
        };
        if (msgs.some(m => m && m.role === 'tool')) return say('done');
        if (/write the station notes/i.test(text)) return tool('fs.write', { path: 'station-notes.md', content: 'approved from starnet approve' });
        return say('Hello from the station.');
      });
    });
    server.listen(0, HOST, () => resolve({ server, base: 'http://' + HOST + ':' + server.address().port + '/api/v1' }));
  });
}

function cli(args, env, ms) {
  return new Promise(resolve => {
    const child = spawn(process.execPath, [BIN].concat(args), { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', d => { out += d; }); child.stderr.on('data', d => { err += d; });
    const timer = setTimeout(() => { try { child.kill(); } catch (_) {} }, ms || 60000);
    child.on('exit', code => { clearTimeout(timer); resolve({ code, out, err }); });
  });
}
function hermetic(profile) {
  const h = { APPDATA: profile, LOCALAPPDATA: profile, XDG_DATA_HOME: profile, STARNET_PORT: '', SKYNET_PORT: '', STARNET_WORKSPACES: '', SKYNET_WORKSPACES: '', STARNET_TOKEN: '', STARNET_API_TOKEN: '', SKYNET_API_TOKEN: '' };
  if (process.platform !== 'win32') h.HOME = profile;
  return h;
}

(async () => {
  const seen = [];
  const mock = await startMock(seen);
  const providerEnv = {
    SKYNET_OPENROUTER_BASE: mock.base, STARNET_OPENROUTER_BASE: mock.base,
    SKYNET_OPENROUTER_KEY: 'sk-or-v1-station-fake', STARNET_OPENROUTER_KEY: 'sk-or-v1-station-fake',
    SKYNET_DEFAULT_MODEL: 'test/model', STARNET_DEFAULT_MODEL: 'test/model'
  };
  const fixture = SidecarFixture.create({ prefix: 'sk-cli-station-', env: providerEnv });
  await fixture.start();
  const port = String(fixture.port);
  const env = Object.assign(hermetic(fixture.profile), providerEnv);
  let watcher = null;
  try {
    // a watcher first, so it sees the whole run
    const watched = { out: '' };
    watcher = spawn(process.execPath, [BIN, 'watch', '--json', '--port', port], { env: Object.assign({}, process.env, env), stdio: ['ignore', 'pipe', 'pipe'] });
    watcher.stdout.setEncoding('utf8'); watcher.stdout.on('data', d => { watched.out += d; });
    await sleep(1500);

    // the page starts work on its own conversation (the bare agent asks before every write; no task brief, so the
    // write goes straight to the approval gate)
    const pageEvents = [];
    const payload = Buffer.from(JSON.stringify({ model: 'test/model', provider: 'openrouter', agentId: 'agent', streamId: 'desk-e2e', placed: [{ objectType: 'computer' }, { objectType: 'cabinet' }], messages: [{ role: 'user', content: 'write the station notes' }] }));
    const pageDone = new Promise(resolve => {
      const req = http.request({ host: HOST, port: fixture.port, path: '/api/run', method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': payload.length, 'X-StarNet-Token': fixture.token, Origin: fixture.baseUrl } }, res => {
        res.setEncoding('utf8'); let buf = '';
        res.on('data', d => { buf += d; let i; while ((i = buf.indexOf('\n')) >= 0) { const l = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (l) { try { pageEvents.push(JSON.parse(l)); } catch (_) {} } } });
        res.on('end', resolve);
      });
      req.on('error', resolve); req.end(payload);
    });
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline && !pageEvents.some(e => e.name === 'permission.prompt')) await sleep(100);
    A.ok(pageEvents.some(e => e.name === 'permission.prompt'), 'the page run is waiting on an approval');

    /* ---- 1. ls --json -------------------------------------------------------------------------- */
    const ls = await cli(['ls', '--json', '--port', port], env);
    A.eq(ls.code, 0, 'ls exits 0: ' + ls.err.slice(0, 200));
    let j = null; try { j = JSON.parse(ls.out); } catch (_) {}
    const hero = j && j.agents.find(a => a.agentId === 'agent');
    A.ok(hero && hero.status === 'needs-you', 'ls sees the open ask: ' + ls.out.slice(0, 300));
    A.ok(hero && /station-notes\.md/.test(hero.now), 'and names what it wants to write: ' + (hero && hero.now));
    const lsText = await cli(['ls', '--port', port], env);
    A.ok(/needs-you/.test(lsText.out) && /1 need you/.test(lsText.out), 'ls prints a table + summary');

    /* ---- 2. approve ---------------------------------------------------------------------------- */
    const ap = await cli(['approve', '--port', port], env);
    A.eq(ap.code, 0, 'approve exits 0: ' + ap.err);
    A.ok(/^allowed once · .* · fs\.write .*station-notes\.md/.test(ap.out), 'approve says what it allowed: ' + ap.out);
    await pageDone;
    const told = pageEvents.find(e => e.name === 'permission.response');
    A.ok(told && told.payload.via === 'terminal' && told.payload.decision === 'once', "the page's stream was told the terminal answered: " + JSON.stringify(told && told.payload));
    A.ok(fs.existsSync(path.join(fixture.workspace, 'agent', 'station-notes.md')), 'the approved write really landed');
    const again = await cli(['approve', '--port', port], env);
    A.eq(again.code, 6, 'nothing left to approve → exit 6');
    A.eq((await cli(['deny', 'agent', '--port', port], env)).code, 6, 'nothing to deny → exit 6');
    A.eq((await cli(['approve', 'ghost', '--port', port], env)).code, 3, 'an unknown agent → exit 3');

    /* ---- 3. watch --json ---------------------------------------------------------------------- */
    await sleep(800);
    const lines = watched.out.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch (_) { return null; } }).filter(Boolean);
    const runId = (pageEvents.find(e => e.name === 'agent.run.start') || { payload: {} }).payload.runId;
    const mine = lines.filter(e => e.payload && e.payload.runId === runId).map(e => e.name);
    A.ok(mine.indexOf('agent.run.start') >= 0 && mine.indexOf('agent.tool_call') >= 0 && mine.indexOf('permission.prompt') >= 0 && mine.indexOf('agent.run.end') >= 0, 'watch --json streamed the run: ' + mine.join(','));
    const start = lines.find(e => e.name === 'agent.run.start' && e.payload.runId === runId);
    A.ok(start && /write the station notes/.test(start.payload.prompt || ''), 'with the asking prompt');

    /* ---- 4. -p marks a task ------------------------------------------------------------------- */
    seen.length = 0;
    await cli(['-p', 'write a haiku file', '--port', port], env);
    A.ok(seen.some(s => /write a haiku file/.test(s.text) && s.tools > 0), '-p on an instruction: the model was offered tools: ' + JSON.stringify(seen.map(s => s.tools)));
    seen.length = 0;
    await cli(['-p', 'thanks!', '--port', port], env);
    A.ok(seen.some(s => /thanks!/.test(s.text)) && !seen.some(s => /thanks!/.test(s.text) && s.tools > 0), '-p on a pleasantry: talk, no tools');

    /* ---- 5. flow + a bare starnet in a pipe ----------------------------------------------------- */
    const fl = await cli(['flow', '--port', port], env);
    A.eq(fl.code, 0, 'flow exits 0');
    A.ok(/no workflows on this station yet/.test(fl.out), 'and says there are none: ' + fl.out);
    const fj = JSON.parse((await cli(['flow', '--json', '--port', port], env)).out);
    A.eq(fj.flows, [], 'flow --json: an empty list');
    const bare = await cli([], env);
    A.ok(bare.code === 0 && /starnet — run StarNet agents/.test(bare.out), 'a bare starnet without a terminal prints the usage');
  } catch (e) {
    A.ok(false, 'cli-station e2e threw: ' + ((e && e.stack) || e));
  } finally {
    try { if (watcher) watcher.kill(); } catch (_) {}
    await fixture.dispose();
    mock.server.close();
  }
  A.report('cli-station.e2e.test');
})();
