'use strict';
/* node test/needs-you-fold.test.js — NEEDS YOU's fold counts WAITS, its rows keep their age honest, and it settles
   (two independent reviews of the one-panel rail, 2026-10-16).

   1. "N more" counted CARDS while the header counted WAITS: an agent's 23 builds are one card, so a folded build card
      read "1 more" for 23 waits, and the header never matched the rows (2 + "3 more" under a header of 28). The fold now
      counts the waits in every row it leaves out (each row carries its own: data-ny-n), so the header is always the waits
      shown plus N.
   2. A card of builds that carry no time showed the age "now" (Math.min of no times is Infinity): the module's own rule
      is "no time: show no age".
   3. At a fold boundary fitRows and the Approve-once reading fed each other: a row read whole got Approve once, its keys
      stacked and grew it, fitRows folded it, the next reading saw a hidden row as "not whole", its keys went back to
      Review, it fit again… and the panel rebuilt twice a second forever. A folded row now keeps its last reading and is
      read afresh the moment it shows; the safety rule (Approve once only for a line read whole, re-read at the click)
      holds throughout.
   4. (fix round) A FIRST row taller than the room settles too. fitRows never folds row 1, and the section's own scrollbar
      took the ask line's width: an approval whose Approve once · Deny stacked past the room brought the scrollbar in, the
      narrower line wrapped to a cut third line, the reading went to Review, Review fit, the scrollbar left, the line read
      whole again… two rebuilds every heartbeat, forever, painting Approve once over a line just read as cut. The section
      now reserves its scrollbar's gutter and the panel takes the measured gutter back (--ny-gutter), so the line has one
      width, scrolling or not.
   GENUINE (executed): the real needsyou.js renders into a host laid out by a height model (a row's lines and its keys,
   Approve once · Deny stacking in this column), so the real fitRows, measure and heartbeat run; case 4's scrollbar and
   the panel's give-back are read from the real pipglass.css. */
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const NOW = 40 * 86400000;
let clock = NOW;
Date.now = () => clock;
global.localStorage = { getItem: () => null, setItem() {} };
const sessions = new Map([['home', { id: 'home', title: null, agentId: 'agent' }], ['proj', { id: 'proj', title: 'Launch prep', agentId: 'agent' }]]);
global.Workstreams = { get: id => sessions.get(id) || null, list: () => [...sessions.values()], unread: () => false, generalId: () => 'home', isDeleted: () => false };
let pending = [];
global.Channels = { allPending: () => pending };
const opened = [], answered = [];
global.App = { agentName: id => ({ agent: 'NOVA', ultron: 'ULTRON', vex: 'VEX', mira: 'MIRA' })[id] || id, openWorkstream: id => opened.push(id) };
global.Chat = { consentPhrase: p => 'use fs read: ' + p.argsSummary, consentInspect: () => null, revealAsk: () => true,
  answerConsent: async (p, ws, d) => { answered.push(p.promptId + ':' + d); } };
let builds = [], workers = [];
global.WorkshopStore = { pendingAll: async () => builds, pendingAllOk: () => true, ensureSession: m => 'workshop-' + m.runId };
global.Overseer = { snapshot: () => ({ workers }) };
global.fetch = async url => ({ ok: true, json: async () => url === '/api/hooks' ? { hooks: [], pending: [] } : { plugins: [] } });
global.document = undefined;
const NY = require('../frontend/app/needsyou.js');

/* ---- the section, laid out: head, rows (name + ask lines, then keys), and the fold key when it shows ---- */
const HEAD = 30, MORE = 25;
let lineCut = false;   // every ask line reads cut (a TEXT SIZE change, a dragged rail): the boxes read it live
const dataset = attrs => Object.fromEntries([...attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(m => [m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), m[2]]));
const LISTENERS = {};   // needsyou.js wires its click listener once (one section per page): every host here shares it
/* (case 4) the section's own scrollbar, as the browser lays it out from the REAL stylesheet: BAR px wide (Chrome's thin
   scrollbar on Windows, measured live 10-16), shown while the section overflows — or always, where pipglass.css reserves
   its gutter (scrollbar-gutter: stable) — and the panel's right margin giving back up to its own width of what
   --ny-gutter says. Whatever the scrollbar takes and the panel does not give back narrows every ask line. */
const GLASS = fs.readFileSync(path.join(__dirname, '..', 'frontend/css/pipglass.css'), 'utf8');
const RESERVED = /scrollbar-gutter:\s*stable/.test((/^#left \.ws-needs \{([^}]*)\}/m.exec(GLASS) || [])[1] || '');
const GIVE_BACK = (/body\.glass-demo:not\(\.hud-mode\) #left \.ws-needs \.ny-list \{[^}]*margin-right:\s*max\(0px,\s*(\d+)px - var\(--ny-gutter, 0px\)\)/.exec(GLASS) || [])[1];
const BAR = 10, RAIL = 200;
function makeHost(room, scroll) {
  const doc = { activeElement: null, hidden: false };
  const host = { hidden: false, writes: 0, rows: [], buttons: [], more: null, listeners: LISTENERS, _h: '', clientHeight: room,
    setAttribute() {}, addEventListener(t, fn) { LISTENERS[t] = fn; }, contains: () => false,
    querySelectorAll: sel => sel === 'li.ny-item[data-ny-key]' ? host.rows : sel === '[data-ny-act]' ? host.buttons : [],
    querySelector: sel => sel === '.ny-more' ? host.more : null,
    get scrollHeight() { return HEAD + host.rows.filter(r => !r.hidden).reduce((s, r) => s + r.h, 0) + (host.more && !host.more.hidden ? MORE : 0); },
    get innerHTML() { return this._h; },
    set innerHTML(h) {
      this._h = h; this.writes++;
      this.rows = [...h.matchAll(/<li class="ny-item ([^"]*)"([^>]*)>([\s\S]*?)<\/li>/g)].map(m => {
        const inner = m[3], labels = [...inner.matchAll(/class="ny-key\b[^"]*"[^>]*>([^<]*)</g)].map(k => k[1]);
        const row = { dataset: dataset(m[2]), labels, hidden: false, ageEl: { textContent: (/<span class="ny-age">([^<]*)<\/span>/.exec(inner) || [])[1] },
          // 60px of name and ask lines, then the keys: one row of them (40px), or Approve once · Deny stacked (80px)
          h: 60 + (!labels.length ? 0 : labels.includes('Approve once') ? 80 : 40) };
        // the ask line's box, as the browser reports it: a row the section folded away (hidden) is not laid out. (case 4)
        // its line fits two lines in the full text column and wraps to a cut third in any narrower one
        const cut = () => lineCut || (scroll ? host.narrowed() > 0 : false);
        const what = { get clientHeight() { return row.hidden ? 0 : 40; }, get scrollHeight() { return row.hidden ? 0 : cut() ? 60 : 40; },
          get clientWidth() { return row.hidden ? 0 : 150; }, get scrollWidth() { return row.hidden ? 0 : 150; } };
        row.querySelector = sel => sel === '.ny-age' ? row.ageEl : sel === '.ny-what' ? what : null;
        return row;
      });
      const mm = /<button type="button" class="ny-more"([^>]*)>([^<]*)<\/button>/.exec(h);
      this.more = mm ? { dataset: Object.assign(dataset(mm[1]), { nyAct: 'more' }), hidden: / hidden/.test(mm[1]), textContent: mm[2] } : null;
      this.buttons = [...h.matchAll(/<button type="button" class="ny-key[^"]*" data-ny-act="([^"]*)" data-ny-key="([^"]*)"[^>]*>([^<]*)</g)].map(m =>
        ({ dataset: { nyAct: m[1], nyKey: m[2] }, label: m[3], closest: sel => sel === 'li.ny-item' ? host.rows.find(r => r.dataset.nyKey === m[2]) || null : null }));
    } };
  if (scroll) {   // (case 4) the section's scrollbar, its border box (offsetWidth) and its style (--ny-gutter)
    const vars = {}, barOn = () => RESERVED || host.scrollHeight > host.clientHeight;
    Object.assign(host, { offsetWidth: RAIL, clientLeft: 0, style: { setProperty: (k, v) => { vars[k] = String(v); }, getPropertyValue: k => vars[k] || '' },
      narrowed: () => (barOn() ? BAR : 0) - (GIVE_BACK ? Math.min(Number(GIVE_BACK), parseFloat(vars['--ny-gutter']) || 0) : 0),
      overflows: () => host.scrollHeight > host.clientHeight });
    Object.defineProperty(host, 'clientWidth', { get: () => RAIL - (barOn() ? BAR : 0) });
  }
  doc.getElementById = id => id === 'ws-needs' ? host : null;
  global.document = doc;
  return host;
}
// a fresh section (another rail, another room): leaving SESSIONS and coming back makes the next render a full rebuild
function remount(room, scroll) { const host = makeHost(room, scroll); App.railView = () => 'projects'; NY.render(); delete App.railView; NY.render(); return host; }
const click = (host, b) => host.listeners.click({ target: { closest: sel => sel === '[data-ny-act]' ? b : null }, preventDefault() {}, stopPropagation() {} });
const headerOf = host => Number((/<span class="ny-count">(\d+)<\/span>/.exec(host.innerHTML) || [])[1]);
const moreOf = host => host.more && !host.more.hidden ? Number((/^(\d+) more$/.exec(host.more.textContent) || [])[1]) : 0;
const shownKeys = host => host.rows.filter(r => !r.hidden).map(r => r.dataset.nyKey);
const rowOf = (host, k) => host.rows.find(r => r.dataset.nyKey === k);
const keysOf = (host, k) => (rowOf(host, k) || { labels: [] }).labels.join(' · ');

(async () => {
  /* ---- 1. the fold counts waits: 2 asks, ULTRON's 23 builds, VEX's 2 untimed builds, a failed worker = 28 waits ---- */
  pending = [
    { wsId: 'proj', p: { promptId: 'q1', tool: 'brief.ask', argsSummary: JSON.stringify({ question: 'Which tier should lead?' }), agentId: 'agent', askedAt: NOW - 120000 } },
    { wsId: 'home', p: { promptId: 'a1', tool: 'fs.read', argsSummary: 'notes.md', agentId: 'agent', askedAt: NOW - 60000 } }];
  builds = Array.from({ length: 23 }, (_, i) => ({ runId: 'u' + i, agentId: 'ultron', title: 'Ghost run v' + i, builtAt: NOW - (40 - i) * 60000 }))
    .concat([{ runId: 'v0', agentId: 'vex', title: 'Pricing page', builtAt: 0 }, { runId: 'v1', agentId: 'vex', title: 'Pricing page v2' }]);
  workers = [{ runId: 'w1', status: 'error', agentId: 'mira', parentStreamId: 'home', completedAt: NOW - 30000 }];
  await NY.refreshFeeds(true);
  A.eq(NY.items(NOW).length, 28, 'fixture: 28 waits');

  let host = remount(10000);   // room for everything: only the three-row collapse folds
  A.eq(headerOf(host), 28, 'the header counts every wait');
  A.eq(shownKeys(host), ['ask:q1', 'ask:a1', 'build:u0'], 'collapsed, three rows show: the two asks and ULTRON\'s builds (one row, named by the oldest)');
  A.eq((rowOf(host, 'build:u0') || { dataset: {} }).dataset.nyN, '23', 'that row holds its 23 waits (data-ny-n)');
  A.eq(moreOf(host), 3, '"N more" counts the WAITS left out (VEX\'s 2 builds + the failed worker), never the 2 cards');
  A.eq(headerOf(host), 25 + moreOf(host), 'so the header is the waits shown (1 + 1 + 23) plus N more');

  /* ---- 2. the same when the room folds a card: ULTRON's builds fold, and all 23 of them are in "N more" ---- */
  host = remount(HEAD + 100 + 140 + MORE + 1);   // the question, the approval with Approve once · Deny stacked, the fold key
  A.eq(shownKeys(host), ['ask:q1', 'ask:a1'], 'a room for two rows shows two');
  A.eq(moreOf(host), 26, '"26 more": ULTRON\'s 23 builds, VEX\'s 2 and the failed worker');
  A.eq(headerOf(host), 2 + moreOf(host), 'the header (28) is still the waits shown plus N more');

  /* ---- 3. no time, no age: a card of untimed builds shows none (never "now") ---- */
  click(host, host.more);   // expand: every row
  A.eq(shownKeys(host), ['ask:q1', 'ask:a1', 'build:u0', 'build:v0', 'worker:w1'], 'expanded, every row shows');
  A.eq(rowOf(host, 'build:v0').ageEl.textContent, '', 'VEX\'s builds carry no time: their card shows no age (it said "now")');
  A.eq(rowOf(host, 'build:u0').ageEl.textContent, '40m', 'ULTRON\'s card shows its oldest build\'s age');
  click(host, host.more);   // Show fewer

  /* ---- 4. at a fold boundary the heartbeat settles: no rebuild loop ---- */
  pending = [
    { wsId: 'proj', p: { promptId: 'q2', tool: 'brief.ask', argsSummary: JSON.stringify({ question: 'Which tier should lead?' }), agentId: 'agent', askedAt: NOW - 120000 } },
    { wsId: 'home', p: { promptId: 'a2', tool: 'fs.read', argsSummary: 'notes.md', agentId: 'agent', askedAt: NOW - 60000 } }];
  builds = []; workers = [];
  await NY.refreshFeeds(true);
  // the room holds the approval with Review · Deny on one row (100px), not with Approve once · Deny stacked (140px)
  host = remount(HEAD + 100 + 100 + 1);
  const settled = host.writes;
  for (let beat = 0; beat < 6; beat++) { clock += 1000; NY.render(); }
  A.eq(host.writes - settled, 0, 'six heartbeats at the fold boundary rebuild nothing (it rebuilt the panel twice a beat, forever)');
  A.eq(shownKeys(host), ['ask:q2'], 'the approval, read whole (Approve once · Deny no longer fit), is folded');
  A.eq([headerOf(host), moreOf(host)], [2, 1], '…into "1 more", under a header of 2');
  A.eq(keysOf(host, 'ask:a2'), 'Approve once · Deny', '…keeping the keys of its last reading while folded');

  /* ---- 5. the safety rule holds at the fold: a folded row's reading is never trusted blind ---- */
  click(host, host.more);   // expand: the folded row shows, and is read before anything paints
  A.eq(keysOf(host, 'ask:a2'), 'Approve once · Deny', 'unfolded and read whole: Approve once');
  lineCut = true; clock += 1000; NY.render();
  A.eq(keysOf(host, 'ask:a2'), 'Review · Deny', 'its line reads cut now: the next heartbeat offers Review');
  lineCut = false; clock += 1000; NY.render();
  A.eq(keysOf(host, 'ask:a2'), 'Approve once · Deny', 'whole again: Approve once');
  lineCut = true;   // cut since that heartbeat: the click reads it again
  answered.length = 0; opened.length = 0;
  click(host, host.buttons.find(b => b.dataset.nyAct === 'once' && b.dataset.nyKey === 'ask:a2'));
  A.eq(answered, [], 'a click on Approve once for a line cut since the last reading approves nothing');
  A.eq(opened, ['home'], '…it opens the card that shows the whole request');
  lineCut = false;
  click(host, host.more);   // Show fewer: folded again, and settled again
  const settled2 = host.writes;
  for (let beat = 0; beat < 4; beat++) { clock += 1000; NY.render(); }
  A.eq(host.writes - settled2, 0, 'collapsed again, it settles again');
  // the room grows (a smaller TEXT SIZE) while the folded row's line is cut: the heartbeat that unfolds it reads it too
  lineCut = true; host.clientHeight = 1000; clock += 1000; NY.render();
  A.eq(shownKeys(host), ['ask:q2', 'ask:a2'], 'room for both: the heartbeat unfolds the approval');
  A.eq(keysOf(host, 'ask:a2'), 'Review · Deny', '…and reads it in the same beat, before it paints: a line cut while folded never shows Approve once');
  lineCut = false;

  /* ---- 6. a FIRST row taller than the room settles: its own keys never move its own reading (fix round 10-16) ----
     A laptop's 200px rail: one approval, so it is row 1 (fitRows never folds it). The room holds it with Review · Deny on one
     key row (100px), not with Approve once · Deny stacked (140px): Approve once makes the section scroll. */
  pending = [{ wsId: 'home', p: { promptId: 'a3', tool: 'fs.read', argsSummary: 'notes/a.md', agentId: 'agent', askedAt: NOW - 60000 } }];
  builds = []; workers = [];
  await NY.refreshFeeds(true);
  host = remount(HEAD + 100 + 10, true);
  const paints = [];   // after every render: the keys the row paints, and whether its line reads cut right then
  const look = () => { const r = rowOf(host, 'ask:a3'), w = r && r.querySelector('.ny-what'); paints.push({ keys: keysOf(host, 'ask:a3'), cut: !!w && w.scrollHeight > w.clientHeight + 2 }); };
  look();
  const settled3 = host.writes;
  for (let beat = 0; beat < 6; beat++) { clock += 1000; NY.render(); look(); }
  A.eq(host.writes - settled3, 0, 'six heartbeats with a first row taller than the room rebuild nothing (it rebuilt the panel twice a beat, forever)');
  A.eq(paints.filter(p => /Approve once/.test(p.keys) && p.cut).length, 0, 'Approve once is never painted over a line read as cut (' + JSON.stringify(paints[paints.length - 1]) + ')');
  A.ok(host.overflows(), '(the row with Approve once · Deny stacked overflows the room: the section scrolls)');
  A.eq(paints[paints.length - 1], { keys: 'Approve once · Deny', cut: false }, 'the line keeps the panel\'s full width while the section scrolls (the gutter is reserved and given back), so it reads whole and keeps one-tap Approve once');
  answered.length = 0;
  click(host, host.buttons.find(b => b.dataset.nyAct === 'once' && b.dataset.nyKey === 'ask:a3'));
  A.eq(answered, ['a3:once'], '…and Approve once does what it says: the line it shows is the whole request');
  A.report('needs-you-fold.test');
})().catch(e => { console.error(e); process.exit(1); });
