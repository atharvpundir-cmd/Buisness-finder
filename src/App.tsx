import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Database, Heart, List, LoaderCircle, MapIcon, SearchX, SlidersHorizontal,
  TriangleAlert,
} from 'lucide-react';

import DubizzleNavbar from './components/DubizzleNavbar';
import LocationSelectorBar from './components/LocationSelectorBar';
import RadiusFilterBar from './components/RadiusFilterBar';
import DubizzleCategoryCarousel from './components/DubizzleCategoryCarousel';
import DubizzleBusinessCard from './components/DubizzleBusinessCard';
import InteractiveBusinessMap from './components/InteractiveBusinessMap';
import BusinessDetailModal from './components/BusinessDetailModal';
import AddBusinessModal from './components/AddBusinessModal';
import AiAssistantModal, { type AiPlan } from './components/AiAssistantModal';
import AuthModal, { type AuthMode } from './components/AuthModal';

import { BUSINESSES, calculateDistance, isOpenNow } from './data/businesses';
import { DEFAULT_AREA, DUBAI_AREAS } from './data/dubaiAreas';
import { loadShippedDataset, toBusiness } from './lib/overpass';
import { currentUser, signOut, type AuthUser } from './lib/auth';
import type {
  Business, CategoryId, FilterState, GpsStatus, UserLocation,
} from './types';

const FAVORITES_KEY = 'bf-dubai-favorites';
const PAGE_SIZE = 24;

const INITIAL_FILTERS: FilterState = {
  query: '',
  category: 'all',
  radiusKm: 5,
  openNow: false,
  verifiedOnly: false,
  topRated: false,
  favoritesOnly: false,
  sort: 'distance',
};

/** Nearest district centroid to an arbitrary coordinate. */
function snapToArea(lat: number, lng: number) {
  let best = DUBAI_AREAS[0];
  let bestKm = Number.POSITIVE_INFINITY;
  for (const area of DUBAI_AREAS) {
    const km = calculateDistance(lat, lng, area.lat, area.lng);
    if (km < bestKm) {
      bestKm = km;
      best = area;
    }
  }
  return best;
}

/** Favourites are scoped per account, so two users on one device stay separate. */
const favoritesKey = (user: AuthUser | null): string =>
  `${FAVORITES_KEY}:${user?.id ?? 'guest'}`;

function readFavorites(key: string): string[] {
  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

function writeFavorites(key: string, ids: string[]): void {
  try {
    window.localStorage.setItem(key, JSON.stringify(ids));
  } catch {
    /* private mode / storage disabled — favourites stay in memory */
  }
}

/** Normalised key used to spot the same shop appearing in both sources. */
const dedupeKey = (b: Business): string =>
  `${b.name.toLowerCase().replace(/[^a-z0-9]/g, '')}@${b.lat.toFixed(3)},${b.lng.toFixed(3)}`;

export default function App() {
  const [osmBusinesses, setOsmBusinesses] = useState<Business[]>([]);
  const [dataStatus, setDataStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [userAdded, setUserAdded] = useState<Business[]>([]);

  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [user, setUser] = useState<AuthUser | null>(() => currentUser());
  const [favorites, setFavorites] = useState<string[]>(() =>
    readFavorites(favoritesKey(currentUser()))
  );
  const [page, setPage] = useState(1);

  const [authOpen, setAuthOpen] = useState(false);
  const [authMode, setAuthMode] = useState<AuthMode>('login');
  const [authReason, setAuthReason] = useState<string | null>(null);

  const [areaId, setAreaId] = useState<string>(DEFAULT_AREA.id);
  const [userLocation, setUserLocation] = useState<UserLocation>({
    lat: DEFAULT_AREA.lat,
    lng: DEFAULT_AREA.lng,
    label: DEFAULT_AREA.name,
    source: 'area',
  });
  const [gpsStatus, setGpsStatus] = useState<GpsStatus>('idle');

  const [selected, setSelected] = useState<Business | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [mobileView, setMobileView] = useState<'list' | 'map'>('list');

  /* --------------------- Load the full Dubai dataset --------------------- */
  useEffect(() => {
    const controller = new AbortController();
    let cancelled = false;

    (async () => {
      try {
        const records = await loadShippedDataset(controller.signal);
        if (cancelled) return;
        const mapped: Business[] = [];
        for (const record of records) {
          const business = toBusiness(record, snapToArea(record.a, record.o).name);
          if (business) mapped.push(business);
        }
        setOsmBusinesses(mapped);
        setDataStatus('ready');
      } catch (err) {
        if (cancelled || (err as Error)?.name === 'AbortError') return;
        setDataStatus('error');
      }
    })();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, []);

  /** Curated entries win over OSM duplicates — they carry photos and ratings. */
  const catalog = useMemo<Business[]>(() => {
    const seen = new Set<string>();
    const out: Business[] = [];
    for (const b of [...userAdded, ...BUSINESSES, ...osmBusinesses]) {
      const key = dedupeKey(b);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(b);
    }
    return out;
  }, [userAdded, osmBusinesses]);

  /* -------------------------------- Auth --------------------------------- */
  const favKey = useMemo(() => favoritesKey(user), [user]);

  const openAuth = useCallback((mode: AuthMode, reason?: string) => {
    setAuthMode(mode);
    setAuthReason(reason ?? null);
    setAuthOpen(true);
  }, []);

  const handleAuthenticated = useCallback((next: AuthUser) => {
    setUser(next);
    setFavorites(readFavorites(favoritesKey(next)));
    setAuthReason(null);
  }, []);

  const handleSignOut = useCallback(() => {
    signOut();
    setUser(null);
    setFavorites(readFavorites(favoritesKey(null)));
    setFilters((f) => ({ ...f, favoritesOnly: false }));
  }, []);

  /* ------------------------------ Favourites ----------------------------- */
  const toggleFavorite = useCallback(
    (id: string) => {
      setFavorites((prev) => {
        const next = prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id];
        writeFavorites(favKey, next);
        return next;
      });
    },
    [favKey]
  );

  /* ------------------------------ Location ------------------------------- */
  const handleAreaChange = useCallback((nextId: string) => {
    const area = DUBAI_AREAS.find((a) => a.id === nextId);
    if (!area) return;
    setAreaId(area.id);
    setGpsStatus('idle');
    setUserLocation({ lat: area.lat, lng: area.lng, label: area.name, source: 'area' });
  }, []);

  const handleUseGps = useCallback(() => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsStatus('unavailable');
      return;
    }
    setGpsStatus('locating');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const { latitude, longitude, accuracy } = pos.coords;
        if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
          setGpsStatus('unavailable');
          return;
        }
        const area = snapToArea(latitude, longitude);
        setAreaId(area.id);
        setGpsStatus('granted');
        setUserLocation({
          lat: latitude,
          lng: longitude,
          label: `Your location · near ${area.name}`,
          source: 'gps',
          accuracy: Number.isFinite(accuracy) ? accuracy : undefined,
        });
      },
      (err) => setGpsStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable'),
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
    );
  }, []);

  /* --------------------------- Distance engine ---------------------------
   * Distances live in a parallel array rather than on cloned Business objects:
   * with tens of thousands of records, cloning on every origin change would
   * dominate the render.
   * --------------------------------------------------------------------- */
  const distances = useMemo(
    () => catalog.map((b) => calculateDistance(userLocation.lat, userLocation.lng, b.lat, b.lng)),
    [catalog, userLocation.lat, userLocation.lng]
  );

  const inRadiusIdx = useMemo(() => {
    const idx: number[] = [];
    for (let i = 0; i < catalog.length; i += 1) {
      if (distances[i] <= filters.radiusKm) idx.push(i);
    }
    return idx;
  }, [catalog, distances, filters.radiusKm]);

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const i of inRadiusIdx) {
      const c = catalog[i].category;
      counts[c] = (counts[c] ?? 0) + 1;
    }
    return counts;
  }, [inRadiusIdx, catalog]);

  /* ------------------------- Filtering + sorting -------------------------- */
  const sortedIdx = useMemo(() => {
    const q = filters.query.trim().toLowerCase();

    const kept = inRadiusIdx.filter((i) => {
      const b = catalog[i];
      if (filters.category !== 'all' && b.category !== filters.category) return false;
      if (filters.verifiedOnly && !b.verified) return false;
      if (filters.topRated && b.rating < 4.5) return false;
      if (filters.favoritesOnly && !favorites.includes(b.id)) return false;
      if (filters.openNow) {
        if (b.hoursUnknown || b.hours.length === 0) return false;
        if (!isOpenNow(b)) return false;
      }
      if (q) {
        const haystack = [
          b.name, b.nameAr, b.subcategory, b.area, b.address,
          ...b.tags, ...b.amenities,
        ].join(' ').toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const byFeatured = (a: number, b: number) =>
      Number(catalog[b].featured) - Number(catalog[a].featured);

    switch (filters.sort) {
      case 'rating':
        kept.sort((a, b) => catalog[b].rating - catalog[a].rating
          || catalog[b].reviewCount - catalog[a].reviewCount);
        break;
      case 'reviews':
        kept.sort((a, b) => catalog[b].reviewCount - catalog[a].reviewCount);
        break;
      case 'name':
        kept.sort((a, b) => catalog[a].name.localeCompare(catalog[b].name));
        break;
      default:
        kept.sort((a, b) => distances[a] - distances[b]);
    }
    kept.sort(byFeatured);
    return kept;
  }, [inRadiusIdx, catalog, distances, filters, favorites]);

  /** Reset paging whenever the result set changes shape. */
  useEffect(() => setPage(1), [filters, userLocation.lat, userLocation.lng, catalog.length]);

  /** Only the visible slice is cloned with its distance attached. */
  const visible = useMemo(
    () => sortedIdx.slice(0, page * PAGE_SIZE).map((i) => ({
      ...catalog[i],
      distanceKm: distances[i],
    })),
    [sortedIdx, page, catalog, distances]
  );

  /** The map takes uncloned references — clustering handles the volume. */
  const mapBusinesses = useMemo(
    () => sortedIdx.map((i) => catalog[i]),
    [sortedIdx, catalog]
  );

  /* ------------------------------- Handlers ------------------------------ */
  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      setFilters((f) => ({ ...f, [key]: value }));
    },
    []
  );

  const requestAddBusiness = useCallback(() => {
    if (!user) {
      openAuth('signup', 'Create a free account to list your business on BuisnessFind.');
      return;
    }
    setAddOpen(true);
  }, [user, openAuth]);

  const handleAddBusiness = useCallback((business: Business) => {
    setUserAdded((prev) => [business, ...prev]);
    setFilters((f) => ({ ...f, category: 'all', query: '', favoritesOnly: false }));
  }, []);

  const handleAiApply = useCallback((plan: AiPlan) => {
    setFilters((f) => ({ ...f, ...plan.patch }));
    setMobileView('list');
  }, []);

  const resetFilters = useCallback(() => setFilters(INITIAL_FILTERS), []);

  const activeId = selected?.id ?? hoveredId;
  const hasActiveFilters =
    filters.category !== 'all' || filters.openNow || filters.verifiedOnly ||
    filters.topRated || filters.favoritesOnly || filters.query.trim() !== '';

  return (
    <div className="min-h-screen bg-slate-50">
      <DubizzleNavbar
        query={filters.query}
        onQueryChange={(v) => setFilter('query', v)}
        onAddBusiness={requestAddBusiness}
        onOpenAi={() => setAiOpen(true)}
        onToggleFavorites={() => setFilter('favoritesOnly', !filters.favoritesOnly)}
        favoritesCount={favorites.length}
        favoritesActive={filters.favoritesOnly}
        user={user}
        onSignIn={() => openAuth('login')}
        onSignUp={() => openAuth('signup')}
        onSignOut={handleSignOut}
      />

      <LocationSelectorBar
        activeAreaId={areaId}
        onAreaChange={handleAreaChange}
        onUseGps={handleUseGps}
        userLocation={userLocation}
        gpsStatus={gpsStatus}
        resultCount={sortedIdx.length}
      />

      <DubizzleCategoryCarousel
        active={filters.category}
        counts={categoryCounts}
        totalCount={inRadiusIdx.length}
        onChange={(c: CategoryId | 'all') => setFilter('category', c)}
      />

      <RadiusFilterBar filters={filters} onChange={setFilter} />

      {/* Dataset status */}
      {dataStatus !== 'ready' && (
        <div
          className={`border-b px-3 py-2.5 sm:px-5 ${
            dataStatus === 'error'
              ? 'border-amber-200 bg-amber-50'
              : 'border-slate-200 bg-slate-50'
          }`}
        >
          <div className="mx-auto flex max-w-[1600px] items-center gap-2 text-[13px] font-semibold">
            {dataStatus === 'loading' ? (
              <>
                <LoaderCircle className="h-4 w-4 animate-spin text-dubai-600" />
                <span className="text-slate-600">
                  Loading every business in Dubai from OpenStreetMap…
                </span>
              </>
            ) : (
              <>
                <TriangleAlert className="h-4 w-4 text-amber-600" />
                <span className="text-amber-800">
                  Could not load the full directory — showing curated listings only.
                </span>
              </>
            )}
          </div>
        </div>
      )}

      {/* Mobile list/map switch */}
      <div className="sticky top-16 z-[800] border-b border-slate-200 bg-white px-3 py-2 lg:hidden">
        <div className="flex gap-1.5 rounded-xl bg-slate-100 p-1">
          <button
            type="button"
            onClick={() => setMobileView('list')}
            className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-bold transition ${
              mobileView === 'list' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            <List className="h-4 w-4" />
            List
          </button>
          <button
            type="button"
            onClick={() => setMobileView('map')}
            className={`inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg text-[13px] font-bold transition ${
              mobileView === 'map' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'
            }`}
          >
            <MapIcon className="h-4 w-4" />
            Map
          </button>
        </div>
      </div>

      <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-5">
        <div className="flex gap-5">
          <section
            className={`min-w-0 flex-1 ${mobileView === 'map' ? 'hidden lg:block' : 'block'}`}
            aria-label="Business results"
          >
            {filters.favoritesOnly && (
              <div className="mb-3 flex items-center gap-2 rounded-xl border border-dubai-200 bg-dubai-50 px-4 py-3">
                <Heart className="h-4 w-4 fill-dubai-600 text-dubai-600" />
                <span className="text-[13px] font-bold text-dubai-800">
                  Showing your {favorites.length} saved{' '}
                  {favorites.length === 1 ? 'business' : 'businesses'}
                </span>
                {!user && (
                  <button
                    type="button"
                    onClick={() => openAuth('signup', 'Create an account to keep your saved businesses.')}
                    className="text-[12px] font-extrabold text-dubai-700 underline underline-offset-2"
                  >
                    Save to an account
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setFilter('favoritesOnly', false)}
                  className="ml-auto text-[12px] font-extrabold text-dubai-700 underline underline-offset-2"
                >
                  Show all
                </button>
              </div>
            )}

            {sortedIdx.length === 0 ? (
              <div className="grid place-items-center rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center">
                <SearchX className="h-10 w-10 text-slate-300" />
                <h3 className="mt-3 text-lg font-extrabold text-slate-900">
                  Nothing matches those filters
                </h3>
                <p className="mt-1 max-w-sm text-[13px] font-semibold text-slate-500">
                  Try widening the radius beyond {filters.radiusKm} km, clearing the search box, or
                  switching category.
                </p>
                {hasActiveFilters && (
                  <button
                    type="button"
                    onClick={resetFilters}
                    className="mt-4 inline-flex h-10 items-center gap-1.5 rounded-xl bg-slate-900 px-4 text-[13px] font-bold text-white transition hover:bg-slate-800"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    Reset all filters
                  </button>
                )}
              </div>
            ) : (
              <>
                <div className="grid gap-3">
                  {visible.map((b) => (
                    <DubizzleBusinessCard
                      key={b.id}
                      business={b}
                      isFavorite={favorites.includes(b.id)}
                      isActive={activeId === b.id}
                      onToggleFavorite={toggleFavorite}
                      onOpen={setSelected}
                      onHover={setHoveredId}
                    />
                  ))}
                </div>

                {visible.length < sortedIdx.length && (
                  <button
                    type="button"
                    onClick={() => setPage((p) => p + 1)}
                    className="mt-4 h-12 w-full rounded-2xl border border-slate-200 bg-white text-sm font-extrabold text-slate-700 shadow-card transition hover:border-dubai-200 hover:bg-dubai-50 hover:text-dubai-700"
                  >
                    Show more · {visible.length.toLocaleString()} of{' '}
                    {sortedIdx.length.toLocaleString()}
                  </button>
                )}
              </>
            )}
          </section>

          <aside
            className={`${
              mobileView === 'map' ? 'block w-full' : 'hidden'
            } lg:block lg:w-[46%] lg:max-w-[720px] lg:shrink-0`}
            aria-label="Map"
          >
            <div className="h-[calc(100dvh-13rem)] lg:sticky lg:top-[7.5rem] lg:h-[calc(100dvh-9.5rem)]">
              <InteractiveBusinessMap
                businesses={mapBusinesses}
                userLocation={userLocation}
                radiusKm={filters.radiusKm}
                activeId={activeId}
                onSelect={setSelected}
                onHover={setHoveredId}
              />
            </div>
          </aside>
        </div>
      </main>

      <footer className="border-t border-slate-200 bg-white py-6">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center justify-center gap-2 px-5 text-center text-[12px] font-semibold text-slate-400">
          <Database className="h-3.5 w-3.5" />
          {catalog.length.toLocaleString()} businesses across {DUBAI_AREAS.length} Dubai districts ·
          Business data &amp; map tiles © OpenStreetMap contributors (ODbL) · Satellite © Esri
        </div>
      </footer>

      <BusinessDetailModal
        business={selected}
        isFavorite={selected ? favorites.includes(selected.id) : false}
        onToggleFavorite={toggleFavorite}
        onClose={() => setSelected(null)}
      />
      <AddBusinessModal
        open={addOpen}
        onClose={() => setAddOpen(false)}
        onSubmit={handleAddBusiness}
      />
      <AuthModal
        open={authOpen}
        mode={authMode}
        onModeChange={setAuthMode}
        onClose={() => setAuthOpen(false)}
        onAuthenticated={handleAuthenticated}
        reason={authReason}
      />
      <AiAssistantModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        businesses={catalog}
        onApply={handleAiApply}
      />
    </div>
  );
}
