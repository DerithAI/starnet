/* node test/qa-message-content.test.js — locks the QA provider mocks to both
   supported message-content wire shapes, including cacheable Anthropic blocks. */
'use strict';
const A = require('./_assert.js');
const { messageContentText } = require('../scripts/lib/message-content.mjs');
const { firstUserWords } = require('./helpers/host-notes.js');
const provider = require('../sidecar/providers/provider.js');
const { makeOpenRouterProvider } = require('../sidecar/providers/openrouter.js');

A.eq(messageContentText('plain prompt'), 'plain prompt', 'plain string content is unchanged');
A.eq(messageContentText([
  { type: 'text', text: '[WORKSHOP_SHIFT] build journey demo', cache_control: { type: 'ephemeral' } }
]), '[WORKSHOP_SHIFT] build journey demo', 'cacheable structured text is extracted');
A.eq(messageContentText([
  { type: 'image_url', image_url: { url: 'data:image/png;base64,x' } },
  { type: 'text', text: 'write a short note to a file' }
]), 'write a short note to a file', 'non-text blocks are ignored without corrupting routing text');
A.eq(messageContentText({ type: 'text', text: 'single text block' }), 'single text block', 'a single text block is accepted defensively');
A.eq(messageContentText({ type: 'image_url' }), '', 'unknown objects never stringify as object noise');
A.eq(messageContentText(null), '', 'missing content is empty text');

/* THE RUN'S OWN OPENING PROMPT ON EVERY ROUTE (2026-10-15, qa:journeys J4 red 3/3 on the 0.13.5 candidate). The journey
   mock builds a workshop deliverable only when the run's opening prompt STARTS with [WORKSHOP_SHIFT]. Since the lean-prompt
   review the per-run <run_context> note (and recall) ride the user side of the wire: on a generic chat wire they LEAD the
   Commander's user message, on a Claude route (the journey's seeded model) they are their own user turns BEFORE it. The
   mock read "the first user message", got the run-context note, answered plain text, and the shift honestly reported
   no-manifest. Drive the REAL OpenRouter adapter for both route kinds, opening turn and mid-run (after a tool result), and
   require the matcher the mock uses to find the shift prompt and its workshop/<runId>/ path. */
(async () => {
  const PROMPT = '[WORKSHOP_SHIFT]\nYou are working in your private workshop while the Commander is away.\n'
    + 'Write every file under workshop/run-7f3a/ and finish with workshop/run-7f3a/deliverable.json.';
  const opening = [
    { role: 'system', content: 'SYSTEM_PROMPT: you are the resident agent.' },
    { role: 'system', content: provider.runContextNote('## SAVED AGENT SKILLS\nnone yet\n[RUNTIME]\nRun id: run-7f3a') },
    { role: 'system', content: '<recalled-memory>\nRECALL: prefers single-file tools.\n</recalled-memory>' },
    { role: 'user', content: PROMPT }
  ];
  const midRun = opening.concat([
    { role: 'assistant', content: '', tool_calls: [{ id: 'h1', type: 'function', function: { name: 'fs_write', arguments: '{"path":"workshop/run-7f3a/index.html","content":"x"}' } }] },
    { role: 'tool', tool_call_id: 'h1', content: 'wrote workshop/run-7f3a/index.html' }
  ]);
  const bodies = [];
  const fetch = async (url, init) => {
    if (!String(url).endsWith('/chat/completions')) return new Response('{"data":[]}');
    bodies.push(JSON.parse(init.body));
    return new Response('data: [DONE]\n\n');
  };
  const collect = async (req) => { for await (const _ of makeOpenRouterProvider({ fetch, key: 'k' }).stream(req)) { /* drain */ } };
  for (const model of ['anthropic/claude-sonnet-4.6', 'test/model']) {
    for (const [label, messages] of [['opening turn', opening], ['mid-run', midRun]]) {
      bodies.length = 0;
      await collect({ model, messages });
      const wire = bodies[0] && bodies[0].messages;
      A.ok(Array.isArray(wire) && wire.some(m => m.role === 'user' && /<run_context>/.test(messageContentText(m.content))),
        model + ' ' + label + ': the run-context note rides the user side of the wire (the premise this matcher exists for)');
      const words = firstUserWords(wire);
      A.ok(words.indexOf('[WORKSHOP_SHIFT]') === 0, model + ' ' + label + ': the matcher reads the run\'s own prompt, not a host note — got ' + JSON.stringify(words.slice(0, 60)));
      A.eq((words.match(/workshop\/([A-Za-z0-9-]+)\//) || [])[1], 'run-7f3a', model + ' ' + label + ': the workshop run id comes from the prompt');
      A.ok(!/<run_context>|<recalled-memory>/.test(words), model + ' ' + label + ': no host note leaks into the routed words');
    }
  }
  // a request whose user side is host notes alone has no opening prompt of its own: it never routes as a shift
  A.eq(firstUserWords([{ role: 'system', content: 's' }, { role: 'user', content: provider.runContextNote('[WORKSHOP_SHIFT] quoted in a brief') }]), '',
    'a user turn that is only a host note is never read as the run\'s prompt');
  A.eq(firstUserWords([]), '', 'no messages: empty words');
  A.report('qa-message-content.test');
})().catch(e => { console.log('FAIL: ' + (e && e.stack || e)); process.exit(1); });
