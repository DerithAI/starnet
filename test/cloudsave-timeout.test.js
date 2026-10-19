'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../frontend/app/cloudsave.js'), 'utf8');

(async () => {
  for (const phase of ['headers', 'body']) {
    let release, signal;
    const timers = new Map(); let seq = 0;
    const context = { console, module: { exports: {} }, require, AbortController,
      setTimeout(fn, delay) { const id = ++seq; timers.set(id, { fn, delay }); return id; },
      clearTimeout(id) { timers.delete(id); },
      fetch(url, opts) {
        signal = opts.signal;
        if (phase === 'headers') return new Promise(resolve => { release = () => resolve({ ok: true, json: async () => ({ ok: true }) }); });
        return Promise.resolve({ ok: true, json: () => new Promise(resolve => { release = () => resolve({ ok: true }); }) });
      }
    };
    vm.runInNewContext(source, context);
    const client = context.module.exports;
    client.push({ schema: 'starnet.save', version: 5, updatedAt: 1, agent: { id: 'agent' } });
    const writing = client.flush({ force: true });
    await Promise.resolve(); await Promise.resolve();
    const deadline = [...timers.values()].find(t => t.delay === 15000);
    assert.ok(deadline, phase + ' write has a bounded persistence deadline');
    deadline.fn();
    assert.equal(await writing, false, phase + ' timeout is not success');
    assert.equal(signal.aborted, true);
    assert.equal(client.health().lastPushOkAt, 0);
    release(); await Promise.resolve(); await Promise.resolve();
    assert.equal(client.health().lastPushOkAt, 0, 'late reply cannot acknowledge expired transport');
    let retried;
    context.fetch = async (url, opts) => { retried = JSON.parse(opts.body); return { ok: true, json: async () => ({ ok: true }) }; };
    assert.equal(await client.flush({ force: true }), true, 'same snapshot can retry after timeout');
    assert.equal(retried.agent.id, 'agent');
  }
  // Initial GET must remain unknown when headers or a partial JSON body stall.
  for (const phase of ['headers', 'body']) {
    let signal, late;
    const timers=new Map();let seq=0;
    const hung=()=>new Promise((resolve,reject)=>{late=resolve;signal.addEventListener('abort',()=>reject(new Error('aborted')),{once:true});});
    const context={console,module:{exports:{}},require,AbortController,setTimeout(fn,delay){const id=++seq;timers.set(id,{fn,delay});return id;},clearTimeout(id){timers.delete(id);},fetch(url,opts){signal=opts.signal;return phase==='headers'?hung():Promise.resolve({ok:true,json:hung});}};
    vm.runInNewContext(source,context);const client=context.module.exports;
    const pulling=client.pull();await Promise.resolve();await Promise.resolve();
    const deadline=[...timers.values()].find(t=>t.delay===2500);assert.ok(deadline,phase+' GET has bounded deadline');deadline.fn();
    assert.equal(await pulling,null);assert.equal(signal.aborted,true);assert.equal(client.pullOutcome(),'unreachable','GET timeout never proves empty');
    late({save:null});await Promise.resolve();assert.equal(client.pullOutcome(),'unreachable','late response cannot turn timeout into empty');
    const doc={schema:'starnet.save',version:5,updatedAt:1,agent:{id:'agent'}};
    context.fetch=async()=>({ok:true,json:async()=>({save:doc})});assert.deepEqual(await client.pull(),doc);assert.equal(client.pullOutcome(),'save','same client can retry successfully');
  }
  console.log('cloudsave timeout: stalled headers/body, abort, late acknowledgement and retry PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
