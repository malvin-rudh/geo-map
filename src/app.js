/* global d3, topojson */
// Geopolitical map. All content comes from dist/data.json (built from data/*.json).
(async function () {
  'use strict';

  // Arrow types are told apart four ways: colour, line style, arrowhead shape and icon.
  // Colours match the --military, --sanctions, --trade, --diplomacy and --proxy tokens in style.css.
  const TYPES = {
    military: {label: 'Military action or threat', short: 'Military', color: '#F0674B', dash: null, width: 2.6, head: 'triangle', trim: 9,
      glyph: 'M0-5V-2.4M0 2.4V5M-5 0H-2.4M2.4 0H5M2 0A2 2 0 1 1-2 0A2 2 0 1 1 2 0'},
    sanctions: {label: 'Sanctions or economic pressure', short: 'Sanctions', color: '#B996F2', dash: '9 7', width: 5, head: 'bar', trim: 0, hollow: true,
      glyph: 'M4.2 0A4.2 4.2 0 1 1-4.2 0A4.2 4.2 0 1 1 4.2 0M-3 3L3-3'},
    trade: {label: 'Trade or energy', short: 'Trade, energy', color: '#43C4A3', dash: '16 5', width: 1.8, head: 'chevron', trim: 1,
      glyph: 'M0-5C2.6-2 4 0 4 1.6A4 4 0 0 1-4 1.6C-4 0-2.6-2 0-5Z'},
    diplomacy: {label: 'Diplomacy or talks', short: 'Diplomacy', color: '#6AAEF2', dash: '0.1 6.5', width: 3, head: 'circle', trim: 9,
      glyph: 'M-4.6-3.6H4.6V1.8H-0.4L-3 4.4V1.8H-4.6Z'},
    proxy: {label: 'Proxy or alliance support', short: 'Proxy support', color: '#D9CCB0', dash: '11 4 2 4', width: 2, head: 'diamond', trim: 11,
      glyph: 'M0.4 0A2.6 2.6 0 1 1-4.8 0A2.6 2.6 0 1 1 0.4 0M4.8 0A2.6 2.6 0 1 1-0.4 0A2.6 2.6 0 1 1 4.8 0'},
  };
  const PLACE_KINDS = {
    capital: 'Capital city', city: 'City', nuclear: 'Nuclear site', base: 'Military base', port: 'Port',
    energy: 'Oil or gas site', chokepoint: 'Narrow sea passage', water: 'Sea or gulf', territory: 'Area or landmark',
  };
  const STATUS = {active: 'Ongoing', escalating: 'Getting worse', easing: 'Easing', talks: 'In talks', ceasefire: 'Ceasefire', frozen: 'Frozen'};
  const NAME_FIX = {'United States of America': 'United States', 'Dem. Rep. Congo': 'DR Congo', 'Central African Rep.': 'Central African Republic',
    'S. Sudan': 'South Sudan', 'Bosnia and Herz.': 'Bosnia and Herzegovina', 'Dominican Rep.': 'Dominican Republic', 'Eq. Guinea': 'Equatorial Guinea',
    'W. Sahara': 'Western Sahara', 'N. Cyprus': 'Northern Cyprus', 'Czechia': 'Czech Republic', 'Côte d\'Ivoire': 'Ivory Coast', 'eSwatini': 'Eswatini'};
  const VIEWS = {
    iran: [43.5, 24, 64, 40.5], mideast: [25, 10.5, 66, 42.5],
    'Middle East': [25, 10.5, 66, 42.5], Europe: [-10, 35, 60, 64], 'Asia-Pacific': [96, -6, 150, 50], 'South Asia': [58, 5, 98, 40],
    Africa: [-20, -35, 54, 38], Americas: [-130, -55, -32, 55],
  };

  const $ = (s) => document.querySelector(s);
  const el = (tag, props = {}, kids = []) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (k === 'class') n.className = v; else if (k === 'text') n.textContent = v; else if (k.startsWith('on')) n.addEventListener(k.slice(2), v); else n.setAttribute(k, v);
    }
    for (const kid of [].concat(kids)) if (kid) n.append(kid);
    return n;
  };
  const fmtDate = (iso) => {
    const [y, m, d] = iso.split('-').map(Number);
    return `${d} ${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${y}`;
  };
  const fmtStart = (s) => (s.length === 10 ? fmtDate(s) : fmtDate(`${s}-01`).replace(/^1 /, ''));
  const isPhone = () => window.innerWidth <= 760;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const [data, topo] = await Promise.all([
    fetch('dist/data.json').then((r) => r.json()),
    fetch('vendor/countries-50m.json').then((r) => r.json()),
  ]);
  const places = data.places, events = data.events, arrows = data.arrows, meta = data.meta;
  const placeById = new Map(places.map((p) => [p.id, p]));
  const eventById = new Map(events.map((e) => [e.id, e]));
  for (const e of events) e.arrows = arrows.filter((a) => a.event === e.id);

  // Bend each arrow so that arrows between the same two places do not sit on top of each other.
  const pairCount = new Map();
  arrows.forEach((a, i) => {
    const key = [a.from, a.to].sort().join('|');
    const n = pairCount.get(key) || 0;
    pairCount.set(key, n + 1);
    const mag = 0.2 + Math.floor(n / 2) * 0.17 + (i % 3) * 0.025;
    a.bend = (n % 2 === 0 ? 1 : -1) * mag;
    a.flip = a.from > a.to; // keeps the two directions of one pair on opposite sides
  });

  const countries = topojson.feature(topo, topo.objects.countries).features.map((f) => {
    const name = NAME_FIX[f.properties.name] || f.properties.name;
    let main = f;
    if (f.geometry && f.geometry.type === 'MultiPolygon') {
      let best = -1;
      for (const coords of f.geometry.coordinates) {
        const poly = {type: 'Polygon', coordinates: coords};
        const area = d3.geoArea(poly);
        if (area > best) { best = area; main = {type: 'Feature', geometry: poly}; }
      }
    }
    return {feature: f, main, name, hasPlace: places.some((p) => p.country === name)};
  }).filter((c) => c.feature.geometry);
  const countryByName = new Map(countries.map((c) => [c.name, c]));

  const svg = d3.select('#map');
  const gGrid = d3.select('#grid'), gLand = d3.select('#land'), gArrows = d3.select('#arrows'), gPlaces = d3.select('#places'), gLabels = d3.select('#labels');
  const projection = d3.geoNaturalEarth1().rotate([-11, 0]);
  const path = d3.geoPath(projection);
  let W = 0, H = 0, T = d3.zoomIdentity;

  const state = {types: new Set(Object.keys(TYPES)), region: 'All', focusEvent: null, focusArrow: null, selPlace: null, selCountry: null, view: 'world'};

  const pads = () => (isPhone() ? {l: 8, t: 160, r: 8, b: 64} : {l: 384, t: 132, r: 16, b: 60});

  function layout() {
    W = window.innerWidth; H = window.innerHeight;
    const p = pads();
    // Fit the lands people live on, not the empty Pacific and Antarctica. The rest is one drag away.
    projection.fitExtent([[p.l, p.t], [W - p.r, H - p.b]], {type: 'MultiPoint', coordinates: [[-128, 70], [-128, -48], [152, 70], [152, -48], [11, 72], [11, -50]]});
    gLand.selectAll('path').attr('d', (c) => path(c.feature));
    gGrid.select('.sphere').attr('d', path({type: 'Sphere'}));
    gGrid.select('.graticule').attr('d', path(d3.geoGraticule10()));
    for (const c of countries) {
      const ctr = path.centroid(c.main);
      c.xy = ctr.every(Number.isFinite) ? ctr : null;
      c.size = Math.sqrt(Math.max(path.area(c.main), 0));
    }
    for (const pl of places) pl.xy = projection([pl.lon, pl.lat]);
  }

  gGrid.append('path').attr('class', 'sphere');
  gGrid.append('path').attr('class', 'graticule');
  gLand.selectAll('path').data(countries).join('path').attr('class', 'country')
    .on('click', (ev, c) => selectCountry(c.name, false))
    .on('pointermove', (ev, c) => showTip(ev, c.name, 'Country'))
    .on('pointerleave', hideTip);

  const zoom = d3.zoom().scaleExtent([1, 80]).on('zoom', (ev) => {
    T = ev.transform;
    gLand.attr('transform', T);
    gGrid.attr('transform', T);
    if (ev.sourceEvent) setView(null);
    scheduleDraw();
  });
  svg.call(zoom).on('dblclick.zoom', null);

  let drawQueued = false;
  function scheduleDraw() {
    if (drawQueued) return;
    drawQueued = true;
    requestAnimationFrame(() => { drawQueued = false; draw(); });
  }

  // ---------- drawing (screen space, redrawn on every zoom) ----------
  const visibleArrows = () => arrows.filter((a) => state.types.has(a.type) && (state.region === 'All' || eventById.get(a.event).region === state.region));
  const isDim = (a) => (state.focusArrow && state.focusArrow !== a.id) || (!state.focusArrow && state.focusEvent && state.focusEvent !== a.event);
  const isHot = (a) => state.focusArrow === a.id || (!state.focusArrow && state.focusEvent === a.event);

  // Symbols are drawn a little smaller on phones so the world view stays readable.
  const sym = () => (isPhone() ? 0.68 : 1);
  function headShape(kind, e, u, k = 1) {
    const v = [-u[1], u[0]];
    const pt = (du, dv) => `${(e[0] + u[0] * du * k + v[0] * dv * k).toFixed(1)} ${(e[1] + u[1] * du * k + v[1] * dv * k).toFixed(1)}`;
    if (kind === 'triangle') return {d: `M${pt(0, 0)}L${pt(-12, 6)}L${pt(-12, -6)}Z`, fill: true};
    if (kind === 'bar') return {d: `M${pt(0, 7.5)}L${pt(0, -7.5)}`, fill: false, w: 3.4};
    if (kind === 'chevron') return {d: `M${pt(-10, 6.5)}L${pt(0, 0)}L${pt(-10, -6.5)}`, fill: false, w: 2.2};
    if (kind === 'circle') return {d: `M${pt(0, 0)}A${5 * k} ${5 * k} 0 1 1 ${pt(-10, 0)}A${5 * k} ${5 * k} 0 1 1 ${pt(0, 0)}Z`, fill: true};
    return {d: `M${pt(0, 0)}L${pt(-7, 5.2)}L${pt(-14, 0)}L${pt(-7, -5.2)}Z`, fill: true}; // diamond
  }

  function arrowGeom(a) {
    const A = T.apply(placeById.get(a.from).xy), B = T.apply(placeById.get(a.to).xy);
    const dx = B[0] - A[0], dy = B[1] - A[1], d = Math.hypot(dx, dy) || 1;
    let nx = -dy / d, ny = dx / d;
    if (ny > 0) { nx = -nx; ny = -ny; } // default bow is upward on screen, like a great circle in the north
    const s = a.bend * (a.flip ? -1 : 1);
    const C = [(A[0] + B[0]) / 2 + nx * d * s, (A[1] + B[1]) / 2 + ny * d * s];
    const unit = (p, q) => { const l = Math.hypot(q[0] - p[0], q[1] - p[1]) || 1; return [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; };
    const u0 = unit(A, C), u1 = unit(C, B);
    const t = TYPES[a.type];
    const k = sym();
    const start = [A[0] + u0[0] * 7 * k, A[1] + u0[1] * 7 * k];
    const tip = [B[0] - u1[0] * 7 * k, B[1] - u1[1] * 7 * k];
    const end = [tip[0] - u1[0] * t.trim * k, tip[1] - u1[1] * t.trim * k];
    const mid = [0.25 * start[0] + 0.5 * C[0] + 0.25 * end[0], 0.25 * start[1] + 0.5 * C[1] + 0.25 * end[1]];
    return {d: `M${start[0].toFixed(1)} ${start[1].toFixed(1)}Q${C[0].toFixed(1)} ${C[1].toFixed(1)} ${end[0].toFixed(1)} ${end[1].toFixed(1)}`, tip, u1, mid, len: d};
  }

  function placeMark(p) {
    const k = p.type;
    if (k === 'capital') return '<circle class="mark" r="5"/><circle class="mark solid" r="1.7" stroke="none"/>';
    if (k === 'city') return '<circle class="mark solid" r="3.3"/>';
    if (k === 'nuclear') return '<path class="mark" d="M0-6L6 0L0 6L-6 0Z"/>';
    if (k === 'base') return '<path class="mark" d="M0-6L6 4.6H-6Z"/>';
    if (k === 'port' || k === 'energy') return '<rect class="mark" x="-4.4" y="-4.4" width="8.8" height="8.8"/>';
    if (k === 'chokepoint') return '<path class="mark" d="M-4.5-4.5L4.5 4.5M4.5-4.5L-4.5 4.5"/>';
    if (k === 'territory') return '<circle class="mark" r="3.6"/>';
    return '';
  }
  const minK = (p) => (p.tier === 1 ? 3 : p.tier === 2 ? 5.5 : 8.5);

  function draw() {
    const k = T.k;
    const vis = visibleArrows();
    const endpoints = new Set(), hotPlaces = new Set();
    for (const a of vis) {
      endpoints.add(a.from); endpoints.add(a.to);
      if (isHot(a)) { hotPlaces.add(a.from); hotPlaces.add(a.to); }
    }
    if (state.selPlace) hotPlaces.add(state.selPlace);
    const anyFocus = state.focusArrow || state.focusEvent;

    // arrows
    const sel = gArrows.selectAll('g.arrow').data(vis, (a) => a.id);
    sel.exit().remove();
    const ent = sel.enter().append('g').attr('class', 'arrow').attr('tabindex', 0).attr('role', 'button')
      .on('click', (ev, a) => { ev.stopPropagation(); selectArrow(a.id); })
      .on('keydown', (ev, a) => { if (ev.key === 'Enter') selectArrow(a.id); })
      .on('pointermove', (ev, a) => showTip(ev, a.label, `${TYPES[a.type].label}. Click for details`))
      .on('pointerleave', hideTip);
    ent.append('path').attr('class', 'arrow-hit');
    ent.append('path').attr('class', 'arrow-line');
    ent.append('path').attr('class', 'arrow-core');
    ent.append('path').attr('class', 'arrow-head');
    const badge = ent.append('g').attr('class', 'arrow-badge');
    badge.append('circle').attr('class', 'badge').attr('r', 9);
    badge.append('path').attr('class', 'glyph');
    ent.append('title');
    const all = ent.merge(sel);
    all.each(function (a) {
      const t = TYPES[a.type], g = arrowGeom(a), n = d3.select(this);
      const head = headShape(t.head, g.tip, g.u1, sym());
      n.attr('class', `arrow${isDim(a) ? ' is-dim' : ''}${isHot(a) ? ' is-hot' : ''}`).attr('aria-label', `${a.label}. ${t.label}`);
      n.select('.arrow-hit').attr('d', g.d);
      n.select('.arrow-line').attr('d', g.d).attr('stroke', t.color).attr('stroke-width', t.width).attr('stroke-dasharray', t.dash).attr('stroke-linecap', t.hollow ? 'butt' : 'round');
      // Hollow lines (sanctions) get a dark core, so they read as outlined dashes even without colour.
      n.select('.arrow-core').attr('d', t.hollow ? g.d : null).attr('stroke-dasharray', t.dash);
      n.select('.arrow-head').attr('d', head.d).attr('fill', head.fill ? t.color : 'none').attr('stroke', t.color)
        .attr('stroke-width', head.fill ? 1 : head.w).attr('stroke-linecap', 'round').attr('stroke-linejoin', 'round');
      n.select('.arrow-badge').attr('transform', `translate(${g.mid[0].toFixed(1)},${g.mid[1].toFixed(1)}) scale(${sym()})`).attr('display', g.len < 60 * sym() ? 'none' : null);
      n.select('.badge').attr('stroke', t.color);
      n.select('.glyph').attr('d', t.glyph).attr('stroke', t.color);
    });
    all.filter((a) => isHot(a)).raise();

    // places
    const shown = places.filter((p) => p.xy && (k >= minK(p) || endpoints.has(p.id) || hotPlaces.has(p.id)));
    const psel = gPlaces.selectAll('g.place').data(shown, (p) => p.id);
    psel.exit().remove();
    const pent = psel.enter().append('g')
      .on('click', (ev, p) => { ev.stopPropagation(); selectPlace(p.id, false); })
      .on('pointermove', (ev, p) => showTip(ev, p.name, `${PLACE_KINDS[p.type]}${p.type === 'water' ? '' : `, ${p.country}`}. ${p.why}`))
      .on('pointerleave', hideTip);
    pent.each(function (p) { this.innerHTML = `<circle class="place-hit" r="13"/>${placeMark(p)}`; });
    const boxes = [];
    pent.merge(psel).each(function (p) {
      const s = T.apply(p.xy);
      p.s = s;
      d3.select(this).attr('transform', `translate(${s[0].toFixed(1)},${s[1].toFixed(1)}) scale(${sym()})`)
        .attr('class', `place${anyFocus && !hotPlaces.has(p.id) ? ' is-dim' : ''}${hotPlaces.has(p.id) ? ' is-hot' : ''}`);
      if (p.type !== 'water') boxes.push([s[0] - 7, s[1] - 7, s[0] + 7, s[1] + 7]);
    });

    // labels, placed greedily so they never overlap
    const out = [];
    const free = (b) => b[0] > 2 && b[2] < W - 2 && b[1] > 2 && b[3] < H - 2 && !boxes.some((o) => b[0] < o[2] && b[2] > o[0] && b[1] < o[3] && b[3] > o[1]);
    const tryPlace = (text, cls, cands, charW) => {
      const w = text.length * charW + 8;
      for (const c of cands) {
        const x0 = c.anchor === 'start' ? c.x : c.anchor === 'end' ? c.x - w : c.x - w / 2;
        const b = [x0, c.y - 11, x0 + w, c.y + 4];
        if (free(b)) { boxes.push(b); out.push({text, cls, x: c.x, y: c.y, anchor: c.anchor}); return true; }
      }
      return false;
    };
    const labelPlaces = shown.filter((p) => k >= minK(p) || hotPlaces.has(p.id))
      .sort((a, b) => (hotPlaces.has(b.id) - hotPlaces.has(a.id)) || (a.tier - b.tier));
    for (const p of labelPlaces) {
      const [x, y] = p.s;
      if (x < -20 || x > W + 20 || y < -20 || y > H + 20) continue;
      const hot = hotPlaces.has(p.id) ? ' is-hot' : '';
      if (p.type === 'water') {
        tryPlace(p.name.toUpperCase(), 'lbl water-lbl', [{x, y: y + 4, anchor: 'middle'}, {x, y: y - 10, anchor: 'middle'}, {x, y: y + 18, anchor: 'middle'}], 7.4);
      } else {
        tryPlace(p.name, `lbl${hot}`, [{x: x + 10, y: y + 4, anchor: 'start'}, {x: x - 10, y: y + 4, anchor: 'end'}, {x, y: y - 11, anchor: 'middle'}, {x, y: y + 20, anchor: 'middle'},
          {x: x + 9, y: y - 8, anchor: 'start'}, {x: x + 9, y: y + 16, anchor: 'start'}, {x: x - 9, y: y - 8, anchor: 'end'}, {x: x - 9, y: y + 16, anchor: 'end'}], 6.7);
      }
    }
    const cands = [];
    for (const c of countries) {
      if (!c.xy) continue;
      const size = c.size * k;
      if (!(size >= 40 || (c.hasPlace && size >= 15 && k >= 4.5) || c.name === state.selCountry)) continue;
      const [x, y] = T.apply(c.xy);
      if (x < 0 || x > W || y < 0 || y > H) continue;
      cands.push({c, x, y, size});
    }
    cands.sort((a, b) => b.size - a.size);
    for (const {c, x, y} of cands) {
      tryPlace(c.name.toUpperCase(), 'lbl country-lbl', [{x, y: y + 4, anchor: 'middle'}, {x, y: y - 12, anchor: 'middle'}, {x, y: y + 20, anchor: 'middle'}, {x, y: y - 26, anchor: 'middle'}, {x, y: y + 34, anchor: 'middle'}], 7.6);
    }
    gLabels.selectAll('text').data(out).join('text').attr('class', (d) => d.cls).attr('x', (d) => d.x.toFixed(1)).attr('y', (d) => d.y.toFixed(1))
      .attr('text-anchor', (d) => d.anchor).text((d) => d.text);

    gLand.selectAll('path').classed('is-selected', (c) => c.name === state.selCountry).classed('is-focus', (c) => state.view === 'iran' && c.name === 'Iran');
  }

  // ---------- moving the view ----------
  function geoBox([lon0, lat0, lon1, lat1]) {
    const xs = [], ys = [];
    for (let i = 0; i <= 6; i++) for (let j = 0; j <= 6; j++) {
      const p = projection([lon0 + (lon1 - lon0) * i / 6, lat0 + (lat1 - lat0) * j / 6]);
      if (p) { xs.push(p[0]); ys.push(p[1]); }
    }
    return [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]];
  }
  function fly(box, maxK = 80) {
    const p = pads();
    if (isPhone()) { if (!$('#card').hidden || !$('#top').classList.contains('is-closed')) p.b = H * 0.55; }
    else p.r = !$('#card').hidden ? 400 : 360; // keep clear of the card or the legend
    const w = Math.max(W - p.l - p.r, 60), h = Math.max(H - p.t - p.b, 60);
    const bw = Math.max(box[1][0] - box[0][0], 1e-3), bh = Math.max(box[1][1] - box[0][1], 1e-3);
    const k = Math.max(1, Math.min(maxK, 0.88 * Math.min(w / bw, h / bh)));
    const cx = (box[0][0] + box[1][0]) / 2, cy = (box[0][1] + box[1][1]) / 2;
    const t = d3.zoomIdentity.translate(p.l + w / 2 - k * cx, p.t + h / 2 - k * cy).scale(k);
    svg.transition().duration(reduceMotion ? 0 : 900).call(zoom.transform, t);
  }
  const flyWorld = () => svg.transition().duration(reduceMotion ? 0 : 900).call(zoom.transform, d3.zoomIdentity);
  function flyToPlaces(ids, maxK) {
    const pts = ids.map((id) => placeById.get(id).xy).filter(Boolean);
    if (!pts.length) return;
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const padX = Math.max((Math.max(...xs) - Math.min(...xs)) * 0.2, 6), padY = Math.max((Math.max(...ys) - Math.min(...ys)) * 0.3, 6);
    fly([[Math.min(...xs) - padX, Math.min(...ys) - padY], [Math.max(...xs) + padX, Math.max(...ys) + padY]], maxK);
  }
  function setView(name) {
    state.view = name;
    document.querySelectorAll('[data-view]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.view === name)));
  }
  function goView(name) {
    setView(name);
    if (name === 'world') flyWorld(); else fly(geoBox(VIEWS[name]));
    scheduleDraw();
  }
  document.querySelectorAll('[data-view]').forEach((b) => b.addEventListener('click', () => goView(b.dataset.view)));

  // ---------- selection and cards ----------
  const card = $('#card'), cardBody = $('#card-body');
  const srcList = (sources) => el('ul', {}, sources.map((s) => el('li', {}, [
    el('a', {href: s.url, target: '_blank', rel: 'noopener noreferrer', text: s.title ? `${s.publisher}: ${s.title}` : s.publisher}),
    el('small', {text: `  Published ${fmtDate(s.published)}`}),
  ])));
  const typeTag = (type) => {
    const t = TYPES[type];
    const wrap = el('span', {class: 'kind'});
    wrap.innerHTML = `<svg width="22" height="22" viewBox="-11 -11 22 22"><circle class="ic-bg" r="9" stroke="${t.color}" stroke-width="1.4"/><path d="${t.glyph}" fill="none" stroke="${t.color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
    wrap.append(el('span', {class: 'label', text: t.label}));
    return wrap;
  };
  const unverifiedNote = (e) => {
    if (!e.verified) return el('div', {class: 'callout'}, [el('b', {text: 'Unverified. '}), document.createTextNode(e.verify_note || 'Only one independent source so far.')]);
    return e.verify_note ? el('p', {class: 'sub'}, [el('b', {text: 'Good to know: '}), document.createTextNode(e.verify_note)]) : null;
  };
  const arrowLinks = (list) => el('ul', {}, list.map((a) => el('li', {}, [
    el('button', {class: 'link-btn', text: a.label, onclick: () => selectArrow(a.id)}),
    el('small', {text: `  ${placeById.get(a.from).name} to ${placeById.get(a.to).name}`}),
  ])));
  function openCard(nodes) {
    cardBody.replaceChildren(...nodes.filter(Boolean));
    card.hidden = false;
    card.scrollTop = 0;
    if (isPhone()) { $('#top').classList.add('is-closed'); $('#top-toggle').setAttribute('aria-expanded', 'false'); }
    else compactLegend(true); // on a desktop the legend folds to its title so the card has room
  }
  function compactLegend(on) {
    if (isPhone()) return;
    legend.classList.toggle('is-compact', on);
    $('#legend-toggle').setAttribute('aria-expanded', String(!on));
    fitPanels();
  }
  function clearSelection(redraw = true) {
    state.focusArrow = null; state.focusEvent = null; state.selPlace = null; state.selCountry = null;
    card.hidden = true;
    compactLegend(false);
    syncTop();
    if (redraw) scheduleDraw();
  }
  $('#card-close').addEventListener('click', () => clearSelection());
  svg.on('click', () => { if (!card.hidden || state.focusEvent) clearSelection(); });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') clearSelection(); });

  function ensureVisible(e) {
    let changed = false;
    for (const a of e.arrows) if (!state.types.has(a.type)) { state.types.add(a.type); changed = true; }
    if (state.region !== 'All' && state.region !== e.region) { state.region = 'All'; $('#region-filter').value = 'All'; changed = true; }
    if (changed) syncFilters();
  }
  const full = (p) => (p.type === 'water' ? p.name : `${p.name}, ${p.country}`);
  function selectArrow(id) {
    const a = arrows.find((x) => x.id === id), e = eventById.get(a.event), from = placeById.get(a.from), to = placeById.get(a.to);
    ensureVisible(e);
    Object.assign(state, {focusArrow: id, focusEvent: e.id, selPlace: null, selCountry: null});
    const dl = el('dl');
    for (const [k, v] of [['Who', a.who], ['What', a.what], ['When', a.when], ['Why', a.why]]) dl.append(el('dt', {text: k}), el('dd', {text: v}));
    openCard([
      typeTag(a.type), el('h2', {text: a.label}),
      el('p', {class: 'sub', text: `${full(from)} to ${full(to)}`}),
      dl, unverifiedNote(e),
      el('h4', {class: 'label', text: 'Part of'}),
      el('button', {class: 'link-btn', text: e.title, onclick: () => selectEvent(e.id)}),
      el('h4', {class: 'label', text: 'Sources'}), srcList(a.sources),
    ]);
    if (isPhone()) { setView(null); flyToPlaces([a.from, a.to], 14); } // the card covers half a phone screen, so bring the arrow into the free half
    syncTop(); scheduleDraw();
  }
  function selectEvent(id, doFly = true) {
    const e = eventById.get(id);
    ensureVisible(e);
    Object.assign(state, {focusArrow: null, focusEvent: id, selPlace: null, selCountry: null});
    const head = el('div', {class: 'kind'}, [el('span', {class: 'label', text: e.hotspot}), el('span', {class: 'tag', text: STATUS[e.status]}), e.verified ? null : el('span', {class: 'tag unverified', text: 'Unverified'})]);
    openCard([
      head, el('h2', {text: e.title}),
      el('p', {class: 'sub', text: `Latest development: ${fmtDate(e.date)}${e.started ? `. Began ${fmtStart(e.started)}` : ''}`}),
      ...e.summary.map((line) => el('p', {text: line})),
      el('p', {}, [el('b', {text: 'Why it matters: '}), document.createTextNode(e.why_it_matters)]),
      unverifiedNote(e),
      el('h4', {class: 'label', text: 'Arrows on the map'}), arrowLinks(e.arrows),
      el('h4', {class: 'label', text: 'Sources'}), srcList(e.sources),
    ]);
    syncTop();
    if (doFly) { setView(null); flyToPlaces(e.arrows.flatMap((a) => [a.from, a.to]), 14); }
    scheduleDraw();
  }
  function selectPlace(id, doFly = true) {
    const p = placeById.get(id);
    Object.assign(state, {focusArrow: null, focusEvent: null, selPlace: id, selCountry: null});
    const touching = arrows.filter((a) => a.from === id || a.to === id);
    openCard([
      el('span', {class: 'label', text: PLACE_KINDS[p.type]}), el('h2', {text: p.name}),
      p.type === 'water' ? null : el('p', {class: 'sub', text: p.country}),
      el('p', {}, [el('b', {text: 'Why it matters: '}), document.createTextNode(p.why)]),
      touching.length ? el('h4', {class: 'label', text: 'Arrows here'}) : null, touching.length ? arrowLinks(touching) : null,
      el('p', {class: 'sub', text: `Location: ${Math.abs(p.lat).toFixed(2)}° ${p.lat >= 0 ? 'N' : 'S'}, ${Math.abs(p.lon).toFixed(2)}° ${p.lon >= 0 ? 'E' : 'W'}`}),
    ]);
    syncTop();
    if (doFly) { setView(null); const d = p.type === 'water' ? 9 : p.tier === 3 ? 2.5 : 4; fly(geoBox([p.lon - d * 1.4, p.lat - d, p.lon + d * 1.4, p.lat + d])); } // a few degrees around it, so neighbours give context
    scheduleDraw();
  }
  function selectCountry(name, doFly = true) {
    const c = countryByName.get(name);
    Object.assign(state, {focusArrow: null, focusEvent: null, selPlace: null, selCountry: name});
    const here = places.filter((p) => p.country === name && p.type !== 'water');
    const touching = arrows.filter((a) => placeById.get(a.from).country === name || placeById.get(a.to).country === name);
    openCard([
      el('span', {class: 'label', text: 'Country'}), el('h2', {text: name}),
      here.length ? el('h4', {class: 'label', text: 'Places on this map'}) : null,
      here.length ? el('ul', {}, here.map((p) => el('li', {}, [el('button', {class: 'link-btn', text: p.name, onclick: () => selectPlace(p.id)}), el('small', {text: `  ${PLACE_KINDS[p.type]}`})]))) : null,
      touching.length ? el('h4', {class: 'label', text: 'Arrows touching this country'}) : null, touching.length ? arrowLinks(touching) : null,
      !here.length && !touching.length ? el('p', {class: 'sub', text: 'No tracked events here right now.'}) : null,
    ]);
    syncTop();
    if (doFly && c) { setView(null); fly(path.bounds(c.main), 30); }
    scheduleDraw();
  }

  // ---------- top events ----------
  $('#updated').replaceChildren('Last updated ', el('b', {text: fmtDate(meta.last_updated)}));
  $('#top-sub').textContent = 'The biggest stories now. Click one to see it on the map.';
  const topList = $('#top-list');
  for (const id of meta.top_events) {
    const e = eventById.get(id);
    const metaRow = el('div', {class: 'meta'}, [el('span', {class: 'tag', text: STATUS[e.status]}), e.verified ? null : el('span', {class: 'tag unverified', text: 'Unverified'}), el('span', {text: fmtDate(e.date)})]);
    const body = el('div', {}, [el('h3', {text: e.title}), ...e.summary.map((s) => el('p', {text: s})), metaRow]);
    topList.append(el('li', {'data-id': id}, el('button', {onclick: () => selectEvent(id)}, body)));
  }
  function syncTop() {
    topList.querySelectorAll('li').forEach((li) => li.classList.toggle('is-active', li.dataset.id === state.focusEvent));
    $('#show-all').hidden = !(state.focusEvent || state.focusArrow);
  }
  $('#show-all').addEventListener('click', () => clearSelection());
  const topPanel = $('#top');
  $('#top-toggle').addEventListener('click', () => {
    if (!isPhone()) return;
    const closed = topPanel.classList.toggle('is-closed');
    $('#top-toggle').setAttribute('aria-expanded', String(!closed));
    if (!closed) card.hidden = true;
  });
  const legend = $('#legend');
  $('#legend-toggle').addEventListener('click', () => {
    if (!isPhone()) { if (!card.hidden || legend.classList.contains('is-compact')) compactLegend(!legend.classList.contains('is-compact')); return; }
    $('#legend-toggle').setAttribute('aria-expanded', String(!legend.classList.toggle('is-closed')));
  });
  if (isPhone()) { topPanel.classList.add('is-closed'); legend.classList.add('is-closed'); }

  // ---------- filters and legend ----------
  const sample = (type) => {
    const t = TYPES[type], h = headShape(t.head, [50, 8], [1, 0]);
    return `<svg width="56" height="16" viewBox="0 0 56 16"><path d="M2 8H${50 - t.trim}" fill="none" stroke="${t.color}" stroke-width="${t.width}" stroke-linecap="${t.hollow ? 'butt' : 'round'}"${t.dash ? ` stroke-dasharray="${t.dash}"` : ''}/>${t.hollow ? `<path class="core" d="M2 8H${50 - t.trim}" stroke-dasharray="${t.dash}"/>` : ''}<path d="${h.d}" fill="${h.fill ? t.color : 'none'}" stroke="${t.color}" stroke-width="${h.fill ? 1 : h.w}" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };
  const icon = (type, size = 18) => {
    const t = TYPES[type];
    return `<svg width="${size}" height="${size}" viewBox="-11 -11 22 22"><circle class="ic-bg" r="9" stroke="${t.color}" stroke-width="1.4"/><path d="${t.glyph}" fill="none" stroke="${t.color}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  };
  const typeFilters = $('#type-filters');
  for (const type of Object.keys(TYPES)) {
    const b = el('button', {class: 'chip', 'data-type': type, 'aria-pressed': 'true', title: TYPES[type].label});
    b.innerHTML = icon(type);
    b.append(el('span', {text: TYPES[type].short}));
    b.addEventListener('click', () => {
      if (state.types.has(type)) state.types.delete(type); else state.types.add(type);
      syncFilters(); scheduleDraw();
    });
    typeFilters.append(b);
  }
  const regionSel = $('#region-filter');
  const regions = ['All', ...['Middle East', 'Europe', 'Asia-Pacific', 'South Asia', 'Africa', 'Americas', 'Global'].filter((r) => events.some((e) => e.region === r))];
  for (const r of regions) regionSel.append(el('option', {value: r, text: r === 'All' ? 'All regions' : r}));
  regionSel.addEventListener('change', () => {
    state.region = regionSel.value;
    clearSelection(false);
    setView(null);
    if (VIEWS[state.region]) fly(geoBox(VIEWS[state.region])); else flyWorld();
    scheduleDraw();
  });
  function syncFilters() {
    typeFilters.querySelectorAll('[data-type]').forEach((b) => b.setAttribute('aria-pressed', String(state.types.has(b.dataset.type))));
  }
  const markSvg = (type) => `<svg width="56" height="18" viewBox="-28 -9 56 18">${placeMark({type})}</svg>`;
  $('#legend-body').innerHTML =
    Object.keys(TYPES).map((t) => `<div class="row">${sample(t)}${icon(t, 16)}<span>${TYPES[t].label}</span></div>`).join('') +
    '<div class="sep"></div>' +
    [['capital', 'Capital city'], ['city', 'City'], ['nuclear', 'Nuclear site'], ['base', 'Military base'], ['port', 'Port or oil site'], ['chokepoint', 'Narrow sea passage']]
      .map(([t, name]) => `<div class="row">${markSvg(t)}<span>${name}</span></div>`).join('') +
    `<div class="sep"></div><p class="fine">Summaries of the cited sources as of ${fmtDate(meta.last_updated)}. They may be out of date or wrong. Not advice.</p>`;

  // ---------- about ----------
  const about = $('#about'), aboutBtn = $('#about-toggle');
  const setAbout = (open) => { about.hidden = !open; aboutBtn.setAttribute('aria-expanded', String(open)); };
  aboutBtn.addEventListener('click', (ev) => { ev.stopPropagation(); setAbout(about.hidden); });
  document.addEventListener('click', (ev) => { if (!about.hidden && !ev.target.closest('#about')) setAbout(false); });
  window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape') setAbout(false); });

  // ---------- search ----------
  const searchIndex = [
    ...places.map((p) => ({kind: 'place', id: p.id, name: p.name, sub: p.type === 'water' ? PLACE_KINDS[p.type] : `${PLACE_KINDS[p.type]}, ${p.country}`, keys: [p.name, ...(p.aliases || [])].map((s) => s.toLowerCase())})),
    ...countries.map((c) => ({kind: 'country', id: c.name, name: c.name, sub: 'Country', keys: [c.name.toLowerCase(), c.feature.properties.name.toLowerCase()]})),
  ];
  const input = $('#search'), results = $('#results');
  let hits = [], active = 0;
  function runSearch() {
    const q = input.value.trim().toLowerCase();
    if (!q) { results.hidden = true; return; }
    hits = searchIndex.map((it) => {
      let score = 0;
      for (const key of it.keys) { if (key === q) score = Math.max(score, 4); else if (key.startsWith(q)) score = Math.max(score, 3); else if (key.includes(q)) score = Math.max(score, 1); }
      return {it, score: score + (it.kind === 'country' ? 0.5 : 0)};
    }).filter((h) => h.score >= 1).sort((a, b) => b.score - a.score || a.it.name.localeCompare(b.it.name)).slice(0, 8).map((h) => h.it);
    active = 0;
    results.replaceChildren(...(hits.length ? hits.map((it, i) => el('li', {class: i === 0 ? 'is-active' : '', onclick: () => pick(it)}, [el('span', {text: it.name}), el('small', {text: it.sub})]))
      : [el('li', {}, el('small', {text: 'Nothing found. Try a country or a big city.'}))]));
    results.hidden = false;
  }
  function pick(it) {
    results.hidden = true;
    input.value = it.name;
    input.blur();
    if (it.kind === 'place') selectPlace(it.id); else selectCountry(it.id);
  }
  input.addEventListener('input', runSearch);
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' && hits[active]) pick(hits[active]);
    else if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
      ev.preventDefault();
      if (!hits.length) return;
      active = (active + (ev.key === 'ArrowDown' ? 1 : hits.length - 1)) % hits.length;
      [...results.children].forEach((li, i) => li.classList.toggle('is-active', i === active));
    } else if (ev.key === 'Escape') results.hidden = true;
  });
  document.addEventListener('click', (ev) => { if (!ev.target.closest('.search')) results.hidden = true; });

  // ---------- tooltip ----------
  const tip = $('#tooltip');
  function showTip(ev, title, sub) {
    if (ev.pointerType === 'touch') return;
    tip.replaceChildren(el('b', {text: title}), el('span', {text: sub}));
    tip.hidden = false;
    const x = Math.min(ev.clientX + 14, W - tip.offsetWidth - 8), y = Math.min(ev.clientY + 16, H - tip.offsetHeight - 8);
    tip.style.left = `${x}px`; tip.style.top = `${y}px`;
  }
  function hideTip() { tip.hidden = true; }

  // ---------- start ----------
  let wasPhone = isPhone();
  window.addEventListener('resize', () => {
    layout();
    if (isPhone() !== wasPhone) { wasPhone = isPhone(); topPanel.classList.toggle('is-closed', wasPhone); legend.classList.toggle('is-closed', wasPhone); }
    draw();
  });
  if (isPhone()) input.placeholder = 'Search a place';
  const fitPanels = () => document.documentElement.style.setProperty('--legend-h', `${legend.offsetHeight}px`);
  window.addEventListener('resize', fitPanels);
  fitPanels();
  layout();
  draw();
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { fitPanels(); draw(); });
  // Small hook for automated checks. Read-only helpers, no data changes.
  window.geoMap = {state, selectArrow, selectEvent, selectPlace, selectCountry, goView, clearSelection, getTransform: () => ({k: T.k, x: T.x, y: T.y}), counts: () => ({arrows: gArrows.selectAll('g.arrow').size(), places: gPlaces.selectAll('g.place').size(), labels: gLabels.selectAll('text').size()})};
})();
