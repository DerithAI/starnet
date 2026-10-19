'use strict';
const A = require('./_assert.js'), S = require('../frontend/app/starters.js');
const now = 1800000000000, day = 86400000;
const request = 'Build a revenue dashboard for my subscription product; start with churn by cohort.';
const history = [{ role: 'user', content: request }, { role: 'assistant', content: 'The data import is working. Cohort calculations still need validation.' }];
const session = (id, more = {}) => ({ id, title: 'Revenue dashboard', agentId: 'agent', projectRoot: '/product', lastActiveAt: now - day, history, ...more });
const signals = { now, agentId: 'agent', projectRoot: '/product', sessions: [session('revenue')], capabilities: ['workbench'] };
const ctx = S.context(signals);
const row = { title: 'Validate revenue retention by cohort', why: 'Your revenue dashboard imports data, but its cohort calculations still need validation.', deliverable: 'Validated cohort calculations and regression checks in the dashboard.', prompt: 'Continue the revenue dashboard. Validate the cohort calculations against sample subscriptions, correct any errors, and test the displayed retention figures.', sourceIds: ['session:revenue:0', 'session:revenue:1'], sessionId: 'revenue', kind: 'continue', requiredCapabilities: ['workbench'] };
const parse = (r = row, c = ctx, excluded = []) => S.parse(JSON.stringify({ suggestions: [r] }), c, excluded);
A.eq(S.defaults().length, 3, 'Three substantial general starting points');
A.ok(S.defaults().every(s => s.general && s.prompt.length > 250 && s.deliverable && !s.evidence.length), 'Defaults carry actionable briefs without fabricated personalization');
A.ok(S.defaults()[0].prompt.includes('Do not stop at a plan or a mockup'), 'Build default asks for a tangible result');
A.ok(S.defaults()[1].prompt.includes('implement and test'), 'Automation default goes beyond planning');
A.ok(S.defaults()[2].prompt.includes('Separate evidence from uncertainty'), 'Decision default requires evidence');
A.eq(S.launchPrompt(S.defaults()[0]), S.defaults()[0].prompt, 'General starter does not invent supporting history');
A.ok(ctx.ready && ctx.sources.length === 2, 'Meaningful user work enables personalization immediately');
A.eq(parse().length, 1, 'Concrete unfinished continuation accepted');
A.eq(S.context({}).ready, false, 'Empty station has no fabricated understanding');
A.eq(S.context({ ...signals, enabled: false }).ready, false, 'Pause disables personalization');
A.eq(S.context({ ...signals, sessions: [session('short', { history: [{ role: 'user', content: 'hi' }] })] }).ready, false, 'Greeting is insufficient evidence');
A.eq(S.context({ ...signals, sessions: [session('other', { agentId: 'other' }), session('elsewhere', { projectRoot: '/other' }), session('old', { lastActiveAt: now - 31 * day }), session('future', { lastActiveAt: now + day }), session('archived', { archived: true }), session('group', { conversationMode: 'group' })] }).sources.length, 0, 'No other-agent, other-project, stale, future, archived or group history');
const other = S.context({ ...signals, sessions: [session('book', { history: [{ role: 'user', content: 'Help publish my cookbook with a printable layout and tested recipes for home cooks.' }] })] });
A.ok(!S.buildDirective(other).includes(request) && S.buildDirective(other).includes('cookbook'), 'Different work yields different model evidence');
const goal = S.context({ now, goal: { id: 'g', status: 'active', text: 'Launch my subscription product', milestones: [{ id: 'm', text: 'Validate pricing', status: 'open' }] } });
A.ok(goal.ready && goal.sources.some(x => x.type === 'milestone'), 'Active goal supplies direction without history');
A.eq(S.context({ now, beliefs: { ambition: [{ id: 'seed', text: 'Build useful things', weight: 'seed' }] } }).ready, false, 'Seed is not learned ambition');
A.ok(S.context({ now, beliefs: { ambition: [{ id: 'a', text: 'Grow my independent research business', weight: 'strong', createdAt: now }] } }).ready, 'Learned ambition grounds ideas');
for (const [why, bad] of Object.entries({ 'invented citation': { sourceIds: ['invented'] }, 'result alone': { sourceIds: ['session:revenue:1'] }, 'unavailable capability': { requiredCapabilities: ['missing'] }, 'old preset': { title: 'Plan a task' }, 'unknown kind': { kind: 'arbitrary' }, 'other session': { sessionId: 'other' }, 'invented recurrence': { kind: 'automate', sessionId: null } })) A.eq(parse({ ...row, ...bad }), [], 'Reject ' + why);
for (const state of [{ busy: true }, { lane: 'shipped' }]) A.eq(parse(row, S.context({ ...signals, sessions: [session('revenue', state)] })), [], 'Do not continue busy/completed work');
A.eq(parse(row, ctx, [row.title]), [], 'Dismissed title excluded');
A.eq(S.parse('not json', ctx), [], 'Invalid model output rejected');
A.eq(S.parse(JSON.stringify({ suggestions: [row, row] }), ctx).length, 1, 'Duplicates collapsed');
A.ok(S.launchPrompt(parse()[0]).includes(request) && S.launchPrompt(parse()[0]).includes('Expected result:'), 'Launch carries evidence and deliverable');
A.ok(S.buildDirective(ctx).includes('Never fill a quota') && S.buildDirective(ctx).includes('Current direction outranks old habits'), 'Prompt prioritizes value and latest direction');
// Execute the production launch handler against real sessions; selecting never starts a run.
const fs = require('node:fs'), vm = require('node:vm'), W = require('../frontend/app/workstreams.js');
W.reset(); W.create(null, { agentId: 'agent' }); const original = W.adopt(session('revenue')); let loaded = null, prepared = null;
const input = { value: '', focus() {} }, hint = {};
const scope = vm.createContext({ input, Starters: S, Workstreams: W, Channels: { isBusy: () => false }, StarterStore: { exclusions: () => [], prepare: (...args) => { prepared = args; } }, starterContext: () => ctx, load: w => { loaded = w; }, prefill: text => { input.value = text; }, clearEmptyState() {}, maybeEmptyState() {}, refreshWorkflowViews() {}, send: () => { throw Error('Unexpected run'); } });
const source = fs.readFileSync(require('node:path').join(__dirname, '../frontend/app/chat.js'), 'utf8');
vm.runInContext(A.fnBody(source, 'function openStarter('), scope); scope.idea = parse()[0]; scope.hint = hint;
vm.runInContext('openStarter(idea, hint)', scope);
A.eq(loaded.id, original.id, 'Selection resumes original session'); A.eq(original.history[0].content, request, 'History preserved'); A.eq(prepared[1], original.id, 'Attribution bound to selected session'); A.ok(input.value.includes(request), 'Draft includes source context');
loaded = null; vm.runInContext('openStarter(idea, hint)', scope); A.eq(loaded, null, 'Existing draft never overwritten or moved');
input.value = ''; scope.idea = S.defaults()[0]; prepared = null; vm.runInContext('openStarter(idea, hint)', scope);
A.ok(loaded.id !== original.id && loaded.title === S.defaults()[0].label, 'General starter creates named session'); A.eq(prepared, null, 'General starter is not called personalized');
// org P25 (2026-10-14): a starter picked on a BLANK open session fills THAT session — no second empty row
const blank = W.create(null, { agentId: ctx.agentId || 'agent', projectRoot: ctx.projectRoot || undefined }); W.switch(blank.id);
input.value = ''; const rowsBefore = W.list().length; scope.idea = S.defaults()[0]; loaded = null; vm.runInContext('openStarter(idea, hint)', scope);
A.eq(loaded && loaded.id, blank.id, 'a starter on a blank open session fills it'); A.eq(W.list().length, rowsBefore, 'no new empty session is minted beside it');
A.ok(input.value.length > 0, 'the starter prompt is prefilled into the blank session');
// org P25 fix (review): "blank" is Workstreams.isUntouched — the same test +NEW uses. A titled TO DO card from the board,
// or a pinned empty chat, has no history but IS shaped: a starter must never take it over, so today's create stays.
for (const [why, mk] of [
  ['a titled TO DO card (board addTask)', () => W.create('Ship pricing page', { agentId: ctx.agentId || 'agent', projectRoot: ctx.projectRoot || undefined, kind: 'task' })],
  ['a pinned empty chat', () => { const p = W.create(null, { agentId: ctx.agentId || 'agent', projectRoot: ctx.projectRoot || undefined }); W.pin(p.id, true); return p; }]
]) {
  const shaped = mk(); W.switch(shaped.id);
  input.value = ''; const before = W.list().length; scope.idea = S.defaults()[0]; loaded = null; vm.runInContext('openStarter(idea, hint)', scope);
  A.ok(loaded && loaded.id !== shaped.id && loaded.title === S.defaults()[0].label, 'a starter on ' + why + ' keeps today\'s create — the card is not taken over');
  A.eq(W.list().length, before + 1, 'a starter on ' + why + ' mints its own session');
  A.eq(W.get(shaped.id).title, shaped.title, why + ' keeps its own title');
}
A.ok(W.isUntouched(W.create(null, {})) && !W.isUntouched(W.create('x', { kind: 'task' })), 'Workstreams.isUntouched is exported: an untitled chat is untouched, a titled task card is not');
A.report('starters');
