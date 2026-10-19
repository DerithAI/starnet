/* test/workflow-panel-done-reframe.test.js — DONE must not bury the line under the Build Library (0.13.5 live, s1-hand r05/r05b).

   The live bug: open the Workflow panel on a line → the library MINIMIZES and the floor frames the line in the glass left of the
   panel (frameLineOnFloor, against the minimized-kit insets) → ✓ DONE (or ✕, or Escape) → the library springs back open over the
   left of the screen, on top of the INBOX + BAY just edited, and the camera never moved (out-r05b-naming.json occAfterDone: INBOX hit
   BUTTON.refit-hotslot, BAY hit DIV.refit-palette).

   This drives build.js's REAL host seam — wfHost() sliced out of frontend/app/build.js with toggleKit, viewInsets, lineOfProp and the
   camera framers — through the REAL panel close() (sliced from frontend/app/workflowpanel.js), over a stub DOM whose rects are the
   live run's (1440×900, library 14..448, collapsed library 64..387 tall, panel 807..1425). It asserts what the Commander sees:
     · after DONE no machine of the line it was editing sits under the RESTORED library's rect, and the camera only panned (zoom never
       grows); a lone BAY (on no line yet) gets the same courtesy; the narrow-screen bottom sheet too
     · a line already clear of the library is never moved; a line the Commander panned OFF the glass themselves stays where they put
       it; a library the Commander reopened themselves (OPEN KIT) mid-panel is not "restored" by DONE, so nothing moves; closing BUILD
       MODE itself moves nothing
     · the move is a CAMERA move only: no StationBake call, no geometry projection, no plan compile, no rebake / fitCamera, no bake
       flag raised (StationBake.bake is ~2.5 s on a big station — a pan must never pay it). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const build = rd('frontend/app/build.js'), panel = rd('frontend/app/workflowpanel.js');

/* ---------- the slices ---------- */
const slice = (src, header, max) => { const b = A.fnBody(src, header); A.ok(b.length > 20 && b.length < (max || 20000), 'sliced ' + header + ' (' + b.length + ' chars)'); return b; };
const one = (re, what) => { const m = build.match(re); A.ok(!!m, 'found ' + what); return m ? m[0] : ''; };
// the camera framers live together, from focusPropOnFloor to the panel's floor marks (whatever helpers sit between them come along)
const camFrom = build.indexOf('function focusPropOnFloor('), camTo = build.indexOf('function drawWorkflowMarks(');
const camera = camFrom > 0 && camTo > camFrom ? build.slice(camFrom, camTo) : '';
A.ok(camera.length > 200 && camera.length < 12000, 'sliced the camera framers (' + camera.length + ' chars)');
const buildScript = [
  "'use strict';",
  one(/const MINZ = [^\n;]+;/, 'MINZ/MAXZ'),
  one(/const T = \(\) => [^\n;]+;/, 'T()'),
  one(/const clamp = \(v, a, b\) => [^\n;]+;/, 'clamp()'),
  slice(build, 'function toggleKit(collapsed)'),
  slice(build, 'function viewInsets()'),
  slice(build, 'function lineOfProp(propId)'),
  camera,
  slice(build, 'function wfHost()'),
  '({ host: wfHost(), toggleKit: () => toggleKit() })'
].join('\n');
const closeSrc = slice(panel, 'function close()', 4000);

/* ---------- a stub DOM with the live run's rects ---------- */
const rect = (l, t, r, b) => ({ left: l, top: t, right: r, bottom: b, width: r - l, height: b - t, x: l, y: t });
function classList(init) {
  const s = new Set(init);
  return { contains: c => s.has(c), add: c => { s.add(c); }, remove: c => { s.delete(c); },
    toggle: (c, on) => { const v = on === undefined ? !s.has(c) : !!on; if (v) s.add(c); else s.delete(c); return v; } };
}
const DESK = { W: 1440, H: 900, narrow: false, top: rect(0, 0, 1440, 52), dockOpen: rect(14, 64, 448, 886), dockMin: rect(14, 64, 448, 387), panel: rect(807, 68, 1425, 818) };
const NARROW = { W: 390, H: 800, narrow: true, top: rect(0, 0, 390, 52), dockOpen: rect(10, 406, 380, 790), dockMin: rect(10, 742, 380, 790), panel: rect(0, 420, 390, 800) };
// the r04/r05 line: INBOX p31 → BAY p32 → OUTBOX p33, 2×2 each, on row 4; and a lone BAY p40 on no line
const PROPS = [
  { id: 'p31', t: 'intake', x: 3, y: 4, w: 2, h: 2 }, { id: 'p32', t: 'bay', x: 7, y: 4, w: 2, h: 2 }, { id: 'p33', t: 'outbox', x: 11, y: 4, w: 2, h: 2 },
  { id: 'p40', t: 'bay', x: 5, y: 9, w: 2, h: 2 }
];
const LINE = { key: 'p31', props: ['p31', 'p32', 'p33'], bbox: { x1: 3, y1: 4, x2: 12, y2: 5 } };

function rig(G, cam) {
  const n = { bake: 0, bakeIncremental: 0, missingVisibleChunks: 0, projectGeometry: 0, compileRoutingPlan: 0, lineComponents: 0, rebake: 0, fitCamera: 0, resize: 0 };
  const spy = k => () => { n[k]++; return null; };
  const state = { panelOpen: false };
  const dock = { classList: classList(['refit-dock']), getBoundingClientRect: () => (dock.classList.contains('is-collapsed') ? G.dockMin : G.dockOpen) };
  const kitBtn = { textContent: '', setAttribute() {} };
  const wfPanel = { getBoundingClientRect: () => G.panel };
  const root = { querySelector: s => s === '.refit-dock' ? dock : s === '.refit-top' ? { getBoundingClientRect: () => G.top } : s === '#refit-kit-toggle' ? kitBtn : s === '.wf-panel' ? (state.panelOpen ? wfPanel : null) : null,
    querySelectorAll: () => [] };
  const cv = { width: G.W, height: G.H, getBoundingClientRect: () => rect(0, 0, G.W, G.H) };
  const station = { TILE: 24, propById: id => PROPS.find(p => p.id === id) || null, props: () => PROPS, projectGeometry: spy('projectGeometry') };
  const stub = () => null;
  const ctx = vm.createContext({
    console, Math, Object, Array, String, Number, JSON, Date, Promise, Intl,
    window: { matchMedia: () => ({ matches: G.narrow }) },
    root, cv, station, cacheGeo: { origin: { tx: 0, ty: 0 } }, valComps: [LINE], valPlan: null,
    running: true, insMemo: null, bakeDirty: false, planDirty: false,
    zoom: cam.zoom, panX: cam.panX, panY: cam.panY,
    wfHighlightId: null, wfPaused: null, wfHostMemo: null, wfKitAuto: false, wfShownPart: null,
    bumpUi() {}, updateSafetyClearance() {},
    StationBake: { bake: spy('bake'), bakeIncremental: spy('bakeIncremental'), missingVisibleChunks: spy('missingVisibleChunks') },
    Pipeline: { compileRoutingPlan: spy('compileRoutingPlan'), lineComponents: spy('lineComponents') },
    rebake: spy('rebake'), fitCamera: spy('fitCamera'), resize: spy('resize'),
    // wfHost()'s eagerly-read members (shorthand / renamed functions): stubs — this test only drives the camera + kit seams
    lineNameOf: stub, agentLabelFor: stub, esc: s => String(s), sfx: stub, valWhy: stub, summonForRole: stub, stepPositionOf: stub,
    finApi: stub, loopRuleTxt: stub, loopBackTxt: stub
  });
  const api = vm.runInContext(buildScript, ctx);
  const H = api.host;
  let shown = null;   // the part the panel is showing (its S.sel)
  // the panel's own open() order: mount() (appends .wf-panel, then H.panelShown(true)) → H.highlight(part) → frame the new line, or
  // (a part on no line) focus it only if the panel now hides it — exactly what WorkflowPanel.open does for a floor click
  function open(partId) {
    shown = partId;
    state.panelOpen = true; H.panelShown(true);
    H.highlight(partId);
    const c = H.lineOfProp(partId);
    if (c) H.frameLine(c.key); else H.focusProp(partId, true);
  }
  // the panel's REAL close(): DONE (#wf-done), ✕ (#wf-close) and Escape all land here
  function close() {
    const c = shown && H.lineOfProp(shown);
    const pctx = vm.createContext({ console, Date, H, S: { lineKey: c ? c.key : null, sel: shown, lone: c ? null : shown, note: null, ltTimer: 0, closing: false },
      el: { remove() { state.panelOpen = false; } }, saveOpenFields() {}, stopPoll() {}, todayTimer: 0, noteTimer: 0, NOTE_FRESH_MS: 2000,
      clearInterval() {}, clearTimeout() {} });
    vm.runInContext(closeSrc + '\nclose();', pctx);
    A.ok(!state.panelOpen, 'the real close() took the panel off the glass');
  }
  const camNow = () => ({ zoom: ctx.zoom, panX: ctx.panX, panY: ctx.panY });
  const screen = id => { const p = PROPS.find(q => q.id === id), t = 24; return rect(p.x * t * ctx.zoom + ctx.panX, p.y * t * ctx.zoom + ctx.panY, (p.x + p.w) * t * ctx.zoom + ctx.panX, (p.y + p.h) * t * ctx.zoom + ctx.panY); };
  return { ctx, H, api, n, state, dock, open, close, camNow, screen };
}
const meets = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const inside = (a, b) => a.left >= b.left - 0.5 && a.right <= b.right + 0.5 && a.top >= b.top - 0.5 && a.bottom <= b.bottom + 0.5;
const fmt = r => '[' + [r.left, r.top, r.right, r.bottom].map(v => Math.round(v)).join(',') + ']';
function noBake(r, what) {
  const hit = Object.keys(r.n).filter(k => r.n[k]);
  A.ok(!hit.length, what + ': a camera move only — no bake / geometry / plan / refit call (' + (hit.map(k => k + '×' + r.n[k]).join(', ') || 'none') + ')');
  A.ok(r.ctx.bakeDirty === false && r.ctx.planDirty === false, what + ': no bake or plan flag raised for the frame loop');
}
// a line the Commander can reach: every machine clear of the RESTORED library, and on the glass under the top bar
function reachable(r, G, ids, what) {
  A.ok(!r.dock.classList.contains('is-collapsed'), what + ': the library is back open');
  const glass = rect(0, G.top.bottom, G.W, G.H);
  for (const id of ids) {
    const s = r.screen(id);
    A.ok(!meets(s, G.dockOpen), what + ': ' + id + ' is not under the restored library ' + fmt(G.dockOpen) + ' — it sits at ' + fmt(s));
    A.ok(inside(s, glass), what + ': ' + id + ' is on the glass ' + fmt(glass) + ' — it sits at ' + fmt(s));
  }
}

/* ---------- 1. the live repro (r05b): DONE after the panel framed the line left of it ---------- */
{
  // after FIT the line sits right of the open library (occFit: INBOX ≈ 783, all hit CANVAS)
  const r = rig(DESK, { zoom: 1.07, panX: 693, panY: 168 });
  for (const id of LINE.props) A.ok(!meets(r.screen(id), DESK.dockOpen), 'setup: ' + id + ' starts clear of the open library');
  r.open('p32');
  A.ok(r.dock.classList.contains('is-collapsed'), 'opening the panel minimizes the library');
  const framed = r.camNow();
  A.ok(meets(r.screen('p31'), DESK.dockOpen) && meets(r.screen('p32'), DESK.dockOpen), 'setup reproduces the live state: the panel framed INBOX + BAY where the open library will land (' + fmt(r.screen('p31')) + ', ' + fmt(r.screen('p32')) + ')');
  r.close();
  reachable(r, DESK, LINE.props, 'DONE');
  A.ok(r.ctx.zoom <= framed.zoom, 'DONE never zooms in (' + framed.zoom + ' → ' + r.ctx.zoom + ')');
  noBake(r, 'DONE');
}

/* ---------- 2. the Commander panned while the panel was open, leaving only the OUTBOX's edge on the glass ---------- */
{
  const r = rig(DESK, { zoom: 1.07, panX: 693, panY: 168 });
  r.open('p32');
  r.ctx.panX = -227;   // the line now spans ≈ -150..107: mostly off the left edge, the OUTBOX still in view
  r.close();
  reachable(r, DESK, LINE.props, 'a line still partly in view');
  noBake(r, 'a line still partly in view');
}

/* ---------- 3. a lone BAY (on no line yet) the panel was showing ---------- */
{
  const r = rig(DESK, { zoom: 1.07, panX: 15, panY: 170 });   // p40 at ≈ 143..194: clear of the minimized library + the panel
  r.open('p40');
  const before = r.camNow();
  A.ok(meets(r.screen('p40'), DESK.dockOpen) && before.panX === 15, 'setup: the BAY sits where the open library will land, the panel left the camera alone');
  r.close();
  reachable(r, DESK, ['p40'], 'a lone BAY');
  noBake(r, 'a lone BAY');
}

/* ---------- 4. the narrow-screen bottom sheet: the returning library rises from the bottom ---------- */
{
  const r = rig(NARROW, { zoom: 1.07, panX: -57, panY: 397 });
  r.open('p31');
  r.ctx.panY = 340;   // the Commander dragged the floor down while the panel was open: the line at ≈ 437..486
  r.close();
  reachable(r, NARROW, LINE.props, 'narrow DONE');
  noBake(r, 'narrow DONE');
}

/* ---------- 5. what DONE must NOT move ---------- */
{
  // a line already clear of the library: the panel never moved it, DONE does not either
  let r = rig(DESK, { zoom: 1.07, panX: 423, panY: 168 });   // line at ≈ 500..757
  r.open('p32');
  let cam = r.camNow();
  A.eq(cam, { zoom: 1.07, panX: 423, panY: 168 }, 'setup: a line clear of the panel is not framed on open');
  r.close();
  A.eq(r.camNow(), cam, 'a line already clear of the restored library is never moved');
  reachable(r, DESK, LINE.props, 'already clear');
  noBake(r, 'already clear');

  // the Commander panned the whole line off the glass while the panel was open: DONE leaves the camera where they put it
  r = rig(DESK, { zoom: 1.07, panX: 693, panY: 168 });
  r.open('p32');
  r.ctx.panX = -600; cam = r.camNow();
  r.close();
  A.eq(r.camNow(), cam, 'a line panned off the glass by the Commander stays where they put it');
  noBake(r, 'panned away');

  // the Commander reopened the library themselves (OPEN KIT) while the panel was open: DONE restores nothing, so moves nothing
  r = rig(DESK, { zoom: 1.07, panX: 693, panY: 168 });
  r.open('p32');
  r.api.toggleKit();
  A.ok(!r.dock.classList.contains('is-collapsed'), 'setup: OPEN KIT reopened the library mid-panel');
  cam = r.camNow();
  r.close();
  A.eq(r.camNow(), cam, 'a library the Commander reopened is not DONE\'s doing: the camera stays');
  noBake(r, 'OPEN KIT mid-panel');

  // BUILD MODE itself closing (close() sets running=false before it closes the panel): nothing to keep in view
  r = rig(DESK, { zoom: 1.07, panX: 693, panY: 168 });
  r.open('p32');
  r.ctx.running = false; cam = r.camNow();
  r.close();
  A.eq(r.camNow(), cam, 'closing BUILD MODE moves no camera');
  noBake(r, 'BUILD MODE closing');
}

/* ---------- 6. every way the panel closes goes through that one close() ---------- */
A.ok(/\$\('#wf-done'\)\.onclick = \(\) => \{ H\.sfx\('click'\); close\(\); \};/.test(panel), '✓ DONE closes through close()');
A.ok(/\$\('#wf-close'\)\.onclick = \(\) => \{ H\.sfx\('click'\); close\(\); \};/.test(panel), '✕ closes through close()');
A.ok(/if \(e\.key === 'Escape' && [^\n]*\{ e\.stopPropagation\(\); close\(\); \}/.test(panel), 'Escape inside the panel closes through close()');
A.ok(/if \(typeof WorkflowPanel !== 'undefined' && WorkflowPanel\.isOpen\(\)\) \{ WorkflowPanel\.close\(\); return; \}/.test(build), 'Escape on the floor closes the panel through WorkflowPanel.close()');
// the host-call order the rig reproduces: open() mounts (panelShown(true)) BEFORE it highlights + frames; close() clears the highlight
// BEFORE it reports panelShown(false)
const openSrc = slice(panel, 'function open(host, propId, opts)', 6000), mountSrc = slice(panel, 'function mount()', 3000);
const iM = openSrc.indexOf('if (!el) mount();'), iH = openSrc.indexOf('H.highlight(propId);'), iF = openSrc.indexOf('H.frameLine(S.lineKey)');
A.ok(iM > 0 && iH > iM && iF > iH && /H\.panelShown\(true\)/.test(mountSrc), 'open(): mount → panelShown(true), then highlight, then frameLine');
const iN = closeSrc.indexOf('H.highlight(null)'), iP = closeSrc.indexOf('H.panelShown(false');
A.ok(iN > 0 && iP > iN, 'close(): highlight(null), then panelShown(false)');
// the framers themselves never reach for a bake
const camCode = camera.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');
A.ok(!/bake|projectGeometry|fitCamera|compileRoutingPlan|lineComponents|resize\(/i.test(camCode), 'the camera framers call no bake / geometry / plan / fit');

A.report('workflow-panel-done-reframe.test');
