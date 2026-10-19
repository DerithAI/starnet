/* Real Canvas lock: a BUILD MODE chunk paints its own square, not the station around it (2026-10-14, the busy-station walk: a
   room edit froze BUILD MODE 0.4-2 s re-baking 384px chunks). Each chunk walks every wall, corner, doorway and hull column
   within the dirty reach of its square, and a quarter of its fillRects and over half of its drawImages landed wholly beside
   the canvas — painted, clipped away, paid for. The bake skips a draw that misses its canvas (a corner whose whole box does,
   a doorway reveal slice, a hull column, a side face, a floor tile off the canvas, a replayed crown rect), and nothing else:
   the pixels are the same (the kept bake still equals the fresh one, stationbake.plate-parity; a chunk set and its stitched
   floor were compared with the previous bake pixel for pixel on the busy station, the dev seed and a station of every
   material). This counts, in a real page with the industrial textures loaded, the draw calls a chunked bake makes whose
   destination misses the canvas they are made on.
   ...and a face strip the industrial atlas does not cover (glass, here) is rendered and read back once, not on every bake:
   the second bake of the same floor reads no strip back at all.
   ...and the light maps' dither readbacks (a GPU readback waits for every draw queued before it, the chunk's whole dense
   plate) run together after the call's last chunk, never between one chunk's walls and the next. */
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
  if (path === '/offcanvas.html') { res.writeHead(200, { 'content-type': 'text/html' }); res.end(page); return; }
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

// runs in the page: a station of nine rooms in every hull, wall and floor material family, corridors and alleys between them
function probe() {
  const SB = StationBake, WM = WorldModel;
  const doc = WM.defaultDoc(1); doc.rooms = {}; doc.order = []; doc.props = []; doc.belts = {}; doc.edges = [];
  doc.meta.spawnRoomId = null; doc.meta.trunkRoomId = null;
  const F = WM.MAT_ORDER, Wm = WM.WALL_ORDER, Hm = WM.HULL_ORDER;
  let n = 0;
  const room = (kind, rects) => { const id = 'r' + n, i = n++; doc.order.push(id);
    doc.rooms[id] = { id, name: kind === 'corridor' ? '' : 'R' + i, kind, rects, floorStyle: 'hull', floorMat: F[i % F.length], wallStyle: 'hull',
      wallMat: Wm[(i * 3) % Wm.length], hullStyle: null, hullMat: Hm[(i * 5) % Hm.length] === 'station' ? null : Hm[(i * 5) % Hm.length], floorPaint: {} }; };
  for (let gy = 0; gy < 3; gy++) for (let gx = 0; gx < 3; gx++) {
    const x = gx * 22, y = gy * 17, w = 13 + gx, h = 9 + (gx % 2) * 2;
    room('hab', [{ x1: x, y1: y, x2: x + w, y2: y + h }]);
    if (gx < 2) room('corridor', [{ x1: x + w + 1, y1: y + 3, x2: x + 21, y2: y + 5 }]);
  }
  doc.rooms.r0.wallMat = 'viewport'; doc.rooms.r4.wallMat = 'viewport';   // glass: the strip only the bake itself renders
  const st = WM.create(doc), geo = st.projectGeometry();
  const P = CanvasRenderingContext2D.prototype, orig = { fillRect: P.fillRect, drawImage: P.drawImage };
  const tally = { fillRect: [0, 0], drawImage: [0, 0] };
  const misses = (ctx, x, y, w, h) => {
    const m = ctx.getTransform(), cv = ctx.canvas;
    if (m.b || m.c) return false;
    const X0 = x * m.a + m.e, X1 = (x + w) * m.a + m.e, Y0 = y * m.d + m.f, Y1 = (y + h) * m.d + m.f;
    return Math.max(X0, X1) < 0 || Math.min(X0, X1) > cv.width || Math.max(Y0, Y1) < 0 || Math.min(Y0, Y1) > cv.height;
  };
  P.fillRect = function (x, y, w, h) { tally.fillRect[0]++; if (misses(this, x, y, w, h)) tally.fillRect[1]++; return orig.fillRect.call(this, x, y, w, h); };
  P.drawImage = function (...a) {
    tally.drawImage[0]++;
    const [x, y, w, h] = a.length === 3 ? [a[1], a[2], a[0].width, a[0].height] : a.length === 5 ? a.slice(1) : a.slice(5);
    if (misses(this, x, y, w, h)) tally.drawImage[1]++;
    return orig.drawImage.apply(this, a);
  };
  // a face strip is a 48px-wide canvas (STRIP_TILES tiles) read back once rendered; every readback of the first bake is
  // logged with the fillRects made since the one before, and the chunks' own light canvases are picked out after it
  const getImageData = P.getImageData, strips = [0, 0], fillRect = P.fillRect, reads = [];
  let drawsSince = 0;
  let pass = 0;
  P.getImageData = function (...a) {
    if (this.canvas.width === 48) strips[pass]++;
    if (pass === 0) { reads.push({ cv: this.canvas, draws: drawsSince }); drawsSince = 0; }
    return getImageData.apply(this, a);
  };
  P.fillRect = function (...a) { drawsSince++; return fillRect.apply(this, a); };
  let baked;
  try {
    baked = SB.bakeIncremental(geo, null, null);
    P.fillRect = orig.fillRect; P.drawImage = orig.drawImage;
    pass = 1; SB.bakeIncremental(geo, null, null);
  } finally { P.fillRect = orig.fillRect; P.drawImage = orig.drawImage; P.getImageData = getImageData; }
  const lightCvs = new Set([...baked.chunkMap.values()].map(c => c.lightCv)), lightReads = reads.map((r, i) => lightCvs.has(r.cv) ? i : -1).filter(i => i >= 0);
  const first = lightReads[0], lastRead = lightReads[lightReads.length - 1];
  const lights = { n: lightReads.length, drawsBetween: reads.slice(first + 1, lastRead + 1).reduce((m, r) => m + r.draws, 0) };
  return { textures: IndustrialTextures.status(), rooms: st.rooms().length, W: geo.W, H: geo.H, chunks: baked.chunkMap.size, tally, strips, lights };
}

let chrome, cdp, profile, failed = false;
try {
  const httpPort = await freePort();
  await new Promise(done => server.listen(httpPort, '127.0.0.1', done));
  const port = await freePort(); profile = mkdtempSync(join(tmpdir(), 'starnet-offcanvas-'));
  chrome = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check', '--mute-audio',
    '--remote-debugging-port=' + port, '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore', windowsHide: true });
  cdp = await connectCDP(port);
  cdp.timeoutMs = 300000;
  await cdp.send('Page.enable');
  await cdp.send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/offcanvas.html` });
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) {
    ready = await evalJS(cdp, `typeof StationBake !== 'undefined' && typeof IndustrialTextures !== 'undefined'`).catch(() => false);
    if (!ready) await sleep(250);
  }
  assert.ok(ready, 'the page loaded the bake');
  await evalJS(cdp, 'IndustrialTextures.ready.then(() => 1)');
  const r = await evalJS(cdp, '(' + probe.toString() + ')()');
  assert.ok(r.textures.loaded, 'the industrial textures loaded, so every bake paints a dense plate');
  assert.ok(r.chunks >= 4, 'the station bakes as several chunks (got ' + r.chunks + ')');
  const share = k => r.tally[k][1] / Math.max(1, r.tally[k][0]);
  console.log(`  ${r.rooms} rooms, ${r.W}x${r.H}, ${r.chunks} chunks: fillRect ${r.tally.fillRect[1]} of ${r.tally.fillRect[0]} off the canvas, drawImage ${r.tally.drawImage[1]} of ${r.tally.drawImage[0]}`);
  assert.ok(share('fillRect') < 0.08, 'a chunk bake makes few fillRects off its canvas (' + (share('fillRect') * 100).toFixed(1) + '%)');
  assert.ok(share('drawImage') < 0.08, 'a chunk bake makes few drawImages off its canvas (' + (share('drawImage') * 100).toFixed(1) + '%)');
  console.log('  face strips read back: ' + r.strips[0] + ' on the first bake, ' + r.strips[1] + ' on the second');
  assert.ok(r.strips[0] > 0, 'the first bake renders the face strips the floor needs');
  assert.equal(r.strips[1], 0, 'a second bake of the same floor renders and reads back no face strip again');
  console.log('  light-map dithers: ' + r.lights.n + ' readbacks, ' + r.lights.drawsBetween + ' fillRects between the first and the last');
  assert.equal(r.lights.n, r.chunks, 'every chunk dithers its light map once');
  assert.equal(r.lights.drawsBetween, 0, 'the dither readbacks run together after the last chunk, not between chunks');
  console.log('stationbake.offcanvas: a chunk bake paints its own square — ' + (share('fillRect') * 100).toFixed(1) + '% fillRect, ' + (share('drawImage') * 100).toFixed(1) + '% drawImage off the canvas');
} catch (error) { failed = true; console.error(error.stack || error); }
finally {
  try { if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(2000)]); } catch { console.warn('stationbake.offcanvas: browser close interrupted; using process cleanup'); }
  try { cdp?.ws.close(); } catch (error) { console.warn('stationbake.offcanvas: CDP socket close:', error.message); }
  await stop(chrome);
  server.close();
  if (profile) {
    const rel = relative(resolve(tmpdir()), resolve(profile));
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.startsWith('starnet-offcanvas-'), 'cleanup stays inside the test temp directory');
    for (let attempt = 0; attempt < 50; attempt++) try { rmSync(profile, { recursive: true, force: true }); break; }
    catch (error) { if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 49) throw error; await sleep(200); }
  }
}
process.exit(failed ? 1 : 0);
