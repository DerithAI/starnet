/* node test/internal-run-not-working.test.js — an INTERNAL run is never the agent working for the Commander.

   The escape (live walk 10-13, shots/a5-01-after-reload.png): after a page reload NOVA's crew card read WORKING
   with a RUN clock over the desk while the only live run on the station was the harness's own self-talk (a
   session-recommendations pass). The sidecar's /api/state/snapshot DOES mark those rows `internal: true`, and
   live, the bus never lights them (an internal run's run.start/run.end are suppressed) — but the snapshot
   reconcile copied every row into the world's live-run refcount, so a reload (or the 30s poll) lit the agent
   for work nobody asked it to do. The CREW card, the world RUN clock and the desk window all read that refcount
   (stationui agentLive -> World.agentRunsLive), so the fix lives where the snapshot is read.

   Laws under test:
     • world.js normalizeSnapshot never turns an internal row into an active run (behavioral, the real function);
     • a real run of the same agent beside it still counts (the filter is per row, never per agent);
     • the desk window's server-live list leaves internal rows out too (deskscreen._liveRowsFor). */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const worldSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'world.js'), 'utf8');
const normalizeSnapshot = Function(A.fnBody(worldSrc, 'function normalizeSnapshot(') + '\nreturn normalizeSnapshot;')();

// ---- world: an internal row alone lights nothing ----
{
  const out = normalizeSnapshot({ ts: 10000, runs: [{ runId: 'rec-1', agentId: 'agent', startedAt: 9000, source: 'interactive', internal: true }], prompts: [] });
  A.ok(Array.isArray(out.activeRuns), 'the normalized snapshot still carries an activeRuns list (an empty list is what clears a stale clock)');
  A.eq(out.activeRuns.length, 0, 'an internal (self-talk) run is not an active run of the agent');
}

// ---- world: a real run beside it still counts, and only it ----
{
  const out = normalizeSnapshot({ ts: 10000, runs: [
    { runId: 'rec-1', agentId: 'agent', startedAt: 9000, source: 'interactive', internal: true },
    { runId: 'work-1', agentId: 'agent', startedAt: 8000, source: 'interactive' },
    { runId: 'copy-1', agentId: 'copywriter', startedAt: 9500, source: 'subagent' }
  ] });
  A.eq(out.activeRuns.map(r => r.runId).join(','), 'work-1,copy-1', 'real runs stay live; only the internal row is dropped');
  A.eq(out.activeRuns[0].startedMsAgo, 2000, 'the real run keeps its server start (RUN clock reads the truth)');
}

// ---- desk window: the server-live list never shows self-talk as the agent's job ----
{
  const D = require('../frontend/app/deskscreen.js');
  A.ok(typeof D._liveRowsFor === 'function', 'deskscreen exposes the pure server-live row filter');
  const rows = D._liveRowsFor([
    { runId: 'rec-1', agentId: 'agent', internal: true },
    { runId: 'work-1', agentId: 'agent' },
    { runId: 'copy-1', agentId: 'copywriter' }
  ], 'agent');
  A.eq(rows.map(r => r.runId).join(','), 'work-1', 'the desk lists only this agent\'s real live runs');
  A.eq(D._liveRowsFor(null, 'agent'), null, 'an unreadable snapshot stays unknown (null), never an empty "proven idle" list');
}

A.report('internal-run-not-working.test');
