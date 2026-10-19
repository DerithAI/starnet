/* node test/harness.cancel-truth.test.js — STOP MEANS STOP, browser side (audit 2026-09-03).

   Harness.cancel swallowed a failed POST /api/cancel and chat.js tore the local fetch down first, so a refused or
   unreachable cancel rendered a clean "RUN STOPPED" while the run kept burning server-side; consentAck swallowed
   its failure the same way. harness.js and chat.js are browser IIFEs, so this is the house pattern: the two
   harness functions are lifted out by fnBody and RUN against a fake fetch, and chat.js's stop flow is source-locked. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const harnessSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'harness.js'), 'utf8');
const chatSrc = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'chat.js'), 'utf8');

// lift one async function out of the IIFE and bind it to a fake fetch
function lift(name) {
  const body = A.fnBody(harnessSrc, 'async function ' + name);
  A.ok(body.length > 100, name + ' body located');
  return (fetchImpl) => new Function('fetch', body + '\nreturn ' + name + ';')(fetchImpl);
}
const calls = [];
const fetchOk = async (url, init) => { calls.push([url, init]); return { ok: true, status: 200 }; };
const fetch500 = async () => ({ ok: false, status: 500 });
const fetchDown = async () => { throw new TypeError('Failed to fetch'); };

(async () => {
  /* ---- Harness.cancel: the answer is the sidecar's ---- */
  const cancel = lift('cancel');
  A.eq(await cancel(fetchOk)('r1'), { ok: true }, 'a 2xx from /api/cancel is the ONLY way to get ok:true');
  A.eq(calls[0][0], '/api/cancel', 'it POSTs /api/cancel');
  A.eq(JSON.parse(calls[0][1].body), { runId: 'r1' }, 'with the run id');
  const refused = await cancel(fetch500)('r1');
  A.eq([refused.ok, refused.status], [false, 500], 'a non-2xx is ok:false and names the status');
  A.ok(/http 500/.test(refused.error), 'the error text carries the status: ' + refused.error);
  const down = await cancel(fetchDown)('r1');
  A.eq([down.ok, down.transport], [false, true], 'a thrown fetch is ok:false and flagged transport (LINK DOWN wording upstream)');
  A.ok(/Failed to fetch/.test(down.error), 'the original transport error is kept, not invented');
  A.eq((await cancel(fetchOk)('')).ok, false, 'no run id -> ok:false (nothing was cancelled)');
  // (review 2026-10-14) the station's answer says whether a live run was there to stop; the page passes that fact on
  // unchanged, and never invents it when the answer does not say
  const fetchSays = said => async () => ({ ok: true, status: 200, json: async () => said });
  A.eq(await cancel(fetchSays({ ok: true, stopped: true }))('r1'), { ok: true, stopped: true }, 'stopped:true from the station is passed on');
  A.eq(await cancel(fetchSays({ ok: true, stopped: false }))('r1'), { ok: true, stopped: false }, 'stopped:false (the id was already gone) is passed on — still a confirmed 2xx');
  A.eq(await cancel(fetchSays({ ok: true, stopped: 'yes' }))('r1'), { ok: true }, 'a non-boolean stopped is not trusted');
  A.eq(await cancel(async () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token o'); } }))('r1'), { ok: true }, 'a 2xx whose body is not JSON is still ok, and says nothing about stopped');

  /* ---- Harness.consentAck: same honesty ---- */
  const consentAck = lift('consentAck');
  A.eq(await consentAck(fetchOk)('r1', 'p1'), { ok: true }, 'ack 2xx -> ok:true');
  A.eq((await consentAck(fetch500)('r1', 'p1')).ok, false, 'ack refused -> ok:false');
  const ackDown = await consentAck(fetchDown)('r1', 'p1');
  A.eq([ackDown.ok, ackDown.transport], [false, true], 'ack transport failure -> ok:false, transport:true');
  A.eq((await consentAck(fetchOk)('r1', '')).ok, false, 'missing prompt id -> ok:false');

  /* ---- no silent swallow is left on either function ---- */
  for (const name of ['cancel', 'consentAck']) {
    const body = A.fnBody(harnessSrc, 'async function ' + name);
    A.ok(!/catch \(_\) \{\}/.test(body), name + ' has no bare catch (_) {} swallow');
    A.ok(/if \(!r\.ok\) return \{ ok: false/.test(body), name + ' reads r.ok (the Response stays in scope)');
  }

  /* ---- chat.js stop flow: the local teardown WAITS for the sidecar's answer ---- */
  const stop = A.fnBody(chatSrc, 'function stopActive');
  A.ok(stop.length > 500, 'stopActive body located');
  const cancelIdx = stop.indexOf('Harness.cancel(rid)');
  const localIdx = stop.indexOf('const localAbort = ');
  A.ok(cancelIdx > 0 && localIdx > 0, 'stopActive both defines the local abort and calls Harness.cancel');
  A.ok(/\.then\(v => \{ if \(v && v\.ok\) localAbort\(\); else stopFailed\(id, v\); \}/.test(stop), 'the local fetch is aborted ONLY on ok:true; anything else routes to stopFailed');
  A.ok(!/const ac = aborters\.get\(id\); if \(ac\) \{ try \{ ac\.abort\(\); \} catch \(_\) \{\} \}\s*\/\/ aborts the fetch/.test(stop) || /localAbort/.test(stop), 'no unconditional pre-cancel abort remains');
  // (stall report 2026-10-13) a send with no run id also asks the station to stop the report holding its conversation
  // (stop-truth.test.js 1b), but its own local abort never waits on that answer
  A.ok(/\} else \{ if \(!rid\) stopReportHolding\(id\); localAbort\(\); \}/.test(stop), 'with no run id there is nothing server-side to kill: the local abort stands alone');
  A.ok(/stopFailed\(id, \{ ok: false, error: /.test(stop), 'a rejected cancel promise also routes to stopFailed (never a silent stop)');

  const failed = A.fnBody(chatSrc, 'function stopFailed');
  A.ok(failed.length > 200, 'stopFailed body located');
  A.ok(/interrupted\.delete\(id\)/.test(failed), 'an unconfirmed stop un-flags the stream: it is never marked stopped on a claim the harness cannot back');
  A.ok(/Harness\.pingEngine\(\)/.test(failed) && /Friendly\.friendlyError\(new Error\(reason\), null, \{ engineAlive: engineAlive \}\)/.test(failed), 'the transport verdict is MEASURED (pingEngine) and worded by friendlyError, the same path send()\'s catch uses');
  A.ok(/STOP was not confirmed by the station — the run may still be working\./.test(failed), 'the line says the run may still be working (truthful telemetry)');
  A.ok(/status\(isBusy\(\) \? 'stopping… not confirmed' : 'online'\)/.test(failed), 'the status stays in the stopping family while the run is still busy');

  /* ---- chat.js consent ack: a failed ack is surfaced, the card stays pending ---- */
  A.ok(/Promise\.resolve\(Harness\.consentAck\(Channels\.runIdOf\(ws\.id\), ev\.promptId\)\)\.then\(v => \{ if \(!\(v && v\.ok\)\) consentAckFailed\(ws, ev, v\); \}/.test(chatSrc), 'the onPermission ack checks ok and routes a failure to consentAckFailed');
  const ackFailed = A.fnBody(chatSrc, 'function consentAckFailed');
  A.ok(/auto-denies on a timer/.test(ackFailed), 'the warning tells the Commander why it matters (the fail-closed timer is still running)');
  A.ok(!/clearPending|Channels\.setPending/.test(ackFailed), 'the pending card is left pending — it IS pending');

  A.report('harness.cancel-truth');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
