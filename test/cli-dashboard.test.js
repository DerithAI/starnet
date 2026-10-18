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
  A.eq(m.rows(T0 + 200).find(r => r.id === 'astra').now, 'fs.read {"path":"auth.js"}', 'NOW is the tool it is running');
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
  A.eq(m.front().summary, '{ "path": "auth.js" }', 'the ask reads as one line');
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
  A.eq([m.logOf('cypher').find(e => e.k === 'ask').text, m.front().summary], ['asks: fs.write { "path": "notes.md" }', '{ "path": "notes.md" }'], 'once its request is read, the ask line names it');
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
  A.eq(costText(m.state.cost), '≥$0.00 today', "the station's own floor shape ({ today, lifetime, runs }) reads as at least");
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
  A.ok(logo.word.every((l, i) => text[i].indexOf(l.trim()) >= 0), 'the screen opens on the outlined STARNET wordmark from bin/lib/logo.js, four rows');
  A.ok(text.slice(0, 1).some(l => /1 needs you/.test(l)), 'the counts sit on the top row');
  const starCell = rows.slice(0, 4).flat().find(([t]) => t.indexOf('✦') >= 0);
  A.ok(starCell && /logohi/.test(starCell[1]), "the A carries the brand's four-point star, in its own glint");
  const crewRow = text.findIndex(l => /CREW /.test(l));
  A.ok(crewRow === 1 && text[crewRow].indexOf('CREW') > logo.word[1].length && /‹ ▲ ASTRA ›/.test(text[crewRow]) && /○ NOVA/.test(text[crewRow]), 'the crew is a bar of names beside the logo, the agent in COMMS marked: ' + text[crewRow]);
  const nowRow = text.findIndex(l => /^NOW  /.test(l));
  A.ok(nowRow === logo.word.length && /^NOW  ASTRA › asks: fs\.write/.test(text[nowRow]), 'a NOW line under the logo says what the busy ones are doing: ' + text[nowRow]);
  const commsRow = text.findIndex(l => /^── COMMS ▸ ASTRA /.test(l));
  A.ok(commsRow > 0 && commsRow <= 6, 'COMMS starts right under the header (row ' + commsRow + '), so it gets most of the screen');
  const compact = screen(m, {}, 70, 20, T0 + 3000).map(tui.toPlain);
  A.ok(/S T A R N E T/.test(compact[0]) && /1 needs you/.test(compact[0]) && /^CREW /.test(compact[1]), 'a small terminal gets the one-line mark, counts on it, crew bar under it: ' + compact.slice(0, 2).join(' | '));
  A.ok(!screen(m, { logo: 'plain' }, 110, 34, T0).map(tui.toPlain).some(l => l.indexOf(logo.word[1].trim()) >= 0), 'STARNET_LOGO=plain keeps to the one-line mark');
  A.ok(text.some(l => /ASTRA asks/.test(l)) && text.some(l => /\[y\] allow once/.test(l)), 'the open ask is a card with its keys');
  A.ok(text.some(l => /evil {2}text|evil text/.test(l)), 'model text is shown…');
  A.ok(!rows.some(r => r.some(([t]) => /\x1b|\x07/.test(t))), '…with every escape sequence stripped before it reaches a cell');
  const ansi = rows.map(r => tui.toAnsi(r, 3)).join('\n');
  A.ok(!/\x1b\[2J|\x1b\]0;/.test(ansi), 'the ANSI output carries only our own styling');
  A.ok(!/\x1b\[(38|48);/.test(rows.map(r => tui.toAnsi(r, 0)).join('')), 'NO_COLOR level emits no colors');
  const narrow = screen(m, {}, 60, 30, T0).map(tui.toPlain);
  A.ok(narrow.every(l => tui.width(l) <= 60) && narrow.some(l => /^CREW /.test(l)), 'narrow: still fits, crew bar kept');
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
  A.ok(/▲ needs you · fs\.write \{ "path": "a" \}\s+\(starnet approve astra\)/.test(ask), 'watch: an ask on one line, with the command that answers it: ' + ask);
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
  A.ok(/^CREW /.test(img[1].slice(61)), 'the crew bar sits beside the image: ' + img[1].slice(55, 90));
  A.ok(!img.some(l => l.indexOf(require('../bin/lib/logo.js').word[1].trim()) >= 0), 'with the image, the text logo is not drawn');
}

A.report('cli-dashboard.test');
