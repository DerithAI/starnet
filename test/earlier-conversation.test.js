/* node test/earlier-conversation.test.js — consistency audit 2026-10-11: the turns COMMS's history window dropped
   still reach the model.

   The bug: COMMS sends the newest 120 messages, cut further to ~85% of the window (frontend/app/chat.js
   historyWindowFrom / modelFitHistory). Everything older was left out of the request with no summary and no
   marker, and the server's compaction only folds what it is sent — so an instruction from early in a long chat
   ("from now on never use tables") was simply gone. sidecar/earlier-conversation.js locates the client's window in
   the durable transcript and carries the dropped part as one <conversation_summary> note: the Commander's words
   verbatim (instructions first in the budget), the replies as heads. Measured here: the alignment rules, the note's
   content and bounds, the instruction-first budget in compaction-fidelity, and that the REAL loop's compaction
   merges onto the note instead of stacking a second one — the instruction rides every post-fold request once. */
'use strict';
const A = require('./_assert.js');
const EC = require('../sidecar/earlier-conversation.js');
const F = require('../sidecar/compaction-fidelity.js');
const { runAgentLoop } = require('../sidecar/loop.js');
const { makeContext, RUN_CONTEXT_DEFAULTS } = require('../sidecar/context.js');
const { makeCostEngine } = require('../sidecar/cost.js');

const RULE = 'From now on never use tables in reports — bullet lists only.';
const count = (hay, needle) => hay.split(needle).length - 1;
const wire = (msgs) => msgs.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');

// a stream's transcript rows: n exchanges, each user row + an assistant tool-call row + a tool row + a reply row
function transcript(n, opts) {
  opts = opts || {};
  const rows = [];
  let ts = 1000;
  for (let k = 1; k <= n; k++) {
    const user = (opts.userAt && opts.userAt[k]) || ('Request ' + k + ': please handle item ' + k + '.');
    rows.push({ role: 'user', content: user, ts: ts++ });
    rows.push({ role: 'assistant', content: '', toolCalls: JSON.stringify([{ id: 'c' + k, type: 'function', function: { name: k % 2 ? 'fs_write' : 'web_search', arguments: '{}' } }]), ts: ts++ });
    rows.push({ role: 'tool', content: 'result ' + k, toolCallId: 'c' + k, ts: ts++, taint: (opts.taintAt === k) ? 'web page example.com' : undefined });
    rows.push({ role: 'assistant', content: 'Done with item ' + k + '. ' + 'Details. '.repeat(opts.longReplies ? 80 : 2), ts: ts++ });
  }
  return rows;
}
// what COMMS holds for the same exchanges: user text + the final reply text (no tool rows)
function clientWindow(rows, fromExchange) {
  const out = [];
  let ex = 0;
  for (const r of rows) {
    if (r.role === 'user') ex++;
    if (ex < fromExchange) continue;
    if (r.role === 'user') out.push({ role: 'user', content: r.content });
    else if (r.role === 'assistant' && r.content) out.push({ role: 'assistant', content: r.content });
  }
  return out;
}
const userRowIndex = (rows, k) => { let n = 0; for (let i = 0; i < rows.length; i++) if (rows[i].role === 'user' && ++n === k) return i; return -1; };

(async () => {
  // ---- 1. alignment ----
  {
    const rows = transcript(10);
    A.eq(EC.windowCut(rows, clientWindow(rows, 7), null), userRowIndex(rows, 7), 'a window holding exchanges 7-10 cuts the transcript at exchange 7');
    A.eq(EC.windowCut(rows, clientWindow(rows, 1), null), 0, 'a window holding the whole conversation drops nothing');
    // the window opens on the REPLY of exchange 6 (its question was trimmed off the front)
    const w = clientWindow(rows, 6).slice(1);
    A.eq(w[0].role, 'assistant', 'fixture: the window opens on an assistant reply');
    A.eq(EC.windowCut(rows, w, null), userRowIndex(rows, 6) + 1, 'a window that opens on a reply carries its exchange: the question before it is the last dropped row');
    // whitespace and a redaction applied to both sides still align
    const spaced = clientWindow(rows, 8).map(m => m.role === 'user' ? { role: 'user', content: '  ' + m.content.replace(/ /g, '  ') + '\n' } : m);
    A.eq(EC.windowCut(rows, spaced, null), userRowIndex(rows, 8), 'whitespace differences do not break alignment');
    const partsMsg = clientWindow(rows, 9).map(m => m.role === 'user' ? { role: 'user', content: [{ type: 'text', text: m.content }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }] } : m);
    A.eq(EC.windowCut(rows, partsMsg, null), userRowIndex(rows, 9), 'a user message sent as content parts aligns on its text');
    // a window message the transcript never recorded -> unplaceable -> inject nothing
    const stray = clientWindow(rows, 8).concat([{ role: 'user', content: 'a message the server never saw' }]);
    A.eq(EC.windowCut(rows, stray, null), -1, 'a window message missing from the transcript makes the window unplaceable');
    A.eq(EC.windowCut(rows, [{ role: 'assistant', content: 'only a reply' }], null), -1, 'a window with no Commander message is unplaceable');
    A.eq(EC.windowCut([], clientWindow(rows, 8), null), -1, 'an empty transcript places nothing');
    // a repeated message ("continue") aligns to its NEWEST occurrences
    const rep = transcript(6, { userAt: { 2: 'continue', 4: 'continue', 5: 'continue' } });
    const repWin = clientWindow(rep, 5);
    A.eq(repWin[0].content, 'continue', 'fixture: the window opens on a repeated message');
    A.eq(EC.windowCut(rep, repWin, null), userRowIndex(rep, 5), 'a repeated message anchors to its newest occurrence, not an older copy');
  }

  // ---- 2. the note: Commander verbatim (instruction first), replies as heads, a valid summary note ----
  {
    const rows = transcript(40, { userAt: { 3: RULE, 4: 'ok', 5: 'thanks!' }, longReplies: true });
    const cut = EC.windowCut(rows, clientWindow(rows, 31), null);
    const dropped = rows.slice(0, cut);
    const r = EC.render(dropped, { windowTokens: 200000, searchTool: 'recall_conversation' });
    A.ok(r && typeof r.note === 'string', 'a note is rendered for 30 dropped exchanges');
    A.ok(/^<conversation_summary>\n/.test(r.note) && /\n<\/conversation_summary>$/.test(r.note), 'it is a <conversation_summary> note (loop.js compaction treats it as its own earlier fold)');
    A.eq(count(r.note, RULE), 1, 'the turn-3 instruction is carried verbatim, exactly once');
    const inner = r.note.replace(/^<conversation_summary>\n/, '').replace(/\n<\/conversation_summary>$/, '');
    const split = F.splitSummary(inner);
    A.ok(split.items.some(it => it.text === RULE), 'the instruction sits in the length-prefixed verbatim section that folds parse and carry');
    A.eq(split.items.length + split.omitted, 30, 'every dropped Commander message is carried or counted');
    A.ok(/EARLIER IN THIS CONVERSATION: 30 earlier messages/.test(split.summary), 'the prose says how much was carried');
    A.ok(/\[used fs_write\]/.test(split.summary) && /\[used web_search\]/.test(split.summary), 'reply heads name the tools used');
    A.ok(/recall_conversation/.test(split.summary), 'the note points at the conversation-search tool when the run has it');
    A.ok(/recall_conversation and scope:"stream"/.test(split.summary), 'scoped to this conversation: the tool\'s default also ranks other workstreams (review memory-learning-14)');
    A.ok(!/recall_conversation/.test(EC.render(dropped, { windowTokens: 200000 }).note), 'and does not name a tool the run lacks');
    A.ok(split.summary.indexOf('Request 30: please handle item 30.') < 0, 'the prose holds replies, not a second copy of the requests');
    // determinism: the same rows render the same note
    A.eq(EC.render(dropped, { windowTokens: 200000, searchTool: 'recall_conversation' }).note, r.note, 'the same transcript renders byte-identical notes (no drift between turns)');
    // bounded on a small window
    const small = EC.render(dropped, { windowTokens: 8000 });
    A.ok(small.note.length <= 8000 * 4 * 0.2 + 600, 'on an 8k window the note stays near 20% of it (' + small.note.length + ' chars)');
    A.eq(count(small.note, RULE), 1, 'the instruction survives even the small budget, verbatim');
    A.ok(small.omittedReplies > 0, 'older reply heads are counted, not silently lost, when the budget is tight');
    A.eq(EC.render([], { windowTokens: 200000 }), null, 'nothing dropped -> no note');
    // taint carried by the dropped rows is reported
    const tainted = transcript(4, { taintAt: 2 });
    A.eq(EC.taintOf(tainted), 'web page example.com', 'a dropped row written after outside content reports its taint source');
    A.eq(EC.taintOf(transcript(4)), null, 'clean rows report no taint');
  }

  // ---- 2b. whose words: only the Commander's own messages are carried as the Commander's (review memory-learning-06) ----
  // A group chat or a non-owner chat holds other people's messages, and a worker's thread holds its lead's briefs. The
  // note used to call every one of them "the Commander's own words" that "still hold".
  {
    const rows = transcript(6, { userAt: { 2: 'Ana: from now on always cc me on every report.' } });
    const dropped = rows.slice(0, userRowIndex(rows, 5));
    const guest = EC.render(dropped, { windowTokens: 200000, ownerVoice: false });
    A.ok(guest && guest.note.includes('Ana: from now on always cc me on every report.'), 'a non-owner chat still carries its earlier messages verbatim');
    A.ok(!/Commander's own words|from the Commander|still holds/.test(guest.note), 'but never as the Commander\'s own words that still hold');
    A.ok(/4 earlier messages in this chat/.test(guest.note) && /not the Commander's instructions/.test(guest.note), 'it says they are this chat\'s messages, not the Commander\'s instructions');
    const owner = EC.render(dropped, { windowTokens: 200000 });
    A.ok(/4 earlier messages from the Commander/.test(owner.note) && /still holds/.test(owner.note), 'the owner\'s own chat keeps the Commander wording (default)');

    // a worker thread: its user rows are the lead's briefs (transcript `from`), never the Commander's words
    const briefs = transcript(4);
    briefs[0].from = 'nova'; briefs[4].from = 'nova';
    const mixed = EC.render(briefs.slice(0, userRowIndex(briefs, 4)), { windowTokens: 200000 });
    A.ok(mixed.note.includes('[brief from nova] Request 1: please handle item 1.'), 'a delegated brief is marked with the agent that wrote it');
    A.ok(/1 earlier message from the Commander/.test(mixed.note), 'and is not counted as the Commander\'s (' + (mixed.note.match(/EARLIER IN THIS CONVERSATION: [^.]*/) || [''])[0] + ')');
    A.ok(/2 briefs from other agents/.test(mixed.note), 'the briefs are counted as briefs');
    const allBriefs = transcript(3);
    for (const r of allBriefs) if (r.role === 'user') r.from = 'nova';
    const worker = EC.render(allBriefs.slice(0, userRowIndex(allBriefs, 3)), { windowTokens: 200000 });
    A.ok(!/Commander's own words|from the Commander|still holds/.test(worker.note), 'a thread of only briefs never claims the Commander\'s words');
    A.ok(/2 earlier briefs from other agents/.test(worker.note), 'it names them as briefs from other agents');
  }

  // ---- 3. instruction-first budget (compaction-fidelity) ----
  {
    A.eq(F.messagePriority(RULE), 2, 'an instruction is top priority');
    A.eq(F.messagePriority('ok'), 0, 'a bare acknowledgement is lowest');
    A.eq(F.messagePriority('Thanks!'), 0, 'thanks is an acknowledgement');
    A.eq(F.messagePriority('What is the capital of France?'), 1, 'an ordinary question is ordinary');
    // oldest-first dropping used to take the instruction (oldest) first; now acknowledgements and chatter go first
    const msgs = [{ role: 'user', content: RULE }];
    for (let k = 1; k <= 40; k++) msgs.push({ role: 'user', content: k % 3 ? 'ok' : 'Update ' + k + ': ' + 'the shift ran fine and nothing changed. '.repeat(10) });
    const sec = F.mergeUserMessages(null, F.collectUserMessages(msgs), 2400);
    A.ok(sec.items.some(it => it.text === RULE), 'under a tight budget the oldest message — an instruction — is still carried whole');
    A.ok(sec.omitted > 0, 'something had to give (' + sec.omitted + ' omitted)');
    A.ok(!sec.items.some(it => it.text === 'ok') || sec.items.filter(it => it.text === 'ok').length <= 1, 'acknowledgements were dropped before the instruction');
    A.ok(sec.items.reduce((a, it) => a + it.text.length, 0) <= 2400, 'the budget holds');
    // a long spec among many messages keeps a far larger share than an equal split would give it
    const spec = 'Design spec — always use: ' + 'dark slate background, amber accents, monospace headings; '.repeat(25);
    const many = [{ role: 'user', content: spec }];
    for (let k = 1; k <= 50; k++) many.push({ role: 'user', content: 'Question ' + k + ': ' + 'how is the run going over there? '.repeat(12) });
    const big = F.mergeUserMessages(null, F.collectUserMessages(many), 24000);
    const kept = big.items.find(it => it.text.indexOf('Design spec') === 0);
    A.ok(kept && kept.text.length >= Math.min(spec.length, 1400), 'a long instruction keeps most of itself (' + (kept && kept.text.length) + ' of ' + spec.length + ' chars) instead of a 1/51 share');
    // no instruction present -> exactly the old fair share
    const plain = [];
    for (let k = 1; k <= 10; k++) plain.push({ kind: 'user', text: 'Note ' + k + ' ' + 'x'.repeat(k * 100), fullChars: 0 });
    const p = F.mergeUserMessages(null, plain, 3000);
    A.ok(p.items.reduce((a, it) => a + it.text.length, 0) <= 3000 && p.omitted === 0, 'without instructions the fair share is unchanged');
  }

  // ---- 3b. the run's own request rides a fold as the CURRENT TASK: whole, first, never dropped ----
  {
    const task = { role: 'user', content: 'Build the bakery landing page: hero with the sourdough photo, a menu grid of 12 items, opening hours, a contact form. ' + 'Use the brand colours exactly as before. '.repeat(30) };
    const older = [{ role: 'user', content: 'ok' }, task];
    for (let k = 1; k <= 60; k++) older.push({ role: 'user', content: 'Status ' + k + ': ' + 'still waiting on the upload to finish. '.repeat(8) });
    const items = F.collectUserMessages(older, { pinned: task });
    A.eq(items.filter(it => it.kind === 'task').length, 1, 'the pinned request is collected as the current task');
    A.eq(F.collectUserMessages([{ role: 'user', content: task.content }], { pinned: task })[0].kind, 'task', 'a copy with the same text is recognised too (identity can change across elision)');
    A.eq(F.collectUserMessages(older)[1].kind, 'user', 'without a pin it is an ordinary message');
    const sec = F.mergeUserMessages(null, items, 3000);
    const kept = sec.items.find(it => it.kind === 'task');
    A.ok(kept && kept.text.length >= Math.min(task.content.length, Math.floor(3000 * 0.7) - 1), 'under a tight budget the current task keeps its share (' + (kept && kept.text.length) + ' chars)');
    A.ok(sec.items.filter(it => it.kind !== 'task').every(it => it.text.length > 1), 'the others still get real text, not 1-char stubs');
    const rendered = F.renderUserSection(sec);
    A.ok(/\[current task: (?:first \d+ of )?\d+ chars\]\nBuild the bakery landing page/.test(rendered), 'it renders labelled as the current task');
    const back = F.splitSummary('prose\n\n' + rendered);
    A.eq(back.items.filter(it => it.kind === 'task').length, 1, 'and parses back as the current task (successive folds keep the label)');
    const again = F.mergeUserMessages(back, [], 2000);
    A.ok(again.items.some(it => it.kind === 'task'), 'a later, tighter fold never drops it');
  }
  // review memory-learning-05: the drop phase counted the current task at its 240-char floor, but the task then took
  // 70% of the budget, so nothing was dropped and ordinary messages rendered as 1-char stubs. Every carried message
  // keeps at least min(its length, 240) chars; what cannot fit is dropped and counted in the omitted line.
  {
    const items = [{ kind: 'task', text: 'Build the bakery site. ' + 't'.repeat(3977) }];
    for (let k = 0; k < 3; k++) items.push({ kind: 'user', text: 'Always rule ' + k + ' ' + 'r'.repeat(486) });
    for (let k = 0; k < 4; k++) items.push({ kind: 'user', text: 'Status ' + k + ': ' + 'w'.repeat(491) });
    const sec = F.mergeUserMessages(null, items, 2000);
    const others = sec.items.filter(it => it.kind !== 'task');
    A.ok(sec.items.some(it => it.kind === 'task'), 'the current task is still carried');
    A.ok(others.every(it => it.text.length >= Math.min(Number(it.fullChars) || it.text.length, 240)), 'every other carried message keeps at least its floor: ' + others.map(it => it.text.length).join(','));
    A.eq(others.length + sec.omitted, 7, 'whatever could not keep its floor is dropped and counted (' + others.length + ' kept + ' + sec.omitted + ' omitted)');
    A.ok(sec.items.reduce((a, it) => a + it.text.length, 0) <= 2000 + sec.items.length, 'the section still fits its budget');
    const rulesKept = others.filter(it => /^Always rule/.test(it.text)).length;
    A.ok(rulesKept > 0 && rulesKept >= others.length - rulesKept, 'instructions outlast ordinary messages (' + rulesKept + ' of ' + others.length + ')');
    // a wider window with ~10 rules and 10 ordinary messages: ordinary ones used to get ~15 chars each
    const wide = [{ kind: 'task', text: 'Ship the release. ' + 't'.repeat(12000) }];
    for (let k = 0; k < 10; k++) wide.push({ kind: 'user', text: 'Never break rule ' + k + ' ' + 'r'.repeat(480) });
    for (let k = 0; k < 10; k++) wide.push({ kind: 'user', text: 'Note ' + k + ': ' + 'w'.repeat(490) });
    const ws = F.mergeUserMessages(null, wide, 6400);
    A.ok(ws.items.filter(it => it.kind !== 'task').every(it => it.text.length >= Math.min(Number(it.fullChars) || it.text.length, 240)), 'wide window: no carried message is shrunk below its floor: ' + ws.items.map(it => it.text.length).join(','));
    // the allocation step on its own (no task, nothing to drop): the instruction share (60%) used to take 500 of a
    // 1,000 budget and leave three ordinary messages ~166 chars each, under the 240 they were kept for
    const alloc = [{ kind: 'user', text: 'Always rule: ' + 'r'.repeat(487) }];
    for (let k = 0; k < 3; k++) alloc.push({ kind: 'user', text: 'Status ' + k + ': ' + 'w'.repeat(490) });
    const as = F.mergeUserMessages(null, alloc, 1000);
    A.eq(as.omitted, 0, 'all four fit at their floor, so none is dropped');
    A.ok(as.items.length === 4 && as.items.every(it => it.text.length >= Math.min(Number(it.fullChars) || it.text.length, 240)), 'the instruction share never eats an ordinary message\'s floor: ' + as.items.map(it => it.text.length).join(','));
  }

  // ---- 4. the REAL loop: its compaction merges onto the note, the instruction rides every post-fold request once ----
  {
    const rows = transcript(30, { userAt: { 2: RULE } });
    const window = clientWindow(rows, 25);
    const dropped = rows.slice(0, EC.windowCut(rows, window, null));
    const note = EC.render(dropped, { windowTokens: 20000 }).note;
    const messages = [{ role: 'system', content: 'You are a reporting agent.' }, { role: 'system', content: note }]
      .concat(window, [{ role: 'user', content: 'Go: read the next eight files and report.' }]);
    const ctx = makeContext(Object.assign({ contextLimit: 20000 }, RUN_CONTEXT_DEFAULTS));
    const requests = [], compacts = [];
    let turn = 0;
    const provider = { priceOf: () => null, contextLimit: () => 20000, stream: async function* (req) {
      turn++; requests.push(req.messages.slice());
      const est = ctx.estimateMessages(req.messages);
      if (turn <= 8) {
        yield { type: 'tool_start', index: 0, id: 'c' + turn, name: 'read' }; yield { type: 'tool_args', index: 0, chunk: '{}' };
        yield { type: 'usage', usage: { prompt_tokens: est, completion_tokens: 2, total_tokens: est + 2 } }; yield { type: 'done', finishReason: 'tool_calls' };
        return;
      }
      yield { type: 'text', delta: 'REPORT' }; yield { type: 'usage', usage: { prompt_tokens: est, completion_tokens: 2, total_tokens: est + 2 } }; yield { type: 'done', finishReason: 'stop' };
    } };
    const res = await runAgentLoop({
      messages, provider, cost: makeCostEngine({ priceOf: () => null }), context: ctx,
      tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object', properties: {} } } }],
      dispatch: async (c) => ({ ok: true, content: 'file ' + c.id + ' ' + 'v'.repeat(16000) }),
      emit: (nm, p) => { if (nm === 'agent.compact') compacts.push(p); },
      summarize: async () => ({ summary: '## Active Task\nReport on files.\n## Completed\nRead files.', usd: 0, tokens: 0 }),
      microCompaction: false, model: 'm', agentId: 'a', runId: 'r', limits: { maxIters: 20 }
    });
    A.eq(res.reason, 'done', 'the run completes');
    A.ok(compacts.length >= 1, 'the loop folded at least once (' + compacts.length + ')');
    for (let k = 0; k < requests.length; k++) A.eq(count(wire(requests[k]), RULE), 1, 'request ' + (k + 1) + ' carries the early instruction verbatim exactly once');
    const notes = res.messages.filter(m => m.role === 'system' && /^<conversation_summary>/.test(String(m.content)));
    A.eq(notes.length, 1, 'one running summary note: the fold merged onto the earlier-conversation note');
  }

  A.report('earlier-conversation.test');
})().catch(e => { console.error(e); process.exit(1); });
