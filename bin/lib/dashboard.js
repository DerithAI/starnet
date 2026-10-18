/* bin/lib/dashboard.js — the live `starnet` dashboard: the terminal I/O and the station wiring around the pure model
   (station-model.js) and screen (tui.js).

   What it reads (all over the attached station's loopback API, token in the header):
     GET /api/observe          the live feed — every run's events and asks (reconnects with its cursor)
     GET /api/state/snapshot   every 3 s — which runs and asks are live (the truth after any gap)
     GET /api/runtime/agent    the roster · GET /api/budget/status spend · GET /api/routing/lines/stats + /api/line-jobs flows
     GET /api/transcript       this terminal's earlier conversation with each agent
   What it does (only when the person at the keyboard says so):
     POST /api/run             a message, on the agent's own terminal conversation (cli-<agentId>), as its roster defines it
     POST /api/consent(/answer) an answer to an ask, marked via:'terminal' so the desk card lets go
     POST /api/cancel          /stop · POST /api/routing/sample  /flow run

   A run this terminal starts lives as long as its response stream (the station's rule for every client): quitting
   stops it, and the quit key says so first. */
'use strict';

const http = require('node:http');
const readline = require('node:readline');
const core = require('./cli-core.js');
const { makeStation } = require('./station-model.js');
const tui = require('./tui.js');

function runDashboard(station, opts) {
  const o = opts || {};
  const out = o.stdout || process.stdout;
  const inp = o.stdin || process.stdin;
  const env = o.env || process.env;
  const client = station.client;
  const model = makeStation();
  const level = tui.colorLevel(env, !!out.isTTY);
  const ui = {
    focus: '', input: '', overlay: null, flash: null, scroll: 0, keyFlash: null, quitArmed: 0, quitNote: '',
    stationLabel: (station.mode === 'spawned' ? 'private station · ' : 'station · ') + client.base.replace(/^http:\/\//, ''),
    still: !!(env.STARNET_STILL === '1')
  };
  const mine = new Map();       // requests this terminal holds open: id -> { req, agentId, kind }
  let feedReq = null, cursor = '', feedRetry = null, stopped = false;
  const timers = [];
  let prevRows = [];
  let resolveExit;
  const exited = new Promise(r => { resolveExit = r; });
  const now = () => Date.now();
  const flash = (text, style, ms) => { ui.flash = { text, style: style || 'am', until: now() + (ms || 4000) }; paint(); };

  // ---- HTTP ----------------------------------------------------------------------------------------------
  const get = (p, t) => client.request('GET', p, null, { timeoutMs: t || 8000 });
  async function loadRoster() { const r = await get('/api/runtime/agent'); if (r.ok && r.status === 200 && r.json) { model.setRoster(r.json); if (!ui.focus || !model.state.agents.has(ui.focus)) ui.focus = pickFocus(); } return r; }
  async function loadSnapshot() {
    const r = await get('/api/state/snapshot');
    if (r.ok && r.status === 200 && r.json) { model.applySnapshot(r.json, now()); await require('./station-commands.js').fillAskSummaries(client, model).catch(() => {}); }
    return r;
  }
  async function loadBudget() { const r = await get('/api/budget/status'); if (r.ok && r.status === 200 && r.json) model.applyBudget(r.json); }
  async function loadLines() {
    const [s, j] = await Promise.all([get('/api/routing/lines/stats'), get('/api/line-jobs?limit=40')]);
    if (s.ok && s.status === 200 && j.ok && j.status === 200) model.applyLines(s.json || {}, (j.json && j.json.jobs) || []);
  }
  async function loadHistory() {
    const ids = model.state.order.slice(0, 12);
    await Promise.all(ids.map(async id => {
      const r = await get('/api/transcript?agent=' + encodeURIComponent(id) + '&stream=' + encodeURIComponent(core.cliStreamId(id)) + '&limit=40');
      if (r.ok && r.status === 200 && r.json && Array.isArray(r.json.turns)) model.seedHistory(id, r.json.turns);
    }));
  }
  function pickFocus() {
    const rows = model.rows(now());
    const f = rows.find(r => r.status.key === 'needs') || rows.find(r => r.status.key === 'working') || rows[0];
    return f ? f.id : '';
  }

  // ---- the live feed ---------------------------------------------------------------------------------------
  function connectFeed() {
    if (stopped) return;
    const headers = { Accept: 'text/event-stream', Origin: client.base, 'x-starnet-token': client.token() };
    if (cursor) headers['Last-Event-ID'] = cursor;
    let req;
    try {
      req = http.request({ host: client.host, port: client.port, method: 'GET', path: '/api/observe', headers }, res => {
        if (res.statusCode === 404) { model.state.feed = 'old'; res.resume(); paint(); return; }   // an older station: status from the snapshot only
        if (res.statusCode !== 200) { res.resume(); return retryFeed(); }
        res.setEncoding('utf8');
        let buf = '';
        res.on('data', chunk => {
          const r = core.splitSse(buf + chunk);
          buf = r.rest;
          for (const ev of r.events) {
            if (ev.id) cursor = ev.id;
            let j = null; try { j = JSON.parse(ev.data); } catch (_) { continue; }
            if (j && j.stream === 'ready') { model.state.feed = 'live'; if (j.reset) loadSnapshot().then(paint, () => {}); continue; }
            if (j && j.name) model.apply(j.name, j.payload, now());
          }
          schedulePaint();
        });
        const lost = () => { if (feedReq === req) { feedReq = null; if (!stopped) retryFeed(); } };
        res.on('end', lost); res.on('close', lost); res.on('error', lost);
      });
    } catch (_) { return retryFeed(); }
    req.on('error', () => { if (feedReq === req) { feedReq = null; retryFeed(); } });
    req.end();
    feedReq = req;
  }
  function retryFeed() {
    if (stopped || feedRetry) return;
    if (model.state.feed !== 'old') model.state.feed = 'down';
    paint();
    feedRetry = setTimeout(() => { feedRetry = null; connectFeed(); }, 2000);
  }

  // ---- doing things ---------------------------------------------------------------------------------------
  function send(agentId, text) {
    const a = model.state.agents.get(agentId);
    if (!a) return flash('no agent named ' + agentId);
    if (!a.model) return flash(a.name + ' has no model set — pick one in the app first');
    const streamId = core.cliStreamId(agentId);
    model.noteSent(agentId, text, streamId, now());
    ui.scroll = 0;
    // tools only for a task, decided the way the page decides it (the agent's last reply lets a bare "yes" to its offer count)
    const prior = [...model.logOf(agentId)].reverse().find(e => e.k === 'agent');
    const body = { model: a.model, provider: a.provider || undefined, agentId, streamId, rosterSystem: true, isTask: core.isTaskText(text, prior && prior.text), messages: [{ role: 'user', content: text }] };
    const payload = Buffer.from(JSON.stringify(body), 'utf8');
    const id = 'run' + Math.random().toString(36).slice(2);
    let req;
    try {
      req = http.request({ host: client.host, port: client.port, method: 'POST', path: '/api/run', headers: { Origin: client.base, 'Content-Type': 'application/json', 'Content-Length': payload.length, 'x-starnet-token': client.token(), Accept: 'application/x-ndjson' } }, res => {
        if (res.statusCode !== 200) {
          const chunks = [];
          res.on('data', d => chunks.push(d));
          res.on('end', () => { mine.delete(id); model.sendFailed(agentId, streamId, Buffer.concat(chunks).toString('utf8').slice(0, 200) || 'HTTP ' + res.statusCode, now()); paint(); });
          return;
        }
        res.setEncoding('utf8');
        let buf = '';
        res.on('data', chunk => {
          const r = core.splitNdjson(buf + chunk);
          buf = r.rest;
          // with the live feed up, the feed already carries this run; without it (an older station) its own stream does
          if (model.state.feed === 'live') return;
          for (const line of r.lines) { let ev = null; try { ev = JSON.parse(line); } catch (_) { continue; } if (ev && ev.name) model.apply(ev.name, Object.assign({}, ev.payload, ev.name === 'agent.run.start' ? { streamId } : {}), now()); }
          schedulePaint();
        });
        const done = () => { mine.delete(id); paint(); };
        res.on('end', done); res.on('close', done); res.on('error', done);
      });
    } catch (e) { model.sendFailed(agentId, streamId, (e && e.message) || String(e), now()); return paint(); }
    req.on('error', e => { mine.delete(id); if (!stopped) { model.sendFailed(agentId, streamId, (e && e.message) || 'connection failed', now()); paint(); } });
    req.end(payload);
    mine.set(id, { req, agentId, kind: 'run' });
    paint();
  }
  async function answer(key) {
    const q = model.front();
    if (!q) return;
    if (key === 'v') {
      q.view = !q.view;
      if (q.view && q.details == null) {
        paint();
        const r = await get('/api/consent/args?runId=' + encodeURIComponent(q.runId) + '&promptId=' + encodeURIComponent(q.promptId));
        q.details = (r.ok && r.status === 200 && r.json) ? (r.json.noDetails ? 'this ask carries no further detail' : String(r.json.args || '')) : (r.json && r.json.error) || 'the full request could not be read';
      }
      return paint();
    }
    const decision = key === 'y' ? 'once' : 'deny';
    ui.keyFlash = { k: key, until: now() + 700 };
    const r = await client.request('POST', '/api/consent', { runId: q.runId, promptId: q.promptId, decision, via: 'terminal' });
    if (r.ok && r.json && r.json.ok) model.apply('permission.response', { promptId: q.promptId, decision: r.json.decision || decision, via: 'terminal' }, now());
    else if (r.ok && r.json && r.json.gone) { model.apply('permission.response', { promptId: q.promptId, decision: 'deny', stopped: true }, now()); flash('that ask is no longer waiting — it was answered elsewhere or its run ended'); }
    else flash('the station did not take that answer' + (r.error ? ' (' + r.error + ')' : r.status ? ' (HTTP ' + r.status + ')' : ''));
    paint();
  }
  async function answerQuestion(text) {
    const q = model.front();
    if (!q || !q.question) return;
    const r = await client.request('POST', '/api/consent/answer', { runId: q.runId, promptId: q.promptId, answer: text, receipt: true, via: 'terminal' });
    if (r.ok && r.json && r.json.ok) model.apply('permission.response', { promptId: q.promptId, decision: 'once', via: 'terminal' }, now());
    else flash('that question is no longer waiting');
    paint();
  }
  async function stopAgent(agentId) {
    const a = model.state.agents.get(agentId);
    if (!a || !a.runs.size) return flash((a ? a.name : 'that agent') + ' has nothing running');
    const ids = [...a.runs];
    const rs = await Promise.all(ids.map(runId => client.request('POST', '/api/cancel', { runId })));
    const n = rs.filter(r => r.ok && r.json && r.json.ok).length;
    flash(n ? 'stopping ' + n + ' run(s) of ' + a.name : 'the station did not confirm the stop', n ? 'ok' : 'am');
  }
  async function runFlow(word, text) {
    const line = model.findLine(word);
    if (!line) return flash('no workflow named ' + word + ' · /flow lists them');
    const name = line.name || line.lineId;
    flash('sending one job down ' + name + ' · it runs until the line delivers', 'ok', 5000);
    const id = 'flow' + Math.random().toString(36).slice(2);
    mine.set(id, { req: null, agentId: '', kind: 'flow' });
    const r = await client.request('POST', '/api/routing/sample', { text, line: line.lineId }, { timeoutMs: 60 * 60 * 1000 });
    mine.delete(id);
    if (r.ok && r.status === 200 && r.json && r.json.ok) flash(name + ' delivered' + (r.json.totalUsd ? ' · $' + Number(r.json.totalUsd).toFixed(3) : ''), 'ok', 8000);
    else flash(name + ': ' + ((r.json && (r.json.error || r.json.reason)) || r.error || 'HTTP ' + r.status), 'bad', 8000);
    loadLines().then(paint, () => {});
  }

  // ---- input ------------------------------------------------------------------------------------------------
  function submit(raw) {
    const text = String(raw || '').trim();
    ui.overlay = null;
    if (!text) return;
    const q = model.front();
    if (q && q.question && text[0] !== '@' && text[0] !== '/') return answerQuestion(text);
    if (text[0] === '/') return command(text);
    let target = ui.focus, body = text;
    const m = /^@(\S+)\s*([\s\S]*)$/.exec(text);
    if (m) {
      const a = model.findAgent(m[1]);
      if (!a) return flash('no agent named ' + m[1] + ' · ' + model.state.order.map(id => '@' + model.state.agents.get(id).name.toLowerCase()).join(' '));
      ui.focus = a.id; target = a.id; body = m[2].trim();
      if (!body) return paint();
    }
    if (!target) return flash('no agent to talk to');
    send(target, body);
  }
  function command(text) {
    const parts = text.split(/\s+/), cmd = parts[0].toLowerCase();
    if (cmd === '/help' || cmd === '/?') { ui.overlay = { title: 'COMMANDS', items: tui.HELP, foot: 'any key closes this' }; return paint(); }
    if (cmd === '/quit' || cmd === '/exit') return quit(true);
    if (cmd === '/stop') { const a = parts[1] ? model.findAgent(parts[1]) : model.state.agents.get(ui.focus); return a ? stopAgent(a.id) : flash('no agent named ' + parts[1]); }
    if (cmd === '/flow' || cmd === '/flows') {
      if (parts[1] === 'run') {
        if (parts.length < 4) return flash('/flow run <name> <the job text>');
        return runFlow(parts[2], parts.slice(3).join(' '));
      }
      const fl = model.flows(now());
      ui.overlay = { title: 'WORKFLOWS', items: fl.length ? fl.map(f => [f.name, f.state + ' · ' + f.text + (f.shipped ? ' · ' + f.shipped + ' shipped' : '')]) : [['none yet', 'build a line in the app (INBOX → steps → OUTBOX)']], foot: 'send one job: /flow run <name> <text>' };
      return paint();
    }
    flash('unknown command ' + cmd + ' · /help lists them');
  }
  function focusStep(d) {
    const ids = model.state.order;
    if (!ids.length) return;
    const i = Math.max(0, ids.indexOf(ui.focus));
    ui.focus = ids[(i + d + ids.length) % ids.length];
    ui.scroll = 0; ui.overlay = null;
  }
  function quit(force) {
    const live = [...mine.values()].filter(x => x.kind === 'run').length;
    const flows = [...mine.values()].filter(x => x.kind === 'flow').length;
    if (!force && (live || flows) && !(ui.quitArmed > now())) {
      ui.quitArmed = now() + 3000;
      ui.quitNote = (live ? 'stops ' + live + ' run(s) you started here' : '') + (live && flows ? ' and ' : '') + (flows ? 'stops waiting on ' + flows + ' workflow job(s)' : '');
      return paint();
    }
    stop(0);
  }
  function onKey(str, key) {
    const k = key || {};
    if (k.ctrl && k.name === 'c') return quit(false);
    if (k.ctrl && k.name === 'l') { prevRows = []; return paint(); }
    ui.quitArmed = 0;
    if (k.name === 'escape') { ui.input = ''; ui.overlay = null; ui.scroll = 0; return paint(); }
    if (k.name === 'tab') { focusStep(k.shift ? -1 : 1); return paint(); }
    if (k.name === 'up' && !ui.input) { focusStep(-1); return paint(); }
    if (k.name === 'down' && !ui.input) { focusStep(1); return paint(); }
    if (k.name === 'pageup') { ui.scroll += 8; return paint(); }
    if (k.name === 'pagedown') { ui.scroll = Math.max(0, ui.scroll - 8); return paint(); }
    if (k.name === 'return' || k.name === 'enter') { const t = ui.input; ui.input = ''; submit(t); return paint(); }
    if (k.name === 'backspace') { ui.input = ui.input.slice(0, -1); return paint(); }
    if (typeof str !== 'string' || !str || k.ctrl || k.meta) return;
    const ch = str.replace(/[\x00-\x1f\x7f]/g, '');
    if (!ch) return;
    ui.overlay = null;
    const q = model.front();
    if (!ui.input && q && !q.question && /^[ynv]$/i.test(ch)) { answer(ch.toLowerCase()); return; }
    if (!ui.input && q && q.question && /^[1-6]$/.test(ch) && q.question.options[Number(ch) - 1]) { answerQuestion(q.question.options[Number(ch) - 1]); return; }
    if (ui.input.length < 4000) ui.input += ch;
    paint();
  }

  // ---- the screen ---------------------------------------------------------------------------------------------
  let paintTimer = null;
  function schedulePaint() { if (!paintTimer) paintTimer = setTimeout(() => { paintTimer = null; paint(); }, 33); }
  function paint() {
    if (stopped) return;
    const t = now();
    model.tick(t);
    // the last column stays empty: a glyph there leaves the cursor in a pending wrap, so an erase after it ate the
    // character, and on consoles without a deferred wrap the bottom-right cell scrolls the whole screen
    const size = { cols: Math.max(20, (out.columns || 80) - 1), rows: out.rows || 24 };
    const rows = tui.render(model, ui, size, t).map(segs => tui.toAnsi(segs, level));
    let s = '';
    // every rendered row is padded to the full width, so no erase-to-end is needed (or wanted)
    for (let y = 0; y < rows.length; y++) if (prevRows[y] !== rows[y]) s += '\x1b[' + (y + 1) + ';1H' + rows[y] + '\x1b[0m';
    if (rows.length < prevRows.length) s += '\x1b[' + (rows.length + 1) + ';1H\x1b[J';
    prevRows = rows;
    if (s) try { out.write(s); } catch (_) {}
  }
  function enterScreen() {
    out.write('\x1b[?1049h\x1b[?25l\x1b[2J\x1b[H');
    readline.emitKeypressEvents(inp);
    if (inp.isTTY && typeof inp.setRawMode === 'function') inp.setRawMode(true);
    inp.on('keypress', onKey);
    inp.resume();
    out.on('resize', onResize);
  }
  function onResize() { prevRows = []; try { out.write('\x1b[2J'); } catch (_) {} paint(); }
  function leaveScreen() {
    try { inp.removeListener('keypress', onKey); } catch (_) {}
    try { out.removeListener('resize', onResize); } catch (_) {}
    try { if (inp.isTTY && typeof inp.setRawMode === 'function') inp.setRawMode(false); } catch (_) {}
    try { inp.pause(); } catch (_) {}
    try { out.write('\x1b[0m\x1b[?25h\x1b[?1049l'); } catch (_) {}
  }
  const onExit = () => { if (!stopped) leaveScreen(); };
  function stop(code) {
    if (stopped) return;
    stopped = true;
    for (const t of timers) clearInterval(t);
    if (feedRetry) clearTimeout(feedRetry);
    if (paintTimer) clearTimeout(paintTimer);
    try { if (feedReq) feedReq.destroy(); } catch (_) {}
    for (const m of mine.values()) { try { if (m.req) m.req.destroy(); } catch (_) {} }
    leaveScreen();
    process.removeListener('exit', onExit);
    resolveExit(code || 0);
  }

  // ---- go ----------------------------------------------------------------------------------------------------
  (async () => {
    process.on('exit', onExit);
    enterScreen();
    paint();
    const rt = await loadRoster();
    if (!(rt.ok && rt.status === 200)) {
      stop(core.EXIT.STATION);
      process.stderr.write('starnet: could not read the station roster (' + (rt.error || 'HTTP ' + rt.status) + ')\n');
      return;
    }
    await Promise.all([loadSnapshot(), loadBudget(), loadLines().catch(() => {})]);
    await loadHistory().catch(() => {});
    ui.focus = pickFocus() || ui.focus;
    connectFeed();
    paint();
    const every = (ms, fn) => { const t = setInterval(() => { Promise.resolve().then(fn).then(paint, () => {}); }, ms); timers.push(t); };
    every(3000, loadSnapshot);
    every(10000, loadBudget);
    every(6000, () => loadLines().catch(() => {}));
    every(20000, loadRoster);
    timers.push(setInterval(paint, 250));
  })().catch(e => { stop(0); process.stderr.write('starnet: ' + ((e && e.message) || e) + '\n'); });
  return exited;
}

module.exports = { runDashboard };
