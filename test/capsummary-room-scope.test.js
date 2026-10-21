/* node test/capsummary-room-scope.test.js — the capability note names the ROOM a room-scoped agent's missing gear must
   go in (capability/cap-scope.js, 2026-10-20; tweet: "the agents aren't good").

   The real path that breaks: the lead's station.build with "new" recruits seats a RESEARCHER and a WRITER at desks in a
   new RESEARCH room. Each owns a bay, so its floor tools come ONLY from that desk room, and RESEARCH holds no DISH,
   SERVER CART or STUDIO: the Researcher cannot search the web. The note said "place a DISH" with no room (the DISH in
   HOME does not reach it), and on its line runs said "Placing objects cannot change that here", which is false for web.
   Review fixes (same day): the unattended clause offers only what the floor really grants with nobody watching (web,
   file reading; never images: image_generate needs the routine's ALLOW IMAGES grant), memory's gear is the SERVER CART
   the palette shows (no prop is called NOTEBOOK), and the fix is named only when the job needed it.
   Built here with the REAL station builder, saved-floor validation, router.stationFor, composeOffice + execution
   profile + resolveTools, and summarizeCapabilities. Pure node: no sidecar boot (index.js is source-locked only). */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs'), path = require('node:path');
const M = require('../frontend/app/worldmodel.js'), P = require('../frontend/app/pipeline.js'), W = require('../frontend/app/workflowline.js');
const SB = require('../frontend/app/stationbuilder.js'), T = require('../frontend/app/stationtemplates.js'), Sprites = require('../frontend/app/propsprites.js');
const { summarizeCapabilities } = require('../sidecar/capability/capsummary.js');
const { capScope, consistentScope, scopeForRun, makeSavedFloor } = require('../sidecar/capability/cap-scope.js');
const { savedPlacement, checkedStation } = require('../sidecar/capability/saved-placement.js');
const { composeOffice, stationWithObject } = require('../sidecar/capability/office.js');
const { resolveTools } = require('../sidecar/capability/resolve.js');
const Profiles = require('../sidecar/execution-profiles.js');
const { makeRouter } = require('../sidecar/routing/router.js');

M.setPropRules(t => { const s = Sprites.spec(t); return s ? { mount: s.mount || null, stack: !!s.stack, surface: !!s.surface, flat: !!s.flat } : null; });
const env = { WorldModel: M, Pipeline: P, WorkflowLine: W, crew: [{ id: 'agent', name: 'NOVA' }], heroId: 'agent',
  StationTemplates: T, PropSprites: Sprites, EquipmentHelp: require('../frontend/app/equipmenthelp.js'), RoomStyles: require('../frontend/app/roomstyles.js'),
  LineLayout: require('../frontend/app/linelayout.js'), LineEdit: require('../frontend/app/lineedit.js') };

// THE VERIFIED REAL PATH: the starter station, then the lead builds a research line in a new room with two recruits
const st = M.create(M.starterDoc()); st.ensureWorkstation('agent');
const made = [];
const R = Object.assign({}, env, { canRecruit: true, recruit: role => { const id = 'rq' + (made.length + 1); if (!st.ensureWorkstation(id).ok) return null; made.push(id); return { id, name: role }; } });
const pb = SB.planBuild(st.serialize(), { rooms: [{ name: 'Research', size: 'giant', lines: [{ line: 'research_line', staff: [{ step: 1, agent: 'new' }, { step: 2, agent: 'new' }] }] }] }, R);
A.ok(pb.ok && /with a desk in RESEARCH/.test(pb.plan.summary), 'fixture: the lead plans a research line whose recruits sit in RESEARCH (' + (pb.error || '') + ')');
A.ok(SB.apply(st, pb.plan, R).ok && made.join() === 'rq1,rq2', 'fixture: built, RESEARCHER = rq1');
const save = { station: st.serialize() };
const saved = checkedStation(save);
A.ok(!!saved, 'the saved floor validates');

// how runOnce builds the run's grants: office (or routed room) + the agent's execution profile objects, then resolveTools
const PROFILE = Profiles.PROFILES['trusted-project'].capabilityObjects;   // every hire since v0.9.0 (app.js summonAgent)
function withProfile(station, agentId) { for (const t of PROFILE) station = stationWithObject(station, agentId, t); return station; }
function interactiveRun(agentId, extraObjects) {
  const office = { agents: { [agentId]: { id: agentId, room: 'office' } }, rooms: { office: { id: 'office', objects: composeOffice({ surface: 'interactive', extraObjects }) } } };
  return resolveTools(agentId, withProfile(office, agentId));
}
// the autonomous strip of enforceRunAuthority for an ASK-mode agent: shell.exec / verify.run need the routine's grant
const unattended = (res) => Object.assign({}, res, { tools: res.tools.filter(n => n !== 'shell.exec' && n !== 'verify.run'),
  grants: res.grants.filter(g => g.tool !== 'shell.exec' && g.tool !== 'verify.run') });

/* 1. capScope reads the real floor */
{
  const s = capScope(saved, 'rq1');
  A.ok(s && s.scoped === true && s.roomName === 'RESEARCH' && s.via === 'desk', 'rq1 is scoped to RESEARCH, the room its desk is in: ' + JSON.stringify(s && { r: s.roomName, via: s.via }));
  A.eq(s.placedTypes, [], 'RESEARCH holds no floor gear');
  A.ok(['dish', 'notebook', 'studio', 'cabinet', 'workbench'].every(t => (s.gearElsewhere[t] || []).indexOf('HOME') >= 0), 'every essential stands in HOME: ' + JSON.stringify(s.gearElsewhere));
  A.eq(JSON.stringify(savedPlacement(save, 'rq1')), '[]', 'savedPlacement (refactored onto checkedStation) still answers [] for rq1');
  A.eq(savedPlacement(save, 'agent').map(o => o.objectType).sort(), ['cabinet', 'dish', 'notebook', 'studio', 'workbench'], 'savedPlacement still gives the bayless hero the whole station');
  A.eq(capScope(saved, 'agent').scoped, false, 'the hero owns no bay: not room-scoped');
  A.eq(capScope(null, 'rq1'), null, 'no floor: no scope');
  // a desk-less bay agent draws on its BAY's room, and the note says so
  const fx = M.create(st.serialize());
  const desk = fx.props().find(p => p.agentId === 'rq2' && /^desk/.test(p.t));
  A.ok(desk && fx.removeProp(desk.id).ok, 'fixture: the WRITER loses its desk');
  const s2 = capScope(checkedStation({ station: fx.serialize() }), 'rq2');
  A.ok(s2 && s2.scoped && s2.via === 'bay' && s2.roomName === 'RESEARCH', 'a desk-less agent is scoped to its bay\'s room: ' + JSON.stringify(s2 && { r: s2.roomName, via: s2.via }));
  A.ok(/Place the DISH in RESEARCH, the room your bay is in: your tools come only from that room \(the DISH in HOME does not reach you\)\./.test(
    summarizeCapabilities(interactiveRun('rq2', []), { surface: 'interactive', scopeFn: () => Object.assign({}, s2, { gearElsewhere: { dish: ['HOME'] } }) })), '...and the note names the bay\'s room');
}

/* 2. the guard: a room is named only when the saved floor reproduces THIS run's floor grants */
{
  A.ok(!!consistentScope(saved, 'rq1', { grantedTypes: [] }), 'same floor -> scope');
  A.eq(consistentScope(saved, 'rq1', { grantedTypes: ['dish'] }), null, 'the page saw a DISH the saved floor lacks (stale save): no room is named');
  A.eq(consistentScope(saved, 'agent', { grantedTypes: [] }), null, 'an unscoped agent: nothing to name');
  A.eq(scopeForRun({ loadStation: () => saved, agentId: 'rq1', interactive: false, extraObjects: [] }), null, 'the autonomous office is not a floor room');
  A.eq(scopeForRun({ loadStation: () => saved, agentId: 'rq1', interactive: true, floorless: true, extraObjects: [] }), null, 'a floorless channel run names no room');
  A.eq(scopeForRun({ loadStation: () => saved, agentId: 'rq1', interactive: true }), null, 'no placement sent at all: no room');
  A.eq(scopeForRun({ loadStation: () => saved, agentId: 'rq1', runStation: { agents: { rq1: { room: 'x' } }, rooms: { x: { objects: [] } } } }), null, 'an explicit station that is not a routed floor room names nothing');
}

/* 3. INTERACTIVE (COMMS): the note names the room and the gear standing elsewhere */
const extra = savedPlacement(save, 'rq1');   // what /api/run uses when the page sends no `placed`
const resolvedI = interactiveRun('rq1', extra);
const scopeI = () => scopeForRun({ loadStation: () => saved, agentId: 'rq1', extraObjects: extra, interactive: true });
const BEFORE_I = '\n<capabilities_ground_truth>\nThese are your REAL powers this run, decided by the objects placed on your station floor and host-granted station roles -- not aspirational. This block is AUTHORITATIVE: if anything earlier in your instructions implies you always have web or file access, ignore it -- what follows is what you ACTUALLY have right now:\n- You CAN: read and write files, run shell commands and verify code.\n- You do NOT have: search/fetch the web and use the controlled browser.\nIf the Commander asks for something you lack, do NOT claim, promise, or pretend to do it. Say plainly you can\'t yet, and name the object to place to grant it: search/fetch the web and use the controlled browser -> place a DISH. You can always think and reply; that needs nothing.\n</capabilities_ground_truth>';
{
  A.eq(summarizeCapabilities(resolvedI, { surface: 'interactive' }), BEFORE_I, 'no scopeFn: byte-identical to the note before this change');
  A.eq(summarizeCapabilities(resolvedI, { surface: 'interactive', scopeFn: () => null }), BEFORE_I, 'a null scope: byte-identical');
  A.eq(summarizeCapabilities(resolvedI, { surface: 'interactive', scopeFn: () => { throw new Error('boom'); } }), BEFORE_I, 'a throwing scope fails open: byte-identical');
  const note = summarizeCapabilities(resolvedI, { surface: 'interactive', scopeFn: scopeI });
  A.ok(/search\/fetch the web and use the controlled browser -> place a DISH/.test(note), 'still names the DISH for web');
  A.ok(note.indexOf('Place the DISH, SERVER CART and STUDIO in RESEARCH, the room your desk is in: your tools come only from that room (the ones in HOME do not reach you).') >= 0,
    'names RESEARCH, the room the desk is in, and the gear in HOME that does not reach it: ' + note.slice(note.indexOf('Place the'), note.indexOf('Place the') + 220));
  A.ok(/You do NOT have: search\/fetch the web and use the controlled browser, keep long-term memory, generate and analyze images\./.test(note),
    'memory and images are named missing too, since that gear stands in HOME where it cannot reach');
  A.ok(/search\/fetch the web and use the controlled browser -> place a DISH; keep long-term memory -> place a SERVER CART; generate and analyze images -> place a STUDIO\./.test(note), 'each with its object');
  // REVIEW FIX 2: every object the note names is a real palette prop granting THAT power, and one of each stands in HOME
  // (the gear "the ones in HOME" points at). "a NOTEBOOK" named a prop that does not exist; manual.js says SERVER CART.
  const typeOf = { 'web': 'dish', 'keep long-term memory': 'notebook', 'generate and analyze images': 'studio' };
  const named = [];
  note.replace(/(search\/fetch the web|keep long-term memory|generate and analyze images)[^;.]*-> place an? ([A-Z][A-Z ]*[A-Z])/g, (m, power, label) => { named.push({ power: power === 'search/fetch the web' ? 'web' : power, label }); return m; });
  A.eq(named.map(n => n.label), ['DISH', 'SERVER CART', 'STUDIO'], 'the note names three objects');
  const homeId = saved.rooms().find(r => r.name === 'HOME').id;
  const homeLabels = saved.props().filter(p => saved.roomAt(p.x, p.y) === homeId).map(p => (Sprites.spec(p.t) || {}).label);
  for (const n of named) {
    A.ok(Sprites.CATALOG.some(e => e.label === n.label && M.capForProp(e.id) === typeOf[n.power]), n.label + ' is a palette prop that grants ' + n.power);
    A.ok(homeLabels.indexOf(n.label) >= 0, 'a ' + n.label + ' really stands in HOME');
  }
  A.ok(note.indexOf('NOTEBOOK') < 0 && /SERVER CART[^\n]*MEMORY/.test(require('../sidecar/manual.js').starnetManual()), 'no NOTEBOOK: the note and the manual name memory\'s gear alike');
  A.ok(note.indexOf('read and write files') < note.indexOf('You do NOT have') && !/place an INTEL CAB|place a WORKBENCH/.test(note), 'files + terminal come from the execution profile: never nagged');
  console.log('[room-scope] interactive note: ' + BEFORE_I.length + ' -> ' + note.length + ' chars (+' + (note.length - BEFORE_I.length) + ')');

  // the LEAD variant keeps its own opener
  const lead = summarizeCapabilities(Object.assign({}, resolvedI, { grants: resolvedI.grants.concat([{ capId: 'orchestrator', tool: 'team.dispatch' }]), tools: resolvedI.tools.concat(['team.dispatch']) }), { surface: 'interactive', scopeFn: scopeI });
  A.ok(/offer to place it yourself \(station builder add[^)]*\): .*-> place a DISH.*Place the DISH, SERVER CART and STUDIO in RESEARCH/.test(lead), 'the lead offers to place them itself, in RESEARCH');

  // a hero with the whole station: nothing missing, so the (11 ms) scope is never even asked for
  let asked = 0;
  const hero = interactiveRun('agent', savedPlacement(save, 'agent'));
  const heroNote = summarizeCapabilities(hero, { surface: 'interactive', scopeFn: () => { asked++; return scopeI(); } });
  A.eq(asked, 0, 'fully equipped: the scope is never computed (lazy)');
  A.eq(heroNote, summarizeCapabilities(hero, { surface: 'interactive' }), 'fully equipped: byte-identical');
}

/* 4. THE FIX WORKS: a DISH placed in RESEARCH grants web on the next run, and the note stops asking for it */
{
  const fx = M.create(st.serialize());
  const room = fx.rooms().find(r => r.name === 'RESEARCH'), Rr = room.rects[0];
  let placed = null;
  for (let y = Rr.y1 + 1; y < Rr.y2 && !placed; y++) for (let x = Rr.x1 + 1; x < Rr.x2 && !placed; x++) {
    const r = fx.addProp({ t: 'comms_dish', x, y, w: 1, h: 1 }); if (r && r.ok) placed = r;
  }
  A.ok(!!placed, 'fixture: a DISH placed in RESEARCH');
  const save2 = { station: fx.serialize() }, saved2 = checkedStation(save2), extra2 = savedPlacement(save2, 'rq1');
  A.eq(extra2.map(o => o.objectType), ['dish'], 'rq1 now draws a DISH from its room');
  const res2 = interactiveRun('rq1', extra2);
  A.ok(res2.tools.indexOf('web_search') >= 0, 'web_search is granted');
  const note2 = summarizeCapabilities(res2, { surface: 'interactive', scopeFn: () => scopeForRun({ loadStation: () => saved2, agentId: 'rq1', extraObjects: extra2, interactive: true }) });
  A.ok(/You CAN: search\/fetch the web/.test(note2) && !/-> place a DISH/.test(note2), 'web is a power now, never asked for');
  A.ok(/Place the SERVER CART and STUDIO in RESEARCH, the room your desk is in: your tools come only from that room \(the ones in HOME do not reach you\)\./.test(note2), 'still names the memory and image gear: ' + note2.slice(note2.indexOf('Place the'), note2.indexOf('Place the') + 160));

  // a page that saw the DISH while the save has not caught up yet (debounce): no room is named at all
  const stale = summarizeCapabilities(res2, { surface: 'interactive', scopeFn: () => scopeForRun({ loadStation: () => saved, agentId: 'rq1', extraObjects: extra2, interactive: true }) });
  A.ok(stale.indexOf('RESEARCH') < 0, 'a floor that is not this run\'s names no room');
}

/* 5. UNATTENDED LINE RUN: router.stationFor's routed room, the floor marker, and the false "cannot change that" fixed */
{
  const router = makeRouter();
  const set = router.setStation(st.serialize());
  A.ok(set.ok, 'fixture: the router takes the built station (' + (set.error || '') + ')');
  const rs = router.stationFor('rq1');
  const bay = st.props().find(p => p.t === 'bay' && p.agentId === 'rq1');
  A.ok(rs && rs.floor && rs.floor.dockId === bay.id, 'stationFor marks its routed room with the dock it resolved: ' + JSON.stringify(rs && rs.floor));
  const bare = Object.assign({}, rs); delete bare.floor;
  A.eq(JSON.stringify(resolveTools('rq1', rs)), JSON.stringify(resolveTools('rq1', bare)), 'resolveTools ignores the marker: grants unchanged');
  const resolvedU = unattended(resolveTools('rq1', withProfile(rs, 'rq1')));
  A.ok(resolvedU.tools.indexOf('web_search') < 0 && resolvedU.tools.indexOf('fs.read') >= 0, 'fixture: the line run has files, no web');
  const before = summarizeCapabilities(resolvedU, { surface: 'autonomous' });
  A.ok(/search\/fetch the web and use the controlled browser, run shell commands and verify code, use live MCP connector tools and desktop control are unavailable on this run -- each needs either a watched session or an explicit per-routine grant the Commander sets on the routine itself\. Placing objects cannot change that here\./.test(before),
    'baseline (no scope): web is lumped under "placing objects cannot change that" — the false claim');
  const scopeU = () => scopeForRun({ loadStation: () => saved, agentId: 'rq1', runStation: rs, interactive: false });
  A.eq((scopeU() || {}).floorRouted, true, 'the routed run\'s scope is floor-routed');
  const note = summarizeCapabilities(resolvedU, { surface: 'autonomous', scopeFn: scopeU });
  A.ok(/so run shell commands and verify code, use live MCP connector tools and desktop control are unavailable on this run -- each needs either a watched session or an explicit per-routine grant the Commander sets on the routine itself\. Placing objects cannot change that here\. /.test(note),
    'the terminal and connectors keep the authority sentence (placing cannot grant them unattended)');
  A.ok(note.indexOf('Placing objects cannot change that here') > note.indexOf('run shell commands') && !/search\/fetch the web[^.]*Placing objects cannot change that here/.test(note),
    'web is no longer under "placing objects cannot change that"');
  A.ok(note.indexOf('No web on this run: RESEARCH, the room your desk is in, has no DISH; the Commander can place one there for your next job (the DISH in HOME does not reach you). If the job needed it, name that fix in your closing clause. ') >= 0,
    'names the room, the missing gear and where it stands instead: ' + note.slice(note.indexOf('No web'), note.indexOf('No web') + 300));
  // REVIEW FIX 1: a placed STUDIO does not give a line hop images (image_generate needs the routine's ALLOW IMAGES grant;
  // a line hop runs with unattendedGrants []), so the unattended note never offers images (or memory) as a floor fix
  A.ok(!/STUDIO|images|SERVER CART|NOTEBOOK|memory/.test(note), 'the unattended note offers no image or memory gear: ' + note.slice(note.indexOf('No web'), note.indexOf('No web') + 200));
  const lackOf = (s) => (s.match(/- You do NOT have: [^\n]*/) || [''])[0];
  A.eq(lackOf(note), lackOf(before), 'the lack list is the one the run had before the room scope (memory and images never join it unattended)');
  A.ok(/Say it in the Commander's terms, in one short closing clause/.test(note), 'the closing-clause rule still carries it to the delivered reply');
  console.log('[room-scope] unattended note: ' + before.length + ' -> ' + note.length + ' chars (+' + (note.length - before.length) + ')');

  // REVIEW FIX 3: the fix is named only when the job needed it, never as an order on every hop; a toolless turn
  // (a conversational channel reply) has no job that needed it, so it carries no order at all
  A.ok(!/Name that fix/.test(note), 'no unconditional order');
  const chat = summarizeCapabilities(resolvedU, { surface: 'autonomous', toolless: true, scopeFn: scopeU });
  A.ok(chat.indexOf('has no DISH; the Commander can place one there for your next job (the DISH in HOME does not reach you). Do NOT claim') >= 0 && !/name that fix/i.test(chat),
    'a toolless turn keeps the fact and drops the order: ' + chat.slice(chat.indexOf('No web'), chat.indexOf('No web') + 200));

  // the INTEL CAB half: a legacy agent (no execution profile) also lacks files; unattended, placing one grants READING
  // only (fs.write/edit stay default-denied without an AWAY WORKSHOP grant), so that is all the note offers
  const legacy = summarizeCapabilities(unattended(resolveTools('rq1', rs)), { surface: 'autonomous', scopeFn: scopeU });
  A.ok(legacy.indexOf('No web or file reading on this run: RESEARCH, the room your desk is in, has no DISH or INTEL CAB; the Commander can place them there for your next job (the ones in HOME do not reach you). If the job needed them, name that fix in your closing clause. ') >= 0,
    'a legacy agent is offered web and file reading: ' + legacy.slice(legacy.indexOf('No web'), legacy.indexOf('No web') + 260));

  // the fully furnished room: only the terminal (authority) is missing -> the old sentence, byte-identical
  const fx = M.create(st.serialize()), room = fx.rooms().find(r => r.name === 'RESEARCH'), Rr = room.rects[0];
  const want = ['comms_dish', 'gigs_servercart', 'studio'];
  for (let y = Rr.y1 + 1; y < Rr.y2 && want.length; y++) for (let x = Rr.x1 + 1; x < Rr.x2 && want.length; x++) {
    const r = fx.addProp({ t: want[0], x, y, w: 1, h: 1 }); if (r && r.ok) want.shift();
  }
  A.eq(want.length, 0, 'fixture: DISH + SERVER CART + STUDIO placed in RESEARCH');
  const r2 = makeRouter(); A.ok(r2.setStation(fx.serialize()).ok, 'fixture: the router takes the furnished station');
  const rs2 = r2.stationFor('rq1'), saved2 = checkedStation({ station: fx.serialize() });
  const res2 = unattended(resolveTools('rq1', withProfile(rs2, 'rq1')));
  const note2 = summarizeCapabilities(res2, { surface: 'autonomous', scopeFn: () => scopeForRun({ loadStation: () => saved2, agentId: 'rq1', runStation: rs2 }) });
  A.eq(note2, summarizeCapabilities(res2, { surface: 'autonomous' }), 'only the terminal is missing: the unattended note is byte-identical (no room clause)');

  // a DISH alone in RESEARCH: memory and images are still absent, but unattended they are no floor fix, so the (11 ms)
  // scope is never even asked for and the note is byte-identical
  const fd = M.create(st.serialize()), Rd = fd.rooms().find(r => r.name === 'RESEARCH').rects[0];
  let dish = null;
  for (let y = Rd.y1 + 1; y < Rd.y2 && !dish; y++) for (let x = Rd.x1 + 1; x < Rd.x2 && !dish; x++) { const r = fd.addProp({ t: 'comms_dish', x, y, w: 2, h: 2 }); if (r && r.ok) dish = r; }
  const r3 = makeRouter(); A.ok(!!dish && r3.setStation(fd.serialize()).ok, 'fixture: a DISH alone in RESEARCH');
  const res3 = unattended(resolveTools('rq1', withProfile(r3.stationFor('rq1'), 'rq1')));
  A.ok(res3.tools.indexOf('web_search') >= 0 && res3.tools.indexOf('image_generate') < 0, 'fixture: web granted, no studio');
  let asked3 = 0;
  const note3 = summarizeCapabilities(res3, { surface: 'autonomous', scopeFn: () => { asked3++; return null; } });
  A.eq(asked3, 0, 'only memory/images missing on an unattended run: the scope is never computed');
  A.eq(note3, summarizeCapabilities(res3, { surface: 'autonomous' }), '...and the note is byte-identical');

  // a DELEGATED worker keeps its own branch and never asks for the scope
  let asked = 0;
  const del = summarizeCapabilities(resolvedU, { surface: 'autonomous', delegatedBy: 'agent', scopeFn: () => { asked++; return scopeU(); } });
  A.eq(asked, 0, 'a delegated worker run never computes the scope');
  A.eq(del, summarizeCapabilities(resolvedU, { surface: 'autonomous', delegatedBy: 'agent' }), 'delegated: byte-identical');
  A.eq((() => { let n = 0; summarizeCapabilities(resolvedU, { surface: 'autonomous', unrestrictedHost: true, scopeFn: () => { n++; return null; } }); return n; })(), 0, 'FULL POWER never computes the scope');
}

/* 6. makeSavedFloor: one validation per save stamp; an unclean read is never memoized */
{
  let stamp = 's1', loads = 0;
  const floor = makeSavedFloor({ stamp: () => stamp, loadStamped: () => { loads++; return { doc: save, stamp }; } });
  const a = floor(), b = floor();
  A.ok(!!a && a === b && loads === 1, 'the same stamp reuses the validated floor (' + loads + ' load)');
  stamp = 's2'; floor();
  A.eq(loads, 2, 'a new stamp re-reads');
  let n = 0;
  const unclean = makeSavedFloor({ stamp: () => '', loadStamped: () => { n++; return { doc: save, stamp: '' }; } });
  unclean(); unclean();
  A.eq(n, 2, 'an empty stamp never memoizes');
  A.eq(makeSavedFloor({ stamp: () => 'x', loadStamped: () => ({ doc: undefined, stamp: 'x' }) })(), null, 'no save: null');
}

/* 7. THE HOST WIRING (index.js is never required: it boots a real sidecar). runOnceCore passes the lazy scope at the ONE
      capability-note seam, built from this run's own routed station / placed objects and the stamped saved floor. */
{
  const idx = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');
  A.ok(/const savedFloor = makeSavedFloor\(\{ stamp: \(\) => saveStore\.stamp\('agent'\), loadStamped: \(\) => saveStore\.loadStamped\('agent'\) \}\);/.test(idx), 'the saved floor is memoized by the save stamp');
  A.ok(/toolless: !isTask,\s*\n[^\n]*\n\s*scopeFn: \(\) => \{ try \{ return scopeForRun\(\{ loadStation: savedFloor, agentId, runStation: o\.station, extraObjects: o\.extraObjects, interactive: surface === 'interactive', floorless: !!o\.floorless \}\); \} catch \(e\) \{ failNote\('capsummary\.roomscope', e\); return null; \} \} \}\) \+ skillBlock;/.test(idx),
    'summarizeCapabilities gets scopeFn from this run\'s station, placed objects and surface, failing open to null');
  const at = idx.indexOf('let station = o.station ||');
  A.ok(at > 0 && idx.indexOf('composeOffice({ surface: officeSurface, lead: o.lead || ownerTrusted, connectorIds: connectors.ids(), extraObjects: o.extraObjects })') > 0,
    'the office the scope compares against is composed from the same o.extraObjects');
}

A.report('capsummary-room-scope.test');
