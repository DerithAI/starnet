#!/usr/bin/env node
// perf-build-place.mjs — what one BUILD MODE edit costs the main thread, and whether the floor it leaves is the true one.
//
// Boots a SKYNET_DEV sidecar over a COPY of a station's shape (--station: a dir holding agent.save.json / agent.roster.json;
// default the dev seed fixture) in a hermetic scratch home (its own APPDATA / LOCALAPPDATA / XDG_DATA_HOME / HERMES_HOME, so
// the sidecar's boot-time station recovery can never reach a real station), opens BUILD MODE in headless Chrome and drives
// REAL gestures through build.js's own handlers (Build.__test__): place a stool, place a second, move, turn, delete, undo,
// redo, lay a belt and undo it, stamp a room past the south edge (the floor grows), undo/redo it, stamp one past the north
// edge (the origin moves), undo it, rename a room. Each edit runs in ONE page task — the gesture, then the first and second
// frames after it, timed synchronously — so the number is the freeze a person feels, not a sampling of it. The 1.2 s after
// each edit is watched for long tasks too (anything the edit scheduled for later).
//
// --shots <dir>   a PNG of the page after every edit (read with your eyes: the floor must look the same before and after)
// --verify        a second, exact pass through the station API: keep a chunked bake the way BUILD MODE does (keep it for a
//                 patch that says staticBakeUnchanged, re-bake the patch's rects otherwise) and after every edit compare it
//                 PIXEL FOR PIXEL, chunk by chunk, base + light, against a fresh chunked bake of the same floor. Any mismatch
//                 is a stale or wrong pixel a person would see in BUILD MODE.
// --json <file>   write the measured rows as JSON (for a before/after table).
//
// Usage: node scripts/perf-build-place.mjs [--station dir] [--port 9712] [--cdp 9722] [--out dir] [--size 1600,900]
//        [--reps 1] [--only place,move,turn,delete,undo,belt,south,north,rename] [--shots dir] [--verify] [--json file] [--headed]
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes(k);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const { connectCDP, evalJS, sleep, capture } = await import(pathToFileURL(join(repo, 'scripts/lib/cdp.mjs')).href);
const { waitUp, waitDevReady } = await import(pathToFileURL(join(repo, 'scripts/lib/seed.mjs')).href);
const port = arg('--port', '9712'), cdpPort = Number(arg('--cdp', '9722')), size = arg('--size', '1600,900');
const reps = Number(arg('--reps', '1'));
const only = arg('--only', 'place,move,turn,delete,undo,belt,south,north,rename').split(',');
const station = resolve(arg('--station', join(repo, 'dev/fixtures/seed-workspace')));
const OUT = resolve(arg('--out', join(tmpdir(), 'starnet-perf-build')));
const shots = arg('--shots') ? resolve(arg('--shots')) : null;
const scratch = join(OUT, '_ws-' + port), profile = join(OUT, '_profile-' + cdpPort), home = join(OUT, '_home-' + port);
for (const d of [scratch, profile, home]) rmSync(d, { recursive: true, force: true });
mkdirSync(scratch, { recursive: true });
// only the station's SHAPE travels: save, roster, dossier — never secrets, journals or checkpoints
for (const f of readdirSync(station)) if (/^(agent\.save|agent\.roster|_commander\.dossier)\.json$/.test(f)) cpSync(join(station, f), join(scratch, f));
try {
  const p = join(scratch, 'agent.save.json'), w = JSON.parse(readFileSync(p, 'utf8')), now = Date.now();
  w.updatedAt = now; w.savedAt = now; if (w.doc) w.doc.updatedAt = now;
  writeFileSync(p, JSON.stringify(w));
} catch (e) { console.warn('could not restamp the copied save (the page may resume an older local copy):', e.message); }
const APP_URL = `http://127.0.0.1:${port}/`;
for (const d of ['appdata', 'local', 'xdg', 'hermes']) mkdirSync(join(home, d), { recursive: true });
const side = spawn(process.execPath, [join(repo, 'sidecar/index.js')], { cwd: repo, stdio: 'ignore', env: {
  ...process.env, SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1', SKYNET_WORKSPACES: scratch, SKYNET_PORT: port, PORT: port,
  APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'local'), XDG_DATA_HOME: join(home, 'xdg'), HERMES_HOME: join(home, 'hermes'),
  SKYNET_DEFAULT_MODEL: 'anthropic/claude-sonnet-4.6', SKYNET_OPENROUTER_KEY: 'sk-or-perf-placeholder' } });
const CHROME = [process.env.SKYNET_CHROME, 'C:/Users/andro/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(existsSync);
let chrome = null;
console.log('sidecar pid', side.pid, 'port', port, 'workspace', scratch);

function summarize(prof, top = 18) {   // a CPU profile -> the top inclusive and self functions, in ms
  const byId = new Map(prof.nodes.map(n => [n.id, n])), parent = new Map();
  for (const n of prof.nodes) for (const c of (n.children || [])) parent.set(c, n.id);
  const name = n => { const f = n.callFrame; return (f.functionName || '(anon)') + ' ' + (f.url.split('/').pop() || '') + ':' + (f.lineNumber + 1); };
  const self = new Map(), incl = new Map(), dts = prof.timeDeltas; let total = 0;
  for (let i = 0; i < prof.samples.length; i++) {
    const dt = (dts[i + 1] != null ? dts[i + 1] : 0) / 1000; let id = prof.samples[i];
    const n0 = byId.get(id), k0 = name(n0);
    if (/^\((idle|program|garbage collector)\)/.test(n0.callFrame.functionName)) { if (n0.callFrame.functionName !== '(idle)') self.set(k0, (self.get(k0) || 0) + dt); continue; }
    total += dt; self.set(k0, (self.get(k0) || 0) + dt);
    const seen = new Set();
    while (id != null) { const k = name(byId.get(id)); if (!seen.has(k)) { seen.add(k); incl.set(k, (incl.get(k) || 0) + dt); } id = parent.get(id); }
  }
  const fmt = m => [...m].sort((a, b) => b[1] - a[1]).slice(0, top).map(([k, v]) => v.toFixed(1).padStart(8) + ' ms  ' + k).join('\n');
  // --callers fnName: who spends the time inside fnName (its direct callers, by self time of fnName)
  const want = arg('--callers'), callers = new Map();
  if (want) for (let i = 0; i < prof.samples.length; i++) {
    const n0 = byId.get(prof.samples[i]); if (n0.callFrame.functionName !== want) continue;
    const pid = parent.get(n0.id), k = pid != null ? name(byId.get(pid)) : '(none)';
    callers.set(k, (callers.get(k) || 0) + (prof.timeDeltas[i + 1] || 0) / 1000);
  }
  return { total, self: fmt(self) + (want ? '\n-- ' + want + ' callers:\n' + fmt(callers) : ''), incl: fmt(incl) };
}

// one edit, one page task: settle two frames, run the gesture, then time the first and second frames after it
const HARNESS = `(() => {
  const T = Build.__test__, st = T.station();
  window.__patches = [];
  if (!window.__perfSub) window.__perfSub = st.onChange(p => window.__patches.push({ rects: (p.dirtyRects || []).length, static: !!p.staticBakeUnchanged, global: !!p.global }));
  window.__edit = (label, fn) => {
    T.frame(); T.frame(); window.__patches.length = 0;
    const t0 = performance.now(); let out; try { out = fn(); } catch (e) { out = 'THREW ' + (e && e.message); }
    const t1 = performance.now(); T.frame(); const t2 = performance.now(); T.frame(); const t3 = performance.now();
    return { label, gesture: Math.round(t1 - t0), frame1: Math.round(t2 - t1), frame2: Math.round(t3 - t2), patches: window.__patches.slice(), out };
  };
  window.__lt = []; new PerformanceObserver(l => { for (const e of l.getEntries()) window.__lt.push(Math.round(e.duration)); }).observe({ entryTypes: ['longtask'] });
  return 1;
})()`;

// free spots on THIS station: a stool pair, a 6-tile belt run, a room past the south edge, a room past the north edge
const SPOTS = `(() => {
  const st = Build.__test__.station(); const rooms = st.rooms(); let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for (const r of rooms) for (const q of r.rects) { minX=Math.min(minX,q.x1); minY=Math.min(minY,q.y1); maxX=Math.max(maxX,q.x2); maxY=Math.max(maxY,q.y2); }
  let prop=null, belt=null;
  for (let y=minY; y<=maxY && !prop; y++) for (let x=minX; x<=maxX && !prop; x++) { const v = st.canPlaceProp('stool', x, y, 1, 1); if (v && v.ok && st.canPlaceProp('stool', x+1, y, 1, 1).ok && st.canPlaceProp('stool', x+2, y, 1, 1).ok && st.canPlaceProp('stool', x+3, y, 1, 1).ok) prop = [x, y]; }
  for (let y=maxY; y>=minY && !belt; y--) for (let x=minX; x<=maxX-6 && !belt; x++) { const v = st.canPlaceBeltRun({tx:x,ty:y},{tx:x+5,ty:y}); if (v && v.ok) belt = [[x,y],[x+5,y]]; }
  const roomAt = (y1, y2) => { for (let x=minX; x<=maxX; x++) { const r = { x1:x, y1, x2:x+5, y2 }; const v = st.canPlaceRoom([r], 'hab'); if (v && v.ok) return [[r.x1,r.y1],[r.x2,r.y2]]; } return null; };
  return { prop, belt, south: roomAt(maxY+1, maxY+5), north: roomAt(minY-5, minY-1), bounds: [minX,minY,maxX,maxY], rename: rooms[0] && rooms[0].id };
})()`;

// the exact pass: a chunked bake kept the way BUILD MODE keeps it, compared after every edit against a fresh one
const VERIFY = `(() => {
  const T = Build.__test__, st = T.station(), SB = StationBake;
  const geoOf = () => st.projectGeometry();
  // mismatched pixels; 'inner' counts only those 4+ px inside the chunk (a stale or wrong region shows up there, while a
  // chunk bake's own edge seam — which a whole-station bake does not have — stays at the rim)
  let inner = 0;
  const diff = (a, b) => {
    if (!a || !b || a.width !== b.width || a.height !== b.height) return -1;
    const A = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, B = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    let n = 0; for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i+1] !== B[i+1] || A[i+2] !== B[i+2] || A[i+3] !== B[i+3]) {
      n++; const p = i >> 2, x = p % a.width, y = (p / a.width) | 0;
      if (Math.min(x, y, a.width - 1 - x, a.height - 1 - y) >= 4) inner++;
    }
    return n;
  };
  // the dense art plate a chunk draws (IndustrialTextures keeps it beside the base canvas): mismatched pixels + worst channel delta
  const plate = cv => (typeof IndustrialTextures !== 'undefined' && IndustrialTextures.baseLayers ? IndustrialTextures.baseLayers(cv)[0] : null) || null;
  const plateDiff = (a, b) => {
    if (!a && !b) return [0, 0];
    if (!a || !b || a.width !== b.width || a.height !== b.height) return [1e9, 255];
    const A = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, B = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
    let n = 0, worst = 0; for (let i = 0; i < A.length; i++) { const d = Math.abs(A[i] - B[i]); if (d) { if (d > worst) worst = d; if ((i & 3) === 0 || true) n++; } }
    return [n, worst];
  };
  const compare = (cache, geo) => {
    if (!cache.chunked) return { chunks: 0, missing: 0, sizeOff: 0, base: 0, light: 0, plate: 0, plateWorst: 0, extra: 0, lamps: [cache.lamps.length, cache.lamps.length], whole: true };
    inner = 0;
    const fresh = SB.bakeIncremental(geo, null, null), out = { chunks: fresh.chunkMap.size, missing: 0, sizeOff: 0, base: 0, light: 0, plate: 0, plateWorst: 0, lamps: [cache.lamps.length, fresh.lamps.length] };
    for (const [k, f] of fresh.chunkMap) {
      const c = cache.chunkMap.get(k);
      if (!c) { out.missing++; continue; }
      if (c.x !== f.x || c.y !== f.y || c.w !== f.w || c.h !== f.h) { out.sizeOff++; continue; }
      const b = diff(c.baseCv, f.baseCv), l = diff(c.lightCv, f.lightCv), [pn, pw] = plateDiff(plate(c.baseCv), plate(f.baseCv));
      out.base += b < 0 ? 1e9 : b; out.light += l < 0 ? 1e9 : l; out.plate += pn; out.plateWorst = Math.max(out.plateWorst, pw);
    }
    out.extra = [...cache.chunkMap.keys()].filter(k => !fresh.chunkMap.has(k)).length;
    out.inner = inner;
    return out;
  };
  // start where BUILD MODE starts: the live world's WHOLE-station bake (the entry handoff), never a chunked one
  let geo = geoOf(), cache = SB.bake(geo), last = null;
  const unsub = st.onChange(p => { last = p; });
  const rows = [];
  const step = (label, fn) => {
    last = null; const r = fn(); const p = last;
    geo = geoOf();
    let rebaked = 0, t = 0;
    if (p && (!p.staticBakeUnchanged || p.global)) { const t0 = performance.now(); cache = SB.bakeIncremental(geo, cache, p.global ? null : p.dirtyRects); t = Math.round(performance.now() - t0); rebaked = cache.stats.rebakedChunks; }
    const cmp = compare(cache, geo);
    rows.push({ label, ok: !!(r && r.ok), static: !!(p && p.staticBakeUnchanged), global: !!(p && p.global), rects: p ? p.dirtyRects.length : null, rebaked, ms: t, reset: !!(cache.stats && cache.stats.fullReset), ...cmp });
  };
  const rooms = st.rooms(); let minX=1e9,minY=1e9,maxX=-1e9,maxY=-1e9;
  for (const r of rooms) for (const q of r.rects) { minX=Math.min(minX,q.x1); minY=Math.min(minY,q.y1); maxX=Math.max(maxX,q.x2); maxY=Math.max(maxY,q.y2); }
  const freeRoom = (y1, y2, x0, x1) => { for (let x = x0; x <= x1; x++) { const r = { x1: x, y1, x2: x + 5, y2 }; if (st.canPlaceRoom([r], 'hab').ok) return r; } return null; };
  let spot = null;
  for (let y = minY; y <= maxY && !spot; y++) for (let x = minX; x <= maxX && !spot; x++) if (st.canPlaceProp('stool', x, y, 1, 1).ok) spot = [x, y];
  let stool = null;
  step('place stool', () => (stool = st.addProp({ t: 'stool', x: spot[0], y: spot[1], w: 1, h: 1 })));
  step('remove stool', () => st.removeProp(stool.id));
  step('undo remove', () => st.undo());
  step('redo remove', () => st.redo());
  let belt = null;
  for (let y = maxY; y >= minY && !belt; y--) for (let x = minX; x <= maxX - 6 && !belt; x++) if (st.canPlaceBeltRun({ tx: x, ty: y }, { tx: x + 5, ty: y }).ok) belt = [x, y];
  if (belt) { step('lay belt run', () => st.placeBeltRun({ tx: belt[0], ty: belt[1] }, { tx: belt[0] + 5, ty: belt[1] })); step('undo belt', () => st.undo()); }
  const rid0 = st.rooms()[0].id;   // the first edit the bake sees, in the same frame: chunks cut from the whole-station bake
  if (window.__verifyFirst !== 'south') {
    step('rename room (first)', () => st.renameRoom(rid0, 'PERF-' + Date.now().toString(36).slice(-4)));
    step('undo rename (first)', () => st.undo());
  }
  const south = freeRoom(maxY + 1, maxY + 5, minX, maxX);
  if (south) { step('room past south edge', () => st.addRoom({ kind: 'hab', rects: [south] })); step('undo south room', () => st.undo()); step('redo south room', () => st.redo()); }
  const east = (() => { for (let y = minY; y <= maxY; y++) { const r = { x1: maxX + 1, y1: y, x2: maxX + 6, y2: y + 4 }; if (st.canPlaceRoom([r], 'hab').ok) return r; } return null; })();
  if (east) step('room past east edge', () => st.addRoom({ kind: 'hab', rects: [east] }));
  const north = freeRoom(minY - 5, minY - 1, minX, maxX);
  if (north) { step('room past north edge', () => st.addRoom({ kind: 'hab', rects: [north] })); step('undo north room', () => st.undo()); }
  const rid = st.rooms()[0].id;
  step('rename room', () => st.renameRoom(rid, 'PERF-' + Date.now().toString(36).slice(-4)));
  step('undo rename', () => st.undo());
  unsub && unsub();
  return rows;
})()`;

try {
  if (!(await waitUp(APP_URL, 120))) throw new Error('sidecar never came up');
  chrome = spawn(CHROME, [...(flag('--headed') ? [] : ['--headless=new']), '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--enable-gpu', '--use-angle=d3d11', '--ignore-gpu-blocklist', '--disable-features=CalculateNativeWinOcclusion',
    `--remote-debugging-port=${cdpPort}`, '--window-position=0,0', `--window-size=${size}`, `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  console.log('chrome pid', chrome.pid);
  const cdp = await connectCDP(cdpPort);
  cdp.timeoutMs = 600000;
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true });
  const errors = [];
  cdp.on('Runtime.exceptionThrown', p => errors.push((p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exception').slice(0, 300)));
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 60, url: APP_URL }))) throw new Error('never reached the floor');
  // the authored prop art lands late and re-bakes the live world once (PropRemaster.ready) — let that pass before measuring
  await evalJS(cdp, `(typeof PropRemaster !== 'undefined' && PropRemaster.ready ? PropRemaster.ready.then(() => 1) : 1)`).catch(e => console.warn('PropRemaster.ready:', e.message));
  await sleep(6000);
  const opened = await evalJS(cdp, `(() => { Build.open(); const T = Build.__test__; return { open: T && T.isOpen(), props: T && T.station().props().length, rooms: T && T.station().rooms().length, cam: T && T.camera() }; })()`);
  console.log('station', station, 'opened', JSON.stringify(opened));
  await sleep(5000);
  await evalJS(cdp, HARNESS);
  const spots = await evalJS(cdp, SPOTS);
  console.log('spots', JSON.stringify(spots));
  if (shots) console.log('opened shot', (await capture(cdp, shots, '00-open')).path);

  const rows = [], out0 = {};
  let n = 0;
  const profiled = arg('--profile') ? arg('--profile').split(',') : [];
  async function idle(label) {   // what an untouched BUILD MODE frame costs right now (rAF-driven, the real loop)
    if (profiled.includes('idle')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
    await cdp.send('Performance.enable').catch(e => console.warn('Performance.enable:', e.message));
    const m0 = Object.fromEntries(((await cdp.send('Performance.getMetrics')).metrics || []).map(m => [m.name, m.value]));
    await evalJS(cdp, `(Build.__test__.perf(true), window.__lt.length = 0, window.__gaps = [], window.__gapOn = true, (() => { let last = performance.now(); const f = t => { if (!window.__gapOn) return; window.__gaps.push(t - last); last = t; requestAnimationFrame(f); }; requestAnimationFrame(f); })(), 1)`);
    await sleep(2000);
    const r = await evalJS(cdp, `(window.__gapOn = false, { lt: window.__lt.slice(), gaps: window.__gaps.slice(1).map(Math.round), layers: Build.__test__.perf(false) })`);
    const m1 = Object.fromEntries(((await cdp.send('Performance.getMetrics')).metrics || []).map(m => [m.name, m.value]));
    const dm = k => Math.round(((m1[k] || 0) - (m0[k] || 0)) * 1000);
    const where = `task ${dm('TaskDuration')} · script ${dm('ScriptDuration')} · style ${dm('RecalcStyleDuration')} · layout ${dm('LayoutDuration')} ms (main thread, over the window)`;
    const g = r.gaps.slice().sort((a, b) => a - b), med = g.length ? g[g.length >> 1] : 0;
    const layers = Object.entries(r.layers || {}).map(([k, v]) => [k, v && v.n ? v.ms / v.n : 0]).sort((x, y) => y[1] - x[1]).slice(0, 7).map(([k, v]) => k + ' ' + v.toFixed(1)).join(' · ');
    console.log(`IDLE ${label.padEnd(17)} ${r.gaps.length} frames in 2 s · median frame gap ${med} ms · worst ${g.length ? g[g.length - 1] : 0} ms · long tasks [${r.lt.join(', ')}]
     frame() ran ${(r.layers && r.layers['=FRAME'] && r.layers['=FRAME'].n) || 0}× · per-call ms by layer: ${layers}
     ${where}`);
    if (profiled.includes('idle')) { const p = summarize((await cdp.send('Profiler.stop')).profile, 30); console.log(`-- idle profile busy ${p.total.toFixed(0)} ms\n-- inclusive:\n${p.incl}\n-- self:\n${p.self}`); }
    return { label, frames: r.gaps.length, median: med, worst: g.length ? g[g.length - 1] : 0, lt: r.lt };
  }
  out0.idle = [await idle('at open')];
  async function edit(label, body) {
    const prof = profiled.some(p => p !== 'idle' && label.includes(p));
    if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
    await evalJS(cdp, `(window.__lt.length = 0, 1)`);
    const r = await evalJS(cdp, `window.__edit(${JSON.stringify(label)}, () => (${body}))`);
    await sleep(1200);
    r.later = await evalJS(cdp, `window.__lt.slice()`);
    rows.push(r);
    console.log(`${label.padEnd(22)} gesture ${String(r.gesture).padStart(5)} ms · frame1 ${String(r.frame1).padStart(5)} ms · frame2 ${String(r.frame2).padStart(4)} ms · later long tasks [${r.later.join(', ')}] · patches ${JSON.stringify(r.patches)} · ${JSON.stringify(r.out).slice(0, 90)}`);
    if (prof) { const p = summarize((await cdp.send('Profiler.stop')).profile, 40); console.log(`-- profile busy ${p.total.toFixed(0)} ms\n-- inclusive:\n${p.incl}\n-- self:\n${p.self}`); }
    if (shots) await capture(cdp, shots, String(++n).padStart(2, '0') + '-' + label.replace(/[^a-z0-9]+/gi, '-').toLowerCase());
    return r;
  }
  if (arg('--eval')) {   // a one-off probe: a JS file's expression, evaluated in the open BUILD MODE page (profiled with --profile eval)
    const prof = profiled.includes('eval');
    if (prof) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
    console.log(JSON.stringify(await evalJS(cdp, readFileSync(resolve(arg('--eval')), 'utf8')), null, 1));
    if (prof) { const p = summarize((await cdp.send('Profiler.stop')).profile, 60); console.log(`-- eval profile busy ${p.total.toFixed(0)} ms\n-- inclusive:\n${p.incl}\n-- self:\n${p.self}`); }
  }
  const T = 'Build.__test__';
  // --grow N: does BUILD MODE get slower the more you build? N place+delete cycles of one stool (real gestures, no bake),
  // the idle frame cost read every 5 cycles
  const grow = Number(arg('--grow', '0'));
  if (grow && spots.prop) {
    const [px, py] = spots.prop;
    for (let c = 1; c <= grow; c++) {
      await evalJS(cdp, `(${T}.setHand({ t: 'stool' }), ${T}.click([${px}, ${py}]), ${T}.setHand(null), 1)`); await sleep(250);
      await evalJS(cdp, `(${T}.click([${px}, ${py}]), ${T}.key('Delete'), ${T}.key('Escape'), 1)`); await sleep(250);
      if (c % 5 === 0) out0.idle.push(await idle('after ' + c + ' cycles'));
    }
  }
  for (let i = 0; i < reps; i++) {
    const [px, py] = spots.prop || [0, 0];
    if (spots.prop && only.includes('place')) {
      await edit('place stool', `(${T}.setHand({ t: 'stool' }), ${T}.click([${px}, ${py}]), ${T}.setHand(null), ${T}.station().props().length)`);
      await edit('place 2nd stool', `(${T}.setHand({ t: 'stool' }), ${T}.click([${px + 3}, ${py}]), ${T}.setHand(null), ${T}.station().props().length)`);
    }
    if (spots.prop && only.includes('move')) await edit('move stool +1', `(${T}.click([${px}, ${py}]), ${T}.gesture([[${px}, ${py}], [${px + 1}, ${py}]]).ok)`);
    if (spots.prop && only.includes('turn')) await edit('turn (r)', `(${T}.key('r'), ${T}.selection())`);
    if (spots.prop && only.includes('delete')) await edit('delete', `(${T}.key('Delete'), ${T}.station().props().length)`);
    if (spots.prop && only.includes('undo')) {
      await edit('undo (ctrl+z)', `(${T}.key('z', { ctrlKey: true }), ${T}.station().props().length)`);
      await edit('redo (ctrl+y)', `(${T}.key('y', { ctrlKey: true }), ${T}.station().props().length)`);
    }
    if (spots.belt && only.includes('belt')) {
      await edit('lay belt run', `(${T}.station().placeBeltRun({ tx: ${spots.belt[0][0]}, ty: ${spots.belt[0][1]} }, { tx: ${spots.belt[1][0]}, ty: ${spots.belt[1][1]} }), ${T}.station().belts().length)`);
      await edit('undo belt', `(${T}.key('z', { ctrlKey: true }), ${T}.station().belts().length)`);
    }
    if (spots.south && only.includes('south')) {
      await edit('stamp room south', `${T}.placeDrag('room', ${JSON.stringify(spots.south[0])}, ${JSON.stringify(spots.south[1])}).ok`);
      await edit('undo south room', `(${T}.key('z', { ctrlKey: true }), ${T}.station().rooms().length)`);
      await edit('redo south room', `(${T}.key('y', { ctrlKey: true }), ${T}.station().rooms().length)`);
    }
    if (spots.north && only.includes('north')) {
      await edit('stamp room north', `${T}.placeDrag('room', ${JSON.stringify(spots.north[0])}, ${JSON.stringify(spots.north[1])}).ok`);
      await edit('undo north room', `(${T}.key('z', { ctrlKey: true }), ${T}.station().rooms().length)`);
    }
    if (spots.rename && only.includes('rename')) {
      await edit('rename room', `${T}.station().renameRoom(${JSON.stringify(spots.rename)}, 'PERF-${i}').ok`);
      await edit('undo rename', `(${T}.key('z', { ctrlKey: true }), ${T}.station().rooms()[0].name)`);
    }
  }
  // --zoom-shots "tx,ty;tx,ty": wheel-zoom (real mouseWheel input, --zoom-steps notches) onto each world tile and capture it
  if (shots && arg('--zoom-shots')) {
    for (const spec of arg('--zoom-shots').split(';')) {
      const [tx, ty] = spec.split(',').map(Number);
      const steps = Number(arg('--zoom-steps', '18'));
      for (let i = 0; i < steps; i++) {
        const e = await evalJS(cdp, `(() => { const e = Build.__test__._tileEvent([${tx}, ${ty}]); return { x: e.clientX, y: e.clientY }; })()`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: e.x, y: e.y, deltaX: 0, deltaY: -50 });
      }
      await sleep(1500);   // any chunk the zoom brought into view bakes on the next frames
      const cam = await evalJS(cdp, `Build.__test__.camera()`);
      console.log('zoom shot', spec, 'zoom', cam.zoom.toFixed(2), (await capture(cdp, shots, 'zoom-' + tx + '_' + ty)).path);
      for (let i = 0; i < steps; i++) {
        const e = await evalJS(cdp, `(() => { const e = Build.__test__._tileEvent([${tx}, ${ty}]); return { x: e.clientX, y: e.clientY }; })()`);
        await cdp.send('Input.dispatchMouseEvent', { type: 'mouseWheel', x: e.x, y: e.y, deltaX: 0, deltaY: 50 });
      }
      await sleep(800);
    }
  }
  out0.idle.push(await idle('after the edits'));
  if (flag('--close')) {   // SAVE & EXIT: what leaving BUILD MODE costs once the floor was edited (the live world takes over)
    if (profiled.includes('close')) { await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 }); await cdp.send('Profiler.start'); }
    await evalJS(cdp, `(window.__lt.length = 0, 1)`);
    const c = await evalJS(cdp, `(() => { const t0 = performance.now(); Build.close(); return { sync: Math.round(performance.now() - t0), open: Build.isOpen() }; })()`);
    await sleep(2500);
    c.later = await evalJS(cdp, `window.__lt.slice()`);
    console.log(`CLOSE (save & exit)    sync ${c.sync} ms · open after: ${c.open} · later long tasks [${c.later.join(', ')}]`);
    if (profiled.includes('close')) { const p = summarize((await cdp.send('Profiler.stop')).profile, 40); console.log(`-- close profile busy ${p.total.toFixed(0)} ms
-- inclusive:
${p.incl}`); }
    out0.close = c;
    if (shots) console.log('closed shot', (await capture(cdp, shots, '99-closed')).path);
    if (flag('--reopen')) {   // BUILD MODE again on the floor it handed back: entry, then a room past the east edge
      await sleep(1500);
      const t0 = Date.now(); const re = await evalJS(cdp, `(() => { const t0 = performance.now(); Build.open(); return { sync: Math.round(performance.now() - t0), open: Build.isOpen() }; })()`);
      console.log(`REOPEN                 sync ${re.sync} ms · open ${re.open}`);
      await sleep(3000);
      const east = await evalJS(cdp, `(() => { const st = Build.__test__.station(); let maxX = -1e9, minY = 1e9, maxY = -1e9; for (const r of st.rooms()) for (const q of r.rects) { maxX = Math.max(maxX, q.x2); minY = Math.min(minY, q.y1); maxY = Math.max(maxY, q.y2); } for (let y = minY; y <= maxY; y++) { const r = { x1: maxX + 1, y1: y, x2: maxX + 6, y2: y + 4 }; if (st.canPlaceRoom([r], 'hab').ok) return [[r.x1, r.y1], [r.x2, r.y2]]; } return null; })()`);
      if (east) await edit('stamp room east (reopened)', `${T}.placeDrag('room', ${JSON.stringify(east[0])}, ${JSON.stringify(east[1])}).ok`);
      await edit('undo east room', `(${T}.key('z', { ctrlKey: true }), ${T}.station().rooms().length)`);
      await evalJS(cdp, `(window.__lt.length = 0, 1)`);
      const c2 = await evalJS(cdp, `(() => { const t0 = performance.now(); Build.close(); return Math.round(performance.now() - t0); })()`);
      await sleep(2000);
      console.log(`CLOSE again            sync ${c2} ms · later long tasks [${(await evalJS(cdp, 'window.__lt.slice()')).join(', ')}]`);
      if (shots) console.log('closed again shot', (await capture(cdp, shots, '99-closed-again')).path);
    }
  }
  for (let s = 1; s <= Number(arg('--settle', '0')); s++) { await sleep(4000); out0.idle.push(await idle('+' + (s * 6) + ' s later')); }
  if (flag('--esc')) {   // diagnosis only: does putting the armed tool down change the idle cost?
    console.log('tool before', await evalJS(cdp, `Build.__test__.tool()`));
    await evalJS(cdp, `(Build.__test__.key('Escape'), Build.__test__.key('Escape'), 1)`); await sleep(800);
    console.log('tool after', await evalJS(cdp, `Build.__test__.tool()`));
    out0.idle.push(await idle('after Escape'));
  }
  if (flag('--gc')) {   // diagnosis only: is the idle cost garbage (unreferenced canvases) or live state?
    const mem = async () => { const m = await evalJS(cdp, `({ heap: Math.round(performance.memory.usedJSHeapSize / 1048576), canvases: document.querySelectorAll('canvas').length })`); return JSON.stringify(m); };
    console.log('before gc', await mem());
    await cdp.send('HeapProfiler.enable'); await cdp.send('HeapProfiler.collectGarbage'); await sleep(1500);
    console.log('after gc', await mem());
    out0.idle.push(await idle('after a forced GC'));
  }
  if (flag('--stub-layers')) {   // diagnosis only: which drawn layer carries the idle cost (page-side stubs, never product code)
    for (const [label, on, off] of [
      ['no deck base', `window.__sb = StationBake.drawBase, StationBake.drawBase = () => {}`, `StationBake.drawBase = window.__sb`],
      ['no bake light', `window.__sl = StationBake.drawLight, StationBake.drawLight = () => {}`, `StationBake.drawLight = window.__sl`],
      ['no hi plates', `window.__ib = IndustrialTextures.drawBase, IndustrialTextures.drawBase = () => false`, `IndustrialTextures.drawBase = window.__ib`],
    ]) { await evalJS(cdp, `(${on}, 1)`); out0.idle.push(await idle(label)); await evalJS(cdp, `(${off}, 1)`); }
  }
  const out = { station, opened, spots, rows, idle: out0.idle, close: out0.close || null, errors: errors.slice(0, 20) };
  if (flag('--verify')) {
    console.log('\n-- verify: kept chunked bake vs a fresh chunked bake, after every edit (base/light = mismatched pixels)');
    await evalJS(cdp, `(window.__verifyFirst = ${JSON.stringify(arg('--verify-first', 'rename'))}, 1)`);
    const v = await evalJS(cdp, VERIFY);
    out.verify = v;
    for (const r of v) console.log(`${r.label.padEnd(22)} ok ${r.ok} · static ${r.static} · global ${r.global} · rects ${r.rects} · re-baked ${r.rebaked} chunks in ${r.ms} ms · of ${r.chunks} · missing ${r.missing} · extra ${r.extra} · size-off ${r.sizeOff} · base ${r.base} · light ${r.light} (inside the rim ${r.inner || 0}) · plate ${r.plate} (worst Δ${r.plateWorst}) · lamps ${r.lamps.join('/')}${r.reset ? ' · FULL RESET' : ''}${r.whole ? ' · (still the whole-station bake)' : ''}`);
  }
  console.log('\npage exceptions:', errors.length ? errors.slice(0, 8).join(' | ') : 'none');
  if (arg('--json')) writeFileSync(resolve(arg('--json')), JSON.stringify(out, null, 1));
  cdp.ws.close();
} catch (e) { console.error('FAILED', e && e.stack || e); process.exitCode = 1; }
finally {
  // stop only what this run started, by its own handle
  // Chrome's renderer/GPU/utility children outlive a killed browser process on Windows: end the whole tree, by its own pid
  try { if (chrome) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill(); } }
  catch (e) { console.warn('chrome kill:', e.message); }
  try { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(side.pid), '/T', '/F'], { stdio: 'ignore' }); else side.kill(); }
  catch (e) { console.warn('sidecar kill:', e.message); }
}
