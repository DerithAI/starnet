/* test/workflow-panel-sendto-truth.test.js — what the Workflow panel promises about SEND TO and TOO LONG is what the station
   does (release review 2026-10-12, wave 2, agent lane). The panel's OWN functions (sliced from frontend/app/workflowpanel.js
   with A.fnBody, run in a vm) over a REAL station (worldmodel + layout engine) and the REAL routing compiler:
     conveyor-ui-01  SEND IT DOWN THE LINE / RUN ONE REAL JOB say a SEND TO starts another line's paid job; the result card says
                     where the job went (SENT ON / NOT SENT ON from the job's record, else only that the line sends on)
     conveyor-ui-05  the OUTBOX card promises a hand-off only for a job that finishes cleanly, and says so when the target line
                     would refuse it (no agent on its first BAY, its daily limit spent)
     conveyor-ui-16  an OUTBOX on no line shows one sentence, not one dead chip + the same reason per line; a reason several
                     lines share is said once
     conveyor-ui-06  TOO LONG says "the longest way", never "every job would stop" (a FILTER line's short ways still finish) */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const P = require('../frontend/app/pipeline.js');
const WM = require('../frontend/app/worldmodel.js');
const LE = require('../frontend/app/lineedit.js');
const WL = require('../frontend/app/workflowline.js');
const rd = p => fs.readFileSync(path.join(__dirname, '..', p), 'utf8').replace(/\r\n/g, '\n');
const panel = rd('frontend/app/workflowpanel.js'), build = rd('frontend/app/build.js'), commands = rd('frontend/app/stationcommands.js');
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const strip = h => String(h).replace(/<[^>]+>/g, '');
// the floor's own finding sentences (build.js VAL_LABEL / VAL_WHY → valWhy), the H.valLabel the real panel is wired with
// (build.js `valLabel: valWhy`) — the OUTBOX card says PRIVATE FILES through it (floor lane M19 / M29)
const valWhy = (() => {
  const a = build.indexOf('  const VAL_LABEL = {'), z = build.indexOf('  const valWhy = code => ');
  A.ok(a >= 0 && z > a && z - a < 20000, 'sliced the floor\'s VAL_LABEL / VAL_WHY tables');
  return vm.runInNewContext(build.slice(a, build.indexOf('\n', z)) + '\nvalWhy', {});
})();

function lines(n) {
  const d = WM.starterDoc();
  for (const id in d.rooms) for (const r of d.rooms[id].rects) { r.x2 = 44; r.y2 = 44; }
  const st = WM.create(d);
  const out = [];
  for (let i = 0; i < n; i++) {
    const r = LE.placeBlueprint(st, 'research_line', { x: 8, y: 4 + i * 12 });
    if (!r.ok) throw new Error('placeBlueprint ' + JSON.stringify(r));
    const of = t => r.ids.filter(id => st.propById(id).t === t);
    out.push({ intake: of('intake')[0], bays: of('bay'), outbox: of('outbox')[0] });
  }
  for (const p of st.props()) if (p.t === 'bay' && !p.agentId) st.assignPropAgent(p.id, 'ag_' + p.id);
  return { st, L: out };
}
// the panel, over a live station: the functions it paints the OUTBOX card and the send helpers with
function panelOn(st, opts) {
  const o = opts || {};
  const geo = () => st.projectGeometry();
  const H = {
    station: () => st, plan: () => P.compileRoutingPlan(geo()), sfx() {}, flashTip() {}, valLabel: valWhy,
    lineOfProp: id => (P.lineComponents(geo()) || []).find(c => c.props.indexOf(id) >= 0) || null,
    sampleState: () => o.sample || null, sampleHTML: () => '<div class="fl-result bad">REFUSED</div>', stopSample: null
  };
  const headers = ['function sendChoices(outboxId)', 'function sendState(outboxId)', 'function sendTarget(outboxId)', 'function onwardNote()', 'function sendBlocked(outboxId, name)',
    'function paintOutbox(body, f, p)', 'function sendDynHTML(f)', 'function jobResultHTML(mine, f)', 'function loopNotes(text)', 'function notShippedNote(mine)'];
  // the panel's one SEND TO chip namer (floor lane's one line-name rule: the chip carries worldmodel.lineName) — a const arrow,
  // so it is sliced by its own line, not by fnBody
  const chipAt = panel.indexOf('  const sendChipName = c => ');
  A.ok(chipAt >= 0, 'the panel names its SEND TO chips with sendChipName');
  const chipName = panel.slice(chipAt, panel.indexOf('\n', chipAt));
  const src = chipName + '\n' + headers.map(h => { const b = A.fnBody(panel, h); A.ok(b.length > 20 && b.length < 20000, 'sliced ' + h); return b; }).join('\n');
  const names = headers.map(h => /function (\w+)\(/.exec(h)[1]);
  const ctx = vm.createContext({ esc, H, Pipeline: P, World: o.world, WL: () => WL, JSON, Object, Array, String, Set, Map, Math,
    comp: () => o.comp || null, S: { testJob: {} }, $: () => null, note() {}, paint() {}, prop: id => st.propById(id), nameOf: a => String(a).toUpperCase(),
    stepText: () => 'reply', stepOut: {}, exampleKept: () => false, notRightHTML: () => '', runEnd: r => r, liveText: () => '' });
  return vm.runInContext("const LOOP_NOTE = /^\\[LOOP — (exhausted|escalated): (\\d+) pass(?:es)? round the gate[^\\n]*\\]\\s*/gm;\n" + src + '\n({ ' + names.join(', ') + ' })', ctx);
}
const card = (fns, st, outboxId) => { const b = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] }; fns.paintOutbox(b, null, st.propById(outboxId)); return b.innerHTML; };

/* ---------- conveyor-ui-05: the OUTBOX card promises only what the station does ---------- */
{
  const { st, L: [a, b] } = lines(2);
  st.setPropLabel(b.intake, 'B');
  A.ok(st.setSendTo(a.outbox, b.intake).ok, 'LINE A sends to LINE B');
  let fns = panelOn(st);
  let html = card(fns, st, a.outbox), note = strip((/id="send-note">([\s\S]*?)<\/p>/.exec(html) || [])[1] || '');
  A.ok(/^Every job that finishes cleanly here is sent on to LINE B — that line’s crew works it next, under its own budget\./.test(note), 'the SEND TO note promises only a cleanly finished job — ' + note);
  A.ok(!/Every job that lands in this OUTBOX rides on/.test(html), '…never "every job that lands in this OUTBOX rides on"');
  A.ok(!/id="send-blocked"/.test(html), 'a crewed target with no spent cap carries no warning');
  // the target's first BAY loses its agent: the hand-off runner would refuse ("routes work to no crewed dock")
  for (const id of b.bays) st.assignPropAgent(id, '');
  fns = panelOn(st);
  html = card(fns, st, a.outbox);
  const warn = strip((/id="send-blocked">([\s\S]*?)<\/p>/.exec(html) || [])[1] || '');
  A.ok(/^LINE B has no agent on its first BAY yet — nothing is sent on until it has one\.$/.test(warn), 'an uncrewed target line is said on the card — ' + warn + ' :: ' + strip(html).slice(0, 400));
  for (const id of b.bays) st.assignPropAgent(id, 'ag_' + id);
  // the target line's daily limit is spent (the LINE BUDGET ledger the floor reads)
  const planB = P.compileRoutingPlan(st.projectGeometry()), toLine = planB.sendTo[a.outbox].toLine;
  const world = { lineStatsFor: id => id === toLine ? { usdToday: 1, capUsdPerDay: 1 } : null };
  html = card(panelOn(st, { world }), st, a.outbox);
  A.ok(/LINE B has spent its \$1\.00 daily limit — nothing is sent on until tomorrow, or until its LINE BUDGET is raised\./.test(strip(html)), 'a target whose daily limit is spent is said on the card');
  html = card(panelOn(st, { world: { lineStatsFor: () => ({ usdToday: 0.4, capUsdPerDay: 1 }) } }), st, a.outbox);
  A.ok(!/id="send-blocked"/.test(html), '…a target under its limit is not');
  html = card(panelOn(st, { world: { lineStatsFor: () => null } }), st, a.outbox);
  A.ok(!/id="send-blocked"/.test(html), '…and a spend the floor has not read says nothing (never a guess)');
  // the strip tip and the lead's overview say the same
  const stripFn = A.fnBody(panel, 'function paintStrip(f)');
  A.ok(/every job that finishes cleanly is sent on to ' \+ sendsTo\.name/.test(stripFn) && !/every job that lands in it rides on/.test(stripFn), 'the strip\'s OUTBOX tip says the same');
  A.ok(/Then every job it finishes cleanly is sent on to /.test(commands) && !/Then every job it finishes is sent on/.test(commands), 'the lead\'s station.layout overview says the same');
  // (wave-2 repair) the OUTBOX's Build Library card and the release notes draft say it too — never "every job … rides on"
  const outboxDesc = (/\{ id: "outbox", label: "OUTBOX"[^\n]*desc: "([^"]*)"/.exec(rd('frontend/app/propsprites.js')) || [])[1] || '';
  A.ok(/Drag it onto another line's INBOX \(SEND TO\) and every job that finishes cleanly is sent on to that line \(its crew, its budget\)\./.test(outboxDesc) && !/rides on/.test(outboxDesc), 'the OUTBOX catalog card promises only a cleanly finished job — ' + outboxDesc);
  const notes = rd('docs/releases/next/NOTES_DRAFT.md');
  A.ok(/every job that finishes cleanly is sent on to it/.test(notes) && !/every finished job rides on/.test(notes), 'the release notes draft says the same');
  // (docs-claims-08) the floor's own SEND TO tips — arming an OUTBOX and the SEND TO it set — say it too
  A.ok(/'SEND TO — now click another line’s INBOX: each job that finishes cleanly here starts a job on it'/.test(build)
    && /'SENDS TO ' \+ sendName\(ip\.id\) \+ ' — each job that finishes cleanly here starts a job on it'/.test(build)
    && !/every job that lands in this OUTBOX rides on/.test(build), 'the build floor\'s SEND TO tips promise only a cleanly finished job');
}

/* ---------- conveyor-ui-16: an OUTBOX on no line ---------- */
{
  const { st, L: [a, b, c] } = lines(3);
  st.setPropLabel(b.intake, 'B'); st.setPropLabel(c.intake, 'C');
  const lob = st.addProp({ t: 'outbox', x: 40, y: 34, w: 2, h: 2 }).id;
  let html = card(panelOn(st), st, lob);
  A.ok(!/data-sendto="p/.test(html) && !/data-sendto="[^"]+"/.test(html), 'an OUTBOX on no line lists no line chips (each would be disabled for the same reason) — ' + strip(html).slice(0, 300));
  A.eq((html.match(/ends no line yet/g) || []).length, 0, '…and no per-line copy of "ends no line yet"');
  A.ok(/Once this OUTBOX ends a line, pick the line its finished work goes on to\./.test(html), 'it says once what to do first');
  A.ok(!/data-sendto=""/.test(html), '…with no NOWHERE to press when it points nowhere');
  A.ok(!/Or drag this OUTBOX onto another line’s INBOX/.test(html) && !/This line’s work stops here/.test(html), '…and no drag hint or "this line" sentence for an OUTBOX on no line');
  // a stale pointer on it: NOWHERE stays reachable and the note says why it is off
  const doc = JSON.parse(JSON.stringify(st.serialize()));
  for (const p of doc.props) if (p.id === lob) p.sendTo = b.intake;
  const st2 = WM.create(doc);
  html = card(panelOn(st2), st2, lob);
  A.ok(/data-sendto="" aria-pressed="false">NOWHERE/.test(html), 'a stale pointer keeps NOWHERE to clear it');
  A.ok(/Its SEND TO <b>LINE B<\/b> is off, so nothing is sent on/.test(html), '…and says it is off, and why');
  // each line's own reason stays its own (a circle names the line that closes it)…
  A.ok(st.setSendTo(b.outbox, c.intake).ok && st.setSendTo(c.outbox, a.intake).ok, 'B → C → A');
  html = card(panelOn(st), st, a.outbox);
  let whys = html.match(/class="wf-help dim wf-sendwhy">[^<]*/g) || [];
  A.ok(whys.length === 2 && /LINE B — That would send work round in a circle — LINE B/.test(whys[0]) && /LINE C — That would send work round in a circle — LINE C/.test(whys[1]), 'two different reasons are two lines — ' + JSON.stringify(whys));
  // …and one reason several lines share is said once, naming them
  const shared = Object.create(st);
  shared.sendToChoices = () => [{ intakeId: 'i1', name: 'LINE B', on: false, refusal: { msg: 'That INBOX is being rebuilt.' } }, { intakeId: 'i2', name: 'LINE C', on: false, refusal: { msg: 'That INBOX is being rebuilt.' } }];
  html = card(panelOn(shared), shared, a.outbox);
  whys = html.match(/class="wf-help dim wf-sendwhy">[^<]*/g) || [];
  A.ok(whys.length === 1 && /LINE B, LINE C — That INBOX is being rebuilt\./.test(whys[0]), 'a shared reason is said once, naming both lines — ' + JSON.stringify(whys));
}

/* ---------- conveyor-ui-01: a job sent on a SEND TO line says it starts another paid job ---------- */
{
  const { st, L: [a, b] } = lines(2);
  st.setPropLabel(b.intake, 'B');
  const plan0 = P.compileRoutingPlan(st.projectGeometry());
  const compA = (P.lineComponents(st.projectGeometry()) || []).find(c => c.props.indexOf(a.intake) >= 0);
  let fns = panelOn(st, { comp: compA });
  A.eq(fns.onwardNote(), '', 'a line with no SEND TO adds nothing to the send box');
  A.ok(st.setSendTo(a.outbox, b.intake).ok, 'A sends to B');
  fns = panelOn(st, { comp: compA });
  const say = strip(fns.onwardNote());
  A.ok(/^ When it finishes cleanly it is sent on to LINE B: that line’s crew starts a job of its own on the result, at its own cost\.$/.test(say), 'the send box says the job goes on to LINE B, at that line\'s own cost — ' + say);
  const box = strip(fns.sendDynHTML(null));
  A.ok(/lands in this line’s OUTBOX and is also filed in DELIVERABLES\. When it finishes cleanly it is sent on to LINE B/.test(box), 'SEND IT DOWN THE LINE says it — ' + box);
  A.ok(/body = '<p class="wf-help">Your test job runs through the line for real, end to end: real agents, real cost, and the result lands in this line’s <b>OUTBOX<\/b> and is also filed in <b>DELIVERABLES<\/b>, like any job\.' \+ onwardNote\(\) \+ '<\/p>'/.test(A.fnBody(panel, 'function testPickerHTML(s)')), 'RUN ONE REAL JOB says it too');
  // the result card
  const key = compA.key, view = { ok: true, stages: ['AG'], usd: 0.01, reply: 'x' }, runs = [{ runId: 'r1', dockId: a.bays[1], agentId: 'ag', reason: 'done', usd: 0.01 }];
  const world = { lineName: id => (id === plan0.lineOfProp[b.intake] ? 'LINE B' : null) };
  const res = (mine, w) => strip(panelOn(st, { comp: compA, world: w || world }).jobResultHTML(Object.assign({ key, view, runs, output: 'The result', stamp: 1 }, mine), null));
  A.ok(/Sent on to LINE B — that line works on this result next, at its own cost\. OPEN ITS JOB/.test(res({ sentTo: { line: plan0.lineOfProp[b.intake], jobId: 'job-2', name: '' } })), 'a job the record says was sent on says SENT ON TO, named by the floor, with its job');
  A.ok(/NOT sent on to LINE B — LINE B reached its \$1\.00 daily limit\./.test(res({ sentTo: { line: 'x', name: 'B', refused: 'LINE B reached its $1.00 daily limit' } })), 'a refused hand-off says NOT sent on, with why');
  const onlyPtr = res({ sentTo: null, onward: [{ lineId: plan0.lineOfProp[b.intake] }] });
  A.ok(/This line sends its finished work on to LINE B \(SEND TO\) — WORKFLOWS › LAST JOBS shows that line’s job, or why it was not sent\./.test(onlyPtr) && !/Sent on to/.test(onlyPtr), 'with no record yet it says only that the line sends on — never "sent" — ' + onlyPtr);
  A.ok(!/sent on/i.test(res({ sentTo: null, onward: [] })), 'a line that sends nowhere says nothing about it');
  A.ok(!/sent on/i.test(strip(panelOn(st, { comp: compA, world }).jobResultHTML({ key, view: { ok: false, stages: [], usd: 0.01 }, runs, output: '', stamp: 1, sentTo: { line: 'x', name: 'B' } }, null))), 'a job that did not finish cleanly is never said to be sent on');
  // build.js keeps what the sample answered
  const run = build.slice(build.indexOf('  function finRunSample(c, options = {}) {'), build.indexOf('  function finStopSample() {'));
  A.ok(run.length > 200 && run.length < 6000, 'sliced finRunSample (' + run.length + ' chars)');
  A.ok(/sentTo: \(response && response\.sentTo && typeof response\.sentTo === 'object'\) \? response\.sentTo : null, onward: Array\.isArray\(response\?\.onwardDestinations\) \? response\.onwardDestinations : \[\]/.test(run), 'the sample result keeps the job\'s sentTo and the line\'s onwardDestinations');
  A.ok(/\$\$\('\[data-open-job\]'\)\.forEach\(b => \{ b\.onclick = \(\) => \{ H\.sfx\('click'\); saveOpenFields\(\); H\.openTerm\('workflows'\); if \(typeof WorkflowsWindow !== 'undefined' && WorkflowsWindow\.showJob\) WorkflowsWindow\.showJob\(b\.dataset\.openJob\); \}; \}\);/.test(A.fnBody(panel, 'function wireJob()')), 'OPEN ITS JOB opens that job in WORKFLOWS');
}

/* ---------- wave-2 repair: a hand-off the station would refuse is never promised; the job card says only where THIS job went ---------- */
{
  const { st, L: [a, b] } = lines(2);
  st.setPropLabel(b.intake, 'B');
  A.ok(st.setSendTo(a.outbox, b.intake).ok, 'A sends to B');
  const compA = (P.lineComponents(st.projectGeometry()) || []).find(c => c.props.indexOf(a.intake) >= 0);
  const toLine = P.compileRoutingPlan(st.projectGeometry()).sendTo[a.outbox].toLine;
  // the target's first BAY has no agent: the hand-off runner refuses ("routes work to no crewed dock")
  for (const id of b.bays) st.assignPropAgent(id, '');
  let fns = panelOn(st, { comp: compA });
  let say = strip(fns.onwardNote());
  A.ok(/^ Its SEND TO LINE B is set, but nothing will be sent on: LINE B has no agent on its first BAY yet\.$/.test(say), 'an uncrewed target: the send box says nothing will be sent on, and why — ' + say);
  A.ok(!/starts a job of its own/.test(say), '…never the promise of a paid job the station would refuse');
  A.ok(/lands in this line’s OUTBOX and is also filed in DELIVERABLES\. Its SEND TO LINE B is set, but nothing will be sent on: LINE B has no agent on its first BAY yet\./.test(strip(fns.sendDynHTML(null))), 'SEND IT DOWN THE LINE says it too');
  A.ok(/LINE B has no agent on its first BAY yet — nothing is sent on until it has one\./.test(strip(card(fns, st, a.outbox))), 'the OUTBOX card says the same refusal (one predicate)');
  for (const id of b.bays) st.assignPropAgent(id, 'ag_' + id);
  // the target's daily limit is spent
  say = strip(panelOn(st, { comp: compA, world: { lineStatsFor: id => (id === toLine ? { usdToday: 2, capUsdPerDay: 1.5 } : null) } }).onwardNote());
  A.ok(/^ Its SEND TO LINE B is set, but nothing will be sent on: LINE B has spent its \$1\.50 daily limit\.$/.test(say), 'a target whose daily limit is spent: nothing will be sent on — ' + say);
  say = strip(panelOn(st, { comp: compA, world: { lineStatsFor: () => ({ usdToday: 0.2, capUsdPerDay: 1.5 }) } }).onwardNote());
  A.ok(/^ When it finishes cleanly it is sent on to LINE B: that line’s crew starts a job of its own on the result, at its own cost\.$/.test(say), 'under its limit the promise stands — ' + say);
  say = strip(panelOn(st, { comp: compA, world: { lineStatsFor: () => null } }).onwardNote());
  A.ok(/When it finishes cleanly it is sent on to LINE B/.test(say), '…and a spend the floor has not read is never a refusal');
}
{
  // a SORTING OFFICE: two finished lanes, each into its OWN OUTBOX — only the first sends on
  const d = WM.starterDoc();
  for (const id in d.rooms) for (const r of d.rooms[id].rects) { r.x2 = 60; r.y2 = 44; }
  const st = WM.create(d);
  const so = LE.placeBlueprint(st, 'sorting_office', { x: 8, y: 4 });
  const sb = so.ids.filter(id => st.propById(id).t === 'bay'), [o1, o2] = so.ids.filter(id => st.propById(id).t === 'outbox');
  const rb = LE.placeBlueprint(st, 'research_line', { x: 8, y: 24 });
  const bIn = rb.ids.find(id => st.propById(id).t === 'intake');
  for (const p of st.props()) if (p.t === 'bay' && !p.agentId) st.assignPropAgent(p.id, 'ag_' + p.id);
  st.setPropLabel(bIn, 'B');
  A.ok(o1 && o2 && st.setSendTo(o1, bIn).ok, 'a two-OUTBOX line; only OUTBOX 1 sends on');
  const plan = P.compileRoutingPlan(st.projectGeometry()), compS = (P.lineComponents(st.projectGeometry()) || []).find(c => c.props.indexOf(sb[0]) >= 0);
  const toLine = plan.sendTo[o1].toLine;
  A.eq((P.sendToOf(plan, compS.key, sb[0]) || {}).outboxId, o1, '(fixture) BAY 1 ships into the sending OUTBOX');
  A.eq(P.sendToOf(plan, compS.key, sb[1]), null, '(fixture) BAY 2 ships into the OUTBOX that sends nowhere');
  const fns = panelOn(st, { comp: compS, world: { lineName: id => (id === toLine ? 'LINE B' : null) } });
  const view = { ok: true, stages: ['AG'], usd: 0.01, reply: 'x' };
  // the route lists every SEND TO of the line (onwardDestinations): the card must not read that as THIS job's hand-off
  const res = dock => strip(fns.jobResultHTML({ key: compS.key, view, runs: [{ runId: 'r1', dockId: dock, agentId: 'ag', reason: 'done', usd: 0.01 }], output: 'R', stamp: 1, sentTo: null, onward: [{ lineId: toLine }] }, null));
  A.ok(!/LINE B/.test(res(sb[1])) && !/sends? (its finished work )?on/.test(res(sb[1])), 'a job that landed in the OUTBOX that sends nowhere says nothing about a hand-off — ' + res(sb[1]).slice(0, 200));
  A.ok(/This line sends its finished work on to LINE B \(SEND TO\) — WORKFLOWS › LAST JOBS shows that line’s job, or why it was not sent\./.test(res(sb[0])), 'a job that landed in the sending OUTBOX says the line sends it on');
  A.ok(/An OUTBOX on this line sends on to LINE B \(SEND TO\) — if this job was handed on, WORKFLOWS › LAST JOBS shows that line’s job, or why it was not sent\./.test(res('p-gone')), 'where the job landed is not on the floor: said conditionally, never "sent" — ' + res('p-gone').slice(0, 200));
  // RUN ONE REAL JOB on a two-OUTBOX line says which jobs are sent on
  A.ok(/^ When it finishes cleanly in an OUTBOX that sends on, it goes on to LINE B: that line’s crew starts a job of its own on the result, at its own cost\.$/.test(strip(fns.onwardNote())), 'the send box says only a job in the sending OUTBOX goes on — ' + strip(fns.onwardNote()));
}

/* ---------- wave-2 repair: the floor FINISH card's ③ RUN ONE REAL JOB says what the panel's key says ---------- */
{
  const fin = ['  function finOnwardPromise(c) {', '  function finOnwardHTML(sr) {'].map(h => { const b = A.fnBody(build, h); A.ok(b.length > 50 && b.length < 6000, 'sliced ' + h.trim()); return b; }).join('\n');
  const { st, L: [a, b] } = lines(2);
  st.setPropLabel(b.intake, 'B');
  const compA = () => (P.lineComponents(st.projectGeometry()) || []).find(c => c.props.indexOf(a.intake) >= 0);
  const finOn = (world) => {
    const ctx = vm.createContext({ esc, WorkflowLine: WL, Pipeline: P, valPlan: P.compileRoutingPlan(st.projectGeometry()), opts: { world }, String, Object, Array, Set });
    return vm.runInContext(fin + '\n({ finOnwardPromise, finOnwardHTML })', ctx);
  };
  const lineB = () => P.compileRoutingPlan(st.projectGeometry()).lineOfProp[b.intake];
  const world = { lineName: id => (id === lineB() ? 'LINE B' : null), lineStatsFor: () => null };
  A.eq(finOn(world).finOnwardPromise(compA()), '', 'a line with no SEND TO adds nothing to ③');
  A.ok(st.setSendTo(a.outbox, b.intake).ok, 'A sends to B');
  let f = finOn(world);
  A.eq(f.finOnwardPromise(compA()), 'When it finishes cleanly it is sent on to LINE B: that line’s crew starts a job of its own on the result, at its own cost.', '③ RUN ONE REAL JOB says the job starts LINE B\'s own paid job, in the panel\'s words');
  for (const id of b.bays) st.assignPropAgent(id, '');
  A.eq(finOn(world).finOnwardPromise(compA()), 'Its SEND TO LINE B is set, but nothing will be sent on: LINE B has no agent on its first BAY yet.', '…and a target that would refuse it says so instead');
  for (const id of b.bays) st.assignPropAgent(id, 'ag_' + id);
  f = finOn(world);
  const key = compA().key, view = { ok: true, stages: ['AG'], usd: 0.01, reply: 'x' }, runs = [{ runId: 'r1', dockId: a.bays[1], agentId: 'ag', reason: 'done', usd: 0.01 }];
  const out = sr => strip(f.finOnwardHTML(Object.assign({ key, view, runs }, sr)));
  A.ok(/^SENT ON to LINE B — its crew works this result next, at its own cost$/.test(out({ sentTo: { line: lineB(), jobId: 'job-2', name: '' } })), 'the FINISH card says SENT ON from the job\'s record — ' + out({ sentTo: { line: lineB(), jobId: 'job-2' } }));
  A.ok(/^NOT SENT ON to LINE B — LINE B reached its \$1\.00 daily limit$/.test(out({ sentTo: { line: 'x', name: 'B', refused: 'LINE B reached its $1.00 daily limit' } })), '…NOT SENT ON with why');
  A.ok(/^SEND TO this line sends its finished work on to LINE B — WORKFLOWS › LAST JOBS shows that line’s job, or why it was not sent$/.test(out({ sentTo: null, onward: [{ lineId: lineB() }] })), '…and with no record yet, only that the line sends on');
  A.eq(out({ sentTo: null, onward: [] }), '', 'a line that sends nowhere says nothing');
  A.eq(strip(f.finOnwardHTML({ key, view: { ok: false, stages: [], usd: 0 }, runs, sentTo: { line: 'x', name: 'B' } })), '', 'a job that did not finish cleanly is never said to be sent on');
  // the card wires both: the promise in ③'s tip and under it (before a result), the outcome beside RAN / COST / SAID
  const render = A.fnBody(build, '  function renderFinCard() {');
  A.ok(/const onward = st\.crewLeft === 0 \? finOnwardPromise\(c\) : '';/.test(render) &&/'run ONE real job through the whole line \(your INBOX test job, if you wrote one\)' \+ \(onward \? '\. ' \+ onward : ''\)/.test(render), '③\'s tip carries the SEND TO promise');
  A.ok(/\$\{sr && sr\.view \? finSampleHTML\(sr\.view\) \+ finOnwardHTML\(sr\) : onward \? '<div class="fl-result fl-onward"><span class="fl-result-k">SEND TO<\/span> ' \+ esc\(onward\) \+ '<\/div>' : ''\}/.test(render), '…and under the key until a result replaces it with SENT ON / NOT SENT ON');
  A.ok(/const sig = \[[^\]]*\bonward\b[^\]]*\]\.join\('\|'\);/.test(render) && render.indexOf('finOnwardPromise(c)') < render.indexOf('const sig = '), 'the card repaints when the SEND TO (or its target\'s refusal) changes: the promise is in the card\'s signature');
}

/* ---------- conveyor-ui-06: TOO LONG says the longest way ---------- */
{
  const t = WL.tooLongText({ stages: 8, maxHops: 6 });
  A.ok(/^too long: the longest way runs 8 stages, the LINE BUDGET allows 7$/.test(t), 'readiness says the longest way — ' + t);
  const row = A.fnBody(panel, 'function paintTooLong(f)');
  A.ok(/the longest way through this line runs <b>/.test(row) && /so a job that goes that way would stop at stage/.test(row) && !/every job would stop/.test(row), 'the panel\'s TOO LONG row says the longest way, not every job');
  const why = A.fnBody(build, 'function findingWhy(e)');
  A.ok(/the longest way through this line runs ' \+ e\.stages \+ ' stages/.test(why) && !/every job would stop/.test(why), 'the floor\'s hover card says it too');
  A.ok(/LINE_TOO_LONG: 'Too long — the longest way through this line runs more stages than its LINE BUDGET allows, so a job that goes the longest way would stop part-way/.test(build), '…and the finding\'s plain sentence');
}

A.report('workflow-panel-sendto-truth.test');
