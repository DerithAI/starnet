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
  {
    // scale: the wordmark a bit smaller inside the same rows, centred top to bottom
    const full = sx.logoSixel({ cellW: 10, cellH: 20, rows: 3 }), small = sx.logoSixel({ cellW: 10, cellH: 20, rows: 3, scale: 0.8 });
    const inkRows = r => { const d = sx.decodeSixel(r.sixel); const ys = []; for (let y = 0; y < d.height; y++) for (let x = 0; x < d.width; x++) if (d.px[y * d.width + x] >= 0) { ys.push(y); break; } return { h: d.height, top: ys[0], bot: ys[ys.length - 1] }; };
    const f = inkRows(full), s = inkRows(small);
    A.ok(small.rows === 3 && small.height === full.height && s.h === f.h, 'scaled, the logo keeps its 3 rows (what sits beside it stays put)');
    A.ok(small.cols < full.cols && (s.bot - s.top) < (f.bot - f.top) * 0.85 && s.top > 3 && (s.h - 1 - s.bot) > 3, 'and draws the wordmark ~80% the size, centred: ' + full.cols + '→' + small.cols + ' columns, ink rows ' + s.top + '–' + s.bot + ' of ' + s.h);
  }
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

// ---- the camera feed: the station camera locked on the agent in COMMS, made of ASCII, at the foot of CREW --------------
{
  const fs = require('fs');
  const path = require('path');
  const cf = require('../bin/lib/camfeed.js');
  const sx = require('../bin/lib/sixel.js');
  const png = require('../bin/lib/png.js');
  const FRONT = path.join(__dirname, '..', 'frontend');
  const chair = png.decode(fs.readFileSync(path.join(FRONT, 'assets', 'furniture', 'chair.png')));
  A.ok(chair.width === 48 && chair.height === 48 && chair.data.some((v, i) => i % 4 === 3 && v === 255), 'the built-in PNG reader decodes the app\'s furniture: ' + chair.width + '×' + chair.height);
  const skins = cf.parseSkins("DATA.SKINS = {\n  blank: {\"name\":\"Cadet\",\"set\":\"approved_android\"},\n  ultron: {\"name\":\"U\",\"set\":\"approved_ultron\"},\n  alien: {\"name\":\"Alien\",\"set\":\"approved_alien\"},\n  junk: {not json},\n  evil: {\"set\":\"../../etc\"},\n};\nDATA.DEFAULT_SKIN = 'blank';");
  A.eq([skins.alien, skins.junk, skins.evil, skins['']], ['approved_alien', undefined, undefined, 'approved_android'], "the app's skin table is read off data-shim.js; a bad line or a path-like set is skipped");
  A.eq([cf.setFor('researcher', 'alien', skins), cf.setFor('kaze', '', skins), cf.setFor('ULTRON', 'alien', skins)], ['approved_alien', 'approved_android', 'approved_ultron'], "each agent wears its own skin, the default when it has none, ULTRON its own — the app's rule");

  const feed = cf.makeCamFeed();
  const box = { cellW: 10, cellH: 20, cols: 26, rows: 8 };
  A.eq(feed.frame('nova', 'idle', T0, false, box), null, 'no skin yet → no feed (the card waits)');
  feed.setSkin('nova', 'approved_elonmusk');
  const want = feed.needs('nova');
  A.ok(want.some(p => /\/assets\/sprites\/approved_elonmusk\/type_north_1\.png$/.test(p)) && want.some(p => /\/assets\/furniture\/chair\.png$/.test(p)) && want.every(p => /^\/assets\/(sprites|furniture)\/[A-Za-z0-9_-]+(\/[A-Za-z0-9_-]+)?\.png$/.test(p)), 'it asks for exactly its skin\'s walk / type frames and the room\'s furniture (' + want.length + ' files)');
  A.eq(feed.frame('nova', 'idle', T0, false, box), null, 'until they are in, no feed');
  for (const p of want) { const f = path.join(FRONT, p); feed.add(p, fs.existsSync(f) ? fs.readFileSync(f) : null); }
  A.eq(feed.needs('nova').length, 0, 'every file handed in (a missing one counts as answered)');
  const f0 = feed.frame('nova', 'idle', T0, false, box);
  const d0 = sx.decodeSixel(f0.sixel);
  A.ok(d0.width === 260 && d0.height === 160, 'one frame fills the card exactly: 26 × 8 cells of 10 × 20 px = ' + d0.width + '×' + d0.height);
  A.ok(d0.px.every(v => v >= 0 && v < cf.PALETTE.length), 'every pixel is one of StarNet\'s palette colours');
  // its walk follows its state
  const sim = (key, from, ms) => { let f; for (let t = from; t <= from + ms; t += 100) f = feed.frame('nova', key, T0 + t, false, box); return { f, s: feed.sim('nova', key, T0 + from + ms) }; };
  const idleA = feed.sim('nova', 'idle', T0 + 50);
  const w = sim('working', 100, 9000);
  A.ok(w.s.sat && Math.abs(w.s.x - 372) < 1, 'given work, it walks to its desk and sits: at x ' + Math.round(w.s.x) + ' (the seat is 372), started at ' + Math.round(idleA.x));
  const typing = new Set(); for (let t = 9200; t < 10400; t += 100) typing.add(feed.frame('nova', 'working', T0 + t, false, box).key);
  A.ok(typing.size >= 3, 'seated, it types: its frames change (' + typing.size + ' looks in a second)');
  const used = f => { const d = sx.decodeSixel(f.sixel); const s = new Set(); for (const v of d.px) s.add(v); return [...s].map(i => cf.PALETTE[i]); };
  A.ok(used(feed.frame('nova', 'working', T0 + 10500, true, box)).some(([r, g, b]) => r > 170 && g < r * 0.4 && b < r * 0.45), 'working: its rim is the station red');
  sim('needs', 10600, 300);
  A.ok(used(feed.frame('nova', 'needs', T0 + 11000, true, box)).some(([r, g, b]) => r > 170 && g > r * 0.55 && g < r * 0.8 && b < 80), 'needs you: amber');
  const dn = sim('done', 11100, 4000);
  A.ok(!dn.s.sat && used(feed.frame('nova', 'done', T0 + 15200, true, box)).some(([r, g, b]) => g > 150 && g > r * 1.8 && g > b * 1.2), 'done: it gets up, rimmed green');
  const st1 = feed.frame('nova', 'done', T0 + 20000, true, box).key, st2 = feed.frame('nova', 'done', T0 + 20000, true, box).key;
  A.eq(st1, st2, 'the same moment draws the same frame (cached, not redrawn)');

  const m = crew();
  m.apply('agent.run.start', { runId: 'r1', agentId: 'astra', trigger: 'directive', surface: 'interactive', prompt: 'fix it' }, T0);
  const withImg = screen(m, { images: true }, 120, 34, T0 + 12000);
  const scr = withImg.map(tui.toPlain);
  const div = scr.findIndex(l => /^├─/.test(l));
  const crewTop = scr.findIndex(l => /^╭─ CREW /.test(l));
  const bot = scr.findIndex((l, i) => i > crewTop && /^╰─+╯/.test(l));
  const av = withImg.avatar;
  A.ok(div > crewTop && bot - div === 9 && /^├─ ASTRA ⠋ working ─+ ● REC ─*┤/.test(scr[div]), 'the card sits at the foot of CREW: its rule names the agent, says what it does, and carries the camera\'s REC light: ' + scr[div]);
  A.ok(av && av.x === 2 && av.y === div + 1 && av.cols === 26 && av.rows === 8 && av.id === 'astra' && av.key === 'working', 'the screen tells the dashboard where the feed goes, of whom, doing what: ' + JSON.stringify(av));
  A.ok(scr.slice(av.y, av.y + av.rows).every(l => l.slice(av.x, av.x + av.cols).trim() === ''), 'and leaves those cells empty for the image');
  const noImg = screen(m, {}, 120, 34, T0 + 12000);
  A.ok(!noImg.avatar && !noImg.map(tui.toPlain).some(l => /^├─/.test(l)), 'a terminal that cannot draw images has no card: the crew list keeps the room');
  const room = makeStation();
  room.setRoster({ agents: Array.from({ length: 12 }, (_, i) => ({ agentId: 'a' + i, name: 'Agent' + i })) });   // + the overseer the model adds = 13
  A.ok(screen(room, { focus: 'a3', images: true }, 120, 30, T0).avatar, 'a crew of 13 in a 120×30 window still has it');
  const big = makeStation();
  big.setRoster({ agents: Array.from({ length: 24 }, (_, i) => ({ agentId: 'a' + i, name: 'Agent' + i })) });
  A.ok(!screen(big, { focus: 'a3', images: true }, 120, 30, T0).avatar, 'when the crew list needs the room, the card steps aside');
  A.eq(tui.sliceSegs([['abcdef', 'x'], ['gh', 'y']], 2, 5), [['cde', 'x']], 'a row beside the image is written either side of it');
}

A.report('cli-dashboard.test');
