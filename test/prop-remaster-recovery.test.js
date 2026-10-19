'use strict';
// Execute the real authored renderer with real pixel buffers. The fake loader and
// clock control graphics loss/retry ordering; no browser or production assets are required.
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),path=require('node:path');
const Canvas=require('@napi-rs/canvas');
const source=fs.readFileSync(path.join(__dirname,'../frontend/app/propremaster.js'),'utf8');
const rgb=[160,90,32,255],replacementRgb=[35,170,85,255];
const copy=value=>JSON.parse(JSON.stringify(value));
const view=(image='sample.png')=>({image,sourceWidth:8,sourceHeight:8,footprint:{w:1,h:1},bounds:{x:0,y:0,width:12,height:12},mode:'static'});
function solid(colour=rgb,width=8,height=8){const c=Canvas.createCanvas(width,height),g=c.getContext('2d');g.fillStyle='rgba('+colour.slice(0,3).join(',')+',1)';g.fillRect(0,0,width,height);return c;}
async function fixture(count=1,options={}){
  const canvases=[],pending=[],state={now:1000,failLoads:0,hold:false,blankFresh:false,failDefaultContext:false,failCpuAfter:null,cpuRequests:0,requests:0,active:0,maxActive:0};
  const projection=options.projection?require('../frontend/app/projection-prop-effects.js'):null;
  const ids=projection?['console','connector_portal']:Array.from({length:count},(_,i)=>'sample_'+i),props={},geometry={};
  for(const id of ids){const binding=projection?.classify(id)?.binding,spec={...view(id+'.png'),...(options.mode?{mode:options.mode}:{}),...(binding?{sourceWidth:binding.width,sourceHeight:binding.height}:{})};props[id]={views:{s:spec}};geometry[id+':s']={image:spec.image,width:spec.sourceWidth,height:spec.sourceHeight,crop:{x:0,y:0,width:spec.sourceWidth,height:spec.sourceHeight}};}
  class Image {constructor(){const c=solid();Object.defineProperty(c,'src',{set(url){
    const spec=Object.values(props).map(p=>p.views.s).find(v=>url.endsWith('/'+v.image));
    if(spec){c.width=spec.sourceWidth;c.height=spec.sourceHeight;const g=c.getContext('2d');g.fillStyle='rgb('+rgb.slice(0,3).join(',')+')';g.fillRect(0,0,c.width,c.height);}
    state.requests++;state.active++;state.maxActive=Math.max(state.maxActive,state.active);
    const finish=()=>{state.active--;if(state.failLoads>0){state.failLoads--;c.onerror?.(Error('injected decode failure'));}else c.onload?.();};
    if(state.hold)pending.push(finish);else queueMicrotask(finish);
  }});return c;}}
  const document={documentElement:{dataset:{}},createElement(){
    const c=Canvas.createCanvas(1,1),listeners=new Map();
    c.addEventListener=(name,fn)=>{if(!listeners.has(name))listeners.set(name,[]);listeners.get(name).push(fn);};
    c.removeEventListener=(name,fn)=>listeners.set(name,(listeners.get(name)||[]).filter(x=>x!==fn));
    c.emit=name=>{for(const fn of [...(listeners.get(name)||[])])fn({preventDefault(){}});};
    c.hasLossListener=()=>!!listeners.get('contextlost')?.length;
    if(state.blankFresh){const g=c.getContext('2d');g.drawImage=()=>{};g.putImageData=()=>{};}
    const native=c.getContext.bind(c);let acquired=false;c.getContext=(kind,attrs)=>{
      if(!acquired){if(attrs?.willReadFrequently){state.cpuRequests++;if(state.failCpuAfter!=null&&state.cpuRequests>state.failCpuAfter)return null;}else if(state.failDefaultContext)return null;}
      acquired=true;return native(kind,attrs);
    };
    canvases.push(c);return c;
  }};
  const contentRegions=Object.fromEntries(ids.map(id=>[id,{}]));
  const drawContent=(g,id,box,live={})=>{g.fillStyle=live.value===2?'#c83c64':'#1e8cc8';g.fillRect(1,1,2,2);};
  const composedOwners=options.mode?{AuthoredPropContent:{regions:contentRegions,draw:drawContent},AuthoredServiceContent:{regions:contentRegions,draw:drawContent},AuthoredMachineConfig:{get:()=>({motion:{sourceWidth:8,sourceHeight:8},layers:{}})},AuthoredPropMotion:{register:()=>true,draw:drawContent}}:{};
  const scope={...composedOwners,module:{exports:{}},console,URLSearchParams,location:{search:''},Image,ImageData:Canvas.ImageData,
    performance:{now:()=>state.now},Date,setTimeout,clearTimeout,queueMicrotask,document,
    IndustrialTextures:{isRemaster:()=>true},...(projection?{ProjectionPropEffects:projection}:{}),fetch:async url=>({ok:true,json:async()=>url.endsWith('runtime-geometry.json')?{version:1,views:geometry}:{version:1,props}})};
  vm.runInNewContext(source,scope);const api=scope.module.exports;await api.ready;
  assert.equal(api.status().failures.length,0,'fixture artwork loaded');
  const output=Canvas.createCanvas(144,144),g=output.getContext('2d');g.scale(6,6);let nativeCalls=0;
  const draw=(id=ids[0],live={},point=[6,6])=>{g.clearRect(0,0,24,24);const authored=api.draw(g,id,'s',0,0,12,12,live,()=>{nativeCalls++;});return{authored,pixel:Array.from(g.getImageData(Math.floor(point[0]*6),Math.floor(point[1]*6),1,1).data)};};
  const wipe=c=>{const p=c.getContext('2d');p.setTransform(1,0,0,1,0,0);p.clearRect(0,0,c.width,c.height);};
  const lose=c=>{wipe(c);c.emit('contextlost');};
  const latestBody=()=>[...canvases].reverse().find(c=>c.hasLossListener()&&c.width===72&&c.height===72);
  const drain=async()=>{state.hold=false;while(pending.length){pending.shift()();await Promise.resolve();}await api.whenRecovered();};
  return{api,ids,state,canvases,draw,wipe,lose,latestBody,drain,get nativeCalls(){return nativeCalls;}};
}
const tests=[];
function test(name,run){tests.push([name,run]);}
function sameArt(f,id){assert.deepEqual(f.draw(id),{authored:true,pixel:rgb},'known authored art remains visible; legacy fallback is not selected');}
function recoveryAPI(f){assert.equal(typeof f.api.restore,'function','global recovery is available');assert.equal(typeof f.api.whenRecovered,'function','recovery completion is observable');}

test('context loss preserves artwork, physical geometry and pixel picking immediately',async()=>{
  const f=await fixture();sameArt(f);const before=copy(f.api.viewGeometry(f.ids[0]));
  assert.equal(f.api.hitTest(f.ids[0],'s',6,6,12,12),true);
  f.lose(f.latestBody());sameArt(f);
  assert.deepEqual(copy(f.api.viewGeometry(f.ids[0])),before,'a graphics fault cannot move tabletop anchors');
  assert.equal(f.api.hitTest(f.ids[0],'s',6,6,12,12),true,'authored picking survives repair');
  assert.equal(f.nativeCalls,0);recoveryAPI(f);await f.api.whenRecovered();sameArt(f);
});

test('repeated losses reconstruct entries without accumulating decoded or recovery memory',async()=>{
  const f=await fixture();recoveryAPI(f);const initial=copy(f.api.status());
  assert(initial.recoveryBytes>0&&initial.recoveryBytes<=initial.pixels*4,'CPU artwork backup is bounded by prepared pixels');
  for(let cycle=0;cycle<4;cycle++){
    f.state.now+=4000;f.lose(f.latestBody());sameArt(f);await f.api.whenRecovered();sameArt(f);
    const status=f.api.status();assert.equal(status.lost,0);assert.equal(status.recovering,0);
    assert.equal(status.pixels,initial.pixels,'replacement releases the entire previous pixel charge');
    assert.equal(status.recoveryBytes,initial.recoveryBytes,'replacement does not retain old CPU backups');
  }
});

test('silent global cache loss restores every authored view with a bounded deduplicated queue',async()=>{
  const f=await fixture(6);recoveryAPI(f);const initial=copy(f.api.status()),requests=f.state.requests;
  for(const c of f.canvases)f.wipe(c);
  f.state.hold=true;f.api.restore();f.api.restore();
  for(const id of f.ids)sameArt(f,id);
  await f.drain();for(const id of f.ids)sameArt(f,id);
  assert(f.state.maxActive<=4,'no more than four images decode concurrently');
  assert.equal(f.state.requests-requests,f.ids.length,'repeated global signals share one repair per view');
  assert.equal(f.api.status().lost,0);assert.equal(f.api.status().pixels,initial.pixels);
  assert.equal(f.api.status().recoveryBytes,initial.recoveryBytes);
});

test('failed repair preserves artwork and retries on a later draw after cooldown',async()=>{
  const f=await fixture();recoveryAPI(f);f.state.failLoads=1;f.lose(f.latestBody());sameArt(f);
  await f.api.whenRecovered();sameArt(f);assert.equal(f.api.status().lost,1,'failed repair stays truthfully outstanding');
  const requests=f.state.requests;f.state.now+=1000;sameArt(f);await f.api.whenRecovered();
  assert.equal(f.state.requests,requests,'failed recovery cannot retry on every frame');
  f.state.now+=3100;sameArt(f);await f.api.whenRecovered();sameArt(f);
  assert(f.state.requests>requests,'later draw retries the original source');assert.equal(f.api.status().lost,0);
});

test('a stale queued recovery cannot overwrite replacement player-made artwork',async()=>{
  const f=await fixture(6);recoveryAPI(f);const id='user_sample',spec={...view('runtime.png'),mode:'approved',effects:false};
  assert.equal(await f.api.registerRuntime(id,spec,solid()),true);sameArt(f,id);
  const before=copy(f.api.status());f.state.hold=true;f.api.restore();
  assert.equal(await f.api.registerRuntime(id,spec,solid(replacementRgb),'s',true),true);
  assert.deepEqual(f.draw(id),{authored:true,pixel:replacementRgb});await f.drain();
  assert.deepEqual(f.draw(id),{authored:true,pixel:replacementRgb},'old restoration recipe must not win the replacement race');
  assert.equal(f.api.status().pixels,before.pixels);assert.equal(f.api.status().recoveryBytes,before.recoveryBytes);
});

test('a blank rebuilt canvas cannot replace the last valid authored pixels',async()=>{
  const f=await fixture();recoveryAPI(f);f.api.restore();sameArt(f);f.state.blankFresh=true;await f.api.whenRecovered();
  f.state.blankFresh=false;sameArt(f);assert.equal(f.api.status().lost,1,'silent paint failure remains retryable');
  f.state.now+=4000;sameArt(f);await f.api.whenRecovered();sameArt(f);assert.equal(f.api.status().lost,0);
});

test('recovery preserves idle screen power and live connector status overlays',async()=>{
  const f=await fixture(2,{projection:true});recoveryAPI(f);
  const at=(id,x,y)=>{const b=f.api.viewGeometry(id).box;return[b.x+x*b.width,b.y+y*b.height];};
  const screen=at('console',.5,.265),socket=at('connector_portal',.292,.338);
  const idle={occupied:false,work:false,still:true},online={bound:true,state:'online',still:true},error={bound:true,state:'error',still:true};
  const beforeIdle=f.draw('console',idle,screen),beforeOnline=f.draw('connector_portal',online,socket),beforeError=f.draw('connector_portal',error,socket);
  assert.notDeepEqual(beforeIdle.pixel,rgb,'the selected console pixel is inside the real idle overlay');
  assert.notDeepEqual(beforeOnline.pixel,beforeError.pixel,'the selected socket pixel carries real connection status');
  f.state.hold=true;for(const c of [...f.canvases])if(c.hasLossListener())f.lose(c);
  assert.deepEqual(f.draw('console',idle,screen),beforeIdle,'an idle console cannot light up because its canvas was lost');
  assert.deepEqual(f.draw('connector_portal',online,socket),beforeOnline,'online state survives fallback body painting');
  assert.deepEqual(f.draw('connector_portal',error,socket),beforeError,'status changes remain live while texture repair is pending');
  await f.drain();assert.deepEqual(f.draw('console',idle,screen),beforeIdle);
});
for(const mode of ['service','content','machine'])test(mode+' recovery remains drawable when accelerated composition allocation fails',async()=>{
  const f=await fixture(1,{mode});recoveryAPI(f);sameArt(f);
  if(mode!=='machine')assert.deepEqual(f.draw(f.ids[0],{value:1},[2,2]).pixel,[30,140,200,255],'fixture contains separately painted live content');
  f.state.hold=true;f.lose(f.latestBody());f.state.failDefaultContext=true;
  // Default contexts are unavailable, but an explicitly CPU-backed context is
  // still available. The fault must not escape and skip the rest of the station.
  assert.doesNotThrow(()=>sameArt(f),'a failed graphics allocation cannot throw out of the prop draw');
  if(mode!=='machine')assert.deepEqual(f.draw(f.ids[0],{value:2},[2,2]).pixel,[200,60,100,255],'pure live content still updates on the available CPU surface');
  assert.equal(f.nativeCalls,0,'composition failure cannot reveal procedural legacy art');
  f.state.failDefaultContext=false;await f.drain();sameArt(f);assert.equal(f.api.status().lost,0);
});
for(const mode of ['service','content','machine'])test(mode+' keeps its body and bounds retries when CPU composition is unavailable',async()=>{
  const f=await fixture(1,{mode});recoveryAPI(f);sameArt(f);
  f.state.hold=true;f.lose(f.latestBody());f.state.failDefaultContext=true;f.state.failCpuAfter=1;
  // The first CPU allocation restores the body; the second (composition) fails.
  assert.doesNotThrow(()=>sameArt(f),'failed composition must still display the retained authored body');
  const attempts=f.state.cpuRequests;assert.equal(attempts,2,'the injected failure reached composition after restoring the body');
  for(let frame=0;frame<5;frame++)sameArt(f);
  assert.equal(f.state.cpuRequests,attempts,'failed composition allocation is not retried every frame');
  f.state.now+=3100;sameArt(f);assert.equal(f.state.cpuRequests,attempts+1,'one composition retry is allowed after backoff');
  assert.equal(f.nativeCalls,0);f.state.failCpuAfter=null;f.state.failDefaultContext=false;
  await f.drain();sameArt(f);assert.equal(f.api.status().lost,0);
});
(async()=>{let failed=0;for(const [name,run]of tests){try{await run();console.log('PASS: '+name);}catch(error){failed++;console.error('FAIL: '+name+'\n'+(error.stack||error));}}console.log('prop-remaster-recovery: '+(tests.length-failed)+'/'+tests.length+' scenarios passed');if(failed)process.exitCode=1;})().catch(error=>{console.error(error);process.exitCode=1;});
