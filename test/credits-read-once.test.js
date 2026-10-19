/* node test/credits-read-once.test.js — SETTINGS reads the credits account ONCE, not once per repaint
   (frontend/app/stationui.js; live walk 10-14: opening SETTINGS › SPENDING LIMITS fired /api/credits 12 times in
   1.5 s, every one a 404 — each pane repaint re-ran both the provider-card read and the STORE read).
   A settled answer is reused for a while; a 404 is the station's definitive "no cloud account linked" and is kept
   longer; an outage is never kept (RETRY must really retry); and anything that can change the answer (LINK, UNLINK,
   RETRY, REFRESH, the STORE key) reads afresh. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const ui = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationui.js'), 'utf8');
const readFn = A.fnBody(ui, 'function creditsRead(url, opts)');
const forgetFn = A.fnBody(ui, 'function forgetCreditsReads()');
A.ok(readFn && forgetFn && readFn.length < 4000, 'the shared credits read exists');

let now = 1.8e12;
const calls = [];
let answer = () => Promise.reject(new Error('http 404 not found'));
let epoch = 0;   // Harness.creditsEpoch(): moves on every account change anywhere (Harness.refreshCreditsConfigured)
const Harness = { api: { get: (url) => { calls.push(url); return answer(url); } }, creditsEpoch: () => epoch };
const consts = (/const CREDITS_FRESH_MS = [^;]+;/.exec(ui) || [''])[0] + '\n' + (/const CREDITS_UNLINKED_MS = [^;]+;/.exec(ui) || [''])[0];
const api = new Function('Harness', 'Date', consts + '\nconst _creditsReads = new Map();\n' + readFn + '\n' + forgetFn + '\nreturn { creditsRead, forgetCreditsReads };')(Harness, { now: () => now });

(async () => {
  const settle = p => p.then(v => ({ ok: v }), e => ({ err: String(e && e.message) }));
  // a SETTINGS open = both reads fire, then repaints re-ask
  const a = await Promise.all([settle(api.creditsRead('/api/credits?history=0')), settle(api.creditsRead('/api/credits'))]);
  A.ok(/404/.test(a[0].err) && /404/.test(a[1].err), 'a station with no cloud account answers 404 (the answer is passed through untouched)');
  A.eq(calls.length, 2, 'the first open reads each once');
  for (let i = 0; i < 6; i++) { await settle(api.creditsRead('/api/credits?history=0')); await settle(api.creditsRead('/api/credits')); now += 200; }
  A.eq(calls.length, 2, 'six more repaints in ~1.5 s cost zero requests');
  now += 5 * 60000;
  await settle(api.creditsRead('/api/credits'));
  A.eq(calls.length, 2, '"no account linked" holds for minutes — it changes only when the Commander links');
  api.forgetCreditsReads();
  await settle(api.creditsRead('/api/credits'));
  A.eq(calls.length, 3, 'LINK / UNLINK / RETRY / REFRESH forget it and read afresh');
  // an account change OUTSIDE the STORE (review 10-14: the connect screen's link/switch flows in app.js) — every path
  // that links or unlinks ends in Harness.refreshCreditsConfigured, which moves the epoch; a kept answer from before
  // it is never served again ("Link this station…" must not outlive the link by ten minutes)
  now += 1000; await settle(api.creditsRead('/api/credits'));
  A.eq(calls.length, 3, '(still held before the change)');
  epoch++;
  await settle(api.creditsRead('/api/credits'));
  A.eq(calls.length, 4, 'an account change anywhere reads afresh');
  await settle(api.creditsRead('/api/credits'));
  A.eq(calls.length, 4, '…and that fresh answer is held again');
  {
    const hs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'harness.js'), 'utf8');
    const refresh = A.fnBody(hs, 'async function refreshCreditsConfigured()');
    A.ok(/creditsEpoch\+\+/.test(refresh), 'Harness.refreshCreditsConfigured moves the credits epoch');
    A.ok(/creditsEpoch:\s*\(\)\s*=>\s*creditsEpoch/.test(hs), 'Harness exposes it');
  }

  // concurrent callers share one request in flight
  answer = () => new Promise(r => setTimeout(() => r({ configured: true, balanceUsd: 3 }), 5));
  api.forgetCreditsReads(); calls.length = 0;
  const both = await Promise.all([api.creditsRead('/api/credits'), api.creditsRead('/api/credits')]);
  A.ok(calls.length === 1 && both[0].balanceUsd === 3 && both[1] === both[0], 'two repaints while a read is in flight share it');
  now += 10000; await api.creditsRead('/api/credits');
  A.eq(calls.length, 1, 'a fresh linked answer is reused for a short while');
  now += 61000; await api.creditsRead('/api/credits');
  A.eq(calls.length, 2, '…then read again, so a balance never goes stale on screen');

  // an outage is never kept: RETRY must really retry
  answer = () => Promise.reject(new Error('timeout after 20000ms'));
  api.forgetCreditsReads(); calls.length = 0;
  await settle(api.creditsRead('/api/credits'));
  await settle(api.creditsRead('/api/credits'));
  A.eq(calls.length, 2, 'a failed read (not a 404) is not cached — the next ask tries again');

  // the panel itself goes through the shared read
  const prov = A.fnBody(ui, 'function refreshCreditsProvider()'), store = A.fnBody(ui, 'function wireCredits(body)');
  A.ok(/creditsRead\('\/api\/credits\?history=0'/.test(prov) && /creditsRead\('\/api\/credits\/linkable'/.test(prov), 'the provider card reads through the shared read');
  A.ok(/creditsRead\('\/api\/credits'/.test(store) && /creditsRead\('\/api\/credits\/linkable'/.test(store), 'the STORE reads through the shared read');
  A.ok(!/Harness\.api\.get\('\/api\/credits/.test(prov + store), 'neither re-asks the station directly on every repaint');
  A.report('credits-read-once');
})().catch(e => { console.error(e); process.exit(1); });
