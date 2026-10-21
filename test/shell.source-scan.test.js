/* node test/shell.source-scan.test.js — the shell safety floor keeps trunk's whole-file lexing of every referenced
   script and also lexes code launch lines alone and shell files in their OWN dialect (2026-10-20, 10-21).

   commandSourceEntries queued the text of every script a command names, then ran commandHeads() over EVERY queued
   source as if it were a command line in the OUTER dialect, a referenced .js/.mjs/.py file included:
   `node sidecar/tools/builtin/browser.js` lexed 5,731 fake heads out of JavaScript (~30 ms of synchronous work per
   check). Narrowing that lexing (code files by line only, shell files in their own dialect only) let through
   commands trunk refused, so every source is still lexed whole in the outer dialect as trunk did, and the floor
   only ADDS heads on top: each launch line of a code file lexed alone (an apostrophe in an earlier comment no
   longer hides it), and a .ps1/.sh/.cmd file also lexed as PowerShell/POSIX/cmd. These fixtures pin both the
   added refusals and trunk's refusals the narrowed scan lost. Temp fixtures only. */
'use strict';
const A = require('./_assert.js');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inputIsolationRisk, commandSafetyRisk } = require('../sidecar/tools/builtin/shell.js');

function put(root, rel, text) {
  const p = path.join(root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, text);
}
// the real fs, recording every file the floor reads
function countingFs() {
  const reads = [];
  return { fs: Object.assign({}, fs, { readFileSync: (p, ...rest) => { reads.push(path.basename(String(p))); return fs.readFileSync(p, ...rest); } }), reads };
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-source-scan-'));
try {
  put(root, 'second.mjs', "import puppeteer from 'puppeteer-core';\nawait puppeteer.launch({ headless: false });\n");
  // a command list in a template literal, between two comments that each hold an apostrophe
  put(root, 'runner.mjs', "// it's the runner\nconst steps = `\nnode second.mjs --headed\n`;\nrequire('child_process').execSync(steps);\n// that's all\n");
  put(root, 'quiet.mjs', "// it's quiet\nconsole.log('no launches here');\n// that's all\n");
  // PowerShell: a backtick-escaped quote, then a second statement after ';'
  put(root, 'chain.ps1', 'Write-Host `"starting ; node second.mjs\n');
  put(root, 'chain.cmd', '@node second.mjs\n');
  put(root, 'gui.mjs', "require('child_process').exec('notepad.exe');\n");

  // ---- 1. a code file's verdict no longer depends on how a SHELL would quote its JavaScript ----
  {
    const verdicts = ['cmd', 'posix', 'powershell'].map((dialect) => inputIsolationRisk('node runner.mjs', { cwd: root, fs, pathMod: path, dialect }));
    A.ok(verdicts.every((v) => v && /browser automation/.test(v)), 'the command list in runner.mjs is followed under EVERY dialect (trunk: posix quoting of the apostrophes hid it): ' + JSON.stringify(verdicts));
    const c = countingFs();
    A.eq(inputIsolationRisk('node quiet.mjs', { cwd: root, fs: c.fs, pathMod: path, dialect: 'posix' }), null, 'a code file with no launch lines is allowed');
    A.eq(c.reads, ['quiet.mjs'], 'and nothing past it is read');
  }

  // ---- 2. a .ps1 is lexed as PowerShell, not as the outer cmd command line ----
  {
    const c = countingFs();
    const verdict = inputIsolationRisk('powershell -File chain.ps1', { cwd: root, fs: c.fs, pathMod: path, dialect: 'cmd' });
    A.ok(c.reads.includes('second.mjs'), 'the statement after ";" in the .ps1 is a real head in PowerShell (trunk lexed it as cmd, where `" opened a quote and hid it): ' + JSON.stringify(c.reads));
    A.ok(verdict && /browser automation/.test(verdict), 'so the browser automation it runs is refused: ' + verdict);
    A.ok(commandSafetyRisk('powershell -File chain.ps1', { cwd: root, fs, pathMod: path, dialect: 'cmd', isWin: true }), 'the combined safety floor refuses it too');
  }

  // ---- 2b. a launcher INSIDE a code line is still followed under cmd, as trunk's whole-file lexing did ----
  {
    put(root, 'one.mjs', "require('child_process').execSync('npm ci && node second.mjs --headed');\n");
    put(root, 'package.json', JSON.stringify({ scripts: { e2e: 'node second.mjs --headed' } }));
    put(root, 'three.mjs', "require('child_process').execSync('npm ci && npm run e2e');\n");
    for (const f of ['one.mjs', 'three.mjs']) {
      const v = inputIsolationRisk('node ' + f, { cwd: root, fs, pathMod: path, dialect: 'cmd' });
      A.ok(v && /browser automation/.test(v), f + ' under cmd: the head after && is followed into second.mjs and refused (a line-start-only scan allowed it): ' + v);
      A.ok(commandSafetyRisk('node ' + f, { cwd: root, fs, pathMod: path, dialect: 'cmd', isWin: true }), f + ': the combined safety floor refuses it too');
    }
  }

  // ---- 2c. trunk's refusals hold: a nesting launcher on a code line, an apostrophe in a shell file's comment ----
  {
    const list = (line) => "const steps = `\n" + line + "\n`;\nrequire('child_process').execSync(steps);\n";
    put(root, 'nest-cmd.mjs', list('cmd /c chain.cmd'));
    put(root, 'nest-call.mjs', list('call chain.cmd'));
    put(root, 'nest-saps.mjs', list('Start-Process chain.cmd'));
    put(root, 'nest-zsh.mjs', list('zsh -c ./chain.cmd'));
    for (const f of ['nest-cmd.mjs', 'nest-call.mjs', 'nest-saps.mjs', 'nest-zsh.mjs']) for (const dialect of ['cmd', 'posix']) {
      const v = inputIsolationRisk('node ' + f, { cwd: root, fs, pathMod: path, dialect });
      A.ok(v && /browser automation/.test(v), f + ' under ' + dialect + ': the nested script is followed into second.mjs and refused, as trunk did: ' + v);
      A.ok(commandSafetyRisk('node ' + f, { cwd: root, fs, pathMod: path, dialect, isWin: true }), f + ' under ' + dialect + ': the combined safety floor refuses it too');
    }
    put(root, 'note.sh', "#!/bin/bash\n# don't run this twice\nnode second.mjs\n");
    put(root, 'note.ps1', "# Don't run this twice\nnode second.mjs\n");
    for (const cmd of ['bash note.sh', 'powershell -File note.ps1']) {
      const v = inputIsolationRisk(cmd, { cwd: root, fs, pathMod: path, dialect: 'cmd' });
      A.ok(v && /browser automation/.test(v), cmd + ' under cmd: the line after the comment is still a head, as trunk lexed it: ' + v);
    }
  }

  // ---- 3. unchanged: shell sources are followed, code text keeps its in-text checks ----
  {
    const verdict = inputIsolationRisk('cmd /c chain.cmd', { cwd: root, fs, pathMod: path, dialect: 'cmd' });
    A.ok(verdict && /browser automation/.test(verdict), 'a .cmd file is still a command list whose scripts are followed: ' + verdict);
    const gui = inputIsolationRisk('node gui.mjs', { cwd: root, fs, pathMod: path, dialect: 'cmd' });
    A.ok(gui && /GUI\/native runtime/.test(gui), 'a referenced script that launches a desktop program is still refused: ' + gui);
  }
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
A.report('shell.source-scan.test');
