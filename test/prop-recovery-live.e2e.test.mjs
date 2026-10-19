/* Real seeded-app regression for authored prop and station cache loss. Clear the
   prepared prop's actual canvas and dispatch contextlost, then verify same-page
   authored pixels and floor recovery. No real model or driver crash is needed. */
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findChrome, connectCDP, evalJS, collectDiagnostics, sleep } from '../scripts/lib/cdp.mjs';
import { materializeSeedWorkspace, bootSeededSidecar, waitUp, waitDevReady } from '../scripts/lib/seed.mjs';

const failures = [];
const check = (name, ok, detail = '') => {
  console.log((ok ? 'PASS ' : 'FAIL ') + name + (detail ? ' :: ' + detail : ''));
  if (!ok) failures.push(name);
};
const freePort = () => new Promise((resolve, reject) => {
  const server = createServer();
  server.once('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const address = server.address();
    server.close(error => error ? reject(error) : resolve(address.port));
  });
});
// Let Chromium close its workers before removing their profile. Killing only the
// browser PID on Windows can leave child processes holding cache/log files open.
const stopChild = (child, graceful = false) => new Promise(resolve => {
  if (!child || child.exitCode != null) { resolve(); return; }
  let killTimer;
  const timer = setTimeout(resolve, 6000);
  child.once('exit', () => { clearTimeout(timer); clearTimeout(killTimer); resolve(); });
  const kill = () => {
    try {
      if (process.platform === 'win32') {
        const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
        killer.on('error', () => { try { child.kill('SIGKILL'); } catch {} });
      } else child.kill('SIGKILL');
    } catch (_) { clearTimeout(timer); resolve(); }
  };
  if (graceful) killTimer = setTimeout(kill, 3000); else kill();
});

const root = mkdtempSync(join(tmpdir(), 'starnet-crt-loss-'));
const workspace = join(root, 'workspace');
const profile = join(root, 'profile');
const appPort = await freePort();
const cdpPort = await freePort();
const appUrl = `http://127.0.0.1:${appPort}/`;
materializeSeedWorkspace(workspace);
const sidecar = bootSeededSidecar({ port: appPort, scratchDir: workspace });
const chrome = spawn(findChrome(), [
  '--headless=new', '--no-first-run', '--no-default-browser-check', '--hide-scrollbars', '--mute-audio',
  '--disable-gpu',
  `--remote-debugging-port=${cdpPort}`, '--window-size=1280,720', `--user-data-dir=${profile}`, 'about:blank'
], { stdio: 'ignore' });

let cdp = null;
try {
  check('isolated seeded sidecar starts', await waitUp(appUrl));
  cdp = await connectCDP(cdpPort);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  const diagnostics = collectDiagnostics(cdp);
  // Optional before-fix proof uses the old renderer bytes in the same real app,
  // without modifying any checkout or the owner's installed application.
  if(process.env.STARNET_REPRO_BASELINE){
    const source=execFileSync('git',['show',process.env.STARNET_REPRO_BASELINE+':frontend/app/propremaster.js'],{encoding:'utf8'});
    await cdp.send('Fetch.enable',{patterns:[{urlPattern:'*app/propremaster.js*'}]});
    cdp.on('Fetch.requestPaused',p=>{cdp.send('Fetch.fulfillRequest',{requestId:p.requestId,responseCode:200,responseHeaders:[{name:'Content-Type',value:'text/javascript'}],body:Buffer.from(source).toString('base64')}).catch(()=>{});});
  }
  await cdp.send('Page.navigate', { url: appUrl });
  check('seeded station reaches the live floor', await waitDevReady(cdp, evalJS, { url: appUrl }));


  cdp.timeoutMs=90000;
  await evalJS(cdp, 'PropRemaster.ready');
  const before=await evalJS(cdp, `(()=>{const key=PropRemaster.status().views.find(k=>k.endsWith(':s'));const [id,view]=key.split(':');const geo=PropRemaster.viewGeometry(id,view);const c=document.createElement('canvas');c.width=c.height=512;const g=c.getContext('2d');const sources=[];const draw=g.drawImage.bind(g);g.drawImage=(im,...args)=>{sources.push(im);return draw(im,...args);};const paint=()=>{g.clearRect(0,0,512,512);const ok=PropRemaster.draw(g,id,view,120,120,geo.spec.footprint.w*12,geo.spec.footprint.h*12,{still:true},()=>{});const px=g.getImageData(0,0,512,512).data;return {ok,alpha:px.reduce((a,v,i)=>a+(i%4===3?v:0),0)};};const initial=paint();window.__lossProof={paint,body:sources[0],geo,id,view};return {key,...initial,status:PropRemaster.status()};})()`);
  check('authored prop starts with visible pixels',before.ok&&before.alpha>0,JSON.stringify({key:before.key,alpha:before.alpha,pixels:before.status.pixels}));
  const immediate=await evalJS(cdp, `(()=>{const c=__lossProof.body,g=c.getContext('2d');g.setTransform(1,0,0,1,0,0);g.clearRect(0,0,c.width,c.height);c.dispatchEvent(new Event('contextlost',{cancelable:true}));return {...__lossProof.paint(),lost:PropRemaster.status().lost};})()`);
  check('loss preserves authored pixels instead of legacy fallback',immediate.ok&&immediate.alpha===before.alpha&&immediate.lost>0,JSON.stringify(immediate));
  await evalJS(cdp,'PropRemaster.whenRecovered?.()');
  const after=await evalJS(cdp,'({...__lossProof.paint(),lost:PropRemaster.status().lost,recovering:PropRemaster.status().recovering})');
  check('authored artwork recovers on same page',after.ok&&after.alpha===before.alpha&&after.lost===0&&after.recovering===0,JSON.stringify(after));
  const floor=await evalJS(cdp,'World._dbgLoseCanvases(); World._dbgCanvasLoss()');
  // Software rendering under the full gate can take longer than one fixed delay.
  // Wait for proven recovered pixels, retaining a hard deadline for real failures.
  const floorDeadline=Date.now()+15000;
  let recovered=floor;
  while(Date.now()<floorDeadline){
    await sleep(250);
    recovered=await evalJS(cdp,'World._dbgCanvasLoss()');
    if(recovered.recoveries>floor.recoveries&&recovered.blank===false&&recovered.probeOff===false&&recovered.probe!=null)break;
  }
  check('station floor recovers after cache loss',recovered.recoveries>floor.recoveries&&recovered.blank===false&&recovered.probeOff===false&&recovered.probe!=null,JSON.stringify(recovered));
  check('graphics recovery has no uncaught errors',diagnostics.exceptions.length===0,JSON.stringify(diagnostics.exceptions));

} catch (error) {
  console.log('FAIL harness :: ' + (error && error.stack || error));
  failures.push('harness');
} finally {
  try { if (cdp) await Promise.race([cdp.send('Browser.close'), sleep(2000)]); } catch {}
  try { cdp?.ws.close(); } catch {}
  await Promise.all([stopChild(chrome, true), stopChild(sidecar)]);
  const resolvedRoot = root.replace(/\\/g, '/');
  if (resolvedRoot.startsWith(tmpdir().replace(/\\/g, '/') + '/') && /starnet-crt-loss-/.test(resolvedRoot)) {
    // Chrome's children can hold chrome_debug.log for seconds after the parent exits on a loaded
    // Windows box (2s was not enough under a full gate) — the same transient-lock window
    // stationbake.connections.test.mjs allows, and it still fails if the lock never lifts.
    for (let attempt = 0; attempt < 50; attempt++) {
      try { rmSync(root, { recursive: true, force: true }); break; }
      catch (error) { if (!['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(error.code) || attempt === 49) throw error; await sleep(200); }
    }
  }
}

console.log('\n=== ' + (failures.length ? 'FAILURES: ' + failures.join(', ') : 'ALL CHECKS PASSED') + ' ===');
process.exit(failures.length ? 1 : 0);
