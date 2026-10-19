/* node test/dock-focus-seams.test.js — the live walk's (10-14) dock / focus seams, each locked where the Commander meets it:
     #0   a CREW / WORK / BUILD / SYSTEM dock menu opens ABOVE every open station window (it opened behind them, so BUILD
          MODE and SETTINGS were unreachable while any window was open)
     #1   an approval or MY READ card that lands while you follow the exchange stays in view: a press (the composer, the
          send key, Approve once) is not a scroll gesture and never stops the follow; NEEDS YOU › Review lands on the
          approval card, as Answer does on a question
     #16  quick model / effort picks update ONE receipt card instead of stacking one card per press
   The panels' own functions are sliced out of the shipped files and run in a vm over stubs; the live proof (isolated
   station, real mouse input over CDP) is in the lane report. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');

/* ---------- #0: an open dock menu is above every window ---------- */
{
  const style = rd('frontend/css/style.css'), app = rd('frontend/css/app.css'), pip = rd('frontend/css/pipglass.css');
  const nav = rd('frontend/app/navdock.js'), html = rd('frontend/index.html'), ui = rd('frontend/app/stationui.js');
  const zOf = body => { const m = /(?:^|;|\s)z-index:\s*(-?\d+)/.exec(body || ''); return m ? Number(m[1]) : null; };
  const rule = (css, sel) => { const re = new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}'); const m = re.exec(css); return m ? m[1] : null; };
  // the window layer: every window lives in #terms (z 50), a sibling of the dock inside #screen-game
  const termsZ = zOf(rule(style, '#terms'));
  A.eq(termsZ, 50, 'the window layer #terms stacks at z 50 inside #screen-game');
  const iTerms = html.indexOf('<div id="terms">'), iBar = html.indexOf('<footer id="bottombar">'), iGame = html.indexOf('<section id="screen-game"');
  A.ok(iGame >= 0 && iBar > iGame && iTerms > iBar, 'the dock and the window layer are siblings in the one #screen-game stacking context');
  A.ok(/\$\('#terms'\)\.appendChild\(w\)/.test(ui) && /w\.style\.zIndex = U\.zTop\(\)/.test(ui), 'windows mount in #terms and stack by U.zTop() inside it');
  // the cause: the glass deck is its own stacking context, so the menu's z-index 60 can never leave it
  A.ok(/:is\(#left, #chat-panel, #topbar, #bottombar\) \{[^}]*backdrop-filter:\s*blur/.test(pip), 'the glass deck carries a backdrop-filter (a stacking context the menu cannot leave)');
  // the fix: the deck itself rises over the window layer while one of its menus is open, keyed on navdock's own .open
  const up = rule(app, '#screen-game #bottombar:has(.bb-group.open)'), rest = rule(app, '#screen-game #bottombar');
  A.ok(up != null, 'an open dock menu raises the whole deck');
  A.ok(zOf(up) > termsZ, 'the raised deck ranks over every window (' + zOf(up) + ' > ' + termsZ + ')');
  A.ok(rest != null && zOf(rest) < termsZ, 'a closed deck ranks under the windows, which keep resting above it (' + zOf(rest) + ')');
  A.ok(/g\.classList\.toggle\('open', willOpen\)/.test(nav) && /g\.classList\.remove\('open'\)/.test(nav), 'the raise keys on the exact class navdock opens and closes a menu with');
  A.ok(/document\.addEventListener\('click', ev => \{ if \(!bar\.contains\(ev\.target\)\) closeAll\(null\); \}\)/.test(nav), 'a click on a window closes the menu, which drops the deck back');
  // the drop waits out the menu's own close fade, so a closing menu never flashes behind a window
  A.ok(/transition:\s*z-index 0s linear var\(--t-fast/.test(rest || '') && /transition-delay:\s*0s/.test(up || ''), 'the deck rises at once and drops after the menu\'s close fade (--t-fast)');
  A.ok(/#bottombar \.bb-menu \{[^}]*transition: opacity var\(--t-fast\)/.test(rd('frontend/css/glass-demo.css')), '…which is the menu\'s own fade length');
}

/* ---------- #1: a press is not a scroll; Review lands on the approval card ---------- */
{
  const chat = rd('frontend/app/chat.js'), ny = rd('frontend/app/needsyou.js');
  // the whole press filter (its selectors and every helper, from PRESS_SEL up to nearBottom), run as shipped
  const iBlk = chat.indexOf('  const PRESS_SEL = '), jBlk = chat.indexOf('  function nearBottom()');
  A.ok(iBlk > 0 && jBlk > iBlk && jBlk - iBlk < 4000, 'sliced the press filter (' + (jBlk - iBlk) + ' chars)');
  const block = chat.slice(iBlk, jBlk);
  ['function isPress(ev)', 'function logGesture(ev)', 'function logHold(ev)', 'function endLogHold()'].forEach(h => A.ok(block.indexOf(h) >= 0, 'the filter has ' + h));
  const press = /const PRESS_SEL = '[^'\n]*';/.exec(block);
  A.ok(!!press && /button/.test(press[0]) && /input/.test(press[0]) && /textarea/.test(press[0]), 'a press is a press on a control (button, input, textarea, …)');
  const scroll = (/log\.addEventListener\('scroll', \(\) => \{([^]*?)\n      \}\);/.exec(chat) || [])[1];
  A.ok(!!scroll && /const near = nearBottom\(\);/.test(scroll), 'sliced the transcript\'s scroll handler');
  // one transcript: a log, its follow state, a clock the test drives
  function world() {
    const ctx = vm.createContext({ Date: { now: () => ctx.now }, now: 10000 });
    vm.runInContext('let stick = true, userScrollHeld = false, userScrollAt = 0, historyPinPending = 0, pill = 0;\n'
      + 'const log = { scrollTop: 600, scrollHeight: 1400, clientHeight: 500 };\n'
      + 'function nearBottom() { return log.scrollHeight - log.scrollTop - log.clientHeight < 40; }\n'
      + 'function hideNewPill() { pill = 0; } function showNewPill() { pill = 1; }\n'
      + block + '\nfunction onScroll() {' + scroll + '\n}\n'
      + 'this.api = { isPress, logGesture, logHold, endLogHold, onScroll, get stick() { return stick; }, get pill() { return pill; }, get at() { return userScrollAt; }, get held() { return userScrollHeld; }, log };', ctx);
    return ctx;
  }
  const control = { closest: sel => /button/.test(sel) ? {} : null };   // the send key, Approve once, a brief chip
  const text = { closest: () => null };                                 // the transcript's own text / its scrollbar
  {
    // the walk: click the composer (a release OUTSIDE the log), Enter; the reply rows land after the follow's own scroll
    const w = world(), a = w.api;
    a.endLogHold();                                   // window pointerup from the composer / send key click
    A.eq(a.at, 0, 'a release that did not begin on the log stamps no gesture');
    w.now += 300; a.onScroll();                       // the programmatic follow's scroll event, content grew under it
    A.ok(a.stick, 'content landing right after a send keeps the follow (it read as "they scrolled up")');
    A.eq(a.log.scrollTop, a.log.scrollHeight, '…and the transcript is pinned back to its newest line');
    A.eq(a.pill, 0, '…with no NEW MESSAGES pill over it');
  }
  {
    // Approve once (a press on a key inside the log), then the run goes on and new rows land
    const w = world(), a = w.api;
    a.logGesture({ target: control }); a.logHold({ target: control }); a.endLogHold();
    A.ok(!a.held && a.at === 0, 'a press on a key in the log is no hold and no gesture');
    w.now += 200; a.onScroll();
    A.ok(a.stick && a.pill === 0, 'the follow continues after Approve once');
  }
  {
    // a real reading gesture still wins: a scrollbar / text drag that began on the log, released anywhere
    const w = world(), a = w.api;
    a.logGesture({ target: text }); a.logHold({ target: text });
    A.ok(a.held, 'a hold that begins on the log is a reading gesture');
    w.now += 50; a.endLogHold();
    A.ok(!a.held && a.at === w.now, '…its release (anywhere) stamps the gesture');
    w.now += 300; a.onScroll();
    A.ok(!a.stick && a.pill === 1, 'scrolling up to read history still stops the follow and offers the way back');
  }
  {
    // Approve once: the card sheds its keys and shrinks, which moves a follower ~34 px up INSIDE the near band (the working
    // line sat cut off under the fold for the rest of the run) — no gesture, still following: back to the newest line
    const w = world(), a = w.api;
    a.log.scrollTop = a.log.scrollHeight - a.log.clientHeight - 34;
    a.onScroll();
    A.ok(a.stick && a.log.scrollTop === a.log.scrollHeight, 'a follower nudged up inside the near band is put back on the newest line');
    const r = world(), b = r.api;
    b.log.scrollTop = b.log.scrollHeight - b.log.clientHeight - 34;
    b.logGesture({ target: text });   // …but a small wheel / PageUp of the reader's own is left where they put it
    b.onScroll();
    A.eq(b.log.scrollTop, b.log.scrollHeight - b.log.clientHeight - 34, 'a reader\'s own small scroll inside the near band is not undone');
  }
  {
    // a key outside a control (PageUp on the focused log) is a gesture; typing in a field inside the log is not
    const w = world(), a = w.api;
    a.logGesture({ type: 'keydown', key: 'a', target: { closest: sel => /input/.test(sel) ? {} : null } });
    A.eq(a.at, 0, 'typing in the brief card\'s correction field is not a scroll gesture');
    a.logGesture({ type: 'keydown', key: 'PageUp', target: text });
    A.eq(a.at, w.now, 'PageUp / arrows on the log itself are');
  }
  /* (review 10-14) A KEY THAT MOVES THE READER IS A GESTURE WHEREVER FOCUS SITS. With focus left on a message's copy key after
     a click, PageUp / ArrowUp were read as layout moving under a follower and pulled straight back to the bottom: the reader
     could not move and no pill showed. Only a key that ACTS on a control is a press: Enter or Space on a key, or typing and
     caret keys in a field. */
  {
    const key = { closest: sel => /button/.test(sel) ? {} : null };                // button.cmsg-copy, still focused after its click
    const field = { closest: sel => /input/.test(sel) ? {} : null };               // the brief card's correction field
    const stamps = (k, target) => { const w = world(), a = w.api; a.logGesture({ type: 'keydown', key: k, target }); return a.at === w.now; };
    for (const k of ['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'Tab']) A.ok(stamps(k, key), k + ' with focus on a key in the log is a reading gesture');
    for (const k of ['Enter', ' ']) A.ok(!stamps(k, key), JSON.stringify(k) + ' on a key in the log presses it (not a gesture)');
    for (const k of ['PageUp', 'PageDown', 'Tab']) A.ok(stamps(k, field), k + ' in a field inside the log still moves the reader');
    for (const k of ['a', ' ', 'Enter', 'ArrowUp', 'Home', 'End']) A.ok(!stamps(k, field), JSON.stringify(k) + ' in a field types or moves its caret (not a gesture)');
    A.ok(stamps(' ', text), 'Space on the log itself scrolls it');
    // far: PageUp from the bottom with focus on the copy key — the reader stays where the key put them, the pill offers the way back
    const w = world(), a = w.api;
    a.log.scrollTop = a.log.scrollHeight - a.log.clientHeight; a.onScroll();
    A.ok(a.stick && a.pill === 0, '(setup) following at the bottom');
    a.logGesture({ type: 'keydown', key: 'PageUp', target: key });
    a.log.scrollTop -= 450; const far = a.log.scrollTop; a.onScroll();
    A.ok(!a.stick && a.log.scrollTop === far && a.pill === 1, 'PageUp on a focused key scrolls the transcript up and is not pulled back down (' + a.log.scrollTop + ' vs ' + far + ')');
    // near band: one ArrowUp (inside the 40 px band) is the reader's too — not re-pinned
    const r = world(), b = r.api;
    b.log.scrollTop = b.log.scrollHeight - b.log.clientHeight; b.onScroll();
    b.logGesture({ type: 'keydown', key: 'ArrowUp', target: key });
    b.log.scrollTop -= 34; const nudged = b.log.scrollTop; b.onScroll();
    A.eq(b.log.scrollTop, nudged, 'ArrowUp on a focused key inside the near band is left where the reader put it');
  }
  // a server-history repaint after NEEDS YOU › Review finds the approval card again, as it does a question card
  {
    // sliced by its own two-space closing line: a quote inside its regex class sends fnBody long (the _assert.js hazard)
    const sel = (/\n  function revealSelector\(target\) \{\n([\s\S]*?)\n  \}\n/.exec(chat) || [])[1] || '';
    A.ok(sel.length > 20 && sel.length < 600, 'sliced revealSelector (' + sel.length + ' chars)');
    const run = new Function('target', sel);
    const card = attrs => ({ hasAttribute: n => n in attrs, getAttribute: n => attrs[n] });
    A.eq(run(card({ 'data-consent-prompt': 'p7' })), '[data-consent-prompt="p7"]', 'an approval card is found again by its prompt after the repaint');
    A.eq(run(card({ 'data-clarify-prompt': 'q2' })), '[data-clarify-prompt="q2"]', '…as a question card is');
  }
  // the wiring: a window release only ENDS a log hold; presses go through the filter; wheel / touch-drag always count
  A.ok(/\['pointerup', 'pointercancel', 'blur'\]\.forEach\(type => window\.addEventListener\(type, endLogHold, \{ passive: true \}\)\)/.test(chat), 'a release anywhere only ends a hold that began on the log');
  A.ok(/\['touchstart', 'pointerdown', 'keydown'\]\.forEach\(type => log\.addEventListener\(type, logGesture, \{ passive: true \}\)\)/.test(chat) && /log\.addEventListener\('pointerdown', logHold, \{ passive: true \}\)/.test(chat), 'presses on the log go through the press filter');
  A.ok(/\['wheel', 'touchmove'\]\.forEach\(type => log\.addEventListener\(type, \(\) => \{ userScrollAt = Date\.now\(\); \}/.test(chat), 'the wheel and a touch drag always count as reading');
  A.ok(!/window\.addEventListener\(type, \(\) => \{ userScrollHeld = false; userScrollAt = Date\.now\(\); \}/.test(chat), 'no window-wide release stamps a gesture any more');
  // NEEDS YOU › Review lands on the approval card (tagged with its prompt, found by revealAsk)
  A.ok(/r\.d\.dataset\.liveAsk = '1';\s*\n\s*r\.d\.dataset\.consentPrompt = String\(\(p && p\.promptId\) \|\| ''\);/.test(A.fnBody(chat, 'function permissionRow(p, ws)')), 'an approval card carries its prompt id');
  const reveal = A.fnBody(chat, 'function revealAsk(promptId)');
  A.ok(/\[data-clarify-prompt\], \[data-consent-prompt\]/.test(reveal) && /n\.dataset\.clarifyPrompt \|\| n\.dataset\.consentPrompt/.test(reveal), 'revealAsk finds a question card or an approval card by its prompt');
  A.ok(/\(i\.kind === 'question' \|\| i\.kind === 'approval'\) && i\.p && typeof Chat !== 'undefined' && Chat\.revealAsk/.test(A.fnBody(ny, 'function open(i)')), 'NEEDS YOU › Review on an approval reveals its card');
}

/* ---------- #16: one receipt card for quick model / effort picks ---------- */
{
  const ui = rd('frontend/app/stationui.js'), app = rd('frontend/app/app.js'), motion = rd('frontend/css/motion.css');
  const toastSrc = A.fnBody(ui, 'function toast(text, cls, playSound, opts)');
  A.ok(toastSrc.length > 500 && toastSrc.length < 8000, 'sliced toast() (' + toastSrc.length + ' chars)');
  class El {
    constructor(tag) { this.tagName = tag; this.children = []; this.parentNode = null; this.dataset = {}; this.className = ''; this.style = { setProperty() {} }; this._html = ''; this.id = ''; }
    get childElementCount() { return this.children.length; }
    get firstChild() { return this.children[0] || null; }
    get nextSibling() { const p = this.parentNode; if (!p) return null; const i = p.children.indexOf(this); return p.children[i + 1] || null; }
    get isConnected() { return !!this.parentNode; }
    set innerHTML(h) { this._html = h; } get innerHTML() { return this._html; }
    get classList() { const el = this; return { add: c => { if (!el.className.split(' ').includes(c)) el.className += ' ' + c; }, contains: c => el.className.split(' ').includes(c) }; }
    appendChild(c) { if (c.parentNode) c.remove(); c.parentNode = this; this.children.push(c); return c; }
    insertBefore(c, ref) { if (c.parentNode) c.remove(); const i = this.children.indexOf(ref); c.parentNode = this; if (i < 0) this.children.push(c); else this.children.splice(i, 0, c); return c; }
    removeChild(c) { const i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); c.parentNode = null; return c; }
    remove() { if (this.parentNode) this.parentNode.removeChild(this); }
    querySelector() { return null; }
    addEventListener() {}
  }
  const body = new El('body');
  const document = { body, getElementById: id => body.children.find(c => c.id === id) || null, createElement: t => new El(t) };
  const ctx = vm.createContext({ document, Array, String, Object, setTimeout: () => 0, console });
  vm.runInContext('const mkEl = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };\n'
    + 'const esc = s => String(s); const clock = () => "00:00"; const sfx = () => {}; function seatToastRack() {}\n'
    + "const SEV_GLYPH = { good: 'G', info: 'I', warn: 'W', bad: 'B', gold: 'O' }; function severityOf(c) { return c || 'info'; }\n"
    + "function splitToastLabel(t) { const m = /^([A-Z]+): (.*)$/.exec(t); return m ? { label: m[1], body: m[2] } : { label: '', body: t }; }\n"
    + toastSrc + '\nthis.toast = toast;', ctx);
  const stack = () => document.getElementById('toast-stack');
  const pick = v => ctx.toast('REASONING: ' + v, 'good', false, { silent: true, key: 'model-pick' });
  ctx.toast('saved the note', 'good', false);          // an unrelated card already up
  pick('LOW'); pick('MED'); pick('HIGH'); pick('MAX');   // four quick presses
  const cards = stack().children;
  A.eq(cards.length, 2, 'four quick picks leave ONE receipt card (plus the unrelated card), not four');
  const receipt = cards.find(c => c.dataset.toastKey === 'model-pick');
  A.ok(receipt && /MAX/.test(receipt.innerHTML) && !/HIGH/.test(receipt.innerHTML), 'the receipt shows the latest pick');
  A.ok(receipt && receipt.classList.contains('swap'), 'a replaced receipt takes its seat without a second slide-in');
  ctx.toast('another note', 'good', false);
  pick('LOW');
  A.eq(stack().children.map(c => c.dataset.toastKey || 'x'), ['x', 'model-pick', 'x'], 'the updated receipt keeps its seat in the rack (it does not jump past a newer card)');
  A.ok(!stack().children[0].classList.contains('swap'), 'a first card (nothing to replace) still slides in');
  A.ok(/userPick \? \{ silent: true, key: 'model-pick' \} : undefined/.test(A.fnBody(app, 'function applyQuickModel(sel)')), 'model and effort picks share the one receipt key');
  A.ok(/\.toast\.swap:not\(\.leaving\), \.toast\.swap \.toast-lamp \{ animation: none; \}/.test(motion), 'a swapped card skips only the arrival motion (it still leaves with toast-out)');
}

/* ---------- W10 window sweep: a control past its window, and labels below the station's smallest type ---------- */
{
  const app = rd('frontend/css/app.css'), ui = rd('frontend/app/stationui.js'), mp = rd('frontend/app/modelpicker.js');
  const rule = sel => { const m = new RegExp('(?:^|\\n)' + sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\{([^}]*)\\}').exec(app); return m ? m[1] : null; };
  // AGENT DOSSIER › CONFIG › MODEL: the picker's wrap is an inline-flex box, so in a block cell it sized itself to the longest
  // model name (a 418 px select in a 242 px column) and pushed EFFORT out of the window
  A.ok(/<span class="mp-wrap"/.test(A.fnBody(mp, 'function shellHTML(')) || /'<span class="mp-wrap" data-mp="'/.test(mp), 'the picker shell is an inline .mp-wrap');
  A.ok(/display: inline-flex/.test(rule('.mp-wrap') || ''), '…which shrink-wraps its content by default');
  A.ok(/ModelPicker\.shellHTML\(\{ id: 'ag-model-pick'/.test(ui) && /<div class="mc-pick" id="ag-model-pick">/.test(ui), 'the dossier mounts it in the .mc-pick cell');
  const fill = rule('.mc-pick .mp-wrap');
  A.ok(fill && /display: flex/.test(fill) && /width: 100%/.test(fill), 'in that cell the picker takes the cell\'s width, so the selects shrink and EFFORT wraps under MODEL');
  A.ok(/\.mp-model \{ flex: 1 1 200px; min-width: 0; \}/.test(app) && /flex-wrap: wrap/.test(rule('.mp-wrap') || ''), '…(the model select can shrink, the wrap can break)');
  // labels inside a line are set in that line's size (no-shrunken-inline-chips)
  A.ok(/font-size:\s*inherit/.test(rule('.q-outcome') || '') && !/font-size:\s*9px/.test(rule('.q-outcome') || ''), 'QUESTS: the run outcome ("NOTHING PASSED") is set in its line\'s size');
  A.ok(/font-size: var\(--sn-type-meta/.test(rule('.pc-rh') || ''), 'PERMISSIONS: a reach rung\'s house name is at the station\'s smallest type, not 9 px');
  // PERMISSIONS: a collapsed crew row's state clause is one ellipsed line (~40 characters at a window's width). Under the
  // whole-station override it read "whole-station override is ON · returns to FU…" — the one fact it exists for (what the
  // agent returns to) was the part cut off. The posture it returns to leads the clause now; the badge already says FULL POWER.
  const ovr = /const stateLine = overridden\n\s*\? ([^\n]+)\n/.exec(ui);
  A.ok(!!ovr, 'sliced the override branch of the crew row\'s state line');
  const said = new Function('AP', 'return ' + (ovr ? ovr[1] : "''"));
  for (const label of ['CHECK WITH ME', 'LET IT WORK', 'FULL POWER']) {
    const s = said({ label }), end = s.indexOf(label) + label.length;
    A.ok(s.indexOf(label) >= 0 && end <= 32, 'under the override the row names what it returns to inside the visible clause: "' + s + '" (' + label + ' ends at ' + end + ')');
    A.ok(/override/.test(s) && /off/.test(s), '…and still says it waits on the whole-station override');
  }
  A.ok(/returns to its custom mix/.test(said(null)) && said(null).indexOf('custom mix') <= 32, 'a custom mix names that first too: ' + said(null));
}

A.report('dock-focus-seams');
process.exit(A.fails() ? 1 : 0);
