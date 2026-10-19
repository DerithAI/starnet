/* test/crate-honesty.test.js — the floor must show something TRUE for a run that really happened.

   world.js is a browser IIFE over live canvas/bus globals (not node-loadable), so this asserts the law
   against the SOURCE, the same idiom kitout.test.js and refit-card-stack.test.js use.

   THE LAW (2026-08-07 conveyor audit). A finished, productive run draws exactly ONE crate:
     • if this dock hands off to another dock on its own line, the handoff crate the sidecar places IS
       its product — the dock must not ALSO ship its own, or the same work is drawn leaving twice;
     • but the handoff is decided by the sidecar, LATER, against a plan that may have been re-posted in
       between (a floor edit re-keys the line and the chain gate then refuses to advance). Nothing is
       placed, and the old code had already suppressed the dock's crate — so a run the Commander paid
       for left NO mark on the floor at all.
   Never both, and NEVER NEITHER. The suppression is therefore a WAIT that the real handoff cancels and
   that ships the dock's own crate if the handoff never comes.

   Two supporting facts this also pins, because getting either wrong silently re-breaks the law:
     • the crate's MASS is captured when the run ends, not when the timer fires — run.end drops
       runUsdRecon immediately, so a deferred read would weigh every deferred crate 0 (crate-mass
       honesty);
     • the run-id dedup happens BEFORE the wait is armed — agent.run.end is observed twice (local
       harness + SSE echo) and two waits would ship two crates. */
'use strict';
const A = require('./_assert.js');
const fs = require('fs');
const path = require('path');

const world = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'world.js'), 'utf8');
const strip = s => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/\/\/.*/g, ' ');

const ship = world.slice(world.indexOf('function shipProductCrate(p)'), world.indexOf('function enqueueSlag'));
A.ok(ship.length > 200 && ship.length < 4000, 'shipProductCrate was located');
const shipCode = strip(ship);

/* ---- the suppression is a WAIT, not a drop ---- */
A.ok(/deferredShip\.set\(/.test(shipCode), 'a suppressed crate is HELD, not dropped');
A.ok(/setTimeout\(/.test(shipCode), '…on a timer');
A.ok(/emitProductCrate\(cAid, spec(, runDock)?\)/.test(shipCode), '…that ships the dock’s own crate when it expires');
// the branch must not simply `return` without arming something
const branch = shipCode.slice(shipCode.indexOf('dockLineTake(cAid)'), shipCode.indexOf('dockLineTake(cAid)') + 500);
A.ok(/deferredShip\.set/.test(branch), 'the line-work branch arms the wait before it returns');
/* ---- OVERLAP SAFETY (2026-08-11 audit #5): one dock, several runs in flight ---- */
// arming a NEW wait must never cancel a sibling run's held crate — the old single-timer slot did
A.ok(!/cancelDeferredShip\(cAid\)/.test(shipCode), 'arming a wait never cancels a sibling wait (K waits in, K crates out)');
A.ok(/deferredShip\.get\(cAid\) \|\| \[\]/.test(shipCode), 'waits queue per dock instead of overwriting one slot');
// the line-identity latch is consumed per run (FIFO), not read-and-kept — a stale latch must not
// re-answer for a later, unrelated run
A.ok(/function dockLineTake\(/.test(world), 'line identity is TAKEN per ended run, oldest first');
A.ok(/q\.shift\(\)/.test(strip(world.slice(world.indexOf('function dockLineTake('), world.indexOf('function dockLineTake(') + 300))),
  '…consuming the oldest placement');
// proven work is tallied PER RUN (runId), so overlapping runs at one dock cannot wipe each other
A.ok(/const runWork = new Map\(\);\s*\/\/ runId/.test(world) || /runId \(or agentId when the event has none\)/.test(world),
  'runWork is keyed per run, not per agent');
A.ok(/runWorked\(p\)\) shipProductCrate\(p\)/.test(strip(world)), 'the ship gate reads the ENDING run’s own tally');
// and the un-suppressed path still ships immediately
A.ok(shipCode.trim().endsWith('emitProductCrate(cAid, spec);\n  }') || /emitProductCrate\(cAid, spec(, runDock)?\);\s*\}\s*$/.test(shipCode),
  'a dock with no downstream handoff ships its crate immediately');

/* ---- the real handoff CANCELS the wait (never both crates) ---- */
A.ok(/function cancelDeferredShip\(/.test(world), 'there is a cancel path');
A.ok(/if \(p\.kind === 'chain' && p\.from\) cancelDeferredShip\(String\(p\.from\)\);/.test(world),
  'a chain work-item cancels the wait held by the dock that PRODUCED it');
/* The cancel must run before EVERY early return in intakeMessage. Cancelling is bookkeeping about a run
   that already happened; it must not depend on this floor currently having a conveyor to draw on, or on a
   compiled plan being present. It shipped behind `if (!convey) return;` — this is what caught that. */
const intake = strip(world.slice(world.indexOf('function intakeMessage(payload)'),
                                world.indexOf('function intakeMessage(payload)') + 4000));
const iCancel = intake.indexOf('cancelDeferredShip');
A.ok(iCancel > 0, 'intakeMessage cancels the wait');
A.ok(iCancel < intake.indexOf('if (!convey) return;'), '…before the no-conveyor early return');
A.ok(iCancel < intake.indexOf("p.kind === 'chain' && routingPlan"), '…and before the branch that needs a compiled plan');

/* ---- mass is read at run.end, not when the timer fires ---- */
A.ok(/function productCrateSpec\(p\)[\s\S]{0,400}?runUsdRecon\.get\(/.test(world),
  'the crate spec reads the reconciled cost');
A.ok(shipCode.indexOf('productCrateSpec(p)') < shipCode.indexOf('deferredShip.set'),
  'the spec (and its mass) is captured BEFORE the wait is armed — run.end drops runUsdRecon right after');
A.ok(!/setTimeout\([^)]*productCrateSpec/.test(shipCode), 'and the timer never re-reads it');

/* ---- dedup precedes the wait, so an SSE echo cannot arm two ---- */
A.ok(shipCode.indexOf('shippedRunIds.add(rid)') < shipCode.indexOf('deferredShip.set'),
  'the run-id dedup runs before the wait is armed (run.end is observed twice)');

/* ---- a wait never survives the floor it belongs to ---- */
A.ok(/function clearDeferredShips\(/.test(world), 'pending waits can be cleared wholesale');
const load = world.slice(world.indexOf('function loadStation(st)'), world.indexOf('function loadStation(st)') + 900);
A.ok(/clearDeferredShips\(\);/.test(load), 'loading a different station clears them — a crate must not land on the wrong floor');
A.ok(/dockLineWork\.clear\(\);/.test(load), '…and the per-dock line-work memory is cleared with it');

/* ---- the crate card's LINE row names the LINE, never a BAY (review worldmodel-04) ----
   A crate's lineId is the line's KEY: its OLDEST member prop, which on a hand-built line is often a BAY. Looking that id up
   as a prop and reading its label printed the BAY's own name as the line's ("LINE WRITER"), or "LINE null" when the BAY had
   no label (lineLetter only letters an INBOX). The name comes from the compiled line record, as the SENDS TO plate and the
   Workflow panel read it: its INBOX's label, else that INBOX's letter. Run for real in a sandbox, not matched as prose. */
{
  const vm = require('vm');
  const P = require('../frontend/app/pipeline.js');
  const fn = A.fnBody(world, 'function lwLineName(lineId)');
  A.ok(fn.length > 40 && fn.length < 2000, 'lwLineName was located');
  const props = [{ id: 'p12', t: 'bay', label: 'writer' }, { id: 'p15', t: 'intake' }, { id: 'p16', t: 'bay' },
    { id: 'p20', t: 'bay' }, { id: 'p22', t: 'intake', label: 'Research' }, { id: 'p30', t: 'bay' }];
  const letters = { p15: 'O', p22: 'V' };
  const sb = {
    Pipeline: P,
    geo: { props },
    station: { lineLetter: id => { const q = props.find(x => x.id === id); return q && q.t === 'intake' ? letters[id] : null; } },
    routingPlan: {
      lines: [{ lineId: 'p12', intakes: ['p15'], propIds: ['p12', 'p15', 'p16'] }, { lineId: 'p20', intakes: ['p22'], propIds: ['p20', 'p22'], name: 'Research' },
        { lineId: 'p30', intakes: [], propIds: ['p30'] }],
      lineOfProp: { p12: 'p12', p15: 'p12', p16: 'p12', p20: 'p20', p22: 'p20', p30: 'p30' },
    },
  };
  vm.createContext(sb);
  vm.runInContext(fn + '\nthis.name = lwLineName;', sb);
  A.eq(sb.name('p12'), 'LINE O', 'a line keyed by its BAY is named by its INBOX (letter) — never the BAY\'s label');
  props[0].label = '';
  A.eq(sb.name('p12'), 'LINE O', '…and an unlabelled key BAY never prints "LINE null"');
  A.eq(sb.name('p20'), 'LINE RESEARCH', 'a named line reads its INBOX\'s name');
  A.eq(sb.name('p16'), 'LINE O', 'a lineId re-keyed by an edit resolves through that prop\'s current line');
  A.eq(sb.name('p30'), 'UNNAMED LINE', 'a line with no INBOX says it has no name');
  A.eq(sb.name('p99'), 'a line since edited', 'a key the floor no longer has says so — no borrowed label, no null');
}

/* ---- a SEND TO hand-off crate belongs to ITS floor and ITS frame (review world-render-06) ----
   The crate is held (up to the hand-off grace) and then flown on an arc from the sending OUTBOX to the next line's INBOX, both
   held as prop objects of the geometry it was placed on. Loading another save kept it, so it flew at stale coordinates and then
   enqueued on the NEW floor's belts — a phantom work crate on the wrong line — and the OUTBOX-sink memory keyed by (recycled)
   low prop ids could release a fresh one early. An edit that moved the station's origin left the arc in the old frame. */
{
  const vm = require('vm');
  const blk = world.slice(world.indexOf('  const SEND_FLY_MS'), world.indexOf('  // hover: an INBOX (or its plate)'));
  A.ok(blk.length > 500 && blk.length < 9000, 'the SEND TO crate block was located');
  const enq = [], geoAt = (dx, dy, keep) => ({ props: [{ id: 'p5', t: 'outbox', x: 10 + dx, y: 10 + dy }, { id: 'p9', t: 'intake', x: 30 + dx, y: 10 + dy }].filter(keep || (() => true)) });
  const sb = { T: 12, fnow: 1000, HANDOFF_GRACE_MS: 8000, geo: geoAt(0, 0), routingPlan: { lines: [] },
    Pipeline: { sourceFor: () => ({ x: 3, y: 4 }) }, convey: { enqueueAt: (x, y, p) => enq.push([x, y, p.workitemId]) }, dockArrival: () => {} };
  vm.createContext(sb);
  vm.runInContext(blk + '\nthis.S = { place: placeSendCrate, crates: sendCrates, sunk: outboxSunk, arc: sendArcPts, sink: noteOutboxSink,' +
    ' reframe: typeof reframeSendCrates === "function" ? reframeSendCrates : () => {}, clear: typeof clearSendCrates === "function" ? clearSendCrates : () => {} };', sb);
  const S = sb.S;
  A.ok(S.place({ fromOutbox: 'p5', toIntake: 'p9', agentId: 'ag1', workitemId: 'w1' }), 'a hand-off crate is placed on this floor');
  sb.geo = geoAt(2, 1); S.reframe();
  A.eq(S.arc(S.crates[0]).ax, 12.5 * 12, 'a room added at the north/west edge re-frames the held crate\'s arc with the floor');
  sb.geo = geoAt(2, 1, q => q.id !== 'p5'); S.reframe();
  A.eq(S.crates.length, 0, 'a crate whose OUTBOX was removed no longer flies from where it stood...');
  A.eq(JSON.stringify(enq), JSON.stringify([[3, 4, 'w1']]), '...its real work still lands on its agent\'s line, like any work the floor cannot arc in');
  sb.geo = geoAt(0, 0); S.place({ fromOutbox: 'p5', toIntake: 'p9', agentId: 'ag1', workitemId: 'w2' }); S.sink(10, 10);
  A.ok(S.crates.length === 1 && S.sunk.size === 1, '(a held crate and an OUTBOX sink on the old floor)');
  S.clear();
  A.ok(S.crates.length === 0 && S.sunk.size === 0, 'clearing drops every hand-off and the sink memory');
  A.ok(/clearSendCrates\(\);/.test(load), 'loading a different station clears the SEND TO crates — a hand-off never lands on the wrong floor');
  A.ok(/reframeSendCrates\(\);/.test(A.fnBody(world, 'function rederive()')), 'every re-derive re-reads the held crates against the new floor');
}

A.report('crate-honesty');
