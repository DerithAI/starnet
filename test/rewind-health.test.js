/* node test/rewind-health.test.js — the RESTORE lane never implies an undo point that was not saved.

   The lane's own paragraph promises a restore point before every command, and a snapshot is fail-open: when one
   cannot be saved (a killed checkpoint Git command's stale lock refused every later add for that agent — the P1 the
   GH#107 lane found) the run goes on with no undo point, and the list used to look exactly like a working one.
   GET /api/checkpoint now carries the store's health record (the LAST automatic attempt this boot); the lane shows
   a failing net in the alarm line, a recovered one's missed point as a dim line, and nothing when health is unknown
   or clean. Driven in a vm against stub StationUI/Harness, the real windows/rewind.js. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const SRC = path.join(__dirname, '..', 'frontend', 'app', 'windows', 'rewind.js');

function element() { return { innerHTML: '', className: '', textContent: '', listeners: {}, addEventListener(t, fn) { this.listeners[t] = fn; } }; }
async function render(body) {
  const els = { '#rw-list': element(), '#rw-msg': element(), '#rw-refresh': element() };
  const host = { querySelector: sel => els[sel] || null };
  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, Promise, JSON, Date, encodeURIComponent,
    window: {},
    StationUI: { h: { esc, sfx: () => {}, notify: () => {}, fmtRel: iso => 'REL[' + iso + ']', present: [{ id: 'nova', name: 'NOVA' }], sel: 0 } },
    Harness: { api: { get: async url => { ctx.lastUrl = url; return body; }, post: async () => ({ j: { ok: true } }) } } });
  vm.runInContext(fs.readFileSync(SRC, 'utf8'), ctx, { filename: 'rewind.js' });
  const lane = ctx.window.DossierLanes[0](host);
  const sec = element(); lane.sections[0].build(sec);
  lane.wire();
  for (let i = 0; i < 5; i++) await new Promise(r => setImmediate(r));
  return { list: els['#rw-list'].innerHTML, about: sec.innerHTML, url: ctx.lastUrl };
}
const iso = ms => new Date(ms).toISOString();
const snap = (id, ts) => ({ id: id.repeat(40).slice(0, 40), ts, label: 'shell.exec', turn: 1, files: 3 });

(async () => {
  const t0 = 1792000000000;
  const snapshots = [snap('a', t0), snap('b', t0 + 60000)];

  // unknown (nothing attempted this boot) and clean: no claim either way, rows render as before
  let r = await render({ enabled: true, snapshots, health: null });
  A.eq(r.url, '/api/checkpoint?agent=nova', 'the lane reads the selected agent\'s checkpoints');
  A.ok(!/rw-health/.test(r.list) && (r.list.match(/class="mc-row"/g) || []).length === 2, 'no health yet: no note, both rows render');
  r = await render({ enabled: true, snapshots, health: { ok: true, at: t0 + 60000, since: null, failures: 0, lastFailure: null } });
  A.ok(!/rw-health/.test(r.list), 'a clean net shows no note');
  r = await render({ enabled: true, snapshots });
  A.ok(!/rw-health/.test(r.list), 'a backend that reports no health (remote) shows no note');

  // failing (the agent workspace): the alarm line names the root, the failure and what is NOT protected, above the rows
  const reason = "Git add failed (exit 128): Unable to create '<checkpoint repo>/index.lock': File exists.";
  const wsRoot = (ok, at, since, failures, lastFailure) => ({ kind: 'workspace', workTree: '', scopeId: '', ok, at, since, failures, lastFailure });
  const wsFail = { at: t0 + 120000, reason, kind: 'workspace', workTree: '', scopeId: '' };
  const failing = { ok: false, at: t0 + 120000, since: t0 + 90000, failures: 2, lastFailure: wsFail,
    roots: [wsRoot(false, t0 + 120000, t0 + 90000, 2, wsFail)] };
  r = await render({ enabled: true, snapshots, health: failing });
  A.ok(/id="rw-health" data-state="failing"/.test(r.list) && /class="mc-detail"/.test(r.list), 'a failing net renders the alarm line');
  A.ok(/RESTORE POINTS ARE NOT SAVING/.test(r.list), 'it says plainly that restore points are not saving');
  A.ok(/<b>AGENT WORKSPACE<\/b> · NOVA&#39;s agent workspace/.test(r.list.slice(0, r.list.indexOf('mc-row'))), 'it names the root that is not saving, as the rows do');
  A.ok(r.list.indexOf('REL[' + iso(t0 + 120000) + ']') >= 0, 'it says when the last attempt failed');
  A.ok(r.list.indexOf('&lt;checkpoint repo&gt;/index.lock') >= 0 && r.list.indexOf('<checkpoint repo>') < 0, 'the reason is shown, HTML-escaped');
  A.ok(r.list.indexOf('Nothing done in this root since its newest restore point (REL[' + iso(t0 + 60000) + ']) has a point of its own') >= 0,
    'it says what is unprotected: everything since the newest real point has no point of its own');
  A.ok(/a restore here may be refused until one saves, because the current state is saved first\./.test(r.list), 'it warns that a restore of this root may be refused while saving fails');
  A.ok(!/cannot be rolled back/.test(r.list), 'it never claims the changes since that point cannot be rolled back (restoring that point does roll them back)');
  A.ok(r.list.indexOf('rw-health') < r.list.indexOf('mc-row'), 'the note sits above the restore points');
  A.eq((r.list.match(/data-act="restore"/g) || []).length, 2, 'the real restore points stay listed');

  // per ROOT: a project root that keeps failing while the agent workspace saves fine is still an alarm, about THAT root
  const app = '/work/app', appScope = 'c'.repeat(24);
  const appSnap = Object.assign(snap('c', t0 + 30000), { scopeId: appScope, workTree: app, id: appScope + ':' + 'c'.repeat(40) });
  const appFail = { at: t0 + 150000, reason: 'Git add failed (exit 128): open("main.js"): Permission denied', kind: 'project', workTree: app, scopeId: appScope };
  const appRoot = { kind: 'project', workTree: app, scopeId: appScope, ok: false, at: t0 + 150000, since: t0 + 100000, failures: 3, lastFailure: appFail };
  const mixed = { ok: false, at: t0 + 160000, since: t0 + 100000, failures: 3, lastFailure: appFail,
    roots: [wsRoot(true, t0 + 160000, null, 0, null), appRoot] };
  r = await render({ enabled: true, snapshots: snapshots.concat([appSnap]).sort((x, y) => x.ts - y.ts), health: mixed });
  const alarm = r.list.slice(0, r.list.indexOf('mc-row'));
  A.ok(/data-state="failing"/.test(alarm) && /RESTORE POINTS ARE NOT SAVING/.test(alarm), 'a dead project root keeps the alarm while the workspace saves');
  A.ok(alarm.indexOf('<b>PROJECT ROOT</b> · /work/app') >= 0 && !/AGENT WORKSPACE/.test(alarm), 'the alarm names the project root, not the healthy workspace');
  A.ok(alarm.indexOf('its newest restore point (REL[' + iso(t0 + 30000) + '])') >= 0 && alarm.indexOf(iso(t0 + 60000)) < 0, "the newest point named is that root's own, not the workspace's newer one");
  A.ok(/Permission denied/.test(alarm), "with that root's own reason");

  // both roots failing: both are named
  r = await render({ enabled: true, snapshots, health: { ok: false, at: t0 + 160000, since: t0 + 90000, failures: 5, lastFailure: appFail,
    roots: [wsRoot(false, t0 + 160000, t0 + 90000, 2, wsFail), appRoot] } });
  const both = r.list.slice(0, r.list.indexOf('mc-row'));
  A.ok(/<b>AGENT WORKSPACE<\/b>/.test(both) && /<b>PROJECT ROOT<\/b>/.test(both) && (both.match(/RESTORE POINTS ARE NOT SAVING/g) || []).length === 1, 'two failing roots: one alarm naming both');
  A.ok(/PROJECT ROOT<\/b> · \/work\/app · last attempt \(REL\[[^\]]+\]\): [^<]*Permission denied\. It has no restore point yet, so nothing done there can be rolled back until one saves\./.test(both),
    'a failing root with no restore point of its own says nothing there can be rolled back: ' + both);

  // failing with no restore point at all: the warning AND the honest empty state
  r = await render({ enabled: true, snapshots: [], health: failing });
  A.ok(/data-state="failing"/.test(r.list) && /It has no restore point yet, so nothing done there can be rolled back/.test(r.list) && /NO RESTORE POINTS YET/.test(r.list), 'no points + failing: the warning says nothing can be undone, plus the empty state');

  // recovered after a miss: a dim line naming the root of that miss, never the alarm
  const missed = { at: t0 + 120000, reason: 'Git add timed out', kind: 'project', workTree: app, scopeId: appScope };
  r = await render({ enabled: true, snapshots, health: { ok: true, at: t0 + 180000, since: null, failures: 1, lastFailure: missed,
    roots: [wsRoot(true, t0 + 180000, null, 0, null), Object.assign({}, appRoot, { ok: true, since: null, failures: 1, lastFailure: missed })] } });
  A.ok(/id="rw-health" data-state="missed"/.test(r.list) && !/NOT SAVING/.test(r.list), 'a recovered net shows the missed point, not the alarm');
  A.ok(/Git add timed out/.test(r.list) && /no restore point of its own/.test(r.list), 'it says which change has no restore point of its own');
  A.ok(r.list.indexOf('for <b>PROJECT ROOT</b> · /work/app (REL[' + iso(t0 + 120000) + '])') >= 0, 'and in which root');

  // a health record without roots (an older or partial backend) still renders from its top-level fields
  r = await render({ enabled: true, snapshots, health: { ok: false, at: t0 + 120000, since: t0 + 90000, failures: 2, lastFailure: { at: t0 + 120000, reason: 'Git add timed out' } } });
  A.ok(/data-state="failing"/.test(r.list) && /Git add timed out/.test(r.list) && /<b>AGENT WORKSPACE<\/b>/.test(r.list.slice(0, r.list.indexOf('mc-row'))), 'no roots array: one alarm from the top-level failure');

  A.report('rewind-health.test');
})().catch(e => { console.error(e); process.exitCode = 1; });
