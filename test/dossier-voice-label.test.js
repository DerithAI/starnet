'use strict';
/* org P21 wire: the dossier's VOICE row names an agent's voice with the SAME word the VOICE FOR picker it opens shows
   (the catalogue label, e.g. HEART) — never the stored engine id (af_heart). Runs the shipped voice.js helpers and the shipped
   agSetupStrip, not stubs of them. */
const A = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const LV = require('../sidecar/local-voice.js');

const voiceSrc = fs.readFileSync(require.resolve('../frontend/app/voice.js'), 'utf8');
const from = voiceSrc.indexOf('  const voiceLabels = new Map();');
const to = voiceSrc.indexOf('  function setVoiceChoice(');
A.ok(from > 0 && to > from, 'voice.js carries the voiceLabels helpers');
const vctx = {};
vm.createContext(vctx);
vm.runInContext(voiceSrc.slice(from, to) + '\nthis.voiceLabel = voiceLabel; this.rememberVoiceLabels = rememberVoiceLabels;', vctx);

// before the sidecar has reported its list, the fallback already gives every shipped catalogue row its picker word
for (const v of LV.voices()) A.equal(vctx.voiceLabel(v.id), v.label, v.id + ' reads ' + v.label + ' before the voice list loads');
A.equal(vctx.voiceLabel(''), '', 'no choice → no word (the row says station default)');
// once the sidecar reports labels, those words win
vctx.rememberVoiceLabels([{ id: 'af_heart', label: 'HEART (WARM)' }, null, { id: 'x' }]);
A.equal(vctx.voiceLabel('af_heart'), 'HEART (WARM)', 'a label the sidecar reported is the word shown');

// the shipped dossier strip uses it
const ui = fs.readFileSync(require.resolve('../frontend/app/stationui.js'), 'utf8');
const s0 = ui.indexOf('  function agSetupStrip(a) {');
const s1 = ui.indexOf('  function agBrief(a) {');
A.ok(s0 > 0 && s1 > s0, 'stationui.js carries agSetupStrip');
function strip(stored) {
  const lv = {};
  vm.createContext(lv);
  vm.runInContext(voiceSrc.slice(from, to) + '\nthis.voiceLabel = voiceLabel;', lv);
  const ctx = {
    Personas: undefined, esc: s => String(s),
    executionProfileOf: () => ({ label: 'SAFE CELL' }), executionProfileId: () => 'safe',
    Voice: { voiceChoice: id => (id === 'mira' ? stored : ''), voiceLabel: lv.voiceLabel }
  };
  vm.createContext(ctx);
  vm.runInContext(ui.slice(s0, s1), ctx);
  return ctx.agSetupStrip({ id: 'mira' });
}
const html = strip('af_heart');
const row = html.split('data-goconfig="ag-voice"')[1].split('</button>')[0];
A.match(row, /ag-setup-val">HEART</, 'MIRA\'s VOICE row reads HEART, the picker\'s word');
A.doesNotMatch(row, /af_heart/, '…never the engine id');
A.match(strip('').split('data-goconfig="ag-voice"')[1], /ag-setup-val dim">station default</, 'no choice still reads station default');

// VoiceLive.voices feeds the label memory from the same reply the picker paints
const live = fs.readFileSync(require.resolve('../frontend/app/voice-live.js'), 'utf8');
A.match(live, /rememberVoiceLabels\(j\.voices\)/, 'VoiceLive.voices remembers the sidecar\'s labels');
console.log('dossier-voice-label.test: OK');
