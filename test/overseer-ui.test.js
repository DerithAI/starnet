'use strict';
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
(async () => {
  const rows = new Map([['planning', {id:'planning'}]]);
  let reconciled = 0, persisted = 0, timeout, fail = false, hang = false;
  const data = {threads:[{id:'research',parentStreamId:'planning',agentId:'custom_researcher'}],workers:[{runId:'w1',status:'done'}],reviews:[{reviewRunId:'r1',status:'done'}]};
  const context = {
    module:{exports:{}}, console:{debug(){}}, AbortController,
    setTimeout(fn){timeout=fn;return 1;}, clearTimeout(){},
    document:{addEventListener(){}, createElement(){throw new Error('No additional UI permitted');}},
    Workstreams:{generalId:()=> 'general',get:id=>rows.get(id),adopt:row=>{if(!rows.has(row.id)) rows.set(row.id,row);return rows.get(row.id);}},
    App:{persist(){persisted++;},refreshRail(){},openWorkstream(){throw new Error('Must not move focus');}},
    StationCommands:{async reconcile(){reconciled++;}},
    fetch:async (_url,options)=>{
      if(hang) return new Promise((_resolve,reject)=>options.signal.addEventListener('abort',()=>reject(new Error('timeout'))));
      if(fail) throw new Error('offline');
      return {ok:true,json:async()=>data};
    }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/app/overseer.js'),'utf8'),context);
  const sync=context.module.exports;
  await sync.refresh();
  assert.equal(rows.get('research').agentId,'custom_researcher');
  assert.equal(persisted,1);assert.equal(reconciled,1);
  await sync.refresh();assert.equal(reconciled,1,'unchanged polling does not rebuild the transcript');assert.equal(persisted,1,'unchanged polling does not persist again');
  fail=true;await sync.refresh();fail=false;await sync.refresh();
  assert.equal(reconciled,2,'reconnect reconciles even if worker state did not change');
  hang=true;const pending=sync.refresh();timeout();await pending;hang=false;await sync.refresh();
  assert.equal(reconciled,3,'a hung request times out and does not permanently block synchronization');
  // review app-shell-ui-05: a failed poll leaves the last ledger readable (finished/failed rows) but no longer FRESH, so
  // nothing reads its running workers as still working through an outage; the delegation card repaints at once
  let repaints=0;context.Delegated={repaint(){repaints++;}};
  await sync.refresh();
  assert.equal(typeof sync.fresh,'function','the ledger says whether it is still current');
  assert.equal(sync.fresh(),true,'a ledger just answered is fresh');
  const before=repaints;fail=true;await sync.refresh();
  assert.equal(sync.fresh(),false,'a failed poll: the ledger is no longer current');
  assert.ok(sync.snapshot()&&sync.snapshot().workers.length===1,'…but the last answer stays readable');
  assert.ok(repaints>before,'the delegation card repaints when the ledger goes stale');
  fail=false;await sync.refresh();
  assert.equal(sync.fresh(),true,'recovery makes the ledger current again');
  hang=true;const stuck=sync.refresh();
  const realNow=Date.now;context.Date=Date;Date.now=()=>realNow()+60000;
  try { assert.equal(sync.fresh(),false,'a poll hung past three beats: the ledger is no longer current'); }
  finally { Date.now=realNow; }
  timeout();await stuck;hang=false;

  /* IDLE CPU PIECE 3 (2026-10-20): the beat runs through PollGate — 2.5 s on screen, a 30 s floor while the Commander is
     away, a catch-up read the moment they are back. Freshness is measured against the cadence that produced the answer and
     a hang is counted from THIS ask, so the catch-up read on return is never called "station unreachable" just because the
     last answer is 40 s old (trunk: busy && now - okAt > 7.5 s said unreachable at once). */
  let cadence=2500,ready=null,offset=0;const clockNow=Date.now;
  const gated=Object.assign({},context,{
    module:{exports:{}},Date:{now:()=>clockNow()+offset},setInterval:()=>0,
    document:{addEventListener(k,fn){if(k==='DOMContentLoaded')ready=fn;},createElement(){throw new Error('No additional UI permitted');}},
    PollGate:{every(fn,o){assert.equal(o.ms,2500,'the overseer keeps its 2.5 s visible beat');return {interval:()=>cadence,cadence:()=>cadence,stop(){},runNow(){}};}}
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/app/overseer.js'),'utf8'),gated);
  const g=gated.module.exports;ready();for(let n=0;n<20;n++)await Promise.resolve();
  await g.refresh();assert.equal(g.fresh(),true,'gated: a ledger just answered is fresh');
  // the Commander comes back after 40 s away: the catch-up read is on its way
  offset+=40000;hang=true;const catchUp=g.refresh();
  assert.equal(g.unreachable(),false,'the catch-up read on return is not "station unreachable" while it is on its way');
  assert.equal(g.fresh(),false,'…but an ask in flight never vouches for an answer older than three of the beats that produced it (40 s at 2.5 s)');
  offset+=4000;assert.equal(g.unreachable(),false,'four seconds into the ask: still not hung');
  offset+=1500;assert.equal(g.unreachable(),true,'past two beats of THIS ask: hung, so unreachable');
  assert.equal(g.fresh(),false,'…and no longer fresh');
  timeout();await catchUp;hang=false;
  // an answer asked for while away (the 30 s floor) stays current for three of those beats
  cadence=30000;await g.refresh();
  offset+=40000;assert.equal(g.fresh(),true,'an answer from a 30 s away beat is still current 40 s later');
  offset+=60000;assert.equal(g.fresh(),false,'…but not past three of its beats');
  // back on screen at 2.5 s: an answer older than three beats with no ask out is no longer vouched for
  cadence=2500;await g.refresh();
  offset+=4000;assert.equal(g.fresh(),true,'visible: an answer 4 s old is current');
  offset+=60000;assert.equal(g.fresh(),false,'visible: an answer a minute old with nothing asked since is not');
  /* fix round (2026-10-20): fresh() is EXACTLY the design's formula — !failing && !hung && now - okAt <= 3 x max(BEAT, the
     cadence that produced the answer). The old `busy ||` term let any ask in flight vouch for the last ledger however old
     it was: after a sleep or a frozen page the catch-up read made an hour-old ledger "fresh" (crew lamps "working", a
     delegated row's live clock) until it answered or hung. */
  // the design's own case: the last answer came from a 30 s away beat, the catch-up read is on its way 40 s later
  cadence=30000;await g.refresh();cadence=2500;
  offset+=40000;hang=true;const back=g.refresh();
  assert.equal(g.unreachable(),false,'an answer from a 30 s away beat, 40 s old, catch-up in flight: not unreachable');
  assert.equal(g.fresh(),true,'…and still fresh (40 s is inside three 30 s beats)');
  timeout();await back;hang=false;
  // an hour-old ledger (sleep / a frozen page) with the catch-up read in flight
  await g.refresh();assert.equal(g.fresh(),true,'fixture: a ledger just answered');
  offset+=3600000;hang=true;const resumed=g.refresh();
  assert.equal(g.unreachable(),false,'an hour later the catch-up read is on its way: not (yet) unreachable');
  assert.equal(g.fresh(),false,'…but an hour-old ledger is never fresh because an ask is out (it was, with busy ||)');
  timeout();await resumed;hang=false;

  /* the freshness clock is monotonic (performance.now when present): a backward wall-clock step can neither make an old
     ledger current nor keep a hung ask from reading as hung */
  let mono=1e6,wallStep=0,monoReady=null;
  const monoCtx=Object.assign({},context,{
    module:{exports:{}},Date:{now:()=>clockNow()+wallStep},performance:{now:()=>mono},setInterval:()=>0,
    document:{addEventListener(k,fn){if(k==='DOMContentLoaded')monoReady=fn;},createElement(){throw new Error('No additional UI permitted');}},
    PollGate:{every(){return {interval:()=>2500,cadence:()=>2500,stop(){},runNow(){}};}}
  });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/app/overseer.js'),'utf8'),monoCtx);
  const m=monoCtx.module.exports;monoReady();for(let n=0;n<20;n++)await Promise.resolve();
  await m.refresh();assert.equal(m.fresh(),true,'monotonic: a ledger just answered is fresh');
  mono+=60000;wallStep-=3600000;
  assert.equal(m.fresh(),false,'a minute with no answer, wall clock stepped back an hour: still not fresh (Date.now said fresh)');
  hang=true;const stepped=m.refresh();mono+=6000;wallStep-=3600000;
  assert.equal(m.unreachable(),true,'an ask out 6 s on the monotonic clock is hung, whatever the wall clock did');
  timeout();await stepped;hang=false;
  /* fix round 2 (2026-10-20): every age is the LONGER of the two clocks. WebKit's performance.now (macOS WKWebView, Linux
     WebKitGTK) stands still while the machine sleeps; on it alone a pre-sleep ledger read seconds old after an hour's sleep
     and painted pre-sleep "working" lamps as current. Windows' WebView2 counts the sleep on both clocks. */
  wallStep=0;await m.refresh();assert.equal(m.fresh(),true,'fixture: a ledger just answered');
  wallStep+=3600000;   // an hour of sleep: the wall clock moved, the monotonic clock did not
  assert.equal(m.fresh(),false,'an hour-old ledger after a sleep that stopped performance.now is not current (it read fresh)');
  await m.refresh();assert.equal(m.fresh(),true,'fixture: answered again after the resume');
  hang=true;const slept=m.refresh();wallStep+=3600000;
  assert.equal(m.unreachable(),true,'an ask out across an hour of that sleep is hung, as on WebView2 (it read 0 s old)');
  timeout();await slept;hang=false;

  /* fix round 2 (2026-10-20): AN AWAY STRETCH IS NOT STALENESS. GENUINE (executed): the REAL pollgate.js (fake monotonic
     clock + timers through its seams, a rAF probe that answers only while visible) and the REAL overseer.js, whose fetch
     answers after a 40 ms round trip. The last answer before a minimize came from the 2.5 s visible beat and the
     first away beat answers ~30 s later: a Commander back 10-32 s after a minimize saw the rail's crew row read "crew ·
     unknown — station unreachable" (fresh() false) while the station answered all along. */
  const PollGate=require('../frontend/app/pollgate.js');
  async function minimizeAndReturn({awayMs,frozenMs=0}){
    let T=5e6;const timers=new Map();let nextId=1;
    const setT=(fn,ms)=>{const id=nextId++;timers.set(id,{at:T+Math.max(0,ms||0),fn});return id;};
    const clearT=id=>{timers.delete(id);};
    const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
    const advance=async ms=>{const end=T+ms;for(;;){let best=null;for(const [id,t] of timers) if(t.at<=end&&(!best||t.at<best[1].at||(t.at===best[1].at&&id<best[0])))best=[id,t];if(!best)break;timers.delete(best[0]);T=best[1].at;best[1].fn();await drain();}T=end;await drain();};
    const listeners={};
    const doc={hidden:false,visibilityState:'visible',hasFocus:()=>!doc.hidden,addEventListener(k,fn){(listeners[k]=listeners[k]||[]).push(fn);},removeEventListener(){}};
    PollGate._resetForTest();PollGate._setClockForTest(()=>T);PollGate._setTimersForTest(setT,clearT);
    PollGate._setFrameForTest(cb=>{if(!doc.hidden)setT(()=>cb(T),16);});
    PollGate._setDocForTest(doc,{addEventListener(){},removeEventListener(){}});
    let ready=null;
    const ledger={threads:[],workers:[{runId:'w1',status:'running',parentStreamId:'planning'}],reviews:[]};
    const c={module:{exports:{}},console:{debug(){}},AbortController,PollGate,performance:{now:()=>T},setTimeout:setT,clearTimeout:clearT,setInterval:()=>0,
      document:{addEventListener(k,fn){if(k==='DOMContentLoaded')ready=fn;}},Workstreams:{generalId:()=>'general',get:()=>null,adopt:r=>r},App:{persist(){},refreshRail(){}},
      fetch:()=>new Promise(res=>setT(()=>res({ok:true,json:async()=>ledger}),40))};
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/app/overseer.js'),'utf8'),c);
    const o=c.module.exports;ready();await drain();
    await advance(20000);
    const before=o.fresh();
    doc.hidden=true;doc.visibilityState='hidden';for(const fn of listeners.visibilitychange||[])fn();
    await advance(awayMs);
    T+=frozenMs;   // a sleep / a frozen page: the clock moves, nothing runs
    doc.hidden=false;doc.visibilityState='visible';for(const fn of listeners.visibilitychange||[])fn();
    const atReturn={fresh:o.fresh(),unreachable:o.unreachable()};   // what app.js's visibilitychange renderRail reads
    await advance(3000);
    const after=o.fresh();
    PollGate._resetForTest();
    return {before,atReturn,after};
  }
  for(const awayMs of [12000,20000,28000]){
    const r=await minimizeAndReturn({awayMs});
    assert.equal(r.before,true,'fixture: the ledger is current before the minimize');
    assert.equal(r.atReturn.fresh,true,'back '+awayMs/1000+' s after a minimize: the last ledger is still current while the catch-up read is out (it read "station unreachable")');
    assert.equal(r.after,true,'…and the catch-up answer keeps it current');
  }
  {
    const r=await minimizeAndReturn({awayMs:20000,frozenMs:3600000});
    assert.equal(r.atReturn.unreachable,false,'minimized, then an hour frozen: the catch-up read on its way is not "unreachable"');
    assert.equal(r.atReturn.fresh,false,'…but an hour-old ledger is never current because the gate went away after it');
    assert.equal(r.after,true,'…until the catch-up read answers');
  }
  console.log('overseer sync: existing sessions, no added UI/focus changes, recovery and timeout PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
