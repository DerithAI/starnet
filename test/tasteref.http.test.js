'use strict';
// THE DESIGN ANCHOR, live (user report 2026-10-11: "say I approve one, the next comes out with a complete off-the-wall style
// and concept"). Real sidecar + real /api/run against a local mock provider that also renders the image (no money spent):
// a run WRITES a styled page and GENERATES an image; a 👍 stores the run's real reference (its files, the palette and
// fonts inside the page, the image prompt / rendered model / shape, the tools in order); the NEXT run on an UNRELATED task
// carries that reference + the match-the-approved rule in its prompt; ★ KEEP THIS STYLE (POST /api/taste/keep-style) on
// another design run becomes the newest approval; everything survives a sidecar restart; the personalization pause stops
// keep-style and says so.
const A = require('./_assert.js');
const { userWords } = require('./helpers/host-notes.js');   // the user's own words: the run-context note leads the newest user message on this wire
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const {spawn} = require('node:child_process');
const {once} = require('node:events');
const {bootToken} = require('./_httpToken.js');
const root = path.resolve(__dirname, '..');
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-taste-ref-'));
const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
const PAGE = (accent, font) => '<!doctype html><html><head><style>:root{--bg:#0b0f14;--accent:' + accent + '}body{background:var(--bg);color:#e6e6e6;font-family:"' + font + '",sans-serif}h1{color:' + accent + '}a{color:' + accent + '}</style></head><body><h1>Candles</h1></body></html>';
let child, base, headers;
const seen = [];   // every chat request body the provider received
function sse(res, delta, finish) {
  res.writeHead(200, {'Content-Type': 'text/event-stream'});
  res.write('data: ' + JSON.stringify({choices: [{delta}]}) + '\n\n');
  res.write('data: ' + JSON.stringify({choices: [{delta: {}, finish_reason: finish || 'stop'}], usage: {prompt_tokens: 5, completion_tokens: 5, total_tokens: 10}}) + '\n\n');
  res.end('data: [DONE]\n\n');
}
const mock = http.createServer((req, res) => {
  if (req.url.includes('/models')) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({data: [{id: 'test/model', context_length: 128000, pricing: {prompt: '0', completion: '0'}, supported_parameters: ['tools']}]})); }
  let raw = ''; req.on('data', d => { raw += d; }); req.on('end', () => {
    let body = {}; try { body = JSON.parse(raw); } catch (_) {}
    if (Array.isArray(body.modalities) && body.modalities.includes('image')) {   // the STUDIO render: a real PNG, free
      res.writeHead(200, {'Content-Type': 'application/json'});
      return res.end(JSON.stringify({choices: [{message: {images: [{image_url: {url: 'data:image/png;base64,' + PNG_B64}}]}}]}));
    }
    seen.push(body);
    const msgs = Array.isArray(body.messages) ? body.messages : [];
    let lastUser = -1; for (let i = msgs.length - 1; i >= 0; i--) if (msgs[i] && msgs[i].role === 'user') { lastUser = i; break; }
    const ask = lastUser >= 0 ? userWords(msgs[lastUser]) : '';
    const answered = msgs.slice(lastUser + 1).some(m => m && m.role === 'tool');
    const job = /DESIGN_JOB_(\w+)/.exec(ask);
    if (job && !answered) {
      const v2 = job[1] === 'TWO';
      return sse(res, {tool_calls: [
        {index: 0, id: 'w_' + job[1], type: 'function', function: {name: 'fs_write', arguments: JSON.stringify({path: v2 ? 'site/v2.html' : 'site/index.html', content: PAGE(v2 ? '#ff2bd6' : '#39ff88', v2 ? 'VT323' : 'Space Grotesk')})}},
        {index: 1, id: 'i_' + job[1], type: 'function', function: {name: 'image_generate', arguments: JSON.stringify({prompt: v2 ? 'magenta arcade marquee, pixel art' : 'neon synthwave skyline, teal haze', aspect_ratio: '16:9', transparent: v2})}}
      ]}, 'tool_calls');
    }
    return sse(res, {content: 'Here is the finished piece of work you asked for.'});
  });
});
async function boot() {
  const socket = http.createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening'); const port = socket.address().port; await new Promise(r => socket.close(r));
  base = 'http://127.0.0.1:' + port;
  const orBase = 'http://127.0.0.1:' + mock.address().port + '/api/v1';
  child = spawn(process.execPath, ['sidecar/index.js'], {cwd: root, env: {...process.env, SKYNET_WORKSPACES: workspace, SKYNET_PORT: String(port), SKYNET_OPENROUTER_BASE: orBase, STARNET_OPENROUTER_BASE: orBase, SKYNET_OPENROUTER_KEY: 'sk-or-v1-tasteref-fixture', SKYNET_FULL_ACCESS: '1', SKYNET_EDGE_TTS: '0', SKYNET_REFLECT: '0', SKYNET_SKILL_REVIEW: '0', SKYNET_AUX_BUDGET: '0'}, stdio: ['ignore', 'pipe', 'pipe']});
  await new Promise((resolve, reject) => { let out = ''; const timer = setTimeout(() => reject(new Error('boot timeout: ' + out.slice(-1200))), 30000); const read = d => { out += d; if (out.includes('Open in your browser:')) { clearTimeout(timer); resolve(); } }; child.stdout.on('data', read); child.stderr.on('data', read); child.once('exit', c => { clearTimeout(timer); reject(new Error('boot exit ' + c + out.slice(-1200))); }); });
  headers = {'Content-Type': 'application/json', 'X-StarNet-Token': await bootToken(base, base), Origin: base};
}
async function stop() { if (child && child.exitCode === null) { const exit = once(child, 'exit'); child.kill(); await exit; } }
async function api(url, body) { const r = await fetch(base + url, {headers, method: body === undefined ? 'GET' : 'POST', body: body === undefined ? undefined : JSON.stringify(body)}); return {status: r.status, body: await r.json()}; }
async function run(text, agentId) {
  const before = seen.length;
  const r = await fetch(base + '/api/run', {method: 'POST', headers, body: JSON.stringify({agentId: agentId || 'agent', key: 'sk-or-v1-tasteref-fixture', model: 'test/model', isTask: true, placed: ['cabinet', 'studio'], messages: [{role: 'user', content: text}]})});
  const events = (await r.text()).split('\n').filter(Boolean).map(s => { try { return JSON.parse(s); } catch (_) { return null; } }).filter(Boolean);
  const end = events.filter(e => e.name === 'agent.run.end').pop();
  A.eq(end && end.payload.reason, 'done', 'run completed: ' + text);
  const req = seen.slice(before).find(b => Array.isArray(b.messages) && b.messages.some(m => m.role === 'user' && String(m.content).indexOf(text) >= 0));
  return {runId: end && end.payload.runId, prompt: req ? JSON.stringify(req.messages) : '', events};
}
(async () => {
  mock.listen(0, '127.0.0.1'); await once(mock, 'listening');
  try {
    await boot();
    A.ok((await api('/api/roster', {agents: [{agentId: 'agent', name: 'Hero', model: 'test/model', provider: 'openrouter'}, {agentId: 'scribe', name: 'Scribe', model: 'test/model', provider: 'openrouter'}]})).body.ok, 'roster saved');

    // 1. a design run: a styled page + a hero image, both REAL files in the workspace
    const r1 = await run('Design the candle shop landing page with a hero image. DESIGN_JOB_ONE');
    A.ok(r1.events.some(e => e.name === 'agent.tool_result' && e.payload.callId === 'i_ONE' && e.payload.ok), 'the image was generated (mock render, no spend)');
    A.ok(fs.existsSync(path.join(workspace, 'agent', 'site', 'index.html')), 'the page was written');

    // 2. 👍 -> the record carries what the run REALLY made
    const liked = await api('/api/growth/ratings', {runId: r1.runId, verdict: 'great', epoch: 1});
    A.ok(liked.body.ok && liked.body.feedbackMemory && liked.body.feedbackMemory.stored, 'great stored: ' + JSON.stringify(liked.body.feedbackMemory));
    const ref = (liked.body.feedbackMemory || {}).reference || {};
    A.eq((ref.paths || [])[0], 'site/index.html', 'the page leads the reference');
    A.ok((ref.paths || []).some(p => /^images\/gen-[0-9a-f]+\.png$/.test(p)), 'the saved image path (the tool\'s own) is in it: ' + JSON.stringify(ref.paths));
    A.eq((ref.palette || [])[0], '#39ff88', 'the palette was read out of the page: ' + JSON.stringify(ref.palette));
    A.ok((ref.palette || []).indexOf('#0b0f14') >= 0, 'its background token too');
    A.eq((ref.fonts || [])[0], 'Space Grotesk', 'the font was read out of the page');
    const im = (ref.images || [])[0] || {};
    A.eq([im.prompt, im.aspect, im.model], ['neon synthwave skyline, teal haze', '1x1', 'google/gemini-3.1-flash-image'], 'the image prompt, shape and RENDERED model came from the run\'s transcript: ' + JSON.stringify(im));
    A.ok(/fs[._]write → image_generate/.test(String(ref.tools || '')), 'the approach, in order: ' + ref.tools);

    // 3. the NEXT run, on an unrelated task, carries the reference and the rule
    const r2 = await run('Summarize these customer call notes.');
    A.ok(/APPROVED \d{4}-\d{2}-\d{2}: Design the candle shop landing page/.test(r2.prompt), 'the approval rides the unrelated next run');
    for (const want of ['site/index.html', '#39ff88', 'Space Grotesk', 'neon synthwave skyline, teal haze', 'google/gemini-3.1-flash-image, 1x1'])
      A.ok(r2.prompt.indexOf(want) >= 0, 'next run sees ' + want);
    A.ok(r2.prompt.indexOf('match the newest relevant APPROVED one in style and concept') >= 0, 'with the match-the-approved rule');
    A.ok(r2.prompt.indexOf('[agent workspace]') < 0, 'the agent that made it sees its own openable paths');
    // station-wide: ANOTHER agent gets the same approval, its files tagged as the maker's jail (it cannot open them; it matches the line)
    const rs = await run('Compose a short poem about autumn leaves.', 'scribe');
    A.ok(rs.prompt.indexOf('[agent workspace] site/index.html') >= 0 && rs.prompt.indexOf('#39ff88') >= 0, 'another agent sees the approval with the owner tag and the palette');

    // 4. ★ KEEP THIS STYLE on a second design: the newest approval leads
    const r3 = await run('Design the arcade night flyer with a marquee image. DESIGN_JOB_TWO');
    const kept = await api('/api/taste/keep-style', {runId: r3.runId});
    A.ok(kept.body.ok && kept.body.feedbackMemory && kept.body.feedbackMemory.stored && kept.body.feedbackMemory.created, 'keep-style stored a new approval: ' + JSON.stringify(kept.body));
    A.eq(((kept.body.feedbackMemory || {}).reference || {}).paths && kept.body.feedbackMemory.reference.paths[0], 'site/v2.html', 'with that run\'s own page');
    const imageReceipt = seen.flatMap(b => b.messages || []).find(m => m.role === 'tool' && m.tool_call_id === 'i_TWO');
    A.ok(imageReceipt && /NOT TRANSPARENT|Transparency NOT verified/.test(String(imageReceipt.content)), 'the real image tool did not verify transparency for these saved bytes: ' + JSON.stringify(imageReceipt));
    const savedImage = kept.body.feedbackMemory.reference.images[0];
    A.ok(savedImage.aspect === '1x1' && !savedImage.transparent, 'the remembered image follows the actual receipt, not the wide/transparent request: ' + JSON.stringify(savedImage));

    A.eq((await api('/api/taste/keep-style', {runId: 'no-such-run'})).status, 404, 'an unknown run is refused');
    const r4 = await run('Draft an email to the landlord about the heating.');
    const iKept = r4.prompt.indexOf('APPROVED (style kept)'), iFirst = r4.prompt.indexOf('Design the candle shop landing page');
    A.ok(iKept >= 0 && iFirst > iKept, 'the kept style leads, the earlier approval follows');
    A.ok(r4.prompt.indexOf('#ff2bd6') >= 0 && r4.prompt.indexOf('VT323') >= 0 && r4.prompt.indexOf('magenta arcade marquee, pixel art') >= 0, 'with its real palette, font and image prompt');
    const styleLine = r4.prompt.split('\\n').find(line => line.includes('Design the arcade night flyer')) || '';
    A.ok(styleLine.includes('1x1') && !/16:9|, transparent/.test(styleLine), 'the next provider prompt cannot assert the requested image properties: ' + styleLine);


    // 5. survives a restart
    await stop(); await boot();
    const r5 = await run('Plan the team offsite agenda.');
    A.ok(r5.prompt.indexOf('site/v2.html') >= 0 && r5.prompt.indexOf('neon synthwave skyline, teal haze') >= 0, 'both references survive a sidecar restart and reach the prompt');

    // 5b. ★ STYLE KEPT · PUT IT BACK: the crew's copy goes too; the 👍 on the first design stays
    const undo = await api('/api/taste/keep-style', {runId: r3.runId, undo: true});
    A.ok(undo.body.ok && undo.body.undone === true && undo.body.removed === true, 'PUT IT BACK removed the keep-only approval: ' + JSON.stringify(undo.body));
    const r6 = await run('List three ideas for a team lunch.');
    A.ok(r6.prompt.indexOf('site/v2.html') < 0 && r6.prompt.indexOf('magenta arcade marquee') < 0, 'the put-back style no longer reaches the next prompt');
    A.ok(r6.prompt.indexOf('neon synthwave skyline, teal haze') >= 0, 'the rated approval is untouched');
    A.eq((await api('/api/taste/keep-style', {runId: r3.runId, undo: true})).body.undone, false, 'a second PUT IT BACK changes nothing');

    // 5c. Keep first, then a real rejection, then PUT IT BACK: the rejection must reach the provider.
    A.ok((await api('/api/taste/keep-style', {runId: r3.runId})).body.ok, 'keep the second style again');
    // memory-learning-11: a later run rewrote the rated run's page before the verdict. Its colours and fonts are the later
    // run's work, so the rated run's reference keeps the path but must not record them.
    const v2File = path.join(workspace, 'agent', 'site', 'v2.html');
    fs.writeFileSync(v2File, PAGE('#00c2ff', 'Comic Neue'));
    const later = new Date(Date.now() + 120000); fs.utimesSync(v2File, later, later);
    const miss = await api('/api/growth/ratings', {runId: r3.runId, verdict: 'miss', correction: 'wrong colors', epoch: 1});
    A.ok(miss.body.ok && miss.body.feedbackMemory && miss.body.feedbackMemory.stored, 'the real miss was stored');
    const missRef = (miss.body.feedbackMemory || {}).reference || {};
    A.ok((missRef.paths || []).indexOf('site/v2.html') >= 0, 'the rated run\'s page path stays in its reference: ' + JSON.stringify(missRef.paths));
    A.ok((missRef.palette || []).indexOf('#00c2ff') < 0 && (missRef.fonts || []).indexOf('Comic Neue') < 0, 'a page rewritten after the run lends no colours or fonts to it: ' + JSON.stringify({palette: missRef.palette, fonts: missRef.fonts}));
    const undoMiss = await api('/api/taste/keep-style', {runId: r3.runId, undo: true});
    A.ok(undoMiss.body.undone && undoMiss.body.removed === false, 'unkeep retains the real verdict');
    const r7 = await run('Plan the quarterly planning meeting.');
    const arcadeLine = r7.prompt.split('\\n').find(line => line.includes('Design the arcade night flyer')) || '';
    A.ok(/REJECTED .*Design the arcade night flyer.*wrong colors/.test(arcadeLine) && !/APPROVED|(?:^|[^s])liked:/.test(arcadeLine), 'provider receives the rejection after unkeep: ' + arcadeLine);

    // 5d. seams-03: the crew's memory cannot be written (here: the notebook path is a directory). KEEP must not report
    // that the crew learned the style.
    const nb = path.join(workspace, 'agent.notebook.json');
    A.ok(fs.existsSync(nb), 'the agent notebook exists');
    fs.renameSync(nb, nb + '.held'); fs.mkdirSync(nb);
    try {
      const unsaved = await api('/api/taste/keep-style', {runId: r1.runId});
      A.eq(unsaved.body.ok, false, 'a keep that could not be saved is not ok: ' + JSON.stringify(unsaved.body));
      A.ok(/could not be written/.test(String(unsaved.body.error || '')), 'and says the memory was not written');
      A.eq(unsaved.body.feedbackMemory && unsaved.body.feedbackMemory.reason, 'could not save', 'with the store\'s own reason');
    } finally { fs.rmdirSync(nb); fs.renameSync(nb + '.held', nb); }

    // 6. the personalization pause stops keep-style and says so
    A.ok((await api('/api/personalization', {enabled: false})).body.ok, 'personalization paused');
    const paused = await api('/api/taste/keep-style', {runId: r1.runId});
    A.eq(paused.body.feedbackMemory && paused.body.feedbackMemory.reason, 'personalization-paused', 'no taste while paused, reported truthfully');
  } finally { await stop(); await new Promise(r => mock.close(r)); fs.rmSync(workspace, {recursive: true, force: true}); }
  A.report('tasteref.http');
})().catch(e => { console.error(e); process.exit(1); });
