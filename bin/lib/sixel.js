/* bin/lib/sixel.js — the REAL StarNet wordmark as a terminal image (Sixel), sized to the terminal's own cells.

   The master (bin/lib/logo-image.js) is the brand wordmark's light, one channel. logoSixel() scales it to fit `rows`
   text rows of `cellH` pixels (and no wider than `maxCols` cells), colors it on a red ramp (the glow fades to deep red,
   the brightest core runs hot), leaves every unlit pixel transparent, and encodes it as a DCS Sixel string. Pure: no
   I/O, no dependencies beyond node:zlib, so test/cli-dashboard.test.js decodes the output and checks it against the
   master. Terminals that draw Sixel: Windows Terminal ≥ 1.22, WezTerm, iTerm2, foot, mlterm, VS Code (with images on). */
'use strict';

const zlib = require('node:zlib');

let MASTER = null;
function master() {
  if (!MASTER) {
    const m = require('./logo-image.js');
    MASTER = { w: m.width, h: m.height, px: zlib.inflateSync(Buffer.from(m.light, 'base64')) };
  }
  return MASTER;
}

// area-average resample of the light channel to w×h
function resample(src, w, h) {
  const out = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    const sy0 = y * src.h / h, sy1 = (y + 1) * src.h / h;
    for (let x = 0; x < w; x++) {
      const sx0 = x * src.w / w, sx1 = (x + 1) * src.w / w;
      let s = 0, n = 0;
      for (let yy = Math.floor(sy0); yy < Math.min(src.h, Math.ceil(sy1)); yy++) {
        const wy = Math.min(yy + 1, sy1) - Math.max(yy, sy0);
        for (let xx = Math.floor(sx0); xx < Math.min(src.w, Math.ceil(sx1)); xx++) {
          const wx = Math.min(xx + 1, sx1) - Math.max(xx, sx0);
          s += src.px[yy * src.w + xx] * wx * wy; n += wx * wy;
        }
      }
      out[y * w + x] = n ? s / n / 255 : 0;
    }
  }
  return out;
}

// the red ramp, dim glow → the brand red → a hot core (sRGB 0-255)
const RAMP = [[70, 4, 14], [118, 8, 22], [170, 14, 32], [215, 24, 44], [255, 46, 62], [255, 104, 116], [255, 176, 184]];
const FLOOR = 0.07;   // below this a pixel is background (transparent)

/* logoSixel({ cellW, cellH, rows, maxCols }) → { sixel, cols, rows, width, height } or null when it cannot fit */
function logoSixel(opts) {
  const o = opts || {};
  const cellW = Math.max(4, o.cellW | 0), cellH = Math.max(8, o.cellH | 0);
  const src = master();
  let rows = Math.max(1, o.rows | 0);
  let height, width, cols;
  for (;;) {
    height = rows * cellH - 2;                               // a hair under the rows, so it never touches the next one
    width = Math.round(height * src.w / src.h);
    cols = Math.ceil(width / cellW);
    if (!o.maxCols || cols <= o.maxCols || rows === 1) break;
    rows--;
  }
  if (o.maxCols && cols > o.maxCols) return null;
  const light = resample(src, width, height);
  const idx = new Int8Array(width * height).fill(-1);
  for (let i = 0; i < light.length; i++) {
    const v = light[i];
    if (v < FLOOR) continue;
    idx[i] = Math.min(RAMP.length - 1, Math.floor((v - FLOOR) / (1 - FLOOR) * RAMP.length));
  }
  // DCS P1=0 (aspect 2:1 default, overridden by raster attributes), P2=1 (unset pixels stay transparent), q
  let s = '\x1bP0;1;0q"1;1;' + width + ';' + height;
  RAMP.forEach(([r, g, b], i) => { s += '#' + i + ';2;' + Math.round(r * 100 / 255) + ';' + Math.round(g * 100 / 255) + ';' + Math.round(b * 100 / 255); });
  for (let band = 0; band < height; band += 6) {
    let first = true;
    for (let c = 0; c < RAMP.length; c++) {
      // the sixel column codes for this color in this band, run-length encoded
      let line = '', used = false, run = 0, prev = -1;
      const flush = () => { if (run === 0) return; const ch = String.fromCharCode(63 + prev); line += run > 3 ? '!' + run + ch : ch.repeat(run); run = 0; };
      for (let x = 0; x < width; x++) {
        let bits = 0;
        for (let k = 0; k < 6; k++) { const y = band + k; if (y < height && idx[y * width + x] === c) bits |= 1 << k; }
        if (bits) used = true;
        if (bits === prev) run++; else { flush(); prev = bits; run = 1; }
      }
      if (!used) continue;
      if (prev !== 0) flush();   // a trailing run of empty columns is dropped
      s += (first ? '' : '$') + '#' + c + line;
      first = false;
    }
    s += '-';
  }
  s += '\x1b\\';
  return { sixel: s, cols, rows, width, height };
}

/* decodeSixel(str) → { width, height, px: Int8Array of color indexes (-1 = transparent) } — for the tests */
function decodeSixel(str) {
  const m = /"1;1;(\d+);(\d+)/.exec(str);
  const width = Number(m[1]), height = Number(m[2]);
  const px = new Int8Array(width * height).fill(-1);
  const body = str.slice(str.indexOf(m[0]) + m[0].length, str.lastIndexOf('\x1b\\'));
  let x = 0, band = 0, color = 0, i = 0;
  while (i < body.length) {
    const c = body[i];
    if (c === '#') {
      const mm = /^#(\d+)(;2;\d+;\d+;\d+)?/.exec(body.slice(i));
      if (!mm[2]) color = Number(mm[1]);
      i += mm[0].length; continue;
    }
    if (c === '$') { x = 0; i++; continue; }
    if (c === '-') { x = 0; band += 6; i++; continue; }
    let rep = 1;
    if (c === '!') { const mm = /^!(\d+)/.exec(body.slice(i)); rep = Number(mm[1]); i += mm[0].length; }
    const bits = body.charCodeAt(i) - 63;
    for (let r = 0; r < rep; r++, x++) for (let k = 0; k < 6; k++) if (bits & (1 << k)) { const y = band + k; if (y < height && x < width) px[y * width + x] = color; }
    i++;
  }
  return { width, height, px };
}

/* brailleLogo(rows) → the same REAL wordmark as braille dots (2×4 a cell), for terminals that cannot draw images. The
   logo is itself a dot matrix, so its dots map onto braille dots: each dot takes the BRIGHTEST master pixel it covers
   (max, not mean — a thin dotted stroke must light its dot, never average away). Four rows ≈ 56 columns.
   Two things a plain grid gets wrong, both fixed here:
   - a level stroke that falls on the line between two dot rows lights BOTH (the top edge read as a doubled, thick bar).
     The wordmark's level strokes sit at STROKE_Y, so the dot rows are laid out to put each of them on a row's centre
     (piecewise between them, never more than half a dot off) — every level stroke is one dot thick, as in the logo.
   - the star in the A is ~6×7 dots: sampled, it smudges into a blob. Its pixels (STAR_BOX) are left out of the sample
     and a drawn star (STAR_DOTS: long top spike, short bottom spike, leaning with the italic) goes in its place.
   STROKE_Y and STAR_BOX are measured off logo-image.js (dev/cli-logo-image.cjs) — re-measure if the master changes. */
const BRAILLE_DOT = [[1, 8], [2, 16], [4, 32], [64, 128]];
const STROKE_Y = [6.3, 31.2, 45.3, 70.6, 87.5, 111];   // the master's level strokes, top edge to bottom edge (px)
const STAR_BOX = { x0: 244, x1: 290, y0: 38, y1: 91, cx: 265, cy: 71 };   // the star's pixels in the master, and its centre
const inStar = (x, y) => x >= STAR_BOX.x0 && x <= STAR_BOX.x1 && y >= STAR_BOX.y0 && y <= STAR_BOX.y1 && !(x < 250 && y < 56);   // (the A's own inner stroke dips into the box's top-left corner)
const STAR_DOTS = ['....X..', '....X..', '...X...', '..X.X..', 'XX...XX', '..X.X..', '...X...', '..X....'];   // arms on row 4, centre column 3
const brailleCache = new Map();
function brailleLogo(rows, threshold) {
  const r = Math.max(1, rows | 0), thr = threshold == null ? 0.5 : threshold;
  const key = r + '@' + thr;
  if (brailleCache.has(key)) return brailleCache.get(key);
  const src = master();
  const gh = r * 4, cols = Math.ceil(Math.round(gh * src.w / src.h) / 2), gw = cols * 2;
  // dot row k → the master y at its centre: each level stroke on a row of its own, straight lines between
  const span = STROKE_Y[STROKE_Y.length - 1] - STROKE_Y[0];
  const rowOf = STROKE_Y.map(y => Math.round((y - STROKE_Y[0]) / span * (gh - 1)));
  const snapped = rowOf.every((k, i) => i === 0 || k > rowOf[i - 1]);   // too few rows to give each stroke its own: plain grid
  const rowY = k => {
    if (!snapped) return (k + 0.5) * src.h / gh;
    let i = 0;
    while (i < rowOf.length - 2 && k > rowOf[i + 1]) i++;
    return STROKE_Y[i] + (k - rowOf[i]) * (STROKE_Y[i + 1] - STROKE_Y[i]) / (rowOf[i + 1] - rowOf[i]);
  };
  const star = gh >= 16;   // a drawn star needs 8 dot rows of room; smaller logos keep the sampled one
  const on = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++) {
    const sy0 = y === 0 ? 0 : Math.round((rowY(y - 1) + rowY(y)) / 2);
    const sy1 = y === gh - 1 ? src.h : Math.max(sy0 + 1, Math.round((rowY(y) + rowY(y + 1)) / 2));
    for (let x = 0; x < gw; x++) {
      const sx0 = Math.floor(x * src.w / gw), sx1 = Math.max(sx0 + 1, Math.floor((x + 1) * src.w / gw));
      let mx = 0;
      for (let yy = Math.max(0, sy0); yy < Math.min(src.h, sy1); yy++) for (let xx = sx0; xx < sx1; xx++) {
        if (star && inStar(xx, yy)) continue;
        mx = Math.max(mx, src.px[yy * src.w + xx]);
      }
      if (mx / 255 >= thr) on[y * gw + x] = 1;
    }
  }
  if (star) {
    let cy = 0;
    for (let k = 1; k < gh; k++) if (Math.abs(rowY(k) - STAR_BOX.cy) < Math.abs(rowY(cy) - STAR_BOX.cy)) cy = k;
    const x0 = Math.round(STAR_BOX.cx * gw / src.w - 0.5) - 3, y0 = cy - 4;
    STAR_DOTS.forEach((line, dy) => { for (let dx = 0; dx < line.length; dx++) if (line[dx] === 'X' && y0 + dy >= 0 && y0 + dy < gh) on[(y0 + dy) * gw + x0 + dx] = 1; });
  }
  const lines = [];
  for (let cy = 0; cy < r; cy++) {
    let s = '';
    for (let cx = 0; cx < cols; cx++) {
      let bits = 0;
      for (let k = 0; k < 4; k++) for (let c = 0; c < 2; c++) if (on[(cy * 4 + k) * gw + cx * 2 + c]) bits |= BRAILLE_DOT[k][c];
      s += bits ? String.fromCharCode(0x2800 + bits) : ' ';
    }
    lines.push(s.replace(/\s+$/, ''));
  }
  brailleCache.set(key, lines);
  return lines;
}

/* What the terminal said to the startup probe (CSI 16 t, CSI 14 t, DA1):
   { sixel: DA1 lists attribute 4, cellW/cellH: from the cell-size reply, else the window's pixel size ÷ its cells,
     replied: the terminal answered DA1 at all }. */
function parseTermReplies(buf, cols, rows) {
  const s = String(buf || '');
  const da = /\x1b\[\?([\d;]*)c/.exec(s);
  const out = { sixel: !!(da && da[1].split(';').indexOf('4') >= 0), cellW: 0, cellH: 0, replied: !!da };
  const cell = /\x1b\[6;(\d+);(\d+)t/.exec(s);
  if (cell) { out.cellH = Number(cell[1]); out.cellW = Number(cell[2]); }
  else {
    const win = /\x1b\[4;(\d+);(\d+)t/.exec(s);
    if (win && cols > 0 && rows > 0) { out.cellH = Math.floor(Number(win[1]) / rows); out.cellW = Math.floor(Number(win[2]) / cols); }
  }
  if (!(out.cellW >= 4 && out.cellH >= 8)) { out.cellW = 0; out.cellH = 0; }   // a nonsense size draws no image
  return out;
}

module.exports = { logoSixel, brailleLogo, decodeSixel, parseTermReplies, RAMP };
