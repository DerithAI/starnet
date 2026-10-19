/* node test/first-minutes-labels.test.js — org pass P31 (2026-10-14): the first ten minutes' labels match what happens.

   Pins the parts test/onboarding-refresh.test.js (question counts, pace hints, 1-3 of 3) and test/onboarding.test.js
   (one hand-off header) don't:
     A. the create screen has ONE numbering — the journey strip 01-03. The setup-nav buttons stay a working stepper
        (data-setup-step, aria-controls) with no digits, and the column heads carry no numerals;
     B. the nav coach waits for the arrival: World exposes awakeningHeld() and releaseAwakening() fires
        'starnet:awakening-released'; navdock's showCoachOnce returns while the awakening holds the room and asks again
        on that event (behavioural, in a vm with a stub DOM). Source-level + one tiny vm run: no browser. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const root = path.join(__dirname, '..');
const read = rel => fs.readFileSync(path.join(root, rel), 'utf8');

// ---- A. one numbering on the create screen ----
const html = read('frontend/index.html');
const journey = (html.match(/<ol class="ov-journey"[^>]*>([\s\S]*?)<\/ol>/) || [])[1] || '';
A.eq((journey.match(/<b>0[1-3]<\/b>/g) || []).length, 3, 'the journey strip keeps its 01-03');
const nav = (html.match(/<nav class="ov-setup-nav"[^>]*>([\s\S]*?)<\/nav>/) || [])[1] || '';
A.ok(/data-setup-step="identity" aria-controls="ov-identity">Your Overseer<\/button>/.test(nav), 'YOUR OVERSEER stays a stepper button, no digit');
A.ok(/data-setup-step="brain" aria-controls="ov-brain">Connect a brain<\/button>/.test(nav), 'CONNECT A BRAIN stays a stepper button, no digit');
A.ok(!/<span>0\d<\/span>/.test(nav), 'no numerals in the setup nav');
A.ok(/<div class="ov-step">APPEARANCE </.test(html) && /<div class="ov-step">THE BRAIN </.test(html), 'column heads read APPEARANCE / THE BRAIN');
A.ok(!/<div class="ov-step"><b>\d/.test(html), 'no column head carries a numeral');

// ---- B. the nav coach waits for the arrival ----
const world = read('frontend/app/world.js');
A.ok(/function releaseAwakening\(\) \{[\s\S]{0,700}dispatchEvent\(new CustomEvent\('starnet:awakening-released'\)\)/.test(world),
  'releaseAwakening announces the release');
A.ok(/function awakeningHeld\(\) \{ return awakeFrozen; \}/.test(world) && /releaseAwakening, awakeningHeld, say,/.test(world),
  'World exposes awakeningHeld()');

const navSrc = read('frontend/app/navdock.js');
const start = navSrc.indexOf("  const COACH_KEY = 'starnet.navcoach.seen';");
const end = navSrc.indexOf('  groups.forEach(g => {', start);
A.ok(start > 0 && end > start, 'found the nav coach block');
const block = navSrc.slice(start, end);

function run(held, dialogue) {
  const listeners = {};
  let observerCb = null;
  const el = (extra) => Object.assign({ hidden: true, addEventListener() {} }, extra || {});
  const coach = el();
  const game = el({ classList: { contains: c => c === 'active' } });
  const state = { held, dialogue: !!dialogue };
  const ctx = vm.createContext({
    document: {
      getElementById: id => (id === 'nav-coach' ? coach : id === 'screen-game' ? game : el()),
      addEventListener: (name, fn) => { (listeners[name] = listeners[name] || []).push(fn); }
    },
    localStorage: { getItem: () => null, setItem() {} },
    setTimeout: () => 1, clearTimeout() {},
    MutationObserver: function (cb) { observerCb = cb; this.observe = () => {}; },
    World: { awakeningHeld: () => state.held },
    Dialogue: { isOpen: () => state.dialogue }
  });
  vm.runInContext(block, ctx);
  return { coach, state, fire: name => (listeners[name] || []).forEach(fn => fn()), observe: () => observerCb && observerCb() };
}

const returning = run(false);
A.eq(returning.coach.hidden, false, 'a returning Commander (no awakening) still gets the coach on arrival');

const born = run(true);
A.eq(born.coach.hidden, true, 'during the awakening the coach stays hidden');
born.observe();
A.eq(born.coach.hidden, true, 'a class flicker on #screen-game during the awakening does not show it');
born.state.held = false;
born.fire('starnet:awakening-released');
A.eq(born.coach.hidden, false, 'the release shows the coach once the arrival is over');

// org P31 review fix: closeOut releases the awakening while the Dialogue panel still covers COMMS (first-task hand-off,
// tour). The coach ("Talk to your agent up in COMMS") must hold until that panel closes.
A.ok(/const wasOpen = open;[\s\S]{0,1400}if \(wasOpen && [^\n]*dispatchEvent\(new CustomEvent\('starnet:dialogue-closed'\)\)/.test(read('frontend/app/dialogue.js')),
  'Dialogue.close announces that COMMS is uncovered');
const handoff = run(true, true);
handoff.state.held = false;
handoff.fire('starnet:awakening-released');
A.eq(handoff.coach.hidden, true, 'the release with the hand-off panel still over COMMS keeps the coach hidden');
handoff.observe();
A.eq(handoff.coach.hidden, true, 'a class flicker while the panel is open does not show it');
handoff.state.dialogue = false;
handoff.fire('starnet:dialogue-closed');
A.eq(handoff.coach.hidden, false, 'closing the panel shows the coach over an uncovered COMMS');

A.report('first-minutes-labels.test');
