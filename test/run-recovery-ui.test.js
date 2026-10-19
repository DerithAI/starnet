'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const harness = fs.readFileSync(path.join(root, 'frontend', 'app', 'harness.js'), 'utf8');
const chat = fs.readFileSync(path.join(root, 'frontend', 'app', 'chat.js'), 'utf8');
const mirrorHarness = fs.readFileSync(path.join(root, 'website', 'app', 'app', 'harness.js'), 'utf8');
const mirrorChat = fs.readFileSync(path.join(root, 'website', 'app', 'app', 'chat.js'), 'utf8');

A.eq(harness, mirrorHarness, 'website harness mirror carries the same recovery client');
A.eq(chat, mirrorChat, 'website chat mirror carries the same recovery behavior');
A.ok(/mode: 'automatic'/.test(harness) && /continuationToken/.test(harness), 'browser prepares the typed one-shot automatic continuation');
A.ok(/r\.canAutoContinue/.test(chat), 'chat only auto-starts a server-proven safe recovery');
A.ok(/operationalState === 'needs_review'/.test(chat), 'review-required recovery has a distinct UI path');
A.ok(/StarNet will not repeat it/.test(chat), 'uncertain mutation copy states the no-duplicate guarantee');
A.ok(/It happened/.test(chat) && /It did not happen/.test(chat) && /I am not sure/.test(chat), 'uncertain mutation presents explicit outcome choices');
A.ok(/resolveRunRecovery/.test(harness) && /prepareReviewedRecovery/.test(harness), 'review decisions persist before reviewed continuation starts');
A.ok(/recovery: recoveryResume \? opts\.recovery : undefined/.test(chat), 'recovery re-enters the ordinary Harness.chat execution path');
A.ok(!/last run was interrupted and can\\'t resume/.test(chat), 'obsolete unconditional cannot-resume claim is gone');

// Execute the actual recovery function against deferred fakes; no app, network or provider.
const recoverySource = A.fnBody(chat, 'async function recoverSafeRun');
A.ok(recoverySource.length > 1000 && recoverySource.length < 5000 && !recoverySource.includes('async function probeReconnect'), 'exact recovery function located');
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
let controlsCompleted = false;
process.once('beforeExit', () => { if (!controlsCompleted) { console.error('recovery announcement controls did not complete'); process.exitCode = 1; } });
(async () => {
  for (const mode of ['rejected', 'focus-changed', 'busy', 'success', 'quiet', 'send-rejected']) {
    const preparation = deferred(), entered = deferred(), sending = deferred(), sendEntered = deferred();
    const ws = { id: 'stream-one', agentId: 'agent-one' }, safe = { runId: 'safe-one', streamId: ws.id, agentId: ws.agentId, startedAt: 1, canAutoContinue: true, userTitle: 'Continue task' };
    const claims = new Set(), lines = [], calls = [], order = [];
    const token = { continuationToken: 'fake-one-shot-token' }, originalError = new Error('fake rejection');
    let focused = true, busy = false;
    const recover = new Function('fetch', 'Harness', 'Channels', 'isActiveWs', 'recoveryClaims', 'recoveryNotices', 'toolLine', 'offerRecoveryReview', 'send', recoverySource + '\nreturn recoverSafeRun;')(
      async () => ({ ok: true, json: async () => ({ briefs: [] }) }),
      { runRecoveries: async () => [safe], prepareAutomaticRecovery(row) { A.ok(row === safe, mode + ': original recovery selected'); entered.resolve(); return preparation.promise; } },
      { isBusy: () => busy }, () => focused, claims, new Set(),
      line => { lines.push(line); order.push('announcement'); }, () => { throw new Error('unexpected review path'); },
      (text, options) => { calls.push({ text, options }); order.push('send'); sendEntered.resolve(); return sending.promise; }
    );
    const operation = recover(ws, mode !== 'quiet');
    // Attach rejection handling immediately, including the authored send-rejection row.
    const settled = operation.then(value => ({ value }), error => ({ error }));
    await entered.promise;
    A.eq(lines, [], mode + ': pending preparation never announces continuation');
    A.eq(calls.length, 0, mode + ': pending preparation never sends');
    A.ok(claims.has(safe.runId), mode + ': original in-flight claim retained');
    if (mode === 'rejected') preparation.reject(originalError);
    else {
      if (mode === 'focus-changed') focused = false;
      if (mode === 'busy') busy = true;
      preparation.resolve(token);
    }
    if (['rejected', 'focus-changed', 'busy'].includes(mode)) {
      const result = await settled;
      A.eq(result.value, mode === 'rejected' ? 'unavailable' : 'deferred', mode + ': original result preserved');
      A.eq(lines, [], mode + ': no premature announcement');
      A.eq(calls.length, 0, mode + ': no continuation sent');
      A.ok(!claims.has(safe.runId), mode + ': original claim release preserved');
    } else {
      await sendEntered.promise;
      A.eq(lines, mode === 'quiet' ? [] : ['recovery prepared — requesting continuation from the last durable step.'], mode + ': only prepared/requesting state announced');
      A.eq(order, mode === 'quiet' ? ['send'] : ['announcement', 'send'], mode + ': announcement follows preparation and precedes request');
      A.eq(calls.length, 1, mode + ': exactly one continuation request');
      A.eq(calls[0].text, safe.userTitle, mode + ': original continuation text');
      A.ok(calls[0].options.recovery === token && calls[0].options.retry === true && calls[0].options.recoveryResume === true, mode + ': original token and retry flags');
      if (mode === 'send-rejected') sending.reject(originalError); else sending.resolve();
      const result = await settled;
      if (mode === 'send-rejected') A.ok(result.error === originalError, 'send rejection preserves original error identity');
      else A.eq(result.value, 'started', mode + ': legacy internal result preserved, not interpreted as inference acknowledgement');
      A.ok(claims.has(safe.runId), mode + ': original post-send claim behavior preserved');
      A.eq(lines.length, mode === 'quiet' ? 0 : 1, mode + ': no invented started/success announcement');
    }
  }
  await require('./helpers/reconnect-health-controls.js')(A, chat);
  controlsCompleted = true;
  A.report('run-recovery-ui.test');
})().catch(error => { console.error(error); process.exitCode = 1; });
