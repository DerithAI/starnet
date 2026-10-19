/* node test/nav-coach-dismiss.test.js — the first-hour dock tip stays retired (frontend/app/navdock.js; live walk 10-14).
   "Everything you run lives in these 4 docks… GOT IT" came back after a reload 40 minutes into heavy use: the tip fades
   by itself after 15 s WITHOUT retiring (so a Commander who never noticed it sees it next session), and the dock-open
   path that should retire it for good returned early because the tip was already hidden — the Commander had found
   every dock, and the station never wrote that down. Opening any dock now retires it whether or not it is on screen. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');

const nav = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'navdock.js'), 'utf8');
const dismiss = A.fnBody(nav, 'function dismissCoach(persist)');
const show = A.fnBody(nav, 'function showCoachOnce()');
A.ok(dismiss && show && dismiss.length < nav.length && show.length < nav.length, 'both coach functions are found');

// held = { awakening, dialogue }: what navdock's own guards read (org P31 — the tip waits for the arrival and for an open
// conversation panel to clear); both false is the ordinary in-game page
function page(storage, held) {
  const coach = { hidden: true };
  const timers = [];
  const h = held || {};
  const make = new Function('coach', 'localStorage', 'setTimeout', 'clearTimeout', 'awakeningHeld', 'dialogueOpen', 'tourCoaching',
    "const COACH_KEY = 'starnet.navcoach.seen'; let coachTimer = 0; let coachShown = false;\n" + dismiss + '\n' + show + '\nreturn { dismissCoach, showCoachOnce };');
  const api = make(coach, storage, (fn) => { timers.push(fn); return timers.length; }, () => {}, () => !!h.awakening, () => !!h.dialogue, () => !!h.tour);
  return { coach, timers, api };
}
const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), m }; };
// the arrival and an open conversation panel hold the tip back; it shows on the next ask once both clear (org P31)
{
  const ls = store(), held = { awakening: true, dialogue: false };
  const p = page(ls, held);
  p.api.showCoachOnce();
  A.eq(p.coach.hidden, true, 'the tip waits while the awakening is on screen');
  held.awakening = false; held.dialogue = true;
  p.api.showCoachOnce();
  A.eq(p.coach.hidden, true, 'the tip waits while the conversation panel covers COMMS');
  held.dialogue = false;
  p.api.showCoachOnce();
  A.eq(p.coach.hidden, false, 'the tip shows once nothing covers the docks');
}
// (org P31 wire) the optional tour's own mid-tour close (TRY A SMALL FILE EXAMPLE reveals COMMS) is not the end of
// onboarding: the tip holds while the tutorial coaches, and shows on the tour-ended ask
{
  const ls = store(), held = { awakening: false, dialogue: false, tour: true };
  const p = page(ls, held);
  p.api.showCoachOnce();   // the demo's Dialogue.close → 'starnet:dialogue-closed'
  A.eq(p.coach.hidden, true, 'the tip waits while the optional tour still coaches');
  held.tour = false;
  p.api.showCoachOnce();   // Tutorial.finishUp → 'starnet:tutorial-ended'
  A.eq(p.coach.hidden, false, 'the tip shows once the tour has ended');
}
// the wiring the behaviour above relies on: navdock reads the real Tutorial.isCoaching and re-asks on the tour's end, and
// every exit of Tutorial.finishUp announces it after active/kitMode/coach are cleared
{
  A.ok(/const tourCoaching = \(\) => typeof Tutorial !== 'undefined' && typeof Tutorial\.isCoaching === 'function' && !!Tutorial\.isCoaching\(\);/.test(nav), 'navdock holds on Tutorial.isCoaching()');
  A.ok(/if \(tourCoaching\(\)\) return;/.test(show), 'showCoachOnce reads that hold');
  A.ok(/addEventListener\('starnet:tutorial-ended'[^\n]*showCoachOnce\(\)/.test(nav), 'navdock asks again when the tour ends');
  const tut = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'tutorial.js'), 'utf8');
  const fin = A.fnBody(tut, 'function finishUp(skipped, valueHandoff)');
  A.ok(fin && fin.length < tut.length, 'Tutorial.finishUp is found');
  A.ok(fin.indexOf('active = false') >= 0 && fin.indexOf('active = false') < fin.indexOf('tourEnded()'), 'the tour ends (isCoaching false) before it is announced');
  A.eq((fin.match(/tourEnded\(\)/g) || []).length, 3, 'every exit of finishUp announces the end (value hand-off, replay, first-task return)');
  A.ok(/CustomEvent\('starnet:tutorial-ended'\)/.test(A.fnBody(tut, 'function tourEnded()') || ''), 'tourEnded fires starnet:tutorial-ended');
}

// the walk's path: the tip shows, fades by itself, then the Commander uses the docks for 40 minutes, then reloads
{
  const ls = store();
  const p1 = page(ls);
  p1.api.showCoachOnce();
  A.eq(p1.coach.hidden, false, 'a new station shows the tip once');
  p1.timers.shift()();   // the 15 s fade
  A.ok(p1.coach.hidden && !ls.getItem('starnet.navcoach.seen'), 'the fade hides it without retiring it (an unnoticed tip may come back)');
  p1.api.dismissCoach();   // a dock opens (navdock toggle → dismissCoach())
  A.eq(ls.getItem('starnet.navcoach.seen'), '1', 'opening a dock retires the tip even after it faded — they found the docks');
  const p2 = page(ls);
  p2.api.showCoachOnce();
  A.eq(p2.coach.hidden, true, 'after a reload the tip stays gone');
}
// GOT IT retires it for good
{
  const ls = store();
  const p1 = page(ls);
  p1.api.showCoachOnce();
  p1.api.dismissCoach(true);
  A.ok(p1.coach.hidden && ls.getItem('starnet.navcoach.seen') === '1', 'GOT IT hides and retires the tip');
  const p2 = page(ls);
  p2.api.showCoachOnce();
  A.eq(p2.coach.hidden, true, 'GOT IT holds across a reload');
}
// the fade alone still lets an unnoticed tip return next session
{
  const ls = store();
  const p1 = page(ls);
  p1.api.showCoachOnce(); p1.timers.shift()();
  const p2 = page(ls);
  p2.api.showCoachOnce();
  A.eq(p2.coach.hidden, false, 'a tip that only faded (no dock opened, no GOT IT) returns next session');
}
// storage blocked: the tip never throws
{
  const blocked = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
  const p = page(blocked);
  A.notThrows(() => { p.api.showCoachOnce(); p.api.dismissCoach(true); }, 'blocked storage never breaks the dock');
}

A.report('nav-coach-dismiss');
