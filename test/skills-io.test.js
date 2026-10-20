/* node test/skills-io.test.js — skills.jsonl never loses a skill: compacted, read whole, never size-rotated.

   Before: skills.jsonl was wired like the spend ledger. markUsed persisted the WHOLE record (body, support files,
   base64 package) of every loaded skill on every run; each append rotated the live file to skills.jsonl.1 past
   LOG_MAX_BYTES, deleting the previous .1; the boot read kept only the newest LOG_MAX_BYTES. On a busy station
   two rotations in one uptime deleted the only durable copy of every skill not used recently — 5 skills in, 2 out
   after a restart — and boot compaction then made it permanent.

   Laws under test (real fs in a temp dir, the same skills-io + skillstore the host wires):
     • the original failure: 5 skills, 40 runs using 2 of them, restart -> all 5, with the uses counted;
     • a use appends a small usage row (never the whole record); uses and the stale->active flip survive restart;
     • the file is compacted, never rotated: it stays bounded and no .1 is ever made;
     • a legacy .1 left by an older StarNet is read whole and folded back in by the boot compaction, then removed;
     • a partial or failed load is never rewritten as the whole library;
     • a usage row carries no `name`, so an older StarNet skips it instead of replacing the skill;
     • a large library is not rewritten on every append (hysteresis); a torn row is reported, not silent. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { makeSkillStore } = require('../sidecar/skillstore.js');
const { makeSkillsIo } = require('../sidecar/skills-io.js');
const { writeFileDurable } = require('../sidecar/durable-write.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-skills-io-'));
let t = 1000;
const clock = { now: () => ++t };
const body = (n) => 'Step ' + n + ': ' + 'do the thing carefully. '.repeat(1500);   // ~36 KB
function fixture(name, opts) {
  const dir = path.join(tmp, name); fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'skills.jsonl');
  const notes = [];
  const mkIo = () => makeSkillsIo(Object.assign({ fs, file, note: (tag, e) => notes.push(tag + ': ' + ((e && e.message) || e)),
    writeDurable: (f, b) => writeFileDurable({ fs, path }, f, b), compactBytes: 256 * 1024 }, opts || {}));
  const f = { file, notes, io: mkIo() };
  f.store = makeSkillStore({ io: f.io, clock });
  f.restart = () => { f.io = mkIo(); f.store = makeSkillStore({ io: f.io, clock }); return f.store; };
  return f;
}
const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'];
const seed = (s) => { for (const n of names) A.ok(s.write({ agentId: 'a', name: n, summary: n + ' procedure', body: body(n), createdBy: 'user' }).ok, 'seeded ' + n); };

// ---- 1. the original failure: nothing is lost across heavy use + restart ----
{
  const f = fixture('loss');
  seed(f.store);
  let maxSize = 0;
  for (let run = 0; run < 40; run++) { f.store.markUsed('a', ['Alpha', 'Bravo']); maxSize = Math.max(maxSize, fs.statSync(f.file).size); }
  A.ok(!fs.existsSync(f.file + '.1'), 'the live file is never rotated to .1');
  const s = f.restart();
  A.eq(s.count(), 5, 'all 5 skills survive 40 runs + a restart (trunk kept 2)');
  A.eq(s.view('a', 'Alpha', { bump: false }).useCount, 40, 'the uses survive the restart');
  A.eq(s.view('a', 'Charlie', { bump: false }).body, body('Charlie'), 'an unused skill keeps its exact body');
  A.ok(maxSize < 256 * 1024 + 64 * 1024, 'uses never balloon the file (max ' + maxSize + ' bytes)');
}

// ---- 2. a use is a small usage row, not the whole record; stale -> active survives restart ----
{
  const f = fixture('usage');
  seed(f.store);
  const before = fs.statSync(f.file).size;
  f.store.markUsed('a', 'Delta');
  const grew = fs.statSync(f.file).size - before;
  A.ok(grew > 0 && grew < 300, 'one use appends a ~150-byte usage row (' + grew + ' bytes), not the ~36 KB record');
  const last = JSON.parse(fs.readFileSync(f.file, 'utf8').trim().split('\n').pop());
  A.eq(last.recordType, 'skill-usage', 'the appended row is a usage row');
  A.ok(!('name' in last) && last.skillName === 'Delta', 'a usage row carries skillName, never `name` (an older StarNet skips it)');
  A.eq(f.store.curate('a', { now: t + 40 * 86400000 }).stale, 5, 'precondition: aging marks every skill stale');
  f.store.markUsed('a', 'Echo');
  const s = f.restart();
  A.eq(s.view('a', 'Echo', { bump: false }).state, 'active', 'a use flips stale -> active, and that survives restart');
  A.eq(s.view('a', 'Echo', { bump: false }).useCount, 1, 'and its use count with it');
  A.eq(s.view('a', 'Delta', { bump: false }).state, 'stale', 'a skill aged after its last use stays stale');
  A.eq(s.view('a', 'Delta', { bump: false }).useCount, 1, 'and keeps its earlier use');
}

// ---- 3. an older StarNet's loader (rows without `name` are skipped) never replaces a skill with a usage row ----
{
  const rows = [{ id: 'x', agentId: 'a', name: 'Xray', summary: 's', body: 'the real body', createdBy: 'user', state: 'active', createdAt: 1, updatedAt: 1 },
    { recordType: 'skill-usage', agentId: 'a', skillName: 'Xray', useCount: 7, lastUsedAt: 9 },
    { recordType: 'skill-usage', agentId: 'a', skillName: 'Ghost', useCount: 1, lastUsedAt: 9 }];
  const s = makeSkillStore({ io: { readAll: () => rows, append() {} }, clock });
  A.eq(s.count(), 1, 'a usage row for an unknown skill creates nothing');
  A.eq([s.view('a', 'Xray', { bump: false }).body, s.view('a', 'Xray', { bump: false }).useCount], ['the real body', 7], 'a usage row only moves the counters');
  const legacy = rows.filter(r => !r.recordType || r.recordType !== 'skill-usage').concat(rows.filter(r => r.recordType === 'skill-usage').map(r => { const c = Object.assign({}, r); delete c.recordType; return c; }));
  A.eq(makeSkillStore({ io: { readAll: () => legacy, append() {} }, clock }).view('a', 'Xray', { bump: false }).body, 'the real body', 'even read as a plain record, a nameless usage row cannot replace the skill');
}

// ---- 4. a legacy .1 (an older StarNet rotated the file) is read whole, folded in at boot, then removed ----
{
  const f = fixture('legacy');
  const rec = (n, extra) => Object.assign({ id: n.toLowerCase(), agentId: 'a', name: n, summary: n, body: body(n), createdBy: 'user', state: 'active', createdAt: 1, updatedAt: 1 }, extra || {});
  fs.writeFileSync(f.file + '.1', [rec('Alpha'), rec('Bravo'), rec('Charlie')].map(r => JSON.stringify(r)).join('\n') + '\n');
  fs.writeFileSync(f.file, [rec('Alpha', { useCount: 9, updatedAt: 2 }), rec('Delta')].map(r => JSON.stringify(r)).join('\n') + '\n');
  const s = f.restart();
  A.eq(s.count(), 4, 'archive + live are both read whole');
  A.eq(s.view('a', 'Alpha', { bump: false }).useCount, 9, 'the live (newer) record wins over the archive');
  A.ok(f.io.needsCompaction(), 'a legacy .1 asks for the boot compaction');
  A.ok(s.compact().ok, 'the boot compaction runs');
  A.ok(!fs.existsSync(f.file + '.1'), 'and removes the folded-in archive');
  A.eq(f.restart().count(), 4, 'every skill from the archive survives the next restart');
}

// ---- 5. a partial or failed load is never rewritten as the whole library ----
{
  const f = fixture('partial', { readMaxBytes: 50 * 1024 });   // smaller than the seeded file
  const full = fixture('partial-seed');
  seed(full.store);
  fs.copyFileSync(full.file, f.file);
  const before = fs.readFileSync(f.file, 'utf8');
  const s = f.restart();
  A.eq(f.io.loadComplete(), false, 'an oversized file is read partially and says so');
  A.ok(s.count() < 5, 'precondition: the partial read sees fewer skills (' + s.count() + ')');
  const r = s.compact();
  A.eq(r.ok, false, 'compaction refuses after a partial load');
  A.eq(fs.readFileSync(f.file, 'utf8'), before, 'the file on disk is untouched');
  const broken = makeSkillStore({ io: { readAll() { throw new Error('EIO'); }, append() {}, rewrite() { throw new Error('must never be called'); } }, clock });
  A.eq(broken.compact().ok, false, 'a failed load never rewrites either');
}

// ---- 6. hysteresis: a large library is not rewritten on every append; a torn row is reported ----
{
  const f = fixture('hysteresis', { compactBytes: 64 * 1024 });   // the seeded library (~180 KB) is already larger
  seed(f.store);
  const compactedAt = fs.statSync(f.file).size;
  let rewrites = 0, last = compactedAt;
  for (let run = 0; run < 50; run++) { f.store.markUsed('a', 'Alpha'); const sz = fs.statSync(f.file).size; if (sz < last) rewrites++; last = sz; }
  A.ok(rewrites <= 1, 'a library over the threshold is not rewritten per append (' + rewrites + ' rewrites in 50 uses)');
  fs.appendFileSync(f.file, '{"torn": \n');
  f.restart();
  A.ok(f.notes.some(n => /skills\.io\.torn-row: 1 unparsable row/.test(n)), 'a torn row is skipped and reported');
}

try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
A.report('skills-io.test');
