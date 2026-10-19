/* CLI review regressions: mocked children/files only; no CLI, network or native process. */
'use strict';
const A = require('./_assert.js');
const { EventEmitter } = require('node:events');
const { makeClaudeCliProvider } = require('../sidecar/providers/claude-cli.js');
const init = source => ({ type: 'system', subtype: 'init', apiKeySource: source });
const delta = text => ({ type: 'stream_event', event: { type: 'content_block_delta', delta: { type: 'text_delta', text } } });
const usage = { input_tokens: 100, output_tokens: 5, cache_read_input_tokens: 20 };
const result = (text, cost, extra) => Object.assign({ type: 'result', subtype: 'success', result: text, usage, total_cost_usd: cost, stop_reason: 'end_turn' }, extra);
const block = '<function_calls><invoke name="read"><parameter name="path">a</parameter></invoke></function_calls>';
const tools = [{ type: 'function', function: { name: 'read', parameters: { type: 'object', properties: { path: { type: 'string' } } } } }];
const tick = () => new Promise(resolve => setImmediate(resolve));
function rig(script, options = {}) {
  const children = [], kills = [], removed = [];
  const spawn = (file, args) => {
    const child = new EventEmitter();
    if (file === 'taskkill') {
      const target = children.find(c => String(c.child.pid) === args[1]);
      const attempt = { child, target, finish: code => child.emit('close', code) };
      kills.push(attempt);
      if (!options.pendingKill) setImmediate(() => {
        const code = options.failKill && kills.length === 1 ? 1 : 0;
        if (code === 0 && !options.stubborn) target.exit(null);
        attempt.finish(code);
      });
      return child;
    }
    const record = { child, inputs: [], exited: false, args };
    child.pid = 7100 + children.length; child.exitCode = null; child.signalCode = null;
    record.exit = code => { if (record.exited) return; record.exited = true; child.exitCode = code; child.signalCode = code === null ? 'SIGTERM' : null; child.emit('exit', code); child.emit('close', code); };
    record.emit = data => { if (!record.exited) child.stdout.emit('data', JSON.stringify(data) + '\n'); };
    const pipe = () => Object.assign(new EventEmitter(), { setEncoding() {} });
    child.stdout = pipe(); child.stderr = pipe();
    child.kill = () => { record.directKills = (record.directKills || 0) + 1; if (!options.stubborn) record.exit(null); return true; };
    child.stdin = Object.assign(new EventEmitter(), {
      write(text) { record.inputs.push(JSON.parse(text)); setImmediate(() => { for (const line of script(record, record.inputs.length, children.length) || []) record.emit(line); }); return true; },
      end() { if (!options.keepAliveOnEnd) setImmediate(() => record.exit(0)); }
    });
    children.push(record);
    if (options.earlyInit !== undefined) setImmediate(() => record.emit(init(options.earlyInit)));
    return child;
  };
  const provider = makeClaudeCliProvider({ spawn, fs: { statSync: () => ({ isFile: () => true }), writeFileSync() {}, unlinkSync: file => removed.push(file) },
    bin: 'mock-cli', env: { PATH: '' }, platform: options.platform || 'win32', persistEndGraceMs: 50 });
  const ac = new AbortController();
  const request = messages => ({ model: 'sonnet', tools, messages, runId: 'review-run', signal: ac.signal });
  return { provider, ac, request, children, kills, removed, dispose() { for (const c of children) c.exit(0); } };
}
async function collect(p, req) { const events = []; let error; try { for await (const event of p.stream(req)) events.push(event); } catch (e) { error = e; } return { events, error }; }
function reply(events) {
  const calls = [];
  for (const event of events) {
    if (event.type === 'tool_start') calls[event.index] = { id: event.id, type: 'function', function: { name: event.name, arguments: '' } };
    if (event.type === 'tool_args') calls[event.index].function.arguments += event.chunk;
  }
  const r = { role: 'assistant', content: events.filter(e => e.type === 'text').map(e => e.delta).join('') };
  if (calls.length) r.tool_calls = calls;
  return r;
}
const startMessages = () => [{ role: 'system', content: 'Review fixture' }, { role: 'user', content: 'Read a' }];
const spent = r => { const event = r.events.find(e => e.type === 'usage'); return event && event.usage.cost; };
(async () => {
  // Initialization may be emitted only once; cost provenance stays with this child/account.
  for (const source of ['none', 'ANTHROPIC_API_KEY']) {
    const r = rig((c, n) => [...(n === 1 ? [init(source)] : []), delta(n === 1 ? block : 'done'), result(n === 1 ? block : 'done', n * 0.25)]);
    try {
      const messages = startMessages(), first = await collect(r.provider, r.request(messages));
      const a = reply(first.events); messages.push(a, { role: 'tool', tool_call_id: a.tool_calls[0].id, content: 'contents' });
      const second = await collect(r.provider, r.request(messages));
      A.eq([spent(first), spent(second)], source === 'none' ? [0, 0] : [0.25, 0.25], 'R1 init-once costs remain scoped to ' + source);
      A.eq(r.children.length, 1, 'R1 the second turn really reused its child');
      A.eq(second.events.filter(e => e.type === 'done').length, 1, 'R1 one terminal on the reused turn');
    } finally { r.dispose(); }
  }
  {
    const r = rig((c, n, count) => count === 1 ? [delta(block + ' invented'), result(block + ' invented', 0.25)] : [delta('done'), result('done', 0.25)], { earlyInit: 'none' });
    try {
      const messages = startMessages(), first = await collect(r.provider, r.request(messages));
      await tick(); // warm child emits init while it has no active turn sink
      const a = reply(first.events); messages.push(a, { role: 'tool', tool_call_id: a.tool_calls[0].id, content: 'real' });
      const second = await collect(r.provider, r.request(messages));
      A.eq(r.children.length, 2, 'R1 warm replacement is reused rather than hidden by another cold start');
      A.eq(spent(second), 0, 'R1 warm init observed before the prompt still establishes subscription provenance');
    } finally { r.dispose(); }
  }
  // A termination attempt is not exit proof; release retries exactly the owned child.
  for (const kind of ['failed', 'delayed', 'pending', 'posix']) {
    const r = rig(() => [init('none'), delta('done'), result('done', 0)], { keepAliveOnEnd: true, failKill: kind === 'failed', stubborn: kind === 'delayed' || kind === 'posix', pendingKill: kind === 'pending', platform: kind === 'posix' ? 'linux' : 'win32' });
    try {
      await collect(r.provider, r.request(startMessages()));
      r.provider.release('review-run'); await tick();
      const state = r.provider.persistStats();
      A.eq(state.live, true, 'R2 ' + kind + ': unknown exit remains owned/live');
      A.eq(state.reusable, false, 'R2 ' + kind + ': closing child cannot serve another turn');
      A.eq(state.cleanupPending, 1, 'R2 ' + kind + ': pending cleanup is explicit');
      A.eq(r.removed.length, 0, 'R2 ' + kind + ': prompt file retained until observed close');
      if (kind === 'failed') A.eq(state.cleanupFailures, 1, 'R2 taskkill nonzero is visible');
      const attempts = r.kills.length;
      r.provider.release('other-run');
      A.eq(r.kills.length, attempts, 'R2 unrelated run release is harmless');
      if (kind === 'pending') {
        r.provider.release('review-run');
        A.eq(r.kills.length, 1, 'R2 pending taskkill does not race a duplicate attempt');
        r.kills[0].finish(1);
        r.provider.release('review-run');
        A.eq(r.kills.length, 2, 'R2 failed pending attempt remains retryable');
      } else if (kind === 'failed') {
        r.provider.release('review-run'); await tick();
        A.eq(r.kills.length, 2, 'R2 nonzero taskkill can be retried');
      } else if (kind === 'posix') {
        r.provider.release('review-run');
        A.eq(r.children[0].directKills, 2, 'R2 ignored SIGTERM remains retryable');
      }
      r.children[0].exit(null);
      A.eq(r.provider.persistStats().live, false, 'R2 observed signal-style close clears ownership even with null exitCode');
      A.eq(r.removed.length, 1, 'R2 confirmed close removes the owned prompt once');
      r.provider.release('review-run');
      A.eq(r.removed.length, 1, 'R2 repeated release after exit is harmless');
    } finally { r.dispose(); }
  }
  {
    const r = rig(() => [init('none'), delta('done'), result('done', 0)], { keepAliveOnEnd: true });
    try {
      await collect(r.provider, r.request(startMessages()));
      const child = r.children[0].child;
      child.signalCode = 'SIGTERM'; child.emit('exit', null, 'SIGTERM');
      r.provider.release('review-run');
      A.eq(r.kills.length, 0, 'R2 exit before pipe close never targets a potentially reused PID');
      A.eq(r.provider.persistStats().reusable, false, 'R2 exited child is never reused while pipes are closing');
      A.eq(r.provider.persistStats().cleanupPending, 1, 'R2 exit alone keeps pending resource ownership until close');
      r.children[0].exit(null);
      A.eq(r.provider.persistStats().live, false, 'R2 close after exit completes cleanup');
    } finally { r.dispose(); }
  }
  // A terminal error after a parsed tool block must account and throw, not succeed or prewarm.
  for (const [tag, status, code] of [['authentication_failed', 401, 'provider_not_configured'], ['rate_limit', 429, 'usage_limit_reached']]) {
    const r = rig(() => [init('ANTHROPIC_API_KEY'), delta(block), { type: 'assistant', error: tag }, result('rejected', 0.25, { is_error: true, subtype: 'error_during_execution' })]);
    try {
      const out = await collect(r.provider, r.request(startMessages()));
      A.eq(out.error && [out.error.status, out.error.code], [status, code], 'R3 ' + tag + ': original classification survives grace settlement');
      A.eq(spent(out), 0.25, 'R3 failed turn books its complete usage/cost before throwing');
      A.eq(out.events.filter(e => e.type === 'usage').length, 1, 'R3 no duplicate/incremental usage snapshot');
      A.eq(out.events.filter(e => e.type === 'tool_start').length, 1, 'R3 parsed call is not emitted twice');
      A.eq(out.events.filter(e => e.type === 'done').length, 0, 'R3 failure never reports successful done');
      A.eq(r.children.length, 1, 'R3 terminal failure never prewarms a replacement');
    } finally { r.dispose(); }
  }
  for (const mode of ['plain-success', 'tool-success', 'tool-error']) {
    const text = mode === 'plain-success' ? 'done' : block;
    const r = rig(c => {
      setImmediate(() => {
        c.child.exitCode = 0; c.child.emit('exit', 0);
        setImmediate(() => {
          if (mode === 'tool-error') c.emit({ type: 'assistant', error: 'rate_limit' });
          c.emit(result(mode === 'tool-error' ? 'rejected' : text, 0.25, mode === 'tool-error' ? { is_error: true } : {}));
          c.exit(0);
        });
      });
      return [init('ANTHROPIC_API_KEY'), delta(text)];
    }, { keepAliveOnEnd: true });
    try {
      const out = await collect(r.provider, r.request(startMessages()));
      A.eq(spent(out), 0.25, 'R2 late stdout after exit retains exact result cost: ' + mode);
      A.eq(out.events.filter(e => e.type === 'done').length, mode === 'tool-error' ? 0 : 1, 'R2 late terminal controls success/failure: ' + mode);
      A.eq(out.error && out.error.code, mode === 'tool-error' ? 'usage_limit_reached' : undefined, 'R2 late result remains authoritative: ' + mode);
      A.eq(r.children.length, 1, 'R2 exit before stdout never causes a false no_end prewarm');
      A.eq(r.kills.length, 0, 'R2 draining stdout never kills an exited PID');
    } finally { r.dispose(); }
  }
  for (const tag of ['authentication_failed', 'rate_limit']) for (const end of ['eof', 'timeout']) {
    const r = rig(c => {
      if (end === 'eof') setImmediate(() => c.exit(0));
      return [init('ANTHROPIC_API_KEY'), { type: 'stream_event', event: { type: 'message_start', message: { usage } } }, delta(block), { type: 'assistant', error: tag }];
    });
    try {
      const out = await collect(r.provider, r.request(startMessages()));
      A.eq(out.error && out.error.code, tag === 'rate_limit' ? 'usage_limit_reached' : 'provider_not_configured', 'R3 observed ' + tag + ' survives missing result/' + end);
      A.eq(out.events.filter(e => e.type === 'done').length, 0, 'R3 missing result cannot turn observed failure into done');
      A.eq(out.events.filter(e => e.type === 'usage').length, 1, 'R3 missing result preserves one available usage snapshot');
      A.eq(out.events.find(e => e.type === 'usage').usage.prompt_tokens, 120, 'R3 partial usage preserves observed input/cache tokens');
      A.ok(spent(out) > 0 && spent(out) !== 0.25, 'R3 no result uses existing partial estimate, not invented actual billed cost');
      A.eq(out.events.filter(e => e.type === 'tool_start').length, 1, 'R3 missing result never re-emits tool deltas');
      A.eq(r.children.length, 1, 'R3 missing-result failure never prewarms');
    } finally { r.dispose(); }
  }
  {
    const r = rig(() => [init('none'), delta('done'), result('done', 0)], { keepAliveOnEnd: true, failKill: true });
    try {
      await collect(r.provider, r.request(startMessages()));
      r.provider.release('review-run'); await tick();
      await collect(r.provider, { ...r.request(startMessages()), runId: 'next-run' });
      A.eq(r.children.length, 2, 'R2 a new turn uses a new child while old cleanup remains owned');
      r.provider.release('review-run'); await tick();
      A.eq(r.children[1].exited, false, 'R2 old-run cleanup never terminates the replacement');
      A.eq(r.provider.persistStats().reusable, true, 'R2 old close does not clear the replacement session');
      A.eq(r.provider.persistStats().cleanupPending, 0, 'R2 confirmed old cleanup removes only its pending owner');
    } finally { r.dispose(); }
  }
  A.report('claude-cli-persist-review.test');
})().catch(e => { console.error(e); process.exitCode = 1; });
