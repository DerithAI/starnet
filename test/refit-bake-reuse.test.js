'use strict';
// Execute the production cache handoff and rebake functions with renderer spies.
// Real canvas timing/edit/undo coverage lives in scripts/qa/refit-entry.mjs.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const read = name => fs.readFileSync(require.resolve('../frontend/app/' + name), 'utf8');
const world = read('world.js'), build = read('build.js');
const handoff = world.match(/refitBake:\s*(st =>[\s\S]*?\? \{ cache, geo \} : null),/);
assert.ok(handoff, 'world exposes its guarded read-only cache handoff');
const station = {}, cache = {}, geo = {};
const context = vm.createContext({ station, cache, geo, geoDirty: false, bakeDirty: false });
vm.runInContext('this.borrow = ' + handoff[1], context);
assert.equal(context.borrow({}), null, 'different station cannot inherit this image');
for (const key of ['geoDirty', 'bakeDirty']) {
  context[key] = true;
  assert.equal(context.borrow(station), null, key + ' rejects stale rendered state');
  context[key] = false;
}
for (const key of ['cache', 'geo']) {
  const prior = context[key]; context[key] = null;
  assert.equal(context.borrow(station), null, 'missing ' + key + ' falls back to baking');
  context[key] = prior;
}
assert.equal(context.borrow(station).cache, cache, 'handoff shares the already-painted image');
assert.equal(context.borrow(station).geo, geo, 'geometry and pixels remain paired');

const openStart = build.indexOf('    const worldBake =');
const openEnd = build.indexOf('    frameFailures = 0;', openStart);
assert.ok(openStart > 0 && openEnd > openStart);
const initialize = build.slice(openStart, openEnd);
const bakeStart = build.indexOf('  function rebake()');
const bakeEnd = build.indexOf('  // A browser animation callback', bakeStart);
assert.ok(bakeStart > 0 && bakeEnd > bakeStart);
let calls = 0, projections = 0;
const editedGeo = { origin: { tx: 5, ty: 8 } }, editedCache = {};
const editor = vm.createContext({
  station: { projectGeometry() { projections++; return editedGeo; } },
  opts: { world: { refitBake() { return { cache, geo }; } } },
  cache: null, cacheGeo: null, bakeDirty: true, bakeDirtyRects: null, projectionDirty: false,
  bakeDirtyRectsGlobal: false, bakeVisibleOnly: false, planDirty: false,
  valPlan: {}, valLive: null, valComps: null, ghost: null, lastStampIds: null,
  maybeFirstRide() {}, renderFinCard() {}, refreshLineFacts() {},
  visibleBakeRect() { return null; }, MAX_REFIT_CHUNKS: 18,
  StationBake: { bakeIncremental(g) { assert.equal(g, editedGeo); calls++; return editedCache; } }
});
vm.runInContext(build.slice(bakeStart, bakeEnd), editor);
const initializeEditor = () => vm.runInContext('{\n' + initialize + '\n}', editor);
for (let trial = 0; trial < 2; trial++) {
  initializeEditor();
  editor.rebake(); // Entry still compiles its routing plan, without painting again.
  assert.equal(calls, 0, 'entry and reopening must not synchronously rebake');
  assert.equal(projections, 0, 'borrowed geometry stays paired with borrowed pixels');
  assert.equal(editor.cache, cache);
  assert.equal(editor.cacheGeo, geo);
  assert.equal(editor.planDirty, false, 'routing plan is refreshed on entry');
}
editor.bakeDirty = true;
editor.rebake();
assert.equal(calls, 1, 'a real edit replaces the borrowed image');
assert.equal(projections, 1);
assert.equal(editor.cache, editedCache);
assert.equal(editor.cacheGeo, editedGeo);
editor.rebake();
assert.equal(calls, 1, 'clean frames do not repeat the edit bake');
editor.opts.world.refitBake = () => null;
initializeEditor(); editor.rebake();
assert.equal(calls, 2, 'missing or stale world image takes the original cold-bake path');
console.log('refit-bake-reuse: same-save handoff, invalidation, entry/reopen and cold fallback PASS');

// Execute the actual edit listener, so coalesced invalidations cannot turn a
// floor/airlock edit into a prop-only frame (including a pending pan bake).
Object.assign(editor, { clearLineFields() {}, scheduleLineFitSync() {}, bumpGeo() {}, updateUndoRedo() {},
  renderSelection() {}, renderEquipmentInfo() {}, tool: 'select' });
const listenerStart = build.indexOf('    unsub = station.onChange(p => {');
const listenerEnd = build.indexOf('    const worldBake =', listenerStart);
vm.runInContext('this.edit = p => {' + build.slice(listenerStart, listenerEnd)
  .split('station.onChange(p => {')[1].replace(/\}\);\s*$/, '') + '};', editor);
const reset = () => Object.assign(editor, { bakeDirty: false, planDirty: false,
  projectionDirty: false, bakeDirtyRects: null, bakeDirtyRectsGlobal: false, bakeVisibleOnly: false });
const propPatch = { staticBakeUnchanged: true, dirtyRects: [{x1:2,y1:2,x2:3,y2:3}] };
reset(); editor.edit(propPatch);
assert.equal(editor.bakeDirty, false, 'ordinary prop keeps environment pixels');
assert.equal(editor.projectionDirty, true, 'prop refreshes collision geometry');
assert.equal(editor.planDirty, true, 'prop refreshes capability routing');
const priorCalls=calls, priorProjections=projections;
editor.rebake();
assert.equal(calls, priorCalls, 'prop-only frame never repaints environment');
assert.equal(projections, priorProjections+1, 'prop-only frame gets fresh geometry');
assert.equal(editor.projectionDirty, false);
for (const edits of [[{global:true},propPatch],[propPatch,{global:true}],
  [{dirtyRects:propPatch.dirtyRects},propPatch],[propPatch,{dirtyRects:propPatch.dirtyRects}]]) {
  reset(); editor.bakeVisibleOnly=true;
  for(const patch of edits)editor.edit(patch);
  assert.equal(editor.bakeDirty,true,'mixed edits retain the environment bake');
  assert.equal(editor.bakeVisibleOnly,false,'real edit cancels pan-only mode');
  if(edits.some(p=>p.global))assert.equal(editor.bakeDirtyRects,null,'global invalidation stays global');
}

const WM=require('../frontend/app/worldmodel.js');
const st=WM.create(); let patch;
st.onChange(p=>{patch=p;});
const added=st.addProp({t:'plant',x:4,y:4,w:1,h:1});
assert.ok(added.ok); assert.equal(patch.staticBakeUnchanged,true);
for(const change of [()=>st.moveProp(added.id,1,0),()=>st.rotateProp(added.id,1),
  ()=>st.mirrorProp(added.id),()=>st.removeProp(added.id)]){
  assert.ok(change().ok);assert.equal(patch.staticBakeUnchanged,true);
}
// AN UNDO RE-BAKES ONLY WHAT IT PUT BACK (2026-10-13): history says what the forward edit said
st.undo();assert.equal(patch.staticBakeUnchanged,true,'undoing a furniture edit leaves the bake alone');
assert.ok(patch.dirtyRects.length>0&&!patch.global,'…and still names where it happened');
st.redo();assert.equal(patch.staticBakeUnchanged,true,'redoing it too');
const door=st.addProp({t:'airlock',door:'closed',x:6,y:4,w:1,h:1});
assert.ok(door.ok);assert.equal(patch.staticBakeUnchanged,undefined,'airlock can change doorways');
for(const change of [()=>st.moveProp(door.id,1,0),()=>st.rotateProp(door.id,1),
  ()=>st.mirrorProp(door.id),()=>st.removeProp(door.id)]){
  assert.ok(change().ok);assert.equal(patch.staticBakeUnchanged,undefined);
}
st.undo();assert.equal(patch.staticBakeUnchanged,undefined,'undoing an airlock edit re-bakes');
assert.ok(patch.global&&patch.dirtyRects.length===0,'…the whole station (a sealed room drops every doorway it has)');
st.redo();assert.ok(patch.global,'…and so does redoing it');
// A SEALING AIRLOCK MOVES A WHOLE ROOM'S DOORWAYS: its edits name the room it stands in, not just its own tile
const sr=st.rooms()[0].rects[0], covers=(rects,r)=>rects.some(q=>q.x1===r.x1&&q.y1===r.y1&&q.x2===r.x2&&q.y2===r.y2);
const seal=st.addProp({t:'airlock',door:'closed',x:sr.x1+3,y:sr.y1+3,w:1,h:1});
assert.ok(seal.ok&&covers(patch.dirtyRects,sr),'placing a closed airlock re-bakes its whole room');
assert.ok(st.moveProp(seal.id,1,0).ok&&covers(patch.dirtyRects,sr),'…moving it too');
assert.ok(st.setDoorState(seal.id,'open').ok&&covers(patch.dirtyRects,sr)&&!patch.global,'…opening it re-bakes that room, not the station');
assert.ok(st.setDoorState(seal.id,'closed').ok&&covers(patch.dirtyRects,sr),'…closing it too');
assert.ok(st.removeProp(seal.id).ok&&covers(patch.dirtyRects,sr),'…and removing it');
const openLock=st.addProp({t:'airlock',x:sr.x1+3,y:sr.y1+3,w:1,h:1});
assert.ok(openLock.ok&&patch.dirtyRects.length===1,'an open airlock seals nothing: its own tile is enough');
assert.ok(st.removeProp(openLock.id).ok);
const r0=st.rooms()[0];
st.setFloor(r0.id,'cobalt');
assert.equal(patch.staticBakeUnchanged,undefined,'floor changes still rebake');
st.undo();assert.equal(patch.staticBakeUnchanged,undefined,'undoing a floor change re-bakes');
assert.ok(!patch.global&&patch.dirtyRects.some(r=>r.x1===r0.rects[0].x1&&r.y2===r0.rects[0].y2),'…that room, by its own rects');
const clad=Object.keys(WM.HULL_MATERIALS).find(m=>m!==(st.rooms()[0].hullMat||'station'));
assert.ok(clad&&st.setHull(r0.id,{mat:clad}).ok&&patch.global,'re-cladding a shell is a global edit');
st.undo();assert.ok(patch.global,'…and so is undoing it (the shell is a station-wide composite)');
// belts, links and a machine's settings are read by the conveyor, the crew and the compiler — never by the deck/wall/light bake
const bx=r0.rects[0].x1+1, by=r0.rects[0].y1+1;
assert.ok(st.setBelt(bx,by,'E').ok);assert.equal(patch.staticBakeUnchanged,true,'a belt leaves the bake alone');
st.undo();assert.equal(patch.staticBakeUnchanged,true,'…undoing it too');
assert.ok(st.placeBeltRun({tx:bx,ty:by},{tx:bx+3,ty:by}).ok);assert.equal(patch.staticBakeUnchanged,true,'a belt run too');
assert.ok(st.removeBelts([[bx,by],[bx+1,by]]).ok);assert.equal(patch.staticBakeUnchanged,true,'clearing belts too');
assert.ok(st.removeBelt(bx+2,by).ok);assert.equal(patch.staticBakeUnchanged,true,'removing one too');
const intake=st.addProp({t:'intake',x:bx,y:by+3,w:2,h:2});
if(intake.ok){
  assert.ok(st.setPropLabel(intake.id,'PERF LINE').ok);assert.equal(patch.staticBakeUnchanged,true,'a line name leaves the bake alone');
  assert.ok(st.assignPropAgent(intake.id,'nova').ok);assert.equal(patch.staticBakeUnchanged,true,'binding an agent too');
}
// a room's name is stencilled by the bake at its bounding box's bottom-right corner: a rename re-bakes the chunks there
const rn=st.rooms()[0], x2=Math.max(...rn.rects.map(r=>r.x2)), y2=Math.max(...rn.rects.map(r=>r.y2));
assert.ok(st.renameRoom(rn.id,'RENAMED').ok);assert.equal(patch.staticBakeUnchanged,undefined,'a room name is part of the bake');
// the plate is the text's own pixels — 24 chars at 7px written rightward from 28px inside the box's right edge, in its
// bottom tile row — so its rect holds exactly that span and carries no wall reach (pad 0)
const plateRect=r=>r.x1===x2-3&&r.x2===x2+12&&r.y1===y2&&r.y2===y2&&r.pad===0;
assert.ok(!patch.global&&patch.dirtyRects.length===1&&plateRect(patch.dirtyRects[0]),
  '…so a rename names that plate, not the whole station: '+JSON.stringify(patch.dirtyRects));
st.undo();assert.ok(!patch.global&&patch.dirtyRects.length===2&&patch.dirtyRects.every(plateRect),
  '…and undoing it re-bakes only that plate, never the whole room: '+JSON.stringify(patch.dirtyRects));
console.log('refit placement: prop-only pixels, fresh geometry/routing, mixed edits, airlock and history PASS');

// Render invalidation is not authorization to publish a floor held in Build.
const fnBody=require('./_assert').fnBody;
let buildOpen=true,derived=0,painted=0;
const render=vm.createContext({
  station:{},geo:{},geoDirty:true,bakeDirty:false,cache:{},bakedAnchorKey:null,handedBake:null,bakeEdits:null,
  Build:{isOpen:()=>buildOpen},
  StationBake:{bake(){painted++;return {}; }},fixtureAnchorKey:()=>'',recordBakeProbe(){},
  rederive(){derived++;render.geo={};render.geoDirty=false;}
});
vm.runInContext(['buildHoldsFloor','bakeKnobs','bakeEditedChunks','rebake','renderStill','renderStillOfTiles'].map(n=>fnBody(world,'function '+n+'(')).join('\n'),render);
render.rebake();
assert.equal(derived,0,'art/lighting refresh cannot recompile a held edit');
assert.equal(painted,0,'held geometry is not baked as if it were published');
assert.equal(render.geoDirty,true,'pending edit survives refresh');
assert.equal(render.bakeDirty,true,'visual invalidation is retained for publication');
assert.equal(render.renderStill(320),null,'full still declines a held edit');
assert.equal(render.renderStillOfTiles({},320),null,'cropped still declines a held edit');
assert.equal(derived,0,'still reads cannot send the floor');
render.geoDirty=false;render.rebake();
assert.equal(painted,1,'clean geometry may refresh during Build');
render.geoDirty=true;buildOpen=false;render.rebake();
assert.equal(derived,1,'normal rendering still recompiles after Build closes');
assert.equal(painted,2,'deferred visual work is consumed after publication');
assert.equal(render.bakeDirty,false,'successful bake clears only visual invalidation');
delete render.Build;render.geoDirty=true;render.rebake();
assert.equal(derived,2,'bootstrap without Build still derives the floor');
// BUILD MODE HANDS ITS FLOOR BACK: the world's rebake takes the stitched floor only for this station at this edit revision
let seqNow=7;const handedSt={getSeq:()=>seqNow},frameOf={W:10,H:5,origin:{tx:-3,ty:2}},stitched={W:10,H:5,origin:{tx:-3,ty:2},tag:'stitched'};
Object.assign(render,{station:handedSt,geo:frameOf,geoDirty:false});
render.handedBake={station:handedSt,seq:7,bake:stitched};
const paintedBefore=painted;render.rebake();
assert.equal(render.cache,stitched,'the stitched floor becomes the world bake');
assert.equal(painted,paintedBefore,'…without baking the station again');
assert.equal(render.handedBake,null,'…and the offer is spent');
render.handedBake={station:handedSt,seq:7,bake:stitched};seqNow=8;render.rebake();
assert.ok(render.cache!==stitched&&painted===paintedBefore+1,'a floor edited since the offer bakes for itself');
render.handedBake={station:{getSeq:()=>8},seq:8,bake:stitched};render.rebake();
assert.ok(render.cache!==stitched&&painted===paintedBefore+2,'another station\'s floor is never taken');
render.handedBake={station:handedSt,seq:8,bake:Object.assign({},stitched,{H:6})};render.rebake();
assert.ok(render.cache.tag!=='stitched'&&painted===paintedBefore+3,'nor one of another size');
const worldStart=fnBody(world,'function start(');
assert.ok(/frame\(last\);\s*handedBake = null;/.test(worldStart),'start() lets the offer live for its first frame only');
const buildClose=fnBody(build,'function close(');
assert.ok(buildClose.indexOf('adoptBuildBake')>0&&buildClose.indexOf('adoptBuildBake')<buildClose.indexOf('opts.world.start()'),'BUILD MODE offers its floor before the world starts again');
assert.ok(/!bakeDirty/.test(buildClose.slice(0,buildClose.lastIndexOf('adoptBuildBake'))),'…and only with nothing left to bake');
console.log('render-only Build publication boundaries PASS');
assert.equal(require('./_assert').fails(),0,'shared assertion helpers have no pending failures');
