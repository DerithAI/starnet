/* node test/cli-dashboard.test.js — the `starnet` dashboard, ls, approve and watch: their PURE parts, no I/O.

   Locks: the new commands parse (and a bare `starnet` opens the dashboard only at a terminal) · task-vs-talk rides
   every run body (a run without isTask is offered no tools) · the station model says only what the station proved
   (working while a run is live, needs-you while an ask waits, done only after run.end{done}, a run that vanished
   unseen is never "done", unknown spend is never $0) · the screen fits the terminal, shows the open ask as a card,
   and never lets model text drive the terminal · watch prints one line per meaningful event. Part of test:fast. */
'use strict';
const A = require('./_assert.js');
const core = require('../bin/lib/cli-core.js');
const { makeStation, sourceOf, toolName, oneLine, RECENT_MS, costText } = require('../bin/lib/station-model.js');
const tui = require('../bin/lib/tui.js');
const sc = require('../bin/lib/station-commands.js');

// ---- argv ---------------------------------------------------------------------------------------------------
{
  A.eq(core.parseArgs([], {}, { tty: true }).cmd, 'dash', 'a bare `starnet` at a terminal opens the dashboard');
  A.ok(core.parseArgs([], {}, { tty: false }).help, 'a bare `starnet` in a pipe prints the usage, never a screen');
  A.ok(core.parseArgs([], {}).help, 'no context → usage (the old contract)');
  A.eq(core.parseArgs(['ls', '--json'], {}).cmd + ':' + core.parseArgs(['ls', '--json'], {}).json, 'ls:true', 'ls --json');
  const ap = core.parseArgs(['approve', 'cypher', '--session'], {});
  A.eq([ap.cmd, ap.args, ap.session], ['approve', ['cypher'], true], 'approve <agent> --session');
  A.eq(core.parseArgs(['deny'], {}).cmd, 'deny', 'deny with no agent');
  const fl = core.parseArgs(['flow', 'run', 'release', 'ship the notes'], {});
  A.eq([fl.cmd, fl.args], ['flow', ['run', 'release', 'ship the notes']], 'flow run <name> <text>');
  const throws = (argv, re, label) => { let m = ''; try { core.parseArgs(argv, {}); } catch (e) { m = e.message; } A.ok(re.test(m), label + ': ' + m); };
  throws(['flow', 'run', 'release'], /needs a workflow and the job text/, 'flow run without text is a usage error');
  throws(['approve', 'a', 'b'], /at most one agent/, 'approve takes one agent');
  A.eq(core.parseArgs(['watch'], {}).cmd, 'watch', 'watch');
  A.ok(/starnet ls/.test(core.USAGE) && /6 nothing to answer/.test(core.USAGE), 'the usage names the new commands and exit code');
}

// ---- small pure helpers ---------------------------------------------------------------------------------------
{
  A.eq(core.cliStreamId('astra'), 'cli-astra', 'the terminal conversation id');
  A.ok(/^[A-Za-z0-9_-]{1,64}$/.test(core.cliStreamId('we!rd id/../x' + 'y'.repeat(80))), 'always a valid stream id');
  const sse = core.splitSse('retry: 3000\n\nid: e:1\ndata: {"name":"a"}\n\ndata: {}\n\nid: e:2\ndata: {"na');
  A.eq(sse.events.map(e => e.id + '|' + e.data), ['e:1|{"name":"a"}', '|{}'], 'complete events out (the retry hint dropped)');
  A.eq(sse.rest, 'id: e:2\ndata: {"na', 'the partial tail is kept');
  A.ok(core.isTaskText('write the release notes'), 'an instruction is a task (tools offered)');
  A.ok(!core.isTaskText('thanks!'), 'a pleasantry is talk');
  A.ok(core.isTaskText('yes', 'Want me to draft it?'), 'a yes to an offer to act is the task');
  A.eq(core.buildRunBody({ model: 'm', provider: 'p', agentId: 'agent' }, 'fix the build', {}).isTask, true, 'starnet -p marks a task (without it the station offers no tools)');
  A.eq(core.buildRunBody({ model: 'm', provider: 'p', agentId: 'agent' }, 'hello', {}).isTask, false, '…and talk as talk');
  A.eq([toolName('fs_write'), toolName('fs.write'), toolName('web')], ['fs.write', 'fs.write', 'web'], 'tool names as the station says them');
  A.eq(oneLine('{\n  "a": "x\\ny"\n}', 100), '{ "a": "x y" }', 'pretty JSON reads as one line');
  A.eq(costText({ usd: null, atLeast: null }), 'spend unknown', 'unknown spend is never $0');
  A.eq(costText({ usd: null, atLeast: 0.5 }), '≥$0.50 today', 'unsettled spend says at least');
  A.eq(costText({ usd: 1.234 }), '$1.23 today', 'settled spend');
}

// ---- the station model -------------------------------------------------------------------------------------------
const T0 = 1700000000000;
function crew() {
  const m = makeStation();
  m.setRoster({ agents: [{ agentId: 'astra', name: 'Astra', model: 'm/a', provider: 'openrouter' }, { agentId: 'agent', name: 'Nova', model: 'm/n' }, { agentId: 'cypher', name: 'Cypher', model: 'm/c' }] });
  return m;
}
{
  const m = crew();
  A.eq(m.state.order, ['agent', 'astra', 'cypher'], 'the hero leads the crew, then the roster order');
  A.eq(m.rows(T0).map(r => r.status.key), ['idle', 'idle', 'idle'], 'nobody works until a run proves it');

  m.apply('agent.run.start', { runId: 'r1', agentId: 'astra', trigger: 'directive', surface: 'interactive', streamId: 'desk-1', prompt: 'fix the redirect' }, T0);
  let astra = m.rows(T0 + 5000).find(r => r.id === 'astra');
  A.eq([astra.status.key, astra.status.since], ['working', T0], 'a live run = working, timed from its start');
  A.eq(m.logOf('astra')[0].k + ':' + m.logOf('astra')[0].source + ':' + m.logOf('astra')[0].text, 'start:desktop:fix the redirect', 'a desk run shows its asking prompt, said as from the app');
  m.apply('agent.tool_call', { runId: 'r1', agentId: 'astra', callId: 'c1', name: 'fs_read', argsSummary: '{"path":"auth.js"}' }, T0 + 100);
  A.eq(m.rows(T0 + 200).find(r => r.id === 'astra').now, 'fs.read auth.js', 'NOW is the tool it is running, said by its salient argument (never the raw JSON)');
  {
    const { argDigest } = require('../bin/lib/station-model.js');
    A.eq(argDigest('{"path":"notes.md","content":"# Notes\\n\\nFour comp', 'fs.write'), 'notes.md', 'a write cut mid-content still says its file');
    A.eq(argDigest('{"command":"npm run test:fast","cwd":"C:/w"}', 'shell.exec'), 'npm run test:fast', 'a shell call says its command');
    A.eq(argDigest('{"content":"a body the cut halved', 'fs.write'), '{"content":"a body the cut halved', 'a value the cut halved is never shown as whole: the raw line stays');
    A.eq(argDigest('{"workers":[{"agentId":"astra","task":"x"},{"agentId":"cyp', 'team.dispatch', id => id === 'astra' ? 'ASTRA' : ''), 'ASTRA …', 'a hand-off names its workers, and marks the cut');
    A.eq(argDigest('{}', 'brief.proceed'), '', 'no arguments, no words');
  }
  m.apply('agent.tool_result', { runId: 'r1', agentId: 'astra', callId: 'c1', ok: true, ms: 12, summary: '212\nlines' }, T0 + 300);
  const tool = m.logOf('astra').find(e => e.k === 'tool');
  A.eq([tool.running, tool.ok, tool.res], [false, true, '212 lines'], 'the outcome lands on its call');
  m.apply('agent.token', { runId: 'r1', agentId: 'astra', delta: 'Found ' }, T0 + 400);
  m.apply('agent.token', { runId: 'r1', agentId: 'astra', delta: 'it.' }, T0 + 410);
  m.apply('agent.cost', { runId: 'r1', agentId: 'astra', usd: 0.01 }, T0 + 420);
  m.apply('agent.token', { runId: 'r1', agentId: 'astra', delta: 'Next turn.' }, T0 + 430);
  const texts = m.logOf('astra').filter(e => e.k === 'agent').map(e => e.text);
  A.eq(texts, ['Found it.', 'Next turn.'], 'the reply is the streamed tokens; a new model turn is a new line');

  m.apply('permission.prompt', { runId: 'r1', agentId: 'astra', promptId: 'p1', tool: 'fs.write', scope: 'write', argsSummary: '{\n "path": "auth.js"\n}' }, T0 + 500);
  astra = m.rows(T0 + 600).find(r => r.id === 'astra');
  A.eq(astra.status.key, 'needs', 'an open ask = needs you');
  A.eq(m.header(T0).needs, 1, 'the header counts it');
  A.eq(m.front().summary, 'auth.js', 'the ask reads as what it acts on (the station sends the whole request; the terminal words its glance)');
  m.apply('permission.response', { runId: 'r1', agentId: 'astra', promptId: 'p1', decision: 'once', via: 'terminal' }, T0 + 700);
  A.eq([m.front(), m.rows(T0 + 800).find(r => r.id === 'astra').status.key], [null, 'working'], 'answered → back to working');
  A.ok(/allowed once from the terminal/.test(m.logOf('astra').slice(-1)[0].text), 'the conversation says who answered');
  m.apply('agent.run.end', { runId: 'r1', agentId: 'astra', reason: 'done', usd: 0.02 }, T0 + 1000);
  A.eq(m.rows(T0 + 1500).find(r => r.id === 'astra').status.key, 'done', 'done only after run.end{done}');
  A.eq(m.rows(T0 + 1000 + RECENT_MS + 1).find(r => r.id === 'astra').status.key, 'idle', 'and then it settles to idle');

  m.apply('agent.run.start', { runId: 'r2', agentId: 'cypher', trigger: 'directive' }, T0);
  m.apply('agent.run.end', { runId: 'r2', agentId: 'cypher', reason: 'budget', usd: 0 }, T0 + 10);
  A.eq(m.rows(T0 + 20).find(r => r.id === 'cypher').status, { key: 'stopped', text: 'budget' }, 'a run that ended early says why, never "done"');
}
{
  // the snapshot: adopt a run the feed never started; end one it no longer lists as UNSEEN, never as done
  const m = crew();
  m.applySnapshot({ runs: [{ runId: 'rX', agentId: 'cypher', startedAt: T0, source: 'interactive' }, { runId: 'rI', agentId: 'agent', startedAt: T0, internal: true }], prompts: [{ runId: 'rX', agentId: 'cypher', promptId: 'pX', tool: 'fs.write' }] }, T0 + 100);
  A.eq(m.rows(T0 + 200).find(r => r.id === 'cypher').status.key, 'needs', 'a snapshot ask is adopted');
  A.eq(m.rows(T0 + 200).find(r => r.id === 'agent').status.key, 'idle', 'self-talk (internal) never shows as work');
  A.ok(m.logOf('cypher').some(e => e.k === 'start' && e.adopted), 'a run already under way says so in its conversation');
  A.eq(m.logOf('cypher').find(e => e.k === 'ask').text, 'asks: fs.write', 'an adopted ask arrives without its words');
  m.describePrompt('pX', '{\n "path": "notes.md"\n}');
  A.eq([m.logOf('cypher').find(e => e.k === 'ask').text, m.front().summary], ['asks: fs.write notes.md', 'notes.md'], 'once its request is read, the ask line names it');
  m.applySnapshot({ runs: [], prompts: [] }, T0 + 1000);
  A.eq(m.rows(T0 + 1100).find(r => r.id === 'cypher').status.key, 'needs', 'inside the grace a run (and its ask) that just left the snapshot is not dropped');
  m.applySnapshot({ runs: [], prompts: [] }, T0 + 10000);
  const row = m.rows(T0 + 10001).find(r => r.id === 'cypher');
  A.ok(row.status.key !== 'done' && /ended unseen/.test(row.now), 'a run that vanished unseen is said as unseen, never as done: ' + JSON.stringify(row));
  A.eq(m.front(), null, 'and its ask is gone');
}
{
  // what this terminal sends
  const m = crew();
  m.apply('agent.run.start', { runId: 'r1', agentId: 'astra', trigger: 'directive', surface: 'interactive' }, T0);
  m.noteSent('astra', 'also check logout', 'cli-astra', T0 + 10);
  const log1 = m.logOf('astra');
  A.ok(log1.some(e => e.k === 'you' && e.queued) && log1.some(e => /queued/.test(e.text)), 'a message to a busy agent says it is queued');
  m.apply('agent.run.start', { runId: 'r9', agentId: 'astra', trigger: 'directive', surface: 'interactive', streamId: 'cli-astra', prompt: 'also check logout' }, T0 + 50);
  A.ok(!m.logOf('astra').some(e => e.k === 'start' && e.runId === 'r9'), 'its own run start does not print the message twice');
  A.ok(!m.logOf('astra').find(e => e.k === 'you').queued, 'and the message is marked delivered');
  m.noteSent('cypher', 'hi', 'cli-cypher', T0);
  m.sendFailed('cypher', 'cli-cypher', 'no model selected', T0 + 5);
  A.ok(/not sent: no model selected/.test(m.logOf('cypher').slice(-1)[0].text), 'a refused message says why');
  m.seedHistory('cypher', [{ role: 'user', content: 'earlier q' }, { role: 'assistant', content: 'earlier a' }, { role: 'tool', content: 'x' }]);
  A.eq(m.logOf('cypher').slice(0, 3).map(e => e.k + ':' + e.text), ['sys:— earlier in this terminal conversation —', 'you:earlier q', 'agent:earlier a'], 'earlier terminal turns come first, under their divider');
  // a delegated worker's ask is the worker's
  m.apply('permission.prompt', { runId: 'r1', agentId: 'astra', workerAgentId: 'cypher', promptId: 'pw', tool: 'fs.write' }, T0);
  A.eq(m.front().agentId, 'cypher', "a worker's ask is filed under the worker");
  A.eq(m.findAgent('cyp').id, 'cypher', 'agents are found by a name prefix');
  A.eq(m.findAgent('@NOVA').id, 'agent', '…or by name, @ and case ignored');
  A.eq(sourceOf({ streamId: 'cli-x' }) + sourceOf({ lineId: 'L1' }) + sourceOf({ trigger: 'schedule' }), 'terminalflowroutine', 'run sources');
}
{
  // budget + flows
  const m = crew();
  m.applyBudget({ spentToday: null, atLeast: 0.25 });
  A.eq(costText(m.state.cost), '≥$0.25 today', 'an unsettled ledger reads as at least');
  m.applyBudget({ spentToday: null, atLeast: { today: 0, lifetime: 1.35, runs: 815 } });
  A.eq(costText(m.state.cost), 'spend unsettled', "the station's own floor shape ({ today, lifetime, runs }) at $0.00 names the state, never reads as $0");
  m.applyBudget({ spentToday: null, atLeast: { today: 0.4, lifetime: 1.75, runs: 816 } });
  A.eq(costText(m.state.cost), '≥$0.40 today', 'a floor above zero reads as at least');
  m.applyLines({ lines: [{ lineId: 'L9' }] }, [{ id: 'j9', line: 'L9', name: 'CRUCIBLE', status: 'delivered', startedAt: T0, endedAt: T0 + 1000, steps: 8 }]);
  A.eq(m.flows(T0 + 5 * 86400000).find(x => x.lineId === 'L9').state, 'done', 'a delivered job is the line succeeding');
  A.ok(/5d ago/.test(m.flows(T0 + 5 * 86400000 + 2000).find(x => x.lineId === 'L9').text), 'old jobs read in days');
  m.applyLines({ lines: [{ lineId: 'L1', runs: 3, shipped: 2 }] }, [{ id: 'j1', line: 'L1', name: 'RELEASE', status: 'done', startedAt: T0, endedAt: T0 + 60000, steps: 3 }]);
  m.apply('agent.run.start', { runId: 'rf', agentId: 'astra', trigger: 'event', lineId: 'L1' }, T0 + 70000);
  const f = m.flows(T0 + 75000)[0];
  A.eq([f.name, f.state, f.agents], ['RELEASE', 'running', ['ASTRA']], 'a flow is running while a run on its line is live, named from its jobs');
  A.eq(m.findLine('rel').lineId, 'L1', 'a flow is found by a name prefix');
}

// ---- the screen ---------------------------------------------------------------------------------------------------
function screen(m, ui, cols, rows, now) { return tui.render(m, Object.assign({ focus: 'astra', input: '', scroll: 0, still: true, stationLabel: 'station · test' }, ui), { cols, rows }, now); }
{
  const m = crew();
  m.apply('agent.run.start', { runId: 'r1', agentId: 'astra', trigger: 'directive', surface: 'interactive', prompt: 'fix it' }, T0);
  m.apply('agent.token', { runId: 'r1', agentId: 'astra', delta: 'evil \x1b[2J\x1b]0;pwned\x07 text' }, T0 + 1);
  m.apply('permission.prompt', { runId: 'r1', agentId: 'astra', promptId: 'p1', tool: 'fs.write', argsSummary: 'auth.js (+2 −1)' }, T0 + 2);
  const rows = screen(m, {}, 110, 34, T0 + 3000);
  const text = rows.map(tui.toPlain);
  A.eq(rows.length, 34, 'one row per terminal line');
  A.ok(text.every(l => tui.width(l) <= 110), 'nothing is wider than the terminal');
  const logo = require('../bin/lib/logo.js');
  const dots = require('../bin/lib/sixel.js').brailleLogo();
  A.ok(dots.length === 3 && dots.every((l, i) => l.trim() && text[i].indexOf(l.trim()) === text[i].indexOf(l.trim()[0]) && text[i].indexOf(l.trim()) >= 0), 'without an image the screen opens on the REAL logo drawn in braille dots, three rows');
  A.ok(/[⠁-⣿]/.test(dots.join('')) && Math.max(...dots.map(l => l.length)) <= 45, 'the dot logo is the three-row size (45 columns)');
  {
    // the logo back as a dot grid: dot[y][x], 12 rows
    const BIT = [[1, 8], [2, 16], [4, 32], [64, 128]];
    const dot = Array.from({ length: 12 }, (_, y) => Array.from({ length: 90 }, (_, x) => { const ch = dots[y >> 2][x >> 1]; const b = ch ? ch.codePointAt(0) - 0x2800 : 0; return b > 0 && (b & BIT[y & 3][x & 1]) ? 1 : 0; }));
    const lit = y => dot[y].reduce((a, b) => a + b, 0);
    A.ok(lit(0) > 45 && lit(0) >= 3 * lit(1), 'the top edge is ONE dot thick, as in the logo (a sampled cut lit two rows for it): ' + lit(0) + ' vs ' + lit(1));
    const STAR = ['..X..', '..X..', '.X.X.', 'X...X', '.X.X.', '..X..', '..X..'];
    A.ok(STAR.every((l, dy) => [...l].every((c, dx) => (c === 'X') === (dot[4 + dy][26 + dx] === 1))), 'the A carries a drawn four-point star, hollow at its heart, nothing else in its box — never a sampled blob');
    // the T's stems lean exactly as the wordmark does: one dot right for every two rows up, the pairs on the braille cells
    A.ok([13, 16].every(base => [4, 5, 6, 7, 8, 9, 10].every(y => dot[y][base + ((11 - y) >> 1)] === 1 && dot[y][base + ((11 - y) >> 1) - 1] === 0)), 'every upright leans one dot per two rows, so each braille row repeats the same pattern');
  }
  A.ok(text.slice(0, 1).some(l => /1 needs you/.test(l)), 'the counts sit on the top row');
  const ascii = screen(m, { logo: 'ascii' }, 110, 34, T0 + 3000);
  const starCell = ascii.slice(0, 4).flat().find(([t]) => t.indexOf('✦') >= 0);
  A.ok(logo.word.every((l, i) => tui.toPlain(ascii[i]).indexOf(l.trim()) >= 0) && starCell && /logohi/.test(starCell[1]), 'STARNET_LOGO=ascii draws the drawn-letter version, the star in its A glinting');
  const crewTop = text.findIndex(l => /^╭─ CREW 3 /.test(l));
  const astraRow = text.findIndex(l => /^│▌ ▲ ASTRA +asks │/.test(l));
  A.ok(crewTop === 4 && astraRow === crewTop + 2 && text.some(l => /^│  ○ NOVA +│/.test(l)), 'the crew is a framed list down the left under the header, the agent in COMMS marked, its ask said in a word: ' + text[astraRow]);
  const sel = rows[astraRow].find(([t]) => /ASTRA/.test(t));
  A.ok(sel && /sel/.test(sel[1]) && /hi b/.test(sel[1]), 'the agent in COMMS sits on the highlight bar, in white: ' + (sel && sel[1]));
  A.ok(!rows.flat().some(([, st]) => /a[0-5]/.test(st)), 'one palette: no agent has a hue of its own');
  A.ok(!text.some(l => /NOW {2}/.test(l)), 'the ask on the card is not said again on a NOW line (the only busy agent is the one asking)');
  {
    const m2 = crew();
    m2.apply('agent.run.start', { runId: 'r1', agentId: 'astra', trigger: 'directive', surface: 'interactive', prompt: 'fix it' }, T0);
    m2.apply('permission.prompt', { runId: 'r1', agentId: 'astra', promptId: 'p1', tool: 'fs.write', argsSummary: 'auth.js (+2 −1)' }, T0 + 2);
    m2.apply('agent.run.start', { runId: 'r2', agentId: 'cypher', trigger: 'schedule', surface: 'autonomous', prompt: 'nightly tests' }, T0);
    m2.apply('agent.tool_call', { runId: 'r2', agentId: 'cypher', callId: 'c1', name: 'shell_exec', argsSummary: '{"command":"npm test"}' }, T0 + 5);
    const t2 = screen(m2, {}, 110, 34, T0 + 3000).map(tui.toPlain);
    const nowRow = t2.findIndex(l => /NOW {4}CYPHER › shell\.exec npm test/.test(l));
    A.ok(nowRow === 1 && t2[nowRow].indexOf('NOW') > 45 && !/ASTRA/.test(t2[nowRow]), 'a NOW line beside the logo says what the other busy ones are doing: ' + t2[nowRow]);
    A.ok(t2.some(l => /│  ⠋ CYPHER +\d+s │/.test(l)), 'a working agent in the crew list spins, and shows how long its run has gone');
    A.ok(/⠋ 2 working/.test(t2[0]), 'the working count spins too');
    const spun = tui.render(m2, { focus: 'astra', input: '', scroll: 0, still: false, stationLabel: '' }, { cols: 110, rows: 34 }, T0 + 3150).map(tui.toPlain);
    A.ok(spun.some(l => /│  ⠙ CYPHER/.test(l)), 'a moving screen turns the wheel (frame 2 at +150 ms)');
  }
  const commsRow = text.findIndex(l => /╭─ COMMS ▸ ASTRA /.test(l));
  A.ok(commsRow === crewTop && text[commsRow].indexOf('COMMS') > 20, 'COMMS is framed beside the crew, from right under the header, so it gets most of the screen');
  const compact = screen(m, {}, 70, 20, T0 + 3000).map(tui.toPlain);
  const cTop = compact.findIndex(l => /^╭─ COMMS ▸ ASTRA /.test(l));
  A.ok(/S T A R N E T/.test(compact[0]) && /1 needs you/.test(compact[0]) && cTop > 0 && cTop <= 3 && /2\/3 ─╮$/.test(compact[cTop].trimEnd()) && !compact.some(l => /CREW/.test(l)), 'a small terminal gets the one-line mark with the counts, and COMMS full width, saying which agent of how many: ' + compact[cTop]);
  A.ok(!screen(m, { logo: 'plain' }, 110, 34, T0).map(tui.toPlain).some(l => l.indexOf(logo.word[1].trim()) >= 0), 'STARNET_LOGO=plain keeps to the one-line mark');
  A.ok(text.some(l => /ASTRA asks/.test(l)) && text.some(l => /\[y\] allow once/.test(l)), 'the open ask is a card with its keys');
  A.ok(text.some(l => /evil {2}text|evil text/.test(l)), 'model text is shown…');
  A.ok(!rows.some(r => r.some(([t]) => /\x1b|\x07/.test(t))), '…with every escape sequence stripped before it reaches a cell');
  const ansi = rows.map(r => tui.toAnsi(r, 3)).join('\n');
  A.ok(!/\x1b\[2J|\x1b\]0;/.test(ansi), 'the ANSI output carries only our own styling');
  A.ok(!/\x1b\[(38|48);/.test(rows.map(r => tui.toAnsi(r, 0)).join('')), 'NO_COLOR level emits no colors');
  const narrow = screen(m, {}, 60, 30, T0).map(tui.toPlain);
  A.ok(narrow.every(l => tui.width(l) <= 60) && narrow.some(l => /^╭─ COMMS ▸ ASTRA /.test(l)), 'narrow: still fits, COMMS framed');
  {
    const m3 = crew();
    m3.applyLines({ lines: [{ lineId: 'L1' }, { lineId: 'L2', shipped: 19 }] }, [
      { id: 'j1', line: 'L1', name: 'Venture Crucible', status: 'delivered', endedAt: T0 - 5 * 86400000, steps: 8 },
      { id: 'j2', line: 'L2', name: 'RIFT / 98 Evolution', status: 'delivered', endedAt: T0 - 4 * 86400000, steps: 6 }]);
    const fl = screen(m3, {}, 119, 30, T0).map(tui.toPlain).find(l => /FLOWS/.test(l));
    A.ok(/Venture Crucible 5d ago +\+1\s*$/.test(fl) && !/RIFT/.test(fl), 'a flow that does not fit is counted, never cut off mid-word: ' + fl.slice(56));
  }
  {
    // MARKDOWN: an agent's reply reads as formatted text, never raw ** ` ``` markers
    const m6 = crew();
    m6.apply('agent.run.start', { runId: 'md', agentId: 'astra', trigger: 'directive', surface: 'interactive', prompt: 'how?' }, T0);
    m6.apply('agent.token', { runId: 'md', agentId: 'astra', delta: '## Steps\nDo it **here**, with `/model`:\n- first *thing*\n2. second [docs](https://starnetos.com/d)\n```\nstarnet ls\n```' }, T0 + 1);
    m6.apply('agent.run.end', { runId: 'md', agentId: 'astra', reason: 'done' }, T0 + 2);
    const segs = screen(m6, {}, 110, 34, T0 + 5);
    const t6 = segs.map(tui.toPlain);
    A.ok(t6.some(l => /│ ASTRA +Steps +│|ASTRA {3,}Steps/.test(l)) && !t6.some(l => /\*\*|```|`\/model`|## /.test(l)), 'markdown markers never reach the screen');
    A.ok(t6.some(l => /Do it here, with \/model:/.test(l)) && t6.some(l => /• first thing/.test(l)) && t6.some(l => /2\. second docs \(https:\/\/starnetos\.com\/d\)/.test(l)) && t6.some(l => /│ starnet ls/.test(l)), 'bold, code, bullets, numbered items, links and code blocks read as a terminal shows them');
    const bold = segs.flat().find(([t, s]) => t === 'here' && /hi b/.test(s)), code = segs.flat().find(([t, s]) => t === '/model' && /\bam\b/.test(s));
    A.ok(!!bold && !!code, 'bold is bold white, inline code is amber');
    // the PICKER (/model, /resume): filter by every typed word, the current item marked, the selection on the bar
    const items = [['codex', 'gpt-6.1-sol'], ['codex', 'gpt-5.6-sol'], ['openrouter', 'anthropic/claude-sonnet-5-5'], ['claude-cli', 'claude-opus-5-5']].map(([p, id]) => ({ cols: [[p + '  ', 'dim'], [id, 'fg']], search: p + ' ' + id, current: id === 'gpt-5.6-sol' }));
    A.eq(tui.pickerView({ items, filter: 'claude opus' }).map(i => i.search), ['claude-cli claude-opus-5-5'], 'the filter keeps items matching every word');
    const pk = screen(crew(), { picker: { title: 'MODEL · ASTRA', note: 'now codex · gpt-5.6-sol', filter: 'gpt', sel: 1, items } }, 110, 34, T0).map(tui.toPlain);
    A.ok(pk.some(l => /MODEL · ASTRA .*now codex · gpt-5\.6-sol/.test(l)) && pk.some(l => /› gpt.* 2 of 4/.test(l)), 'the picker says what it picks for, what it is now, the filter and the count');
    A.ok(pk.some(l => /▌● codex +gpt-5\.6-sol/.test(l)) && pk.some(l => / {2}codex +gpt-6\.1-sol/.test(l)) && !pk.some(l => /claude/.test(l)), 'the selection sits on the bar, the current one is marked, filtered-out items are gone');
    // a conversation switch starts the pane over
    const m7 = crew();
    m7.noteSent('astra', 'old talk', 'cli-astra', T0);
    m7.resetLog('astra', '— a new conversation with ASTRA —');
    A.eq(m7.logOf('astra').map(e => e.text), ['— a new conversation with ASTRA —'], '/new: the pane starts over under one divider');
  }
  {
    // the edges a long-lived station reaches: a long name, an hour-long run, a web request, a roster not loaded yet
    const m4 = crew();
    m4.setRoster({ agents: [{ agentId: 'comms-lead', name: 'Communications Lead', model: 'm' }] });
    m4.apply('agent.run.start', { runId: 'r9', agentId: 'comms-lead', trigger: 'schedule', surface: 'autonomous', prompt: 'nightly digest' }, T0 - 3725000);
    const t4 = screen(m4, { focus: 'comms-lead' }, 119, 30, T0).map(tui.toPlain);
    A.ok(t4.some(l => /│▌ ⠋ COMMUNICATIONS L… 1h02m │/.test(l)), 'a long name keeps its words and shortens with …; an hour-long run reads 1h02m');
    A.ok(t4.some(l => /╭─ COMMS ▸ COMMUNICATIONS LEAD /.test(l)) && t4.some(l => /│ ROUTINE +nightly digest/.test(l)), 'COMMS names it whole, and its speaker column fits the name');
    const { askGlance, fmtDur } = require('../bin/lib/station-model.js');
    A.eq([fmtDur(65000), fmtDur(3725000)], ['1m05s', '1h02m'], 'durations: minutes and seconds, then hours and minutes');
    A.eq(askGlance('web.request', JSON.stringify({ method: 'post', url: 'https://hooks.example.com/deploy' })), 'POST https://hooks.example.com/deploy', 'a web request asks with its method');
    const m5 = makeStation();
    const t5 = screen(m5, { focus: '' }, 110, 30, T0).map(tui.toPlain);
    A.ok(t5.some(l => /^╭─ COMMS ─/.test(l)) && t5.some(l => /connecting to the station…/.test(l)), 'before the roster loads, COMMS says it is connecting (never an empty frame titled —)');
  }
  A.ok(/needs at least/.test(tui.toPlain(screen(m, {}, 40, 10, T0)[0])), 'a terminal too small says so');
  const help = screen(m, { overlay: { title: 'COMMANDS', items: tui.HELP, foot: 'any key closes this' } }, 110, 34, T0).map(tui.toPlain);
  A.ok(help.some(l => /COMMANDS/.test(l)) && help.some(l => /\/flow run name text/.test(l)), '/help lists the commands');
  A.eq(tui.colorLevel({ NO_COLOR: '1', COLORTERM: 'truecolor' }, true), 0, 'NO_COLOR wins');
  A.eq(tui.colorLevel({ COLORTERM: 'truecolor' }, true), 3, '24-bit where the terminal says so');
  A.eq(tui.colorLevel({}, false), 0, 'no TTY, no color');
  A.eq(tui.width('日本'), 4, 'wide glyphs take two cells');
}

// ---- ls + watch formatting -----------------------------------------------------------------------------------------
{
  const m = crew();
  m.apply('agent.run.start', { runId: 'r1', agentId: 'astra', trigger: 'directive', surface: 'interactive' }, T0);
  m.apply('permission.prompt', { runId: 'r2', agentId: 'cypher', promptId: 'p', tool: 'fs.write', argsSummary: 'x.md' }, T0);
  const rows = sc.lsRows(m, T0 + 65000);
  A.eq(rows.map(r => r.status), ['idle', 'working', 'needs-you'], 'ls statuses');
  A.ok(/desktop run · 1m05s/.test(rows[1].now), 'ls says where a run came from and for how long');
  const out = sc.formatLs(rows, { usd: 0.4 }, 100);
  A.ok(/^AGENT\s+MODEL\s+STATUS\s+NOW/.test(out) && /1 working · 1 need you · \$0\.40 today/.test(out), 'ls table + summary line');
  const fmt = sc.makeWatchFormatter({ astra: 'ASTRA' });
  const at = new Date(2026, 9, 17, 12, 4, 31).getTime();
  A.eq(fmt({ name: 'agent.run.start', payload: { runId: 'r', agentId: 'astra', trigger: 'directive', surface: 'interactive', prompt: 'fix it' } }, at), ['12:04:31  ASTRA       ▸ started (desktop) "fix it"'], 'watch: a run start');
  A.eq(fmt({ name: 'agent.token', payload: { runId: 'r', agentId: 'astra', delta: 'Hello ' } }, at), [], 'tokens wait for a whole line');
  A.eq(fmt({ name: 'agent.token', payload: { runId: 'r', agentId: 'astra', delta: 'there.\nNext' } }, at), ['12:04:31  ASTRA       Hello there.'], 'a finished line prints');
  A.eq(fmt({ name: 'agent.run.end', payload: { runId: 'r', agentId: 'astra', reason: 'done', usd: 0.0012 } }, at), ['12:04:31  ASTRA       Next', '12:04:31  ASTRA       ■ done · $0.0012'], 'the rest flushes at the end');
  const ask = fmt({ name: 'permission.prompt', payload: { agentId: 'astra', tool: 'fs_write', argsSummary: '{\n "path": "a"\n}' } }, at)[0];
  A.ok(/▲ needs you · fs\.write a\s+\(starnet approve astra\)/.test(ask), 'watch: an ask on one line, with the command that answers it: ' + ask);
  {
    const { askGlance, askInspect } = require('../bin/lib/station-model.js');
    const w = JSON.stringify({ path: 'auth-fix.md', content: '# Fix\n\nKeep ?next= through.\n' }, null, 2);
    A.eq(askGlance('fs.write', w), 'auth-fix.md (3 lines)', 'a file write asks as its file and how much goes in');
    A.eq(askInspect('fs.write', w), 'File: auth-fix.md\n\n# Fix\n\nKeep ?next= through.\n', '[v] reads a file write as the file: its path, then its text as written');
    A.eq(askGlance('shell.exec', JSON.stringify({ command: 'npm run test:fast', cwd: 'C:/w' }, null, 2)), 'npm run test:fast', 'a command asks as the command');
    A.eq(askGlance('fs.write', 'auth.js (+2 −1)'), 'auth.js (+2 −1)', 'a summary the station already worded is kept');
  }
}

// ---- the real logo as an image (Sixel) ----------------------------------------------------------------------------
{
  const sx = require('../bin/lib/sixel.js');
  const r = sx.logoSixel({ cellW: 10, cellH: 20, rows: 4, maxCols: 80 });
  A.ok(r && r.rows === 4 && r.height === 78 && r.cols === Math.ceil(r.width / 10), 'the image fits four rows of 20 px cells: ' + JSON.stringify(r && { cols: r.cols, rows: r.rows, width: r.width, height: r.height }));
  A.ok(/^\x1bP0;1;0q"1;1;\d+;\d+/.test(r.sixel) && r.sixel.endsWith('\x1b\\'), 'a DCS Sixel with transparent background and raster size');
  const d = sx.decodeSixel(r.sixel);
  let lit = 0; for (const v of d.px) if (v >= 0) lit++;
  A.ok(d.width === r.width && d.height === r.height && lit / d.px.length > 0.05 && lit / d.px.length < 0.6, 'it decodes back to the wordmark: ' + (lit / d.px.length).toFixed(3) + ' of pixels lit');
  const narrow = sx.logoSixel({ cellW: 10, cellH: 20, rows: 4, maxCols: 30 });
  A.ok(narrow && narrow.rows < 4 && narrow.cols <= 30, 'a narrow terminal gets a shorter image that still fits');
  A.eq(sx.logoSixel({ cellW: 10, cellH: 20, rows: 4, maxCols: 3 }), null, 'no room at all → no image (the text logo stands in)');
  A.eq(sx.parseTermReplies('\x1b[6;20;10t\x1b[4;680;1200t\x1b[?61;4;6;7;14;21;22c', 120, 34), { sixel: true, cellW: 10, cellH: 20, replied: true }, "Windows Terminal's real reply: Sixel, 10×20 cells");
  A.eq(sx.parseTermReplies('\x1b[?1;2c', 80, 24).sixel, false, 'a terminal without Sixel draws the text logo');
  A.eq(sx.parseTermReplies('\x1b[4;680;1200t\x1b[?62;4c', 120, 34).cellH, 20, 'the cell size falls back to the window size ÷ its cells');
  A.eq(tui.sliceSegs([['abc', 'x'], ['de', 'y']], 2), [['c', 'x'], ['de', 'y']], 'a row beside the image starts to its right');
  const m = crew();
  const img = screen(m, { logoImage: { cols: 58, rows: 4 } }, 120, 30, T0).map(tui.toPlain);
  A.ok(img.slice(0, 4).every(l => l.slice(0, 58).trim() === ''), "the image's cells stay blank (the image is painted there, never written over)");
  A.ok(/0 working/.test(img[0].slice(61)) && /^╭─ CREW /.test(img[5]), 'the counts sit beside the image, the crew list under it: ' + img[0].slice(55, 120));
  A.ok(!img.some(l => l.indexOf(require('../bin/lib/logo.js').word[1].trim()) >= 0), 'with the image, the text logo is not drawn');
}

// ---- the portrait: an agent's station sprite as ASCII art beside COMMS -------------------------------------------------
{
  const zlib = require('node:zlib');
  const png = require('../bin/lib/png.js');
  const portrait = require('../bin/lib/portrait.js');
  // a minimal PNG writer: every row filtered with `filter(y)`, so each of the five filters is read back
  function encode(w, h, rgba, type, filter) {
    const ch = { 0: 1, 2: 3, 4: 2, 6: 4 }[type], stride = w * ch;
    const px = Buffer.alloc(stride * h);
    for (let i = 0; i < w * h; i++) {
      const s = i * 4, d = i * ch;
      if (type === 6) rgba.copy(px, d, s, s + 4);
      else if (type === 2) rgba.copy(px, d, s, s + 3);
      else if (type === 0) px[d] = rgba[s];
      else { px[d] = rgba[s]; px[d + 1] = rgba[s + 3]; }
    }
    const raw = Buffer.alloc((stride + 1) * h);
    for (let y = 0; y < h; y++) {
      const f = filter(y);
      raw[y * (stride + 1)] = f;
      for (let i = 0; i < stride; i++) {
        const x = px[y * stride + i], a = i >= ch ? px[y * stride + i - ch] : 0, b = y ? px[(y - 1) * stride + i] : 0, c = y && i >= ch ? px[(y - 1) * stride + i - ch] : 0;
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        const pred = [0, a, b, (a + b) >> 1, pa <= pb && pa <= pc ? a : pb <= pc ? b : c][f];
        raw[y * (stride + 1) + 1 + i] = (x - pred) & 255;
      }
    }
    const chunk = (kind, body) => { const len = Buffer.alloc(4); len.writeUInt32BE(body.length); return Buffer.concat([len, Buffer.from(kind, 'latin1'), body, Buffer.alloc(4)]); };
    const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = type;
    return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
  }
  // a figure: 40×80, a 10 px clear margin, the body 20×60 getting brighter downward
  const W = 40, H = 80, rgba = Buffer.alloc(W * H * 4);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = (y * W + x) * 4, inside = x >= 10 && x < 30 && y >= 10 && y < 70, v = inside ? Math.round(40 + (y - 10) * 3.5) : 0;
    rgba[i] = v; rgba[i + 1] = v; rgba[i + 2] = v; rgba[i + 3] = inside ? 255 : 0;
  }
  const back = png.decode(encode(W, H, rgba, 6, y => y % 5));
  A.ok(back.width === W && back.height === H && Buffer.from(back.data).equals(rgba), 'the PNG decoder reads RGBA back exactly through all five row filters');
  const grey = png.decode(encode(W, H, rgba, 4, y => (y * 3) % 5));
  A.ok(grey.data[(40 * W + 20) * 4] === rgba[(40 * W + 20) * 4] && grey.data[3] === 0 && grey.data[(40 * W + 20) * 4 + 3] === 255, 'grey + alpha reads back');
  const rgb = png.decode(encode(W, H, rgba, 2, () => 4));
  A.ok(rgb.data[3] === 255 && rgb.data[(40 * W + 20) * 4 + 1] === rgba[(40 * W + 20) * 4 + 1], 'RGB reads back opaque');
  let bad = ''; try { png.decode(Buffer.from('not a png at all, really not one')); } catch (e) { bad = e.message; }
  A.ok(/not a PNG/.test(bad), 'anything else throws (the caller draws no picture): ' + bad);
  const sprite = png.decode(require('fs').readFileSync(require('path').join(__dirname, '..', 'frontend', 'assets', 'sprites', 'alien', 'rot_south.png')));
  A.ok(sprite.width === 92 && sprite.height === 92 && sprite.data.some((v, i) => i % 4 === 3 && v === 255) && sprite.data.some((v, i) => i % 4 === 3 && v === 0), 'a real station sprite decodes: ' + sprite.width + '×' + sprite.height);

  const art = portrait.art(back, { rows: 12, maxCols: 26 });
  A.ok(art && art.rows === 12 && art.cols === 8, 'the figure is trimmed to its ink and drawn 12 rows tall, cells half as wide as tall: ' + (art && art.cols + '×' + art.rows));
  A.ok(art.cells.every(l => l.length === 8 && l.every(c => c && portrait.RAMP.indexOf(c.ch) >= 0 && c.lv >= 0 && c.lv <= 6)), 'every inked cell is a ramp character on the red ramp');
  A.ok(art.cells[0][3].lv < art.cells[11][3].lv && portrait.RAMP.indexOf(art.cells[0][3].ch) < portrait.RAMP.indexOf(art.cells[11][3].ch), 'brighter pixels draw denser, hotter characters');
  A.eq(portrait.art({ width: 4, height: 4, data: new Uint8Array(64) }), null, 'a blank image has no portrait');
  A.ok(portrait.art(back, { rows: 40, maxCols: 6 }).cols <= 6, 'a figure that would come out too wide is drawn shorter instead');
  const skins = portrait.parseSkins("DATA.SKINS = {\n  blank: {\"name\":\"Cadet\",\"set\":\"approved_android\"},\n  ultron: {\"name\":\"U\",\"set\":\"approved_ultron\"},\n  alien: {\"name\":\"Alien\",\"set\":\"alien\"},\n  junk: {not json},\n  evil: {\"set\":\"../../etc\"},\n};\nDATA.DEFAULT_SKIN = 'blank';");
  A.eq([skins.alien, skins.junk, skins.evil, skins['']], ['alien', undefined, undefined, 'approved_android'], "the app's skin table is read off data-shim.js; a bad line or a path-like set is skipped");
  A.eq([portrait.setFor('researcher', 'alien', skins), portrait.setFor('kaze', '', skins), portrait.setFor('ULTRON', 'alien', skins)], ['alien', 'approved_android', 'approved_ultron'], "the app's own rule: the skin's set, the default skin when it wears none, ULTRON its own");

  const m = crew();
  m.apply('agent.run.start', { runId: 'r1', agentId: 'astra', trigger: 'directive', surface: 'interactive', prompt: 'fix it' }, T0);
  const withPic = screen(m, { sprites: { astra: back } }, 140, 40, T0 + 1000);
  const plain = withPic.map(tui.toPlain);
  const commsTop = plain.findIndex(l => /╭─ COMMS/.test(l));
  A.ok((plain[commsTop].match(/╮/g) || []).length === 3, 'the portrait has its own frame beside COMMS (CREW, COMMS, portrait): ' + plain[commsTop]);
  const picCells = withPic.flatMap((r, y) => { let x = 0; const out = []; for (const [t, s] of r) for (const ch of t) { if (/^r[0-6]$/.test(s)) out.push({ x, y }); x += tui.width(ch); } return out; });
  const commsRight = plain[commsTop].indexOf('╮');
  A.ok(picCells.length >= 8 * 12 && picCells.every(c => c.x > commsRight), 'the figure is drawn on the red ramp, right of COMMS: ' + picCells.length + ' cells');
  A.ok(plain.every(l => tui.width(l) <= 140), 'it still fits the terminal');
  const noPic = screen(m, { sprites: { astra: back }, portraits: false }, 140, 40, T0 + 1000);
  A.ok(!noPic.flat().some(([, s]) => /^r[0-6]$/.test(s)), 'STARNET_PORTRAIT=0 (portraits off) draws none');
  const tight = screen(m, { sprites: { astra: back } }, 95, 40, T0 + 1000);
  A.ok(!tight.flat().some(([, s]) => /^r[0-6]$/.test(s)), 'where COMMS would keep under 64 columns, there is no portrait');
  const none = screen(m, { sprites: { cypher: back } }, 140, 40, T0 + 1000);
  A.ok(!none.flat().some(([, s]) => /^r[0-6]$/.test(s)), 'an agent without a sprite has no portrait, and COMMS keeps the room');
  // working: a bright line sweeps down the figure; a still screen holds none
  const styles = (still, t) => screen(m, { sprites: { astra: back }, still }, 140, 40, t).flat().filter(([, s]) => /^r[0-6]$/.test(s)).map(([t2, s]) => t2 + s).join('|');
  const frames = new Set(), stills = new Set();
  for (let t = 0; t < 30 * 70; t += 70) { frames.add(styles(false, T0 + t)); stills.add(styles(true, T0 + t)); }
  A.ok(frames.size > 5 && stills.size === 1, 'while its agent works, a bright line sweeps the portrait (' + frames.size + ' frames); a still screen holds one');
  m.apply('agent.run.end', { runId: 'r1', agentId: 'astra', reason: 'done' }, T0 + 2000);
  const idle = new Set();
  for (let t = 0; t < 30 * 70; t += 70) idle.add(styles(false, T0 + 3000 + t));
  A.eq(idle.size, 1, 'an agent not working holds still (motion means working)');
}

A.report('cli-dashboard.test');
