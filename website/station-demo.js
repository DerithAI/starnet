/* station-demo.js — the homepage "watch it work" console (2026-10-14).
   The station is the REAL app (website/app, generated from frontend/) booted from the website-only
   crew save in demo-boot.js. Nothing here draws a sprite: each chapter emits the same harness events
   the sidecar would (workitem.placed, agent.run.start/end, agent.tool_call/result, shell.exec,
   verify.result, agent.token) onto the app's own U.bus, and the renderer reacts exactly as it does in
   the desktop app — crates ride belts, agents sit and type, gear pulses, handoff boxes fly. The trace
   panel prints the same script as text. No model runs; the caption on the page says so. */
(function(){
  'use strict';
  var root = document.querySelector('[data-demo]');
  var frame = document.getElementById('crew-app');
  if (!root || !frame) return;
  /* Phones get the poster, never the app: the full renderer is a desktop-weight program (tens of MB of
     art plus the whole app), so on a small touch screen the still frame stays and the trace runs alone. */
  var still = !!(window.matchMedia && window.matchMedia('(max-width:760px), (hover:none) and (pointer:coarse)').matches);
  if (!still && frame.getAttribute('data-src')) frame.src = frame.getAttribute('data-src');
  var clip = root.querySelector('.stage-clip');
  var log = root.querySelector('[data-trace]');
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-chapter]'));
  var titleEl = root.querySelector('[data-ch-title]');
  var copyEl = root.querySelector('[data-ch-copy]');
  var linkEl = root.querySelector('[data-ch-link]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- camera crop: the iframe renders at a fixed native size; the clip shows the room ---------- */
  var FW = 1300, FH = 1066;                               // iframe viewport the app lays out in (never changes)
  var CROP = { x: 208, y: 182, w: 890, h: 702 };          // room interior inside that viewport
  frame.style.setProperty('--fw', FW + 'px');
  frame.style.setProperty('--fh', FH + 'px');
  clip.style.setProperty('--stage-aspect', (CROP.w / CROP.h).toFixed(4));
  function fit(){
    var k = clip.clientWidth / CROP.w;
    frame.style.setProperty('--k', String(k));
    frame.style.setProperty('--fx', (-CROP.x) + 'px');
    frame.style.setProperty('--fy', (-CROP.y) + 'px');
  }
  fit();
  window.addEventListener('resize', fit);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(fit).observe(clip);

  /* ---------- the crew (ids + colors match demo-boot.js) ---------- */
  var CREW = { NOVA: { id: 'agent', c: '#5ad0ff' }, SCOUT: { id: 'scout', c: '#7fd6a4' },
               QUILL: { id: 'quill', c: '#e8b85c' }, FORGE: { id: 'forge', c: '#e07a5f' } };
  function aid(who){ return CREW[who] ? CREW[who].id : who; }

  /* ---------- chapter scripts: [ms, action, ...] ----------
     actions: line(who, text, cls) · job(agent, kind, preview) · start(who, trigger) · end(who)
              call(who, tool, ok) · shell(who) · verify(who, passed) */
  var CH = {
    delegate: { title: 'Delegation', link: ['docs/agents.html', 'How crews work'],
      copy: 'The overseer hands work to a specialist with <code>team.dispatch</code>. The worker runs on its own, with its own tools, and the result comes back to the lead.',
      len: 11500, s: [
        [0, 'line', 'YOU', 'COMMS &rarr; NOVA &ldquo;fix the failing price test&rdquo;', 'dim'],
        [400, 'start', 'NOVA', 'event'], [400, 'line', 'NOVA', 'run.start'],
        [1600, 'call', 'NOVA', 'team.dispatch', null], [1600, 'line', 'NOVA', 'team.dispatch &rarr; FORGE'],
        [2400, 'start', 'FORGE', 'directive'], [2400, 'line', 'FORGE', 'run.start &middot; delegated'],
        [2800, 'result', 'NOVA'],
        [3800, 'shell', 'FORGE'], [3800, 'line', 'FORGE', 'shell.exec npm test'],
        [4600, 'verify', 'FORGE', false], [4600, 'line', 'FORGE', '&rarr; 1 failing', 'err'],
        [5800, 'call', 'FORGE', 'fs.edit', true], [5800, 'line', 'FORGE', 'fs.edit src/pricing.js &rarr; ok'],
        [7000, 'shell', 'FORGE'], [7000, 'line', 'FORGE', 'shell.exec npm test'],
        [7800, 'verify', 'FORGE', true], [7800, 'line', 'FORGE', '&rarr; 214 passing', 'ok'],
        [8600, 'end', 'FORGE'], [8600, 'line', 'FORGE', 'run.end &rarr; result to NOVA'],
        [9400, 'line', 'NOVA', 'reply &rarr; COMMS &ldquo;fixed: rounding bug&rdquo;'],
        [9800, 'end', 'NOVA'], [9800, 'line', 'NOVA', 'run.end']
      ] },
    flow: { title: 'Workflows', link: ['docs/guides/first-line.html', 'Build a workflow'],
      copy: 'A conveyor line is a routing plan, not a drawing. Each job rides from the inbox to the next agent&rsquo;s bay, each bay starts a real run, and its product moves on down the line.',
      len: 20500, s: [
        [0, 'job', 'SCOUT', 'cron', 'weekly competitor brief'], [0, 'line', 'ROUTER', 'job w-14 &rarr; INBOX'],
        [500, 'line', 'ROUTER', 'route INBOX &rarr; SCOUT&rsquo;s bay'],
        [3400, 'start', 'SCOUT', 'schedule'], [3400, 'line', 'SCOUT', 'run.start &middot; w-14'],
        [4800, 'call', 'SCOUT', 'web_search', true], [4800, 'line', 'SCOUT', 'web_search &ldquo;agent harness pricing&rdquo;'],
        [5600, 'line', 'SCOUT', '&rarr; 9 results', 'ok'],
        [6400, 'call', 'SCOUT', 'web_fetch', true], [6400, 'line', 'SCOUT', 'web_fetch 3 pages &rarr; 200', 'ok'],
        [7800, 'end', 'SCOUT'], [7800, 'line', 'SCOUT', 'run.end &rarr; product on the belt'],
        [8200, 'line', 'ROUTER', 'route SCOUT &rarr; QUILL&rsquo;s bay'],
        [11600, 'start', 'QUILL', 'chain'], [11600, 'line', 'QUILL', 'run.start &middot; w-14 stage 2'],
        [13200, 'call', 'QUILL', 'fs.write', true], [13200, 'line', 'QUILL', 'fs.write brief.md &rarr; ok', 'ok'],
        [15000, 'end', 'QUILL'], [15000, 'line', 'QUILL', 'run.end &rarr; product on the belt'],
        [17800, 'line', 'OUTBOX', 'brief.md delivered &middot; $0.06 of $2.00', 'ok']
      ] },
    tools: { title: 'Tools', link: ['docs/station.html', 'Explore capabilities'],
      copy: 'Placed gear is capability for the whole crew: the dish grants web, the cabinet files, the workbench a shell. Every call pulses the gear that granted it &mdash; green when it worked, red when it didn&rsquo;t.',
      len: 11500, s: [
        [0, 'start', 'SCOUT', 'event'], [300, 'start', 'QUILL', 'event'], [600, 'start', 'FORGE', 'event'],
        [0, 'line', 'HARNESS', '3 runs in parallel', 'dim'],
        [1800, 'call', 'SCOUT', 'web_search', true], [1800, 'line', 'SCOUT', 'web_search &rarr; 12 results &middot; DISH', 'ok'],
        [2900, 'call', 'QUILL', 'fs.read', true], [2900, 'line', 'QUILL', 'fs.read notes.md &middot; CABINET', 'ok'],
        [4000, 'shell', 'FORGE'], [4000, 'line', 'FORGE', 'shell.exec npm run build &middot; BENCH'],
        [4800, 'verify', 'FORGE', false], [4800, 'line', 'FORGE', '&rarr; exit 1 &middot; missing import', 'err'],
        [5800, 'call', 'SCOUT', 'web_fetch', true], [5800, 'line', 'SCOUT', 'web_fetch changelog &rarr; 200', 'ok'],
        [6800, 'call', 'FORGE', 'fs.edit', true], [6800, 'line', 'FORGE', 'fs.edit build.js &middot; CABINET', 'ok'],
        [7700, 'shell', 'FORGE'], [8400, 'verify', 'FORGE', true], [8400, 'line', 'FORGE', 'shell.exec npm run build &rarr; ok', 'ok'],
        [9000, 'call', 'QUILL', 'fs.write', true], [9000, 'line', 'QUILL', 'fs.write summary.md &middot; CABINET', 'ok'],
        [9800, 'end', 'SCOUT'], [10000, 'end', 'QUILL'], [10200, 'end', 'FORGE'],
        [10200, 'line', 'HARNESS', '3 runs ended', 'dim']
      ] },
    away: { title: 'Schedules & channels', link: ['docs/guides/routines.html', 'Set up a routine'],
      copy: 'Routines fire on a clock and messages arrive from Telegram, Discord, Slack, Matrix or Signal. The harness starts the runs &mdash; nobody has to be at the keyboard.',
      len: 20500, s: [
        [0, 'line', 'SCHED', 'routine &ldquo;morning digest&rdquo; fired &middot; 07:00'],
        [0, 'job', 'SCOUT', 'cron', 'morning digest'], [300, 'line', 'ROUTER', 'job w-15 &rarr; INBOX &rarr; SCOUT'],
        [1800, 'line', 'TELEGRAM', '@you &rarr; NOVA &ldquo;anything break overnight?&rdquo;', 'dim'],
        [2200, 'start', 'NOVA', 'channel'], [2200, 'line', 'NOVA', 'run.start &middot; from Telegram'],
        [3400, 'start', 'SCOUT', 'schedule'], [3400, 'line', 'SCOUT', 'run.start &middot; w-15'],
        [4200, 'call', 'NOVA', 'web_fetch', true], [4200, 'line', 'NOVA', 'web_fetch status page &rarr; 200', 'ok'],
        [5400, 'call', 'SCOUT', 'web_search', true], [5400, 'line', 'SCOUT', 'web_search &ldquo;release notes&rdquo; &rarr; 7', 'ok'],
        [6800, 'line', 'NOVA', 'reply &rarr; Telegram &ldquo;all green&rdquo;'], [7000, 'end', 'NOVA'],
        [8000, 'end', 'SCOUT'], [8000, 'line', 'ROUTER', 'route SCOUT &rarr; QUILL&rsquo;s bay'],
        [11600, 'start', 'QUILL', 'chain'], [11600, 'line', 'QUILL', 'run.start &middot; w-15 stage 2'],
        [13200, 'call', 'QUILL', 'fs.write', true], [13200, 'line', 'QUILL', 'fs.write digest.md &rarr; ok', 'ok'],
        [15000, 'end', 'QUILL'],
        [17800, 'line', 'OUTBOX', 'digest.md delivered &middot; while you slept', 'ok']
      ] },
    ledger: { title: 'Models & budgets', link: ['docs/providers.html', 'Choose a provider'],
      copy: 'Each agent can run its own model &mdash; hosted with your key, or local with Ollama. Every run lands in a ledger, and budgets cap a job, an agent, a day or the whole station.',
      len: 11000, s: [
        [0, 'start', 'NOVA', 'event'], [0, 'line', 'NOVA', 'run.start &middot; anthropic/claude-sonnet'],
        [500, 'start', 'SCOUT', 'event'], [500, 'line', 'SCOUT', 'run.start &middot; google/gemini-flash'],
        [1000, 'start', 'FORGE', 'event'], [1000, 'line', 'FORGE', 'run.start &middot; ollama/qwen-coder &middot; local'],
        [2600, 'line', 'LEDGER', 'budget check &middot; job $2.00 &middot; day $5.00', 'dim'],
        [3600, 'call', 'SCOUT', 'web_search', true],
        [5200, 'end', 'FORGE'], [5200, 'line', 'FORGE', 'run.end &middot; 41k tok &middot; $0.000', 'ok'],
        [6400, 'end', 'SCOUT'], [6400, 'line', 'SCOUT', 'run.end &middot; 18k tok &middot; $0.004', 'ok'],
        [7800, 'end', 'NOVA'], [7800, 'line', 'NOVA', 'run.end &middot; 9k tok &middot; $0.031', 'ok'],
        [8600, 'line', 'LEDGER', 'today $0.41 of $5.00 day cap', 'dim']
      ] }
  };
  var ORDER = ['delegate', 'flow', 'tools', 'away', 'ledger'];
  var WHO_COLOR = { ROUTER: '#c9a26a', OUTBOX: '#c9a26a', SCHED: '#c9a26a', LEDGER: '#c9a26a', HARNESS: '#c9a26a', TELEGRAM: '#8fb6d8', YOU: '#efe6d8' };

  /* ---------- app bridge ---------- */
  var app = null;          // the embed's StarnetDemoBridge once the floor is live
  function ready(){
    try {
      var b = frame.contentWindow && frame.contentWindow.StarnetDemoBridge;   // set by app/demo-boot.js once the floor is live
      return (b && b.crew() >= 4) ? b : null;
    } catch (_) { return null; }
  }
  function emit(name, payload){ try { app.emit(name, payload); } catch (_) {} }

  /* ---------- player ---------- */
  var timers = [], live = {}, tokenTimer = 0, current = -1, chStart = 0, chLen = 1, rafId = 0, seq = 0, visible = false, started = false;
  function clearTimers(){ timers.forEach(clearTimeout); timers = []; }
  function endAll(){
    Object.keys(live).forEach(function(id){ emit('agent.run.end', { agentId: id, runId: live[id], reason: 'done', ok: true }); });
    live = {};
  }
  function tokens(){                                      // token flow heats the working desks, as in the app
    Object.keys(live).forEach(function(id){ emit('agent.token', { agentId: id, runId: live[id] }); });
  }
  function esc(s){ return String(s); }                  // scripts are authored HTML above, never user input
  function line(who, html, cls){
    var t = Math.max(0, (performance.now() - chStart) / 1000);
    var li = document.createElement('li');
    var c = (CREW[who] && CREW[who].c) || WHO_COLOR[who] || '#ffc46b';
    li.innerHTML = '<span class="t">' + t.toFixed(1) + 's</span><span class="who" style="--c:' + c + '">' + who + '</span>'
      + '<span class="' + (cls || '') + '">' + esc(html) + '</span>';
    log.appendChild(li);
    while (log.children.length > 14) log.removeChild(log.firstChild);
  }
  function act(step){
    var kind = step[1], who = step[2];
    if (kind === 'line') return line(who, step[3], step[4]);
    var id = aid(who);
    if (kind === 'job') return emit('workitem.placed', { agentId: id, kind: step[3], workitemId: 'demo-' + (++seq), preview: step[4] });
    if (kind === 'start') { live[id] = 'demo-r' + (++seq); return emit('agent.run.start', { agentId: id, runId: live[id], trigger: step[3] }); }
    if (kind === 'end') { if (!live[id]) return; emit('agent.run.end', { agentId: id, runId: live[id], reason: 'done', ok: true }); delete live[id]; return; }
    if (kind === 'call') {
      var cid = 'demo-c' + (++seq);
      emit('agent.tool_call', { agentId: id, name: step[3], callId: cid, runId: live[id] });
      if (step[4] === null) { pendingResult[id] = cid; return; }   // result arrives in its own step (delegation window)
      timers.push(setTimeout(function(){ emit('agent.tool_result', { agentId: id, callId: cid, runId: live[id], isError: !step[4] }); }, 700));
      return;
    }
    if (kind === 'result') { if (pendingResult[id]) emit('agent.tool_result', { agentId: id, callId: pendingResult[id], runId: live[id] }); delete pendingResult[id]; return; }
    if (kind === 'shell') return emit('shell.exec', { agentId: id, runId: live[id] });
    if (kind === 'verify') return emit('verify.result', { agentId: id, runId: live[id], passed: !!step[3] });
  }
  var pendingResult = {};

  function select(i){
    tabs.forEach(function(t, j){
      var on = j === i;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      t.style.setProperty('--p', '0');
    });
    var ch = CH[ORDER[i]];
    titleEl.textContent = ch.title;
    copyEl.innerHTML = ch.copy;
    linkEl.href = ch.link[0];
    linkEl.innerHTML = ch.link[1] + ' &rarr;';
  }
  function progress(){
    cancelAnimationFrame(rafId);
    (function tick(){
      if (current < 0 || !tabs[current]) return;
      var p = Math.min(1, (performance.now() - chStart) / chLen);
      tabs[current].style.setProperty('--p', p.toFixed(3));
      if (p < 1) rafId = requestAnimationFrame(tick);
    })();
  }
  function play(i){
    clearTimers(); endAll(); pendingResult = {};
    current = i; select(i);
    var ch = CH[ORDER[i]];
    log.innerHTML = '';
    chStart = performance.now(); chLen = ch.len;
    if (!app || !visible) return;
    ch.s.forEach(function(step){ timers.push(setTimeout(function(){ act(step); }, step[0])); });
    if (reduce) return;                                   // reduced motion: play once, never advance on its own
    progress();
    // let crates already on the belt clear before the next chapter starts
    timers.push(setTimeout(function(){ play((current + 1) % ORDER.length); }, ch.len + 1200));
  }

  /* tabs: click/arrow keys jump to a chapter; autoplay continues from there */
  tabs.forEach(function(t, i){
    t.addEventListener('click', function(){ play(i); });
    t.addEventListener('keydown', function(e){
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var n = (i + d + tabs.length) % tabs.length;
      tabs[n].focus(); play(n);
    });
  });

  /* only run while the console is on screen — the app keeps rendering, the script pauses */
  function setVisible(v){
    if (v === visible) return;
    visible = v;
    if (!visible) { clearTimers(); endAll(); clearInterval(tokenTimer); tokenTimer = 0; cancelAnimationFrame(rafId); return; }
    if (app) { tokenTimer = setInterval(tokens, 220); play(current < 0 ? 0 : current); }
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function(en){ setVisible(en[0].isIntersecting); }, { threshold: 0.25 }).observe(root);
  } else { visible = true; }
  document.addEventListener('visibilitychange', function(){ if (document.hidden) setVisible(false); });

  /* boot: wait for the embedded app to reach the live floor with its crew, then start */
  select(0);
  (function wait(){
    var w = still ? { emit: function(){} } : ready();
    if (!w) { setTimeout(wait, 300); return; }
    app = w;
    setTimeout(function(){
      if (!still) clip.classList.add('live');
      started = true;
      if (visible) { tokenTimer = setInterval(tokens, 220); play(current < 0 ? 0 : current); }
    }, still ? 0 : 1200);
  })();
  window.__starnetDemo = { play: play, state: function(){ return { ready: !!app, started: started, visible: visible, chapter: ORDER[current], live: Object.keys(live) }; } };
})();
