'use strict';
/* node test/needs-you.test.js — NEEDS YOU (2026-10-11): every ask and failure on the station in ONE list atop SESSIONS.
   GENUINE: NeedsYou.items reads only provable state (open asks per conversation incl. a delegated worker's stamped ask,
   group chats waiting, the overseer ledger's failed workers, unread failed routines), orders it (asks oldest first,
   then failures newest first), gives each kind its real action, and forgets a failure once dismissed or stale.
   SOURCE-LOCKED: the rail renders it in place of the retired "Waiting for you" filter, and the page loads it. */
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const NOW = 10 * 86400000;
const store = new Map();
global.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
const sessions = new Map([
  ['home', { id: 'home', title: null, agentId: 'agent' }],
  ['proj', { id: 'proj', title: 'Launch prep', agentId: 'agent' }],
  ['grp', { id: 'grp', title: 'War room', agentId: 'agent', conversationMode: 'group' }],
  ['cron-r1', { id: 'cron-r1', title: 'Inbox sweep', agentId: 'writer', lastRunOk: false, lastActiveAt: NOW - 60000, automation: { kind: 'routine', id: 'job1', name: 'Inbox sweep' } }],
  ['cron-r2', { id: 'cron-r2', title: 'Morning news', agentId: 'agent', lastRunOk: true, lastActiveAt: NOW - 60000 }]
]);
const unread = new Set(['cron-r1', 'cron-r2']);
global.Workstreams = { get: id => sessions.get(id) || null, list: () => [...sessions.values()], unread: w => unread.has(w.id), generalId: () => 'home', markRead: id => unread.delete(id) };
const pend = [
  { wsId: 'home', p: { promptId: 'p2', tool: 'mcp__gmail__send', agentId: 'agent', workerAgentId: 'writer', workerStreamId: 'thread_vex', askedAt: NOW - 120000 } },
  { wsId: 'proj', p: { promptId: 'p1', tool: 'brief.ask', agentId: 'agent', argsSummary: JSON.stringify({ question: 'Which price tier should lead?' }), askedAt: NOW - 600000 } },
  { wsId: 'gone', p: { promptId: 'p9', tool: 'fs.write', askedAt: 1 } }
];
global.Channels = { allPending: () => pend };
global.GroupChat = { attentionIds: () => ['grp'], stateOf: () => ({ approvals: 1 }), membersOf: id => id === 'grp' ? ['writer', 'agent', 'researcher'] : null };
global.Overseer = { snapshot: () => ({ workers: [
  { runId: 'wr1', status: 'error', reason: 'timeout', agentId: 'researcher', parentStreamId: 'home', streamId: 'thread_mira', completedAt: NOW - 300000 },
  { runId: 'wr2', status: 'done', agentId: 'researcher', parentStreamId: 'home', completedAt: NOW - 1000 },
  { runId: 'wr3', status: 'stale', agentId: 'designer', parentStreamId: 'proj', completedAt: 0, startedAt: NOW - 3600000 },
  { runId: 'wr4', status: 'error', agentId: 'designer', parentStreamId: 'home', completedAt: NOW - 5 * 86400000 },
  { runId: 'wr5', status: 'interrupted', agentId: 'designer', parentStreamId: 'home', completedAt: NOW - 1000 }
] }) };
global.App = { agentName: id => ({ agent: 'NOVA', writer: 'VEX', researcher: 'MIRA', designer: 'ROOK' })[id] || id };
global.Chat = { consentPhrase: p => p.tool === 'mcp__gmail__send' ? 'send an email to beta@list' : String(p.tool) };
// the approval card's own INSPECT rule (chat.js consentInspect), run for real: it decides whether the rail's one line is
// the whole request
const consentCard = {};
{
  const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8'), at = src.indexOf('function glance(');
  vm.createContext(consentCard); vm.runInContext(src.slice(at, src.indexOf('  function clarifyRow(', at)), consentCard);
  global.Chat.consentInspect = consentCard.consentInspect;
}
global.document = undefined;
global.Delegated = require('../frontend/app/delegated.js');   // the page loads both; worker end-lines are worded once, there
const NY = require('../frontend/app/needsyou.js');
// the SESSIONS rail's own agent line (app.js railAgentName + railAgentLine, run as shipped, with the production U.esc), as App
// exposes it: NEEDS YOU names a group chat by the line its session row reads
{
  const appSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
  const util = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'js', 'util.js'), 'utf8');
  const s0 = util.indexOf('  esc(s) {'), s1 = util.indexOf('\n  // seeded-ish', s0);
  A.ok(s0 >= 0 && s1 > s0 && s1 - s0 < 500, 'fixture: the production escaping method');
  const ctx = vm.createContext({ GroupChat: global.GroupChat, agents: new Map([['agent', { name: 'NOVA' }], ['writer', { name: 'VEX' }], ['researcher', { name: 'MIRA' }]]) });
  vm.runInContext('this.U = {' + util.slice(s0, s1) + '};\n' + A.fnBody(appSrc, 'function railAgentName(w)') + '\n' + A.fnBody(appSrc, 'function railAgentLine(w)') + '\nthis.line = railAgentLine;', ctx);
  global.App.railAgentLine = ctx.line;
  A.ok(/\n    railAgentLine,/.test(appSrc), 'App exposes railAgentLine: NEEDS YOU reads the SESSIONS row\'s own line');
}
// what the rail READ of a row's ask line (needsyou.js measure, run for real on a stand-in row): a clamped .ny-what that holds
// all of its text, or one that cuts it. Approve once is offered only for a line read whole (test/needs-you-rail-fit.test.js
// reads it at every TEXT SIZE and rail width); a line never read offers Review
const WHOLE = { clientHeight: 41, scrollHeight: 41, clientWidth: 150, scrollWidth: 150 }, CUT = { clientHeight: 41, scrollHeight: 61, clientWidth: 150, scrollWidth: 150 };
const readAs = (i, box) => { NY._internals.measure({ querySelectorAll: () => [{ dataset: { nyKey: i.key }, querySelector: sel => sel === '.ny-what' ? box : null }] }, [i]); return i; };
const shown = i => readAs(i, WHOLE), cut = i => readAs(i, CUT);

{
  const list = NY.items(NOW);
  A.eq(list.map(i => i.key).join(' '), 'group:grp ask:p1 ask:p2 routine:cron-r1 worker:wr1 worker:wr3',
    'asks first (oldest waiting first; a group with no age leads), then failures newest first');
  const ask = list.find(i => i.key === 'ask:p2');
  A.eq(ask.who + ' | ' + ask.what + ' | ' + ask.where + ' | ' + ask.workerWsId, 'VEX | send an email to beta@list | General | thread_vex', 'a delegated worker\'s ask names the WORKER, says exactly what, and where');
  A.eq(list.find(i => i.key === 'ask:p1').what, 'Which price tier should lead?', 'a question shows the question itself');
  // (two reviews 10-16) a group chat waiting on you was headed "GROUP" with an empty portrait well: standing law (Andrew 10-13) is
  // that a group reads its members' names, never a GROUP label. It is the SESSIONS row's own line, its portrait the lead's
  const grp = list.find(i => i.key === 'group:grp');
  A.eq([grp.who, grp.aid].join(' | '), 'NOVA, VEX +1 | agent', 'a group chat that waits on you is named by its members ("NOVA, VEX +1": the SESSIONS row\'s line, lead first), never GROUP');
  const grpHtml = NY._internals.html([grp], NOW);
  A.ok(/<span class="ny-who"[^>]*><span class="ws-agent-names">NOVA, VEX<\/span><span class="ws-agent-more">\+1<\/span><\/span>/.test(grpHtml) && /class="ny-face"[^>]*data-ny-aid="agent"/.test(grpHtml) && !/>GROUP</.test(grpHtml),
    '…drawn as that very line, with the lead\'s portrait in its well: ' + grpHtml.slice(0, 300));
  A.eq(NY.lineOf(grp), 'has an approval waiting', '(its line stays what the group waits on)');
  A.ok(!list.some(i => i.key === 'ask:p9'), 'an ask in a conversation this page does not hold is not listed');
  A.ok(!list.some(i => /wr2|wr5/.test(i.key)), 'finished work and work the Commander stopped never need you');
  A.ok(!list.some(i => i.key === 'worker:wr4'), 'a failure older than three days is history, not a to-do');
  A.eq(list.find(i => i.key === 'worker:wr3').what, 'stopped when the station restarted', 'a restart-stopped worker says so');
  A.eq(list.find(i => i.key === 'worker:wr1').what, 'failed: ran out of time', 'a failed worker says why in words, never the ledger\'s code');
  A.ok(!list.some(i => i.key === 'routine:cron-r2'), 'a routine that ran fine is not a to-do');
  const k = NY._internals.keysFor;
  A.ok(/data-ny-act="once"[^>]*>Approve/.test(k(shown(ask))) && /data-ny-act="deny"[^>]*>Deny/.test(k(ask)), 'an approval: Approve / Deny right there');
  A.ok(!/data-ny-act="(always|full|session)"/.test(k(ask)), 'never a standing or lead-wide grant from the list');
  A.ok(/data-ny-act="open"[^>]*>Answer/.test(k(list.find(i => i.key === 'ask:p1'))), 'a question: Answer opens it');
  A.ok(/data-ny-act="retry"[^>]*>Retry/.test(k(list.find(i => i.key === 'routine:cron-r1'))), 'a failed routine: Retry');
  A.ok(/data-ny-act="dismiss"/.test(k(list.find(i => i.key === 'worker:wr1'))), 'failed delegated work: Open or Dismiss');
  const h = NY._internals.html(list, NOW);
  A.ok(/<span class="ny-title">Needs you<\/span><span class="ny-count">6<\/span>/.test(h), 'labeled: "Needs you" and how many, never a bare number');
  A.eq((h.match(/class="ny-item /g) || []).length, 3, 'three rows, the rest behind one fold');
  A.ok(/data-ny-act="more"[^>]*>3 more</.test(h), '"3 more" says how many are folded');
  A.eq(NY._internals.age(NOW - 120000, NOW) + ',' + NY._internals.age(NOW - 7200000, NOW) + ',' + NY._internals.age(0, NOW), '2m,2h,', 'age reads in plain units; unknown age shows nothing');
  global.localStorage.setItem('skynet.needs-dismissed', JSON.stringify(['worker:wr1']));
  A.ok(!NY.items(NOW).some(i => i.key === 'worker:wr1'), 'a dismissed failure leaves the list');
  unread.delete('cron-r1');
  A.ok(!NY.items(NOW).some(i => i.key === 'routine:cron-r1'), 'a failed routine you have opened (read) leaves it too');
}
{
  // the liveness check settles a hung worker as stale too (reason "stalled: …"), with no restart at all.
  // wr8's `result` is a field /api/overseer does not project yet: its tip assertion pins the page's half only.
  const ledger = global.Overseer;
  global.Overseer = { snapshot: () => ({ workers: [
    { runId: 'wr6', status: 'stale', reason: 'stalled: no progress for 450s — the liveness check stopped this worker (threshold 420s)', agentId: 'researcher', parentStreamId: 'home', streamId: 'thread_mira', completedAt: NOW - 2000 },
    { runId: 'wr7', status: 'stale', reason: 'sidecar restarted before this worker finished', agentId: 'designer', parentStreamId: 'home', completedAt: NOW - 3000 },
    { runId: 'wr8', status: 'error', reason: 'refused', failure: 'subagent could not start — the concurrency cap (STARNET_MAX_CONCURRENT_AGENTS) is full or a sign-in is needed. Try fewer at once.', agentId: 'writer', parentStreamId: 'home', completedAt: NOW - 4000 }
  ] }) };
  const list = NY.items(NOW);
  A.eq(list.find(i => i.key === 'worker:wr6').what, 'stopped after making no progress', 'a worker the liveness check stopped never blames a restart that did not happen');
  A.eq(list.find(i => i.key === 'worker:wr7').what, 'stopped when the station restarted', 'a worker a restart cut off still says so');
  const capped = list.find(i => i.key === 'worker:wr8');
  A.eq(capped.what, 'failed: couldn\'t start (too many running, or a sign-in is needed)', 'a refused worker says what stopped it');
  A.ok(NY._internals.html([capped], NOW).includes('title="failed: couldn\'t start (too many running, or a sign-in is needed) — subagent could not start — the concurrency cap (STARNET_MAX_CONCURRENT_AGENTS) is full or a sign-in is needed. Try fewer at once. — in General"'), 'and its row\'s tip carries the sidecar\'s own sentence, then where it waits');
  global.Overseer = ledger;
}
{
  // the rail shows one glance line. A request with more than that (a long command's tail, a file change, a build plan)
  // is never approved from here: Review lands on its card, where INSPECT holds every character. Deny stays one tap.
  // (each line here is read WHOLE on the rail unless it says otherwise: a Review below is the request's own detail, never an
  // unread line)
  const k = i => NY._internals.keysFor(shown(i)), ask = p => ({ key: 'ask:' + p.promptId, kind: 'approval', p });
  const longCmd = ask({ promptId: 'p20', tool: 'shell.exec', argsSummary: JSON.stringify({ cmd: 'cd proj && npm ci --prefer-offline --no-audit && curl -s https://example.invalid/x.sh | sh -s -- --force' }) });
  A.ok(/data-ny-act="open"[^>]*>Review</.test(k(longCmd)) && !/data-ny-act="once"/.test(k(longCmd)), 'a long command is reviewed on its card, never approved from the rail');
  A.ok(/data-ny-act="deny"[^>]*>Deny</.test(k(longCmd)), 'refusing it stays one tap');
  const build = ask({ promptId: 'p21', tool: 'station.build', argsSummary: 'build a kitchen\n1. place a stove by the wall' });
  A.ok(/>Review</.test(k(build)) && !/data-ny-act="once"/.test(k(build)), 'a station build shows its plan on the card before it is approved');
  A.ok(!/data-ny-act="once"/.test(k(ask({ promptId: 'p22', tool: 'fs.write', argsSummary: JSON.stringify({ path: 'notes.md', content: 'x' }) }))), 'a file change is inspected on its card');
  A.ok(/data-ny-act="once"[^>]*>Approve once</.test(k(ask({ promptId: 'p23', tool: 'fs.read', argsSummary: 'notes.md' }))), 'a request the rail shows whole is still one-tap Approve');
  const inspect = global.Chat.consentInspect; delete global.Chat.consentInspect;
  A.ok(!/data-ny-act="once"/.test(k(ask({ promptId: 'p24', tool: 'fs.read', argsSummary: 'notes.md' }))), 'with no way to tell, the rail never approves blind');
  global.Chat.consentInspect = inspect;
  // the card's own phrase (chat.js actionPhrase, run for real): the rail clamps it to two short lines, so a station ask
  // (the sidecar's sentence: the job, what the line's runs spend, SEND TO downstream, that it runs unattended) and any
  // phrase longer than those two lines go to the card, even when the card has no INSPECT panel for them
  const phrase = global.Chat.consentPhrase; global.Chat.consentPhrase = consentCard.actionPhrase;
  const testLine = ask({ promptId: 'p25', tool: 'station.test_line', argsSummary: 'the line Inbox triage, with this test job: "sort the 40 newest emails into folders and draft a reply to every customer". It runs the line\'s agents and spends what they spend; the result lands in DELIVERABLES › TO REVIEW. If its OUTBOX has SEND TO, the downstream line also runs the result at its own cost.' });
  A.ok(/>Review</.test(k(testLine)) && !/data-ny-act="once"/.test(k(testLine)), 'a line test that spends money is reviewed on its card, never approved from the rail');
  const startLine = ask({ promptId: 'p26', tool: 'station.start_line', argsSummary: 'the line Inbox triage: run it every day at 9:00, with the job: "sort the inbox". From then on it runs the line\'s agents unattended, within the line\'s budget.' });
  A.ok(!/data-ny-act="once"/.test(k(startLine)), 'a line that will run unattended is reviewed on its card');
  A.ok(!/data-ny-act="once"/.test(k(ask({ promptId: 'p27', tool: 'station.control', argsSummary: 'turn the room light up' }))), 'every station ask is reviewed on its card');
  const longPath = ask({ promptId: 'p28', tool: 'fs.read', argsSummary: 'C:\\Users\\andro\\projects\\launch-prep\\drafts\\pricing\\tier-comparison-final.md' });
  A.eq(global.Chat.consentInspect(longPath.p), null, '(a bare path under the glance limit has no INSPECT panel on its card)');
  const cutKeys = NY._internals.keysFor(cut(longPath));
  A.ok(/>Review</.test(cutKeys) && !/data-ny-act="once"/.test(cutKeys), 'a path longer than the rail shows (its line read cut) is reviewed on its card');
  const unread = ask({ promptId: 'p32', tool: 'fs.read', argsSummary: 'notes.md' });
  NY._internals.measure({ querySelectorAll: () => [] }, []);
  A.ok(/>Review</.test(NY._internals.keysFor(unread)) && !/data-ny-act="once"/.test(NY._internals.keysFor(unread)), 'a line the rail has not read whole (not drawn yet, hidden) is reviewed, never approved blind');
  A.ok(/data-ny-act="once"[^>]*>Approve once</.test(k(ask({ promptId: 'p29', tool: 'fs.read', argsSummary: 'notes.md' }))), 'a short request is still one-tap Approve');
  // org P02 (g3 D1, final round): a direct-chat ask is reviewed through its own row — the row, its "in <where>" door and its
  // ask line open the COMMS card (the whole request, its Always / Full access keys) — so its keys are Approve once · Deny on ONE
  // row (three keys stacked into three full-width keys on the rail); a worker's ask reviews on its Delegated row's INSPECT
  const direct = k(ask({ promptId: 'p30', tool: 'fs.read', argsSummary: 'notes.md' }));
  A.eq((direct.match(/data-ny-act="[a-z]+"[^>]*>[^<]+</g) || []).map(x => x.replace(/^data-ny-act="([a-z]+)"[^>]*>([^<]+)<$/, '$1:$2')).join(' | '), 'once:Approve once | deny:Deny', 'a direct-chat row\'s keys: Approve once · Deny');
  const rowHtml = NY._internals.html([shown(Object.assign(ask({ promptId: 'p30', tool: 'fs.read', argsSummary: 'notes.md' }), { who: 'NOVA', where: 'General', what: 'fs read: notes.md', since: Date.now() }))], Date.now());
  A.ok(/<li class="ny-item approval ny-review" data-ny-key="ask:p30"[^>]*>/.test(rowHtml), 'its row is the Review door (the row click opens its card)');
  A.ok(/<button type="button" class="ny-where" data-ny-act="open" data-ny-key="ask:p30"[^>]* data-tip="Review it on its card: the whole request, and its Always and Full access keys">in General<\/button>/.test(rowHtml), '…and its "in <where>" door says so: ' + rowHtml.slice(0, 400));
  for (const w of [{ workerStreamId: 'thread_vex' }, { workerRunId: 'wr9' }, { background: true }]) {
    const wa = Object.assign(ask(Object.assign({ promptId: 'p31', tool: 'fs.read', argsSummary: 'notes.md' }, w)), { who: 'VEX', where: 'General', what: 'fs read: notes.md', since: Date.now() }), wk = k(wa);
    A.ok(/>Approve once</.test(wk) && />Deny</.test(wk) && !/>Review</.test(wk), 'a worker ask keeps Approve once · Deny (its review is the Delegated INSPECT): ' + Object.keys(w)[0]);
    A.ok(!/ny-review/.test(NY._internals.html([shown(wa)], Date.now())), '…and its row is not offered as the Review door: ' + Object.keys(w)[0]);
  }
  const glassCss = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'css', 'pipglass.css'), 'utf8');
  A.ok(/\.ny-keys \{ display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; \}/.test(glassCss) && /\.ny-key \{\s*flex: 1 1 auto; min-width: 0; min-height: 34px; padding: 5px 8px; font: 15px\/1\.1 'VT323'/.test(glassCss) && !/\.ny-key\.ny-review \{ flex: 1 1 100%; \}/.test(glassCss)
    && /\.ny-keys > \.ny-key \{ flex: 1 1 0; min-width: max-content; min-height: 34px; \}/.test(glassCss),
    'a row has two keys, never three: they share its text column where both labels fit (the 232px rail at STANDARD) and stack, whole and 34px tall, where they do not (the 200px rail; test/needs-you-rail-fit.test.js lays both out)');
  // (two reviews 10-16) "in <where>" was display:none on every default rail (a 250px container query): approval rows never
  // said which conversation asks, keyboard focus fell to the page while an answer was on its way (the focus assertions below
  // run on a host with no CSS, so they never saw it), and build / STEP-IN / extension / loop / group rows had nothing to focus
  A.ok(!/\.ny-where[^{}]*\{[^}]*display:\s*none/.test(glassCss), 'no rule takes "in <where>" out with display:none: it stays a focusable door on every rail');
  A.ok(/@container \(max-width: \d+px\) \{\s*body\.glass-demo:not\(\.hud-mode\) #left \.ws-needs \.ny-where \{[^}]*position: absolute;[^}]*clip-path: inset\(50%\);/.test(glassCss),
    'on a narrow rail it is only hidden from sight (clipped, still focusable and read)');
  // live 10-16: put back into the line on keyboard focus it was a 0-22px stub on the 200px rail, so the focus showed nowhere
  A.ok(/\.ny-item:has\(> \.ny-line > \.ny-where:focus-visible\) \{ outline: 2px solid var\(--ph-bright\); outline-offset: -2px; \}/.test(glassCss),
    'a keyboard focus on a row\'s door rings the whole row (an edge, on every rail), so it is seen where the door is out of sight');
  const doorRow = NY._internals.html([shown(Object.assign(ask({ promptId: 'p33', tool: 'fs.read', argsSummary: 'notes.md' }), { who: 'NOVA', where: 'Launch prep', what: 'use fs read: notes.md', since: Date.now() }))], Date.now());
  A.ok(/<button type="button" class="ny-where" data-ny-act="open" data-ny-key="ask:p33" aria-label="NOVA wants to use fs read: notes\.md — in Launch prep"/.test(doorRow), 'the door\'s name says who, what, and where it lands: ' + doorRow.slice(0, 600));
  A.ok(/<div class="ny-what" title="use fs read: notes\.md — in Launch prep — Review it on its card/.test(doorRow), 'the line\'s hover tip says where it waits (the place the narrow rail hides from the line)');
  A.eq((NY._internals.keysFor(cut(longPath)).match(/>Review</g) || []).length, 1, 'a cut line still shows exactly one Review, never a blind Approve');
  A.eq((k(longCmd).match(/>Review</g) || []).length, 1, 'a hidden-detail ask read whole still shows exactly one Review, never a blind Approve');
  global.Chat.consentPhrase = phrase;
}
{
  const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
  const html = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'index.html'), 'utf8');
  A.ok(!/railAttentionOnly|ws-attention/.test(app) && !/id="ws-attention"/.test(html), 'the "Waiting for you" filter is retired');
  A.ok(/<section id="ws-needs" class="ws-needs" aria-label="Needs you" hidden><\/section>/.test(html) && html.indexOf('app/needsyou.js') > 0, 'the page has the NEEDS YOU section and loads its module');
  // app-shell-ui-04 / seams-04: bounded in every mode (glass, plain, hud) — an expanded "N more" scrolls inside its card,
  // so the lower asks' keys and "Show fewer" stay reachable, with a themed scrollbar (never a white native one)
  const glass = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'css', 'pipglass.css'), 'utf8');
  A.ok(/\n#left \.ws-needs \{[^}]*max-height: min\(48%, 440px\);[^}]*overflow-y: auto;[^}]*overscroll-behavior: contain;/.test(glass), 'NEEDS YOU has a height bound and scrolls inside its card, unscoped so every rail mode gets it');
  A.ok(/\n#left \.ws-needs::-webkit-scrollbar-thumb \{[^}]*background: var\(--ph-dim\)/.test(glass) && /\n#left \.ws-needs \{[^}]*scrollbar-color: var\(--ph-dim\) transparent/.test(glass), 'its scrollbar is themed like COMMS');
  A.ok(/if \(railView !== 'sessions'\) \{ host\.hidden = true; return; \}\s*\n\s*if \(typeof NeedsYou !== 'undefined' && NeedsYou\.render\) NeedsYou\.render\(\);/.test(app), 'the rail renders it (SESSIONS view only)');
  A.ok(/NeedsYou\.render\(\);   \/\/ ages tick, failures arrive/.test(app), 'and the 1s rail heartbeat keeps it current');
  const ny = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'needsyou.js'), 'utf8');
  A.ok(/Chat\.answerConsent\(i\.p, Workstreams\.get\(i\.wsId\), kind, 'needs-you'\)/.test(ny), 'Approve / Deny answer through the approval card\'s own path (and say they came from NEEDS YOU)');
  A.ok(/fetch\('\/api\/cron\/run', \{ method: 'POST'[^\n]*detach: true/.test(ny), 'Retry reruns the routine for real (detached)');
}
/* ---- the rail's 1s heartbeat: an age tick never rebuilds the list (focus survives), an answer in flight stays locked ---- */
// a host that understands exactly the markup html() writes (no DOM library in this repo's headless tests)
function fakeRail() {
  const doc = { activeElement: null };
  const host = { hidden: false, writes: 0, buttons: [], rows: [], listeners: {}, _h: '',
    setAttribute() {}, addEventListener(type, fn) { this.listeners[type] = fn; },
    contains: n => host.buttons.includes(n),
    querySelectorAll: sel => sel === 'li.ny-item[data-ny-key]' ? host.rows : sel === '[data-ny-act]' ? host.buttons : [],
    querySelector: sel => sel === '.ny-more' ? host.buttons.find(b => /\bny-more\b/.test(b.className)) || null : null,
    get innerHTML() { return this._h; },
    set innerHTML(h) {
      if (this.buttons.includes(doc.activeElement)) doc.activeElement = null;   // a removed element loses focus to the page
      this._h = h; this.writes++;
      this.buttons = [...h.matchAll(/<button type="button" class="([^"]*)" data-ny-act="([^"]*)"([^>]*)>/g)].map(m => {
        const key = /data-ny-key="([^"]*)"/.exec(m[3]);
        const b = { className: m[1], dataset: { nyAct: m[2], nyKey: key ? key[1] : undefined }, disabled: / disabled/.test(m[3]), focus() { if (!b.disabled) doc.activeElement = b; } };   // a disabled key cannot take focus
        return b;
      });
      this.rows = [...h.matchAll(/<li class="ny-item [^"]*" data-ny-key="([^"]*)"[^>]*>[\s\S]*?<span class="ny-age">([^<]*)<\/span>/g)].map(m => {
        const ageEl = { textContent: m[2] };
        return { dataset: { nyKey: m[1] }, ageEl, querySelector: sel => sel === '.ny-age' ? ageEl : sel === '.ny-what' ? WHOLE : null };   // each line fits its row
      });
    } };
  doc.getElementById = id => id === 'ws-needs' ? host : null;
  return { doc, host, key: (act, k) => host.buttons.find(b => b.dataset.nyAct === act && b.dataset.nyKey === k) };
}
(async () => {
  const realNow = Date.now, realDoc = global.document;
  let clock = NOW; Date.now = () => clock;
  const { doc, host, key } = fakeRail(); global.document = doc;
  const drawn = [];
  const write = Object.getOwnPropertyDescriptor(host, 'innerHTML').set;
  Object.defineProperty(host, 'innerHTML', { get() { return this._h; }, set(h) { drawn.push(h); write.call(this, h); }, configurable: true });
  NY.render();
  A.eq(host.writes, 2, 'the first render draws the list, then once more when it has read each ask line whole');
  A.ok(/data-ny-act="open" data-ny-key="ask:p2"[^>]*>Review</.test(drawn[0]) && !/data-ny-act="once"/.test(drawn[0]), '…the first draw offers Review: no line is read yet');
  A.ok(key('once', 'ask:p2') && !host.buttons.some(x => x.dataset.nyAct === 'open' && x.dataset.nyKey === 'ask:p2' && x.className.split(' ').includes('ny-key')), '…and the redraw offers Approve once for the line read whole, before anything paints');
  doc.activeElement = key('once', 'ask:p2');
  clock = NOW + 60000; NY.render();
  A.eq(host.writes, 2, 'a minute passing does not rebuild the list');
  A.eq(host.rows.find(r => r.dataset.nyKey === 'ask:p2').ageEl.textContent, '3m', 'only the age text moves, in place');
  A.ok(doc.activeElement === key('once', 'ask:p2'), 'so the key the Commander is on keeps its focus');
  pend.push({ wsId: 'proj', p: { promptId: 'p30', tool: 'fs.read', argsSummary: 'notes.md', askedAt: NOW - 30000 } });
  NY.render();
  A.eq(host.writes, 3, 'a new ask rebuilds the list (folded under "more", it is not read yet, so nothing redraws)');
  A.ok(doc.activeElement && doc.activeElement === key('once', 'ask:p2'), 'and focus lands back on the same key in the new list');
  // an answer in flight: both keys stay disabled through every re-render, and a second click sends nothing
  let calls = 0, settle = null;
  const answerConsent = global.Chat.answerConsent;
  global.Chat.answerConsent = () => { calls++; return new Promise(r => { settle = r; }); };
  const click = b => host.listeners.click({ target: { closest: sel => sel === '[data-ny-act]' ? b : null }, preventDefault() {}, stopPropagation() {} });
  click(key('once', 'ask:p2'));
  A.ok(key('once', 'ask:p2').disabled && key('deny', 'ask:p2').disabled, 'Approve and Deny are disabled while the answer is in flight');
  A.ok(doc.activeElement === key('open', 'ask:p2'), 'a keyboard answer keeps focus on that ask\'s row (its "in <where>" key), never drops it to the page');
  clock += 1000; pend.push({ wsId: 'proj', p: { promptId: 'p31', tool: 'fs.read', argsSummary: 'b.md', askedAt: NOW - 20000 } }); NY.render();
  A.ok(key('once', 'ask:p2').disabled && key('deny', 'ask:p2').disabled, 'and stay disabled when the list rebuilds meanwhile');
  A.ok(doc.activeElement === key('open', 'ask:p2'), 'and focus stays on that row through the rebuild');
  click(key('once', 'ask:p2')); click({ dataset: { nyAct: 'deny', nyKey: 'ask:p2' } });
  A.eq(calls, 1, 'a second click on a settling ask sends no second answer');
  pend.splice(pend.findIndex(x => x.p.promptId === 'p2'), 1);
  settle(); await new Promise(r => setTimeout(r, 0));
  A.ok(!key('once', 'ask:p2') && !/ask:p2/.test(host.innerHTML), 'once answered, the ask leaves the list');
  // an answer that fails: the keys come back, and so does the focus
  let fail = null;
  global.Chat.answerConsent = () => new Promise((_, no) => { fail = no; });
  doc.activeElement = key('once', 'ask:p30');
  click(key('once', 'ask:p30'));
  // org P02 (g3 D1, final round): a direct-chat row's Review is its row's own door, so focus waits on that row's "in <where>"
  // door (live while the keys are locked), never dropped to the page
  const review30 = host.buttons.find(b => b.dataset.nyAct === 'open' && b.dataset.nyKey === 'ask:p30' && b.className.split(' ').includes('ny-where'));
  A.ok(key('once', 'ask:p30').disabled && review30 && doc.activeElement === review30, 'a second ask in flight: its keys lock, focus waits on its row (its review door)');
  fail(new Error('the station is offline')); await new Promise(r => setTimeout(r, 0));
  A.ok(!key('once', 'ask:p30').disabled && doc.activeElement === key('once', 'ask:p30'), 'the answer failed: Approve is back and so is the focus');
  global.Chat.answerConsent = answerConsent; Date.now = realNow; global.document = realDoc;
  pend.splice(pend.findIndex(x => x.p.promptId === 'p30'), 1); pend.splice(pend.findIndex(x => x.p.promptId === 'p31'), 1);
})().then(() => A.report('needs-you.test'), e => { console.error(e); process.exit(1); });
