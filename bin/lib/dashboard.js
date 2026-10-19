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
const sixel = require('./sixel.js');
const png = require('./png.js');
const portrait = require('./portrait.js');

function runDashboard(station, opts) {
  const o = opts || {};
  const out = o.stdout || process.stdout;
  const inp = o.stdin || process.stdin;
  const env = o.env || process.env;
  const client = station.client;
  const model = makeStation();
  const level = tui.colorLevel(env, !!out.isTTY);
  const ui = {
    focus: '', input: '', overlay: null, picker: null, streams: {}, history: [], histAt: null, histDraft: '', pasting: false, flash: null, scroll: 0, keyFlash: null, quitArmed: 0, quitNote: '',
    // which station this is, in words: the desktop app's own, a private one this terminal booted, or one at an address
    stationLabel: station.mode === 'spawned' ? 'private station · port ' + client.base.replace(/^.*:/, '')
      : station.workspace ? 'desktop station · port ' + client.base.replace(/^.*:/, '')
        : 'station · ' + client.base.replace(/^http:\/\//, ''),
    still: !!(env.STARNET_STILL === '1'),
    // the REAL logo: an image where the terminal draws Sixel, else the same logo as braille dots. STARNET_LOGO=dots skips
    // the image, =ascii draws the drawn-letter version, =plain keeps to the one-line mark
    logo: ['plain', 'ascii', 'dots'].indexOf(env.STARNET_LOGO) >= 0 ? env.STARNET_LOGO : 'full',
    logoImage: null,
    // each agent's station sprite (decoded), drawn as ASCII art beside COMMS; STARNET_PORTRAIT=0 leaves it out
    sprites: {}, portraits: env.STARNET_PORTRAIT !== '0' && env.STARNET_LOGO !== 'plain'
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
  /* CONVERSATIONS. Each agent talks on one terminal conversation at a time (a stream: cli-<agent> or cli-<agent>-<time>). The
     station keeps no list of them, but every run row names its stream, so the terminal's own conversations are read off
     GET /api/runs: newest first, with when, how many messages and the run title. At launch each agent reopens its newest. */
  const convs = new Map();   // agentId -> [{ streamId, last, first, msgs, title }]
  const streamOf = id => ui.streams[id] || core.cliStreamId(id);
  async function loadConversations() {
    const r = await get('/api/runs?agent=*&limit=500', 15000);
    if (!(r.ok && r.status === 200 && r.json && Array.isArray(r.json.runs))) return false;
    const by = new Map();
    for (const x of r.json.runs) {
      const sid = String((x && x.streamId) || ''), aid = String((x && x.agentId) || '');
      if (!aid || !(sid === core.cliStreamId(aid) || sid.indexOf(core.cliStreamId(aid) + '-') === 0) || x.internal) continue;
      const t = Number(x.startedAt || x.ts) || 0;
      const key = aid + '\n' + sid;
      const c = by.get(key) || { agentId: aid, streamId: sid, last: 0, first: Infinity, msgs: 0, title: '' };
      c.msgs++;
      if (t >= c.last) c.last = t;
      if (t < c.first) { c.first = t; c.title = String(x.title || x.sessionTitle || c.title || ''); }
      by.set(key, c);
    }
    convs.clear();
    for (const c of by.values()) { if (!convs.has(c.agentId)) convs.set(c.agentId, []); convs.get(c.agentId).push(c); }
    for (const list of convs.values()) list.sort((a, b) => b.last - a.last);
    return true;
  }
  async function loadStream(id, sid) {
    const r = await get('/api/transcript?agent=' + encodeURIComponent(id) + '&stream=' + encodeURIComponent(sid) + '&limit=60');
    if (r.ok && r.status === 200 && r.json && Array.isArray(r.json.turns)) model.seedHistory(id, r.json.turns);
  }
  async function loadHistory() {
    await loadConversations().catch(() => false);
    for (const [id, list] of convs) if (list.length && !ui.streams[id]) ui.streams[id] = list[0].streamId;   // each agent's newest
    await Promise.all(model.state.order.slice(0, 16).map(id => loadStream(id, streamOf(id))));
  }
  /* PORTRAITS: the figure each agent is in the app — the same sprite and rule the app's own portraits use (rot_south.png of
     the set its skin names; ULTRON's own set; the default skin when it wears none). The skin table is the app's
     (/app/data-shim.js), the skin each agent wears is in the saved station (GET /api/save). Any of it missing and that agent
     simply has no portrait. Read at launch, and again when the roster gains an agent. */
  const spriteOf = new Map();   // set -> decoded image | null
  let skinTable = null;
  async function loadPortraits() {
    if (!ui.portraits) return;
    if (!skinTable) {
      const r = await get('/app/data-shim.js');
      if (!(r.ok && r.status === 200)) return;
      skinTable = portrait.parseSkins(r.text);
    }
    const s = await get('/api/save', 30000);
    const doc = s.ok && s.status === 200 && s.json ? (s.json.save || s.json.doc || s.json) : null;
    const wearing = {};
    for (const a of (doc && Array.isArray(doc.agents) ? doc.agents : [])) if (a && a.id) wearing[a.id] = String(a.skin || '');
    for (const id of model.state.order) {
      const set = portrait.setFor(id, wearing[id], skinTable);
      if (!set) { ui.sprites[id] = null; continue; }
      if (!spriteOf.has(set)) {
        const r = await client.request('GET', '/assets/sprites/' + set + '/rot_south.png', null, { raw: true, timeoutMs: 8000 });
        let img = null;
        if (r.ok && r.status === 200 && r.buf) { try { img = png.decode(r.buf); } catch (_) { img = null; } }
        spriteOf.set(set, img);
      }
      ui.sprites[id] = spriteOf.get(set);
    }
  }
  function newConversation() {
    const a = model.state.agents.get(ui.focus);
    if (!a) return flash('no agent to start a conversation with');
    ui.streams[a.id] = core.cliStreamId(a.id) + '-' + Date.now().toString(36);
    model.resetLog(a.id, '— a new conversation with ' + a.name + ' —');
    ui.scroll = 0; ui.overlay = null;
    flash('new conversation with ' + a.name + ' · /resume goes back to an earlier one', 'ok');
  }
  async function openResumePicker() {
    const a = model.state.agents.get(ui.focus);
    if (!a) return flash('no agent shown');
    const p = { kind: 'resume', title: 'CONVERSATIONS · ' + a.name, note: 'from this terminal', filter: '', sel: 0, items: [], loading: true,
      foot: '↑ ↓ pick · enter opens it · esc close · type to filter', onPick: it => switchConversation(a.id, it.streamId, it.when) };
    ui.picker = p; ui.overlay = null; paint();
    await loadConversations().catch(() => false);
    const cur = streamOf(a.id);
    const list = (convs.get(a.id) || []).slice();
    // the station lists a run once it ENDS: a conversation whose first reply is still running is this one, said as such
    const sentHere = model.logOf(a.id).some(e => e.k === 'you');
    if (!list.some(c => c.streamId === cur)) list.unshift({ streamId: cur, last: now(), msgs: 0, title: sentHere ? '(this conversation — its first reply is still running)' : '(this conversation — nothing sent yet)' });
    p.items = list.map(c => {
      const when = c.msgs ? require('./station-model.js').ago(now() - c.last) : 'now';
      return { streamId: c.streamId, when, current: c.streamId === cur, search: (when + ' ' + c.title).toLowerCase(),
        cols: [[padTo(when, 10), 'dim'], [padTo(c.msgs ? c.msgs + ' msg' + (c.msgs === 1 ? '' : 's') : '', 9), 'dim'], [c.title || '(untitled)', 'fg']] };
    });
    p.sel = Math.max(0, p.items.findIndex(i => i.current));
    p.loading = false;
    paint();
  }
  async function switchConversation(agentId, sid, when) {
    const a = model.state.agents.get(agentId);
    if (!a) return;
    if (sid === streamOf(agentId)) return paint();
    ui.streams[agentId] = sid;
    model.resetLog(agentId, '');
    ui.scroll = 0;
    await loadStream(agentId, sid);
    flash('back in the conversation from ' + when + ' with ' + a.name, 'ok');
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
    const streamId = streamOf(agentId);
    model.noteSent(agentId, text, streamId, now());
    ui.scroll = 0;
    // tools only for a task, decided the way the page decides it (the agent's last reply lets a bare "yes" to its offer count)
    const prior = [...model.logOf(agentId)].reverse().find(e => e.k === 'agent');
    const body = { model: a.model, provider: a.provider || undefined, agentId, streamId, rosterSystem: true, client: 'terminal', isTask: core.isTaskText(text, prior && prior.text), messages: [{ role: 'user', content: text }] };
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
  // ---- /model: every model of every CONNECTED provider, the one the agent runs on marked ------------------------------
  let modelsCache = null;
  async function loadModels() {
    if (modelsCache && now() - modelsCache.at < 5 * 60000) return modelsCache.items;
    const pr = await get('/api/providers', 10000);
    if (!(pr.ok && pr.status === 200 && pr.json)) throw new Error(pr.error || 'HTTP ' + pr.status);
    const provs = (pr.json.providers || []).filter(p => p && p.id && p.configured);
    const lists = await Promise.all(provs.map(async p => {
      const r = await get('/api/models/' + encodeURIComponent(p.id), 20000);
      return { p, models: (r.ok && r.status === 200 && r.json && Array.isArray(r.json.models)) ? r.json.models : [] };
    }));
    const items = [];
    for (const { p, models } of lists) for (const m of models) if (m && m.id) items.push({ provider: p.id, id: String(m.id), name: String(m.displayName || m.name || ''), tools: m.supportsTools !== false });
    modelsCache = { at: now(), items };
    return items;
  }
  const padTo = (s, n) => { const t = tui.trunc(String(s), n); return t + ' '.repeat(Math.max(0, n - tui.width(t))); };
  async function openModelPicker(filter) {
    const a = model.state.agents.get(ui.focus);
    if (!a) return flash('no agent to set a model for');
    const p = {
      kind: 'model', title: 'MODEL · ' + a.name, note: 'now ' + (a.provider ? a.provider + ' · ' : '') + (a.model || 'not set'),
      filter: String(filter || ''), sel: 0, items: [], loading: true,
      foot: '↑ ↓ pick · enter switches ' + a.name + ' · esc close · type to filter',
      onPick: it => setModel(a.id, it.provider, it.model)
    };
    ui.picker = p; ui.overlay = null; paint();
    try {
      const items = await loadModels();
      p.items = items.map(m => ({
        provider: m.provider, model: m.id, current: m.provider === a.provider && m.id === a.model,
        search: (m.provider + ' ' + m.id + ' ' + m.name).toLowerCase(),
        cols: [[padTo(m.provider, 12), 'dim'], [m.id, 'fg'], [m.name && m.name.toLowerCase() !== m.id.toLowerCase() ? '   ' + m.name : '', 'dim'], [m.tools ? '' : '   no tools', 'am']]
      }));
      const ci = tui.pickerView(p).findIndex(i => i.current);
      p.sel = ci >= 0 ? ci : 0;
    } catch (e) { p.error = 'the station did not list its models: ' + ((e && e.message) || e); }
    p.loading = false;
    // /model <name> that matches exactly one model switches at once
    if (p.filter && ui.picker === p) { const v = tui.pickerView(p); if (v.length === 1) { ui.picker = null; return setModel(a.id, v[0].provider, v[0].model); } }
    paint();
  }
  async function setModel(agentId, provider, modelId) {
    const a = model.state.agents.get(agentId);
    if (!a) return;
    flash('switching ' + a.name + ' to ' + provider + ' · ' + modelId + '…', 'am', 15000);
    const r = await client.request('POST', '/api/agent/model', { agentId, model: modelId, provider }, { timeoutMs: 15000 });
    if (r.ok && r.status === 200 && r.json && r.json.ok) {
      a.model = String(r.json.model); a.provider = String(r.json.provider);
      flash(a.name + ' now runs on ' + a.provider + ' · ' + a.model + ' (from its next message)', 'ok', 6000);
    } else flash('the model did not change: ' + ((r.json && r.json.error) || r.error || (r.status === 404 ? 'this station is older than /model' : 'HTTP ' + r.status)), 'bad', 9000);
    loadRoster().then(paint, () => {});
  }
  function pickerKey(str, k) {
    const p = ui.picker, list = tui.pickerView(p);
    if (k.name === 'escape') { ui.picker = null; return paint(); }
    if (k.name === 'up') { p.sel = Math.max(0, (p.sel | 0) - 1); return paint(); }
    if (k.name === 'down') { p.sel = Math.max(0, Math.min(list.length - 1, (p.sel | 0) + 1)); return paint(); }
    if (k.name === 'pageup') { p.sel = Math.max(0, (p.sel | 0) - 10); return paint(); }
    if (k.name === 'pagedown') { p.sel = Math.max(0, Math.min(list.length - 1, (p.sel | 0) + 10)); return paint(); }
    if (k.name === 'return' || k.name === 'enter') { const it = list[p.sel | 0]; if (it && p.onPick && !p.loading) { ui.picker = null; p.onPick(it); } return paint(); }
    if (k.name === 'backspace') { p.filter = p.filter.slice(0, -1); p.sel = 0; return paint(); }
    if (k.sequence && /^\x1b\[[?\d;]*[ct]$/.test(k.sequence)) return;
    if (typeof str !== 'string' || !str || k.ctrl || k.meta || str.charCodeAt(0) === 27) return;
    const ch = str.replace(/[\x00-\x1f\x7f]/g, '');
    if (ch && p.filter.length < 80) { p.filter += ch; p.sel = 0; }
    paint();
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
  function historyStep(d) {
    const h = ui.history;
    if (!h.length) return;
    if (ui.histAt == null) { if (d > 0) return; ui.histDraft = ui.input; ui.histAt = h.length; }
    const i = Math.max(0, Math.min(h.length, ui.histAt + d));
    ui.input = i === h.length ? ui.histDraft : h[i];
    ui.histAt = i === h.length ? null : i;
  }
  function submit(raw) {
    const text = String(raw || '').trim();
    ui.overlay = null;
    ui.histAt = null; ui.histDraft = '';
    if (!text) return;
    if (ui.history[ui.history.length - 1] !== text) { ui.history.push(text); if (ui.history.length > 200) ui.history.shift(); }
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
    if (cmd === '/model' || cmd === '/models') return openModelPicker(parts.slice(1).join(' '));
    if (cmd === '/new' || cmd === '/clear') return newConversation();
    if (cmd === '/resume' || cmd === '/conversations') return openResumePicker();
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
    if (k.ctrl && k.name === 'l') { redrawAll(); return; }
    ui.quitArmed = 0;
    if (ui.picker) return pickerKey(str, k);
    if (k.name === 'escape') { ui.input = ''; ui.overlay = null; ui.scroll = 0; return paint(); }
    // a PASTE is text (bracketed paste, ESC[?2004h): its newlines stay in the message — nothing is sent or answered mid-paste
    if (k.name === 'paste-start') { ui.pasting = true; return; }
    if (k.name === 'paste-end') { ui.pasting = false; return paint(); }
    if (ui.pasting) {
      if (k.name === 'return' || k.name === 'enter') { if (ui.input.length < 20000) ui.input += '\n'; return schedulePaint(); }
      if (typeof str === 'string' && str) { const ch = str.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ''); if (ch && ui.input.length < 20000) ui.input += ch; }
      return schedulePaint();
    }
    // tab / shift+tab: the agent shown in COMMS · ↑ ↓: your earlier messages (and back to what you were typing)
    if (k.name === 'tab') { focusStep(k.shift ? -1 : 1); return paint(); }
    if (k.name === 'up') { historyStep(-1); return paint(); }
    if (k.name === 'down') { historyStep(1); return paint(); }
    if (k.name === 'pageup') { ui.scroll += 8; return paint(); }
    if (k.name === 'pagedown') { ui.scroll = Math.max(0, ui.scroll - 8); return paint(); }
    if (k.name === 'return' || k.name === 'enter') { const t = ui.input; ui.input = ''; submit(t); return paint(); }
    if (k.name === 'backspace') { ui.input = ui.input.slice(0, -1); return paint(); }
    if (k.sequence && /^\x1b\[[?\d;]*[ct]$/.test(k.sequence)) return;   // a late reply to the startup probe
    if (typeof str !== 'string' || !str || k.ctrl || k.meta || str.charCodeAt(0) === 27) return;
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
    const skip = ui.logoImage ? ui.logoImage.cols : 0, skipRows = ui.logoImage ? ui.logoImage.rows : 0;
    const rows = tui.render(model, ui, size, t).map((segs, y) => tui.toAnsi(y < skipRows ? tui.sliceSegs(segs, skip) : segs, level));
    let s = '';
    // every rendered row is padded to the full width, so no erase-to-end is needed (or wanted); a row beside the logo
    // image starts to its right, so the image's cells are never written over
    for (let y = 0; y < rows.length; y++) if (prevRows[y] !== rows[y]) s += '\x1b[' + (y + 1) + ';' + (y < skipRows ? skip + 1 : 1) + 'H' + rows[y] + '\x1b[0m';
    if (image && !imageShown) { s += '\x1b[1;1H' + image.sixel; imageShown = true; }
    if (rows.length < prevRows.length) s += '\x1b[' + (rows.length + 1) + ';1H\x1b[J';
    prevRows = rows;
    if (s) try { out.write(s); } catch (_) {}
  }
  function enterScreen() {
    out.write('\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J\x1b[H');   // …and bracketed paste on, so a paste arrives marked
    readline.emitKeypressEvents(inp);
    if (inp.isTTY && typeof inp.setRawMode === 'function') inp.setRawMode(true);
    inp.on('keypress', onKey);
    inp.resume();
    out.on('resize', onResize);
  }
  function redrawAll() { prevRows = []; imageShown = false; buildImage(); try { out.write('\x1b[2J'); } catch (_) {} paint(); }
  function onResize() { redrawAll(); }

  // ---- the real logo, as an image -----------------------------------------------------------------------------------
  let term = {}, image = null, imageShown = false;
  // ask the terminal (before the screen opens) whether it draws Sixel and how big a cell is. Replies arrive in order, so
  // DA1, which every terminal answers, goes last and closes the probe.
  function probeTerminal(ms) {
    return new Promise(resolve => {
      if (!inp.isTTY || !out.isTTY || ui.logo !== 'full') return resolve({});
      let buf = '', done = false, timer = null;
      const onData = d => { buf += String(d); if (/\x1b\[\?[\d;]*c/.test(buf)) finish(); };
      function finish() { if (done) return; done = true; clearTimeout(timer); inp.removeListener('data', onData); resolve(sixel.parseTermReplies(buf, out.columns || 80, out.rows || 24)); }
      try { if (typeof inp.setRawMode === 'function') inp.setRawMode(true); } catch (e) { return resolve({ error: e.message }); }
      timer = setTimeout(finish, ms);
      inp.on('data', onData);
      inp.resume();
      try { out.write('\x1b[16t\x1b[14t\x1b[c'); } catch (e) { finish(); }
    });
  }
  // the image fits three rows of this terminal's cells and leaves the crew bar at least 44 columns beside it
  function buildImage() {
    image = null; ui.logoImage = null;
    if (!term.sixel || !term.cellW || !term.cellH || ui.logo !== 'full') return;
    const r = sixel.logoSixel({ cellW: term.cellW, cellH: term.cellH, rows: 3, maxCols: Math.max(0, (out.columns || 80) - 1 - 47) });
    if (r) { image = r; ui.logoImage = { cols: r.cols, rows: r.rows }; }
  }
  function leaveScreen() {
    try { inp.removeListener('keypress', onKey); } catch (_) {}
    try { out.removeListener('resize', onResize); } catch (_) {}
    try { if (inp.isTTY && typeof inp.setRawMode === 'function') inp.setRawMode(false); } catch (_) {}
    try { inp.pause(); } catch (_) {}
    try { out.write('\x1b[0m\x1b[?25h\x1b[?2004l\x1b[?1049l'); } catch (_) {}
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
    term = await probeTerminal(400);
    buildImage();
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
    loadPortraits().then(paint, () => {});
    const every = (ms, fn) => { const t = setInterval(() => { Promise.resolve().then(fn).then(paint, () => {}); }, ms); timers.push(t); };
    every(3000, loadSnapshot);
    every(10000, loadBudget);
    every(6000, () => loadLines().catch(() => {}));
    every(20000, () => loadRoster().then(() => { if (ui.portraits && model.state.order.some(id => !(id in ui.sprites))) return loadPortraits(); }));
    timers.push(setInterval(paint, 100));   // the working spinner turns at 10 frames a second (paint writes only rows that changed)
  })().catch(e => { stop(0); process.stderr.write('starnet: ' + ((e && e.message) || e) + '\n'); });
  return exited;
}

module.exports = { runDashboard };
