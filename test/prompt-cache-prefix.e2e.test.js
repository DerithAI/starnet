'use strict';
// Real HTTP request assembly and provider wire boundaries. No external inference.
const assert = require('node:assert/strict');
const http = require('node:http');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');
const { runContextOf } = require('./helpers/host-notes.js');
const text = content => typeof content === 'string' ? content : (content || []).map(p => p.text || '').join('');
(async () => {
  const bodies = [];
  const upstream = http.createServer(async (req, res) => {
    req.setEncoding('utf8'); // decode across chunk boundaries; prompts/tools contain multibyte text
    let raw = ''; for await (const part of req) raw += part;
    if (!raw) { res.setHeader('Content-Type', 'application/json'); return res.end(JSON.stringify({data:[]})); }
    const body = JSON.parse(raw);
    const system = body.system ? text(body.system) : body.messages.filter(m => m.role === 'system').map(m => text(m.content)).join('\n\n');
    if (system.includes('CACHE_PROOF_IDENTITY')) bodies.push(body);
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    if (body.system) res.end('data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"acknowledged"}}\n\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"}}\n\ndata: {"type":"message_stop"}\n\n');
    else res.end('data: {"choices":[{"delta":{"content":"acknowledged"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n');
  });
  await new Promise(resolve => upstream.listen(0, '127.0.0.1', resolve));
  const baseUrl = 'http://127.0.0.1:' + upstream.address().port + '/v1';
  const fixture = new SidecarFixture({env:{SKYNET_FULL_ACCESS:'1',STARNET_FULL_ACCESS:'1',SKYNET_SKILL_REVIEW:'0',SKYNET_SKILL_CURATOR:'0',SKYNET_THREAD_MINE:'0',STARNET_CREDITS_URL:'',SKYNET_CREDITS_URL:''}});
  try {
    await fixture.start();
    for (const provider of ['anthropic','openrouter','custom']) {
      bodies.length=0;
      const model=provider==='anthropic'?'claude-test':provider==='openrouter'?'anthropic/claude-test':'audit-model';
      for(let i=0;i<2;i++) {
        const r=await fetch(fixture.baseUrl+'/api/run',{method:'POST',headers:{'Content-Type':'application/json','X-StarNet-Token':fixture.token,Origin:fixture.baseUrl},body:JSON.stringify({provider,baseUrl,key:'fixture-key',model,reasoningEffort:'low',agentId:'agent',streamId:'cache-'+provider,isTask:true,placed:[],system:'CACHE_PROOF_IDENTITY: Preserve all required checks.',messages:[{role:'user',content:'Please acknowledge this request.'}]})});
        assert.equal(r.status,200);
        const events=(await r.text()).trim().split('\n').map(l=>JSON.parse(l));
        assert.equal(events.findLast(e=>e.name==='agent.run.end')?.payload.reason,'done');
      }
      assert.equal(bodies.length,2,provider+': one foreground inference per request');
      const [a,b]=bodies;
      assert.deepEqual(a.tools,b.tools,provider+': all tool definitions retained across runs');
      assert.ok(a.tools.length>20,provider+': task capability projection is present');
      /* CACHE-STABLE PREFIX (lean-prompt 2026-10-12). This used to pin the per-run block INSIDE the system prompt (a
         split "stable | volatile" system whose second half differed per run). That block now rides one <run_context>
         note placed with the newest user message, so the system prompt itself is byte-identical across the
         conversation's two messages (the second request replays the first exchange from the transcript). */
      const systemOf=body=>body.system ? text(body.system) : text(body.messages[0].content);
      const lastUser=body=>{for(let i=body.messages.length-1;i>=0;i--) if(body.messages[i].role==='user') return i; return -1;};
      const noteOf=body=>{ // native Anthropic: inside the newest user turn; Claude on a chat wire: the user message before it; any other model: the newest user message's leading text
        const i=lastUser(body);
        if(body.system) return (body.messages[i].content.find(p=>String(p.text||'').startsWith('<run_context>'))||{}).text||'';
        return runContextOf(body.messages);
      };
      for(const body of bodies) {
        const sys=systemOf(body), note=noteOf(body);
        assert.ok(note.includes('Run id:'),provider+': truthful runtime identity retained (run-context note)');
        assert.ok(!sys.includes('Run id:'),provider+': no run id in the system prompt');
        assert.ok(sys.includes('CACHE_PROOF_IDENTITY'),provider+': caller instructions retained');
        assert.ok(sys.includes('<capabilities_ground_truth>'),provider+': capability truth retained');
        assert.ok(sys.includes('brief_proceed') || sys.includes('brief.proceed'),provider+': Task Brief control retained (its constant doctrine stays in the system prompt)');
        assert.ok(note.includes('<task_brief id="tb_'),provider+': the brief itself (its id is the run\'s) rides the run-context note');
        assert.ok(!sys.includes('<task_brief'),provider+': no per-run brief block in the system prompt');
        assert.ok(sys.length+note.length>20000,provider+': full task context was not shortened');
        assert.equal(lastUser(body),body.messages.length-1,provider+': the request ends on the user turn');
      }
      assert.ok(b.messages.length>a.messages.length,provider+': the second message carries the first exchange as history');
      assert.notEqual(noteOf(a),noteOf(b),provider+': each run receives fresh metadata');
      if(provider!=='custom') {
        const parts=body=>body.system||body.messages[0].content;
        assert.deepEqual(parts(a),parts(b),provider+': the system prompt is BYTE-IDENTICAL across the two messages, cache markers included');
        assert.ok(parts(a)[0].cache_control,provider+': the stable prefix carries a cache anchor');
        if(provider==='anthropic') assert.ok(a.tools[a.tools.length-1].cache_control,'anthropic: the tool catalogue carries its own anchor');
        assert.ok((JSON.stringify(a).match(/cache_control/g)||[]).length<=4,provider+': marker limit respected');
        assert.ok((JSON.stringify(b).match(/cache_control/g)||[]).length<=4,provider+': marker limit respected with history');
      } else {
        assert.deepEqual(a.messages[0],b.messages[0],'custom: the system message is BYTE-IDENTICAL across the two messages');
        assert.equal(typeof a.messages[0].content,'string','generic provider keeps string system prompt');
        for(const body of bodies) assert.equal(body.messages.filter(m=>m.role==='system').length,1,'custom: exactly ONE system message (the notes ride the newest user turn)');
        assert.ok(!JSON.stringify(a).includes('cacheSystemPrefix'),'internal cache hint does not leak to wire');
      }
    }
    console.log('prompt-cache-prefix.e2e: PASS (three live adapters, stable cross-run prefix, full task context and tools)');
  } finally { await fixture.dispose(); await new Promise(resolve=>upstream.close(resolve)); }
})().catch(e=>{console.error(e);process.exitCode=1;});
