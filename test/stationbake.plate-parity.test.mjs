/* Real Canvas lock for BUILD MODE's kept bake (2026-10-14, the busy-station walk: after a rename, a room past the south or
   east edge, BUILD MODE's kept chunked bake disagreed with a fresh one by 0.8-1.1 M dense-plate pixels, worst Δ255, and a
   room past the east edge left 9 chunks at the wrong plate size). The page loads the real industrial textures, so every
   bake paints its dense art plate; the station is wider than 682px, so that plate's density is not a whole number.
   Starting where BUILD MODE starts (the live world's whole-station bake), each edit is applied the way BUILD MODE applies
   it (keep the cache, re-bake the patch's rects) and the result is compared, chunk by chunk, base + light + dense plate,
   with a fresh chunked bake of the same floor. Any mismatch is a stale or wrong pixel a person would see. */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createServer as createHttp } from 'node:http';
import { readFileSync, mkdtempSync, rmSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative, resolve, isAbsolute, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findChrome, connectCDP, evalJS, sleep } from '../scripts/lib/cdp.mjs';

const frontend = resolve(fileURLToPath(new URL('../frontend/', import.meta.url)));
const page = `<!doctype html><meta charset="utf-8"><body>
<script src="js/util.js"></script><script src="app/industrialtextures.js"></script><script src="app/worldsurface.js"></script>
<script src="app/worldmodel.js"></script><script src="app/stationbake.js"></script></body>`;
const types = { '.js': 'text/javascript', '.png': 'image/png', '.html': 'text/html' };
const server = createHttp((req, res) => {
  const path = decodeURIComponent((req.url || '/').split('?')[0]);
  if (path === '/parity.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); return; }
  const file = resolve(frontend, '.' + path);
  if (!file.startsWith(frontend + sep) || !existsSync(file) || !statSync(file).isFile()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(file)] || 'application/octet-stream' });
  res.end(readFileSync(file));
});
const freePort = () => new Promise((done, reject) => {
  const s = createServer(); s.once('error', reject); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(e => e ? reject(e) : done(p)); });
});
const stop = async child => {
  if (!child?.pid) return;
  const exited = () => child.exitCode != null || child.signalCode != null;
  const waitForExit = () => new Promise(done => {
    if (exited()) { done(true); return; }
    const finish = () => { clearTimeout(timer); child.removeListener('exit', finish); done(exited()); };
    const timer = setTimeout(finish, 3000);
    child.once('exit', finish);
  });
  if (await waitForExit()) return;
  if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore', timeout: 5000 });
  else child.kill('SIGKILL');
  await waitForExit();
};

// runs in the page: a station of three rooms, BUILD MODE's edit sequence, and the exact comparison after every edit
function probe() {
  const SB = StationBake, IT = IndustrialTextures, rows = [];
  const doc = WorldModel.defaultDoc(1); doc.rooms = {}; doc.order = []; doc.props = []; doc.belts = {}; doc.edges = [];
  doc.meta.spawnRoomId = null; doc.meta.trunkRoomId = null;
  const room = (id, kind, rects, extra) => { doc.order.push(id); doc.rooms[id] = { id, name: '', kind, rects, floorStyle: 'hull', floorMat: 'alloy',
    wallStyle: 'hull', wallMat: 'ribbed', hullStyle: null, hullMat: null, floorPaint: {}, ...extra }; };
  room('a', 'hab', [{ x1: 0, y1: 0, x2: 24, y2: 12 }]);
  room('b', 'hab', [{ x1: 30, y1: 0, x2: 58, y2: 16 }], { hullMat: 'brick' });
  room('c', 'hab', [{ x1: 4, y1: 18, x2: 26, y2: 30 }], { hullMat: 'timber' });
  const st = WorldModel.create(doc);
  const plate = cv => (IT.baseLayers(cv)[0]) || null;
  const px = cv => cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  const diff = (a, b) => {
    if (!a && !b) return 0;
    if (!a || !b || a.width !== b.width || a.height !== b.height) return 1e9;
    const A = px(a), B = px(b); let n = 0;
    for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2] || A[i + 3] !== B[i + 3]) n++;
    return n;
  };
  const compare = (cache, geo) => {
    const fresh = SB.bakeIncremental(geo, null, null), out = { chunks: fresh.chunkMap.size, missing: 0, sizeOff: 0, base: 0, light: 0, plate: 0 };
    for (const [k, f] of fresh.chunkMap) {
      const c = cache.chunkMap.get(k);
      if (!c) { out.missing++; continue; }
      if (c.x !== f.x || c.y !== f.y || c.w !== f.w || c.h !== f.h) { out.sizeOff++; continue; }
      out.base += diff(c.baseCv, f.baseCv); out.light += diff(c.lightCv, f.lightCv); out.plate += diff(plate(c.baseCv), plate(f.baseCv));
    }
    return out;
  };
  let geo = st.projectGeometry(), cache = SB.bake(geo), last = null, keysBefore = [];
  const density = Number(document.documentElement.dataset.textureResolution);
  st.onChange(p => { last = p; });
  const step = (label, fn) => {
    last = null; const r = fn(); const p = last;
    geo = st.projectGeometry();
    if (p && (!p.staticBakeUnchanged || p.global)) cache = SB.bakeIncremental(geo, cache, p.global ? null : p.dirtyRects);
    // which chunks the edit baked, against the chunks its rects reach (plus any the floor grew that did not exist before)
    const reach = p && !p.global ? SB.dirtyChunks(geo, p.dirtyRects).map(d => d.cx + ',' + d.cy) : [];
    const baked = cache.stats ? cache.stats.dirtyChunks.filter(k => !reach.includes(k) && keysBefore.includes(k)) : [];
    keysBefore = [...cache.chunkMap.keys()];
    rows.push({ label, ok: !!(r && r.ok), W: geo.W, H: geo.H, chunked: !!cache.chunked, reset: !!(cache.stats && cache.stats.fullReset), bakedBeyondReach: baked, ...compare(cache, geo) });
  };
  step('rename a room (the first edit: chunks cut from the whole-station bake)', () => st.renameRoom('a', 'PARITY'));
  step('undo the rename', () => st.undo());
  step('a room past the south edge', () => st.addRoom({ kind: 'hab', rects: [{ x1: 2, y1: 34, x2: 9, y2: 39 }] }));   // (the edge row grows: AN EDGE CHUNK IS RESIZED, NOT RE-BAKED)
  step('undo it', () => st.undo());
  /* a room far below a corner, in its columns, beyond the reach of the corner's chunk: the corner's rects were grouped by the
     nearest wall standing below them however far it stood, so this room's north wall split them and the kept chunk (painted
     without it) disagreed with a fresh one (2026-10-14, 1 base + 5 plate px on the busy station's west column) */
  step('a room far below a corner, in its columns', () => st.addRoom({ kind: 'hab', rects: [{ x1: 26, y1: 42, x2: 30, y2: 46 }] }));
  step('undo that one', () => st.undo());
  step('a room past the east edge (the plate density changes)', () => st.addRoom({ kind: 'hab', rects: [{ x1: 63, y1: 2, x2: 74, y2: 8 }] }));
  step('a room past the north edge (the origin moves)', () => st.addRoom({ kind: 'hab', rects: [{ x1: 36, y1: -10, x2: 44, y2: -5 }] }));
  step('rename again', () => st.renameRoom('b', 'PARITY-2'));
  return { textures: IT.status(), density, whole: { stitched: !!SB.bake(st.projectGeometry()).stitched }, rows };
}

let chrome, cdp, profile, failed = false;
try {
  const httpPort = await freePort();
  await new Promise(done => server.listen(httpPort, '127.0.0.1', done));
  const port = await freePort(); profile = mkdtempSync(join(tmpdir(), 'starnet-plate-parity-'));
  chrome = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCDP(port);
  cdp.timeoutMs = 300000;
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/parity.html` });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    ready = await evalJS(cdp, `typeof StationBake !== 'undefined' && typeof IndustrialTextures !== 'undefined'`).catch(() => false);
    if (!ready) await sleep(250);
  }
  assert.ok(ready, 'the parity page loaded the bake');
  await evalJS(cdp, 'IndustrialTextures.ready.then(() => 1)');
  const result = await evalJS(cdp, '(' + probe.toString() + ')()');
  assert.ok(result.textures.loaded, 'the industrial textures loaded, so every bake paints a dense plate');
  assert.ok(result.density > 1.5 && !Number.isInteger(result.density), 'the plate density is fractional (got ' + result.density + ')');
  for (const r of result.rows) console.log(`  ${r.label}: ${r.W}x${r.H} chunks ${r.chunks} missing ${r.missing} size-off ${r.sizeOff} base ${r.base} light ${r.light} plate ${r.plate}${r.reset ? ' (reset)' : ''}${r.bakedBeyondReach.length ? ' baked beyond its reach: ' + r.bakedBeyondReach.join(' ') : ''}`);
  for (const r of result.rows) {
    assert.ok(r.ok, r.label + ': the edit applied');
    assert.ok(r.chunked, r.label + ': BUILD MODE holds a chunked bake after it');
    assert.deepEqual({ missing: r.missing, sizeOff: r.sizeOff, base: r.base, light: r.light, plate: r.plate },
      { missing: 0, sizeOff: 0, base: 0, light: 0, plate: 0 }, r.label + ': the kept bake is the fresh one, pixel for pixel');
    if (!r.reset) assert.deepEqual(r.bakedBeyondReach, [], r.label + ': it baked only the chunks its rects reach (an edge chunk the floor reshapes is resized, not baked)');
  }
  assert.ok(result.whole.stitched, 'a station wider than one chunk bakes as its chunks, stitched');
  console.log('stationbake.plate-parity: ' + result.rows.length + ' edits, kept bake == fresh bake (base, light, dense plate at ' + result.density + 'x)');
} catch (error) { failed = true; console.error(error.stack || error); }
finally {
  try { if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(2000)]); } catch { console.warn('stationbake.plate-parity: browser close interrupted; using process cleanup'); }
  try { cdp?.ws.close(); } catch (error) { console.warn('stationbake.plate-parity: CDP socket close:', error.message); }
  await stop(chrome);
  server.close();
  if (profile) {
    const rel = relative(resolve(tmpdir()), resolve(profile));
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.startsWith('starnet-plate-parity-'), 'cleanup stays inside the test temp directory');
    for (let attempt = 0; attempt < 50; attempt++) try { rmSync(profile, { recursive: true, force: true }); break; }
    catch (error) { if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 49) throw error; await sleep(200); }
  }
}
process.exit(failed ? 1 : 0);
