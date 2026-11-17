# Geo Map

An interactive map of what is going on in the world right now. Click an arrow to see who did what to whom, when, why it matters and where it was reported. The Middle East and Iran are covered in depth, plus the other main hotspots.

It is a set of plain static files: no framework, no build step for the code, no accounts and nothing loaded from other sites. The map libraries, country shapes and fonts are bundled in `vendor/`, so it also works offline.

> Each event is a short summary written from the sources linked on its card, as of the "Last updated" date. It may be out of date or wrong; check the sources. Borders follow Natural Earth's default view and are not a position on any dispute. Not advice of any kind.

## Run it locally

```bash
node serve.mjs
```

Then open http://localhost:4650. Node 18 or newer, no install step. If the port is busy, add `--port 4651`. The server checks the data first: if a data file has a mistake it prints what is wrong and does not start.

Any static file server works too, because `dist/data.json` is committed:

```bash
python3 -m http.server 8000
```

## Put it online

The site is the repository root as it is. Nothing needs building on the host.

**Vercel**

1. Import the repository in Vercel.
2. Framework preset: **Other**. Build command: leave empty. Output directory: `.`
3. Deploy. Every push to the default branch redeploys.

**GitHub Pages (alternative)**

1. In the repository: Settings, Pages, Source: **Deploy from a branch**.
2. Branch: the default branch, folder: `/ (root)`. Save.
3. The map appears at `https://<user>.github.io/geo-map/` after a minute. The empty `.nojekyll` file makes Pages serve the files as they are.

Netlify works the same way: no build command, publish directory `.`.

## Use it

- **Top events** (left): the 5 to 7 biggest stories now. Click one: its arrows light up and the map flies there.
- **Arrows**: click one for a short card (who, what, when, why it matters, sources with dates).
- **Views** (top right): World, Middle East, Iran. The Iran view labels its cities, nuclear sites, the Strait of Hormuz and nearby US bases.
- **Search**: type a country or city, press Enter, the map flies there.
- **Filters**: switch arrow types on and off, or pick a region.
- Zoom in and more country and city names appear. Hover or click any place for one line on why it matters.
- An **Unverified** tag means the newest claim has fewer than two independent sources.

Arrow types are told apart four ways, so colour is never the only clue:

| Type | Colour | Line | Arrowhead | Icon |
|---|---|---|---|---|
| Military action or threat | vermilion | solid | triangle | crosshair |
| Sanctions or economic pressure | violet | hollow dashes | flat bar | circle with a slash |
| Trade or energy | jade | long dashes | open chevron | drop |
| Diplomacy or talks | blue | dots | circle | speech bubble |
| Proxy or alliance support | sand | dash and dot | diamond | two linked rings |

Violet and blue look alike to some colour-blind readers, which is why sanctions are drawn hollow and every type also has its own line, head and icon. `scripts/check-style.mjs` measures this.

An arrow from a capital city means an action by that country's government.

## Update it

All content is in `data/`. The code never needs to change for new events. An update is:

1. Edit the data files (see below).
2. Run the checks:

   ```bash
   node build.mjs --check          # schema, links between files, limits
   node scripts/check-coords.mjs   # every place against the gazetteer and its country
   node scripts/check-links.mjs    # every source link (needs the internet)
   node scripts/check-style.mjs    # no em or en dashes, colours only from tokens, arrow types distinguishable
   ```

3. Run `node build.mjs` to write `dist/data.json`, and commit `data/` and `dist/` together.

To remove an event, do not delete it: `node scripts/retire-event.mjs <event-id> --reason "why"` moves it to `data/archive/` with the date.

The author updates the map with an AI assistant skill that researches what changed, edits only the data files and runs these same checks.

### Add a place

In `data/places.json`:

```json
{"id": "ahvaz", "name": "Ahvaz", "country": "Iran", "lat": 0, "lon": 0, "type": "city", "tier": 2,
 "why": "Main city of Iran's oil-rich southwest.", "wiki": "Ahvaz", "osm": "Ahvaz, Iran"}
```

- `type`: capital, city, nuclear, base, port, energy, chokepoint, water, territory.
- `tier`: 1 shows first when zooming in, 3 shows last.
- `country` must match the name on the map (for example "United States", "Palestine", "DR Congo").
- Leave `lat` and `lon` at 0, then run `node scripts/fetch-gazetteer.mjs --apply`. It looks the place up in Wikipedia (`wiki` is the article title) and OpenStreetMap (`osm` is the search text) and fills in the coordinate. Do not type coordinates from memory.

### Add an arrow

In `data/arrows.json`. It must belong to an event in `data/events.json`:

```json
{"id": "my-event-1", "event": "my-event", "from": "tehran", "to": "ahvaz", "type": "diplomacy",
 "label": "Six words at most", "who": "Who acts on whom", "what": "What happened, with who says so",
 "when": "12 November 2026", "why": "Why it matters",
 "sources": [{"url": "https://...", "publisher": "Reuters", "title": "Page title", "published": "2026-11-12"}]}
```

- `type`: military, sanctions, trade, diplomacy, proxy.
- `from` and `to` are place ids.
- A new event needs: `id`, `hotspot`, `region`, `title`, `summary` (2 or 3 short lines), `why_it_matters`, `date`, `started`, `status`, `verified`, `verify_note`, `sources`. With fewer than two independent sources set `"verified": false` and say why in `verify_note`.

## How it is built

- `index.html`, `style.css`, `src/app.js`: the page. D3 draws the map. All paths are relative, so it runs from any folder or sub-path.
- `build.mjs`: validates `data/*.json` and writes `dist/data.json`, which the page loads.
- `serve.mjs`: optional local server, port 4650, localhost only. Runs the build first.
- `vendor/`: D3, TopoJSON client, Natural Earth country shapes, and the Newsreader, IBM Plex Sans and IBM Plex Sans Condensed fonts.
- Design: a dark graphite map with bone-coloured type. Newsreader (serif) for headlines, IBM Plex Sans for the interface, IBM Plex Sans Condensed for map labels. Every colour is a token in `:root` in `style.css`; the style check fails on any colour used outside them.

## Licence and sources

- Code: MIT, see `LICENSE`.
- Event summaries are original text written for this map, each with links to the reporting it is based on. Quotes are kept short and attributed.
- Third-party material in `vendor/` (Natural Earth, D3, TopoJSON, the fonts) keeps its own licence; see `THIRD-PARTY-NOTICES.txt`.
