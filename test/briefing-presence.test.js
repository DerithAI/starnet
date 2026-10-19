/* node test/briefing-presence.test.js — THE ABSENCE, page side (frontend/app/briefing.js; live walk 10-14).
   A reload briefed work the Commander had watched land, because the briefing stamp only moved when a briefing was
   delivered. The page now stamps the Commander's PRESENCE ({ seen:true }) while they are here — throttled, on input,
   when the tab is hidden and when the page goes away — and never before the boot delivery has settled or while a
   delivery is in flight (a stamp racing ahead of a return would swallow the very absence it was about to brief). */
'use strict';
const A = require('./_assert.js');

let now = 1.8e12;
const realNow = Date.now;
Date.now = () => now;
const handlers = {};
global.window = { addEventListener: (n, f) => { handlers[n] = f; } };
global.document = { visibilityState: 'visible', addEventListener: (n, f) => { handlers['doc:' + n] = f; }, getElementById: () => null };
global.Workstreams = { adopt: (o) => o, get: () => null, pin: () => true, markUnread: () => true, activeId: () => 'general' };
global.App = { openWorkstream: () => {}, refreshRail: () => {}, persist: () => {} };
const timers = [];
global.setTimeout = (fn) => { timers.push(fn); return timers.length; };

const posts = [];
let hold = null;   // a deliver held open, to prove no stamp races it
global.fetch = async (url, opts) => {
  const body = JSON.parse((opts && opts.body) || '{}');
  posts.push({ url: String(url), body, keepalive: !!(opts && opts.keepalive) });
  if (body.seen) return { ok: true, json: async () => ({ delivered: false, why: 'seen' }) };
  if (hold) await hold;
  return { ok: true, json: async () => ({ delivered: false, why: 'present' }) };
};
const B = require('../frontend/app/briefing.js');
const seens = () => posts.filter(p => p.body.seen === true);
const delivers = () => posts.filter(p => p.body.seen !== true);
const tick = () => new Promise(r => setImmediate(r));

(async () => {
  B.init({ enabled: true, agentId: 'agent' });
  handlers.pointerdown();
  await tick();
  A.eq(seens().length, 0, 'no presence stamp before the boot delivery settles (it would swallow the absence being briefed)');

  await timers.shift()();   // the boot delivery
  A.eq(delivers().length, 1, 'boot asks for a briefing');
  A.eq(delivers()[0].body.why + '|' + delivers()[0].body.minAwayMs, 'boot|' + 30 * 60000, 'boot names the away threshold: a reload is not an absence');

  now += 1000; handlers.pointerdown(); await tick();
  A.eq(seens().length, 0, 'the boot delivery itself moved the stamp: an input a second later needs no second one');
  now += 61000; handlers.pointerdown(); await tick();
  A.eq(seens().length, 1, 'the Commander is here → the page stamps their presence');
  now += 1000; handlers.keydown(); await tick();
  A.eq(seens().length, 1, 'stamps are throttled (one a minute is plenty for a 30-minute threshold)');
  now += 61000; handlers.keydown(); await tick();
  A.eq(seens().length, 2, 'a minute later the next input stamps again');

  document.visibilityState = 'hidden'; handlers['doc:visibilitychange'](); await tick();
  A.ok(seens().length === 3 && seens()[2].keepalive, 'hiding the tab stamps the moment they left (keepalive)');
  document.visibilityState = 'visible'; now += 5000; handlers['doc:visibilitychange'](); await tick();
  A.eq(delivers().length, 1, 'back after seconds: not an absence, no delivery');

  handlers.pagehide(); await tick();
  A.ok(seens().length === 4 && seens()[3].keepalive, 'a reload/close stamps presence on the way out');

  // a real absence: 31 minutes with no input → the next input asks for the briefing FIRST and stamps nothing ahead of it
  now += 31 * 60000;
  const before = seens().length;
  document.visibilityState = 'hidden'; handlers['doc:visibilitychange'](); handlers.pagehide(); await tick();
  A.eq(seens().length, before, 'hiding or reloading a page left untouched for half an hour stamps nothing (that hour stays an absence)');
  document.visibilityState = 'visible'; handlers['doc:visibilitychange'](); await tick();
  let release; hold = new Promise(r => { release = r; });
  handlers.pointerdown(); await tick();
  A.eq(delivers().length, 2, 'the first input after a real absence asks for the briefing');
  A.eq(delivers()[1].body.why, 'return', 'as a return');
  now += 61000; handlers.pointerdown(); await tick();
  A.eq(seens().length, before, 'no presence stamp while that delivery is in flight');
  release(); hold = null; await tick(); await tick();
  now += 61000; handlers.pointerdown(); await tick();
  A.eq(seens().length, before + 1, 'once it settles, presence stamps resume');

  B.reset();
  now += 61000; handlers.pointerdown(); await tick();
  A.eq(seens().length, before + 1, 'a reset station stamps nothing until its next page starts');

  // THE AWAKENING (review 10-14): a new Commander's first session runs with the briefing OFF (enterGame passes
  // enabled:false), but a presence stamp delivers nothing — it must still land, or the stamp stays 0 all session and the
  // first reload briefs the whole first session ("While you were away" over work they watched) and takes the screen.
  const t0 = timers.length, s0 = seens().length, d0 = delivers().length;
  B.init({ enabled: false, agentId: 'agent' });
  A.eq(timers.length, t0, 'the awakening asks for no boot briefing');
  now += 1000; handlers.pointerdown(); await tick();
  A.eq(seens().length, s0 + 1, 'the awakening page stamps the Commander\'s presence on their first input');
  A.eq(delivers().length, d0, '…and delivers nothing');
  handlers.pagehide(); await tick();
  A.ok(seens().length === s0 + 2 && seens()[s0 + 1].keepalive, 'a reload/close of the awakening stamps on the way out (the first reload is a reload)');
  now += 31 * 60000; handlers.pointerdown(); await tick();
  A.eq(delivers().length, d0, 'the awakening never delivers a briefing, even after an idle half hour');
  A.eq(seens().length, s0 + 3, 'it stamps the return instead (the Commander is here again)');
  A.eq(B.ownsReturn(), false, 'the awakening still does not own the return');

  Date.now = realNow;
  A.report('briefing-presence');
})().catch(e => { console.error(e); process.exit(1); });
