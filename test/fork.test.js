/* node test/fork.test.js — the pure mid-task preference-fork engine (frontend/app/fork.js, R1).
   Locks: shouldOffer() gates on LOW style confidence and fails CLOSED (no read → no fork — an unearned
   interruption is the failure mode this feature must never have); the directive rides only via the caller;
   parse() reads the one-line FORK marker tolerantly but never yields a broken chip row (min 2 options,
   caps); strip() removes the marker from the rendered reply; beliefText() composes a legible banked
   belief. Pure + deterministic. */
'use strict';
const A = require('./_assert.js');
const F = require('../frontend/app/fork.js');

/* ---------- shouldOffer: the self-retiring confidence gate ---------- */
A.eq(F.shouldOffer({ dims: { style: { conf: 0.2 } } }), true, 'low style confidence earns the fork instruction');
A.eq(F.shouldOffer({ dims: { style: { conf: 0.6 } } }), false, 'a well-grounded style model retires the fork (self-retiring)');
A.eq(F.shouldOffer({ dims: { style: { conf: F.CONF_FLOOR } } }), false, 'the floor itself is NOT below the floor');
A.eq(F.shouldOffer(null), false, 'no understanding read → fail CLOSED (never an unearned interruption)');
A.eq(F.shouldOffer({}), false, 'malformed read → fail closed');
A.eq(F.shouldOffer({ dims: {} }), false, 'missing style dim → fail closed');

/* ---------- directive: present, bounded, format-locked ---------- */
const d = F.directive();
A.ok(d.indexOf('AT MOST ONCE per task') >= 0, 'the directive caps the fork at one per task');
A.ok(d.indexOf('FORK: <the question') >= 0, 'the directive teaches the exact marker format');
A.ok(d.indexOf('never ask a fork twice') >= 0, 'the directive forbids re-asking (the station remembers)');
A.ok(d.indexOf('one-off task details') >= 0, 'the directive excludes one-off task details (durable preferences only)');

/* ---------- parse: tolerant but never a broken chip row ---------- */
const p1 = F.parse('Here is the draft.\nFORK: terse summary or full detail? || terse | full detail');
A.eq(p1.question, 'terse summary or full detail?', 'parse reads the question');
A.eq(p1.options, ['terse', 'full detail'], 'parse reads the options');
const p3 = F.parse('FORK: how should reports read? || bullets | prose | mixed');
A.eq(p3.options.length, 3, 'parse accepts three options');
A.eq(F.parse('FORK: too many? || a | b | c | d').options.length, 3, 'options cap at three (never a menu)');
A.eq(F.parse('no marker here'), null, 'no marker → null');
A.eq(F.parse('FORK: only one option? || solo'), null, 'fewer than two options → null (renders as plain text, never a broken row)');
A.eq(F.parse('FORK: || a | b'), null, 'an empty question → null');
A.eq(F.parse(null), null, 'null input → null, never throws');
// caps: a rambling question/option is clipped, not rejected
const long = F.parse('FORK: ' + 'q'.repeat(300) + '? || ' + 'x'.repeat(90) + ' | b');
A.ok(long.question.length <= 160 && long.options[0].length <= 48, 'question and options are clipped to their caps');

/* ---------- strip: the marker never renders raw ---------- */
A.eq(F.strip('The draft is ready.\nFORK: terse or full? || terse | full'), 'The draft is ready.', 'strip removes the marker line');
A.eq(F.strip('no marker'), 'no marker', 'strip is a no-op without a marker');

/* ---------- the marker as models really write it (rc walk 2026-10-14): bold-wrapped, bulleted, glued mid-line ----------
   Every one of these rendered as raw machine syntax in COMMS — the line-start parse never saw them. */
{
  const bold = 'Is it:\n\n**FORK: What\'s the headline story?** || Local-first | Pixel-art UI | AI crews | Something else';
  A.eq(F.parse(bold), { question: 'What\'s the headline story?', options: ['Local-first', 'Pixel-art UI', 'AI crews'] }, 'a bold-wrapped FORK parses into its question and (capped) options');
  A.eq(F.stripMarkers(bold), 'Is it:', 'a bold-wrapped FORK never renders raw');
  A.eq(F.parse('**FORK: terse or full? || terse | full**'), { question: 'terse or full?', options: ['terse', 'full'] }, 'a fully bolded marker line parses without its asterisks');
  A.eq(F.parse('- FORK: a or b? || a | b').options, ['a', 'b'], 'a bulleted marker parses');
  const glued = 'Before I draft, one quick clarification: TASK_QUESTION: personal or community? || Personal | Community';
  A.eq(F.TaskIntent.parse(glued), { question: 'personal or community?', options: ['Personal', 'Community'] }, 'a TASK_QUESTION glued onto prose parses');
  A.eq(F.stripMarkers(glued), 'Before I draft, one quick clarification:', 'the prose before a glued marker stays, the marker goes');
  A.eq(F.TaskIntent.strip('Ready.\n**TASK_QUESTION:** format? || PDF | HTML'), 'Ready.', 'TaskIntent.strip removes a decorated marker');
  A.eq(F.stripMarkers('Mid-reply.\n> FORK: x? || a | b\nMore prose after.'), 'Mid-reply.\n\nMore prose after.', 'a marker in the middle of a reply leaves the prose around it');
}
/* ---------- liveText: a marker being typed never flashes raw while the reply streams ---------- */
A.eq(F.liveText('Is it:\n\n**FORK: which angle?** || a | b'), 'Is it:', 'a complete marker is gone from the live text');
A.eq(F.liveText('One thing first.\n\nTASK_QUESTION: who is it for'), 'One thing first.\n\n', 'a marker still arriving (no || yet) is held back');
A.eq(F.liveText('One thing first: TASK_QUES'), 'One thing first:', 'a half-typed keyword is held back');
A.eq(F.liveText('TASK COMPLETE'), 'TASK COMPLETE', 'an ordinary capital word is never held');
A.eq(F.liveText('The FORK: in the road'), 'The', 'a prose "FORK:" on the still-streaming last line waits for its line');
A.eq(F.liveText('The FORK: in the road\nnext'), 'The FORK: in the road\nnext', 'and shows the moment the line completes');
/* ---------- readable: a marker no card took over reads as prose, never syntax ---------- */
A.eq(F.readable('Pick one.\nFORK: tone? || casual | formal'), 'Pick one.\ntone?\n- casual\n- formal', 'an unclaimed marker becomes the question and a short option list');
A.eq(F.readable('no marker here'), 'no marker here', 'readable is byte-identical without a marker');

/* ---------- ONE CASE RULE, ONE KEYWORD GRAMMAR (rc review 2026-10-14) ----------
   The loop's "the reply waits on the Commander" check was case-insensitive while the chat's parse was not, so a title-case
   "Fork:" ended the run as a question and rendered raw. One keyword source (Fork.MARKER_KEY) now serves fork.js, the loop and
   the push line: FORK in capitals or title case (a lowercase "fork:" is prose or code, never a marker), TASK_QUESTION in
   any case (the word is unmistakable). An ordered-list number before a marker is decoration, never a dangling "1.". */
{
  A.eq(F.stripMarkers('Two things.\n1. TASK_QUESTION: personal or community? || Personal | Community'), 'Two things.', 'a numbered marker strips whole — no dangling "1."');
  A.eq(F.TaskIntent.parse('2) TASK_QUESTION: which? || a | b'), { question: 'which?', options: ['a', 'b'] }, 'a numbered marker parses');
  A.eq(F.parse('Fork: tone? || casual | formal'), { question: 'tone?', options: ['casual', 'formal'] }, 'a title-case Fork marker parses');
  A.eq(F.stripMarkers('Pick.\nFork: tone? || casual | formal'), 'Pick.', 'and never renders raw');
  A.eq(F.parse('fork: tone? || casual | formal'), null, 'a lowercase "fork:" is never a marker');
  const code = 'const fork: Fork = a || b';
  A.eq(F.stripMarkers(code), code, 'so a line of code that says "fork: … ||" is left alone');
  A.eq(F.TaskIntent.parse('task_question: which? || a | b'), { question: 'which?', options: ['a', 'b'] }, 'a lowercase task_question parses');
  A.eq(F.stripMarkers('Ok.\ntask_question: which? || a | b'), 'Ok.', 'and strips');
  A.eq(F.liveText('Ok.\n\ntask_question: who is it'), 'Ok.\n\n', 'a lowercase task_question being typed is held back');
  A.eq(F.liveText('Ok: task_qu'), 'Ok:', 'and so is a half-typed lowercase keyword (it carries the underscore)');
  A.eq(F.liveText('I asked for'), 'I asked for', 'an ordinary lowercase word is never held');
  A.eq(F.liveText('Ok.\n\nFork: tone'), 'Ok.\n\n', 'a title-case Fork being typed is held back');
  A.eq(F.readable('Pick.\ntask_question: tone? || casual | formal'), 'Pick.\ntone?\n- casual\n- formal', 'readable takes the lowercase marker too');
  A.eq(F.readable('Pick.\n1. FORK: tone? || casual | formal'), 'Pick.\ntone?\n- casual\n- formal', 'and a numbered one');
  A.eq(typeof F.MARKER_KEY, 'string', 'the keyword grammar is exported for the host');
  const key = new RegExp(F.MARKER_KEY);
  A.ok(key.test('FORK') && key.test('Fork') && key.test('TASK_QUESTION') && key.test('Task_Question') && !key.test('fork'), 'MARKER_KEY is the one case rule');
  const loop = require('fs').readFileSync(require('path').join(__dirname, '..', 'sidecar', 'loop.js'), 'utf8');
  A.ok(/const CHOICE_MARKER = new RegExp\(MARKER_KEY \+/.test(loop) && /const MARKER_START = new RegExp\([^\n]*MARKER_KEY/.test(loop), 'the loop builds its marker checks from the same keyword grammar');
}

/* ---------- beliefText: the banked belief stays legible ---------- */
A.eq(F.beliefText('terse summary or full detail?', 'terse'), 'terse (asked: terse summary or full detail?)', 'the belief carries answer + question context');
A.eq(F.beliefText('', 'bullets'), 'bullets', 'no question → the bare answer');
A.eq(F.beliefText('q?', ''), '', 'no answer → empty (the caller banks nothing)');

A.report('fork.test');
