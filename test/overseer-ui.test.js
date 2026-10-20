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

  /* RIG: the REAL overseer.js on one fake monotonic clock (performance.now) + wall clock (Date.now) + timer queue, and an
     /api/overseer that answers after a round trip, hangs (honouring the abort) or fails on cue. `gate`: 'real' = the REAL
     pollgate.js drives the beat through its seams; an object = a PollGate stub; absent = the test calls refresh() itself.
     stall(ms) = the page's own event loop busy (a long task), or the machine asleep: the clocks move and NO task runs, so
     a reader right after it (the rail's 1 s tick) can run before what queued up behind it. advance(ms) then runs every
     task that came due, oldest first. */
  const PollGate=require('../frontend/app/pollgate.js');
  function rig({gate=null,rtt=40,navigator=undefined}={}){
    let T=5e6,wall=0,nextId=1;const timers=new Map();
    const setT=(fn,ms)=>{const id=nextId++;timers.set(id,{at:T+Math.max(0,ms||0),fn});return id;};
    const clearT=id=>{timers.delete(id);};
    const drain=async()=>{for(let i=0;i<30;i++)await Promise.resolve();};
    const advance=async ms=>{const end=T+ms;for(;;){let best=null;for(const [id,t] of timers) if(t.at<=end&&(!best||t.at<best[1].at||(t.at===best[1].at&&id<best[0])))best=[id,t];if(!best)break;timers.delete(best[0]);T=Math.max(T,best[1].at);best[1].fn();await drain();if(s.afterTask)s.afterTask();}T=Math.max(T,end);await drain();};
    const s={mode:'answer',rtt,reconcileMs:0,bodyTask:false,afterTask:null,deliver:null};
    const ledger={threads:[],workers:[{runId:'w1',status:'running',parentStreamId:'planning'}],reviews:[]};
    let ready=null;const listeners={};
    const doc={hidden:false,visibilityState:'visible',hasFocus:()=>!doc.hidden,addEventListener(k,fn){(listeners[k]=listeners[k]||[]).push(fn);},removeEventListener(){}};
    if(gate==='real'){PollGate._resetForTest();PollGate._setClockForTest(()=>T);PollGate._setTimersForTest(setT,clearT);PollGate._setFrameForTest(cb=>{if(!doc.hidden)setT(()=>cb(T),16);});PollGate._setDocForTest(doc,{addEventListener(){},removeEventListener(){}});}
    const c={module:{exports:{}},console:{debug(){}},AbortController,performance:{now:()=>T},Date:{now:()=>T+wall},
      setTimeout:setT,clearTimeout:clearT,setInterval:()=>0,
      document:{addEventListener(k,fn){if(k==='DOMContentLoaded')ready=fn;}},
      Workstreams:{generalId:()=>'general',get:()=>null,adopt:r=>r},App:{persist(){},refreshRail(){}},
      StationCommands:{reconcile:()=>new Promise(res=>setT(res,s.reconcileMs))},
      fetch:(_u,o)=>new Promise((res,rej)=>{
        o.signal.addEventListener('abort',()=>rej(new Error('aborted')));
        if(s.mode==='hang')return;
        if(s.mode==='fail'){setT(()=>rej(new Error('offline')),s.rtt);return;}
        // bodyTask: the body is read on a task of its own, posted when json() is called, and an abort errors it
        const answer={ok:true,json:()=>s.bodyTask?new Promise((r2,j2)=>{if(o.signal.aborted)return j2(new Error('aborted'));setT(()=>r2(ledger),0);o.signal.addEventListener('abort',()=>j2(new Error('aborted')));}):Promise.resolve(ledger)};
        if(s.mode==='held'){s.deliver=()=>res(answer);return;}   // the answer sits in the page's queue until deliver()
        setT(()=>res(answer),s.rtt);
      })};
    if(gate)c.PollGate=gate==='real'?PollGate:gate;
    if(navigator)c.navigator=navigator;
    vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../frontend/app/overseer.js'),'utf8'),c);
    const o=c.module.exports;
    return Object.assign(s,{o,advance,stall:ms=>{T+=ms;},stepWall:ms=>{wall+=ms;},
      start:async()=>{ready();await drain();},
      ask:async()=>{const p=o.refresh();await advance(s.rtt+1);await p;},   // one read, answered (or refused)
      read:()=>({fresh:o.fresh(),unreachable:o.unreachable()}),
      done(){if(gate==='real')PollGate._resetForTest();}});
  }

  /* IDLE CPU PIECE 3 (2026-10-20): the beat runs through PollGate — 2.5 s on screen, a 30 s floor while the Commander is
     away, a catch-up read the moment they are back. Freshness counts the cadence that produced the answer.
     fix round 3 (2026-10-20): "station unreachable" only once the page has SEEN the station fail — a failed read, or an ask
     that ran past its 8 s deadline on the page's own timer. A clock read alone never says it (a reader right after a
     stall found "this ask is 5 s old" while the answer sat queued behind it). */
  {
    let cadence=2500;
    const r=rig({gate:{every(fn,o){assert.equal(o.ms,2500,'the overseer keeps its 2.5 s visible beat');return {interval:()=>cadence,cadence:()=>cadence,stop(){},runNow(){}};}}});
    await r.start();const g=r.o;
    await r.ask();assert.equal(g.fresh(),true,'gated: a ledger just answered is fresh');
    // the Commander comes back 40 s later with nothing asked meanwhile; the catch-up read goes out and the station sits on it
    r.stall(40000);r.mode='hang';let p=g.refresh();
    assert.deepEqual(r.read(),{fresh:false,unreachable:false},'IN FLIGHT, OLD LEDGER: a 40 s old visible-beat ledger is not vouched for while the catch-up read is out, and that read is not "station unreachable"');
    await r.advance(4000);assert.equal(g.unreachable(),false,'four seconds into the ask: not unreachable');
    await r.advance(4100);assert.deepEqual(r.read(),{fresh:false,unreachable:true},'REAL FAILURE: the ask ran past its 8 s deadline on the page own timer: unreachable');
    await p;r.mode='answer';
    // an answer asked for while away (the 30 s floor) stays current for three of those beats, plus the late grace
    cadence=30000;await r.ask();
    r.stall(40000);assert.equal(g.fresh(),true,'an answer from a 30 s away beat is still current 40 s later');
    r.stall(70000);assert.equal(g.fresh(),false,'…but not 110 s later (three of its beats and the 15 s late grace)');
    // back on screen at 2.5 s
    cadence=2500;await r.ask();
    r.stall(4000);assert.equal(g.fresh(),true,'visible: an answer 4 s old is current');
    r.stall(60000);assert.equal(g.fresh(),false,'visible: an answer a minute old with nothing asked since is not');
    // the design's own case: the last answer came from a 30 s away beat, the catch-up read is on its way 40 s later
    cadence=30000;await r.ask();cadence=2500;
    r.stall(40000);p=g.refresh();
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'an answer from a 30 s away beat, 40 s old, catch-up in flight: still current');
    await r.advance(100);await p;
    // an hour-old ledger (a sleep, a frozen page) with the catch-up read in flight
    r.stall(3600000);p=g.refresh();
    assert.deepEqual(r.read(),{fresh:false,unreachable:false},'IN FLIGHT, OLD LEDGER: an hour-old ledger is never fresh because an ask is out, and the ask on its way is not "station unreachable"');
    await r.advance(100);await p;
    assert.equal(g.fresh(),true,'…until the catch-up read answers');
    // a refused read is the station not answering, at once; the next answer recovers
    r.mode='fail';await r.ask();
    assert.deepEqual(r.read(),{fresh:false,unreachable:true},'REAL FAILURE: a refused read: unreachable, not fresh');
    r.mode='answer';await r.ask();
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'…and the next answer makes the ledger current again');
  }

  /* the ledger's ages are monotonic AND wall: the longer of the two (performance.now when present). A backward wall-clock
     step can never make an old ledger current; WebKit's performance.now (macOS WKWebView, Linux WebKitGTK) stands still
     while the machine sleeps, so the wall clock still ages a pre-sleep ledger. */
  {
    const r=rig();const m=r.o;
    await r.ask();assert.equal(m.fresh(),true,'monotonic: a ledger just answered is fresh');
    r.stall(60000);r.stepWall(-3600000);
    assert.equal(m.fresh(),false,'a minute with no answer, wall clock stepped back an hour: still not fresh (Date.now said fresh)');
    r.mode='hang';let p=m.refresh();await r.advance(6000);r.stepWall(-3600000);
    assert.deepEqual(r.read(),{fresh:false,unreachable:false},'an ask the station has sat on for 6 s (monotonic): no longer vouched for, not yet past its deadline');
    await r.advance(2100);
    assert.equal(m.unreachable(),true,'…past its 8 s deadline on the monotonic clock: unreachable, whatever the wall clock did');
    await p;r.mode='answer';
    await r.ask();assert.equal(m.fresh(),true,'fixture: answered again');
    r.stepWall(3600000);   // an hour of sleep that stopped performance.now: the wall clock moved, the monotonic one did not
    assert.equal(m.fresh(),false,'an hour-old ledger after a sleep that stopped performance.now is not current (it read fresh)');
    await r.ask();assert.equal(m.fresh(),true,'fixture: answered again after the resume');
    r.mode='hang';p=m.refresh();r.stepWall(3600000);
    assert.deepEqual(r.read(),{fresh:false,unreachable:false},'an ask out across an hour of that sleep: its pre-sleep ledger is not vouched for (it read 0 s old), and the page has not lived through its deadline (the station slept too)');
    await r.advance(8100);
    assert.equal(m.unreachable(),true,'…once the page has lived through the deadline: unreachable');
    await p;r.mode='answer';
  }

  /* fix round 4 (2026-10-20): THE WALL CLOCK AGES A LEDGER ONLY WHERE performance.now STANDS STILL IN A SLEEP. On Windows
     (WebView2: QueryPerformanceCounter) the monotonic clock counts the sleep itself, and reading the wall clock there only
     let a forward wall step (a w32time correction, the Commander setting the clock) make a ledger 0.1 s old read stale:
     the rail said "crew · unknown — checking the station" though the station had answered every ask. */
  {
    const r=rig({navigator:{userAgent:'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36 Edg/130.0.0.0',platform:'Win32'}});const m=r.o;
    await r.ask();assert.equal(m.fresh(),true,'Windows: a ledger just answered is fresh');
    r.stepWall(60000);r.stall(100);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'WINDOWS, WALL STEPPED +60 s: a ledger 0.1 s old on the monotonic clock is still current (it read "checking the station")');
    r.stall(3600000);
    assert.equal(m.fresh(),false,'Windows: an hour of sleep counted by performance.now still makes the ledger stale');
    await r.ask();r.stepWall(-3600000);
    assert.equal(m.fresh(),true,'Windows: a backward wall step changes nothing either');
  }
  for(const nav of [{userAgent:'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',platform:'MacIntel'},
    {userAgent:'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/605.1.15 (KHTML, like Gecko)',platform:'Linux x86_64'}]){
    const r=rig({navigator:nav});const m=r.o;
    await r.ask();r.stepWall(3600000);
    assert.equal(m.fresh(),false,nav.platform+': an hour of sleep that stopped performance.now still makes the pre-sleep ledger stale (the wall clock is read there)');
  }

  /* fix round 3 (2026-10-20): THE PAGE'S OWN LATENESS IS NOT THE STATION'S. Each case below failed on the previous formula
     (fresh = an age past three beats with nothing else; hung = a clock read 5 s after the ask, the beat's reconcile too). */
  {
    // LATE BEAT, nothing asked: the REAL PollGate beats on screen; right after an answer the page's event loop is busy 10 s,
    // and the first reader after it is the rail's tick. Every ask the station was given, it answered.
    const r=rig({gate:'real'});await r.start();await r.advance(20100);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'fixture: beating on screen, the ledger is current');
    r.stall(10000);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'LATE BEAT: a ledger a 10 s stall left old is still current (it read "crew · unknown — station unreachable")');
    await r.advance(3000);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'…and the overdue beat answers and keeps it current');
    r.done();
  }
  {
    // LATE BEAT, ask out: the beat's ask went out on time, its answer arrived 40 ms later, and the page's event loop was
    // busy for the next 10 s — the answer is queued behind the reader that runs first
    const r=rig({gate:'real'});await r.start();await r.advance(20000);   // the 20 s beat's ask is out, its answer due at +40 ms
    r.stall(10000);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'LATE BEAT: an answer queued behind a 10 s stall is not "station unreachable" (it read hung: "this ask is 10 s old")');
    await r.advance(1);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'…the queued answer lands first and the ledger stays current');
    r.done();
  }
  {
    // LATE DEADLINE: the station answered at 9 s while the page was stalled until 12 s, so the page's 8 s deadline fires
    // after the answer came in but before it was read. A deadline the page saw late gives the ask one more beat.
    const r=rig({gate:'real'});await r.start();await r.advance(20100);
    r.rtt=9000;await r.advance(2400);   // the 22.5 s beat: its ask is out, the station answers at +9 s
    r.stall(12000);
    await r.advance(1);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'LATE DEADLINE: the answer that came in during the stall is taken, never thrown away as "station unreachable" (the 8 s abort ran first)');
    r.done();
  }
  {
    // the station really sits on an on-time ask, and the page is watching (its timers run on time)
    const r=rig({gate:'real'});await r.start();await r.advance(20100);
    r.mode='hang';await r.advance(2400);   // the 22.5 s beat's ask is out and never answers
    await r.advance(4900);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'4.9 s into an on-time ask: still current (7.4 s from the answer)');
    await r.advance(200);
    assert.deepEqual(r.read(),{fresh:false,unreachable:false},'IN FLIGHT, OLD LEDGER: two beats into an ask the station sits on, the ledger no longer vouches, and nothing claims unreachable yet (it did at 5 s)');
    await r.advance(3000);
    assert.deepEqual(r.read(),{fresh:false,unreachable:true},'REAL FAILURE: past the 8 s deadline the page lived through: unreachable');
    // the overdue beat right after the abort asked again (still hanging); once that one is aborted too, a beat answers
    r.mode='answer';await r.advance(9000);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'…and the next beat that answers recovers');
    r.done();
  }
  {
    // the station answered and the page is busy reconciling deliveries (StationCommands.reconcile, awaited in the beat)
    const r=rig();r.reconcileMs=6000;
    const p=r.o.refresh();await r.advance(5500);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'a 6 s reconcile after the answer is not the station hanging (it read hung 5 s after the ask)');
    await r.advance(600);await p;
  }

  /* fix round 4 (2026-10-20): THE SLOW TIMER IS A VERDICT TOO. Round 3 gave the 8 s deadline its "seen late" grace, but
     the 5 s timer that marks an ask slow (and makes fresh() false) had none: a page stalled past the 5 s mark ran it
     before the station's answer — already in, only queued behind the stall — and a reader between them said "crew ·
     unknown — checking the station". Neither verdict is drawn by a timer the page saw late, or once the answer is in. */
  {
    // the whole answer queued behind the overdue timers: the station answered at once, the page stalled 10 s, and the
    // answer's task runs only after the timers that came due during the stall
    const r=rig({gate:'real'});await r.start();await r.advance(20100);
    r.mode='held';await r.advance(2450);   // the 22.5 s beat's ask is out; the station's answer waits in the page's queue
    r.stall(10000);
    await r.advance(0);                    // the overdue slow (5 s) and deadline (8 s) timers run first
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'SLOW SEEN LATE: an answer queued behind a 10 s stall is not "checking the station" (the overdue 5 s timer marked the ask slow)');
    r.deliver();await r.advance(0);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'…and the queued answer lands and keeps the ledger current');
    r.done();
  }
  {
    // the answer's headers came in at 4.6 s, the page was busy 4.55 → 5.5 s (the slow timer fires 0.5 s late — inside
    // LATE_FIRE_MS), and the body is read on a task of its own posted when json() is called: the slow timer runs between
    const r=rig({gate:'real'});await r.start();await r.advance(20100);
    r.rtt=4600;r.bodyTask=true;await r.advance(2400 + 4550);   // 4.55 s into the 22.5 s beat's ask, every timer on time
    r.stall(950);
    const seen=[];r.afterTask=()=>seen.push(r.read());
    await r.advance(0);r.afterTask=null;
    assert.ok(seen.length>=3&&seen.every(x=>x.fresh&&!x.unreachable),'ANSWER IN, BODY ON ITS WAY: every reader between the headers and the body says current (one said "checking the station"): '+JSON.stringify(seen));
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'…and the body lands');
    r.done();
  }
  {
    // the same at the deadline: headers at 7.9 s, the page busy 7.85 → 8.5 s, so the 8 s deadline fires 0.5 s late with
    // the answer in and its body still being read. It aborted that read, and the rail said "station unreachable".
    const r=rig({gate:'real'});await r.start();await r.advance(20100);
    r.rtt=7900;r.bodyTask=true;await r.advance(2400 + 7850);   // 7.85 s into the 22.5 s beat's ask
    r.stall(650);
    await r.advance(0);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'ANSWER IN AT THE DEADLINE: a body still being read when a late deadline fires is taken, never thrown away as "station unreachable"');
    r.done();
  }
  {
    // …and the verdicts still come when the station really sits on an ask: a deadline graced once still aborts
    const r=rig({gate:'real'});await r.start();await r.advance(20100);
    r.mode='hang';await r.advance(2450);
    r.stall(10000);await r.advance(0);
    assert.deepEqual(r.read(),{fresh:true,unreachable:false},'the overdue verdicts were seen late: each gives the ask one more beat');
    await r.advance(2600);
    assert.deepEqual(r.read(),{fresh:false,unreachable:true},'a beat the page lived through on time with no answer: slow, and past the deadline — unreachable');
    r.done();
  }


  /* fix round 2 (2026-10-20): AN AWAY STRETCH IS NOT STALENESS. GENUINE (executed): the REAL pollgate.js (fake monotonic
     clock + timers through its seams, a rAF probe that answers only while visible) and the REAL overseer.js, whose fetch
     answers after a 40 ms round trip. The last answer before a minimize came from the 2.5 s visible beat and the
     first away beat answers ~30 s later: a Commander back 10-32 s after a minimize saw the rail's crew row read "crew ·
     unknown — station unreachable" (fresh() false) while the station answered all along. */
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
