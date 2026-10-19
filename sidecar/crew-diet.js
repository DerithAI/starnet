/* sidecar/crew-diet.js — ZERO-CREW DIET (lean-prompt, 2026-10-12): which lead holds part of its crew kit DEFERRED.

   A lead whose live roster holds no crew used to pay for the whole crew kit on every task request (team_* schemas +
   a ~5 KB [ORCHESTRATION] briefing about a team that does not exist). Deferred = still GRANTED, dispatchable and
   findable through tool_search, just not advertised — exactly like the station builder.

   Only what needs a crew or a running background worker is deferred: team.dispatch (there is nobody to address;
   team.summon's result reveals it) and the background-worker controls (a background team.spawn / team.dispatch
   result reveals them). NOT deferred: team.summon (recruiting needs no crew), team.spawn (same-identity clones need
   no crew) and team.config / team.configure (the lead edits its OWN Dossier) — review 2026-10-12: deferring those
   hid working capabilities behind a search.

   The diet applies only where a deferred name can be found again: tool.search must be granted, or the deferred kit
   would be a hidden tool. Pure: no I/O, no clock. */
'use strict';

const CREW_KIT_DEFERRED = Object.freeze(['team.dispatch', 'team.subagents', 'team.steer', 'team.interrupt', 'team.resume']);

// isTask: a task run (tools on the wire). deferralOff: SKYNET_TOOL_SEARCH=0. leanCrew: the STARNET_LEAN_CREW value
// ('0' = kill switch). tools: this run's GRANTED tool names. crewCount: roster agents other than the one running.
function isCrewlessLead({ isTask, deferralOff, leanCrew, tools, crewCount } = {}) {
  const granted = Array.isArray(tools) ? tools : [];
  return !!isTask && !deferralOff && String(leanCrew == null ? '' : leanCrew).trim() !== '0'
    && granted.indexOf('team.dispatch') >= 0 && granted.indexOf('tool.search') >= 0 && crewCount === 0;
}

module.exports = { CREW_KIT_DEFERRED, isCrewlessLead };
