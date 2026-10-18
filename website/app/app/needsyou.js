'use strict';
/* NEEDS YOU — every thing on the station waiting on the Commander, in ONE list at the top of SESSIONS (2026-10-11: all
   nine blind usability testers, on every design, asked for exactly this: approvals and failures from every conversation
   in one place, each with its action right there, saying exactly what will happen and how long it has waited).

   TRUTHFUL TELEMETRY: every item is state this page can prove, read live each render — nothing is stored or guessed.
   - an approval or question: Channels.allPending() (the asking run's own permission.prompt; a delegated worker's ask
     names the worker — sidecar attributeAsks);
   - a group chat waiting on you: GroupChat.attentionIds();
   - delegated work that failed, or was stopped by a restart or the liveness check: the overseer's worker ledger (/api/overseer), for a
     conversation this page holds, until you open it or dismiss it;
   - a routine run that failed and you have not looked at: its own cron-<runId> session (lastRunOk === false, unread);
   - (org P01) every other wait that BLOCKS on the Commander, each from its own live source, never the bell's stored entries:
     an agent waiting at STEP-IN (StepIn.live — the sidecar's handoff records), extensions awaiting approval (GET /api/hooks +
     /api/plugins, re-read every minute), builds that need a keep/discard decision (GET /api/workshop/pending via
     WorkshopStore.pendingAll — DELIVERABLES' NEEDS A DECISION), a quest an agent says is done (QuestLedgerStore.pendingAttests),
     and goal-loop results waiting on review (LoopsReview.waiting — the loops watcher's own GET /api/loops). TO REVIEW (an
     optional rating pile) and PROPOSALS (optional, in QUESTS) are not waits and are never listed.
   - (org P01) a wait with NO live source — above all a background conversation whose finished reply asked you a question
     ("NOVA has a question for you", chat.js) — is the station's own stored wait (StationUI.storedWaits: unsettled, and not
     one a live source above already shows). It is a row here until it settles the way the bell entry always did (its
     conversation is opened — StationUI.seenSession — or its run's waits end), never a second row beside a live ask in the
     same conversation.
   NOTIFICATIONS › NEEDS YOU renders this SAME list (StationUI buildNotifs), so its count, Dismiss and OPEN match the rail.
   Actions are the real ones: Approve / Deny answer through the approval card's own path (Chat.answerConsent) — Approve
   only when the rail's line is the whole request, else Review opens the card that shows all of it (a direct-chat ask
   offers Review beside Approve once too, org P02) — Retry runs the
   routine again (POST /api/cron/run), Open lands on the conversation (a worker's work unfolded on its card). */
const NeedsYou = (() => {
  const DAY = 86400000;
  const KEEP_FAILED_MS = 3 * DAY;      // a failure older than this is history, not a to-do
  const SHOW = 3;                       // rows before "N more"
  const DISMISS_KEY = 'skynet.needs-dismissed';
  let expanded = false, wired = false, lastShape = '';
  // (org P01) the waits whose source is a sidecar read, not page state: re-read at most once a minute (and at once after a
  // decision here), so each row is the station's last answer. null = never answered yet: say nothing rather than guess.
  const FEED_MS = 60000;
  let feeds = { builds: null, extensions: null }, feedsAt = 0, feedsLoading = null, feedsAgain = null;
  const answering = new Set();          // promptIds whose answer is on its way: their keys stay disabled through re-renders
  let parked = null;                    // { act, cls, key } of a focused key that went disabled: focus returns when it can
  const has = (o, k) => typeof o !== 'undefined' && o && typeof o[k] === 'function';
  const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // a dismissal is a per-viewer convenience (which failures you have already seen), never station state
  function dismissed() {
    try { const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || '[]'); return new Set(Array.isArray(v) ? v : []); } catch (_) { return new Set(); }
  }
  function dismiss(key) {
    try { const s = dismissed(); s.add(key); localStorage.setItem(DISMISS_KEY, JSON.stringify([...s].slice(-300))); } catch (_) { /* storage blocked: the item stays, never lost */ }
  }
  function nameOf(id) { return (has(App, 'agentName') && App.agentName(id)) || id || 'an agent'; }
  // the rail names an agent in its own colour, as its session rows and CREW card do
  function colorOf(id) {
    if (!id || !has(App, 'agents')) return '';
    try { const a = (App.agents() || []).find(x => x && x.id === id); return (a && a.color) || ''; } catch (_) { return ''; }
  }
  // the SESSIONS rail's agent line (App.railAgentLine: HTML its own U.esc escaped) as words, for the bell, NOTIFICATIONS and
  // the tips: its "+N" is a span of its own, so it gets its space back ("ULTRON, CYPHER +3")
  const ENT = { lt: '<', gt: '>', quot: '"', '#39': "'", amp: '&' };
  const textOfLine = h => String(h).replace(/<span class="ws-agent-more">/g, ' ').replace(/<[^>]*>/g, '').replace(/&(lt|gt|quot|#39|amp);/g, (m, e) => ENT[e]);
  function titleOf(ws) { return (ws && (ws.title || (typeof Workstreams !== 'undefined' && Workstreams.generalId && ws.id === Workstreams.generalId() ? 'General' : ''))) || 'a conversation'; }
  function questionOf(p) {
    try { const j = JSON.parse(p.argsSummary || '{}'); if (j && typeof j.question === 'string' && j.question.trim()) return j.question.trim(); } catch (_) { /* a plain-text ask */ }
    return String(p.argsSummary || 'a question').trim();
  }
  // why a worker ended, in the card's own words (Delegated words them once): a stale worker was cut off by a restart or
  // stopped by the liveness check; a failed one says why in plain words, never the ledger's internal code
  function reasonOf(w) {
    const D = typeof Delegated !== 'undefined' ? Delegated : null;
    if (w.status === 'stale') return D && D.staleLine ? D.staleLine(w) : 'stopped';
    const why = w.reason && w.reason !== 'error' && D && D.whyOf ? D.whyOf(w.reason) : '';
    return 'failed' + (why ? ': ' + why : '');
  }

  /* (org P01) THE OTHER BLOCKING WAITS — each read live from its own source, each keeping its existing action words:
     STEP-IN → Open (its window, on that handoff) · extensions → Open (ABILITIES › EXTENSIONS) · a build → Open (its own
     session, where its keep/discard card is; DELIVERABLES › NEEDS A DECISION only when that session cannot be had) · a quest
     an agent says is done → Confirm / Not yet · goal-loop results → Open (GOAL LOOPS).
     A background worker's ask is already an approval row through Channels: it is never added twice. */
  const WAIT_KINDS = new Set(['approval', 'question', 'group', 'stepin', 'attest', 'extension', 'build', 'loop', 'asked']);
  // (a stored wait — 'asked' — blocks no running conversation: it sorts with the station's other waits, never above an ask)
  const WAIT_RANK = { approval: 0, question: 0, group: 0, stepin: 1, attest: 2, build: 2, loop: 2, extension: 2, asked: 2 };
  const STEPIN_WHY = { login: 'sign in', '2fa': 'enter a sign-in code', captcha: 'get past a human check', payment: 'confirm a payment', other: 'help with a page' };
  const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);
  function blockingWaits(out, now) {
    if (typeof StepIn !== 'undefined' && StepIn.live) {
      for (const h of StepIn.live()) {
        if (!h || !h.id) continue;
        out.push({ key: 'stepin:' + h.id, kind: 'stepin', handoffId: String(h.id), who: nameOf(h.agentId), aid: h.agentId,
          what: 'needs you to ' + (STEPIN_WHY[h.reason] || STEPIN_WHY.other) + (h.where ? ' at ' + h.where : ''), where: 'STEP-IN', since: Number(h.requestedAt) || 0 });
      }
    }
    if (typeof QuestLedgerStore !== 'undefined' && QuestLedgerStore.pendingAttests) {
      for (const q of QuestLedgerStore.pendingAttests()) {
        if (!q || !q.id || !q.attest) continue;
        out.push({ key: 'attest:' + q.id + '@' + (Number(q.attest.at) || 0), kind: 'attest', questId: String(q.id), who: nameOf(q.attest.agentId || 'agent'), aid: q.attest.agentId || 'agent',
          what: 'says "' + String(q.title || 'a quest') + '" is done', tip: String(q.attest.evidence || ''), where: 'QUESTS', since: Number(q.attest.at) || 0 });
      }
    }
    if (typeof LoopsReview !== 'undefined' && LoopsReview.waiting) {
      for (const l of LoopsReview.waiting()) {
        if (!l || !l.id || !(l.count > 0)) continue;
        out.push({ key: 'loop:' + l.id, kind: 'loop', who: nameOf(l.agentId || 'agent'), aid: l.agentId || 'agent',
          what: 'has ' + plural(l.count, 'result', 'results') + ' waiting on your review from "' + String(l.name || 'a goal loop') + '"', where: 'GOAL LOOPS', since: Number(l.since) || 0 });
      }
    }
    refreshFeeds(false, now);
    // no time: the sidecar's pending lists carry none, so the row shows no age rather than a guessed one
    if (feeds.extensions > 0) out.push({ key: 'extensions', kind: 'extension', who: 'STATION', what: 'has ' + plural(feeds.extensions, 'extension', 'extensions') + ' awaiting your approval', where: 'EXTENSIONS', since: 0 });
    for (const m of (feeds.builds || [])) {
      out.push({ key: 'build:' + m.runId, kind: 'build', build: m, who: nameOf(m.agentId), aid: m.agentId, what: 'built "' + String(m.title || 'a build') + '": keep or discard it',
        rail: { verb: 'keep or discard', text: String(m.title || 'a build') }, where: buildPlace(m), since: Number(m.builtAt) || 0 });
    }
  }
  /* where a build's row goes, named as the place it lands (Andrew 10-15: "where you are ACTUALLY needed"): its own session,
     by the name the SESSIONS rail shows (the session's title once it exists, else the one WorkshopStore gives it on the
     click). DELIVERABLES only when openDoor will fall back to it: no WorkshopStore to adopt the session, or the Commander
     deleted it (adopt refuses the tombstone). Read only: the session is adopted by the click, never by a render. */
  function buildPlace(m) {
    const W = typeof WorkshopStore !== 'undefined' ? WorkshopStore : null;
    if (!W || typeof W.ensureSession !== 'function' || !has(App, 'openWorkstream')) return 'DELIVERABLES';
    const sid = W.sessionIdOf ? W.sessionIdOf(m.runId) : 'workshop-' + m.runId;
    if (Workstreams.isDeleted && Workstreams.isDeleted(sid)) return 'DELIVERABLES';
    const ws = Workstreams.get ? Workstreams.get(sid) : null;
    if (ws) return titleOf(ws);
    return W.sessionTitleOf ? W.sessionTitleOf(m) : String(m.title || 'a build');
  }
  /* (org P01) THE STORED WAITS — what the station filed as waiting on you with no live source behind it (a finished reply's
     question, chat.js 'needs:<conversation>'). Read from the station's own record (StationUI.storedWaits), one row each, in
     the station's own words: "<who> has a question for you — <conversation>" shows who, then the line, with the
     conversation as its "in <where>" door. A conversation a live ask or group row already lists is that row (opening it
     lands there and settles this too), never a second row. Opening its conversation settles it (StationUI.seenSession),
     from here or from anywhere. One with no conversation to open (none was named, or it was deleted since) has no door:
     its "in NOTIFICATIONS" shows where it was filed, and Dismiss settles it, as its bell row's ✕ cleared it. (Every stored
     wait that names a window — STEP-IN, EXTENSIONS, GOAL LOOPS — is a live row above, never one of these.) */
  const SESSION_ASKS = new Set(['approval', 'question', 'group']);
  function storedRows(out) {
    if (typeof StationUI === 'undefined' || !StationUI || typeof StationUI.storedWaits !== 'function') return;
    const covered = new Set(out.filter(i => i.wsId && SESSION_ASKS.has(i.kind)).map(i => String(i.wsId)));
    for (const n of StationUI.storedWaits() || []) {
      if (!n || !n.id) continue;
      const goWs = n.go && n.go.ws ? String(n.go.ws) : '';
      if (goWs && covered.has(goWs)) continue;
      const ws = goWs ? Workstreams.get(goWs) : null;
      let what = String(n.txt || '').trim(), who = '', aid = '';
      if (ws) {
        // chat.js wrote whoOf(ws) + the line + sessionNote(ws): who and where show on their own, so the line is said once
        const name = nameOf(ws.agentId || 'agent');
        if (name && what.indexOf(name + ' ') === 0) { who = name; what = what.slice(name.length + 1); }
        aid = ws.agentId || 'agent';
        const t = String(ws.title || '').trim(), note = t ? ' — ' + (t.length > 56 ? t.slice(0, 53) + '…' : t) : '';
        if (note && what.length > note.length && what.slice(-note.length) === note) what = what.slice(0, -note.length);
      }
      out.push({ key: 'asked:' + n.id, kind: 'asked', storedId: String(n.id), wsId: ws ? ws.id : '', noDoor: !ws,
        who, aid, what: what || 'is waiting on you', where: ws ? titleOf(ws) : 'NOTIFICATIONS', since: Number(n.t) || 0 });
    }
  }
  const settleStored = i => !!(i && i.kind === 'asked' && typeof StationUI !== 'undefined' && StationUI.settleStoredWait && StationUI.settleStoredWait(i.storedId));
  // re-read the sidecar-backed waits (builds, extensions) when a minute has passed, or now (force). A failed read keeps the
  // last answer: an unreachable station is not "nothing waiting". A forced re-read asked for while a read is already on its
  // way (a keep/discard made while opening the build row started one) is never dropped: that read may have left before the
  // decision, so one more read follows it and its answer is the one the row shows.
  function refreshFeeds(force, now) {
    if (typeof fetch !== 'function') return null;
    if (feedsLoading) {
      if (!force) return feedsLoading;
      if (!feedsAgain) feedsAgain = feedsLoading.then(() => { feedsAgain = null; return refreshFeeds(true); });
      return feedsAgain;
    }
    now = Number(now) || Date.now();
    if (!force && feedsAt && now - feedsAt < FEED_MS) return null;
    if (typeof document !== 'undefined' && document && document.hidden && !force) return null;
    feedsAt = now;
    const json = url => fetch(url, { cache: 'no-store' }).then(r => r.ok ? r.json() : null).catch(() => null);
    const builds = typeof WorkshopStore !== 'undefined' && WorkshopStore.pendingAll ? WorkshopStore.pendingAll().catch(() => null) : Promise.resolve(null);
    feedsLoading = Promise.all([builds, json('/api/hooks'), json('/api/plugins')]).then(([b, h, p]) => {
      const before = JSON.stringify(feeds);
      if (Array.isArray(b) && (typeof WorkshopStore === 'undefined' || !WorkshopStore.pendingAllOk || WorkshopStore.pendingAllOk())) feeds.builds = b.filter(m => m && m.runId);
      if (h && p && Array.isArray(h.pending || []) && Array.isArray(p.plugins)) feeds.extensions = (h.pending || []).length + p.plugins.filter(x => x && x.pending).length;
      if (JSON.stringify(feeds) !== before) { lastShape = ''; render(); if (typeof StationUI !== 'undefined' && StationUI.badges) StationUI.badges(); }
    }).then(() => { feedsLoading = null; }, () => { feedsLoading = null; });
    return feedsLoading;
  }

  // the live list, most urgent first: asks (oldest waiting first), then what failed (newest first)
  function items(now) {
    now = Number(now) || Date.now();
    const out = [];
    if (typeof Workstreams === 'undefined') return out;
    const gone = dismissed();
    if (typeof Channels !== 'undefined' && Channels.allPending) {
      for (const { wsId, p } of Channels.allPending()) {
        const ws = Workstreams.get(wsId); if (!ws || !p || !p.promptId) continue;
        const question = p.tool === 'brief.ask';
        out.push({ key: 'ask:' + p.promptId, kind: question ? 'question' : 'approval', wsId, workerWsId: p.workerStreamId || '',
          who: nameOf(p.workerAgentId || ws.agentId || p.agentId), aid: p.workerAgentId || ws.agentId || p.agentId, what: question ? questionOf(p) : (typeof Chat !== 'undefined' && Chat.consentPhrase ? Chat.consentPhrase(p) : String(p.tool || '')),
          where: titleOf(ws), since: Number(p.askedAt) || 0, p });
      }
    }
    if (typeof GroupChat !== 'undefined' && GroupChat.attentionIds) {
      for (const id of GroupChat.attentionIds()) {
        const ws = Workstreams.get(id); if (!ws) continue;
        const st = GroupChat.stateOf ? GroupChat.stateOf(id) : null;
        // a group is told by its members' names, the SESSIONS rail's own line ("ULTRON, CYPHER +3"; Andrew 10-13: never a
        // GROUP label), and its portrait is the first of them (the lead, when the lead is a member, as that line orders them)
        const line = has(App, 'railAgentLine') ? String(App.railAgentLine(ws) || '') : '';
        const members = (GroupChat.membersOf && GroupChat.membersOf(id)) || [];
        const aid = !members.length || members.includes(ws.agentId) ? ws.agentId : members[0];
        out.push({ key: 'group:' + id, kind: 'group', wsId: id, who: line ? textOfLine(line) : nameOf(aid), whoHtml: line, aid,
          what: st && st.approvals ? 'has an approval waiting' : 'has a question waiting', where: titleOf(ws), since: 0 });
      }
    }
    storedRows(out);   // after the live asks: a conversation they already list is never a second row
    const ov = typeof Overseer !== 'undefined' && Overseer.snapshot ? Overseer.snapshot() : null;
    for (const w of ((ov && ov.workers) || [])) {
      if (!w || !['error', 'refused', 'stale'].includes(w.status) || !w.parentStreamId) continue;
      const parent = Workstreams.get(w.parentStreamId); if (!parent) continue;
      const at = Number(w.completedAt) || Number(w.startedAt) || 0, key = 'worker:' + w.runId;
      if (gone.has(key) || (at && now - at > KEEP_FAILED_MS)) continue;
      const tip = typeof Delegated !== 'undefined' && Delegated.tipOf ? Delegated.tipOf(w) : '';   // the sidecar's own sentence, on hover
      out.push({ key, kind: 'failed', wsId: parent.id, workerWsId: w.streamId || '', who: nameOf(w.agentId), aid: w.agentId, what: reasonOf(w), tip, where: titleOf(parent), since: at });
    }
    for (const ws of Workstreams.list()) {
      if (!/^cron-/.test(String(ws.id)) || ws.lastRunOk !== false || !(Workstreams.unread && Workstreams.unread(ws))) continue;
      const name = (ws.automation && ws.automation.name) || ws.title || 'routine';
      out.push({ key: 'routine:' + ws.id, kind: 'routine', wsId: ws.id, who: nameOf(ws.agentId), aid: ws.agentId, what: 'routine "' + name + '" failed', routineName: name,
        where: 'ROUTINES', since: Number(ws.lastActiveAt) || 0, routineId: (ws.automation && ws.automation.id) || '' });
    }
    blockingWaits(out, now);
    // the asks a running conversation is stopped on (they auto-deny on a timer) lead, oldest first as ever (a group with no
    // age first); then an agent held at STEP-IN; then the station's other waits (a quest said done, a build, loop results,
    // extensions), oldest first with an untimed one last — an extension with no time never jumps the approval in your chat
    const rank = i => WAIT_RANK[i.kind] || 0;
    const asks = out.filter(i => WAIT_KINDS.has(i.kind)).sort((a, b) => (rank(a) - rank(b))
      || (rank(a) === 0 ? (a.since || 0) - (b.since || 0) : (!a.since - !b.since) || (a.since || 0) - (b.since || 0)));
    const fails = out.filter(i => i.kind === 'failed' || i.kind === 'routine').sort((a, b) => (b.since || 0) - (a.since || 0));
    return asks.concat(fails);
  }
  function age(ms, now) {
    if (!ms) return '';
    const s = Math.max(0, Math.round(((Number(now) || Date.now()) - ms) / 1000));
    return s < 60 ? 'now' : s < 3600 ? Math.floor(s / 60) + 'm' : s < DAY / 1000 ? Math.floor(s / 3600) + 'h' : Math.floor(s / 86400) + 'd';
  }
  const KIND = { approval: 'wants to', question: 'asks', group: '', failed: '', routine: '' };
  // the rail shows one glance line. Approve from here only when that line IS the whole request; when the approval card
  // holds more (INSPECT: a long command's tail, a file change, every argument; a station ask's own sentence: a build's
  // plan, the job a line runs, what its runs spend, that it runs unattended), Review lands on that card instead. Deny
  // stays one tap: refusing without the detail is safe. (Whether the rail shows that line whole is measured: below.)
  function hiddenDetail(p) {
    if (/^station[._]/.test(String((p && p.tool) || ''))) return true;
    if (typeof Chat === 'undefined' || !Chat.consentInspect || !Chat.consentPhrase) return true;   // no way to tell: never approve blind
    return !!Chat.consentInspect(p);
  }
  /* WHOLE ON THE RAIL, MEASURED, NEVER COUNTED (polish fix round 10-15). The line is .ny-what, clamped to two lines
     (pipglass.css) in a column that moves with the rail (168/200/232px defaults, a dragged seam) while its type moves
     with TEXT SIZE (a body zoom, 90% to 150%, that the counter-zoomed rail does not follow). No character count holds
     across those: 48 let a 40-character ask be cut to "…", and 23 still cut "wants to use fs rm: a" at 145% while it
     hid Approve once from a 28-character line that sat whole on a 232px rail at 100%. So the rail reads the box it drew,
     chat.js fitWhole's own test: the line is whole when the clamped box holds all of it. Every render and every 1s
     heartbeat re-reads it (a TEXT SIZE change or a dragged rail moves no list state), and the click reads it again.
     Until a row's line has been read whole — and for one that cannot be read (hidden, not laid out) — it offers Review. */
  const wholeLines = new Set();          // fitId of each approval row last read showing its whole line
  const fitId = i => i.key + '\u0001' + i.what;
  function shownWhole(li) {
    const box = li && typeof li.querySelector === 'function' ? li.querySelector('.ny-what') : null;
    return !!box && box.clientHeight > 0 && box.clientWidth > 0
      && box.scrollHeight <= box.clientHeight + 2 && box.scrollWidth <= box.clientWidth + 2;
  }
  // read every approval row the rail shows; true when an answer moved (that row's keys follow). A row fitRows folded into
  // "N more" shows nothing to read or press: it keeps its last reading, and is read afresh the moment it shows again (the
  // heartbeat fits before it reads; an expand redraws, then reads). Reading it as "not whole" flipped its keys, which
  // changed its height, which unfolded it, which read it whole again: the panel rebuilt twice a second at a fold boundary.
  function measure(host, list) {
    const asks = new Map(list.filter(i => i.kind === 'approval').map(i => [i.key, i]));
    const whole = new Set();
    if (asks.size) {
      for (const li of host.querySelectorAll('li.ny-item[data-ny-key]')) {
        const i = asks.get(li.dataset && li.dataset.nyKey);
        if (!i) continue;
        if (li.hidden) { if (wholeLines.has(fitId(i))) whole.add(fitId(i)); continue; }
        if (shownWhole(li)) whole.add(fitId(i));
      }
    }
    if (whole.size === wholeLines.size && [...whole].every(id => wholeLines.has(id))) return false;
    wholeLines.clear(); whole.forEach(id => wholeLines.add(id));
    return true;
  }
  const railApproves = i => !hiddenDetail(i.p) && wholeLines.has(fitId(i));
  /* (org P02; g3 D1, final round) a direct-chat ask the rail can approve is REVIEWED through the row itself: the row, its
     "in <where>" door and its ask line land on the COMMS card (the whole request, and its Always / Full access keys, which the
     rail never grants). Three keys never fit the rail on one row at a readable size — they stacked into three full-width
     keys — so its keys are Approve once · Deny, side by side. A worker's ask (background ones too) reviews on its Delegated
     row's INSPECT instead. */
  const reviewRow = i => !!(i && i.kind === 'approval' && railApproves(i) && !(i.p && (i.p.workerStreamId || i.p.workerRunId || i.p.background === true)));
  const REVIEW_TIP = 'Review it on its card: the whole request, and its Always and Full access keys';
  function keysFor(i) {
    const k = (act, label, cls, off) => '<button type="button" class="ny-key' + (cls ? ' ' + cls : '') + '" data-ny-act="' + act + '" data-ny-key="' + esc(i.key) + '"' + (off ? ' disabled' : '') + '>' + label + '</button>';
    const sending = !!(i.p && answering.has(String(i.p.promptId))) || answering.has(i.key);
    if (i.kind === 'approval') {
      if (!railApproves(i)) return k('open', 'Review', 'primary') + k('deny', 'Deny', 'deny', sending);
      // (a direct-chat ask's Review is its row's own open action: reviewRow above)
      return k('once', 'Approve once', 'primary', sending) + k('deny', 'Deny', 'deny', sending);
    }
    // (Andrew 10-15) THE ROW IS THE DOOR, as a session row is: a click anywhere on it opens where the wait is, so a wait
    // whose only action was Open has no key at all. Keys stay only for what is NOT opening: answer, retry, dismiss.
    if (i.kind === 'question') return k('open', 'Answer', 'primary');
    // a quest an agent says is done: the QUESTS card's own verdict keys (Confirm → done; Not yet keeps it open, the agent sees why)
    // (the rail's key drops the card's ✓: a symbol glyph is a fallback font in a VT323 label and overran the key's edge)
    if (i.kind === 'attest') return k('attest-yes', 'Confirm', 'primary', sending) + k('attest-no', 'Not yet', 'deny', sending);
    if (i.kind === 'routine' && i.routineId) return k('retry', 'Retry', 'primary');
    if (i.kind === 'failed') return k('dismiss', 'Dismiss', 'quiet');
    if (i.kind === 'asked' && i.noDoor) return k('dismiss', 'Dismiss', 'quiet');   // no conversation to open: only its Dismiss
    return '';
  }
  // the row's line, the ask first so a clamp never cuts it: "wants to …", "asks …", "keep or discard · <build>",
  // "23 builds to keep or discard · <the oldest build>". A failed routine's line is its name: its card's header already
  // says ROUTINE FAILED (the whole sentence, 'routine "…" failed', stays its tip, its door's name and its bell row)
  function lineHtml(i) {
    if (i.rail) return '<span class="ny-verb">' + esc(i.rail.verb) + '</span> · ' + esc(i.rail.text);
    if (i.kind === 'routine' && i.routineName) return esc(i.routineName);
    return (KIND[i.kind] ? '<span class="ny-verb">' + esc(KIND[i.kind]) + '</span> ' : '') + esc(i.what);
  }
  /* (Andrew 10-17, of three rendered: "C is def the best") every wait is a card under a header strip that names WHAT it is,
     in the station's own word for that kind (the line under it still says the ask whole), with how long it has waited at
     the strip's end. A group says which of its waits it is; an agent's builds say how many; a worker says whether it
     failed or was stopped, as its own line does. */
  const KIND_LABEL = { approval: 'Approval', question: 'Question', asked: 'Question', stepin: 'Step-in', attest: 'Quest done?',
    loop: 'Goal loop', extension: 'Extensions', routine: 'Routine failed' };
  function kindLabel(i) {
    if (i.kind === 'group') return /approval/.test(String(i.what)) ? 'Approval' : 'Question';
    if (i.kind === 'build') return (i.n > 1 ? i.n + ' builds' : 'Build') + ' to review';
    if (i.kind === 'failed') return /^failed\b/.test(String(i.what)) ? 'Work failed' : 'Work stopped';
    return KIND_LABEL[i.kind] || 'Waiting';
  }
  // a build's door is its own session, named for the build its line already names: the card says that place once
  const placeSaid = i => i.kind === 'build' && !!i.rail && String(i.where || '').indexOf(String(i.rail.text || '')) >= 0;
  /* (Andrew 10-15, second pass: "disgusting and cheap … we need it premium") one agent's builds waiting on keep/discard are
     ONE card, never 23 copies of the same line. It names the build its click opens (the oldest: the next decision) and
     its door is that build's own session, its age the oldest build's (none when no build has a time). Its count LEADS the
     line ("23 builds to keep or discard · <oldest>"): the line is clamped to two lines, and a count after a long title was
     cut on every default rail, so 22 real waits vanished. Every other wait stays its own card (each has its own action).
     Each card carries how many waits it holds (n): the header counts every wait, and "N more" counts the waits folded. */
  function railRows(list) {
    const out = [], builds = new Map();
    for (const i of list) {
      if (i.kind !== 'build') { out.push(i); continue; }
      const key = String(i.aid || i.who), g = builds.get(key);
      if (g) { g.n++; const t = [g.since, i.since].filter(x => Number(x) > 0); g.since = t.length ? Math.min(...t) : 0; continue; }
      const row = Object.assign({}, i, { n: 1, since: Number(i.since) > 0 ? Number(i.since) : 0 });
      builds.set(key, row); out.push(row);
    }
    return out.map(r => r.n > 1 ? Object.assign({}, r, {
      rail: { verb: plural(r.n, 'build', 'builds') + ' to keep or discard', text: r.rail.text },
      what: plural(r.n, 'build', 'builds') + ' to keep or discard, the oldest first: "' + r.rail.text + '"' }) : r);
  }
  const waitsIn = rows => rows.reduce((s, r) => s + (r.n || 1), 0);
  function html(list, now) {
    if (!list.length) return '';
    const rows = railRows(list), shown = expanded ? rows : rows.slice(0, SHOW), folded = list.length - waitsIn(shown);
    return '<div class="ny-head"><span class="ny-lamp" aria-hidden="true"></span><span class="ny-title">Needs you</span><span class="ny-count">' + list.length + '</span></div>'
      + '<ul class="ny-list">' + shown.map(i => { const rv = reviewRow(i), keys = keysFor(i), color = colorOf(i.aid), place = ' — in ' + i.where; return '<li class="ny-item ' + i.kind + (rv ? ' ny-review' : '') + (placeSaid(i) ? ' ny-place-said' : '') + '" data-ny-key="' + esc(i.key) + '" data-ny-n="' + (i.n || 1) + '">'
        // the card's header strip (Andrew 10-17, "C · ALERT CARDS"): what this wait is, and how long it has waited
        + '<div class="ny-strip"><span class="ny-kind">' + esc(kindLabel(i)) + '</span><span class="ny-age">' + esc(age(i.since, now)) + '</span></div>'
        // the CREW card, for a wait (Andrew 10-15: "premium"): the agent's portrait in its well with the gold lamp housed in
        // its corner, then WHO (in the agent's colour) · where, the line (the ask first; two lines at most, the whole of it on
        // hover), then keys only when there is more than Open
        + '<span class="ny-face" aria-hidden="true"' + (i.aid ? ' data-ny-aid="' + esc(i.aid) + '"' : '') + '><img alt="" draggable="false" hidden><span class="ny-dot"></span></span>'
        // "in <where>" is the row's door for the keyboard and a screen reader on every rail (pipglass.css only hides it from
        // sight where the line has no room): its name says who, what, and where it lands
        + '<div class="ny-line">' + (i.who ? '<span class="ny-who"' + (color ? ' style="color:' + esc(color) + '"' : '') + '>' + (i.whoHtml || esc(i.who)) + '</span>' : '')
        + '<button type="button" class="ny-where" data-ny-act="open" data-ny-key="' + esc(i.key) + '" aria-label="' + esc((i.who ? i.who + ' ' : '') + lineOf(i) + place) + '"' + (rv ? ' data-tip="' + esc(REVIEW_TIP) + '"' : '') + '>in ' + esc(i.where) + '</button></div>'
        + '<div class="ny-what" title="' + esc(i.what + (i.tip ? ' — ' + i.tip : '') + place + (rv ? ' — ' + REVIEW_TIP : '')) + '">' + lineHtml(i) + '</div>'
        + (keys ? '<div class="ny-keys">' + keys + '</div>' : '')
        + '</li>'; }).join('') + '</ul>'
      + (rows.length > 1 ? '<button type="button" class="ny-more" data-ny-act="more" data-ny-waits="' + list.length + '" aria-expanded="' + expanded + '"'
        + (folded > 0 || expanded ? '' : ' hidden') + '>' + (expanded ? 'Show fewer' : folded + ' more') + '</button>' : '');
  }
  /* EVERY TEXT SIZE (Andrew 10-15: "many people have it on large or x-large … make sure that left sidebar is able to be seen"):
     the collapsed list shows only the rows that fit WHOLE in the section's room; the rest fold into "N more", so no row
     but the first is ever cut by the section's own scroll at LARGE / X-LARGE or on a narrow rail (the first always shows:
     a row taller than the whole room scrolls inside it). "N more" counts the WAITS folded, so the header is always the
     waits shown plus N. Run after every build and on the 1 s heartbeat (TEXT SIZE and the rail's width change the room
     without a rebuild). Expanded, the list scrolls as before. */
  function fitRows(host) {
    if (!host || expanded || typeof host.querySelector !== 'function' || typeof host.querySelectorAll !== 'function') return;
    const lis = Array.from(host.querySelectorAll('li.ny-item[data-ny-key]'));
    const more = host.querySelector('.ny-more');
    if (!lis.length || !more) return;
    lis.forEach(li => { li.hidden = false; });
    const waitsOf = li => Number(li.dataset && li.dataset.nyN) || 1;
    const total = Number(more.dataset && more.dataset.nyWaits) || 0;
    let shown = lis.length, shownWaits = lis.reduce((s, li) => s + waitsOf(li), 0);
    const fold = () => { const n = Math.max(0, total - shownWaits); more.hidden = n <= 0; const t = n + ' more'; if (more.textContent !== t) more.textContent = t; };
    fold();
    while (shown > 1 && host.scrollHeight > host.clientHeight + 1) { const li = lis[--shown]; li.hidden = true; shownWaits -= waitsOf(li); fold(); }
  }
  /* THE TEXT COLUMN NEVER MOVES WITH THE SECTION'S OWN SCROLL (review 10-16). The section reserves its scrollbar's gutter
     (pipglass.css: scrollbar-gutter: stable), and the gutter's width, measured here into --ny-gutter, is taken back out of
     the panel's right margin: the panel keeps the rail's edges and its rows one width, scrolling or not. Before, a first row
     whose Approve once · Deny overflowed the room brought the scrollbar in, the scrollbar narrowed the ask line to a third
     line, the reading went to Review, Review fit, the scrollbar left, the line read whole… and the 1 s heartbeat redrew the
     panel twice a beat, forever, painting Approve once over a line it had just read as cut. Read before the rows are fitted
     and again after them (where no gutter is reserved, the scrollbar comes with the overflow fitRows settles), so measure()
     always reads the one width. A hidden section (no box) keeps its last reading. */
  function fitGutter(host) {
    if (!host || !host.style || typeof host.style.setProperty !== 'function' || !(host.offsetWidth > 0)) return;
    const g = Math.max(0, host.offsetWidth - host.clientWidth - 2 * (Number(host.clientLeft) || 0)) + 'px';
    if (host.style.getPropertyValue('--ny-gutter') !== g) host.style.setProperty('--ny-gutter', g);
  }
  const fit = host => { fitGutter(host); fitRows(host); fitGutter(host); };
  // each card's portrait: the same figure the CREW card paints (AgentPortraits), from the agent the wait names
  function paintFaces(host) {
    if (typeof AgentPortraits === 'undefined' || !AgentPortraits.paint || !has(App, 'agents')) return;
    let roster = [];
    try { roster = App.agents() || []; } catch (_) { return; }
    host.querySelectorAll('.ny-face[data-ny-aid]').forEach(face => {
      const a = roster.find(x => x && x.id === face.dataset.nyAid);
      if (a) AgentPortraits.paint(face.querySelector('img'), a);
    });
  }
  // what the list shows apart from its ages: the rail's 1s heartbeat rebuilds the list only when this moves
  const shapeOf = list => list.map(i => [i.key, i.who, i.what, i.tip || '', i.where, keysFor(i)].join('\u0001')).join('\u0002') + '#' + expanded;

  const inSessionsView = () => typeof App === 'undefined' || !App || typeof App.railView !== 'function' || App.railView() === 'sessions';
  let remeasured = false;               // a render the measurement asked for: it redraws once, never in a loop
  function render() {
    const host = typeof document !== 'undefined' && document.getElementById('ws-needs');
    if (!host) return;
    wire(host);
    // NEEDS YOU belongs to the SESSIONS view: a render reached from any other view (a build landing, a STEP-IN opening, an
    // extension change, a dismiss from NOTIFICATIONS) keeps the block hidden there, and the next SESSIONS render rebuilds it.
    // The bell and NOTIFICATIONS read items() themselves, so they still follow.
    if (!inSessionsView()) { host.hidden = true; lastShape = ''; return; }
    const now = Date.now(), list = items(now), shape = shapeOf(list);
    host.hidden = !list.length;
    host.setAttribute('aria-label', list.length ? 'Needs you: ' + list.length + ' waiting' : 'Needs you');
    if (shape === lastShape) {
      // only time moved: update the ages in place, so the key the Commander is on keeps its focus
      const since = new Map(list.map(i => [i.key, i.since]));
      host.querySelectorAll('li.ny-item[data-ny-key]').forEach(li => {
        const el = li.querySelector('.ny-age'), text = age(since.get(li.dataset.nyKey), now);
        if (el && el.textContent !== text) el.textContent = text;
      });
      fit(host);               // …and how many rows fit whole in the room (TEXT SIZE or the rail's width may have moved)
      remeasure(host, list);   // …then re-read each line the rail now shows (a row just unfolded is read before it paints)
      return;
    }
    lastShape = shape;
    // a real rebuild: put focus back on the same key in the new list
    const f = typeof document !== 'undefined' && document.activeElement && host.contains(document.activeElement) ? document.activeElement : null;
    let fAct = f && f.dataset ? f.dataset.nyAct : '', fCls = f ? f.className : '';
    const fKey = f && f.dataset ? f.dataset.nyKey : '';
    // focus is on the stand-in for a key that was locked: aim for that key again (it is back when its answer failed)
    if (f && parked && parked.key === fKey) { fAct = parked.act; fCls = parked.cls; }
    parked = null;
    host.innerHTML = html(list, now);
    paintFaces(host);
    fit(host);
    if (fAct) {
      // "in <where>" and Review/Open share an action: the class tells them apart
      const keys = Array.from(host.querySelectorAll('[data-ny-act]'));
      const same = keys.filter(n => n.dataset.nyAct === fAct && (fAct === 'more' || n.dataset.nyKey === fKey));
      const again = same.find(n => n.className === fCls) || same[0];
      // a disabled key cannot hold focus (its answer is on the way): keep it on the same row's live key, else its
      // "in <where>", so a keyboard Commander is never dropped to the page
      const live = again && !again.disabled ? again
        : fKey ? keys.find(n => n.dataset.nyKey === fKey && !n.disabled && /\bny-key\b/.test(n.className)) || keys.find(n => n.dataset.nyKey === fKey && !n.disabled) : null;
      if (live && again && live !== again) parked = { act: fAct, cls: fCls, key: fKey };
      if (live && live.focus) live.focus({ preventScroll: true });
    }
    remeasure(host, list);   // the rows are drawn: read which lines show whole, and give those (only) Approve once
  }
  // a line that now reads whole (or no longer does) redraws the list at once, in the same task, before anything paints
  // or takes a click. Once per render, and that bounds only the one task: a reading that moved again in the redraw would
  // move again on the next heartbeat (a row's own keys used to move the section's scrollbar, and with it the line's width:
  // two rebuilds a beat, forever). What keeps it settled is that a row's keys cannot move its own reading — the line's
  // width never follows the section's scroll (fitGutter), and a row fitRows folds keeps its last reading (measure). A
  // stale Approve once meanwhile still meets the click's own reading in act().
  function remeasure(host, list) {
    if (!measure(host, list) || remeasured) return;
    remeasured = true;
    try { lastShape = ''; render(); } finally { remeasured = false; }
  }
  // (org P01) the waits that live in a window, not a conversation: Open goes through that window's own door
  function openDoor(i) {
    const ui = typeof StationUI !== 'undefined' ? StationUI : null;
    if (i.kind === 'stepin') { if (typeof StepIn !== 'undefined' && StepIn.open) StepIn.open(i.handoffId); return true; }
    if (!ui || !ui.openTerm) return true;
    if (i.kind === 'extension') ui.openTerm('connectors', 'extensions');
    else if (i.kind === 'attest') ui.openTerm('quests');
    else if (i.kind === 'loop') ui.openTerm('loops');
    else if (i.kind === 'asked') ui.openTerm('notifs');   // a stored wait with no conversation: where it was filed (Dismiss settles it)
    else if (i.kind === 'build') {
      // (Andrew 10-15: "it only takes you to deliverables … instead of where you are ACTUALLY needed") a build opens ITS OWN
      // session (workshop-<runId>), where WorkshopStore.presentFor puts its keep/discard card in COMMS. Only a build whose
      // session cannot be had (deleted: adopt refuses the tombstone) falls back to DELIVERABLES › NEEDS A DECISION.
      const sid = i.build && typeof WorkshopStore !== 'undefined' && WorkshopStore.ensureSession ? WorkshopStore.ensureSession(i.build) : null;
      if (sid && has(App, 'openWorkstream')) { App.openWorkstream(sid); refreshFeeds(true); return 'conversation'; }
      ui.openTerm('deliverables');
      // lands on NEEDS A DECISION: the library's own status filter (the summary's "N need a decision" route)
      const lib = typeof document !== 'undefined' && document.querySelector ? document.querySelector('#dl-status') : null;
      const body = lib && lib.closest ? lib.closest('.term-body') : null;
      if (body && typeof Deliverables !== 'undefined' && Deliverables.showStatus) Deliverables.showStatus(body, 'pending');
      refreshFeeds(true);   // a decision is likely next: the row follows it at once, not a minute later
    }
    return true;
  }
  function open(i) {
    if (i && !i.wsId) return openDoor(i);
    if (!i || !has(App, 'openWorkstream')) return false;
    if (i.kind === 'failed') dismiss(i.key);   // you went to look at it: it has done its job here
    App.openWorkstream(i.wsId);
    // a stored wait (a finished reply's question) settles when its conversation is opened: opening it lands there (its
    // seenSession settles it on every route); settled here too, so this OPEN never leaves the row behind
    if (i.kind === 'asked') settleStored(i);
    // a question lands on its question card in one hop (not on the worker's row, which only points there), and Review on
    // an approval lands on its approval card (live walk 10-14: it re-opened the session and left the card below the fold)
    if ((i.kind === 'question' || i.kind === 'approval') && i.p && typeof Chat !== 'undefined' && Chat.revealAsk && Chat.revealAsk(i.p.promptId)) return true;
    if (i.workerWsId && typeof Delegated !== 'undefined' && Delegated.reveal) Delegated.reveal(i.workerWsId);
    return true;
  }
  async function act(kind, key, btn) {
    const i = items().find(x => x.key === key);
    if (kind === 'more') { expanded = !expanded; lastShape = ''; render(); return; }
    if (!i) { lastShape = ''; render(); return; }
    // never approve what the rail cannot show: the line read whole at the last render AND in the row clicked, read now
    // (a TEXT SIZE change or a dragged rail since the last heartbeat cuts it before the keys follow)
    const clicked = btn && typeof btn.closest === 'function' ? btn.closest('li.ny-item') : undefined;
    if (kind === 'open' || (kind === 'once' && !(railApproves(i) && (clicked === undefined || shownWhole(clicked))))) return open(i);
    if (kind === 'dismiss') { if (i.kind === 'failed') dismiss(key); else if (canDismiss(i)) settleStored(i); lastShape = ''; render(); return; }
    if ((kind === 'attest-yes' || kind === 'attest-no') && i.kind === 'attest' && typeof QuestLedgerStore !== 'undefined' && QuestLedgerStore.confirm) {
      if (answering.has(key)) return;
      answering.add(key); render(); if (btn) btn.disabled = true;
      let r = null;
      try { r = await QuestLedgerStore.confirm(i.questId, kind === 'attest-yes'); }
      catch (e) { r = { ok: false, error: (e && e.message) || String(e) }; }
      finally { answering.delete(key); }
      if (!(r && r.ok) && typeof StationUI !== 'undefined' && StationUI.notify) StationUI.notify('could not record that verdict', 'bad');
      if (typeof StationUI !== 'undefined' && StationUI.rerender) StationUI.rerender('quests', false);
      lastShape = ''; render(); if (typeof StationUI !== 'undefined' && StationUI.badges) StationUI.badges(); return;
    }
    if ((kind === 'once' || kind === 'deny') && i.p && typeof Chat !== 'undefined' && Chat.answerConsent) {
      // one answer per ask: a re-render while it is on its way keeps both keys disabled, and a second click sends nothing
      const promptId = String(i.p.promptId);
      if (answering.has(promptId)) return;
      // render first, while the clicked key still holds focus (the rebuild moves it to the row), then lock the key in hand
      answering.add(promptId); render(); if (btn) btn.disabled = true;
      // 'needs-you': the ask's card settles as answered here, never "from your phone"
      try { await Chat.answerConsent(i.p, Workstreams.get(i.wsId), kind, 'needs-you'); }
      catch (e) { if (typeof StationUI !== 'undefined' && StationUI.notify) StationUI.notify('Could not send that answer: ' + ((e && e.message) || e), 'warn'); }
      finally { answering.delete(promptId); }
      render(); if (has(App, 'refreshRail')) App.refreshRail(); return;
    }
    if (kind === 'retry' && i.routineId) {
      if (btn) { btn.disabled = true; btn.textContent = 'Running…'; }
      try {
        const r = await fetch('/api/cron/run', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: i.routineId, detach: true }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error((j && j.error) || ('HTTP ' + r.status)); }
        if (typeof Workstreams !== 'undefined' && Workstreams.markRead) Workstreams.markRead(i.wsId);   // the new run is what counts now
        if (typeof StationUI !== 'undefined' && StationUI.notify) StationUI.notify('Running ' + i.what.replace(/ failed$/, '') + ' again', 'good');
      } catch (e) {
        if (btn) { btn.disabled = false; btn.textContent = 'Retry'; }
        if (typeof StationUI !== 'undefined' && StationUI.notify) StationUI.notify('Could not rerun it: ' + ((e && e.message) || e), 'warn');
      }
      lastShape = ''; render(); if (has(App, 'refreshRail')) App.refreshRail();
    }
  }
  function wire(host) {
    if (wired || !host) return; wired = true;
    host.addEventListener('click', e => {
      const b = e.target && e.target.closest ? e.target.closest('[data-ny-act]') : null;
      if (b) { e.preventDefault(); e.stopPropagation(); act(b.dataset.nyAct, b.dataset.nyKey, b); return; }
      const row = e.target && e.target.closest ? e.target.closest('.ny-item[data-ny-key]') : null;
      if (row) { const i = items().find(x => x.key === row.dataset.nyKey); open(i); }
    });
    if (typeof U !== 'undefined' && U.bus && U.bus.on) {
      // an ask arrives or is answered anywhere (here, its card, the phone, a timeout): the list follows at once — and so do
      // NOTIFICATIONS › NEEDS YOU and the bell, on the SAME settle (org live walk 10-14: Approve cleared the rail at once while
      // the bell and NOTIFICATIONS kept "1 waiting" until the rail heartbeat's next badges(), ~1.5 s later). The tick runs
      // after the answering path has cleared the ask from Channels (answerConsent emits before clearPending).
      const follow = () => setTimeout(() => {
        render();
        try { if (typeof StationUI !== 'undefined' && StationUI && StationUI.badges) StationUI.badges(); } catch (_) {}
      }, 0);
      U.bus.on('permission.prompt', follow);
      U.bus.on('permission.response', follow);
      // (org P01) a STEP-IN opens or ends, a build lands: the list follows at once (a build is a sidecar read: re-read now)
      U.bus.on('browser.handoff', follow);
      U.bus.on('workshop.built', () => { refreshFeeds(true); });
    }
  }
  /* (org P01) for NOTIFICATIONS › NEEDS YOU, which renders this same list: the line it reads, Open / Dismiss by key, and a
     shape that moves only when the list does (the bell repaints on it) */
  const lineOf = i => (KIND[i.kind] ? KIND[i.kind] + ' ' : '') + i.what;
  // what it opened: { conversation: true } when the door was a session (NOTIFICATIONS then steps aside with a way back) —
  // a build's own session too; { conversation: false } when it was a window (STEP-IN, EXTENSIONS, QUESTS, GOAL LOOPS, and
  // DELIVERABLES for a build whose session cannot be had, keep the focus)
  function openKey(key) { const i = items().find(x => x.key === key); const r = i ? open(i) : false; if (!r) return false; return { conversation: !!i.wsId || r === 'conversation' }; }
  // Dismiss: failed work (the rail's own per-viewer dismissal), or a stored wait with no conversation to open (it settles,
  // as its bell row's ✕ cleared it). A live wait is never dismissed away.
  function dismissKey(key) {
    const i = items().find(x => x.key === key); if (!canDismiss(i)) return false;
    if (i.kind === 'failed') dismiss(key); else settleStored(i);
    lastShape = ''; render(); return true;
  }
  function canDismiss(i) { return !!i && (i.kind === 'failed' || (i.kind === 'asked' && !!i.noDoor)); }
  const listShape = list => (list || items()).map(i => i.key + '\u0001' + i.what + '\u0001' + i.where).join('\u0002');
  return { items, render, openKey, dismissKey, canDismiss, lineOf, listShape, refreshFeeds, _internals: { html, age, keysFor, measure, fitRows, railRows, dismissed, feeds: () => feeds } };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = NeedsYou;
