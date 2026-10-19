/* test/build-mode-easy.test.js — BUILD MODE, EASIER + MORE FUN (2026-10-01 — Andrew: "lets also do a big upgrade on build mode overall,
   i feel it needs to be easier and more fun to use"). A newcomer's walk at 1440×900 found the Props tab showing ZERO props, a
   selection that hid the whole library, Delete/Backspace doing nothing, no duplicate or nudge keys, and a tooltip stuck on the glass.
   Locked here (source — build.js is the DOM-bound REFIT module):
     1. the library shows its props: one scroller for the tiles, MAKE A PROP resting as one row that opens in place and is held open
        while a paid job, a preview or a message waits (the props lane's rule), the credits key kept in that row;
     2. the selection card sits ABOVE the library (never hides it), shows the object's art, and every action wears its key;
     3. the editor keys: Delete/Backspace, Ctrl+D (a copy beside it, then selected), Ctrl+C / Ctrl+V (COPY's own pickup), the arrows
        (Shift: five), R/M on the selection — each one ordinary edit, one UNDO;
     4. the BUILD menu's tooltip never outlives opening REFIT;
     5. THE FEEL: a placed thing drops into its own shadow and settles with a low thunk (a whole line drops machine by machine), a
        deleted thing dissolves behind a sweeping cut line with a falling hiss, a hovered prop lifts a hair — drawn only (the model
        has already changed), from the station's own synth, no particles;
     6. MANY AT ONCE: a drag across empty floor in SELECT draws a box and selects everything it touches (Shift adds), Shift+click
        adds / drops one, Ctrl+A takes the floor; the group moves (drag any member, the arrows), duplicates (Ctrl+D) or goes (Delete)
        as ONE edit — one UNDO, all-or-nothing; a plain click on empty floor lets go, and with nothing selected opens the room;
     7. THE TABS SHOW THEIR THINGS: Rooms opens on its room types and Surfaces on its finishes (a pick arms the tool with it), Edit
        on the editor's keys as key caps under the object finder — never a title, a sentence and an empty glass;
     8. DRAG TO LAY A ROW: with furniture armed a drag lays copies from press to release, one every footprint, as ONE undo
        (taken spots skipped, shown red first); machines and capability gear still place one at a time; a jitter is a click;
     9. ROOMS ARE EASY (phase 2): a room is selected like a prop — gold outline + edge handles on the floor, its card docked above
        the library (never a mid-screen sheet): rename in place, a drag inside it MOVES it (SELECT MOVES, 10-11) / RESIZE (drag a
        handle; resizeRoom, one undo) / FLOOR /
        FURNISH (a whole furnished room in one click — the station builder's own refurnish, one undo) / CLEAR / DELETE (twice);
        a furnish or clear that would take EQUIPMENT out names it and asks once more (object = capability). */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const build = rd('frontend/app/build.js'), easy = rd('frontend/css/refit-easy.css'), kit = rd('frontend/css/refit-kit.css'), html = rd('frontend/index.html');
const fn = name => { const i = build.indexOf('function ' + name + '('); if (i < 0) return ''; const j = build.indexOf('\n  }\n', i); return build.slice(i, j + 4); };

/* ---------- 1. the library shows its props ---------- */
A.ok(/\.refit-overlay \.refit-propbrowser \{ overflow: hidden; min-height: 0; \}/.test(easy) && /\.refit-overlay #refit-propgrid-host \{ height: auto; flex: 1 1 0; min-height: 0; overflow-y: auto; \}/.test(easy),
  'ONE scroller holds the tiles (the browser column no longer scrolls around a 160px grid)');
A.ok(/browser\.append\(makePropMount\(\)\)/.test(build) && !/browser\.append\(makePropPanel\(\)\)/.test(build), 'MAKE A PROP mounts through the compact row');
const mount = fn('makePropMount');
A.ok(/const box = makePropPanel\(\);/.test(mount), '…which wraps the props lane\'s own panel, untouched');
A.ok(/makeJob && makeJob\.status !== 'done' && makeJob\.status !== 'failed'\) \|\| !!makePreview \|\| !!makeMsg/.test(mount) && /const open = makeOpen \|\| busy;/.test(mount),
  '…held OPEN while a paid job runs, a preview or a message waits (a job the Commander paid for is never hidden behind a key)');
A.ok(/inp\.addEventListener\('focus', \(\) => \{ makeOpen = true;/.test(mount) && /door\.onclick = \(\) => \{ makeOpen = true; chooseLibrarySection\('decoration'\);/.test(build),
  '…and opens when its field takes the focus, or the EQUIPMENT/ABILITIES door sends the Commander to it');
A.ok(/\.refit-makeprop\.is-compact > :not\(\.refit-makeprop-head\):not\(\.refit-makeprop-cta\) \{ display: none !important; \}/.test(easy) && /\.is-compact \.refit-makeprop-cta \.bb \{/.test(easy),
  'at rest it is ONE row: the title and the credits key (conversion stays in view)');
A.ok(/\.refit-overlay\[data-catalog="true"\] \.refit-hint \.refit-hint-keys \{ display: none; \}/.test(easy) && /white-space: nowrap; overflow: hidden; text-overflow: ellipsis; \}/.test(easy),
  'the status strip is one quiet line while the catalog is up (the tiles get the room)');

/* ---------- 2. the selection card ---------- */
A.ok(!/\.has-selection\[data-tool="select"\] #refit-option-section \{ display:none; \}/.test(kit), 'a selection never hides the library any more');
const sel = fn('renderSelection');
A.ok(/propArtInto\(host\.querySelector\('\.refit-sel-art'\),p\)/.test(sel) && /refit-sel-x/.test(sel), 'the card shows the selected object\'s own art and a ✕ to deselect');
for (const [label, key] of [['TURN', 'R'], ['FLIP', 'M'], ['DUPLICATE', 'Ctrl\\+D'], ['COPY', 'Ctrl\\+C'], ['DELETE', 'Del']])
  A.ok(new RegExp("addKey\\('" + label + "','" + key + "'").test(sel), 'the ' + label + ' key wears its shortcut (' + key.replace(/\\/g, '') + ')');
// (SELECT MOVES, Andrew 10-11: "rather than a move button, which is annoying can we just make the select button allow the user to
//  move" — the card has no MOVE key any more: the selected piece moves when dragged, and the card's sub-line says so; a conveyor
//  machine's card says both halves of ONE GESTURE, THE TARGET DECIDES — onto floor it moves, onto a machine it belts)
A.ok(!/addKey\('MOVE'/.test(sel) && /\(pressMovesSelection\(\)\?' · '\+\(CONNECT_TYPES\[p\.t\]\?'drag onto floor to move, onto a machine to belt':'drag it to move'\)\+' · arrows nudge':''\)\+'<\/small>/.test(sel), 'no MOVE key on the card — it says what a drag on the selected piece does (only where a drag on it does: pressMovesSelection)');
A.ok(/finally \{ if \(ctx\) PropSprites\.setCtx\(ctx\); \}/.test(fn('propArtInto')), 'drawing the card art hands PropSprites back to the floor canvas');
A.ok(/\.refit-overlay \.refit-selection-actions \{ display: grid; grid-template-columns: repeat\(3, minmax\(0,1fr\)\); gap: 5px; \}/.test(easy)
  && /@container \(max-width: 380px\) \{ \.refit-overlay \.refit-selection-actions \{ grid-template-columns: repeat\(2, minmax\(0,1fr\)\); \} \}/.test(easy),
  'actions three to a row, two where the dock is narrow (every key cap fits)');
A.ok(/c\.width = 84; c\.height = 54;/.test(fn('propArtInto')) && /\.refit-sel-art \{ display: grid; place-items: center; width: 84px; height: 54px;/.test(easy),
  'the art well is 84x54, drawn at that size (a taller card squeezed the tile grid back to a sliver at 1440x900)');
A.ok(/addKey\('POSITION','',\(\)=>\{positionOpen=!positionOpen;renderSelection\(\);\},'refit-sel-pos'\)/.test(sel) && /if\(!positionOpen\)return;/.test(sel) && /aria-label="Object grid X"/.test(sel),
  'typing an exact tile is its own key in the grid; the X / Y fields appear only when asked');

/* ---------- 3. the editor keys ---------- */
const key = fn('onKey');
A.ok(/if \(\(selectedPropId \|\| groupIds\.length\) && tool === 'select'\) \{/.test(key), 'the editor keys act on the SELECTED object (or the selected group) only');
A.ok(/ev\.key === 'Delete' \|\| ev\.key === 'Backspace'\) \{ ev\.preventDefault\(\); deleteSelected/.test(key), 'Delete / Backspace remove it');
A.ok(/\(ev\.ctrlKey \|\| ev\.metaKey\) && \(ev\.key === 'd' \|\| ev\.key === 'D'\)\) \{ ev\.preventDefault\(\); duplicateSelected/.test(key), 'Ctrl+D duplicates it');
A.ok(/\(ev\.key === 'c' \|\| ev\.key === 'C'\)\) \{ ev\.preventDefault\(\); copySelected/.test(key) && /\(ev\.key === 'v' \|\| ev\.key === 'V'\) && lastCopy\)/.test(key), 'Ctrl+C picks it up as a stamp; Ctrl+V picks the last copy up again');
A.ok(/ArrowLeft: \[-1, 0\], ArrowRight: \[1, 0\], ArrowUp: \[0, -1\], ArrowDown: \[0, 1\]/.test(key) && /const n = ev\.shiftKey \? 5 : 1;/.test(key), 'the arrows nudge a tile (Shift: five)');
A.ok(key.indexOf("if ((selectedPropId || groupIds.length) && tool === 'select')") > 0 && key.indexOf("if ((selectedPropId || groupIds.length) && tool === 'select')") < key.indexOf("const map = { '0': 'select'"), '…before the number keys pick tools');
const dup = fn('duplicateSelected');
A.ok(/const spec = copySpecOf\(p\), at = freeSpotNear\(spec, p\.x, p\.y\);/.test(dup) && /if \(res\.id\) \{ selectedPropId = res\.id; renderSelection\(\); \}/.test(dup), 'a duplicate lands in the nearest clear spot and becomes the selection (Ctrl+D again makes a row)');
A.ok(!/agentId/.test(fn('copySpecOf')), '…a lone prop\'s copy never carries an agent binding (the COPY tool\'s own rule — a CLIP of a line carries its crew only where that agent is on this station: build-clip.test)');
A.ok(/if \(res && res\.ok\) \{ selectedPropId = null;/.test(fn('deleteSelected')), 'a delete that was refused keeps the selection');
A.ok(/station\.propById\(hoverPropId \|\| selectedPropId\)/.test(build), 'R / M turn and flip the selected object (a hovered one still wins)');
A.ok(/if \(id !== 'select' && !\(o && o\.keepGroup\)\) buildGroup =/.test(build), 'Ctrl+C from the Props tab keeps the Props tab up');

/* ---------- 4. no stuck tooltip ---------- */
A.ok(/raf = requestAnimationFrame\(frame\);\n[^\n]*\n[^\n]*\n    try \{ document\.dispatchEvent\(new Event\('scroll'\)\); \} catch \(_\) \{\}/.test(build), 'opening REFIT sends the station tooltip its hide signal');
A.ok(/<link rel="stylesheet" href="css\/refit-easy\.css">/.test(html) && html.indexOf('css/refit-easy.css') > html.indexOf('css/refit-polish.css'), 'the stylesheet loads after the REFIT glass it refines');
A.ok(/\.refit-library-tabs \.bb:hover::before, \.refit-overlay \.refit-library-tabs \.bb:hover::after/.test(easy), 'the library tabs never wear the old [ ] hover brackets');

/* ---------- 5. the feel ---------- */
A.ok(/const LAND_MS = 340, LAND_RISE = 14;/.test(build) && /function landProps\(ids, stagger\)/.test(build) && /function landState\(id, now\)/.test(build),
  'a placed thing lands: dropped from a little over a tile up, 340ms');
const land = fn('landState');
A.ok(/k < 0\.62 \? -LAND_RISE \* \(1 - \(k \/ 0\.62\) \* \(k \/ 0\.62\)\)/.test(land) && /-LAND_RISE \* 0\.16 \* Math\.sin/.test(land) && /if \(k >= 1\) \{ landings\.delete\(id\); return null; \}/.test(land),
  '…it falls under gravity, settles with ONE small bounce, and is forgotten when it has landed');
A.ok(/const land = landings\.size \? landState\(p\.id, now\) : null;/.test(build) && /hoverPropId === p\.id \? -1\.5 : 0;/.test(build) && /try \{ PropSprites\.draw\(dp, true\); \} finally \{ ctx\.restore\(\); \}/.test(build),
  'the floor pass draws a landing prop in the air and a hovered one lifted a hair (and always restores the canvas)');
for (const [where, rx] of [
  ['the prop tool\'s stamp', /pushFlash\(\[\{ x1: px, y1: py, x2: px \+ s\.w - 1, y2: py \+ s\.h - 1 \}\], false\);\n\s*landProps\(\[res\.id\]\);/],
  ['COPY\'s stamp', /pushFlash\(dupeRectsAt\(w\.tx, w\.ty\), false\);\n\s*landProps\(\[res\.id\]\);/],
  ['Ctrl+D', /pushFlash\(\[\{ x1: at\.x, y1: at\.y, x2: at\.x \+ spec\.w - 1, y2: at\.y \+ spec\.h - 1 \}\], false\);\n\s*landProps\(\[res\.id\]\);/],
  ['a whole line (machine by machine, left to right)', /landProps\(\(res\.ids \|\| \[\]\)\.map\(id => station\.propById\(id\)\)\.filter\(Boolean\)\.sort\(\(a, b\) => a\.x - b\.x \|\| a\.y - b\.y\)\.map\(p => p\.id\), 70\);/],
  ['a dragged move', /if\(moved && moved\.ok\)\{if\(selectedPropId!==d\.propId\|\|groupIds\.length\|\|selectedRoomId\)setSelection\(\[d\.propId\]\);else renderSelection\(\);landProps\(\[d\.propId\]\);\}/],
]) A.ok(rx.test(build), 'lands: ' + where);
A.ok(/vanishProp\(was\); flashUndo\(\);/.test(build) && /vanishProp\(was\); \}/.test(fn('deleteSelected')), 'the DELETE tool and Delete on a selection dissolve what they remove');
const dv = fn('drawVanishing');
A.ok(/cut = top \+ \(bot - top\) \* k;/.test(dv) && /ctx\.clip\(\);/.test(dv) && /ctx\.globalAlpha = Math\.max\(0, 1 - k \* 1\.15\);/.test(dv) && /vanishing\.splice\(i, 1\)/.test(dv),
  '…a cut line sweeps down through it and it fades behind the cut, then is gone');
A.ok(/drawVanishing\(now\);\n  \}/.test(build), '…drawn after the floor\'s props, every frame it lasts');
A.ok(/SFX\.voice\(\{ freq: 140, glide: 62,/.test(fn('sfxLand')) && /SFX\.noise\(\{ dur: 0\.26,/.test(fn('sfxVanish')) && /!SFX\.ctx\) return;/.test(fn('sfxLand')) && /!SFX\.ctx\) return;/.test(fn('sfxVanish')),
  'a low thunk to land, a falling hiss to dissolve — the station\'s own synth, silent until audio is unlocked');
const feelBlock = build.slice(build.indexOf('THINGS LAND, THINGS DISSOLVE'), build.indexOf('function drawFlashes('));
A.ok(feelBlock.length > 0 && !/confetti|particle|sparkle/i.test(feelBlock.replace(/no particles, no confetti/, '')), 'eerie, not cute: no particles, no confetti');
A.ok(/feel: \(\) => \(\{ landing: \[\.\.\.landings\.keys\(\)\], vanishing: vanishing\.length, selected: selectedPropId \}\)/.test(build), 'CDP proof can read what is landing / dissolving mid-animation');

/* ---------- 6. many at once ---------- */
const down = fn('onDown');
A.ok(/if \(p && groupIds\.includes\(p\.id\)\) \{ drag=\{mode:'grouppress',propId:p\.id,start:w,cur:w,moved:false,add:ev\.shiftKey,cx:ev\.clientX,cy:ev\.clientY\};return; \}/.test(down)   // (cx/cy: the group press keeps the click slop too — wave 2, build-20)
  && /if \(p\) \{ drag=\{mode:'selectpress',propId:p\.id,start:w,cur:w,moved:false,add:ev\.shiftKey,cx:ev\.clientX,cy:ev\.clientY,sel:p\.id===selectedPropId\};return; \}/.test(down),   // (cx/cy: THE HAND's click slop, 2026-10-11; sel: SELECT MOVES, 10-11)
  'pressing a member of the group grabs the group; pressing anything else grabs just it (Shift remembered)');
A.ok(/drag = \{ mode: 'boxpress', start: w, cur: w, moved: false, add: ev\.shiftKey, roomId: station\.roomAt\(w\.tx, w\.ty\) \};/.test(down) && !/openRoomCard\(/.test(down),
  'a press on empty floor can become a box — the room card waits for the release, never opens on the press');
A.ok(/if\(drag\.mode==='grouppress'&&drag\.moved&&slipped\)drag\.mode='groupmove';/.test(build) && /if\(drag\.mode==='boxpress'&&drag\.moved\)drag\.mode='box';/.test(build), '…a press that moves becomes a group drag or a box');
const up = fn('onUp') + fn('upCommit');   // (onUp hands the release to upCommit, then re-says the cursor)
A.ok(/if \(d\.mode === 'selectpress' \|\| d\.mode === 'grouppress'\) return d\.add \? toggleInSelection\(d\.propId\) : onInspect\(/.test(up)
  && /if \(d\.mode === 'groupmove'\) return commitGroupMove\(d, ev\);/.test(up) && /if \(d\.mode === 'boxpress' \|\| d\.mode === 'roompress'\) return clickEmptyFloor\(d, ev\);/.test(up) && /if \(d\.mode === 'box'\) return commitBox\(d, ev\);/.test(up),
  'releases: Shift+click toggles, a click inspects one, a group drag commits, a box selects, a plain floor click lets go');
A.ok(/if \(!d\.add && selectionIds\(\)\.length\) \{ setSelection\(\[\]\); sfx\('click'\); return; \}\n    if \(d\.roomId\) \{ if \(d\.roomId !== selectedRoomId\) openRoomCard\(d\.roomId, ev\); return; \}\n    if \(selectedRoomId\) \{ selectRoom\(null\); sfx\('click'\); \}/.test(fn('clickEmptyFloor')),
  'a plain click on empty floor lets go of selected props first; otherwise it selects the room under it (off the deck it lets go of the room)');
// (THE HAND part 2, 2026-10-11: the box takes the BELTS it crosses too — beltsInBox — and they ride with the selection)
A.ok(/rectsMeet\(propRect\(p\), r\)/.test(fn('propsInBox')) && /const all = d\.add \? selectionIds\(\)\.concat\(ids\) : ids, bb = beltsInBox\(r, all\);/.test(fn('commitBox')) && /setSelection\(all, \{ links: /.test(fn('commitBox')),
  'the box takes everything it TOUCHES — the belts it crosses too; Shift adds to what was already selected');
A.ok(/groupIds = live\.length > 1 \? live : \[\];/.test(fn('setSelection')) && /selectedPropId = live\.length === 1 \? live\[0\] : null;/.test(fn('setSelection')),
  'one is a selection, two or more a group (never both)');
A.ok(/groupIds=\[\];selectedRoomId=null;selectedPropId=p\.id;renderSelection\(\);/.test(fn('onInspect')) && /selBelts=null;selectedPropId=null;groupIds=\[\];selectedRoomId=null;renderSelection\(\);/.test(build),
  'inspecting one thing, or arming any tool, lets go of the group');
const mg = fn('moveGroupBy');
A.ok(/return station\.transact\(\(\) => \{/.test(mg) && /sort\(\(a, b\) => \(b\.x \* dx \+ b\.y \* dy\) - \(a\.x \* dx \+ a\.y \* dy\)\)/.test(mg)
  && /if \(next\.length === pending\.length\) return last/.test(mg) && /if \(!r \|\| !r\.ok\) \{ next\.push\(id\); last = r; continue; \}/.test(mg) && !/r\.lost/.test(mg),   // (wave 2: a lost belt link is moveProp's own LINK_LOST refusal — it waits as a stuck member and `last` hands it back)
  'a group moves as ONE transact: front-first, members wait for each other, and a stuck member or a lost belt link puts it all back');
A.ok(/!ids\.has\(q\.id\) && !propSpec\(q\.t\)\.flat && rectsMeet\(propRect\(q\), to\)/.test(fn('groupFit')), 'the drag ghost counts only things OUTSIDE the group as in the way');
A.ok(/const fit = groupFit\(/.test(fn('refusalOf')) && /refusalOf\(res, ids, dx, dy\)/.test(fn('commitGroupMove')) && /refusalOf\(res, ids, dx, dy\)\.msg/.test(fn('nudgeGroup')),
  'a refused group move names what is in the way, as the ghost did');
const dg = fn('deleteGroup');
// (THE HAND part 2: the belts the box took go in the SAME transact — taken up first, while both their ends still stand)
// (repair 2026-10-11: the box's belts — or, for a CUT, the belts its clip carries — and the tile under each removed junction)
A.ok(/const res = station\.transact\(\(\) => \{/.test(dg) && /station\.removeLinks\(liftIds, loose, \{ junctions: /.test(dg) && /: \(bs \? bs\.links : \[\]\), loose = cut \? \[\] : \(bs \? bs\.tiles : \[\]\);/.test(dg) && /for \(const p of was\) \{ const r = station\.removeProp\(p\.id\);/.test(dg)
  && dg.indexOf('station.removeLinks(') < dg.indexOf('station.removeProp(') && /was\.forEach\(p => vanishProp\(p\)\)/.test(dg),
  'Delete removes the whole group — and the belts it took — in one transact (one UNDO), and every member dissolves');
A.ok(/if \(n - lastVanishSfx < 80\) return;/.test(fn('sfxVanish')), '…on one hiss, not a hiss per member');
// (THE HAND part 2: Ctrl+D on a group is a CLIP laid beside itself — its belts, settings and crew too; the model's pasteLines is
//  the one transact, and its clipOrder lays a table before what stands on it — test/build-clip.test.js)
const dup2 = fn('duplicateGroup'), dupc = fn('duplicateClip'), wm = rd('frontend/app/worldmodel.js');
A.ok(/return duplicateClip\(ev\);/.test(dup2) && /tries\.push\(\[c\.x0 \+ c\.w \+ gap, c\.y0 \+ s\], \[c\.x0 \+ s, c\.y0 \+ c\.h \+ gap\], \[c\.x0 - c\.w - gap, c\.y0 \+ s\], \[c\.x0 \+ s, c\.y0 - c\.h - gap\]\)/.test(dupc)
  && /const res = station\.pasteLines\(c, ax, ay, \{ agent: agentHere, label: 'DUPLICATE' \}\);/.test(dupc) && /setSelection\(res\.ids, \{ links: res\.links \|\| \[\], tiles: \[\] \}\);/.test(dupc)
  && /\(ma\.mount === 'surface' \|\| ma\.stack\) \? 1 : 0\)/.test(wm),
  'Ctrl+D lays the whole arrangement again beside itself (one transact, tables before what stands on them, its belts with it), and the copies become the selection');
for (const fname of ['deleteSelected', 'duplicateSelected', 'nudgeSelected']) A.ok(/if \(groupIds\.length\) return /.test(fn(fname)), fname + ' speaks for the group when there is one');
// (THE HAND part 2: a group, a conveyor piece or a selection with belts copies as a CLIP — Andrew approved copying a line WITH
//  its crew in his prototype; a lone piece of furniture is still the COPY tool's stamp)
A.ok(/if \(groupIds\.length \|\| beltSel\(\) \|\| clipWorthy\(\)\) return copyClip\(ev, false\);/.test(fn('copySelected')) && /pickupDupe\(\{ tx: p\.x, ty: p\.y \}, ev, p\.id\);/.test(fn('copySelected')),
  'Ctrl+C on a group (or a conveyor piece) puts a CLIP of it in hand; a lone prop is still picked up as a stamp');
const gc = fn('renderGroupCard');
A.ok(!/key\('MOVE'/.test(gc) && /key\('DUPLICATE', 'Ctrl\+D'/.test(gc) && /key\('DELETE', 'Del'/.test(gc) && /ps\.slice\(0, 3\)\.forEach\(p => propArtInto\(art, p\)\)/.test(gc),
  'the group card: up to three of them in the art well, then DUPLICATE / DELETE wearing their keys (no MOVE key: drag any of them — SELECT MOVES)');
A.ok(/\(ev\.key === 'a' \|\| ev\.key === 'A'\) && tool === 'select'\) \{ ev\.preventDefault\(\); selectAllProps/.test(key), 'Ctrl+A takes the whole floor');
A.ok(/if \(selectedPropId \|\| groupIds\.length \|\| selectedRoomId\) \{ selectTool\('select'\); return; \}/.test(key), 'Esc lets go of a group (or a room)');
A.ok(/for\(const id of groupIds\)\{const gp=station\.propById\(id\);if\(gp\)drawPropSelection\(gp,t,'rgba\(244,200,112,\.9\)',false\);\}/.test(fn('drawHover')), 'every member wears the selection gold');
A.ok(/if \(drag && drag\.mode === 'box'\) \{ drawSelectBox\(t\); return; \}/.test(build) && /if \(g\.group\) \{ drawGroupGhost\(t, now, g\); return; \}/.test(build), 'the box and a group drag each draw their own ghost');
A.ok(/RELEASE TO SELECT/.test(fn('drawSelectBox')) && /' THINGS'\]/.test(fn('drawGroupGhost')), '…the box says how many it will take; the group ghost says how far and how many');
A.ok(/groupmove: 1, roomresize: 1 \}/.test(build), 'a group drag and a room resize tick tile by tile like any move');
A.ok(/<span><b>Drag a box<\/b> Select several<\/span>/.test(build), 'HELP teaches the box');
A.ok(/selection: \(\) => selectionIds\(\),/.test(build), 'CDP proof can read the selection');

/* ---------- 6b. SELECT MOVES (Andrew 10-11: "rather than a move button, which is annoying can we just make the select button allow
   the user to move") — the MOVE tool is retired; SELECT does the moving ---------- */
A.ok(!/id: 'move'/.test(build.slice(build.indexOf('const TOOLS = ['), build.indexOf('const ICON_PX'))) && /\['edit', 'Edit', \['select','dupe','reclaim'\]\]/.test(build),
  'no MOVE tool in TOOLS or on the Edit toolbar');
A.ok(/const map = \{ '0': 'select', '1': 'room', '2': 'hall', '3': 'paint', '5': 'reclaim', '6': 'prop', '7': 'belt', '8': 'dupe', '9': 'line' \};/.test(key),
  'key 4 is free — no other tool was renumbered');
A.ok(/if \(id === 'move'\) id = 'select';/.test(fn('selectTool')), 'a stale selectTool(\'move\') lands on SELECT (which moves)');
A.ok(/if\(drag\.mode==='selectpress'&&drag\.moved&&slipped\)drag\.mode=\(!drag\.add&&!drag\.sel&&beltSource\(drag\.propId\)\)\?'handbelt':'propmove';/.test(fn('onMove')),
  'a SELECTED piece dragged moves; an unselected machine dragged lays a belt; Shift (or furniture) moves');
A.ok(/const inSelRoom = !!selectedRoomId && station\.roomAt\(w\.tx, w\.ty\) === selectedRoomId;/.test(down) && /if \(inSelRoom\) \{ drag = \{ mode: 'roompress', roomId: selectedRoomId,/.test(down)
  && down.indexOf("if (inSelRoom) {") > down.indexOf("mode: 'beltpress'") && down.indexOf("if (inSelRoom) {") < down.indexOf("mode: 'boxpress'")
  && /if\(drag\.mode==='roompress'&&drag\.moved&&slipped\)drag\.mode='move';/.test(fn('onMove')) && /if \(d\.mode === 'move'\) return commitMove\(d, ev\);/.test(up),
  'inside the SELECTED room on bare floor a drag moves the room (pieces and belts first; elsewhere a box)');
const aim = fn('selectAim');
A.ok(/\(shift \|\| p\.id === selectedPropId \|\| groupIds\.includes\(p\.id\)\) \? 'move' : beltSource\(p\.id\) \? 'crosshair' : null/.test(aim) && /hoverRoomId === selectedRoomId && \(shift \|\| !station\.beltAt\(/.test(aim)
  && /const want = cursorFor\(ev\.shiftKey\);/.test(fn('onMove')),
  'the pointer says what a drag will do: move over a selected piece (or the selected room, or with Shift), aim over an unselected machine');
A.ok(!/MOVE \(4\)|selectTool\('move'\)|\['4', 'Move'\]/.test(build + rd('frontend/app/tutorial.js')), 'no copy or key list names the retired MOVE (4)');
A.ok(/<span><b>Drag a selected piece<\/b> Move it<\/span>/.test(build) && /\['Drag a machine', 'onto another: belt them'\], \['Drag a selected one', 'onto floor: move it'\], \['Shift \+ drag', 'move any piece'\]/.test(build)
  && /fmEntry\(null, 'Select &amp; move', 'Click a piece to select it, then drag it onto open floor to move it;[^']*Drag a machine onto another machine to belt them, selected or not;/.test(rd('frontend/app/tutorial.js')),
  'HELP, the Edit key caps and the Field Manual teach: drag a machine onto another to belt them (selected or not), drag a selected piece onto open floor to move it');

/* ---------- 6c. SELECT MOVES — the review's repair pass (10-11) ---------- */
// an armed tool: the card said "drag it to move" over the desk PROP just placed (or a BAY clicked with a chair armed), and the drag
// stamped a second desk / laid a row of chairs — the press on the SELECTED piece is SELECT's own press unless pressing it is the tool's job
const pms = fn('pressMovesSelection');
A.ok(/if \(tool === 'select'\) return !hand && !touchArm;/.test(pms) && /if \(tool === 'reclaim' \|\| tool === 'paint' \|\| tool === 'belt'\) return false;/.test(pms)
  && /if \(tool === 'dupe'\) return !!dupe && dupe\.type !== 'lines';/.test(pms),
  'the selection moves under an armed tool — never where DELETE / SURFACE / BELT / an empty COPY / a clip in hand owns that press');
A.ok(/if \(tool !== 'select' && \(selectedPropId \|\| groupIds\.length\) && pressMovesSelection\(\)\) \{/.test(down)
  && down.indexOf('pressMovesSelection()') < down.indexOf("if (tool === 'select') {") && down.indexOf('pressMovesSelection()') < down.indexOf("mode: 'propstamp', start: w, cur: w, moved: false, cx: ev.clientX, cy: ev.clientY };   // cx/cy: a jitter is not a row")
  && /if \(sp && sp\.id === selectedPropId\) \{ drag = \{ mode: 'selectpress', propId: sp\.id, [^}]*sel: true \}; return; \}/.test(down)
  && /if \(sp && groupIds\.includes\(sp\.id\)\) \{ drag = \{ mode: 'grouppress',/.test(down),
  'PROP / LINES / ROOM armed: a press on the selected piece (or a group member) drags it before the tool branches — never a stamp or a row');
A.ok(/if \(tool !== 'select'\) return \(p && \(p\.id === selectedPropId \|\| groupIds\.includes\(p\.id\)\) && pressMovesSelection\(\)\) \? 'move' : null;/.test(aim)
  && /if \(hoverHandle < 0\) \{ const want = cursorFor\(ev\.shiftKey\);/.test(fn('onMove'))
  && /!\(tool !== 'select' && hoverPropId && \(hoverPropId === selectedPropId \|\| groupIds\.includes\(hoverPropId\)\) && pressMovesSelection\(\)\)/.test(fn('ghostInfo')),
  '…and the pointer says so (the move cursor, no stamp ghost over the selected piece)');
A.ok(/if \(\(selectedPropId \|\| groupIds\.length\) && tool !== 'select' && pressMovesSelection\(\)\) \{/.test(key), '…and the arrows nudge it there too, as its card says');
// the cards teach the drag their MOVE keys used to
A.ok(/' · drag inside to move · arrows nudge'\)/.test(fn('renderRoomCard')) && /\+ \(ps\.length && pressMovesSelection\(\) \? ' · drag any to move' : ''\);/.test(gc),
  'the room card and the group card say how they move (the single card says "drag it to move")');
// a selected room with no bare floor (a hallway its belt covers end to end): Shift over a belt in it grabs the room
A.ok(/if \(inSelRoom && ev\.shiftKey && station\.beltAt\(w\.tx, w\.ty\)\) \{ drag = \{ mode: 'roompress', roomId: selectedRoomId, [^}]*viaBelt: true \}; return; \}/.test(down)
  && down.indexOf('viaBelt: true') < down.indexOf("mode: 'beltpress'")
  && /if \(d\.mode === 'roompress' && d\.viaBelt\) return openBeltCard\(d\.start\.tx, d\.start\.ty, ev\);/.test(up),
  'Shift+drag over a belt inside the selected room moves the room (a Shift+click on it still opens the belt card)');
A.ok(/if \(ev\.key === 'Shift'\) \{ escExitArmedAt = 0;/.test(key), 'Shift still disarms a pending Esc-to-exit (any other key does)');
A.ok(/upCommit\(d, ev\);\n[^\n]*\n[^\n]*\n    if \(!drag\) setCursor\(\);/.test(fn('onUp')), 'the cursor is said again AFTER the release changed the selection (a just-selected machine shows the move cursor)');
// the points of use that walked users into "I dragged to belt it and it moved" — the refine (10-11) made that drag WORK (a selected
// machine let go on another machine belts them: test/build-select-target.test.js), so none of them teaches a deselect any more
A.ok(!/ORPHAN_SOURCE_SELECTED/.test(build) && /ORPHAN_SOURCE: 'NOT CONNECTED — DRAG IT ONTO A BAY'/.test(build),
  'an unconnected source says DRAG IT ONTO A BAY on the floor, selected or not (no DESELECT variant)');
A.ok(/' PLACED AND CONNECTED' \+ \(t === 'bay' \? ' · CLICK IT TO CREW IT' : ''\)/.test(fn('commitDropPick'))
  && /'run a second belt OUT of the splitter first: drag from the SPLITTER onto the next machine'/.test(fn('splitModeInfo'))
  && !/it was selected, so the drag MOVED it/.test(fn('commitPropMove')),
  'the drop-pick tip and the SPLITTER refusal say just the gesture; a selected machine let go on a machine is never a move to explain');
A.ok(/const dragWords = p => CONNECT_TYPES\[p\.t\] \? 'drag it onto another machine to belt them, onto open floor to move it' : 'drag it to move it';/.test(build)
  && /setHint\('Selected '\+propLabel\(p\.t\)\+' · '\+dragWords\(p\)\+' · choose an action in the build kit'\);/.test(fn('onInspect')),
  'the status line under a just-clicked machine says both halves: onto a machine belts, onto open floor moves');
{
  const tut = rd('frontend/app/tutorial.js'), lines = tut.slice(tut.indexOf("if (tab === 'LINES') {"), tut.indexOf("if (tab === 'PROGRESS') {"));
  const same = lines.indexOf('selected or not, so the BAY you just crewed belts the same way'), route = lines.indexOf('Connect INBOX → BAY, then BAY → OUTBOX');
  A.ok(/Click the BAY: the <b>Workflow panel<\/b>/.test(lines) && same > 0 && route > same && !/deselect/i.test(lines),
    'the Field Manual LINES steps crew the BAY (selecting it) and then say the drag belts it all the same — no deselect step');
  const wfp = rd('frontend/app/workflowpanel.js');
  A.ok(!/Esc lets go of it first|deselect it first/.test(wfp) && /'Drag from one machine onto the next to connect them\.'\]/.test(wfp),
    'the Workflow panel teaches the drag alone (selected or not, it belts)');
}
A.ok(/^\.refit-toolset-buttons\.is-edit \{ grid-template-columns: repeat\(3,minmax\(0,1fr\)\); \}/m.test(kit)
  && /^\.refit-overlay \.refit-toolset-buttons\.is-edit \{ grid-template-columns: repeat\(3,minmax\(0,1fr\)\); \}/m.test(rd('frontend/css/refit-polish.css')),
  'the Edit toolset lays out three columns for its three tools (no empty cell where MOVE was)');
{
  const sc = rd('website/docs/shortcuts.html'), gl = rd('website/docs/glossary.html');
  A.ok(!/<b>MOVE<\/b>/.test(sc) && /<b>SELECT<\/b> &mdash; click to select &middot; drag a machine onto another to belt them &middot; drag a selected piece onto open floor to move it/.test(sc) && !/Ten tools|, move, delete,/.test(gl),
    'the public shortcuts page and glossary no longer advertise the retired MOVE on key 4');
  /* the layout count on the public pages is the shelf's own count (review docs-claims-07 follow-up: it drifted 19 vs 20 once);
     a page may drop the number, but a number it states must be WorldModel.BLUEPRINTS.length */
  const units = 'zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen'.split(' ');
  const tens = { twenty: 20, thirty: 30, forty: 40 };
  const num = t => {
    t = t.toLowerCase();
    if (/^\d+$/.test(t)) return +t;
    if (units.includes(t)) return units.indexOf(t);
    const m = /^(twenty|thirty|forty)(?:-(one|two|three|four|five|six|seven|eight|nine))?$/.exec(t);
    return m ? tens[m[1]] + (m[2] ? units.indexOf(m[2]) : 0) : null;
  };
  const shelf = require('../frontend/app/worldmodel.js').BLUEPRINTS.length;
  for (const [page, src] of [['glossary.html', gl], ['help.html', rd('website/docs/help.html')]]) {
    const said = [...src.matchAll(/\b([A-Za-z]+(?:-[a-z]+)?|\d+) (?:ready-made |finished )?layouts\b/g)].map(m => num(m[1])).filter(n => n !== null);
    A.ok(said.every(n => n === shelf), page + ' states the shelf\'s own layout count (' + shelf + '), never a stale one: ' + JSON.stringify(said));
  }
}

/* ---------- 7. the tabs show their things ---------- */
const pal = fn('renderPalette');
A.ok(/if \(tool === 'select' && buildGroup === 'edit'\) \{/.test(pal) && !/Choose Room to add space/.test(pal) && !/Choose Surface to pick a floor/.test(pal), 'only the Edit tab keeps a note — Rooms and Surfaces show their things');
A.ok(/\['Drag a box', 'select several'\]/.test(pal) && /\['Ctrl \+ D', 'duplicate'\]/.test(pal) && /\['Del', 'delete'\]/.test(pal) && /<kbd>' \+ esc\(k\) \+ '<\/kbd>/.test(pal),
  'Edit shows the editor\'s keys as key caps (the gestures no button shows, too)');
A.ok(/note\.insertBefore\(finder, note\.querySelector\('\.refit-keyrows'\)\);/.test(pal), '…under the object finder, which acts');
A.ok(/\} else if \(tool === 'room' \|\| \(tool === 'select' && buildGroup === 'rooms'\)\) \{/.test(pal) && /const active = tool === 'room' && k === kind;/.test(pal)
  && /kind = k; if \(tool !== 'room'\) selectTool\('room', \{ silent: true \}\);/.test(pal),
  'Rooms opens on its room types (none lit until one is picked); picking one arms ROOM with it');
A.ok(/\} else if \(tool === 'paint' \|\| \(tool === 'select' && buildGroup === 'surfaces'\)\) \{\n      if \(tool === 'select'\) pal\.addEventListener\('click', armPaintFromBrowse, true\);/.test(pal)
  && /closest\('\.refit-mattile, \.refit-hue'\)\) selectTool\('paint', \{ silent: true \}\);/.test(fn('armPaintFromBrowse')),
  'Surfaces opens on its finishes; the first material or colour picked arms SURFACE with it');
A.ok(/buildGroup === 'rooms'\) verb = 'Pick a room type, then drag on the grid · click a room to move, resize or furnish it'/.test(build) && /\['Click a room', 'move · resize · furnish'\]/.test(build) && /buildGroup === 'surfaces'\) verb = 'Pick a finish, then click a room to lay it/.test(build),
  'the status line says what the open tab is for');

/* ---------- 8. drag to lay a row ---------- */
const rowable = fn('rowable');
A.ok(/!isWorkflowType\(t\) && t !== 'airlock'/.test(rowable) && /\.tier !== 'functional'/.test(rowable) && /WorldModel\.grantLabelForProp\(t\)/.test(rowable),
  'only furniture lays rows: never a line machine, an airlock, functional gear or anything that grants a capability');
const rs = fn('rowSpots');
A.ok(/if \(Math\.hypot\(lastClient\.x - d\.cx, lastClient\.y - d\.cy\) < 12\) return null;/.test(rs), 'a jitter across a tile edge is a click, not a row');
A.ok(/const step = across \? s\.w : s\.h/.test(rs) && /Math\.min\(40, Math\.floor\(Math\.abs\(across \? dx : dy\) \/ step\) \+ 1\)/.test(rs) && /if \(n >= 2\)/.test(rs)
  && /v: station\.canPlaceProp\(propType, x, y, s\.w, s\.h\)/.test(rs),
  'a row runs along the longer axis, one copy every footprint (40 at most), each spot asked of the floor');
A.ok(/drag = \{ mode: 'propstamp', start: w, cur: w, moved: false, cx: ev\.clientX, cy: ev\.clientY \};/.test(build), '…the press remembers where the pointer was');
const cps = fn('commitPropStamp');
A.ok(/const row = rowSpots\(d\);\n    if \(row\) return commitRow\(row, ev\);/.test(cps) && cps.indexOf('rowSpots(d)') > cps.indexOf('if (!d.moved)'), 'a drag lays the row; a click still places one (or inspects what it hit)');
const cr = fn('commitRow');
A.ok(/const res = station\.transact\(/.test(cr) && /landProps\(made, 45\)/.test(cr) && /taken spot/.test(cr) && /one Undo takes the row back/.test(cr),
  'the whole row is ONE transact (one UNDO), its copies drop in down the row, and a skipped spot is said');
A.ok(/'ROW OF ' \+ g\.row\.length/.test(fn('drawRowGhost')) && /RELEASE TO LAY ALL /.test(fn('drawRowGhost')) && /if \(g\.row\) \{ drawRowGhost\(t, now, g\); return; \}/.test(build),
  'the row ghost shows every spot (taken ones red) and how many the release will lay');
A.ok(/rowable\(propType\) \? 'CLICK TO PLACE · DRAG FOR A ROW' : 'CLICK TO PLACE'/.test(build) && /'click a clear deck tile to place' \+ \(rowable\(propType\) \? ' · drag for a row' : ''\)/.test(build),
  'the hover ghost and the status line teach the row where it exists');
A.ok(/if \(!ids\.length && !bb\.n\) \{ if \(!d\.add\) setSelection\(\[\]\); return; \}/.test(fn('commitBox')), 'an empty box lets go quietly (a stray drag on bare floor is not buzzed at)');

/* ---------- 9. rooms are easy ---------- */
const orc = fn('openRoomCard');
A.ok(/cardCloseAll\(\);\n    selectRoom\(roomId\);/.test(orc) && !/class(Name)? ?= ?['"]refit-guide/.test(orc), 'a room click selects the room — no mid-screen sheet any more');
A.ok(/if\(selectedRoomId\)\{\n      const rm=station&&station\.roomById\(selectedRoomId\);\n      if\(rm\)\{host\.hidden=false;root\.classList\.add\('has-selection'\);return renderRoomCard\(host,rm\);\}/.test(build),
  'the selected room\'s card docks where a prop\'s does, above the library');
const rc = fn('renderRoomCard');
A.ok(/class="refit-room-name"/.test(rc) && /nameEl\.onblur = saveName;/.test(rc) && /if \(e\.key === 'Enter'\) \{ e\.preventDefault\(\); nameEl\.blur\(\); \}/.test(rc) && /e\.key === 'Escape'\) \{ e\.preventDefault\(\); nameEl\.value = saved;/.test(rc),
  'rename in place: Enter or leaving the field saves it, Esc puts it back');
A.ok(rc.indexOf("key('MOVE'") < 0, 'the room card has no MOVE key — a drag inside the selected room moves it (SELECT MOVES, 10-11)');
for (const k of ["key('RESIZE', 'edges'", "key('FLOOR', '3'", "key('FURNISH', ''", "key('CLEAR', ''", "isSpawn ? 'PROTECTED' : 'DELETE'"]) A.ok(rc.indexOf(k) >= 0, 'the room card offers ' + k.replace(/key\('|', .*$|isSpawn \? 'PROTECTED' : '|'$/g, ''));
A.ok(/if \(isSpawn\) \{ del\.disabled = true;/.test(rc), '…and the spawn room is protected');
A.ok(/matSwatchCanvas\(matId \|\| 'plate', hue, 7, 4\)/.test(rc), 'its art well is the room\'s own deck, painted by the bake');
const rha = fn('roomHandleAt');
A.ok(/if \(!rm \|\| rm\.rects\.length !== 1 \|\| !cv\) return null;/.test(rha) && /Math\.max\(t \* 0\.45, 9 \/ zoom\)/.test(rha) && /Math\.abs\(wy - Y1\) < B/.test(rha),
  'handles: eight on a plain rectangle (corners + edge middles), or anywhere along an edge');
A.ok(/const hd = selectedRoomId \? roomHandleAt\(ev\) : null;\n      if \(hd\) \{ drag = \{ mode: 'roomresize', roomId: selectedRoomId, edge: hd\.e, start: w, cur: w, moved: false \}; return; \}/.test(fn('onDown')),
  'a press on the selected room\'s handle starts a resize before anything else is hit');
A.ok(/r\.x1 = Math\.min\(r0\.x1 \+ dx, r0\.x2 - min \+ 1\)/.test(fn('resizedRect')) && /station\.MIN_ROOM \|\| 3/.test(fn('resizedRect')), 'a grabbed edge follows by whole tiles, never past the room minimum');
const rk = fn('resizeCheck');
A.ok(/station\.canPlaceRoom\(\[nr\], rm\.kind, rm\.id\)/.test(rk) && /it would be left off the deck/.test(rk) && /A belt would be left off the deck/.test(rk),
  'the ghost asks resizeRoom\'s own two questions, naming what is in the way');
A.ok(/const res = pre && pre\.ok \? keepsHalls\(\(\) => station\.resizeRoom\(rm\.id, nr\)\) : pre;/.test(fn('commitRoomResize')), 'the release resizes through WorldModel.resizeRoom (one undo), keeping every hallway joined');
A.ok(/if \(g\.kind === 'resize'\) return/.test(fn('placementReason')), 'a resize refusal says the room\'s own reason (never "Blocked by" a prop inside it)');
A.ok(/station\.moveRoom\(rm\.id, dx, dy\)/.test(fn('nudgeRoom')) && /deleteSelectedRoom\(orientEv\(\)\)/.test(key) && /nudgeRoom\(RA\[0\] \* n, RA\[1\] \* n, orientEv\(\)\)/.test(key),
  'with a room selected the arrows nudge it (its contents ride) and Delete deletes it');
A.ok(/press Delete again to delete/.test(fn('deleteSelectedRoom')) && /now - roomDelArmedAt > \(cutArmFor\(rm\.id\) \? 6000 : 2500\)/.test(fn('deleteSelectedRoom')), '…on the SECOND press within 2.5 s (a room takes everything on it) — or anywhere in the 6 s window of a SEND TO cut warning for THIS room (final floor lane M15; repair: never a stale, unrelated warning’s)');
A.ok(/on\.forEach\(p => vanishProp\(p\)\)/.test(fn('doDeleteRoom')), 'a deleted room\'s contents dissolve');
const re = fn('runRoomEdit');
A.ok(/StationBuilder\.planEdit\(station\.serialize\(\), req, env\)/.test(re) && /StationBuilder\.apply\(station, r\.plan, env\)/.test(re), 'FURNISH / CLEAR are the station builder\'s own planned edit, applied as planned (one undo)');
A.ok(/if \(gear\.length && !confirmed\) \{ roomAsk = /.test(re) && /WorldModel\.capForProp/.test(fn('gearLost')) && /back\.has\(p\.t\)/.test(fn('gearLost')),
  'a plan that takes EQUIPMENT out (and does not bring the same piece back) is not applied on the first click');
A.ok(/FURNISH ANYWAY/.test(rc) && /KEEP IT/.test(rc) && /agents here lose what/.test(rc), '…the card names what goes, and the two ways on');
A.ok(/refurnish: \{ room: rm\.name, style: sid \}/.test(fn('furnishRoom')) && /landProps\(/.test(fn('furnishRoom')) && /vanishProp\(p\)/.test(fn('furnishRoom')), 'a furnished room drops in piece by piece; what it replaced dissolves');
A.ok(/for \(const sid of RoomStyles\.ROOM_ORDER/.test(rc) && /propArtInto\(art, \{ t: icon/.test(rc) && /tile\.setAttribute\('data-tip', styleLabel\(sid\) \+ ' — ' \+ rec\.about\)/.test(rc),
  'the furnish tiles: art + name, the description is the hover tip (no sentences under tiles)');
A.ok(/canRecruit: false/.test(fn('furnishEnv')), 'Build mode never recruits an agent through the furnisher');

A.report('build-mode-easy.test');
