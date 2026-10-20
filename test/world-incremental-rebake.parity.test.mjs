/* Real Canvas parity for the world's INCREMENTAL STATIC BAKE (perf, 2026-10-20). A room edit outside BUILD MODE now
   re-bakes only the chunks its dirty rects reach and stitches them back into the world's whole-station bake
   (world.js bakeEditedChunks: StationBake.bakeIncremental against the current bake + stitchWhole). The station must look
   exactly as it did when every edit re-baked the whole floor, so after each edit the chunk-baked floor is compared with a
   fresh whole bake of the same floor: every layer the world draws (base, dense art plate, light, interior) is drawn into
   a FRESH probe canvas and read back there — never the stage, never a canvas a frame loop draws — plus the fixture
   lists, door records, glass rects, nav lights and door occluders. The page loads the real industrial textures, and the
   station is wider than one chunk, so the world's bake is stitched (the only bake the incremental path continues).
   The world.js functions run here are lifted from the source, not re-implemented. */
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
const worldSrc = readFileSync(join(frontend, 'app/world.js'), 'utf8');
// the world's own decision, lifted by its function headers (brace-counted, like test/_assert.js fnBody)
function fnBody(src, header) {
  const start = src.indexOf(header); if (start < 0) return '';
  let i = src.indexOf('{', start), depth = 0;
  for (; i < src.length; i++) {
    const c = src[i], n = src[i + 1];
    if (c === '/' && n === '/') { i = src.indexOf('\n', i); continue; }
    if (c === '/' && n === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
    if (c === '"' || c === "'" || c === '`') { for (i++; i < src.length; i++) { if (src[i] === '\\') { i++; continue; } if (src[i] === c) break; } continue; }
    if (c === '{') depth++; else if (c === '}' && --depth === 0) return src.slice(start, i + 1);
  }
  return '';
}
const lifted = ['  function bakeKnobs()', '  function bakeEditedChunks(edits)'].map(h => fnBody(worldSrc, h));
assert.ok(lifted.every(s => s && s.length < 3000), 'world.js carries bakeKnobs + bakeEditedChunks');

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

// runs in the page: a station of three rooms, the edits a live floor takes outside BUILD MODE, and the exact comparison
function probe(liftedSrc) {
  const SB = StationBake, IT = IndustrialTextures, rows = [];
  const W = new Function('let geo = null, cache = null;\n' + liftedSrc + '\nreturn { set(g, c) { geo = g; cache = c; }, bakeKnobs, bakeEditedChunks };')();
  const doc = WorldModel.defaultDoc(1); doc.rooms = {}; doc.order = []; doc.props = []; doc.belts = {}; doc.edges = [];
  doc.meta.spawnRoomId = null; doc.meta.trunkRoomId = null;
  const room = (id, kind, rects, extra) => { doc.order.push(id); doc.rooms[id] = { id, name: '', kind, rects, floorStyle: 'hull', floorMat: 'alloy',
    wallStyle: 'hull', wallMat: 'ribbed', hullStyle: null, hullMat: null, floorPaint: {}, ...extra }; };
  room('a', 'hab', [{ x1: 0, y1: 0, x2: 24, y2: 12 }]);
  room('b', 'hab', [{ x1: 30, y1: 0, x2: 58, y2: 16 }], { hullMat: 'brick' });
  room('c', 'hab', [{ x1: 4, y1: 18, x2: 26, y2: 30 }], { hullMat: 'timber' });
  const st = WorldModel.create(doc);
  // every comparison reads a FRESH probe canvas the layer is drawn into — never the bake's own canvas, never a stage
  const probePx = cv => {
    if (!cv) return null;
    const c = document.createElement('canvas'); c.width = cv.width; c.height = cv.height;
    const g = c.getContext('2d'); g.imageSmoothingEnabled = false; g.drawImage(cv, 0, 0);
    return g.getImageData(0, 0, c.width, c.height).data;
  };
  const diff = (a, b) => {
    if (!a && !b) return 0;
    if (!a || !b || a.width !== b.width || a.height !== b.height) return 1e9;
    const A = probePx(a), B = probePx(b); let n = 0;
    for (let i = 0; i < A.length; i += 4) if (A[i] !== B[i] || A[i + 1] !== B[i + 1] || A[i + 2] !== B[i + 2] || A[i + 3] !== B[i + 3]) n++;
    return n;
  };
  const plate = cv => (IT.baseLayers(cv)[0]) || null;
  const lists = b => JSON.stringify([b.flickers, b.lamps, b.wallFixtures, b.navLights, b.doorRecords, b.glassRects, b.W, b.H, b.origin, b.viewport,
    (b.doorOccluders || []).map(d => [d.x, d.y, d.w, d.h, d.sortY])]);
  const compare = (got, want) => ({
    base: diff(got.baseCv, want.baseCv), plate: diff(plate(got.baseCv), plate(want.baseCv)), light: diff(got.lightCv, want.lightCv),
    interior: diff(got.interiorCv, want.interiorCv),
    occluders: (got.doorOccluders || []).reduce((n, d, i) => n + diff(d.image, ((want.doorOccluders || [])[i] || {}).image), 0),
    lists: lists(got) === lists(want), stitched: !!got.stitched
  });
  let geo = st.projectGeometry(), cache = SB.bake(geo), knobs = (W.set(geo, cache), W.bakeKnobs()), last = null;
  st.onChange(p => { last = p; });
  const step = (label, fn) => {
    last = null; const r = fn(); const p = last;
    const prev = geo; geo = st.projectGeometry();
    const sameFrame = prev.W === geo.W && prev.H === geo.H && prev.origin.tx === geo.origin.tx && prev.origin.ty === geo.origin.ty;
    W.set(geo, cache);
    const t0 = performance.now();
    const inc = (p && !p.global && (p.dirtyRects || []).length) ? W.bakeEditedChunks({ base: cache, rects: p.dirtyRects.slice(), knobs }) : null;
    const incMs = performance.now() - t0, t1 = performance.now();
    const fresh = SB.bake(geo);
    const wholeMs = performance.now() - t1;
    rows.push({ label, ok: !!(r && r.ok), bakeEdit: !!(p && !p.staticBakeUnchanged), sameFrame, took: !!inc, incMs, wholeMs, rects: p ? p.dirtyRects.length : 0,
      chunksBaked: inc ? (SB.dirtyChunks(geo, p.dirtyRects) || []).length : 0, ...(inc ? compare(inc, fresh) : {}) });
    cache = inc || fresh; W.set(geo, cache); knobs = W.bakeKnobs();
  };
  const other = (table, cur) => Object.keys(table).find(k => k !== cur);
  step('rename a room', () => st.renameRoom('a', 'PARITY'));
  step('repaint a room\'s floor', () => st.setFloor('b', other(st.FLOOR_STYLES, 'hull')));
  step('a room\'s deck material', () => st.setMaterial('c', other(st.FLOOR_MATERIALS, 'alloy')));
  step('a room\'s walls', () => st.setWalls('a', { mat: other(st.WALL_MATERIALS, 'ribbed') }));
  step('paint three tiles', () => st.paintTiles('c', [[6, 20], [7, 20], [8, 21]], other(st.FLOOR_STYLES, 'hull')));
  step('a room inside the frame', () => st.addRoom({ kind: 'hab', rects: [{ x1: 34, y1: 21, x2: 46, y2: 28 }] }));
  step('undo it', () => st.undo());
  step('resize a room inside the frame', () => st.resizeRoom('c', { x1: 4, y1: 18, x2: 22, y2: 30 }));
  step('undo the resize', () => st.undo());
  step('rename again', () => st.renameRoom('b', 'PARITY-2'));
  return { textures: IT.status(), whole: !!SB.bake(st.projectGeometry()).stitched, rows };
}

let chrome, cdp, profile, failed = false;
try {
  const httpPort = await freePort();
  await new Promise(done => server.listen(httpPort, '127.0.0.1', done));
  const port = await freePort(); profile = mkdtempSync(join(tmpdir(), 'starnet-world-rebake-'));
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
  const result = await evalJS(cdp, '(' + probe.toString() + ')(' + JSON.stringify(lifted.join('\n')) + ')');
  assert.ok(result.textures.loaded, 'the industrial textures loaded, so every bake paints a dense plate');
  assert.ok(result.whole, 'the station is wider than one chunk, so the world bake is stitched');
  for (const r of result.rows) console.log(`  ${r.label}: ${r.took ? `chunks ${r.chunksBaked} in ${r.incMs.toFixed(0)} ms vs whole ${r.wholeMs.toFixed(0)} ms · base ${r.base} plate ${r.plate} light ${r.light} interior ${r.interior} occluders ${r.occluders} lists ${r.lists ? 'same' : 'DIFFER'}` : 'whole bake'}`);
  for (const r of result.rows) {
    assert.ok(r.ok && r.bakeEdit && r.sameFrame, r.label + ': the edit applied, is a bake edit, and kept the frame');
    assert.ok(r.took, r.label + ': the world re-baked only its chunks (the path under test was taken)');
    assert.deepEqual({ base: r.base, plate: r.plate, light: r.light, interior: r.interior, occluders: r.occluders, lists: r.lists, stitched: r.stitched },
      { base: 0, plate: 0, light: 0, interior: 0, occluders: 0, lists: true, stitched: true }, r.label + ': the chunk-baked floor is the whole bake, pixel for pixel');
  }
  console.log('world-incremental-rebake.parity: ' + result.rows.length + ' live-floor edits, chunk-baked floor == whole bake (base, dense plate, light, interior, occluders, lists)');
} catch (error) { failed = true; console.error(error.stack || error); }
finally {
  try { if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(2000)]); } catch { console.warn('world-incremental-rebake.parity: browser close interrupted; using process cleanup'); }
  try { cdp?.ws.close(); } catch (error) { console.warn('world-incremental-rebake.parity: CDP socket close:', error.message); }
  await stop(chrome);
  server.close();
  if (profile) {
    const rel = relative(resolve(tmpdir()), resolve(profile));
    assert.ok(rel && !rel.startsWith('..') && !isAbsolute(rel) && rel.startsWith('starnet-world-rebake-'), 'cleanup stays inside the test temp directory');
    for (let attempt = 0; attempt < 50; attempt++) try { rmSync(profile, { recursive: true, force: true }); break; }
    catch (error) { if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 49) throw error; await sleep(200); }
  }
}
process.exit(failed ? 1 : 0);
