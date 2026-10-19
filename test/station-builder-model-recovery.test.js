'use strict';
/* test/station-builder-model-recovery.test.js — A REAL MODEL BUILDS A LINE IN ONE TRY (rc walk 10-14, A3).

   Asked in a group chat "set up a simple conveyor line for this workflow: draft the post, then review it", the lead
   (Haiku 4.5) sent station.plan TWELVE times and every one was refused: the first picked the right line (revision_loop,
   Writer → Reviewer) but named its steps "Draft" and "Review", and the refusal "This line has steps 1 to 2: 1 Writer,
   2 Reviewer." never said a step is a NUMBER; then it laid the line by hand and every belt it drew from one machine
   onto the next was "a prop is in the way", every piece it set on a plant "overlaps a prop", with no word of WHICH
   prop. It gave up and created a loop nobody asked for: 20 turns, $0.28.

   The walker's twelve requests are replayed here, verbatim, against the walker's own HOME room:
     · a step named for its work ("Draft", "Final review", "Tester") is read for the role it means; steps given in
       order with no number staff the line in that order; the plan says how it matched them;
     · every refusal says what was wrong, the exact shape that is accepted with a tiny example on THIS line's own
       steps, and which lines (or which shape) fit what was asked;
     · a refit belt drawn from one machine onto another connects them (StarNet lays the belt), a machine set on a
       taken tile stands on the nearest free one (the card says where, and why), and what still cannot be placed is
       refused by NAME and tile;
     · station.build's result tells the model it is DONE, so it reports and stops. */
const A = require('./_assert.js');
const M = require('../frontend/app/worldmodel.js'), P = require('../frontend/app/pipeline.js'), W = require('../frontend/app/workflowline.js');
const SB = require('../frontend/app/stationbuilder.js'), T = require('../frontend/app/stationtemplates.js'), Sprites = require('../frontend/app/propsprites.js');
const { makeStationTools } = require('../sidecar/tools/builtin/station.js');

M.setPropRules(t => { const s = Sprites.spec(t); return s ? { mount: s.mount || null, stack: !!s.stack, surface: !!s.surface, flat: !!s.flat } : null; });
const crew = [{ id: 'agent', name: 'NOVA' }, { id: 'copywriter', name: 'COPY' }, { id: 'strategist', name: 'STRATEGY' }];
const env = { WorldModel: M, Pipeline: P, WorkflowLine: W, crew, heroId: 'agent', StationTemplates: T, PropSprites: Sprites,
  RoomStyles: require('../frontend/app/roomstyles.js'), LineLayout: require('../frontend/app/linelayout.js'), LineEdit: require('../frontend/app/lineedit.js'),
  EquipmentHelp: require('../frontend/app/equipmenthelp.js') };

/* the walker's station: the starter HOME room (18 × 11) with three desks (NOVA, COPY, STRATEGY), as station.map showed it */
function walkerStation() {
  const st = M.create(M.starterDoc());
  for (const id of ['agent', 'copywriter', 'strategist']) A.ok(st.ensureWorkstation(id).ok, 'fixture: ' + id + ' has a desk');
  return st;
}
const snap = st => JSON.stringify(st.serialize());
const COPY_DRAFT = 'Write a sharp 2-sentence launch post for StarNet 0.13.5 based on the options discussed.';
const STRAT_REVIEW = 'Review the draft post. Approve if it is ready to ship, or send it back with specific cuts.';

/* ---- 1. the walker's FIRST plan: the right line, its steps named for their work — it plans, staffed in order ---- */
{
  const st = walkerStation(), before = snap(st);
  const r = SB.plan(st.serialize(), { line: 'revision_loop', name: 'Launch Post Workflow', steps: [
    { step: 'Draft', agent: 'COPY', instructions: COPY_DRAFT }, { step: 'Review', agent: 'STRATEGY', instructions: STRAT_REVIEW }] }, env);
  A.ok(r.ok, 'steps named "Draft" and "Review" plan on the Writer → Reviewer line (was: "This line has steps 1 to 2"): ' + (r.error || ''));
  if (r.ok) {
    A.eq(r.plan.steps.map(s => s.role + ':' + s.agent), ['Writer:COPY', 'Reviewer:STRATEGY'], 'COPY writes, STRATEGY reviews');
    A.eq(r.plan.steps.map(s => s.instructions), [COPY_DRAFT, STRAT_REVIEW], 'each step keeps the instructions the model wrote for it');
    A.ok(r.plan.ready, 'staffed, the line will be ready to run');
    A.ok(r.plan.notes.some(n => /"Draft" → step 1 \(Writer\)/.test(n) && /"Review" → step 2 \(Reviewer\)/.test(n)), 'the plan says how it read the step names: ' + JSON.stringify(r.plan.notes));
    A.ok(SB.apply(st, r.plan, env).ok, 'and it builds');
    A.ok(st.undo().ok); A.eq(snap(st), before, 'one undo takes it back');
  }
  // the same steps in order with no step at all, and a step named by its ROLE word, plan the same way
  const bare = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ agent: 'COPY' }, { agent: 'STRATEGY' }] }, env);
  A.ok(bare.ok && bare.plan.steps.map(s => s.agent).join() === 'COPY,STRATEGY', 'two steps listed in order with no number staff the two steps in order: ' + (bare.error || ''));
  const word = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ step: 'Final review', agent: 'STRATEGY' }] }, env);
  A.ok(word.ok && word.plan.steps[1].agent === 'STRATEGY' && word.plan.steps[0].agent == null, 'one step named "Final review" staffs the Reviewer, whatever its place: ' + (word.error || ''));
  const role = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ step: 'Reviewer', agent: 'STRATEGY' }, { step: 'Writer', agent: 'COPY' }] }, env);
  A.ok(role.ok && role.plan.steps.map(s => s.agent).join() === 'COPY,STRATEGY', 'a step named by its role ("Writer") finds that step in any order: ' + (role.error || ''));
  A.ok(SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ step: '2', agent: 'STRATEGY' }] }, env).ok, 'a number sent as text still counts');
  /* (review) a list with no numbers given OUT of run order was staffed by its place: the reviewer on the Writer step, the
     drafter on the Reviewer, while the reply said "COPY drafts → STRATEGY reviews". A step read by its place is checked by its work. */
  const rev = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ agent: 'STRATEGY', instructions: 'Review the draft and approve it.' }, { agent: 'COPY', instructions: 'Draft the launch post.' }] }, env);
  A.ok(rev.ok && rev.plan.steps.map(s => s.role + ':' + s.agent).join() === 'Writer:COPY,Reviewer:STRATEGY', 'a reversed list is read by each step\'s instructions, COPY writes: ' + (rev.error || JSON.stringify(rev.plan.steps.map(s => s.role + ':' + s.agent))));
  if (rev.ok) A.ok(rev.plan.notes.some(n => /step 2 \(Reviewer\) by its instructions/.test(n) && /step 1 \(Writer\) by its instructions/.test(n)), 'and the plan notes say so: ' + JSON.stringify(rev.plan.notes));
  const muddle = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ agent: 'COPY', instructions: 'Draft the launch post.' }, { agent: 'STRATEGY', instructions: 'Write up what is wrong with it.' }] }, env);
  A.ok(!muddle.ok && /^The steps have no numbers, so they were read in order, but step 2 \(Reviewer\) in that order was given a Writer's work \("Write up what is wrong with it\.…"\)\. Number every step/.test(muddle.error) && /"step": 1/.test(muddle.error), 'a list whose work cannot be read one step each is refused with the numbered form, never staffed by guess: ' + (muddle.error || 'PLANNED'));
  const inOrder = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ agent: 'COPY', instructions: 'Draft the launch post.' }, { agent: 'STRATEGY', instructions: 'Review the draft and approve it.' }] }, env);
  A.ok(inOrder.ok && inOrder.plan.steps.map(s => s.agent).join() === 'COPY,STRATEGY', 'a list in run order whose work agrees keeps its order: ' + (inOrder.error || ''));
  // a step read by its place and another by its role word, landing on the same step (zone staff takes such labels): both named
  const twice = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ step: 'Intro', agent: 'COPY' }, { step: 'Draft', agent: 'STRATEGY' }] }, env);
  A.ok(!twice.ok && /^Step 1 \(Writer\) was given twice: "Intro" → step 1 \(Writer\) by its place in the list, and "Draft" → step 1 \(Writer\)\. Number every step/.test(twice.error), 'two entries on one step say how each was read: ' + (twice.error || 'PLANNED'));
}

/* ---- 1b. a line planned with nobody on its steps says, BEFORE the build, how to staff it in the same plan ----
   (the third live re-run built Draft + review empty, then staffed it with a second plan and a second approval card) */
{
  const st = walkerStation(), names = crew.map(a => a.name);
  const bare = SB.plan(st.serialize(), { line: 'revision_loop', where: 'HOME', name: 'draft_and_review' }, env);
  const next = bare.ok ? SB.planNext(bare.plan, names) : null;
  /* the fix round's live run: staffed from that advice with agents only, COPY's Bay kept the Writer's stock "Turn the notes into a
     200-word newsletter blurb" while the reply said "COPY drafts the post". The one re-plan asks for each step's instructions too. */
  A.ok(/^Nothing is built yet\. Steps 1 \(Writer\) and 2 \(Reviewer\) have nobody to work them, so the line will not run; they also have only their roles' stock instructions \(step 1: "Turn the notes into a 200-word newsletter blurb\."\)\. /.test(next || '')
    && /If the Commander said who works them, or someone on the crew \(NOVA, COPY, STRATEGY\) is right for them, plan again with the same request plus steps: \[ \{ "step": 1, "agent": "…", "instructions": "…" \}, \{ "step": 2, "agent": "…", "instructions": "…" \} \] \(instructions: what that step does in the workflow the Commander described\), so ONE approval builds it ready to run\. Otherwise tell the Commander the summary, call station\.build with this planId, and say which steps still need crew\.$/.test(next || ''), 'an unstaffed plan says how to staff it, and tell it the work, before building: ' + next);
  const half = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ step: 1, agent: 'COPY' }] }, env);
  A.ok(/^Nothing is built yet\. Step 2 \(Reviewer\) has nobody to work it, so the line will not run\. Steps 1 \(Writer\) and 2 \(Reviewer\) have only their roles' stock instructions/.test(SB.planNext(half.plan, names) || '')
    && /\[ \{ "step": 1, "agent": "COPY", "instructions": "…" \}, \{ "step": 2, "agent": "…", "instructions": "…" \} \]/.test(SB.planNext(half.plan, names) || ''), 'one empty step, in the singular, and the staffed one keeps its crew in the form: ' + SB.planNext(half.plan, names));
  const full = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ step: 1, agent: 'COPY' }, { step: 2, agent: 'STRATEGY' }] }, env);
  A.ok(/^Steps 1 \(Writer\) and 2 \(Reviewer\) have only their roles' stock instructions \(step 1: "Turn the notes into a 200-word newsletter blurb\."\)\. If that is not the work the Commander described, plan again with the same request plus steps: \[ \{ "step": 1, "agent": "COPY", "instructions": "…" \}, \{ "step": 2, "agent": "STRATEGY", "instructions": "…" \} \].* Otherwise: Tell the Commander the summary in plain words, then call station\.build with this planId\. Nothing has been built yet\.$/.test(SB.planNext(full.plan, names) || ''),
    'a staffed plan with only stock instructions names them for the lead to judge (crew kept), then the usual next step: ' + SB.planNext(full.plan, names));
  const told = SB.plan(st.serialize(), { line: 'revision_loop', steps: [{ step: 1, agent: 'COPY', instructions: COPY_DRAFT }, { step: 2, agent: 'STRATEGY', instructions: STRAT_REVIEW }] }, env);
  A.eq(SB.planNext(told.plan, names), null, 'a staffed plan told its work keeps the usual next step');
  const aimed = SB.plan(st.serialize(), { line: 'revision_loop', purpose: 'launch posts for StarNet', steps: [{ step: 1, agent: 'COPY' }, { step: 2, agent: 'STRATEGY' }] }, env);
  A.eq(SB.planNext(aimed.plan, names), null, 'a purpose carries the work into the stock instructions, so that plan keeps it too');
  const custom = SB.plan(st.serialize(), { shape: ['WRITER', 'REVIEWER'], steps: [{ step: 1, agent: 'COPY' }, { step: 2, agent: 'STRATEGY' }] }, env);
  A.ok(/^Steps 1 \(Writer\) and 2 \(Reviewer\) have only their roles' stock instructions/.test(SB.planNext(custom.plan, names) || ''), 'a custom line with stock instructions is named the same: ' + SB.planNext(custom.plan, names));
  A.eq(SB.planNext({ steps: [] }, names), null, 'a plan with no steps (an edit, a room) keeps it too');
  /* the fix round's live run's first plan, { line: "draft_review", shape: [{ role: WRITER }, { role: REVIEWER }] }: "draft_review"
     IS revision_loop ("Draft + review"), and the shape is its own steps — both say one line, so it is laid, never refused */
  const same = SB.plan(st.serialize(), { line: 'draft_review', shape: [{ role: 'WRITER' }, { role: 'REVIEWER' }], where: 'HOME', name: 'Draft & Review' }, env);
  A.ok(same.ok && same.plan.line && same.plan.line.id === 'revision_loop' && same.plan.notes.some(n => /the shape is revision_loop's own steps \(Writer → Reviewer\), so that ready-made line was laid/.test(n)), 'a line named beside its own shape is that line: ' + (same.error || JSON.stringify(same.plan.notes)));
  const other = SB.plan(st.serialize(), { line: 'draft_review', shape: ['RESEARCHER', 'WRITER'] }, env);
  A.ok(!other.ok && /not both/.test(other.error), 'a line beside a DIFFERENT shape is still refused with both forms: ' + (other.error || 'PLANNED'));
  const cmds = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'frontend', 'app', 'stationcommands.js'), 'utf8');
  const lineVerb = cmds.slice(cmds.indexOf("'station.plan_line': (a) => {"), cmds.indexOf("'station.plan_room': (a) => {"));
  A.ok((cmds.match(/next: planNextOf\(p\.plan\)/g) || []).length === 1 && /next: planNextOf\(p\.plan\)/.test(lineVerb), 'the page hands it on for a line plan (the one whose request takes top-level steps)');
}

/* ---- 2. every refusal is actionable in one read: what was wrong, the accepted shape with an example, what fits ---- */
{
  const st = walkerStation(), before = snap(st);
  const plan = req => SB.plan(st.serialize(), req, env);
  // the walker's second plan: a ONE-step line given two steps
  const two = plan({ line: 'ship_out', where: 'HOME', name: 'Post Draft & Review', steps: [{ step: 'Draft', agent: 'COPY', instructions: 'x' }, { step: 'Review', agent: 'STRATEGY', instructions: 'y' }] });
  A.ok(!two.ok, 'two steps on a one-step line are refused');
  A.ok(/ship_out has 1 step \(1 Shipper\), and the request gives 2/.test(two.error), 'it says the count is what is wrong: ' + two.error);
  A.ok(/revision_loop \(Writer → Reviewer\)/.test(two.error) && /"shape": \["WRITER", "REVIEWER"\]/.test(two.error), 'and names the line that has exactly those steps, and the shape that lays them: ' + two.error);
  A.ok(/"step": 1, "agent": "COPY"/.test(two.error), 'with the accepted step shape as a tiny example: ' + two.error);
  // a step NUMBER out of range
  const nine = plan({ line: 'build_test', steps: [{ step: 9 }] });
  A.ok(!nine.ok && /This line has steps 1 to 2: 1 Engineer, 2 Tester/.test(nine.error) && /step is the step's NUMBER in run order/.test(nine.error) && /\{ "step": 1, "agent": "NOVA", "instructions": "…" \}/.test(nine.error), 'a number out of range says what step is, with an example: ' + nine.error);
  // the walker's tenth: steps named for work this line does not do
  const ten = plan({ line: 'research_line', steps: [{ step: 'Draft Post', agent: 'COPY' }, { step: 'Final Review', agent: 'STRATEGY' }] });
  A.ok(!ten.ok && /"Final Review" reads as a Reviewer step, and research_line has none \(its steps: 1 Researcher, 2 Writer\)/.test(ten.error), 'a step named for a role the line lacks is refused, never staffed on the wrong role: ' + (ten.error || 'PLANNED'));
  A.ok(/revision_loop \(Writer → Reviewer\)/.test(ten.error), '…and it names the line that has it: ' + ten.error);
  // the walker's eleventh: three named steps on a Writer → Reviewer → Fixer line, the third named for shipping
  const eleven = plan({ line: 'fire_escape', steps: [{ step: 'Draft', agent: 'COPY' }, { step: 'Review', agent: 'STRATEGY' }, { step: 'Ship', agent: 'agent' }] });
  A.ok(!eleven.ok && /"Ship" reads as a Shipper step, and fire_escape has none/.test(eleven.error) && /crucible \(Writer → Reviewer → Shipper → Reviewer\)|"shape": \["WRITER", "REVIEWER", "SHIPPER"\]/.test(eleven.error), 'a third step named for shipping says which line or shape has a Shipper: ' + (eleven.error || 'PLANNED'));
  /* the second live re-run: the model picked research_line (Researcher → Writer) for "draft the post, then review it" and
     numbered its steps right, so COPY drafted as a RESEARCHER and STRATEGY reviewed as a WRITER, and its reply said "COPY drafts →
     STRATEGY reviews". When every step's instructions are another ready-made line's work, exactly, that line is named instead. */
  const DRAFT2 = 'Draft the launch post based on the refined version from the team discussion. Keep it exactly 2 sentences.';
  const REVIEW2 = 'Review the launch post draft. Check that it is exactly 2 sentences and ready for publication.';
  const wrong = plan({ line: 'research_line', where: 'HOME', name: 'launch_post', steps: [{ step: 1, agent: 'COPY', instructions: DRAFT2 }, { step: 2, agent: 'STRATEGY', instructions: REVIEW2 }] });
  A.ok(!wrong.ok && /^These steps are a Writer's and a Reviewer's work \(step 1: "Draft the launch post/.test(wrong.error) && /research_line's steps are 1 Researcher, 2 Writer\./.test(wrong.error), 'a line whose steps are another line\'s work is refused: ' + (wrong.error || 'PLANNED ' + (wrong.plan || {}).summary));
  A.ok(/\{ "line": "revision_loop" \} \(Writer → Reviewer\) has exactly these steps: plan it with the same steps/.test(wrong.error) && /To keep research_line, give each step its role \(\{ "step": 1, "role": "Researcher", … \}\)/.test(wrong.error), '…naming the line that fits, and how to keep this one: ' + wrong.error);
  const right = plan({ line: 'revision_loop', where: 'HOME', name: 'launch_post', steps: [{ step: 1, agent: 'COPY', instructions: DRAFT2 }, { step: 2, agent: 'STRATEGY', instructions: REVIEW2 }] });
  A.ok(right.ok && /Writer \(COPY\) → Reviewer \(STRATEGY\)/.test(right.plan.summary), 'the line it names plans: ' + (right.error || right.plan.summary.slice(0, 160)));
  const kept = plan({ line: 'research_line', steps: [{ step: 1, role: 'Researcher', agent: 'COPY', instructions: DRAFT2 }, { step: 2, role: 'Writer', agent: 'STRATEGY', instructions: REVIEW2 }] });
  A.ok(kept.ok, 'naming each step\'s role keeps the line asked for: ' + (kept.error || ''));
  const code = plan({ line: 'build_test', steps: [{ step: 1, agent: 'NOVA', instructions: 'Write the code for the feature.' }, { step: 2, agent: 'STRATEGY', instructions: 'Test it and send it back until it passes.' }] });
  A.ok(code.ok, 'instructions that fit no other ready-made line exactly never refuse ("Write the code" on an Engineer step): ' + (code.error || ''));
  // the old refusals keep their words (and now say how to fix them)
  const pilot = plan({ line: 'build_test', steps: [{ role: 'PILOT' }] });
  A.ok(!pilot.ok && /This line has no PILOT step\. Its steps are: 1 Engineer, 2 Tester/.test(pilot.error) && /"step": 1/.test(pilot.error), 'an unknown role: ' + pilot.error);
  const none = plan({ line: 'build_test', steps: [{ instructions: 'hi' }] });
  A.ok(!none.ok && /Each step needs "step" \(a number\) or "role"/.test(none.error) && /"step": 1/.test(none.error), 'a step with neither: ' + none.error);
  A.eq(snap(st), before, 'no refusal changed anything');
  // the suggested shape really plans
  const shaped = plan({ shape: ['WRITER', 'REVIEWER'], steps: [{ step: 1, agent: 'COPY' }, { step: 2, agent: 'STRATEGY' }] });
  A.ok(shaped.ok, 'the shape a refusal suggests plans: ' + (shaped.error || ''));
  /* the live re-run's (after the step fix) two refusals: a line name that is no line beside a shape, and crew in the shape */
  const DRAFT = 'Draft the launch post based on the refined version agreed in chat. Keep it exactly 2 sentences.', REVIEW = 'Review the draft post for clarity, impact and positioning.';
  const crewShape = plan({ line: 'review_loop', shape: [{ role: 'copywriter' }, { role: 'strategist' }], steps: [{ step: 1, agent: 'COPY', instructions: DRAFT }, { step: 2, agent: 'STRATEGY', instructions: REVIEW }] });
  A.ok(!crewShape.ok && /^"copywriter" is not a step: COPY is a crew member\. A shape lists ROLES in run order/.test(crewShape.error), 'crew named in a shape is refused as crew: ' + (crewShape.error || 'PLANNED'));
  A.ok(/For this request: \{ "shape": \["WRITER", "REVIEWER"\], "steps": \[\{ "step": 1, "agent": "COPY" \}, \{ "step": 2, "agent": "STRATEGY" \}\] \}/.test(crewShape.error), '…with the shape its own steps describe, ready to send ("Review the draft" reads as Reviewer): ' + crewShape.error);
  const names = plan({ shape: ['COPY', 'STRATEGY'], steps: [{ step: 1, agent: 'COPY', instructions: DRAFT }, { step: 2, agent: 'STRATEGY', instructions: REVIEW }] });
  A.ok(!names.ok && /^"COPY" is not a step: COPY is a crew member/.test(names.error) && /"shape": \["WRITER", "REVIEWER"\]/.test(names.error), 'crew names as stages, the same: ' + (names.error || 'PLANNED'));
  const noLine = plan({ line: 'review_loop', shape: ['WRITER', 'REVIEWER'], steps: [{ step: 1, agent: 'COPY', instructions: DRAFT }, { step: 2, agent: 'STRATEGY', instructions: REVIEW }] });
  A.ok(noLine.ok && noLine.plan.notes.some(n => /there is no line called "review_loop", so the shape was laid/.test(n)), 'a line name that is no line beside a shape: the shape is laid, and the notes say so: ' + (noLine.error || JSON.stringify(noLine.plan.notes)));
  if (noLine.ok) A.ok(/Writer \(COPY\) → Reviewer \(STRATEGY\) → Outbox/.test(noLine.plan.summary), 'COPY writes, STRATEGY reviews: ' + noLine.plan.summary);
  // the live re-run's room was "LAUNCH POST DRAFT & REVI": a name too long for a room is cut at a word, never mid-word
  const long = plan({ shape: ['WRITER', 'REVIEWER'], name: 'Launch Post Draft & Review' });
  A.ok(long.ok && /^LAUNCH POST DRAFT, a new \d+ × \d+ room/.test(long.plan.summary) && /\("Launch Post Draft & Review"\)/.test(long.plan.summary), 'the room is LAUNCH POST DRAFT, the line keeps its whole name: ' + (long.error || long.plan.summary.slice(0, 160)));
  const longLine = plan({ line: 'revision_loop', name: 'Weekly Newsletter Draft and Review' });
  A.ok(longLine.ok && /in a new room/.test(longLine.plan.summary) && longLine.plan.spec.room && longLine.plan.spec.room.name === 'WEEKLY NEWSLETTER DRAFT', 'a shelf line\'s new room is cut at a word too: ' + (longLine.error || (longLine.plan.spec.room || {}).name));
  const roleObj = plan({ shape: [{ role: 'WRITER' }, { role: 'REVIEWER' }] });
  A.ok(roleObj.ok, 'a stage { "role": "WRITER" } is the role: ' + (roleObj.error || ''));
  const both = plan({ line: 'revision_loop', shape: ['WRITER'] });
  A.ok(!both.ok && /not both: \{ "line": "revision_loop", "steps": \[…\] \} builds that ready-made line \(Writer → Reviewer\); \{ "shape": \["WRITER", "REVIEWER"\], "steps": \[…\] \} lays your own/.test(both.error), 'a real line beside a shape writes both forms out: ' + (both.error || 'PLANNED'));
  A.eq(snap(st), before, 'planning changed nothing');
}

/* ---- 3. the walker's hand-laid refits: belts drawn machine onto machine connect, a taken tile moves to a free one ---- */
{
  const ops = (x0, y0, dx, dy) => {
    const at = k => [x0 + dx * k, y0 + dy * k];
    return [
      { op: 'place', t: 'intake', x: at(0)[0], y: at(0)[1], as: 'draft_inbox' }, { op: 'place', t: 'bay', x: at(1)[0], y: at(1)[1], as: 'draft_bay' },
      { op: 'place', t: 'bay', x: at(2)[0], y: at(2)[1], as: 'review_bay' }, { op: 'place', t: 'outbox', x: at(3)[0], y: at(3)[1], as: 'final_outbox' },
      // the walker's belts: from a tile of one machine onto a tile of the next
      { op: 'belt', from: [at(0)[0] + (dx ? 1 : 0), at(0)[1] + (dy ? 1 : 0)], to: at(1) }, { op: 'belt', from: [at(1)[0] + (dx ? 1 : 0), at(1)[1] + (dy ? 1 : 0)], to: at(2) },
      { op: 'belt', from: [at(2)[0] + (dx ? 1 : 0), at(2)[1] + (dy ? 1 : 0)], to: at(3) },
      { op: 'role', prop: 'draft_bay', role: 'WRITER' }, { op: 'agent', prop: 'draft_bay', agent: 'COPY' },
      { op: 'role', prop: 'review_bay', role: 'REVIEWER' }, { op: 'agent', prop: 'review_bay', agent: 'STRATEGY' }];
  };
  const st = walkerStation(), before = snap(st);
  // the walker's fourth plan: a column at x 12, each machine touching the next
  const col = SB.planEdit(st.serialize(), { refit: ops(12, 3, 0, 2) }, env);
  A.ok(col.ok, 'a belt drawn from one machine onto the next is a connect (was: "Edit 5 (belt): a prop is in the way"): ' + (col.error || ''));
  if (col.ok) {
    A.ok(/5\. the INBOX at \(12, 3\) belted to the bay at \(12, 5\) \(a belt drawn from one machine onto another connects them\)/i.test(col.plan.summary), 'the card says the belt became a connect: ' + col.plan.summary.slice(0, 600));
    A.ok(SB.apply(st, col.plan, env).ok, 'and it builds');
    const g = st.projectGeometry(), comp = P.lineComponents(g).find(c => c.bays.length === 2);
    A.ok(comp && P.compileRoutingPlan(g).errors.filter(e => !e.warn).length === 0, 'one line of two staffed bays, no routing error');
    A.ok(st.undo().ok); A.eq(snap(st), before, 'one undo takes it back');
  }
  // the walker's third plan: a row along the top wall, the INBOX on the plant in the corner
  const row = SB.planEdit(st.serialize(), { refit: ops(0, 0, 2, 0) }, env);
  if (row.ok) A.ok(/moved from \(0, 0\)/.test(row.plan.summary), 'a machine set on a taken tile stands on the nearest free one, and the card says so: ' + row.plan.summary.slice(0, 500));
  else A.ok(/the (plant|intel cab|workbench|desk) at \(\d+, \d+\)/.test(row.error), 'what cannot be placed is named by piece and tile: ' + row.error);
  // a machine that would overlap a piece moves to the nearest free tile, and the card names what stood there
  const moved = SB.planEdit(st.serialize(), { refit: [{ op: 'place', t: 'bay', x: 14, y: 8, as: 'b' }] }, env);
  A.ok(moved.ok && /a bay at \(\d+, \d+\) in HOME \(moved from \(14, 8\): the studio at \(14, 8\) stands there\)/.test(moved.plan.summary), 'a bay on the studio moves next to it: ' + (moved.error || moved.plan.summary));
  // a later edit naming the tile the moved piece was ASKED for still means that piece, never what stood there
  const byTile = SB.planEdit(st.serialize(), { refit: [{ op: 'place', t: 'bay', x: 14, y: 8 }, { op: 'role', prop: [14, 8], role: 'REVIEWER' }, { op: 'agent', prop: [15, 9], agent: 'STRATEGY' }] }, env);
  A.ok(byTile.ok && /3\. the bay at \(\d+, \d+\) is STRATEGY's/.test(byTile.plan.summary) && /2\. the bay at \(\d+, \d+\) is Reviewer/.test(byTile.plan.summary), 'the asked tile still names the moved bay: ' + (byTile.error || byTile.plan.summary));
  // a belt run across a piece that is no machine is refused by name, with the way to join two machines
  const across = SB.planEdit(st.serialize(), { refit: [{ op: 'belt', from: [13, 9], to: [16, 9] }] }, env);
  A.ok(!across.ok && /Edit 1 \(belt\): the tile \(14, 9\) is under the studio at \(14, 8\)/.test(across.error) && /\{ op: "connect", from, to \}/.test(across.error), 'a belt across the studio names it and says how to connect machines: ' + (across.error || 'PLANNED'));
  // a chair AIMED at something keeps its exact tile: an overlap is refused by name, never moved off its aim
  const chair = SB.planEdit(st.serialize(), { refit: [{ op: 'place', t: 'chair', x: 14, y: 8, toward: [10, 8] }] }, env);
  A.ok(!chair.ok && /overlaps the studio at \(14, 8\)/.test(chair.error) && /nearest free spot/.test(chair.error), 'an aimed piece on a taken tile is refused by name, with a free spot: ' + (chair.error || 'PLANNED'));
  A.eq(snap(st), before, 'planning changed nothing');
}

/* ---- 4. station.build tells the model it is DONE (and what is still to do, when anything is) ---- */
(async () => {
  let reply = null;
  const bridge = { request: async verb => verb === 'station.build' ? { ok: true, result: reply } : { ok: false, error: 'unknown verb' } };
  const tools = makeStationTools({ station: bridge, now: () => 1000, planMemo: new Map(), lineMenu: () => [], styleMenu: () => [], roomMenu: () => [], kitMenu: () => [], presetMenu: () => [] });
  reply = { built: true, summary: 'Draft + review ("LAUNCH POST") in a new room east of HOME: Writer (COPY) → Reviewer (STRATEGY) → Outbox.', line: { name: 'Draft + review' }, ready: true, blocking: [] };
  const done = JSON.parse((await tools.buildTool.run({ planId: 'p1' }, {})).content);
  A.ok(/^DONE: it is built and ready to run\. Tell the Commander what was built in a sentence or two, and stop: there is nothing left to build or check for this\./.test(done.next || ''), 'a ready build says DONE and to stop: ' + done.next);
  reply = { built: true, summary: 'Build + test …', line: { name: 'Build + test' }, ready: false, blocking: ['the line is not connected'] };
  const todo = JSON.parse((await tools.buildTool.run({ planId: 'p2' }, {})).content);
  A.ok(/^DONE: it is built\. Still to do before it runs: the line is not connected\. Tell the Commander exactly that, and stop/.test(todo.next || ''), 'a build with work left says DONE and names exactly what is left: ' + todo.next);
  /* the third live re-run: the lead built Draft + review with nobody on it, then staffed it with a refit on GUESSED ids ("p12_bay_0",
     refused), a map, a plan and a SECOND approval card. A receipt whose only work left is crew says the one form that staffs it. */
  reply = { built: true, summary: 'Draft + review …', line: { id: 'revision_loop', name: 'Draft + review', label: 'draft_and_review' }, ready: false, blocking: ['BAY 1 (WRITER) needs an agent', 'BAY 2 (REVIEWER) needs an agent'] };
  const crewLeft = JSON.parse((await tools.buildTool.run({ planId: 'p5' }, {})).content);
  A.ok(/^DONE: it is built\. Still to do before it runs: BAY 1 \(WRITER\) needs an agent; BAY 2 \(REVIEWER\) needs an agent\. If the Commander said who works those steps, staff them in one plan: station\.plan \{ "staff": \{ "line": "draft_and_review", "steps": \[ \{ "step": 1, "agent": "a crew name" \} \] \} \}, then station\.build; otherwise tell the Commander exactly that, and stop\./.test(crewLeft.next || ''), 'a build that only needs crew names the staff form, by the line\'s own name: ' + crewLeft.next);
  reply = { built: true, kind: 'restyle', summary: 'Restyle HOME.', where: 'HOME', rooms: [], lines: [] };
  const room = JSON.parse((await tools.buildTool.run({ planId: 'p3' }, {})).content);
  A.ok(/^DONE: it is built\. Tell the Commander what was built in a sentence or two, and stop: there is nothing left to build or check for this\.$/.test(room.next || ''), 'a restyle says DONE and stop, with no look at a design nobody laid by hand: ' + room.next);
  reply = { built: true, kind: 'refit', handLaid: true, summary: 'BUILD MODE, 3 edits…', lines: [] };
  const byHand = JSON.parse((await tools.buildTool.run({ planId: 'p6' }, {})).content);
  A.ok(/^DONE: it is built\. You laid pieces by hand: look at the room once \(station\.map \{ look: the room \}\) and fix only what is wrong; then tell the Commander what was built in a sentence or two, and stop\.$/.test(byHand.next || ''), 'a hand-laid refit keeps its one look: ' + byHand.next);
  reply = { built: true, kind: 'rooms', summary: 'A conveyor hall…', rooms: [{ name: 'WORKS' }], lines: [], blocking: ['routing is not live yet (the router did not confirm the new plan)'] };
  const unrouted = JSON.parse((await tools.buildTool.run({ planId: 'p7' }, {})).content);
  A.ok(/^DONE: it is built\. Still to do before it runs: routing is not live yet \(the router did not confirm the new plan\)\. Tell the Commander exactly that, and stop/.test(unrouted.next || ''), 'routing that did not publish is still to do, line or no line: ' + unrouted.next);
  reply = { ok: false };
  const refusedBuild = await tools.buildTool.run({ planId: 'p4' }, {});
  A.ok(!/DONE/.test(refusedBuild.content), 'a reply that is no build never says DONE: ' + refusedBuild.content.slice(0, 120));
  // the planner's own schema says a step is a NUMBER (so the model need not learn it from a refusal)
  const steps = tools.planTool.schema.properties.steps;
  A.eq(steps.items.properties.step.type, 'integer', 'station.plan\'s schema types step as an integer');
  A.ok(['agent', 'instructions', 'role'].every(k => JSON.stringify(steps.items.properties[k].type) === '["string","null"]'), 'and agent, instructions and role as text (null = leave it out)');
  A.ok(/\[ \{ "step": 1, "agent": "lead", "instructions": "…" \} \] \(step = the step's NUMBER in run order\)/.test(tools.planTool.description), 'its description shows a step as a number');
  /* what a real model's call meets FIRST is the harness's own argument check (shared/schema.js, run by the registry before the
     tool): the walker's first plan, step "Draft", is refused there in words that say what a step is; a null field (leave it out)
     passes, as the builder always took it */
  const { validate } = require('../shared/schema.js');
  const walkerFirst = { line: 'revision_loop', name: 'Launch Post Workflow', steps: [{ step: 'Draft', agent: 'COPY', instructions: COPY_DRAFT }, { step: 'Review', agent: 'STRATEGY', instructions: STRAT_REVIEW }] };
  const v1 = validate(tools.planTool.schema, walkerFirst);
  A.ok(!v1.ok && v1.errors[0] === '$.steps[0].step: expected integer, got string', 'the walker\'s step "Draft" is refused by the argument check as "expected integer": ' + JSON.stringify(v1.errors));
  const nulls = { line: 'revision_loop', steps: [{ step: 1, agent: 'COPY', role: null, instructions: null }, { step: 2, agent: null }] };
  A.ok(validate(tools.planTool.schema, nulls).ok, 'null on an optional step field passes the argument check: ' + JSON.stringify(validate(tools.planTool.schema, nulls).errors));
  { const pl = SB.plan(walkerStation().serialize(), nulls, env); A.ok(pl.ok && pl.plan.steps.map(s => s.agent || '-').join() === 'COPY,-', '…and plans with that field left out: ' + (pl.error || '')); }

  /* ---- 4b. the receipt of a REAL build of every kind (review): plan → SB.apply → the page's receipt (SB.receipt, what
     stationcommands answers) → station.build. A custom line (the shape path after1 took), a refit, a restaff: each says DONE
     with the floor's own readiness, and what is still to do, by the line's name. ---- */
  {
    const page = (st, pl) => { const r = SB.apply(st, pl, env); A.ok(r.ok, 'it builds: ' + (r.error || '')); return Object.assign({ built: true, undo: 'One UNDO in Build mode takes it back.' }, SB.receipt(r, pl), { routing: { published: true } }); };
    const build = async rep => { reply = rep; const out = await tools.buildTool.run({ planId: 'real' }, {}); return { next: JSON.parse(out.content).next || '', summary: out.summary }; };
    const cmds = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'frontend', 'app', 'stationcommands.js'), 'utf8');
    A.ok(/Object\.assign\(\{ built: true, undo \}, StationBuilder\.receipt\(r, e\.plan\)\)/.test(cmds), 'the page answers station.build with the builder\'s own receipt');
    // a custom line with nobody on it: still to do, named, and the staff form by the line's floor name
    const st = walkerStation();
    const bare = SB.plan(st.serialize(), { shape: ['WRITER', 'REVIEWER'], name: 'Launch Post' }, env);
    const b1 = await build(page(st, bare.plan));
    A.ok(/^DONE: it is built\. Still to do before it runs: BAY 1 \(WRITER\) needs an agent; BAY 2 \(REVIEWER\) needs an agent\. If the Commander said who works those steps, staff them in one plan: station\.plan \{ "staff": \{ "line": "([^"]+)", "steps": \[ \{ "step": 1, "agent": "a crew name" \} \] \} \}, then station\.build; otherwise tell the Commander exactly that, and stop\.$/.test(b1.next), 'an unstaffed custom line is NOT "done, stop": it names what is left and the staff form: ' + b1.next);
    A.ok(/· 2 to do$/.test(b1.summary), 'its chip counts what is left: ' + b1.summary);
    // …and the staff form it names is one that plans and builds the line ready
    const lineName = (/"line": "([^"]+)"/.exec(b1.next) || [])[1];
    A.eq(lineName, 'Launch Post', 'the staff form names the line by its own name (the live page said "LINE LAUNCH POST", the plate word, before)');
    const staff = SB.planEdit(st.serialize(), { staff: { line: lineName, steps: [{ step: 1, agent: 'COPY' }, { step: 2, agent: 'STRATEGY' }] } }, env);
    A.ok(staff.ok, 'the named staff form plans: ' + (staff.error || ''));
    if (staff.ok) {
      const b2 = await build(page(st, staff.plan));
      A.ok(/^DONE: it is built and ready to run\. Tell the Commander what was built in a sentence or two, and stop: there is nothing left to build or check for this\.$/.test(b2.next) && /· ready to run$/.test(b2.summary), 'a restaff that readies the line says ready to run, by the floor: ' + b2.next + ' | ' + b2.summary);
    }
    // a custom line planned staffed is ready to run
    const st2 = walkerStation();
    const full = SB.plan(st2.serialize(), { shape: ['WRITER', 'REVIEWER'], steps: [{ step: 1, agent: 'COPY' }, { step: 2, agent: 'STRATEGY' }] }, env);
    const b3 = await build(page(st2, full.plan));
    A.ok(/^DONE: it is built and ready to run\. Tell the Commander/.test(b3.next), 'a staffed custom line: ready to run: ' + b3.next);
    // a hand-laid refit line (the walker's column) reports its line as it stands: staffed and joined, it is ready
    const st3 = walkerStation();
    const col = SB.planEdit(st3.serialize(), { refit: [
      { op: 'place', t: 'intake', x: 12, y: 3, as: 'in' }, { op: 'place', t: 'bay', x: 12, y: 5, as: 'w' }, { op: 'place', t: 'bay', x: 12, y: 7, as: 'r' }, { op: 'place', t: 'outbox', x: 12, y: 9, as: 'out' },
      { op: 'connect', from: 'in', to: 'w' }, { op: 'connect', from: 'w', to: 'r' }, { op: 'connect', from: 'r', to: 'out' },
      { op: 'role', prop: 'w', role: 'WRITER' }, { op: 'agent', prop: 'w', agent: 'COPY' }, { op: 'role', prop: 'r', role: 'REVIEWER' }, { op: 'agent', prop: 'r', agent: 'STRATEGY' }] }, env);
    A.ok(col.ok, 'the column refit plans: ' + (col.error || ''));
    if (col.ok) { const b4 = await build(page(st3, col.plan)); A.ok(/^DONE: it is built and ready to run\. Tell the Commander/.test(b4.next), 'a refit that lays a whole staffed line: ready to run, no look (only machines were laid): ' + b4.next); }
    // the same line laid with nobody on it: the refit's line is still to do, by name
    const st4 = walkerStation();
    const empty = SB.planEdit(st4.serialize(), { refit: [
      { op: 'place', t: 'intake', x: 12, y: 3, as: 'in' }, { op: 'place', t: 'bay', x: 12, y: 5, as: 'w' }, { op: 'place', t: 'outbox', x: 12, y: 7, as: 'out' },
      { op: 'connect', from: 'in', to: 'w' }, { op: 'connect', from: 'w', to: 'out' }, { op: 'role', prop: 'w', role: 'WRITER' }] }, env);
    if (empty.ok) { const b5 = await build(page(st4, empty.plan)); A.ok(/^DONE: it is built\. Still to do before it runs: BAY 1 \(WRITER\) needs an agent\. If the Commander said who works those steps, staff them in one plan: station\.plan \{ "staff": \{ "line": "LINE [A-Z]+"/.test(b5.next), 'an unstaffed refit line says what is left, by the floor\'s own LINE word: ' + b5.next); }
    else A.ok(false, 'the empty column plans: ' + empty.error);
    // a machine laid on no line is still to do, and a refit's left-over work is the refit's to fix
    const st5 = walkerStation();
    const lone = SB.planEdit(st5.serialize(), { refit: [{ op: 'place', t: 'bay', x: 12, y: 5 }] }, env);
    if (lone.ok) { const b6 = await build(page(st5, lone.plan)); A.ok(/^DONE: it is built\. Still to do before it runs: the bay at \(12, 5\) stands on no line yet\. Fix that with one more refit plan and build it; if you cannot, tell the Commander exactly what is left, and stop\.$/.test(b6.next), 'a lone machine is on no line yet, for the refit to fix: ' + b6.next); }
    else A.ok(false, 'the lone bay plans: ' + lone.error);
    // a refit that sets furniture by hand keeps its one look; one that never touched a line has no line to report
    const st6 = walkerStation();
    const plant = SB.planEdit(st6.serialize(), { refit: [{ op: 'place', t: 'plant', x: 12, y: 5 }] }, env);
    if (plant.ok) { const b7 = await build(page(st6, plant.plan)); A.ok(/^DONE: it is built\. You laid pieces by hand: look at the room once/.test(b7.next) && !/ready to run/.test(b7.next), 'a hand-set plant: DONE, one look, no line claimed: ' + b7.next); }
    else A.ok(false, 'the plant plans: ' + plant.error);
  }

  /* ---- 5. tool_search finds the builder by the phrase the lead's note gives it, whatever else the query says ----
     Two of three real runs spent a search: "station builder - create assembly lines and workflows" and "station builder create
     assembly line workflow" revealed app.create, or nothing, because "create" is a whole tool name (app.create, loop.create).
     A phrase of the query that a tool's description carries, word for word, counts as the strong signal it is. */
  const { makeToolSearchTool } = require('../sidecar/tools/builtin/toolsearch.js');
  const fake = (name, description, schema) => ({ name, description, schema: schema || { type: 'object', properties: {} } });
  const reg = new Map([tools.mapTool, tools.planTool, tools.buildTool, tools.makePropTool, tools.testLineTool, tools.startLineTool].filter(Boolean).map(t => [t.name, t]));
  for (const t of [fake('app.create', 'Create a new StarNet app: a dashboard or tool that lives INSIDE StarNet, in its own StarNet window, from a name and a one-line description.', { type: 'object', required: ['name'] }),
    fake('app.edit', 'Rewrite one file of a StarNet app the crew made, by its app id.'), fake('session.create', 'Create a new chat session for an agent, with a title.'),
    fake('loop.create', 'Create one durable StarNet LOOP when the Commander asks to keep working, iterate, or continue until an objective/convergence/check passes.', { type: 'object', required: ['objective'] }),
    fake('routine.create', 'Create a StarNet ROUTINE: work an agent runs on a schedule (digests, research, monitoring, reports, drafts, reminders).', { type: 'object', required: ['prompt', 'schedule'] }),
    fake('task.create', 'Add one durable card to the Commander\'s task board when they say "add this to my board", "make a task", or equivalent.', { type: 'object', required: ['title'] }),
    fake('station.layout', 'Read the station floor the way the Workflow panel shows it: whether routing is live (confirmed against the router) and whether automation is stopped (E-STOP), every assembly line.')]) reg.set(t.name, t);
  const search = makeToolSearchTool({ registry: { get: n => reg.get(n) || null } }).toolSearchTool;
  const ctx = { deferred: ['station.map', 'station.plan', 'station.build', 'station.make_prop', 'station.test_line', 'station.start_line', 'app.create', 'app.edit', 'session.create'].filter(n => reg.has(n)),
    advertised: ['loop.create', 'routine.create', 'task.create', 'station.layout', 'tool.search'] };
  for (const q of ['station builder - create assembly lines and workflows', 'station builder create assembly line workflow', 'station builder']) {
    const r = await search.run({ query: q }, ctx), shown = (r.control && r.control.revealTools) || [];
    A.ok(['station.map', 'station.plan', 'station.build'].every(n => shown.indexOf(n) >= 0), '"' + q + '" reveals station.map, station.plan and station.build: ' + JSON.stringify(shown) + ' ' + String(r.content).slice(0, 160));
  }
  const plain = await search.run({ query: 'create an app dashboard' }, ctx);
  A.ok(((plain.control && plain.control.revealTools) || [])[0] === 'app.create', 'a query with no builder phrase still finds what it names first: ' + JSON.stringify(plain.control));
  A.report('station-builder-model-recovery');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
