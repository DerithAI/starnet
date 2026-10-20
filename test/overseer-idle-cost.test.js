'use strict';
/* node test/overseer-idle-cost.test.js — THE IDLE OVERSEER READS NO SAVE (idle-cpu piece 2, 2026-10-19).
   The 2 s tick and GET /api/halt read `paused` and `reviews` through snapshot(), which also built every thread from a full
   parse of the page's save: two parses a tick (~20 ms at a real 3.8 MB station, ~86k parses a day) and two per /api/halt
   poll. GENUINE: sidecar/overseer.js's in-memory accessors answer what snapshot() would, with no save read.
   SOURCE-LOCKED: the tick and haltStatus() call no snapshot(). Never requires sidecar/index.js (it boots a sidecar). */
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeOverseer } = require('../sidecar/overseer.js');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-overseer-idle-'));
const clone = v => JSON.parse(JSON.stringify(v));
const page = { generalId: 'home', workstreams: [{ id: 'home', title: null, agentId: 'agent' }, { id: 'side', title: 'Side work', agentId: 'agent' }], deletedIds: [] };
let clock = 1000;
const worker = (id, o) => Object.assign({ id, runId: id + '_run', leadId: 'agent', agentId: 'researcher', parentStreamId: 'home', parentRunId: 'lead1',
  streamId: 'thread_' + id, status: 'done', completedAt: clock, generation: 1 }, o || {});

try {
  // ── (a) the accessors read no save, and say exactly what snapshot() says ──
  {
    let loads = 0;
    const m = makeOverseer({ fs, path, file: path.join(root, 'a.json'), now: () => clock,
      newId: (() => { let n = 0; return () => 'thread_' + (++n); })(), sessions: () => { loads++; return clone(page); },
      hasAgent: id => ['agent', 'researcher'].includes(id) });
    m.create({ title: 'Research', parentStreamId: 'home', agentId: 'researcher', worker: true, requestId: 'lead1:0:1' });
    m.collect([worker('w1')]);
    A.eq(m.reviews().length, 1, 'fixture: one settled worker filed one report');
    const id = m.reviews()[0].id;
    const agree = label => {
      const s = m.snapshot();
      A.eq(m.paused(), s.paused, label + ': paused() === snapshot().paused');
      A.eq(m.reviews(), s.reviews, label + ': reviews() === snapshot().reviews');
      A.eq(m.review(id), s.reviews.find(r => r.id === id) || null, label + ': review(id) === that snapshot row');
      A.eq(m.error(), s.error || '', label + ': error() === snapshot().error || \'\'');
    };
    agree('normal');
    loads = 0;
    for (let i = 0; i < 50; i++) { m.paused(); m.reviews(); m.review(id); m.error(); }
    A.eq(loads, 0, 'fifty rounds of paused()/reviews()/review()/error() load the page\'s save zero times');
    A.eq(m.review('nope'), null, 'an unknown review id is null');
    // a caller can never edit the overseer's own rows through what it was handed
    m.reviews()[0].status = 'tampered'; m.review(id).status = 'tampered';
    A.eq(m.review(id).status, 'pending', 'reviews() and review() hand out copies');
    m.stopReviews([]);
    agree('after stopReviews()');
    A.eq([m.paused(), m.review(id).status], [true, 'cancelled'], 'E-STOP pauses and cancels, read from RAM');
    loads = 0; m.paused(); m.reviews(); m.review(id); m.error();
    A.eq(loads, 0, 'still no save read after the E-STOP');
    m.resumeReviews();
    agree('after resumeReviews()');
  }
  {
    const corrupt = path.join(root, 'corrupt.json');
    fs.writeFileSync(corrupt, '{broken');
    let loads = 0;
    const m = makeOverseer({ fs, path, file: corrupt, now: () => clock, newId: () => 'x', sessions: () => { loads++; return clone(page); }, hasAgent: () => true });
    A.eq([m.paused(), m.reviews(), m.review('any'), /unavailable/.test(m.error())], [true, [], null, true], 'a damaged overseer.json reads paused, no reviews, its error');
    A.eq([m.paused(), m.reviews(), m.error()], [m.snapshot().paused, m.snapshot().reviews, m.snapshot().error || ''], 'exactly what snapshot() says for it');
    A.eq(loads, 0, 'and reads no save for any of it');
  }

  // ── (b) source pins: the tick and the halt picture read the accessors, never snapshot() ──
  {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    const tick = A.fnBody(idx, 'async function tickOverseer');
    const halt = A.fnBody(idx, 'function haltStatus');
    A.ok(tick.length > 1000 && tick.length < 20000, 'tickOverseer located (' + tick.length + ' chars)');
    A.ok(halt.length > 100 && halt.length < 2000, 'haltStatus located (' + halt.length + ' chars)');
    A.ok(!tick.includes('overseer.snapshot('), 'the 2 s tick never builds a snapshot (each one parsed the whole save)');
    A.ok(!halt.includes('overseer.snapshot('), 'GET /api/halt never builds a snapshot');
    A.ok(/overseer\.paused\(\)/.test(tick) && /for \(let review of overseer\.reviews\(\)\)/.test(tick), 'the tick reads paused() and reviews()');
    A.ok(halt.includes('overseer: { halted: overseer.paused(), error: overseer.error() }'), 'haltStatus reads paused() and error() (same keys, same values)');
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
A.report('overseer-idle-cost');
