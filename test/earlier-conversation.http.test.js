'use strict';
// THE TURNS THE WINDOW DROPPED STILL COUNT, live: real sidecar + real /api/run against a capturing local provider.
// A long COMMS conversation is built turn by turn on one workstream (each send carries the whole history, like
// COMMS does while it fits). Then a send carries only the newest slice — what chat.js historyWindowFrom /
// modelFitHistory sends once a chat outgrows its window. Before 2026-10-11 the instruction from turn 1 simply did
// not exist in that request. Now the model request carries it verbatim, in one <conversation_summary> note rebuilt
// from the durable transcript; a send that holds the whole conversation gets no note; a window the transcript
// cannot place gets no note.
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {bootToken} = require('./_httpToken.js');
const {hostNotes, userWords} = require('./helpers/host-notes.js');
const root = path.resolve(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-earlier-conversation-'));
const RULE = 'From now on, never use tables in anything you write for me — bullet lists only.';
let child, base, headers;
const seen = [];
const mock = http.createServer((req, res) => {
  if (req.url.includes('/models')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({data: [{id: 'test/model', context_length: 128000, pricing: {prompt: '0', completion: '0'}, supported_parameters: ['tools']}]})); }
  let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
    let body = null; try { body = JSON.parse(raw); seen.push(body); } catch (_) { body = null; }
    const last = body && Array.isArray(body.messages) ? body.messages.filter(m => m.role === 'user').pop() : null;
    const echo = last ? userWords(last).slice(0, 60) : '';
    res.writeHead(200, {'Content-Type': 'text/event-stream'});
    res.write('data: ' + JSON.stringify({choices: [{delta: {content: 'Handled: ' + echo}}]}) + '\n\n');
    res.write('data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: 'stop'}], usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10}}) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
});
async function boot() {
  const socket = http.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(r => socket.close(r));
  base = 'http://127.0.0.1:' + port;
  child = spawn(process.execPath, ['sidecar/index.js'], {cwd: root, env: {...process.env, SKYNET_WORKSPACES: workspace, SKYNET_PORT: String(port), SKYNET_OPENROUTER_BASE: 'http://127.0.0.1:' + mock.address().port + '/api/v1', SKYNET_OPENROUTER_KEY: 'sk-or-v1-earlier-fixture', SKYNET_EDGE_TTS: '0', SKYNET_REFLECT: '0', SKYNET_SKILL_REVIEW: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(new Error('boot timeout: ' + out.slice(-1200))), 30000); const read = d => { out += d; if (out.includes('Open in your browser:')) { clearTimeout(timer); resolve(); } }; child.stdout.on('data', read); child.stderr.on('data', read); child.once('exit', c => { clearTimeout(timer); reject(new Error('boot exit ' + c + out.slice(-1200))); }); });
  headers = {'Content-Type': 'application/json', 'X-StarNet-Token': await bootToken(base, base), Origin: base};
}
async function stop() { if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } }
// one COMMS send: the history the page holds + the new message; returns the reply text and the model request
async function send(streamId, history, text) {
  const before = seen.length;
  const r = await fetch(base + '/api/run', {method: 'POST', headers, body: JSON.stringify({agentId: 'agent', key: 'sk-or-v1-earlier-fixture', model: 'test/model', streamId, messages: history.concat([{role: 'user', content: text}])})});
  const events = (await r.text()).split('\n').filter(Boolean).map(s => JSON.parse(s));
  const end = events.find(e => e.name === 'agent.run.end');
  A.eq(end && end.payload.reason, 'done', 'run completed: ' + text.slice(0, 40));
  const reply = events.filter(e => e.name === 'agent.token').map(e => e.payload.delta).join('');
  // the provider request that carried this send (user content may arrive as a string or as content parts). It must be
  // found: an empty message list would make every "gets no note" / "never sees" check below pass vacuously (review tests-24)
  const textOf = (c) => typeof c === 'string' ? c : JSON.stringify(c);
  const req = seen.slice(before).find(b => Array.isArray(b.messages) && b.messages.some(m => m.role === 'user' && textOf(m.content).indexOf(text) >= 0));
  A.ok(req, 'the provider saw the request: ' + text.slice(0, 40));
  return {reply, messages: req ? req.messages : []};
}
// the earlier-conversation note: a system message on a Claude route, the newest user turn's fenced leading text on this one
const notesOf = (msgs) => hostNotes(msgs, 'conversation_summary').map(content => ({content}));
const count = (hay, needle) => hay.split(needle).length - 1;
(async () => {
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  try {
    await boot();
    A.ok((await fetch(base + '/api/roster', {method: 'POST', headers, body: JSON.stringify({agents: [{agentId: 'agent', name: 'Hero', model: 'test/model', provider: 'openrouter'}]})}).then(r => r.json())).ok, 'roster saved');

    // build a 12-exchange conversation, the page sending its whole history each time (the instruction is turn 1)
    const stream = 'ws_long_chat_1';
    const history = [];
    const asks = [RULE];
    for (let k = 2; k <= 12; k++) asks.push('Request ' + k + ': draft section ' + k + ' of the quarterly report.');
    let full = null;
    for (const ask of asks) {
      const out = await send(stream, history.slice(), ask);
      if (ask === asks[asks.length - 1]) full = out;
      history.push({role: 'user', content: ask}, {role: 'assistant', content: out.reply});
    }
    A.eq(notesOf(full.messages).length, 0, 'a send that holds the whole conversation gets no earlier-conversation note');
    A.eq(count(JSON.stringify(full.messages), RULE), 1, 'and still carries the instruction once (it is in the history it sent)');

    // the page now sends only its newest slice — the instruction fell off the front of the window
    const windowed = history.slice(-6);
    A.ok(!JSON.stringify(windowed).includes(RULE), 'fixture: the window no longer holds the turn-1 instruction');
    const late = await send(stream, windowed, 'Request 13: write the summary section.');
    const notes = notesOf(late.messages);
    A.eq(notes.length, 1, 'the model request carries one earlier-conversation note');
    A.eq(count(String(notes[0] && notes[0].content), RULE), 1, 'the turn-1 instruction rides in it verbatim, once');
    A.ok(/EARLIER IN THIS CONVERSATION: 9 earlier messages/.test(String(notes[0] && notes[0].content)), 'the note says how many Commander messages it carries (12 sent, 3 still in the window)');
    // on this non-Claude chat wire (OpenRouter test/model) it is the fenced leading text of the newest user turn: strict chat
    // templates refuse a second system message (provider.js userSideHostNotes)
    A.eq(late.messages.filter(m => m.role === 'system').length, 1, 'the system prompt is the only system message');
    A.ok(String(late.messages[late.messages.length - 1].content).indexOf('<conversation_summary>') === 0, 'it opens the newest user turn');
    A.ok(!String(notes[0].content).includes('Request 12: draft section 12'), 'messages still in the window are not duplicated into the note');

    // a window the transcript cannot place injects nothing (never a guess)
    const stray = await send(stream, [{role: 'user', content: 'a message this stream never recorded'}, {role: 'assistant', content: 'ok'}], 'Request 14: one more.');
    A.eq(notesOf(stray.messages).length, 0, 'an unplaceable window gets no note');

    // another workstream's history never leaks in
    const other = await send('ws_other_chat_2', [], 'Hello there, new conversation.');
    A.eq(notesOf(other.messages).length, 0, 'a fresh workstream gets no note');
    A.ok(!JSON.stringify(other.messages).includes(RULE), 'and never sees another conversation\'s words');
  } finally { await stop(); await new Promise(r => mock.close(r)); fs.rmSync(workspace, {recursive: true, force: true}); }
  A.report('earlier-conversation.http');
})().catch(e => { console.error(e); process.exit(1); });
