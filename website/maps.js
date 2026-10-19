/* website/maps.js — the public community maps gallery (maps.html).

   Reads the SAME signed index every StarNet station reads (/.well-known/starnet-maps.json, built by
   scripts/build-map-catalog.mjs) and lists each map with its picture, its author and what it holds. Same-origin
   requests only (the site's CSP allows nothing else); every string from the index is inserted as text, never as
   HTML, and only paths of the gallery's own shape become links or images. No tracking, no storage. */
(function () {
  'use strict';

  var INDEX = '/.well-known/starnet-maps.json';
  var list = document.getElementById('mp-list');
  var status = document.getElementById('mp-status');
  var count = document.getElementById('mp-count');
  if (!list || !status) return;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = String(text);
    return n;
  }
  function str(v) { return v == null ? '' : String(v); }
  function n(k, one, many) { k = Number(k) || 0; return k + ' ' + (k === 1 ? one : many); }
  // only the gallery's own immutable file paths are ever used
  var FILE_RE = { 'still.png': /^maps\/[a-z0-9-]+\/[0-9]+\/still\.png$/, 'build.starnet-build.json': /^maps\/[a-z0-9-]+\/[0-9]+\/build\.starnet-build\.json$/ };
  function safe(path, file) { return FILE_RE[file] && FILE_RE[file].test(str(path)) ? '/' + path : ''; }

  function card(m) {
    var c = el('article', 'mp-card');
    var still = safe(m.still && m.still.path, 'still.png');
    var art = el('div', 'mp-art');
    if (still) {
      var img = el('img');
      img.src = still; img.alt = 'The station ' + str(m.title); img.loading = 'lazy'; img.decoding = 'async';
      if (m.still.width && m.still.height) { img.width = m.still.width; img.height = m.still.height; }
      art.appendChild(img);
    }
    c.appendChild(art);
    var body = el('div', 'mp-body');
    body.appendChild(el('h4', null, m.title));
    var meta = el('p', 'mk-meta');
    meta.appendChild(document.createTextNode('by '));
    meta.appendChild(el('b', null, m.credit));
    meta.appendChild(document.createTextNode(' · CC BY 4.0 · v' + str(m.version)));
    body.appendChild(meta);
    if (m.description) body.appendChild(el('p', 'mk-desc', m.description));
    var st = m.stats || {};
    var holds = [n(st.rooms, 'room', 'rooms'), n(st.props, 'prop', 'props')];
    if (st.lines) holds.push(n(st.lines, 'line', 'lines'));
    body.appendChild(el('p', 'mp-holds', holds.join(' · ')));
    var build = safe(m.build && m.build.path, 'build.starnet-build.json');
    if (build) {
      var row = el('p', 'mk-dl-row');
      var a = el('a', 'mk-dl', 'Download the map file');
      a.href = build;
      a.setAttribute('download', str(m.slug) + '.starnet-build.json');
      row.appendChild(a);
      row.appendChild(el('span', null, ' ' + Math.max(1, Math.round((Number(m.build.bytes) || 0) / 1024)) + ' KB'));
      body.appendChild(row);
    }
    c.appendChild(body);
    return c;
  }

  function show(maps) {
    list.textContent = '';
    if (!maps.length) {
      status.textContent = 'No maps yet. Be the first: share your station from build mode (see below).';
      return;
    }
    status.textContent = '';
    if (count) count.textContent = n(maps.length, 'station', 'stations') + ' shared by StarNet players, each one checked by a person.';
    for (var i = 0; i < maps.length; i++) list.appendChild(card(maps[i]));
  }

  fetch(INDEX, { credentials: 'omit' }).then(function (r) {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  }).then(function (doc) {
    if (!doc || doc.format !== 'starnet-maps/v1' || !Array.isArray(doc.maps)) throw new Error('unsupported gallery');
    // newest version first is not knowable from the index; show by name, the way stations list them
    var maps = doc.maps.filter(function (m) { return m && m.slug && m.title && m.credit; });
    show(maps);
  }).catch(function () {
    status.textContent = 'The gallery could not be loaded. Try again in a moment.';
    status.classList.add('mk-err');
  });
})();
