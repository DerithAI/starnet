/* bin/lib/agent-art.js — the agent in COMMS as a small ASCII figure, alive in every state:
     idle      it floats a row up and back, breathes (its core dims and glows), blinks, and now and then turns its eyes to you
     working   it faces a holo panel, its hand tapping, the panel typing line after line and scrolling, its core flickering
     needs you it turns to you, one hand raised and waving, a [!] blinking beside it, eyes amber
     done      both arms up, eyes ^ ^, a spark winking over it
     stopped   slumped, eyes x x, the figure glitching a column aside now and then
   Pure: scene(state, now, still) → H rows of [text, style] segments, W cells wide, the same for the same moment; a still
   screen (STARNET_STILL) holds each state's first frame. Plain ASCII on the station's palette: the body dark red in the dark,
   only the eyes and the chest core lit, a status colour where a state needs one. */
'use strict';

const W = 24, H = 7;
// style keys in the art's second layer: a space is the body (dark red); e eyes, c core, b bright body line
const KEYS = { b: 'dim', k: 'rule', r: 'ph', R: 'brand b', p: 'logohi', h: 'hi', f: 'fg', a: 'am b', A: 'am', g: 'ok b', o: 'bad' };
const EYE = { idle: 'ph b', working: 'ph b', needs: 'am b', done: 'ok b', stopped: 'rule' };

// THE FIGURE, 9 wide × 6 tall: a dome, a dark face with two eyes, long arms, long legs. [text, keys]
const FIG = {
  stand: [['   .-.   ', '   bbb   '], ['  (o o)  ', '  bebeb  '], ['  /)=(\\  ', '    c    '], [' / |#| \\ ', '    c    '], ['   | |   ', '         '], ['  _| |_  ', '         ']],
  blink: [['   .-.   ', '   bbb   '], ['  (- -)  ', '  bebeb  '], ['  /)=(\\  ', '    c    '], [' / |#| \\ ', '    c    '], ['   | |   ', '         '], ['  _| |_  ', '         ']],
  stare: [['   .-.   ', '   bbb   '], ['  (oo )  ', '  bee b  '], ['  /)=(\\  ', '    c    '], [' / |#| \\ ', '    c    '], ['   | |   ', '         '], ['  _| |_  ', '         ']],
  // facing its panel, the near hand on it: two heights, a tap
  tapA: [['   .-.   ', '   bbb   '], ['  ( oo)  ', '  b eeb  '], ['  /)=(\\__', '    c  rr'], [' / |#|   ', '    c    '], ['   | |   ', '         '], ['  _| |_  ', '         ']],
  tapB: [['   .-.   ', '   bbb   '], ['  ( oo)  ', '  b eeb  '], ['  /)=(\\  ', '    c    '], [' / |#|`--', '    c rrr'], ['   | |   ', '         '], ['  _| |_  ', '         ']],
  // one hand up, waving: two angles
  waveA: [['   .-.  |', '   bbb  b'], ['  (o o) |', '  bebeb b'], ['  /)=(_/ ', '    c    '], [' / |#|   ', '    c    '], ['   | |   ', '         '], ['  _| |_  ', '         ']],
  waveB: [['   .-.  /', '   bbb  b'], ['  (o o) /', '  bebeb b'], ['  /)=(_/ ', '    c    '], [' / |#|   ', '    c    '], ['   | |   ', '         '], ['  _| |_  ', '         ']],
  cheer: [['\\  .-.  /', 'b  bbb  b'], [' \\(^ ^)/ ', ' bbebebb '], ['   )=(   ', '    c    '], ['   |#|   ', '    c    '], ['   | |   ', '         '], ['  _| |_  ', '         ']],
  slump: [['         ', '         '], ['   .-.   ', '   kkk   '], ['  (x x)_ ', '  kekek  '], ['  /)=( \\ ', '    c    '], ['  /|#|   ', '    c    '], ['  _/ \\_  ', '         ']]
};

// what the panel types: lines of a terminal at work, shown as strokes (never words: it is the agent's own business)
const LINES = ['> ==== --', '  -= ===', '  == - =', '> -=====', '  === --', '  =- ==', '> == ===', '  -- =-='];
function panel(now, still) {
  // 14 characters a second; each line typed, then the next; three lines show, the newest at the bottom
  const typed = still ? 20 : Math.floor(now / 70) % (LINES.length * 9);
  const line = Math.floor(typed / 9), col = typed % 9;
  const shown = [];
  for (let i = 2; i >= 0; i--) {
    const n = line - i;
    if (n < 0) { shown.push(''); continue; }
    const txt = LINES[n % LINES.length];
    shown.push(i === 0 ? txt.slice(0, col) : txt);
  }
  const cursor = still || Math.floor(now / 400) % 2 === 0;
  const rows = [['.----------.', 'kkkkkkkkkkkk']];
  shown.forEach((t, i) => {
    let s = t.padEnd(8).slice(0, 8), key = s.replace(/[^ ]/g, 'r').replace(/^r/, s[0] === '>' ? 'R' : 'r');
    if (i === 2 && cursor) { const at = Math.min(7, t.length); s = s.slice(0, at) + '_' + s.slice(at + 1); key = key.slice(0, at) + 'h' + key.slice(at + 1); }
    rows.push([': ' + s + ' :', 'kk' + key + 'kk']);
  });
  rows.push(["'----------'", 'kkkkkkkkkkkk']);
  return rows;
}

function blank() { return Array.from({ length: H }, () => ({ ch: new Array(W).fill(' '), st: new Array(W).fill('') })); }
function stamp(buf, x, y, art, eye, core) {
  art.forEach(([txt, key], r) => {
    const row = buf[y + r];
    if (!row) return;
    for (let c = 0; c < txt.length; c++) {
      const ch = txt[c];
      if (ch === ' ' || x + c < 0 || x + c >= W) continue;
      const k = key[c] || ' ';
      row.ch[x + c] = ch;
      row.st[x + c] = k === 'e' ? eye : k === 'c' ? core : k === ' ' ? 'rule' : KEYS[k] || 'rule';
    }
  });
}
function dot(buf, x, y, ch, st) { if (buf[y] && x >= 0 && x < W) { buf[y].ch[x] = ch; buf[y].st[x] = st; } }
function segs(buf) {
  return buf.map(row => {
    const out = [];
    for (let x = 0; x < W; x++) {
      const s = row.st[x], ch = row.ch[x];
      if (out.length && out[out.length - 1][1] === s) out[out.length - 1][0] += ch;
      else out.push([ch, s]);
    }
    return out;
  });
}

function scene(key, now, still) {
  const k = EYE[key] ? key : 'idle';
  const buf = blank();
  const t = still ? 0 : now;
  const eye = EYE[k];
  if (k === 'idle') {
    // dust drifting past, slow
    for (let i = 0; i < 4; i++) {
      const x = 11 + Math.floor((i * 41 + t / (700 + i * 230)) % 13), y = (i * 2 + Math.floor(t / 5000 + i)) % H;
      dot(buf, x, y, (Math.floor(t / 900) + i) % 4 === 0 ? '*' : '.', (Math.floor(t / 900) + i) % 4 === 0 ? 'fg' : 'dim');
    }
    const up = Math.floor(t / 1400) % 2 === 1;                      // a slow float, a row up and back
    const phase = t % 9000;
    const fig = still ? FIG.stand : phase < 160 || (phase > 330 && phase < 470) ? FIG.blink : phase > 5200 && phase < 6600 ? FIG.stare : FIG.stand;
    stamp(buf, 1, up ? 0 : 1, fig, eye, Math.floor(t / 1400) % 2 ? 'ph' : 'rule');   // the core breathes with the float
  } else if (k === 'working') {
    const tap = Math.floor(t / 210) % 3 === 0;
    stamp(buf, 1, 1, tap ? FIG.tapB : FIG.tapA, eye, Math.floor(t / 150) % 2 ? 'ph b' : 'brand b');
    stamp(buf, 11, 1, panel(now, still), eye, 'ph');
  } else if (k === 'needs') {
    const wave = Math.floor(t / 380) % 2 === 1;
    stamp(buf, 1, 1, wave ? FIG.waveB : FIG.waveA, eye, 'am b');
    const on = still || Math.floor(t / 530) % 2 === 0;
    stamp(buf, 12, 1, [['.---.', 'kkkkk'], ['| ! |', on ? 'kkakk' : 'kkAkk'], ["'---'", 'kkkkk']], eye, 'am');
  } else if (k === 'done') {
    stamp(buf, 1, 1, FIG.cheer, eye, 'ok b');
    const tw = Math.floor(t / 600) % 3;
    if (still || tw !== 2) dot(buf, [11, 13, 12][still ? 0 : tw], [1, 2, 0][still ? 0 : tw], tw === 0 || still ? '*' : '+', 'ok');
  } else {
    // stopped: slumped in the dark; every few seconds it glitches a column aside for a blink
    const glitch = !still && t % 3700 < 110;
    stamp(buf, glitch ? 2 : 1, 1, FIG.slump, eye, 'rule');
  }
  return segs(buf);
}

module.exports = { scene, W, H, FIG };
