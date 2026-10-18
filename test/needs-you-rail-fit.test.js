'use strict';
/* node test/needs-you-rail-fit.test.js — NEEDS YOU's safety rule, held at every rail width and every TEXT SIZE (delta review
   10-15, and its fix round).

   The rail offers "Approve once" only when its ask line IS the whole request (needsyou.js); a line the rail cuts gets
   Review, which opens the card that shows all of it. The line is .ny-what: a box clamped to two lines in the rail's narrow
   column. Its width moves with the rail (168px in a browser window of 860px or less, 200px on a laptop, 232px on a desktop,
   up to 400px dragged) and its type with TEXT SIZE (a body zoom from 90% to 150% that the counter-zoomed rail does not
   follow). A fixed character count failed both ways: 48 let a 40-character ask be cut to "…" with Approve once beside it,
   and 23 still cut "wants to use fs rm: a" at HUGE (145%) while taking Approve once from a 28-character line that sits whole
   on a 232px rail at 100%. So needsyou.js reads the box it drew.

   This test lays each row out the way the browser does (the row's metrics from pipglass.css and the rail CSS, the bundled
   VT323's own advance width, word wrap with overflow-wrap: anywhere, the two-line clamp), on every rail, at every TEXT SIZE
   step and the 150% clamp, with and without the section's scrollbar, and drives the REAL render path with each row's box
   reporting that layout. Approve once must be offered exactly where the line lays out whole, the 1s heartbeat must follow
   a TEXT SIZE change, and a click must never approve a line that is cut now. */
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const zlib = require('zlib');

const ROOT = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const glass = read('frontend/css/pipglass.css');
const appCss = read('frontend/css/app.css');
const stationui = read('frontend/app/stationui.js');

/* ---- the font: every VT323 glyph advances the same width (read from the bundled woff2's hmtx, not assumed) ---- */
function woff2Advances(buf) {
  const KNOWN = ['cmap', 'head', 'hhea', 'hmtx', 'maxp', 'name', 'OS/2', 'post', 'cvt ', 'fpgm', 'glyf', 'loca', 'prep'];
  let o = 48;
  const numTables = buf.readUInt16BE(12), compressed = buf.readUInt32BE(20);
  const b128 = () => { let v = 0; for (let i = 0; i < 5; i++) { const b = buf[o++]; v = (v * 128) + (b & 0x7f); if (!(b & 0x80)) return v; } throw new Error('bad UIntBase128'); };
  const tables = [];
  for (let i = 0; i < numTables; i++) {
    const flags = buf[o++], idx = flags & 0x3f;
    let tag = KNOWN[idx] || '?';
    if (idx === 63) { tag = buf.toString('latin1', o, o + 4); o += 4; }
    const xf = (flags >> 6) & 3, len = b128();
    const transformed = (tag === 'glyf' || tag === 'loca') ? xf === 0 : xf !== 0;
    tables.push({ tag, transformed, len: transformed ? b128() : len });
  }
  const data = zlib.brotliDecompressSync(buf.subarray(o, o + compressed));
  let at = 0; const T = {};
  for (const t of tables) { T[t.tag] = Object.assign(t, { at }); at += t.len; }
  if (T.hmtx.transformed) throw new Error('hmtx is transformed: read the glyf table instead');
  const upem = data.readUInt16BE(T.head.at + 18), n = data.readUInt16BE(T.hhea.at + 34);
  const adv = new Set();
  for (let i = 0; i < n; i++) adv.add(data.readUInt16BE(T.hmtx.at + i * 4));
  return { upem, advances: [...adv].filter(a => a > 0) };   // 0 = combining marks, which take no room
}
const font = woff2Advances(fs.readFileSync(path.join(ROOT, 'frontend/assets/fonts/vt323.woff2')));
A.eq(font.advances.length, 1, 'VT323 is monospaced: one advance width for every spacing glyph (got ' + font.advances.join(', ') + ')');
const EM = font.advances[0] / font.upem;
A.ok(/#left \.ws-needs \{\s*flex: 0 0 auto;[^}]*font-family: 'VT323', monospace;/.test(glass), 'the NEEDS YOU section is set in VT323');

/* ---- the row: what stands between the rail's edge and the ask line, and the box that cuts it ---- */
const block = sel => {
  const at = glass.indexOf(sel + ' {');
  A.ok(at >= 0, 'pipglass.css still has `' + sel + ' {`');
  return glass.slice(at, glass.indexOf('}', at));
};
const px = (src, re, what) => { const m = re.exec(src); A.ok(!!m, what + ' (update the layout below if this moved)'); return m ? m.slice(1).map(Number) : [NaN]; };
// (10-17, Andrew's pick "C · ALERT CARDS") every wait is its own card: the section has no side margin, the list has side
// margins and no edge of its own, each card carries the 1px edge the old panel had (so the ask line's column is as wide as
// it was) and side padding, and a portrait column leads each card under its header strip
const needs = block('body.glass-demo:not(.hud-mode) #left .ws-needs');
const list = block('body.glass-demo:not(.hud-mode) #left .ws-needs .ny-list');
const item = block('body.glass-demo:not(.hud-mode) #left .ws-needs .ny-item');
const what = block('body.glass-demo:not(.hud-mode) #left .ws-needs .ny-what');
const [needsMx] = px(needs, /margin: \d+px (\d+)(?:px)? \d+px;/, 'the section keeps its side margins');
const [listMx] = px(list, /margin: \d+(?:px)? (\d+)px \d+px;/, 'the list keeps its side margins');
const [listBorder] = px(list, /border: (\d+)(?:px)?;/, 'the list has no edge of its own (each card carries it)');
const [listPx] = px(list, /padding: (\d+)(?:px)?;/, 'the list keeps its padding');
const [itemMx] = px(item, /margin: (\d+)(?:px)?;/, 'a card keeps its margins');
const [, itemPside] = px(item, /padding: (\d+)(?:px)? (\d+)px(?: \d+px)?;/, 'a card keeps its side padding');
const [itemBorder] = px(item, /border: (\d+)px solid /, 'a card keeps its 1px edge');
A.eq(listBorder + itemBorder, 1, 'one 1px edge stands between the rail and a card\'s padding (moved from the panel onto each card): the ask line\'s column did not narrow');
const [lampCol] = px(item, /grid-template-columns: (\d+)px minmax\(0, 1fr\);/, 'a row keeps its portrait column');
const [colGap] = px(item, /column-gap: (\d+)px;/, 'a row keeps its column gap');
const itemPl = itemPside, itemPr = itemPside;
const [fontPx] = px(what, /font-size: (\d+)px;/, 'the ask line keeps its type size');
const [lineH] = px(what, /line-height: (\d*\.?\d+);/, 'the ask line keeps its line height');
const [spacing] = px(what, /letter-spacing: (\.?\d*\.?\d+)px;/, 'the ask line keeps its letter-spacing');
const [clamp] = px(what, /-webkit-line-clamp: (\d+);/, 'the ask line is clamped');
// needsyou.js reads .ny-what's own scroll box: the clamp that cuts the line must be on THAT box, or the reading sees nothing cut
A.ok(/overflow: hidden;/.test(what) && /display: -webkit-box;/.test(what) && /-webkit-box-orient: vertical;/.test(what),
  'the clamp is on .ny-what itself (overflow hidden, a vertical -webkit-box): the box the rail reads is the box that cuts');
A.ok(/overflow-wrap: anywhere;/.test(what), 'a word too long for a line breaks anywhere (the layout below wraps the same way)');
const [railEdge] = px(read('frontend/css/glass-demo.css'), /\.glass-demo :is\(#left,#chat-panel,#topbar,#bottombar\) \{\s*background: var\(--gd-face\); border: (\d+)px solid/, 'the rail keeps its 1px edge');
const inset = 2 * (railEdge + needsMx + listMx + listBorder + listPx + itemMx + itemBorder) + itemPl + itemPr + lampCol + colGap;

/* ---- the rails (px, and whether TEXT SIZE's zoom is counter-zoomed out of their width) ---- */
const [desk] = px(appCss, /grid-template-columns: calc\(var\(--crew-w, (\d+)px\) \* var\(--cz\)\) 1fr/, 'a desktop window keeps its counter-zoomed default rail');
const [laptop] = px(read('frontend/css/comms-layout.css'), /@media \(min-width: 861px\) and \(max-width: 1440px\), \(min-width: 861px\) and \(max-height: 740px\) \{\s*body #screen-game\.active \{[^}]*grid-template-columns: calc\(var\(--crew-w, (\d+)px\) \* var\(--cz\)\)/, 'a laptop window keeps its counter-zoomed default rail');
const [narrow] = px(appCss, /@media \(max-width: 860px\) \{\s*#screen-game\.active \{[^}]*grid-template-columns: (\d+)px 1fr;/, 'a browser window of 860px or less keeps its fixed rail (not counter-zoomed: it grows with TEXT SIZE)');
const [dragMin, dragMax] = px(read('frontend/app/leftrail.js'), /WMIN = (\d+), WMAX = (\d+),/, 'the rail seam keeps its range');
const RAILS = [{ px: narrow, cz: false, name: narrow + 'px narrow window' }, { px: laptop, cz: true, name: laptop + 'px laptop' },
  { px: desk, cz: true, name: desk + 'px desktop' }, { px: dragMin, cz: true, name: dragMin + 'px dragged (narrowest)' }, { px: dragMax, cz: true, name: dragMax + 'px dragged (widest)' }];
A.ok(/#left > h3, #chat-panel > h3, \.ws-head \{ zoom: var\(--sn-unzoom, 1\); --cz: 1; \}/.test(appCss) && !/#left[^{]*\.ws-needs[^{]*\{[^}]*zoom:/.test(glass),
  'NEEDS YOU is not counter-zoomed: its text grows with TEXT SIZE inside the rail');

/* ---- every TEXT SIZE a user can pick, AUTO's steps, and the clamp on a stored value ---- */
const steps = [...((/const TEXT_SCALES = \[([^\n]+)\];/.exec(stationui) || [])[1] || '').matchAll(/\[(\d+), '[A-Z-]+'\]/g)].map(m => Number(m[1])).filter(Boolean);
A.ok(steps.length >= 5, 'TEXT SIZE keeps its steps (' + steps.join(', ') + ')');
const autoSteps = px(stationui, /return long <= 1470 \? (\d+) : long <= 1740 \? (\d+) : (\d+);/, 'AUTO text size keeps its steps');
const [lo, hi] = px(stationui, /return n === 0 \? autoTextScale\(\) : clampN\(n, (\d+), (\d+), 100\);/, 'a stored TEXT SIZE is clamped');
const ZOOMS = [...new Set([...steps, ...autoSteps, lo, hi])].sort((a, b) => a - b);
A.ok(ZOOMS.includes(130) && ZOOMS.includes(145) && ZOOMS.includes(150), 'X-LARGE, HUGE and the 150% clamp are all laid out (' + ZOOMS.join(', ') + ')');

/* ---- the browser's layout of one ask line: greedy wrap at spaces, a word too long for a line broken anywhere ---- */
const perChar = fontPx * EM + spacing;
let layout = { rail: RAILS[1], zoom: 100, bar: 0, laid: true };
const lineWidth = () => (layout.rail.cz ? layout.rail.px / (layout.zoom / 100) : layout.rail.px) - inset - layout.bar;
function linesOf(text) {
  const per = Math.max(1, Math.floor(lineWidth() / perChar));
  let lines = 1, cur = 0;
  const place = w => { lines += Math.floor((w.length - 1) / per); cur = ((w.length - 1) % per) + 1; };
  for (const w of text.split(' ').filter(Boolean)) {
    if (!cur) place(w);
    else if (cur + 1 + w.length <= per) cur += 1 + w.length;
    else { lines++; place(w); }
  }
  return lines;
}
const unesc = s => s.replace(/<[^>]*>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
// the box needsyou.js reads: live getters, so a TEXT SIZE change moves it with no redraw (as the browser's does)
// (a row the section folded away — hidden — is not laid out either: its box reads 0, as the browser's does)
function box(text, gone) {
  const h = n => Math.round(n * fontPx * lineH), laid = () => layout.laid && !(gone && gone());
  return {
    get clientHeight() { return laid() ? h(Math.min(linesOf(text), clamp)) : 0; },
    get scrollHeight() { return laid() ? h(linesOf(text)) : 0; },
    get clientWidth() { return laid() ? Math.floor(lineWidth()) : 0; },
    get scrollWidth() { return laid() ? Math.floor(lineWidth()) : 0; }   // overflow-wrap: anywhere never overflows sideways
  };
}

/* ---- the real page objects: the approval card's own phrase and INSPECT rule (chat.js, run for real) and the rail ---- */
const card = {};
{
  const src = read('frontend/app/chat.js'), at = src.indexOf('function glance(');
  vm.createContext(card); vm.runInContext(src.slice(at, src.indexOf('  function clarifyRow(', at)), card);
}
let pending = [];
const opened = [], answered = [];
global.localStorage = { getItem: () => null, setItem() {} };
global.Workstreams = { get: id => id === 'home' ? { id: 'home', title: null, agentId: 'agent' } : null, list: () => [], unread: () => false, generalId: () => 'home' };
global.Channels = { allPending: () => pending };
global.App = { agentName: id => ({ agent: 'NOVA' })[id] || id, openWorkstream: id => opened.push(id) };
global.Chat = { consentPhrase: card.actionPhrase, consentInspect: card.consentInspect, revealAsk: () => true, answerConsent: async (p, ws, d) => { answered.push(p.promptId + ':' + d); } };
/* ---- a row's keys: side by side while every label fits the text column, else stacked, each full width (pipglass.css) ---- */
const keyRule = block('body.glass-demo:not(.hud-mode) #left .ws-needs .ny-key'), keysRule = block('body.glass-demo:not(.hud-mode) #left .ws-needs .ny-keys');
const keyEach = block('body.glass-demo:not(.hud-mode) #left .ws-needs .ny-keys > .ny-key');
const [, keyPx] = px(keyRule, /padding: (\d+)px (\d+)px;/, 'a key keeps its side padding');
const [keyFont] = px(keyRule, /font: (\d+)px\/[\d.]+ 'VT323'/, 'a key keeps its 15px label');
const [keySpacing] = px(keyRule, /letter-spacing: (\.?\d*\.?\d+)px;/, 'a key keeps its letter-spacing');
const [keyEdge] = px(keyRule, /border: (\d+)px solid /, 'a key keeps its 1px edge');
const [keyGap] = px(keysRule, /gap: (\d+)px;/, 'the keys keep their gap');
const [keyH] = px(keyEach, /min-height: (\d+)px;/, 'a key in a row keeps its height');
const [keyBaseH] = px(keyRule, /min-height: (\d+)px;/, 'a key keeps its height');
A.ok(keyH >= 34 && keyBaseH >= 34, 'every NEEDS YOU key is the glass key\'s 34px or taller, in a key row too (got ' + keyBaseH + ', ' + keyH + ')');
A.ok(/min-width: max-content;/.test(keyEach) && /flex-wrap: wrap;/.test(keysRule), 'a key is never narrower than its label: a column too narrow for both wraps them, never clips one');
const keyWidth = label => label.length * (keyFont * EM + keySpacing) + 2 * keyPx + 2 * keyEdge;
const keysSideBySide = labels => labels.reduce((s, l) => s + keyWidth(l), 0) + keyGap * (labels.length - 1) <= lineWidth();
const keyRowsHeight = labels => keysSideBySide(labels) ? keyH : labels.length * keyH + (labels.length - 1) * keyGap;
/* ---- a card's header strip (Andrew 10-17, "C · ALERT CARDS"): what the wait is · how long, above the portrait and the lines.
   Measured live 10-17: 26px (5px + 4px padding, a 14px / 1.15 line, its 1px rule), then a 7px gap ---- */
const stripRule = block('body.glass-demo:not(.hud-mode) #left .ws-needs .ny-item > .ny-strip');
A.ok(/margin: 0 -10px 7px;/.test(stripRule) && /padding: 5px 10px 4px;/.test(stripRule) && /font-size: 14px; line-height: 1\.15;/.test(stripRule) && /border-bottom: 1px solid /.test(stripRule),
  'the header strip keeps the metrics the cards are laid out with (5px + 4px padding, a 14px / 1.15 line, a 1px rule, a 7px gap)');
const STRIP = 5 + 4 + Math.round(14 * 1.15) + 1 + 7;

const doc = { activeElement: null, hidden: false };
/* the section, laid out as the browser stacks it, so the REAL fitRows runs on every render (its fold key, each row's hidden
   flag, the section's scrollHeight against its room): a row is its name line, its ask line (the layout above) and its keys */
const dataset = attrs => Object.fromEntries([...attrs.matchAll(/data-([a-z-]+)="([^"]*)"/g)].map(m => [m[1].replace(/-([a-z])/g, (_, c) => c.toUpperCase()), m[2]]));
const ROOM = 440;                      // the section's cap at a tall rail: min(48%, 440px)
let fitRuns = 0;                       // how many times fitRows set a row's hidden flag (it sets every row's, every run)
const host = { hidden: false, rows: [], buttons: [], more: null, listeners: {}, _h: '', clientHeight: ROOM,
  setAttribute() {}, addEventListener(t, fn) { this.listeners[t] = fn; }, contains: () => false,
  querySelectorAll: sel => sel === 'li.ny-item[data-ny-key]' ? host.rows : sel === '[data-ny-act]' ? host.buttons : [],
  querySelector: sel => sel === '.ny-more' ? host.more : null,
  get scrollHeight() { return 33 + host.rows.filter(r => !r.hidden).reduce((s, r) => s + r.height(), 0) + (host.more && !host.more.hidden ? 25 : 0); },
  get innerHTML() { return this._h; },
  set innerHTML(h) {
    this._h = h;
    this.rows = [...h.matchAll(/<li class="ny-item [^"]*"([^>]*)>([\s\S]*?)<\/li>/g)].map(m => {
      const inner = m[2];
      const ageEl = { textContent: (/<span class="ny-age">([^<]*)<\/span>/.exec(inner) || [])[1] };
      const text = unesc((/<div class="ny-what"[^>]*>([\s\S]*?)<\/div>/.exec(inner) || [])[1] || '');
      let hidden = false;
      const whatEl = box(text, () => hidden), labels = [...inner.matchAll(/class="ny-key\b[^"]*"[^>]*>([^<]*)</g)].map(k => k[1]);
      return { dataset: dataset(m[1]), text, querySelector: sel => sel === '.ny-age' ? ageEl : sel === '.ny-what' ? whatEl : null,
        get hidden() { return hidden; }, set hidden(v) { fitRuns++; hidden = !!v; },
        // (measured live 10-17) the card's two 1px edges, its header strip and the strip's 7px gap, a 3px row gap, the 22px name
        // line, a 3px row gap, the ask line, and (when it has keys) a 3px row gap, the keys' 6px margin and its key rows
        // (keyRows, below), then the card's 10px foot
        height: () => 2 * itemBorder + STRIP + 3 + 22 + 3 + Math.min(linesOf(text), clamp) * Math.round(fontPx * lineH) + (labels.length ? 3 + 6 + keyRowsHeight(labels) : 0) + 10 };
    });
    const mm = /<button type="button" class="ny-more"([^>]*)>([^<]*)<\/button>/.exec(h);
    this.more = mm ? { dataset: dataset(mm[1]), hidden: / hidden/.test(mm[1]), textContent: mm[2] } : null;
    this.buttons = [...h.matchAll(/<button type="button" class="([^"]*)" data-ny-act="([^"]*)" data-ny-key="([^"]*)"[^>]*>([^<]*)</g)].map(m =>
      ({ className: m[1], dataset: { nyAct: m[2], nyKey: m[3] }, label: m[4], closest: sel => sel === 'li.ny-item' ? host.rows.find(r => r.dataset.nyKey === m[3]) || null : null }));
  } };
doc.getElementById = id => id === 'ws-needs' ? host : null;
global.document = doc;
const NY = require('../frontend/app/needsyou.js');
const keysOf = k => host.buttons.filter(b => b.dataset.nyKey === k && /\bny-key\b/.test(b.className)).map(b => b.label).join(' · ');
const click = (act, k) => host.listeners.click({ target: { closest: sel => sel === '[data-ny-act]' ? host.buttons.find(b => b.dataset.nyAct === act && b.dataset.nyKey === k) : null }, preventDefault() {}, stopPropagation() {} });

// the shapes the sidecar sends (consentSummary): a lone path is the bare path; a call with no arguments is '{}'
const ASKS = [['mcp__fs__rm', 'a'], ['mcp__fs__rm', 'a.md'], ['fs.list', 'src'], ['mcp__fs__rm', 'notes.md'], ['fs.read', 'notes.md'],
  ['mcp__filesystem__read_file', 'notes.md'], ['fs.read', 'notes/launch-prep/pricing.md'], ['mcp__git__push', '{}']];
let n = 0;
// an older question waits above each ask, so the section has two rows and a fold key: the real fitRows runs every render
const QUESTION = { promptId: 'fit-q', tool: 'brief.ask', argsSummary: JSON.stringify({ question: 'Which tier should lead?' }), agentId: 'agent', askedAt: Date.now() - 600000 };
function show(tool, argsSummary) {
  const p = { promptId: 'fit' + (++n), tool, argsSummary, agentId: 'agent', askedAt: Date.now() - 1000 };
  pending = [{ wsId: 'home', p: QUESTION }, { wsId: 'home', p }];
  NY.render();
  return 'ask:' + p.promptId;
}
const sayLine = k => (host.rows.find(r => r.dataset.nyKey === k) || {}).text;

/* ---- 1. every rail × every TEXT SIZE × the section's scrollbar off and on: Approve once exactly where the line lays out whole ---- */
const wrong = [];
let wholeSeen = 0, cutSeen = 0;
for (const rail of RAILS) for (const zoom of ZOOMS) for (const bar of [0, 10]) for (const [tool, args] of ASKS) {
  layout = { rail, zoom, bar, laid: true };
  const k = show(tool, args), line = sayLine(k), lines = linesOf(line), detail = !!card.consentInspect({ tool, argsSummary: args });
  const want = !detail && lines <= clamp ? 'Approve once · Deny' : 'Review · Deny';
  if (!detail) { if (lines <= clamp) wholeSeen++; else cutSeen++; }
  if (keysOf(k) !== want) wrong.push(rail.name + ' @' + zoom + '%' + (bar ? ' +bar' : '') + ': "' + line + '" (' + lines + ' lines) offered ' + keysOf(k) + ', not ' + want);
}
A.ok(wholeSeen > 20 && cutSeen > 20, '(the layouts include many whole lines and many cut ones: ' + wholeSeen + ' whole, ' + cutSeen + ' cut)');
A.eq(wrong.slice(0, 6), [], 'at every rail width and TEXT SIZE, Approve once is offered exactly for a line the rail shows whole (' + wrong.length + ' wrong)');

/* ---- 2. the cases the reviews named ---- */
const at = (railPx, zoom, tool, args, bar) => { layout = { rail: RAILS.find(r => r.px === railPx), zoom, bar: bar || 0, laid: true }; const k = show(tool, args); return { k, line: sayLine(k), keys: keysOf(k) }; };
let c = at(laptop, 145, 'mcp__fs__rm', 'a');
A.eq(c.line, 'wants to use fs rm: a', '(HUGE on a laptop: the rm ask\'s line)');
A.eq(c.keys, 'Review · Deny', 'HUGE (145%) on the 200px laptop rail cuts "wants to use fs rm: a" (' + linesOf(c.line) + ' lines): reviewed on its card, never approved blind');
c = at(laptop, 130, 'mcp__fs__rm', 'a', 10);
A.eq(c.keys, linesOf(c.line) > clamp ? 'Review · Deny' : 'Approve once · Deny', 'X-LARGE (130%) with the list scrolling: the same line follows what the rail shows (' + linesOf(c.line) + ' lines)');
c = at(laptop, 115, 'mcp__filesystem__read_file', 'notes.md');
A.eq(c.keys, 'Review · Deny', 'AUTO\'s 115% on the laptop rail cuts a 43-character ask ("' + c.line + '"): reviewed on its card');
c = at(desk, 100, 'mcp__fs__rm', 'notes.md');
A.eq([c.line, linesOf(c.line), c.keys].join(' | '), 'wants to use fs rm: notes.md | 2 | Approve once · Deny', 'a 28-character rm ask that sits whole on the 232px desktop rail at 100% keeps one-tap Approve once (org P02)');
c = at(desk, 100, 'fs.read', 'notes.md');
A.eq(c.keys, 'Approve once · Deny', 'so does "wants to use fs read: notes.md" on the desktop rail at 100%');
c = at(desk, 100, 'mcp__git__push', '{}');
A.eq(c.keys, 'Review · Deny', 'a call with no arguments (the sidecar sends "{}") has an INSPECT panel, so it is reviewed on its card wherever it fits');

/* ---- 3. the 1s heartbeat follows a TEXT SIZE change with no list change; a click reads the line again ---- */
c = at(desk, 100, 'fs.read', 'notes.md');
A.eq(c.keys, 'Approve once · Deny', '(at 100% the line is whole: Approve once)');
layout.zoom = 145;   // the Commander picks HUGE: nothing in the list moves
answered.length = 0; opened.length = 0;
click('once', c.k);
A.eq(answered, [], 'a click on Approve once after the line was cut (before the heartbeat redrew it) approves nothing');
A.eq(opened, ['home'], '…it opens the card that shows the whole request instead');
NY.render();   // the heartbeat
A.eq(keysOf(c.k), 'Review · Deny', 'the next heartbeat re-reads the line and offers Review');
layout.zoom = 100; NY.render();
A.eq(keysOf(c.k), 'Approve once · Deny', 'back at 100% the heartbeat gives Approve once back');
click('once', c.k);
A.eq(answered, [c.k.slice(4) + ':once'], 'and a click on a line read whole approves it once, through the card\'s own path');

/* ---- 4. a line that cannot be read (its row hidden, not laid out) is never approved from the rail ---- */
c = at(desk, 100, 'fs.read', 'a.md'); layout.laid = false; NY.render();
A.eq(keysOf(c.k), 'Review · Deny', 'a row with no layout to read offers Review');

/* ---- 5. the real fitRows ran on every render above, with the ask's own row never folded (the room holds both rows) ---- */
fitRuns = 0;
c = at(narrow, hi, 'fs.read', 'notes.md');
A.ok(fitRuns > 0, 'fitRows runs on the rail\'s render (this host has the fold key, the rows\' hidden flags and the section\'s room)');
A.ok(host.rows.every(r => !r.hidden) && host.more && host.more.hidden, 'at the narrowest rail and the largest TEXT SIZE both rows fit the room: nothing folds, "N more" stays hidden');

/* ---- 6. the two keys: side by side where both labels fit, stacked (each full width, 34px) where they do not ---- */
layout = { rail: RAILS.find(r => r.px === desk), zoom: 100, bar: 0, laid: true };
A.ok(keysSideBySide(['Approve once', 'Deny']), 'Approve once · Deny share one row on the 232px rail at STANDARD (' + Math.round(keyWidth('Approve once') + keyGap + keyWidth('Deny')) + 'px of ' + Math.floor(lineWidth()) + ')');
layout = { rail: RAILS.find(r => r.px === laptop), zoom: 100, bar: 0, laid: true };
A.ok(!keysSideBySide(['Approve once', 'Deny']), '…and stack on the 200px rail at STANDARD (' + Math.floor(lineWidth()) + 'px): each key stays whole, the row grows by a key');

/* ---- 8. the name line: the PLACE gives up its room before the NAME does (fix round 10-16) ----
   Line 1 of a row is a flex line: WHO · in <where> · age. A group's names may wrap (.ny-who shrinks), and that let the
   flex algorithm shrink the name in proportion beside a long place: on Andrew's 400px rail MISS FORTUNE broke onto two
   lines (MISS / FORTUNE) and "ULTRON, CYPHER +3" onto two, while "in ⚒ Speedrun timer with checkpoint splits + test
   course" kept 219px. The line is laid out here with the CSS flex algorithm (Flexbox §9.7, one line) from the REAL rules —
   each item's flex, min-width and type, the line's gap, the container query that takes the place out of the line on a
   narrow row — and VT323's own advance, on every rail at every TEXT SIZE:
   - a name stays on one line whenever it and the gap fit the line (the place takes only what is left, "…");
   - (10-17) the time is no longer in this line: it sits in the card's header strip, at its right end, whole. */
{
  const topRule = sel => { const m = new RegExp('^' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ' \\{([^}]*)\\}', 'm').exec(glass); A.ok(!!m, 'pipglass.css still has `' + sel + ' {` at the top level'); return m ? m[1] : ''; };
  const P = 'body.glass-demo:not(.hud-mode) #left .ws-needs ';
  const lineRule = topRule(P + '.ny-line'), whoRule = topRule(P + '.ny-who'), whereRule = topRule(P + '.ny-where'), ageRule = topRule(P + '.ny-age');
  const flexOf = (rule, what) => {
    const m = /(?:^|[;\s])flex:\s*([^;]+);/.exec(rule); A.ok(!!m, what + ' keeps a flex rule');
    const v = m ? m[1].trim() : 'none';
    if (v === 'none') return { grow: 0, shrink: 0, basis: 'auto' };
    if (v === 'auto') return { grow: 1, shrink: 1, basis: 'auto' };
    const t = v.split(/\s+/), num = s => /^\d*\.?\d+$/.test(s);
    if (t.length === 1 && num(t[0])) return { grow: +t[0], shrink: 1, basis: 0 };
    const grow = +t[0], shrink = t[1] && num(t[1]) ? +t[1] : 1, b = num(t[1] || '') ? t[2] : t[1];
    return { grow, shrink, basis: !b || /^0(px|%)?$/.test(b) ? 0 : b === 'auto' || b === 'content' ? 'auto' : parseFloat(b) };
  };
  const minOfRule = rule => { const m = /(?:^|[;\s])min-width:\s*(\d+)(?:px)?;/.exec(rule); return m ? +m[1] : 'auto'; };
  const typeOf = (rule, what) => { const [f] = px(rule, /font(?:-size)?: (\d+)px/, what + ' keeps its type size'); const [ls] = px(rule, /letter-spacing: (\.?\d*\.?\d+)px;/, what + ' keeps its letter-spacing'); return f * EM + ls; };
  const [gap] = px(lineRule, /gap: 0 (\d+)px;/, 'the name line keeps its gap');
  const perWho = typeOf(whoRule, 'the name'), perWhere = typeOf(whereRule, 'the place'), perAge = typeOf(ageRule, 'the time');
  const cq = /@container \(max-width: (\d+)px\) \{\s*body\.glass-demo:not\(\.hud-mode\) #left \.ws-needs \.ny-where \{[^}]*(?:position: absolute|display: none)/.exec(glass);
  A.ok(!!cq, 'a narrow row takes the place out of its name line (the container query)');
  const placeOutBelow = cq ? +cq[1] : 0;
  const moreEm = Number((/\.ny-who > \.ws-agent-more \{ margin-left: (\.?\d*\.?\d+)em; \}/.exec(glass) || [])[1]) || 0;   // a group's "+N" keeps its gap
  // a name's widths: max-content (one line) and min-content (its longest unbreakable run: a group's "+N" rides its last name)
  function nameBox(names, more) {
    const w = s => s.length * perWho, gapMore = more ? moreEm * fontPxOf(whoRule) : 0, tail = more ? gapMore + w('+' + more) : 0;
    const words = names.split(' ');
    return { maxC: w(names) + tail, minC: Math.max(...words.map((x, k) => w(x) + (k === words.length - 1 ? tail : 0))) };
  }
  function fontPxOf(rule) { return +(/font-size: (\d+)px/.exec(rule) || [])[1]; }
  // Flexbox §9.7 resolving flexible lengths, one line, no wrap
  function flexLine(avail, items) {
    const minOf = i => i.min === 'auto' ? i.minC : i.min;
    const base = items.map(i => i.basis === 'auto' ? i.maxC : i.basis);
    const hypo = items.map((i, k) => Math.max(minOf(i), base[k]));
    const gaps = gap * (items.length - 1);
    const growing = hypo.reduce((s, x) => s + x, 0) + gaps < avail;
    const factor = i => growing ? i.grow : i.shrink;
    const target = hypo.slice();
    const frozen = items.map((i, k) => factor(i) === 0 || (growing ? base[k] > hypo[k] : base[k] < hypo[k]));
    const initialFree = avail - gaps - items.reduce((s, i, k) => s + (frozen[k] ? target[k] : base[k]), 0);
    for (let guard = 0; guard < 12 && frozen.some(f => !f); guard++) {
      const un = items.map((_, k) => k).filter(k => !frozen[k]);
      let free = avail - gaps - items.reduce((s, i, k) => s + (frozen[k] ? target[k] : base[k]), 0);
      const sumF = un.reduce((s, k) => s + factor(items[k]), 0);
      if (sumF < 1 && Math.abs(initialFree * sumF) < Math.abs(free)) free = initialFree * sumF;
      if (growing) un.forEach(k => { target[k] = base[k] + (sumF ? free * items[k].grow / sumF : 0); });
      else { const sumS = un.reduce((s, k) => s + items[k].shrink * base[k], 0); un.forEach(k => { target[k] = base[k] + (sumS ? free * items[k].shrink * base[k] / sumS : 0); }); }
      let total = 0; const viol = {};
      un.forEach(k => { const c = Math.max(minOf(items[k]), target[k]); viol[k] = c - target[k]; total += viol[k]; target[k] = c; });
      un.forEach(k => { if (Math.abs(total) < 1e-9 || (total > 0 ? viol[k] > 0 : viol[k] < 0)) frozen[k] = true; });
    }
    return { sizes: target, used: target.reduce((s, x) => s + x, 0) + gaps };
  }
  // (10-17, "C · ALERT CARDS") the time moved up into the card's header strip, beside what the wait is: the name line is the
  // name and its place, and the strip says how long (its own rule, read from the stylesheet; the rows below carry it there)
  const whoF = flexOf(whoRule, 'the name'), whereF = flexOf(whereRule, 'the place');
  A.ok(/<div class="ny-strip"><span class="ny-kind">[^<]*<\/span><span class="ny-age">/.test(NY._internals.html([{ key: 'ask:t', kind: 'question', who: 'NOVA', aid: 'agent', what: 'Which tier?', where: 'General', since: Date.now() - 120000, p: { promptId: 't', tool: 'brief.ask' } }], Date.now()))
    && !/<div class="ny-line">[^]*?<span class="ny-age">[^]*?<\/div>/.test(NY._internals.html([{ key: 'ask:t', kind: 'question', who: 'NOVA', aid: 'agent', what: 'Which tier?', where: 'General', since: Date.now() - 120000, p: { promptId: 't', tool: 'brief.ask' } }], Date.now())),
    'a card\'s time sits in its header strip, beside what the wait is, never in its name line');
  A.ok(/flex: none;/.test(ageRule) && /margin-left: auto;/.test(ageRule), 'the strip keeps its time at its right end, whole');
  const ROWS = [
    { what: 'MISS FORTUNE beside a build session\'s long place', names: 'MISS FORTUNE', place: 'in ⚒ Speedrun timer with checkpoint splits + test course' },
    { what: 'a group of five beside its long title', names: 'ULTRON, CYPHER', more: 3, place: 'in Scout the speedrun community for course ideas and leaderboards' },
    { what: 'ULTRON beside "General"', names: 'ULTRON', place: 'in General' }
  ];
  const wrapped = [], placeWide = [], tooNarrow = new Set();
  let placeShown = 0, oneLineAt400 = 0;
  for (const rail of RAILS) for (const zoom of ZOOMS) for (const r of ROWS) {
    layout = { rail, zoom, bar: 0, laid: true };
    const avail = lineWidth(), placeIn = avail + lampCol + colGap > placeOutBelow;
    const nb = nameBox(r.names, r.more);
    const who = Object.assign({ min: minOfRule(whoRule) }, whoF, nb);
    const where = Object.assign({ min: minOfRule(whereRule), maxC: r.place.length * perWhere, minC: r.place.length * perWhere }, whereF);
    const items = placeIn ? [who, where] : [who], out = flexLine(avail, items);
    const at = rail.name + ' @' + zoom + '%: ' + r.what;
    const roomForName = nb.maxC + (items.length - 1) * gap <= avail + 0.01;
    if (roomForName && out.sizes[0] < nb.maxC - 0.01) wrapped.push(at + ' — the name gets ' + out.sizes[0].toFixed(1) + 'px of the ' + nb.maxC.toFixed(1) + ' it needs, the place ' + (placeIn ? out.sizes[1].toFixed(1) : 'none'));
    // (where not even the name's longest word fits the line — the 200px rail at X-LARGE and up — it breaks: not this rule's to fix)
    if (nb.minC > avail + 0.01) tooNarrow.add(rail.name + ' @' + zoom + '%');
    if (placeIn) {
      placeShown++;
      if (out.sizes[1] > Math.max(0, avail - (out.sizes[0] + gap)) + 0.01) placeWide.push(at + ' — the place takes more than the name leaves');
      if (rail.px === dragMax && zoom === 90 && roomForName) oneLineAt400++;
    }
  }
  A.ok(placeShown > 10 && oneLineAt400 === ROWS.length, '(the place is in the line on the wide rails: ' + placeShown + ' layouts, all three rows at Andrew\'s 400px rail at 90%)');
  A.eq(wrapped.slice(0, 4), [], 'a name stays on one line wherever it and the gap fit the line: the place gives up its room first (' + wrapped.length + ' wrapped)');
  if (tooNarrow.size) console.log('NOTE: not even a name\'s longest word fits one line at ' + [...tooNarrow].join(', ') + ' (unchanged by this rule)');
  A.eq(placeWide.slice(0, 4), [], 'the place takes only the room the name leaves, and shows the rest as "…" (' + placeWide.length + ')');
  // Andrew's rail, the review's two cases, named
  layout = { rail: RAILS.find(r => r.px === dragMax), zoom: 90, bar: 0, laid: true };
  for (const r of ROWS.slice(0, 2)) {
    const nb = nameBox(r.names, r.more);
    const out = flexLine(lineWidth(), [Object.assign({ min: minOfRule(whoRule) }, whoF, nb), Object.assign({ min: minOfRule(whereRule), maxC: r.place.length * perWhere, minC: r.place.length * perWhere }, whereF)]);
    A.ok(out.sizes[0] >= nb.maxC - 0.01 && out.sizes[1] < r.place.length * perWhere, 'Andrew\'s 400px rail at 90%: ' + r.what + ' — the name on one line (' + out.sizes[0].toFixed(1) + ' of ' + nb.maxC.toFixed(1) + 'px), the place cut to ' + out.sizes[1].toFixed(1) + 'px with "…"');
  }
}

/* ---- 7. an agent's builds are one row whose COUNT is never cut (two reviews 10-16, P1) ----
   "+22 more" after the oldest build's title sat on line 3+ of the two-line clamp on every default rail: 22 real waits
   vanished from the rail while the header counted them. The count leads the line, so it ends on line 1 or 2 on every
   rail, at every TEXT SIZE, with and without the section's own scrollbar (its real width, from the stylesheet). */
const [barPx] = px(glass, /#left \.ws-needs::-webkit-scrollbar \{ width: (\d+)px; \}/, 'the section keeps its themed scrollbar width');
(async () => {
  const builds = Array.from({ length: 23 }, (_, i) => ({ runId: 'b' + i, agentId: 'agent', title: i ? 'Ghost replay recorder v' + i : 'Speedrun timer with checkpoint splits + test course', builtAt: Date.now() - (30 - i) * 60000 }));
  global.WorkshopStore = { pendingAll: async () => builds, pendingAllOk: () => true, ensureSession: m => 'workshop-' + m.runId, sessionIdOf: r => 'workshop-' + r, sessionTitleOf: m => '⚒ ' + m.title };
  global.fetch = async url => ({ ok: true, json: async () => url === '/api/hooks' ? { hooks: [], pending: [] } : { plugins: [] } });
  await NY.refreshFeeds(true);
  pending = [];
  layout = { rail: RAILS[1], zoom: 100, bar: 0, laid: true };
  NY.render();
  const row = host.rows.find(r => /^build:/.test(r.dataset.nyKey));
  A.ok(!!row && host.rows.length === 1, 'the 23 builds are ONE row (' + host.rows.length + ' rows)');
  A.eq((/<span class="ny-count">(\d+)<\/span>/.exec(host.innerHTML) || [])[1], '23', 'the header counts every one of them');
  const line = row ? row.text : '', count = /\+\d+ more|\b\d+ builds?\b/.exec(line);
  A.ok(!!count && /23/.test(count[0]), 'the row says how many builds wait: "' + line + '"');
  const cutAt = [];
  for (const rail of RAILS) for (const zoom of ZOOMS) for (const bar of [0, barPx]) {
    layout = { rail, zoom, bar, laid: true };
    const upTo = count ? linesOf(line.slice(0, count.index + count[0].length)) : Infinity;
    if (upTo > clamp) cutAt.push(rail.name + ' @' + zoom + '%' + (bar ? ' +bar' : '') + ': the count ends on line ' + upTo);
  }
  A.eq(cutAt.slice(0, 6), [], 'the count of builds sits on line 1 or 2 of the clamped line on every rail at every TEXT SIZE (' + cutAt.length + ' cut)');
  A.report('needs-you-rail-fit');
})().catch(e => { console.error(e); process.exit(1); });
