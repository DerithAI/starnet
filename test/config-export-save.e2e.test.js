/* node test/config-export-save.e2e.test.js — #134: the desktop EXPORT STATION route writes a real file the line can name.
   Boots a real sidecar whose home (USERPROFILE/HOME) is a scratch dir with a Downloads folder, then proves through
   HTTP: the route saves the envelope into <home>/Downloads, returns that exact path, never overwrites a same-day
   backup, and stays behind the launch token like every /api route. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const A = require('./_assert.js');
const { SidecarFixture } = require('./helpers/sidecar-fixture.js');

(async () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-export-home-'));
  const downloads = path.join(home, 'Downloads');
  fs.mkdirSync(downloads);
  const fixture = SidecarFixture.create({ prefix: 'starnet-export-save-', env: { USERPROFILE: home, HOME: home } });
  try {
    await fixture.start();

    const first = await fixture.json('POST', '/api/config/export/save', { sections: { settings: { theme: 'blue' } } });
    A.eq(first.status, 200, 'POST /api/config/export/save -> 200');
    A.eq(first.body.ok, true, 'the save reports ok');
    A.eq(path.dirname(first.body.path), downloads, 'the file lands in the Commander\'s Downloads folder');
    A.ok(/^starnet-station-\d{4}-\d{2}-\d{2}\.json$/.test(first.body.file), 'the file carries the dated backup name: ' + first.body.file);
    A.eq(path.join(downloads, first.body.file), first.body.path, 'the returned path is the file\'s real absolute path');
    const env = JSON.parse(fs.readFileSync(first.body.path, 'utf8'));
    A.eq(env.starnetExport, 1, 'the saved file is the station export envelope');
    A.eq(env.sections.settings, { theme: 'blue' }, 'the browser-owned slices ride into the saved file');

    const second = await fixture.json('POST', '/api/config/export/save', { sections: {} });
    A.eq(second.status, 200, 'a second save the same day succeeds');
    A.ok(second.body.path !== first.body.path && /-2\.json$/.test(second.body.file), 'a second save gets its own name: ' + second.body.file);
    A.eq(JSON.parse(fs.readFileSync(first.body.path, 'utf8')).sections.settings, { theme: 'blue' }, 'the first backup is not overwritten');

    const tokenless = await fetch(fixture.baseUrl + '/api/config/export/save', {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: fixture.baseUrl }, body: '{}'
    });
    A.eq(tokenless.status, 403, 'the save route is behind the launch token');
    A.eq(fs.readdirSync(downloads).length, 2, 'a refused request writes nothing');

    const plain = await fixture.json('POST', '/api/config/export', { sections: {} });
    A.eq(plain.status, 200, 'the browser export route is unchanged');
    A.eq(plain.body.starnetExport, 1, 'the browser export still returns the envelope itself');
  } catch (e) {
    A.ok(false, 'config-export-save.e2e threw: ' + (e && e.stack ? e.stack : e));
    console.error(fixture.output().slice(-2000));
  } finally {
    await fixture.dispose();
    fs.rmSync(home, { recursive: true, force: true });
  }
  A.report('config-export-save.e2e.test');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
