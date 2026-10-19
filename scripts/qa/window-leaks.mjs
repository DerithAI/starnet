#!/usr/bin/env node
// window-leaks.mjs — do closed windows and the art pack give their memory back? (night-leak, 2026-10-15)
//
// The 10-15 soak found a dock sweep left every closed window alive (SETTINGS 3,509 elements, CONNECT 8,762, MY WORK 696,
// AUTOMATE, two replaced SETTINGS panes) and a one-room station holding 445-738 MB of canvases, most of them texture-pack
// materials it never drew. This probe boots a hermetic SKYNET_DEV sidecar over a COPY of a station's shape (--station dir: a
// folder holding agent.save / agent.roster / _commander.dossier json; default the dev seed fixture; never the real station:
// every home dir — APPDATA, LOCALAPPDATA, HOME, XDG, HERMES_HOME — is a scratch dir under --out) in ONE headless Chrome
// (--disable-gpu unless --gpu), and reads:
//   1. ART   — canvases alive after boot (Runtime.queryObjects on HTMLCanvasElement + OffscreenCanvas: count, total MB, the
//              biggest sizes) and IndustrialTextures.status() (materials loaded, rasters held).
//   2. CLOSE — --sweeps passes that open every station window (StationUI.openTerm) and close it by its ✕, then a forced GC and
//              every DETACHED tree still alive (queryObjects on Node.prototype → the roots of disconnected trees), largest first.
//   3. AGAIN — the same canvas read after the sweeps (a window must not leave canvases behind either).
// Exit 1 when a detached tree holds more than --max-root elements (default 30), or the canvases exceed --max-canvas-mb (off by
// default). Read-only towards everything but its own scratch station; stops only the processes it started, by their own PIDs.
//
// Usage: node scripts/qa/window-leaks.mjs [--station dir] [--port 9861] [--cdp 19861] [--out dir] [--sweeps 3] [--max-root 30]
//        [--max-canvas-mb N] [--keys settings,connectors,…] [--json file] [--gpu] [--attach (use a station already on --port)]
//        [--snapshot file.heapsnapshot (tag the trees over --max-root as LeakTag and write a heap snapshot)]
//        [--repaints N (background repaints per open window, StationUI.rerender(key, false))]
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { mkdirSync, rmSync, cpSync, readFileSync, writeFileSync, existsSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';

const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes(k);
const repo = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { connectCDP, evalJS, sleep, findChrome } = await import(pathToFileURL(join(repo, 'scripts/lib/cdp.mjs')).href);
const { waitUp, waitDevReady } = await import(pathToFileURL(join(repo, 'scripts/lib/seed.mjs')).href);
const port = Number(arg('--port', '9861')), cdpPort = Number(arg('--cdp', '19861'));
const sweeps = Number(arg('--sweeps', '3')), repaints = Number(arg('--repaints', '0')), maxRoot = Number(arg('--max-root', '30')), maxCanvasMB = Number(arg('--max-canvas-mb', '0'));
const station = resolve(arg('--station', join(repo, 'dev/fixtures/seed-workspace')));
const OUT = resolve(arg('--out', join(tmpdir(), 'starnet-window-leaks')));
const KEYS = (arg('--keys', 'settings,connectors,deliverables,tasks,workflows,automation,messaging,notifs,quests,manual,updates,commander,trophies')).split(',').filter(Boolean);
const APP_URL = `http://127.0.0.1:${port}/`;
const scratch = join(OUT, '_ws-' + port), profile = join(OUT, '_profile-' + cdpPort), home = join(OUT, '_home-' + port);
let side = null, chrome = null;

function bootStation() {
  for (const d of [scratch, profile, home]) rmSync(d, { recursive: true, force: true });
  mkdirSync(scratch, { recursive: true });
  // only the station's SHAPE travels: save, roster, dossier — never secrets, journals or checkpoints; a Codex/Claude crew is moved
  // onto a placeholder OpenRouter model so no CLI is ever spawned (this probe sends no runs)
  for (const f of readdirSync(station)) if (/^(agent\.save|agent\.roster|_commander\.dossier)\.json$/.test(f)) {
    let txt = readFileSync(join(station, f), 'utf8')
      .replace(/"(provider|prov)":\s*"(codex|claude-cli|claude)"/g, '"$1": "openrouter"');
    if (f === 'agent.save.json') { try { const w = JSON.parse(txt), now = Date.now(); w.updatedAt = now; w.savedAt = now; if (w.doc) w.doc.updatedAt = now; txt = JSON.stringify(w); } catch (_) {} }
    writeFileSync(join(scratch, f), txt);
  }
  for (const d of ['appdata', 'local', 'home', 'xdg', 'hermes', 'tmp']) mkdirSync(join(home, d), { recursive: true });
  const env = {};
  for (const [k, v] of Object.entries(process.env)) if (!/^(CLAUDE|ANTHROPIC|OPENAI|OPENROUTER|STARNET|SKYNET|HERMES|CODEX|NODE_OPTIONS|SEED_)|KEY|TOKEN|SECRET|PASSWORD/i.test(k)) env[k] = v;
  Object.assign(env, { SKYNET_DEV: '1', SKYNET_FULL_ACCESS: '1', SKYNET_WORKSPACES: scratch, SKYNET_PORT: String(port), PORT: String(port),
    APPDATA: join(home, 'appdata'), LOCALAPPDATA: join(home, 'local'), HOME: join(home, 'home'), USERPROFILE: join(home, 'home'),
    XDG_DATA_HOME: join(home, 'xdg'), HERMES_HOME: join(home, 'hermes'), CODEX_HOME: join(home, 'home', '.codex'),
    CLAUDE_CONFIG_DIR: join(home, 'home', '.claude'), TEMP: join(home, 'tmp'), TMP: join(home, 'tmp'),
    SKYNET_DEFAULT_MODEL: 'anthropic/claude-sonnet-4.6', SKYNET_OPENROUTER_KEY: 'sk-or-window-leaks-placeholder' });
  side = spawn(process.execPath, [join(repo, 'sidecar/index.js')], { cwd: repo, stdio: 'ignore', env, windowsHide: true });
  console.log('sidecar pid', side.pid, 'port', port, 'workspace', scratch);
}

// run fn over every live object of a prototype (queryObjects GCs first); the handles are released right after
async function overObjects(cdp, protoExpr, fn, args) {
  const proto = await cdp.send('Runtime.evaluate', { expression: protoExpr, objectGroup: 'leaks' });
  if (!proto.result || !proto.result.objectId) return null;
  const q = await cdp.send('Runtime.queryObjects', { prototypeObjectId: proto.result.objectId, objectGroup: 'leaks' });
  const r = await cdp.send('Runtime.callFunctionOn', { objectId: q.objects.objectId, functionDeclaration: fn.toString(), returnByValue: true, objectGroup: 'leaks', arguments: (args || []).map(value => ({ value })) });
  await cdp.send('Runtime.releaseObjectGroup', { objectGroup: 'leaks' });
  if (r.exceptionDetails) throw new Error('probe threw: ' + (r.exceptionDetails.exception?.description || r.exceptionDetails.text));
  return r.result.value;
}
function canvasTally() {
  let n = 0, px = 0; const sizes = {};
  for (const c of this) {
    let w, h; try { w = c.width || 0; h = c.height || 0; } catch (_) { continue; }   // a prototype in the list, not a canvas
    n++; px += w * h; const k = w + 'x' + h; sizes[k] = (sizes[k] || 0) + 1;
  }
  const top = Object.entries(sizes).map(([k, c]) => { const [w, h] = k.split('x').map(Number); return { size: k, count: c, mb: +(w * h * 4 * c / 1048576).toFixed(1) }; })
    .sort((a, b) => b.mb - a.mb).slice(0, 8);
  return { count: n, mb: +(px * 4 / 1048576).toFixed(1), top, sizes };
}
function detachedRoots() {
  const roots = new Map();
  for (const n of this) {
    // the list also holds the prototypes that inherit from Node.prototype (Element.prototype …): reading them throws
    let r;
    try { if (!n || n.nodeType !== 1 || n.isConnected) continue; r = n; while (r.parentNode) r = r.parentNode; } catch (_) { continue; }
    if (r.nodeType === 9 || r.nodeType === 11) continue;   // another document (an SVG image, a parser doc) or a template's fragment
    roots.set(r, (roots.get(r) || 0) + 1);
  }
  const label = r => {
    const cls = typeof r.className === 'string' ? r.className : (r.className && r.className.baseVal) || '';
    const head = r.querySelector && r.querySelector('[id^="term-title-"], .term-title, .gd-title, h2, h3, h4');
    return (r.nodeName.toLowerCase() + (r.id ? '#' + r.id : '') + (cls ? '.' + cls.trim().split(/\s+/).slice(0, 3).join('.') : '')).slice(0, 80) +
      (head ? ' «' + String(head.textContent || '').trim().slice(0, 30) + '»' : '');
  };
  return [...roots].map(([r, n]) => ({ elements: n, root: label(r) })).sort((a, b) => b.elements - a.elements).slice(0, 25);
}
// --snapshot: tag every detached tree over the limit (root.__leakTag = new LeakTag(label)) and write a heap snapshot, so the
// retaining path of each can be read (DevTools › Memory › load it, search LeakTag; or scripts that walk the snapshot's edges)
function tagRoots(limit) {
  const LeakTag = window.LeakTag || (window.LeakTag = class LeakTag { constructor(label, elements) { this.label = label; this.elements = elements; } });
  const roots = new Map();
  for (const n of this) { let r; try { if (!n || n.nodeType !== 1 || n.isConnected) continue; r = n; while (r.parentNode) r = r.parentNode; if (r.nodeType === 9 || r.nodeType === 11) continue; } catch (_) { continue; } roots.set(r, (roots.get(r) || 0) + 1); }
  let tagged = 0;
  for (const [r, n] of roots) if (n > limit) { const t = r.querySelector && r.querySelector('[id^="term-title-"]'); r.__leakTag = new LeakTag((r.className || r.nodeName) + (t ? ' «' + t.textContent.trim() + '»' : ''), n); tagged++; }
  return tagged;
}
async function snapshotTo(cdp, file) {
  const chunks = [];
  const onChunk = p => chunks.push(p.chunk);
  cdp.on('HeapProfiler.addHeapSnapshotChunk', onChunk);
  await cdp.send('HeapProfiler.takeHeapSnapshot', { reportProgress: false, captureNumericValue: false });
  writeFileSync(file, chunks.join(''));
  return chunks.reduce((s, c) => s + c.length, 0);
}
const art = async cdp => ({
  canvases: await overObjects(cdp, 'HTMLCanvasElement.prototype', canvasTally),
  offscreen: await overObjects(cdp, 'typeof OffscreenCanvas !== "undefined" ? OffscreenCanvas.prototype : null', canvasTally),
  textures: await evalJS(cdp, `(() => { try { const s = IndustrialTextures.status(); return { loaded: s.loaded, assets: s.assets.length, failed: s.failed, rasters: s.rasters || null }; } catch (e) { return String(e); } })()`),
  dom: await cdp.send('Memory.getDOMCounters').catch(() => null),
});

try {
  if (!flag('--attach')) bootStation();
  if (!(await waitUp(APP_URL, 120))) throw new Error('sidecar never came up on ' + APP_URL);
  mkdirSync(profile, { recursive: true });
  chrome = spawn(findChrome(), ['--headless=new', ...(flag('--gpu') ? [] : ['--disable-gpu']), '--no-sandbox', '--no-first-run', '--no-default-browser-check',
    '--mute-audio', '--js-flags=--expose-gc', `--remote-debugging-port=${cdpPort}`, '--window-size=1600,900', `--user-data-dir=${profile}`, 'about:blank'],
    { stdio: 'ignore', windowsHide: true });
  console.log('chrome pid', chrome.pid, 'cdp', cdpPort, flag('--gpu') ? '(gpu)' : '(--disable-gpu)');
  const cdp = await connectCDP(cdpPort);
  cdp.timeoutMs = 600000;
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable'); await cdp.send('HeapProfiler.enable');
  await cdp.send('Emulation.setFocusEmulationEnabled', { enabled: true }).catch(() => {});
  const errors = [];
  cdp.on('Runtime.exceptionThrown', p => errors.push((p.exceptionDetails?.exception?.description || p.exceptionDetails?.text || 'exception').slice(0, 300)));
  await cdp.send('Page.navigate', { url: APP_URL });
  if (!(await waitDevReady(cdp, evalJS, { tries: 90, url: APP_URL }))) throw new Error('never reached the floor');
  // the boot finishes when the art pack has settled and the world has baked with it
  await evalJS(cdp, `(typeof IndustrialTextures !== 'undefined' ? (IndustrialTextures.settled ? IndustrialTextures.settled() : IndustrialTextures.ready) : null)`).catch(() => null);
  await evalJS(cdp, `(typeof PropRemaster !== 'undefined' && PropRemaster.ready ? PropRemaster.ready.then(() => 1) : 1)`).catch(() => null);
  await sleep(8000);
  await cdp.send('HeapProfiler.collectGarbage');
  const booted = await art(cdp);
  console.log('\n-- ART after boot');
  console.log('  canvases', booted.canvases.count, '·', booted.canvases.mb, 'MB  ·  offscreen', booted.offscreen ? booted.offscreen.count + ' · ' + booted.offscreen.mb + ' MB' : 'n/a');
  for (const t of booted.canvases.top) console.log('   ', t.size.padEnd(12), 'x' + t.count, t.mb + ' MB');
  console.log('  texture pack', JSON.stringify(booted.textures));
  console.log('  DOM', JSON.stringify(booted.dom));

  const opened = {};
  for (let s = 0; s < sweeps; s++) {
    for (const key of KEYS) {
      const ok = await evalJS(cdp, `(() => { try { StationUI.openTerm(${JSON.stringify(key)}); } catch (e) { return 'threw ' + e.message; } return [...document.querySelectorAll('.term')].filter(t => t.offsetWidth).length; })()`);
      await sleep(1400);
      // --repaints: the live data pokes a window takes while it is open (StationUI.rerender(key, false) — a background repaint
      // replaces the window's panes; the replaced ones must die with it)
      for (let r = 0; r < repaints; r++) { await evalJS(cdp, `(() => { try { StationUI.rerender(${JSON.stringify(key)}, false); } catch (_) {} return 1; })()`); await sleep(350); }
      // close every visible window by its own ✕ (the real close path, unsaved-draft guard included)
      let closed = 0;
      for (let i = 0; i < 6; i++) {
        const left = await evalJS(cdp, `(() => { const t = [...document.querySelectorAll('.term')].filter(t => t.offsetWidth && !t.classList.contains('term-closing')).sort((a, b) => (+getComputedStyle(b).zIndex || 0) - (+getComputedStyle(a).zIndex || 0))[0];
          if (!t) return 0; const x = t.querySelector('.term-x'); if (x) x.click(); else document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); return 1; })()`);
        if (!left) break;
        closed++; await sleep(500);
      }
      opened[key] = opened[key] || { opens: 0, closes: 0, res: null };
      opened[key].opens++; opened[key].closes += closed; opened[key].res = ok;
    }
  }
  console.log('\n-- CLOSE: ' + sweeps + ' sweeps over ' + KEYS.length + ' windows');
  for (const [k, v] of Object.entries(opened)) console.log('   ', k.padEnd(13), 'opened', v.opens, 'closed', v.closes, typeof v.res === 'string' ? v.res : '');
  await sleep(4000);
  await cdp.send('HeapProfiler.collectGarbage'); await sleep(500); await cdp.send('HeapProfiler.collectGarbage');
  const detached = await overObjects(cdp, 'Node.prototype', detachedRoots);
  const total = detached.reduce((s, d) => s + d.elements, 0);
  console.log('  detached trees alive after GC:', detached.length, '·', total, 'elements');
  for (const d of detached.slice(0, 12)) console.log('   ', String(d.elements).padStart(6), d.root);
  if (arg('--snapshot')) {
    const tagged = await overObjects(cdp, 'Node.prototype', tagRoots, [maxRoot]);
    const bytes = tagged ? await snapshotTo(cdp, resolve(arg('--snapshot'))) : 0;
    console.log('  heap snapshot:', tagged ? tagged + ' tagged tree(s), ' + (bytes / 1048576).toFixed(0) + ' MB → ' + resolve(arg('--snapshot')) : 'nothing over the limit, none taken');
  }
  const after = await art(cdp);
  console.log('\n-- ART after the sweeps');
  console.log('  canvases', after.canvases.count, '·', after.canvases.mb, 'MB  ·  DOM', JSON.stringify(after.dom));
  const worst = detached[0] ? detached[0].elements : 0;
  const fails = [];
  if (worst > maxRoot) fails.push('a closed window is still alive: ' + detached[0].root + ' holds ' + worst + ' elements (max ' + maxRoot + ')');
  if (maxCanvasMB > 0 && booted.canvases.mb > maxCanvasMB) fails.push('canvases after boot ' + booted.canvases.mb + ' MB > ' + maxCanvasMB + ' MB');
  console.log('\npage exceptions:', errors.length ? errors.slice(0, 6).join(' | ') : 'none');
  console.log(fails.length ? 'WINDOW-LEAKS: FAIL\n  ' + fails.join('\n  ') : 'WINDOW-LEAKS: PASS (largest detached tree ' + worst + ' elements)');
  if (arg('--json')) writeFileSync(resolve(arg('--json')), JSON.stringify({ booted, opened, detached, after, errors: errors.slice(0, 20), fails }, null, 1));
  process.exitCode = fails.length ? 1 : 0;
  cdp.ws.close();
} catch (e) { console.error('FAILED', e && e.stack || e); process.exitCode = 2; }
finally {
  // stop only what this run started, by its own handle (Chrome's children outlive its browser process on Windows: the whole tree)
  try { if (chrome) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(chrome.pid), '/T', '/F'], { stdio: 'ignore' }); else chrome.kill(); } } catch (_) {}
  try { if (side) { if (process.platform === 'win32') spawnSync('taskkill', ['/PID', String(side.pid), '/T', '/F'], { stdio: 'ignore' }); else side.kill(); } } catch (_) {}
}
