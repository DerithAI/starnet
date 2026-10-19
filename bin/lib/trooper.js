/* bin/lib/trooper.js — the agent in COMMS as an armored trooper at its desk: real pixel art (bin/lib/trooper-art.js), drawn
   as an image where the terminal draws Sixel (at 8 rows, character cells could only smear it: elsewhere there is no card).
   Its state is the scene:
     working   it types: the 9-frame loop, hands on the keys, the code on its monitors changing
     idle      it sits at its desk, the red light of its visor and screens breathing slowly
     needs you the light turns amber and pulses
     done      the light turns green
     stopped   powered down, screens and visor dark, a last flicker now and then
   Pure: look(state, now, still) picks the frame and palette for a moment; sixel(...) draws it. A still
   screen (STARNET_STILL) holds each state's first look. Everything decoded or encoded is cached: a moment that looks the same
   as the last costs nothing. */
'use strict';

const zlib = require('node:zlib');
const art = require('./trooper-art.js');
const { encodeSixel } = require('./sixel.js');

const W = art.width, H = art.height, PAL = art.palette;
let FRAMES = null;
function frames() {
  if (!FRAMES) {
    FRAMES = {};
    for (const [k, list] of Object.entries(art.frames)) FRAMES[k] = list.map(b => new Uint8Array(zlib.inflateSync(Buffer.from(b, 'base64'))));
    // one outline for every frame: a pixel inked in any frame is inked in all (the few at a moving edge take the art's
    // darkest colour, its outline), so the image can draw transparent over the terminal's own background and each frame
    // still covers every pixel the last one drew
    const all = Object.values(FRAMES).flat();
    const dark = PAL.reduce((best, c, i) => (c[0] + c[1] + c[2] < PAL[best][0] + PAL[best][1] + PAL[best][2] ? i : best), 0);
    for (let p = 0; p < W * H; p++) if (all.some(f => f[p] !== 255)) for (const f of all) if (f[p] === 255) f[p] = dark;
  }
  return FRAMES;
}

// the scene's light: the saturated reds (visor, screens, the glow they throw on the armor)
const GLOW = PAL.map(([r, g, b]) => r >= 60 && r > g * 1.6 && r > b * 1.4);
const AMBER = [255, 180, 58], GREEN = [93, 255, 168];
const clamp = v => Math.max(0, Math.min(255, Math.round(v)));
const tint = (c, to, k) => to.map(v => clamp(v * c[0] / 255 * k));   // a red glow pixel, its brightness kept, in another hue
const scale = (c, k) => c.map(v => clamp(v * k));
const palettes = new Map();
function palette(key, fn) { if (!palettes.has(key)) palettes.set(key, PAL.map((c, i) => fn(c, GLOW[i]))); return palettes.get(key); }

/* look(state, now, still) → { key, frame: Uint8Array (palette indexes, 255 = none), palette: [[r,g,b]] } */
function look(state, now, still) {
  const f = frames();
  const t = still ? 0 : now;
  if (state === 'working') {
    const i = still ? 0 : Math.floor(t / 110) % f.working.length;
    return { key: 'w' + i, frame: f.working[i], palette: PAL };
  }
  if (state === 'needs') {
    const on = still || Math.floor(t / 450) % 2 === 0;
    return { key: 'n' + (on ? 1 : 0), frame: f.working[0], palette: palette('n' + on, (c, g) => g ? tint(c, AMBER, on ? 1.15 : 0.7) : c) };
  }
  if (state === 'done') return { key: 'd', frame: f.working[0], palette: palette('d', (c, g) => g ? tint(c, GREEN, 1.05) : c) };
  if (state === 'stopped') {
    const flicker = !still && t % 4100 < 160;
    return { key: 's' + (flicker ? 1 : 0), frame: f.stopped[flicker ? 1 : 0], palette: PAL };
  }
  // idle: the light breathes, one slow swell every 3.2 s, in 6 steps (each a palette, so each a cached image)
  const step = still ? 5 : Math.round((0.5 + 0.5 * Math.sin(t / 3200 * 2 * Math.PI)) * 5);
  return { key: 'i' + step, frame: f.working[0], palette: palette('i' + step, (c, g) => g ? scale(c, 0.55 + 0.09 * step) : c) };
}

/* sixel(look, { cellW, cellH, cols, rows }) → { sixel, cols, rows } — the frame scaled to the box (a whole-number scale
   when one fits, so every pixel stays square and sharp), bottom-aligned, drawn transparent so the terminal's own
   background shows around it (every frame inks the same outline, so it still covers the last). Cached per look and box. */
const sixels = new Map();
function sixel(lk, box) {
  const ck = lk.key + '|' + box.cellW + 'x' + box.cellH + '|' + box.cols + 'x' + box.rows;
  if (sixels.has(ck)) return sixels.get(ck);
  const maxW = box.cols * box.cellW, maxH = box.rows * box.cellH;
  let s = Math.min(maxW / W, maxH / H);
  if (s >= 1) s = Math.floor(s);
  const w = Math.max(1, Math.round(W * s)), h = Math.max(1, Math.round(H * s));
  const top = maxH - h;   // stand it on the card's floor
  const idx = new Int16Array(w * (h + top)).fill(-1);
  for (let y = 0; y < h; y++) {
    const sy = Math.min(H - 1, Math.floor(y / s));
    for (let x = 0; x < w; x++) {
      const v = lk.frame[sy * W + Math.min(W - 1, Math.floor(x / s))];
      if (v !== 255) idx[(y + top) * w + x] = v;
    }
  }
  const out = { sixel: encodeSixel(idx, w, h + top, lk.palette), cols: Math.ceil(w / box.cellW), rows: box.rows };
  if (sixels.size > 200) sixels.clear();
  sixels.set(ck, out);
  return out;
}

module.exports = { look, sixel, W, H };
