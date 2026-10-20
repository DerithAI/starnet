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
  assert.equal(g.fresh(),true,'…and the last answer stays current until that read hangs');
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
  console.log('overseer sync: existing sessions, no added UI/focus changes, recovery and timeout PASS');
})().catch(e=>{console.error(e);process.exitCode=1;});
