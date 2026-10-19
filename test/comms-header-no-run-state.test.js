/* node test/comms-header-no-run-state.test.js — NO RUN STATE IN THE COMMS HEADER.

   Andrew asked five times (locked 2026-10-03): nothing on top of COMMS says working… / thinking… / a timer — the
   transcript's working card is the one run indicator. The header hides run states by CLASS (frontend/css/app.css:
   .status-thinking/working/connecting/approval/stopping + the plain idle 'online'), so every run-state string status()
   receives must land on one of those classes. The 10-13 walkthrough found three that slipped through on the VISIBLE
   status-online class: "awaiting your context… 43s", "waking…" and "online · also running in <session>". Faults stay
   visible on purpose (station unreachable, voice errors). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const chat = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');
const css = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'css', 'app.css'), 'utf8');
const from = chat.indexOf('  function status(s) {');
const to = chat.indexOf('  // derive the DISPLAYED stream', from);
A.ok(from > 0 && to > from, 'chat.js still has status()');

function classesFor(text) {
  const cls = new Set();
  const statusEl = { textContent: '', classList: { remove: (...c) => c.forEach(x => cls.delete(x)), add: (...c) => c.forEach(x => cls.add(x)) } };
  const ctx = { statusEl, String };
  vm.createContext(ctx);
  vm.runInContext(chat.slice(from, to) + '\nthis.status = status;', ctx);
  ctx.status(text);
  return Array.from(cls);
}
// the classes the header hides — read from the stylesheet, not assumed
const HIDDEN = ['status-thinking', 'status-working', 'status-connecting', 'status-approval', 'status-stopping', 'status-idle']
  .filter(c => new RegExp('\\.' + c + '\\b').test(css));
A.ok(HIDDEN.indexOf('status-approval') >= 0 && HIDDEN.indexOf('status-thinking') >= 0, 'the stylesheet still hides the run-state classes');
const hidden = (text) => classesFor(text).some(c => HIDDEN.indexOf(c) >= 0);

for (const s of ['thinking…', 'working…', 'connecting…', 'stopping…', 'awaiting your approval…', 'awaiting your context…', 'awaiting your answer…', 'waking…', 'online']) {
  A.ok(hidden(s), 'the header never shows run state: "' + s + '" lands on a hidden class (' + classesFor(s).join(' ') + ')');
}
A.ok(!hidden('station unreachable'), 'a fault still shows in the header');
A.ok(!/'online · also running in '/.test(chat), 'the header never names another session\'s run ("online · also running in …")');

A.report('comms-header-no-run-state.test');
