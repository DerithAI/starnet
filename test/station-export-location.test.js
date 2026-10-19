/* node test/station-export-location.test.js — #134 "Export Station no where to be found".

   EXPORT STATION used to hand a blob to `<a download>` and then print "✓ exported (secrets excluded …)": a delivery
   the page can never see. On the macOS desktop app the WebView dropped the file into ~/Downloads silently, and the
   user could not find it. The truthful split:
     • desktop  — the sidecar writes the file itself into a folder it can name (Downloads, else home), proves it by
                  reading it back, and the line names the EXACT path;
     • browser  — the page can only hand the file to the browser, so the line names the file it handed over and
                  points at the browser's downloads, never a bare "exported".
   Round-trips the REAL functions: configexport.buildExport -> backupfile.saveStationExport -> Backup.exportStation. */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');

const A = require('./_assert.js');
const ok = A.ok, eq = A.eq;

global.localStorage = { length: 0, key: () => null, getItem: () => null, setItem: () => {}, removeItem: () => {} };
const Backup = require('../frontend/app/backup.js');
const backupFile = require('../sidecar/backupfile.js');
const configExport = require('../sidecar/configexport.js');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'starnet-export-134-'));
const NOW = Date.UTC(2026, 9, 18, 12, 0, 0);
const DAY = '2026-10-18';

(async () => {
  try {
    // ---- the reproduction: the settings line claimed a delivery it cannot see ----
    const ui = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'stationui.js'), 'utf8');
    const wire = A.fnBody(ui, 'function wireBackup(');
    ok(wire.indexOf('function wireBackup(') === 0 && wire.length < 20000, 'wireBackup is present (and scanned alone)');
    ok(!/✓ exported/.test(wire), 'EXPORT STATION never prints a bare "✓ exported" it cannot prove');
    ok(/Backup\.exportStation\(/.test(wire), 'EXPORT STATION goes through Backup.exportStation (the one truthful line)');
    const appjs = fs.readFileSync(path.join(__dirname, '..', 'frontend', 'app', 'app.js'), 'utf8');
    ok(!/'saved ' \+ r\.file/.test(appjs), 'EXPORT AGENT (recovery screen) never claims "saved" for a file it only handed over');

    // ---- sidecar: where the desktop file lands, named before it is written ----
    eq(backupFile.stationBackupBase(NOW), 'starnet-station-' + DAY, 'the backup name carries the export day');
    const homeNoDl = fs.mkdtempSync(path.join(tmp, 'home-a-'));
    eq(backupFile.defaultExportDir(homeNoDl), homeNoDl, 'no Downloads folder: the file lands in home');
    const homeDl = fs.mkdtempSync(path.join(tmp, 'home-b-'));
    fs.mkdirSync(path.join(homeDl, 'Downloads'));
    eq(backupFile.defaultExportDir(homeDl), path.join(homeDl, 'Downloads'), 'the Downloads folder when it exists');

    // ---- sidecar: write, prove, never clobber ----
    const first = backupFile.saveExportFile('{"a":1}\n', { dir: homeDl, base: 'starnet-station-' + DAY });
    eq(first.ok, true, 'the first save succeeds');
    eq(first.file, 'starnet-station-' + DAY + '.json', 'the first save keeps the plain name');
    eq(first.path, path.join(homeDl, 'starnet-station-' + DAY + '.json'), 'the returned path is the real absolute path');
    eq(fs.readFileSync(first.path, 'utf8'), '{"a":1}\n', 'the file on disk holds exactly what was exported');
    const second = backupFile.saveExportFile('{"a":2}\n', { dir: homeDl, base: 'starnet-station-' + DAY });
    eq(second.file, 'starnet-station-' + DAY + '-2.json', 'a second export the same day gets its own name');
    eq(fs.readFileSync(first.path, 'utf8'), '{"a":1}\n', 'the earlier backup is never overwritten');
    const missing = backupFile.saveExportFile('{}', { dir: path.join(tmp, 'no-such-folder'), base: 'x' });
    eq(missing.ok, false, 'a folder that is not there is an honest failure');
    ok(/folder/.test(missing.error), 'the failure says why: ' + missing.error);
    ok(!fs.existsSync(path.join(tmp, 'no-such-folder')), 'a failed save creates nothing');

    // ---- round trip: the real envelope saved, read back, and accepted by the real importer ----
    const env = configExport.buildExport({ budget: { perRun: 2 }, settings: { theme: 'blue' } }, { now: NOW, app: 'StarNet' });
    const saved = backupFile.saveStationExport(JSON.stringify(env, null, 2), { home: homeNoDl, now: NOW });
    eq(saved.ok, true, 'the station export saves');
    eq(saved.path, path.join(homeNoDl, 'starnet-station-' + DAY + '.json'), 'saveStationExport names the real file');
    const parsed = configExport.parseImport(JSON.parse(fs.readFileSync(saved.path, 'utf8')));
    eq(parsed.ok, true, 'the saved file imports back through the real importer');
    eq(parsed.sections.budget, { perRun: 2 }, 'the saved file carries the station config');

    // ---- frontend: the line says exactly what the app knows ----
    const fakeHome = fs.mkdtempSync(path.join(tmp, 'home-c-'));
    fs.mkdirSync(path.join(fakeHome, 'Downloads'));
    const routes = calls => async (url, body) => {
      calls.push(url);
      if (url === '/api/config/export') return { ok: true, status: 200, j: configExport.buildExport({ settings: body.sections.settings }, { now: NOW }) };
      if (url === '/api/config/export/save') {
        const env2 = configExport.buildExport({ settings: body.sections.settings }, { now: NOW });
        const r = backupFile.saveStationExport(JSON.stringify(env2, null, 2), { home: fakeHome, now: NOW });
        return { ok: r.ok, status: r.ok ? 200 : 500, j: r };
      }
      return { ok: false, status: 404, j: { error: 'no route' } };
    };

    // desktop: the sidecar wrote it; the line names the exact path and nothing is handed to the WebView
    let calls = [], downloads = [];
    let r = await Backup.exportStation({ sections: { settings: { theme: 'blue' } }, desktop: true, post: routes(calls),
      download: (f, t) => { downloads.push(f); return true; }, now: NOW });
    eq(r.ok, true, 'desktop export succeeds');
    eq(r.where, 'disk', 'desktop export is a file the station wrote');
    eq(r.path, path.join(fakeHome, 'Downloads', 'starnet-station-' + DAY + '.json'), 'desktop result carries the real path');
    ok(r.line.indexOf(r.path) >= 0, 'the line names the exact path: ' + r.line);
    ok(/secrets excluded/.test(r.line), 'the line still says secrets are excluded');
    eq(downloads.length, 0, 'desktop never also drops a WebView download');
    eq(calls, ['/api/config/export/save'], 'desktop asks the sidecar to save');
    ok(fs.existsSync(r.path), 'the named file is really there');

    // browser: only the hand-off is known
    calls = []; downloads = [];
    let texts = [];
    r = await Backup.exportStation({ sections: { settings: { theme: 'blue' } }, desktop: false, post: routes(calls),
      download: (f, t) => { downloads.push(f); texts.push(t); return true; }, now: NOW });
    eq(r.ok, true, 'browser export succeeds');
    eq(r.where, 'browser', 'browser export is a hand-off to the browser');
    eq(downloads, ['starnet-station-' + DAY + '.json'], 'the browser is handed the dated file');
    eq(JSON.parse(texts[0]).starnetExport, 1, 'the handed file is the real envelope');
    ok(r.line.indexOf('starnet-station-' + DAY + '.json') >= 0, 'the browser line names the file: ' + r.line);
    ok(/browser's downloads/.test(r.line), 'the browser line points at the browser downloads');
    ok(!/✓/.test(r.line) && !/^exported/.test(r.line), 'the browser line claims no delivery it cannot see');
    eq(calls, ['/api/config/export'], 'the browser never asks the sidecar to write a file on the host');

    // desktop, but the save was refused (e.g. macOS folder permission denied): fall back to the hand-off, say so
    calls = []; downloads = [];
    const refusing = async (url, body) => {
      calls.push(url);
      if (url === '/api/config/export/save') return { ok: false, status: 500, j: { ok: false, error: 'permission denied for ' + fakeHome } };
      return routes([])(url, body);
    };
    r = await Backup.exportStation({ sections: {}, desktop: true, post: refusing, download: f => { downloads.push(f); return true; }, now: NOW });
    eq(r.ok, true, 'a refused save still exports through the hand-off');
    eq(r.where, 'browser', 'the fallback is the hand-off');
    eq(calls, ['/api/config/export/save', '/api/config/export'], 'refused save -> plain export');
    eq(downloads, ['starnet-station-' + DAY + '.json'], 'the fallback hands over the dated file');
    ok(/permission denied/.test(r.line), 'the line says why the save failed: ' + r.line);
    ok(r.line.indexOf('starnet-station-' + DAY + '.json') >= 0, 'the fallback line names the file');

    // an older sidecar without the save route (404, no JSON ok) falls back the same way
    calls = []; downloads = [];
    const oldSidecar = async (url, body) => { calls.push(url); if (url === '/api/config/export/save') return { ok: false, status: 404, j: { error: 'not found' } }; return routes([])(url, body); };
    r = await Backup.exportStation({ sections: {}, desktop: true, post: oldSidecar, download: f => { downloads.push(f); return true; }, now: NOW });
    eq(r.ok && downloads.length === 1, true, 'no save route -> the hand-off still happens');

    // a sidecar that refuses the export entirely: nothing is downloaded as a "backup"
    downloads = [];
    r = await Backup.exportStation({ sections: {}, desktop: false, post: async () => ({ ok: false, status: 409, j: { error: 'cannot export safely' } }),
      download: f => { downloads.push(f); return true; }, now: NOW });
    eq(r.ok, false, 'a refused export fails');
    eq(downloads.length, 0, 'an error body is never downloaded as a backup');
    ok(/export failed/.test(r.line) && /cannot export safely/.test(r.line), 'the failure line carries the reason: ' + r.line);

    // the hand-off itself failed
    r = await Backup.exportStation({ sections: {}, desktop: false, post: routes([]), download: () => false, now: NOW });
    eq(r.ok, false, 'a failed hand-off is not an export');

    // the post itself threw (sidecar unreachable)
    r = await Backup.exportStation({ sections: {}, desktop: false, post: async () => { throw new Error('offline'); }, download: () => true, now: NOW });
    eq(r.ok, false, 'an unreachable sidecar is an honest failure');

  } catch (e) {
    ok(false, 'station-export-location threw: ' + (e && e.stack ? e.stack : e));
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { console.warn('[test] temp cleanup: ' + e.message); }
  }
  A.report('station-export-location.test');
})().catch(e => { console.error(e && e.stack || e); process.exit(1); });
