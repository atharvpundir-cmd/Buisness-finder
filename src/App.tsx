import { useCallback, useEffect, useMemo, useState } from 'react';
import { Heart, List, MapIcon, SearchX, SlidersHorizontal } from 'lucide-react';

import DubizzleNavbar from './components/DubizzleNavbar';
import LocationSelectorBar from './components/LocationSelectorBar';
import RadiusFilterBar from './components/RadiusFilterBar';
import DubizzleCategoryCarousel from './components/DubizzleCategoryCarousel';
import DubizzleBusinessCard from './components/DubizzleBusinessCard';
import InteractiveBusinessMap from './components/InteractiveBusinessMap';
import BusinessDetailModal from './components/BusinessDetailModal';
import AddBusinessModal from './components/AddBusinessModal';
import AiAssistantModal, { type AiPlan } from './components/AiAssistantModal';

import { BUSINESSES, calculateDistance, isOpenNow } from './data/businesses';
import { DEFAULT_AREA, DUBAI_AREAS } from './data/dubaiAreas';
import type {
  Business, CategoryId, FilterState, GpsStatus, UserLocation,
} from './types';

const FAVORITES_KEY = 'bf-dubai-favorites';

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
  return { area: best, km: bestKm };
}

function readFavorites(): string[] {
  try {
    const raw = window.localStorage.getItem(FAVORITES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.filter((v) => typeof v === 'string') : [];
  } catch {
    return [];
  }
}

export default function App() {
  const [catalog, setCatalog] = useState<Business[]>(BUSINESSES);
  const [filters, setFilters] = useState<FilterState>(INITIAL_FILTERS);
  const [favorites, setFavorites] = useState<string[]>(readFavorites);

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

  /* ------------------------------ Favourites ----------------------------- */
  useEffect(() => {
    try {
      window.localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch {
      /* private mode / storage disabled — favourites stay in memory */
    }
  }, [favorites]);

  const toggleFavorite = useCallback((id: string) => {
    setFavorites((prev) =>
      prev.includes(id) ? prev.filter((f) => f !== id) : [...prev, id]
    );
  }, []);

  /* ------------------------------ Location ------------------------------- */
  const handleAreaChange = useCallback((nextId: string) => {
    const area = DUBAI_AREAS.find((a) => a.id === nextId);
    if (!area) return;
    setAreaId(area.id);
    setGpsStatus('idle');
    setUserLocation({
      lat: area.lat,
      lng: area.lng,
      label: area.name,
      source: 'area',
    });
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
        const { area } = snapToArea(latitude, longitude);
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
      (err) => {
        setGpsStatus(err.code === err.PERMISSION_DENIED ? 'denied' : 'unavailable');
      },
      { enableHighAccuracy: false, timeout: 9000, maximumAge: 300000 }
    );
  }, []);

  /* --------------------------- Distance engine --------------------------- */
  const withDistance = useMemo<Business[]>(
    () =>
      catalog.map((b) => ({
        ...b,
        distanceKm: calculateDistance(userLocation.lat, userLocation.lng, b.lat, b.lng),
      })),
    [catalog, userLocation.lat, userLocation.lng]
  );

  /** Everything inside the radius — drives the category counts. */
  const inRadius = useMemo(
    () => withDistance.filter((b) => (b.distanceKm ?? Infinity) <= filters.radiusKm),
    [withDistance, filters.radiusKm]
  );

  const categoryCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const b of inRadius) counts[b.category] = (counts[b.category] ?? 0) + 1;
    return counts;
  }, [inRadius]);

  /* ------------------------- Filtering + sorting -------------------------- */
  const results = useMemo(() => {
    const q = filters.query.trim().toLowerCase();

    const filtered = inRadius.filter((b) => {
      if (filters.category !== 'all' && b.category !== filters.category) return false;
      if (filters.verifiedOnly && !b.verified) return false;
      if (filters.topRated && b.rating < 4.5) return false;
      if (filters.favoritesOnly && !favorites.includes(b.id)) return false;
      if (filters.openNow && !isOpenNow(b)) return false;

      if (q) {
        const haystack = [
          b.name, b.nameAr, b.subcategory, b.area, b.address, b.description,
          ...b.tags, ...b.amenities,
        ]
          .join(' ')
          .toLowerCase();
        if (!haystack.includes(q)) return false;
      }
      return true;
    });

    const sorted = [...filtered];
    switch (filters.sort) {
      case 'rating':
        sorted.sort((a, b) => b.rating - a.rating || b.reviewCount - a.reviewCount);
        break;
      case 'reviews':
        sorted.sort((a, b) => b.reviewCount - a.reviewCount);
        break;
      case 'name':
        sorted.sort((a, b) => a.name.localeCompare(b.name));
        break;
      default:
        sorted.sort((a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity));
    }
    // Featured listings surface first within the chosen ordering.
    sorted.sort((a, b) => Number(b.featured) - Number(a.featured));
    return sorted;
  }, [inRadius, filters, favorites]);

  /* ------------------------------- Handlers ------------------------------ */
  const setFilter = useCallback(
    <K extends keyof FilterState>(key: K, value: FilterState[K]) => {
      setFilters((f) => ({ ...f, [key]: value }));
    },
    []
  );

  const handleAddBusiness = useCallback((business: Business) => {
    setCatalog((prev) => [business, ...prev]);
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
        onAddBusiness={() => setAddOpen(true)}
        onOpenAi={() => setAiOpen(true)}
        onToggleFavorites={() => setFilter('favoritesOnly', !filters.favoritesOnly)}
        favoritesCount={favorites.length}
        favoritesActive={filters.favoritesOnly}
      />

      <LocationSelectorBar
        activeAreaId={areaId}
        onAreaChange={handleAreaChange}
        onUseGps={handleUseGps}
        userLocation={userLocation}
        gpsStatus={gpsStatus}
        resultCount={results.length}
      />

      <DubizzleCategoryCarousel
        active={filters.category}
        counts={categoryCounts}
        totalCount={inRadius.length}
        onChange={(c: CategoryId | 'all') => setFilter('category', c)}
      />

      <RadiusFilterBar filters={filters} onChange={setFilter} />

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

      {/* Split layout */}
      <main className="mx-auto max-w-[1600px] px-3 py-4 sm:px-5">
        <div className="flex gap-5">
          {/* Results */}
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
                <button
                  type="button"
                  onClick={() => setFilter('favoritesOnly', false)}
                  className="ml-auto text-[12px] font-extrabold text-dubai-700 underline underline-offset-2"
                >
                  Show all
                </button>
              </div>
            )}

            {results.length === 0 ? (
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
              <div className="grid gap-3">
                {results.map((b) => (
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
            )}
          </section>

          {/* Map */}
          <aside
            className={`${
              mobileView === 'map' ? 'block w-full' : 'hidden'
            } lg:block lg:w-[46%] lg:max-w-[720px] lg:shrink-0`}
            aria-label="Map"
          >
            <div className="h-[calc(100dvh-13rem)] lg:sticky lg:top-[7.5rem] lg:h-[calc(100dvh-9.5rem)]">
              <InteractiveBusinessMap
                businesses={results}
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
        <div className="mx-auto max-w-[1600px] px-5 text-center text-[12px] font-semibold text-slate-400">
          BuisnessFind Dubai · {catalog.length} businesses across {DUBAI_AREAS.length} districts ·
          Map data © OpenStreetMap contributors, tiles © CARTO &amp; Esri
        </div>
      </footer>

      {/* Modals */}
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
      <AiAssistantModal
        open={aiOpen}
        onClose={() => setAiOpen(false)}
        businesses={withDistance}
        onApply={handleAiApply}
      />
    </div>
  );
}
