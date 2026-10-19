'use strict';
/* test/build-rightclick-furniture.test.js — right-click on furniture is never a silent no-op (2026-10-14, the busy-station walk:
   BUILD MODE › Props, a plant placed, Esc, right-click the plant — five times, nothing removed and nothing said, while the
   Conveyors strip reads "right-click removes").

   Right-click removes conveyor pieces and belts only (THE HAND, 2026-10-10: furniture and bare floor are not that gesture's).
   So with nothing held, a right-click that lands on furniture now says what it does and how that piece goes instead
   (click it, then Del — the path every other piece of furniture takes), and the strip names what right-click removes.

   build.js is a browser IIFE; the production onDown runs here in a vm with its collaborators stubbed. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
function fn(name) {
  const at = build.indexOf('  function ' + name + '(');
  assert.ok(at > 0, name + ' exists');
  let depth = 0, i = build.indexOf('{', at);
  for (; i < build.length; i++) { if (build[i] === '{') depth++; else if (build[i] === '}' && --depth === 0) break; }
  return build.slice(at, i + 1);
}
const props = { plant: { id: 'plant', t: 'plant', x: 4, y: 4, w: 1, h: 1 }, bay: { id: 'bay', t: 'bay', x: 8, y: 4, w: 2, h: 2 } };
const tips = [], sounds = [], removed = [];
let under = null;
const ctx = vm.createContext({
  lastClient: null, drag: null, connectFrom: null, connectTo: null, dupe: null, hand: null, touchArm: null, dropPick: null, tool: 'select',
  hidePropCard() {}, releaseDrag() {}, hideTip() {}, setHint() {}, setHand() {}, deselectTool() {},
  removeAt() { const p = under && props[under]; if (p && p.t === 'bay') { removed.push(p.id); return true; } return false; },
  propAtEvent() { return under; }, station: { propById: id => props[id] || null },
  isConveyorPiece: p => p.t === 'bay', propLabel: t => t === 'plant' ? 'Plant' : t.toUpperCase(),
  flashTip(ev, text, ok) { tips.push({ text, ok }); }, sfx(k) { sounds.push(k); }
});
vm.runInContext(fn('onDown'), ctx);
const rightClick = () => vm.runInContext('onDown({ button: 2, clientX: 40, clientY: 40, pointerType: "mouse" })', ctx);

under = 'bay'; rightClick();
assert.deepEqual([removed, tips.length], [['bay'], 0], 'right-click still removes a conveyor piece, saying nothing more');

under = 'plant'; rightClick();
assert.equal(removed.length, 1, 'right-click never removes furniture');
assert.equal(tips.length, 1, 'right-click on furniture is never a silent no-op');
assert.match(tips[0].text, /PLANT/, '…it names the piece under the pointer');
assert.match(tips[0].text, /CONVEYOR PIECES AND BELTS/, '…says what right-click removes');
assert.match(tips[0].text, /THEN DEL/, '…and how this piece goes instead');

tips.length = 0; under = null; rightClick();
assert.equal(tips.length, 0, 'right-click on bare floor stays a plain deselect');

tips.length = 0; under = 'plant'; ctx.hand = { t: 'bay' }; rightClick();
assert.equal(tips.length, 0, 'with a piece in hand right-click only puts it down, as before');
ctx.hand = null;

const strip = /if \(tool === 'select' && buildGroup === 'workflow'\) verb = '([^']*)'/.exec(build);
assert.ok(strip, 'the Conveyors strip is where the test reads it');
assert.ok(!/right-click removes ·/.test(strip[1]) && /right-click removes a conveyor piece or belt/.test(strip[1]),
  'the Conveyors strip names what right-click removes');

console.log('build-rightclick-furniture: furniture right-click says how it goes; conveyor right-click unchanged — PASS');
