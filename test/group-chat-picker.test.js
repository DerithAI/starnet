'use strict';
// Execute the production button, picker and @ menu with a small DOM and controlled HTTP responses.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/app/group-chat.js'), 'utf8');
class Element {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.value = ''; this.style = { setProperty() {} }; this.classList = { add() {}, toggle() {}, contains: () => false }; }
  get isConnected() { return this.attached || !!this.parentElement?.isConnected; }
  setAttribute(k, v) { this.attrs[k] = v; if (k === 'id') this.id = v; if (k === 'data-agent-name') this.dataset.agentName = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelectorAll() { return []; }
  querySelector() { return null; }
  addEventListener(k, fn) { this.events[k] = fn; }
  append(...nodes) { for (const n of nodes) { const e = typeof n === 'string' ? Object.assign(new Element('#text'), { textContent: n }) : n; e.parentElement = this; this.children.push(e); } }
  replaceChildren(...nodes) { for (const e of this.children) e.parentElement = null; this.children = []; this.textContent = ''; this.append(...nodes); }
  before(node) { this.parentElement.append(node); }
  insertBefore(node, ref) { node.remove(); const i = ref ? this.children.indexOf(ref) : -1; node.parentElement = this; if (i < 0) this.children.push(node); else this.children.splice(i, 0, node); return node; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  remove() { if (this.parentElement) this.parentElement.children = this.parentElement.children.filter(e => e !== this); this.parentElement = null; }
}
const walk = e => [e, ...e.children.flatMap(walk)];
const text = e => (e.textContent || '') + e.children.map(text).join(' ');
const settle = async () => { for (let n = 0; n < 60; n++) await Promise.resolve(); };
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const roster = [{ id: 'agent', name: 'Lead' }, { id: 'peer', name: 'Peer' }, { id: 'third', name: 'Third' }];
const ok = result => ({ status: 200, ok: true, json: async () => ({ ok: true, result }) });
const success = () => ok({ roster, groups: [] });
async function boot({ general = false, crew = roster } = {}) {
  const body = new Element('body'); body.attached = true;
  const head = new Element('head'); head.attached = true;
  for (const id of ['comms-idbar', 'chat-input', 'chat-log', 'chat-queued', 'chat-inputrow']) { const e = new Element('div'); e.id = id; body.append(e); }
  const find = id => walk(body).find(e => e.id === id);
  let request = async () => success(), push = async () => {}, onClose, opens = 0;
  const sent = [], opened = [], workstreams = new Map([['direct', { id: 'direct', agentId: 'agent', history: [{ role: 'user', content: 'hi' }], title: 'Direct' }]]);
  const document = { body, head, createElement: tag => new Element(tag), createTextNode: t => Object.assign(new Element('#text'), { textContent: t }), getElementById: find };
  const ctx = vm.createContext({ document, console, crypto: { randomUUID: () => 'test' }, clearTimeout() {}, setTimeout() {}, queueMicrotask, Chat: {},
    fetch: (url, init) => { const b = init && init.body ? JSON.parse(init.body) : null; sent.push({ url, body: b }); return request(url, b); },
    App: { pushRoster: () => push(), agents: () => crew, persist() {}, refreshRail() {}, openWorkstream: id => opened.push(id) },
    StationUI: { toggleTerm(key, title, build, opts) { opens++; const shell = new Element('div'); shell.id = 'test-window'; body.append(shell); build(shell); onClose = opts.onClose; }, closeTerm() { onClose?.(); find('test-window')?.remove(); }, notify() {} },
    Workstreams: { get: id => workstreams.get(id), adopt: o => { const w = { ...o }; workstreams.set(o.id, w); return w; }, generalId: () => general ? 'direct' : 'general-home' } });
  vm.runInContext(source + '\nglobalThis.GroupChat = GroupChat;\nGroupChat.bind({id:"direct",agentId:"agent",history:[{role:"user",content:"hi"}],title:"Direct"});', ctx);
  await settle();
  const button = label => walk(body).find(e => e.tagName === 'button' && (e.attrs['aria-label'] === label || text(e).trim() === label));
  return { find, ctx, sent, opened, workstreams,
    button,
    click: async label => { const b = button(label); assert.ok(b, 'button exists: ' + label); assert.ok(!('disabled' in b.attrs), 'button is enabled: ' + label); b.events.click(); await settle(); },
    type: async value => { const input = find('chat-input'); input.value = value; input.events.input(); await settle(); },
    key: async key => { const e = { key, shiftKey: false, isComposing: false, prevented: false, preventDefault() { this.prevented = true; }, stopPropagation() {} }; const handled = ctx.GroupChat.mentionKey(e); await settle(); return { handled, prevented: e.prevented }; },
    request(fn) { request = fn; }, push(fn) { push = fn; }, get opens() { return opens; } };
}
const group = (members, extra = {}) => ({ id: 'direct', title: 'Direct', members, leadId: 'agent', revision: 3, paused: false, messages: [], turns: [], artifacts: [], questions: [], ...extra });
(async () => {
  // ---- loading, failure and cancellation (unchanged contract) ----
  const app = await boot();
  const pending = deferred(); app.request(() => pending.promise);
  await app.click('+ Add agents');
  assert.ok(app.find('gc-picker')?.isConnected, 'picker is visible before the backend responds');
  assert.match(text(app.find('gc-picker')), /Loading agents/);
  await app.click('+ Add agents'); assert.equal(app.opens, 1, 'rapid clicks open only one picker');
  pending.resolve({ status: 404, ok: false, json: async () => { throw new SyntaxError('not found'); } }); await settle();
  assert.match(text(app.find('gc-picker')), /Group chat is unavailable on this server/);
  assert.ok(walk(app.find('gc-picker')).some(e => e.attrs.role === 'alert'), 'failure is announced inside the visible picker');
  app.request(async () => success()); await app.click('RETRY');
  assert.match(text(app.find('gc-picker')), /Add to this chat/);
  await app.click('DONE'); assert.equal(app.find('gc-picker'), undefined);
  for (const status of [401, 403, 500]) {
    app.request(async () => ({ status, ok: false, json: async () => { throw new SyntaxError('invalid JSON'); } }));
    await app.click('+ Add agents');
    assert.match(text(app.find('gc-picker')), status === 500 ? /server could not load group chat/ : /Reconnect to this station/);
    await app.click('CANCEL');
  }
  app.push(async () => { throw new Error('Roster sync failed'); });
  await app.click('+ Add agents'); assert.match(text(app.find('gc-picker')), /Roster sync failed/); await app.click('CANCEL');
  app.push(async () => {});
  const late = deferred(); app.request(() => late.promise);
  await app.click('+ Add agents'); await app.click('CANCEL'); late.resolve(success()); await settle();
  assert.equal(app.find('gc-picker'), undefined, 'late success cannot reopen a canceled picker');

  // ---- + ADD SAVES AT ONCE: nothing is listed IN THIS CHAT until the backend confirmed it ----
  let members = ['agent'], rev = 3;
  const create = deferred();
  app.request((url, b) => {
    if (!b) return Promise.resolve(url.includes('?id=') ? ok(group(members, { revision: rev })) : success());
    if (b.op === 'create') return create.promise;
    if (b.op === 'invite') { members = [...members, b.agentId]; rev++; return Promise.resolve(ok(group(members, { revision: rev }))); }
    if (b.op === 'configure') { if (b.revision !== rev) return Promise.resolve({ status: 409, ok: false, json: async () => ({ ok: false, error: 'Session changed; refresh and try again' }) }); members = b.members; rev++; return Promise.resolve(ok(group(members, { revision: rev }))); }
    throw new Error('unexpected op ' + b.op);
  });
  await app.click('+ Add agents');
  assert.match(text(app.find('gc-picker')), /\+ ADD starts a group chat/, 'a direct chat says what + ADD will do');
  assert.ok(!app.button('START GROUP CHAT') && !app.button('SAVE'), 'there is no separate save step to miss');
  await app.click('Add Peer to this chat');
  const createReq = app.sent.filter(s => s.body && s.body.op === 'create').at(-1);
  assert.ok(createReq, '+ ADD posts the group to the backend immediately');
  assert.deepEqual([...createReq.body.members], ['agent', 'peer']);
  assert.equal(createReq.body.id, 'direct', 'a non-General chat converts in place');
  assert.equal(createReq.body.conversionKey, 'direct');
  assert.match(text(app.find('gc-picker')), /adding Peer/, 'the in-flight add says so');
  assert.ok(!app.button('Remove Peer from this chat'), 'Peer is NOT listed in this chat before the backend answered');
  members = ['agent', 'peer']; create.resolve(ok(group(members))); await settle();
  assert.ok(app.button('Remove Peer from this chat'), 'once saved, Peer is in this chat');
  assert.match(text(app.find('gc-picker')), /Peer joined · saved/);
  assert.equal(app.workstreams.get('direct').conversationMode, 'group', 'the session became a group');
  assert.deepEqual([...app.ctx.GroupChat.membersOf('direct')], ['agent', 'peer']);
  await app.click('Add Third to this chat');
  assert.equal(app.sent.filter(s => s.body && s.body.op === 'invite').at(-1).body.agentId, 'third', 'the next + ADD invites into the existing group');
  assert.match(text(app.find('gc-picker')), /Third joined · saved/);
  await app.click('Remove Peer from this chat');
  assert.deepEqual([...app.sent.filter(s => s.body && s.body.op === 'configure').at(-1).body.members], ['agent', 'third'], '✕ REMOVE saves at once');
  assert.match(text(app.find('gc-picker')), /Peer left · saved/);
  assert.ok(!app.button('Remove Lead from this chat'), 'the lead cannot be removed');
  await app.click('DONE');

  // ---- the General home stream is never converted: a fresh group opens beside it ----
  const home = await boot({ general: true });
  home.request((url, b) => {
    if (!b) return Promise.resolve(success());
    if (b.op === 'create') return Promise.resolve(ok({ ...group(b.members), id: b.id, title: b.title }));
    throw new Error('unexpected op ' + b.op);
  });
  await home.click('+ Add agents'); await home.click('Add Peer to this chat');
  const homeCreate = home.sent.find(s => s.body && s.body.op === 'create');
  assert.notEqual(homeCreate.body.id, 'direct', 'General keeps its id');
  assert.equal(homeCreate.body.conversionKey, undefined, 'General is not converted');
  assert.equal(homeCreate.body.history, undefined, 'General history is not copied into the group');
  assert.equal(homeCreate.body.title, 'Lead + Peer');
  assert.deepEqual(home.opened, [homeCreate.body.id], 'COMMS opens the new group');
  // org(P27): in General the @ row says the pick opens a NEW group beside General (General is never converted)
  const homeAt = await boot({ general: true });
  await homeAt.type('ask @pe');
  const homeRows = walk(homeAt.find('gc-mentions')).filter(e => e.attrs.role === 'option');
  assert.equal(homeRows.length, 1);
  assert.match(text(homeRows[0]), /opens a group chat with Lead beside General/, 'the General @ row names the group that opens beside it');
  assert.doesNotMatch(text(homeRows[0]), /starts a group with/, 'General never reads as converting');

  // ---- @ in a DIRECT chat: lists the crew, keyboard picks, picking starts the group ----
  const at = await boot();
  let atMembers = null;
  at.request((url, b) => {
    if (!b) return Promise.resolve(url.includes('?id=') && atMembers ? ok(group(atMembers)) : success());
    if (b.op === 'create') { atMembers = b.members; return Promise.resolve(ok(group(b.members))); }
    throw new Error('unexpected op ' + b.op);
  });
  await at.type('can you ask @pe');
  const rows = walk(at.find('gc-mentions')).filter(e => e.attrs.role === 'option');
  assert.equal(rows.length, 1, 'the @ menu lists matching crew in a direct chat');
  assert.match(text(rows[0]), /Peer/); assert.match(text(rows[0]), /starts a group with Lead/);
  assert.equal(rows[0].attrs['aria-selected'], 'true', 'the first match is highlighted');
  const enter = await at.key('Enter');
  assert.ok(enter.handled && enter.prevented, 'Enter picks from the open @ menu instead of sending');
  const atCreate = at.sent.find(s => s.body && s.body.op === 'create');
  assert.deepEqual([...atCreate.body.members], ['agent', 'peer'], 'picking someone new starts the group with them');
  assert.equal(at.find('chat-input').value, 'can you ask @Peer ', 'the handle is written into the message');
  assert.equal(at.find('gc-mentions').children.length, 0, 'the menu closes after a pick');
  assert.equal((await at.key('Enter')).handled, false, 'with the menu closed Enter is the composer\'s again');
  await at.type('@zz'); assert.equal(at.find('gc-mentions').children.length, 0, 'no match, no menu');
  await at.type('@');
  const inGroup = walk(at.find('gc-mentions')).filter(e => e.attrs.role === 'option').map(text).join(' | ');
  assert.match(inGroup, /@all.*everyone here/, 'in the group the menu offers @all');
  assert.match(inGroup, /Peer\s+in this chat/, 'members are marked as in this chat');
  assert.match(inGroup, /Third\s+adds to this chat/, 'the rest of the crew can be pulled in');
  assert.equal((await at.key('Escape')).handled, true); assert.equal(at.find('gc-mentions').children.length, 0, 'Esc closes the @ menu');
  await at.type('/help @pe'); assert.equal(at.find('gc-mentions').children.length, 0, 'a slash command never opens the @ menu');

  // ---- @handles typed out in a direct chat resolve exactly or not at all ----
  const T = (t, ws = { id: 'x', agentId: 'agent' }) => [...at.ctx.GroupChat.mentionTargets(t, ws)];
  assert.deepEqual(T('@peer take a look'), ['peer'], 'a stable id resolves');
  assert.deepEqual(T('hey @PEER and @third'), ['peer', 'third'], 'a name resolves case-insensitively');
  assert.deepEqual(T('@lead hi'), [], 'the agent you are already talking to is not pulled in');
  assert.deepEqual(T('mail me@peer.dev'), [], 'an email is not a mention');
  assert.deepEqual(T('`@peer` and\n> @third quoted'), [], 'code and quotes are not mentions');
  assert.deepEqual(T('@nobody hi'), [], 'an unknown handle is left alone');
  assert.deepEqual(T('@peer', { id: 'g', agentId: 'agent', conversationMode: 'group' }), [], 'a group resolves its own mentions on the backend');
  // ---- a stale @ menu (the box was sent/cleared) closes and gives the key back: Esc must reach the run's interrupt ----
  await at.type('ping @pe'); assert.ok(at.find('gc-mentions').children.length > 0);
  at.find('chat-input').value = '';   // what a SEND-chip send leaves behind
  assert.equal((await at.key('Escape')).handled, false, 'Esc on a stale menu falls through to the composer (interrupt)');
  assert.equal(at.find('gc-mentions').children.length, 0, 'and the stale menu is gone');

  // ---- "@SCOUT" is never written when another name extends it ("@SCOUT " + "2 more" would read as SCOUT 2) ----
  const scouts = await boot({ crew: [{ id: 'agent', name: 'Lead' }, { id: 'scout', name: 'SCOUT' }, { id: 'scout-2', name: 'SCOUT 2' }] });
  scouts.request((url, b) => Promise.resolve(!b ? success() : ok(group(b.members))));
  await scouts.type('@scout');
  const scoutRow = walk(scouts.find('gc-mentions')).find(e => e.attrs.role === 'option' && /^\s*SCOUT\s/.test(text(e)) && !/SCOUT 2/.test(text(e)));
  assert.ok(scoutRow, 'SCOUT is offered'); scoutRow.events.click(); await settle();
  assert.equal(scouts.find('chat-input').value, '@scout ', 'the stable id is written, not a name another name extends');
  const S = t => [...scouts.ctx.GroupChat.mentionTargets(t, { id: 'x', agentId: 'agent' })];
  assert.deepEqual(S('@SCOUT 2 more ideas'), ['scout-2'], 'a typed handle resolves to the LONGEST crew name, as the backend will');
  assert.deepEqual(S('@SCOUT, then'), ['scout'], 'the shorter name still resolves on its own');

  // ---- two Enters during one conversion make ONE group ----
  const twice = await boot({ general: true });
  let creates = 0; const gate = deferred();
  twice.request((url, b) => { if (!b) return Promise.resolve(success()); if (b.op === 'create') { creates++; return gate.promise.then(() => ok({ ...group(b.members), id: b.id })); } throw new Error('unexpected ' + b.op); });
  const one = twice.ctx.GroupChat.startWith(['peer']), two = twice.ctx.GroupChat.startWith(['peer']);
  gate.resolve(); const [g1, g2] = await Promise.all([one, two]);
  assert.equal(creates, 1, 'a second Enter joins the conversion in flight'); assert.equal(g1, g2);
  // ---- NO SENTENCES UNDER TILES (walk 10-14 #9): a picker row is portrait + name; its description is the row's hover tip ----
  const tipped = await boot({ crew: [{ id: 'agent', name: 'Lead', role: 'overseer' }, { id: 'peer', name: 'Peer', role: 'Answers with every claim sourced' }, { id: 'third', name: 'Third' }] });
  tipped.request(async () => ok({ roster: [{ id: 'agent', name: 'Lead' }, { id: 'peer', name: 'Peer' }, { id: 'third', name: 'Third' }], groups: [] }));
  await tipped.click('+ Add agents');
  const rowOf = id => walk(tipped.find('gc-picker')).find(e => e.attrs.role === 'listitem' && e.attrs['data-agent-name'] === id);
  const peerRow = rowOf('peer');
  assert.ok(peerRow, 'the picker lists Peer');
  assert.ok(!walk(peerRow).some(e => /\bgc-tag\b/.test(e.className || '')), 'no description line is built under the name');
  assert.ok(!/Answers with every claim sourced/.test(text(peerRow)), 'the sentence is not printed on the row');
  assert.equal(peerRow.attrs.title, 'Answers with every claim sourced', 'the description is the row\'s hover tip (adopted into the station tooltip)');
  assert.equal(peerRow.attrs['aria-description'], 'Answers with every claim sourced', 'and is still read to a screen reader');
  assert.equal(rowOf('third').attrs.title, undefined, 'no description, no tip (never an invented job title)');
  assert.match(text(tipped.find('gc-picker')), /Talk to one agent with/, 'the how-to line is kept (simplify = organization, never removal)');
  await tipped.click('DONE');
  // the picker fills its window and never overflows it: the lists flex, the how-to line and the footer stay in the flow
  const pickerCss = (source.match(/\.gc-picker\{[^}]*\}/) || [''])[0];
  assert.match(pickerCss, /height:100%/, 'the picker is exactly its window\'s height (min-height:100% let it overflow under its sticky footer)');
  assert.doesNotMatch(pickerCss, /min-height:100%/, 'no min-height:100% that grows the picker past its window');
  assert.match(source, /\.gc-empty:empty\{display:none\}/, 'an empty "whole crew is here" slot takes no room from the add list');
  /* the ADD list keeps a floor of TWO rows (review 10-14: at min-height:0 a 5-member group's add list was 1.3 rows at
     1440x900 and none at all on a window ~80px shorter — 1366x768, a larger TEXT SIZE, a dragged picker). The members list
     gives way first, down to one row; below both floors the window body scrolls with the how-to line and footer in the flow. */
  const outRule = (source.match(/\.gc-sect\.out\{[^}]*\}/) || [''])[0], inRule = (source.match(/\.gc-sect\.in\{[^}]*\}/) || [''])[0];
  assert.match(outRule, /min-height:calc\(var\(--gc-head-h\) \+ 2 \* var\(--gc-row-h\) \+ 2px\)/, 'the add list never shrinks below its heading and two agents');
  assert.match(inRule, /flex:0 1 auto/, 'the members list gives way when the window is short');
  assert.match(inRule, /min-height:calc\(var\(--gc-head-h\) \+ var\(--gc-row-h\) \+ 2px\)/, 'but never below its heading and one agent');
  // the row height the floors count in is the row's real height: the 38px portrait plus its padding and its 1px rule
  const thumbH = +(source.match(/thumbHTML\(.*?, 32, (\d+), 'gc-av'\)/) || [])[1];
  const basePad = +((source.match(/\.gc-row\{[^}]*padding:(\d+)px/) || [])[1]);
  const glassCss = fs.readFileSync(path.join(__dirname, '../frontend/css/glass-comms.css'), 'utf8');
  const glassPad = +((glassCss.match(/body\.glass-demo \.gc-picker \.gc-row \{[^}]*padding: (\d+)px/) || [])[1]);
  assert.equal(+((source.match(/\.gc-picker\{[^}]*--gc-row-h:(\d+)px/) || [])[1]), thumbH + 2 * basePad + 1, 'the base row height the floors count in');
  assert.equal(+((source.match(/body\.glass-demo \.gc-picker\{--gc-row-h:(\d+)px/) || [])[1]), thumbH + 2 * glassPad + 1, 'the glass row (11px padding) height the floors count in');
  assert.match(source, /\.gc-sect-h\{[^}]*line-height:18px/, 'the section heading has a fixed line the floors count in');
  assert.match(source, /--gc-head-h:22px/, 'the heading is its 18px line plus its 4px gap');
  assert.doesNotMatch((source.match(/\.gc-picker-footer\{[^}]*\}/) || [''])[0], /position:sticky/, 'the footer sits in the flow under the how-to line, never stuck over text that scrolls behind its 95%-alpha panel');
  // the picker opens tall enough to show its roster, like the other pick-from windows (an explicit drag still wins)
  assert.match(source, /className: 'gc-picker-win'/, 'the ADD AGENTS window names itself to the dock');
  const glass = fs.readFileSync(path.join(__dirname, '../frontend/app/glass-demo.js'), 'utf8');
  assert.match(glass, /const roster = w\.classList\.contains\('gc-picker-win'\)/, 'the dock knows the picker is a roster');
  assert.match(glass, /roster \? Math\.max\(available \* \.8, rosterNeed\)/, 'and opens it at 80% of the band, not the 56% that showed one and a half agents — or taller, to hold its floors');
  // a short screen (1366x768): at 80% the floors overflowed by 18px and DONE sat under the fold; once the roster is drawn the
  // dock re-seats the window to the height its floors need (an explicit drag still wins, a short band still caps it)
  assert.match(glass, /const rosterNeed = rosterBody \? w\.offsetHeight - rosterBody\.clientHeight \+ rosterBody\.scrollHeight : 0;/, 'the dock reads what the roster still needs from its own overflow');
  assert.match(source, /if \(search\) search\.addEventListener\('input', render\);\s*render\(\);\s*const win = dialog\.closest \? dialog\.closest\('\.term'\) : null;\s*if \(win && typeof win\._fitDockedSheet === 'function'\) win\._fitDockedSheet\(\);/, 'the picker asks the dock to re-seat it once its roster is drawn');
  // tiny text (walk 10-14 #14): the footer status, section heads, how-to line and the lead tag read at the 14px glass floor
  for (const sel of ['.gc-sect-h', '.gc-picker-footer .gc-delta', '.gc-hint', '.gc-row .gc-lead']) {
    const rule = (source.match(new RegExp(sel.replace(/[.]/g, '\\.').replace(/ /g, ' ') + '\\{[^}]*\\}')) || [''])[0];
    assert.match(rule, /font-size:var\(--sn-type-meta,14px\)/, sel + ' reads at 14px (was 11-13px)');
  }

  console.log('group-chat-picker: loading, failure, cancellation, + ADD/✕ REMOVE save at once, nothing claimed before the backend, General never converted, @ menu in a direct chat with keyboard pick, exact @handle resolution PASS');
})().catch(e => { console.error(e); process.exitCode = 1; });
