/* © 2026 Ara Badiia. All rights reserved. Not to be copied, shared or reused without permission. */
/* Portals · Portals — one picture, a different place and time of day in every window.
   1. Layout: a picture where every window is painted one flat colour. Portals finds the colours by itself and each
      colour becomes a window. Everything that isn't a flat colour (the stone arches) is kept exactly as it is.
   2. Each window has its own place, time of day, camera height and reference pictures.
   3. Windows are painted into the picture from the outside in. Each window owns the arch standing inside it:
      the arch is lit by that scene, casts shadows into it, and things in the scene can pass in front of it.
      (Window 1 owns arch 1, window 2 owns arch 2, and so on.) The inner windows stay flat colour until their turn.
   4. Optional last pass: Nano Banana makes it all look like one photograph (light on the stone, shadows, clean edges). */
(function () {
  'use strict';
  const $q = s => document.querySelector(s);
  const MAX = 4096, TOL = 34;
  const TIMES = [
    ['sunrise', 'Sunrise', 'at sunrise: the sun just above the horizon, soft golden-pink light, long shadows and a little morning haze'],
    ['morning', 'Morning', 'in clear mid-morning light: fresh, bright and clean, with soft shadows'],
    ['midday', 'Midday', 'at midday: high bright sun, deep blue sky, crisp short shadows'],
    ['golden', 'Golden hour', 'at golden hour: warm low sun, glowing golden light and long shadows'],
    ['sunset', 'Sunset', 'at sunset: the sun on the horizon, an orange and magenta sky, warm rim light'],
    ['blue', 'Blue hour', 'at blue hour just after sunset: a deep blue sky, warm lights and lanterns starting to glow'],
    ['night', 'Night', 'at night: a dark sky, warm light from lanterns, windows and city lights'],
  ];
  const CAMS = [
    ['eye', 'Eye level', 'The camera is at eye level, looking straight ahead, with the horizon around the middle of the window.'],
    ['low', 'Low', 'The camera is low, close to the ground, looking slightly up, with the horizon low in the window.'],
    ['high', 'High', 'The camera is slightly raised, looking a little down over the scene, with the horizon high in the window.'],
  ];
  const defs = { ptModel: 'gemini-nano-banana-2.1', ptSize: '2K' };
  for (const k in defs) if (settings[k] === undefined) settings[k] = defs[k];

  const P = { layoutId: null, W: 0, H: 0, layoutC: null, px: null, labels: null, frameC: null, zones: [], sel: null,
    view: 'result', busy: {}, busyMsg: null, blendBusy: null, picking: false, style: '', notes: '', grow: 2, blendId: null };

  /* ---------------- small helpers ---------------- */
  const cv = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };
  const ctx = c => c.getContext('2d', { willReadFrequently: true });
  const rgb = c => `rgb(${c[0]},${c[1]},${c[2]})`;
  const part = (c, t) => ({ mime: t, b64: c.toDataURL(t, 0.92).split(',')[1] });
  const zoneOf = id => P.zones.find(z => z.id === id);
  const timeOf = z => TIMES.find(t => t[0] === z.time) || TIMES[2];
  const camOf = z => CAMS.find(c => c[0] === z.cam) || CAMS[0];
  async function getBlob(r) { return r.blob || await (await fetch(r.url)).blob(); }
  function sizeFor(model) { const m = MODELS.find(x => x.id === model) || MODELS[0]; return m.sizes.includes(settings.ptSize) ? settings.ptSize : m.sizes[m.sizes.length > 1 ? 1 : 0]; }
  const price = () => (PRICES[settings.ptModel] || {})[sizeFor(settings.ptModel)] || 0;
  const ratio = () => typeof nearestRatio === 'function' ? nearestRatio(P.W / P.H, RATIOS) : '16:9';
  function colourName(c) {
    const r = c[0] / 255, g = c[1] / 255, b = c[2] / 255, mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
    const s = d === 0 ? 0 : d / (1 - Math.abs(2 * l - 1));
    if (s < 0.15) return l > 0.85 ? 'White' : l < 0.15 ? 'Black' : 'Grey';
    let h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4; h = (h * 60 + 360) % 360;
    return h < 15 ? 'Red' : h < 40 ? 'Orange' : h < 70 ? 'Yellow' : h < 165 ? 'Green' : h < 195 ? 'Teal' : h < 255 ? 'Blue' : h < 290 ? 'Purple' : h < 335 ? 'Pink' : 'Red';
  }
  const newZone = c => ({ id: uid(), color: c, name: colourName(c) + ' window', place: '', time: 'midday', cam: 'eye', refs: [], versions: [], vi: -1, t: { x: 0, y: 0, s: 1 }, meta: {} });

  /* ---------------- 1. Finding the windows ---------------- */
  async function loadLayout(r) {
    const bm = await createImageBitmap(await getBlob(r)), k = Math.min(1, MAX / Math.max(bm.width, bm.height));
    const W = Math.round(bm.width * k), H = Math.round(bm.height * k), c = cv(W, H), g = ctx(c);
    g.drawImage(bm, 0, 0, W, H); bm.close && bm.close();
    Object.assign(P, { layoutC: c, W, H, px: g.getImageData(0, 0, W, H).data });
  }
  function findColours() {   // flat colours covering a good part of the picture
    const { px, W, H } = P, step = Math.max(1, Math.floor(Math.sqrt(W * H / 400000))), exact = new Map(); let n = 0;
    for (let y = 0; y < H; y += step) for (let x = 0; x < W; x += step) {
      const i = (y * W + x) * 4; if (px[i + 3] < 200) continue;
      const key = (px[i] << 16) | (px[i + 1] << 8) | px[i + 2]; exact.set(key, (exact.get(key) || 0) + 1); n++;
    }
    let cands = [...exact].filter(([, c]) => c > n * 0.004).map(([k, c]) => ({ rgb: [k >> 16 & 255, k >> 8 & 255, k & 255], c }));
    if (!cands.length) {   // saved as JPEG: the colours wobble a little, so group close ones
      const q = new Map();
      for (const [k, c] of exact) {
        const r = k >> 16 & 255, g = k >> 8 & 255, b = k & 255, key = (r >> 3) << 10 | (g >> 3) << 5 | (b >> 3), o = q.get(key) || { c: 0, r: 0, g: 0, b: 0 };
        o.c += c; o.r += r * c; o.g += g * c; o.b += b * c; q.set(key, o);
      }
      cands = [...q.values()].filter(o => o.c > n * 0.02).map(o => ({ rgb: [o.r / o.c, o.g / o.c, o.b / o.c].map(Math.round), c: o.c }));
    }
    cands.sort((a, b) => b.c - a.c);
    const out = [];
    for (const cd of cands) if (!out.some(o => dist2(o.rgb, cd.rgb) < 45 * 45)) out.push(cd);
    return out.slice(0, 8).map(o => o.rgb);
  }
  const dist2 = (a, b) => (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
  function dilate(a, W, H, r) {
    const t = new Uint8Array(a.length), o = new Uint8Array(a.length);
    for (let y = 0; y < H; y++) { const row = y * W; for (let x = 0; x < W; x++) { let m = 0; for (let k = Math.max(0, x - r), e = Math.min(W - 1, x + r); k <= e; k++) if (a[row + k] > m) { m = a[row + k]; if (m === 255) break; } t[row + x] = m; } }
    for (let x = 0; x < W; x++) for (let y = 0; y < H; y++) { let m = 0; for (let k = Math.max(0, y - r), e = Math.min(H - 1, y + r); k <= e; k++) { const v = t[k * W + x]; if (v > m) { m = v; if (m === 255) break; } } o[y * W + x] = m; }
    return o;
  }
  function soften(a, W, H) {   // a one-pixel soft edge
    const o = new Uint8Array(a.length);
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, v = a[i];
      if (x > 0 && x < W - 1 && y > 0 && y < H - 1 && a[i - 1] === v && a[i + 1] === v && a[i - W] === v && a[i + W] === v) { o[i] = v; continue; }
      let s = 0, c = 0; for (let dy = -1; dy <= 1; dy++) { const yy = y + dy; if (yy < 0 || yy >= H) continue; for (let dx = -1; dx <= 1; dx++) { const xx = x + dx; if (xx < 0 || xx >= W) continue; s += a[yy * W + xx]; c++; } }
      o[i] = s / c;
    }
    return o;
  }
  function labelPoint(lab, k) {   // the spot deepest inside a window, for its number badge
    const { W, H } = P, s = Math.max(1, Math.round(Math.max(W, H) / 160)), gw = Math.ceil(W / s), gh = Math.ceil(H / s), d = new Float32Array(gw * gh);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) d[y * gw + x] = lab[Math.min(H - 1, y * s) * W + Math.min(W - 1, x * s)] === k ? (x === 0 || y === 0 || x === gw - 1 || y === gh - 1 ? 1 : 1e9) : 0;   // the picture edge counts as a border
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) { const i = y * gw + x; if (!d[i]) continue; if (x > 0) d[i] = Math.min(d[i], d[i - 1] + 1); if (y > 0) d[i] = Math.min(d[i], d[i - gw] + 1); if (x > 0 && y > 0) d[i] = Math.min(d[i], d[i - gw - 1] + 1.4); if (x < gw - 1 && y > 0) d[i] = Math.min(d[i], d[i - gw + 1] + 1.4); }
    let best = -1, bx = 0.5, by = 0.5;
    for (let y = gh - 1; y >= 0; y--) for (let x = gw - 1; x >= 0; x--) { const i = y * gw + x; if (!d[i]) continue; if (x < gw - 1) d[i] = Math.min(d[i], d[i + 1] + 1); if (y < gh - 1) d[i] = Math.min(d[i], d[i + gw] + 1); if (x < gw - 1 && y < gh - 1) d[i] = Math.min(d[i], d[i + gw + 1] + 1.4); if (x > 0 && y < gh - 1) d[i] = Math.min(d[i], d[i + gw - 1] + 1.4); if (d[i] > best) { best = d[i]; bx = (x + 0.5) / gw; by = (y + 0.5) / gh; } }
    return [bx, by];
  }
  function buildMasks() {
    const { W, H, px } = P, n = W * H, Z = P.zones, lab = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const r = px[i * 4], g = px[i * 4 + 1], b = px[i * 4 + 2]; let best = 0, bd = TOL * TOL;
      for (let z = 0; z < Z.length; z++) { const c = Z[z].color, d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2; if (d < bd) { bd = d; best = z + 1; } }
      lab[i] = best;
    }
    P.labels = lab;
    const union = new Uint8Array(n);
    Z.forEach((z, zi) => {
      let a = new Uint8Array(n), area = 0; for (let i = 0; i < n; i++) if (lab[i] === zi + 1) { a[i] = 255; area++; }
      if (P.grow > 0) a = dilate(a, W, H, P.grow);   // tuck each scene a little under the stone, so no coloured fringe shows
      a = soften(a, W, H);
      const c = cv(W, H), g = ctx(c), id = g.createImageData(W, H), d = id.data;
      for (let i = 0; i < n; i++) { const j = i * 4; d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = a[i]; const u = union[i] + a[i]; union[i] = u > 255 ? 255 : u; }
      g.putImageData(id, 0, 0); z.maskC = c; z.area = area / n; z.pt = area ? labelPoint(lab, zi + 1) : [0.5, 0.5];
    });
    const fc = cv(W, H), fg = ctx(fc); fg.drawImage(P.layoutC, 0, 0); const fd = fg.getImageData(0, 0, W, H);
    for (let i = 0; i < n; i++) fd.data[i * 4 + 3] = Math.min(fd.data[i * 4 + 3], 255 - union[i]);
    fg.putImageData(fd, 0, 0); P.frameC = fc;
    buildNesting();
  }
  /* which windows sit inside which: a window "contains" everything it surrounds (its arch and the windows further in) */
  function buildNesting() {
    const { W, H } = P, n = W * H, lab = P.labels, q = new Int32Array(n);
    P.zones.forEach((z, zi) => {
      const k = zi + 1, out = new Uint8Array(n); let h = 0, t = 0;
      const push = i => { if (!out[i] && lab[i] !== k) { out[i] = 1; q[t++] = i; } };
      let onEdge = 0; for (let x = 0; x < W; x++) { if (lab[x] === k) onEdge++; if (lab[(H - 1) * W + x] === k) onEdge++; } for (let y = 0; y < H; y++) { if (lab[y * W] === k) onEdge++; if (lab[y * W + W - 1] === k) onEdge++; }
      if (onEdge < (W + H) * 0.5) {   // a window that wraps round most of the picture edge (like the outer world) surrounds everything else
        for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
        for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
      }
      while (h < t) { const i = q[h++], x = i % W; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < n - W) push(i + W); }
      const nest = new Uint8Array(n); let stone = 0;
      for (let i = 0; i < n; i++) if (!out[i] && lab[i] !== k) { nest[i] = 1; if (!lab[i]) stone++; }
      z.nest = nest; z.hasArch = stone > n * 0.002;
      let al = new Uint8Array(n); for (let i = 0; i < n; i++) if (lab[i] === k) al[i] = 255;
      al = dilate(al, W, H, Math.max(1, P.grow + 1)); for (let i = 0; i < n; i++) if (nest[i]) al[i] = 255;
      const ac = cv(W, H), ag = ctx(ac), aid = ag.createImageData(W, H);
      for (let i = 0; i < n; i++) { const j = i * 4; aid.data[j] = aid.data[j + 1] = aid.data[j + 2] = 255; aid.data[j + 3] = al[i]; }
      ag.putImageData(aid, 0, 0); z.allowC = ac;   // where this window's pictures may ever show
      z.first = lab.indexOf(k);
    });
    P.zones.forEach(z => { z.depth = P.zones.filter(o => o !== z && z.first >= 0 && o.nest[z.first]).length; });
    P.zones.forEach(z => {   // the stone arch this window owns, for tinting it with this world's colour
      const inner = new Uint8Array(n);
      for (const o of P.zones) if (o !== z && o.first >= 0 && z.nest[o.first]) { const k = P.zones.indexOf(o) + 1; for (let i = 0; i < n; i++) if (lab[i] === k || o.nest[i]) inner[i] = 1; }
      let a = new Uint8Array(n), cnt = 0; for (let i = 0; i < n; i++) if (z.nest[i] && !inner[i] && !lab[i]) { a[i] = 255; cnt++; }
      if (!cnt) { z.archC = null; return; }
      a = soften(a, W, H);
      const c = cv(W, H), g = ctx(c), id = g.createImageData(W, H);
      for (let i = 0; i < n; i++) { const j = i * 4; id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = a[i]; }
      g.putImageData(id, 0, 0); z.archC = c;
    });
  }
  const ordered = () => P.zones.slice().sort((a, b) => a.depth - b.depth);
  const outerOf = z => P.zones.filter(o => o !== z && z.first >= 0 && o.nest[z.first]);
  const innerOf = z => P.zones.filter(o => o !== z && o.first >= 0 && z.nest[o.first]);
  const metaOf = (z, v) => (z.meta || {})[v] || { kind: 'old' };   // 'ctx' painted in place, 'own' your own picture, 'old' made by the first version of Portals
  function staleOf(z) {   // made before a window around it changed
    const v = sceneOf(z), m = v && metaOf(z, v); if (!m || m.kind === 'own') return null;
    if (m.kind === 'old') return { old: true, name: 'an earlier version of Portals' };
    return outerOf(z).find(o => (m.on || {})[o.id] !== (sceneOf(o) || null)) || null;
  }
  const labelAt = (u, v) => { if (!P.labels) return null; const x = Math.min(P.W - 1, Math.max(0, Math.floor(u * P.W))), y = Math.min(P.H - 1, Math.max(0, Math.floor(v * P.H))), k = P.labels[y * P.W + x]; return k ? P.zones[k - 1] : null; };

  /* ---------------- 2. Putting it together ---------------- */
  const LOADING = new Map();
  function load(map, key, fn) { if (!LOADING.has(key)) LOADING.set(key, fn().then(v => { map.set(key.slice(2), v); return v; }).catch(() => null).finally(() => LOADING.delete(key))); return LOADING.get(key); }
  async function loadAll() {   // wait until every window picture and its mask is ready to use
    const jobs = [];
    for (const z of P.zones) {
      const v = sceneOf(z); if (!v) continue;
      if (!EL.get(v)) jobs.push(load(EL, 'p:' + v, async () => createImageBitmap(await getBlob(img(v)))));
      if (metaOf(z, v).over && !MO.get(v)) jobs.push(load(MO, 'o:' + v, async () => { const rec = await DB.run('tilesets', 'readonly', st => st.get('ptover:' + v)); return rec && rec.blob ? fixOver(await createImageBitmap(rec.blob), v) : null; }));
      jobs.push(loadEdit('b', v), loadEdit('o', v));
      if (metaOf(z, v).kind === 'ctx' && !MK.get(v)) jobs.push(load(MK, 'm:' + v, async () => { const rec = await DB.run('tilesets', 'readonly', st => st.get('ptmask:' + v)); return rec && rec.blob ? createImageBitmap(rec.blob) : null; }));
    }
    await Promise.all(jobs);
  }
  const EL = new Map();   // picture id -> decoded picture
  function picEl(id, onload) {
    const r = id && img(id); if (!r) return null;
    if (EL.has(id)) return EL.get(id) || null;
    EL.set(id, null);
    (async () => { try { EL.set(id, await createImageBitmap(await getBlob(r))); } catch { EL.delete(id); } (onload || paint)(); })();
    return null;
  }
  const sceneOf = z => (z.vi >= 0 && z.versions[z.vi]) || null;
  function drawCover(g, el, w, h, t) {
    const ew = el.width, eh = el.height, k = Math.max(w / ew, h / eh) * (t.s || 1), dw = ew * k, dh = eh * k;
    g.drawImage(el, (w - dw) / 2 + (t.x || 0) * w, (h - dh) / 2 + (t.y || 0) * h, dw, dh);
  }
  const MO = new Map();   // picture id -> its cut-out of things in front of the windows further in
  function overEl(id) {
    if (MO.has(id)) return MO.get(id) || null;
    MO.set(id, null);
    (async () => { try { const rec = await DB.run('tilesets', 'readonly', st => st.get('ptover:' + id)); if (rec && rec.blob) MO.set(id, fixOver(await createImageBitmap(rec.blob), id)); } catch {} paint(); })();
    return null;
  }
  const MK = new Map();   // picture id -> its window mask
  function maskEl(id) {
    if (MK.has(id)) return MK.get(id) || null;
    MK.set(id, null);
    (async () => { try { const rec = await DB.run('tilesets', 'readonly', st => st.get('ptmask:' + id)); if (rec && rec.blob) MK.set(id, await createImageBitmap(rec.blob)); else MK.delete(id); } catch { MK.delete(id); } paint(); })();
    return null;
  }

  /* ---------------- cleaning up the masks (applied when a picture is shown, so existing work improves too) ---------------- */
  const zoneOfPic = v => P.zones.find(z => z.versions.includes(v)) || null;
  /* Things in front (a car, a person): solid inside with a soft edge, never see-through. And only things that stand in this
     window's own world are kept: loose pieces elsewhere (for example this world's copy of an arch further in) are dropped. */
  function fixOver(bm, v) {
    const { W, H } = P; if (!W || !H) return bm;
    const c = cv(W, H), g = ctx(c); g.imageSmoothingQuality = 'high'; g.drawImage(bm, 0, 0, W, H); bm.close && bm.close();
    const id = g.getImageData(0, 0, W, H), d = id.data, n = W * H, a = new Uint8Array(n);
    for (let i = 0; i < n; i++) { const x = d[i * 4 + 3], t = Math.min(1, Math.max(0, (x - 50) / 100)); a[i] = Math.round(255 * t * t * (3 - 2 * t)); }
    const z = zoneOfPic(v);
    if (z && P.labels) {
      const inner = innerRegion(z), comp = new Int32Array(n), q = new Int32Array(n); let next = 0;
      for (let s0 = 0; s0 < n; s0++) {
        if (a[s0] < 20 || comp[s0]) continue;
        next++; let h = 0, t = 0, anchored = false; comp[s0] = next; q[t++] = s0;
        while (h < t) {
          const i = q[h++], x = i % W; if (!inner[i]) anchored = true;
          if (x > 0 && !comp[i - 1] && a[i - 1] >= 20) { comp[i - 1] = next; q[t++] = i - 1; }
          if (x < W - 1 && !comp[i + 1] && a[i + 1] >= 20) { comp[i + 1] = next; q[t++] = i + 1; }
          if (i >= W && !comp[i - W] && a[i - W] >= 20) { comp[i - W] = next; q[t++] = i - W; }
          if (i < n - W && !comp[i + W] && a[i + W] >= 20) { comp[i + W] = next; q[t++] = i + W; }
        }
        if (!anchored) for (let k = 0; k < t; k++) a[q[k]] = 0;
      }
      fillHoles(a, W, H);
    }
    for (let i = 0; i < n; i++) { const j = i * 4; d[j] = d[j + 1] = d[j + 2] = 255; d[j + 3] = a[i]; }
    g.putImageData(id, 0, 0); return c;
  }
  /* Gaps inside a thing in front (a car's bonnet, the people in it) are filled, so nothing behind shows through it.
     Only small, fully enclosed gaps: never a whole window, never the open space around an arch. */
  function fillHoles(a, W, H) {
    const n = W * H, out = new Uint8Array(n), q = new Int32Array(n), L = P.labels, Z = P.zones.length, area = new Int32Array(Z + 1);
    for (let i = 0; i < n; i++) area[L[i]]++;
    let h = 0, t = 0; const push = i => { if (!out[i] && a[i] < 128) { out[i] = 1; q[t++] = i; } };
    for (let x = 0; x < W; x++) { push(x); push((H - 1) * W + x); }
    for (let y = 0; y < H; y++) { push(y * W); push(y * W + W - 1); }
    while (h < t) { const i = q[h++], x = i % W; if (x > 0) push(i - 1); if (x < W - 1) push(i + 1); if (i >= W) push(i - W); if (i < n - W) push(i + W); }
    const seen = new Uint8Array(n), cnt = new Int32Array(Z + 1);
    for (let s0 = 0; s0 < n; s0++) {
      if (a[s0] >= 128 || out[s0] || seen[s0]) continue;
      let hh = 0, tt = 0; seen[s0] = 1; q[tt++] = s0; cnt.fill(0);
      while (hh < tt) {
        const i = q[hh++], x = i % W; cnt[L[i]]++;
        if (x > 0 && !seen[i - 1] && !out[i - 1] && a[i - 1] < 128) { seen[i - 1] = 1; q[tt++] = i - 1; }
        if (x < W - 1 && !seen[i + 1] && !out[i + 1] && a[i + 1] < 128) { seen[i + 1] = 1; q[tt++] = i + 1; }
        if (i >= W && !seen[i - W] && !out[i - W] && a[i - W] < 128) { seen[i - W] = 1; q[tt++] = i - W; }
        if (i < n - W && !seen[i + W] && !out[i + W] && a[i + W] < 128) { seen[i + W] = 1; q[tt++] = i + W; }
      }
      let ok = tt < n * 0.02;
      for (let k = 1; k <= Z && ok; k++) if (area[k] && cnt[k] > area[k] * 0.5) ok = false;
      if (ok) for (let k = 0; k < tt; k++) a[q[k]] = 255;
    }
  }
  /* Leftover placeholder colour (a red or green line along an arch) in a world's picture, next to the windows further in:
     taken out, so the stone shows there instead. */
  const CLEAN = new Map();
  function cleanMaskOf(z, v, el) {
    const mk = maskEl(v); if (!mk || !el) return mk;
    if (CLEAN.has(v)) return CLEAN.get(v);
    const inner = innerOf(z); if (!inner.length || !P.labels) { CLEAN.set(v, mk); return mk; }
    const { W, H } = P, n = W * H, mc = cv(W, H), mg = ctx(mc); mg.drawImage(mk, 0, 0, W, H);
    const pc = cv(W, H), pg = ctx(pc); pg.drawImage(el, 0, 0, W, H);
    const md = mg.getImageData(0, 0, W, H), pp = pg.getImageData(0, 0, W, H).data, R = Math.max(5, Math.round(Math.max(W, H) / 200));
    const hsv = (r, g2, b) => { const mx = Math.max(r, g2, b), mn = Math.min(r, g2, b), dd = mx - mn; let h = 0;
      if (dd) h = mx === r ? ((g2 - b) / dd) % 6 : mx === g2 ? (b - r) / dd + 2 : (r - g2) / dd + 4; return [(h * 60 + 360) % 360, mx ? dd / mx : 0, mx]; };
    let changed = 0;
    for (const o of inner) {
      const k = P.zones.indexOf(o) + 1; let near = new Uint8Array(n); const hist = new Map();
      for (let i = 0; i < n; i++) if (P.labels[i] === k) { near[i] = 255; const j = i * 4, key = (pp[j] >> 4) << 8 | (pp[j + 1] >> 4) << 4 | (pp[j + 2] >> 4), hh = hist.get(key) || [0, 0, 0, 0]; hh[0]++; hh[1] += pp[j]; hh[2] += pp[j + 1]; hh[3] += pp[j + 2]; hist.set(key, hh); }
      let b = [0, 0, 0, 0]; for (const hh of hist.values()) if (hh[0] > b[0]) b = hh;
      const est = b[0] ? [b[1] / b[0], b[2] / b[0], b[3] / b[0]] : o.color, ph = hsv(...o.color);
      let x0 = W, y0 = H, x1 = -1, y1 = -1;   // only the area round this window, so it stays quick
      for (let i = 0; i < n; i++) if (near[i]) { const x = i % W, y = (i / W) | 0; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      if (x1 < 0) continue;
      x0 = Math.max(0, x0 - R); y0 = Math.max(0, y0 - R); x1 = Math.min(W - 1, x1 + R); y1 = Math.min(H - 1, y1 + R);
      const cw = x1 - x0 + 1, ch = y1 - y0 + 1; let crop = new Uint8Array(cw * ch);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) crop[y * cw + x] = near[(y + y0) * W + x + x0];
      crop = dilate(crop, cw, ch, R);
      for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
        const i = (y + y0) * W + x + x0;
        if (!crop[y * cw + x] || md.data[i * 4 + 3] === 0) continue;
        const j = i * 4, r = pp[j], g2 = pp[j + 1], bb = pp[j + 2];
        const d1 = (r - o.color[0]) ** 2 + (g2 - o.color[1]) ** 2 + (bb - o.color[2]) ** 2, d2 = (r - est[0]) ** 2 + (g2 - est[1]) ** 2 + (bb - est[2]) ** 2;
        const [hu, sa, va] = hsv(r, g2, bb), dh = Math.min(Math.abs(hu - ph[0]), 360 - Math.abs(hu - ph[0]));
        if (d1 < 80 * 80 || d2 < 50 * 50 || (ph[1] > 0.5 && sa > 0.55 && va > 60 && dh < 24)) { md.data[j + 3] = 0; changed++; }
      }
    }
    if (!changed) { CLEAN.set(v, mk); return mk; }
    mg.putImageData(md, 0, 0); CLEAN.set(v, mc); return mc;
  }

  /* ---------------- mask brush: wipe out or paint back parts of a window ---------------- */
  // 'b:<picture id>' = that window's own mask, 'o:<picture id>' = its things-in-front cut-out. Your edited copy, or false.
  const EM = new Map(), EMP = new Map();
  function loadEdit(kind, id) {
    const key = kind + ':' + id;
    if (EM.has(key)) return Promise.resolve(EM.get(key) || null);
    if (!EMP.has(key)) EMP.set(key, (async () => {
      let c = false;
      try {
        const rec = await DB.run('tilesets', 'readonly', st => st.get('pted' + kind + ':' + id));
        if (rec && rec.blob) { const bm = await createImageBitmap(rec.blob); c = cv(P.W, P.H); ctx(c).drawImage(bm, 0, 0, P.W, P.H); bm.close && bm.close(); }
      } catch {}
      if (!EM.has(key)) EM.set(key, c); EMP.delete(key); return EM.get(key) || null;
    })());
    return EMP.get(key);
  }
  function editedEl(kind, id) {
    const key = kind + ':' + id;
    if (EM.has(key)) return EM.get(key) || null;
    loadEdit(kind, id).then(c => { if (c) paint(); });
    return null;
  }
  const baseMaskOf = (z, v, el) => editedEl('b', v) || (metaOf(z, v).kind === 'ctx' ? cleanMaskOf(z, v, el) : z.maskC);
  const overMaskOf = v => editedEl('o', v) || overEl(v);

  // the brush itself
  async function startBrush(z) {
    const v = sceneOf(z); if (!v) return;
    try { await loadAll(); } catch {}
    P.brush = { zid: z.id, v, layer: P.brush && P.brush.zid === z.id ? P.brush.layer : 'b', mode: 'erase', size: P.brush ? P.brush.size : Math.round(Math.max(P.W, P.H) / 40), show: true, undo: [] };
    if (P.brush.layer === 'o' && !metaOf(z, v).over) P.brush.layer = 'b';
    P.view = 'result'; renderPanel(); renderStage();
  }
  function workingMask() {   // the canvas being painted: your edited copy, made from the current mask the first time
    const B = P.brush, z = zoneOf(B.zid); if (!z) return null;
    const key = B.layer + ':' + B.v; let c = EM.get(key);
    if (c) return c;
    const src = B.layer === 'b' ? (metaOf(z, B.v).kind === 'ctx' ? cleanMaskOf(z, B.v, picEl(B.v)) : z.maskC) : overEl(B.v);
    if (!src) { toast('The mask is still loading. Try again in a moment.'); return null; }
    c = cv(P.W, P.H); ctx(c).drawImage(src, 0, 0, P.W, P.H); EM.set(key, c); return c;
  }
  function dab(c, x, y) {
    const B = P.brush, r = B.size / 2, g = ctx(c), gr = g.createRadialGradient(x, y, r * 0.55, x, y, r);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.save(); g.globalCompositeOperation = B.mode === 'erase' ? 'destination-out' : 'source-over'; g.fillStyle = gr;
    g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); g.restore();
  }
  function snapshot(c) {   // a copy for Undo, saved small in the background
    const B = P.brush, copy = cv(c.width, c.height); copy.getContext('2d').drawImage(c, 0, 0);
    const item = { layer: B.layer, blob: null, ready: new Promise(res => copy.toBlob(b => { item.blob = b; res(); }, 'image/png')) };
    B.undo.push(item); if (B.undo.length > 20) B.undo.shift();
  }
  let brushSaveT = 0;
  function saveBrush() {
    clearTimeout(brushSaveT);
    const B = P.brush; if (!B) return;
    const key = B.layer + ':' + B.v, id = 'pted' + B.layer + ':' + B.v;
    brushSaveT = setTimeout(() => { const c = EM.get(key); if (c) c.toBlob(b => { if (b) DB.put('tilesets', { id, kind: 'ptedit', blob: b }); }, 'image/png'); }, 400);
  }
  async function undoBrush() {
    const B = P.brush; if (!B || !B.undo.length) { toast('Nothing to undo.'); return; }
    const it = B.undo.pop(); await it.ready; if (!it.blob) return;
    const bm = await createImageBitmap(it.blob), key = it.layer + ':' + B.v, c = EM.get(key) || cv(P.W, P.H), g = ctx(c);
    g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, c.width, c.height); g.drawImage(bm, 0, 0); bm.close && bm.close(); EM.set(key, c);
    const was = B.layer; B.layer = it.layer; saveBrush(); B.layer = was; paint();
  }
  async function resetBrush() {
    const B = P.brush; if (!B) return;
    if (!confirm(`Put the ${B.layer === 'b' ? 'window' : 'things-in-front'} mask back the way Portals made it? Your brush changes on it are removed.`)) return;
    EM.set(B.layer + ':' + B.v, false); await DB.del('tilesets', 'pted' + B.layer + ':' + B.v); B.undo = B.undo.filter(u => u.layer !== B.layer);
    paint(); toast('Mask reset.');
  }
  let brushAt = null;   // where the brush is on the picture, for the outline
  let tmpC = null, tintC = null;
  const TINT = new Map();   // picture id -> the overall colour of that world's light
  function tintOf(z, v, el) {
    if (TINT.has(v)) return TINT.get(v);
    const w = 160, h = Math.max(1, Math.round(160 * P.H / P.W)), c = cv(w, h), g = ctx(c);
    g.drawImage(el, 0, 0, w, h); const d = g.getImageData(0, 0, w, h).data;
    const m = cv(w, h), mg = ctx(m); mg.drawImage(z.maskC, 0, 0, w, h); const md = mg.getImageData(0, 0, w, h).data;
    let r = 0, gg = 0, b = 0, n = 0;
    for (let i = 0; i < w * h; i++) if (md[i * 4 + 3] > 200) { r += d[i * 4]; gg += d[i * 4 + 1]; b += d[i * 4 + 2]; n++; }
    if (!n) { TINT.set(v, null); return null; }
    r /= n; gg /= n; b /= n;
    const l = 0.3 * r + 0.59 * gg + 0.11 * b || 1, sat = 1.7;   // keep the colour, set it to a mid tone and make it a little richer
    const col = [r, gg, b].map(x => Math.max(0, Math.min(255, (l + (x - l) * sat) * (140 / l))));
    TINT.set(v, col); return col;
  }
  function compose(w, h, needAll, only, noOver) {   // the layout, then every window from the outside in, each with the arch it owns
    const out = cv(w, h), g = out.getContext('2d'); g.imageSmoothingQuality = 'high';
    g.drawImage(P.layoutC, 0, 0, w, h);
    if (!tmpC || tmpC.width !== w || tmpC.height !== h) tmpC = cv(w, h);
    const tg = tmpC.getContext('2d'); tg.imageSmoothingQuality = 'high';
    for (const z of ordered()) {
      if (only && !only.includes(z)) continue;
      const v = sceneOf(z); if (!v) continue;
      const m = metaOf(z, v), el = picEl(v), mk = baseMaskOf(z, v, el);
      if (!el || !mk) { if (needAll) throw new Error('A window picture is still loading. Try again in a moment.'); continue; }
      tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, w, h);
      if (m.kind === 'ctx') tg.drawImage(el, 0, 0, w, h); else drawCover(tg, el, w, h, z.t);
      tg.globalCompositeOperation = 'destination-in'; tg.drawImage(mk, 0, 0, w, h);
      g.drawImage(tmpC, 0, 0);
      const amt = z.tint ?? 0.35;
      if (m.kind === 'ctx' && amt > 0 && z.archC) {   // the arch takes on this world's colour
        const col = tintOf(z, v, el);
        if (col) {
          if (!tintC || tintC.width !== w || tintC.height !== h) tintC = cv(w, h);
          const t2 = tintC.getContext('2d'); t2.globalCompositeOperation = 'source-over'; t2.clearRect(0, 0, w, h);
          t2.fillStyle = `rgb(${col.map(Math.round).join(',')})`; t2.fillRect(0, 0, w, h);
          t2.globalCompositeOperation = 'destination-in'; t2.drawImage(z.archC, 0, 0, w, h);
          const mo = m.over ? overMaskOf(v) : null; if (mo) { t2.globalCompositeOperation = 'destination-out'; t2.drawImage(mo, 0, 0, w, h); }
          g.save(); g.globalCompositeOperation = 'soft-light'; g.globalAlpha = Math.min(1, amt); g.drawImage(tintC, 0, 0);
          g.globalCompositeOperation = 'color'; g.globalAlpha = amt * 0.25; g.drawImage(tintC, 0, 0); g.restore();
        }
      }
    }
    if (!noOver) for (const z of ordered().reverse()) {   // things in front go on top last: the outermost world is nearest the camera
      if (only && !only.includes(z)) continue;
      const v = sceneOf(z); if (!v || !metaOf(z, v).over) continue;
      const el = picEl(v), mo = overMaskOf(v);
      if (!el || !mo) { if (needAll) throw new Error('A window picture is still loading. Try again in a moment.'); continue; }
      tg.globalCompositeOperation = 'source-over'; tg.clearRect(0, 0, w, h); tg.drawImage(el, 0, 0, w, h);
      tg.globalCompositeOperation = 'destination-in'; tg.drawImage(mo, 0, 0, w, h); if (z.allowC) tg.drawImage(z.allowC, 0, 0, w, h); g.drawImage(tmpC, 0, 0);
    }
    return out;
  }

  /* ---------------- UI shell ---------------- */
  const ICON = '<path d="M7 21V8.5a5 5 0 0 1 10 0V21"/>';
  const icoS = (d, n) => `<svg viewBox="0 0 24 24" width="${n || 20}" height="${n || 20}" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const tab = document.createElement('button');
  tab.className = 'tab'; tab.dataset.view = 'portals'; tab.title = 'A different place and time of day in every window';
  tab.innerHTML = icoS(ICON) + '<span>Portals</span><i class="rail-beta">new</i>';
  const after = document.querySelector('.tab[data-view="angles"]') || document.querySelector('.tab[data-view="sections"]') || document.querySelector('.tab[data-view="upscale"]');
  if (after) after.parentNode.insertBefore(tab, after.nextSibling); else (document.querySelector('nav.tabs') || document.body).appendChild(tab);
  tab.addEventListener('click', () => setView('portals'));

  const css = document.createElement('style');
  css.textContent = `
#ptView{grid-template-rows:auto 1fr!important}
.pt-stage{position:relative;display:flex;min-height:0;overflow:hidden;background:#000;padding:20px;box-sizing:border-box}
.pt-wrap{position:relative;margin:auto;flex:none}
.pt-wrap canvas{display:block;touch-action:none;cursor:pointer;border-radius:4px}
.pt-wrap.picking canvas{cursor:crosshair}
.pt-wrap.moving canvas{cursor:grab}
.pt-chip{position:absolute;transform:translate(-50%,-50%);display:flex;align-items:center;gap:6px;background:rgba(10,10,10,.78);color:#fff;border:1px solid rgba(255,255,255,.25);border-radius:999px;padding:3px 10px 3px 4px;font:inherit;font-size:12px;cursor:pointer;white-space:nowrap;max-width:200px;overflow:hidden;text-overflow:ellipsis;-webkit-backdrop-filter:blur(8px);backdrop-filter:blur(8px)}
.pt-chip i{font-style:normal;width:18px;height:18px;border-radius:50%;display:grid;place-items:center;font-size:11px;font-weight:700;color:#000;flex:none;box-shadow:0 0 0 1px rgba(255,255,255,.6)}
.pt-chip.on{background:#fff;color:#000;border-color:#fff}
.pt-chip .res-spin{width:10px;height:10px}
.pt-chips.off{display:none}
.pt-empty{margin:auto;color:var(--muted);text-align:center;max-width:460px;line-height:1.6;padding:20px}
.pt-empty b{color:#fff;font-size:16px;display:block;margin-bottom:6px}
.pt-busy{position:absolute;inset:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;background:rgba(0,0,0,.6);color:#fff;font-size:13px;z-index:3}
.pt-step{border:1px solid #1d1d1d;border-radius:14px;padding:12px;margin-bottom:12px;background:#0b0b0b}
.pt-step.off{opacity:.45;pointer-events:none}
.pt-step>h4{display:flex;align-items:center;gap:8px;margin:0 0 10px;font-size:13px;font-weight:600}
.pt-step>h4 i{font-style:normal;width:20px;height:20px;border-radius:50%;background:#fff;color:#000;display:grid;place-items:center;font-size:11px;font-weight:700;flex:none}
.pt-step>h4 small{margin-left:auto;color:var(--faint);font-weight:400;font-size:11.5px}
.pt-found{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:8px 0 4px;font-size:12px;color:var(--muted)}
.pt-found i{width:14px;height:14px;border-radius:4px;box-shadow:0 0 0 1px rgba(255,255,255,.25)}
.pz{border:1px solid #1f1f1f;border-radius:12px;margin-bottom:8px;background:#0e0e0e;overflow:hidden}
.pz.on{border-color:#5a5a5a}
.pz-head{display:flex;align-items:center;gap:9px;width:100%;background:none;border:0;color:var(--text);font:inherit;text-align:left;padding:9px 10px;cursor:pointer}
.pz-head .pz-sw{width:22px;height:22px;border-radius:7px;flex:none;display:grid;place-items:center;color:#000;font-size:11px;font-weight:700;font-style:normal;box-shadow:0 0 0 1px rgba(255,255,255,.25)}
.pz-head img{width:22px;height:22px;border-radius:7px;object-fit:cover;flex:none}
.pz-head b{font-size:12.5px;font-weight:600;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pz-head span{color:var(--faint);font-size:11px;white-space:nowrap}
.pz-body{border-top:1px solid #1a1a1a;padding:10px}
.pz-body .field{margin-bottom:12px}
.pz-chips{display:flex;flex-wrap:wrap;gap:5px}
.pz-chips button{background:none;border:1px solid #262626;color:#bbb;border-radius:999px;padding:4px 10px;font:inherit;font-size:11.5px;cursor:pointer}
.pz-chips button:hover{border-color:#555;color:#fff}
.pz-chips button.on{background:#fff;color:#000;border-color:#fff}
.pz-ver{display:flex;align-items:center;gap:6px;margin:0 0 8px;font-size:12px;color:var(--muted)}
.pz-ver button{background:#161616;border:1px solid #262626;color:#fff;border-radius:8px;width:26px;height:24px;cursor:pointer}
.pz-ver button:disabled{opacity:.3;cursor:default}
.pz-refs.over{outline:1px dashed #fff;outline-offset:4px;border-radius:8px}
.pz-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.pt-pick.on{background:#fff;color:#000;border-color:#fff}
.pt-brush{border:1px solid #333;border-radius:10px;padding:10px;margin:0 0 10px;background:#111}
.pt-brush-h{display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;font-size:12.5px}
.pt-brush .seg button.on{background:#fff!important;color:#000!important}
.pt-brush .slider output{min-width:34px;text-align:right;white-space:nowrap}
.pt-wrap.brushing canvas{cursor:none}`;
  document.head.appendChild(css);

  const panel = document.createElement('aside');
  panel.className = 'brief'; panel.id = 'ptPanel'; panel.hidden = true; panel.setAttribute('aria-label', 'Portals settings');
  const view = document.createElement('section');
  view.className = 'upview'; view.id = 'ptView'; view.hidden = true; view.setAttribute('aria-label', 'Portals');
  view.innerHTML = `<div class="up-bar">
      <div class="seg" id="ptShow" role="group" aria-label="Show"><button type="button" data-pv="result">Windows</button><button type="button" data-pv="layout">Layout</button><button type="button" data-pv="final">Final</button></div>
      <label class="check" style="margin:0"><input type="checkbox" id="ptNums" checked> Labels</label>
      <span class="up-hint" id="ptHint"></span>
      <span class="up-info" id="ptInfo"></span>
      <button class="btn small" id="ptDl" hidden>Download</button>
    </div>
    <div class="pt-stage" id="ptStage"></div>`;
  const app = document.querySelector('main.app');
  app.appendChild(panel); app.appendChild(view);
  const fileIn = document.createElement('input'); fileIn.type = 'file'; fileIn.accept = 'image/*'; fileIn.hidden = true; document.body.appendChild(fileIn);
  let fileFor = { kind: 'layout', zone: null };
  const edIn = document.createElement('input'); edIn.type = 'file'; edIn.accept = '.psd,image/*'; edIn.hidden = true; document.body.appendChild(edIn);
  edIn.onchange = async () => {   // your amended picture back from Photoshop
    const f = edIn.files[0]; if (!f) return;
    try {
      let blob = f, name = f.name;
      if (/\.psd$/i.test(f.name) || f.type === 'image/vnd.adobe.photoshop') {
        toast('Reading your Photoshop file…');
        const ag = await loadAgPsd(), psd = ag.readPsd(await f.arrayBuffer(), { skipLayerImageData: true, skipThumbnail: true });
        if (!psd.canvas) throw new Error('This PSD has no flattened copy inside. In Photoshop, turn on Preferences › File Handling › Maximize PSD Compatibility and save again, or export a PNG.');
        blob = await new Promise(res => psd.canvas.toBlob(res, 'image/png')); name = f.name.replace(/\.psd$/i, '') + '-edited.png';
      }
      const [rec] = await importFiles([new File([blob], name, { type: blob.type || 'image/png' })], false);
      if (!rec) return;
      P.editedId = rec.id; save(); renderPanel(); toast('Got it. “Make it one photograph” now uses your edited version.');
    } catch (e) { toast('Couldn’t read that file: ' + friendly(e)); }
  };

  const baseSetView = setView;
  setView = function (v) {
    baseSetView(v);
    panel.hidden = view.hidden = v !== 'portals';
    tab.classList.toggle('on', v === 'portals');
    if (v === 'portals') {
      if (P.layoutId && !img(P.layoutId)) P.layoutId = null;
      if (P.layoutId && !P.layoutC && !P.busyMsg) setLayout(P.layoutId); else { renderPanel(); renderStage(); }
    }
  };

  /* ---------------- saving the work on each layout ---------------- */
  let saveT = 0;
  function save() {
    clearTimeout(saveT);
    saveT = setTimeout(() => {
      if (!P.layoutId) return;
      DB.put('tilesets', { id: 'portals:' + P.layoutId, kind: 'portals', layoutId: P.layoutId, style: P.style, notes: P.notes, grow: P.grow, blendId: P.blendId, editedId: P.editedId, sel: P.sel,
        zones: P.zones.map(z => ({ id: z.id, color: z.color, name: z.name, place: z.place, time: z.time, cam: z.cam, refs: z.refs, versions: z.versions, vi: z.vi, t: z.t, meta: z.meta || {}, overlap: z.overlap, tint: z.tint, front: z.front })) });
    }, 300);
  }
  async function setLayout(id) {
    const r = img(id); if (!r) return;
    if (S.view !== 'portals') setView('portals');
    Object.assign(P, { layoutId: id, layoutC: null, labels: null, zones: [], sel: null, blendId: null, editedId: null, picking: false, view: 'result', busyMsg: 'Finding the windows…' });
    store.set('pandora.portals.src', id); renderPanel(); renderStage();
    await new Promise(res => setTimeout(res, 40));
    try {
      if (typeof ensureDims === 'function') await ensureDims(r);
      await loadLayout(r);
      const saved = await DB.run('tilesets', 'readonly', st => st.get('portals:' + id));
      if (saved && saved.zones && saved.zones.length) {
        Object.assign(P, { style: saved.style || '', notes: saved.notes || '', grow: saved.grow ?? 2, blendId: saved.blendId && img(saved.blendId) ? saved.blendId : null, editedId: saved.editedId && img(saved.editedId) ? saved.editedId : null });
        P.zones = saved.zones.map(z => { const v = (z.versions || []).filter(x => img(x)); return { ...z, refs: (z.refs || []).filter(x => img(x)), versions: v, vi: Math.min(v.length - 1, z.vi ?? v.length - 1), t: z.t || { x: 0, y: 0, s: 1 }, meta: z.meta || {} }; });
        P.sel = saved.sel && zoneOf(saved.sel) ? saved.sel : P.zones[0].id;
      } else {
        P.zones = findColours().map(newZone); P.grow = 2; P.blendId = null; P.notes = '';
        P.sel = P.zones[0] ? P.zones[0].id : null;
      }
      buildMasks();
      if (!P.zones.length) toast('No flat colours found. Paint each window one flat colour, or use “Pick a colour I missed”.');
      else toast(`Found ${P.zones.length} window${P.zones.length > 1 ? 's' : ''}. Give each one a place and a time of day.`);
      save();
    } catch (e) { toast('Portals couldn’t read that picture: ' + friendly(e)); P.layoutId = null; P.layoutC = null; }
    P.busyMsg = null; renderPanel(); renderStage();
  }
  async function rebuild(msg) {
    P.busyMsg = msg || 'Updating the windows…'; renderStage();
    await new Promise(res => setTimeout(res, 30));
    try { buildMasks(); } catch (e) { toast(friendly(e)); }
    P.busyMsg = null; renderPanel(); renderStage(); save();
  }

  /* ---------------- 3. Making a window ---------------- */
  function promptFor(z, nRefs) {
    const T = timeOf(z), style = (P.style || '').trim(), cn = colourName(z.color).toLowerCase();
    const inner = innerOf(z), innerNames = inner.map(o => colourName(o.color).toLowerCase()), outer = outerOf(z).length;
    return `Image 1 is a picture being built in steps: stone arches, with some areas still painted as flat colour placeholders. `
      + `Replace the flat ${cn} area with a real photograph of ${z.place.trim()}, ${T[2]}. Use exactly the same camera as the arches in image 1: the same eye height, the same horizon line and the same vanishing point, looking straight on at the arches, so the ground meets the base of the arches at the same level as everywhere else. `
      + (z.hasArch ? `The stone arch standing inside the ${cn} area is part of this scene. Keep its shape, size and position exactly the same, but make it a real structure standing in this place, relit by this scene: the colour and direction of this scene's light and sky must be clearly visible on the stone (for example warm orange at sunset, cool blue at blue hour, green bounce light from trees, turquoise from water), casting realistic shadows onto the ground of this scene, with contact shadows where it meets the ground. People, vehicles, animals, plants, dust or water from this scene can pass in front of the arch where it makes sense. The stone and this scene must look like one photograph. ` : '')
      + (outer ? `The ground must flow naturally from the ground already outside this opening into this scene, with no hard seam or line on the floor at the threshold: sand, stone, water, paths, rugs, shadows and light can cross the threshold and appear on both sides. ` : `The ground of this scene runs right up to and under the arch and continues through its opening, ready for the next world to flow on from it. `)
      + (inner.length ? `Do not relight or change any arch further in, inside the ${innerNames.join(' and ')} area${inner.length > 1 ? 's' : ''}: those belong to other places. ` : '')
      + (inner.length && z.overlap !== false && settings.falKey ? `Layer this world in front of the next one: ${(z.front || '').trim() ? 'place ' + z.front.trim() : 'place at least one thing from this scene (for example a person, an animal, a vehicle, market goods, a lantern or a plant)'} in the foreground, close to the camera, standing in front of the inner arch and partly overlapping it and the ${innerNames.join(' and ')} area, drawn complete and not cut off. ` : '')
      + (inner.length ? `The ${innerNames.join(' and ')} area${inner.length > 1 ? 's are' : ' is'} further away, behind this scene, and another place goes there later. So the ground, water, sky and landscape of this scene stop at the arch and never continue into ${inner.length > 1 ? 'them' : 'it'}: keep ${inner.length > 1 ? 'them' : 'it'} the same flat ${innerNames.join(' and ')} colour as in image 1. Only a separate thing standing in front of the arch, such as a vehicle, a person or an animal, may overlap ${inner.length > 1 ? 'them' : 'it'}, drawn whole and not cut off. ` : '')
      + (outer ? `Keep everything outside the ${cn} area exactly as it is in image 1. Do not continue anything from the scene in front into this one, and do not add vehicles, people or animals from it. ` : '')
      + (style ? `Overall look for the whole campaign: ${style}. ` : '')
      + (nRefs ? `Image${nRefs > 1 ? 's' : ''} 2${nRefs > 1 ? ' to ' + (nRefs + 1) : ''} ${nRefs > 1 ? 'are reference photos' : 'is a reference photo'} of the real place for this ${cn} area. Recreate that place faithfully, as seen from this camera: its buildings, landmarks, landscape, materials, colours and details must match the reference closely, not a generic version of it. Only image 1 sets the composition, the arches and the framing; the reference${nRefs > 1 ? 's do' : ' does'} not. ` : '')
      + (outer ? `Depth: this ${cn} area is ${outer} arch${outer > 1 ? 'es' : ''} further back than the outermost scene, so everything in it is further from the camera. People, animals, vehicles and objects here must look clearly smaller than the same things in the scene${outer > 1 ? 's' : ''} in front of it, about ${Math.round(Math.pow(0.65, outer) * 100)}% of their size in the outermost scene, with matching perspective and slightly softer detail. ` : '')
      + 'Do not add anything on top of or around any arch (no spires, domes, finials, carvings or extra stone): every arch keeps exactly the outline it has in image 1. '
      + 'Same framing and size as image 1. No text or logos. A clean, real, high-end photograph.';
  }
  function innerRegion(z) {   // the windows further in, with everything inside them
    const n = P.W * P.H, r = new Uint8Array(n);
    for (const o of innerOf(z)) { const k = P.zones.indexOf(o) + 1; for (let i = 0; i < n; i++) if (P.labels[i] === k || o.nest[i]) r[i] = 1; }
    return r;
  }
  function maskBlob(a) {
    const { W, H } = P, n = W * H, mc = cv(W, H), g = ctx(mc), id = g.createImageData(W, H);
    for (let i = 0; i < n; i++) { const j = i * 4; id.data[j] = id.data[j + 1] = id.data[j + 2] = 255; id.data[j + 3] = a[i]; }
    g.putImageData(id, 0, 0); return new Promise(res => mc.toBlob(res, 'image/png'));
  }
  async function stepMasks(z, outPx, fg) {   // base: the window and the arch it owns. over: only cut-out things standing in front of the windows further in
    const { W, H } = P, n = W * H, k = P.zones.indexOf(z) + 1, inner = innerRegion(z);
    let own = new Uint8Array(n); for (let i = 0; i < n; i++) if (P.labels[i] === k) own[i] = 255;
    own = dilate(own, W, H, Math.max(1, P.grow + 1));
    for (let i = 0; i < n; i++) if (z.nest[i] && !inner[i]) own[i] = 255;
    const base = await maskBlob(soften(own, W, H));
    if (!fg) return { base, over: null };
    const mine = own;   // this window and its own arch
    let over = new Uint8Array(n), any = 0; const L = P.px, est = {}, SM = stoneMatch(outPx);
    for (const o of innerOf(z)) {   // which shade the AI used for each placeholder: a flat block of it is never a thing in front, however much it stands out
      const k = P.zones.indexOf(o) + 1, hist = new Map();
      for (let i = 0; i < n; i++) if (P.labels[i] === k) { const j = i * 4, key = (outPx[j] >> 4) << 8 | (outPx[j + 1] >> 4) << 4 | (outPx[j + 2] >> 4), h = hist.get(key) || [0, 0, 0, 0]; h[0]++; h[1] += outPx[j]; h[2] += outPx[j + 1]; h[3] += outPx[j + 2]; hist.set(key, h); }
      let b = [0, 0, 0, 0]; for (const h of hist.values()) if (h[0] > b[0]) b = h;
      est[k] = b[0] ? [b[1] / b[0], b[2] / b[0], b[3] / b[0]] : o.color;
    }
    for (let i = 0; i < n; i++) {
      if (fg[i] < 8) continue;
      const lk = P.labels[i];
      if (inner[i] && lk) {   // inside a placeholder: the placeholder colour itself never goes on top
        const o = P.zones[lk - 1], e = est[lk] || o.color, j = i * 4;
        const d = Math.sqrt(Math.min((outPx[j] - e[0]) ** 2 + (outPx[j + 1] - e[1]) ** 2 + (outPx[j + 2] - e[2]) ** 2, (outPx[j] - o.color[0]) ** 2 + (outPx[j + 1] - o.color[1]) ** 2 + (outPx[j + 2] - o.color[2]) ** 2));
        if (d < 60) continue;
        if (d < 120) { over[i] = Math.round(fg[i] * (d - 60) / 60); any++; continue; }
      }
      if (!inner[i]) { if (mine[i]) over[i] = fg[i]; continue; }   // never the AI's copies of things belonging to the windows around it   // same pixels as the base here; covering them too avoids a seam where the two meet
      if (!P.labels[i]) {   // stone of an inner arch: only where something really covers it, never this world's relit copy of another world's arch
        const x = i % W, y = (i / W) | 0, si = Math.min(SM.h - 1, (y / SM.k) | 0) * SM.w + Math.min(SM.w - 1, (x / SM.k) | 0);
        if (SM.same[si]) continue;
      }
      over[i] = fg[i]; any++;
    }
    if (any < n * 0.0005) return { base, over: null };
    return { base, over: await maskBlob(soften(over, W, H)) };
  }
  function stoneMatch(outPx) {   // where the new picture still shows the layout's stone pattern (relit or not), on a small grid
    const { W, H } = P, k = Math.max(1, Math.round(Math.max(W, H) / 1024)), w = Math.ceil(W / k), h = Math.ceil(H / k);
    const lum = src => { const a = new Float32Array(w * h), c = new Float32Array(w * h);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) { const i = (y * W + x) * 4, j = ((y / k) | 0) * w + ((x / k) | 0); a[j] += 0.3 * src[i] + 0.59 * src[i + 1] + 0.11 * src[i + 2]; c[j]++; }
      for (let j = 0; j < a.length; j++) a[j] /= c[j] || 1; return a; };
    const box = (a, r) => { const t = new Float32Array(a.length), o = new Float32Array(a.length);
      for (let y = 0; y < h; y++) { let s = 0; for (let x = -r; x <= r; x++) s += a[y * w + Math.min(w - 1, Math.max(0, x))]; for (let x = 0; x < w; x++) { t[y * w + x] = s / (2 * r + 1); s += a[y * w + Math.min(w - 1, x + r + 1)] - a[y * w + Math.max(0, x - r)]; } }
      for (let x = 0; x < w; x++) { let s = 0; for (let y = -r; y <= r; y++) s += t[Math.min(h - 1, Math.max(0, y)) * w + x]; for (let y = 0; y < h; y++) { o[y * w + x] = s / (2 * r + 1); s += t[Math.min(h - 1, y + r + 1) * w + x] - t[Math.max(0, y - r) * w + x]; } }
      return o; };
    const A = lum(outPx), B = lum(P.px), bA = box(A, 3), bB = box(B, 3), hA = A.map((v, i) => v - bA[i]), hB = B.map((v, i) => v - bB[i]);
    const ab = box(hA.map((v, i) => v * hB[i]), 4), aa = box(hA.map(v => v * v), 4), bb = box(hB.map(v => v * v), 4), same = new Uint8Array(w * h);
    for (let i = 0; i < same.length; i++) {
      const r = (bA[i] + 8) / (bB[i] + 8);   // brightness compared with the original stone: a relight changes it a little, dark paint or a body a lot
      if (r < 0.45 || r > 2.2) { same[i] = 0; continue; }
      const smooth = aa[i] < 4 && bb[i] < 4;   // plain smooth stone in both
      same[i] = smooth || ab[i] / Math.sqrt(aa[i] * bb[i] + 1e-6) > 0.45 ? 1 : 0;
    }
    return { k, w, h, same };
  }
  function pushPull(rgba, w, h) {   // fills see-through pixels with a smooth guess from their surroundings
    let lv = [{ w, h, c: new Float32Array(w * h * 3), a: new Float32Array(w * h) }];
    for (let i = 0; i < w * h; i++) { const a = rgba[i * 4 + 3] / 255; lv[0].a[i] = a; for (let k = 0; k < 3; k++) lv[0].c[i * 3 + k] = rgba[i * 4 + k] * a; }
    while (lv[lv.length - 1].w > 1 || lv[lv.length - 1].h > 1) {
      const p = lv[lv.length - 1], nw = Math.max(1, Math.ceil(p.w / 2)), nh = Math.max(1, Math.ceil(p.h / 2)), q = { w: nw, h: nh, c: new Float32Array(nw * nh * 3), a: new Float32Array(nw * nh) };
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) { const s = y * p.w + x, t = (y >> 1) * nw + (x >> 1); q.a[t] += p.a[s]; for (let k = 0; k < 3; k++) q.c[t * 3 + k] += p.c[s * 3 + k]; }
      for (let t = 0; t < nw * nh; t++) { const a = q.a[t]; if (a > 1) { for (let k = 0; k < 3; k++) q.c[t * 3 + k] /= a; q.a[t] = 1; } }
      lv.push(q);
    }
    for (let l = lv.length - 2; l >= 0; l--) {
      const p = lv[l], q = lv[l + 1];
      for (let y = 0; y < p.h; y++) for (let x = 0; x < p.w; x++) {
        const s = y * p.w + x, a = p.a[s]; if (a >= 1) continue;
        const t = Math.min(q.h - 1, y >> 1) * q.w + Math.min(q.w - 1, x >> 1);
        for (let k = 0; k < 3; k++) p.c[s * 3 + k] = p.c[s * 3 + k] + (1 - a) * q.c[t * 3 + k] / Math.max(1e-6, q.a[t]);
        p.a[s] = 1;
      }
    }
    const out = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) { for (let k = 0; k < 3; k++) out[i * 4 + k] = lv[0].c[i * 3 + k]; out[i * 4 + 3] = 255; }
    return out;
  }
  function inputFor(z, outer) {   // the picture the AI starts from: the worlds in front, with their cut-out objects taken out, so they are never copied into this world
    const { W, H } = P, comp = compose(W, H, true, outer, true), hole = cv(W, H), hg = ctx(hole); let anyHole = false;
    for (const o of outer) { const v = sceneOf(o); if (!v || !metaOf(o, v).over) continue; const mo = overMaskOf(v); if (mo) { hg.drawImage(mo, 0, 0, W, H); if (o.allowC) { hg.globalCompositeOperation = 'destination-in'; hg.drawImage(o.allowC, 0, 0, W, H); hg.globalCompositeOperation = 'source-over'; } anyHole = true; } }
    if (!anyHole) return comp;
    const k = Math.min(1, 1024 / Math.max(W, H)), sw = Math.round(W * k), sh = Math.round(H * k);
    const small = cv(sw, sh), sg = ctx(small); sg.drawImage(comp, 0, 0, sw, sh); sg.globalCompositeOperation = 'destination-out'; sg.drawImage(hole, 0, 0, sw, sh);
    const filled = cv(sw, sh); ctx(filled).putImageData(new ImageData(pushPull(sg.getImageData(0, 0, sw, sh).data, sw, sh), sw, sh), 0, 0);
    const patch = cv(W, H), pg = ctx(patch); pg.imageSmoothingQuality = 'high'; pg.drawImage(filled, 0, 0, W, H);   // a soft guess of what's behind
    if (z.allowC) {   // inside this window and the ones behind it: the clean layout (flat placeholder, original stone)
      const lay = cv(W, H), lg = ctx(lay); lg.drawImage(P.layoutC, 0, 0); lg.globalCompositeOperation = 'destination-in'; lg.drawImage(z.allowC, 0, 0); pg.drawImage(lay, 0, 0);
    }
    pg.globalCompositeOperation = 'destination-in'; pg.drawImage(hole, 0, 0);
    ctx(comp).drawImage(patch, 0, 0);
    return comp;
  }
  async function cutOut(blob) {   // BiRefNet on fal.ai: white where the things in front are
    const { W, H } = P, bm = await createImageBitmap(blob), k = Math.min(1, 2048 / Math.max(bm.width, bm.height)), c = cv(Math.round(bm.width * k), Math.round(bm.height * k));
    c.getContext('2d').drawImage(bm, 0, 0, c.width, c.height); bm.close && bm.close();
    const url = c.toDataURL('image/jpeg', 0.92); let res;
    try { res = await falQueue('fal-ai/birefnet/v2', { image_url: url, mask_only: true, model: 'General Use (Light 2K)', operating_resolution: '2048x2048' }); }
    catch (e) { if (e && e.status !== 422) throw e; res = await falQueue('fal-ai/birefnet/v2', { image_url: url, mask_only: true }); }
    const u = (res && res.image && res.image.url) || (res && res.mask_image && res.mask_image.url);
    if (!u) throw new Error('fal.ai didn’t send the cut-out back.');
    recordSpend('fal', 0.01, 'Portals: cut-out');
    const mb = typeof fetchBlob === 'function' ? await fetchBlob(u) : await (await fetch(u)).blob();
    const m = await createImageBitmap(mb), mc = cv(W, H), g = ctx(mc); g.imageSmoothingQuality = 'high'; g.drawImage(m, 0, 0, W, H); m.close && m.close();
    const d = g.getImageData(0, 0, W, H).data, out = new Uint8Array(W * H);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = Math.round(d[j] * d[j + 3] / 255);
    return out;
  }
  async function makeZone(z, quiet) {
    if (P.busy[z.id]) return;
    if (!z.place.trim()) { if (!quiet) { P.sel = z.id; renderPanel(); toast('Write where this window looks out to first.'); setTimeout(() => { const t = panel.querySelector('[data-pzf="place"]'); t && t.focus(); }, 30); } return false; }
    const model = settings.ptModel;
    if (needKey(model)) return false;
    const outer = outerOf(z);
    if (!quiet && outer.some(o => !sceneOf(o))) toast('Tip: make the windows around this one first, so it fits their light and shadows.');
    P.busy[z.id] = true; renderPanel(); renderStage();
    try {
      await loadAll(); const { W, H } = P, full = inputFor(z, outer);
      const k = Math.min(1, 2048 / Math.max(W, H)), send = cv(Math.round(W * k), Math.round(H * k)); send.getContext('2d').drawImage(full, 0, 0, send.width, send.height);
      const refIds = z.refs.filter(id => img(id));
      const refs = [part(send, 'image/png'), ...await Promise.all(refIds.map(id => prepRef(img(id))))];
      const prompt = promptFor(z, refIds.length), size = sizeFor(model), r0 = ratio();
      const out = await callImage({ model, prompt, refs, ratio: r0, size });
      recordSpend(PROVIDER(model), (PRICES[model] || {})[size] || 0, 'Portals: ' + z.name);
      const bm = await createImageBitmap(b64ToBlob(out.data, out.mime)), oc = cv(W, H), og = ctx(oc);
      og.imageSmoothingQuality = 'high'; og.drawImage(bm, 0, 0, W, H); bm.close && bm.close();   // same size as the layout, so everything lines up
      const blob = await new Promise(res => oc.toBlob(res, 'image/jpeg', 0.95));
      let fg = null;
      if (innerOf(z).length && z.overlap !== false && settings.falKey) {
        P.busy[z.id] = true; try { fg = await cutOut(blob); } catch (e) { toast('The cut-out didn’t work, so nothing goes over the inner windows this time: ' + friendly(e)); }
      }
      const masks = await stepMasks(z, og.getImageData(0, 0, W, H).data, fg);
      const rec = await addImage({ id: uid(), projectId: S.projectId || null, groupId: null, blob, mime: 'image/jpeg',
        name: slug(z.place.slice(0, 40)) + '-window', source: 'generated', fav: false, createdAt: Date.now(),
        recipe: { kind: 'portals', model, prompt, ratio: r0, size, refs: refIds, window: z.name, time: timeOf(z)[1], place: z.place, style: P.style, front: z.front || '' } });
      await DB.put('tilesets', { id: 'ptmask:' + rec.id, kind: 'ptmask', blob: masks.base });
      if (masks.over) await DB.put('tilesets', { id: 'ptover:' + rec.id, kind: 'ptmask', blob: masks.over });
      z.meta = z.meta || {}; z.meta[rec.id] = { kind: 'ctx', over: !!masks.over, on: Object.fromEntries(outer.map(o => [o.id, sceneOf(o) || null])) };
      z.versions.push(rec.id); z.vi = z.versions.length - 1; z.t = { x: 0, y: 0, s: 1 };
      renderLibrary(); save();
    } catch (e) { toast(`${z.name}: ` + friendly(e)); delete P.busy[z.id]; renderPanel(); renderStage(); return false; }
    delete P.busy[z.id]; renderPanel(); renderStage(); return true;
  }
  async function makeAll() {   // from the outside in, one after another, so each window sees the ones around it
    const todo = ordered().filter(z => !sceneOf(z) || staleOf(z));
    if (!todo.length) { toast('Every window is made and up to date. Use “Make again” on a window to redo it.'); return; }
    const missing = todo.filter(z => !z.place.trim());
    if (missing.length) { P.sel = missing[0].id; renderPanel(); toast(`Write a place for ${missing.map(z => z.name).join(', ')} first.`); return; }
    if (needKey(settings.ptModel)) return;
    let ok = 0;
    for (const z of ordered()) {
      if (!(!sceneOf(z) || staleOf(z))) continue;
      if (await makeZone(z, true)) ok++; else break;
    }
    toast(ok === todo.length ? 'All windows made, outside in. Next: make it one photograph, or save it as it is.' : `${ok} of ${todo.length} windows worked. It stopped at the one that didn’t, so the ones inside it still fit.`);
  }
  async function useOwn(z, id) {
    z.meta = z.meta || {}; z.meta[id] = { kind: 'own' };
    z.versions.push(id); z.vi = z.versions.length - 1; z.t = { x: 0, y: 0, s: 1 };
    P.sel = z.id; renderPanel(); renderStage(); save(); toast(`Using that picture in ${z.name}. Drag on it to slide it in the window.`);
  }

  /* ---------------- 4. One photograph ---------------- */
  async function blend() {
    const model = settings.ptModel; if (needKey(model)) return;
    if (!P.zones.some(z => sceneOf(z))) { toast('Make at least one window first.'); return; }
    P.blendBusy = 'Putting the windows together…'; renderPanel(); renderStage();
    try {
      await loadAll(); const k = Math.min(1, 2048 / Math.max(P.W, P.H)), cw = Math.round(P.W * k), ch = Math.round(P.H * k);
      let comp; const ed = P.editedId && img(P.editedId);
      if (ed) { comp = cv(cw, ch); const eb = await createImageBitmap(await getBlob(ed)); ctx(comp).drawImage(eb, 0, 0, cw, ch); eb.close && eb.close(); }   // your amended version from Photoshop
      else comp = compose(cw, ch, true);
      const times = P.zones.filter(z => sceneOf(z)).map(z => `${z.place.trim() || z.name} ${timeOf(z)[1].toLowerCase()}`).join('; ');
      const short = z => (z.place.trim() || z.name).split(/[,.]/)[0].slice(0, 60);
      const pairs = ordered().filter(z => sceneOf(z) && outerOf(z).length).map(z => { const o = outerOf(z).reduce((a, b) => (b.depth > a.depth ? b : a)); return `arch ${P.zones.indexOf(z)}: the ground of “${short(o)}” in front and the floor of “${short(z)}” through the opening`; });
      const notes = (P.notes || '').trim();
      const prompt = 'Image 1 is a composite: stone arches, with a different place seen through each opening, each at its own time of day (' + times + '). Turn it into one seamless, real photograph. '
        + 'Keep the composition exactly: the arches keep their shape, size and position, and every opening keeps its own place, time of day, sky and light. Do not swap, merge, simplify or move them. '
        + 'Make the stone look truly lit by the scenes around it: each face of the arches picks up the colour and direction of the light next to it, with soft bounce light, believable shadows where the arches meet the ground, and natural contact between stone, sand and water. '
        + 'Make the ground flow naturally from world to world with no hard seams on the floor: elements such as sand, water, paths, rugs, light and shadow cross each arch threshold so they appear on both sides. '
        + (pairs.length ? `Do this at every threshold, including the small ones furthest back, with the same care as the front one: ${pairs.join('; ')}. At each of them there must be no straight line where one floor stops and the next begins: let them overlap and mix over a short distance (for example water lapping onto tiles, sand drifting over stone, a rug or path running out onto the ground in front). ` : '')
        + 'Remove any hard cut-out edges, halos or seams where a scene meets the stone. Match focus, grain and colour response so it reads as one camera. '
        + (notes ? 'Also: ' + notes + '. ' : '') + 'Do not add text or logos.';
      P.blendBusy = 'Nano Banana is making it one photograph…'; renderStage();
      const mm = MODELS.find(x => x.id === model) || MODELS[0], size = mm.sizes.includes(settings.ptFinal || '4K') ? (settings.ptFinal || '4K') : mm.sizes[mm.sizes.length - 1], out = await callImage({ model, prompt, refs: [part(comp, 'image/jpeg')], ratio: ratio(), size });
      recordSpend(PROVIDER(model), (PRICES[model] || {})[size] || 0, 'Portals: one photograph');
      const rec = await addImage({ id: uid(), projectId: S.projectId || null, groupId: null, blob: b64ToBlob(out.data, out.mime), mime: out.mime,
        name: 'portals-' + slug((P.zones.find(z => z.place.trim()) || {}).place || 'final').slice(0, 30), source: 'generated', fav: false, createdAt: Date.now(), upscaleOf: P.layoutId,
        recipe: { kind: 'portals', model, prompt, size, ratio: ratio() } });
      P.blendId = rec.id; P.view = 'final'; renderLibrary(); save();
      toast('Done. It’s in History. Switch between Windows and Final at the top to compare.');
    } catch (e) { toast('Portals: ' + friendly(e)); }
    P.blendBusy = null; renderPanel(); renderStage();
  }
  async function saveAsIs() {
    try {
      await loadAll(); const c = compose(P.W, P.H, true), blob = await new Promise((res, rej) => c.toBlob(b => b ? res(b) : rej(new Error('Your browser ran out of room. Try a smaller layout.')), 'image/png'));
      await addImage({ id: uid(), projectId: S.projectId || null, groupId: null, blob, mime: 'image/png', name: 'portals-windows', source: 'imported', fav: false, createdAt: Date.now(), upscaleOf: P.layoutId,
        recipe: { kind: 'portals', prompt: P.zones.map((z, i) => `${i + 1}. ${z.place || z.name}, ${timeOf(z)[1].toLowerCase()}`).join('\n') } });
      renderLibrary(); toast('Saved to History, exactly as it looks now.');
    } catch (e) { toast(friendly(e)); }
  }

  /* ---------------- 5. Layered Photoshop file ---------------- */
  let agLoading = null;
  function loadAgPsd() {   // ag-psd, the same Photoshop writer the PSD export uses, loaded only when needed
    if (window.agPsd && window.agPsd.writePsdUint8Array) return Promise.resolve(window.agPsd);
    if (!agLoading) agLoading = new Promise((res, rej) => {
      const sc = document.createElement('script'); sc.src = 'pandora_ag-psd.js';
      sc.onload = () => window.agPsd ? res(window.agPsd) : rej(new Error('The Photoshop writer didn’t start. Reload Portals and try again.'));
      sc.onerror = () => { agLoading = null; rej(new Error('Couldn’t load the Photoshop writer. Check your internet connection and try again.')); };
      document.head.appendChild(sc);
    });
    return agLoading;
  }
  function layerFrom(name, picC, maskEls, opts) {   // a picture layer, cropped to where its mask shows, with the mask kept editable
    const { W, H } = P, m = cv(W, H), mg = ctx(m);
    maskEls.forEach((e, i) => { mg.globalCompositeOperation = i ? (e.out ? 'destination-out' : 'destination-in') : 'source-over'; mg.drawImage(e.el || e, 0, 0, W, H); });
    const md = mg.getImageData(0, 0, W, H).data;
    let x0 = W, y0 = H, x1 = -1, y1 = -1;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (md[(y * W + x) * 4 + 3] > 0) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return null;
    const w = x1 - x0 + 1, h = y1 - y0 + 1, mask = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) mask[y * w + x] = md[((y + y0) * W + x + x0) * 4 + 3];
    const rgba = ctx(picC).getImageData(x0, y0, w, h).data;
    for (let i = 3; i < rgba.length; i += 4) rgba[i] = 255;
    const grey = new Uint8ClampedArray(w * h * 4); for (let i = 0, j = 0; i < mask.length; i++, j += 4) { grey[j] = grey[j + 1] = grey[j + 2] = mask[i]; grey[j + 3] = 255; }
    return { name, left: x0, top: y0, opacity: opts && opts.opacity != null ? opts.opacity : 1, hidden: !!(opts && opts.hidden), blendMode: (opts && opts.blend) || 'normal',
      imageData: { width: w, height: h, data: rgba },
      mask: { left: x0, top: y0, right: x0 + w, bottom: y0 + h, defaultColor: 0, imageData: { width: w, height: h, data: grey } } };
  }
  async function exportPSD() {
    if (!P.layoutC) return;
    const btn = panel.querySelector('#ptPsd'); if (btn) { btn.disabled = true; btn.textContent = 'Building the layers…'; }
    try {
      await loadAll(); const ag = await loadAgPsd(), { W, H } = P, kids = [], yieldUI = () => new Promise(r => setTimeout(r, 0));
      const lay = cv(W, H); ctx(lay).drawImage(P.layoutC, 0, 0);
      kids.push({ name: 'Layout (arches and colour placeholders)', left: 0, top: 0, imageData: { width: W, height: H, data: ctx(lay).getImageData(0, 0, W, H).data } });
      const full = c => { const x = cv(W, H); ctx(x).drawImage(c, 0, 0, W, H); return x; };
      const nm = (z, i, what) => `${P.zones.indexOf(z) + 1}. ${(z.place.trim() || z.name).split(/[,.]/)[0].slice(0, 40)}${what ? ' · ' + what : ''}`;
      for (const z of ordered()) {   // each world with its arch, outside in
        const v = sceneOf(z); if (!v) continue; await yieldUI();
        const m = metaOf(z, v), el = picEl(v);
        let pic;
        if (m.kind === 'ctx') pic = full(el); else { pic = cv(W, H); drawCover(ctx(pic), el, W, H, z.t); }
        const L = layerFrom(nm(z, 0, timeOf(z)[1].toLowerCase()), pic, [baseMaskOf(z, v, el)]); if (L) kids.push(L);
        const amt = z.tint ?? 0.35, col = m.kind === 'ctx' && z.archC && amt > 0 ? tintOf(z, v, el) : null;
        if (col) {   // the arch colour, as its own soft-light layer you can turn up, down or off
          const t = cv(W, H), tg = ctx(t); tg.fillStyle = `rgb(${col.map(Math.round).join(',')})`; tg.fillRect(0, 0, W, H);
          const masks = [z.archC]; const mo = m.over ? overMaskOf(v) : null; if (mo) masks.push({ el: mo, out: true });
          const T = layerFrom(nm(z, 0, 'arch colour'), t, masks, { blend: 'soft light', opacity: Math.min(1, amt) }); if (T) kids.push(T);
        }
      }
      for (const z of ordered().reverse()) {   // the cut-outs in front, nearest the camera on top
        const v = sceneOf(z); if (!v || !metaOf(z, v).over) continue; await yieldUI();
        const L = layerFrom(nm(z, 0, 'in front (cut-out)'), full(picEl(v)), [overMaskOf(v), z.allowC]); if (L) kids.push(L);
      }
      if (P.blendId && img(P.blendId)) {   // the finished photograph, switched off, on top
        const el = picEl(P.blendId) || await createImageBitmap(await getBlob(img(P.blendId)));
        kids.push({ name: 'One photograph (final pass)', left: 0, top: 0, hidden: true, imageData: { width: W, height: H, data: ctx(full(el)).getImageData(0, 0, W, H).data } });
      }
      const comp = compose(W, H, true);
      if (btn) btn.textContent = 'Writing the Photoshop file…'; await yieldUI();
      const bytes = ag.writePsdUint8Array({ width: W, height: H, children: kids, imageData: { width: W, height: H, data: ctx(comp).getImageData(0, 0, W, H).data } }, { generateThumbnail: false });
      const b = new Blob([bytes], { type: 'image/vnd.adobe.photoshop' }), u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = 'portals-' + slug((P.zones.find(z => z.place.trim()) || {}).place || 'layers').slice(0, 30) + '.psd';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
      toast(`Photoshop file saved: ${kids.length} layers, each world with an editable mask.`);
    } catch (e) { toast('The Photoshop file didn’t work: ' + friendly(e)); }
    if (btn) { btn.disabled = false; btn.textContent = 'Download layered PSD (free)'; }
  }

  /* ---------------- the picture on screen ---------------- */
  let raf = 0, shown = { w: 0, h: 0 };
  const paint = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(paintNow); };
  function paintNow() {
    const st = $q('#ptStage'), c = $q('#ptCanvas'), wrap = $q('#ptWrap'); if (!st || !c || !P.layoutC) return;
    const bw = st.clientWidth - 40, bh = st.clientHeight - 40, a = P.W / P.H; let w = bw, h = bw / a; if (h > bh) { h = bh; w = bh * a; }
    w = Math.max(1, Math.floor(w)); h = Math.max(1, Math.floor(h));
    const dpr = Math.min(2, window.devicePixelRatio || 1), pw = Math.max(1, Math.min(P.W, Math.round(w * dpr))), ph = Math.max(1, Math.round(pw / a));
    wrap.style.width = w + 'px'; wrap.style.height = h + 'px'; c.style.width = w + 'px'; c.style.height = h + 'px';
    if (c.width !== pw || c.height !== ph) { c.width = pw; c.height = ph; }
    const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.clearRect(0, 0, pw, ph);
    if (P.view === 'layout') g.drawImage(P.layoutC, 0, 0, pw, ph);
    else if (P.view === 'final' && P.blendId) { const el = picEl(P.blendId); if (el) g.drawImage(el, 0, 0, pw, ph); }
    else g.drawImage(compose(pw, ph), 0, 0);
    if (P.brush && P.view === 'result') {
      const B = P.brush, mk = EM.get(B.layer + ':' + B.v) || (B.layer === 'b' ? baseMaskOf(zoneOf(B.zid) || {}, B.v, picEl(B.v)) : overMaskOf(B.v));
      if (B.show && mk) {   // the mask being edited, shown in colour on top
        const o = cv(pw, ph), og = o.getContext('2d'); og.fillStyle = B.layer === 'b' ? 'rgba(0,200,255,0.45)' : 'rgba(255,60,200,0.5)'; og.fillRect(0, 0, pw, ph);
        og.globalCompositeOperation = 'destination-in'; og.drawImage(mk, 0, 0, pw, ph); g.drawImage(o, 0, 0);
      }
      if (brushAt) { const k = pw / P.W; g.save(); g.strokeStyle = '#fff'; g.lineWidth = 1.5; g.setLineDash([4, 3]); g.beginPath(); g.arc(brushAt[0] * k, brushAt[1] * k, B.size / 2 * k, 0, Math.PI * 2); g.stroke(); g.restore(); }
    }
    shown = { w, h };
    const chips = $q('#ptChips');
    if (chips) {
      chips.classList.toggle('off', !$q('#ptNums').checked || P.view === 'final');
      chips.innerHTML = P.zones.map((z, i) => `<button type="button" class="pt-chip${z.id === P.sel ? ' on' : ''}" data-pzsel="${z.id}" style="left:${z.pt[0] * w}px;top:${z.pt[1] * h}px"><i style="background:${rgb(z.color)}">${i + 1}</i>${P.busy[z.id] ? '<i class="res-spin"></i>' : ''}${esc(z.place.trim() ? z.place.trim().split(/[,.]/)[0].slice(0, 26) : z.name)}</button>`).join('');
    }
  }
  function renderStage() {
    const st = $q('#ptStage'); if (!st || view.hidden) return;
    view.querySelectorAll('#ptShow button').forEach(b => { b.classList.toggle('on', b.dataset.pv === P.view); b.disabled = b.dataset.pv === 'final' && !P.blendId; });
    $q('#ptInfo').textContent = P.layoutC ? `${P.W} × ${P.H} px` : '';
    $q('#ptDl').hidden = !P.layoutC;
    const z = zoneOf(P.sel);
    $q('#ptHint').textContent = !P.layoutC ? '' : P.picking ? 'Click a colour on the picture to make it a window.' : P.view === 'final' ? 'The finished photograph. Windows shows the parts.' : z && sceneOf(z) && metaOf(z, sceneOf(z)).kind === 'own' ? `Drag inside ${z.name} to slide its picture. ⌘ + scroll to size it.` : 'Click a window to work on it. Windows are made from the outside in.';
    if (!P.layoutC) {
      st.innerHTML = P.busyMsg ? `<div class="pt-busy"><i class="res-spin"></i><span>${esc(P.busyMsg)}</span></div>`
        : `<div class="pt-empty"><b>A different place in every window</b>1. Make a layout: your frame (arches, doors, windows) with each opening painted one flat colour.<br>2. Drop it here, or drag it from History.<br>3. Give every colour its own place and time of day.<br>4. Portals makes each one, puts them in their windows and blends it into one photograph.</div>`;
      return;
    }
    if (!$q('#ptCanvas')) {
      st.innerHTML = '<div class="pt-wrap" id="ptWrap"><canvas id="ptCanvas"></canvas><div class="pt-chips" id="ptChips"></div></div>';
      bindCanvas($q('#ptCanvas'));
    }
    if (P.brush && (P.brush.zid !== P.sel || !zoneOf(P.brush.zid) || sceneOf(zoneOf(P.brush.zid)) !== P.brush.v)) { P.brush = null; brushAt = null; }
    $q('#ptWrap').classList.toggle('picking', P.picking);
    $q('#ptWrap').classList.toggle('brushing', !!P.brush && P.view === 'result');
    $q('#ptWrap').classList.toggle('moving', !!(z && sceneOf(z) && metaOf(z, sceneOf(z)).kind === 'own') && P.view === 'result');
    st.querySelectorAll('.pt-busy').forEach(b => b.remove());
    const msg = P.busyMsg || P.blendBusy;
    if (msg) { const b = document.createElement('div'); b.className = 'pt-busy'; b.innerHTML = `<i class="res-spin"></i><span>${esc(msg)}</span>`; st.appendChild(b); }
    paint();
  }
  function bindCanvas(c) {
    const toPic = (e, b) => [(e.clientX - b.left) / b.width * P.W, (e.clientY - b.top) / b.height * P.H];
    c.addEventListener('pointermove', e => { if (!P.brush || c.onpointermove) return; brushAt = toPic(e, c.getBoundingClientRect()); paint(); });
    c.addEventListener('pointerleave', () => { if (P.brush && brushAt) { brushAt = null; paint(); } });
    c.addEventListener('pointerdown', e => {
      if (P.brush && P.view === 'result') {   // painting the mask
        const b = c.getBoundingClientRect(), m = workingMask(); if (!m) return;
        e.preventDefault(); c.setPointerCapture(e.pointerId); snapshot(m);
        let [lx, ly] = toPic(e, b); dab(m, lx, ly); brushAt = [lx, ly]; paint();
        c.onpointermove = ev => {
          const [x, y] = toPic(ev, b), step = Math.max(1, P.brush.size / 5), dd = Math.hypot(x - lx, y - ly);
          for (let s1 = step; s1 <= dd; s1 += step) dab(m, lx + (x - lx) * s1 / dd, ly + (y - ly) * s1 / dd);
          if (dd >= step) { lx = x; ly = y; } brushAt = [x, y]; paint();
        };
        c.onpointerup = () => { c.onpointermove = null; c.onpointerup = null; saveBrush(); };
        return;
      }
      const b = c.getBoundingClientRect(), u = (e.clientX - b.left) / b.width, v = (e.clientY - b.top) / b.height;
      if (P.picking) {
        const x = Math.min(P.W - 1, Math.floor(u * P.W)), y = Math.min(P.H - 1, Math.floor(v * P.H)), i = (y * P.W + x) * 4, col = [P.px[i], P.px[i + 1], P.px[i + 2]];
        P.picking = false;
        if (P.zones.some(z => dist2(z.color, col) < TOL * TOL)) { toast('That colour is already a window.'); renderStage(); renderPanel(); return; }
        const z = newZone(col); P.zones.push(z); P.sel = z.id; rebuild('Adding the window…'); return;
      }
      if (P.view === 'final') { P.view = 'result'; renderStage(); return; }
      const z = labelAt(u, v); if (!z) return;
      if (z.id !== P.sel || !sceneOf(z) || metaOf(z, sceneOf(z)).kind !== 'own' || P.view !== 'result') { if (P.sel !== z.id) { P.sel = z.id; renderPanel(); } if (P.view !== 'result') P.view = 'result'; renderStage(); if (!sceneOf(z) || metaOf(z, sceneOf(z)).kind !== 'own') return; }
      c.setPointerCapture(e.pointerId);
      const x0 = e.clientX, y0 = e.clientY, t0 = { ...z.t };
      c.onpointermove = ev => { z.t = { ...t0, x: t0.x + (ev.clientX - x0) / b.width, y: t0.y + (ev.clientY - y0) / b.height }; paint(); };
      c.onpointerup = () => { c.onpointermove = null; c.onpointerup = null; save(); };
    });
    c.addEventListener('wheel', e => {
      if (!(e.ctrlKey || e.metaKey)) return;
      const z = zoneOf(P.sel); if (!z || !sceneOf(z) || metaOf(z, sceneOf(z)).kind !== 'own') return;
      e.preventDefault(); z.t = { ...z.t, s: Math.max(1, Math.min(3, (z.t.s || 1) * Math.exp(-e.deltaY * 0.002))) }; paint(); syncSize(z); save();
    }, { passive: false });
  }
  function syncSize(z) { const i = panel.querySelector('[data-pzsize]'); if (i) { i.value = Math.round(z.t.s * 100); i.nextElementSibling.textContent = Math.round(z.t.s * 100) + '%'; } }

  /* ---------------- the panel ---------------- */
  function zoneCard(z, i) {
    const on = z.id === P.sel, busy = P.busy[z.id], sc = sceneOf(z), T = timeOf(z), n = z.versions.length;
    const own = sc && metaOf(z, sc).kind === 'own', stale = staleOf(z);
    const status = busy ? 'making…' : stale ? 'remake to fit' : sc ? T[1] : z.place.trim() ? 'ready to make' : 'needs a place';
    let h = `<div class="pz${on ? ' on' : ''}" data-pz="${z.id}"><button type="button" class="pz-head" data-pzsel="${z.id}"><i class="pz-sw" style="background:${rgb(z.color)}">${i + 1}</i>${sc && img(sc) ? `<img src="${thumb(img(sc))}" data-th="${sc}" alt="">` : ''}<b>${esc(z.place.trim() || z.name)}</b><span>${busy ? '<i class="res-spin"></i> ' : ''}${status}</span></button>`;
    if (!on) return h + '</div>';
    h += `<div class="pz-body">
      <label class="field"><span class="lbl">Where does it look out to?</span><textarea data-pzf="place" rows="3" placeholder="e.g. a palm oasis with turquoise water and flamingos">${esc(z.place)}</textarea></label>
      <div class="field"><span class="lbl">Time of day</span><div class="pz-chips">${TIMES.map(t => `<button type="button" data-pztime="${t[0]}" class="${t[0] === z.time ? 'on' : ''}">${t[1]}</button>`).join('')}</div></div>
      ${z.archC ? `<label class="slider v" style="margin-bottom:12px"><span>Arch colour</span><input type="range" data-pztint min="0" max="100" step="1" value="${Math.round((z.tint ?? 0.35) * 100)}"><output>${Math.round((z.tint ?? 0.35) * 100)}%</output></label><div class="hint" style="margin:-8px 0 12px">How much the arch around this window takes on this world’s colours. Free, and it changes straight away.</div>` : ''}
      ${innerOf(z).length ? `<label class="check" style="margin:-2px 0 12px"><input type="checkbox" data-pzover${z.overlap !== false ? ' checked' : ''}${settings.falKey ? '' : ' disabled'}> Let things in front (a car, a person) pass over the windows further in</label>${settings.falKey ? `<div class="hint" style="margin:-8px 0 12px">Portals cuts them out with BiRefNet: about 1¢ on fal.ai. The ground and scenery never spill over.</div><label class="field"><span class="lbl">In front of the next arch <small>optional</small></span><input type="text" data-pzfront value="${esc(z.front || '')}" placeholder="e.g. a man carrying a rolled rug, spice sacks"></label>` : '<div class="hint" style="margin:-8px 0 12px">Needs a fal.ai key in Settings, for the cut-out.</div>'}` : ''}
      <div class="field pz-refs" data-pzrefs="${z.id}"><span class="lbl">Reference pictures <small>optional</small></span>
        <div class="fx-refs">${z.refs.filter(id => img(id)).map(id => `<div class="r"><img src="${thumb(img(id))}" data-th="${id}" alt=""><button type="button" data-pzrefx="${id}" title="Remove">×</button></div>`).join('')}</div>
        <div class="row" style="margin-top:6px"><button type="button" class="btn small" data-pzrefadd>Add picture…</button></div>
        <div class="hint">Drag pictures here from History, or add them from your computer: the real place, a landmark, a mood.</div></div>`;
    if (n) h += `<div class="pz-ver"><button type="button" data-pzv="-1"${z.vi <= 0 ? ' disabled' : ''} title="Earlier version">‹</button><span>Version ${z.vi + 1} of ${n}</span><button type="button" data-pzv="1"${z.vi >= n - 1 ? ' disabled' : ''} title="Later version">›</button><span class="sp-fill" style="flex:1"></span>${own ? '<button type="button" class="linkbtn" data-pzreset style="font-size:12px;width:auto;height:auto;background:none;border:0">Reset position</button>' : ''}</div><div class="pz-btns" style="margin:-2px 0 10px"><button type="button" class="btn small" data-pzcopy="place" title="Copy what you wrote for this window">Copy my description</button><button type="button" class="btn small" data-pzcopy="prompt" title="Copy the whole prompt Portals sent for this version">Copy full prompt</button></div>`;
    if (stale) h += `<div class="hint" style="color:var(--star);margin:-2px 0 10px">${stale.old ? 'Made with the earlier version of Portals, so its arch isn’t part of it. Make it again to paint it into the picture.' : `Made before ${esc(stale.name)} changed, so its light and shadows may not match. Make it again to fit.`}</div>`;
    const B = P.brush && P.brush.zid === z.id ? P.brush : null;
    if (sc && !B) h += `<button type="button" class="btn wide" data-pzbrush style="margin:0 0 10px" title="Wipe out or paint back parts of this window with a brush">Edit mask…</button>`;
    if (sc && B) {
      const hasOver = !!metaOf(z, sc).over;
      h += `<div class="pt-brush"><div class="pt-brush-h"><b>Mask brush</b><button type="button" class="btn small" data-pzbrushdone>Done</button></div>
        ${hasOver ? `<div class="seg" style="grid-template-columns:1fr 1fr;margin-bottom:8px"><button type="button" data-pzlayer="b" class="${B.layer === 'b' ? 'on' : ''}">This window</button><button type="button" data-pzlayer="o" class="${B.layer === 'o' ? 'on' : ''}">Things in front</button></div>` : ''}
        <div class="seg" style="grid-template-columns:1fr 1fr;margin-bottom:8px"><button type="button" data-pzmode="erase" class="${B.mode === 'erase' ? 'on' : ''}">Erase</button><button type="button" data-pzmode="restore" class="${B.mode === 'restore' ? 'on' : ''}">Restore</button></div>
        <label class="slider v"><span>Brush size</span><input type="range" data-pzbsize min="4" max="${Math.round(Math.max(P.W, P.H) / 6)}" step="1" value="${B.size}"><output>${B.size}</output></label>
        <label class="check" style="margin:2px 0 8px"><input type="checkbox" data-pzbshow${B.show ? ' checked' : ''}> Show the mask in colour</label>
        <div class="pz-btns"><button type="button" class="btn small" data-pzbundo>Undo</button><button type="button" class="btn small" data-pzbreset>Reset mask</button></div>
        <div class="hint" style="margin-top:6px">${B.layer === 'b' ? 'Erase hides this window’s picture there, so what’s behind shows. Restore paints it back.' : 'Erase takes things out of the cut-out (they stop passing over the windows further in). Restore paints the cut-out back.'} Changes save by themselves.</div></div>`;
    }
    if (own) h += `
<label class="slider v"><span>Size</span><input type="range" data-pzsize min="100" max="300" step="1" value="${Math.round((z.t.s || 1) * 100)}"><output>${Math.round((z.t.s || 1) * 100)}%</output></label>
      <div class="hint" style="margin:-2px 0 10px">Drag inside the window on the picture to slide the scene.</div>`;
    h += `<button type="button" class="primary" data-pzgo${busy ? ' disabled' : ''}>${busy ? 'Making…' : sc ? 'Make again' : 'Make this window'}<small>about ${usd(price())} · ${T[1].toLowerCase()}</small></button>
      <div class="pz-btns">${sc ? '<button type="button" class="btn small" data-pzrm title="Take this picture out of the window (it stays in History)">Remove picture</button>' : ''}<button type="button" class="btn small" data-pzown>Use my own picture…</button><button type="button" class="btn small" data-pzdel title="Remove this colour if it isn’t really a window">Not a window</button></div></div></div>`;
    return h;
  }
  function renderPanel() {
    if (panel.hidden) return;
    const r = img(P.layoutId), ready = !!P.layoutC, scroll = panel.querySelector('.brief-scroll') ? panel.querySelector('.brief-scroll').scrollTop : 0;
    const empty = P.zones.filter(z => !sceneOf(z) || staleOf(z)).length, any = P.zones.some(z => sceneOf(z));
    const models = MODELS.filter(m => !m.noRefs && !m.custom), m = MODELS.find(x => x.id === settings.ptModel) || MODELS[0];
    panel.innerHTML = `<div class="brief-scroll">
      <div class="tool-head"><b>Portals</b><span>A different place and time of day in every window</span></div>
      <div class="pt-step"><h4><i>1</i>Layout<small>one flat colour = one window</small></h4>
        <div class="up-src${r ? '' : ' empty'}" data-ptlayout>${r ? `<img src="${thumb(r)}" data-th="${r.id}" alt=""><div><b title="${esc(r.name || 'layout')}">${esc(r.name || 'layout')}</b><span>${ready ? `${P.zones.length} window${P.zones.length === 1 ? '' : 's'} found` : 'reading…'}</span></div>` : 'No layout yet'}</div>
        <div class="row" style="margin-top:6px"><button class="btn small" id="ptOpen">Open layout…</button>${r ? '<button class="btn small" id="ptClear" title="Take this layout out of Portals and start with a new one">Remove layout</button>' : ''}</div>
        <div class="hint">Paint each window one flat colour, like your arches picture. Anything that isn’t a flat colour (the stone) is kept exactly as it is.</div>
        ${ready ? `<div class="pt-found">${P.zones.map(z => `<i style="background:${rgb(z.color)}" title="${esc(z.name)}"></i>`).join('')}<button type="button" class="btn small pt-pick${P.picking ? ' on' : ''}" id="ptPick">${P.picking ? 'Click a colour…' : '+ Pick a colour I missed'}</button></div>
        <label class="slider v" style="margin-top:8px"><span>Tuck under</span><input type="range" id="ptGrow" min="0" max="8" step="1" value="${P.grow}"><output>${P.grow} px</output></label>
        <div class="hint" style="margin-top:0">How far each scene slips under the stone. Raise it if you see a coloured line round the arches.</div>` : ''}
      </div>
      <div class="pt-step${ready ? '' : ' off'}"><h4><i>2</i>The look<small>shared by every window</small></h4>
        <label class="field"><span class="lbl">Overall style <small>optional</small></span><textarea id="ptStyle" rows="2" placeholder="e.g. photorealistic luxury travel campaign, warm cinematic grade, 35mm">${esc(P.style)}</textarea></label>
        <div class="grid2"><label class="field" style="margin-bottom:0"><span class="lbl">Model</span><select id="ptModel">${models.map(x => `<option value="${x.id}"${x.id === settings.ptModel ? ' selected' : ''}>${esc(x.name)}</option>`).join('')}</select></label>
        <label class="field" style="margin-bottom:0"><span class="lbl">Size</span><select id="ptSize">${m.sizes.map(s => `<option${s === sizeFor(settings.ptModel) ? ' selected' : ''}>${s}</option>`).join('')}</select></label></div>
      </div>
      <div class="pt-step${ready && P.zones.length ? '' : ' off'}"><h4><i>3</i>Windows${any ? '<button type="button" class="btn small" id="ptRestart" style="margin-left:auto" title="Empty every window and start again; your places, times and references stay">Start again</button>' : '<small>or click one on the picture</small>'}</h4>
        ${P.zones.map(zoneCard).join('') || '<div class="hint">No windows yet.</div>'}
        ${P.zones.length > 1 ? `<button type="button" class="btn wide" id="ptAll"${empty ? '' : ' disabled'}>Make all windows, outside in${empty ? ` · about ${usd(price() * empty)}` : ''}</button>` : ''}
      </div>
      <div class="pt-step${any ? '' : ' off'}"><h4><i>4</i>Finish</h4>
        <label class="field"><span class="lbl">Anything to add across the picture <small>optional</small></span><textarea id="ptNotes" rows="2" placeholder="e.g. a dune buggy driving out of the left arch, kicking up sand">${esc(P.notes)}</textarea></label>
        <div class="up-src${P.editedId && img(P.editedId) ? '' : ' empty'}" style="margin-bottom:8px">${P.editedId && img(P.editedId) ? `<img src="${thumb(img(P.editedId))}" alt=""><div><b>Using your edited version</b><span>${esc(img(P.editedId).name || '')} · <button type="button" class="linkbtn" id="ptEdOff" style="font-size:11.5px">stop using it</button></span></div>` : 'Using the windows as they are'}</div>
        <button type="button" class="btn wide" id="ptEdUp" style="margin:0 0 10px" title="Bring back your amended PSD (or a PNG or JPG of it) and make the final photograph from that">Upload my edited version…</button><div class="hint" style="margin:-6px 0 10px">A PSD, PNG or JPG of your retouched picture.</div>
        <label class="field"><span class="lbl">Final size</span><select id="ptFinal">${(MODELS.find(x => x.id === settings.ptModel) || MODELS[0]).sizes.map(sz => `<option${sz === (settings.ptFinal || '4K') ? ' selected' : ''}>${sz}</option>`).join('')}</select></label>
        <button type="button" class="primary" id="ptBlend"${P.blendBusy ? ' disabled' : ''}>${P.blendBusy ? 'Working…' : 'Make it one photograph'}<small>about ${usd((PRICES[settings.ptModel] || {})[settings.ptFinal || '4K'] || price())} · lights the stone and blends the edges</small></button>
        <button type="button" class="btn wide" id="ptSave">Save it as it is (free)</button>
        <button type="button" class="btn wide" id="ptPsd" title="Every world on its own layer with an editable mask, the arch colours, the cut-outs in front, and the final photograph">Download layered PSD (free)</button>
      </div>
      <div style="height:12px"></div></div>`;
    panel.querySelector('.brief-scroll').scrollTop = scroll;
  }

  panel.addEventListener('input', e => {
    const t = e.target, z = zoneOf(P.sel);
    if (t.dataset.pzf === 'place' && z) { z.place = t.value; save(); paint(); const hb = panel.querySelector('.pz.on .pz-head b'); if (hb) hb.textContent = z.place.trim() || z.name; return; }
    if (t.id === 'ptStyle') { P.style = t.value; save(); return; }
    if (t.id === 'ptNotes') { P.notes = t.value; save(); return; }
    if (t.id === 'ptGrow') { t.nextElementSibling.textContent = t.value + ' px'; return; }
    if (t.dataset.pzover !== undefined && z) { z.overlap = t.checked; save(); return; }
    if (t.dataset.pzfront !== undefined && z) { z.front = t.value; save(); return; }
    if (t.dataset.pzbsize !== undefined && P.brush) { P.brush.size = +t.value; t.nextElementSibling.textContent = t.value; paint(); return; }
    if (t.dataset.pzbshow !== undefined && P.brush) { P.brush.show = t.checked; paint(); return; }
    if (t.dataset.pztint !== undefined && z) { z.tint = +t.value / 100; t.nextElementSibling.textContent = t.value + '%'; paint(); save(); return; }
    if (t.dataset.pzsize !== undefined && z) { z.t = { ...z.t, s: +t.value / 100 }; t.nextElementSibling.textContent = t.value + '%'; paint(); save(); }
  });
  panel.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'ptGrow') { P.grow = +t.value; rebuild('Updating the edges…'); }
    if (t.id === 'ptModel') { settings.ptModel = t.value; saveSettings(); renderPanel(); }
    if (t.id === 'ptSize') { settings.ptSize = t.value; saveSettings(); renderPanel(); }
    if (t.id === 'ptFinal') { settings.ptFinal = t.value; saveSettings(); renderPanel(); }
  });
  panel.addEventListener('click', e => {
    const t = e.target, z = zoneOf(P.sel);
    const sel = t.closest('[data-pzsel]'); if (sel) { P.sel = P.sel === sel.dataset.pzsel ? null : sel.dataset.pzsel; renderPanel(); renderStage(); return; }
    if (t.closest('#ptOpen')) { fileFor = { kind: 'layout' }; fileIn.multiple = false; fileIn.value = ''; fileIn.click(); return; }
    if (t.closest('#ptClear')) { Object.assign(P, { layoutId: null, layoutC: null, labels: null, zones: [], sel: null, blendId: null, editedId: null, picking: false }); store.set('pandora.portals.src', null); renderPanel(); renderStage(); return; }
    if (t.closest('#ptPick')) { P.picking = !P.picking; if (P.picking) P.view = 'layout'; renderPanel(); renderStage(); return; }
    if (t.closest('#ptAll')) { makeAll(); return; }
    if (t.closest('#ptRestart')) { if (!confirm('Empty every window and start again? Your places, times of day and references stay, and every picture stays in History.')) return; P.zones.forEach(x => { x.versions = []; x.vi = -1; x.meta = {}; x.t = { x: 0, y: 0, s: 1 }; }); P.blendId = null; P.editedId = null; P.view = 'result'; save(); renderPanel(); renderStage(); toast('All windows emptied. Press “Make all windows, outside in” to start again.'); return; }
    if (t.closest('#ptBlend')) { blend(); return; }
    if (t.closest('#ptSave')) { saveAsIs(); return; }
    if (t.closest('#ptPsd')) { exportPSD(); return; }
    if (t.closest('#ptEdUp')) { edIn.value = ''; edIn.click(); return; }
    if (t.closest('#ptEdOff')) { P.editedId = null; save(); renderPanel(); toast('Back to the windows as they are.'); return; }
    if (!z) return;
    const tm = t.closest('[data-pztime]'); if (tm) { z.time = tm.dataset.pztime; save(); renderPanel(); return; }
    const rx = t.closest('[data-pzrefx]'); if (rx) { z.refs = z.refs.filter(id => id !== rx.dataset.pzrefx); save(); renderPanel(); return; }
    if (t.closest('[data-pzrefadd]')) { fileFor = { kind: 'ref', zone: z.id }; fileIn.multiple = true; fileIn.value = ''; fileIn.click(); return; }
    if (t.closest('[data-pzown]')) { fileFor = { kind: 'scene', zone: z.id }; fileIn.multiple = false; fileIn.value = ''; fileIn.click(); return; }
    const v = t.closest('[data-pzv]'); if (v) { z.vi = Math.max(0, Math.min(z.versions.length - 1, z.vi + +v.dataset.pzv)); z.t = { x: 0, y: 0, s: 1 }; save(); renderPanel(); renderStage(); return; }
    if (t.closest('[data-pzreset]')) { z.t = { x: 0, y: 0, s: 1 }; save(); renderPanel(); paint(); return; }
    if (t.closest('[data-pzbrush]')) { startBrush(z); return; }
    if (t.closest('[data-pzbrushdone]')) { P.brush = null; brushAt = null; renderPanel(); renderStage(); return; }
    const ly = t.closest('[data-pzlayer]'); if (ly && P.brush) { P.brush.layer = ly.dataset.pzlayer; renderPanel(); paint(); return; }
    const md = t.closest('[data-pzmode]'); if (md && P.brush) { P.brush.mode = md.dataset.pzmode; renderPanel(); return; }
    if (t.closest('[data-pzbundo]')) { undoBrush(); return; }
    if (t.closest('[data-pzbreset]')) { resetBrush(); return; }
    if (t.closest('[data-pzgo]')) { makeZone(z); return; }
    const cp = t.closest('[data-pzcopy]');
    if (cp) {
      const r = img(sceneOf(z)), rc = (r && r.recipe) || {};
      const txt = cp.dataset.pzcopy === 'place' ? (rc.place || z.place || '') : (rc.prompt || '');
      if (!txt.trim()) { toast(cp.dataset.pzcopy === 'place' ? 'This window has no description yet.' : 'This version has no saved prompt (it’s your own picture).'); return; }
      navigator.clipboard.writeText(txt.trim()).then(() => toast('Copied.'), () => toast('Couldn’t copy. Open the picture in History and copy it from there.'));
      return;
    }
    if (t.closest('[data-pzrm]')) { const v = sceneOf(z); z.versions.splice(z.vi, 1); if (z.meta) delete z.meta[v]; z.vi = z.versions.length - 1; if (P.blendId) P.view = 'result'; save(); renderPanel(); renderStage(); toast(`Picture removed from ${z.name}. It’s still in History.`); return; }
    if (t.closest('[data-pzdel]')) { if (sceneOf(z) && !confirm(`Remove ${z.name}? Its pictures stay in History.`)) return; P.zones = P.zones.filter(x => x !== z); P.sel = P.zones[0] ? P.zones[0].id : null; rebuild('Updating the windows…'); }
  });
  fileIn.onchange = async () => {
    const f = [...fileIn.files]; if (!f.length) return;
    const recs = await importFiles(f, false); if (!recs.length) return;
    const z = zoneOf(fileFor.zone);
    if (fileFor.kind === 'layout') setLayout(recs[recs.length - 1].id);
    else if (fileFor.kind === 'scene' && z) useOwn(z, recs[0].id);
    else if (fileFor.kind === 'ref' && z) { recs.forEach(r => { if (!z.refs.includes(r.id)) z.refs.push(r.id); }); save(); renderPanel(); }
  };
  view.addEventListener('click', e => {
    const s = e.target.closest('[data-pv]'); if (s && !s.disabled) { P.view = s.dataset.pv; P.picking = false; renderStage(); renderPanel(); return; }
    const ch = e.target.closest('[data-pzsel]'); if (ch) { P.sel = ch.dataset.pzsel; renderPanel(); renderStage(); return; }
    if (e.target.closest('#ptDl')) download_();
  });
  $q('#ptNums').onchange = paint;
  async function download_() {
    if (P.view === 'final' && img(P.blendId)) { download(img(P.blendId)); return; }
    try {
      if (P.view !== 'layout') await loadAll(); const c = P.view === 'layout' ? P.layoutC : compose(P.W, P.H, true);
      const b = await new Promise(res => c.toBlob(res, 'image/png')), u = URL.createObjectURL(b), a = document.createElement('a');
      a.href = u; a.download = `portals-${P.view === 'layout' ? 'layout' : 'windows'}.png`; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(u), 60000);
    } catch (e) { toast(friendly(e)); }
  }
  window.addEventListener('resize', () => { if (!view.hidden) paint(); });

  // dropping pictures: on a window's references, on a window in the picture (uses it as that scene), or as the layout
  async function dropped(e) {
    const id = e.dataTransfer.getData('text/x-darkroom');
    if (id && img(id)) return [id];
    const files = [...e.dataTransfer.files]; if (!files.length) return [];
    return (await importFiles(files, false)).map(r => r.id);
  }
  panel.addEventListener('dragover', e => { const r = e.target.closest('[data-pzrefs]'); panel.querySelectorAll('.pz-refs.over').forEach(x => x !== r && x.classList.remove('over')); if (r) r.classList.add('over'); });
  window.addEventListener('drop', async e => {
    if (S.view !== 'portals') return;
    e.preventDefault(); e.stopImmediatePropagation();
    const dh = document.getElementById('dropHint'); if (dh) dh.hidden = true;
    panel.querySelectorAll('.pz-refs.over').forEach(x => x.classList.remove('over'));
    const refBox = e.target.closest && e.target.closest('[data-pzrefs]'), canvas = e.target.closest && e.target.closest('#ptCanvas');
    const ids = await dropped(e); if (!ids.length) return;
    if (refBox) { const z = zoneOf(refBox.dataset.pzrefs); if (z) { ids.forEach(id => { if (!z.refs.includes(id)) z.refs.push(id); }); save(); renderPanel(); toast('Added as a reference for ' + z.name + '.'); } return; }
    if (canvas && P.layoutC && !(e.target.closest('[data-ptlayout]'))) {
      const b = canvas.getBoundingClientRect(), z = labelAt((e.clientX - b.left) / b.width, (e.clientY - b.top) / b.height);
      if (z) { useOwn(z, ids[0]); return; }
    }
    setLayout(ids[ids.length - 1]);
  }, true);
  // clicking a picture in History while Portals is open: the layout if there isn't one, otherwise a reference for the open window
  document.addEventListener('click', e => {
    if (S.view !== 'portals') return;
    const it = e.target.closest('#libGrid [data-drag]'); if (!it || e.target.closest('.lib-info,.lib-proj')) return;
    e.preventDefault(); e.stopImmediatePropagation();
    const id = it.dataset.drag, z = zoneOf(P.sel);
    if (!P.layoutC || !z) { setLayout(id); return; }
    if (!z.refs.includes(id)) z.refs.push(id); save(); renderPanel(); toast(`Added as a reference for ${z.name}. To use it as the layout instead, press Open layout or drop it on step 1.`);
  }, true);

  // from the picture viewer
  const menu = document.getElementById('vUseMenu');
  if (menu && !document.getElementById('vPortals')) {
    const b = document.createElement('button'); b.type = 'button'; b.id = 'vPortals';
    b.innerHTML = icoS(ICON, 16) + '<span>Use as a Portals layout</span>';
    const before = document.getElementById('vRecreate'); menu.insertBefore(b, before || null);
    b.onclick = () => { const r = typeof currentViewed === 'function' ? currentViewed() : null; menu.hidden = true; if (!r) return; const vw = document.getElementById('viewer'); if (vw && vw.open) vw.close(); setLayout(r.id); };
  }
  { const last = store.get('pandora.portals.src', null); if (last) P.layoutId = last; if (S.view === 'portals') setView('portals'); }

  window.PandoraPortals = { P, setLayout, makeZone, makeAll, blend, compose, buildMasks, exportPSD };
})();
