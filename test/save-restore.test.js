'use strict';
// save-restore: a preserved window save's sessions come back into the station and nothing the station holds is lost
// (support report 2026-10-21: a 950-session station, a 1,046-session preserved window save, no way back).
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { plan, restorable } = require('../sidecar/save-restore.js');
const { makeSaveStore } = require('../sidecar/savestore.js');

const turn = (role, content) => ({ role, content });
const ws = (id, history, extra) => Object.assign({ id, title: 'S ' + id, agentId: 'agent', lane: 'active', kind: 'chat', history, runIds: [] }, extra || {});
const station = {
  schema: 'starnet.save', version: 6, agent: { id: 'agent', name: 'NOVA' }, station: { floor: 'station floor' }, generalId: 'g-station',
  deletedIds: ['gone'], _saveRevision: 46,
  workstreams: [
    ws('g-station', [turn('user', 'hi')], { title: null }),
    ws('same', [turn('user', 'a'), turn('assistant', 'b')]),
    ws('grown', [turn('user', 'q')]),
    ws('ahead', [turn('user', 'x'), turn('assistant', 'y')]),
    ws('split', [turn('user', 'one'), turn('assistant', 'station answer')]),
    ws('station-only', [turn('user', 'kept')])
  ]
};
const windowSave = {
  schema: 'starnet.save', version: 6, agent: { id: 'agent', name: 'RENAMED IN WINDOW' }, station: { floor: 'window floor' }, generalId: 'g-window',
  deletedIds: ['station-only'], _saveRevision: 45,
  workstreams: [
    ws('g-window', [turn('user', 'hi'), turn('assistant', 'more general')], { title: null }),
    ws('same', [turn('user', 'a'), turn('assistant', 'b')]),
    ws('grown', [turn('user', 'q'), turn('assistant', 'answer the station never saved')]),
    ws('ahead', [turn('user', 'x')]),
    ws('split', [turn('user', 'one'), turn('assistant', 'window answer')]),
    ws('new-1', [turn('user', 'routine run while away')]),
    ws('worker', [turn('user', 'sub')], { parentStreamId: 'g-window', worker: true }),
    ws('gone', [turn('user', 'deleted on purpose in the station')])
  ]
};
const before = JSON.stringify(station), beforeWindow = JSON.stringify(windowSave);
const r = plan(station, windowSave);
assert.equal(JSON.stringify(station), before, 'the station object is not modified');
assert.equal(JSON.stringify(windowSave), beforeWindow, 'the preserved save is not modified');
const by = id => r.doc.workstreams.find(w => w.id === id);

assert.deepEqual(r.added, ['new-1', 'worker'], 'sessions the station lacks are added');
assert.equal(by('worker').parentStreamId, 'g-station', 'a worker under the window\'s General files under the station\'s');
assert.deepEqual(r.extended.sort(), ['g-station', 'grown'], 'a continued conversation is taken whole');
assert.equal(by('grown').history.length, 2);
assert.equal(by('g-station').history.length, 2, 'the window\'s General is the station\'s General');
assert.equal(r.doc.workstreams.filter(w => w.title == null).length, 1, 'never a second General');
assert.equal(by('ahead').history.length, 2, 'the station\'s longer copy stays');
assert.deepEqual(r.copied, ['split~restored'], 'a session both sides changed keeps both');
assert.equal(by('split').history[1].content, 'station answer');
assert.equal(by('split~restored').history[1].content, 'window answer');
assert.equal(by('split~restored').title, 'S split (restored copy)');
assert.equal(by('gone'), undefined, 'a session the station deleted stays deleted');
assert.ok(by('station-only'), 'the window\'s delete never removes a station session');
for (const w of station.workstreams) assert.ok(by(w.id), 'nothing the station holds is lost: ' + w.id);
assert.equal(r.doc.agent.name, 'NOVA', 'the roster stays the station\'s');
assert.deepEqual(r.doc.station, station.station, 'the floor stays the station\'s');
assert.deepEqual(r.doc.deletedIds, ['gone']);
assert.equal(restorable(station, windowSave), 5);

const again = plan(r.doc, windowSave);
assert.deepEqual([again.added, again.extended, again.copied], [[], [], []], 'a second restore brings nothing back twice');
assert.equal(restorable(r.doc, windowSave), 0, 'so a notice never offers it again');
assert.equal(restorable(station, { workstreams: 'not a list' }), 0);

// review 10-23 #3b (proof3): a CLEARED station session is not "behind", and extending a session appends only the missing
// turns while every station-side field stays the station's ("nothing in the station is removed" holds for metadata too)
{
  const st = { generalId: 'g', deletedIds: [], workstreams: [
    { id: 'g', title: null, history: [turn('user', 'hi')] },
    { id: 'cleared', title: 'Payroll', history: [], lastActiveAt: 900 },
    { id: 'renamed', title: 'Q4 plan (final)', archived: true, pinned: false, lane: 'shipped', runIds: ['run-s'], deliverables: ['d.md'], history: [turn('user', 'plan q4')] },
    { id: 'new-empty', title: 'Fresh', history: [], lastActiveAt: 100 },
    { id: 'checkpointed', title: 'C', history: [], lastActiveAt: 100 },
    { id: 'cleared-then-used', title: 'U', history: [turn('user', 'after the clear')] },
    { id: 'born-empty', title: 'B', history: [], createdAt: 500, lastActiveAt: 500 }
  ], sessionUndo: { kind: 'clear', at: 950, activeId: 'g', rows: [{ id: 'checkpointed', history: [turn('user', 'secret')] }, { id: 'cleared-then-used', history: [turn('user', 'secret 2')] }] } };
  const kept = { generalId: 'g', workstreams: [
    { id: 'g', title: null, history: [turn('user', 'hi')] },
    { id: 'cleared', title: 'Payroll', history: [turn('user', 'salary of each employee'), turn('assistant', '...')], lastActiveAt: 800 },
    { id: 'renamed', title: 'Q4 plan', archived: false, pinned: true, lane: 'active', runIds: ['run-w'], deliverables: [], history: [turn('user', 'plan q4'), turn('assistant', 'draft')] },
    { id: 'new-empty', title: 'Fresh', history: [turn('user', 'typed in the other window')], lastActiveAt: 200 },
    { id: 'checkpointed', title: 'C', history: [turn('user', 'secret')], lastActiveAt: 999 },
    { id: 'cleared-then-used', title: 'U', history: [turn('user', 'secret 2')] },
    { id: 'born-empty', title: 'B', history: [turn('user', 'asked before the run finished')], createdAt: 500, lastActiveAt: 500 }
  ] };
  const stBefore = JSON.stringify(st);
  const p = plan(st, kept);
  const at = id => p.doc.workstreams.find(w => w.id === id);
  assert.equal(JSON.stringify(st), stBefore, '3b: the station object is not modified');
  assert.equal(at('cleared').history.length, 0, '3b: a session cleared after the window last used it stays cleared');
  const ren = at('renamed');
  assert.deepEqual(ren.history.map(t => t.content), ['plan q4', 'draft'], '3b: the missing turn is appended');
  assert.deepEqual({ title: ren.title, archived: ren.archived, pinned: ren.pinned, lane: ren.lane, runIds: ren.runIds, deliverables: ren.deliverables },
    { title: 'Q4 plan (final)', archived: true, pinned: false, lane: 'shipped', runIds: ['run-s'], deliverables: ['d.md'] }, '3b: every station-side field stays the station\'s');
  assert.deepEqual(at('new-empty').history.map(t => t.content), ['typed in the other window'], '3b: an empty session the window worked in AFTER the station last did gets its turns');
  assert.equal(at('checkpointed').history.length, 0, '3b: a session the station\'s clear checkpoint names is never refilled');
  assert.equal(at('cleared-then-used~restored'), undefined, '3b: nor copied back beside the station\'s new turns');
  assert.equal(at('born-empty').history.length, 1, '3b: an empty session never active since it was created (so never cleared) gets the turns');
  assert.deepEqual([p.added, p.extended.sort(), p.copied], [[], ['born-empty', 'new-empty', 'renamed'], []]);
  assert.equal(restorable(st, kept), 3, '3b: the offer counts exactly what a restore brings back');
  // 3c: the sidecar's deleted-session ledger (opts.isDeleted) wins like the save's own deletedIds
  const withDeleted = { generalId: 'g', workstreams: [{ id: 'ledger-deleted', history: [turn('user', 'x')] }, { id: 'renamed~restored', history: [turn('user', 'y')] }] };
  const del = id => id === 'ledger-deleted';
  assert.deepEqual(plan(st, withDeleted, { isDeleted: del }).added, ['renamed~restored'], '3c: a ledger-deleted session is never added');
  assert.equal(restorable(st, withDeleted, { isDeleted: del }), 1, '3c: nor counted');
}

// the store lists preserved saves newest first and copies the station file aside before a restore
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'save-restore-'));
try {
  const store = makeSaveStore({ fs, pathMod: path, root, clock: { now: () => 1000 } });
  assert.deepEqual(store.conflicts('agent'), []);
  assert.equal(store.backup('agent', 'restore-1'), null, 'no station file, nothing to copy');
  assert.equal(store.save('agent', { ...station, _saveRevision: 0 }, { compareRevision: true }).revision, 1000, 'a first save on an empty file takes the clock revision (review 10-23 #2)');
  const refused = store.save('agent', { ...windowSave, _saveRevision: 0, _saveClient: 'window-a' }, { compareRevision: true });
  assert.equal(refused.recovery, 'agent.save-conflict-window-a.json');
  fs.writeFileSync(path.join(root, 'agent.save-conflict-torn.json'), '{"workstreams":[');
  fs.writeFileSync(path.join(root, 'other.save-conflict-x.json'), '{}');
  const listed = store.conflicts('agent');
  assert.deepEqual(listed.map(c => c.name), ['agent.save-conflict-window-a.json'], 'a torn snapshot is skipped and another agent\'s is never listed');
  assert.equal(listed[0].doc.workstreams.length, windowSave.workstreams.length);
  assert.ok(fs.existsSync(path.join(root, 'agent.save-conflict-torn.json')), 'a torn snapshot is never removed');
  const copy = store.backup('agent', 'restore-1');
  assert.equal(copy, 'agent.save-before-restore-1.json');
  assert.equal(fs.readFileSync(path.join(root, copy), 'utf8'), fs.readFileSync(path.join(root, 'agent.save.json'), 'utf8'));
  assert.throws(() => store.backup('agent', '../escape'));
  assert.throws(() => store.conflicts('../agent'));
} finally { fs.rmSync(root, { recursive: true, force: true }); }
console.log('save-restore: preserved sessions return, nothing is lost, General maps, tombstones hold, store lists and backs up PASS');
