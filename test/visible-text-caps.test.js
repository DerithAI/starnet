'use strict';

/* releases#8 — dossier details and class taglines were cut at their cap with nothing on screen saying so.
   A dossier detail holds Dossier.TEXT_CHARS (280) characters; its editor's maxLength stopped typing and clipped
   a paste at that cap while the AGENT BRIEFING meter ("806 / 1600 chars") read as room left. The one-line
   taglines stop at their 48-character maxlength the same way. This drives the real editor code from
   stationui.js and marketplace.js in a vm with a small fake DOM and pins:
     - both dossier editors cap input at the SAME constant the engine clips with (no drop after save),
     - each editor shows a live "n / 280 chars" count in the briefing meter's face, warning at the cap,
     - each tagline input shows a live "n / 48" count (the summon NAME bar's counter), warning at the cap. */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const A = require('./_assert.js');
const Dossier = require('../frontend/app/dossier.js');

const read = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8');
const slice = (src, from, to) => {
  const s = src.indexOf(from);
  const e = src.indexOf(to, s + from.length);
  A.ok(s >= 0 && e > s, 'can isolate ' + from.trim());
  return src.slice(s, e);
};

// ---- a fake DOM just big enough for the editor code ----
function fakeEl(tag) {
  const cls = new Set();
  const e = {
    tagName: String(tag).toUpperCase(), children: [], parentElement: null, listeners: {}, attrs: {},
    value: '', textContent: '', title: '', placeholder: '', maxLength: -1, spellcheck: true, style: {}, onclick: null,
    classList: {
      toggle(c, on) { if (on === undefined ? !cls.has(c) : on) cls.add(c); else cls.delete(c); },
      contains: c => cls.has(c), add: c => cls.add(c), remove: c => cls.delete(c)
    },
    set className(v) { cls.clear(); String(v).split(/\s+/).filter(Boolean).forEach(c => cls.add(c)); },
    get className() { return [...cls].join(' '); },
    set innerHTML(v) { this.children = []; },
    appendChild(c) { this.children.push(c); c.parentElement = this; return c; },
    replaceChild(n, o) { const i = this.children.indexOf(o); if (i >= 0) this.children[i] = n; n.parentElement = this; return o; },
    insertAdjacentElement(where, n) {
      const p = this.parentElement; const i = p.children.indexOf(this);
      p.children.splice(i + 1, 0, n); n.parentElement = p; return n;
    },
    setAttribute(k, v) { this.attrs[k] = v; },
    addEventListener(t, f) { (this.listeners[t] = this.listeners[t] || []).push(f); },
    fire(t) { (this.listeners[t] || []).forEach(f => f({ target: e })); },
    focus() {}, setSelectionRange() {}, querySelector() { return null; }
  };
  return e;
}
const walk = (n, out = []) => { out.push(n); (n.children || []).forEach(c => walk(c, out)); return out; };
const findCls = (root, c) => walk(root).find(n => n.classList && n.classList.contains(c));
const findTag = (root, t) => walk(root).find(n => n.tagName === t);
const type = (ta, s) => { ta.value = ta.maxLength >= 0 ? s.slice(0, ta.maxLength) : s; ta.fire('input'); };   // the browser's maxlength

// ---- the dossier editors (stationui.js), run for real ----
const SUI = read('frontend/app/stationui.js');
const edSrc = slice(SUI, '  const cdTextMax = ', '\n  // QUEST LOG');
const saved = [];
const ctx = {
  Dossier,
  mkEl: (tag, cls, html) => { const e = fakeEl(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; },
  CDS: () => ({ upsert: (dim, b) => saved.push({ dim, b }) }),
  sfx() {}, rerender() {}
};
const { cdEdit, cdAddRow } = vm.runInNewContext(edSrc + '\n({ cdEdit, cdAddRow });', ctx);
const MAX = Dossier.TEXT_CHARS;
A.eq(MAX, 280, 'the engine cap a detail is held to is still 280 characters');

// + Add detail
const row = cdAddRow('standing_orders');
row.children[0].onclick();
const addTa = findTag(row, 'TEXTAREA');
const addCount = findCls(row, 'cd-count');
A.eq(addTa.maxLength, MAX, 'the add editor caps input at Dossier.TEXT_CHARS — nothing typed can be clipped later by the engine');
A.ok(addCount && addCount.classList.contains('cd-brief-meter'), 'the add editor shows a count in the briefing meter’s own face');
A.ok(addCount.parentElement && addCount.parentElement.classList.contains('cd-acts'), 'the count sits in the Save / Cancel row');
A.eq(addCount.textContent, '0 / 280 chars', 'an empty add editor reads 0 / 280 chars');
A.ok(/up to 280 characters/.test(addCount.title), 'the count’s tip names the per-detail cap');
type(addTa, 'Always ship with tests.');
A.eq(addCount.textContent, '23 / 280 chars', 'the count follows typing');
A.ok(!addCount.classList.contains('warn'), 'no warning under the cap');
type(addTa, 'x'.repeat(400));
A.eq(addTa.value.length, MAX, 'a 400-character paste stops at the cap (the browser maxlength)…');
A.eq(addCount.textContent, '280 / 280 chars', '…and the count says it is full');
A.ok(addCount.classList.contains('warn'), '…in the warning colour, so the stop is never silent');
// a starter chip fills the editor programmatically (no input event) — the count still follows
const chip = findCls(row, 'cd-starter');
chip.onclick();
A.eq(addCount.textContent, addTa.value.length + ' / 280 chars', 'a starter chip refreshes the count');
A.ok(!addCount.classList.contains('warn'), 'and clears the warning');
// opening the add editor from an empty dimension’s inline chip (pre-filled) counts the starter immediately
const row2 = cdAddRow('identity');
row2._open('I’m a ');
A.eq(findCls(row2, 'cd-count').textContent, '6 / 280 chars', 'a pre-filled add editor counts its starter text');

// Save keeps every character the editor allowed
type(addTa, 'y'.repeat(MAX));
walk(row).find(n => n.tagName === 'BUTTON' && n.textContent === 'Save').onclick();
const got = saved[saved.length - 1];
A.eq(got && got.b.text.length, MAX, 'Save hands the full 280 characters to the store');
const d = Dossier.fresh();
Dossier.upsert(d, got.dim, got.b, 1);
A.eq(d.dims.standing_orders[0].text.length, MAX, 'and the engine keeps all of them (no second, silent cut after save)');

// Edit an existing detail
const card = fakeEl('div'), txt = fakeEl('div'), btns = fakeEl('div');
btns.className = 'consent-btns cd-acts';
card.appendChild(txt); card.appendChild(btns);
cdEdit(card, txt, btns, 'goals', { id: 'cd_1', text: 'z'.repeat(100) });
const edTa = findTag(card, 'TEXTAREA');
const edCount = findCls(card, 'cd-count');
A.eq(edTa.maxLength, MAX, 'the inline editor caps input at Dossier.TEXT_CHARS');
A.eq(edCount && edCount.textContent, '100 / 280 chars', 'the inline editor counts the existing detail');
type(edTa, 'z'.repeat(300));
A.ok(edCount.classList.contains('warn') && edCount.textContent === '280 / 280 chars', 'the inline editor warns at the cap');

// the warn colour exists and the source no longer hard-codes the cap beside the engine’s constant
const ACSS = read('frontend/css/app.css');
A.ok(/\.cd-count\.warn \{ color: var\(--warn\); \}/.test(ACSS), 'the count turns --warn at the cap');
A.ok(!/ta\.maxLength = 280/.test(SUI), 'no dossier editor hard-codes 280 beside Dossier.TEXT_CHARS');

// ---- the tagline inputs (marketplace.js), run for real ----
const MKT = read('frontend/app/marketplace.js');
const tagSrc = slice(MKT, '  function wireTaglineCount(stage) {', '\n  /* ---------- save / edit a specialty');
const wireTaglineCount = vm.runInNewContext(tagSrc + '\nwireTaglineCount;', { document: { createElement: fakeEl } });
A.ok(/wireTaglineCount\(stage\);\n\s+return;/.test(MKT), 'every form render wires the tagline count');
for (const id of ['mkt-r-tag', 'mkt-f-tag', 'mkt-b-tag']) {
  const m = new RegExp('id="' + id + '" maxlength="(\\d+)"').exec(MKT);
  A.ok(m, id + ' still renders with a maxlength');
  const label = fakeEl('label'), input = fakeEl('input');
  input.id = id; input.maxLength = +(m && m[1]); input.value = 'Plans trips';
  label.appendChild(input);
  wireTaglineCount({ querySelectorAll: sel => (sel.split(/,\s*/).includes('#' + id) ? [input] : []) });
  const count = findCls(label, 'mkt-name-count');
  A.ok(count && count.parentElement.classList.contains('mkt-name-meta'), id + ': a count in the summon NAME bar’s counter face sits under the input');
  A.eq(count.textContent, '11 / ' + input.maxLength, id + ': the count reads the seeded value against the real maxlength');
  type(input, 'w'.repeat(80));
  A.eq(count.textContent, input.maxLength + ' / ' + input.maxLength, id + ': a long paste stops at the cap and the count says so');
  A.ok(count.classList.contains('over'), id + ': in the warning colour');
}
A.ok(/\.mkt-name-count\.over \{ ?color: ?var\(--warn/.test(read('frontend/css/marketplace.css')), 'the tagline count reuses the existing over → warn colour');

A.report('visible-text-caps.test');
