/* dev/seed-builder-lend.js — DEV-ONLY live proof for THE LENT BUILDER (team.dispatch builder:true).

   Real sidecar + real frontend + an in-process scripted model that plays both parts, in ASK mode (no Full Access), so
   every approval card is the real one the Commander answers:
     LEAD (system carries [ORCHESTRATION]): on a Commander message containing LEND it dispatches the crew member named
       FORGE with builder:true; on CONTROL it dispatches FORGE without it. Then it reports the dispatch rows.
     LENT WORKER (system carries [STATION BUILDER — lent by …]): tool_search "station builder" → station_map →
       a recruit plan (must be REFUSED by the page) → a bind plan (must be REFUSED by the sidecar) → add a plant to the
       main room → station_build that plan → report.
     CONTROL WORKER (no lend note): tool_search "station builder" → report what it found.
   Every request's advertised tool names, the system note it carried, and every tool result land in
   <workspace>/mock-log.jsonl as evidence. Isolated with SKYNET_WORKSPACES (never SKYNET_HOME). Not part of any build. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { spawn } = require('node:child_process');

const REPO = path.resolve(__dirname, '..');
const FIXTURE = path.join(__dirname, 'fixtures', 'seed-workspace');
// the scratch station lives under the gitignored .dogfood/ (like the other dev previews), so a run never leaves an
// untracked save + mock log in dev/ for a broad `git add` to sweep into history
const SCRATCH = process.env.SKYNET_LEND_SCRATCH || path.join(REPO, '.dogfood', 'builder-lend');
const SIDECAR = path.join(REPO, 'sidecar', 'index.js');
const PORT = String(process.env.SKYNET_PORT || '8931');
const LOG = path.join(SCRATCH, 'mock-log.jsonl');

const log = (o) => { try { fs.appendFileSync(LOG, JSON.stringify(Object.assign({ at: new Date().toISOString() }, o)) + '\n'); } catch (_) {} };
const textOf = (c) => typeof c === 'string' ? c : Array.isArray(c) ? c.map(p => (p && (p.text || p.content)) || '').join('') : '';

function sse(res, chunks) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  for (const c of chunks) res.write('data: ' + JSON.stringify(c) + '\n\n');
  res.write('data: [DONE]\n\n'); res.end();
}
const usage = { prompt_tokens: 5, completion_tokens: 6, total_tokens: 11 };
let callSeq = 0;
function sayText(res, text) {
  sse(res, [{ choices: [{ delta: { content: text } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage }]);
}
function callTool(res, name, args) {
  const id = 'call_' + (++callSeq);
  sse(res, [
    { choices: [{ delta: { tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }], usage }
  ]);
}

function decide(body, res) {
  const msgs = Array.isArray(body.messages) ? body.messages : [];
  const system = msgs.filter(m => m && m.role === 'system').map(m => textOf(m.content)).join('\n');
  const tools = (Array.isArray(body.tools) ? body.tools : []).map(t => (t && t.function && t.function.name) || t.name).filter(Boolean);
  const allResults = msgs.filter(m => m && m.role === 'tool').map(m => textOf(m.content));
  // the Task Brief gate is the harness's own step before consequential work: settle it first, then script the job
  const briefNoise = r => /Task Brief settled|Task Brief gate/.test(r);
  const results = allResults.filter(r => !briefNoise(r));
  const lastUser = textOf(([...msgs].reverse().find(m => m && m.role === 'user') || {}).content);
  if (tools.includes('brief_proceed') && !allResults.some(r => /Task Brief settled/.test(r))) {
    log({ kind: 'brief', tools: [], toolCount: tools.length, lastResult: allResults.length ? allResults[allResults.length - 1].slice(0, 300) : null });
    return callTool(res, 'brief_proceed', { objective: lastUser.slice(0, 200) || 'do the job', deliverable: 'the station change', success: 'the build is reported by station.build' });
  }
  const kind = /\[ORCHESTRATION\] You are the lead orchestrator/.test(system) ? 'lead'
    : /\[STATION BUILDER — lent by /.test(system) ? 'lent-worker'
    : /CONTROL-JOB/.test(lastUser) ? 'control-worker' : 'other';
  const note = (system.match(/\[STATION BUILDER — lent by [^\]]*\][^\n]*/) || [''])[0];
  log({ kind, tools, toolCount: tools.length, lastResult: results.length ? results[results.length - 1].slice(0, 1500) : null, lendNote: note || undefined });

  if (kind === 'lead') {
    if (!tools.length) return sayText(res, 'Lead: no tools on this turn.');
    if (results.length) return sayText(res, 'Lead: the dispatch answered: ' + results[results.length - 1].slice(0, 600));
    const m = system.match(/- ([A-Za-z0-9_-]+) \(FORGE\)/);
    if (!m) return sayText(res, 'Lead: there is no crew member called FORGE on YOUR TEAM.');
    if (/CONTROL/.test(lastUser)) return callTool(res, 'team_dispatch', { workers: [{ agentId: m[1], prompt: 'CONTROL-JOB: find the station builder tools and say what you found.' }] });
    if (/LEND/.test(lastUser)) return callTool(res, 'team_dispatch', { workers: [{ agentId: m[1], prompt: 'LEND-JOB: add a plant to the main room.', builder: true }] });
    return sayText(res, 'Lead: say LEND or CONTROL.');
  }
  if (kind === 'lent-worker') {
    const n = results.length, last = results[n - 1] || '';
    if (n === 0) return callTool(res, 'tool_search', { query: 'station builder' });
    if (n === 1) return callTool(res, 'station_map', {});
    if (n === 2) return callTool(res, 'station_plan', { line: 'build_test', steps: [{ step: 2, agent: 'new' }] });
    if (n === 3) return callTool(res, 'station_plan', { refit: [{ op: 'bind', prop: 'P1', connector: 'gmail' }] });
    if (n === 4) {
      let main = 'HOME';
      try { const mapRes = JSON.parse(results[1]); main = mapRes.main || (mapRes.rooms || []).find(r => r.main).name || main; } catch (_) {}
      return callTool(res, 'station_plan', { add: { room: main, pieces: ['plant'] } });
    }
    if (n === 5) {
      let planId = '';
      try { planId = JSON.parse(last).planId || ''; } catch (_) {}
      if (!planId) return sayText(res, 'FORGE: the plan did not come back: ' + last.slice(0, 300));
      return callTool(res, 'station_build', { planId });
    }
    return sayText(res, 'FORGE: build result: ' + last.slice(0, 400));
  }
  if (kind === 'control-worker') {
    if (!results.length) return callTool(res, 'tool_search', { query: 'station builder' });
    return sayText(res, 'FORGE (no lend): tool_search said: ' + results[0].slice(0, 400));
  }
  return sayText(res, 'ok');
}

function startMock() {
  return new Promise(resolve => {
    const server = http.createServer((req, res) => {
      if (req.url.indexOf('/models') >= 0) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ data: [{ id: 'test/model', context_length: 64000, pricing: { prompt: '0', completion: '0' }, supported_parameters: ['tools'] }] }));
        return;
      }
      if (req.url.indexOf('/chat/completions') >= 0) {
        let b = ''; req.on('data', d => b += d); req.on('end', () => {
          let body = {};
          try { body = JSON.parse(b); } catch (_) {}
          try { decide(body, res); } catch (e) { log({ mockError: String(e && e.stack || e) }); sayText(res, 'mock error'); }
        });
        return;
      }
      res.writeHead(404); res.end();
    });
    server.listen(0, '127.0.0.1', () => resolve('http://127.0.0.1:' + server.address().port + '/api/v1'));
  });
}

(async () => {
  // SKYNET_LEND_KEEP=1 relaunches on the SAME workspace (the restart half of the proof: did the build survive?)
  const keep = process.env.SKYNET_LEND_KEEP === '1' && fs.existsSync(path.join(SCRATCH, 'agent.save.json'));
  if (!keep) {
    fs.rmSync(SCRATCH, { recursive: true, force: true });
    fs.mkdirSync(SCRATCH, { recursive: true });
    fs.cpSync(FIXTURE, SCRATCH, { recursive: true });
  }
  const now = Date.now();
  if (!keep) try {
    const sp = path.join(SCRATCH, 'agent.save.json');
    const w = JSON.parse(fs.readFileSync(sp, 'utf8'));
    w.updatedAt = now; w.savedAt = now;
    if (w.doc) { w.doc.updatedAt = now; if (w.doc.agent) w.doc.agent.model = 'test/model'; }
    fs.writeFileSync(sp, JSON.stringify(w, null, 2));
  } catch (_) {}
  if (!keep) try {
    const rp = path.join(SCRATCH, 'agent.roster.json');
    const r = JSON.parse(fs.readFileSync(rp, 'utf8'));
    for (const a of (r.agents || [])) a.model = 'test/model';
    fs.writeFileSync(rp, JSON.stringify(r, null, 2));
  } catch (_) {}
  const base = await startMock();
  // ASK mode on purpose: no SKYNET_FULL_ACCESS, so the dispatch and every lent build raise the real approval card
  const env = Object.assign({}, process.env, {
    SKYNET_DEV: '1',
    SKYNET_WORKSPACES: SCRATCH, SKYNET_PORT: PORT,
    SKYNET_OPENROUTER_BASE: base, SKYNET_OPENROUTER_KEY: 'sk-or-v1-mock', SKYNET_DEFAULT_MODEL: 'test/model'
  });
  delete env.SKYNET_FULL_ACCESS; delete env.SKYNET_HOME;
  console.log('[seed-builder-lend] mock provider at ' + base + ' -> http://127.0.0.1:' + PORT + ' · log ' + LOG);
  const child = spawn(process.execPath, [SIDECAR], { cwd: REPO, env, stdio: 'inherit' });
  process.on('SIGINT', () => { try { child.kill(); } catch (_) {} });
  child.on('exit', c => process.exit(c == null ? 0 : c));
})();
