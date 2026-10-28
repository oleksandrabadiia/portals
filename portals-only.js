/* © 2026 Ara Badiia. All rights reserved. Not to be copied, shared or reused without permission. */
/* Portals on its own.
   The page shares its engine with Pandora (settings, keys, History, saving, Nano Banana and fal.ai),
   but here only the Portals tool is shown: every other tool is hidden, and the app always opens on Portals. */
(function () {
  'use strict';
  const css = document.createElement('style');
  css.textContent = `
.tabs .tab:not([data-view="portals"]){display:none!important}
.tabs .rail-sep{display:none!important}
.tab[data-view="portals"] .rail-beta{display:none!important}`;
  document.head.appendChild(css);

  // whatever asks for another tool (the logo, the start-up page, a link inside a message), open Portals instead
  const viaPortals = setView;
  setView = function () { viaPortals('portals'); };

  const name = document.getElementById('appName'); if (name) name.textContent = 'Portals';
  const brand = document.getElementById('brandHome');
  if (brand) {
    brand.title = 'Portals';
    const logo = brand.querySelector('svg');   // the arches icon instead of Pandora's
    if (logo) logo.outerHTML = '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="#ffffff" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 21V10a5 5 0 0 1 5-5h0a5 5 0 0 1 5 5v11"/><path d="M14 21V12a3.5 3.5 0 0 1 7 0v9"/><path d="M3 21h19"/><path d="M7 13.5c1.2-.8 2.8-.8 4 0"/></svg>';
  }
  document.title = 'Portals';

  setView('portals');
})();
