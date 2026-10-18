'use strict';
/* node dev/cli-logo.cjs [--write] — cut the terminal's StarNet logo from the REAL brand art, never a redraw:
   the star from src-tauri/icon-source.png (the master every StarNet icon is cut from) and the wordmark from
   frontend/assets/brand/starnet-wordmark.svg (the master wordmark's own forms, traced by dev/trace-logo.mjs). Each is
   masked, scaled, and set as braille dots (2×4 dots a cell — the logo is itself a dot matrix) and as half blocks
   (1×2 a cell, for consoles without braille). Prints every size for review; --write regenerates bin/lib/logo.js.
   Needs the dev dependency sharp. */
const fs = require('node:fs');
const path = require('node:path');
const sharp = require('sharp');

const REPO = path.resolve(__dirname, '..');
const STAR = path.join(REPO, 'src-tauri', 'icon-source.png');
const WORD = path.join(REPO, 'frontend', 'assets', 'brand', 'starnet-wordmark.svg');

// the star: its orange phosphor is lit; the icon's dark disc, scanlines and transparent margins are dark
async function starMask() {
  const { data, info } = await sharp(STAR).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = new Float32Array(info.width * info.height);
  for (let i = 0; i < m.length; i++) {
    const r = data[i * 4], b = data[i * 4 + 2], a = data[i * 4 + 3];
    m[i] = (a > 110 && r > 150 && r - b > 70) ? 1 : 0;
  }
  return { w: info.width, h: info.height, m };
}
// the wordmark: the traced paths, filled, rasterized at a fixed width (their own alpha is the mask)
async function wordMask(width) {
  const svg = fs.readFileSync(WORD, 'utf8').replace(/currentColor/g, '#ffffff').replace(process.env.FILLED === '1' ? /fill-rule="evenodd"/g : /$^/, 'fill-rule="nonzero"');
  const { data, info } = await sharp(Buffer.from(svg), { density: 72 * width / 946 }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const m = new Float32Array(info.width * info.height);
  for (let i = 0; i < m.length; i++) m[i] = data[i * 4 + 3] / 255;
  return { w: info.width, h: info.height, m };
}
// the lit bounding box, so the art is trimmed to the mark itself
function bounds(mk) {
  let x0 = mk.w, y0 = mk.h, x1 = -1, y1 = -1;
  for (let y = 0; y < mk.h; y++) for (let x = 0; x < mk.w; x++) if (mk.m[y * mk.w + x] > 0.5) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  return { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}
// area-average the mask into a gw×gh grid of coverage values
function grid(mk, b, gw, gh) {
  const out = new Float32Array(gw * gh);
  for (let gy = 0; gy < gh; gy++) for (let gx = 0; gx < gw; gx++) {
    const sx0 = b.left + Math.floor(gx * b.width / gw), sx1 = b.left + Math.max(Math.floor((gx + 1) * b.width / gw), Math.floor(gx * b.width / gw) + 1);
    const sy0 = b.top + Math.floor(gy * b.height / gh), sy1 = b.top + Math.max(Math.floor((gy + 1) * b.height / gh), Math.floor(gy * b.height / gh) + 1);
    let s = 0, n = 0;
    for (let y = sy0; y < sy1; y++) for (let x = sx0; x < sx1; x++) { s += mk.m[y * mk.w + x]; n++; }
    out[gy * gw + gx] = n ? s / n : 0;
  }
  return out;
}
const DOT = [[0x01, 0x08], [0x02, 0x10], [0x04, 0x20], [0x40, 0x80]];   // braille dot bits by [row][col]
const BLANK = String.fromCharCode(0x2800);
function braille(mk, b, cols, rows, threshold) {
  const gw = cols * 2, gh = rows * 4;
  const g = grid(mk, b, gw, gh);
  const lines = [];
  for (let cy = 0; cy < rows; cy++) {
    let s = '';
    for (let cx = 0; cx < cols; cx++) {
      let bits = 0;
      for (let r = 0; r < 4; r++) for (let c = 0; c < 2; c++) if (g[(cy * 4 + r) * gw + cx * 2 + c] >= threshold) bits |= DOT[r][c];
      s += String.fromCharCode(0x2800 + bits);
    }
    lines.push(s.split(BLANK).join(' ').replace(/\s+$/, ''));
  }
  return lines;
}
function halfBlocks(mk, b, cols, rows, threshold) {
  const gw = cols, gh = rows * 2;
  const g = grid(mk, b, gw, gh);
  const lines = [];
  for (let cy = 0; cy < rows; cy++) {
    let s = '';
    for (let cx = 0; cx < cols; cx++) {
      const top = g[(cy * 2) * gw + cx] >= threshold, bot = g[(cy * 2 + 1) * gw + cx] >= threshold;
      s += top && bot ? '█' : top ? '▀' : bot ? '▄' : ' ';
    }
    lines.push(s.replace(/\s+$/, ''));
  }
  return lines;
}

(async () => {
  const star = await starMask();
  const word = await wordMask(1892);
  const sb = bounds(star), wb = bounds(word);
  // a braille dot is about square in a 1:2 cell, so cols = rows × 4 × aspect / 2 keeps the art's own proportions
  const wAspect = wb.width / wb.height;
  const wcols = rows => Math.round(rows * 4 * wAspect / 2);
  const out = {
    star: { braille: { 4: braille(star, sb, 9, 4, 0.35), 5: braille(star, sb, 11, 5, 0.35), 6: braille(star, sb, 13, 6, 0.35) }, blocks: { 3: halfBlocks(star, sb, 6, 3, 0.4), 4: halfBlocks(star, sb, 8, 4, 0.4) } },
    word: { braille: { 3: braille(word, wb, wcols(3), 3, 0.5), 4: braille(word, wb, wcols(4), 4, 0.5), 5: braille(word, wb, wcols(5), 5, 0.5) }, blocks: { 3: halfBlocks(word, wb, Math.round(wcols(3) * 1.1), 3, 0.5), 4: halfBlocks(word, wb, Math.round(wcols(4) * 1.1), 4, 0.5) } }
  };
  for (const [k, v] of Object.entries(out)) for (const [kind, sizes] of Object.entries(v)) for (const [n, lines] of Object.entries(sizes)) {
    console.log('--- ' + k + ' ' + kind + ' ' + n + ' rows (' + lines.length + ' x ' + Math.max(...lines.map(l => [...l].length)) + ')');
    console.log(lines.join('\n'));
  }
  if (process.argv.includes('--write')) {
    const body = '/* bin/lib/logo.js — GENERATED by dev/cli-logo.cjs from the real brand art (src-tauri/icon-source.png and\n'
      + '   frontend/assets/brand/starnet-wordmark.svg). Never edit by hand: regenerate. braille = the dot-matrix cut;\n'
      + '   blocks = for consoles without braille. Keyed by height in rows; blank cells are plain spaces. */\n'
      + "'use strict';\nmodule.exports = " + JSON.stringify(out, null, 1) + ';\n';
    fs.writeFileSync(path.join(REPO, 'bin', 'lib', 'logo.js'), body);
    console.log('wrote bin/lib/logo.js');
  }
})().catch(e => { console.error(e); process.exit(1); });
