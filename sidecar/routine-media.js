/* sidecar/routine-media.js — the files a scheduled routine's delivery carries into a chat.

   THE GAP (issue 2026-10-18, "Telegram messages cannot be automated to include images"). A routine's REPLY is what
   reaches the Commander's chat (index.js deliverCronResult), and an unattended run cannot channel.send at all — it
   is scope 'execute', and the exec lockout (permissions.js tier 2.5) denies it with nobody there to approve. The
   delivery was words-only, so a routine that rendered an image or drew a chart could at best name its path:
   Telegram never received the picture.

   THE FIX rides the delivery that is ALREADY approved. The Commander chose the destination when the routine was
   saved; the files go to that same chat, read through the same workspace jail channel.send uses (the host's
   readFile), uploaded with the same transport call. No new reach: a file can only go where the routine's words
   already go, and only from the workspace of an agent that ran in this fire.

   Which files (capped at MAX_FILES, the same 4 channel.send allows):
     1. ATTACH lines in the final reply — "ATTACH: charts/today.png", one per line. The agent's explicit choice,
        and the lines are removed from the delivered text (they are an instruction to the station, not prose).
        "MEDIA:" is read the same way: it is the reference harness's spelling and models carry it over.
     2. Otherwise the images the fire itself GENERATED (image_generate artifacts on its run rows), so a routine
        whose model forgot the convention still delivers the picture it paid for.
   Neither applies to a chat the fire already sent its own files to with channel.send (possible under Full Access —
   filesAlreadySent): the same picture must not arrive twice.

   THE WORDS GO FIRST and files follow (channel.send's law): a channel that cannot upload never swallows the
   message. A file that does not arrive is said out loud in the chat, naming where it is on the station.

   Pure + injected: no fs/network/clock here; the host passes read/send. */
'use strict';
(function (root, factory) {
  const api = factory(typeof require === 'function' ? require('./tools/builtin/comms.js') : (root.SK && root.SK.tools && root.SK.tools.builtin && root.SK.tools.builtin.comms));
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else { (root.SK = root.SK || {}).routineMedia = api; }
})(typeof globalThis !== 'undefined' ? globalThis : this, function (comms) {
  'use strict';

  const MAX_FILES = comms.MAX_FILES;
  const kindForMime = comms.kindForMime;
  // A whole line that is only the instruction: optional bullet, the word, then the path (optionally `quoted`).
  const ATTACH_LINE = /^\s*(?:[-*•]\s*)?(?:ATTACH|MEDIA)\s*:\s*[`"']?([^`"'\r\n]+?)[`"']?\s*$/i;

  /* parseReply(text) -> { text, files }
     Pulls the ATTACH lines out of a reply. `text` is the reply without them (trailing blank lines trimmed);
     `files` is the paths in order, de-duplicated. A reply with no ATTACH line comes back unchanged. */
  function parseReply(text) {
    const src = String(text == null ? '' : text);
    const files = [];
    let found = false;
    const kept = [];
    for (const line of src.split(/\r?\n/)) {
      const m = ATTACH_LINE.exec(line);
      if (!m) { kept.push(line); continue; }
      found = true;
      const p = m[1].trim();
      if (p && files.indexOf(p) < 0) files.push(p);
    }
    if (!found) return { text: src, files: [] };
    return { text: kept.join('\n').replace(/\s+$/, ''), files: files };
  }

  /* filesAlreadySent(runs, target, chatId) -> true when the fire itself already put files into THIS chat with a
     successful channel.send (possible under Full Access). Live 2026-10-18: the routine's prompt said "send it using
     channel_send", the run did that AND wrote an ATTACH line, and the picture arrived twice. The tool's own summary
     names where it went — "sent to <target>[ in N parts] with N file(s)" — so the check is per destination: a send
     to another chat, a words-only send, or a refused one (ASK) leaves this delivery to carry the files. */
  function filesAlreadySent(runs, target, chatId) {
    const want = [String(target || ''), String(chatId || '')].filter(Boolean);
    const id = String(chatId || '');
    return (Array.isArray(runs) ? runs : []).some(r => r && (Array.isArray(r.toolTrace) ? r.toolTrace : []).some(t => {
      if (!t || !/^channel[._]send$/.test(String(t.name || '')) || t.ok !== true || t.isError) return false;
      const m = /^sent to (\S+?)(?: in \d+ parts)? with [1-9]\d* file/.exec(String(t.summary || ''));
      if (!m) return false;
      return want.indexOf(m[1]) >= 0 || (!!id && m[1].slice(-(id.length + 1)) === '|' + id);   // '<botId>|<chatId>' keys
    }));
  }

  /* pickFiles({ named, runs, agentId }) -> { files:[{ path, agents:[agentId…] }], dropped:[path…] }
     runs = the fire's run rows ({ agentId, artifacts }), NEWEST first. A named path is tried in the workspace of
     every agent that ran in this fire, newest first (on a work line the delivered words are the LAST stage's),
     then the routine's own agent. With nothing named, each image the fire generated is read from the workspace of
     the agent that generated it, in the order they were made. `dropped` is what the cap left behind. */
  function pickFiles(o) {
    o = o || {};
    const runs = Array.isArray(o.runs) ? o.runs.filter(r => r && typeof r === 'object') : [];
    const own = String(o.agentId || '');
    const agents = [];
    for (const r of runs) { const a = String(r.agentId || ''); if (a && agents.indexOf(a) < 0) agents.push(a); }
    if (own && agents.indexOf(own) < 0) agents.push(own);
    const named = Array.isArray(o.named) ? o.named.filter(p => typeof p === 'string' && p.trim()) : [];
    let all;
    if (named.length) {
      all = named.map(p => ({ path: p, agents: agents.slice() }));
    } else {
      all = [];
      for (const r of runs.slice().reverse()) {
        for (const a of (Array.isArray(r.artifacts) ? r.artifacts : [])) {
          if (!a || a.kind !== 'image' || !a.path) continue;
          const p = String(a.path);
          if (all.some(f => f.path === p)) continue;
          all.push({ path: p, agents: [String(r.agentId || own)].filter(Boolean) });
        }
      }
    }
    return { files: all.slice(0, MAX_FILES), dropped: all.slice(MAX_FILES).map(f => f.path) };
  }

  /* sendFiles(files, { read(agentId, rel), send(item) }) -> Promise<{ attached:[path], failed:[{ path, error }] }>
     Sequential, never throws. read answers { ok, buffer, name, mime } | { ok:false, error } (the host's jail proof);
     send answers the transport's SendResult. The first agent whose workspace holds the file wins. */
  async function sendFiles(files, io) {
    const read = io && typeof io.read === 'function' ? io.read : null;
    const send = io && typeof io.send === 'function' ? io.send : null;
    const attached = [], failed = [];
    for (const f of (Array.isArray(files) ? files : [])) {
      if (!read || !send) { failed.push({ path: f.path, error: 'attaching files is not wired on this host' }); continue; }
      let got = null, readError = '';
      for (const agentId of (f.agents && f.agents.length ? f.agents : [''])) {
        try { got = await read(agentId, f.path); } catch (e) { got = { ok: false, error: (e && e.message) || 'read threw' }; }
        if (got && got.ok !== false && got.buffer && got.buffer.length) break;
        readError = readError || (got && got.error) || 'not found';
        got = null;
      }
      if (!got) { failed.push({ path: f.path, error: 'could not be read from the workspace (' + readError + ')' }); continue; }
      const name = String(got.name || f.path).split(/[\\/]/).pop();
      const item = { kind: kindForMime(got.mime, name), buffer: got.buffer, filename: name, mime: got.mime || '' };
      let r;
      try { r = await send(item); } catch (e) { r = { ok: false, error: (e && e.message) || 'upload threw' }; }
      if (r && r.ok) attached.push(f.path);
      else failed.push({ path: f.path, error: (r && r.error) || 'upload failed' });
    }
    return { attached: attached, failed: failed };
  }

  // The chat line for files that did not come — channel.send's own wording, so both paths read the same.
  function missedNote(paths) {
    const list = (Array.isArray(paths) ? paths : []).filter(Boolean);
    if (!list.length) return '';
    return 'Note: ' + (list.length === 1 ? 'this file' : 'these files') + ' could not be attached here — '
      + list.map(p => '"' + p + '"').join(', ') + '. ' + (list.length === 1 ? 'It is' : 'They are') + ' saved in the workspace on the station.';
  }

  /* deliveryNote(platforms) -> the system-prompt paragraph for a routine whose reply goes to a chat ('' otherwise).
     Only a chat-bound routine gets it: a routine that stays on the station has nowhere to upload to, and an
     instruction it cannot use would only put ATTACH lines into a COMMS session. */
  function deliveryNote(platforms) {
    const names = (Array.isArray(platforms) ? platforms : []).map(p => String(p || '').trim()).filter(Boolean);
    if (!names.length) return '';
    const where = names.filter((p, i) => names.indexOf(p) === i).join(' / ');
    // Live finding (haiku-4.5, 2026-10-18): told only the ATTACH format, the model still called channel.targets, found
    // no listed chat and wrote "I cannot send the image to you" into a delivery that carried the image. So the note
    // says up front that the STATION delivers, and rules out the lookup as well as the send.
    return '\n\n[DELIVERY] The station sends this routine\'s reply to the Commander\'s ' + where + ' chat for you — do not '
      + 'look up chat targets or call channel.send. To include a file you made (an image, chart or document in your '
      + 'workspace), end the reply with one line per file: ATTACH: <workspace-relative path> — up to ' + MAX_FILES
      + '; images arrive inline. Never write that the message or a file cannot be sent.';
  }

  return { parseReply, pickFiles, filesAlreadySent, sendFiles, missedNote, deliveryNote, MAX_FILES };
});
