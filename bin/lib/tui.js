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

function render(model, ui, size, now) {
  const W = Math.max(20, size.cols | 0), H = Math.max(8, size.rows | 0);
  const g = makeGrid(W, H);
  if (W < 46 || H < 18) {
    g.put(0, 0, trunc('starnet needs at least 46×18 — this terminal is ' + W + '×' + H, W), 'am');
    return g.out();
  }
  const narrow = W < 80;
  const blink = ui.still || Math.floor(now / 530) % 2 === 0;
  const pulse = ui.still || Math.floor(now / 850) % 2 === 0;
  const head = model.header(now);

  // header
  let x = g.put(0, 0, ' STARNET ', 'inv');
  if (!narrow) g.put(x + 2, 0, trunc(ui.stationLabel || '', W - 50), 'dim');
  const feedDown = head.feed !== 'live';
  if (narrow) {
    g.putR(W, 0, head.needs ? '▲ ' + head.needs + ' needs you' : feedDown ? feedWord(head.feed) : costText(head.cost), head.needs ? 'am b' : feedDown ? 'am' : 'dim');
  } else {
    const segs = [];
    if (feedDown) segs.push([feedWord(head.feed), 'am'], ['  ·  ', 'dim']);
    segs.push([head.working + ' working', 'fg'], ['  ·  ', 'dim'], [head.needs + ' needs you', head.needs ? 'am b' : 'dim'], ['  ·  ', 'dim'], [costText(head.cost), 'dim']);
    let xx = W - segs.reduce((n, s) => n + width(s[0]), 0);
    for (const [t, s] of segs) xx = g.put(xx, 0, t, s);
  }
  g.put(0, 1, '─'.repeat(W), 'rule');

  // crew
  const rows = model.rows(now);
  const cx = narrow ? { name: 2, st: 15, now: 30 } : { name: 2, model: 16, st: 32, act: 51, now: 68 };
  let y = 2;
  g.put(cx.name, y, 'CREW', 'dim'); g.put(cx.st, y, 'STATUS', 'dim'); g.put(cx.now, y, 'NOW', 'dim');
  if (!narrow) { g.put(cx.model, y, 'MODEL', 'dim'); g.put(cx.act, y, 'ACTIVITY', 'dim'); }
  y++;
  const flows = model.flows(now);
  const flowRows = flows.length ? 1 + Math.min(flows.length, 4) * (narrow ? 2 : 1) + 1 : 0;
  const minPane = 5;
  const maxCrew = Math.max(1, H - 3 - 1 - flowRows - 1 - minPane - 3);
  const shown = rows.slice(0, rows.length > maxCrew ? maxCrew - 1 : maxCrew);
  if (rows.length && !shown.some(r => r.id === ui.focus)) { const f = rows.find(r => r.id === ui.focus); if (f) shown[shown.length - 1] = f; }
  for (const r of shown) {
    const foc = r.id === ui.focus;
    const ac = 'a' + r.color;
    g.put(0, y, foc ? '▸' : ' ', 'ph b');
    g.put(cx.name, y, '◆ ' + trunc(r.name, (narrow ? cx.st : cx.model) - cx.name - 3), ac + ' b');
    if (!narrow) g.put(cx.model, y, trunc(r.model || '—', cx.st - cx.model - 1), 'dim');
    const s = r.status;
    let lamp, lc, txt, tc;
    if (s.key === 'working') { lamp = '●'; lc = pulse ? 'ph b' : 'ph faint'; txt = 'working ' + (narrow ? fmtShort(now - s.since) : fmtDur(now - s.since)) + (s.count > 1 ? ' ×' + s.count : ''); tc = 'fg'; }
    else if (s.key === 'needs') { lamp = '▲'; lc = blink ? 'am b' : 'am faint'; txt = 'needs you'; tc = 'am b'; }
    else if (s.key === 'done') { lamp = '✓'; lc = 'ok b'; txt = 'done'; tc = 'ok'; }
    else if (s.key === 'stopped') { lamp = '■'; lc = 'bad'; txt = s.text; tc = 'bad'; }
    else { lamp = '○'; lc = 'dim'; txt = 'idle'; tc = 'dim'; }
    g.put(cx.st, y, lamp, lc);
    g.put(cx.st + 2, y, trunc(txt, (narrow ? cx.now : cx.act) - cx.st - 3), tc);
    if (!narrow) g.put(cx.act, y, spark(r.act), s.key === 'idle' ? 'dim' : ac);
    g.put(cx.now, y, trunc(r.now || '—', W - cx.now - 1), s.key === 'needs' ? 'am' : s.key === 'working' ? 'hi' : 'dim');
    if (foc) g.hl(y, 0, W, 'sel');
    y++;
  }
  if (rows.length > shown.length) { g.put(cx.name, y, '+' + (rows.length - shown.length) + ' more · tab to reach them', 'dim'); y++; }
  if (!rows.length) { g.put(cx.name, y, 'no agents on the roster yet', 'dim'); y++; }

  // flows
  if (flows.length) {
    y++;
    g.put(2, y, 'FLOWS', 'dim'); y++;
    for (const f of flows.slice(0, 4)) {
      const run = f.state === 'running';
      g.put(2, y, trunc(f.name, narrow ? W - 4 : 22), run ? 'hi b' : 'fg');
      const cy = narrow ? y + 1 : y;
      let xx = narrow ? 4 : 26;
      const lamp = run ? '●' : f.state === 'done' ? '✓' : f.state === 'failed' || f.state === 'interrupted' ? '✗' : '○';
      const lc = run ? (pulse ? 'ph b' : 'ph faint') : f.state === 'done' ? 'ok b' : lamp === '✗' ? 'bad' : 'dim';
      xx = g.put(xx, cy, lamp + ' ', lc);
      const chain = run && f.agents.length ? f.agents.join(' ── ') : (f.job ? f.job.steps + ' step' + (f.job.steps === 1 ? '' : 's') + ' last time' : '');
      xx = g.put(xx, cy, trunc(chain, Math.max(0, W - xx - 30)), run ? 'hi' : 'dim');
      const right = f.text + (f.shipped ? ' · ' + f.shipped + ' shipped' : '');
      g.putR(W - 1, y, trunc(right, narrow ? W - 6 - Math.min(width(f.name), W - 8) : W - xx - 3), run ? 'fg' : f.state === 'done' ? 'ok' : 'dim');
      y += narrow ? 2 : 1;
    }
  }

  // COMMS
  y++;
  const focusRow = rows.find(r => r.id === ui.focus) || rows[0];
  x = g.put(0, y, '── ', 'rule');
  x = g.put(x, y, 'COMMS · ', 'dim');
  x = g.put(x, y, focusRow ? focusRow.name : '—', focusRow ? 'a' + focusRow.color + ' b' : 'dim');
  x = g.put(x, y, ' ', '');
  const idx = focusRow ? ' ' + (rows.indexOf(focusRow) + 1) + '/' + rows.length + ' ' : '';
  const scrolled = ui.scroll > 0 ? ' ↑ ' + ui.scroll + ' ' : '';
  while (x < W - width(idx) - width(scrolled) - 2) x = g.put(x, y, '─', 'rule');
  if (scrolled) x = g.put(x, y, scrolled, 'am');
  x = g.put(x, y, idx, 'dim');
  while (x < W) x = g.put(x, y, '─', 'rule');
  y++;
  const ruleY = H - 3, promptY = H - 2, hintY = H - 1;
  const front = model.front();
  const card = front ? cardLines(front, model, W, H) : [];
  const paneBot = card.length ? ruleY - card.length - 1 : ruleY;
  if (ui.overlay) drawOverlay(g, ui.overlay, y, paneBot, W);
  else drawPane(g, focusRow ? model.logOf(focusRow.id) : [], focusRow, y, paneBot, W, ui, now);
  if (card.length) drawCard(g, card, ruleY - card.length, W, blink);
  g.put(0, ruleY, '─'.repeat(W), 'rule');

  // prompt
  const flashKey = ui.keyFlash && ui.keyFlash.until > now;
  let px = g.put(0, promptY, '> ', 'ph b');
  const room = W - 4 - (flashKey ? 8 : 0);
  const inp = width(ui.input) > room ? '…' + tail(ui.input, room - 1) : ui.input;
  px = g.put(px, promptY, inp, 'hi');
  g.put(px, promptY, blink ? '█' : ' ', 'ph');
  if (flashKey) g.putR(W, promptY, '[' + ui.keyFlash.k + ']', 'am b');

  // hints / flash
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
    else if (e.k === 'start') { label = e.source === 'desktop' ? 'YOU·APP' : e.source.toUpperCase().slice(0, 7); lc = 'dim b'; tc = 'fg'; if (!text) text = '(' + e.source + ' run)'; }
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
  fg: ['#b3c5dc', 252], hi: ['#eaf2ff', 255], dim: ['#5f7390', 244], rule: ['#1f3049', 238],
  ph: ['#6aaeff', 75], am: ['#ffab4a', 215], ok: ['#7bc88a', 114], bad: ['#ff6a5c', 203],
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
