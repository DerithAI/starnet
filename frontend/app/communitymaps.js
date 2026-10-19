/* COMMUNITY MAPS (2026-10-18) — the page's side of the community gallery. Build mode's Presets sheet uses it for two
   things, and owns all of the layout around them (build.js):

   SHARE: the station's LAYOUT (BuildShare.exportBuild: no crew, step instructions, folders, connections or made
   props) and a picture of it go to the linked StarNet account for a person to review. The picture is the station
   itself (World.renderStill, crew left out) when that is exactly what the build carries; when it is not — made props
   the build leaves behind, or unsaved build edits the stage has not drawn yet — it is the floor plan drawn from the
   cleaned build, so the gallery never shows furniture an importer would not get. The answer shown is the cloud's.

   READ: the sidecar fetches the signed gallery index and every file it pins (sidecar/maps/community.js); this page
   only ever builds a map through BuildShare.readBuild and the presets' own confirm, backup and undo.

     CommunityMaps.load(refresh)      -> { ok, maps, linked, error }
     CommunityMaps.stillUrl(map)      -> object URL of the map's picture (cached)
     CommunityMaps.buildText(map)     -> the map's build file text
     CommunityMaps.picture(cleanDoc, dropped, drawPlan) -> { dataUrl, kind: 'station'|'plan', why }
     CommunityMaps.share(fields)      -> the sidecar's answer: { ok, status, linked, submission?, error? } */
'use strict';
const CommunityMaps = (() => {
  const api = (url, init) => (typeof Harness !== 'undefined' && Harness.apiFetch) ? Harness.apiFetch(url, init) : fetch(url, init);
  const STILL_PX = 1280, STILL_SMALL_PX = 960, MAX_DATA_URL = 2.8 * 1024 * 1024 * 4 / 3;
  const stills = new Map();

  async function load(refresh) {
    try {
      const r = await api('/api/community-maps' + (refresh ? '?refresh=1' : ''));
      const j = await r.json();
      return j && typeof j === 'object' ? j : { ok: false, error: 'The community gallery answered nothing readable.' };
    } catch (_) { return { ok: false, error: 'This station could not reach its own sidecar.' }; }
  }
  const fileUrl = (m, which) => '/api/community-maps/file?slug=' + encodeURIComponent(m.slug) + '&v=' + encodeURIComponent(m.version) + '&which=' + which;
  async function stillUrl(m) {
    const key = m.slug + '@' + m.version;
    if (stills.has(key)) return stills.get(key);
    const p = (async () => {
      const r = await api(fileUrl(m, 'still'));
      if (!r.ok) throw new Error('no picture');
      return URL.createObjectURL(await r.blob());
    })();
    stills.set(key, p);
    p.catch(() => stills.delete(key));
    return p;
  }
  async function buildText(m) {
    const r = await api(fileUrl(m, 'build'));
    if (!r.ok) {
      let msg = 'That map could not be opened.';
      try { const j = await r.json(); if (j && j.error) msg = j.error; } catch (_) {}
      throw new Error(msg);
    }
    return r.text();
  }

  /* the picture that goes with a share. drawPlan(ctx, doc, w, h) is build.js's floor-plan drawing (the preset cards'). */
  function picture(cleanDoc, dropped, drawPlan) {
    const madeLeftOut = dropped && dropped.made > 0;
    if (!madeLeftOut && typeof World !== 'undefined' && typeof World.renderStill === 'function') {
      for (const px of [STILL_PX, STILL_SMALL_PX]) {
        let still = null;
        try { still = World.renderStill(px, { noBodies: true }); } catch (_) { still = null; }
        if (!still || !still.canvas) break;   // unsaved build edits hold the floor: the stage has not drawn them
        const dataUrl = still.canvas.toDataURL('image/png');
        if (dataUrl.length <= MAX_DATA_URL) return { dataUrl, kind: 'station', why: '' };
      }
    }
    const cv = document.createElement('canvas');
    cv.width = 1200; cv.height = 730;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#0b0d0e'; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.save(); ctx.scale(cv.width / 230, cv.height / 140); drawPlan(ctx, cleanDoc, 230, 140); ctx.restore();
    return {
      dataUrl: cv.toDataURL('image/png'), kind: 'plan',
      why: madeLeftOut ? 'Its picture is the floor plan: your made props stay home, so a picture of the station would show furniture others will not get.'
        : 'Its picture is the floor plan, because this build has changes the station has not drawn yet. SAVE & EXIT first to share a picture of the station itself.'
    };
  }

  async function share(fields) {
    try {
      const r = await api('/api/community-maps/share', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields) });
      let j = null;
      try { j = await r.json(); } catch (_) { j = null; }
      return j && typeof j === 'object' ? j : { ok: false, status: r.status, error: 'The share got no readable answer. Check your Maps tab on account.starnetos.com before sending it again.' };
    } catch (_) { return { ok: false, status: 0, error: 'This station could not reach its own sidecar. Nothing was shared.' }; }
  }

  return { load, stillUrl, buildText, picture, share };
})();
if (typeof module !== 'undefined' && module.exports) module.exports = CommunityMaps;
