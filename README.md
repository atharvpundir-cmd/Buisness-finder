# BuisnessFind Dubai

A hyperlocal business directory and interactive geospatial discovery engine for Dubai, UAE — built with React 18, TypeScript, Vite, Tailwind CSS and Leaflet.

```bash
npm install
npm run dev      # -> http://localhost:4321
```

No API keys required. Map tiles come from OpenStreetMap/CARTO and Esri; the business catalogue is a local seed database.

---

## What it does

**Hyperlocal distance engine.** Pick one of 12 real Dubai districts, or hit *Use my GPS location* to read `navigator.geolocation` and snap to the nearest district centroid. Every business distance is recomputed with the Haversine formula against the active origin, live, via `useMemo`.

**Dynamic radius.** Preset chips from 1 km to 25 km filter the listings and redraw the translucent radius circle on the map in the same pass.

**Interactive map.** Split-screen on desktop (cards left, sticky full-height map right), tabbed List/Map toggle on mobile. Custom `divIcon` pins are colour-coded per category and carry a live star-rating badge; your own position is a pulsating red marker. Controls: Street/Satellite imagery toggle, *My location* re-centre, and *Fit all* bounding-box.

**Filtering.** Instant search across names, Arabic names, tags, subcategories, amenities and addresses; category carousel with live per-category counts; Open Now, Verified Only and 4.5+ toggles; sort by distance, rating, reviews or name. Favourites persist to `localStorage`.

**Modals.** Full business profile (photo carousel, live open/closed state, weekly hours table, amenities, WhatsApp and Google Maps navigation); a *List your business* form that places a new pin in the chosen district; and a *Smart Finder* concierge that parses a natural-language request into a concrete filter patch.

---

## Leaflet crash safeguards

Leaflet dies loudly on `Invalid LatLng object: (NaN, NaN)` and takes the map with it. Three defences, all in `src/components/InteractiveBusinessMap.tsx`:

1. **`toValidCoord` / `isValidCoordPair`** — every coordinate is funnelled through these guards before it reaches Leaflet. Businesses without usable coordinates are filtered out rather than plotted.
2. **Container size validation** — `hasUsableSize()` checks `map.getSize()` returns non-zero dimensions before any `setView`, `fitBounds`, marker or circle update. A zero-size container is what produces NaN projections during layout transitions.
3. **`ResizeObserver` + `invalidateSize`** — switching between the split view and the mobile tabs resizes the container without firing a window `resize`, leaving Leaflet with a stale pixel origin. The observer calls `invalidateSize({ animate: false })` on the next animation frame.

Every Leaflet mutation is additionally wrapped in `try/catch`, so a container detached mid-frame degrades instead of crashing.

---

## Structure

```
src/
  types.ts                       Business, UserLocation, BusinessCategory, OpeningHourDay, FilterState
  data/
    dubaiAreas.ts                12 district centroids
    categories.ts                10 categories with Lucide icon names + colour schemes
    businesses.ts                34 seeded businesses, Haversine, opening-hours engine
  lib/
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
