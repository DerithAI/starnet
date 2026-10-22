/* bin/lib/tui.js — the PURE screen of the `starnet` dashboard: model + ui state + terminal size → rows of styled
   segments, and those rows → ANSI strings. No I/O and no clock (`now` is passed in), so test/cli-dashboard.test.js
   renders it to plain text and checks the layout.

   Layout: the header (the StarNet wordmark; beside it the station, the counts, NOW — what the busy agents are doing —
   and FLOWS), then two framed panels: CREW down the left (lamp, name, a word for what it is doing; the agent in COMMS
   marked; ≥ 90 columns) and COMMS (the focused agent's conversation, the open ask's card at its foot), then the prompt
   and the keys. One palette: names in white, neon red the only accent, color only where it carries status.

   Every glyph sits in one cell (wide characters take two), and anything an agent or a tool wrote is stripped of
   control characters and escape sequences before it reaches a cell: model output can never drive the terminal. */
'use strict';

const { fmtDur, fmtShort, costText, askInspect, ONCE_ONLY_TOOLS, RUN_FLOOR } = require('./station-model.js');
// the StarNet mark, cut from the real brand art by dev/cli-logo.cjs (never redrawn)
const logo = require('./logo.js');
const sixelLib = require('./sixel.js');   // the real logo: an image where the terminal draws Sixel, braille dots elsewhere

const BARS = '▁▂▃▄▅▆▇█';

// ---- text hygiene + cell widths ----------------------------------------------------------------------
// strip ANSI/OSC escapes and every C0/C1 control except newline; tabs become spaces
function clean(s) {
  return String(s == null ? '' : s)
    .replace(/\x1b\[[0-?]*[ -\/]*[@-~]/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)?/g, '')
    .replace(/\t/g, '  ')
    .replace(/[\x00-\x09\x0b-\x1f\x7f-\x9f]/g, '');
}
function cpWidth(cp) {
  if (cp === 0x200b || cp === 0x200c || cp === 0x200d || cp === 0xfe0f || cp === 0xfe0e) return 0;
  if ((cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) || (cp >= 0x20d0 && cp <= 0x20ff)) return 0;
  if ((cp >= 0x1100 && cp <= 0x115f) || (cp >= 0x2e80 && cp <= 0xa4cf) || (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff)
    || (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) || (cp >= 0xffe0 && cp <= 0xffe6)
    || (cp >= 0x1f300 && cp <= 0x1faff) || (cp >= 0x20000 && cp <= 0x3fffd)) return 2;
  return 1;
}
function width(s) { let w = 0; for (const ch of String(s)) w += cpWidth(ch.codePointAt(0)); return w; }
function trunc(s, n) {
  const t = String(s);
  if (n <= 0) return '';
  if (width(t) <= n) return t;
  let out = '', w = 0;
  for (const ch of t) { const cw = cpWidth(ch.codePointAt(0)); if (w + cw > n - 1) break; out += ch; w += cw; }
  return out.trimEnd() + '…';
}
function wrap(text, w) {
  w = Math.max(4, w);
  const out = [];
  for (const para of clean(text).split('\n')) {
    let line = '';
    for (let word of para.split(' ')) {
      while (width(word) > w) {
        if (line) { out.push(line); line = ''; }
        let head = '', hw = 0, rest = '';
        for (const ch of word) { const cw = cpWidth(ch.codePointAt(0)); if (!rest && hw + cw <= w) { head += ch; hw += cw; } else rest += ch; }
        out.push(head); word = rest;
      }
      if (!line) line = word;
      else if (width(line) + 1 + width(word) <= w) line += ' ' + word;
      else { out.push(line); line = word; }
    }
    out.push(line);
  }
  return out;
}

// ---- the cell grid -------------------------------------------------------------------------------------
function makeGrid(cols, rows) {
  const ch = [], st = [];
  for (let y = 0; y < rows; y++) { ch.push(new Array(cols).fill(' ')); st.push(new Array(cols).fill('')); }
  function put(x, y, s, style) {
    if (y < 0 || y >= rows) return x;
    for (const c of clean(s).replace(/\n/g, ' ')) {
      const cw = cpWidth(c.codePointAt(0));
      if (cw === 0) continue;
      if (x + cw > cols) break;
      if (x >= 0) { ch[y][x] = c; st[y][x] = style || ''; if (cw === 2) { ch[y][x + 1] = ''; st[y][x + 1] = style || ''; } }
      x += cw;
    }
    return x;
  }
  function putR(xr, y, s, style) { return put(xr - width(clean(s)), y, s, style); }
  function hl(y, x0, x1, extra) { if (y < 0 || y >= rows) return; for (let x = Math.max(0, x0); x < Math.min(cols, x1); x++) st[y][x] = (st[y][x] + ' ' + extra).trim(); }
  function out() {
    return ch.map((row, y) => {
      const segs = [];
      for (let x = 0; x < cols; x++) {
        if (row[x] === '') continue;   // the second cell of a wide glyph
        const s = st[y][x];
        if (segs.length && segs[segs.length - 1][1] === s) segs[segs.length - 1][0] += row[x];
        else segs.push([row[x], s]);
      }
      return segs;
    });
  }
  return { put, putR, hl, out, cols, rows };
}

// ---- the screen ------------------------------------------------------------------------------------------
const HELP = [
  ['message', 'talk to the agent shown in COMMS'],
  ['@name message', 'talk to another agent (it queues if busy)'],
  ['/model [name]', 'show or switch the shown agent\'s model'],
  ['/new', 'start a fresh conversation with it'],
  ['/resume', 'go back to an earlier conversation'],
  ['y  a  n  v', 'answer the open ask: once, always, no, view'],
  ['1-6 or text', 'answer an open question'],
  ['tab  shift+tab', 'switch the agent shown in COMMS'],
  ['↑  ↓', 'your earlier messages'],
  ['pgup  pgdn', 'scroll COMMS'],
  ['/stop', 'stop the shown agent\'s runs'],
  ['/retry', 'send your last message again'],
  ['/status', 'the agent, its model, its folder, the station'],
  ['/skills', 'its skills · run one: /<skill> <task>'],
  ['/usage  /tools', 'spend · what it can call'],
  ['/routine', 'scheduled routines: list, create, pause'],
  ['/cron  on · off', 'the routines scheduler: its state, arm it'],
  ['/away', 'work it builds on its own away shift'],
  ['/flow', 'list workflows'],
  ['/flow run name text', 'send one job down a workflow'],
  ['/version', 'the CLI and the station'],
  ['/help', 'this list'],
  ['ctrl+c', 'quit']
];

// the wordmark in neon red; the star in its A gets a hotter glint
function putLogo(g, word) {
  word.forEach((l, r) => { let x = 0; for (const ch of l) { if (ch !== ' ') g.put(x, r, ch, ch === '✦' ? 'logohi b' : 'logo b'); x++; } });
}
// WORKING SPINS: an agent with a live run, the working count and a running flow turn this wheel (a still screen holds its
// first frame). Every other state keeps its lamp — ▲ asks, ✓ done, ■ stopped, ○ idle — so motion means one thing.
const SPIN = '⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏';
function spin(now, still) { return SPIN[still ? 0 : Math.floor(now / 100) % SPIN.length]; }
function lampOf(s, blink, now, still) {
  if (s.key === 'working') return [spin(now, still), 'ph b'];
  if (s.key === 'needs') return ['▲', blink ? 'am b' : 'am faint'];
  if (s.key === 'done') return ['✓', 'ok b'];
  if (s.key === 'stopped') return ['■', 'bad'];
  return ['○', 'dim'];
}

// a framed panel: rounded corners, thin rule lines (box-drawing glyphs, which terminals draw edge to edge)
function frame(g, x0, y0, x1, y1, style) {
  g.put(x0, y0, '╭', style); g.put(x1, y0, '╮', style); g.put(x0, y1, '╰', style); g.put(x1, y1, '╯', style);
  for (let x = x0 + 1; x < x1; x++) { g.put(x, y0, '─', style); g.put(x, y1, '─', style); }
  for (let y = y0 + 1; y < y1; y++) { g.put(x0, y, '│', style); g.put(x1, y, '│', style); }
}
// segments laid on a frame's edge: from the left (x) or ending at the right (xr)
function edgeL(g, x, y, segs) { x = g.put(x, y, ' ', ''); for (const [t, s] of segs) x = g.put(x, y, t, s); return g.put(x, y, ' ', ''); }
function edgeR(g, xr, y, segs) { const w = segs.reduce((n, s) => n + width(s[0]), 0) + 2; return edgeL(g, xr - w, y, segs); }

function render(model, ui, size, now) {
  const W = Math.max(20, size.cols | 0), H = Math.max(8, size.rows | 0);
  const g = makeGrid(W, H);
  if (W < 46 || H < 16) {
    g.put(0, 0, trunc('starnet needs at least 46×16 — this terminal is ' + W + '×' + H, W), 'am');
    return g.out();
  }
  const blink = ui.still || Math.floor(now / 530) % 2 === 0;
  const head = model.header(now);
  const rows = model.rows(now);
  const flows = model.flows(now);
  const front = model.front();
  const narrow = W < 80;
  const focusRow = rows.find(r => r.id === ui.focus) || rows[0];

  // the counts, longest form that fits: feed state + working + needs + spend → working + needs → needs alone
  const working = [(head.working ? spin(now, ui.still) + ' ' : '○ ') + head.working + ' working', head.working ? 'ph b' : 'dim'];
  const needs = [(head.needs ? '▲ ' : '△ ') + head.needs + ' needs you', head.needs ? 'am b' : 'dim'];
  const sep = ['   ', ''];
  const feed = head.feed !== 'live' ? [[feedWord(head.feed), 'am'], sep] : [];
  const forms = [feed.concat([working, sep, needs, sep, [costText(head.cost), 'dim']]), feed.concat([working, sep, needs]), [working, sep, needs], [needs]];
  function putCounts(y, xMin) {
    for (const form of forms) {
      const w = form.reduce((n, s) => n + width(s[0]), 0);
      let x = W - w;
      if (x < xMin) continue;
      for (const [t, s] of form) x = g.put(x, y, t, s);
      return W - w;
    }
    return -1;
  }

  // NOW: what the busy ones are doing (the agent whose ask is on the card is left out: the card says it)
  const busy = rows.filter(r => r.status.key === 'needs' && !(front && front.agentId === r.id)).concat(rows.filter(r => r.status.key === 'working'));
  function drawNow(x0, y) {
    let x = g.put(x0, y, 'NOW    ', 'lbl b');
    for (const r of busy) {
      if (x > W - 12) break;
      x = g.put(x, y, r.name, 'hi b');
      x = g.put(x, y, ' › ', 'dim');
      x = g.put(x, y, trunc(r.now || 'working', Math.max(8, Math.min(48, W - x - 3))), r.status.key === 'needs' ? 'am' : 'fg');
      x = g.put(x, y, '    ', '');
    }
  }
  // FLOWS: the station's lines and their last job
  function drawFlows(x0, y) {
    let x = g.put(x0, y, 'FLOWS  ', 'lbl b');
    flows.forEach((f, i) => {
      const run = f.state === 'running';
      const lamp = run ? spin(now, ui.still) : f.state === 'done' ? '✓' : f.state === 'failed' || f.state === 'interrupted' ? '✗' : '○';
      const tailText = run ? (f.agents.length ? ' › ' + f.agents[0] + ' ' : ' ') + f.text.replace(/^[A-Z0-9 ]+ · /, '') : ' ' + f.text.replace(/^(done|delivered) · /, '') + (f.shipped ? ' · ' + f.shipped + ' shipped' : '');
      const name = trunc(f.name, 26), tl = trunc(tailText, 30);
      // a flow is said whole or not at all (the first one shortens to fit): never cut off at the screen's edge
      const room = W - x;
      if (i && width(lamp + ' ' + name + tl) > room) { if (x < W) { const more = '+' + (flows.length - i); if (room >= width(more)) g.put(x, y, more, 'dim'); } x = W; return; }
      if (x >= W - 8) return;
      x = g.put(x, y, lamp + ' ', run ? 'ph b' : f.state === 'done' ? 'ok' : lamp === '✗' ? 'bad' : 'dim');
      x = g.put(x, y, trunc(name, Math.max(4, W - x)), run ? 'hi b' : 'fg');
      x = g.put(x, y, trunc(tl, Math.max(0, W - x)), run ? 'ph' : 'dim');
      x = g.put(x, y, '     ', '');
    });
  }

  // ---- header: the StarNet wordmark, and beside it the station, the counts, NOW and FLOWS -------------------------
  // where the terminal draws images, the REAL logo is an image the dashboard paints into these cells (ui.logoImage); the
  // screen here only keeps them blank. Without an image: the same real logo as braille dots (STARNET_LOGO=ascii keeps the
  // drawn-letter version, =plain the one-line mark)
  const img = ui.logoImage && ui.logoImage.cols > 0 ? ui.logoImage : null;
  const word = img || ui.logo === 'plain' ? null : ui.logo === 'ascii' ? (logo && logo.word) || null : sixelLib.brailleLogo();
  const lw = img ? img.cols : word ? Math.max(...word.map(l => width(l))) : 0;
  const lrows = img ? img.rows : word ? word.length : 0;
  let y, top;
  // THE PIP-BOY CHROME (Andrew 10-22, mock A): a tab rule under the logo and a stat bar at the foot, where there is room
  const chrome = !narrow && H >= 20;
  let tabsRow = -1;
  if ((img || word) && lrows >= 3 && W - lw - 3 >= 44) {
    if (word) putLogo(g, word);
    const x0 = lw + 3;
    const xc = putCounts(0, x0);
    if (xc - x0 > 24) g.put(x0, 0, trunc(ui.stationLabel || '', xc - x0 - 3), 'dim');
    if (busy.length) drawNow(x0, 1);
    if (flows.length) drawFlows(x0, 2);
    top = lrows + 1;
    if (chrome) tabsRow = lrows;   // the blank row under the logo
  } else {
    // the one-line mark, the counts on it; NOW and FLOWS under it only when they have something to say
    let x = 0;
    'STARNET'.split('').forEach((ch, i) => { x = g.put(x, 0, ch, 'logo b'); if (i < 6) x = g.put(x, 0, ' ', ''); });
    const xc = putCounts(0, x + 3);
    if (!narrow && xc - x > 30) g.put(x + 3, 0, trunc(ui.stationLabel || '', xc - x - 6), 'dim');
    y = 1;
    if (busy.length) drawNow(0, y++);
    if (flows.length) drawFlows(0, y++);
    top = y;
  }
  const statY = chrome ? H - 1 : -1, hintY = chrome ? H - 2 : H - 1, promptY = hintY - 1, bot = promptY - 1;
  let avatar = null;   // { x, y, cols, rows, id, key }: where the dashboard paints the camera feed, of whom, doing what
  const wk = ui.wake || null;   // the awakening (a station with no agent yet): its stage names where you are

  // ---- CREW: a framed list down the left — lamp, name, and a word for what it is doing — the one in COMMS marked; at its
  // foot, where the terminal draws images and the list leaves room, the station camera locked on the agent in COMMS -
  const side = W >= 90 && rows.length > 0 && !(ui.wake && !ui.wake.crew);   // the awakening shows the crew once its agent exists
  const sw = side ? 30 : 0;   // room for a name and its tag, and for the camera feed at its foot
  if (side) {
    // the crew BY KIND, each kind under its strip (the app's NEEDS YOU, grouped by kind): who waits on you, who works,
    // who stands by. A kind with nobody in it is not drawn.
    const items = [];
    for (const [label, list, st] of [
      ['NEEDS YOU', rows.filter(r => r.status.key === 'needs'), 'ink b amfill'],
      ['WORKING', rows.filter(r => r.status.key === 'working'), 'lbl b sel'],
      ['STANDING BY', rows.filter(r => r.status.key !== 'needs' && r.status.key !== 'working'), 'lbl b sel']
    ]) if (list.length) { items.push({ strip: label + ' ' + list.length, st }); for (const r of list) items.push({ r }); }
    const card = ui.images && focusRow && items.length <= bot - top - 1 - AGENT_ROWS;
    const listBot = card ? bot - AGENT_ROWS : bot;
    const inner = listBot - top - 1;
    const fi = Math.max(0, items.findIndex(it => it.r === focusRow));
    const start = items.length > inner ? Math.min(Math.max(0, fi - Math.floor(inner / 2)), items.length - inner) : 0;
    const shown = items.slice(start, start + inner);
    const above = items.slice(0, start).filter(it => it.r).length, below = items.slice(start + shown.length).filter(it => it.r).length;
    frame(g, 0, top, sw - 1, bot, 'rule');
    if (tabsRow < 0) edgeL(g, 2, top, [['CREW', 'lbl b'], [' ' + rows.length, 'dim']]);
    if (above) edgeR(g, sw - 2, top, [['↑ ' + above, 'dim']]);
    if (below) edgeR(g, sw - 2, bot, [['↓ ' + below, 'dim']]);
    shown.forEach((it, i) => {
      const yy = top + 1 + i;
      if (it.strip) { g.put(1, yy, (' ' + it.strip).padEnd(sw - 2, ' '), it.st); return; }
      const r = it.r, foc = r === focusRow;
      const [lamp, lc] = lampOf(r.status, blink, now, ui.still);
      // a working agent shows what it has been doing, a segment per 2 s slot: lit = it did something then (a run merely
      // open, waiting on its model, is the dim floor, so a stalled run never reads as busy); the rest keep their word
      const meter = r.status.key === 'working' && Array.isArray(r.act) ? r.act.slice(-6) : null;
      const tag = meter ? null : tagOf(r.status, now);
      g.put(3, yy, lamp, lc);
      g.put(5, yy, trunc(r.name, sw - 7 - (meter ? 7 : tag ? width(tag[0]) + 1 : 0)), foc || r.status.key !== 'idle' ? 'hi b' : 'fg');
      if (meter) meter.forEach((v, k) => g.put(sw - 8 + k, yy, '▌', v > RUN_FLOOR ? 'ph' : 'rule'));
      else if (tag) g.putR(sw - 2, yy, tag[0], tag[1]);
      if (foc) { g.put(1, yy, '▌', 'ph b'); g.hl(yy, 1, sw - 1, 'sel'); }
    });
    if (card) {
      // the rule carries its name and what it is doing, the camera's REC light at its end; under it, the feed
      g.put(0, listBot, '├' + '─'.repeat(sw - 2) + '┤', 'rule');
      edgeR(g, sw - 2, listBot, [['●', ui.still || Math.floor(now / 600) % 2 === 0 ? 'ph b' : 'rule'], [' REC', 'dim']]);
      const waking = !!(ui.wake && ui.wake.feedKey);   // the awakening: the newborn at its desk in the dark
      const [said0, wc0, said1] = stateWords(focusRow.status, now, ui.still);
      const wc = waking ? 'dim' : wc0, said = waking ? '' : said1;
      // the crew list's own word for an ask; a name too long for the word keeps the state's lamp alone (⠋ ▲ ✓ ■ ○)
      let word = waking ? 'waking' : focusRow.status.key === 'needs' ? '▲ asks' : said0;
      if (width(focusRow.name) > sw - 14 - width(word)) word = [...word][0];
      // how long it has worked or waited (its row in the list shows its activity), said only beside the whole name
      let more = waking ? '' : said;
      if (more && width(focusRow.name) > sw - 15 - width(word) - width(more)) more = '';
      const title = trunc(focusRow.name, Math.max(4, sw - 14 - width(word) - (more ? width(more) + 1 : 0)));
      edgeL(g, 2, listBot, [[title, 'hi b'], [' ', ''], [word, wc]].concat(more ? [[' ' + more, 'dim']] : []));
      // the feed is an image the dashboard paints into these cells; the screen only says where, of whom, doing what
      avatar = { x: 2, y: listBot + 1, cols: sw - 4, rows: AGENT_ROWS - 1, id: focusRow.id, key: waking ? ui.wake.feedKey : focusRow.status.key };
    }
  }

  // ---- COMMS: the focused agent's conversation, framed; the open ask's card sits at its foot ------------------------------
  const cx0 = sw, cx1 = W - 1;
  frame(g, cx0, top, cx1, bot, 'rule');
  // with the tab rule above, the frames carry no titles of their own (the rule says each place once)
  if (tabsRow < 0) {
    if (wk) edgeL(g, cx0 + 2, top, [[wk.stage.title || 'THE AWAKENING', 'ph b']].concat(wk.stage.detail ? [[' · ' + wk.stage.detail, 'dim']] : []));
    else edgeL(g, cx0 + 2, top, focusRow ? [['COMMS', 'ph b'], [' ▸ ', 'rule'], [focusRow.name, 'hi b']] : [['COMMS', 'ph b']]);
  }
  const right = [];
  if (focusRow && focusRow.model && cx1 - cx0 > 60) right.push([focusRow.model, 'dim']);
  if (ui.scroll > 0) right.push([(right.length ? '  ' : '') + '↑ ' + ui.scroll, 'am']);
  if (!side && focusRow && !ui.wake) right.push([(right.length ? '  ' : '') + (rows.indexOf(focusRow) + 1) + '/' + rows.length, 'dim']);
  if (right.length) edgeR(g, cx1 - 1, top, right);
  // the trusted project every message from here works in, on the frame's foot (said whatever the width)
  if (ui.project && ui.project.label) edgeL(g, cx0 + 2, bot, [[trunc(ui.project.label, Math.max(8, cx1 - cx0 - 8)), 'dim']]);
  const ix0 = cx0 + 2, ix1 = cx1 - 2, iy0 = top + 1, iy1 = bot - 1;
  const cw = Math.min(ix1 - ix0 + 1, 96);
  // an agent's ask first (a run is waiting on it); else the folder card, when the folder `starnet` started in is not trusted
  const card = wk ? (wk.ask ? wakeCardLines(wk.ask, cw, now, ui.still) : []) : front ? cardLines(front, model, cw, H) : ui.trust ? trustLines(ui.trust, cw) : [];
  const cardTop = iy1 - card.length + 1;
  const paneBot = card.length ? cardTop - 1 : iy1 + 1;
  if (ui.picker) drawPicker(g, ui.picker, iy0, paneBot, ix0, ix1, blink);
  else if (ui.overlay) drawOverlay(g, ui.overlay, iy0, paneBot, ix0, ix1, tabsRow >= 0);
  else if (wk) drawWake(g, wk, iy0, paneBot, ix0, ix1, ui, now);
  else if (!focusRow) g.put(ix0, iy0, trunc(head.feed === 'connecting' ? 'connecting to the station…' : 'no agents on this station yet', ix1 - ix0 + 1), 'dim');
  else drawPane(g, focusRow ? model.logOf(focusRow.id) : [], focusRow, iy0, paneBot, ix0, ix1, ui, now);
  if (card.length) drawCard(g, card, cardTop, ix0, cw, blink);

  // ---- THE TAB RULE: the places on this screen, the one you are in hanging from the rule in a filled label ---------------
  if (tabsRow >= 0) {
    // a list laid over COMMS (/help) is the place you are in: the tab names it, so the list keeps the row
    const here = ui.overlay && !ui.picker ? [ui.overlay.title, ''] : wk ? [wk.stage.title || 'THE AWAKENING', wk.stage.detail || ''] : [focusRow ? 'COMMS ▸ ' + focusRow.name : 'COMMS', ''];
    const tabs = (side ? [['CREW', ' ' + rows.length]] : []).concat([['@here']]).concat(flows.length && !wk ? [['FLOWS', ' ' + flows.length]] : []);
    let x = g.put(0, tabsRow, '──', 'rule');
    for (const t of tabs) {
      if (t[0] === '@here') {
        x = g.put(x, tabsRow, '┘', 'rule');
        x = g.put(x, tabsRow, ' ' + trunc(here[0], Math.max(8, W - x - 30)) + ' ', 'ink b hifill');
        x = g.put(x, tabsRow, '└', 'rule');
        if (here[1]) x = g.put(x, tabsRow, ' ' + trunc(here[1], Math.max(4, W - x - 24)) + ' ', 'dim');
      } else { x = g.put(x, tabsRow, ' ' + t[0], 'dim b'); x = g.put(x, tabsRow, t[1] + ' ', 'dim'); }
      x = g.put(x, tabsRow, '───', 'rule');
    }
    while (x < W) x = g.put(x, tabsRow, '─', 'rule');
  }
  // ---- THE STAT BAR (the Pip-Boy's level · HP · AP): the station's level and what it is doing, in segments -----------------
  if (statY >= 0) {
    const sep = ['│', 'rule'];
    const parts = [];
    const st = ui.stats;   // the station's growth, read from its save (Xp.compute): level and how far into it
    if (st && st.level) parts.push([[' LV ' + st.level + ' ', 'ink b hifill'], [' ', '']].concat(Array.from({ length: 10 }, (_, k) => ['▌', k < Math.round((st.frac || 0) * 10) ? 'ph' : 'rule'])).concat([['  XP ' + st.inLevel + '/' + st.span + '  ', 'dim']]));
    // the awakening before its agent exists has no crew to count
    if (!(wk && !wk.crew)) {
      parts.push([['  CREW ' + rows.length + ' ', 'fg b']]);
      parts.push([[(head.working ? spin(now, ui.still) + ' ' : '○ ') + head.working + ' WORKING ', head.working ? 'ph b' : 'dim']].map(s => ['  ' + s[0], s[1]]));
      parts.push([[(head.needs ? '▲ ' : '△ ') + head.needs + ' NEEDS YOU ', head.needs ? 'am b' : 'dim']].map(s => ['  ' + s[0], s[1]]));
    }
    parts.push([['  ' + costText(head.cost).toUpperCase() + ' ', 'fg']]);
    const d = new Date(now), clock = ' ' + String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0') + ' ';
    const room = W - width(clock) - 1;
    let x = 0, drawn = 0;
    parts.forEach(segs => {
      const w = segs.reduce((n, s) => n + width(s[0]), 0) + (drawn ? 1 : 0);
      if (x + w > room) return;   // what does not fit is left out whole, never cut
      if (drawn++) x = g.put(x, statY, sep[0], sep[1]);
      for (const [t, s] of segs) x = g.put(x, statY, t, s);
    });
    g.putR(W, statY, clock, 'ink b hifill');
  }

  // ---- prompt + keys ------------------------------------------------------------------------------------------------
  const flashKey = ui.keyFlash && ui.keyFlash.until > now;
  let px = g.put(0, promptY, (ui.wake ? 'you' : focusRow ? focusRow.name.toLowerCase() : 'starnet') + ' ', 'dim');   // the awakening: your answers
  px = g.put(px, promptY, '▸ ', 'brand b');
  const room = W - px - 2 - (flashKey ? 8 : 0);
  const typed = String(ui.input || '').replace(/\n/g, ' ⏎ ');   // a pasted multi-line message shows its breaks as ⏎
  const inp = width(typed) > room ? '…' + tail(typed, room - 1) : typed;
  px = g.put(px, promptY, inp, 'hi');
  g.put(px, promptY, blink ? '█' : ' ', 'ph');
  if (flashKey) g.putR(W, promptY, '[' + ui.keyFlash.k + ']', 'am b');
  if (ui.flash && ui.flash.until > now) g.put(0, hintY, trunc(ui.flash.text, W), ui.flash.style || 'am');
  else if (ui.quitArmed && ui.quitArmed > now) g.put(0, hintY, trunc('ctrl+c again to quit — ' + ui.quitNote, W), 'am b');
  else {
    const t = wk
      ? (wk.ask ? ((wk.ask.options || []).length ? '1-' + wk.ask.options.length + ' pick · ' : '') + (wk.ask.custom ? 'or type your own + enter · ' : '') + 'ctrl+c pauses setup'
        : wk.typing ? 'any key shows the rest' : 'ctrl+c pauses setup')
      : front
      ? (front.question ? (front.question.options.length ? '1-' + front.question.options.length + ' pick · ' : '') + 'type an answer + enter · esc clears' : 'y allow once · ' + (canAlways(front) ? 'a always · ' : '') + 'n deny · v ' + (front.view ? 'hide' : 'view') + ' · ' + (narrow ? 'tab agent' : 'tab next agent'))
      : ui.trust ? 'y trust this folder · n not now · or just type to talk'
        : narrow ? 'tab agent · /model · /new · /help · ctrl+c quit' : 'tab next agent  ·  ↑ ↓ history  ·  /model  ·  /new  ·  /resume  ·  /help  ·  ctrl+c quit';
    g.put(0, hintY, trunc(t, W), 'dim');
  }
  const out = g.out();
  out.avatar = avatar;
  return out;
}

const AGENT_ROWS = 9;   // the titled rule above it + its 8-row scene
// what the agent in the card is doing, in words on its rule: [word, style, a second word]
function stateWords(s, now, still) {
  if (s.key === 'working') return [spin(now, still) + ' working', 'ph b', fmtDur(now - (s.since || now))];
  if (s.key === 'needs') return ['▲ needs you', 'am b', ''];
  if (s.key === 'done') return ['✓ done', 'ok', ''];
  if (s.key === 'stopped') return ['■ stopped', 'bad', String(s.text || '') === 'stopped' ? '' : String(s.text || '')];
  return ['○ idle', 'dim', ''];
}

// the word beside a name in the CREW list: what its lamp means, in a word
function tagOf(s, now) {
  if (s.key === 'needs') return ['ASKS', 'am'];
  if (s.key === 'working') return [fmtDur(now - (s.since || now)), 'ph'];
  if (s.key === 'done') return ['DONE', 'ok'];
  if (s.key === 'stopped') return [trunc(String(s.text || 'stopped').toUpperCase(), 9), 'bad'];
  return null;
}

function feedWord(f) { return f === 'connecting' ? 'connecting…' : f === 'down' ? 'feed lost · retrying' : f === 'old' ? 'live feed unavailable · polling' : String(f || ''); }
function spark(act) { const mx = Math.max(4, ...act); return act.map(v => BARS[Math.min(7, Math.round(v / mx * 7))]).join(''); }
function tail(s, n) { const a = [...String(s)]; let out = '', w = 0; for (let i = a.length - 1; i >= 0; i--) { const cw = cpWidth(a[i].codePointAt(0)); if (w + cw > n) break; out = a[i] + out; w += cw; } return out; }

/* MARKDOWN, the way a terminal shows it: an agent writes markdown, and raw `**`, backticks and fences read as noise. Block level:
   fenced code (a dim bar down its left, no fences shown), headings (bold white), bullets (•) and numbered items, quotes, rules.
   Inline: **bold** / __bold__ (bold white), `code` (amber), [text](url) (the text, then the url dim). Everything else is text. */
function mdInline(s, base) {
  base = base || 'fg';
  const out = [];
  const re = /\*\*([^*]+)\*\*|__([^_]+)__|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)|(?<![\w*])\*(\S(?:[^*]*\S)?)\*(?![\w*])/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push([s.slice(last, m.index), base]);
    if (m[1] || m[2]) out.push([m[1] || m[2], 'hi b']);
    else if (m[3]) out.push([m[3], 'am']);
    else if (m[4]) { out.push([m[4], base === 'fg' ? 'hi' : base]); out.push([' (' + m[5] + ')', 'dim']); }
    else out.push([m[6], base]);   // *emphasis*: a terminal has no italic to give it, so the words stand plain
    last = re.lastIndex;
  }
  if (last < s.length) out.push([s.slice(last), base]);
  return out.length ? out : [['', base]];
}
function mdLines(text) {
  const out = [];
  let code = false;
  for (const raw of clean(text).split('\n')) {
    if (/^\s*```/.test(raw)) { code = !code; continue; }
    if (code) { out.push({ pre: [['│ ', 'dim']], segs: [[raw || ' ', 'fg']] }); continue; }
    let m;
    if ((m = /^#{1,6}\s+(.*)$/.exec(raw))) { out.push({ pre: [], segs: mdInline(m[1], 'hi b') }); continue; }
    if ((m = /^(\s*)[-*+]\s+(.*)$/.exec(raw))) { out.push({ pre: [[' '.repeat(Math.min(6, m[1].length)) + '• ', 'ph']], segs: mdInline(m[2]) }); continue; }
    if ((m = /^(\s*)(\d{1,3})[.)]\s+(.*)$/.exec(raw))) { out.push({ pre: [[' '.repeat(Math.min(6, m[1].length)) + m[2] + '. ', 'ph']], segs: mdInline(m[3]) }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(raw)) { out.push({ pre: [], segs: [['────', 'rule']] }); continue; }
    if ((m = /^\s*>\s?(.*)$/.exec(raw))) { out.push({ pre: [['│ ', 'dim']], segs: mdInline(m[1], 'dim') }); continue; }
    out.push({ pre: [], segs: mdInline(raw) });
  }
  return out;
}
// styled segments → lines no wider than w, broken at spaces (a longer word is cut), styles kept
function wrapSegs(segs, w) {
  w = Math.max(4, w);
  const lines = [[]];
  let lw = 0;
  const cur = () => lines[lines.length - 1];
  const add = (t, s) => { const L = cur(); if (L.length && L[L.length - 1][1] === s) L[L.length - 1][0] += t; else L.push([t, s]); };
  const breakLine = () => { const L = cur(); if (L.length) L[L.length - 1][0] = L[L.length - 1][0].replace(/ +$/, ''); lines.push([]); lw = 0; };
  for (const [text, style] of segs) {
    for (const tok of String(text).split(/( +)/)) {
      if (!tok) continue;
      if (/^ +$/.test(tok)) { if (lw && lw + tok.length <= w) { add(tok, style); lw += tok.length; } else if (lw) breakLine(); continue; }
      let word = tok;
      while (width(word) > w) {
        if (lw) breakLine();
        let head = '', hw = 0;
        for (const ch of word) { const cw = cpWidth(ch.codePointAt(0)); if (hw + cw > w) break; head += ch; hw += cw; }
        add(head, style); breakLine(); word = word.slice(head.length);
      }
      if (!word) continue;
      if (lw && lw + width(word) > w) breakLine();
      add(word, style); lw += width(word);
    }
  }
  if (lines.length > 1 && !cur().length) lines.pop();
  return lines;
}

// the conversation as rows: { label, lc, segs } (null = a blank row between exchanges); the text column is `tw` wide
function paneRows(log, focusRow, tw, now) {
  const out = [];
  const name = focusRow ? focusRow.name : '';
  log.forEach((e, i) => {
    if ((e.k === 'you' || e.k === 'start' || e.k === 'say') && i > 0) out.push(null);
    if (e.k === 'say') {
      // a station command's answer, under the command that asked: its title, then its lines as the station wrote them
      const rowsOf = (e.title ? [[e.title, 'hi b']] : []).concat(e.lines.flatMap(l => String(l).split('\n')).map(l => [l, e.ok ? 'fg' : 'am']));
      let first = true;
      for (const [t, s] of rowsOf) for (const ln of wrap(t, tw)) { out.push({ label: first ? e.cmd : '', lc: 'ph b', segs: [[ln, s]] }); first = false; }
      if (first) out.push({ label: e.cmd, lc: 'ph b', segs: [['done', 'dim']] });
      return;
    }
    if (e.k === 'tool') {
      const segs = [['↳ ', 'dim'], [e.name, 'ph'], ['  ' + e.args, 'fg']];
      if (e.running) segs.push(['  ' + ['·  ', '·· ', '···'][Math.floor(now / 320) % 3], 'dim']);
      else if (e.res) segs.push(['  · ' + e.res, e.ok === false ? 'bad' : 'dim']);
      out.push({ label: '', segs });
      return;
    }
    let label = '', lc = '', tc = 'fg', text = e.text, note = '';
    if (e.k === 'you') { label = 'YOU'; lc = 'hi b'; tc = e.queued ? 'dim' : 'hi'; }
    else if (e.k === 'start' && e.source === 'desktop') { label = 'YOU'; lc = 'hi b'; tc = 'hi'; note = '· from the app'; if (!text) text = e.adopted ? '(a run already under way when this terminal attached)' : '(a run from the app)'; }
    else if (e.k === 'start') { label = e.source.toUpperCase().slice(0, 7); lc = 'dim b'; tc = 'fg'; if (!text) text = e.adopted ? '(a ' + e.source + ' run, already under way when this terminal attached)' : '(' + e.source + ' run)'; }
    else if (e.k === 'agent') {
      // the agent's words, rendered as markdown: each block line wrapped under its own prefix (bullet, code bar)
      let first = true;
      for (const ml of mdLines(text + (e.live ? '▍' : ''))) {
        const pw = ml.pre.reduce((n, s) => n + width(s[0]), 0);
        wrapSegs(ml.segs, tw - pw).forEach((segs, j) => {
          out.push({ label: first ? name : '', lc: 'ph b', segs: (j ? (pw ? [[' '.repeat(pw), '']] : []) : ml.pre).concat(segs) });
          first = false;
        });
      }
      return;
    }
    else if (e.k === 'ok') tc = 'ok';
    else if (e.k === 'bad') tc = 'bad';
    else if (e.k === 'ask') tc = 'am';
    else tc = 'dim';
    const lines = wrap(text, tw);
    lines.forEach((ln, j) => {
      const segs = [[ln, tc]];
      // where the words came from, after the first line when it fits there, else after the last
      if (note && ((j === 0 && width(ln) + width(note) + 2 <= tw) || (j === lines.length - 1 && j > 0 && width(lines[0]) + width(note) + 2 > tw && width(ln) + width(note) + 2 <= tw))) segs.push(['  ' + note, 'dim']);
      out.push({ label: j ? '' : label, lc, segs });
    });
  });
  return out;
}
// the conversation inside [x0, x1] (inclusive), rows top..bot-1, newest at the bottom; scrolls by ui.scroll
function drawPane(g, log, focusRow, top, bot, x0, x1, ui, now) {
  const H = bot - top;
  if (H <= 0) return;
  // the label column fits the agent's name and any command whose answer is shown (/routine, /version …)
  const L = Math.max(8, Math.min(14, Math.max(focusRow ? width(focusRow.name) : 0, ...log.filter(e => e.k === 'say').map(e => width(e.cmd))) + 2));
  const all = paneRows(log, focusRow, x1 - x0 + 1 - L, now);
  if (!all.length) { g.put(x0 + L, top, trunc(focusRow ? 'nothing yet · type a message for ' + focusRow.name + ' and press enter' : '', x1 - x0 - L), 'dim'); return; }
  const maxScroll = Math.max(0, all.length - H);
  ui.scroll = Math.min(Math.max(0, ui.scroll | 0), maxScroll);
  const end = all.length - ui.scroll;
  all.slice(Math.max(0, end - H), end).forEach((r, i) => {
    if (!r) return;
    const yy = top + i;
    if (r.label) g.put(x0, yy, trunc(r.label, L - 1), r.lc);
    let x = x0 + L;
    for (const [t, s] of r.segs) { const room = x1 + 1 - x; if (room <= 0) break; x = g.put(x, yy, trunc(t, room), s); }
  });
}
/* A PICKER (/model, /resume): a filterable list inside the COMMS frame. p: { title, note, filter, sel, items: [{ cols:
   [[text, style]…], search, current }], loading, error, foot }. The selected row sits on the highlight bar, the current one is
   marked ●, the window scrolls to keep the selection in view. Pure: it only reads p (sel is clamped by the caller's keys). */
function pickerView(p) {
  const terms = String(p.filter || '').toLowerCase().split(/\s+/).filter(Boolean);
  return (p.items || []).filter(it => terms.every(t => String(it.search || '').indexOf(t) >= 0));
}
function drawPicker(g, p, top, bot, x0, x1, blink) {
  let y = top;
  let x = g.put(x0, y, p.title || 'PICK', 'hi b');
  if (p.note) g.putR(x1 + 1, y, trunc(p.note, Math.max(0, x1 - x - 3)), 'dim');
  y++;
  const list = pickerView(p);
  x = g.put(x0, y, '› ', 'brand b');
  x = g.put(x, y, trunc(p.filter || '', Math.max(4, x1 - x0 - 24)), 'hi');
  g.put(x, y, blink ? '█' : ' ', 'ph');
  g.putR(x1 + 1, y, p.loading ? 'loading…' : list.length + ' of ' + (p.items || []).length, 'dim');
  y += 2;
  const rowsAvail = Math.max(1, bot - 1 - y);
  if (p.error && !list.length) { g.put(x0, y, trunc(p.error, x1 - x0 + 1), 'bad'); }
  else if (!list.length && !p.loading) g.put(x0, y, p.filter ? 'nothing matches "' + trunc(p.filter, 40) + '"' : 'nothing to pick', 'dim');
  const sel = Math.max(0, Math.min(list.length - 1, p.sel | 0));
  const start = Math.max(0, Math.min(sel - Math.floor(rowsAvail / 2), list.length - rowsAvail));
  list.slice(start, start + rowsAvail).forEach((it, i) => {
    const yy = y + i, on = start + i === sel;
    g.put(x0, yy, it.current ? '●' : ' ', 'ph b');
    let xx = x0 + 2;
    for (const [t, s] of it.cols) { if (xx > x1) break; xx = g.put(xx, yy, trunc(t, Math.max(0, x1 + 1 - xx)), on ? 'hi b' : s); }
    if (on) { g.put(x0 - 1 < 0 ? x0 : x0 - 1, yy, '▌', 'ph b'); g.hl(yy, x0, x1 + 1, 'sel'); }
  });
  g.put(x0, bot - 1, trunc(p.foot || '↑ ↓ pick · enter choose · esc close · type to filter', x1 - x0 + 1), 'dim');
}
function drawOverlay(g, o, top, bot, x0, x1, titled) {
  let y = top;
  if (!titled) g.put(x0, y++, o.title, 'hi b');
  const wide = x1 - x0 >= 66;
  for (const [k, d] of o.items) {
    if (y >= bot - 1) break;
    if (wide) { g.put(x0 + 2, y, trunc(k, 22), 'ph'); g.put(x0 + 26, y, trunc(d, x1 - x0 - 25), 'fg'); y++; }
    else { g.put(x0 + 2, y++, trunc(k, x1 - x0 - 1), 'ph'); if (y < bot - 1) g.put(x0 + 4, y++, trunc(d, x1 - x0 - 3), 'fg'); }
  }
  if (o.foot && y < bot) g.put(x0 + 2, bot - 1, trunc(o.foot, x1 - x0 - 1), 'dim');
}

// the open ask as card rows: [{ text, style, kind }], for a card `cw` cells wide
function cardLines(q, model, cw, H) {
  const a = model.state.agents.get(q.agentId);
  const name = a ? a.name : q.agentId.toUpperCase();
  const lines = [{ kind: 'top', name }];
  const inner = cw - 4;
  if (q.question) {
    wrap(q.question.text, inner).slice(0, 3).forEach(t => lines.push({ kind: 'body', segs: [[t, 'hi']] }));
    q.question.options.forEach((o, i) => lines.push({ kind: 'body', segs: [[(i + 1) + '  ', 'am b'], [o + (o === q.question.recommended ? '  (suggested)' : ''), 'fg']] }));
  } else {
    lines.push({ kind: 'body', segs: [[q.tool, 'ph b'], ['  ' + q.summary, 'hi']] });
    if (q.view) {
      // the request read as written: a file change as the file (its path, then its text), anything else as key: value lines
      const detail = q.details == null ? ['loading the full request…'] : String(askInspect(q.tool, q.details)).split('\n');
      const room = Math.max(1, Math.min(10, (H || 30) - 22));
      detail.slice(0, room).forEach(t => lines.push({ kind: 'body', segs: [[t, /^File: /.test(t) ? 'hi b' : /^\+/.test(t) ? 'ok' : /^-/.test(t) ? 'bad' : 'fg']] }));
      if (detail.length > room) lines.push({ kind: 'body', segs: [['… ' + (detail.length - room) + ' more line(s)', 'dim']] });
    }
  }
  lines.push({ kind: 'bottom', question: !!q.question, view: q.view, always: canAlways(q), more: model.state.prompts.length - 1 });
  return lines;
}
// Always (allow this kind of action from now on) is offered where the app's card offers it: not on an ask answered fresh
// every time
function canAlways(q) { return !!q && !q.question && ONCE_ONLY_TOOLS.indexOf(q.tool) < 0; }
// the card that asks to trust the folder `starnet` was started in: the project root the station would trust, and what that
// means. Answered with y / n like an ask.
function trustLines(t, cw) {
  const lines = [{ kind: 'top', title: 'TRUST THIS FOLDER?' }];
  lines.push({ kind: 'body', segs: [[String(t.root), 'hi b']] });
  // started in a folder inside a project: the whole project is what gets trusted
  if (t.folder && t.folder !== t.root) lines.push({ kind: 'body', segs: [['you are in ' + t.folder.slice(String(t.root).replace(/[\\/]+$/, '').length + 1) + ' · the whole project is trusted', 'dim']] });
  wrap('the crew can read and change files here · it joins PROJECTS in the app', cw - 4).forEach(s => lines.push({ kind: 'body', segs: [[s, 'fg']] }));
  wrap('not now: each agent works in its own workspace', cw - 4).forEach(s => lines.push({ kind: 'body', segs: [[s, 'dim']] }));
  lines.push({ kind: 'bottom', keys: [['[Y] TRUST', 'am b'], ['[N] NOT NOW', 'am b']] });
  return lines;
}
/* THE AWAKENING in COMMS (bin/lib/awaken.js): who said each line (STARNET before the agent exists, then the agent; YOU
   for your answers), each line typed out at its own pace (e.born + e.cps; e.full once it is all shown), a note under them
   while the station works (the wire test). Newest at the bottom; scrolls by ui.scroll. */
function drawWake(g, w, top, bot, x0, x1, ui, now) {
  const H = bot - top;
  if (H <= 0) return;
  const L = Math.max(8, Math.min(14, Math.max(...w.log.map(e => width(e.who || '')), 0) + 2));
  const tw = Math.max(10, x1 - x0 + 1 - L);
  const rows = [];
  w.log.forEach((e, i) => {
    const prev = w.log[i - 1];
    const newBlock = !prev || prev.who !== e.who || e.first;
    if (i && newBlock) rows.push(null);
    const all = [...String(e.text)];
    const n = e.full ? all.length : Math.min(all.length, Math.floor(Math.max(0, now - e.born) * (e.cps || 44) / 1000));
    const shown = all.slice(0, n).join('') + (n < all.length ? '▍' : '');
    const tc = e.bad ? 'bad' : e.you ? (e.skip ? 'dim' : 'hi') : e.who === 'STARNET' ? 'fg' : 'hi';
    const lc = e.you ? 'hi b' : e.who === 'STARNET' ? 'dim b' : 'ph b';
    wrap(shown || ' ', tw).forEach((ln, j) => rows.push({ label: newBlock && !j ? e.who : '', lc, segs: [[ln, tc]] }));
  });
  if (w.note) rows.push({ label: '', segs: [[spin(now, ui.still) + ' ' + w.note, w.noteStyle || 'dim']] });
  const maxScroll = Math.max(0, rows.length - H);
  ui.scroll = Math.min(Math.max(0, ui.scroll | 0), maxScroll);
  const end = rows.length - ui.scroll;
  rows.slice(Math.max(0, end - H), end).forEach((r, i) => {
    if (!r) return;
    const yy = top + i;
    if (r.label) g.put(x0, yy, trunc(r.label, L - 1), r.lc);
    let x = x0 + L;
    for (const [t, s] of r.segs) { const room = x1 + 1 - x; if (room <= 0) break; x = g.put(x, yy, trunc(t, room), s); }
  });
}
// the awakening's choice as a card: numbered options, the typed answer when one is welcome, a wait while a sign-in lands
function wakeCardLines(ask, cw, now, still) {
  const opts = ask.options || [];
  const lines = [{ kind: 'top', title: ask.waiting ? 'SIGN IN' : opts.length ? 'YOUR CHOICE' : 'YOUR ANSWER' }];
  if (ask.waiting) lines.push({ kind: 'body', segs: [[spin(now, still) + ' ' + ask.waiting, 'am']] });
  opts.forEach((o, i) => lines.push({ kind: 'body', segs: [[(i + 1) + '  ', 'am b'], [String(o.label || ''), o.skip ? 'dim' : 'fg']] }));
  if (ask.custom) lines.push({ kind: 'body', segs: [['›  ', 'am'], ['or type ' + (ask.customLabel || 'your own answer') + ' and press enter' + (ask.optional && !opts.some(o => o.skip) ? ' (enter alone skips)' : ''), 'dim']] });
  const keys = [];
  if (opts.length) keys.push(['[1-' + opts.length + '] PICK', 'am b']);
  if (ask.custom) keys.push(['[ENTER] SEND WHAT YOU TYPED', 'am b']);
  lines.push({ kind: 'bottom', keys });
  return lines;
}
function drawCard(g, lines, y0, x0, cw, blink) {
  const xr = x0 + cw - 1;
  lines.forEach((l, i) => {
    const y = y0 + i;
    if (l.kind === 'top') {
      let x = g.put(x0, y, '┌─ ', 'am');
      x = g.put(x, y, '▲ ', blink ? 'am b' : 'am faint');
      if (l.title) x = g.put(x, y, l.title + ' ', 'hi b');
      else { x = g.put(x, y, String(l.name).toUpperCase(), 'hi b'); x = g.put(x, y, ' ASKS ', 'am b'); }
      while (x < xr) x = g.put(x, y, '─', 'am');
      g.put(xr, y, '┐', 'am');
    } else if (l.kind === 'body') {
      g.put(x0, y, '│', 'am'); g.put(xr, y, '│', 'am');
      let x = x0 + 2;
      for (const [t, s] of l.segs) { const room = xr - 1 - x; if (room <= 0) break; x = g.put(x, y, trunc(t, room), s); }
    } else {
      let x = g.put(x0, y, '└─ ', 'am');
      if (l.keys) l.keys.forEach(([t, s], j) => { if (j) x = g.put(x, y, '   ', 'am'); x = g.put(x, y, t, s); });
      else if (l.question) x = g.put(x, y, 'PICK A NUMBER OR TYPE AN ANSWER', 'am b');
      else {
        x = g.put(x, y, '[Y] ALLOW ONCE', 'am b'); x = g.put(x, y, '   ', 'am');
        if (l.always) { x = g.put(x, y, '[A] ALWAYS', 'am b'); x = g.put(x, y, '   ', 'am'); }
        x = g.put(x, y, '[N] DENY', 'am b'); x = g.put(x, y, '   ', 'am');
        x = g.put(x, y, l.view ? '[V] HIDE' : '[V] VIEW', 'am b');
      }
      x = g.put(x, y, ' ', 'am');
      const tl = l.more > 0 ? ' +' + l.more + ' more ' : '';
      while (x < xr - width(tl)) x = g.put(x, y, '─', 'am');
      if (tl) x = g.put(x, y, tl, 'am b');
      g.put(xr, y, '┘', 'am');
    }
    g.hl(y, x0, xr + 1, 'card');
  });
}

// ---- styles → ANSI ------------------------------------------------------------------------------------------
// level 0: no color (NO_COLOR) — bold/inverse only · level 2: 256 colors · level 3: 24-bit
const PALETTE = {
  fg: ['#d9d2d4', 252], hi: ['#ffffff', 231], dim: ['#7f666b', 95], rule: ['#7a1c28', 88], lbl: ['#ff4757', 203],
  ph: ['#ff3b4e', 203], am: ['#ffb43a', 214], ok: ['#5dffa8', 85], bad: ['#ff6b3d', 202],
  logo: ['#ff2e3e', 196], logohi: ['#ffb0b8', 217], brand: ['#ff2e3e', 196],   // the wordmark's neon red, and the prompt's ▸
  ink: ['#0c0c0c', 16]   // text on a filled label (the tab you are in, the level, the clock, the NEEDS YOU strip)
};
// (256-color: the card sits on a near-black — the nearest palette brown, 58, is a loud olive)
// hifill / amfill: the Pip-Boy's filled labels — white for where you are, amber for what waits on you
const BG = { sel: ['#3a0c14', 52], card: ['#1f1405', 234], inv: ['#ff3b4e', 203], hifill: ['#ffffff', 231], amfill: ['#ffb43a', 214] };
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function sgr(style, level) {
  const parts = String(style || '').split(/\s+/).filter(Boolean);
  const codes = [];
  if (parts.indexOf('b') >= 0) codes.push('1');
  if (parts.indexOf('faint') >= 0) codes.push('2');
  if (level === 0) {
    if (parts.indexOf('inv') >= 0 || parts.indexOf('sel') >= 0 || parts.some(p => /fill$/.test(p))) codes.push('7');
    return codes.length ? '\x1b[' + codes.join(';') + 'm' : '';
  }
  const fgKey = parts.find(p => PALETTE[p]);
  const bgKey = parts.find(p => BG[p]);
  if (parts.indexOf('inv') >= 0) {
    codes.push(level === 3 ? '38;2;6;11;19' : '38;5;16');
    codes.push('1');
  } else if (fgKey) {
    const [hex, c256] = PALETTE[fgKey];
    codes.push(level === 3 ? '38;2;' + hexRgb(hex).join(';') : '38;5;' + c256);
  }
  if (bgKey) {
    const [hex, c256] = BG[bgKey];
    codes.push(level === 3 ? '48;2;' + hexRgb(hex).join(';') : '48;5;' + c256);
  }
  return codes.length ? '\x1b[' + codes.join(';') + 'm' : '';
}
function toAnsi(segs, level) {
  let s = '';
  for (const [t, style] of segs) { const on = sgr(style, level); s += on ? on + t + '\x1b[0m' : t; }
  return s;
}
function toPlain(segs) { return segs.map(s => s[0]).join(''); }
// the segments from cell `col` on (the cells left of it are the logo image's, never written over), up to `end` when given
function sliceSegs(segs, col, end) {
  if (!col && end == null) return segs;
  const out = [];
  let x = 0;
  for (const [t, style] of segs) {
    let piece = '';
    for (const ch of t) { const w = cpWidth(ch.codePointAt(0)); if (x >= col && (end == null || x + w <= end)) piece += ch; x += w; }
    if (piece) out.push([piece, style]);
  }
  return out;
}

// what the terminal can show: NO_COLOR wins, then 24-bit where the terminal says so, else 256
function colorLevel(env, isTTY) {
  const e = env || {};
  if (!isTTY || (e.NO_COLOR != null && e.NO_COLOR !== '') || e.TERM === 'dumb') return 0;
  if (/^(truecolor|24bit)$/i.test(String(e.COLORTERM || '')) || e.WT_SESSION || /^(vscode|iTerm\.app|WezTerm)$/.test(String(e.TERM_PROGRAM || ''))) return 3;
  return 2;
}

module.exports = { render, toAnsi, toPlain, sliceSegs, colorLevel, clean, width, wrap, trunc, makeGrid, HELP, cardLines, trustLines, wakeCardLines, pickerView, stateWords };
