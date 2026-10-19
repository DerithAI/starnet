/* node test/continuation-guard.test.js — the announce-without-acting CONTINUATION GUARD (sidecar/loop.js).
   Some models (Kimi K3, live-caught 2026-07-17) end a turn by ANNOUNCING the next action ("Reading main.js
   now — then fixing.") with finish_reason 'stop' and NO tool call; the loop used to read that as a final
   answer and end the run 'done' mid-task. Proves: an announce turn gets ONE system nudge and the run
   continues to a real delivery; the nudge budget is bounded (a narrate-forever model still terminates);
   a genuine final answer (incl. "let me know…") never nudges; limits.continueGuard === false disables;
   no wired tools = no nudge. Replay provider -> zero spend. */
'use strict';
const A = require('./_assert.js');
const events = require('../shared/events.js');
const { makeEmitter } = require('../shared/emitter.js');
const { makeCostEngine } = require('../sidecar/cost.js');
const { runAgentLoop } = require('../sidecar/loop.js');

const openCtx = () => ({ canRun: () => true, canUse: () => ({ ok: true }), agentId: 'a', room: 'office' });
const okDispatch = async () => ({ ok: true, isError: false, content: 'ok', summary: 'ok' });
const TOOLS = [{ name: 'thing', description: 't', schema: { type: 'object' } }];
function setup() {
  const bus = A.makeBus();
  const seq = A.collectBus(bus, events.names());
  const emit = makeEmitter(bus, () => {});
  return { seq, emit };
}
const textTurn = (t) => [{ type: 'text', delta: t }, { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }, { type: 'done', finishReason: 'stop' }];
const toolTurn = (i) => [
  { type: 'tool_start', index: 0, id: 'c' + i, name: 'thing' },
  { type: 'tool_args', index: 0, chunk: '{}' },
  { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
  { type: 'done', finishReason: 'tool_calls' }
];
// scripted provider: replays `turns` in order (repeats the last one if over-called)
function scripted(turns) {
  let n = 0;
  return { async *stream() { const t = turns[Math.min(n, turns.length - 1)]; n++; for (const ev of t) yield ev; },
           priceOf: () => ({ prompt: '0', completion: '0' }), contextLimit: () => 8000, callCount: () => n };
}
const run = (provider, extra) => runAgentLoop(Object.assign({
  messages: [{ role: 'user', content: 'go' }], provider, emit: setup().emit,
  cost: makeCostEngine({ priceOf: provider.priceOf }), model: 'replay/model',
  agentId: 'a', runId: 'r', tools: TOOLS, dispatch: okDispatch, capCtx: openCtx()
}, extra || {}));

(async () => {
  // ---- A. announce turn -> ONE nudge -> the model actually works -> clean 'done' delivery ----
  {
    const provider = scripted([
      textTurn('Reading the full main.js now — then fixing immediately.'),   // the Kimi-style premature stop
      toolTurn(0),
      textTurn('All three bugs are fixed; details above.')
    ]);
    const res = await run(provider);
    A.eq(res.reason, 'done', 'nudged run continues to a real delivery');
    A.eq(provider.callCount(), 3, 'announce + tool + final = 3 model calls');
    const nudges = res.messages.filter(m => m.role === 'system' && /<continuation>/.test(m.content));
    A.eq(nudges.length, 1, 'exactly one continuation nudge injected');
    const last = res.messages.filter(m => m.role === 'assistant').pop();
    A.ok(/fixed/.test(String(last.content)), 'the final assistant answer is the delivery, not the announcement');
  }

  // ---- A2. realistic future-work promises cannot end the run as fake done ----
  for (const phrase of [
    "I'll work on that.",
    "I'll take care of it.",
    "I'll get this done over the next few days.",
    "I'm going to work on it."
  ]) {
    const provider = scripted([textTurn(phrase), toolTurn(0), textTurn('The durable work item is created and visible now.')]);
    const res = await run(provider);
    A.eq(provider.callCount(), 3, phrase + ' is nudged into a real tool call before delivery');
    const nudges = res.messages.filter(m => m.role === 'system' && /<continuation>/.test(m.content));
    A.eq(nudges.length, 1, phrase + ' receives exactly one continuation nudge');
    A.ok(/durable routine\/task/.test(nudges[0].content), phrase + ' is told to create durable future work rather than promise it');
  }

  // ---- B. narrate-forever model: nudge budget (default 2) bounds it -> terminates 'done' ----
  {
    const provider = scripted([
      textTurn('Let me read main.js first.'),
      textTurn('Now checking the death path.'),
      textTurn('I will fix the pointer lock next.')   // third announce: budget spent -> ends
    ]);
    const res = await run(provider);
    A.eq(res.reason, 'error', 'a narrate-forever run ends as incomplete, never done');
    A.eq(res.failureCode, 'incomplete_work', 'durable failure identifies the exhausted continuation');
    A.ok(/Work is incomplete/.test(res.text), 'the final transcript explains the stop');
    A.eq(provider.callCount(), 3, 'exactly CG_MAX(2) extra turns, not an unbounded spin');
    const nudges = res.messages.filter(m => m.role === 'system' && /<continuation>/.test(m.content));
    A.eq(nudges.length, 2, 'nudge budget is exactly 2 per run');
  }

  // ---- C. a genuine final answer never nudges — incl. the "let me know" closing pleasantry ----
  {
    const provider = scripted([toolTurn(0), textTurn('Done — the fix is in place. Let me know if anything else breaks.')]);
    const res = await run(provider);
    A.eq(res.reason, 'done', 'clean delivery stays done');
    A.eq(provider.callCount(), 2, 'no nudge fired on a real final answer');
  }

  // ---- D. limits.continueGuard === false restores the old stop-on-text behavior ----
  {
    const provider = scripted([textTurn('Reading the full main.js now.')]);
    const res = await run(provider, { limits: { continueGuard: false } });
    A.eq(res.reason, 'done', 'guard disabled: announce turn ends the run');
    A.eq(provider.callCount(), 1, 'no extra turn when disabled');
  }

  // ---- E. no wired tools = nothing to nudge toward -> never fires ----
  {
    const provider = scripted([textTurn('Let me check the logs now.')]);
    const res = await run(provider, { tools: [] });
    A.eq(res.reason, 'done', 'tool-less run ends normally');
    A.eq(provider.callCount(), 1, 'no nudge without tools');
  }

  // ---- F. guard never overrides the grace turn's tool-free contract ----
  {
    // turn0: tool (hits maxIters:1) -> grace turn announces instead of answering -> must still END, not loop
    const provider = scripted([toolTurn(0), textTurn('Let me read one more file now.')]);
    const res = await run(provider, { limits: { maxIters: 1 } });
    A.eq(res.reason, 'error', 'an announcement on the grace turn cannot assert completion');
    A.eq(provider.callCount(), 2, 'no continuation nudge after grace');
    const nudges = res.messages.filter(m => m.role === 'system' && /<continuation>/.test(m.content));
    A.eq(nudges.length, 0, 'guard is suppressed on the grace turn');
  }

  {
    const provider = scripted([textTurn("I'll work on that.")]);
    const s = setup();
    const res = await run(provider, { emit: s.emit });
    A.eq(provider.callCount(), 3, 'identical promises consume the bounded continuation budget');
    A.eq(res.reason, 'error', 'duplicate detection cannot turn an unfulfilled promise into done');
    A.ok(/Work is incomplete/.test(res.text), 'duplicate exhaustion explains why it stopped');
    A.ok(s.seq.some(e => e.name === 'agent.run.error'), 'the error reaches the normal UI/channel seam');
  }
  {
    const provider = scripted([textTurn("I've saved your design preferences.")]);
    const res = await run(provider, {tools:[{name:'notebook_write',schema:{type:'object'}}]});
    A.eq(res.reason, 'error', 'unsupported save claims cannot pass as done');
    A.eq(res.failureCode, 'memory_write_unverified', 'missing save receipt is a specific failure');
    A.eq(provider.callCount(), 3, 'save verification has bounded retries');
    A.ok(/not confirmed/.test(res.text), 'the final reply corrects the unsupported save claim');
  }
  {
    const provider = scripted([textTurn('The example says "I saved your preferences." It is quoted text.')]);
    const res = await run(provider, {tools:[{name:'notebook_write',schema:{type:'object'}}]});
    A.eq(res.reason, 'done', 'quoted save examples are not first-person receipts');
    A.eq(provider.callCount(), 1, 'quoted examples do not trigger verification');
  }
  // A Dossier receipt must not send the model back to notebook.write. Neither a failed
  // edit nor a separate claim about notebook memory can borrow that receipt.
  for (const scenario of [
    { content: JSON.stringify({ durable: true, agentId: 'worker', field: 'manual' }), text: "I've updated the agent's instructions.", reason: 'done' },
    { content: 'REFUSED: save failed', text: "I've updated the agent's instructions.", reason: 'error' },
    { content: JSON.stringify({ durable: false, agentId: 'worker', field: 'manual' }), text: "I've updated the agent's instructions.", reason: 'error' },
    { content: JSON.stringify({ durable: true, agentId: 'worker', field: 'manual' }), text: "I've saved your preferences.", reason: 'error' }
  ]) {
    const turn = toolTurn('config').map(e => e.type === 'tool_start' ? { ...e, name: 'team_configure' } : e);
    const provider = scripted([turn, textTurn(scenario.text)]);
    const res = await run(provider, {
      tools: [{ name: 'team_configure', schema: { type: 'object' } }, { name: 'notebook_write', schema: { type: 'object' } }],
      dispatch: async () => ({ ok: true, isError: false, content: scenario.content })
    });
    A.eq(res.reason, scenario.reason, scenario.content + ': ' + scenario.text);
    if (scenario.reason === 'done') A.eq(provider.callCount(), 2, 'saved Dossier instructions need no notebook nudge');
    else A.eq(res.failureCode, 'memory_write_unverified', 'unverified memory claims remain blocked');
  }
  // ---- G. WIDENED announce detection (2026-10-11 user report: "they start a task and then stop repeatedly with no
  //         explanation"). Making/shipping announcements used to end the run 'done'; endings that WAIT on the
  //         Commander (a question, a condition on their answer, an offer, a lesson) must still never nudge. ----
  {
    const { announcesIntent } = require('../sidecar/loop.js')._internals;
    for (const p of [
      "I'll build the page.",
      "I'm going to go ahead and create the landing page with a hero section.",
      "I'll get started.",
      'Working on it now.',
      'On it!',
      "Sure — I'll set up the project structure and draft the README.",
      "Now I'll deploy it to the server.",
      'I am going to refactor the module.',
      'Okay, building the dashboard now.',
      'Give me a moment to put together the report.',
      "I'll design the logo with these elements:\n- a star\n- a ring\n- dark palette\n- pixel font\n- glow",
      'Will do!',
      'Consider it done.',
      "Great idea. I'll make the header sticky and add a footer. Let me know if you want changes.",
      "I'm building the page now — it'll have a hero, pricing and a footer.",
      'Found it — now fixing the death path.',
      'Reading the full main.js now.',
      'Found the bug — now working on the fix.',
      'Patched the import — now fixing.'
    ]) A.ok(announcesIntent(p), 'announce-then-stop is caught: ' + p);
    for (const n of [
      'Want me to build it?',
      "I'll build it once you confirm.",
      "I'll build it if you want.",
      "When you're ready, I'll deploy it.",
      "After you send the API key, I'll set up the integration.",
      "I can build the page if you'd like.",
      'Let me know if you want me to add a footer.',
      'Done — the page is built and the server is now running.',
      'The login is now working.',
      "I'll build the page. Should the header be blue or black?",
      "Next time, I'll check the logs first.",
      "From now on I'll use the dark palette.",
      'Let me summarize: the bug was a stale cache and it is fixed.',
      "Here's the fix:\n```js\n// let me check this\nconst a = 1;\n```\nThat resolves it.",
      "If the error comes back, I'll dig deeper.",
      "I'm looking forward to seeing it live!",
      "Now let's add a route:\n```js\napp.get('/')\n```\nThat's it.",
      "First, I'll create the file.\nThen the server starts on port 8080. You can open the page at localhost. The tests cover login and logout. All green.",
      // review threads-backend-04: a finished fix reported as a STATE is not an announce
      'Fixed the import path — now working.',
      'Fixed! Now working as expected.',
      'Saving now works again.',
      'Done — uploading now succeeds.'
    ]) A.ok(!announcesIntent(n), 'a reply that waits on the Commander or delivers is never nudged: ' + n);
  }
  // end to end: the commonest making-announcement now buys a nudge and the real work; a question still ends the run
  {
    const provider = scripted([textTurn("Sure — I'll build the landing page now."), toolTurn(0), textTurn('The page is built: index.html.')]);
    const res = await run(provider);
    A.eq(res.reason, 'done', '"I\'ll build…" is nudged into real work, then delivers');
    A.eq(provider.callCount(), 3, 'announce + tool + delivery');
  }
  {
    const provider = scripted([textTurn('I can build it with a dark hero and a pricing table. Want me to go ahead?')]);
    const res = await run(provider);
    A.eq(res.reason, 'done', 'a question that waits on the Commander ends the run cleanly');
    A.eq(provider.callCount(), 1, 'no nudge on a question');
  }

  // ---- H. MEMORY PROMISES need a receipt too: "I'll remember that" with nothing written means the next run forgets ----
  {
    const { memorySaveClaim } = require('../sidecar/loop.js')._internals;
    for (const [t, ran, want] of [
      ["I've saved your design preferences.", false, 'claim'],
      ["Got it, I'll remember that.", false, 'promise'],
      ['I will remember your preference for dark mode.', false, 'promise'],
      ["Thanks! I'll keep that in mind.", false, 'promise'],
      ["Noted — from now on I'll use the blue palette.", false, 'promise'],
      ["Got it, going forward I'll keep replies short.", false, 'promise'],
      ["From now on, I'll write tests first.", false, 'promise'],
      ["I've noted your preference.", false, 'claim'],
      ["I've made a note of that.", false, 'claim'],
      ['Saved!', false, 'claim'],
      ["I'll always use tabs.", false, 'promise'],
      ["I'll remember to always run the tests first.", false, 'promise'],
      // task narration, quotes and file saves are not memory claims
      ["I'll remember to run the tests after this edit.", false, null],
      ['The example says "I saved your preferences." It is quoted text.', false, null],
      ['Saved! The file is at out/index.html.', true, null],
      ["I've updated the build script and saved the file.", false, null],
      ["I'll always be here if you need anything.", false, null],
      ["I've noted that the tests are flaky on CI and retried them.", false, null],
      ["I'll build the page now.", false, null]
    ]) A.eq(memorySaveClaim(t, ran), want, 'memory claim kind of: ' + t);
  }
  {
    // a promise with no notebook write gets the receipt nudge; writing the note settles it as done
    const nbTurn = toolTurn('nb').map(e => e.type === 'tool_start' ? { ...e, name: 'notebook_write' } : e);
    const provider = scripted([textTurn("Got it — from now on I'll use the dark palette."), nbTurn, textTurn('Saved to memory: dark palette by default.')]);
    const res = await run(provider, {
      tools: [{ name: 'notebook_write', schema: { type: 'object' } }],
      dispatch: async () => ({ ok: true, isError: false, content: 'Saved note "palette"', summary: 'ok' })
    });
    A.eq(res.reason, 'done', 'a kept promise (real notebook write) ends done');
    const nudge = res.messages.find(m => m.role === 'system' && /<memory_receipt>/.test(m.content));
    A.ok(nudge && /WILL forget/.test(nudge.content), 'the promise nudge says the next run would forget');
  }
  {
    const provider = scripted([textTurn("Got it, I'll remember that.")]);
    const res = await run(provider, { tools: [{ name: 'notebook_write', schema: { type: 'object' } }] });
    A.eq(res.reason, 'error', 'an unkept memory promise cannot pass as done');
    A.eq(res.failureCode, 'memory_write_unverified', 'same failure code as an unverified save claim');
    A.ok(/promise to remember above is unverified/.test(res.text), 'the final reply says the promise was not saved');
  }

  // ---- I. EMPTY FIRST REPLY gets one bounded re-ask (a provider hiccup must not end the run on the spot) ----
  {
    const emptyTurn = [{ type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 0, total_tokens: 1 } }, { type: 'done', finishReason: 'stop' }];
    const provider = scripted([emptyTurn, textTurn('Here is the answer.')]);
    const res = await run(provider, { tools: [] });
    A.eq(res.reason, 'done', 'an empty first reply is re-asked once and the run delivers');
    A.eq(provider.callCount(), 2, 'exactly one re-ask');
    A.ok(res.messages.some(m => m.role === 'system' && /<empty_reply>/.test(m.content)), 'the re-ask names the empty reply');
    const twice = scripted([emptyTurn]);
    const res2 = await run(twice, { tools: [] });
    A.eq(res2.reason, 'empty', 'a second empty reply still ends empty (bounded)');
    A.eq(twice.callCount(), 2, 'never more than one re-ask');
    const off = scripted([emptyTurn]);
    await run(off, { tools: [], limits: { continueGuard: false } });
    A.eq(off.callCount(), 1, 'continueGuard:false disables the re-ask with the rest of the nudge family');
  }
  console.log('continuation-guard.test: OK');
  // report() settles the assertion counter. The .catch below only fires on a THROWN error, so
  // without this every one of the assertions above could fail and the file would still exit 0.
  // ---- H. WAITING ON THE CREW (2026-10-13): a lead that REALLY handed work on may end "I'll pull it together when they
  //         report" — the guard failed that turn, and the failed turn cancelled the very hand-offs it had made. The same
  //         words with no hand-off are still an unkept promise. ----
  {
    const { waitsOnPeers } = require('../sidecar/loop.js')._internals;
    for (const p of ['I will pull it together when they report.', "I'll merge both drafts once MIRA and ROOK finish.", 'I will summarize when the crew reports back.', 'I will continue after they reply.'])
      A.ok(waitsOnPeers(p), 'a wait on the crew: ' + p);
    for (const p of ["I'll check the logs when the build finishes.", 'I will run the tests when the page loads.', 'Next I will read main.js.', "I'll deploy it once the tests pass."])
      A.ok(!waitsOnPeers(p), 'not a wait on the crew: ' + p);
    const handoffTurn = [
      { type: 'tool_start', index: 0, id: 'h1', name: 'group_handoff' },
      { type: 'tool_args', index: 0, chunk: '{"agentId":"research","request":"scan competitors"}' },
      { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      { type: 'done', finishReason: 'tool_calls' }
    ];
    const wait = 'MIRA researches the competitors. I will pull it together when they report.';
    const tools = [{ name: 'group_handoff', schema: { type: 'object' } }, { name: 'thing', schema: { type: 'object' } }];
    const handed = await run(scripted([handoffTurn, textTurn(wait)]), { tools, dispatch: async () => ({ ok: true, isError: false, content: 'Queued research.' }) });
    A.eq(handed.reason, 'done', 'after a real hand-off the honest wait ends the turn done (the hand-offs then run)');
    // A queued peer never excuses a separate unperformed promise, in either order or clause layout.
    const mixed = [
      'I will summarize when they report. I will read main.js now.',
      'I will read main.js now. I will summarize when they report.',
      'I will summarize when they report; I will read main.js now.',
      'I will read main.js now; I will summarize when they report.',
      'I will summarize when they report, and I will read main.js now.',
      'I will read main.js now, but I will summarize when they report.',
      'I will read main.js now and summarize when they report.',
      'I will summarize when they report and read main.js now.',
      'I will summarize when they report, then I will read main.js now.',
      'I will read main.js now, then I will summarize when they report.',
      'I will summarize when they report, then read main.js now.',
      'I will read main.js now, then summarize when they report.',
      'I will read main.js now; MIRA is researching; ROOK is drafting; both are on their tasks.',
      "I'll wait for ROOK to finish and then read main.js now.",
      "I'll wait for ROOK to finish; I will read main.js now."
    ];
    for (const phrase of mixed) {
      const provider = scripted([handoffTurn, textTurn(phrase), toolTurn(42), textTurn('The local check is complete.')]);
      const dispatched = [];
      const result = await run(provider, { tools, dispatch: async call => {
        dispatched.push(call.name); return { ok: true, isError: false, content: 'ok' };
      } });
      A.eq(provider.callCount(), 4, 'mixed promise continues into actual work: ' + phrase);
      A.eq(dispatched, ['group_handoff', 'thing'], 'handoff then independent action execute in order: ' + phrase);
      A.eq(result.messages.filter(m => m.role === 'system' && /<continuation>/.test(m.content)).length, 1, 'one continuation nudge: ' + phrase);
      A.eq(result.reason, 'done', 'delivery after real independent action: ' + phrase);
      const stuck = await run(scripted([handoffTurn, textTurn(phrase)]), { tools, dispatch: okDispatch });
      A.eq(stuck.reason, 'error', 'repeated mixed promise cannot finish done: ' + phrase);
      A.eq(stuck.failureCode, 'incomplete_work', 'mixed promise retains bounded failure: ' + phrase);
    }
    for (const phrase of [wait, 'I will summarize when they report.', 'I will merge both drafts once MIRA and ROOK finish.', 'When they report, I will read main.js and summarize.', 'When they report, I will read main.js and run tests.', 'When they report, I will run tests and read main.js.',
      // What follows an explicit wait in sequence is the same dependent plan (a regression the clause split once
      // brought back: the lead's turn failed and its queued hand-offs were stopped).
      "I'll wait for ROOK to finish and then review his draft.",
      "I'll wait for their reports and then put together the final plan.",
      "Handed off to MIRA. I'll wait for her report and then build the plan.",
      "I'll wait for ROOK to finish, then review his draft and merge it."]) {
      const provider = scripted([handoffTurn, textTurn(phrase)]);
      const result = await run(provider, { tools, dispatch: okDispatch });
      A.eq(result.reason, 'done', 'pure successful peer wait stays allowed: ' + phrase);
      A.eq(provider.callCount(), 2, 'pure wait has no continuation turn: ' + phrase);
      A.eq(result.messages.filter(m => m.role === 'system' && /<continuation>/.test(m.content)).length, 0, 'pure wait has no nudge: ' + phrase);
    }
    const refused = await run(scripted([handoffTurn, textTurn(wait)]), { tools, dispatch: async () => ({ ok: false, isError: true, content: 'Unknown participant' }) });
    A.ok(refused.reason !== 'done', 'a hand-off that FAILED earns no wait: still an unkept promise (' + refused.reason + ')');
    const none = await run(scripted([textTurn(wait)]), { tools });
    A.ok(none.reason !== 'done', 'the same words with no hand-off at all are still caught (' + none.reason + ')');
  }

  // ---- A REPLY THAT ENDS ON A CHOICE MARKER WAITS ON THE COMMANDER (rc walk 2026-10-14) ----
  // "Let me ask this the right way:" + a TASK_QUESTION marker read as an announce: the guard pushed "you called no tools",
  // the model answered it in COMMS ("You're right — I ended with a question card but didn't call any tools.") and dropped
  // the question. Bold-wrapped and glued markers are the same question.
  {
    for (const reply of [
      "Let me ask this the right way:\n\nTASK_QUESTION: Is this about personal resilience or community support? || Personal resilience | Community support | Both",
      "Got it — let me check what context I have first and ask directly:\n\nTASK_QUESTION: What's the core promise? || Local control | Instant agents",
      "Let me nail down one thing first. Is it:\n\n**FORK: What's the headline story?** || Local-first | Pixel-art UI | AI crews | Something else",
      'Let me check one thing first: TASK_QUESTION: which format? || PDF | HTML'
    ]) {
      const provider = scripted([textTurn(reply), toolTurn(7), textTurn('should never run')]);
      const res = await run(provider);
      A.eq(provider.callCount(), 1, 'a marker-ended reply ends the run — no nudged second turn: ' + JSON.stringify(reply.slice(0, 40)));
      A.eq(res.messages.filter(m => m.role === 'system' && /<continuation>/.test(m.content)).length, 0, 'no continuation nudge on a question: ' + JSON.stringify(reply.slice(0, 40)));
      A.eq(res.reason, 'done', 'the run ends cleanly on the question');
    }
    // the brief_ask refusal tells the model to END on the marker: failure recovery must accept exactly that ending
    const failed = scripted([toolTurn(1), textTurn("Let me ask this the right way:\n\nTASK_QUESTION: personal or community? || Personal | Community"), textTurn('should never run')]);
    const fr = await run(failed, { dispatch: async () => ({ ok: false, isError: true, content: 'ERROR: tool brief.ask failed: a second question requires an answered first question' }) });
    A.eq(failed.callCount(), 2, 'a marker reply after a failed call ends the run (no failure-recovery turn)');
    A.eq(fr.messages.filter(m => m.role === 'system' && /<failure_recovery>/.test(m.content)).length, 0, 'no failure-recovery nudge on a reply that asks the Commander');
    // a marker that is NOT the ending (prose after it announces work) is still an announce
    const after = scripted([textTurn('TASK_QUESTION: which? || a | b\n\nReading main.js now — then fixing.'), toolTurn(8), textTurn('Fixed.')]);
    const afterRes = await run(after);
    A.eq(afterRes.messages.filter(m => m.role === 'system' && /<continuation>/.test(m.content)).length, 1, 'an announce AFTER a marker is still nudged');
    // the nudge says it is a host check the Commander never sees, so it is not answered in COMMS ("You're right —")
    const nudge = afterRes.messages.find(m => m.role === 'system' && /<continuation>/.test(m.content));
    A.ok(/automatic host check; the Commander never sees it\. Do not answer, acknowledge or apologize/.test(nudge.content), 'the continuation nudge tells the model not to answer it');
    // …and so does every other nudge that pushes back on a reply (rc review 2026-10-14: six of them did not)
    {
      const loopSrc = require('fs').readFileSync(require('path').join(__dirname, '..', 'sidecar', 'loop.js'), 'utf8');
      for (const tag of ['continue_after_tools', 'empty_reply', 'continuation', 'failure_recovery', 'loop_guard', 'tool_markup', 'memory_receipt', 'verify_before_done', 'verify_external_before_done', 'verify_sources_before_done', 'acceptance_before_done']) {
        const line = loopSrc.split('\n').find(l => l.indexOf("messages.push({ role: 'system', content: '<" + tag + ">") >= 0);
        A.ok(line && line.indexOf("HOST_CHECK + '</" + tag + ">'") >= 0, 'the <' + tag + '> nudge says it is a host check, never answered');
      }
      const steer = loopSrc.split('\n').find(l => l.indexOf("'<steering_note>'") >= 0);
      A.ok(steer && steer.indexOf('HOST_CHECK') < 0, 'a steering note (the Commander\'s own words) never carries it');
    }
    // a HIDDEN tool's error tells the model the step is invisible (no "Let me fix that—sources needs to be an array:")
    const hiddenProv = scripted([[{ type: 'tool_start', index: 0, id: 'h1', name: 'brief_proceed' }, { type: 'tool_args', index: 0, chunk: '{}' }, { type: 'done', finishReason: 'tool_calls' }], textTurn('Done.')]);
    const hid = await run(hiddenProv, { tools: [{ name: 'brief_proceed', description: 'b', schema: { type: 'object' } }].concat(TOOLS), hiddenTools: ['brief_proceed'],
      dispatch: async () => ({ ok: false, isError: true, content: 'ERROR: invalid tool arguments: "sources" must be an array' }) });
    const tr = hid.messages.find(m => m.role === 'tool');
    A.ok(/sources" must be an array \(This tool is invisible to the Commander: never mention this error or its fix\. Make the corrected call with no text before it — or, if you fall back to the TASK_QUESTION marker, reply with only that one marker line\.\)$/.test(String(tr && tr.content)), 'a hidden tool error carries the invisible-step note: ' + JSON.stringify(tr && tr.content));
    // A REPAIR TURN AFTER AN INVISIBLE STEP IS NOT CHAT: after a held call (the brief gate) the model's "let me settle the brief
    // first:" turn — whose only call is the hidden brief tool — is never streamed and never kept; a repair turn that makes a
    // visible call streams its text whole.
    {
      const textTool = (t, id, name) => [{ type: 'text', delta: t }, { type: 'tool_start', index: 0, id, name }, { type: 'tool_args', index: 0, chunk: '{}' }, { type: 'done', finishReason: 'tool_calls' }];
      const tokens = [];
      const emitTok = (name, p) => { if (name === 'agent.token') tokens.push(p.delta); };
      let n = 0;
      const prov = scripted([textTool('Handing it over.', 'd1', 'thing'), textTool('Got it — let me settle the brief first:', 'b1', 'brief_proceed'), textTool('Now dispatching:', 'd2', 'thing'), textTurn('Dispatched.')]);
      const res = await run(prov, { emit: emitTok, tools: [{ name: 'brief_proceed', description: 'b', schema: { type: 'object' } }].concat(TOOLS), hiddenTools: ['brief_proceed'],
        dispatch: async c => (c.name === 'thing' && ++n === 1)
          ? { ok: false, isError: true, content: 'Task Brief gate: nothing ran.', summary: 'not run yet — waiting on the task brief', quietRepair: true }
          : { ok: true, isError: false, content: 'ok', summary: 'ok' } });
      const streamed = tokens.join('');
      A.ok(!/settle the brief/.test(streamed), 'the repair narration over a hidden-only turn never streams: ' + JSON.stringify(streamed));
      A.ok(/Handing it over\./.test(streamed) && /Now dispatching:/.test(streamed) && /Dispatched\./.test(streamed), 'every other turn still streams');
      A.ok(!res.messages.some(m => m.role === 'assistant' && /settle the brief/.test(String(m.content || ''))), 'and the narration is not kept in the transcript either');
      const tokens2 = [];
      let m2 = 0;
      await run(scripted([textTool('Handing it over.', 'd1', 'thing'), textTool('Retrying the handoff now:', 'd2', 'thing'), textTurn('Done.')]), { emit: (name, p) => { if (name === 'agent.token') tokens2.push(p.delta); },
        dispatch: async () => (++m2 === 1) ? { ok: false, isError: true, content: 'held', quietRepair: true } : { ok: true, isError: false, content: 'ok' } });
      A.ok(/Retrying the handoff now:/.test(tokens2.join('')), 'a repair turn that makes a VISIBLE call streams its text whole');
    }
    // THE FALLBACK QUESTION IS ITS MARKER ALONE (rc review 2026-10-14): a hidden brief_ask refusal tells the model to end on the
    // TASK_QUESTION marker, and the walker's rows #94 / #110 led in with harness chatter over that invisible step. The repair
    // turn makes no call, so its lead-in is never streamed and never kept; the marker line is, and still parses into the card.
    {
      const { TaskIntent } = require('../frontend/app/fork.js');
      const BRIEF_ASK = [{ name: 'brief_ask', description: 'b', schema: { type: 'object' } }];
      const askTurn = [{ type: 'tool_start', index: 0, id: 'q1', name: 'brief_ask' }, { type: 'tool_args', index: 0, chunk: '{}' }, { type: 'done', finishReason: 'tool_calls' }];
      const refusal = 'ERROR: tool brief.ask failed: inspect available context first; discoverable must be false. Correct the arguments and call brief_ask again — do NOT ask in plain prose; if you cannot satisfy the validator, end your reply with: TASK_QUESTION: <question> || <option A> | <option B> — and put the question ONLY in that marker line (it renders as the question card; never write it out in prose as well).';
      for (const [lead, marker, q] of [
        ['Got it — let me check what context I have first and ask directly:', "TASK_QUESTION: What's the core promise or benefit the tagline should emphasize? || Local control & autonomy (your machine, your rules) | Instant AI agents ready to work | Retro pixel-art meets modern AI power", "What's the core promise or benefit the tagline should emphasize?"],
        ['Let me ask this the right way:', 'TASK_QUESTION: Is this about personal resilience (keeping habits on track despite irregular hours), or community/peer support for nurses? || Personal resilience | Community/peer support | Both equally', 'Is this about personal resilience (keeping habits on track despite irregular hours), or community/peer support for nurses?'],
        ['Let me ask this the right way:', '**TASK_QUESTION: personal or community?** || Personal | Community', 'personal or community?'],
        ['', 'One quick check: TASK_QUESTION: personal or community? || Personal | Community', 'personal or community?']
      ]) {
        const toks = [];
        const reply = lead ? lead + '\n\n' + marker : marker;
        const prov = scripted([askTurn, textTurn(reply), textTurn('should never run')]);
        const res = await run(prov, { emit: (name, p) => { if (name === 'agent.token') toks.push(p.delta); }, tools: BRIEF_ASK.concat(TOOLS), hiddenTools: ['brief_ask'],
          dispatch: async () => ({ ok: false, isError: true, content: refusal }) });
        const streamed = toks.join('');
        const kept = res.messages.filter(m => m.role === 'assistant').pop();
        A.ok(!/let me|One quick check/i.test(streamed), 'the fallback lead-in never streams: ' + JSON.stringify(streamed.slice(0, 80)));
        A.ok(!/let me|One quick check/i.test(String(kept && kept.content)), 'and is never kept: ' + JSON.stringify(String(kept && kept.content).slice(0, 80)));
        const card = TaskIntent.parse(String(kept && kept.content));
        A.eq(card && card.question, q, 'the kept marker still parses into the question card');
        A.ok(/TASK_QUESTION/.test(streamed), 'the marker line itself still streams (the chat turns it into the card)');
        A.eq(prov.callCount(), 2, 'the run ends on the question');
      }
      // a quiet repair turn that ends on prose (no marker) still streams whole — only the marker fallback is reduced
      const toks = [];
      await run(scripted([askTurn, textTurn('I have what I need, so here is the tagline: Own your agents.')]), { emit: (name, p) => { if (name === 'agent.token') toks.push(p.delta); },
        tools: BRIEF_ASK.concat(TOOLS), hiddenTools: ['brief_ask'], dispatch: async () => ({ ok: false, isError: true, content: refusal }) });
      A.ok(/here is the tagline: Own your agents\./.test(toks.join('')), 'a repair turn that answers in prose streams its answer');
    }
    const vis = await run(scripted([toolTurn(9), textTurn('Done.')]), { dispatch: async () => ({ ok: false, isError: true, content: 'boom' }) });
    A.eq(String(vis.messages.find(m => m.role === 'tool').content), 'ERROR: boom', 'a VISIBLE tool error is byte-identical (its chip shows it)');
  }
  // ---- I. A QUEUED SEAT ENDS THE REPLY (review 10-14). station.control group.add on the lead's own running chat lands only
  //         when this reply ends, and the lead's next turn is already scheduled: the kickoff in the group, with the request.
  //         The guard nudged the real Haiku reply below (one of two real seats) — the Commander got a second message
  //         answering an invisible nudge ("You're right… Per the tool response…"), and an exhausted guard fails the reply,
  //         which DROPS the join they approved. A seat that was refused or failed still earns nothing. ----
  {
    const seatTurn = [
      { type: 'tool_start', index: 0, id: 's1', name: 'station_control' },
      { type: 'tool_args', index: 0, chunk: '{"action":"group.add","args":{"agents":["copywriter","strategist"]}}' },
      { type: 'usage', usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } },
      { type: 'done', finishReason: 'tool_calls' }
    ];
    const tools = [{ name: 'station_control', schema: { type: 'object' } }, { name: 'thing', schema: { type: 'object' } }];
    const queued = async () => ({ ok: true, isError: false, content: 'QUEUED, NOT DONE YET: COPY and STRATEGY join this chat the moment this reply ends.', summary: 'group.add (queued)' });
    // the real reply (lane log model.jsonl id 15, Haiku 4.5): its "I'll make sure it all hangs together" is the lead's NEXT turn
    const real = 'Excellent. **Copy** and **Strategy** are queued to join this chat as a group. The moment this reply ends, you\'ll see a new group chat open alongside General with both of them ready to work. I\'ll be there to brief them and orchestrate—Copy will draft the prose, Strategy will shape the positioning and flow, and I\'ll make sure it all hangs together into something launch-ready.\n\nOnce they arrive, we\'ll kick off with a clear handoff on what we\'re building and who it\'s for.';
    for (const phrase of [real, "COPY and STRATEGY join when this reply ends. I'll hand them their parts once they arrive.", "They join when this reply ends; then I'll start them on the draft."]) {
      const provider = scripted([seatTurn, textTurn(phrase)]);
      const res = await run(provider, { tools, dispatch: queued });
      A.eq(res.reason, 'done', 'a queued seat ends the reply done (the join lands, the kickoff turn carries the work): ' + phrase.slice(0, 60));
      A.eq(provider.callCount(), 2, 'no extra model call after a queued seat: ' + phrase.slice(0, 60));
      A.eq(res.messages.filter(m => m.role === 'system' && /<continuation>/.test(m.content)).length, 0, 'and no nudge: ' + phrase.slice(0, 60));
    }
    // a seat that did not queue (refused, or an applied one with no wait) earns nothing: the same promise is still caught
    for (const d of [async () => ({ ok: false, isError: true, content: 'REFUSED: no agent called "ghost"', summary: 'error' }),
      async () => ({ ok: true, isError: false, content: '{"done":"group.add"}', summary: 'group.add' })]) {
      const res = await run(scripted([seatTurn, textTurn(real)]), { tools, dispatch: d });
      A.ok(res.reason !== 'done' || res.messages.some(m => m.role === 'system' && /<continuation>/.test(m.content)), 'no queued seat, no stand-down (' + res.reason + ')');
    }
  }
  A.report('continuation-guard.test');
})().catch(e => { console.error(e); process.exit(1); });
