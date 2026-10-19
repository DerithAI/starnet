'use strict';
const fs = require('node:fs');
const path = require('node:path');
const A = require('./_assert.js');
const root = path.resolve(__dirname, '..');
const css = fs.readFileSync(path.join(root, 'frontend/css/readability.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const html = fs.readFileSync(path.join(root, 'frontend/index.html'), 'utf8');
const tokens = Object.fromEntries([...css.matchAll(/--sn-type-([a-z]+):\s*([\d.]+)px/g)].map(m => [m[1], Number(m[2])]));
// Keep the normal reading hierarchy bounded; making the whole app bigger is not this repair.
A.ok(tokens.meta >= 14 && tokens.meta <= 15, 'secondary text has a readable, compact floor');
A.ok(tokens.control >= 16 && tokens.control <= 17, 'control labels have normal reading size');
A.ok(tokens.prose >= 17 && tokens.prose <= 18, 'conversation prose remains readable without becoming a heading');
A.ok(tokens.title >= tokens.prose && tokens.title <= 20, 'agent names keep the agreed restrained upper bound');
A.ok(!/(?:^|[;{])\s*(?:zoom|transform|scale)\s*:/.test(css), 'readability never magnifies the cabinet or viewport');
A.ok(!/body\s*\*\s*\{/.test(css), 'no universal font override that would resize icons and artwork');
A.ok(!/\.(?:cmsg-copy|md-copy|gd-window-button)\b/.test(css), 'icon-only controls keep their explicit icon metrics');
A.ok(html.includes('href="css/readability.css"'), 'the shared frontend loads the reading scale outside the glass demo too');
A.ok(html.indexOf('css/readability.css') > html.indexOf('css/refit-kit.css'), 'legacy skins load before the reading scale');
for (const role of ['.crew-status','.ws-meta','#ws-kind-filter','.comms-agent-model','.model-dock-row-name','.con-rail-label','.cf-desc','.win-note','.refit-proptile-lbl','.set-bd-name']) {
  A.ok(css.includes(role), 'reading scale covers ' + role);
}
const station = fs.readFileSync(path.join(root, 'frontend/app/stationui.js'), 'utf8');
A.ok(/textScale:\s*0/.test(station), 'fresh users keep the existing automatic text-size preference');
A.ok(/document\.body\.style\.zoom\s*=\s*String\(tz\s*\/\s*100\)/.test(station), 'explicit saved text-size choices keep their existing meaning');
// Review finding world-render-11: the TEXT SIZE hotkey toast names the key the user pressed (Cmd on a Mac),
// in plain ASCII (U+2212 is a VT323 fallback glyph).
{
  const start = station.indexOf("  window.addEventListener('keydown', ev => {\n    if (!(ev.ctrlKey || ev.metaKey)");
  const end = station.indexOf('  let resizeClampTimer', start);
  A.ok(start >= 0 && end > start, 'the TEXT SIZE hotkey handler is present');
  const toasts = [];
  let handler = null;
  const scales = station.match(/const TEXT_SCALES = (\[[^\n]*\]);/);
  new Function('window', 'TEXT_SCALES', 'resolveTextScale', 'store', 'applySettings', 'save', 'rerender', 'autoTextScale', 'notify', station.slice(start, end))(
    { addEventListener: (type, fn) => { if (type === 'keydown') handler = fn; } }, JSON.parse(scales[1].replace(/'/g, '"')),
    v => Number(v) || 100, { settings: { textScale: 100 } }, () => {}, () => {}, () => {}, () => 100, text => toasts.push(text));
  const press = mods => handler(Object.assign({ key: '=', altKey: false, defaultPrevented: false, preventDefault() {} }, mods));
  press({ metaKey: true, ctrlKey: false });
  A.ok(toasts[0] && toasts[0].includes('Cmd + and Cmd - change it, Cmd 0 resets'), 'Cmd+= teaches the Cmd chord: ' + toasts[0]);
  A.ok(toasts[0] && !toasts[0].includes('Ctrl'), 'a Mac toast never says Ctrl');
  press({ metaKey: false, ctrlKey: true });
  A.ok(toasts[1] && toasts[1].includes('Ctrl + and Ctrl - change it, Ctrl 0 resets'), 'Ctrl+= teaches the Ctrl chord: ' + toasts[1]);
  A.ok(toasts.every(t => !t.includes('−')), 'the toast uses the plain minus the user types');
}
A.report('readability.test');
