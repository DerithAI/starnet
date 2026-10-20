/* STARNET — typefloor.js : the station windows' text floor.

   WHY (Andrew 10-19: "make sure the text isnt too small everywhere", then "give the windows the same text floor and
   spacing too"): measured across every station window and each of its rail sections at his settings, 3,179 pieces of
   text sat under the floor, down to 9 screen px, set by 223 different rules — badge and chip classes, hard-set px in
   the windows' own CSS, inline styles, and generic classes (.dim, .mc-hint, `p > b`) that are 12px in one window and
   18px in the next. Raising the reading tokens (readability.css, raised on #terms in pipglass.css) lifts only the roles
   that use them; a stylesheet cannot "raise only what is smaller" without shrinking the instances that are already
   larger, and a list of 223 selectors would miss the next window and every plugin window.

   HOW: the floor is MEASURED, not guessed. Each time a window's content is built or rebuilt, every element that paints
   its own words is read once; one whose computed size is under the floor (the --sn-type-meta token in force there) is
   marked `data-sn-floor`, and pipglass.css sets a marked element to that token. Text already at or over the floor is
   never touched, so nothing is ever made smaller. An icon glyph (✕ ▸ ● ★ — no letter or digit), anything aria-hidden,
   and non-text fields (checkboxes, sliders) keep their own metrics. All reads happen before any write, so a pass is
   one style recalculation; a MutationObserver callback runs before the next paint, so text never flashes small.
   SPACING, the dashboard's too: a caps label at the floor's size is marked `data-sn-caps="label"` (tracked 1.6, the
   dashboard's caps labels) and a caps key — a button, a link, a summary, a pill or chip — `data-sn-caps="key"` (tracked .9,
   the dashboard's keys); a larger caps title keeps its own wide tracking.

   UMD: a `TypeFloor` global in the browser; module.exports under node so the rule is testable. */
'use strict';
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { root.TypeFloor = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const ATTR = 'data-sn-floor', CAPS = 'data-sn-caps';
  const KEYISH = /^(BUTTON|A|SUMMARY|SELECT)$/, KEY_CLASS = /(^|[\s-])(pill|chip|badge|tag|key|btn|bb)([\s-]|$)/;
  const WORDS = /[A-Za-z0-9]/;                                   // an icon glyph alone keeps its own size
  const TEXT_FIELD = /^(|text|search|email|url|number|password|tel)$/;
  const SKIP_TAG = /^(SCRIPT|STYLE|SVG|svg|CANVAS|IMG|VIDEO|IFRAME)$/;

  // does this element paint words of its own (not only its children's)?
  function ownsWords(el) {
    const tag = el.tagName || '';
    if (SKIP_TAG.test(tag)) return false;
    if (tag === 'INPUT') return TEXT_FIELD.test(String(el.getAttribute('type') || '').toLowerCase());
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    for (const c of el.childNodes || []) if (c.nodeType === 3 && WORDS.test(c.textContent || '')) return true;
    return false;
  }
  const hidden = el => !!(el.closest && el.closest('[aria-hidden="true"]'));

  /* every candidate in a subtree: the elements that paint words of their own and have not been read yet */
  function collect(root, into) {
    if (!root || typeof root.querySelectorAll !== 'function') return into;
    for (const el of [root].concat(Array.from(root.querySelectorAll('*')))) {
      if (!el || el.nodeType !== 1 || into.has(el) || (el.hasAttribute(ATTR) && el.hasAttribute(CAPS)) || !ownsWords(el) || hidden(el)) continue;
      into.add(el);
    }
    return into;
  }
  /* read every candidate's size, THEN mark the ones under the floor (all reads before any write, so a batch costs one
     style recalculation however many elements it holds) */
  function measure(els, w) {
    const lift = [], caps = [];
    for (const el of els) {
      const lifted = el.hasAttribute(ATTR);
      const cs = w.getComputedStyle(el);
      const size = parseFloat(cs.fontSize), floor = parseFloat(cs.getPropertyValue('--sn-type-meta'));
      if (!(size > 0 && floor > 0)) continue;
      if (!lifted && size < floor - 0.01) lift.push(el);
      // a caps label or key at the floor's size takes the dashboard's tracking (a bigger caps title keeps its own)
      if (!el.hasAttribute(CAPS) && cs.textTransform === 'uppercase' && Math.max(size, floor) <= floor + 0.5) {
        caps.push([el, KEYISH.test(el.tagName) || el.getAttribute('role') === 'button' || KEY_CLASS.test(String(el.className || '')) ? 'key' : 'label']);
      }
    }
    for (const el of lift) el.setAttribute(ATTR, '');
    for (const [el, kind] of caps) el.setAttribute(CAPS, kind);
    return lift.length;
  }
  const viewOf = v => v || (typeof window !== 'undefined' ? window : null);
  // one pass over a subtree
  function pass(root, view) {
    const w = viewOf(view);
    if (!root || !w || typeof w.getComputedStyle !== 'function' || typeof root.querySelectorAll !== 'function') return 0;
    return measure(collect(root, new Set()), w);
  }

  /* keep a host's content on the floor: a pass now, then one batch per burst of changes — whatever was added (a section
     switch, a list repaint, a card that opens) is read; a LIFTED text whose class changed is read again without its marks,
     so a state that grows it (a selected row at its larger size) is never held at the floor. A re-classed element that was
     never lifted is not read (a search re-classes hundreds of cards per keystroke; reading each subtree on its own forced
     a recalculation per card and doubled the keystroke's cost). */
  function watch(host, view) {
    const w = viewOf(view);
    if (!host || !w || typeof w.MutationObserver !== 'function') return null;
    pass(host, w);
    const mo = new w.MutationObserver(records => {
      const els = new Set(), again = [];
      for (const r of records) {
        if (r.type === 'childList') {
          for (const n of r.addedNodes) {
            if (n.nodeType === 1) { if (n.isConnected !== false) collect(n, els); }
            else if (n.nodeType === 3 && r.target.nodeType === 1 && ownsWords(r.target) && !hidden(r.target)) els.add(r.target);
          }
        } else if (r.type === 'attributes' && r.target.nodeType === 1 && (r.target.hasAttribute(ATTR) || r.target.hasAttribute(CAPS))) again.push(r.target);
      }
      for (const t of again) { t.removeAttribute(ATTR); t.removeAttribute(CAPS); els.add(t); }
      if (els.size) measure(els, w);
    });
    mo.observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
    return mo;
  }

  // Self-start in the browser: the station windows mount into #terms, which is in the page from the start
  if (typeof document !== 'undefined') {
    const start = () => { const host = document.getElementById('terms'); if (host) watch(host); };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  return { pass, watch, ownsWords, ATTR, CAPS };
});
