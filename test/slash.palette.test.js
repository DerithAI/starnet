/* node test/slash.palette.test.js -- lightweight regression pins for the chat slash palette wiring. */
'use strict';

const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');

A.ok(src.indexOf('FALLBACK_SLASH_COMMANDS') >= 0, 'palette keeps local fallback commands');
A.ok(src.indexOf("name: 'retry'") >= 0 && src.indexOf("name: 'stop'") >= 0, 'palette fallback includes retry and stop');
A.ok(src.indexOf("name: 'copy'") >= 0 && src.indexOf("name: 'help'") >= 0, 'palette fallback includes copy and help');
A.ok(src.indexOf("name: 'new'") >= 0 && src.indexOf("name: 'branch'") >= 0, 'palette fallback includes new and branch');
A.ok(src.indexOf("name: 'queue'") >= 0 && src.indexOf("name: 'steer'") >= 0, 'palette fallback includes queue and steer');
A.ok(src.indexOf("name: 'undo'") >= 0 && src.indexOf("name: 'compress'") >= 0, 'palette fallback includes undo and compress');
A.ok(src.indexOf("name: 'model'") >= 0 && src.indexOf("name: 'personality'") >= 0, 'palette fallback includes model and personality');
A.ok(src.indexOf("name: 'yolo'") >= 0 && src.indexOf("name: 'tools'") >= 0, 'palette fallback includes yolo and tools');
A.ok(src.indexOf("name: 'skills'") >= 0 && src.indexOf("name: 'reload-skills'") >= 0, 'palette fallback includes skills and reload-skills');
A.ok(src.indexOf("name: 'debug'") >= 0, 'palette fallback includes debug');
A.ok(src.indexOf("name: 'title'") >= 0 && src.indexOf("name: 'resume'") >= 0, 'palette fallback includes title and resume');
A.ok(src.indexOf("name: 'agents'") >= 0 && src.indexOf("name: 'background'") >= 0, 'palette fallback includes agents and background');
A.ok(src.indexOf("name: 'goal'") >= 0 && src.indexOf("name: 'subgoal'") >= 0, 'palette fallback includes goal and subgoal');
A.ok(src.indexOf("name: 'memory'") >= 0 && src.indexOf("name: 'bundles'") >= 0, 'palette fallback includes memory and bundles');
A.ok(src.indexOf("name: 'cron'") >= 0 && src.indexOf("name: 'suggestions'") >= 0, 'palette fallback includes cron and suggestions');
A.ok(src.indexOf("name: 'blueprint'") >= 0 && src.indexOf("name: 'reload-mcp'") >= 0, 'palette fallback includes blueprint and reload-mcp');
A.ok(src.indexOf("name: 'reasoning'") >= 0 && src.indexOf("name: 'fast'") >= 0 && src.indexOf("name: 'voice'") >= 0, 'palette fallback includes mode commands');
A.ok(src.indexOf("name: 'version'") >= 0, 'palette fallback includes version');
A.ok(src.indexOf('newWorkstreamCommand') >= 0 && src.indexOf('branchWorkstreamCommand') >= 0, 'palette maps workflow commands to workstream handlers');
A.ok(src.indexOf('statusCommand') >= 0, 'palette maps the status command');
// /usage and /tools are dispatch:'server' — they must have NO local handler, or the browser's own (lying)
// numbers would silently win whenever the fallback path ran.
A.ok(src.indexOf('function usageCommand') === -1 && src.indexOf('function toolsCommand') === -1, 'the browser-side usage/tools readouts are gone, not merely bypassed');
A.ok(src.indexOf('function toolRows') === -1, 'the hardcoded tool-name table is gone');
// Harness.totals() is still legitimately used for per-run/per-stream cost DELTAS and as /insights' explicitly
// session-labelled fallback. What must never come back is presenting it as lifetime SPEND.
A.ok(src.indexOf("'Usage: lifetime '") === -1, 'no command labels browser-observed totals as lifetime spend');
A.ok(src.indexOf('titleCommand') >= 0 && src.indexOf('resumeCommand') >= 0 && src.indexOf('backgroundCommand') >= 0, 'palette maps Plan5 session commands');
A.ok(src.indexOf('agentsCommand') >= 0 && src.indexOf('goalCommand') >= 0 && src.indexOf('subgoalCommand') >= 0, 'palette maps agent and goal commands');
A.ok(src.indexOf('modelCommand') >= 0 && src.indexOf('personalityCommand') >= 0 && src.indexOf('yoloCommand') >= 0, 'palette maps config commands');
A.ok(src.indexOf('reasoningCommand') >= 0 && src.indexOf('fastCommand') >= 0 && src.indexOf('voiceCommand') >= 0, 'palette maps mode commands');
A.ok(src.indexOf('skillsCommand') >= 0 && src.indexOf('reloadSkillsCommand') >= 0, 'palette maps skills commands');
A.ok(src.indexOf('memoryCommand') >= 0 && src.indexOf('bundlesCommand') >= 0 && src.indexOf('cronCommand') >= 0, 'palette maps Plan6 status commands');
A.ok(src.indexOf('suggestionsCommand') >= 0 && src.indexOf('blueprintCommand') >= 0 && src.indexOf('reloadMcpCommand') >= 0, 'palette maps Plan6 action commands');
A.ok(src.indexOf('versionCommand') >= 0, 'palette maps version command');
A.ok(src.indexOf('/api/slash/catalog') >= 0, 'palette fetches the sidecar slash catalog');
A.ok(src.indexOf('/api/slash/dispatch') >= 0, 'palette dispatches server-backed commands through the sidecar');
A.ok(src.indexOf('/api/cron') >= 0 && src.indexOf('/api/connectors/refresh') >= 0, 'palette uses real cron and MCP endpoints');
A.ok(src.indexOf('slashPlacedTypes') >= 0 && src.indexOf('World.heroCaps') >= 0, 'palette asks the sidecar for commands matching the active agent capabilities');
A.ok(src.indexOf('Recipes.list') >= 0 && src.indexOf("source: 'recipe'") >= 0, 'palette preserves recipe slash commands');
A.ok(src.indexOf('MintStore.candidates') >= 0 && src.indexOf('Recipes.saveCustom') >= 0, 'palette wires recurring-task suggestions to recipe saves');
A.ok(src.indexOf("directive.type === 'insert'") >= 0, 'palette applies insert directives from skill and recipe commands');
A.ok(src.indexOf('rawInput') >= 0, 'palette preserves typed slash arguments during dispatch');
A.ok(src.indexOf('item.serverBacked || typeof item.run !==') >= 0, 'server-backed commands try dispatch before local fallback');

// --- command-doors lane: server-executed commands + the in-session loop ---
A.ok(src.indexOf("name: 'away'") >= 0 && src.indexOf("name: 'routine'") >= 0, 'palette fallback includes the server-executed away and routine commands');
A.ok(src.indexOf("name: 'loop'") >= 0 && src.indexOf('loopCommand') >= 0, 'palette maps the loop command to its handler');
A.ok(src.indexOf("aliases: ['build-away', 'buildaway']") >= 0, 'away keeps the original build-away name reachable');
A.ok(src.indexOf("directive.type === 'say'") >= 0, 'palette prints say directives returned by server-executed commands');
A.ok(src.indexOf('typeof item.run !== ') >= 0, 'a server command with no local action refuses honestly instead of silently doing nothing');
A.ok(src.indexOf('argsHint') >= 0, 'palette carries the registry argsHint so arg-taking commands show their shape');
A.ok(src.indexOf('LOOP_MIN_MS') >= 0 && src.indexOf('LOOP_MAX_ITERS') >= 0, 'the loop carries a minimum cadence and an iteration budget');
A.ok(src.indexOf('loopStop(activeWs.id') >= 0, 'stop ends an armed loop, not just a live run');
// A loop tick goes through send(), which routes text into interview()/TaskIntent when one of those owns the
// input — so an unguarded tick would ANSWER the station's own question. It must obey the same gate /goal does.
A.ok(/goalBlocked\(activeWs\)/.test(src.slice(src.indexOf('function loopTick'), src.indexOf('function loopCommand'))), 'a loop tick obeys goalBlocked, so it cannot answer an interview or approval prompt');
A.ok(src.indexOf('LOOP_MAX_SKIPS') >= 0 && src.indexOf('loopEnded') >= 0, 'a loop that dies unattended is bounded and can still explain itself');
A.ok(src.indexOf('needsServer && await dispatchSlash') >= 0, 'a command with no local action still asks the sidecar before refusing');

// --- NO SILENT COMMANDS. A handler that returns without printing is indistinguishable from a broken app;
// /stop and /retry both used to no-op in silence on their most common empty state. ---
A.ok(src.indexOf('Nothing is running to stop.') >= 0, '/stop says so when there is nothing to stop');
A.ok(src.indexOf('Nothing to retry yet') >= 0, '/retry says so when there is nothing to retry');
A.ok(src.indexOf('This stream is still running — stop it first') >= 0, '/retry explains a busy stream rather than no-opping');
// /yolo TOGGLES on a bare call — the reply must read as a change, never as a status report, because the
// setting it flips is the approval gate.
A.ok(src.indexOf("'Approval mode: ' + was + ' → ' + now") >= 0, '/yolo states the approval transition, not just the resulting state');
A.ok(src.indexOf('Approval mode unchanged: ') >= 0, '/yolo reports an explicit no-op instead of implying a change');

// --- ARGUMENT-VALUE COMPLETION (design ported from the reference harness, MIT — see NOTICE.md) ---
// Static values are DERIVED from each command's argsHint pipe pattern, so a new "[on|off]" command gets
// completion with no per-command wiring. If this regex or its use goes, completion silently dies.
A.ok(src.indexOf('PIPE_VALUES_RE') >= 0 && /PIPE_VALUES_RE\s*=\s*\//.test(src), 'static values are derived from the argsHint pipe pattern');
A.ok(src.indexOf('function staticValuesFor') >= 0 && src.indexOf('function liveValuesFor') >= 0, 'both static and live value providers exist');
A.ok(src.indexOf('function completeSlashValue') >= 0, 'a value can be completed into the composer');
A.ok(/liveValuesFor[\s\S]{0,600}Personas\.list/.test(src), 'personalities come from the live persona list');
A.ok(/liveValuesFor[\s\S]{0,600}Workstreams\.list/.test(src), 'workstream names complete for /resume');
A.ok(src.indexOf('function warmModelValues') >= 0 && src.indexOf('Harness.listModels()') >= 0, '/model completes against the warmed catalog');
// THE LOAD-BEARING CONTRACT: Enter dispatches the COMMAND, never a value row. A regressed Enter is what
// fired "/personality direct" at the model as chat (2026-07-05); Tab is the completer instead.
A.ok(/e\.key === 'Tab' && slashValueMode/.test(src), 'TAB is what accepts a value');
A.ok(/e\.key === 'Enter' && slashValueMode[\s\S]{0,400}commandFromLine\(input\.value\)/.test(src),
  'ENTER in value mode still dispatches the command resolved from the typed line, never the highlighted value');
A.ok(src.indexOf('c.isValue ? c.name') >= 0, 'a value row renders without a leading slash (it is an argument, not a command)');
A.ok(/closeSlash[\s\S]{0,200}slashValueMode = null/.test(src), 'closing the palette leaves value mode');

/* org P19 (2026-10-14): automation slash replies carry ONE door key into the right AUTOMATE tab — on the reply, never a new card */
(async () => {
  const opened = [];
  // a small fake DOM: enough element behaviour for systemDoor (children, classList, sibling walk, remove)
  const mkEl = (cls) => {
    const el = { type: '', className: cls || '', textContent: '', onclick: null, kids: [], parentNode: null, dataset: {} };
    el.appendChild = n => { if (n && typeof n === 'object') n.parentNode = el; el.kids.push(n); return n; };
    Object.defineProperty(el, 'children', { get: () => el.kids.filter(k => k && k.classList) });
    el.classList = { contains: c => (' ' + el.className + ' ').indexOf(' ' + c + ' ') >= 0 };
    const all = () => { const out = []; const walk = e => { for (const k of e.children) { out.push(k); walk(k); } }; walk(el); return out; };
    el.querySelectorAll = sel => all().filter(k => k.classList.contains(sel.replace(/^\./, '')));
    el.querySelector = sel => el.querySelectorAll(sel)[0] || null;
    el.remove = () => { const p = el.parentNode; if (p) p.kids.splice(p.kids.indexOf(el), 1); el.parentNode = null; };
    Object.defineProperty(el, 'previousElementSibling', { get: () => { const p = el.parentNode; if (!p) return null; const sib = p.children; const i = sib.indexOf(el); return i > 0 ? sib[i - 1] : null; } });
    return el;
  };
  const log = mkEl('chat-log');
  const mkNode = (cls) => { const n = mkEl(cls || 'cmsg system'); n.appendChild(mkEl('body')); log.appendChild(n); return n; };
  const doc = { createElement: () => mkEl(), createTextNode: t => ({ text: t }) };
  const SUI = { openTerm: (k, sec) => opened.push(k + ':' + sec) };
  const doorOf = node => node.querySelectorAll('sys-door').find(k => /automate-door/.test(k.className));
  // P29-sys: the key sits in ONE .sys-doors row of the line's own (a sibling of its text), never inside the prose
  const doorRowOk = (node, d) => !!d && d.parentNode && d.parentNode.className === 'sys-doors' && d.parentNode.parentNode === node && !node.querySelector('.body').kids.length;
  const DOOR_SRC = A.fnBody(src, 'function systemDoor(') + '\n' + A.fnBody(src, 'function automateDoor(');
  // /loop status keeps its note and adds the door to SCHEDULES (the lasting form of a loop is a schedule)
  {
    const loopSrc = A.fnBody(src, 'function loopCommand(');
    const doorSrc = DOOR_SRC;
    const node = mkNode(), lines = [];
    const loop = new Function('StationUI', 'document', 'activeWs', 'loops', 'loopEnded', 'localLine', 'LOOP_MAX_ITERS',
      doorSrc + '\n' + loopSrc + '\nreturn loopCommand;')(SUI, doc, { id: 'w' }, new Map([['w', { label: '5m', fired: 2, skipped: 0, prompt: 'check the build' }]]), new Map(), t => { lines.push(t); return node; }, 20);
    loop('status');
    A.ok(/It stops if you close StarNet; \/routine makes it permanent\.$/.test(lines[0]), '/loop status keeps its note: ' + lines[0]);
    const d = doorOf(node);
    A.ok(d && d.type === 'button' && /\bsys-door\b/.test(d.className) && d.textContent === '▸ AUTOMATE › SCHEDULES › NEW', '/loop status carries one door key to SCHEDULES › NEW (its own label: it opens the form, not the list)');
    A.ok(doorRowOk(node, d), 'the key rides a door row of its own under the line, not the tail of its text');
    d.onclick(); A.eq(opened.pop(), 'automation:routines-create', '…which opens the New schedule form');
  }
  // the server-run /routine and /away replies gain their door client-side (sidecar/slash.js unchanged)
  {
    const body = ['let lastSaid = null, slashDispatchRefusal = null;', DOOR_SRC,
      src.match(/const SERVER_SLASH_DOORS = \{[^\n]+\};/)[0], A.fnBody(src, 'function applySlashDirective('), A.fnBody(src, 'async function dispatchSlash('), 'return dispatchSlash;'].join('\n');
    const run = async (name, directive) => {
      const node = mkNode();
      const dispatch = new Function('StationUI', 'document', 'fetch', 'systemCard', 'localLine', 'slashPlacedTypes', 'activeWs', 'localSlashActions', 'insertSlashText', body)(
        SUI, doc, () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, directive }) }), () => node, () => node, () => [], { agentId: 'agent' }, () => ({}), () => true);
      const ok = await dispatch({ name }, '/' + name);
      return { ok, door: doorOf(node) };
    };
    const routine = await run('routine', { type: 'say', title: 'Routines', lines: ['1. Morning brief'] });
    A.ok(routine.ok && routine.door && routine.door.textContent === '▸ AUTOMATE › SCHEDULES', '/routine reply carries the SCHEDULES door');
    routine.door.onclick(); A.eq(opened.pop(), 'automation:routines', '…opening Scheduled jobs');
    const away = await run('away', { type: 'say', text: 'queued: a small dashboard' });
    A.ok(away.ok && away.door && away.door.textContent === '▸ AUTOMATE › AWAY WORK', '/away reply carries the AWAY WORK door');
    away.door.onclick(); A.eq(opened.pop(), 'automation:away', '…opening AWAY WORK');
    // /cron is a CLIENT action (sidecar/slash.js gives it no dispatch:'server'): the sidecar answers {type:'client', action:'cron'}
    // and cronCommand prints the reply itself — so the door must ride cronCommand's own line, on every outcome
    {
      const cronBody = ['let lastSaid = null, slashDispatchRefusal = null;', DOOR_SRC,
        src.match(/const SERVER_SLASH_DOORS = \{[^\n]+\};/)[0], A.fnBody(src, 'function applySlashDirective('), A.fnBody(src, 'async function dispatchSlash('), 'return dispatchSlash;'].join('\n');
      const runCron = async (cronReply) => {
        const nodes = [], lines = [];
        const fetchFn = url => url === '/api/slash/dispatch'
          ? Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ ok: true, directive: { type: 'client', action: 'cron', args: '' } }) })
          : Promise.resolve(cronReply);
        const localLine = t => { lines.push(t); const n = mkNode(); nodes.push(n); return n; };
        let cronCommand = null;
        const dispatch = new Function('StationUI', 'document', 'fetch', 'systemCard', 'localLine', 'slashPlacedTypes', 'activeWs', 'localSlashActions', 'insertSlashText', cronBody)(
          SUI, doc, fetchFn, () => mkNode(), localLine, () => [], { agentId: 'agent' }, () => ({ cron: a => cronCommand(a) }), () => true);
        cronCommand = new Function('StationUI', 'document', 'fetch', 'localLine', DOOR_SRC + '\n' + A.fnBody(src, 'async function cronCommand(') + '\nreturn cronCommand;')(SUI, doc, fetchFn, localLine);
        const ok = await dispatch({ name: 'cron' }, '/cron');
        for (let i = 0; i < 5 && !lines.length; i++) await Promise.resolve();
        await new Promise(r => setTimeout(r, 0));
        return { ok, lines, doors: nodes.map(doorOf).filter(Boolean) };
      };
      const live = await runCron({ ok: true, status: 200, json: () => Promise.resolve({ enabled: true, halted: false, jobs: [{ name: 'Morning brief' }] }) });
      A.ok(live.ok && /^Routines: scheduler on, 1 job/.test(live.lines[0] || ''), '/cron prints its own status line: ' + live.lines[0]);
      A.ok(live.doors.length === 1 && live.doors[0].textContent === '▸ AUTOMATE › SCHEDULES', '/cron reply carries ONE SCHEDULES door');
      live.doors[0].onclick(); A.eq(opened.pop(), 'automation:routines', '…opening Scheduled jobs');
      const down = await runCron({ ok: false, status: 503, json: () => Promise.resolve(null) });
      A.ok(/real state is unknown/.test(down.lines[0] || '') && down.doors.length === 1, 'an unread /cron still says the state is unknown and keeps the door');
    }
    const other = await run('usage', { type: 'say', text: '$0.12 today' });
    A.ok(other.ok && !other.door, 'any other server command\'s reply is unchanged (no door)');
  }
  // P29-sys (Andrew 10-14: "ugly and unaligned"): never the same door twice in a run of consecutive system lines — the key
  // moves down to the newest line that offers it
  {
    const run = mkEl('chat-log');
    const line = () => { const n = mkEl('cmsg system'); n.appendChild(mkEl('body')); run.appendChild(n); return n; };
    const automateDoor = new Function('StationUI', 'document', DOOR_SRC + '\nreturn automateDoor;')(SUI, doc);
    const systemDoor = new Function('StationUI', 'document', DOOR_SRC + '\nreturn systemDoor;')(SUI, doc);
    const a0 = line(); automateDoor(a0, '▸ AUTOMATE › SCHEDULES', 'routines');
    const b = line(); automateDoor(b, '▸ AUTOMATE › SCHEDULES', 'routines');
    A.eq(run.querySelectorAll('sys-door').length, 1, 'a run of system lines shows the SCHEDULES door once');
    A.ok(!a0.querySelector('.sys-doors') && b.querySelectorAll('sys-door').length === 1, '…under the newest line that offers it (the emptied row leaves with it)');
    b.querySelector('.sys-door').onclick(); A.eq(opened.pop(), 'automation:routines', '…and it opens what the newest line offers');
    // (live walk 10-14) the de-dupe reads the DESTINATION: /loop status's door to New schedule survives a /routine door to the list,
    // even when two doors carry the same words
    const run2 = mkEl('chat-log');
    const line2 = () => { const n = mkEl('cmsg system'); n.appendChild(mkEl('body')); run2.appendChild(n); return n; };
    const l1 = line2(); automateDoor(l1, '▸ AUTOMATE › SCHEDULES', 'routines-create');
    const l2 = line2(); automateDoor(l2, '▸ AUTOMATE › SCHEDULES', 'routines');
    A.ok(l1.querySelectorAll('sys-door').length === 1 && l2.querySelectorAll('sys-door').length === 1, 'two doors to different places are both kept, whatever their words');
    l1.querySelector('.sys-door').onclick(); A.eq(opened.pop(), 'automation:routines-create', '…the first still opens New schedule');
    const l3 = line2(); systemDoor(l3, '▸ AUTOMATE › SCHEDULES', () => {}, {});
    const l4 = line2(); systemDoor(l4, '▸ AUTOMATE › SCHEDULES', () => {}, {});
    A.ok(!l3.querySelector('.sys-doors') && l4.querySelectorAll('sys-door').length === 1, 'a door given no destination still de-dupes on its own words');
    A.ok(/automateDoor\(st, '▸ AUTOMATE › SCHEDULES › NEW', 'routines-create'\)/.test(src) && src.includes("SERVER_SLASH_DOORS = { routine: ['▸ AUTOMATE › SCHEDULES', 'routines']"), 'the loop door and the /routine door read differently');
    const c = line(); automateDoor(c, '▸ AUTOMATE › AWAY WORK', 'away');
    A.ok(b.querySelectorAll('sys-door').length === 1 && c.querySelectorAll('sys-door').length === 1, 'a different door on the next line keeps both');
    run.appendChild(mkEl('cmsg agent'));   // a reply ends the run: the same door again belongs to a new run
    const d = line(); automateDoor(d, '▸ AUTOMATE › SCHEDULES', 'routines');
    A.ok(b.querySelectorAll('sys-door').length === 1 && d.querySelectorAll('sys-door').length === 1, 'after an agent reply the door shows again');
    const e = line(); systemDoor(e, '▸ AUTOMATE › GOAL LOOPS', () => {}, { cls: 'goal-loops-door', lead: 'Lasting goal loops:' });
    const f = line(); systemDoor(f, '▸ AUTOMATE › GOAL LOOPS', () => {}, { cls: 'goal-loops-door', lead: 'Lasting goal loops:' });
    A.ok(!e.querySelector('.sys-doors') && f.querySelectorAll('sys-doors-lead').length === 1, 'a moved key takes its lead label along');
    const g = line(); automateDoor(g, '▸ AUTOMATE › SCHEDULES', 'routines'); automateDoor(g, '▸ AUTOMATE › AWAY WORK', 'away');
    A.ok(g.querySelectorAll('sys-doors').length === 1 && g.querySelectorAll('sys-door').length === 2, 'two keys on one line share ONE door row');
    A.ok(!/consent-btn/.test(DOOR_SRC), 'a system door is the system register\'s own key, not an approval card\'s consent key');
  }
  A.report('slash.palette.test');
})().catch(e => { console.error(e); process.exit(1); });
