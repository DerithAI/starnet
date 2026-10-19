/* bin/lib/portrait.js — an agent's station sprite as ASCII character art, the way COMMS shows who it is talking to.
   Pure: an RGBA image in, a grid of cells out. The figure is trimmed to its ink, then each cell (one column, two of its rows'
   worth of height) averages the pixels under it: a mostly-empty cell stays blank, an inked one takes a character from a
   density ramp by its brightness — stretched over the figure's own range, so a dark suit still reads — and a level 0..6 on
   one red ramp (the station's one accent; never per-agent hues).
   art(img, { rows, maxCols }) → { cols, rows, cells: [[ { ch, lv } | null ]] } · null when the image has no ink. */
'use strict';

const RAMP = '.:-=+*#%@';
const LEVELS = 7;

// the bounding box of the pixels that carry ink (alpha over 16: the anti-aliased fringe a sprite sheet leaves goes)
function trim(img) {
  const { width: w, height: h, data } = img;
  let x0 = w, y0 = h, x1 = -1, y1 = -1;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (data[(y * w + x) * 4 + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return x1 < 0 ? null : { x0, y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

// the area under one cell, every source pixel weighted by how much of it the cell covers: coverage 0..1 and, over the
// inked part, the mean luminance 0..1
function sample(img, box, fx0, fy0, fx1, fy1) {
  const { width: w, data } = img;
  let area = 0, ink = 0, lum = 0;
  for (let y = Math.floor(fy0); y < Math.ceil(fy1); y++) {
    const wy = Math.min(fy1, y + 1) - Math.max(fy0, y);
    if (wy <= 0) continue;
    for (let x = Math.floor(fx0); x < Math.ceil(fx1); x++) {
      const wx = Math.min(fx1, x + 1) - Math.max(fx0, x);
      if (wx <= 0) continue;
      const wt = wx * wy, i = ((box.y0 + y) * w + box.x0 + x) * 4, a = data[i + 3] / 255;
      area += wt;
      if (a > 0) { ink += wt * a; lum += wt * a * (0.3 * data[i] + 0.59 * data[i + 1] + 0.11 * data[i + 2]) / 255; }
    }
  }
  return { cover: area ? ink / area : 0, lum: ink ? lum / ink : 0 };
}

function art(img, opts) {
  const o = opts || {};
  const box = img && img.width && img.height && img.data ? trim(img) : null;
  if (!box) return null;
  // a cell is about twice as tall as it is wide: the rows asked for, fewer when the figure would come out wider than maxCols
  let rows = Math.max(4, o.rows | 0 || 20);
  const colsFor = r => Math.max(2, Math.round(box.w / box.h * r * 2));
  if (o.maxCols && colsFor(rows) > o.maxCols) rows = Math.max(4, Math.floor(o.maxCols / Math.max(0.01, box.w / box.h * 2)));
  const cols = Math.min(o.maxCols || Infinity, colsFor(rows));
  const sx = box.w / cols, sy = box.h / rows;
  const raw = [];
  let lo = 1, hi = 0;
  for (let r = 0; r < rows; r++) {
    const line = [];
    for (let c = 0; c < cols; c++) {
      const s = sample(img, box, c * sx, r * sy, (c + 1) * sx, (r + 1) * sy);
      // under 3/8 inked: the cell is background (a figure's edge reads cleaner than a fringe of dots)
      if (s.cover < 0.375) { line.push(null); continue; }
      if (s.lum < lo) lo = s.lum;
      if (s.lum > hi) hi = s.lum;
      line.push(s.lum);
    }
    raw.push(line);
  }
  const span = Math.max(0.05, hi - lo);
  const cells = raw.map(line => line.map(l => {
    if (l == null) return null;
    const t = Math.pow(Math.max(0, Math.min(1, (l - lo) / span)), 0.8);
    return { ch: RAMP[Math.round(t * (RAMP.length - 1))], lv: Math.round((0.25 + 0.75 * t) * (LEVELS - 1)) };
  }));
  return { cols, rows, cells };
}

/* DATA.SKINS, read off the app's data-shim.js (the station serves it): skin id → sprite set. Each entry is one line of
   `id: {json},`; a line that will not parse is skipped. */
function parseSkins(js) {
  const out = {};
  const block = /DATA\.SKINS\s*=\s*\{([\s\S]*?)\n\};/.exec(String(js || ''));
  if (!block) return out;
  for (const m of block[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*(\{.*\})\s*,?\s*$/gm)) {
    try { const v = JSON.parse(m[2]); if (v && typeof v.set === 'string' && /^[A-Za-z0-9_-]+$/.test(v.set)) out[m[1]] = v.set; } catch (_) {}
  }
  const def = /DATA\.DEFAULT_SKIN\s*=\s*'([A-Za-z0-9_]+)'/.exec(String(js || ''));
  if (def && out[def[1]]) out[''] = out[def[1]];
  return out;
}
// the set the station draws for an agent: the app's own rule (assets.js setForBody), the default skin when it has none
function setFor(agentId, skin, skins) {
  if (agentId === 'ULTRON') return skins.ultron || 'ultron';
  return skins[skin] || skins[''] || '';
}

module.exports = { art, trim, parseSkins, setFor, RAMP, LEVELS };
