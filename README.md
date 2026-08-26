# BuisnessFind Dubai

A hyperlocal business directory and interactive geospatial discovery engine for Dubai, UAE — built with React 18, TypeScript, Vite, Tailwind CSS and Leaflet.

```bash
npm install
npm run dev      # -> http://localhost:4321
```

No API keys required, no billing, no rate limits. Map tiles come from OpenStreetMap/CARTO and Esri.

## The data

The directory ships with **26,435 real Dubai businesses** harvested from OpenStreetMap — every named shop, restaurant, cafe, clinic, pharmacy, hotel, gym, salon, bank, school and office within 30 km of the city centre. Around 1,600 of them fall inside a 5 km radius of JLT; roughly 9,200 within 25 km.

`public/data/dubai-osm.json` (4.3 MB, ~0.97 MB gzipped) holds trimmed OSM records. `src/lib/overpass.ts` normalises them into the `Business` shape at load: mapping OSM tags to the 16 categories, parsing the `opening_hours` grammar, and deriving addresses, phones, websites and amenity flags. On top of that sit 34 hand-curated listings with real photos, ratings and descriptions, which win on any duplicate.

Regenerate the dataset at any time:

```bash
python3 scripts/harvest-osm.py public/data/dubai-osm.json
```

`fetchLive()` in the same module can query Overpass directly for a fresh radius, but the public instances routinely take 80+ seconds and return 504s under load — which is exactly why the shipped snapshot is the default.

Business data is © OpenStreetMap contributors, licensed ODbL; the attribution is displayed in the footer as that licence requires.

---

## What it does

**Hyperlocal distance engine.** Pick one of 12 real Dubai districts, or hit *Use my GPS location* to read `navigator.geolocation` and snap to the nearest district centroid. Every business distance is recomputed with the Haversine formula against the active origin, live, via `useMemo`.

**Dynamic radius.** Preset chips from 1 km to 25 km filter the listings and redraw the translucent radius circle on the map in the same pass.

**Interactive map.** Split-screen on desktop (cards left, sticky full-height map right), tabbed List/Map toggle on mobile. Custom `divIcon` pins are colour-coded per category and carry a live star-rating badge; your own position is a pulsating red marker. Controls: Street/Satellite imagery toggle, *My location* re-centre, and *Fit all* bounding-box.

**Filtering.** Instant search across names, Arabic names, tags, subcategories, amenities and addresses; a 16-category carousel with live per-category counts; Open Now, Verified Only and 4.5+ toggles; sort by distance, rating, reviews or name. Favourites persist to `localStorage`. Results paginate 24 at a time, so 9,000 matches never means 9,000 DOM nodes.

**Accounts.** Sign up and sign in from the header, with a user menu, per-account saved businesses, and a gate on listing a business. Passwords are never stored — `src/lib/auth.ts` keeps a random 16-byte salt and a 210,000-iteration PBKDF2-SHA256 derivation per account via Web Crypto, re-derives on sign-in, and compares in length-independent time. Unknown emails still perform a derivation so a missing account and a wrong password cost the same.

> This is client-side only. There is no server, so accounts live in this browser's `localStorage` and anyone who can edit storage can bypass the check. It gates UI, not trust. `signUp`/`signIn` are the only two functions to swap when a real backend exists.

**Modals.** Full business profile (photo carousel, live open/closed state, weekly hours table, amenities, WhatsApp and Google Maps navigation); a *List your business* form that places a new pin in the chosen district; and a *Smart Finder* concierge that parses a natural-language request into a concrete filter patch.

---

## Leaflet crash safeguards

Leaflet dies loudly on `Invalid LatLng object: (NaN, NaN)` and takes the map with it. Three defences, all in `src/components/InteractiveBusinessMap.tsx`:

1. **`toValidCoord` / `isValidCoordPair`** — every coordinate is funnelled through these guards before it reaches Leaflet. Businesses without usable coordinates are filtered out rather than plotted.
2. **Container size validation** — `hasUsableSize()` checks `map.getSize()` returns non-zero dimensions before any `setView`, `fitBounds`, marker or circle update. A zero-size container is what produces NaN projections during layout transitions.
3. **`ResizeObserver` + `invalidateSize`** — switching between the split view and the mobile tabs resizes the container without firing a window `resize`, leaving Leaflet with a stale pixel origin. The observer calls `invalidateSize({ animate: false })` on the next animation frame.

### Viewport clustering

Leaflet cannot hold 26,000 markers. On every pan and zoom the map projects only the points currently in bounds into pixel space, buckets them into a 62 px grid, and instantiates one marker per bucket — a single business pin, or a count bubble that zooms to fit on click. Marker count is bounded by screen area (~250), not by dataset size, so every business stays addressable without the map ever holding more than a few hundred layers.

Every Leaflet mutation is additionally wrapped in `try/catch`, so a container detached mid-frame degrades instead of crashing.

---

## Structure

```
public/data/dubai-osm.json       26,435 harvested Dubai businesses
scripts/harvest-osm.py           Regenerates the dataset from Overpass
src/
  types.ts                       Business, UserLocation, BusinessCategory, OpeningHourDay, FilterState
  data/
    dubaiAreas.ts                12 district centroids
    categories.ts                16 categories with Lucide icon names + colour schemes
    businesses.ts                34 curated businesses, Haversine, opening-hours engine
  lib/
    auth.ts                      PBKDF2 account store, sessions, password strength
    overpass.ts                  OSM tag -> category mapping, opening_hours parser,
                                 dataset loader and live Overpass client
    links.ts                     wa.me / Google Maps / tel link builders
    icons.tsx                    name -> Lucide component map
  components/
    DubizzleNavbar.tsx           Sticky header, search, favourites, add-business
    LocationSelectorBar.tsx      District dropdown + GPS with accuracy readout
    RadiusFilterBar.tsx          Radius pills, quality toggles, sort
    DubizzleCategoryCarousel.tsx Scrolling category selector with counts
    DubizzleBusinessCard.tsx     Card with hover photo swap, badges, quick actions
    InteractiveBusinessMap.tsx   Leaflet map, custom pins, radius circle, layer switch
    BusinessDetailModal.tsx      Full profile
    AddBusinessModal.tsx         Onboarding form
    AiAssistantModal.tsx         Smart Finder + `planFromPrompt` intent parser
    AuthModal.tsx                Combined sign-in / sign-up with strength meter
  App.tsx                        State, distance recalculation, responsive layout
```

The Smart Finder is a deterministic rule engine (`planFromPrompt`), not a model call — results are instant, offline and never hallucinated.

## Scripts

| Command | Does |
|---|---|
| `npm run dev` | Vite dev server on port 4321 |
| `npm run build` | Typecheck then production build |
| `npm run preview` | Serve the built output |
| `npm run typecheck` | `tsc --noEmit` |

---

## Deployment

**Repository:** `atharvpundir-cmd/Buisness-finder` (private)
**Host:** Vercel — project `buisness-finder`, team *Atharv's team* (Hobby)

### Vercel settings

Vercel auto-detects the Vite preset; these are the effective values:

| Setting | Value |
|---|---|
| Framework preset | Vite |
| Install command | `npm install` |
| Build command | `npm run build` |
| Output directory | `dist` |

There is deliberately **no `vercel.json`**. The app has no client-side router, so a SPA catch-all rewrite is unnecessary — and would be harmful, since `/(.*) → /index.html` would turn a genuine 404 on `/data/dubai-osm.json` into an HTML response that fails to parse as JSON.

### Pushing changes

The Vercel project is linked to this repository, so a single push updates both:

```bash
npm run build          # sanity check before publishing
git add -A && git commit -m "..."
git push origin main   # GitHub updated; Vercel redeploys automatically
```

Pushing to `main` creates a **Production** deployment. Any other branch produces a **Preview** deployment with its own URL.

### A note on privacy

The deployed site is **public** — anyone with the URL can open it. The repository is private, so the source is not, but the running app is.

Two things follow from that:

- The in-app sign-in (`src/lib/auth.ts`) is **client-side only and bypassable**. It gates UI, not access. Every static asset, including `/data/dubai-osm.json`, can be fetched directly regardless of whether anyone is "signed in".
- Do not treat an unshared URL as private. `*.vercel.app` certificates appear in public Certificate Transparency logs and are scanned within minutes of issuance.

To genuinely restrict access later, in increasing order of cost:

1. **Vercel Middleware HTTP Basic Auth** — free, server-side, unlimited viewers, one shared password. Works on the Hobby plan and is Vercel's own documented workaround.
2. **Vercel Pro ($20/mo)** — native Shareable Links (viewers need no account) plus unlimited free Viewer seats.
3. **Password Protection** — Enterprise, or a **$150/mo** add-on on Pro. Not worth it for this use case.

Vercel's free Hobby plan *cannot* protect a production domain: its only mode, Standard Protection, covers preview deployments and generated deployment URLs but explicitly excludes production domains.
