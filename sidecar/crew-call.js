/* sidecar/crew-call.js — CREW CALL: when the Commander's request NAMES a crew member and asks for work, say so at
   the END of the lead's prompt.

   Why (2026-10-11 user report, "if only I could get my chief operations manager to delegate"): reproduced live on
   Ollama qwen3:8b. Asked "Have Ada research three facts about JWST", a custom lead with team.dispatch granted and
   Ada listed under YOUR TEAM did the research itself about half the time. The delegation briefing sits ~7.5k
   characters into a ~24k system prompt, the part of the prompt a small local model weighs least. This note is
   short, request-specific, and last: it names who was asked for and the exact call, nothing more.

   Advisory only: it never dispatches anything and never blocks the lead from answering itself. It composes only
   when the caller has verified team.dispatch is in this run's granted tools (a prompt must not demand a tool the
   model does not have). Pure: no I/O, no clock. */
'use strict';

// "have Ada …", "ask the researcher to …", "get Quill on this", "delegate to Ada", "loop in the analyst".
const ASK = '(?:have|ask|get|tell|let|send|use|put|dispatch|task|loop in|bring in|(?:delegate|assign|hand|give)(?:\\s+(?:this|it|the task))?\\s+to)';
// This note is an unconditional SYSTEM directive, so a request that retracts, hedges or quotes cannot prove it: any such
// word ANYWHERE vetoes it (fail closed — a missed note leaves the lead to decide; a wrong one delegates against the
// Commander's wish). Ordinary task words are not hedges: "check IF the tests pass" and "write it WITHOUT jargon" still
// ask Ada for the work (review 2026-10-12: the old list vetoed them, undoing the 0/4 -> 4/4 fix below).
const QUALIFIED = /\b(?:no|not|never|nope|nah|cancel(?:l?ed)?|don['’]?t|doesn['’]?t|won['’]?t|shouldn['’]?t|unless|maybe|perhaps|instead|actually|wait|scratch\s+that|never\s*mind|on\s+second\s+thought|changed\s+my\s+mind)\b|\bi['’]?ll\s+(?:do|handle|take)\s+(?:it|this|that)\b|\bdo\s+it\s+yourself\b|\bif\s+(?:needed|necessary|required|possible|it\s+helps|you\s+(?:want|like|need|can|think|prefer))\b|["“”`]/i;
// reassurance, not a retraction: "no rush" does not take the work back from Ada
const REASSURANCE = /\bno\s+(?:rush|hurry|pressure|worries)\b/gi;
// ordinary lead-ins before the ask: "can you have Ada…", "hey, ask Ada to…", "please get Quill on this"
const LEAD = '^(?:(?:please|hey|hi|ok(?:ay)?|so|now|also|and|can\\s+you|could\\s+you|would\\s+you|will\\s+you|i(?:[\'’]d|\\s+would)\\s+like\\s+you\\s+to|i\\s+want\\s+you\\s+to|go\\s+ahead\\s+and)[\\s,]+)*';
// Ids that are ordinary words in a sentence, never on their own a reference to one agent ("ask an agent").
const GENERIC_IDS = new Set(['agent']);
const esc = s => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/* INTO THIS CHAT (rc walk 10-14). "get ROOK in here" names ROOK with "get", and this note used to answer it with "Hand that
   part to them with team.dispatch" — a worker in its own thread, when the Commander asked for ROOK HERE. A seat is asked with
   a seat verb, the names, and WHERE as the names' own phrase ("bring ROOK in here", "add Ada to this chat", "have Quill join
   us"): the note then names station.control group.add when the run holds it, and says nothing otherwise (a missed note
   leaves the lead to decide; a wrong one sends the agent off to a thread of its own).
   WHERE THE RESULT LANDS IS NOT A SEAT (review 10-14): "Have Ada research JWST and post the results in this chat" is a
   hand-off with a delivery address — an action verb sits between the names and the where-clause — so it keeps the dispatch
   note. A bare "the thread" is never here (a worker's own thread is "the thread"). The same QUALIFIED veto applies. */
const HERE = '(?:(?:in\\s+|over\\s+)?here|(?:in|into|to)\\s+(?:this|our)\\s+(?:chat|conversation|thread|group(?:\\s+chat)?)'
  + '|(?:in|into|to)\\s+the\\s+(?:chat|conversation|group(?:\\s+chat)?)|(?:to\\s+)?join\\s+(?:us|me|in|this\\s+(?:chat|conversation|group)|the\\s+(?:chat|conversation|group)))';
// words that may sit between the names and WHERE without making it another verb's phrase ("bring Ada in to this chat")
const SEAT_FILL = '(?:\\s+(?:in|too|also|as\\s+well|both|now|back|along))*';
const SEAT_ASK = '(?:have|get|bring|add|invite|pull|let|loop in|bring in)';

/* crewMentions(text, crew, leadId, ask?) -> [{ agentId, name }]
   crew: Map/iterable of [agentId, { name }]. A member counts when its display name or (non-generic) agentId
   appears as a whole word AND the request asks for work (a delegation verb, or "Name, …" / "Name: …" up front).
   mode 'seat': only a SEAT ask counts — SEAT_ASK + the names + WHERE as their own phrase (see HERE); no "Name, …" form. */
function crewMentions(text, crew, leadId, mode) {
  const seat = mode === 'seat';
  const t = String(text || '').trim();
  if (!t || !crew || QUALIFIED.test(t.replace(REASSURANCE, ' '))) return [];
  const members = [];
  for (const [agentId, ident] of crew) {
    if (!agentId || agentId === leadId) continue;
    const name = String((ident && ident.name) || '').trim();
    const cues = [];
    if (name.length >= 3) cues.push(name);
    if (agentId.length >= 3 && !GENERIC_IDS.has(agentId.toLowerCase()) && agentId.toLowerCase() !== name.toLowerCase()) cues.push(agentId);
    if (cues.length) members.push({agentId, name: name || agentId, cues});
  }
  if (!members.length) return [];
  const names = members.flatMap(m => m.cues).sort((a,b) => b.length-a.length).map(esc).join('|');
  const target = '(?:the\\s+)?(' + names + ')(?=$|[^A-Za-z0-9_-])';
  const separator = '\\s*(?:,|and|&)\\s*';
  const list = target + '(?:' + separator + target + ')*';
  // Match the whole target span before rejecting possession, so regex backtracking cannot
  // turn "Have Ada and Quill's report" into a directive for just Ada.
  const action = new RegExp(LEAD + (seat ? SEAT_ASK : ASK) + '\\s+(' + list + ')' + (seat ? SEAT_FILL + '\\s+' + HERE + '(?![A-Za-z0-9_-])' : ''), 'i').exec(t);
  const tail = action ? t.slice(action[0].length) : '';
  // (a seat's match already ends past WHERE, so what follows it — ", I want to talk it through" — is the rest of the ask)
  const targets = new Set(action && (seat || !/^(?:['’]|\s*(?:,|&|and\b))/i.test(tail))
    ? Array.from(action[1].matchAll(new RegExp('(?:^|' + separator + ')' + target, 'ig')), m => m[1].toLowerCase())
    : []);
  // Resolve exact captured cues: Ada is not the Ada prefix inside another member's Ada-Aux name.
  return members.filter(m => m.cues.some(c =>
    targets.has(c.toLowerCase()) || (!seat && new RegExp('^' + esc(c) + '\\s*[,:]\\s*\\S', 'i').test(t))
  )).map(({agentId, name}) => ({agentId, name}));
}

/* Only a NAMED crew call gets a note. Measured 2026-10-11 on qwen3:8b (Ollama): "Have Ada research…" went from
   0/4 delegated (trunk) to 4/4 with this note. An unnamed "delegate this to the other agents" was already ~50%
   (4/8), and neither a generic note (3/7) nor one spelling out the call (3/6) moved it, so none is sent: prompt
   text that changes nothing is not worth its tokens.
   opts (index.js, from this run's granted tools): { dispatch: team.dispatch is granted, seat: station.control is granted }.
   Absent opts = the dispatch note only, as before. A SEAT ask never gets the dispatch note (without station.control: none). */
function crewCallNote(text, crew, leadId, opts) {
  const o = opts || {};
  const seated = crewMentions(text, crew, leadId, 'seat').slice(0, 4);
  if (seated.length) {
    if (!o.seat) return '';
    const names = seated.map(m => m.name === m.agentId ? m.agentId : m.name + ' (agentId ' + m.agentId + ')').join(', ');
    return '\n\n[CREW CALL] The Commander wants ' + names + ' IN THIS CHAT with them. Seat them with station.control '
      + '{"action": "group.add", "args": {"agents": [' + seated.map(m => JSON.stringify(m.agentId)).join(', ') + ']}} '
      + '(tool_search "group add" if it is not in your list); team.dispatch never puts anyone in this chat.';
  }
  if (o.dispatch === false) return '';
  const named = crewMentions(text, crew, leadId).slice(0, 4);
  if (!named.length) return '';
  const who = named.map(m => m.name === m.agentId ? m.agentId : m.name + ' (agentId ' + m.agentId + ')').join(', ');
  const workers = named.map(m => '{agentId:"' + m.agentId + '", prompt:"<their part of the task>"}').join(', ');
  return '\n\n[CREW CALL] The Commander named ' + who + ' in this request. Hand that part to them with team.dispatch, '
    + 'workers:[' + workers + '], and build your answer from what they return. '
    + 'Do it yourself only if the dispatch is refused.';
}

module.exports = { crewMentions, crewCallNote };
