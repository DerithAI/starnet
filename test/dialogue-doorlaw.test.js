/* test/dialogue-doorlaw.test.js — THE DOOR LAW reaches the awakening and the quick tour (sweep 2026-10-02).

   On a fresh station the dock grows with use (systems.js): AUTOMATE and STEP-IN start hidden (org P10, 2026-10-14: RECRUIT and
   CONNECT — the two doors customers ask for on day one — start online). A line that names a system brings it
   online — but only COMMS lines did. The awakening ("its line is waiting for a crew: WORK › AUTOMATE › WORKFLOWS …") and the quick
   tour ("open WORK › AUTOMATE › WORKFLOWS", "BUILD › CONNECT › ABILITIES") speak through Dialogue.say / Dialogue.node, so they sent a
   brand-new Commander to a dock button that was not there. Dialogue now applies the door law to every line it speaks. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');

const store = new Map();
const ctx = vm.createContext({ console, module: { exports: {} }, localStorage: { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k) } });
vm.runInContext(rd('frontend/app/systems.js'), ctx, { filename: 'systems.js' });
const Systems = ctx.module.exports;
Systems.init({ epoch: 'fresh-1', fresh: true, crewCount: () => 1 });
A.ok(Systems.staged() && !Systems.isOnline('automate') && !Systems.isOnline('stepin'), 'fixture: a fresh station starts with AUTOMATE and STEP-IN hidden');
A.ok(Systems.isOnline('recruit') && Systems.isOnline('connect'), 'org P10: RECRUIT and CONNECT are online on day one');

// the exact lines the awakening and the tour speak
const onb = rd('frontend/app/onboarding.js'), tut = rd('frontend/app/tutorial.js');
const built = 'done. the software studio is built, and its line is waiting for a crew: WORK › AUTOMATE › WORKFLOWS walks you through who works each step.';
A.ok(onb.indexOf("its line is waiting for a crew: WORK › AUTOMATE › WORKFLOWS walks you through who works each step.") >= 0, 'fixture: the awakening still says it');
A.ok(/WORK › AUTOMATE › WORKFLOWS/.test(tut) && /BUILD › CONNECT › ABILITIES/.test(tut), 'fixture: the tour still names both');
Systems.noticeReply(built);
A.ok(Systems.isOnline('automate'), 'the awakening line brings AUTOMATE online, so the button it names is there');
Systems.noticeReply('Your agent needs you to sign in — open CREW › STEP-IN to take its browser.');
A.ok(Systems.isOnline('stepin'), 'a line naming STEP-IN brings STEP-IN online');

// Dialogue speaks every say() and node() line (and a node's option labels) through the door law
const dlg = rd('frontend/app/dialogue.js');
A.ok(/function doorLaw\(segs, extra\) \{[\s\S]{0,200}Systems\.noticeReply\(segs\.map\(x => x\.text\)\.concat\(extra \|\| \[\]\)\.join\(' '\)\)/.test(dlg), 'doorLaw hands the spoken text to Systems.noticeReply');
A.ok(/const segs = norm\(lines\); doorLaw\(segs\);\s*\n\s*typeInto\(segs,/.test(dlg), 'say() applies it to every line');
A.ok(/const segs = norm\(cfg\.lines\); doorLaw\(segs, \(cfg\.options \|\| \[\]\)\.map\(/.test(dlg), 'node() applies it to its lines and options');
// and it still loads under node (the naming primitives other tests use)
const { Dialogue } = require('../frontend/app/dialogue.js');
A.ok(typeof Dialogue.say === 'function' && typeof Dialogue.node === 'function', 'dialogue.js still loads');

/* ---- org P10: day-one dock — CONNECT and RECRUIT start online; the help says where a staged system is ---- */
{
  const sys = rd('frontend/app/systems.js'), idx = rd('frontend/index.html'), ui = rd('frontend/app/stationui.js');
  const line = id => (sys.match(new RegExp("\{ id: '" + id + "'[^\n]*")) || [''])[0];
  A.ok(/start: true/.test(line('recruit')) && !/jobs:|how:/.test(line('recruit')), 'RECRUIT starts online, with no milestone or how-line');
  A.ok(/start: true/.test(line('connect')) && !/jobs:|how:/.test(line('connect')), 'CONNECT starts online, with no milestone or how-line');
  A.ok(!/start: true/.test(line('automate')) && !/start: true/.test(line('stepin')), 'AUTOMATE and STEP-IN stay staged');
  A.ok(/tip: 'Pick a class, or re-spec your agent'/.test(line('recruit')) && /<b>RECRUIT<\/b><small>pick a class, or re-spec your agent<\/small>/.test(idx), 'the RECRUIT tip and dock line drop "summon" and say what is inside, not the title again');
  A.ok(/tip: 'Services your agents use, and where you message them'/.test(line('connect')) && /<b>CONNECT<\/b><small>services your agents use, and where you message them<\/small>/.test(idx), 'the CONNECT tip and dock line say services');
  A.ok(/these <b>docks<\/b>/.test(idx) && !/4 docks/.test(idx), 'the nav coach says "these docks" (APPS can make a fifth)');
  A.ok(!/DELIVERABLES · OUTBOX · RECIPES/.test(idx), 'the MY WORK comment no longer lists an OUTBOX tab');
  A.eq((ui.match(/<span>RECRUIT one from the CREW dock\.<\/span>/g) || []).length, 2, 'both empty states point at RECRUIT in the CREW dock');
  A.ok(!/Commission one from RECRUITMENT/.test(ui), 'no empty state names RECRUITMENT');
  // the staged note: ONE helper, printed in FIRST MISSION, CREW, LINES and HELP
  A.eq((tut.match(/\+ stagedNote\(\)/g) || []).length, 4, 'the staged-dock note prints in FIRST MISSION, CREW, LINES and HELP');
  A.eq((tut.match(/Your dock adds buttons as you use the station/g) || []).length, 1, 'one sentence, one place');
  // an existing staged station picks up the new start flags on its next load
  const st = new Map();
  const c2 = vm.createContext({ console, module: { exports: {} }, localStorage: { getItem: k => (st.has(k) ? st.get(k) : null), setItem: (k, v) => st.set(k, String(v)), removeItem: k => st.delete(k) } });
  vm.runInContext(sys, c2, { filename: 'systems.js' });
  const S2 = c2.module.exports;
  S2.init({ epoch: 'old-1', fresh: true, crewCount: () => 1 });
  const keyName = Array.from(st.keys())[0];
  const saved = JSON.parse(st.get(keyName)); saved.online = saved.online.filter(id => id !== 'recruit' && id !== 'connect'); st.set(keyName, JSON.stringify(saved));
  S2.init({ epoch: 'old-1', fresh: false, crewCount: () => 1 });
  A.ok(S2.staged() && S2.isOnline('recruit') && S2.isOnline('connect'), 'a staged station saved before P10 gets RECRUIT and CONNECT on its next load');
}

A.report('dialogue-doorlaw.test');
