/* node test/channels.group-admission-guard.test.js — another bot's /allow or /deny is not ours.

   1. ANOTHER BOT'S /allow. Moderation bots use "/allow @user" and "/deny @user". The admission rule accepted any bare
      /allow or /deny, arguments and all, so the owner moderating a room admitted it to their station ("Anyone here can
      now talk to me … every answer is a real run on your station"), and in an admitted room "/deny @spammer" closed it.
      A non-owner's moderation command also made a bot that sat silent in the room post a refusal line. Ours takes no
      argument unless it names this bot (/allow@thisbot …).

   Real adapter + real hub; fakes only, no network, no sidecar. */
'use strict';
const A = require('./_assert.js');
const { makeChannelAdapter } = require('../sidecar/channels/adapter.js');
const { makeChannelHub } = require('../sidecar/channels/hub.js');

const OWNER = '5';
function mkAdapter(opts) {
  const got = [], sent = [];
  const ad = makeChannelAdapter(Object.assign({
    transport: { getUpdates: async () => [], send: async (chatId, text, o) => { sent.push({ chatId, text, o }); return { ok: true, messageId: 'm' + sent.length }; } },
    normalize: (r) => r, name: 'telegram', clock: { now: () => 1000 },
    botUsername: 'halcyonbot', ownerUserId: OWNER,
    onInbound: (im) => got.push(im)
  }, opts || {}));
  return { ad, got, sent };
}
const group = (extra) => Object.assign({ chatId: '-1001', chatType: 'group', userId: '9', userName: 'Ana', text: 'hello', messageId: String(Math.random()) }, extra);
const flush = () => new Promise(r => setTimeout(r, 0));
function fakeStore() {
  const recs = new Map();
  return {
    recs, loadHistory: () => [], appendTurn: () => [],
    getChatRecord: (c) => recs.get(String(c)),
    saveChatRecord: (c, patch) => { const m = Object.assign({}, recs.get(String(c)), patch); recs.set(String(c), m); return m; }
  };
}
function mkHub(over) {
  const sends = [], runs = [];
  const store = (over && over.store) || fakeStore();
  let n = 0;
  const hub = makeChannelHub(Object.assign({
    channel: 'telegram', store,
    runOnce: async (o) => { runs.push(o); o.emit('agent.run.end', { agentId: o.agentId, runId: o.runId, reason: 'done' }); },
    send: (c, t) => { sends.push({ chatId: String(c), text: t }); return Promise.resolve({ ok: true }); },
    secrets: () => ({ key: 'k', model: 'm', agentId: 'ultron' }), classify: () => false, newId: () => 'r' + (++n),
    isOwner: (m) => String(m.userId) === OWNER
  }, over || {}));
  return { hub, sends, runs, store };
}
const inbound = (userId, text, extra) => Object.assign({ channel: 'telegram', chatId: '-1001', chatType: 'group', userId, text, messageId: String(Math.random()), ts: 1 }, extra || {});

(async () => {
  // ---- 1a. the adapter: a closed group's moderation command is not an admission ----
  {
    const { ad, got, sent } = mkAdapter({ allowedChats: () => false });
    const adm = ad._internals.admission;
    A.eq(adm(group({ userId: OWNER, text: '/allow @newmember' })), 'drop', 'the owner\'s "/allow @user" (a moderation bot\'s) is not an admission');
    A.eq(adm(group({ userId: OWNER, text: '/deny spammer' })), 'drop', 'nor is "/deny spammer"');
    A.eq(adm(group({ userId: OWNER, text: '/allow' })), 'admit', 'a bare /allow still admits');
    A.eq(adm(group({ userId: OWNER, text: '/allow   ' })), 'admit', 'trailing spaces are not an argument');
    A.eq(adm(group({ userId: OWNER, text: '/allow@halcyonbot please', mentions: ['halcyonbot'] })), 'admit', 'an argument is fine when the command names US');
    ad._internals.dispatch({ offset: 1, message: group({ userId: '9', text: '/allow @newmember' }) });
    ad._internals.dispatch({ offset: 2, message: group({ userId: OWNER, text: '/allow @newmember' }) });
    await flush();
    A.eq(sent.length, 0, 'a bot silent in that room stays silent: no refusal line for someone else\'s moderation');
    A.eq(got.length, 0, 'and nothing reaches the hub');
  }

  // ---- 1b. the hub: in an ADMITTED room "/deny @spammer" does not close it, "/allow @x" says nothing ----
  {
    const t = mkHub();
    t.store.saveChatRecord('-1001', { admittedOn: 'telegram' });
    await t.hub.onInbound(inbound(OWNER, '/deny @spammer'));
    await t.hub.onInbound(inbound(OWNER, '/allow @newmember'));
    await t.hub.onInbound(inbound('9', '/deny @spammer'));
    A.eq(t.store.getChatRecord('-1001').admittedOn, 'telegram', 'the room is still admitted');
    A.eq(t.sends, [], 'nothing was said into their conversation');
    A.eq(t.runs.length, 0, 'and nothing ran');
    await t.hub.onInbound(inbound(OWNER, '/deny@halcyonbot now'));
    A.eq(t.store.getChatRecord('-1001').admittedOn, '', 'an argument WITH our own @name still works');
    await t.hub.onInbound(inbound(OWNER, '/allow'));
    A.eq(t.store.getChatRecord('-1001').admittedOn, 'telegram', 'and a bare /allow re-admits');
    const dm = mkHub();
    await dm.hub.onInbound(inbound(OWNER, '/allow everyone', { chatId: 'c5', chatType: 'dm' }));
    A.ok(/for groups/.test((dm.sends[0] || {}).text || ''), 'a DM keeps its answer: ' + JSON.stringify(dm.sends));
  }

  A.report('channels.group-admission-guard');
})().catch(e => { console.error(e); process.exit(1); });
