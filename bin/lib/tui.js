/* bin/lib/tui.js — the PURE screen of the `starnet` dashboard: model + ui state + terminal size → rows of styled
   segments, and those rows → ANSI strings. No I/O and no clock (`now` is passed in), so test/cli-dashboard.test.js
   renders it to plain text and checks the layout.

   Layout (wide ≥ 80 columns; narrow drops MODEL and ACTIVITY):
     header · rule · CREW table (one row per agent: lamp, status, activity bars, what it is doing NOW) · FLOWS (only
     when the station has lines) · COMMS for the focused agent · the open ask's card · rule · prompt · key hints.

   Every glyph sits in one cell (wide characters take two), and anything an agent or a tool wrote is stripped of
   control characters and escape sequences before it reaches a cell: model output can never drive the terminal. */
'use strict';

const { fmtDur, fmtShort, costText } = require('./station-model.js');
// the StarNet mark, cut from the real brand art by dev/cli-logo.cjs (never redrawn)
const logo = require('./logo.js');

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
  return out + '…';
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
  ['@name message', 'talk to an agent (it queues if busy)'],
  ['message', 'talk to the agent shown in COMMS'],
  ['y  n  v', 'answer the open ask: yes, no, view'],
  ['1-6 or text', 'answer an open question'],
  ['tab  ↑  ↓', 'switch the agent shown in COMMS'],
  ['pgup  pgdn', 'scroll COMMS'],
  ['/stop', 'stop the shown agent\'s runs'],
  ['/flow', 'list workflows'],
  ['/flow run name text', 'send one job down a workflow'],
  ['/help', 'this list'],
  ['ctrl+c', 'quit']
];

// a panel's contents draw in their own coordinates (0..iw), clipped inside the frame that holds them
function inset(g, ox, iw) {
  const clip = (x, s) => trunc(s, Math.max(0, iw - x));
  return {
    put: (x, y, s, style) => { if (x >= iw) return x; return g.put(ox + x, y, clip(x, clean(s).replace(/\n/g, ' ')), style) - ox; },
    putR: (xr, y, s, style) => { const t = clean(s).replace(/\n/g, ' '); const x = Math.max(0, Math.min(xr, iw) - width(t)); return g.put(ox + x, y, clip(x, t), style) - ox; },
    hl: (y, x0, x1, extra) => g.hl(y, ox + Math.max(0, x0), ox + Math.min(iw, x1), extra),
    cols: iw
  };
}
// ┌─[ TITLE ]────────────[ right ]─┐ … └────┘ — a station panel; titles and the right note are styled segments
function frame(g, y0, y1, W, title, right) {
  let x = g.put(0, y0, '┌─', 'rule');
  if (title && title.length) { x = g.put(x, y0, '[ ', 'rule'); for (const [t, s] of title) x = g.put(x, y0, t, s); x = g.put(x, y0, ' ]', 'rule'); }
  const rw = right && right.length ? right.reduce((n, s) => n + width(s[0]), 0) + 4 : 0;
  while (x < W - 2 - rw) x = g.put(x, y0, '─', 'rule');
  if (rw) { x = g.put(x, y0, '[ ', 'rule'); for (const [t, s] of right) x = g.put(x, y0, t, s); x = g.put(x, y0, ' ]', 'rule'); }
  while (x < W - 1) x = g.put(x, y0, '─', 'rule');
  g.put(W - 1, y0, '┐', 'rule');
  for (let y = y0 + 1; y < y1; y++) { g.put(0, y, '│', 'rule'); g.put(W - 1, y, '│', 'rule'); }
  g.put(0, y1, '└' + '─'.repeat(Math.max(0, W - 2)) + '┘', 'rule');
}

function render(model, ui, size, now) {
  const W = Math.max(20, size.cols | 0), H = Math.max(8, size.rows | 0);
  const g = makeGrid(W, H);
  if (W < 46 || H < 18) {
    g.put(0, 0, trunc('starnet needs at least 46×18 — this terminal is ' + W + '×' + H, W), 'am');
    return g.out();
  }
  const blink = ui.still || Math.floor(now / 530) % 2 === 0;
  const pulse = ui.still || Math.floor(now / 850) % 2 === 0;
  const head = model.header(now);
  const rows = model.rows(now);
  const flows = model.flows(now);
  const front = model.front();
  const IW = W - 4;                       // inside a frame: │ + space each side
  const narrow = IW < 76;

  // ---- the vertical budget: the logo only when the crew, flows and a readable COMMS still fit beneath it --------------
  const flowsN = Math.min(flows.length, 4);
  const flowsH = flowsN ? 2 + flowsN * (narrow ? 2 : 1) : 0;
  const crewNeed = 3 + Math.max(1, rows.length);
  const fixedBottom = 2;                  // prompt + key hints
  const commsMin = 2 + 6;
  const art = ui.logo !== 'plain' && logo && logo.word && logo.word.braille && logo.word.braille[5];
  const bigLogo = !!art && W >= 90 && H - (7 + crewNeed + flowsH + commsMin + fixedBottom) >= 0;
  const headerH = bigLogo ? 7 : 1;

  // ---- header: the StarNet mark, cut from the real brand art; the star glows only while the crew works ------------------
  const summary = [];
  if (head.feed !== 'live') summary.push([feedWord(head.feed), 'am'], ['  ·  ', 'dim']);
  summary.push([head.working + ' working', head.working ? 'ph b' : 'dim'], ['  ·  ', 'dim'], [head.needs + ' needs you', head.needs ? 'am b' : 'dim'], ['  ·  ', 'dim'], [costText(head.cost), 'dim']);
  const summaryW = summary.reduce((n, s) => n + width(s[0]), 0);
  let summaryInHeader = false;
  if (bigLogo) {
    const starStyle = head.working ? (pulse ? 'brandhi b' : 'brand b') : 'brand';
    logo.star.braille[6].forEach((l, i) => g.put(1, i, l, starStyle));
    const wx = 16;
    logo.word.braille[5].forEach((l, i) => g.put(wx, i + 1, l, 'brand'));
    const wordW = Math.max(...logo.word.braille[5].map(l => width(l)));
    const roomRight = W - (wx + wordW + 3);
    if (roomRight >= 30) {
      summaryInHeader = true;
      g.putR(W - 1, 1, trunc(ui.stationLabel || '', roomRight), 'dim');
      g.putR(W - 1, 2, (head.working ? '● ' : '○ ') + head.working + ' working', head.working ? 'ph b' : 'dim');
      g.putR(W - 1, 3, (head.needs ? '▲ ' : '  ') + head.needs + ' needs you', head.needs ? 'am b' : 'dim');
      g.putR(W - 1, 4, costText(head.cost), 'dim');
      if (head.feed !== 'live') g.putR(W - 1, 5, feedWord(head.feed), 'am');
    }
  } else {
    let x = g.put(0, 0, '✦ ', head.working ? (pulse ? 'brandhi b' : 'brand b') : 'brand');
    x = g.put(x, 0, 'S T A R N E T', 'brand b');
    if (W - x - summaryW > 26) g.put(x + 3, 0, trunc(ui.stationLabel || '', W - x - summaryW - 6), 'dim');
    if (narrow) g.putR(W, 0, head.needs ? '▲ ' + head.needs + ' needs you' : head.feed !== 'live' ? feedWord(head.feed) : costText(head.cost), head.needs ? 'am b' : head.feed !== 'live' ? 'am' : 'dim');
    else { let xx = W - summaryW; for (const [t, s] of summary) xx = g.put(xx, 0, t, s); }
    summaryInHeader = true;
  }

  // ---- CREW --------------------------------------------------------------------------------------------------------
  let y = headerH;
  const maxCrew = Math.max(1, H - headerH - flowsH - commsMin - fixedBottom - 3);
  const shown = rows.slice(0, rows.length > maxCrew ? maxCrew - 1 : maxCrew);
  if (rows.length && !shown.some(r => r.id === ui.focus)) { const f = rows.find(r => r.id === ui.focus); if (f) shown[shown.length - 1] = f; }
  const crewBot = y + 2 + shown.length + (rows.length > shown.length ? 1 : 0) + (rows.length ? 0 : 1);
  frame(g, y, crewBot, W, [['CREW', 'brand b'], [' · ' + rows.length, 'dim']], summaryInHeader ? null : summary);
  const c = inset(g, 2, IW);
  const cx = narrow ? { name: 2, st: 15, now: 30 } : { name: 2, model: 16, st: 32, act: 51, now: 68 };
  y++;
  c.put(cx.name + 2, y, 'AGENT', 'dim'); c.put(cx.st, y, 'STATUS', 'dim'); c.put(cx.now, y, 'NOW', 'dim');
  if (!narrow) { c.put(cx.model, y, 'MODEL', 'dim'); c.put(cx.act, y, 'ACTIVITY', 'dim'); }
  y++;
  for (const r of shown) {
    const foc = r.id === ui.focus;
    const ac = 'a' + r.color;
    c.put(0, y, foc ? '▸' : ' ', 'ph b');
    c.put(cx.name, y, '◆ ' + trunc(r.name, (narrow ? cx.st : cx.model) - cx.name - 3), ac + ' b');
    if (!narrow) c.put(cx.model, y, trunc(r.model || '—', cx.st - cx.model - 1), 'dim');
    const s = r.status;
    let lamp, lc, txt, tc;
    if (s.key === 'working') { lamp = '●'; lc = pulse ? 'ph b' : 'ph faint'; txt = 'working ' + (narrow ? fmtShort(now - s.since) : fmtDur(now - s.since)) + (s.count > 1 ? ' ×' + s.count : ''); tc = 'fg'; }
    else if (s.key === 'needs') { lamp = '▲'; lc = blink ? 'am b' : 'am faint'; txt = 'needs you'; tc = 'am b'; }
    else if (s.key === 'done') { lamp = '✓'; lc = 'ok b'; txt = 'done'; tc = 'ok'; }
    else if (s.key === 'stopped') { lamp = '■'; lc = 'bad'; txt = s.text; tc = 'bad'; }
    else { lamp = '○'; lc = 'dim'; txt = 'idle'; tc = 'dim'; }
    c.put(cx.st, y, lamp, lc);
    c.put(cx.st + 2, y, trunc(txt, (narrow ? cx.now : cx.act) - cx.st - 3), tc);
    if (!narrow) c.put(cx.act, y, spark(r.act), s.key === 'idle' ? 'dim' : ac);
    c.put(cx.now, y, trunc(r.now || '—', IW - cx.now), s.key === 'needs' ? 'am' : s.key === 'working' ? 'hi' : 'dim');
    if (foc) c.hl(y, 0, IW, 'sel');
    y++;
  }
  if (rows.length > shown.length) { c.put(cx.name, y, '+' + (rows.length - shown.length) + ' more · tab reaches them', 'dim'); y++; }
  if (!rows.length) { c.put(cx.name, y, 'no agents on the roster yet', 'dim'); y++; }
  y = crewBot + 1;

  // ---- FLOWS ---------------------------------------------------------------------------------------------------------
  if (flowsN) {
    const fBot = y + flowsH - 1;
    frame(g, y, fBot, W, [['FLOWS', 'brand b'], [' · ' + flows.length, 'dim']], null);
    const f2 = inset(g, 2, IW);
    y++;
    for (const f of flows.slice(0, flowsN)) {
      const run = f.state === 'running';
      const lamp = run ? '●' : f.state === 'done' ? '✓' : f.state === 'failed' || f.state === 'interrupted' ? '✗' : '○';
      const lc = run ? (pulse ? 'ph b' : 'ph faint') : f.state === 'done' ? 'ok b' : lamp === '✗' ? 'bad' : 'dim';
      f2.put(1, y, lamp, lc);
      f2.put(3, y, trunc(f.name, narrow ? IW - 4 : 24), run ? 'hi b' : 'fg');
      const cy = narrow ? y + 1 : y;
      const cx2 = narrow ? 5 : 29;
      const chain = run && f.agents.length ? f.agents.join(' ── ') : (f.job ? f.job.steps + ' step' + (f.job.steps === 1 ? '' : 's') + ' last time' : '');
      const right = f.text + (f.shipped ? ' · ' + f.shipped + ' shipped' : '');
      f2.put(cx2, cy, trunc(chain, Math.max(0, IW - cx2 - (narrow ? 0 : width(right) + 3))), run ? 'hi' : 'dim');
      f2.putR(IW, y, trunc(right, narrow ? IW - 6 - Math.min(width(f.name), IW - 8) : 40), run ? 'fg' : f.state === 'done' ? 'ok' : 'dim');
      y += narrow ? 2 : 1;
    }
    y = fBot + 1;
  }

  // ---- COMMS ---------------------------------------------------------------------------------------------------------
  const focusRow = rows.find(r => r.id === ui.focus) || rows[0];
  const cBot = H - fixedBottom - 1;
  const idx = focusRow ? (rows.indexOf(focusRow) + 1) + '/' + rows.length : '';
  const right = [];
  if (ui.scroll > 0) right.push(['↑ ' + ui.scroll, 'am'], ['  ', 'dim']);
  if (idx) right.push([idx, 'dim']);
  frame(g, y, cBot, W, [['COMMS', 'brand b'], [' · ', 'dim'], [focusRow ? focusRow.name : '—', focusRow ? 'a' + focusRow.color + ' b' : 'dim']], right);
  const p = inset(g, 2, IW);
  const card = front ? cardLines(front, model, IW, H) : [];
  const paneTop = y + 1, paneEnd = card.length ? cBot - card.length - 1 : cBot;
  if (ui.overlay) drawOverlay(p, ui.overlay, paneTop, paneEnd, IW);
  else drawPane(p, focusRow ? model.logOf(focusRow.id) : [], focusRow, paneTop, paneEnd, IW, ui, now);
  if (card.length) drawCard(p, card, cBot - card.length, IW, blink);

  // ---- prompt + keys ------------------------------------------------------------------------------------------------
  const promptY = H - 2, hintY = H - 1;
  const flashKey = ui.keyFlash && ui.keyFlash.until > now;
  let px = g.put(0, promptY, (focusRow ? focusRow.name.toLowerCase() : 'starnet') + ' ', 'dim');
  px = g.put(px, promptY, '▸ ', 'brand b');
  const room = W - px - 2 - (flashKey ? 8 : 0);
  const inp = width(ui.input) > room ? '…' + tail(ui.input, room - 1) : ui.input;
  px = g.put(px, promptY, inp, 'hi');
  g.put(px, promptY, blink ? '█' : ' ', 'ph');
  if (flashKey) g.putR(W, promptY, '[' + ui.keyFlash.k + ']', 'am b');
  if (ui.flash && ui.flash.until > now) g.put(0, hintY, trunc(ui.flash.text, W), ui.flash.style || 'am');
  else if (ui.quitArmed && ui.quitArmed > now) g.put(0, hintY, trunc('ctrl+c again to quit — ' + ui.quitNote, W), 'am b');
  else {
    const t = front
      ? (front.question ? (front.question.options.length ? '1-' + front.question.options.length + ' pick · ' : '') + 'type an answer + enter · esc clears' : 'y allow once · n deny · v ' + (front.view ? 'hide' : 'view') + ' · ' + (narrow ? 'tab agent' : 'tab next agent'))
      : narrow ? 'tab agent · @name talk · /help · ctrl+c quit' : 'tab next agent  ·  @name talk  ·  /flow  ·  /stop  ·  /help  ·  ctrl+c quit';
    g.put(0, hintY, trunc(t, W), 'dim');
  }
  return g.out();
}

function feedWord(f) { return f === 'connecting' ? 'connecting…' : f === 'down' ? 'feed lost · retrying' : f === 'old' ? 'live feed unavailable · polling' : String(f || ''); }
function spark(act) { const mx = Math.max(4, ...act); return act.map(v => BARS[Math.min(7, Math.round(v / mx * 7))]).join(''); }
function tail(s, n) { const a = [...String(s)]; let out = '', w = 0; for (let i = a.length - 1; i >= 0; i--) { const cw = cpWidth(a[i].codePointAt(0)); if (w + cw > n) break; out = a[i] + out; w += cw; } return out; }

function paneRows(log, focusRow, W, now) {
  const L = 8, tw = W - L - 1, out = [];
  const name = focusRow ? focusRow.name : '';
  const ac = focusRow ? 'a' + focusRow.color + ' b' : 'fg';
  log.forEach((e, i) => {
    if ((e.k === 'you' || e.k === 'start') && i > 0) out.push(null);
    if (e.k === 'tool') {
      const segs = [['↳ ', 'dim'], [e.name, 'ph'], ['  ' + e.args, 'fg']];
      if (e.running) segs.push(['  ' + ['·  ', '·· ', '···'][Math.floor(now / 320) % 3], 'dim']);
      else if (e.res) segs.push(['  · ' + e.res, e.ok === false ? 'bad' : 'dim']);
      out.push({ label: '', segs });
      return;
    }
    let label = '', lc = '', tc = 'fg', text = e.text;
    if (e.k === 'you') { label = 'YOU'; lc = 'hi b'; tc = e.queued ? 'dim' : 'hi'; }
    else if (e.k === 'start') { label = e.source === 'desktop' ? 'YOU·APP' : e.source.toUpperCase().slice(0, 7); lc = 'dim b'; tc = 'fg'; if (!text) text = e.adopted ? '(a ' + e.source + ' run, already under way when this terminal attached)' : '(' + e.source + ' run)'; }
    else if (e.k === 'agent') { label = name; lc = ac; if (e.live) text += '▍'; }
    else if (e.k === 'ok') tc = 'ok';
    else if (e.k === 'bad') tc = 'bad';
    else if (e.k === 'ask') tc = 'am';
    else tc = 'dim';
    wrap(text, tw).forEach((ln, j) => out.push({ label: j ? '' : label, lc, segs: [[ln, tc]] }));
  });
  return out;
}
function drawPane(g, log, focusRow, top, bot, W, ui, now) {
  const H = bot - top;
  if (H <= 0) return;
  const all = paneRows(log, focusRow, W, now);
  if (!all.length) { g.put(8, top, focusRow ? 'nothing yet · type a message for ' + focusRow.name + ' and press enter' : '', 'dim'); return; }
  const maxScroll = Math.max(0, all.length - H);
  ui.scroll = Math.min(Math.max(0, ui.scroll | 0), maxScroll);
  const end = all.length - ui.scroll;
  all.slice(Math.max(0, end - H), end).forEach((r, i) => {
    if (!r) return;
    const yy = top + i;
    if (r.label) g.put(0, yy, trunc(r.label, 7), r.lc);
    let x = 8;
    for (const [t, s] of r.segs) { const room = W - 1 - x; if (room <= 0) break; x = g.put(x, yy, trunc(t, room), s); }
  });
}
function drawOverlay(g, o, top, bot, W) {
  let y = top;
  g.put(2, y++, o.title, 'hi b');
  const wide = W >= 70;
  for (const [k, d] of o.items) {
    if (y >= bot - 1) break;
    if (wide) { g.put(4, y, trunc(k, 22), 'ph'); g.put(28, y, trunc(d, W - 29), 'fg'); y++; }
    else { g.put(4, y++, trunc(k, W - 5), 'ph'); if (y < bot - 1) g.put(6, y++, trunc(d, W - 7), 'fg'); }
  }
  if (o.foot && y < bot) g.put(4, bot - 1, trunc(o.foot, W - 5), 'dim');
}

// the open ask as card rows: [{ text, style, kind }]
function cardLines(q, model, W, H) {
  const a = model.state.agents.get(q.agentId);
  const name = a ? a.name : q.agentId.toUpperCase();
  const lines = [{ kind: 'top', name, color: a ? a.color : 0 }];
  const inner = Math.min(W - 4, 96) - 4;
  if (q.question) {
    wrap(q.question.text, inner).slice(0, 3).forEach(t => lines.push({ kind: 'body', segs: [[t, 'hi']] }));
    q.question.options.forEach((o, i) => lines.push({ kind: 'body', segs: [[(i + 1) + '  ', 'am b'], [o + (o === q.question.recommended ? '  (suggested)' : ''), 'fg']] }));
  } else {
    lines.push({ kind: 'body', segs: [[q.tool, 'ph b'], ['  ' + q.summary, 'hi']] });
    if (q.view) {
      const detail = q.details == null ? ['loading the full request…'] : String(q.details).split('\n');
      const room = Math.max(1, Math.min(10, (H || 30) - 22));
      detail.slice(0, room).forEach(t => lines.push({ kind: 'body', segs: [[t, /^\+/.test(t) ? 'ok' : /^-/.test(t) ? 'bad' : 'dim']] }));
      if (detail.length > room) lines.push({ kind: 'body', segs: [['… ' + (detail.length - room) + ' more line(s)', 'dim']] });
    }
  }
  lines.push({ kind: 'bottom', question: !!q.question, view: q.view, more: model.state.prompts.length - 1 });
  return lines;
}
function drawCard(g, lines, y0, W, blink) {
  const x0 = 2, cw = Math.min(W - 4, 96), xr = x0 + cw - 1;
  lines.forEach((l, i) => {
    const y = y0 + i;
    if (l.kind === 'top') {
      let x = g.put(x0, y, '┌─ ', 'am');
      x = g.put(x, y, '▲ ', blink ? 'am b' : 'am faint');
      x = g.put(x, y, l.name, 'a' + l.color + ' b');
      x = g.put(x, y, ' asks ', 'am');
      while (x < xr) x = g.put(x, y, '─', 'am');
      g.put(xr, y, '┐', 'am');
    } else if (l.kind === 'body') {
      g.put(x0, y, '│', 'am'); g.put(xr, y, '│', 'am');
      let x = x0 + 2;
      for (const [t, s] of l.segs) { const room = xr - 1 - x; if (room <= 0) break; x = g.put(x, y, trunc(t, room), s); }
    } else {
      let x = g.put(x0, y, '└─ ', 'am');
      if (l.question) x = g.put(x, y, 'pick a number or type an answer', 'am b');
      else {
        x = g.put(x, y, '[y] allow once', 'am b'); x = g.put(x, y, '   ', 'am');
        x = g.put(x, y, '[n] deny', 'fg'); x = g.put(x, y, '   ', 'am');
        x = g.put(x, y, l.view ? '[v] hide' : '[v] view', 'fg');
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
  fg: ['#b3c5dc', 252], hi: ['#eaf2ff', 255], dim: ['#5f7390', 244], rule: ['#2b405f', 239],
  ph: ['#6aaeff', 75], am: ['#ffab4a', 215], ok: ['#7bc88a', 114], bad: ['#ff6a5c', 203],
  brand: ['#ff9d2f', 208], brandhi: ['#ffd08a', 222],   // the StarNet mark's own orange phosphor (website favicon #ff9d2f)
  a0: ['#6aaeff', 75], a1: ['#5ce8c8', 86], a2: ['#c2a3ff', 183], a3: ['#ff8fc7', 211], a4: ['#b8e07a', 150], a5: ['#8fd6ff', 117]
};
const BG = { sel: ['#0f1d31', 235], card: ['#0b1424', 234], inv: ['#6aaeff', 75] };
function hexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
function sgr(style, level) {
  const parts = String(style || '').split(/\s+/).filter(Boolean);
  const codes = [];
  if (parts.indexOf('b') >= 0) codes.push('1');
  if (parts.indexOf('faint') >= 0) codes.push('2');
  if (level === 0) {
    if (parts.indexOf('inv') >= 0 || parts.indexOf('sel') >= 0) codes.push('7');
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

// what the terminal can show: NO_COLOR wins, then 24-bit where the terminal says so, else 256
function colorLevel(env, isTTY) {
  const e = env || {};
  if (!isTTY || (e.NO_COLOR != null && e.NO_COLOR !== '') || e.TERM === 'dumb') return 0;
  if (/^(truecolor|24bit)$/i.test(String(e.COLORTERM || '')) || e.WT_SESSION || /^(vscode|iTerm\.app|WezTerm)$/.test(String(e.TERM_PROGRAM || ''))) return 3;
  return 2;
}

module.exports = { render, toAnsi, toPlain, colorLevel, clean, width, wrap, trunc, makeGrid, HELP, cardLines };
