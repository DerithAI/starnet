/* node test/channels.group-allow.test.js — group admission by the owner's /allow (2026-10-19).

   The adapter's group allow-list was plumbed through every channel module and never passed by the host, so every
   group message was dropped on every platform. Now a group is closed until the paired owner sends /allow IN it:
   the hub writes that onto the chat's own record and the adapter reads it per message. This pins each piece:

     A. the adapter's verdicts — a live allow-list read, fail-closed, and the narrow 'admit' carve-out
     B. dispatch — the owner's /allow reaches the hub marked admission-only; anyone else's gets one throttled line
        straight from the transport, never the hub
     C. the hub — /allow and /deny write the chat record (per CHANNEL), confirm truthfully, and an admission-only
        message can do nothing else
     D. the host seams — registry.wireChannel hands every generic channel the hub's read, makeTelegramAdapter
        forwards the wake words / observe / membership options it used to drop, and a relayed /allow never admits

   Fakes only: no network, no clock, no sidecar. The live proof is channels.telegram.group-allow.e2e.test.js. */
'use strict';
const A = require('./_assert.js');
const { makeChannelAdapter } = require('../sidecar/channels/adapter.js');
const { makeChannelHub, COMMANDS, menuCommands, commandNeedsOwner, parseCommand } = require('../sidecar/channels/hub.js');
const { wireChannel } = require('../sidecar/channels/registry.js');
const { makeTelegramAdapter } = require('../sidecar/channels/telegram.js');
const { admitRelayMessage } = require('../sidecar/channels/relay-admission.js');

const OWNER = '5';
function mkAdapter(opts) {
  const got = [], sent = [];
  let now = 1000;
  const ad = makeChannelAdapter(Object.assign({
    transport: { getUpdates: async () => [], send: async (chatId, text, o) => { sent.push({ chatId, text, o }); return { ok: true, messageId: 'm' + sent.length }; } },
    normalize: (r) => r, name: 'telegram', clock: { now: () => now },
    botUsername: 'halcyonbot', ownerUserId: OWNER,
    onInbound: (im) => got.push(im)
  }, opts || {}));
  return { ad, got, sent, tick: (ms) => { now += ms; } };
}
const group = (extra) => Object.assign({ chatId: '-1001', chatType: 'group', userId: '9', userName: 'Ana', text: 'hello', messageId: '1' }, extra);
const flush = () => new Promise(r => setTimeout(r, 0));

function fakeStore() {
  const recs = new Map();
  return {
    recs,
    loadHistory: () => [], appendTurn: () => [],
    getChatRecord: (c) => recs.get(String(c)),
    saveChatRecord: (c, patch) => { const m = Object.assign({}, recs.get(String(c)), patch); recs.set(String(c), m); return m; }
  };
}
function mkHub(over) {
  const sends = [], runs = [];
  const store = (over && over.store) || fakeStore();
  const hub = makeChannelHub(Object.assign({
    channel: 'telegram', store,
    runOnce: async (o) => { runs.push(o); o.emit('agent.run.end', { agentId: o.agentId, runId: o.runId, reason: 'done' }); },
    send: (c, t) => { sends.push({ chatId: String(c), text: t }); return Promise.resolve({ ok: true }); },
    secrets: () => ({ key: 'k', model: 'm', agentId: 'ultron' }), classify: () => false, newId: () => 'r' + (runs.length + sends.length),
    isOwner: (m) => String(m.userId) === OWNER,
    ownerTrusted: (m) => String(m.userId) === OWNER && m.chatType === 'dm'
  }, over || {}));
  return { hub, sends, runs, store };
}
let mid = 0;
const inbound = (userId, text, chatType, chatId, extra) => Object.assign({ channel: 'telegram', chatId: chatId || '-1001', chatType: chatType || 'group', userId, text, messageId: String(++mid), ts: 1 }, extra || {});

(async () => {
  // ---- A. adapter verdicts ------------------------------------------------------------------------------------
  {
    let open = new Set();
    const { ad } = mkAdapter({ allowedChats: (id) => open.has(id) });
    const adm = ad._internals.admission;
    A.eq(adm(group({ text: '@halcyonbot hi', mentions: ['halcyonbot'] })), 'drop', 'a group nobody admitted is dropped, even when it @mentions us');
    open.add('-1001');
    A.eq(adm(group({ text: '@halcyonbot hi', mentions: ['halcyonbot'] })), 'run', 'the allow-list is read PER MESSAGE: admitted a moment ago, answered now');
    A.eq(adm(group({ text: 'lunch?' })), 'drop', 'an admitted group still answers only when addressed');
    open = new Set();
    A.eq(adm(group({ text: '@halcyonbot hi', mentions: ['halcyonbot'] })), 'drop', '…and a /deny lands on the very next message too');

    A.eq(adm(group({ text: '/allow' })), 'admit', 'a bare /allow from a closed group is the admission verdict, never run');
    A.eq(adm(group({ text: '/deny' })), 'admit', 'so is /deny');
    A.eq(adm(group({ text: '/allow@halcyonbot', mentions: ['halcyonbot'] })), 'admit', '/allow@ourname is aimed at us');
    A.eq(adm(group({ text: '/ALLOW@HalcyonBot', mentions: ['halcyonbot'] })), 'admit', 'case does not matter');
    A.eq(adm(group({ text: '/allow@otherbot', mentions: ['otherbot'] })), 'drop', '/allow@anotherbot is not for us');
    A.eq(adm(group({ text: '/allow', forwarded: true })), 'drop', 'a FORWARDED /allow is a third party\'s words');
    A.eq(adm(group({ text: '/allow', channelPost: true, userId: '' })), 'drop', 'a broadcast post has no sender to check');
    A.eq(adm(group({ text: '/allow', edited: true })), 'drop', 'an edit of an old /allow is history, not a request');
    A.eq(adm(group({ text: '/allow', fromBot: true })), 'drop', 'another bot can never admit us');
    A.eq(adm(group({ text: '/allowance' })), 'drop', 'only the exact command word counts');
    A.eq(adm(group({ text: 'please /allow' })), 'drop', 'only a LEADING command counts');
    A.eq(adm(group({ text: '/status' })), 'drop', 'no other command passes a closed group');

    const { ad: nameless } = mkAdapter({ botUsername: '', allowedChats: () => false });
    A.eq(nameless._internals.admission(group({ text: '/allow@halcyonbot', mentions: ['halcyonbot'] })), 'drop', 'while our own name is unknown an @-suffixed /allow is refused, not guessed');
    A.eq(nameless._internals.admission(group({ text: '/allow' })), 'admit', 'a bare /allow still works before getMe answers');

    const { ad: broken } = mkAdapter({ allowedChats: () => { throw new Error('store hiccup'); } });
    A.eq(broken._internals.admission(group({ text: '@halcyonbot hi', mentions: ['halcyonbot'] })), 'drop', 'an allow-list read that THROWS fails closed');
    const { ad: listed } = mkAdapter({ allowedChats: ['-1001'] });
    A.eq(listed._internals.admission(group({ text: '@halcyonbot hi', mentions: ['halcyonbot'] })), 'run', 'a fixed list (the unit-test form) still works');
    A.eq(listed._internals.admission(group({ text: '/allow' })), 'run', 'an /allow in an ALREADY-admitted group is an ordinary command for the hub');
    A.eq(listed.chatInfo('-1001').type, 'group', 'chatInfo reads the same allow-list');
  }

  // ---- B. dispatch: owner through, everyone else one throttled line ------------------------------------------
  {
    const { ad, got, sent, tick } = mkAdapter({ allowedChats: () => false });
    ad._internals.dispatch({ offset: 1, message: group({ userId: OWNER, text: '/allow@halcyonbot', mentions: ['halcyonbot'] }) });
    A.eq(got.length, 1, 'the owner\'s /allow in a closed group reaches the hub');
    A.eq(got[0].admissionOnly, true, '…marked admission-only, so the hub can do that and nothing else');
    A.eq(got[0].chatType, 'group', '…as a group message');

    ad._internals.dispatch({ offset: 2, message: group({ userId: '9', text: '/allow', messageId: '7', threadId: '3' }) });
    await flush();
    A.eq(got.length, 1, 'a non-owner\'s /allow never reaches the hub (no inbox, no outbox, no run)');
    A.eq(sent.length, 1, 'a non-owner\'s /allow gets exactly one reply');
    A.ok(/only the owner who paired me/i.test(sent[0].text) && sent[0].text.indexOf('\n') === -1, 'the refusal is one line naming the owner rule');
    A.eq(sent[0].o, { threadId: '3', replyTo: '7' }, 'the refusal answers in the topic it was asked, as a reply');
    A.ok(ad._internals.wasOurs('-1001', 'm1'), 'the refusal is remembered as ours (echo guard)');
    ad._internals.dispatch({ offset: 3, message: group({ userId: '9', text: '/deny', messageId: '8' }) });
    await flush();
    A.eq(sent.length, 1, 'a second refusal in the same chat within a minute is NOT sent (no amplifier)');
    ad._internals.dispatch({ offset: 4, message: group({ userId: '9', text: '/allow', messageId: '9', chatId: '-2002' }) });
    await flush();
    A.eq(sent.length, 2, 'another chat gets its own refusal');
    tick(61000);
    ad._internals.dispatch({ offset: 5, message: group({ userId: '9', text: '/allow', messageId: '10' }) });
    await flush();
    A.eq(sent.length, 3, 'after a minute the first chat may be told again');
    A.eq(ad._internals.offset, 6, 'every one of them was acknowledged');

    const { ad: unpaired, got: g2, sent: s2 } = mkAdapter({ ownerUserId: '', allowedChats: () => false });
    unpaired._internals.dispatch({ offset: 1, message: group({ userId: OWNER, text: '/allow' }) });
    await flush();
    A.eq(g2.length, 0, 'an UNPAIRED bot has no owner — a group message never claims one, so nobody can admit');
    A.eq(s2.length, 1, '…and the sender is told so');
    A.eq(unpaired._internals.owner, '', 'the group /allow did not claim ownership');
  }

  // ---- C. the hub: /allow /deny write the chat record and confirm truthfully --------------------------------
  {
    const names = COMMANDS.map(c => c.command);
    A.ok(names.indexOf('allow') >= 0 && names.indexOf('deny') >= 0, 'allow and deny are in the hub\'s one command table');
    const menu = menuCommands().map(c => c.command);
    A.ok(menu.indexOf('allow') >= 0 && menu.indexOf('deny') >= 0, '…so Telegram\'s "/" menu publishes both');
    A.ok(names.every(n => /^[a-z0-9_]{1,32}$/.test(n)), 'command names keep Telegram\'s grammar');
    A.eq(commandNeedsOwner(parseCommand('/allow@halcyonbot')), true, '/allow is owner-only in every form');
    A.eq(commandNeedsOwner(parseCommand('/deny')), true, '/deny is owner-only in every form');

    const t = mkHub();
    A.eq(t.hub.chatAdmitted('-1001'), false, 'nothing is admitted by default');
    await t.hub.onInbound(inbound(OWNER, '/allow@halcyonbot', 'group', '-1001', { admissionOnly: true }));
    A.eq(t.store.recs.get('-1001').admittedOn, 'telegram', 'the owner\'s /allow writes the CHANNEL onto the chat record');
    A.eq(t.hub.chatAdmitted('-1001'), true, 'chatAdmitted reads it back');
    A.ok(/admitted/i.test(t.sends[0].text) && /\/deny/.test(t.sends[0].text), 'the confirmation says it is admitted and how to undo it');
    A.ok(/real run/i.test(t.sends[0].text), 'the confirmation says every answer is a real run (members can now spend)');
    A.eq(t.runs.length, 0, 'admitting a group spends no model call');

    await t.hub.onInbound(inbound(OWNER, '/allow', 'group', '-1001'));
    A.ok(/already admitted/i.test(t.sends[1].text), 'a second /allow says it is already admitted');
    await t.hub.onInbound(inbound('9', '/deny', 'group', '-1001'));
    A.ok(/owner-only/.test(t.sends[2].text), 'a member\'s /deny in the admitted group is refused');
    A.eq(t.hub.chatAdmitted('-1001'), true, '…and changes nothing');
    await t.hub.onInbound(inbound(OWNER, '/deny', 'group', '-1001'));
    A.eq(t.hub.chatAdmitted('-1001'), false, 'the owner\'s /deny closes the group');
    A.ok(/\/allow/.test(t.sends[3].text), 'the /deny confirmation says how to come back');
    await t.hub.onInbound(inbound(OWNER, '/deny', 'group', '-1001', { admissionOnly: true }));
    A.ok(/not answering/i.test(t.sends[4].text), 'a /deny in a closed group says so instead of pretending');
    await t.hub.onInbound(inbound(OWNER, '/allow', 'dm', 'c-5'));
    A.ok(/for groups/i.test(t.sends[5].text), 'in a DM /allow explains it is for groups');
    A.ok(!(t.store.recs.get('c-5') || {}).admittedOn, '…and stores nothing');

    // an admission-only message may do exactly that and nothing else
    const n = t.sends.length;
    await t.hub.onInbound(inbound(OWNER, 'run the deploy', 'group', '-3003', { admissionOnly: true }));
    await t.hub.onInbound(inbound(OWNER, '/status', 'group', '-3003', { admissionOnly: true }));
    await t.hub.onInbound(inbound(OWNER, '/allow', 'group', '-3003', { admissionOnly: true, forwarded: true }));
    A.eq(t.sends.length, n, 'an admission-only message that is not /allow or /deny gets no reply');
    A.eq(t.runs.length, 0, '…and starts no run');
    A.eq(t.hub.chatAdmitted('-3003'), false, '…and a FORWARDED /allow admits nothing');

    // privacy mode ON: a name is not an @mention, so the confirmation must not promise name-calling
    const blind = mkHub({ canReadAllGroupMessages: () => false });
    await blind.hub.onInbound(inbound(OWNER, '/allow', 'group', '-1001', { admissionOnly: true }));
    A.ok(!/by name/.test(blind.sends[0].text), 'with privacy mode on the confirmation does not promise wake words');
    const seeing = mkHub({ canReadAllGroupMessages: () => true });
    await seeing.hub.onInbound(inbound(OWNER, '/allow', 'group', '-1001', { admissionOnly: true }));
    A.ok(/by name/.test(seeing.sends[0].text), 'with privacy mode off it does');

    // a failed write is never confirmed
    const bad = mkHub({ store: Object.assign(fakeStore(), { saveChatRecord: () => { throw new Error('disk full'); } }) });
    await bad.hub.onInbound(inbound(OWNER, '/allow', 'group', '-1001', { admissionOnly: true }));
    A.ok(/Could not save/.test(bad.sends[0].text) && /not admitted/.test(bad.sends[0].text), 'a failed save says the group is still not admitted');
    A.eq(bad.hub.chatAdmitted('-1001'), false, '…and it is not');

    // one chat map is shared by the station bot and the Discord/Slack/Matrix/Signal hubs: admission is per CHANNEL
    const shared = fakeStore();
    const tgHub = mkHub({ store: shared, channel: 'telegram' });
    const dcHub = mkHub({ store: shared, channel: 'discord' });
    await tgHub.hub.onInbound(inbound(OWNER, '/allow', 'group', '42', { admissionOnly: true }));
    A.eq(tgHub.hub.chatAdmitted('42'), true, 'admitted on telegram');
    A.eq(dcHub.hub.chatAdmitted('42'), false, 'the same chat id on discord is NOT admitted by telegram\'s /allow');

    // the "/" menu sends '/cmd@thebot' in a group. The 350ms text batcher took that for chat, so the same member's
    // next bubble was glued onto the command as its ARGUMENT and never ran (found by the e2e's restart replay).
    const batched = mkHub({ textBatchWaitMs: 40, now: () => 1 });
    const cmdDone = batched.hub.onInbound(inbound('9', '/status@halcyonbot', 'group', '-1001'));
    const chatDone = batched.hub.onInbound(inbound('9', '@halcyonbot are you there?', 'group', '-1001'));
    await Promise.all([cmdDone, chatDone]);
    A.ok(batched.sends.some(s => /Idle|Working/.test(s.text)), 'an @-suffixed command is answered as a command');
    A.eq(batched.runs.length, 1, 'the bubble right after it still runs — it is not swallowed as the command\'s argument');
  }

  // ---- D. host seams -----------------------------------------------------------------------------------------
  {
    // registry.wireChannel: every generic channel (discord/slack/matrix/signal) gets the hub's live read
    let built = null;
    const desc = { id: 'slack', maxMessageLength: 4000, makeAdapter: (o) => { built = o; return { send: async () => ({ ok: true }), _internals: { owner: '' } }; } };
    const fakeHub = { onInbound() {}, onCallback() {}, onStatus() {}, chatAdmitted: (id) => id === 'C1' };
    wireChannel(desc, { makeHub: () => fakeHub, hub: {}, adapter: {} });
    A.eq(typeof built.allowedChats, 'function', 'wireChannel hands the adapter an allow-list');
    A.eq([built.allowedChats('C1'), built.allowedChats('C2')], [true, false], '…and it is the hub\'s own chatAdmitted');
    const mine = ['X'];
    wireChannel(desc, { makeHub: () => fakeHub, hub: {}, adapter: { allowedChats: mine } });
    A.eq(built.allowedChats, mine, 'a caller\'s own allow-list still wins');

    // makeTelegramAdapter used to DROP these three options on the floor
    const memberships = [];
    const tgAd = makeTelegramAdapter({
      fetch: async () => ({ ok: true, status: 200, json: async () => ({ ok: true, result: [] }) }), token: 'T', clock: { now: () => 1 },
      ownerUserId: OWNER, botUsername: 'halcyonbot',
      mentionPatterns: () => ['Halcyon'],
      observeUnmentioned: (id) => id === '-1001',
      allowedChats: (id) => id === '-1001',
      onMembership: (ev) => memberships.push(ev),
      onInbound: () => {}
    });
    A.eq(tgAd._internals.wakeWords(), ['halcyon'], 'the Telegram adapter now receives the wake words');
    A.eq(tgAd._internals.admission(group({ text: 'Halcyon, are you there?' })), 'run', 'calling the bot by name in an admitted group runs');
    A.eq(tgAd._internals.admission(group({ text: 'lunch at noon?' })), 'observe', '/mention observe now reaches the Telegram adapter');
    A.eq(tgAd._internals.admission(group({ text: 'lunch at noon?', chatId: '-2002' })), 'drop', 'a group nobody admitted stays dropped');
    tgAd._internals.dispatch({ update_id: 50, my_chat_member: { chat: { id: -1001, type: 'supergroup' }, from: { id: 9 }, new_chat_member: { status: 'kicked', user: { id: 1 } } } });
    A.eq(memberships.length, 1, 'a my_chat_member update now reaches onMembership (being kicked was invisible)');
    A.eq(memberships[0] && memberships[0].status, 'kicked', '…with its status');

    // a signed relay body can CLAIM the owner's id, so it may never use the admission carve-out
    const { ad } = mkAdapter({ allowedChats: () => false });
    const relayed = admitRelayMessage({ chatId: '-1001', chatType: 'group', userId: OWNER, text: '/allow' }, ad);
    A.eq(relayed.ok, false, 'a relayed /allow from a closed group is refused');
    A.eq(relayed.code, 403, '…with 403');
    const { ad: openAd } = mkAdapter({ allowedChats: () => true });
    A.eq(admitRelayMessage({ chatId: '-1001', chatType: 'group', userId: '9', text: '@halcyonbot hi', mentions: ['halcyonbot'] }, openAd).ok, false,
      'relay-admission copies no mentions field, so an admitted group still needs a real address (unchanged)');
    A.eq(admitRelayMessage({ chatId: '-1001', chatType: 'group', userId: '9', text: '/status' }, openAd).ok, true, 'a relayed command in an ADMITTED group is admitted');
  }

  A.report('channels.group-allow.test');
})().catch(e => { console.log('FAIL: threw ' + (e && e.stack || e)); process.exit(1); });
