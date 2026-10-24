'use strict';
/* node test/cli-agent-routes.e2e.test.js — the terminal's /yolo, /personality and /model routes (POST /api/agent/approval,
   /api/agent/personality, /api/agent/model) against a REAL sidecar (hermetic SidecarFixture: temp workspace + profile, no
   provider, zero spend). Locks the re-cut review's two approval-safety findings (review 10-24):
     A. a StarNet page that is connected but never answers (its save takes longer than the bridge's 6 s) gets NO second
        write from a snapshot taken before the wait: the route answers 409 "a page is open, nothing was changed", the
        page's newer roster stands, and an agent the page deleted in that window is not brought back with full access;
     B. /yolo off with no page open writes "ask" into the app's save too (the field the page hydrates and pushes back
        when it opens), so FULL ACCESS does not silently return; /yolo on stays roster-only (the app's own setting, the
        safer one, applies again when it opens). Part of test:http. */
const A = require('./_assert.js');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const sleep = ms => new Promise(r => setTimeout(r, ms));

// a StarNet page: the bus the page listens to (sse.size() > 1 while it is open); onCommand sees each station.command
function page(fixture, onCommand) {
  const req = http.request({ host: '127.0.0.1', port: fixture.port, path: '/api/channels/events', method: 'GET',
    headers: { Accept: 'text/event-stream', Origin: fixture.baseUrl, 'X-StarNet-Token': fixture.token } }, res => {
    res.setEncoding('utf8'); let buf = '';
    res.on('data', d => {
      buf += d; let i;
      while ((i = buf.indexOf('\n\n')) >= 0) {
        const b = buf.slice(0, i); buf = buf.slice(i + 2);
        const data = b.split('\n').filter(l => l.indexOf('data: ') === 0).map(l => l.slice(6)).join('\n');
        if (!data) continue;
        try { const j = JSON.parse(data); if (j && j.name === 'station.command') onCommand(j.payload || {}); } catch (_) {}
      }
    });
  });
  req.on('error', () => {}); req.end();
  return { close: () => { try { req.destroy(); } catch (_) {} } };
}
const row = (id, system, profile, extra) => Object.assign({ agentId: id, system, name: id.toUpperCase(), model: 'test/model', provider: 'openrouter', role: '', approvalMode: 'ask', executionProfile: profile, skills: [], reasoningEffort: null, track: '' }, extra || {});

(async () => {
  const fixture = SidecarFixture.create({ prefix: 'sk-cli-agent-routes-', env: { STARNET_REMOTE_RELAY: 'off', SKYNET_REMOTE_RELAY: 'off',
    // a key so /model's provider check passes (no request is ever made: the base is a closed port)
    SKYNET_OPENROUTER_KEY: 'sk-or-v1-routes-fake', STARNET_OPENROUTER_KEY: 'sk-or-v1-routes-fake', SKYNET_OPENROUTER_BASE: 'http://127.0.0.1:9/api/v1', STARNET_OPENROUTER_BASE: 'http://127.0.0.1:9/api/v1' } });
  try {
    await fixture.start();
    const rosterFile = path.join(fixture.workspace, 'agent.roster.json');
    const onDisk = id => { try { return (JSON.parse(fs.readFileSync(rosterFile, 'utf8')).agents || []).find(a => a.agentId === id) || null; } catch (_) { return null; } };
    const runtime = async id => ((await fixture.json('GET', '/api/runtime/agent')).body.agents || []).find(a => a.agentId === id) || null;
    const push = agents => fixture.json('POST', '/api/roster', { agents, updatedAt: Date.now() });

    /* ---- A1. a page pushes a newer roster for the agent in the window, then never acks ------------------------------ */
    {
      await push([row('agent', 'HERO', 'station-gear'), row('rook', 'ROOK-V1', 'trusted-project')]);
      let seen = 0;
      const p = page(fixture, () => {
        if (seen++) return;
        // the page applied it and its roster push lands (recomposed prompt; the Commander narrowed the reach meanwhile)
        push([row('agent', 'HERO', 'station-gear'), row('rook', 'ROOK-V2-NEWER', 'safe-cell', { approvalMode: 'full' })]);
        // …and its proveCrewSaved takes longer than the bridge's 6 s: no ack
      });
      await sleep(400);
      const y = await fixture.json('POST', '/api/agent/approval', { agentId: 'rook', mode: 'full' });
      p.close();
      A.eq(y.status, 409, 'a connected page that never answers: 409, no second write — ' + JSON.stringify(y.body));
      A.ok(y.body && y.body.pageOpen === true && y.body.via !== 'roster' && /page is open/.test(String(y.body.error)), 'it says a page IS open and nothing was changed here (never "no app is open")');
      const r = onDisk('rook');
      A.eq([r && r.system, r && r.executionProfile], ['ROOK-V2-NEWER', 'safe-cell'], 'the page\'s newer roster stands (the stale snapshot no longer overwrites it)');
    }

    /* ---- A2. the page deletes the agent in the window: it is not brought back ---------------------------------------- */
    {
      await push([row('agent', 'HERO', 'station-gear'), row('rook', 'ROOK', 'station-gear'), row('scout', 'SCOUT', 'this-computer')]);
      let seen = 0;
      const p = page(fixture, () => { if (!seen++) push([row('agent', 'HERO', 'station-gear'), row('rook', 'ROOK', 'station-gear')]); });
      await sleep(400);
      const y = await fixture.json('POST', '/api/agent/approval', { agentId: 'scout', mode: 'full' });
      p.close();
      A.eq(y.status, 409, 'deleted in the window: 409');
      A.eq([onDisk('scout'), await runtime('scout')], [null, null], 'and the deleted agent stays deleted (not resurrected with full access)');
    }

    /* ---- A3. /personality and /model: the same rule ------------------------------------------------------------------ */
    {
      await push([row('agent', 'HERO', 'station-gear'), row('rook', 'ROOK-P1', 'station-gear')]);
      let seen = 0;
      const p = page(fixture, () => { if (!seen++) push([row('agent', 'HERO', 'station-gear'), row('rook', 'ROOK-P2-NEWER', 'station-gear')]); });
      await sleep(400);
      const pr = await fixture.json('POST', '/api/agent/personality', { agentId: 'rook', personality: 'blunt', system: 'ROOK-FROM-THE-TERMINAL' });
      p.close();
      A.eq(pr.status, 409, '/personality with a page that never answers: 409');
      A.eq(onDisk('rook') && onDisk('rook').system, 'ROOK-P2-NEWER', 'and the page\'s newer prompt stands');
      const p2 = page(fixture, () => {});
      await sleep(400);
      const mr = await fixture.json('POST', '/api/agent/model', { agentId: 'rook', model: 'test/other', provider: 'openrouter' });
      p2.close();
      A.ok(mr.status === 409 && mr.body && mr.body.pageOpen === true, '/model with a page that never answers: 409, a page is open: ' + mr.status + ' ' + JSON.stringify(mr.body));
      A.eq(onDisk('rook') && onDisk('rook').model, 'test/model', 'and the roster keeps its model');
    }
    await sleep(300);   // the pages' SSE sockets close

    /* ---- B. /yolo off with no page: durable where the app reads it back ---------------------------------------------- */
    {
      await push([row('agent', 'HERO', 'station-gear'), row('rook', 'ROOK', 'station-gear', { approvalMode: 'full' })]);
      // the app's save (what it hydrates its crew from when it opens): rook on FULL ACCESS
      const cur = await fixture.json('GET', '/api/save?agent=agent');
      const rev = Number(cur.body && cur.body.save && cur.body.save._saveRevision) || 0;
      const t0 = Date.now();
      const saved = await fixture.json('POST', '/api/save', { schema: 'starnet.save', version: 6, _saveRevision: rev, updatedAt: t0, agent: { id: 'agent', name: 'HERO', createdAt: 1, approvalMode: 'ask' },
        agents: [{ id: 'rook', name: 'ROOK', approvalMode: 'full', executionProfile: 'station-gear' }] });
      A.ok(saved.body && saved.body.ok === true, 'the app\'s save landed: ' + JSON.stringify(saved.body));
      const off = await fixture.json('POST', '/api/agent/approval', { agentId: 'rook', mode: 'ask' });
      A.eq([off.status, off.body && off.body.via, off.body && off.body.save], [200, 'roster', 'patched'], '/yolo off with no page: the roster AND the app\'s save take it — ' + JSON.stringify(off.body));
      const after = (await fixture.json('GET', '/api/save?agent=agent')).body.save || {};
      const savedRook = (after.agents || []).find(a => a && a.id === 'rook') || {};
      A.eq(savedRook.approvalMode, 'ask', 'the app\'s save now says ask first for rook');
      A.ok(Number(after.updatedAt) > t0 && Number(after._saveRevision) > rev, 'on a newer copy the app adopts when it opens (updatedAt and revision moved)');
      A.eq([after.agent && after.agent.name, savedRook.name, savedRook.executionProfile], ['HERO', 'ROOK', 'station-gear'], 'nothing else in the save changed');
      A.eq((await runtime('rook')).approvalMode, 'ask', 'the station holds rook to ask first');
      await fixture.restart();
      A.eq((await runtime('rook')).approvalMode, 'ask', 'and still after a restart');
      const again = await fixture.json('POST', '/api/agent/approval', { agentId: 'rook', mode: 'ask' });
      A.eq(again.body && again.body.save, 'agrees', 'a second /yolo off finds the save already agrees (no write)');
      // /yolo on stays roster-only: the app's own (safer) saved setting applies again when it opens
      const on = await fixture.json('POST', '/api/agent/approval', { agentId: 'rook', mode: 'full' });
      A.eq([on.status, on.body && on.body.via, on.body && on.body.save], [200, 'roster', undefined], '/yolo on with no page: roster only');
      const after2 = (await fixture.json('GET', '/api/save?agent=agent')).body.save || {};
      A.eq(((after2.agents || []).find(a => a && a.id === 'rook') || {}).approvalMode, 'ask', 'and the save is left as the app last saved it');
      // an agent the save does not hold: the roster is the whole truth
      await push([row('agent', 'HERO', 'station-gear'), row('rook', 'ROOK', 'station-gear', { approvalMode: 'full' }), row('nova', 'NOVA', 'station-gear', { approvalMode: 'full' })]);
      const nova = await fixture.json('POST', '/api/agent/approval', { agentId: 'nova', mode: 'ask' });
      A.eq([nova.status, nova.body && nova.body.save, (await runtime('nova')).approvalMode], [200, 'none', 'ask'], 'an agent with no row in the save: roster only, said as such');
    }
  } catch (e) {
    A.ok(false, 'cli-agent-routes e2e threw: ' + ((e && e.stack) || e));
  } finally {
    await fixture.dispose();
  }
  A.report('cli-agent-routes.e2e.test');
})();
