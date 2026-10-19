/* node test/autonomy-ui.test.js — source-lock for the AUTONOMY DIAL in the SETTINGS panel (stationui.js).

   stationui.js is browser-flow (DOM/terminal panels), not node-loadable, so — like harness-internal.test.js /
   newhero-reset.test.js — we lock the dial's invariants by reading the source: it must offer every Initiative +
   Reach level the engine defines, WRITE through AutonomyStore (not ad-hoc state), and repaint the honest
   describe() posture line so the panel can never silently drift from the engine. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const Au = require('../frontend/app/autonomy.js');

const src = fs.readFileSync(path.join(__dirname, '../frontend/app/stationui.js'), 'utf8');

// the dial offers a button for EVERY level on both axes (data-init / data-reach), matching the engine enums — so a
// new rung added to autonomy.js can't be silently missing from the dial.
// The Initiative buttons render from INITIATIVE_RUNGS (org pass 10-14): one table names every rung, so the dial, a
// trust offer and a PERMISSIONS notice can never disagree on a rung's name.
const rungsBlock = /const INITIATIVE_RUNGS = \[([\s\S]*?)\n  \];/.exec(src);
A.ok(!!rungsBlock, 'stationui.js declares the INITIATIVE_RUNGS table');
const rungs = rungsBlock ? [...rungsBlock[1].matchAll(/\{ id: '([a-z]+)', label: '([^']+)'/g)].map(m => ({ id: m[1], label: m[2] })) : [];
A.eq(rungs.map(r => r.id), Au.INITIATIVE, 'INITIATIVE_RUNGS covers every engine Initiative level, in order');
A.ok(src.includes(`data-init="' + r.id + '"`) && src.includes('INITIATIVE_RUNGS.map(r =>'), 'the dial renders one data-init button per INITIATIVE_RUNGS row');
// call #57 copy: the leash rung reads SMALL JOBS (BUILD clashed with the BUILD dock; DRAFT is untrue in build mode),
// and REACH sandbox reads LOCAL ONLY (the stored value stays 'sandbox').
A.eq((rungs.find(r => r.id === 'leash') || {}).label, 'SMALL JOBS', 'the leash rung reads SMALL JOBS');
A.ok(/data-reach="sandbox"[^>]*>LOCAL ONLY<\/button>/.test(src), 'REACH sandbox reads LOCAL ONLY on the button');
A.ok(!/>BUILD<\/button>/.test(src) && !/>SANDBOX<\/button>/.test(src), 'no dial button still reads BUILD or SANDBOX');
A.ok(/initiativeLabel,/.test(src), 'StationUI exports initiativeLabel for trust offers and notices');
A.ok(!/data-reach="(observe|sandbox|reach)" title=/.test(src) && /data-reach="sandbox" data-tip="/.test(src), 'the REACH rungs carry station data-tips, never a native title');
// every OTHER surface that names a rung reads the same table — AUTOMATE's ON ITS OWN rail header and the desktop
// lifecycle note kept a private copy that still said BUILD (org pass fix).
const autoSrc = fs.readFileSync(path.join(__dirname, '../frontend/app/windows/automation.js'), 'utf8');
A.ok(autoSrc.includes('StationUI.initiativeLabel(sum.initiative)') && !autoSrc.includes("leash: 'BUILD'"), 'AUTOMATE names the rung through StationUI.initiativeLabel, never a private BUILD copy');
A.ok(!src.includes('autonomy to BUILD or FREE') && src.includes("initiativeLabel('leash') + ' or ' + initiativeLabel('free')"), 'the lifecycle note names the arming rungs by their rendered labels');
for (const lvl of Au.REACH) A.ok(new RegExp('data-reach="' + lvl + '"').test(src), 'the dial has a Reach button for "' + lvl + '"');

// the PACE row surfaces the leashPerDay knob: a #auto-pace container plus a button for each of the four presets
// (1/3/6/12) covering the engine's LEASH_MIN..LEASH_MAX span, written through AutonomyStore.setLeash.
A.ok(/id="auto-pace"/.test(src), 'the dial has a PACE row (#auto-pace)');
for (const n of [Au.LEASH_MIN, Au.DEFAULT_LEASH, 6, Au.LEASH_MAX]) A.ok(new RegExp('data-pace="' + n + '"').test(src), 'the PACE row has a button for ' + n + ' jobs/day');
A.eq((src.match(/data-pace="/g) || []).length, 4, 'the PACE row offers exactly four pace presets');

// it writes through the store (persisted, single source of truth) and repaints the live honest description.
A.ok(/AutonomyStore\.setInitiative\(/.test(src), 'the dial writes Initiative via AutonomyStore.setInitiative');
A.ok(/AutonomyStore\.setReach\(/.test(src), 'the dial writes Reach via AutonomyStore.setReach');
A.ok(/AutonomyStore\.setLeash\(Number\(/.test(src), 'the PACE row writes the daily pace via AutonomyStore.setLeash(Number(...))');
A.ok(/AutonomyStore\.describe\(\)/.test(src), 'the dial repaints the live describe() posture line (stays honest)');

A.report('autonomy-ui.test');
