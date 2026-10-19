/* Host-only web_request response provenance. A private Symbol cannot be supplied by JSON tool arguments or
   third-party bodies. It is enumerable so the host's Object.assign result decorations preserve it; JSON and
   model-facing string projections omit it. Registry reconstruction must carry it explicitly. */
'use strict';
const RESPONSE = Symbol('web response provenance');
function stamp(result, url) {
  let origin = '';
  try { const u = new URL(url); if (u.protocol === 'https:') origin = u.origin.toLowerCase(); } catch (_) { origin = ''; } // invalid provenance fails closed
  Object.defineProperty(result, RESPONSE, { value: Object.freeze({ origin }), enumerable: true });
  return result;
}
function originOf(result) {
  const record = result && Object.prototype.hasOwnProperty.call(result, RESPONSE) ? result[RESPONSE] : null;
  return record ? record.origin : '';
}
function carry(from, to) {
  if (from && Object.prototype.hasOwnProperty.call(from, RESPONSE)) {
    Object.defineProperty(to, RESPONSE, { value: from[RESPONSE], enumerable: true });
  }
  return to;
}
module.exports = { stamp, originOf, carry };
