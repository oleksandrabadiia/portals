# Portals

A key visual constructor by Ara Badiia: paint each opening of a layout one flat colour,
give every colour its own place and time of day, and Portals builds one photograph
(with a fully layered Photoshop export).

© 2026 Ara Badiia. All rights reserved. Private. See LICENSE.

## Files
- `index.html` — the app (its engine is shared with Pandora: settings, keys, History, saving)
- `pandora_portals-addon.js` — the Portals tool itself
- `portals-only.js` — shows only Portals and always opens on it
- `pandora_ag-psd.js` — the Photoshop file writer (ag-psd by its own authors, MIT licence; not covered by the copyright above)
- `lock.js` — temporary password screen, to be replaced by Cloudflare Access sign-in

## Keys
No API keys are stored in this code. Each person adds their own keys in Settings,
and they're saved only in that person's browser.

## Hosting
Cloudflare Pages, deployed automatically from this repository's `main` branch.
