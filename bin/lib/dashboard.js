/* bin/lib/dashboard.js — the live `starnet` dashboard: the terminal I/O and the station wiring around the pure model
   (station-model.js) and screen (tui.js).

   What it reads (all over the attached station's loopback API, token in the header):
     GET /api/observe          the live feed — every run's events and asks (reconnects with its cursor)
     GET /api/state/snapshot   every 3 s — which runs and asks are live (the truth after any gap)
     GET /api/runtime/agent    the roster · GET /api/budget/status spend · GET /api/routing/lines/stats + /api/line-jobs flows
     GET /api/transcript       this terminal's earlier conversation with each agent
     GET /api/projects         is the folder `starnet` was started in a trusted project (bin/lib/folder.js)
   What it does (only when the person at the keyboard says so):
     POST /api/run             a message, on the agent's own terminal conversation (cli-<agentId>), as its roster defines it,
                               working in that trusted project when there is one
     POST /api/projects/bless  y on the TRUST THIS FOLDER? card: the same grant as the app's PROJECTS rail
     POST /api/consent(/answer) an answer to an ask, marked via:'terminal' so the desk card lets go
     POST /api/cancel          /stop · POST /api/routing/sample  /flow run

   A run this terminal starts lives as long as its response stream (the station's rule for every client): quitting
   stops it, and the quit key says so first. */
'use strict';

const os = require('node:os');
const http = require('node:http');
const readline = require('node:readline');
const core = require('./cli-core.js');
const { makeStation, costText, ONCE_ONLY_TOOLS } = require('./station-model.js');
const tui = require('./tui.js');
const sixel = require('./sixel.js');
const camfeed = require('./camfeed.js');
const folderLib = require('./folder.js');
const mouse = require('./mouse.js');

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
    // the folder this terminal works in: project = the trusted project every message works in; trust = the card asking
    // to trust the folder it was started in
    project: null, trust: null,
    lastSent: {},   // agentId -> { text, shown }: what /retry sends again
    // the page in the COMMS frame ('' = the conversation; stat · crew · work) and what it read off the station; the agent
    // whose menu card is open
    page: '', pageScroll: 0, pageData: {}, agentMenu: ''
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
  /* THE CAMERA FEED's art is the app's own, read off the station: the skin table (/app/data-shim.js), the skin each agent
     wears (GET /api/save), and the sprites and furniture the feed draws (/assets/...), fetched when an agent's feed first
     needs them. An agent with no skin wears the default, as in the app. */
  const feed = camfeed.makeCamFeed();
  let skinTable = null;
  const inFlight = new Set();
  async function loadSkins() {
    if (!ui.images) return;
    if (!skinTable) {
      const r = await get('/app/data-shim.js');
      if (!(r.ok && r.status === 200)) return;
      skinTable = camfeed.parseSkins(r.text);
    }
    const s = await get('/api/save', 30000);
    const doc = s.ok && s.status === 200 && s.json ? (s.json.save || s.json.doc || s.json) : null;
    const wearing = {};
    for (const a of (doc && Array.isArray(doc.agents) ? doc.agents : [])) if (a && a.id) wearing[a.id] = String(a.skin || '');
    for (const id of model.state.order) feed.setSkin(id, camfeed.setFor(id, wearing[id], skinTable));
  }
  // the station's level for the stat bar: its growth record in the save, read through the app's own xp.js (Xp.compute). A
  // save without one (or a read that fails) leaves the level out of the bar — never a made-up LV 1
  let Xp = null;
  async function loadStats() {
    try { Xp = Xp || require(require('node:path').join(__dirname, '..', '..', 'frontend', 'app', 'xp.js')); } catch (_) { return; }
    const s = await get('/api/save?agent=agent', 30000);
    const doc = s.ok && s.status === 200 && s.json ? s.json.save : null;
    ui.stats = doc && doc.stationStats ? Xp.compute(doc.stationStats) : null;
  }
  function loadFeedAssets(id) {
    for (const p of feed.needs(id)) {
      if (inFlight.has(p)) continue;
      inFlight.add(p);
      client.request('GET', p, null, { raw: true, timeoutMs: 8000 }).then(r => {
        feed.add(p, r.ok && r.status === 200 ? r.buf : null);
        inFlight.delete(p);
        if (!feed.needs(id).length) paint();
      }, () => { inFlight.delete(p); });
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
  // shown: what COMMS says you sent, when it is not the text itself (a skill goes as its whole recipe, shown as /skill task)
  function send(agentId, text, shown) {
    const a = model.state.agents.get(agentId);
    if (!a) return flash('no agent named ' + agentId);
    if (!a.model) return flash(a.name + ' has no model set — pick one in the app first');
    const streamId = streamOf(agentId);
    ui.lastSent[agentId] = { text, shown };
    model.noteSent(agentId, shown || text, streamId, now());
    ui.scroll = 0;
    // tools only for a task, decided the way the page decides it (the agent's last reply lets a bare "yes" to its offer count)
    const prior = [...model.logOf(agentId)].reverse().find(e => e.k === 'agent');
    const body = { model: a.model, provider: a.provider || undefined, agentId, streamId, rosterSystem: true, client: 'terminal', isTask: core.isTaskText(text, prior && prior.text), messages: [{ role: 'user', content: text }] };
    if (ui.project) body.projectRoot = ui.project.root;   // the trusted project this terminal was started in
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
    // y once · a always (this kind of action from now on, as the app's card offers it) · n deny
    const decision = key === 'y' ? 'once' : key === 'a' ? 'always' : 'deny';
    ui.keyFlash = { k: key, until: now() + 700 };
    const r = await client.request('POST', '/api/consent', { runId: q.runId, promptId: q.promptId, decision, via: 'terminal' });
    if (r.ok && r.json && r.json.ok) model.apply('permission.response', { promptId: q.promptId, decision: r.json.decision || decision, via: 'terminal' }, now());
    else if (r.ok && r.json && r.json.gone) { model.apply('permission.response', { promptId: q.promptId, decision: 'deny', stopped: true }, now()); flash('that ask is no longer waiting — it was answered elsewhere or its run ended'); }
    else flash('the station did not take that answer' + (r.error ? ' (' + r.error + ')' : r.status ? ' (HTTP ' + r.status + ')' : ''));
    paint();
  }
  // ---- the folder: work in the trusted project `starnet` was started in, or ask to trust it -------------------------
  function setProject(root) { ui.project = root ? { root, label: folderLib.shortPath(root, 60) } : null; }
  async function locateFolder() {
    // a folder here only means that folder to a station on this machine
    if (!folderLib.isLocalHost(client.host)) return;
    const projects = await folderLib.trustedProjects(client).catch(() => []);
    const f = folderLib.locate({ cwd: o.cwd || process.cwd(), projects, stationDirs: o.stationDirs || [] });
    if (f.trusted) return setProject(f.trusted);
    // a shell opens in your home folder (and the like): no card there, unless you named the folder with --cwd
    if (f.skip && !o.cwd) return;
    ui.trust = { root: f.root, folder: f.folder };
  }
  async function answerTrust(key) {
    const t = ui.trust;
    if (!t) return;
    ui.trust = null;
    ui.keyFlash = { k: key, until: now() + 700 };
    if (key !== 'y') return flash('not trusted · the crew works in its own workspace', 'dim', 5000);
    paint();
    const r = await client.request('POST', '/api/projects/bless', { path: t.root }, { timeoutMs: 10000 });
    if (r.ok && r.status === 200 && r.json && r.json.ok && r.json.root) {
      setProject(String(r.json.root));
      flash('trusted · the crew works in ' + folderLib.shortPath(r.json.root, 60) + ' (it is under PROJECTS in the app too)', 'ok', 6000);
    } else flash('the folder was not trusted: ' + ((r.json && r.json.reason) || r.error || 'HTTP ' + r.status), 'bad', 9000);
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

  // ---- THE PAGES: STAT · CREW · COMMS · WORK · SKILLS (the tab rule, f1-f5, /stat /crew /work) ---------------------------
  // what a page shows that the live feed does not carry is read when it opens, and again while it stays open
  let CronHuman = null;
  const appModule = name => require(require('node:path').join(__dirname, '..', '..', 'frontend', 'app', name));
  async function loadUsage() {
    const a = model.state.agents.get(ui.focus);
    const r = await client.request('POST', '/api/slash/dispatch', { input: '/usage', agentId: a ? a.id : 'agent', client: 'terminal' }, { timeoutMs: 20000 });
    const d = r.ok && r.status === 200 && r.json && r.json.ok && r.json.directive;
    ui.pageData.usage = d && d.type === 'say'
      ? { title: String(d.title || ''), lines: (Array.isArray(d.lines) && d.lines.length ? d.lines : String(d.text || '').split('\n')).map(String).filter(l => l.trim()) }
      : { error: 'the station did not say its spend (' + ((r.json && r.json.error) || r.error || 'HTTP ' + r.status) + ')' };
  }
  async function loadRoutines() {
    const r = await get('/api/cron', 10000);
    if (!(r.ok && r.status === 200 && r.json)) { ui.pageData.cron = { error: 'the routines could not be read (' + (r.error || 'HTTP ' + r.status) + ') — their state is unknown' }; return; }
    try { CronHuman = CronHuman || appModule('cronhuman.js'); } catch (_) { CronHuman = null; }
    const nameOf = id => { const a = model.state.agents.get(String(id || '')); return a ? a.name : ''; };
    const jobs = (Array.isArray(r.json.jobs) ? r.json.jobs : []).filter(j => j && j.id).map(j => {
      const shown = String(j.scheduleDisplay || j.schedule || '');
      const next = Date.parse(j.nextRunAt) || Number(j.nextRunAt) || 0;
      return { name: String(j.name || j.id), when: (CronHuman ? CronHuman.describeDisplay(shown) : shown) || 'no schedule', agent: nameOf(j.agentId),
        enabled: j.enabled !== false, inFlight: !!j.inFlight, next: next > now() ? 'in ' + require('./station-model.js').fmtShort(next - now()) : '' };
    });
    ui.pageData.cron = { enabled: !!r.json.enabled, halted: !!r.json.halted, jobs };
  }
  async function loadAway() {
    const a = model.state.agents.get(ui.focus);
    if (!a) { ui.pageData.away = { error: 'no agent shown' }; return; }
    const r = await client.request('POST', '/api/slash/dispatch', { input: '/away list', agentId: a.id, client: 'terminal' }, { timeoutMs: 20000 });
    const d = r.ok && r.status === 200 && r.json && r.json.ok && r.json.directive;
    ui.pageData.away = d && d.type === 'say'
      ? { agent: a.name, title: String(d.title || ''), lines: (Array.isArray(d.lines) ? d.lines : String(d.text || '').split('\n')).map(String).filter(l => l.trim()) }
      : { agent: a.name, error: 'the away shift could not be read (' + ((r.json && r.json.error) || r.error || 'HTTP ' + r.status) + ')' };
  }
  function loadPage() {
    if (ui.page === 'stat') return loadUsage().catch(() => {});
    if (ui.page === 'work') return Promise.all([loadRoutines(), loadAway()]).catch(() => {});
    return Promise.resolve();
  }
  function openPage(p) {
    if (ui.wake) return;
    ui.agentMenu = ''; ui.overlay = null; ui.pageScroll = 0; ui.picker = null;
    if (p === 'skills') { ui.page = ''; return openSkillsPicker(''); }
    ui.page = p === 'comms' ? '' : p;
    if (ui.page === 'stat') ui.pageData.usage = { loading: true };
    if (ui.page === 'work') { ui.pageData.cron = ui.pageData.cron || { loading: true }; ui.pageData.away = { loading: true }; }
    paint();
    loadPage().then(paint, () => {});
  }
  // a chat opened from anywhere: the agent's conversation in COMMS
  function openChat(id) {
    if (!model.state.agents.has(id)) return;
    if (ui.focus !== id) { ui.focus = id; ui.scroll = 0; }
    ui.page = ''; ui.agentMenu = ''; ui.overlay = null; ui.picker = null;
    paint();
  }
  // THE AGENT MENU: o open chat · m model · n new chat · h history · s stop (a card at the foot of COMMS)
  function openMenu(id) {
    if (ui.wake || !model.state.agents.has(id)) return;
    ui.agentMenu = id; ui.overlay = null;
    paint();
  }
  function menuKey(k) {
    const id = ui.agentMenu;
    ui.agentMenu = '';
    if (k === 'escape' || !model.state.agents.has(id)) return paint();
    if (k === 'o') return openChat(id);
    // the rest act on the agent shown in COMMS, as their slash commands do: show it first
    openChat(id);
    if (k === 'm') return openModelPicker('');
    if (k === 'n') return newConversation();
    if (k === 'h') return openResumePicker();
    if (k === 's') return stopAgent(id);
  }
  // a letter the open ask or the folder card answers (the keyboard's y a n v, a click on its [Y] [A] [N] [V])
  function answerKey(ch) {
    const q = model.front();
    if (q && !q.question && /^[ynv]$/.test(ch)) { answer(ch); return true; }
    if (q && !q.question && ch === 'a' && ONCE_ONLY_TOOLS.indexOf(q.tool) < 0) { answer('a'); return true; }
    if (!q && ui.trust && !ui.wake && /^[yn]$/.test(ch)) { answerTrust(ch); return true; }
    return false;
  }

  // ---- THE MOUSE (bin/lib/mouse.js): a click acts on what the screen drew under it, as its key would --------------------
  let lastHits = [], lastAreas = {}, lastScreen = [];
  const inArea = (a, x, y) => !!a && x >= a.x0 && x < a.x1 && y >= a.y0 && y < a.y1;
  function openExternal(url) {
    const { spawn } = require('node:child_process');
    // never through a shell: a link is the program's argument, whatever characters it carries
    const [cmd, args] = process.platform === 'win32' ? ['rundll32', ['url.dll,FileProtocolHandler', url]] : process.platform === 'darwin' ? ['open', [url]] : ['xdg-open', [url]];
    try { const c = spawn(cmd, args, { detached: true, stdio: 'ignore', windowsHide: true }); c.on('error', () => flash('could not open a browser for ' + url, 'bad', 8000)); c.unref(); } catch (_) { flash('could not open a browser for ' + url, 'bad', 8000); }
  }
  const openUrl = o.openUrl || openExternal;
  // a file an agent wrote, on the station's own page for it (signed, so the browser needs no key). Its folder is the run's:
  // the trusted project the live feed said it works in; from an older station, the one its record names once it ends (while
  // it runs, only a run this terminal started is known for sure)
  async function openFile(act) {
    const a = model.state.agents.get(act.agentId);
    if (!folderLib.isLocalHost(client.host)) return flash('a file opens only from a station on this computer');
    let tickets;
    try { tickets = require(require('node:path').join(__dirname, '..', '..', 'sidecar', 'apitickets.js')); } catch (_) { return flash('this starnet cannot sign a file link (the station’s ticket module is missing)', 'bad', 8000); }
    let project = typeof act.root === 'string' ? act.root : null;
    if (project === null) {
      const r = act.runId ? await get('/api/runs?agent=*&runId=' + encodeURIComponent(act.runId), 8000) : null;
      const rec = r && r.ok && r.status === 200 && r.json && Array.isArray(r.json.runs) ? r.json.runs.find(x => x && x.runId === act.runId) : null;
      const run = model.state.runs.get(String(act.runId));
      if (rec) project = String(rec.projectRoot || '');
      else if (run && a && (run.streamId === streamOf(a.id) || run.streamId.indexOf(core.cliStreamId(a.id)) === 0)) project = ui.project ? ui.project.root : '';
    }
    if (project === null) return flash('that run is still going — its file opens once the station has recorded where it worked', 'am', 7000);
    openUrl(mouse.fileUrl(client.base, tickets, client.token(), { agent: act.agentId, path: act.path, project, now: now() }));
    flash('opening ' + act.path + ' (' + (project ? folderLib.shortPath(project, 40) : (a ? a.name : act.agentId) + '’s workspace') + ') in your browser', 'ok', 6000);
  }
  function onMouse(ev) {
    if (stopped) return;
    if (ev.kind === 'wheel') {
      const d = ev.dir === 'up' ? 1 : -1;
      if (ui.picker) { const n = tui.pickerView(ui.picker).length; ui.picker.sel = Math.max(0, Math.min(n - 1, (ui.picker.sel | 0) - d)); return paint(); }
      if (!inArea(lastAreas.comms, ev.x, ev.y)) return;
      if (ui.overlay) ui.overlay.scroll = Math.max(0, (ui.overlay.scroll | 0) - 3 * d);
      else if (ui.page) ui.pageScroll = Math.max(0, (ui.pageScroll | 0) - 3 * d);
      else ui.scroll = Math.max(0, ui.scroll + 3 * d);
      return paint();
    }
    if (ev.kind !== 'down') return;
    const h = mouse.hitAt(lastHits, ev.x, ev.y);
    const act = h && h.act;
    ui.quitArmed = 0;
    // ctrl+click: a link drawn there, or the file a tool line names
    if (ev.ctrl && ev.button === 'left') {
      if (act && act.t === 'file') { openFile(act).catch(() => {}); return; }
      const url = mouse.urlAt(lastScreen[ev.y], ev.x, ch => tui.width(ch));
      if (url) { openUrl(url); flash('opening ' + url + ' in your browser', 'ok', 5000); }
      return;
    }
    if (ev.button === 'right') { if (act && act.t === 'agent') openMenu(act.id); return; }
    if (ev.button !== 'left') return;
    if (!act) {
      // a click anywhere off a list laid over COMMS closes it, as any key does
      if (ui.overlay) { ui.overlay = null; paint(); }
      return;
    }
    if (ui.overlay && act.t !== 'tab') { ui.overlay = null; paint(); return; }
    switch (act.t) {
      case 'tab': return act.here && act.page === 'comms' && ui.focus && !ui.overlay && !ui.picker ? openMenu(ui.focus) : openPage(act.page);
      case 'page': return openPage(act.page);
      case 'agent':
        // the agent already in COMMS (on COMMS): its menu; any other, its chat
        if (!ui.page && act.id === ui.focus && !ui.picker && !ui.wake) return openMenu(act.id);
        return ui.wake ? undefined : openChat(act.id);
      case 'needs': { const q = model.front(); if (q) openChat(q.agentId); return; }
      case 'model': return openModelPicker('');
      case 'menu': return menuKey(act.key);
      case 'key': if (!answerKey(act.key)) paint(); return;
      case 'answer': { const q = model.front(); if (q && q.question && q.question.options[act.i] != null) answerQuestion(q.question.options[act.i]); return; }
      case 'wake': if (ui.wake && ui.wake.ask && ui.wake.ask.options[act.i]) wakeAnswer(Object.assign({}, ui.wake.ask.options[act.i])); return;
      case 'enter': onKey('\r', { name: 'return', sequence: '\r' }); return;
      case 'pick': {
        const p = ui.picker, list = p ? tui.pickerView(p) : [];
        const it = list[act.i];
        if (it && p.onPick && !p.loading) { ui.picker = null; p.onPick(it); }
        return paint();
      }
      case 'flow': ui.page = ''; ui.input = '/flow run ' + (/\s/.test(act.name) ? act.name.split(/\s+/)[0] : act.name) + ' '; flash('type the job for ' + act.name + ' and press enter', 'ok', 6000); return;
      case 'file': return;   // a plain click on a file line: nothing (ctrl+click opens it)
    }
  }
  const mouseReader = mouse.makeReader(onMouse, () => onKey('\x1b', { name: 'escape', sequence: '\x1b' }));

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
    if (text) ui.page = '';   // what you send is answered in COMMS: the page gives way to it
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
    if (cmd === '/stat' || cmd === '/crew' || cmd === '/work' || cmd === '/comms') return openPage(cmd.slice(1));
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
    if (cmd === '/retry') { const last = ui.lastSent[ui.focus]; return last ? send(ui.focus, last.text, last.shown) : flash('nothing sent to ' + ((model.state.agents.get(ui.focus) || {}).name || 'this agent') + ' from here yet'); }
    if (cmd === '/status' || cmd === '/whoami') return showStatus();
    if (cmd === '/version') return showVersion();
    if (cmd === '/skills') return openSkillsPicker(parts.slice(1).join(' '));
    if (cmd === '/history') return openResumePicker();
    if (cmd === '/cron') return cronCommand(parts.slice(1).join(' '));
    // everything else is the station's: its own commands, the Commander's, each skill and recipe
    return stationCommand(text, cmd);
  }
  /* A slash command the station runs (POST /api/slash/dispatch, the same registry the app's "/" and the messaging channels
     use): a server command or one of the Commander's comes back as what the station said, shown in COMMS under the command;
     a skill or recipe comes back as the message that asks for it, sent to the agent (COMMS shows it as you typed it). A
     command only the app's own screen can do says so. */
  async function stationCommand(text, cmd) {
    const a = model.state.agents.get(ui.focus);
    const agentId = a ? a.id : 'agent';
    flash(cmd + ' …', 'dim', 60000);
    const r = await client.request('POST', '/api/slash/dispatch', { input: text, agentId, client: 'terminal' }, { timeoutMs: 60000 });
    ui.flash = null;
    const j = (r && r.json) || {};
    if (r.status === 404 && /unknown slash command/.test(String(j.error || ''))) return flash('unknown command ' + cmd + ' · /help lists them');
    if (!(r.ok && r.status === 200 && j.ok && j.directive)) return flash(cmd + ': ' + (j.error || r.error || 'HTTP ' + r.status), 'bad', 8000);
    const d = j.directive;
    if (d.type === 'say') {
      const lines = Array.isArray(d.lines) && d.lines.some(l => String(l || '').trim()) ? d.lines : String(d.text || '').split('\n');
      model.noteSaid(agentId, cmd, d.title, lines.filter(l => String(l).trim()), d.ok !== false, now());
      ui.scroll = 0; ui.overlay = null;
      return paint();
    }
    if (d.type === 'insert') {
      const body = String(d.text || ''), args = text.slice(text.split(/\s+/)[0].length).trim();
      // a skill needs the task; a recipe, any blank it still has ({topic})
      if (d.source === 'skill' ? !args : /\{[A-Za-z_][A-Za-z0-9_]*\}/.test(body)) return flash(cmd + ' needs what to do: ' + cmd + ' <task>', 'am', 6000);
      if (!a) return flash('no agent to talk to');
      return send(a.id, body, text);
    }
    flash(cmd + ' only works in the StarNet desktop app', 'am', 6000);
  }
  // /cron: the routines scheduler, as the app's /cron does it — on / off arms it, alone it says its real state (a read
  // that failed says the state is unknown, never "off, 0 jobs")
  async function cronCommand(args) {
    const raw = String(args || '').trim().toLowerCase();
    const agentId = ui.focus || 'agent';
    const say = (t, ok) => { model.noteSaid(agentId, '/cron', '', [t], ok !== false, now()); ui.scroll = 0; paint(); };
    const on = /^(on|enable|enabled|arm)$/.test(raw), off = /^(off|disable|disabled|disarm)$/.test(raw);
    if (on || off) {
      const r = await client.request('POST', '/api/cron/arm', { enabled: on }, { timeoutMs: 10000 });
      return say(r.ok && r.status === 200 && r.json ? 'Routines scheduler ' + (r.json.enabled ? 'enabled' : 'disabled') + '.' : 'Could not update the routines scheduler (' + (r.error || 'HTTP ' + r.status) + ').', r.ok && r.status === 200);
    }
    if (raw) return say('/cron takes on or off — /routine lists, adds, pauses and deletes routines.', false);
    const r = await get('/api/cron');
    if (!(r.ok && r.status === 200 && r.json)) return say('Could not read the routines scheduler (' + (r.error || 'HTTP ' + r.status) + ') — its real state is unknown.', false);
    const j = r.json, jobs = Array.isArray(j.jobs) ? j.jobs : [];
    const bits = jobs.slice(0, 5).map((job, i) => (i + 1) + '. ' + (job.name || job.id || 'routine') + (job.enabled === false ? ' [paused]' : ''));
    say('Routines: scheduler ' + (j.halted ? 'stopped (E-STOP)' : j.enabled ? 'on' : 'off') + ', ' + jobs.length + ' job' + (jobs.length === 1 ? '' : 's') +
      (bits.length ? ' - ' + bits.join(' | ') : '.') + (j.halted ? ' Use /cron on to resume.' : ' Use /cron on or /cron off to arm/disarm.'));
  }
  function showStatus() {
    const a = model.state.agents.get(ui.focus);
    if (!a) return flash('no agent on this station yet');
    const row = model.rows(now()).find(r => r.id === a.id);
    ui.overlay = {
      title: 'STATUS · ' + a.name,
      items: [
        ['agent', a.name + ' (' + a.id + ')' + (row ? ' · ' + row.status.text : '')],
        ['model', (a.provider ? a.provider + ' · ' : '') + (a.model || 'not set')],
        ['conversation', streamOf(a.id)],
        ['folder', ui.project ? ui.project.root : 'its own workspace (no trusted project here)'],
        ['station', ui.stationLabel],
        ['spend', costText(model.header(now()).cost)]
      ],
      foot: 'any key closes this'
    };
    paint();
  }
  async function showVersion() {
    const cli = require('./version.js').cliVersion(require('node:path').join(__dirname, '..', '..'));
    const r = await get('/api/version');
    const v = (r.ok && r.status === 200 && r.json) || {};
    ui.overlay = { title: 'VERSION', items: [['starnet', cli], ['station', v.harness ? 'harness ' + v.harness + (v.app ? ' · app ' + v.app : '') : 'did not say (' + (r.error || 'HTTP ' + r.status) + ')'], ['node', (v.node ? v.node + ' (station) · ' : '') + process.version + ' (here)']], foot: 'any key closes this' };
    paint();
  }
  // /skills: the agent's skills and recipes as the station lists them for it (its saved floor), picked into the prompt
  async function openSkillsPicker(filter) {
    const a = model.state.agents.get(ui.focus);
    if (!a) return flash('no agent on this station yet');
    const p = {
      kind: 'skills', title: 'SKILLS · ' + a.name, note: 'run one: /<skill> <task>', filter: String(filter || ''), sel: 0, items: [], loading: true,
      foot: '↑ ↓ pick · enter puts it in the prompt · esc close · type to filter',
      onPick: it => { ui.input = '/' + it.name + ' '; paint(); }
    };
    ui.picker = p; ui.overlay = null; paint();
    const r = await get('/api/slash/catalog?agent=' + encodeURIComponent(a.id) + '&client=terminal', 15000);
    const cmds = (r.ok && r.status === 200 && r.json && Array.isArray(r.json.commands)) ? r.json.commands : null;
    if (!cmds) p.error = 'the station did not list its skills (' + (r.error || 'HTTP ' + r.status) + ')';
    else {
      // your own commands, then the agent's skills, then the recipes everyone has
      const rank = { user: 0, skill: 1, recipe: 2 };
      p.items = cmds.filter(c => c && rank[c.source] != null).sort((x, y) => rank[x.source] - rank[y.source]).map(c => ({
        name: c.name, search: (c.name + ' ' + c.desc + ' ' + c.source).toLowerCase(),
        cols: [[padTo('/' + c.name, 24), 'ph'], [c.source === 'recipe' ? 'recipe  ' : c.source === 'user' ? 'yours   ' : 'skill   ', 'dim'], [c.desc || '', 'fg']]
      }));
      if (!p.items.length) p.error = a.name + ' has no skills ready · add them in the desktop app';
    }
    p.loading = false;
    paint();
  }
  // ---- THE AWAKENING: a station with no agent is onboarded here, the desktop app's own ceremony (bin/lib/awaken.js) -----
  // ui.wake = { log: [{ who, text, born, cps, full, you }], ask, stage: { title, detail }, speaker, feedKey, note, typing, ff }
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  async function waitOrSkip(ms) { const end = now() + ms; while (now() < end && ui.wake && !ui.wake.ff) await sleep(40); }
  const wakeIO = {
    stage: (title, detail) => { if (ui.wake) { ui.wake.stage = { title: String(title || ''), detail: String(detail || '') }; paint(); } },
    speaker: name => { if (ui.wake) ui.wake.speaker = String(name || 'STARNET'); },
    note: (text, style) => { if (ui.wake) { ui.wake.note = String(text || ''); ui.wake.noteStyle = style || 'dim'; paint(); } },
    feed: key => { if (ui.wake) { ui.wake.feedKey = key || null; paint(); } },
    roster: list => { model.setRoster({ agents: list }); ui.focus = 'agent'; if (ui.wake) ui.wake.crew = true; loadSkins().then(paint, () => {}); paint(); },
    // typed lines: each one appears at its pace (any key shows the rest of this beat at once)
    async say(segs, o) {
      const w = ui.wake; if (!w) return;
      const list = typeof segs === 'string' ? [{ text: segs, cps: 46, hold: 0 }] : (segs || []);
      const who = (o && o.who) || w.speaker;
      w.ff = false;
      for (let i = 0; i < list.length; i++) {
        if (!ui.wake) return;
        const s = list[i];
        const e = { who, text: String(s.text).replace(/^\s+/, ''), first: i === 0, born: now(), cps: s.cps || 44, full: false };
        w.log.push(e); w.typing = true; ui.scroll = 0;
        await waitOrSkip(Math.min(9000, e.text.length / e.cps * 1000));
        e.full = true;
        if (s.hold) await waitOrSkip(Math.min(900, s.hold));
      }
      if (ui.wake) ui.wake.typing = false;
      paint();
    },
    ask(spec) { return new Promise(resolve => { if (!ui.wake) return resolve({ value: '', skip: true }); ui.wake.ask = Object.assign({}, spec, { resolve }); ui.input = ''; paint(); }); },
    cancelAsk(ans) { const a = ui.wake && ui.wake.ask; if (!a) return; ui.wake.ask = null; a.resolve(ans); paint(); }
  };
  function wakeAnswer(ans) {
    const w = ui.wake, a = w && w.ask;
    if (!a) return;
    w.ask = null;
    w.log.push({ who: 'YOU', text: ans.custom ? String(ans.value) : String(ans.label || ''), full: true, you: true, skip: !!ans.skip });
    a.resolve(ans);
    paint();
  }
  // a key while the awakening runs; false = the ordinary prompt handles it (typing an answer, backspace, esc)
  function wakeKey(str, k) {
    const w = ui.wake;
    if (w.typing && !w.ask) { w.ff = true; return true; }
    if (!w.ask) return k.name === 'return' || k.name === 'enter' || k.name === 'tab';
    if (k.name === 'return' || k.name === 'enter') {
      const t = ui.input.trim();
      if (t) {
        if (w.ask.custom) { ui.input = ''; wakeAnswer({ value: t, custom: true }); }
        else flash('pick a number — 1 to ' + w.ask.options.length);
        return true;
      }
      if (w.ask.optional) { const sk = (w.ask.options || []).find(o => o.skip); wakeAnswer(sk ? Object.assign({}, sk) : { value: '', label: 'skip', skip: true }); }
      return true;
    }
    if (k.name === 'tab' || k.name === 'up' || k.name === 'down') return true;
    const ch = typeof str === 'string' ? str : '';
    if (!ui.input && /^[1-9]$/.test(ch) && w.ask.options[Number(ch) - 1]) { wakeAnswer(Object.assign({}, w.ask.options[Number(ch) - 1])); return true; }
    if (!ui.input && !w.ask.custom && ch && !/^[\x00-\x1f]$/.test(ch) && k.name !== 'backspace' && k.name !== 'escape' && k.name !== 'pageup' && k.name !== 'pagedown') { flash('pick a number — 1 to ' + w.ask.options.length); return true; }
    return false;
  }
  async function checkOnboarding() {
    const r = await get('/api/save?agent=agent', 15000);
    if (!(r.ok && r.status === 200 && r.json)) return false;
    const save = r.json.save || null;
    // an agent a headless run set up (`starnet -p` on an empty station) was never met by a person: it gets the full awakening
    const boot = !!(save && save.agent && save.agent.bootstrappedBy === 'starnet-cli' && save.agent.onboarded !== true);
    const a = boot ? null : save && save.agent;
    if (a && !((a.onboarded === undefined) ? !a.purpose : !a.onboarded)) return false;   // the app's own needsAwakening
    ui.wake = { log: [], ask: null, stage: { title: 'THE AWAKENING', detail: '' }, speaker: 'STARNET', feedKey: null, note: '', typing: false, ff: false };
    paint();
    // one setup at a time: the app open on this station is mid-setup itself, and a prior install's station is the app's to recover
    if (station.mode === 'attached' && station.workspace) {
      await wakeIO.say([{ text: 'the StarNet app is open on this station and its setup isn’t finished. finish creating your Overseer in the StarNet window — or quit the app and run starnet again to do it here.', cps: 60 }], { who: 'STARNET' });
      return true;
    }
    if (!a && !boot && r.json.lineage && r.json.lineage.priorInstallEvidence) {
      await wakeIO.say([{ text: 'this computer has a station from an earlier StarNet install. open the StarNet app to recover it before setting up a new one.', cps: 60 }], { who: 'STARNET' });
      return true;
    }
    let aw;
    try {
      aw = require('./awaken.js').makeAwakening({ st: require('./station-io.js').makeStationIO(client), io: wakeIO, mods: require('./app-modules.js').load(), env });
    } catch (e) {
      await wakeIO.say([{ text: 'the setup could not load the StarNet app’s files (' + ((e && e.message) || e) + '). open the StarNet app to set up this station.', cps: 80 }], { who: 'STARNET' });
      return true;
    }
    aw.run({ save, resume: !!a, privateStation: station.mode === 'spawned' }).then(async res => {
      const last = ui.wake && [...ui.wake.log].reverse().find(e => e.who !== 'YOU' && e.who !== 'STARNET');
      ui.wake = null;
      await loadRoster().catch(() => {});
      ui.focus = 'agent';
      if (last) model.noteAgentLine('agent', last.text, now());
      if (res && res.firstMove) ui.input = String(res.firstMove);
      loadSkins().then(paint, () => {});
      flash(((res && res.agent && res.agent.name) || 'your agent') + ' is awake — and it knows why.', 'ok', 7000);
    }, e => {
      if (!ui.wake) return;
      ui.wake.ask = null; ui.wake.typing = false;
      ui.wake.log.push({ who: 'STARNET', text: 'setup stopped: ' + ((e && e.message) || e) + '. press ctrl+c, then run starnet again to pick up from here.', full: true, bad: true });
      paint();
    });
    return true;
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
  const F_PAGES = { f1: 'stat', f2: 'crew', f3: 'comms', f4: 'work', f5: 'skills' };
  function onKey(str, key) {
    const k = key || {};
    if (mouseReader(str, k)) return;   // a mouse report, put back together from the keys Node split it into
    if (k.ctrl && k.name === 'c') return quit(false);
    if (k.ctrl && k.name === 'l') { redrawAll(); return; }
    ui.quitArmed = 0;
    if (F_PAGES[k.name] && !ui.pasting) return openPage(F_PAGES[k.name]);
    if (ui.picker) return pickerKey(str, k);
    // the agent menu: its letters act on it (with nothing typed), esc closes it, any other key closes it and goes on
    if (ui.agentMenu && !ui.pasting) {
      if (k.name === 'escape') return menuKey('escape');
      const ch = typeof str === 'string' ? str.toLowerCase() : '';
      const a = model.state.agents.get(ui.agentMenu);
      if (!ui.input && /^[omnh]$/.test(ch)) return menuKey(ch);
      if (!ui.input && ch === 's' && a && a.runs.size) return menuKey('s');
      ui.agentMenu = '';
    }
    if (k.name === 'escape') { ui.input = ''; ui.overlay = null; ui.scroll = 0; ui.page = ''; return paint(); }
    // a PASTE is text (bracketed paste, ESC[?2004h): its newlines stay in the message — nothing is sent or answered mid-paste
    if (k.name === 'paste-start') { ui.pasting = true; return; }
    if (k.name === 'paste-end') { ui.pasting = false; return paint(); }
    if (ui.pasting) {
      if (k.name === 'return' || k.name === 'enter') { if (ui.input.length < 20000) ui.input += '\n'; return schedulePaint(); }
      if (typeof str === 'string' && str) { const ch = str.replace(/[\x00-\x09\x0b-\x1f\x7f]/g, ''); if (ch && ui.input.length < 20000) ui.input += ch; }
      return schedulePaint();
    }
    if (ui.wake && wakeKey(str, k)) return paint();
    // tab / shift+tab: the agent shown in COMMS · ↑ ↓: your earlier messages (and back to what you were typing)
    if (k.name === 'tab') { focusStep(k.shift ? -1 : 1); return paint(); }
    if (k.name === 'up') { historyStep(-1); return paint(); }
    if (k.name === 'down') { historyStep(1); return paint(); }
    // pgup / pgdn scroll what is shown: a list laid over COMMS, the page, or the conversation
    if (k.name === 'pageup' || k.name === 'pagedown') {
      const d = k.name === 'pageup' ? 1 : -1;
      if (ui.overlay) ui.overlay.scroll = Math.max(0, (ui.overlay.scroll | 0) - 8 * d);
      else if (ui.page) ui.pageScroll = Math.max(0, (ui.pageScroll | 0) - 8 * d);
      else ui.scroll = Math.max(0, ui.scroll + 8 * d);
      return paint();
    }
    if (k.name === 'return' || k.name === 'enter') { const t = ui.input; ui.input = ''; submit(t); return paint(); }
    if (k.name === 'backspace') { ui.input = ui.input.slice(0, -1); return paint(); }
    if (k.sequence && /^\x1b\[[?\d;]*[ct]$/.test(k.sequence)) return;   // a late reply to the startup probe
    if (typeof str !== 'string' || !str || k.ctrl || k.meta || str.charCodeAt(0) === 27) return;
    const ch = str.replace(/[\x00-\x1f\x7f]/g, '');
    if (!ch) return;
    ui.overlay = null;
    const q = model.front();
    if (!ui.input && /^[ynva]$/i.test(ch) && answerKey(ch.toLowerCase())) return;
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
    const screen = tui.render(model, ui, size, t);
    lastHits = screen.hits || []; lastAreas = screen.areas || {}; lastScreen = screen;   // what a click lands on
    const av = screen.avatar;   // where the camera feed goes, when the card is up
    // every rendered row is padded to the full width, so no erase-to-end is needed (or wanted). A row beside the logo
    // image starts to its right, a row beside the feed is written either side of it: an image's cells are never
    // written over (that would erase it)
    const rows = screen.map((segs, y) => {
      if (y < skipRows) return '\x1b[' + (y + 1) + ';' + (skip + 1) + 'H' + tui.toAnsi(tui.sliceSegs(segs, skip), level);
      if (av && y >= av.y && y < av.y + av.rows) {
        return '\x1b[' + (y + 1) + ';1H' + tui.toAnsi(tui.sliceSegs(segs, 0, av.x), level) + '\x1b[0m' +
          '\x1b[' + (y + 1) + ';' + (av.x + av.cols + 1) + 'H' + tui.toAnsi(tui.sliceSegs(segs, av.x + av.cols), level);
      }
      return '\x1b[' + (y + 1) + ';1H' + tui.toAnsi(segs, level);
    });
    let s = '';
    for (let y = 0; y < rows.length; y++) if (prevRows[y] !== rows[y]) s += rows[y] + '\x1b[0m';
    if (image && !imageShown) { s += '\x1b[1;1H' + image.sixel; imageShown = true; }
    // the camera feed: drawn again only when what it shows (or where) changes; until the agent's sprites are in, the
    // card stays empty while they load
    if (av) {
      const pic = feed.frame(av.id, av.key, t, ui.still, { cellW: term.cellW, cellH: term.cellH, cols: av.cols, rows: av.rows });
      if (!pic) loadFeedAssets(av.id);
      const key = pic ? pic.key + '@' + av.x + ',' + av.y : '';
      if (pic && key !== avatarShown) { s += '\x1b[0m\x1b[' + (av.y + 1) + ';' + (av.x + 1) + 'H' + pic.sixel; avatarShown = key; }
    } else avatarShown = '';
    if (rows.length < prevRows.length) s += '\x1b[' + (rows.length + 1) + ';1H\x1b[J';
    prevRows = rows;
    if (s) try { out.write(s); } catch (_) {}
  }
  // the mouse, wherever the terminal reports it (STARNET_MOUSE=0 keeps the terminal's own selection; shift+drag selects
  // text while it is on, in most terminals)
  const mouseOn = env.STARNET_MOUSE !== '0';
  function enterScreen() {
    out.write('\x1b[?1049h\x1b[?25l\x1b[?2004h\x1b[2J\x1b[H' + (mouseOn ? mouse.ENABLE : ''));   // …and bracketed paste on, so a paste arrives marked
    readline.emitKeypressEvents(inp);
    if (inp.isTTY && typeof inp.setRawMode === 'function') inp.setRawMode(true);
    inp.on('keypress', onKey);
    inp.resume();
    out.on('resize', onResize);
  }
  function redrawAll() { prevRows = []; imageShown = false; avatarShown = ''; buildImage(); try { out.write('\x1b[2J'); } catch (_) {} paint(); }
  function onResize() { redrawAll(); }

  // ---- the real logo, as an image -----------------------------------------------------------------------------------
  let term = {}, image = null, imageShown = false, avatarShown = '';
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
  // the image fits three rows of this terminal's cells, the wordmark drawn at 80% within them, and leaves the crew bar at
  // least 44 columns beside it
  function buildImage() {
    image = null; ui.logoImage = null;
    // the camera feed at the foot of CREW is an image too: only where the terminal draws them
    ui.images = !!(term.sixel && term.cellW && term.cellH && ui.logo === 'full');
    if (!term.sixel || !term.cellW || !term.cellH || ui.logo !== 'full') return;
    const r = sixel.logoSixel({ cellW: term.cellW, cellH: term.cellH, rows: 3, scale: 0.8, maxCols: Math.max(0, (out.columns || 80) - 1 - 47) });
    if (r) { image = r; ui.logoImage = { cols: r.cols, rows: r.rows }; }
  }
  function leaveScreen() {
    try { inp.removeListener('keypress', onKey); } catch (_) {}
    try { out.removeListener('resize', onResize); } catch (_) {}
    try { if (inp.isTTY && typeof inp.setRawMode === 'function') inp.setRawMode(false); } catch (_) {}
    try { inp.pause(); } catch (_) {}
    try { out.write((mouseOn ? mouse.DISABLE : '') + '\x1b[0m\x1b[?25h\x1b[?2004l\x1b[?1049l'); } catch (_) {}
  }
  const onExit = () => { if (!stopped) leaveScreen(); };
  /* A SIGTERM (the desktop app's boot reaper on macOS, a `kill`, an update) or a SIGHUP kills node WITHOUT 'exit', so
     onExit never ran and the terminal stayed on the alternate screen with mouse reporting on. Give it back, then end
     with the signal's conventional code (128 + its number); starnet.js still stops a station it booted. */
  const SIGNALS = ['SIGTERM', 'SIGHUP'];
  const onSignal = sig => stop(128 + ((os.constants.signals && os.constants.signals[sig]) || 15));
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
    for (const s of SIGNALS) process.removeListener(s, onSignal);
    resolveExit(code || 0);
  }

  // ---- go ----------------------------------------------------------------------------------------------------
  (async () => {
    process.on('exit', onExit);
    for (const s of SIGNALS) process.on(s, onSignal);
    term = await probeTerminal(400);
    if (stopped) return;   // a signal during the probe: never take the screen back after giving it back
    buildImage();
    enterScreen();
    paint();
    const rt = await loadRoster();
    if (stopped) return;
    if (!(rt.ok && rt.status === 200)) {
      stop(core.EXIT.STATION);
      process.stderr.write('starnet: could not read the station roster (' + (rt.error || 'HTTP ' + rt.status) + ')\n');
      return;
    }
    await Promise.all([loadSnapshot(), loadBudget(), loadLines().catch(() => {}), locateFolder().catch(() => {})]);
    if (stopped) return;
    await loadHistory().catch(() => {});
    if (stopped) return;   // …and no feed or refresh timers armed after a stop
    loadSkins().then(paint, () => {});
    loadStats().then(paint, () => {});
    ui.focus = pickFocus() || ui.focus;
    connectFeed();
    paint();
    const every = (ms, fn) => { const t = setInterval(() => { Promise.resolve().then(fn).then(paint, () => {}); }, ms); timers.push(t); };
    every(3000, loadSnapshot);
    every(10000, loadBudget);
    every(6000, () => loadLines().catch(() => {}));
    every(20000, () => loadRoster().then(() => { if (ui.images && model.state.order.some(id => !feed.hasSkin(id))) return loadSkins(); }));
    every(60000, loadStats);   // the level the stat bar shows
    every(15000, () => (ui.page ? loadPage() : null));   // an open page keeps what it read off the station current
    timers.push(setInterval(paint, 100));   // the working spinner turns at 10 frames a second (paint writes only rows that changed)
    checkOnboarding().catch(() => {});   // a station with no agent yet: the awakening, here
  })().catch(e => { stop(0); process.stderr.write('starnet: ' + ((e && e.message) || e) + '\n'); });
  return exited;
}

module.exports = { runDashboard };
