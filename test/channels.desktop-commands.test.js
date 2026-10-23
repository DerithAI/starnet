/* node test/channels.desktop-commands.test.js — desktop slash names typed on a messenger (bug 6cd531b1).
   "/routines", "/reset", "/tasks", "/buildaway" are the shared registry's own aliases of commands the hub DOES have,
   and "/version", "/v", "/q", "/retry" are registry built-ins the hub has no row for. Every one of them fell through
   parseCommand to the MODEL: a paid run whose answer was a guess at what the command means. Now an alias parses to
   its canonical hub command (so the owner gate reads one rule) and any other registry built-in is answered by the
   registry itself, for free. Real hub + the REAL slash registry; no network, no sidecar boot. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const { makeChannelHub, parseCommand, COMMANDS } = require('../sidecar/channels/hub.js');
const slash = require('../sidecar/slash.js');

const DESKTOP_ONLY = 'That command only works in the StarNet desktop app.';
function build(over) {
  const sends = [], runs = [], slashCalls = [], cleared = [];
  let ids = 0;
  const store = {
    loadHistory: () => [], appendTurn: () => [], getChatRecord: () => null, saveChatRecord: () => {},
    clearHistory: (a) => { cleared.push(a); return 2; }
  };
  const hub = makeChannelHub(Object.assign({
    channel: 'telegram', store,
    runOnce: async (o) => { runs.push(o.messages[o.messages.length - 1].content); o.emit('agent.run.end', { agentId: o.agentId, runId: o.runId, reason: 'done' }); },
    send: (c, t) => { sends.push(t); return Promise.resolve({ ok: true }); },
    secrets: () => ({ key: 'k', model: 'm', agentId: 'ultron' }), classify: () => false, newId: () => 'r' + (++ids),
    roster: () => [{ agentId: 'ultron', name: 'Ultron', model: 'm' }],
    // runSlashForChannel's own shape: the registry resolves, a non-server directive is refused as desktop-only
    runSlash: async (input, ctx) => {
      slashCalls.push(input);
      const out = slash.dispatch(input, {});
      if (!out || !out.ok || !out.directive) return { ok: false, text: 'Unknown command.' };
      if (out.directive.type !== 'server') return { ok: false, text: DESKTOP_ONLY };
      return { ok: true, text: 'ran ' + out.directive.action };
    },
    desktopCommand: (t) => !!slash.resolve('/' + t),
    isOwner: (m) => String(m.userId) === 'boss',
    ownerTrusted: (m) => String(m.userId) === 'boss' && m.chatType === 'dm'
  }, over || {}));
  return { hub, sends, runs, slashCalls, cleared };
}
const msg = (userId, text, chatType) => ({ channel: 'telegram', chatId: chatType === 'group' ? '-100' : 'c-' + userId, chatType: chatType || 'dm', userId, text, messageId: String(Math.random()), ts: 1 });

(async () => {
  // ---- 1. parity: every registry alias of a command the hub has parses to that command; the hub invents none ----
  {
    for (const row of COMMANDS) {
      const hit = slash.resolve('/' + row.command);
      const regAliases = (hit && hit.command.name === row.command) ? (hit.command.aliases || []) : [];
      for (const a of regAliases) {
        const p = parseCommand('/' + a + ' x');
        A.eq(p && p.cmd, row.command, 'registry alias /' + a + ' parses to the hub command /' + row.command);
      }
      for (const a of (row.aliases || [])) {
        const r = slash.resolve('/' + a);
        A.ok(r && r.command.name === row.command, 'hub alias /' + a + ' is the registry\'s own alias of /' + row.command);
      }
    }
    A.eq(parseCommand('/routines@starnetbot list'), { cmd: 'routine', arg: 'list' }, '@suffix and argument survive the alias');
    A.eq(parseCommand('/reset'), { cmd: 'new', arg: '' }, '/reset is /new');
  }

  // ---- 2. the owner's DM: aliases run their command, desktop built-ins answer from the registry — zero model runs ----
  {
    const t = build();
    await t.hub.onInbound(msg('boss', '/routines'));
    await t.hub.onInbound(msg('boss', '/buildaway'));
    await t.hub.onInbound(msg('boss', '/tasks'));
    await t.hub.onInbound(msg('boss', '/reset'));
    await t.hub.onInbound(msg('boss', '/version'));
    await t.hub.onInbound(msg('boss', '/v'));
    await t.hub.onInbound(msg('boss', '/q do this next'));
    await t.hub.onInbound(msg('boss', '/retry'));
    A.eq(t.runs, [], 'no desktop command name became a paid model run: ' + JSON.stringify(t.runs));
    A.eq(t.slashCalls.slice(0, 2), ['/routine', '/away'], 'the aliases reach the registry under their canonical names');
    A.ok(/Ultron/.test(t.sends[2]), '/tasks lists the agents like /agents: ' + JSON.stringify(t.sends[2]));
    A.eq(t.cleared.length, 1, '/reset cleared this chat like /new');
    A.eq(t.slashCalls.slice(2), ['/version', '/v', '/q do this next', '/retry'], 'desktop built-ins are handed to the registry as typed');
    A.eq(t.sends.slice(4), [DESKTOP_ONLY, DESKTOP_ONLY, DESKTOP_ONLY, DESKTOP_ONLY], 'and answered with the registry\'s desktop-only line');
  }

  // ---- 3. a non-owner in a group: the alias inherits the owner gate; a desktop command is refused for free ----
  {
    const t = build();
    await t.hub.onInbound(msg('guest', '/reset', 'group'));
    await t.hub.onInbound(msg('guest', '/version', 'group'));
    A.eq(t.runs, [], 'no model run');
    A.eq(t.cleared, [], '/reset from a non-owner clears nothing');
    A.eq(t.slashCalls, [], 'the registry is never asked on a non-owner\'s behalf');
    A.ok(/\/new is owner-only/.test(t.sends[0]) && /\/version is owner-only/.test(t.sends[1]), 'both refused as owner-only: ' + JSON.stringify(t.sends));
  }

  // ---- 4. what is NOT a registry built-in still reaches the agent untouched ----
  {
    const t = build();
    await t.hub.onInbound(msg('boss', '/summarize the meeting'));
    await t.hub.onInbound(msg('boss', '/tmp/build.log is huge'));
    A.eq(t.runs, ['/summarize the meeting', '/tmp/build.log is huge'], 'an unknown head and a path are ordinary messages');
  }

  // ---- 5. a hub built without the registry check keeps the old fall-through (other wire-ups, tests) ----
  {
    const t = build({ desktopCommand: undefined });
    await t.hub.onInbound(msg('boss', '/version'));
    A.eq(t.runs, ['/version'], 'no desktopCommand -> unchanged');
  }

  // ---- 6. every production hub that has the registry also has the check (source pin; index.js is never required) ----
  {
    const idx = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
    const runSlashSites = (idx.match(/runSlash: \(input, sctx\) => runSlashForChannel\(input, sctx\)/g) || []).length;
    const deskSites = (idx.match(/desktopCommand: isDesktopSlashCommand/g) || []).length;
    A.ok(runSlashSites >= 5, 'found the hub wire-ups (' + runSlashSites + ')');
    A.eq(deskSites, runSlashSites, 'each runSlash wire-up passes desktopCommand');
    A.ok(/function isDesktopSlashCommand\(token\) \{\s*try \{ return !!slash\.resolve\(/.test(idx), 'the check reads the BUILT-IN table only (slash.resolve), never skills or recipes');
  }

  A.report('channels.desktop-commands');
})().catch(e => { console.error(e); process.exit(1); });
