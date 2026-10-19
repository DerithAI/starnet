/* node test/group-stop-truth.test.js — STOP in a GROUP chat ends the waiting approval honestly and keeps the run's narration
   readable (live walk with a real model, 2026-10-14).

   Found on the 0.13.5 candidate: the lead reached an approval card (loop.create), the Commander pressed STOP, and
     · the approval card simply disappeared — no retire line (one-on-one says "■ the run ended before an answer — nothing
       was approved");
     · the run's whole narration collapsed to its LAST sentence ("Good. Now I can create the loop:") plus
       "partial · work did not complete" — everything it had said before was gone from the transcript.

   A. the sidecar (sidecar/group-sessions.js, real coordinator, injected runner): a stop while an approval waits records
      what was waiting on the turn, and a stopped/failed turn keeps every paragraph the run said;
   B. the group transcript (frontend/app/group-chat.js, executed with a small DOM): the stopped turn's approval retires in
      the one-on-one card's words, and the stopped reply says who stopped it. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { makeGroupSessions } = require('../sidecar/group-sessions.js');
const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

async function waitFor(fn) { for (let n = 0; n < 200; n++) { if (await fn()) return true; await new Promise(r => setTimeout(r, 10)); } return false; }

class El {
  constructor(tag) { this.tagName = tag; this.children = []; this.attrs = {}; this.dataset = {}; this.events = {}; this.value = ''; this.style = { setProperty() {} }; this._cls = new Set(); const self = this; this.classList = { add: c => self._cls.add(c), remove: c => self._cls.delete(c), toggle: (c, on) => (on === undefined ? (self._cls.has(c) ? self._cls.delete(c) : self._cls.add(c)) : (on ? self._cls.add(c) : self._cls.delete(c))), contains: c => self._cls.has(c) }; }
  get className() { return [...this._cls].join(' '); } set className(v) { this._cls = new Set(String(v || '').split(/\s+/).filter(Boolean)); }
  get isConnected() { return true; }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.id = v; if (k === 'class') this.className = v; }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  querySelectorAll() { return []; } querySelector() { return null; }
  addEventListener(k, fn) { (this.events[k] = this.events[k] || []).push(fn); }
  focus() {}
  append(...n) { for (const e of n) { const x = typeof e === 'string' ? Object.assign(new El('#text'), { textContent: e }) : e; if (x.parentElement) x.remove(); x.parentElement = this; this.children.push(x); } }
  appendChild(n) { this.append(n); return n; }
  replaceChildren(...n) { for (const c of this.children) c.parentElement = null; this.children = []; this.append(...n); }
  before(n) { this.parentElement && this.parentElement.append(n); }
  insertBefore(n, ref) { if (n.parentElement) n.remove(); const i = ref ? this.children.indexOf(ref) : -1; n.parentElement = this; if (i < 0) this.children.push(n); else this.children.splice(i, 0, n); return n; }
  get lastElementChild() { return this.children[this.children.length - 1] || null; }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(e => e !== this); this.parentElement = null; } }
  get textContent() { return this._text != null ? this._text : this.children.map(c => c.textContent).join(''); }
  set textContent(v) { this._text = String(v); this.children = []; }
}
const settle = async () => { for (let n = 0; n < 80; n++) await Promise.resolve(); };
const all = e => [e, ...e.children.flatMap(all)];
const byClass = (root, c) => all(root).filter(e => e._cls && e._cls.has(c));

(async () => {
  /* ---- A. the sidecar ---- */
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'group-stop-'));
  let seq = 0, execute;
  const deps = { fs, path, root, now: () => ++seq, id: () => 'id' + (++seq), log: () => {},
    roster: () => [{ id: 'agent', name: 'NOVA' }, { id: 'copy', name: 'COPY' }],
    execute: async o => { o.emit('agent.run.start', { runId: o.runId }); return execute(o); },
    readFile: async () => ({ name: 'x.md', content: 'aGk=', bytes: 2, hash: 'h' }), decodeFile: f => ({ text: 'hi', hash: f.hash }), uploadFile: (name, content) => ({ name, content, hash: 'h' }) };
  const api = makeGroupSessions(deps); await api.ready;
  const said = ['I\'ll set up the line first. Let me look at what the station has.', 'The steps are locked; the system won\'t let me reconfigure them. Let me take a different approach and create a loop instead.', 'Good. Now I can create the loop:'];
  // the lead narrates across three model turns, then asks to create a loop and waits; the Commander stops it there
  execute = async o => {
    for (const s of said) o.emit('agent.token', { runId: o.runId, delta: s });
    const answer = await o.prompt({ tool: 'loop.create', scope: 'write', argsSummary: '{"name":"Launch post"}' });
    return { reason: o.signal.aborted ? 'cancelled' : 'done', answer, messages: [{ role: 'user', content: 'ctx' }].concat(said.map(content => ({ role: 'assistant', content }))) };
  };
  const g = await api.create({ members: ['agent', 'copy'] });
  await api.send(g.id, { key: 'k1', text: 'set up a conveyor line for this workflow' });
  A.ok(await waitFor(async () => (await api.get(g.id)).turns.some(t => t.state === 'waiting for approval')), 'fixture: the lead waits on its loop.create approval');
  await api.control(g.id, { action: 'stop-all' });
  await api.idle(g.id);
  let st = await api.get(g.id);
  const t = st.turns.find(x => x.agentId === 'agent');
  A.eq([t.state, t.reason], ['stopped', 'Stopped by you'], 'the turn is stopped, by you');
  A.eq(t.approval, undefined, 'no live approval is left on it');
  A.eq(t.unansweredApproval && [t.unansweredApproval.tool, t.unansweredApproval.argsSummary], ['loop.create', '{"name":"Launch post"}'], 'the turn records what was waiting when it stopped (so the transcript can retire it honestly)');
  A.eq(t.unansweredApproval && t.unansweredApproval.promptId, undefined, 'never a live prompt id: nothing can answer it any more');
  const m = st.messages.find(x => x.turnId === t.id);
  A.ok(m && m.partial, 'the stopped reply is still marked partial');
  A.eq(m && m.content, said.join('\n\n'), 'the stopped reply keeps every paragraph the run said, not just its last sentence');

  // a completed turn still posts only its final reply (the narration before it was working prose)
  execute = async o => ({ reason: 'done', messages: [{ role: 'assistant', content: 'Let me check.' }, { role: 'assistant', content: 'Here is the post.' }] });
  await api.send(g.id, { key: 'k2', text: 'and the post?', resume: true }); await api.idle(g.id);
  st = await api.get(g.id);
  A.eq(st.messages.at(-1).content, 'Here is the post.', 'a completed turn posts its reply alone, as before');
  // an approval that was ANSWERED leaves no retire record behind
  execute = async o => { const a = await o.prompt({ tool: 'fs.write', argsSummary: '{"path":"a.md"}' }); return { reason: 'done', messages: [{ role: 'assistant', content: 'wrote ' + a }] }; };
  await api.send(g.id, { key: 'k3', text: 'write it' });
  A.ok(await waitFor(async () => (await api.get(g.id)).turns.some(x => x.state === 'waiting for approval')), 'fixture: a second approval waits');
  const pid = (await api.get(g.id)).turns.find(x => x.state === 'waiting for approval').approval.promptId;
  await api.answer(g.id, { promptId: pid, decision: 'once' }); await api.idle(g.id);
  st = await api.get(g.id);
  A.eq(st.turns.at(-1).unansweredApproval, undefined, 'an answered approval is never recorded as unanswered');

  /* ---- B. the group transcript ---- */
  const group = { id: 'g1', title: 'Launch', members: ['agent', 'copy'], leadId: 'agent', revision: 9, paused: true, artifacts: [], questions: [],
    messages: [
      { id: 'm1', seq: 1, author: 'user', content: 'set up a conveyor line', at: 1 },
      { id: 'm2', seq: 2, author: 'agent', content: said.join('\n\n'), at: 4, turnId: 't1', partial: true }
    ],
    turns: [{ id: 't1', origin: 'm1', agentId: 'agent', state: 'stopped', reason: 'Stopped by you', endedAt: 4, unansweredApproval: { tool: 'loop.create', argsSummary: '{"name":"Launch post"}' } }] };
  const body = new El('body'), head = new El('head');
  for (const id of ['comms-idbar', 'chat-input', 'chat-log', 'chat-queued', 'chat-inputrow']) { const e = new El('div'); e.id = id; body.append(e); }
  const ws = { id: 'g1', agentId: 'agent', title: 'Launch', conversationMode: 'group', history: [] };
  const ctx = vm.createContext({
    document: { body, head, createElement: tg => new El(tg), createTextNode: tx => Object.assign(new El('#text'), { textContent: tx }), getElementById: id => all(body).find(e => e.id === id) },
    console, crypto: { randomUUID: () => 'u' }, clearTimeout() {}, setTimeout: () => 1, queueMicrotask,
    fetch: async (url) => (!/\?id=/.test(String(url))
      ? { status: 200, ok: true, json: async () => ({ ok: true, result: { roster: [{ id: 'agent', name: 'NOVA' }, { id: 'copy', name: 'COPY' }], groups: [group] } }) }
      : { status: 200, ok: true, json: async () => ({ ok: true, result: group }) }),
    Chat: { consentPhrase: p => 'create a loop: ' + JSON.parse(p.argsSummary).name, consentInspect: () => null, clockLabel: () => '', breakLabel: () => '' },
    App: { pushRoster: async () => {}, agents: () => [{ id: 'agent', name: 'NOVA' }, { id: 'copy', name: 'COPY' }], persist() {}, refreshRail() {}, openWorkstream() {} },
    StationUI: { notify() {}, toggleTerm() {}, closeTerm() {} },
    Workstreams: { get: id => (id === 'g1' ? ws : null), list: () => [ws], activeId: () => 'g1', adopt: o => Object.assign(ws, o), generalId: () => 'home' }
  });
  vm.runInContext(read('frontend/app/group-chat.js') + '\nglobalThis.GroupChat = GroupChat;', ctx);
  ctx.GroupChat.bind(ws); await settle();
  const log = ctx.document.getElementById('gc-log');
  A.ok(log, 'the group transcript painted');
  const rows = log ? log.children : [];
  const reply = rows.find(r => r.dataset && r.dataset.messageId === 'm2') || rows.find(r => /Good\. Now I can create the loop/.test(r.textContent));
  A.ok(reply && reply.textContent.indexOf(said[0]) >= 0 && reply.textContent.indexOf(said[2]) >= 0, 'the stopped reply shows the whole narration');
  A.ok(reply && byClass(reply, 'gc-partial').length === 1 && byClass(reply, 'gc-partial')[0].textContent === 'stopped by you · work did not complete', 'it says who stopped it: ' + (reply && byClass(reply, 'gc-partial').map(e => e.textContent)));
  const retired = rows.filter(r => r._cls && r._cls.has('consent'));
  A.eq(retired.length, 1, 'the approval that was waiting is in the transcript, retired');
  const card = retired[0];
  A.ok(card && /▣ NOVA wants to create a loop: Launch post/.test(card.textContent), 'it names who asked and what, in the desk card\'s words: ' + (card && card.textContent));
  A.ok(card && byClass(card, 'consent-result').length === 1 && byClass(card, 'consent-result')[0].textContent === '■ the run ended before an answer — nothing was approved' && byClass(card, 'consent-result')[0]._cls.has('err'),
    'and retires with the one-on-one line: ■ the run ended before an answer — nothing was approved');
  A.ok(card && !all(card).some(e => e.tagName === 'button'), 'a retired card has no keys');
  A.ok(rows.indexOf(card) === rows.indexOf(reply) + 1, 'the retired card follows the reply it interrupted');

  A.report('group-stop-truth.test');
})().catch(e => { console.error(e); process.exit(1); });
