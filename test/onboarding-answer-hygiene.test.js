/* node test/onboarding-answer-hygiene.test.js — what the awakening does with a beginner's typed answers.

   Both found live by the onboarding sweep (2026-10-20) on a fresh station against a mock provider:

   1. A 5,000-word answer (42,001 chars) to "what made you want to set up an agent?" was committed verbatim to the
      agent's context.md. context.md is folded into EVERY system prompt (app.js composeSystemPrompt), so the very
      next interview call already carried a 49,411-char system prompt plus the same text quoted again in the
      directive — ~93 KB per call, and every run afterwards pays for it until someone edits the doc. Each answer
      is now clipped (ANSWER_CHARS) before anything is written or quoted.

   2. At a read gate ("i need a direction here — even a rough one. / Continue →") the composer still says
      "answer to wake your agent…". Typing "teaching chemistry" + Enter there cleared the box, echoed nothing and
      dropped the words: the handler's Dialogue.answer() had no pending question and the text vanished. It now goes
      back into the composer so the next question can take it.

   Behavioral: the REAL onboarding.js and intake.js run in a vm against recording stubs. */
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('./_assert.js');

const read = f => fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', f), 'utf8');

function awakening(answerFor) {
  const commits = [], prefills = [];
  let composer = null;
  const ctx = {
    console, Promise,
    Interview: require('../frontend/app/interview.js'),
    setTimeout: fn => { Promise.resolve().then(fn); return 0; }, clearTimeout() {},
    localStorage: { getItem: () => null, setItem() {}, removeItem() {} },
    World: {},
    Chat: {
      beginInterview(cb) { composer = cb; }, endInterview() {}, localLine() {},
      typeLine(segs, cb) { if (cb) Promise.resolve().then(cb); return () => {}; },
      prefill(t) { prefills.push(t); }
    },
    Dialogue: {
      open() {}, setStage() {}, ink() {}, close() {}, isOpen: () => false,
      say: async () => {},
      answer: () => false,          // a read gate: no free-text question is waiting
      node: async cfg => answerFor(cfg)
    }
  };
  vm.createContext(ctx);
  vm.runInContext(read('onboarding.js') + '\nthis.Onboarding = Onboarding;', ctx);
  return { ctx, commits, prefills, composer: () => composer };
}

(async () => {
  /* ---------- 1. a wall of text is clipped before it is committed ---------- */
  const wall = 'inventory emails posters customers shipping returns '.repeat(800).trim();   // ~42k chars
  A.ok(wall.length > 40000, 'the probe answer is a wall of text (' + wall.length + ' chars)');
  const run = awakening(cfg => {
    const first = String((cfg.lines && cfg.lines[0] && cfg.lines[0].text) || '');
    if ((cfg.options || []).some(o => o.value === 'quick')) return { value: 'quick', label: 'Quick setup' };
    if (/set up an agent/.test(first)) return { value: wall, label: wall, custom: true };
    return { value: '', skip: true };
  });
  run.ctx.Onboarding.start({ docs: {}, commit: p => run.commits.push(p), wake: false, name: 'TEST', role: 'orchestrator' });
  for (let i = 0; i < 200 && !run.commits.some(c => c && c.purpose); i++) await new Promise(r => setImmediate(r));
  const purpose = (run.commits.find(c => c && c.purpose) || {}).purpose || '';
  A.ok(purpose.length > 0, 'the quick setup committed a purpose');
  A.ok(purpose.length <= 2000, 'a 42k-char answer is clipped before it is committed (got ' + purpose.length + ' chars)');
  A.ok(wall.startsWith(purpose.replace(/…$/, '').trim()), 'the clip keeps the beginning of what they said');

  /* ---------- 2. text typed at a read gate goes back to the composer, never into the void ---------- */
  const gate = awakening(() => new Promise(() => {}));   // the ceremony is parked on a beat
  gate.ctx.Onboarding.start({ docs: {}, commit() {}, wake: false, name: 'TEST', role: 'orchestrator' });
  const typed = gate.composer();
  A.ok(typeof typed === 'function', 'the awakening owns the composer');
  typed('teaching chemistry');
  A.eq(gate.prefills, ['teaching chemistry'], 'an answer typed at a read gate is handed back to the composer');
  typed('   ');
  A.eq(gate.prefills.length, 1, 'whitespace is not handed back');

  /* ---------- 2b. the intake interview: an answer typed while the question is still typing ---------- */
  const ip = [];
  let icb = null, hold = null;
  const ictx = {
    console, Interview: require('../frontend/app/interview.js'),
    setTimeout: fn => { fn(); return 0; },
    document: { addEventListener() {}, removeEventListener() {} },
    Chat: {
      beginInterview(cb) { icb = cb; }, endInterview() {}, echoUser() {}, choices() {}, prefill(t) { ip.push(t); },
      typeLine(segs, cb) { if (/\[1\//.test(segs.map(s => s.text).join(''))) { hold = cb; } else if (cb) cb(); return () => {}; }
    }
  };
  vm.createContext(ictx);
  vm.runInContext(read('intake.js') + '\nthis.Intake = Intake;', ictx);
  let committed = null;
  A.ok(ictx.Intake.start({ skip: [], onCommit: b => { committed = b; } }), 'the intake interview starts');
  A.ok(typeof hold === 'function', 'the first question is still typing');
  icb('I run a print shop');
  A.eq(ip, ['I run a print shop'], 'an intake answer typed mid-question is handed back to the composer');
  A.eq(committed, null, '…and nothing was committed for it');

  A.report('onboarding-answer-hygiene.test');
})();
