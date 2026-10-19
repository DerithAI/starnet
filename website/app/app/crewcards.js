/* CREW CARDS — the CREW rail rows as agent cards (css/crew-glass.css): a housed lamp in the portrait well,
   a run clock beside the name while the agent works, the live step beside its status, and a gold frame
   while it waits on your OK. stationui.js still owns the rows and their WORKING / IDLE / IN CONVERSATION
   label (crewTick, locked by test/state-truth-overlap.test.js); this module only adds what it can prove:
     · clock  = the oldest run of that agent this page saw START (agent.run.start). A run already under way
                when the page loaded has no known start, so it shows no clock rather than a guessed one.
     · step   = the tool that run is in right now (agent.tool_call → agent.tool_result clears it).
     · asking = a permission.prompt for that agent with no permission.response yet. The card says only
                "needs your OK"; what is being asked stays in the session (the locked crew decision).
   Everything is gated on the row's own .working class, so a card never claims more than crewTick does. */
(() => {
  'use strict';
  const runs = new Map();   // runId → aggregate CREW state + independent exact-run wait accounting
  const asks = new Map();   // promptId → { agentId, runId (only when stamped), at }
  /* A run the page saw start but never saw END (Stop, E-STOP, a dropped stream: agent.run.end never reaches the bus)
     used to stay here forever — the agent's NEXT run showed the old run's clock, step and gold "needs your OK" frame
     (sweep 2026-10-02). crewTick's .working is the truth; once a row has been not-working for a short grace (the same
     8s agentLive allows a fresh start to land), that agent's leftover runs and asks are dropped. */
  const IDLE_GRACE_MS = 8000;
  const idleSince = new Map();   // agentId → when its row was first seen not working

  const toolLabel = (name) => {
    const n = String(name || '').trim();
    const m = /^mcp__(.+?)__(.+)$/.exec(n);
    return (m ? m[1] + '.' + m[2] : n).replace(/[_-]+/g, '.').toLowerCase();
  };
  const fmtClock = (ms) => {
    const s = Math.max(0, Math.floor(ms / 1000)), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
    return (h ? h + ':' + String(m).padStart(2, '0') : String(m)) + ':' + String(r).padStart(2, '0');
  };

  /* THE CLOCK EXCLUDES WAITS ON YOU (the duration law COMMS keeps with Channels.elapsedOf): time a run spent with an
     open prompt is subtracted — closed waits from pausedMs, an open one up to now — so the card and COMMS agree. */
  // the oldest still-open wait on you for an agent (0 = none)
  function openAskFrom(id) {
    let openFrom = 0;
    for (const a of asks.values()) if (a.agentId === id && (!openFrom || a.at < openFrom)) openFrom = a.at;
    return openFrom;
  }
  const runElapsed = (r, openFrom, now) => Math.max(0, now - r.startedAt - (r.pausedMs || 0) - (openFrom ? Math.max(0, now - Math.max(openFrom, r.startedAt)) : 0));
  function forAgent(id, now) {
    let oldest = null, tool = '';
    for (const r of runs.values()) {
      if (r.agentId !== id) continue;
      if (!oldest || r.startedAt < oldest.startedAt) oldest = r;
      if (r.tool) tool = r.tool;
    }
    const openFrom = openAskFrom(id);
    return { start: oldest ? oldest.startedAt : 0, elapsed: oldest ? runElapsed(oldest, openFrom, now) : 0, tool, asking: !!openFrom };
  }
  // Only the worker stamp proves whose time a delegated ask consumes. The outer lead run owns the consent endpoint,
  // not the worker clock; ordinary raw prompts have no run stamp. Once an ambiguous wait is observed, that run's
  // exact accounting stays unavailable (even after the wait closes), so its caller can use the thread clock.
  function openAsk(p) {
    const who = p && (p.workerAgentId || p.agentId);
    if (!p || !p.promptId || !who) return;
    const id = String(p.promptId), agentId = String(who), runId = String(p.workerRunId || '');
    const r = runId && runs.get(runId);
    if (asks.has(id) || (r && r.seenPrompts.has(id))) return;
    const now = Date.now();
    asks.set(id, { agentId, runId, at: now });
    if (r) {
      r.seenPrompts.add(id);
      if (r.agentId !== agentId) r.runClockKnown = false;
      if (r.runPauseAt === null) r.runPauseAt = now;
    } else if (!runId) {
      // Agent identity can rule out unrelated agents, but cannot choose between this agent's concurrent runs.
      for (const candidate of runs.values()) if (candidate.agentId === agentId) candidate.runClockKnown = false;
    }
    tick();   // a wait opening moves the turn (a clock held on a wait on you never turns)
  }
  function elapsedForRun(runId, now = Date.now()) {
    const r = runs.get(String(runId || ''));
    if (!r || !r.runClockKnown || !Number.isFinite(now)) return null;
    const open = r.runPauseAt === null ? 0 : Math.max(0, now - r.runPauseAt);
    return Math.max(0, now - r.startedAt - r.runPausedMs - open);
  }
  /* PAINT ON THE TURN (review of rc walk #21): a free-running 1 s interval painted at whatever phase the page loaded in, so CREW
     read up to a second behind the world's desk tag, which reads this same clock every frame ("RUN 0:41" over a card saying
     "0:40"). nextTurnAt: the moment the soonest live clock turns its second (a clock held on a wait on you never turns; with
     nothing live, a second from now). msToNextSecond: the wait until just past that turn, for a readout on a timer. */
  function nextTurnAt(now) {
    let wait = 1000;
    for (const r of runs.values()) {
      if (openAskFrom(r.agentId)) continue;
      wait = Math.min(wait, 1000 - (runElapsed(r, 0, now) % 1000));
    }
    return now + Math.ceil(wait);
  }
  const msToNextSecond = (now) => Math.max(2, Math.min(1001, nextTurnAt(now) - now + 1));
  const turnListeners = [];   // CrewClock.atNextTurn: one-shot, called right after CREW paints a turn (same frame)
  // a wait on you closed (answered, denied, or its run ended): its span stops counting toward every run it paused.
  // Preserve CREW's aggregate accounting; the exact-run clock separately subtracts the UNION of its own waits.
  function closeAsk(promptId, now) {
    const a = asks.get(promptId);
    if (!a) return false;
    asks.delete(promptId);
    for (const r of runs.values()) if (r.agentId === a.agentId) r.pausedMs = (r.pausedMs || 0) + Math.max(0, now - Math.max(a.at, r.startedAt));
    const r = a.runId && runs.get(a.runId);
    if (r && r.runPauseAt !== null && ![...asks.values()].some(x => x.runId === a.runId)) {
      r.runPausedMs += Math.max(0, now - r.runPauseAt);
      r.runPauseAt = null;
    }
    return true;
  }
  function dropAgent(id) {
    for (const [k, r] of runs) if (r.agentId === id) runs.delete(k);
    for (const [k, a] of asks) if (a.agentId === id) asks.delete(k);
  }

  function dress(row) {
    const portrait = row.querySelector('.crew-portrait'), dot = row.querySelector(':scope > .dot');
    if (portrait && dot) portrait.appendChild(dot);   // the lamp lives in the well's corner
    const name = row.querySelector('.crew-name');
    if (name && !name.querySelector('.crew-clock')) {
      const c = document.createElement('span'); c.className = 'crew-clock'; c.setAttribute('aria-hidden', 'true'); name.appendChild(c);
    }
    const status = row.querySelector('.crew-status');
    if (status && !row.querySelector('.crew-step')) {
      const s = document.createElement('span'); s.className = 'crew-step'; status.after(s);
    }
  }

  function paint(at) {
    const now = typeof at === 'number' ? at : Date.now();
    document.querySelectorAll('#crew .crew-row[data-agent-id]').forEach((row) => {
      dress(row);
      const live = row.classList.contains('working'), id = row.dataset.agentId;
      if (live) idleSince.delete(id);
      else if (!idleSince.has(id)) idleSince.set(id, now);
      else if (now - idleSince.get(id) >= IDLE_GRACE_MS) dropAgent(id);
      const st = live ? forAgent(id, now) : { start: 0, elapsed: 0, tool: '', asking: false };
      const clock = row.querySelector('.crew-clock'), step = row.querySelector('.crew-step');
      const ct = st.start ? fmtClock(st.elapsed) : '';
      if (clock && clock.textContent !== ct) clock.textContent = ct;
      row.classList.toggle('has-clock', !!ct);
      row.classList.toggle('asking', st.asking);
      const sx = st.asking ? 'needs your OK' : st.tool ? toolLabel(st.tool) : '';
      if (step && step.textContent !== sx) step.textContent = sx;
    });
  }

  // the roster total moves up under the CREW title: "2 WORKING · 1 IDLE" (the same element, its writer unchanged)
  function seatSummary() {
    const h3 = document.querySelector('#left > h3'), sum = document.getElementById('crew-sum');
    if (!h3) return;
    if (sum && sum.parentElement !== h3) h3.appendChild(sum);
  }

  /* THE TICK: paint, then come back ~40 ms before the soonest clock turns and ride the animation frames across the turn, so CREW
     (and every atNextTurn readout — the DELEGATED row) repaints in the very frame the world's desk tag turns. A page that draws
     no frames (hidden, minimized: rAF is paused) is painted by the backstop timer instead; with no rAF at all, a timer just past
     the turn. A run starting or ending and a wait opening or closing move the turn, so they tick (re-aim) too. */
  /* ONE INSTANT PER FRAME: every rAF callback of a frame is handed the same timestamp. The first reader of a frame stamps the wall
     clock and every other reader that frame (the world's desk tag, CREW's turn) gets that same instant — a slow world draw can no
     longer read 0:05 while CREW, a few ms later in the same frame, reads 0:06. tickAt: the instant the running tick painted, so
     an atNextTurn readout (CrewClock.now) reads exactly what CREW just painted. */
  let frameTs = NaN, frameAt = 0, tickAt = 0;
  function frameNow(ts) {
    if (typeof ts !== 'number' || !isFinite(ts)) return Date.now();
    if (ts !== frameTs) { frameTs = ts; frameAt = Date.now(); }
    return frameAt;
  }
  let tickTimer = 0, backstop = 0;
  function tick(at) {
    clearTimeout(tickTimer); clearTimeout(backstop); tickTimer = 0; backstop = 0;
    const now = typeof at === 'number' ? at : Date.now();
    tickAt = now;
    try {
      paint(now);
      for (const fn of turnListeners.splice(0)) { try { fn(); } catch (e) { console.warn('[crew clock] turn listener:', (e && e.message) || e); } }
    } finally { tickAt = 0; }
    const turnAt = nextTurnAt(now);
    const frames = typeof requestAnimationFrame === 'function' && !(typeof document !== 'undefined' && document.hidden);
    const wait = turnAt - Date.now();
    tickTimer = frames ? setTimeout(() => rideTurn(turnAt), Math.max(0, wait - 40)) : setTimeout(() => tick(), Math.max(0, wait) + 1);
  }
  function rideTurn(turnAt) {
    tickTimer = 0;
    backstop = setTimeout(() => tick(), Math.max(0, turnAt - Date.now()) + 60);
    const step = (ts) => { if (!backstop) return; const wall = frameNow(ts); if (wall >= turnAt) tick(wall); else requestAnimationFrame(step); };   // (!backstop: a tick already ran)
    requestAnimationFrame(step);
  }

  function wire() {
    seatSummary();
    if (typeof U !== 'undefined' && U.bus) {
      U.bus.on('agent.run.start', (p) => {
        if (p && p.runId && p.agentId) {
          const runId = String(p.runId), agentId = String(p.agentId);
          idleSince.delete(agentId);
          // A repeated start must not reset either clock or discard waits already observed for this run.
          if (!runs.has(runId)) runs.set(runId, { agentId, startedAt: Date.now(), tool: '', pausedMs: 0,
            runPausedMs: 0, runPauseAt: null, seenPrompts: new Set(),
            runClockKnown: ![...asks.values()].some(a => a.runId === runId || (!a.runId && a.agentId === agentId)) });
        }
        tick();
      });
      U.bus.on('agent.tool_call', (p) => { const r = p && runs.get(String(p.runId)); if (r && p.name) { r.tool = String(p.name); paint(); } });
      U.bus.on('agent.tool_result', (p) => { const r = p && runs.get(String(p.runId)); if (r) { r.tool = ''; paint(); } });
      const end = (p) => {
        const r = p && runs.get(String(p.runId));
        if (!r) return;
        // Ending one of several same-agent runs settles only the prompts explicitly owned by that run.
        for (const [id, a] of asks) if (a.runId === String(p.runId)) closeAsk(id, Date.now());
        runs.delete(String(p.runId));
        // a run that ends with a prompt still open (stopped, failed) can no longer be waiting on you
        if (![...runs.values()].some((x) => x.agentId === r.agentId)) for (const [k, a] of asks) if (a.agentId === r.agentId) asks.delete(k);
        tick();
      };
      U.bus.on('agent.run.end', end);
      U.bus.on('agent.run.error', end);
      // a delegated worker's ask names the worker (workerAgentId): its card says "needs your OK", not the lead's
      U.bus.on('permission.prompt', openAsk);
      U.bus.on('permission.response', (p) => { if (p && p.promptId && closeAsk(String(p.promptId), Date.now())) tick(); });
    }
    const crew = document.getElementById('crew');
    if (crew) new MutationObserver(paint).observe(crew, { childList: true });
    tick();
  }
  /* ONE CLOCK PER WORKER (live walkthrough 2026-10-13): CREW read RESEARCH "3:04" while its DELEGATED row read "4:04" —
     the row's thread clock never saw the worker's approval waits (they are filed on the lead's conversation).
     CREW remains an aggregate view (elapsedOf: per agent, its oldest run). elapsedForRun: ONE run's EXACT clock — only the waits
     stamped with that worker run are excluded; null means this page cannot account for that exact run (unseen start, or an
     unstamped wait), never permission to borrow another run of the same agent (a foreground DELEGATED row reads this).
     elapsedOfRun: ONE run's clock as CREW counts it (waits on that agent excluded); null = this page never saw that run start
     (a ledger worker's DELEGATED row reads this). atNextTurn(fn): fn runs once, right after CREW's next tick paints —
     a readout that repaints from it turns in the same frame as CREW and the world tag. msToNextSecond: the timer fallback.
     frameNow(rafTimestamp): this frame's one instant (the world's desk tag reads its clock at it). now(): the instant CREW is painting
     (inside atNextTurn), else the wall clock. */
  if (typeof window !== 'undefined') window.CrewClock = {
    elapsedOf: (agentId, now) => { const f = forAgent(String(agentId || ''), now || Date.now()); return f.start ? f.elapsed : null; },
    elapsedForRun,
    elapsedOfRun: (runId, now) => { const r = runs.get(String(runId || '')); return r ? runElapsed(r, openAskFrom(r.agentId), now || Date.now()) : null; },
    msToNextSecond: (now) => msToNextSecond(now || Date.now()),
    atNextTurn: (fn) => { if (typeof fn === 'function') turnListeners.push(fn); return true; },
    frameNow: (ts) => frameNow(ts),
    now: () => tickAt || Date.now()
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', wire); else wire();
})();
