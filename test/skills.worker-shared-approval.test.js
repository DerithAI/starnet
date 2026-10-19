/* node test/skills.worker-shared-approval.test.js — an approved skill the Commander shared reaches a worker.

   Customer report f702f2f6: a skill shown Active and approved loaded for the watched lead, while an autonomous worker
   asking for the same skill was told it needed the Commander's approval in ABILITIES > SKILLS, and work stopped.

   Real store + package mirror + guard + gate + skill tools, approval bound the way the allow route binds it (the
   digest of the hydrated bytes the Commander read). The seam this locks: a worker's OWN pending proposal of the same
   name (its background review drafts one after a run) shadowed the approved station skill, because the lookup prefers
   the asker's own record — and a pending-only proposal is not an active skill. The asker's own ACTIVE skill still
   wins, and a proposal with nothing else behind its name still answers that it awaits approval. */
'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const A = require('./_assert.js');
const { makeSkillStore } = require('../sidecar/skillstore.js');
const { makeSkillGate, digestOf } = require('../sidecar/skills/gate.js');
const skillPackages = require('../sidecar/skills/package.js');
const guard = require('../sidecar/skills/guard.js');
const { makeSkillTools } = require('../sidecar/tools/builtin/skills.js');
const runtime = require('../sidecar/skills/runtime.js');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skill-worker-approval-'));
try {
  const lines = [];
  const io = { readAll() { return lines.slice(); }, append(e) { lines.push(JSON.parse(JSON.stringify(e))); }, rewrite(r) { lines.splice(0, lines.length, ...JSON.parse(JSON.stringify(r))); } };
  let t = 1000; const clock = { now: () => ++t };
  const packageStore = skillPackages.makePackageStore({ fs, pathMod: path, root: path.join(dir, 'packages'), now: () => ++t });
  const makeStore = () => makeSkillStore({ io, clock, packageStore, guard, digest: digestOf });
  let store = makeStore();
  const approvals = {};
  const gate = makeSkillGate({ guard, approvals: { get: (a, id, d) => approvals[a + '\x00' + id + '\x00' + d] || approvals[a + '\x00' + id] || null } });
  const tools = () => makeSkillTools({ store, gate });
  const index = who => runtime.composeIndex(store.listAccessible(who, { includeArchived: true }), { gate: s => gate.decide(s) }).text;
  const BODY = '1. Open https://example.com/generate\n2. Make the image the brief asks for.';

  // an imported (community) skill with a URL: the guard asks, so it needs the Commander's approval
  const w = store.write({ agentId: 'agent', name: 'Image Gen', summary: 'make images', body: BODY, setup: 'Needs the studio prop.', createdBy: 'community' });
  A.ok(w.ok && w.skill.guardAction === 'ask', 'the imported skill needs approval: ' + (w.skill && w.skill.guardAction));
  A.ok(store.share({ actor: 'user', agentId: 'agent', target: w.skill.id, scope: 'station' }).ok, 'the Commander shares it with the station');
  A.eq(tools().viewTool.run({ name: 'Image Gen' }, { agentId: 'nova' }).summary, 'withheld', 'before approval a worker is refused');
  // approve exactly as handleAgentSkillAllow does: the digest of the hydrated bytes just read
  const read = store.view('agent', w.skill.id, { includeArchived: true, bump: false });
  approvals['agent\x00' + read.id] = { digest: digestOf(read), stamp: gate.stampOf(read), action: 'allow', at: 1, name: read.name };

  for (const who of ['agent', 'nova', 'sub-0f3a9c']) {
    const v = tools().viewTool.run({ name: 'Image Gen' }, { agentId: who });
    A.eq(v.summary, 'loaded Image Gen', who + ' loads the approved skill: ' + v.content.slice(0, 120));
    A.ok(v.content.indexOf('Make the image the brief asks for.') >= 0, who + ' gets the body');
    A.ok(!/WITHHELD/.test(index(who).split('\n').filter(l => /Image Gen/.test(l)).join('\n')), who + ' index does not call it withheld');
  }

  // THE SEAM: the worker's own background review drafts a same-name proposal
  const p = store.write({ agentId: 'nova', name: 'Image Gen', summary: 'my variant', body: '1. something else', createdBy: 'background-review' });
  A.ok(p.ok && p.pending, 'the worker now holds a pending proposal of the same name');
  for (let boot = 0; boot < 2; boot++) {
    const v = tools().viewTool.run({ name: 'Image Gen' }, { agentId: 'nova' });
    A.eq(v.summary, 'loaded Image Gen', 'boot ' + boot + ': the approved station skill still reaches the worker: ' + v.content.slice(0, 140));
    A.ok(v.content.indexOf('Make the image the brief asks for.') >= 0 && v.content.indexOf('something else') < 0, 'it is the approved body, never the proposal');
    A.ok(/Image Gen \[WITHHELD: proposed skill/.test(index('nova')), 'the proposal is still named in the worker\'s index (truthfully withheld)');
    store = makeStore();   // a restart: proposals and approvals persist, the answer must not change
  }
  // the preload path (/skill Image Gen in the worker's brief) resolves through the same lookup
  const pre = store.viewAccessible('nova', 'Image Gen', {});
  A.ok(pre && !pre.pendingCandidate && pre.agentId === 'agent', 'a preload resolves to the approved station skill');

  // unchanged: a proposal with nothing else behind its name still says it awaits approval
  store.write({ agentId: 'nova', name: 'Only Mine', summary: 's', body: '1. x', createdBy: 'background-review' });
  A.eq(tools().viewTool.run({ name: 'Only Mine' }, { agentId: 'nova' }).summary, 'pending', 'a lone proposal is still a proposal');
  // unchanged: the asker's own ACTIVE skill of the same name wins over a shared one (own-first)
  store.write({ agentId: 'mira', name: 'Image Gen', summary: 'mine', body: '1. mira way', createdBy: 'user' });
  const own = tools().viewTool.run({ name: 'Image Gen' }, { agentId: 'mira' });
  A.ok(own.summary === 'loaded Image Gen' && own.content.indexOf('mira way') >= 0, 'an agent\'s own active skill still wins: ' + own.content.slice(0, 80));
  // unchanged: two other owners sharing the same name stay ambiguous for an asker with only a proposal
  const x = store.write({ agentId: 'kai', name: 'Image Gen', summary: 'kai', body: '1. kai way', createdBy: 'user' });
  store.share({ actor: 'user', agentId: 'kai', target: x.skill.id, scope: 'station' });
  A.eq(tools().viewTool.run({ name: 'Image Gen' }, { agentId: 'nova' }).summary, 'not found', 'two shared owners: never an arbitrary pick');
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
A.report('skills.worker-shared-approval');
