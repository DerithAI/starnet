/* node test/briefing-frontend.test.js — the ONE briefing session (frontend/app/briefing.js): adopting it is
   idempotent + pinned + unread, chips only point at sessions that really exist, the return beats see
   ownsReturn(), and a delivered briefing opens the session unless the Commander is mid-something. */
'use strict';
const A = require('./_assert.js');

const sessions = new Map();
let active = 'general', opened = [], pinned = new Set(), unread = new Set();
global.Workstreams = {
  adopt: (o) => { if (!sessions.has(o.id)) sessions.set(o.id, Object.assign({ history: [] }, o)); return sessions.get(o.id); },
  get: (id) => sessions.get(id) || null,
  pin: (id) => { pinned.add(id); return true; },
  markUnread: (id) => { unread.add(id); return true; },
  activeId: () => active
};
global.App = { openWorkstream: (id) => { opened.push(id); active = id; }, refreshRail: () => {}, persist: () => {} };
let engaged = false, chips = null;
let loads = 0;
global.Chat = { isComposerEngaged: () => engaged, isBusy: () => false, choices: (items) => { chips = items; }, load: () => { loads++; } };
// minimal DOM: the COMMS log the standing link row is appended to
function fakeEl(tag) { return { tag, className: '', textContent: '', children: [], listeners: {}, parent: null,
  appendChild(c) { c.parent = this; this.children.push(c); return c; }, remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
  addEventListener(n, f) { this.listeners[n] = f; },
  querySelector(sel) { const cls = sel.replace(/^./, ''); return this.children.find(c => String(c.className).split(' ').includes(cls)) || null; } }; }
const chatLog = fakeEl('div');
global.document = { getElementById: (id) => id === 'chat-log' ? chatLog : null, createElement: fakeEl, addEventListener() {}, visibilityState: 'visible' };
let deliverBody = null;
const reply = { delivered: true, at: 5000, agentId: 'agent', items: [
  { kind: 'build', title: 'Speedrun timer v2', open: 'workshop-b1' },
  { kind: 'routine', name: 'Daily AI news', latest: { open: 'cron-c2', failed: false } },
  { kind: 'routine', name: 'Inbox sweep', latest: { open: 'cron-gone', failed: true } },
  { kind: 'draft', title: 'idea' }
] };
global.fetch = async (url, opts) => {
  if (String(url).indexOf('/api/away/briefing/deliver') === 0) { deliverBody = JSON.parse(opts.body); return { ok: true, json: async () => reply }; }
  return { ok: true, json: async () => ({ last: { items: reply.items } }) };
};
const B = require('../frontend/app/briefing.js');

(async () => {
  A.eq(B.ownsReturn(), false, 'before init the older return beats keep their job');
  B.init({ enabled: false });
  A.eq(B.ownsReturn(), false, 'the awakening (enabled:false) never briefs');

  B.init({ enabled: true, agentId: 'agent' });
  A.eq(B.ownsReturn(), true, 'live → the older return beats stand down');
  sessions.set('workshop-b1', { id: 'workshop-b1' });
  sessions.set('cron-c2', { id: 'cron-c2' });

  const j = await B.deliver('test');
  A.ok(j && j.delivered, 'deliver hands back the server answer');
  A.ok(typeof deliverBody.tzOffsetMin === 'number', 'deliver sends the local tz so times read local');
  const ws = sessions.get('briefing');
  A.ok(!!ws && ws.title === 'While you were away', 'ONE briefing session adopted with the plain title');
  A.ok(pinned.has('briefing') && unread.has('briefing'), 'briefing session is pinned and unread');
  A.eq(opened.join(','), 'briefing', 'not engaged → the briefing session opens itself');

  ws.title = 'Identify Daily Space Fact Job'; ws.titleAuto = true;   // a reply's auto-title pass renamed it
  const loadsBefore = loads; await B.deliver('again');
  A.eq(loads, loadsBefore + 1, 'briefing already on screen → re-synced in place (open would be a no-op)');
  A.ok(ws.title === 'While you were away' && ws.titleAuto === false, 'a machine re-title is repaired and the name locked');
  A.eq(Array.from(sessions.keys()).filter(k => k === 'briefing').length, 1, 'a second briefing lands in the SAME session (never a new row)');

  await B.presentFor('briefing');
  const row = chatLog.querySelector('.briefing-links');
  A.ok(!!row, 'opening the briefing renders the standing link row');
  A.eq(chips, null, 'it is NOT a one-shot Chat.choices prompt another beat could clear');
  A.eq(B.chipsFor(reply.items).map(c => c.value).join(','), 'workshop-b1,cron-c2', 'links only point at sessions that really exist (a deleted one stays gone)');
  const dg = B.chipsFor([{ kind: 'delegated', name: 'Launch planning', runs: 3, failed: 1, open: 'cron-c2' }, { kind: 'delegated', name: 'Gone', runs: 1, failed: 0, open: 'deleted-1' }]);
  A.eq(dg.map(c => c.label + '>' + c.value).join(','), '⚠ Launch planning>cron-c2', 'delegated work links to the conversation that asked for it (a failure flagged), never into a deleted one');
  A.ok(/review “Speedrun timer v2”/.test(row.children[0].textContent), 'build link says what it opens');
  opened = []; row.children[1].listeners.click();
  A.eq(opened.join(','), 'cron-c2', 'a link opens that item’s own session');
  active = 'briefing';
  await B.presentFor('briefing');
  A.eq(chatLog.children.filter(c => String(c.className).includes('briefing-links')).length, 1, 're-presenting replaces the row, never stacks a second');

  active = 'cron-c2'; const before = chatLog.children.length;
  await B.presentFor('cron-c2');
  A.eq(chatLog.children.length, before, 'other sessions get no briefing links');

  // mid-something → no focus jump; the unread pinned row is the whole signal
  active = 'general'; opened = []; engaged = true;
  await B.deliver('engaged');
  A.eq(opened.length, 0, 'engaged Commander → no focus jump');

  /* LIVE WALK 10-14: a reload made the briefing the active session and took the screen off the conversation whose
     worker approval was still waiting. A waiting ask outranks the report: the station's own count (a reloaded page may
     not have refiled the ask yet) or one this page holds keeps the Commander where they are. */
  engaged = false; active = 'ws-launch'; opened = [];
  reply.asksWaiting = 1;
  await B.deliver('boot');
  A.eq(opened.length, 0, 'an approval waiting on the station → the briefing stays an unread row, no focus jump');
  reply.asksWaiting = 0;
  global.Channels = { allPending: () => [{ wsId: 'ws-launch', p: { promptId: 'p1' } }] };
  await B.deliver('boot');
  A.eq(opened.length, 0, 'an ask this page holds → no focus jump');
  global.Channels = { allPending: () => [] };
  await B.deliver('boot');
  A.eq(opened.join(','), 'briefing', 'nothing waiting and nothing engaged → the briefing still opens itself on a real return');
  A.eq(deliverBody.minAwayMs, 30 * 60000, 'every delivery names the page\'s away threshold: a reload is not an absence');

  A.report('briefing-frontend');
})().catch(e => { console.error(e); process.exit(1); });
