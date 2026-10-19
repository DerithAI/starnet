'use strict';
const A = require('./_assert.js');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), crypto = require('node:crypto');
const { execFile, execFileSync } = require('node:child_process');
const { makeCheckpointStore } = require('../sidecar/checkpoint-store.js');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-checkpoint-maintenance-'));
let active = 0, peak = 0, calls = [], failMaintenance = false, failAdd = false;
function runGit(args, opts) {
  calls.push(args); active++; peak = Math.max(peak, active);
  const failing = (failMaintenance && (args.includes('gc') || (args[1].endsWith('.reinit') && args.includes('add')))) || (failAdd && args.includes('add'));
  if (failing) { active--; return Promise.resolve({code:1,stdout:'',stderr:'injected failure'}); }
  return new Promise(resolve => execFile('git', args, {cwd:opts.cwd,windowsHide:true,timeout:15000}, (err,stdout,stderr) => {
    active--; resolve({code:err?1:0,stdout:String(stdout||''),stderr:String(stderr||'')});
  }));
}
const deps = { fs, pathMod:path, root, runGit, clock:{now:()=>1700000000000} };
const aid = 'worker', wt = path.join(root,aid);
const gitDirOf = id => path.join(root,'.checkpoints',id,'git');
const gitOut = (id, args) => execFileSync('git',['--git-dir',gitDirOf(id)].concat(args),{windowsHide:true,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const gitHas = (id, rev) => { try { gitOut(id,['cat-file','-e',rev]); return true; } catch (e) { return false; } };
fs.mkdirSync(wt); fs.writeFileSync(path.join(wt,'draft.txt'),'baseline');
const pack = path.join(root,'.checkpoints',aid,'git','objects','pack');
const garbage = path.join(pack,'tmp_pack_fixture');
function inflate() { fs.mkdirSync(pack,{recursive:true}); fs.writeFileSync(garbage,Buffer.alloc(128*1024)); }
// reference size: the plain synchronous recursive walk the store used to run on every snapshot
function walkBytes(dir) { let t = 0; for (const e of fs.readdirSync(dir,{withFileTypes:true})) { const f = path.join(dir,e.name); t += e.isDirectory() ? walkBytes(f) : fs.statSync(f).size; } return t; }
function looseObjects(id) {
  const objects = path.join(gitDirOf(id),'objects'), out = [];
  for (const d of fs.readdirSync(objects)) if (/^[0-9a-f]{2}$/.test(d)) for (const f of fs.readdirSync(path.join(objects,d))) if (/^[0-9a-f]{38,62}$/.test(f)) out.push(path.join(objects,d,f));
  return out;
}
(async () => {
  try {
    const wide = makeCheckpointStore({...deps,maxRepoBytes:10*1024*1024});
    A.ok(await wide.snapshot(aid,{runId:'initial'}),'baseline exists');
    const bounded = makeCheckpointStore({...deps,maxRepoBytes:96*1024});
    inflate(); calls=[];
    const unchanged = await bounded.snapshot(aid,{runId:'unchanged'});
    A.ok(calls.some(a=>a.includes('gc')),'unchanged snapshot enforces ceiling');
    A.ok(unchanged && bounded.list(aid).snapshots.some(s=>s.id===unchanged.id),'maintenance returns a recorded surviving checkpoint');
    A.ok(!fs.existsSync(garbage),'replacement removes abandoned shadow data');
    fs.writeFileSync(path.join(wt,'draft.txt'),'later edit');
    A.ok(await bounded.restore(aid,unchanged.id),'post-maintenance id really restores');
    A.eq(fs.readFileSync(path.join(wt,'draft.txt'),'utf8'),'baseline','restore preserves baseline bytes');
    // The failed-replacement proof needs the repo over the ceiling with REAL history, not a temp file: a gc that did
    // not exit 0 now has its tmp_pack leftovers swept, so a tmp_pack inflater would no longer keep the repo over.
    // An incompressible committed blob does, and it is exactly what a failed re-init must never lose.
    fs.writeFileSync(path.join(wt,'heavy.bin'),crypto.randomBytes(160*1024));
    const heavy = await wide.snapshot(aid,{runId:'heavy'});
    A.ok(heavy && heavy.created,'fixture: a committed incompressible blob puts real history over the bound');
    const headBefore = gitOut(aid,['rev-parse','HEAD']);
    const objectsBefore = looseObjects(aid);
    failMaintenance=true; calls=[];
    const failed = await bounded.snapshot(aid,{runId:'maintenance-failure'});
    A.ok(failed && failed.maintenance && failed.maintenance.overLimit===true,'failed cleanup is reported as over limit');
    A.eq(failed.maintenance.gcSucceeded,false,'failed GC is not reported as success');
    A.eq(failed.maintenance.reinit,false,'a failed replacement is not reported as a re-init');
    A.eq(gitOut(aid,['rev-parse','HEAD']),headBefore,'failed replacement preserves original repo (HEAD unchanged)');
    A.ok(gitHas(aid,headBefore+':heavy.bin'),'failed replacement keeps the committed blob reachable');
    A.ok(objectsBefore.length>0&&objectsBefore.every(f=>fs.existsSync(f)),'failed replacement keeps every original object file');
    A.ok(!fs.existsSync(gitDirOf(aid)+'.reinit'),'failed replacement leaves no half-built side repo');
    const priorId=failed.id; failAdd=true; calls=[];
    // The pass above ended over the ceiling, so THIS store backs off: the next turn must not start another gc.
    A.eq(await bounded.snapshot(aid,{runId:'add-failure'}),null,'failed add keeps fail-open null contract');
    A.ok(!calls.some(a=>a.includes('gc')),'a store whose last pass ended over the ceiling does not re-run maintenance next turn');
    // A store's FIRST over-ceiling pass always runs, on the failed-add path too.
    const firstPass = makeCheckpointStore({...deps,maxRepoBytes:96*1024}); calls=[];
    A.eq(await firstPass.snapshot(aid,{runId:'add-failure-first'}),null,'failed add on a fresh store keeps the null contract');
    A.ok(calls.some(a=>a.includes('gc')),'failed add still attempts bounded maintenance');
    failMaintenance=false; failAdd=false;
    A.ok(await wide.restore(aid,priorId),'failed maintenance preserves usable undo history');
    fs.rmSync(path.join(wt,'heavy.bin'),{force:true});
    peak=0; calls=[];
    const project=path.join(root,'project'); fs.mkdirSync(project); fs.writeFileSync(path.join(project,'draft.txt'),'project baseline');
    const multi=makeCheckpointStore({...deps,maxRepoBytes:10*1024*1024,scopeIdOf:()=> 'a'.repeat(24),allowWorkTree:()=>true});
    const both=await Promise.all([multi.snapshot(aid,{runId:'local'}),multi.snapshot(aid,{runId:'project',workTree:project}),multi.listResilient(aid)]);
    A.eq(peak,1,'same agent has one checkpoint Git writer across scopes');
    A.ok(both[0]&&both[1],'both scopes complete');
    const rows=multi.list(aid).snapshots;
    A.ok(rows.some(s=>s.id===both[0].id)&&rows.some(s=>s.id===both[1].id),'shared index retains both scopes');
    A.ok(calls.every(a=>a.includes('gc.auto=0')&&a.includes('maintenance.auto=false')&&a.includes('gc.autoDetach=false')),'Git cannot start hidden background maintenance');
    const tiny=makeCheckpointStore({...deps,maxRepoBytes:1});
    const replaced=await tiny.snapshot(aid,{runId:'replacement',turn:7});
    A.ok(replaced&&replaced.maintenance.reinit,'tiny ceiling exercises replacement');
    const replacement=tiny.list(aid).snapshots.find(s=>s.id===replaced.id);
    A.ok(replacement,'replacement returns surviving indexed id');
    A.eq(replacement.runId,'replacement','replacement preserves triggering run correlation');
    A.ok(await tiny.restore(aid,replaced.id),'returned replacement id restores through undo guard');
    const priorRows=tiny.list(aid).snapshots;
    const failedFs=Object.create(fs);
    failedFs.renameSync=(from,to)=>{
      if(to===path.join(root,'.checkpoints',aid,'index.json')&&!from.endsWith('.reinit-index'))throw Object.assign(new Error('index replace denied'),{code:'EACCES'});
      return fs.renameSync(from,to);
    };
    const noIndex=makeCheckpointStore({...deps,fs:failedFs,maxRepoBytes:1});
    const attempted=await noIndex.enforceSizeCeiling(aid);
    A.eq(attempted.reinit,false,'index failure rejects replacement');
    A.eq(JSON.stringify(noIndex.list(aid).snapshots),JSON.stringify(priorRows),'index failure restores previous rows');
    A.ok(await wide.restore(aid,replaced.id),'old object history survives index failure');

    /* ---- #107 residual: a gc KILLED by its timeout, every turn ----
       The runner used to ignore any per-call bound, so gc (and the re-init add/commit) died at the 15 s snapshot
       default on a big repo; the half-written tmp_pack stayed, the repo stayed over the ceiling, and the very next
       mutating turn started the same doomed gc again. The fake below answers gc and the re-init add exactly as the
       supervised runner reports a timeout ({code:null,timedOut:true}); every other call is real git. */
    const loopAid = 'looper', loopWt = path.join(root,loopAid), loopGit = gitDirOf(loopAid);
    fs.mkdirSync(loopWt); fs.writeFileSync(path.join(loopWt,'notes.txt'),'v0');
    let nowMs = 1700000000000;
    const gcOpts = [], reinitOpts = [], snapshotAddOpts = [];
    const timedOut = () => Promise.resolve({code:null,stdout:'',stderr:'checkpoint Git process tree timed out',timedOut:true});
    function killedMaintenanceGit(args, opts) {
      if (args.includes('gc')) { gcOpts.push(opts||{}); return timedOut(); }
      if (args[1].endsWith('.reinit') && args.includes('add')) { reinitOpts.push(opts||{}); return timedOut(); }
      if (args.includes('add')) snapshotAddOpts.push(opts||{});
      return runGit(args, opts);
    }
    const loopDeps = {...deps, runGit:killedMaintenanceGit, clock:{now:()=>nowMs}};
    const seeded = await makeCheckpointStore({...loopDeps,maxRepoBytes:10*1024*1024}).snapshot(loopAid,{runId:'seed'});
    A.ok(seeded && seeded.created,'fixture: looper baseline committed');
    // a real pack beside the loose objects (a completed earlier repack): the leftover sweep must never touch it
    execFileSync('git',['--git-dir',loopGit,'repack','-a','-q'],{windowsHide:true,stdio:'ignore'});
    const loopPack = path.join(loopGit,'objects','pack');
    const realPacks = fs.readdirSync(loopPack).filter(n=>/^pack-[0-9a-f]+\.(pack|idx)$/.test(n));
    A.ok(realPacks.length>=2,'fixture: a real pack and its index exist');
    // what a killed repack leaves: pack-objects' temp outputs, repack's renamed .tmp-<pid>-pack-*, a loose temp object.
    // git creates them read-only, which Windows refuses to unlink unless the attribute is handled.
    const fanout = fs.readdirSync(path.join(loopGit,'objects')).find(d=>/^[0-9a-f]{2}$/.test(d));
    const leftovers = [path.join(loopPack,'tmp_pack_killed'), path.join(loopPack,'tmp_idx_killed'),
      path.join(loopPack,'.tmp-4242-pack-'+'a'.repeat(40)+'.pack'), path.join(loopGit,'objects',fanout,'tmp_obj_killed')];
    fs.writeFileSync(leftovers[0],crypto.randomBytes(128*1024)); fs.writeFileSync(leftovers[1],'idx'); fs.writeFileSync(leftovers[2],'pack'); fs.writeFileSync(leftovers[3],'obj');
    for (const f of leftovers) fs.chmodSync(f,0o444);
    const loopHead = gitOut(loopAid,['rev-parse','HEAD']);
    const loopObjects = looseObjects(loopAid);
    const loop = makeCheckpointStore({...loopDeps,maxRepoBytes:96*1024});
    const t1 = await loop.snapshot(loopAid,{runId:'turn-1'});
    A.ok(t1 && t1.id===seeded.id,'the turn still gets its (deduped) checkpoint while gc times out');
    A.eq(gcOpts.length,1,'the over-ceiling turn runs maintenance');
    A.ok(gcOpts[0] && gcOpts[0].timeoutMs>15000,'gc gets the maintenance bound, not the 15 s snapshot default');
    A.ok(leftovers.every(f=>!fs.existsSync(f)),'a gc that did not exit 0 has its read-only tmp_pack/tmp_idx/.tmp-pack/tmp_obj leftovers removed');
    A.ok(realPacks.every(n=>fs.existsSync(path.join(loopPack,n))),'the real pack and index survive the leftover sweep');
    A.ok(loopObjects.length>0&&loopObjects.every(f=>fs.existsSync(f)),'every loose object survives the leftover sweep');
    A.eq(gitOut(loopAid,['rev-parse','HEAD']),loopHead,'the leftover sweep leaves history untouched');
    A.ok(t1.maintenance && t1.maintenance.overLimit===false,'with the leftovers gone the repo is back under the ceiling');
    A.ok(snapshotAddOpts.length>0&&snapshotAddOpts.every(o=>!(o.timeoutMs>15000)),'the snapshot-path add keeps the short default bound');

    // BACK-OFF: a ceiling the repo can never get under, gc killed AND re-init killed, three mutating turns.
    const always = makeCheckpointStore({...loopDeps,maxRepoBytes:1024});
    gcOpts.length=0; reinitOpts.length=0;
    fs.writeFileSync(path.join(loopWt,'notes.txt'),'v1');
    const b1 = await always.snapshot(loopAid,{runId:'turn-a'});
    A.ok(b1 && b1.created,'the turn records its checkpoint even though maintenance fails');
    A.ok(b1.maintenance && b1.maintenance.overLimit===true && b1.maintenance.reinit===false,'the failed pass is reported over limit, not replaced');
    A.ok(reinitOpts.length===1 && reinitOpts[0].timeoutMs>15000,'the re-init add gets the maintenance bound');
    A.eq(gitOut(loopAid,['rev-parse','HEAD']),b1.id,'a failed re-init keeps the original repo: HEAD is the checkpoint just taken');
    A.ok(gitHas(loopAid,loopHead),'a failed re-init keeps the older history');
    A.ok(!fs.existsSync(loopGit+'.reinit'),'a failed re-init leaves no side repo');
    fs.writeFileSync(path.join(loopWt,'notes.txt'),'v2'); const b2 = await always.snapshot(loopAid,{runId:'turn-b'});
    fs.writeFileSync(path.join(loopWt,'notes.txt'),'v3'); const b3 = await always.snapshot(loopAid,{runId:'turn-c'});
    A.ok(b2 && b2.created && b3 && b3.created,'turns inside the back-off window still record checkpoints');
    A.eq(gcOpts.length,1,'three over-ceiling turns inside the back-off window start ONE gc, not three');
    A.ok(!(b2.maintenance||b3.maintenance),'a skipped pass reports no maintenance it did not run');
    nowMs += 31*60*1000;
    const b4 = await always.snapshot(loopAid,{runId:'turn-d'});
    A.ok(b4,'the turn after the window records its checkpoint');
    A.eq(gcOpts.length,2,'after the back-off window maintenance is attempted again');
    const forced = await always.enforceSizeCeiling(loopAid);
    A.ok(forced.swept,'an explicit sweep is never suppressed by the back-off');
    await makeCheckpointStore({...loopDeps,maxRepoBytes:1024,maintenanceTimeoutMs:45000}).enforceSizeCeiling(loopAid);
    A.eq(gcOpts[gcOpts.length-1].timeoutMs,45000,'an injected maintenanceTimeoutMs reaches gc');
    A.ok(await always.restore(loopAid,b2.id),'a checkpoint taken during the back-off restores');
    A.eq(fs.readFileSync(path.join(loopWt,'notes.txt'),'utf8'),'v2','restore brings back the bytes captured at turn-b');

    /* ---- the size check never stat-walks the shadow object store synchronously ----
       gc.auto=0 means loose objects are only packed past the ceiling, so the old synchronous walk was an event-loop
       stall that grew with every snapshot. The figure must still equal a full walk, and an unchanged loose-object
       directory must not be re-statted on the next turn. */
    const objectsRoot = path.join(loopGit,'objects');
    const underObjects = p => path.resolve(String(p)).toLowerCase().startsWith(objectsRoot.toLowerCase());
    let syncObjectWalk = 0, looseStats = 0;
    const isLooseDirFile = p => /[\\/]objects[\\/][0-9a-f]{2}[\\/][^\\/]+$/.test(path.resolve(String(p)));
    const walkFs = Object.create(fs);
    walkFs.readdirSync = function (p, o) { if (underObjects(p)) syncObjectWalk++; return fs.readdirSync(p, o); };
    walkFs.statSync = function (p, o) { if (underObjects(p)) syncObjectWalk++; return fs.statSync(p, o); };
    const countingPromises = Object.create(fs.promises);
    countingPromises.stat = function (p, o) { if (isLooseDirFile(p)) looseStats++; return fs.promises.stat(p, o); };
    countingPromises.lstat = function (p, o) { if (isLooseDirFile(p)) looseStats++; return fs.promises.lstat(p, o); };
    Object.defineProperty(walkFs,'promises',{value:countingPromises});
    const sized = makeCheckpointStore({...deps,fs:walkFs,maxRepoBytes:1024*1024*1024});
    const m1 = await sized.enforceSizeCeiling(loopAid);
    A.eq(syncObjectWalk,0,'the size check does no synchronous readdir/stat inside the object store');
    A.eq(m1.bytesBefore,walkBytes(loopGit),'the measured figure equals a full walk of the shadow repo');
    A.ok(looseStats>0,'the first measurement reads the loose objects');
    looseStats=0;
    const m2 = await sized.enforceSizeCeiling(loopAid);
    A.eq(looseStats,0,'an unchanged loose-object store is not re-statted on the next measurement');
    A.eq(m2.bytesBefore,m1.bytesBefore,'the reused figure is unchanged');
    fs.writeFileSync(path.join(loopWt,'notes.txt'),'v5 '+'x'.repeat(4000));
    await sized.snapshot(loopAid,{runId:'grow'});
    const m3 = await sized.enforceSizeCeiling(loopAid);
    A.eq(m3.bytesBefore,walkBytes(loopGit),'new loose objects are counted on the next measurement');
    fs.writeFileSync(path.join(loopPack,'tmp_pack_planted'),Buffer.alloc(64*1024));
    const m4 = await sized.enforceSizeCeiling(loopAid);
    A.eq(m4.bytesBefore,walkBytes(loopGit),'a file planted in the pack directory is counted at once');
    A.eq(syncObjectWalk,0,'still no synchronous object-store walk across turns');
    A.report('checkpoint-maintenance.test');
  } finally { fs.rmSync(root,{recursive:true,force:true}); }
})().catch(e=>{console.error(e);process.exitCode=1;});
