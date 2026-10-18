/* test/build-paint-material.test.js — THE BRUSH NEVER DROPS A PICKED MATERIAL (2026-10-17).

   Andrew: "when applying different textures like turf, it would keep the default floor but change the hue only".
   A deck material is a whole-room surface, and the SURFACE brush only ever painted the hue: a click that drifted across a
   tile seam (the paint press had no CLICK_SLOP) or a deliberate stroke after picking TURF left the old floor down and
   painted MEADOW tiles on it. Proven live before the fix (resin room, TURF picked: a 2px-drift click and a 3-tile stroke
   both left floorMat resin and painted meadow tiles).

   Locked here:
   1. the paint press records where it started and only becomes a stroke past CLICK_SLOP;
   2. paintLaysDeck: a click lays the deck; a stroke lays it when it carries a material the Commander PICKED that the room
      does not have; a stroke with no pick (the palette's PLATE default) or the room's own material paints only the colour;
   3. commitPaint and the paint ghost both read that one rule (the ghost says WHOLE ROOM when release lays the deck). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const build = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'build.js'), 'utf8');
const between = (a, b) => { const i = build.indexOf(a), j = build.indexOf(b, i + 1); A.ok(i >= 0 && j > i, 'found ' + a); return build.slice(i, j); };

/* ---------- 1. a jitter is not a brush stroke ---------- */
{
  A.ok(/drag = \{ mode: 'paint', roomId: id,[^\n]*cx: ev\.clientX, cy: ev\.clientY \}/.test(build), 'the paint press records where it started (cx/cy)');
  A.ok(/if \(drag\.mode === 'paint' && slipped\) drag\.slipped = true;/.test(build), 'a paint drag becomes a stroke only once it has travelled CLICK_SLOP');
  A.ok(/else \{ mat = mid; matPicked = true;/.test(build), 'picking a deck material is what arms it for a stroke');
  A.eq((build.match(/matPicked = true/g) || []).length, 1, 'nothing else marks a material as picked');
}

/* ---------- 2. the rule, run as written ---------- */
{
  const src = build.match(/const paintDragged = [^\n]+\n\s*const paintLaysDeck = [^\n]+/);
  A.ok(src, 'paintDragged + paintLaysDeck are defined');
  const run = (ctx, d) => vm.runInNewContext(src[0] + '\npaintLaysDeck(d)', Object.assign({ d }, ctx));
  const room = { matOfRoom: () => 'resin' };
  const floor = (o) => Object.assign({ paintTarget: 'floor', matPicked: false, mat: 'plate', station: room }, o);
  const click = { roomId: 'r1', moved: false };
  const drift = { roomId: 'r1', moved: true, slipped: false };   // crossed a seam, under CLICK_SLOP
  const stroke = { roomId: 'r1', moved: true, slipped: true };
  A.eq(run(floor({}), click), true, 'a click lays the whole deck');
  A.eq(run(floor({ matPicked: true, mat: 'turf' }), drift), true, 'a click that drifts across a tile seam is still a click: TURF goes down');
  A.eq(run(floor({ matPicked: true, mat: 'turf' }), stroke), true, 'a stroke carrying a picked material the room lacks lays that deck');
  A.eq(run(floor({ matPicked: true, mat: 'resin' }), stroke), false, 'a stroke with the room\'s own material paints only the colour');
  A.eq(run(floor({ matPicked: false, mat: 'plate' }), stroke), false, 'with no material picked (the PLATE default) a stroke never re-floors the room');
  A.eq(run(floor({ paintTarget: 'walls', matPicked: true, mat: 'turf' }), click), false, 'the rule is the deck\'s only (walls and shell clad the whole room on their own)');
}

/* ---------- 3. one rule for the commit and the ghost ---------- */
{
  const commit = between('function commitPaint(d, ev) {', 'function commitReclaim(');
  A.ok(/if \(!paintLaysDeck\(d\)\) \{[\s\S]*station\.paintTiles\(d\.roomId, tiles, style\)[\s\S]*\} else \{[\s\S]*station\.setDeck\(d\.roomId, \{ style, mat \}\)/.test(commit),
    'commitPaint paints tiles only when the rule says colour, else lays the deck in one undo slot');
  A.ok(!/if \(d\.moved\)/.test(commit), 'commitPaint no longer keys on a bare tile change');
  const ghost = between('// paint brush: tint the crossed tiles with the chosen deck colour', '// reclaim drag:');
  A.ok(/drag\.mode === 'paint' && paintDragged\(drag\)/.test(ghost), 'the brush ghost shows only for a real stroke');
  A.ok(/paintLaysDeck\(drag\)/.test(ghost) && /'WHOLE ROOM'/.test(ghost), 'a stroke that will lay the deck shows the whole room and says so');
}

A.report('build-paint-material.test');
