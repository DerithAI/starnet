/* node test/session-creation.test.js — PU-13 blank-session coalescing.
   A +NEW action is idempotent while the active session is still untouched; real content
   makes the next action mint a genuinely new session, and only those legitimate rows persist. */
'use strict';
const fs = require('fs');
const path = require('path');
const A = require('./_assert.js');
const W = require('../frontend/app/workstreams.js');

/* ---------- five synchronous +NEW actions coalesce onto one untouched row ---------- */
W.reset();
const first = W.active();
const opened = [];
for (let i = 0; i < 5; i++) opened.push(W.startSession());
A.eq(W.list().length, 1, 'five synchronous +NEW actions from a blank station leave one session row');
A.ok(opened.every(w => w === first), 'every rapid +NEW action focuses the same untouched session');
A.eq(W.activeId(), first.id, 'the coalesced blank remains active');

/* ---------- content makes the next +NEW legitimate ---------- */
first.history.push({ role: 'user', content: 'real work begins here' });
const second = W.startSession();
A.ok(second.id !== first.id, 'content then +NEW creates a distinct session');
A.eq(W.list().length, 2, 'only the content-bearing session and its new blank exist');

/* ---------- reload preserves only legitimate rows; rapid actions stay idempotent ---------- */
const saved = JSON.parse(JSON.stringify(W.serialize()));
W.init(saved);
A.eq(W.list().length, 2, 'reload preserves the two legitimate sessions');
const reloadedBlank = W.active();
for (let i = 0; i < 5; i++) A.ok(W.startSession() === reloadedBlank, 'post-reload +NEW reuses the active untouched blank');
A.eq(W.list().length, 2, 'reload plus rapid +NEW never resurrects duplicate blanks');

/* ---------- project +NEW only coalesces inside the same stored project scope ---------- */
W.reset();
const scoped = W.startSession({ projectRoot: 'C:\\projects\\alpha' });
A.eq(W.list().length, 2, 'entering a project from unscoped General creates one anchored session');
A.eq(scoped.projectRoot, 'C:\\projects\\alpha', 'project session carries its real root');
A.ok(W.startSession({ projectRoot: 'C:\\projects\\alpha' }) === scoped, 'same-project +NEW reuses its untouched blank');
const other = W.startSession({ projectRoot: 'C:\\projects\\beta' });
A.ok(other !== scoped, 'another project cannot steal or re-anchor the existing blank');
A.eq(W.list().length, 3, 'different project scope creates exactly one additional row');

/* ---------- an untouched blank in the rail is reused even when another session is open (org live walk 10-14) ---------- */
// the rail held an untouched 'New session' plus a real conversation; opening the conversation and pressing +NEW minted a
// SECOND empty 'New session' row. +NEW now focuses the blank that is already there.
W.reset();
W.get(W.generalId()).history.push({ role: 'user', content: 'Brief review' });   // the Commander works in General…
const blank = W.startSession();              // …an empty 'New session' sits in the rail…
W.switch(W.generalId());                     // …and General is open again
const before = W.list().length;
const again = W.startSession();
A.ok(again === blank, '+NEW from another session focuses the untouched blank already in the rail');
A.eq(W.activeId(), blank.id, 'and makes it the open session');
A.eq(W.list().length, before, 'no second empty "New session" row is minted');
A.ok(W.list().filter(w => W.isUntouched(w)).length === 1, 'exactly one blank line remains');
// the same untouched test as the starter path: a used, titled or pinned row is never taken over
blank.history.push({ role: 'user', content: 'now it is a real conversation' });
W.switch(W.generalId());
const fresh2 = W.startSession();
A.ok(fresh2 !== blank && W.isUntouched(fresh2), 'once the blank holds a message, +NEW mints a fresh one');
W.switch(W.generalId());
W.pin(fresh2.id, true);
A.ok(W.startSession() !== fresh2, 'a pinned empty session is never taken over');
// scope: an unscoped +NEW never lands in a project-anchored blank, a project +NEW never in an unanchored one
W.reset();
W.get(W.generalId()).history.push({ role: 'user', content: 'hello' });
const anchored = W.startSession({ activate: false, projectRoot: 'C:\\projects\\alpha' });
A.ok(W.startSession() !== anchored, 'the sessions rail +NEW never reuses a project-anchored blank');
const plain = W.active();
W.switch(W.generalId());
A.ok(W.startSession({ activate: false, projectRoot: 'C:\\projects\\alpha' }) === anchored, 'the project +NEW reuses its own anchored blank');
A.eq(W.activeId(), W.generalId(), '…and activate:false leaves the focus to the caller');
A.ok(W.startSession() === plain, 'the unanchored blank is the sessions rail +NEW target');
A.ok(W.startSession({ reuseActive: false }) !== plain, 'reuseActive:false still mints a fresh row');

/* ---------- both shipped +NEW handlers use the coalescing seam ---------- */
const app = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
A.ok(/function newWorkstream\(\)[\s\S]{0,220}Workstreams\.startSession\(/.test(app), 'global +NEW uses Workstreams.startSession');
A.ok(/function newSessionInProject\(root\)[\s\S]{0,260}Workstreams\.startSession\(\{[\s\S]{0,100}projectRoot:\s*root/.test(app), 'project +NEW uses the same scoped coalescing seam');

A.report('session-creation.test');
