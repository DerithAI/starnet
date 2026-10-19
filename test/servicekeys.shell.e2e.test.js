/* node test/servicekeys.shell.e2e.test.js — a KEYS-tab key reaching a REAL child process through shell.exec.

   THE SEAM THAT BROKE (2026-07-24): servicekeys.test.js proved applyEnv against a fake env object,
   environment.test.js proved sanitizeChildEnv in isolation, and shell.test.js drove real subprocesses but
   wired makeShellTool WITHOUT an environment manager (so it fell to the raw-spawn branch and inherited
   process.env). Three green tests, and the composition they straddled was severed: index.js wires
   makeShellTool WITH executionEnvironment, whose sanitizeChildEnv strips every *_API_KEY — and
   servicekeys.deriveEnvVar always ends in _API_KEY. Every pasted key expanded to '' and agents got 401s.

   This file spawns a REAL child through the REAL wiring (shell.exec × environment manager × servicekeys)
   and asserts watched keys arrive only on watched runs while unattended children receive only explicitly
   granted keys. Spawns processes → rides test:http, not the fast gate. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { makeClock } = require('../shared/clock-rng.js');
const { makeShellTool } = require('../sidecar/tools/builtin/shell.js');
const { makeEnvironmentManager } = require('../sidecar/environment.js');
const K = require('../sidecar/servicekeys.js');

// platform-agnostic: read the var from inside the child rather than relying on %VAR% vs $VAR shell syntax.
const ECHO = 'node -e "console.log(process.env.PRINTIFY_API_KEY || \'MISSING\')"';
const ECHO_UNATTENDED = 'node -e "console.log((process.env.PRINTIFY_API_KEY || \'MISSING\') + \'|\' + (process.env.NIGHTLY_API_KEY || \'MISSING\'))"';
const ECHO_PROVIDER = 'node -e "console.log(process.env.OPENROUTER_API_KEY || \'MISSING\')"';
const RESERVED = new Set(['OPENROUTER_API_KEY']);

(async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sk-keys-'));

  // a host env shaped like the real sidecar's: a provider/billing key plus whatever the Commander pastes.
  const hostEnv = Object.assign({}, process.env, { OPENROUTER_API_KEY: 'sk-or-BILLING-DO-NOT-LEAK' });
  let keys = [];
  let owned = {};
  const apply = () => { owned = K.applyEnv(keys, hostEnv, owned, { reservedEnv: RESERVED }); };

  // EXACTLY the index.js wiring: environment manager gets the lazy serviceEnv hook, shell tool gets the manager.
  const environment = makeEnvironmentManager({
    spawn, fs, pathMod: path, root, clock: makeClock(0), env: hostEnv,
    serviceEnv: (surface) => K.runEnv(keys, hostEnv, { reservedEnv: RESERVED, surface: surface })
  });
  const tool = makeShellTool({
    spawn, fs, pathMod: path, root, environment, clock: makeClock(0), redact: (s) => s
  }).execTool;
  const ctx = (surface) => ({ agentId: 'a1', runId: 'r1', callId: 'c1', surface: surface || 'interactive', emit: () => {} });

  try {
    // ---- 1. before any paste: absent ----
    const before = await tool.run({ cmd: ECHO }, ctx());
    A.ok(/MISSING/.test(before.content), 'with no service key pasted the var is absent from the child');

    // ---- 2. paste it: the REAL child process must see the REAL value ----
    keys = K.upsert(keys, { name: 'Printify', key: 'test-printify-token-9f3a' }, 1, { reservedEnv: RESERVED }).list;
    apply();
    const after = await tool.run({ cmd: ECHO }, ctx());
    A.ok(/test-printify-token-9f3a/.test(after.content),
      'THE REGRESSION: a KEYS-tab key reaches a real shell child — got: ' + JSON.stringify(after.content.slice(0, 120)));
    A.ok(/\[exit 0/.test(after.content), 'the probe command exited 0');

    // no restart happened between 1 and 2 — proves the child env is not a boot-time snapshot
    A.ok(true, 'a key pasted after the environment manager was constructed is live immediately');

    // ---- 3. an unattended child gets only keys explicitly granted for unattended use ----
    keys = K.upsert(keys, { name: 'Nightly', key: 'test-nightly-token-a81c' }, 2, { reservedEnv: RESERVED }).list;
    keys = K.setAutonomous(keys, 'nightly', true, 3).list;
    apply();
    const unattended = await tool.run({ cmd: ECHO_UNATTENDED }, ctx('autonomous'));
    A.ok(/MISSING\|test-nightly-token-a81c/.test(unattended.content),
      'an unattended real child receives the granted key but NEVER the watched-only key — got: ' + JSON.stringify(unattended.content.slice(0, 160)));
    A.ok(/\[exit 0/.test(unattended.content), 'the unattended child probe exited 0');

    // ---- 4. a provider/billing key must STILL never reach a child ----
    const billing = await tool.run({ cmd: ECHO_PROVIDER }, ctx());
    A.ok(/MISSING/.test(billing.content),
      'a model-provider key is still scrubbed from the child — got: ' + JSON.stringify(billing.content.slice(0, 120)));

    // ---- 5. disabling takes effect on the very next call ----
    keys = K.setEnabled(keys, 'printify', false, 4).list;
    apply();
    const off = await tool.run({ cmd: ECHO }, ctx());
    A.ok(/MISSING/.test(off.content), 'disabling the key removes it from the very next shell call');

    // ---- 6. a 1Password reference: the persisted row holds only op://…; the value read into the cache reaches the
    //         child through the SAME applyEnv/runEnv path once index.js hands them the LIVE list ----
    const OP = require('../sidecar/onepassword.js');
    const ECHO_OP = 'node -e "console.log(process.env.VAULTED_API_KEY || \'MISSING\')"';
    const refs = OP.makeRefCache({ reader: { read: () => Promise.resolve({ ok: true, value: 'test-vaulted-token-77d2' }) }, now: () => 1 });
    keys = K.upsert(keys, { name: 'Vaulted', key: 'op://Private/Vaulted/credential' }, 5, { reservedEnv: RESERVED }).list;
    const applyLive = () => { owned = K.applyEnv(refs.live(keys), hostEnv, owned, { reservedEnv: RESERVED }); };
    const liveEnvironment = makeEnvironmentManager({
      spawn, fs, pathMod: path, root, clock: makeClock(0), env: hostEnv,
      serviceEnv: (surface) => K.runEnv(refs.live(keys), hostEnv, { reservedEnv: RESERVED, surface: surface })
    });
    const liveTool = makeShellTool({ spawn, fs, pathMod: path, root, environment: liveEnvironment, clock: makeClock(0), redact: (s) => s }).execTool;
    applyLive();
    A.ok(/MISSING/.test((await liveTool.run({ cmd: ECHO_OP }, ctx())).content), 'a reference not read yet gives the child nothing');
    await refs.ensureFresh(keys, { surface: 'interactive', waitMs: 1000 });
    applyLive();
    const vaulted = await liveTool.run({ cmd: ECHO_OP }, ctx());
    A.ok(/test-vaulted-token-77d2/.test(vaulted.content), 'the value read from 1Password reaches a real shell child — got: ' + JSON.stringify(vaulted.content.slice(0, 120)));
    A.ok(JSON.stringify(keys).indexOf('test-vaulted-token-77d2') < 0, 'and is never in the persisted list');
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }

  A.report('servicekeys.shell.e2e.test.js');
})();
