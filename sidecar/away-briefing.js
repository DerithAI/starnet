/* sidecar/away-briefing.js — THE ONE RETURN REPORT (pure). "While you were away", composed from durable truth.

   THE PROBLEM THIS CLOSES (2026-10-04 audit). Unattended work started from ~8 triggers and landed on ~10
   surfaces: a fresh rail session per routine fire, one per away build, a COMMS digest that skipped every
   cron/workshop/night-shift run (the `internal` stream-prefix fold), a morning report that knew only the night
   shift, a drafts nudge, a workshop reveal, toasts. Coming back meant opening each one and stitching the story
   together yourself. This module folds ALL of it into ONE briefing — delivered as one assistant turn into ONE
   durable session (stream 'briefing'), so the Commander reads one message and replying continues from it.

   PURE: no IO, no clock, no fs. The host (index.js) gathers the inputs from the real stores (runStore rows,
   validated pending workshop manifests, night-shift drafts, cron jobs, the resolved night focus) and owns the
   durable "briefed through" stamp. Every line in the text maps to an input row — truthful telemetry: a count is
   a count of real rows, an excerpt is the run's own recorded delivery text, nothing is synthesized or padded.
   Nothing to say → empty:true and NO briefing (never nag). */
'use strict';

const STREAM_ID = 'briefing';
const TITLE = 'While you were away';
const EXCERPT_MAX = 140;
const TITLE_MAX = 80;
const MAX_ROUTINES = 6;
const MAX_BUILDS = 4;
const MAX_DRAFTS = 3;
const MAX_LOOPS = 4;

const str = (v) => (v == null ? '' : String(v));
const num = (v) => ((typeof v === 'number' && isFinite(v)) ? v : (Number.isFinite(Number(v)) ? Number(v) : 0));
function clip(s, max) {
  const t = str(s).replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
  return t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
}

const RULE_LINE = /^[-*_]{3,}$/;
const HEADING_LINE = /^#{1,6}\s/;
const FENCE_LINE = /^(`{3,}|~{3,})/;
// a pipe-table row or its |---|:--| separator — cells, never a sentence
const TABLE_LINE = /^\||^:?-{3,}:?\s*\|/;
/* A LEAD-IN IS NOT AN OUTCOME (live walk 10-14: "Latest: COPY's draft is in the context at the top. Let me analyze it
   now." — a worker's opening line, quoted as what the job produced). Decided by the text's STRUCTURE, never by its
   words: the opening paragraph is a lead-in when the next block is a rule or a heading (the answer starts there), or
   when it ends in a colon AND the block after it opens with a sentence (review 10-14: a colon before a code fence, a
   table or a list of bare names introduces material, not an outcome — quoting "python" or "| a | b |" is worse than
   the lead-in). Only the FIRST paragraph, and only when something follows. */
function afterLeadIn(lines) {
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const first = lines[i] == null ? '' : lines[i].trim();
  if (!first || HEADING_LINE.test(first) || RULE_LINE.test(first) || FENCE_LINE.test(first) || /^✦\s/.test(first)) return lines;
  let end = i;
  while (end < lines.length && lines[end].trim()) end++;   // end = the first blank line after the opening paragraph
  let next = end;
  while (next < lines.length && !lines[next].trim()) next++;
  if (next >= lines.length || next === end) return lines;   // nothing follows it: the paragraph is all there is
  const after = lines[next].trim();
  const handsOver = RULE_LINE.test(after) || HEADING_LINE.test(after)
    || (/:$/.test(lines[end - 1].trim()) && isSentence(readableLine(after)));
  return handsOver ? lines.slice(next) : lines;
}
// one line's readable words: heading/banner/list/quote marks and **, __, ` dropped; '' for a rule, fence or table row
function readableLine(raw) {
  let l = String(raw || '').trim();
  if (!l || RULE_LINE.test(l) || FENCE_LINE.test(l) || TABLE_LINE.test(l)) return '';
  l = l.replace(/^(>\s?)+/, '').trim();
  l = l.replace(/^#{1,6}\s+/, '').replace(/^✦\s+/, '');
  if (!l || RULE_LINE.test(l)) return '';
  return l.replace(/^[-*•]\s+/, '').replace(/\*\*|__|`/g, '').trim();
}
// a sentence, structurally: at least two words with a letter among them (a bare file name or one token is a label)
function isSentence(l) { return /\S\s+\S/.test(l) && /\p{L}/u.test(l); }
function firstReadable(lines) {
  let fenced = false;
  for (const raw of lines) {
    const t = String(raw || '').trim();
    if (FENCE_LINE.test(t)) { fenced = !fenced; continue; }   // code is material, never the outcome sentence
    if (fenced) continue;
    const l = readableLine(t);
    if (l) return clip(l, EXCERPT_MAX);
  }
  return '';
}
// the first readable line of a run's delivered text: skip a lead-in, headings/rules/the routine banner, strip markdown
// marks. A lead-in with nothing readable after it is all the text there is, so it stays.
function excerptOf(text) {
  const lines = str(text).split(/\r?\n/);
  return firstReadable(afterLeadIn(lines)) || firstReadable(lines);
}
function isSilent(text) { return str(text).trim() === '[SILENT]'; }

/* which kind of UNATTENDED work a run row is — or null when it isn't away work at all.
   Interactive runs, delegated children (their parent is the unit of work), reason-only internal self-talk
   (explicit row.internal — recommendations, night-shift planning) and unknown streams are never briefed. */
function kindOf(r) {
  if (!r || typeof r !== 'object' || !r.runId) return null;
  if (r.internal === true) return null;
  if (r.surface === 'interactive') return null;
  if (r.parentRunId) return null;
  const sid = str(r.streamId);
  if (sid.indexOf('cron-') === 0 || (r.cronJobId && sid.indexOf('workshop-') !== 0)) return 'routine';
  if (sid.indexOf('workshop-') === 0 || sid.indexOf('nightshift-act-') === 0) return 'build';
  if (sid.indexOf('loop-') === 0) return 'loop';
  return null;
}
function endedAt(r) { return num(r && (r.endedAt || r.ts)); }
function failed(r) { return !!r && r.reason !== 'done'; }
function failWord(r) {
  const code = str(r && (r.failureCode || r.reason)).replace(/[_-]+/g, ' ').trim();
  return code && code !== 'done' ? code : 'did not finish';
}

// local wall-clock label "Sun 11:40 PM" — tzOffsetMin = minutes to ADD to UTC (the negative of getTimezoneOffset).
function whenLabel(ms, tzOffsetMin) {
  if (!(ms > 0)) return '';
  const d = new Date(ms + num(tzOffsetMin) * 60000);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  let h = d.getUTCHours(); const m = d.getUTCMinutes(); const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12; if (h === 0) h = 12;
  return days[d.getUTCDay()] + ' ' + h + ':' + (m < 10 ? '0' : '') + m + ' ' + ap;
}

/* compose(input) -> { empty, since, through, items[], counts{}, text }
   input = { since, now, tzOffsetMin, runs[], builds[], drafts[], jobs[], loops[], focus }
     runs   — runStore rows (any order); only unattended kinds that ENDED in (since, now] are briefed
     builds — validated, still-UNDECIDED workshop deliverables { runId, agentId, title, summary, builtAt }
     drafts — night-shift drafts { title, at }
     jobs   — cron jobs { id, name }   (names the routine rows)
     loops  — { id, name }             (names the loop rows)
     focus  — the resolved night focus { title, why[] } or null (the "next up" line; caller decides relevance)
     threads — worker threads { id, parentStreamId } + conversations { id, title } (names the delegated rows: a
               delegated worker is briefed as part of the CONVERSATION that asked for it, never on its own) */
function compose(input) {
  const o = input || {};
  const since = Math.max(0, num(o.since));
  const now = Math.max(since, num(o.now));
  const jobName = new Map((Array.isArray(o.jobs) ? o.jobs : []).filter(j => j && j.id).map(j => [str(j.id), clip(j.name, TITLE_MAX)]));
  const loopName = new Map((Array.isArray(o.loops) ? o.loops : []).filter(l => l && l.id).map(l => [str(l.id), clip(l.name, TITLE_MAX)]));
  const inWindow = (t) => t > since && t <= now;

  const threadRows = Array.isArray(o.threads) ? o.threads : [];
  const parentOf = new Map(threadRows.filter(t => t && t.id && t.parentStreamId).map(t => [str(t.id), str(t.parentStreamId)]));
  const titleOf = new Map(threadRows.filter(t => t && t.id).map(t => [str(t.id), clip(t.title, TITLE_MAX)]));
  const delegated = new Map();   // parent conversation id -> { kind:'delegated', parentId, name, runs, failed, latest }
  const routines = new Map();   // key -> { kind:'routine', jobId, name, runs, failed, silent, latest }
  const loops = new Map();
  const failedBuilds = [];
  const runs = (Array.isArray(o.runs) ? o.runs : []).slice().sort((a, b) => endedAt(a) - endedAt(b));   // oldest → newest
  for (const r of runs) {
    // DELEGATED WORK (2026-10-09): a worker the overseer dispatched ran in its own thread under a conversation; it is
    // briefed as that conversation's work ("Launch planning: 3 delegated jobs finished"), opened at the conversation.
    const parent = r && r.delegatedBy && r.internal !== true && r.surface !== 'interactive' ? parentOf.get(str(r.streamId)) : '';
    if (parent && inWindow(endedAt(r))) {
      let g = delegated.get(parent);
      if (!g) { g = { kind: 'delegated', parentId: parent, name: titleOf.get(parent) || 'a conversation', runs: 0, failed: 0, latest: null, open: parent }; delegated.set(parent, g); }
      g.runs++;
      // A worker's outcome is its FINAL delivery when it has one: a run can end 'done' with an output that failed its
      // result contract, and a repaired answer differs from the raw execution text. Pending/absent → the execution row.
      const dd = r.dispatchDelivery && r.dispatchDelivery.state === 'final' ? r.dispatchDelivery : null;
      const bad = dd ? str(dd.reason) !== 'done' : failed(r);
      if (bad) g.failed++;
      // The delivery's reason says why when it adds something (an invalid result); one that only repeats the run's
      // own reason ('error') says less than the run's failure code ('rate limit').
      const ddWhy = dd && str(dd.reason) !== str(r.reason) ? str(dd.reason).replace(/[_-]+/g, ' ').trim() : '';
      g.latest = { runId: str(r.runId), at: endedAt(r), failed: bad,
        why: bad ? (ddWhy || failWord(r)) : '',
        excerpt: bad ? '' : excerptOf(dd ? dd.text : r.deliveryText), open: str(r.streamId) };
      continue;
    }
    const kind = kindOf(r);
    if (!kind || !inWindow(endedAt(r))) continue;
    if (kind === 'routine') {
      const key = str(r.cronJobId) || ('title:' + clip(r.sessionTitle || r.title, TITLE_MAX));
      let g = routines.get(key);
      if (!g) { g = { kind: 'routine', jobId: str(r.cronJobId), name: jobName.get(str(r.cronJobId)) || clip(r.sessionTitle || r.title || 'Routine', TITLE_MAX), runs: 0, failed: 0, silent: 0, latest: null }; routines.set(key, g); }
      g.runs++;
      if (failed(r)) g.failed++;
      else if (isSilent(r.deliveryText)) g.silent++;
      g.latest = { runId: str(r.runId), at: endedAt(r), failed: failed(r), why: failed(r) ? failWord(r) : '', excerpt: failed(r) ? '' : (isSilent(r.deliveryText) ? '' : excerptOf(r.deliveryText)), open: str(r.streamId) || ('cron-' + str(r.runId)) };
    } else if (kind === 'loop') {
      const id = str(r.streamId).slice('loop-'.length);
      let g = loops.get(id);
      if (!g) { g = { kind: 'loop', loopId: id, name: loopName.get(id) || clip(r.sessionTitle || r.title || 'Loop', TITLE_MAX), runs: 0, failed: 0, latest: null }; loops.set(id, g); }
      g.runs++;
      if (failed(r)) g.failed++;
      g.latest = { runId: str(r.runId), at: endedAt(r), failed: failed(r), why: failed(r) ? failWord(r) : '', excerpt: failed(r) ? '' : excerptOf(r.deliveryText), open: str(r.streamId) };
    } else if (kind === 'build' && failed(r)) {
      failedBuilds.push({ kind: 'build-failed', runId: str(r.runId), title: clip(r.sessionTitle || r.title || 'an away build', TITLE_MAX), why: failWord(r), at: endedAt(r) });
    }
  }

  const allBuilds = (Array.isArray(o.builds) ? o.builds : []).filter(b => b && b.runId)
    .map(b => ({ kind: 'build', runId: str(b.runId), agentId: str(b.agentId) || 'agent', title: clip(b.title || 'a deliverable', TITLE_MAX), summary: clip(b.summary, EXCERPT_MAX), builtAt: num(b.builtAt), isNew: inWindow(num(b.builtAt)), open: 'workshop-' + str(b.runId) }))
    .sort((a, b) => b.builtAt - a.builtAt);
  const newBuilds = allBuilds.filter(b => b.isNew);
  const olderBuilds = allBuilds.filter(b => !b.isNew);
  const buildTitles = new Set(allBuilds.map(b => b.title.toLowerCase()));
  const drafts = (Array.isArray(o.drafts) ? o.drafts : []).filter(d => d && inWindow(num(d.at)) && str(d.title).trim() && !buildTitles.has(clip(d.title, TITLE_MAX).toLowerCase()))
    .sort((a, b) => num(b.at) - num(a.at)).map(d => ({ kind: 'draft', title: clip(d.title, TITLE_MAX), at: num(d.at) }));

  const routineList = Array.from(routines.values()).sort((a, b) => (b.failed - a.failed) || ((b.latest && b.latest.at) - (a.latest && a.latest.at)));
  const loopList = Array.from(loops.values()).sort((a, b) => (b.latest && b.latest.at) - (a.latest && a.latest.at));
  const delegatedList = Array.from(delegated.values()).sort((a, b) => (b.failed - a.failed) || ((b.latest && b.latest.at) - (a.latest && a.latest.at)));

  // something NEW must have happened inside the window; still-waiting older builds alone never re-brief (anti-nag)
  const hasNews = newBuilds.length || failedBuilds.length || routineList.length || loopList.length || delegatedList.length || drafts.length;
  const counts = {
    newBuilds: newBuilds.length, waitingBuilds: allBuilds.length, failedBuilds: failedBuilds.length,
    routines: routineList.length, routineRuns: routineList.reduce((n, g) => n + g.runs, 0),
    failed: failedBuilds.length + routineList.reduce((n, g) => n + g.failed, 0) + loopList.reduce((n, g) => n + g.failed, 0) + delegatedList.reduce((n, g) => n + g.failed, 0),
    loops: loopList.length, drafts: drafts.length,
    delegated: delegatedList.reduce((n, g) => n + g.runs, 0)
  };
  if (!hasNews) return { empty: true, since, through: now, items: [], counts, text: '' };

  const items = [].concat(newBuilds, failedBuilds, routineList, loopList, delegatedList, drafts);
  if (olderBuilds.length) items.push({ kind: 'builds-waiting', count: olderBuilds.length, runIds: olderBuilds.map(b => b.runId), open: olderBuilds[0].open });

  // ---- the text: needs-you first, then what got done, then ideas, then what's next. Plain words. ----
  const L = [];
  const sinceLabel = whenLabel(since, o.tzOffsetMin);
  L.push('**' + TITLE + '**' + (sinceLabel ? ' · since ' + sinceLabel : ''));
  const needs = [];
  for (const b of newBuilds.slice(0, MAX_BUILDS)) needs.push('Built “' + b.title + '”' + (b.summary ? ' — ' + b.summary.replace(/[.!…\s]+$/, '') : '') + '. It’s waiting on you: open it to keep it or toss it.');
  if (newBuilds.length > MAX_BUILDS) needs.push((newBuilds.length - MAX_BUILDS) + ' more new build' + (newBuilds.length - MAX_BUILDS === 1 ? '' : 's') + ' waiting.');
  if (olderBuilds.length) needs.push(olderBuilds.length + ' earlier build' + (olderBuilds.length === 1 ? ' is' : 's are') + ' still waiting on a decision.');
  for (const f of failedBuilds.slice(0, 2)) needs.push('An away build (“' + f.title + '”) didn’t finish: ' + f.why + '.');
  for (const g of routineList) if (g.latest && g.latest.failed) needs.push('“' + g.name + '” failed' + (g.runs > 1 ? ' (latest of ' + g.runs + ' runs)' : '') + ': ' + g.latest.why + '.');
  for (const g of delegatedList) if (g.failed) needs.push(g.failed + ' delegated job' + (g.failed === 1 ? '' : 's') + ' in “' + g.name + '” didn’t finish' + (g.latest && g.latest.failed ? ': ' + g.latest.why : '') + '.');
  if (needs.length) { L.push(''); L.push('**Waiting on you**'); for (const n of needs) L.push('- ' + n); }

  const done = [];
  for (const g of routineList.slice(0, MAX_ROUTINES)) {
    if (g.latest && g.latest.failed) continue;
    const times = g.runs === 1 ? 'ran' : 'ran ' + g.runs + '×';
    if (g.latest && g.latest.excerpt) done.push('“' + g.name + '” ' + times + '. Latest: ' + g.latest.excerpt);
    else if (g.silent === g.runs) done.push('“' + g.name + '” ' + times + ' — nothing new to report.');
    else done.push('“' + g.name + '” ' + times + '.');
  }
  if (routineList.length > MAX_ROUTINES) done.push((routineList.length - MAX_ROUTINES) + ' more routine' + (routineList.length - MAX_ROUTINES === 1 ? '' : 's') + ' ran.');
  for (const g of loopList.slice(0, MAX_LOOPS)) {
    done.push('Loop “' + g.name + '”: ' + g.runs + ' pass' + (g.runs === 1 ? '' : 'es') + (g.failed ? ' (' + g.failed + ' failed)' : '') + (g.latest && g.latest.excerpt ? '. Latest: ' + g.latest.excerpt : '.'));
  }
  for (const g of delegatedList) {
    const ok = g.runs - g.failed;
    if (ok > 0) done.push('“' + g.name + '”: ' + ok + ' delegated job' + (ok === 1 ? '' : 's') + ' finished' + (g.latest && g.latest.excerpt ? '. Latest: ' + g.latest.excerpt : '.'));
  }
  if (done.length) { L.push(''); L.push('**Done**'); for (const d of done) L.push('- ' + d); }

  if (drafts.length) {
    L.push(''); L.push('**Ideas drafted**');
    for (const d of drafts.slice(0, MAX_DRAFTS)) L.push('- ' + d.title);
    if (drafts.length > MAX_DRAFTS) L.push('- …and ' + (drafts.length - MAX_DRAFTS) + ' more');
  }

  const focus = o.focus && str(o.focus.title).trim() ? o.focus : null;
  if (focus) {
    const why = Array.isArray(focus.why) ? clip(focus.why[0], EXCERPT_MAX) : '';
    L.push(''); L.push('**Next up:** ' + clip(focus.title, TITLE_MAX) + (why ? ' — ' + why : ''));
  }
  L.push(''); L.push('Reply here to keep, change, or continue any of it.');

  return { empty: false, since, through: now, items, counts, text: L.join('\n') };
}

/* absence({ through, now, seen, minAwayMs, firstWindowMs }) -> { brief, since?, through }
   THE ABSENCE (live walk 10-14). `through` is the moment the Commander was last told OR last seen present. A page that
   reloaded mid-session briefed everything that had ended since the PREVIOUS briefing — work the Commander had watched
   land — as a new "While you were away", took the screen off the conversation whose approval was still waiting, and a
   restart twelve minutes later appended a second one. Now the page stamps its presence (seen:true) while the Commander
   is here, and a delivery names the page's own away threshold (minAwayMs): a stamp fresher than that is a reload or a
   restart, not an absence — nothing is briefed and the stamp moves to now. The stamp never moves backwards.
   No threshold named → the original contract (brief whatever ended since the stamp). */
function absence(o) {
  o = o || {};
  const through = Math.max(0, num(o.through)), now = Math.max(0, num(o.now));
  const next = Math.max(through, now);
  if (o.seen === true) return { brief: false, why: 'seen', through: next };
  const min = Math.max(0, Math.min(24 * 3600 * 1000, num(o.minAwayMs)));
  if (min > 0 && through > 0 && now - through < min) return { brief: false, why: 'present', through: next };
  return { brief: true, why: 'away', since: through || Math.max(0, now - Math.max(0, num(o.firstWindowMs))), through: now };
}

/* contextBlock(items) — the agent-facing reference for a run in the briefing session: WHERE each briefed thing
   actually lives, so "apply that build to the game" / "redo the news routine" starts from the work, not from
   scratch. Facts only (ids + jail paths the agent can read with its own tools). Bounded. */
function contextBlock(briefing) {
  const items = briefing && Array.isArray(briefing.items) ? briefing.items : [];
  if (!items.length) return '';
  const L = ['[AWAY BRIEFING CONTEXT] This session is the station\'s "' + TITLE + '" report. The Commander is replying to it. What each item refers to:'];
  for (const it of items.slice(0, 16)) {
    if (it.kind === 'build') L.push('- build "' + it.title + '": files in your workspace at workshop/' + it.runId + '/ (deliverable.json lists them). Still undecided — the Commander keeps/discards it from its session; you may read, extend, or copy it where they ask.');
    else if (it.kind === 'build-failed') L.push('- unfinished build "' + it.title + '" (run ' + it.runId + '): ' + it.why + '. Partial files may be in workshop/' + it.runId + '/.');
    else if (it.kind === 'routine') L.push('- routine "' + it.name + '"' + (it.jobId ? ' (job ' + it.jobId + ')' : '') + ': ' + it.runs + ' run(s), ' + it.failed + ' failed; latest run ' + (it.latest ? it.latest.runId : '?') + '.');
    else if (it.kind === 'loop') L.push('- loop "' + it.name + '" (' + it.loopId + '): ' + it.runs + ' pass(es).');
    else if (it.kind === 'draft') L.push('- night-shift idea draft "' + it.title + '" (not built).');
    else if (it.kind === 'delegated') L.push('- conversation "' + it.name + '" (' + it.parentId + '): ' + it.runs + ' delegated job(s) finished, ' + it.failed + ' failed; each worker\'s work is on that conversation\'s delegation card.');
    else if (it.kind === 'builds-waiting') L.push('- ' + it.count + ' earlier undecided build(s): ' + it.runIds.slice(0, 6).map(id => 'workshop/' + id + '/').join(', ') + '.');
  }
  return L.join('\n');
}

module.exports = { compose, contextBlock, kindOf, excerptOf, absence, whenLabel, STREAM_ID, TITLE };
