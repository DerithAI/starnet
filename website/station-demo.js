/* station-demo.js — the homepage "watch it work" console (2026-10-19).
   Each chapter is a RECORDING of the real StarNet renderer (scripts/record-station-demo.mjs plays the
   chapter's harness events through website/app and records the station canvas). This file plays the
   clip and prints the same chapter's trace lines (station-chapters.js) on the video's own clock, so the
   text and the picture cannot drift. A clip is ~1 MB: it starts in about a second, where booting the
   whole app in an iframe used to take tens of MB and many seconds. The caption says it is a replay. */
(function(){
  'use strict';
  var C = window.StarnetChapters;
  var root = document.querySelector('[data-demo]');
  var video = document.getElementById('crew-video');
  if (!C || !root || !video) return;
  var log = root.querySelector('[data-trace]');
  var tabs = Array.prototype.slice.call(root.querySelectorAll('[data-chapter]'));
  var titleEl = root.querySelector('[data-ch-title]');
  var copyEl = root.querySelector('[data-ch-copy]');
  var linkEl = root.querySelector('[data-ch-link]');
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var REV = '20261019';
  var current = -1, lines = [], shown = 0, rafId = 0, visible = false;
  video.muted = true; video.playsInline = true;

  function clip(key, ext){ return 'assets/station/' + key + '.' + ext + '?v=' + REV; }
  // VP9 is ~half the bytes of the H.264 twin; browsers that only half-promise VP9 (Safari) get the mp4
  var EXT = video.canPlayType && video.canPlayType('video/webm; codecs="vp9"') === 'probably' ? 'webm' : 'mp4';
  function color(who){ return (C.CREW[who] && C.CREW[who].c) || C.WHO_COLOR[who] || '#ffc46b'; }
  function addLine(step){
    var li = document.createElement('li');
    li.innerHTML = '<span class="t">' + (step[0] / 1000).toFixed(1) + 's</span><span class="who" style="--c:' + color(step[2]) + '">' + step[2] + '</span>'
      + '<span class="' + (step[4] || '') + '">' + step[3] + '</span>';        // authored HTML from station-chapters.js, never user input
    log.appendChild(li);
    while (log.children.length > 14) log.removeChild(log.firstChild);
  }
  function select(i){
    tabs.forEach(function(t, j){
      var on = j === i;
      t.setAttribute('aria-selected', on ? 'true' : 'false');
      t.tabIndex = on ? 0 : -1;
      t.style.setProperty('--p', '0');
    });
    var ch = C.CH[C.ORDER[i]];
    titleEl.textContent = ch.title;
    copyEl.innerHTML = ch.copy;
    linkEl.href = ch.link[0];
    linkEl.innerHTML = ch.link[1] + ' &rarr;';
  }
  // trace + tab progress follow the video clock (also correct after a stall or a slow network)
  function tick(){
    cancelAnimationFrame(rafId);
    if (current < 0) return;
    var t = video.currentTime * 1000 - C.LEAD_MS;
    while (shown < lines.length && lines[shown][0] <= t) addLine(lines[shown++]);
    if (video.duration) tabs[current].style.setProperty('--p', Math.min(1, video.currentTime / video.duration).toFixed(3));
    if (!video.paused && !video.ended) rafId = requestAnimationFrame(tick);
  }
  function play(i){
    current = i; select(i);
    var key = C.ORDER[i];
    lines = C.CH[key].s.filter(function(s){ return s[1] === 'line'; });
    shown = 0; log.innerHTML = '';
    video.poster = clip(key, 'jpg');
    video.src = clip(key, EXT);
    if (visible) start();
  }
  function start(){
    var p = video.play();
    if (p && p.catch) p.catch(function(){});
  }
  video.addEventListener('playing', tick);
  video.addEventListener('seeked', tick);
  video.addEventListener('ended', function(){
    tick();
    if (!reduce) play((current + 1) % C.ORDER.length);    // reduced motion: play once, never advance on its own
  });

  tabs.forEach(function(t, i){
    t.addEventListener('click', function(){ play(i); if (!visible) start(); });
    t.addEventListener('keydown', function(e){
      var d = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
      if (!d) return;
      e.preventDefault();
      var n = (i + d + tabs.length) % tabs.length;
      tabs[n].focus(); play(n);
    });
  });

  // only play while the console is on screen; the clip resumes where it paused
  function setVisible(v){
    if (v === visible) return;
    visible = v;
    if (!visible) { video.pause(); cancelAnimationFrame(rafId); return; }
    if (!reduce || video.currentTime > 0) start();
  }
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(function(en){ setVisible(en[0].isIntersecting); }, { threshold: 0.25 }).observe(root);
  } else { visible = true; }
  document.addEventListener('visibilitychange', function(){ if (document.hidden) setVisible(false); });

  play(0);
  window.__starnetDemo = { play: play, state: function(){ return { chapter: C.ORDER[current], t: video.currentTime, paused: video.paused, lines: log.children.length }; } };
})();
