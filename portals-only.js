/* © 2026 Ara Badiia. All rights reserved. Not to be copied, shared or reused without permission. */
/* Portals on its own.
   The page shares its engine with Pandora (settings, keys, History, saving, Nano Banana and fal.ai).
   Here only Portals, Sections and Upscale are shown; the app always opens on Portals. */
(function () {
  'use strict';
  const TOOLS = ['portals', 'sections', 'upscale'];

  const css = document.createElement('style');
  css.textContent = `
.tabs .tab:not([data-view="portals"]):not([data-view="sections"]):not([data-view="upscale"]){display:none!important}
.tabs .rail-sep{display:none!important}
.tab[data-view="portals"] .rail-beta{display:none!important}
#vRef,#vAdjust,#vGrid,#vSplit,#vSheet,#vStoryChar,#vStoryStyle,#vRecreate,#vVideo{display:none!important}
#vPromptH{padding-right:110px}
.v-sec:has(#vPromptCopy){position:relative}
#vPromptCopy{position:absolute;top:-4px;right:0;font-size:11.5px}`;
  document.head.appendChild(css);

  // Portals first in the menu, then Sections and Upscale
  const nav = document.querySelector('nav.tabs'), pt = document.querySelector('.tab[data-view="portals"]');
  if (nav && pt) {
    const first = nav.querySelector('.tab');
    nav.insertBefore(pt, first);
    let after = pt;
    for (const v of ['sections', 'upscale']) {
      const t = nav.querySelector(`.tab[data-view="${v}"]`);
      if (t) { after.parentNode.insertBefore(t, after.nextSibling); after = t; }
    }
  }

  // Magnific needs a helper on a server, which Portals doesn't have: leave only the upscalers that work here
  for (const sel of ['#upEngine', '#fxEngine']) {
    const s = document.querySelector(sel); if (!s) continue;
    s.querySelectorAll('option[value="magnific"],option[value="precision"]').forEach(o => o.remove());
  }
  if (settings.upEngine === 'magnific' || settings.upEngine === 'precision') { settings.upEngine = 'google'; saveSettings(); }
  if (settings.fxEngine === 'magnific' || settings.fxEngine === 'precision') { settings.fxEngine = 'google'; saveSettings(); }
  const ue = document.querySelector('#upEngine'); if (ue) ue.value = settings.upEngine;
  const fe = document.querySelector('#fxEngine'); if (fe && settings.fxEngine) fe.value = settings.fxEngine;

  // any other tool asked for (the logo, the start-up page, a link inside a message) opens Portals instead
  const base = setView;
  setView = function (v) { base(TOOLS.includes(v) ? v : 'portals'); };

  const name = document.getElementById('appName'); if (name) name.textContent = 'Portals';
  const brand = document.getElementById('brandHome'); if (brand) brand.title = 'Portals';
  document.title = 'Portals';

  // the picture viewer: copy the prompt a picture was made with
  const ph = document.getElementById('vPromptH');
  if (ph && !document.getElementById('vPromptCopy')) {
    const b = document.createElement('button'); b.type = 'button'; b.id = 'vPromptCopy'; b.className = 'btn small'; b.textContent = 'Copy prompt';
    b.onclick = async e => {
      e.stopPropagation();
      const t = (document.getElementById('vPrompt') || {}).textContent || '';
      if (!t.trim()) { toast('This picture has no prompt saved.'); return; }
      try { await navigator.clipboard.writeText(t.trim()); toast('Prompt copied.'); } catch { toast('Couldn’t copy. Select the text and copy it instead.'); }
    };
    ph.parentNode.insertBefore(b, ph.nextSibling);
  }

  // History and the viewer: describe Portals pictures properly
  if (typeof shortHow === 'function') {
    const baseHow = shortHow;
    shortHow = function (r) {
      const R = r && r.recipe;
      if (R && R.kind === 'portals') return R.window ? `Portals · ${R.window}${R.time ? ' · ' + R.time : ''}` : 'Portals · final photograph';
      return baseHow.apply(this, arguments);
    };
  }

  // open on Portals, and bring back the layout you had open once your saved pictures have loaded
  const lastLayout = store.get('pandora.portals.src', null);
  setView('portals');
  if (lastLayout) (async () => {
    for (let i = 0; i < 200 && !img(lastLayout); i++) await new Promise(r => setTimeout(r, 150));
    const PP = window.PandoraPortals;
    if (img(lastLayout) && PP && !PP.P.layoutC && !PP.P.busyMsg && S.view === 'portals') PP.setLayout(lastLayout);
  })();
})();
