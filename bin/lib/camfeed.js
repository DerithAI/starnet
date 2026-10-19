/* bin/lib/camfeed.js — the station camera locked on the agent in COMMS, made of ASCII. A small room drawn from the app's own
   art (the agent's real skin with its walk / type frames, its desk and chair, a plant and a rack), the camera easing after the
   agent the way the station's camera lock does; each frame is put on StarNet's palette (lit reds on the wordmark's ramp, the
   rest on the station's warm greys) and turned into ASCII: every 4 × 7 px cell becomes the glyph whose shape matches its
   bright pixels (bin/lib/ascii-glyphs.js), drawn in their colour over a dimmed copy of the picture. A rim round the agent picks
   it out and carries its state: red while it works, amber while it asks, green when done, grey idle, dark stopped.

   What the agent does follows its real state:
     idle / done   it wanders the floor, pausing; done shows its green rim a while first
     working       it walks to its desk, sits on its chair, and types
     needs you     it sits at its desk, still, rim pulsing amber
     stopped       it sits at its desk, still, dark
   makeCamFeed() → { setSkin(id, set), hasSkin(id), frame(id, key, now, still, box) → { key, sixel } | null, needs(id) → asset
   paths it still lacks, add(path, png) }. frame() returns null until the agent's sprites are in (the card stays empty meanwhile). Pure
   apart from the per-agent walk it keeps; no I/O (the dashboard fetches the assets and hands them in with add()). */
'use strict';

const png = require('./png.js');
const G = require('./ascii-glyphs.js');
const { encodeSixel } = require('./sixel.js');

// ---- the palette: StarNet's ramps, and a lookup from any colour to its nearest entry --------------------------------
const RAMPS = {
  red: [[40, 2, 8], [70, 4, 14], [118, 8, 22], [170, 14, 32], [215, 24, 44], [255, 46, 62], [255, 104, 116], [255, 176, 184]],
  grey: [[12, 12, 12], [30, 22, 25], [52, 40, 44], [80, 64, 68], [127, 102, 107], [170, 156, 160], [217, 210, 212], [255, 255, 255]],
  amber: [[60, 36, 6], [110, 66, 10], [170, 104, 18], [220, 140, 30], [255, 180, 58], [255, 214, 140]],
  green: [[10, 50, 30], [20, 100, 60], [40, 160, 100], [93, 255, 168], [180, 255, 214]]
};
const ramp = (R, t) => { const x = Math.max(0, Math.min(1, t)) * (R.length - 1), i = Math.floor(x), f = x - i, a = R[i], b = R[Math.min(R.length - 1, i + 1)]; return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f]; };
const PALETTE = [];
for (const R of Object.values(RAMPS)) for (let i = 0; i < 24; i++) PALETTE.push(ramp(R, i / 23).map(Math.round));
let LUT = null;   // 32×32×32 → palette index, built once
function nearest(r, g, b) {
  if (!LUT) {
    LUT = new Uint8Array(32 * 32 * 32);
    for (let i = 0; i < LUT.length; i++) {
      const rr = ((i >> 10) & 31) * 8 + 4, gg = ((i >> 5) & 31) * 8 + 4, bb = (i & 31) * 8 + 4;
      let best = 0, bd = Infinity;
      PALETTE.forEach(([pr, pg, pb], k) => { const d = (rr - pr) ** 2 + (gg - pg) ** 2 + (bb - pb) ** 2; if (d < bd) { bd = d; best = k; } });
      LUT[i] = best;
    }
  }
  return LUT[((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3)];
}

// ---- glyphs ------------------------------------------------------------------------------------------------------
const CW = G.cw, CH = G.ch;
const COV = {};
for (const [c, b64] of Object.entries(G.glyphs)) COV[c] = Uint8Array.from(Buffer.from(b64, 'base64'));
const SHAPES = [...G.shapes].map(c => ({ c, cov: COV[c], mask: Uint8Array.from(COV[c], v => v > 100 ? 1 : 0) }));
const DENSE = G.dense;

// ---- the room (world px at the reference zoom, an image 160 px tall) ----------------------------------------------------
const REF_H = 160, Z0 = 1.5;
const WALL = 60;
const DESK = { x: 300, y: 70 };
const SEAT = { x: 372, y: 198 };
const PROPS = [['plant', 220, 90], ['rack', -60, 20]];
const AREA = { x0: 30, x1: 520, y0: 182, y1: 206 };
const SPEED = 70;   // world px a second
const FURNITURE = ['desk', 'chair', 'plant', 'rack'];

function rnd(seed) { let s = 9; for (const c of String(seed)) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

// the frames a skin set needs (the first that exists of each list is used)
const POSES = {
  stand: [['rot_south']],
  walkE: [1, 2, 3, 4, 5, 6].map(n => ['walk_east_' + n, 'rot_east', 'rot_south']),
  walkW: [1, 2, 3, 4, 5, 6].map(n => ['walk_west_' + n, 'rot_west', 'rot_south']),
  type: [1, 2, 3, 4].map(n => ['type_north_' + n, 'sit_north_4', 'rot_north', 'rot_south'])
};

function makeCamFeed() {
  const assets = new Map();     // path -> decoded image | null (missing)
  const skins = new Map();      // agent id -> sprite set
  const sims = new Map();       // agent id -> its walk
  const scaled = new Map();     // path@zoom -> { w, h, px }
  const frames = new Map();     // render key -> { key, sixel } (recent)

  const spritePath = (set, name) => '/assets/sprites/' + set + '/' + name + '.png';
  const furnPath = n => '/assets/furniture/' + n + '.png';
  function setSkin(id, set) { if (set && skins.get(id) !== set) skins.set(id, set); }
  function add(path, buf) { let img = null; if (buf) { try { img = png.decode(buf); } catch (_) { img = null; } } assets.set(path, img); }
  // what this agent's feed still lacks: its pose frames (every fallback, so the first present one is known) and the room
  function needs(id) {
    const set = skins.get(id);
    if (!set) return [];
    const want = FURNITURE.map(furnPath);
    for (const list of Object.values(POSES)) for (const alts of list) for (const n of alts) want.push(spritePath(set, n));
    return [...new Set(want)].filter(p => !assets.has(p));
  }
  function pose(set, kind, i) {
    const alts = POSES[kind][i % POSES[kind].length];
    for (const n of alts) { const a = assets.get(spritePath(set, n)); if (a) return { path: spritePath(set, n), img: a }; }
    return null;
  }
  function scale(path, img, z) {
    const k = path + '@' + z.toFixed(3);
    if (scaled.has(k)) return scaled.get(k);
    const w = Math.max(1, Math.round(img.width * z)), h = Math.max(1, Math.round(img.height * z));
    const px = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = (Math.min(img.height - 1, Math.floor(y / z)) * img.width + Math.min(img.width - 1, Math.floor(x / z))) * 4, d = (y * w + x) * 4;
      px[d] = img.data[s]; px[d + 1] = img.data[s + 1]; px[d + 2] = img.data[s + 2]; px[d + 3] = img.data[s + 3];
    }
    const v = { w, h, px };
    if (scaled.size > 400) scaled.clear();
    scaled.set(k, v);
    return v;
  }

  // the walk: where its state puts the agent, a step at a time
  function sim(id, key, now) {
    let s = sims.get(id);
    if (!s) { s = { x: SEAT.x - 90, y: AREA.y1 - 8, tx: SEAT.x - 90, ty: AREA.y1 - 8, last: now, pauseUntil: now + 1200, rand: rnd(id), key, since: now, dir: 1, camX: null, camY: null }; sims.set(id, s); }
    if (s.key !== key) { s.key = key; s.since = now; }
    const dt = Math.min(0.25, Math.max(0, (now - s.last) / 1000));
    s.last = now;
    const atDesk = key === 'working' || key === 'needs' || key === 'stopped';
    if (atDesk) { s.tx = SEAT.x; s.ty = SEAT.y; }
    else if (s.sat) { s.sat = false; s.pauseUntil = now + 700; s.tx = s.x; s.ty = s.y + 6; }   // it stands up first
    else if (Math.hypot(s.tx - s.x, s.ty - s.y) < 1 && now > s.pauseUntil) {
      s.tx = AREA.x0 + s.rand() * (AREA.x1 - AREA.x0); s.ty = AREA.y0 + s.rand() * (AREA.y1 - AREA.y0);
      s.pauseUntil = now + 1800 + s.rand() * 4200;
    }
    const dx = s.tx - s.x, dy = s.ty - s.y, dist = Math.hypot(dx, dy);
    if (dist > 0.5) { const m = Math.min(dist, SPEED * dt); s.x += dx / dist * m; s.y += dy / dist * m; if (Math.abs(dx) > 0.5) s.dir = dx > 0 ? 1 : -1; }
    s.walking = dist > 1;
    s.sat = atDesk && dist <= 1;
    // the camera eases after the agent (its chest)
    const cx = s.x, cy = s.y - 60, ease = 1 - Math.exp(-dt / 0.28);
    if (s.camX == null) { s.camX = cx; s.camY = cy; } else { s.camX += (cx - s.camX) * ease; s.camY += (cy - s.camY) * ease; }
    return s;
  }

  /* frame(id, key, now, still, { cellW, cellH, cols, rows }) → { key, sixel } | null */
  function frame(id, key, now, still, box) {
    const set = skins.get(id);
    if (!set || needs(id).length) return null;
    const s = sim(id, key, still ? 0 : now);
    const W = box.cols * box.cellW, H = box.rows * box.cellH;
    const k = H / REF_H, Z = Z0 * k;
    const t = still ? 0 : now;
    // the agent's pose
    let p;
    if (s.sat) p = pose(set, 'type', key === 'working' && !still ? Math.floor(t / 160) : 0);
    else if (s.walking && !still) p = pose(set, s.dir > 0 ? 'walkE' : 'walkW', Math.floor(t / 100));
    else p = pose(set, 'stand', 0);
    if (!p) return null;
    const rimKey = key === 'working' ? 'w' : key === 'needs' ? (still || Math.floor(t / 450) % 2 === 0 ? 'n' : 'n2') : key === 'stopped' ? 's' : (key === 'done' && t - s.since < 8000) ? 'd' : 'i';
    const camX = Math.round(s.camX * k), camY = Math.round(s.camY * k);
    const ox = Math.round(W / 2 - camX), oy = Math.round(H / 2 - camY);
    const rk = [p.path, Math.round(s.x), Math.round(s.y), camX, camY, rimKey, W, H].join('|');
    if (frames.has(rk)) return frames.get(rk);

    // ---- compose the room ----
    const buf = new Uint8Array(W * H * 4);
    const agent = new Uint8Array(W * H);
    const fill = (x0, y0, x1, y1, c) => { for (let y = Math.max(0, y0); y < Math.min(H, y1); y++) for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) { const i = (y * W + x) * 4; buf[i] = c[0]; buf[i + 1] = c[1]; buf[i + 2] = c[2]; buf[i + 3] = 255; } };
    fill(0, 0, W, H, [12, 12, 12]);
    const wy = Math.round(WALL * k) + oy;
    fill(0, 0, W, wy, [26, 16, 18]);
    fill(0, wy, W, wy + Math.max(2, Math.round(3 * k)), [122, 28, 40]);
    for (let y = wy + Math.round(18 * k); y < H; y += Math.max(6, Math.round(24 * k))) fill(0, y, W, y + 1, [34, 22, 24]);
    const blit = (img, left, top, isAgent) => {
      for (let y = 0; y < img.h; y++) {
        const yy = top + y; if (yy < 0 || yy >= H) continue;
        for (let x = 0; x < img.w; x++) {
          const xx = left + x; if (xx < 0 || xx >= W) continue;
          const si = (y * img.w + x) * 4; if (img.px[si + 3] < 128) continue;
          const di = (yy * W + xx) * 4; buf[di] = img.px[si]; buf[di + 1] = img.px[si + 1]; buf[di + 2] = img.px[si + 2];
          agent[yy * W + xx] = isAgent ? 1 : 0;
        }
      }
    };
    const layers = [];
    const deskImg = scale(furnPath('desk'), assets.get(furnPath('desk')), Z);
    layers.push({ y: DESK.y + deskImg.h / k - 8, draw: () => blit(deskImg, Math.round(DESK.x * k) + ox, Math.round(DESK.y * k) + oy, false) });
    const chairImg = scale(furnPath('chair'), assets.get(furnPath('chair')), Z);
    layers.push({ y: SEAT.y - 1, draw: () => blit(chairImg, Math.round(SEAT.x * k - chairImg.w / 2) + ox, Math.round(SEAT.y * k - chairImg.h + 8 * k) + oy, false) });
    for (const [n, x, y] of PROPS) { const im = scale(furnPath(n), assets.get(furnPath(n)), Z); layers.push({ y: y + im.h / k, draw: () => blit(im, Math.round(x * k) + ox, Math.round(y * k) + oy, false) }); }
    const ag = scale(p.path, p.img, Z);
    layers.push({ y: s.y, draw: () => blit(ag, Math.round(s.x * k - ag.w / 2) + ox, Math.round(s.y * k - ag.h + 23 * Z) + oy, true) });
    layers.sort((a, b) => a.y - b.y).forEach(l => l.draw());

    // ---- StarNet palette + the agent's rim ----
    const RIM = { w: [255, 70, 84], n: [255, 180, 58], n2: [150, 96, 20], s: [70, 52, 56], d: [93, 255, 168], i: [184, 168, 172] }[rimKey];
    const col = new Float32Array(W * H * 3), light = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const r = buf[i * 4], g = buf[i * 4 + 1], b = buf[i * 4 + 2];
      const x = i % W, y = (i / W) | 0;
      const inA = agent[i] === 1;
      const rim = !inA && ((x > 0 && agent[i - 1]) || (x < W - 1 && agent[i + 1]) || (y > 0 && agent[i - W]) || (y < H - 1 && agent[i + W]) || (x > 1 && agent[i - 2]) || (x < W - 2 && agent[i + 2]));
      let c;
      if (rim) c = RIM;
      else if (r > 60 && r > g * 1.5 && r > b * 1.3) c = ramp(RAMPS.red, Math.pow(Math.max(r, g, b) / 255, 0.9));
      else { const lum = (0.3 * r + 0.59 * g + 0.11 * b) / 255; c = ramp(RAMPS.grey, 0.18 + 0.82 * Math.pow(lum, inA ? 0.5 : 0.8) * (inA ? 1 : 0.85)); }
      if (key === 'stopped' && inA) c = c.map(v => v * 0.45);
      col[i * 3] = c[0]; col[i * 3 + 1] = c[1]; col[i * 3 + 2] = c[2];
      light[i] = Math.max(c[0], c[1], c[2]) / 255;
    }

    // ---- ASCII: under-layer dimmed, the matched glyph over it in its cell's bright colour ----
    const out = new Float32Array(W * H * 3);
    for (let i = 0; i < W * H; i++) for (let q = 0; q < 3; q++) out[i * 3 + q] = 12 + (col[i * 3 + q] - 12) * 0.4;
    const cols = Math.floor(W / CW), rows = Math.floor(H / CH);
    const mask = new Uint8Array(CW * CH);
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
      let sum = 0;
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) sum += light[(r * CH + y) * W + c * CW + x];
      const mean = sum / (CW * CH);
      if (mean < 0.12) continue;
      let bn = 0, dn = 0; const bc = [0, 0, 0], dc = [0, 0, 0];
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        const i = (r * CH + y) * W + c * CW + x, j = y * CW + x;
        if (light[i] > mean) { mask[j] = 1; bn++; bc[0] += col[i * 3]; bc[1] += col[i * 3 + 1]; bc[2] += col[i * 3 + 2]; }
        else { mask[j] = 0; dn++; dc[0] += col[i * 3]; dc[1] += col[i * 3 + 1]; dc[2] += col[i * 3 + 2]; }
      }
      const bA = bn ? bc.map(v => v / bn) : dc.map(v => v / dn), dA = dn ? dc.map(v => v / dn) : bA;
      let gl;
      if ((Math.max(...bA) - Math.max(...dA)) / 255 < 0.1) gl = COV[DENSE[Math.max(1, Math.min(DENSE.length - 1, Math.round(mean * (DENSE.length - 1))))]];
      else { let bd = Infinity; for (const sh of SHAPES) { let d = 0; for (let j = 0; j < mask.length; j++) if (sh.mask[j] !== mask[j]) d++; if (d < bd) { bd = d; gl = sh.cov; } } }
      const mx = Math.max(bA[0], bA[1], bA[2], 1), lift = Math.min(2.4, Math.max(1, (150 + 100 * mean) / mx));
      const gc = bA.map(v => Math.min(255, v * lift));
      for (let y = 0; y < CH; y++) for (let x = 0; x < CW; x++) {
        const a = gl[y * CW + x] / 255; if (!a) continue;
        const i = (r * CH + y) * W + c * CW + x;
        for (let q = 0; q < 3; q++) out[i * 3 + q] = out[i * 3 + q] * (1 - a) + gc[q] * a;
      }
    }
    // the camera's corner brackets
    const L = Math.max(6, Math.round(10 * k));
    const mark = (x, y) => { if (x >= 0 && x < W && y >= 0 && y < H) { const i = y * W + x; out[i * 3] = 122; out[i * 3 + 1] = 28; out[i * 3 + 2] = 40; } };
    for (let d = 0; d < L; d++) { mark(1 + d, 1); mark(1, 1 + d); mark(W - 2 - d, 1); mark(W - 2, 1 + d); mark(1 + d, H - 2); mark(1, H - 2 - d); mark(W - 2 - d, H - 2); mark(W - 2, H - 2 - d); }
    const idx = new Int16Array(W * H);
    for (let i = 0; i < W * H; i++) idx[i] = nearest(Math.round(out[i * 3]), Math.round(out[i * 3 + 1]), Math.round(out[i * 3 + 2]));
    const res = { key: rk, sixel: encodeSixel(idx, W, H, PALETTE) };
    if (frames.size > 48) frames.clear();
    frames.set(rk, res);
    return res;
  }
  return { setSkin, hasSkin: id => skins.has(id), add, needs, frame, sim };
}

/* DATA.SKINS from the app's data-shim.js (the station serves it): skin id → sprite set; '' → the default skin's set */
function parseSkins(js) {
  const out = {};
  const block = /DATA\.SKINS\s*=\s*\{([\s\S]*?)\n\};/.exec(String(js || ''));
  if (!block) return out;
  for (const m of block[1].matchAll(/^\s*([A-Za-z0-9_]+)\s*:\s*(\{.*\})\s*,?\s*$/gm)) {
    let v = null;
    try { v = JSON.parse(m[2]); } catch (_) { v = null; }
    if (v && typeof v.set === 'string' && /^[A-Za-z0-9_-]+$/.test(v.set)) out[m[1]] = v.set;
  }
  const def = /DATA\.DEFAULT_SKIN\s*=\s*'([A-Za-z0-9_]+)'/.exec(String(js || ''));
  if (def && out[def[1]]) out[''] = out[def[1]];
  return out;
}
// the set the station draws for an agent: the app's own rule (assets.js setForBody)
function setFor(agentId, skin, skins) {
  if (agentId === 'ULTRON') return skins.ultron || 'ultron';
  return skins[skin] || skins[''] || '';
}

module.exports = { makeCamFeed, parseSkins, setFor, PALETTE, POSES, FURNITURE };
