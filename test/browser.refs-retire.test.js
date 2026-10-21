/* node test/browser.refs-retire.test.js — the browser session's ref table stays bounded (memory lane 2026-10-20).

   The session's `refs` Map kept EVERY ref it ever minted, each holding its snapshot node and a tab mark that held the
   driver object itself, so a long-lived station browser grew without bound and kept every replaced driver (and
   everything that driver held) alive. Refs of an earlier document now collapse into seq ranges per tab mark, and a
   tab mark names its driver by id. What an old ref ANSWERS must not change: the agent still gets the same refusal
   (page navigated / tab closed / unknown) byte for byte, and same-document recovery still works.

   Real session code over fake drivers; the driver-retention check uses a real GC. */
'use strict';
const A = require('./_assert.js');
const v8 = require('node:v8');
const vm = require('node:vm');
const { _internals: T } = require('../sidecar/tools/builtin/browser.js');

v8.setFlagsFromString('--expose-gc');
const gc = vm.runInNewContext('gc');
const turn = () => new Promise(r => setImmediate(r));

function fakeDriver(state) {
  state = state || {};
  const clicked = [];
  return {
    clicked,
    navigate: async url => url,
    snapshot: async () => [
      { role: 'button', text: 'Search', x: 10, y: 20, w: 80, h: 30 },
      { role: 'textbox', text: 'Query', x: 10, y: 60, w: 200, h: 24 }
    ],
    click: async node => { clicked.push(node.text); return 'clicked ' + node.text; },
    tabEpoch: () => state.tab || 0,
    close: async () => {}
  };
}
async function message(p) { try { await p; return 'resolved'; } catch (e) { return { message: String(e && e.message), code: e && e.code }; } }

(async () => {
  // ---- 1. many documents: the table holds the current document's refs only ----
  {
    const drv = fakeDriver();
    const s = T.makeBrowserSession({ makeDriver: () => drv, lookup: null, env: {} });
    await s.navigate('https://example.com/0');
    const first = (await s.snapshot())[0].ref;
    for (let i = 1; i <= 50; i++) { await s.navigate('https://example.com/' + i); await s.snapshot(); }
    A.eq(s._internals.refs.size, 2, 'after 51 documents the table holds the 2 current refs (it held all 102 before)');
    const now = (await s.snapshot())[0];
    A.eq(s._internals.refs.size, 4, 'two snapshots of the SAME document keep both, so a renumbered ref can still be recovered');

    const old = await message(s.click(first));
    A.ok(/^stale browser ref: b1 - the page navigated since that snapshot, so it points at the previous page\. Take a fresh browser\.snapshot\.$/.test(old.message),
      'a ref from 50 documents ago gets the SAME refusal as before: ' + old.message);
    A.ok(/^unknown browser ref: b99999 \(take a fresh browser\.snapshot\)$/.test((await message(s.click('b99999'))).message), 'a ref never minted is still unknown');
    A.ok(/^unknown browser ref: b01 /.test((await message(s.click('b01'))).message), 'a non-canonical spelling of a minted ref is unknown, as before');
    A.eq(await s.click(now.ref), 'clicked Search', 'a current ref still acts');
    const renumbered = (await s.snapshot()) && now.ref;   // a re-snapshot of the same page renumbers every ref
    const recovered = await message(s.click(renumbered));
    A.ok(recovered === 'resolved', 'a same-document stale ref is still recovered by role+text: ' + JSON.stringify(recovered));
    A.eq(drv.clicked, ['Search', 'Search'], 'and it clicked the same control');
  }

  // ---- 2. a ref from a CLOSED tab stays refused as a closed tab after it is retired ----
  {
    const tab = { tab: 0 };
    const drv = fakeDriver(tab);
    const s = T.makeBrowserSession({ makeDriver: () => drv, lookup: null, env: {} });
    await s.navigate('https://x.test/');
    const old = (await s.snapshot())[0].ref;
    tab.tab = 1;                       // tab 0 closed, another tab promoted
    await s.snapshot();                // a fresh snapshot on the promoted tab: the old document's refs retire
    A.ok(!s._internals.refs.has(old), 'the closed tab\'s refs left the table');
    const err = await message(s.click(old));
    A.eq(err.code, 'REF_TAB_CLOSED', 'and the old ref is still refused as a closed-tab ref, never re-aimed');
    A.ok(/the tab that snapshot was taken on was closed/.test(err.message), 'with the same reason');
    A.eq(drv.clicked, [], 'nothing was clicked');
  }

  // ---- 3. a replaced driver is released ----
  {
    const holder = { last: null };
    const s = T.makeBrowserSession({ lookup: null, env: {}, makeDriver: () => (holder.last = fakeDriver()) });
    await s.navigate('https://example.com/');
    await s.snapshot();
    const firstDriver = new WeakRef(holder.last);
    holder.last = null;
    await s.navigate('https://example.com/watch', { visible: true });   // a headed relaunch replaces the driver
    await s.snapshot();
    holder.last = null;
    for (let i = 0; i < 4; i++) { await turn(); gc(); }
    A.eq(firstDriver.deref(), undefined, 'the replaced driver is garbage once the session moved on (the ref table kept it alive before)');
  }

  A.report('browser.refs-retire.test');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
