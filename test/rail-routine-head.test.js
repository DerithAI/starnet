'use strict';
/* node test/rail-routine-head.test.js — a routine's ONE row on the rail is its NEWEST run (delta review 10-15).

   A routine is one row (Andrew 10-15): its newest run carries the "N runs" key, and its older runs list under it, set in,
   while the history is open. renderRail took the group's FIRST visible run as that head — but Workstreams.list sorts
   pinned rows first, so a pinned OLDER run came first: it took the head and the key, and the newest run was drawn set in
   under it as "older". The head is now the run with the latest activity; the rest are the older runs.

   Real Workstreams order + railGroups projection, then the rail's own railRunRows (fnBody) and renderRail's wiring of it. */
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const W = require('../frontend/app/workstreams');

const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
const helper = A.fnBody(app, 'function railRunRows(visible)');
A.ok(helper.length > 40 && helper.length < 1500, 'app.js has one bounded railRunRows(visible)');
const railRunRows = helper ? new Function(helper + '\nreturn railRunRows;')() : (visible => visible);

const run = (id, at, extra) => Object.assign({ id, title: 'Morning report', agentId: 'nova', lastRunOk: true, lastActiveAt: at, createdAt: at,
  automation: { kind: 'routine', id: 'job-1', name: 'Morning report' } }, extra || {});
const ids = rows => rows.map(w => w.id).join(' ');

// the rail's input, in the order Workstreams.list gives it: pinned first, then most recent
W.init({ workstreams: [run('run-mid', 3000), run('run-new', 5000), run('run-old', 1000, { pinned: true })] });
const listed = W.list({ includeArchived: true }).filter(w => w.automation);   // (init adds the General home)
A.eq(ids(listed), 'run-old run-new run-mid', '(Workstreams.list puts the pinned older run first)');

{
  const [group] = W.railGroups(listed, { view: 'all' });
  A.eq(ids(group.visible), 'run-old run-new', '(collapsed, the projection keeps the pinned run and the latest, pinned first)');
  const rows = railRunRows(group.visible);
  A.eq(rows[0].id, 'run-new', 'the routine\'s head row (the one with the runs key) is its newest run, not the pinned older one');
  A.eq(ids(rows.slice(1)), 'run-old', 'the pinned older run lists under it as an older run');
}
{
  const [group] = W.railGroups(listed, { view: 'all', expanded: [W.railGroups(listed, { view: 'all' })[0].key] });
  A.eq(ids(railRunRows(group.visible)), 'run-new run-old run-mid', 'with the history open: the newest heads, every other run under it');
}
{
  const same = [run('a', 0), run('b', 0)];
  A.eq(ids(railRunRows(same)), 'a b', 'runs with no time to tell them apart keep the order they came in');
  A.eq(ids(railRunRows([run('only', 9)])), 'only', 'a single run is its own head');
}

// renderRail hangs the runs key on that head and marks the rest older — never on whichever run the list put first
const render = A.fnBody(app, 'function renderRail()');
A.ok(render.length > 400 && render.length < 20000, 'app.js has one bounded renderRail()');
A.ok(/const runs = railRunRows\(item\.visible\);\s*headers\.set\(runs\[0\]\.id, item\);\s*runs\.slice\(1\)\.forEach\(w => olderRuns\.add\(w\.id\)\);\s*return runs;/.test(render),
  'renderRail heads each routine with railRunRows\' newest run and lists the rest as older');
A.ok(!/headers\.set\(item\.visible\[0\]\.id/.test(render), 'renderRail never takes the first visible run as the head');

A.report('rail-routine-head');
