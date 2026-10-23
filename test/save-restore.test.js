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

// the store lists preserved saves newest first and copies the station file aside before a restore
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'save-restore-'));
try {
  const store = makeSaveStore({ fs, pathMod: path, root, clock: { now: () => 1000 } });
  assert.deepEqual(store.conflicts('agent'), []);
  assert.equal(store.backup('agent', 'restore-1'), null, 'no station file, nothing to copy');
  assert.equal(store.save('agent', { ...station, _saveRevision: 0 }, { compareRevision: true }).revision, 1);
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
