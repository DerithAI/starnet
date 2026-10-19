/* node test/index-strict-mode.test.js — sidecar/index.js really runs in strict mode.

   A merge (f3c77c454, 2026-07-29) left a stray object-literal line in FRONT of the header comment:
   `botUsername: () => ...,/* sidecar/index.js ...`. That parses as a labelled comma expression, so the
   `'use strict'` below the comment stopped being a directive and the whole 28k-line host ran in sloppy mode
   for months. In sloppy mode an undeclared assignment silently creates a global: `finalCompletionEvidence`
   (assigned in runOnceCore, never declared) became ONE process-wide slot shared by every concurrent run, so an
   overlapping run could stamp another run's completion verdict on its agent.run.end + durable runStore row.

   Laws under test (compile only — index.js is not loadable, requiring it boots a real sidecar):
     • the 'use strict' directive is live: the module body, compiled the way Node's CJS wrapper does, rejects
       strict-only syntax;
     • finalCompletionEvidence is a per-run local of runOnceCore, and the settle path never reads it unset. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const A = require('./_assert.js');

const src = fs.readFileSync(path.join(__dirname, '..', 'sidecar', 'index.js'), 'utf8');

function compiles(body) {
  try { new vm.Script('(function (exports, require, module, __filename, __dirname) {' + body + '\n})', { filename: 'index.js' }); return null; }
  catch (e) { return e; }
}

// The module compiles as-is (the CJS wrapper allows its top-level returns).
A.eq(compiles(src), null, 'sidecar/index.js compiles inside the CJS wrapper');

// `var eval` is legal sloppy JS and a SyntaxError only under a live 'use strict' directive.
const probe = compiles(src + '\n;var eval;');
A.ok(probe instanceof SyntaxError && /strict mode/i.test(probe.message), 'the use-strict directive is live (strict-only syntax is rejected): ' + (probe && probe.message));

// Nothing but comments/whitespace may precede the directive.
const lead = src.replace(/^(?:\s+|\/\*[\s\S]*?\*\/|\/\/[^\n]*\n)*/, '');
A.ok(lead.startsWith("'use strict';"), "the first statement of sidecar/index.js is 'use strict';");

// finalCompletionEvidence: declared per run inside runOnceCore, and defaulted before the settle path reads it.
const core = A.fnBody(src, 'async function runOnceCore(o)');
A.ok(core.length > 1000, 'found runOnceCore');
A.ok(/\blet finalCompletionEvidence = null;/.test(core), 'finalCompletionEvidence is a per-run local of runOnceCore');
A.ok(/\bif \(!finalCompletionEvidence\) finalCompletionEvidence = execution\.completionEvidence\(\);/.test(core), 'the settle path defaults it to THIS run\'s own evidence when the run threw before the postconditions pass');

A.report('index-strict-mode.test');
