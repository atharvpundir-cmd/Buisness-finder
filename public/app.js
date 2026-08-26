/* BusinessFind — client SPA.
 * Vanilla ES module. No dependencies, no build step.
 * Agent E owns this file and /public/index.html only.
 */

/* ------------------------------------------------------------------ *
 * 1. The XSS boundary. Every interpolated value goes through esc().
 * ------------------------------------------------------------------ */

const ESC_MAP = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
  '=': '&#61;'
};

/** Escape any value for interpolation into an HTML template string. */
function esc(value) {
  if (value === null || value === undefined) return '';
  return String(value).replace(/[&<>"'`=]/g, (ch) => ESC_MAP[ch]);
}

/** Escape a value destined for a URL query component (then esc() for HTML). */
function escUrl(value) {
  return esc(encodeURIComponent(value === null || value === undefined ? '' : String(value)));
}

/** Allow only http(s) URLs to become hrefs; anything else becomes empty. */
function safeHref(url) {
  if (!url) return '';
  const s = String(url).trim();
  if (!/^https?:\/\//i.test(s)) return '';
  return esc(s);
}

/* ------------------------------------------------------------------ *
 * 2. Shared constants (must match the other agents exactly).
 * ------------------------------------------------------------------ */

const CATEGORY_KEYS = [
  'all', 'restaurants', 'cafes', 'groceries', 'malls', 'clothing', 'pharmacies',
  'gyms', 'salons', 'atms', 'petrol', 'bakeries', 'bars'
];

const CATEGORY_LABELS = {
  all: 'All businesses',
  restaurants: 'Restaurants',
  cafes: 'Cafes',
  groceries: 'Groceries',
  malls: 'Malls',
  clothing: 'Clothing',
  pharmacies: 'Pharmacies',
  gyms: 'Gyms',
  salons: 'Salons',
  atms: 'ATMs',
  petrol: 'Petrol',
  bakeries: 'Bakeries',
  bars: 'Bars'
};

const CATEGORY_ICONS = {
  all: '✦',
  restaurants: '🍽️',
  cafes: '☕',
  groceries: '🛒',
  malls: '🏬',
  clothing: '👕',
  pharmacies: '💊',
  gyms: '🏋️',
  salons: '💇',
  atms: '🏧',
  petrol: '⛽',
  bakeries: '🥐',
  bars: '🍸'
};

const PRICE_SYMBOLS = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: '$',
  PRICE_LEVEL_MODERATE: '$$',
  PRICE_LEVEL_EXPENSIVE: '$$$',
  PRICE_LEVEL_VERY_EXPENSIVE: '$$$$'
};

const PRICE_TITLES = {
  PRICE_LEVEL_FREE: 'Free',
  PRICE_LEVEL_INEXPENSIVE: 'Inexpensive',
  PRICE_LEVEL_MODERATE: 'Moderate',
  PRICE_LEVEL_EXPENSIVE: 'Expensive',
  PRICE_LEVEL_VERY_EXPENSIVE: 'Very expensive'
};

const THEMES = ['aurora', 'midnight', 'meadow', 'sunset', 'mono'];
const THEME_LABELS = {
  aurora: 'Aurora',
  midnight: 'Midnight',
  meadow: 'Meadow',
  sunset: 'Sunset',
  mono: 'Mono',
  system: 'Follow system'
};
const THEME_KEY = 'bf-theme';

/* Fallbacks used when --map-tint has not been defined by the stylesheet. */
const THEME_TINT_FALLBACK = {
  aurora: '#3d7dff',
  midnight: '#6f7dff',
  meadow: '#3f9a5f',
  sunset: '#e2703a',
  mono: '#7a7a7a'
};

const DARK_THEMES = { midnight: true };

const RADIUS_MIN = 500;
const RADIUS_MAX = 50000;
const RADIUS_STEP = 500;
const NEARBY_DEBOUNCE_MS = 400;

/* A transparent, reproducible starting point for the product brief. This is
 * intentionally an example location, not a substitute for the user's GPS. */
const JLT_EXAMPLE = {
  lat: 25.0693,
  lng: 55.1401,
  label: 'Jumeirah Lakes Towers, Dubai, UAE'
};

/* ------------------------------------------------------------------ *
 * 3. State — one object.
 * ------------------------------------------------------------------ */

const state = {
  booted: false,
  route: { name: 'hero', params: {} },

  config: null,
  configError: null,

  user: null,
  authChecked: false,

  theme: readStoredTheme(),

  // location
  origin: null,              // {lat,lng,label,source:'gps'|'manual'}
  geoStatus: 'idle',         // idle | prompting | locating | ready | error
  geoError: null,            // {kind, message}
  manualQuery: '',
  manualBusy: false,
  manualError: null,

  // search
  category: 'restaurants',
  radius: 5000,
  minRating: 0,
  openNowOnly: false,
  sort: 'relevance',
  query: '',

  places: [],
  placesLoading: false,
  placesError: null,
  activeId: null,

  detail: null,
  detailLoading: false,
  detailError: null,

  saved: [],
  savedLoaded: false,

  friends: { friends: [], incoming: [], blocked: [] },
  friendsLoaded: false,
  friendsError: null,

  checkIns: [],
  checkInsLoaded: false,

  live: { locations: [], status: null },
  liveLoaded: false,

  authBusy: false,
  authError: null,
  pendingVerifyEmail: '',

  quotaNotice: null,
  toasts: [],
  modal: null
};

/* client-side cache for the PAID nearby endpoint */
const nearbyCache = new Map();       // key -> {places, at}
const NEARBY_CACHE_MAX = 60;
const NEARBY_CACHE_TTL = 10 * 60 * 1000;
const detailCache = new Map();       // id -> PlaceDetail

let nearbyDebounceTimer = null;
let nearbyAbort = null;
let nearbySeq = 0;

/* ------------------------------------------------------------------ *
 * 4. Small utilities.
 * ------------------------------------------------------------------ */

function readStoredTheme() {
  try {
    const raw = localStorage.getItem(THEME_KEY);
    if (raw === 'system') return 'system';
    if (raw && THEMES.indexOf(raw) !== -1) return raw;
  } catch (e) { /* storage blocked */ }
  return 'system';
}

function prefersDark() {
  try {
    return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
  } catch (e) {
    return false;
  }
}

function resolveTheme(pref) {
  if (pref && pref !== 'system' && THEMES.indexOf(pref) !== -1) return pref;
  return prefersDark() ? 'midnight' : 'aurora';
}

function applyTheme(pref) {
  state.theme = pref;
  const resolved = resolveTheme(pref);
  document.documentElement.dataset.theme = resolved;
  document.documentElement.setAttribute('data-theme-pref', pref);
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) { /* ignore */ }
  applyMapTheme(resolved);
}

function debounce(fn, ms) {
  let t = null;
  return function debounced(...args) {
    if (t) clearTimeout(t);
    t = setTimeout(() => { t = null; fn.apply(null, args); }, ms);
  };
}

function haversine(a, b) {
  if (!a || !b) return null;
  const R = 6371000;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const la1 = toRad(a.lat);
  const la2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

function formatDistance(m) {
  if (m === null || m === undefined || !isFinite(m)) return '';
  if (m < 950) return `${Math.round(m / 10) * 10} m`;
  return `${(m / 1000).toFixed(m < 9500 ? 1 : 0)} km`;
}

function formatRadius(m) {
  if (m < 1000) return `${m} m`;
  return `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km`;
}

function priceSymbol(level) {
  if (!level) return '';
  return PRICE_SYMBOLS[level] || '';
}

function priceTitle(level) {
  if (!level) return '';
  return PRICE_TITLES[level] || '';
}

function relativeTime(iso) {
  if (!iso) return '';
  const t = Date.parse(iso);
  if (!isFinite(t)) return String(iso);
  const diff = Date.now() - t;
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  if (days < 7) return `${days} d ago`;
  try {
    return new Date(t).toLocaleDateString();
  } catch (e) {
    return new Date(t).toDateString();
  }
}

function starsFor(rating) {
  const r = Number(rating);
  if (!isFinite(r) || r <= 0) return '';
  const full = Math.floor(r + 0.001);
  const half = r - full >= 0.5 ? 1 : 0;
  return '★'.repeat(full) + (half ? '⯨' : '') + '☆'.repeat(Math.max(0, 5 - full - half));
}

function photoUrl(resourceName, maxWidth) {
  if (!resourceName) return '';
  return `/api/photo?name=${encodeURIComponent(resourceName)}&maxWidth=${encodeURIComponent(maxWidth || 800)}`;
}

function directionsUrl(place) {
  if (!place) return '';
  if (place.mapsUri) return place.mapsUri;
  if (isFinite(place.lat) && isFinite(place.lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(place.lat + ',' + place.lng)}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(place.name || '')}`;
}

/* ------------------------------------------------------------------ *
 * 5. API layer.
 * ------------------------------------------------------------------ */

class ApiError extends Error {
  constructor(message, status) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

async function api(path, options) {
  const opts = Object.assign({ credentials: 'same-origin' }, options || {});
  if (opts.body !== undefined && typeof opts.body !== 'string') {
    opts.body = JSON.stringify(opts.body);
    opts.headers = Object.assign({ 'Content-Type': 'application/json' }, opts.headers || {});
  }
  let res;
  try {
    res = await fetch(path, opts);
  } catch (err) {
    if (err && err.name === 'AbortError') throw err;
    throw new ApiError('Could not reach the server. Check your connection and try again.', 0);
  }

  if (res.status === 429) {
    const msg = 'Daily limit reached — BusinessFind has used up its Google Places quota for today. Search opens up again after midnight Pacific time.';
    state.quotaNotice = msg;
    throw new ApiError(msg, 429);
  }

  let data = null;
  const ct = res.headers.get('content-type') || '';
  if (ct.indexOf('application/json') !== -1) {
    try { data = await res.json(); } catch (e) { data = null; }
  }

  if (!res.ok) {
    const msg = (data && data.error) ? String(data.error) : `Request failed (${res.status}).`;
    throw new ApiError(msg, res.status);
  }
  return data === null ? {} : data;
}

/* ------------------------------------------------------------------ *
 * 6. Google Maps runtime loader + per-theme styles.
 * ------------------------------------------------------------------ */

let mapsLoadPromise = null;
let mapInstance = null;
let mapMarkers = new Map();          // placeId -> google.maps.Marker
let mapOriginMarker = null;
let mapRadiusCircle = null;
let mapInfoWindow = null;
let mapFailed = false;

function loadGoogleMaps(browserKey) {
  if (mapsLoadPromise) return mapsLoadPromise;
  if (!browserKey) {
    mapsLoadPromise = Promise.reject(new Error('no-key'));
    return mapsLoadPromise;
  }
  mapsLoadPromise = new Promise((resolve, reject) => {
    if (window.google && window.google.maps) { resolve(window.google.maps); return; }
    const cbName = '__bfMapsReady_' + Math.random().toString(36).slice(2);
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('timeout'));
    }, 15000);
    window[cbName] = function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
      resolve(window.google.maps);
    };
    const script = document.createElement('script');
    script.async = true;
    script.defer = true;
    script.src =
      'https://maps.googleapis.com/maps/api/js?v=weekly&loading=async&key=' +
      encodeURIComponent(browserKey) + '&callback=' + encodeURIComponent(cbName);
    script.onerror = function () {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error('script-error'));
    };
    document.head.appendChild(script);
  });
  return mapsLoadPromise;
}

/* --- colour maths so the styles[] can be derived from --map-tint --- */

function parseHex(hex) {
  if (!hex) return null;
  let s = String(hex).trim();
  const m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!m) {
    const rgb = s.match(/rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i);
    if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
    return null;
  }
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}

function toHex(rgb) {
  return '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
}

function mix(a, b, t) {
  const A = parseHex(a) || [128, 128, 128];
  const B = parseHex(b) || [128, 128, 128];
  return toHex([
    A[0] + (B[0] - A[0]) * t,
    A[1] + (B[1] - A[1]) * t,
    A[2] + (B[2] - A[2]) * t
  ]);
}

function currentTint(theme) {
  let tint = '';
  try {
    tint = getComputedStyle(document.documentElement).getPropertyValue('--map-tint').trim();
  } catch (e) { tint = ''; }
  if (!parseHex(tint)) tint = THEME_TINT_FALLBACK[theme] || THEME_TINT_FALLBACK.aurora;
  return tint;
}

/**
 * Compact per-theme styles[] array.
 * Geometry is tinted toward the theme's --map-tint; default POI and transit
 * labels are hidden because we draw our own pins. Midnight uses a dark base.
 */
function buildMapStyles(theme) {
  const tint = currentTint(theme);
  const dark = !!DARK_THEMES[theme];

  const base = dark ? '#12141c' : '#f7f8fa';
  const landscape = mix(base, tint, dark ? 0.10 : 0.05);
  const manmade = mix(base, tint, dark ? 0.16 : 0.09);
  const road = dark ? mix('#232733', tint, 0.12) : mix('#ffffff', tint, 0.03);
  const roadStroke = dark ? mix('#0d0f16', tint, 0.10) : mix('#e2e5ec', tint, 0.14);
  const arterial = dark ? mix('#2c3140', tint, 0.16) : mix('#ffffff', tint, 0.06);
  const highway = dark ? mix('#394054', tint, 0.24) : mix('#ffffff', tint, 0.12);
  const water = dark ? mix('#0a1626', tint, 0.30) : mix('#cfe3f5', tint, 0.28);
  const park = dark ? mix('#16241c', tint, 0.14) : mix('#dbeee0', tint, 0.10);
  const label = dark ? mix('#c9cfdd', tint, 0.14) : mix('#3d4350', tint, 0.20);
  const labelHalo = dark ? '#0d1017' : '#ffffff';
  const adminStroke = dark ? mix('#3a4155', tint, 0.22) : mix('#c6ccd8', tint, 0.22);

  return [
    { elementType: 'geometry', stylers: [{ color: landscape }] },
    { elementType: 'labels.text.fill', stylers: [{ color: label }] },
    { elementType: 'labels.text.stroke', stylers: [{ color: labelHalo }, { weight: 2 }] },
    { elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },

    /* We draw our own pins: no default POI or transit clutter. */
    { featureType: 'poi', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.business', stylers: [{ visibility: 'off' }] },
    { featureType: 'poi.park', elementType: 'geometry', stylers: [{ visibility: 'on' }, { color: park }] },
    { featureType: 'poi.park', elementType: 'labels', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit', stylers: [{ visibility: 'off' }] },
    { featureType: 'transit.line', elementType: 'geometry', stylers: [{ visibility: 'off' }] },

    { featureType: 'landscape.natural', elementType: 'geometry', stylers: [{ color: landscape }] },
    { featureType: 'landscape.man_made', elementType: 'geometry', stylers: [{ color: manmade }] },

    { featureType: 'road', elementType: 'geometry', stylers: [{ color: road }] },
    { featureType: 'road', elementType: 'geometry.stroke', stylers: [{ color: roadStroke }] },
    { featureType: 'road', elementType: 'labels.icon', stylers: [{ visibility: 'off' }] },
    { featureType: 'road.arterial', elementType: 'geometry', stylers: [{ color: arterial }] },
    { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: highway }] },
    { featureType: 'road.highway', elementType: 'geometry.stroke', stylers: [{ color: roadStroke }] },
    { featureType: 'road.local', elementType: 'labels', stylers: [{ visibility: dark ? 'off' : 'simplified' }] },

    { featureType: 'water', elementType: 'geometry', stylers: [{ color: water }] },
    { featureType: 'water', elementType: 'labels.text.fill', stylers: [{ color: mix(label, water, 0.35) }] },

    { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: adminStroke }] },
    { featureType: 'administrative.land_parcel', stylers: [{ visibility: 'off' }] },
    { featureType: 'administrative.neighborhood', elementType: 'labels', stylers: [{ visibility: 'simplified' }] }
  ];
}

function applyMapTheme(resolvedTheme) {
  if (!mapInstance) return;
  try {
    mapInstance.setOptions({ styles: buildMapStyles(resolvedTheme) });
  } catch (e) { /* map not ready */ }
  refreshMarkerIcons();
  if (mapRadiusCircle) {
    const tint = currentTint(resolvedTheme);
    try {
      mapRadiusCircle.setOptions({
        strokeColor: tint,
        fillColor: tint
      });
    } catch (e) { /* ignore */ }
  }
}

function markerIcon(active, theme) {
  const tint = currentTint(theme || resolveTheme(state.theme));
  const fill = active ? mix(tint, '#ffffff', 0.15) : tint;
  const stroke = DARK_THEMES[resolveTheme(state.theme)] ? '#0d1017' : '#ffffff';
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${active ? 40 : 30}" height="${active ? 52 : 40}" viewBox="0 0 30 40">` +
    `<path d="M15 39C15 39 28 24.4 28 14.7 28 6.9 22.2 1 15 1S2 6.9 2 14.7C2 24.4 15 39 15 39Z" ` +
    `fill="${fill}" stroke="${stroke}" stroke-width="2"/>` +
    `<circle cx="15" cy="14.5" r="5" fill="${stroke}"/></svg>`;
  return {
    url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(svg),
    scaledSize: new window.google.maps.Size(active ? 40 : 30, active ? 52 : 40),
    anchor: new window.google.maps.Point(active ? 20 : 15, active ? 52 : 40)
  };
}

function refreshMarkerIcons() {
  if (!window.google || !window.google.maps) return;
  mapMarkers.forEach((marker, id) => {
    try {
      marker.setIcon(markerIcon(id === state.activeId));
      marker.setZIndex(id === state.activeId ? 999 : 1);
    } catch (e) { /* ignore */ }
  });
}

async function ensureMap() {
  const host = document.getElementById('map');
  if (!host) return;
  if (!state.config || !state.config.mapEnabled || !state.config.mapsBrowserKey) return;
  if (mapFailed) return;

  if (mapInstance) {
    try {
      window.google.maps.event.trigger(mapInstance, 'resize');
      if (state.origin) mapInstance.setCenter({ lat: state.origin.lat, lng: state.origin.lng });
    } catch (e) { /* ignore */ }
    syncMarkers();
    return;
  }

  let maps;
  try {
    maps = await loadGoogleMaps(state.config.mapsBrowserKey);
  } catch (err) {
    mapFailed = true;
    render();
    return;
  }

  const center = state.origin
    ? { lat: state.origin.lat, lng: state.origin.lng }
    : { lat: 28.6139, lng: 77.209 };

  mapInstance = new maps.Map(host, {
    center,
    zoom: state.origin ? 15 : 12,
    styles: buildMapStyles(resolveTheme(state.theme)),
    disableDefaultUI: true,
    zoomControl: true,
    gestureHandling: 'greedy',
    clickableIcons: false,
    keyboardShortcuts: false
  });
  mapInfoWindow = new maps.InfoWindow();
  syncMarkers();
}

function syncMarkers() {
  if (!mapInstance || !window.google || !window.google.maps) return;
  const maps = window.google.maps;

  // origin marker + radius circle
  if (state.origin) {
    const pos = { lat: state.origin.lat, lng: state.origin.lng };
    if (!mapOriginMarker) {
      mapOriginMarker = new maps.Marker({
        map: mapInstance,
        position: pos,
        title: 'You are here',
        zIndex: 1000,
        icon: {
          path: maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: '#2f7bff',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 3
        }
      });
    } else {
      mapOriginMarker.setPosition(pos);
    }
    const tint = currentTint(resolveTheme(state.theme));
    if (!mapRadiusCircle) {
      mapRadiusCircle = new maps.Circle({
        map: mapInstance,
        center: pos,
        radius: state.radius,
        strokeColor: tint,
        strokeOpacity: 0.5,
        strokeWeight: 1,
        fillColor: tint,
        fillOpacity: 0.06,
        clickable: false
      });
    } else {
      mapRadiusCircle.setCenter(pos);
      mapRadiusCircle.setRadius(state.radius);
    }
  }

  const visible = visiblePlaces();
  const wanted = new Set(visible.map((p) => p.id));

  mapMarkers.forEach((marker, id) => {
    if (!wanted.has(id)) {
      marker.setMap(null);
      mapMarkers.delete(id);
    }
  });

  const bounds = new maps.LatLngBounds();
  let any = false;

  visible.forEach((place) => {
    if (!isFinite(place.lat) || !isFinite(place.lng)) return;
    const pos = { lat: place.lat, lng: place.lng };
    any = true;
    bounds.extend(pos);
    let marker = mapMarkers.get(place.id);
    if (!marker) {
      marker = new maps.Marker({
        map: mapInstance,
        position: pos,
        title: place.name || '',
        icon: markerIcon(place.id === state.activeId)
      });
      marker.addListener('click', () => {
        setActive(place.id, { fromMap: true });
      });
      mapMarkers.set(place.id, marker);
    } else {
      marker.setPosition(pos);
      marker.setIcon(markerIcon(place.id === state.activeId));
    }
  });

  if (state.origin) {
    bounds.extend({ lat: state.origin.lat, lng: state.origin.lng });
    any = true;
  }
  if (any && !state.activeId) {
    try {
      mapInstance.fitBounds(bounds, 48);
      if (visible.length <= 1 && mapInstance.getZoom() > 16) mapInstance.setZoom(16);
    } catch (e) { /* ignore */ }
  }
  refreshMarkerIcons();
}

function panToPlace(id) {
  if (!mapInstance) return;
  const place = state.places.find((p) => p.id === id);
  if (!place || !isFinite(place.lat) || !isFinite(place.lng)) return;
  try {
    mapInstance.panTo({ lat: place.lat, lng: place.lng });
    if (mapInstance.getZoom() < 15) mapInstance.setZoom(15);
    if (mapInfoWindow) {
      mapInfoWindow.setContent(
        `<div style="font:600 13px/1.35 system-ui,sans-serif;max-width:200px;color:#111">${esc(place.name || '')}</div>`
      );
      const marker = mapMarkers.get(id);
      if (marker) mapInfoWindow.open({ map: mapInstance, anchor: marker });
    }
  } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ *
 * 7. Geolocation.
 * ------------------------------------------------------------------ */

const GEO_COPY = {
  insecure: {
    title: 'Your browser will not share location over an insecure connection',
    body: 'This page is not being served over HTTPS (or localhost), so the browser blocks location access entirely — there is no prompt to accept. Open BusinessFind over https://, or type a place name or address below and we will find it for you.'
  },
  unsupported: {
    title: 'This browser has no location API',
    body: 'We cannot ask this browser where you are. Type a place name, address, or postcode below instead — that works everywhere.'
  },
  denied: {
    title: 'Location permission was denied',
    body: 'Your browser is blocking location for this site, so we cannot detect where you are. To turn it back on, click the padlock (or the location icon) in the address bar, set Location to Allow, and reload. Or just type where you are below — it works just as well.'
  },
  unavailable: {
    title: 'Your device could not work out where it is',
    body: 'The browser tried, but no position came back — this usually means GPS is off, Wi-Fi and mobile data are both unavailable, or the device is in a shielded space such as a basement or lift. Try again in a moment, or type your location below.'
  },
  timeout: {
    title: 'Locating you took too long',
    body: 'Your device did not return a position within 12 seconds. This is common indoors, where GPS struggles to get a fix. You can try again, or type your location below to search straight away.'
  },
  unknown: {
    title: 'Something went wrong while locating you',
    body: 'The browser returned an error we did not expect. Try again, or type your location below.'
  }
};

function requestGeolocation() {
  if (!window.isSecureContext) {
    state.geoStatus = 'error';
    state.geoError = { kind: 'insecure' };
    render();
    return;
  }
  if (!navigator.geolocation || typeof navigator.geolocation.getCurrentPosition !== 'function') {
    state.geoStatus = 'error';
    state.geoError = { kind: 'unsupported' };
    render();
    return;
  }

  state.geoStatus = 'locating';
  state.geoError = null;
  render();

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      state.origin = {
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        label: 'Your current location',
        source: 'gps',
        accuracy: pos.coords.accuracy
      };
      state.geoStatus = 'ready';
      state.geoError = null;
      render();
      ensureMap();
      scheduleNearby(true);
    },
    (err) => {
      let kind = 'unknown';
      if (err) {
        if (err.code === 1) kind = 'denied';
        else if (err.code === 2) kind = 'unavailable';
        else if (err.code === 3) kind = 'timeout';
      }
      state.geoStatus = 'error';
      state.geoError = { kind };
      render();
    },
    { enableHighAccuracy: true, timeout: 12000, maximumAge: 60000 }
  );
}

async function geocodeManual(q) {
  const query = String(q || '').trim();
  if (!query) {
    state.manualError = 'Type a place name, address, or postcode first.';
    render();
    return;
  }
  state.manualBusy = true;
  state.manualError = null;
  render();
  try {
    const data = await api(`/api/geocode?q=${encodeURIComponent(query)}`);
    if (!data || !isFinite(data.lat) || !isFinite(data.lng)) {
      throw new ApiError('We could not find that place. Try adding a city or postcode.', 404);
    }
    state.origin = {
      lat: Number(data.lat),
      lng: Number(data.lng),
      label: data.formattedAddress || query,
      source: 'manual'
    };
    state.geoStatus = 'ready';
    state.geoError = null;
    state.manualBusy = false;
    state.manualQuery = '';
    render();
    ensureMap();
    scheduleNearby(true);
  } catch (err) {
    state.manualBusy = false;
    state.manualError = err && err.message ? err.message : 'Could not look that place up.';
    render();
  }
}

/** Load the JLT scenario from the product brief without consuming geocoding quota. */
function useJltExample() {
  state.origin = { ...JLT_EXAMPLE, source: 'example' };
  state.radius = 5000;
  state.geoStatus = 'ready';
  state.geoError = null;
  state.manualError = null;
  render();
  ensureMap();
  scheduleNearby(true);
}

/* ------------------------------------------------------------------ *
 * 8. Nearby search — debounced, cached, abortable.
 * ------------------------------------------------------------------ */

function nearbyKey() {
  if (!state.origin) return null;
  return [
    state.origin.lat.toFixed(4),
    state.origin.lng.toFixed(4),
    state.category,
    state.radius
  ].join('|');
}

function cacheGet(key) {
  const hit = nearbyCache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > NEARBY_CACHE_TTL) {
    nearbyCache.delete(key);
    return null;
  }
  // refresh recency
  nearbyCache.delete(key);
  nearbyCache.set(key, hit);
  return hit.places;
}

function cacheSet(key, places) {
  nearbyCache.set(key, { places, at: Date.now() });
  while (nearbyCache.size > NEARBY_CACHE_MAX) {
    const oldest = nearbyCache.keys().next().value;
    nearbyCache.delete(oldest);
  }
}

const debouncedFetchNearby = debounce(() => { fetchNearby(); }, NEARBY_DEBOUNCE_MS);

/**
 * The only path to the PAID /api/nearby endpoint.
 * immediate=true still goes through the cache; it just skips the 400ms wait.
 */
function scheduleNearby(immediate) {
  const key = nearbyKey();
  if (!key) return;

  const cached = cacheGet(key);
  if (cached) {
    if (nearbyDebounceTimer) { clearTimeout(nearbyDebounceTimer); nearbyDebounceTimer = null; }
    state.places = cached;
    state.placesLoading = false;
    state.placesError = null;
    if (state.activeId && !cached.some((p) => p.id === state.activeId)) state.activeId = null;
    render();
    syncMarkers();
    return;
  }

  state.placesLoading = true;
  state.placesError = null;
  render();

  if (immediate) {
    if (nearbyDebounceTimer) { clearTimeout(nearbyDebounceTimer); nearbyDebounceTimer = null; }
    fetchNearby();
  } else {
    debouncedFetchNearby();
  }
}

async function fetchNearby() {
  const key = nearbyKey();
  if (!key) return;

  const cached = cacheGet(key);
  if (cached) {
    state.places = cached;
    state.placesLoading = false;
    render();
    syncMarkers();
    return;
  }

  if (nearbyAbort) { try { nearbyAbort.abort(); } catch (e) { /* ignore */ } }
  const controller = new AbortController();
  nearbyAbort = controller;
  const seq = ++nearbySeq;

  const params = new URLSearchParams({
    lat: String(state.origin.lat),
    lng: String(state.origin.lng),
    category: state.category,
    radius: String(state.radius)
  });

  try {
    const data = await api(`/api/nearby?${params.toString()}`, { signal: controller.signal });
    if (seq !== nearbySeq) return;
    const places = Array.isArray(data.places) ? data.places : [];
    cacheSet(key, places);
    state.places = places;
    state.placesLoading = false;
    state.placesError = null;
    if (state.activeId && !places.some((p) => p.id === state.activeId)) state.activeId = null;
    render();
    syncMarkers();
  } catch (err) {
    if (err && err.name === 'AbortError') return;
    if (seq !== nearbySeq) return;
    state.placesLoading = false;
    state.placesError = err && err.message ? err.message : 'Search failed.';
    render();
  } finally {
    if (nearbyAbort === controller) nearbyAbort = null;
  }
}

function visiblePlaces() {
  let list = state.places.slice();

  if (state.query.trim()) {
    const q = state.query.trim().toLowerCase();
    list = list.filter((p) => String(p.name || '').toLowerCase().indexOf(q) !== -1);
  }
  if (state.minRating > 0) {
    list = list.filter((p) => Number(p.rating) >= state.minRating);
  }
  if (state.openNowOnly) {
    list = list.filter((p) => {
      const d = detailCache.get(p.id);
      if (d && typeof d.openNow === 'boolean') return d.openNow;
      return p.businessStatus === 'OPERATIONAL' || !p.businessStatus;
    });
  }

  const withDist = list.map((p) => {
    const d = state.origin ? haversine(state.origin, { lat: p.lat, lng: p.lng }) : null;
    return Object.assign({}, p, { _distance: d });
  });

  if (state.sort === 'rating') {
    withDist.sort((a, b) => (Number(b.rating) || 0) - (Number(a.rating) || 0) ||
      (Number(b.ratingCount) || 0) - (Number(a.ratingCount) || 0));
  } else if (state.sort === 'distance') {
    withDist.sort((a, b) => (a._distance === null ? Infinity : a._distance) - (b._distance === null ? Infinity : b._distance));
  } else if (state.sort === 'reviews') {
    withDist.sort((a, b) => (Number(b.ratingCount) || 0) - (Number(a.ratingCount) || 0));
  } else if (state.sort === 'name') {
    withDist.sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
  }
  return withDist;
}

function setActive(id, opts) {
  state.activeId = state.activeId === id && !(opts && opts.fromMap) ? null : id;
  render();
  refreshMarkerIcons();
  if (state.activeId) {
    if (opts && opts.fromMap) {
      const card = document.querySelector(`.result-card[data-id="${cssEscape(state.activeId)}"]`);
      if (card && card.scrollIntoView) card.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } else {
      panToPlace(state.activeId);
    }
  }
}

function cssEscape(s) {
  if (window.CSS && typeof window.CSS.escape === 'function') return window.CSS.escape(String(s));
  return String(s).replace(/["\\\]]/g, '\\$&');
}

/* ------------------------------------------------------------------ *
 * 9. Detail.
 * ------------------------------------------------------------------ */

async function loadDetail(id) {
  const cached = detailCache.get(id);
  if (cached) {
    state.detail = cached;
    state.detailLoading = false;
    state.detailError = null;
    render();
    return;
  }
  state.detail = null;
  state.detailLoading = true;
  state.detailError = null;
  render();
  try {
    const data = await api(`/api/place?id=${encodeURIComponent(id)}`);
    const place = data && data.place ? data.place : null;
    if (!place) throw new ApiError('That place could not be found.', 404);
    detailCache.set(id, place);
    if (state.route.name === 'place' && state.route.params.id === id) {
      state.detail = place;
      state.detailLoading = false;
      render();
    }
  } catch (err) {
    if (state.route.name === 'place' && state.route.params.id === id) {
      state.detailLoading = false;
      state.detailError = err && err.message ? err.message : 'Could not load that place.';
      render();
    }
  }
}

/* ------------------------------------------------------------------ *
 * 10. Auth / friends / check-ins / saved / live.
 * ------------------------------------------------------------------ */

async function loadMe() {
  try {
    const data = await api('/api/auth/me');
    state.user = data && data.user ? data.user : null;
  } catch (err) {
    state.user = null;
  }
  state.authChecked = true;
}

async function doAuth(kind, payload) {
  state.authBusy = true;
  state.authError = null;
  render();
  try {
    const data = await api(`/api/auth/${kind}`, { method: 'POST', body: payload });
    state.authBusy = false;
    if (data && data.user) {
      state.user = data.user;
      if (data.user.verified === false) {
        state.pendingVerifyEmail = data.user.email || payload.email || '';
        navigate('#/verify');
        return;
      }
      toast(kind === 'signup' ? 'Welcome to BusinessFind.' : 'Signed in.');
      state.savedLoaded = false;
      state.friendsLoaded = false;
      state.checkInsLoaded = false;
      navigate('#/map');
      return;
    }
    if (kind === 'signup') {
      state.pendingVerifyEmail = payload.email || '';
      navigate('#/verify');
      return;
    }
    render();
  } catch (err) {
    state.authBusy = false;
    state.authError = err && err.message ? err.message : 'That did not work.';
    render();
  }
}

async function doVerify(code) {
  state.authBusy = true;
  state.authError = null;
  render();
  try {
    const data = await api('/api/auth/verify', {
      method: 'POST',
      body: { email: state.pendingVerifyEmail || (state.user && state.user.email) || '', code }
    });
    state.authBusy = false;
    if (data && data.user) state.user = data.user;
    else await loadMe();
    toast('Email verified.');
    navigate('#/map');
  } catch (err) {
    state.authBusy = false;
    state.authError = err && err.message ? err.message : 'That code did not work.';
    render();
  }
}

async function doLogout() {
  try { await api('/api/auth/logout', { method: 'POST', body: {} }); } catch (e) { /* ignore */ }
  state.user = null;
  state.saved = [];
  state.savedLoaded = false;
  state.friends = { friends: [], incoming: [], blocked: [] };
  state.friendsLoaded = false;
  state.checkIns = [];
  state.checkInsLoaded = false;
  state.live = { locations: [], status: null };
  state.liveLoaded = false;
  toast('Signed out.');
  navigate('#/');
}

async function loadSaved(force) {
  if (!state.user) return;
  if (state.savedLoaded && !force) return;
  try {
    const data = await api('/api/saved');
    state.saved = Array.isArray(data.saved) ? data.saved : [];
    state.savedLoaded = true;
    render();
  } catch (err) {
    state.savedLoaded = true;
    render();
  }
}

function isSaved(id) {
  return state.saved.some((s) => (s.placeId || s.id) === id);
}

async function toggleSaved(place) {
  if (!state.user) { toast('Sign in to save places.'); navigate('#/login'); return; }
  const id = place.id;
  try {
    if (isSaved(id)) {
      const data = await api(`/api/saved?placeId=${encodeURIComponent(id)}`, { method: 'DELETE' });
      state.saved = Array.isArray(data.saved) ? data.saved : state.saved.filter((s) => (s.placeId || s.id) !== id);
      toast('Removed from saved.');
    } else {
      const data = await api('/api/saved', {
        method: 'POST',
        body: {
          placeId: id,
          name: place.name || '',
          lat: place.lat,
          lng: place.lng,
          category: state.category,
          rating: place.rating,
          address: place.address || ''
        }
      });
      state.saved = Array.isArray(data.saved) ? data.saved : state.saved;
      if (!isSaved(id)) state.saved = state.saved.concat([{ placeId: id, name: place.name, lat: place.lat, lng: place.lng }]);
      toast('Saved.');
    }
    render();
  } catch (err) {
    toast(err && err.message ? err.message : 'Could not update saved places.');
  }
}

async function loadFriends(force) {
  if (!state.user) return;
  if (state.friendsLoaded && !force) return;
  try {
    const data = await api('/api/friends');
    state.friends = {
      friends: Array.isArray(data.friends) ? data.friends : [],
      incoming: Array.isArray(data.incoming) ? data.incoming : [],
      blocked: Array.isArray(data.blocked) ? data.blocked : []
    };
    state.friendsLoaded = true;
    state.friendsError = null;
  } catch (err) {
    state.friendsLoaded = true;
    state.friendsError = err && err.message ? err.message : 'Could not load friends.';
  }
  render();
}

async function friendAction(action, payload) {
  try {
    await api(`/api/friends/${action}`, { method: 'POST', body: payload });
    toast(FRIEND_TOASTS[action] || 'Done.');
    await loadFriends(true);
  } catch (err) {
    toast(err && err.message ? err.message : 'That did not work.');
  }
}

const FRIEND_TOASTS = {
  request: 'Friend request sent.',
  accept: 'Friend added.',
  decline: 'Request declined.',
  remove: 'Friend removed.',
  block: 'Blocked.',
  report: 'Reported. Thank you — we review every report.'
};

async function loadCheckIns(force) {
  if (!state.user) return;
  if (state.checkInsLoaded && !force) return;
  try {
    const data = await api('/api/checkins');
    state.checkIns = Array.isArray(data.checkIns) ? data.checkIns : [];
  } catch (err) {
    state.checkIns = [];
  }
  state.checkInsLoaded = true;
  render();
}

async function postCheckIn(place, note) {
  if (!state.user) { toast('Sign in to check in.'); navigate('#/login'); return; }
  try {
    const data = await api('/api/checkins', {
      method: 'POST',
      body: {
        placeId: place.id,
        name: place.name || '',
        lat: place.lat,
        lng: place.lng,
        note: note || '',
        category: state.category
      }
    });
    if (data && data.checkIn) state.checkIns = [data.checkIn].concat(state.checkIns);
    state.modal = null;
    toast('Checked in.');
    render();
  } catch (err) {
    toast(err && err.message ? err.message : 'Could not check in.');
  }
}

async function loadLive(force) {
  if (!state.user) return;
  if (state.liveLoaded && !force) return;
  try {
    const data = await api('/api/live');
    state.live = {
      locations: Array.isArray(data.locations) ? data.locations : [],
      status: data.status || null
    };
  } catch (err) {
    state.live = { locations: [], status: null };
  }
  state.liveLoaded = true;
  render();
}

async function liveAction(action) {
  try {
    const body = {};
    if (action === 'update' || action === 'start') {
      if (state.origin) { body.lat = state.origin.lat; body.lng = state.origin.lng; }
    }
    await api(`/api/live/${action}`, { method: 'POST', body });
    toast(action === 'stop' ? 'Stopped sharing your location.' : 'Sharing your location with friends.');
    await loadLive(true);
  } catch (err) {
    toast(err && err.message ? err.message : 'Could not change live sharing.');
  }
}

function isSharingLive() {
  const s = state.live && state.live.status;
  if (!s) return false;
  if (typeof s === 'string') return s === 'active' || s === 'sharing' || s === 'on';
  return !!(s.active || s.sharing || s.on);
}

/* ------------------------------------------------------------------ *
 * 11. Toasts + modal.
 * ------------------------------------------------------------------ */

let toastSeq = 0;
function toast(message) {
  const id = ++toastSeq;
  state.toasts.push({ id, message: String(message || '') });
  render();
  setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    render();
  }, 4200);
}

/* ------------------------------------------------------------------ *
 * 12. Router.
 * ------------------------------------------------------------------ */

function parseHash() {
  const raw = (location.hash || '').replace(/^#/, '');
  const path = raw.replace(/^\/+/, '');
  const parts = path.split('/').filter(Boolean);

  if (parts.length === 0) return { name: state.user ? 'map' : 'hero', params: {} };
  const head = parts[0].toLowerCase();

  if (head === 'map') return { name: 'map', params: {} };
  if (head === 'place') return { name: 'place', params: { id: decodeURIComponent(parts.slice(1).join('/') || '') } };
  if (head === 'login') return { name: 'login', params: {} };
  if (head === 'signup') return { name: 'signup', params: {} };
  if (head === 'verify') return { name: 'verify', params: {} };
  if (head === 'friends') return { name: 'friends', params: {} };
  if (head === 'checkins') return { name: 'checkins', params: {} };
  if (head === 'saved') return { name: 'saved', params: {} };
  return { name: 'hero', params: {} };
}

function navigate(hash) {
  if (location.hash === hash) { onRouteChange(); return; }
  location.hash = hash;
}

function onRouteChange() {
  const next = parseHash();
  const prev = state.route;
  state.route = next;

  if (next.name === 'place') {
    if (!prev || prev.name !== 'place' || prev.params.id !== next.params.id) {
      state.activeId = next.params.id;
      loadDetail(next.params.id);
    }
  }
  if (next.name === 'saved') loadSaved(false);
  if (next.name === 'friends') { loadFriends(false); loadLive(false); }
  if (next.name === 'checkins') { loadCheckIns(false); loadLive(false); }

  render();

  if (next.name === 'map' || next.name === 'place') {
    ensureMap();
    if (state.origin && !state.places.length && !state.placesLoading) scheduleNearby(true);
  }
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------------ *
 * 13. Views.
 * ------------------------------------------------------------------ */

function viewTopbar() {
  const u = state.user;
  return `
    <header class="topbar">
      <a class="brand" href="#/" data-link>
        <span class="brand-mark" aria-hidden="true">📍</span>
        <span class="brand-name">BusinessFind</span>
      </a>
      <nav class="nav-actions">
        <a class="btn btn-ghost" href="#/map" data-link>Map</a>
        ${u ? `
          <a class="btn btn-ghost" href="#/saved" data-link>Saved${state.saved.length ? ` (${esc(state.saved.length)})` : ''}</a>
          <a class="btn btn-ghost" href="#/friends" data-link>Friends${state.friends.incoming.length ? ` · ${esc(state.friends.incoming.length)}` : ''}</a>
          <a class="btn btn-ghost" href="#/checkins" data-link>Check-ins</a>
        ` : ''}
        ${viewThemePicker()}
        ${u ? `
          <span class="nav-user" title="${esc(u.email || '')}">${esc(u.name || u.email || 'You')}</span>
          <button class="btn btn-ghost" type="button" data-action="logout">Sign out</button>
        ` : `
          <a class="btn btn-ghost" href="#/login" data-link>Sign in</a>
          <a class="btn btn-primary" href="#/signup" data-link>Sign up</a>
        `}
      </nav>
    </header>
  `;
}

function viewThemePicker() {
  const opts = ['system'].concat(THEMES);
  return `
    <label class="theme-picker">
      <span class="theme-picker-label">Theme</span>
      <select data-action="theme" aria-label="Colour theme">
        ${opts.map((t) => `<option value="${esc(t)}"${t === state.theme ? ' selected' : ''}>${esc(THEME_LABELS[t] || t)}</option>`).join('')}
      </select>
    </label>
  `;
}

function viewHero() {
  return `
    <section class="hero">
      <h1 class="hero-title">Find great places. Bring people with you.</h1>
      <p class="hero-sub">Search every kind of business near you, save the ones worth returning to, and see where your friends are headed.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#/signup" data-link>Get started — it's free</a>
        <a class="btn btn-ghost" href="#/map" data-link>Browse the map</a>
      </div>
      <div class="chips hero-chips">
        ${CATEGORY_KEYS.map((k) => `
          <button class="chip" type="button" data-action="hero-category" data-category="${esc(k)}">
            <span aria-hidden="true">${esc(CATEGORY_ICONS[k])}</span> ${esc(CATEGORY_LABELS[k])}
          </button>
        `).join('')}
      </div>
      <div class="hero-points">
        <div class="hero-point">
          <h3>Popular local categories, one search</h3>
          <p>Start with every nearby business, or narrow to restaurants, cafes, groceries, malls, clothing, pharmacies, gyms, salons, ATMs, petrol, bakeries and bars.</p>
        </div>
        <div class="hero-point">
          <h3>Save what is worth returning to</h3>
          <p>Keep a private list of the places you liked, with the ratings and directions attached.</p>
        </div>
        <div class="hero-point">
          <h3>See where friends are headed</h3>
          <p>Check in, share your location while you are out, and meet people where they already are.</p>
        </div>
      </div>
    </section>
  `;
}

function viewQuotaBanner() {
  if (!state.quotaNotice) return '';
  return `<div class="toast toast-quota" role="status">${esc(state.quotaNotice)}</div>`;
}

function viewLiveBanner() {
  if (!state.user || !isSharingLive()) return '';
  return `
    <div class="share-banner" role="status">
      <span>You are sharing your live location with your friends.</span>
      <button class="btn btn-ghost" type="button" data-action="live-stop">Stop sharing</button>
    </div>
  `;
}

function viewFilters() {
  return `
    <div class="chips" role="group" aria-label="Category">
      ${CATEGORY_KEYS.map((k) => `
        <button class="chip${k === state.category ? ' is-active' : ''}" type="button"
          data-action="category" data-category="${esc(k)}"
          aria-pressed="${k === state.category ? 'true' : 'false'}">
          <span aria-hidden="true">${esc(CATEGORY_ICONS[k])}</span> ${esc(CATEGORY_LABELS[k])}
        </button>
      `).join('')}
    </div>

    <div class="filters">
      <label class="filter">
        <span>Search results</span>
        <input type="search" data-action="query" value="${esc(state.query)}" placeholder="Filter by name" autocomplete="off">
      </label>

      <label class="filter">
        <span>Radius — ${esc(formatRadius(state.radius))}</span>
        <input class="radius-slider" type="range" min="${RADIUS_MIN}" max="${RADIUS_MAX}" step="${RADIUS_STEP}"
          value="${esc(state.radius)}" data-action="radius" aria-label="Search radius in metres">
      </label>

      <label class="filter">
        <span>Minimum rating</span>
        <select data-action="min-rating">
          ${[0, 3, 3.5, 4, 4.5].map((v) => `<option value="${esc(v)}"${Number(state.minRating) === v ? ' selected' : ''}>${v === 0 ? 'Any rating' : esc(v + '+')}</option>`).join('')}
        </select>
      </label>

      <label class="filter">
        <span>Sort by</span>
        <select data-action="sort">
          ${[
            ['relevance', 'Relevance'],
            ['distance', 'Distance'],
            ['rating', 'Rating'],
            ['reviews', 'Most reviewed'],
            ['name', 'Name']
          ].map(([v, l]) => `<option value="${esc(v)}"${state.sort === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}
        </select>
      </label>

      <label class="filter filter-toggle">
        <input type="checkbox" data-action="open-now"${state.openNowOnly ? ' checked' : ''}>
        <span>Open now</span>
      </label>
    </div>
    ${state.openNowOnly ? `<p class="filter-note">Opening hours are confirmed when you open a place. Until then this hides anything Google reports as closed down.</p>` : ''}
  `;
}

function viewGeo() {
  if (state.geoStatus === 'ready') {
    return `
      <div class="geo-prompt geo-ready">
        <span>Searching around <strong>${esc(state.origin.label || 'your location')}</strong></span>
        <button class="btn btn-ghost" type="button" data-action="change-location">Change</button>
      </div>
    `;
  }
  if (state.geoStatus === 'locating') {
    return `<div class="geo-prompt"><span class="skeleton skeleton-line"></span><span>Finding where you are…</span></div>`;
  }
  if (state.geoStatus === 'error') {
    const copy = GEO_COPY[state.geoError && state.geoError.kind] || GEO_COPY.unknown;
    const retryable = state.geoError && ['timeout', 'unavailable', 'unknown', 'denied'].indexOf(state.geoError.kind) !== -1;
    return `
      <div class="geo-error" role="alert">
        <h3>${esc(copy.title)}</h3>
        <p>${esc(copy.body)}</p>
        ${retryable ? `<button class="btn btn-ghost" type="button" data-action="use-location">Try locating me again</button>` : ''}
      </div>
      ${viewManualLocation()}
    `;
  }
  return `
    <div class="geo-prompt">
      <p>BusinessFind needs a starting point before it can search.</p>
      <button class="btn btn-primary" type="button" data-action="use-location">Use my current location</button>
      <button class="btn btn-ghost" type="button" data-action="use-jlt-example">Explore JLT within 5 km</button>
      <p class="filter-note">We ask your browser for your position. Nothing is sent anywhere until you search, and you can type a location instead.</p>
    </div>
    ${viewManualLocation()}
  `;
}

function viewManualLocation() {
  return `
    <form class="manual-location" data-form="manual">
      <label class="field">
        <span>Where should we search?</span>
        <input type="text" name="q" value="${esc(state.manualQuery)}" placeholder="e.g. Connaught Place, New Delhi" autocomplete="street-address">
      </label>
      <button class="btn btn-primary" type="submit"${state.manualBusy ? ' disabled' : ''}>${state.manualBusy ? 'Looking up…' : 'Search here'}</button>
      ${state.manualError ? `<p class="form-error" role="alert">${esc(state.manualError)}</p>` : ''}
    </form>
  `;
}

function viewMapWrap() {
  const cfg = state.config;
  let placeholder = '';
  if (!cfg) {
    placeholder = 'Loading map settings…';
  } else if (!cfg.mapEnabled || !cfg.mapsBrowserKey) {
    placeholder = 'The map is switched off — no browser Maps key is configured on this server. The result list below works exactly the same without it.';
  } else if (mapFailed) {
    placeholder = 'The Google Maps script could not load (blocked, offline, or the browser key is restricted to another domain). Results are still listed below.';
  } else if (!state.origin) {
    placeholder = 'Pick a starting point and the map will appear here.';
  }
  return `
    <div class="map-wrap">
      <div id="map" role="application" aria-label="Map of nearby places"></div>
      ${placeholder ? `<div class="map-placeholder">${esc(placeholder)}</div>` : ''}
    </div>
  `;
}

function viewResults() {
  if (!state.origin) return '';
  if (state.placesLoading && !state.places.length) {
    return `<div class="results">${Array.from({ length: 6 }).map(() => `
      <div class="result-card skeleton"><span class="skeleton-line"></span><span class="skeleton-line"></span></div>
    `).join('')}</div>`;
  }
  if (state.placesError) {
    return `
      <div class="results">
        <div class="empty-state" role="alert">
          <h3>${esc(state.placesError)}</h3>
          <button class="btn btn-ghost" type="button" data-action="retry-nearby">Try again</button>
        </div>
      </div>
    `;
  }
  const list = visiblePlaces();
  if (!list.length) {
    return `
      <div class="results">
        <div class="empty-state">
          <h3>Nothing matched</h3>
          <p>No ${esc(CATEGORY_LABELS[state.category].toLowerCase())} within ${esc(formatRadius(state.radius))} passed your filters. Try widening the radius or lowering the minimum rating.</p>
        </div>
      </div>
    `;
  }
  return `
    <div class="results" role="list">
      <p class="results-count">${esc(list.length)} ${list.length === 1 ? 'place' : 'places'}${state.placesLoading ? ' · refreshing…' : ''}</p>
      ${list.map((p) => viewResultCard(p)).join('')}
    </div>
  `;
}

function viewResultCard(p) {
  const price = priceSymbol(p.priceLevel);
  const closed = p.businessStatus && p.businessStatus !== 'OPERATIONAL';
  return `
    <article class="result-card${p.id === state.activeId ? ' is-active' : ''}" role="listitem"
      data-id="${esc(p.id)}" data-action="select" tabindex="0">
      <h3 class="result-name">${esc(p.name || 'Unnamed place')}</h3>
      <div class="result-meta">
        ${p.rating ? `<span class="result-rating" title="${esc(p.rating)} out of 5">
            <span class="stars" aria-hidden="true">${esc(starsFor(p.rating))}</span>
            ${esc(Number(p.rating).toFixed(1))}${p.ratingCount ? ` <span class="rating-count">(${esc(p.ratingCount)})</span>` : ''}
          </span>` : `<span class="result-rating result-rating-none">No rating yet</span>`}
        ${price ? `<span class="result-price" title="${esc(priceTitle(p.priceLevel))}">${esc(price)}</span>` : ''}
        ${p._distance !== null && p._distance !== undefined ? `<span class="result-distance">${esc(formatDistance(p._distance))}</span>` : ''}
        ${closed ? `<span class="result-closed">${esc(p.businessStatus === 'CLOSED_TEMPORARILY' ? 'Temporarily closed' : 'Permanently closed')}</span>` : ''}
      </div>
      <div class="result-actions">
        <a class="btn btn-ghost" href="#/place/${escUrl(p.id)}" data-link data-stop>Details</a>
        <button class="btn btn-ghost" type="button" data-action="save" data-id="${esc(p.id)}" data-stop>
          ${isSaved(p.id) ? 'Saved ✓' : 'Save'}
        </button>
        <button class="btn btn-ghost" type="button" data-action="checkin" data-id="${esc(p.id)}" data-stop>Check in</button>
      </div>
    </article>
  `;
}

function viewMapPage() {
  return `
    ${viewLiveBanner()}
    ${viewQuotaBanner()}
    <section class="map-page">
      ${viewGeo()}
      ${state.origin ? viewFilters() : ''}
      ${viewMapWrap()}
      ${viewResults()}
      ${viewQuotaFooter()}
    </section>
  `;
}

function viewQuotaFooter() {
  const q = state.config && state.config.quota;
  if (!q) return '';
  const bits = [];
  if (typeof q.nearby === 'number') bits.push(`${q.nearby} searches`);
  if (typeof q.place === 'number') bits.push(`${q.place} place lookups`);
  if (typeof q.geocode === 'number') bits.push(`${q.geocode} address lookups`);
  if (!bits.length) return '';
  return `<p class="quota-footer">Remaining today: ${esc(bits.join(' · '))}.</p>`;
}

function viewDetailPage() {
  const id = state.route.params.id;
  if (state.detailLoading) {
    return `<section class="detail"><div class="skeleton skeleton-block"></div><div class="skeleton skeleton-line"></div><div class="skeleton skeleton-line"></div></section>`;
  }
  if (state.detailError) {
    return `
      <section class="detail">
        <div class="empty-state" role="alert">
          <h3>${esc(state.detailError)}</h3>
          <a class="btn btn-ghost" href="#/map" data-link>Back to the map</a>
        </div>
      </section>
    `;
  }
  const d = state.detail;
  if (!d) {
    return `<section class="detail"><div class="empty-state"><h3>Nothing to show</h3><a class="btn btn-ghost" href="#/map" data-link>Back to the map</a></div></section>`;
  }

  const dist = state.origin ? haversine(state.origin, { lat: d.lat, lng: d.lng }) : null;
  const photos = Array.isArray(d.photos) ? d.photos.slice(0, 8) : [];
  const reviews = Array.isArray(d.reviews) ? d.reviews : [];
  const hours = Array.isArray(d.weekdayHours) ? d.weekdayHours : [];

  return `
    <section class="detail">
      <div class="detail-header">
        <a class="btn btn-ghost" href="#/map" data-link>← Back</a>
        <h1 class="result-name">${esc(d.name || 'Unnamed place')}</h1>
        <div class="result-meta">
          ${d.rating ? `<span class="result-rating">
              <span class="stars" aria-hidden="true">${esc(starsFor(d.rating))}</span>
              ${esc(Number(d.rating).toFixed(1))}${d.ratingCount ? ` <span class="rating-count">(${esc(d.ratingCount)} reviews)</span>` : ''}
            </span>` : `<span class="result-rating result-rating-none">No rating yet</span>`}
          ${d.priceLevel ? `<span class="result-price" title="${esc(priceTitle(d.priceLevel))}">${esc(priceSymbol(d.priceLevel))}</span>` : ''}
          ${dist !== null ? `<span class="result-distance">${esc(formatDistance(dist))} away</span>` : ''}
          ${typeof d.openNow === 'boolean' ? `<span class="detail-open ${d.openNow ? 'is-open' : 'is-closed'}">${d.openNow ? 'Open now' : 'Closed now'}</span>` : ''}
          ${d.businessStatus && d.businessStatus !== 'OPERATIONAL' ? `<span class="result-closed">${esc(d.businessStatus === 'CLOSED_TEMPORARILY' ? 'Temporarily closed' : 'Permanently closed')}</span>` : ''}
        </div>
        ${d.address ? `<p class="detail-address">${esc(d.address)}</p>` : ''}
      </div>

      ${photos.length ? `
        <div class="detail-photos">
          ${photos.map((name, i) => `
            <img src="${esc(photoUrl(name, 800))}" alt="${esc((d.name || 'Place') + ' photo ' + (i + 1))}" loading="lazy" decoding="async">
          `).join('')}
        </div>
      ` : ''}

      <div class="detail-actions">
        <a class="btn btn-primary" href="${esc(directionsUrl(d))}" target="_blank" rel="noopener noreferrer">Directions</a>
        ${d.phone ? `<a class="btn btn-ghost" href="tel:${esc(String(d.phone).replace(/[^0-9+]/g, ''))}">${esc(d.phone)}</a>` : ''}
        ${safeHref(d.website) ? `<a class="btn btn-ghost" href="${safeHref(d.website)}" target="_blank" rel="noopener noreferrer">Website</a>` : ''}
        <button class="btn btn-ghost" type="button" data-action="save" data-id="${esc(d.id)}">${isSaved(d.id) ? 'Saved ✓' : 'Save'}</button>
        <button class="btn btn-ghost" type="button" data-action="checkin" data-id="${esc(d.id)}">Check in here</button>
      </div>

      ${hours.length ? `
        <div class="detail-hours">
          <h2>Opening hours</h2>
          <ul>${hours.map((line) => `<li>${esc(line)}</li>`).join('')}</ul>
        </div>
      ` : `<div class="detail-hours"><h2>Opening hours</h2><p>Google has no published hours for this place.</p></div>`}

      ${reviews.length ? `
        <div class="reviews">
          <h2>Reviews from Google</h2>
          ${reviews.map((r) => viewReview(r)).join('')}
        </div>
      ` : ''}

      <div class="google-attrib">
        <span>Place data, ratings, photos and reviews are provided by Google.</span>
        ${safeHref(d.mapsUri) ? ` <a href="${safeHref(d.mapsUri)}" target="_blank" rel="noopener noreferrer">View ${esc(d.name || 'this place')} on Google Maps</a>` : ''}
      </div>
    </section>
  `;
}

function viewReview(r) {
  const photo = safeHref(r.authorPhoto);
  const profile = safeHref(r.profileUri);
  const author = esc(r.author || 'A Google user');
  return `
    <article class="review">
      <div class="review-author">
        ${photo ? `<img class="review-avatar" src="${photo}" alt="" loading="lazy" referrerpolicy="no-referrer" width="36" height="36">` : `<span class="review-avatar review-avatar-blank" aria-hidden="true"></span>`}
        <span class="review-author-name">
          ${profile ? `<a href="${profile}" target="_blank" rel="noopener noreferrer">${author}</a>` : author}
        </span>
        ${r.rating ? `<span class="review-rating" aria-label="${esc(r.rating)} out of 5">${esc(starsFor(r.rating))}</span>` : ''}
        ${r.relativeTime ? `<span class="review-time">${esc(r.relativeTime)}</span>` : ''}
      </div>
      ${r.text ? `<p class="review-body">${esc(r.text)}</p>` : ''}
    </article>
  `;
}

function viewLogin() {
  return `
    <section class="auth-wrap">
      <form class="auth-form" data-form="login">
        <h1>Welcome back</h1>
        <label class="field">
          <span>Email</span>
          <input type="email" name="email" required autocomplete="email" autocapitalize="none" spellcheck="false">
        </label>
        <label class="field">
          <span>Password</span>
          <input type="password" name="password" required autocomplete="current-password">
        </label>
        ${state.authError ? `<p class="form-error" role="alert">${esc(state.authError)}</p>` : ''}
        <button class="btn btn-primary" type="submit"${state.authBusy ? ' disabled' : ''}>${state.authBusy ? 'Signing in…' : 'Sign in'}</button>
        <p class="auth-alt">No account yet? <a href="#/signup" data-link>Create one — it's free</a>.</p>
      </form>
    </section>
  `;
}

function viewSignup() {
  return `
    <section class="auth-wrap">
      <form class="auth-form" data-form="signup">
        <h1>Create your account</h1>
        <label class="field">
          <span>Name</span>
          <input type="text" name="name" required autocomplete="name">
        </label>
        <label class="field">
          <span>Email</span>
          <input type="email" name="email" required autocomplete="email" autocapitalize="none" spellcheck="false">
        </label>
        <label class="field">
          <span>Password</span>
          <input type="password" name="password" required minlength="8" autocomplete="new-password">
          <small>At least 8 characters.</small>
        </label>
        ${state.authError ? `<p class="form-error" role="alert">${esc(state.authError)}</p>` : ''}
        <button class="btn btn-primary" type="submit"${state.authBusy ? ' disabled' : ''}>${state.authBusy ? 'Creating…' : "Get started — it's free"}</button>
        <p class="auth-alt">Already have an account? <a href="#/login" data-link>Sign in</a>.</p>
      </form>
    </section>
  `;
}

function viewVerify() {
  const email = state.pendingVerifyEmail || (state.user && state.user.email) || '';
  return `
    <section class="auth-wrap">
      <form class="auth-form" data-form="verify">
        <h1>Check your email</h1>
        <p>We sent a verification code${email ? ` to <strong>${esc(email)}</strong>` : ''}. Enter it below to finish setting up your account. Codes expire after a short while — if yours has, sign up again and we will send a fresh one.</p>
        <label class="field">
          <span>Verification code</span>
          <input type="text" name="code" required inputmode="numeric" autocomplete="one-time-code" spellcheck="false">
        </label>
        ${state.authError ? `<p class="form-error" role="alert">${esc(state.authError)}</p>` : ''}
        <button class="btn btn-primary" type="submit"${state.authBusy ? ' disabled' : ''}>${state.authBusy ? 'Verifying…' : 'Verify my email'}</button>
        <p class="auth-alt"><a href="#/map" data-link>Skip for now</a></p>
      </form>
    </section>
  `;
}

function requireAuth(what) {
  return `
    <section class="empty-state">
      <h3>Sign in to use ${esc(what)}</h3>
      <p>${esc(what.charAt(0).toUpperCase() + what.slice(1))} is tied to your account, so we need to know who you are first.</p>
      <div class="hero-cta">
        <a class="btn btn-primary" href="#/signup" data-link>Get started — it's free</a>
        <a class="btn btn-ghost" href="#/login" data-link>Sign in</a>
      </div>
    </section>
  `;
}

function viewFriends() {
  if (!state.user) return requireAuth('friends');
  const f = state.friends;
  return `
    ${viewLiveBanner()}
    <section class="friends">
      <h1>Friends</h1>

      <form class="auth-form friend-add" data-form="friend-request">
        <label class="field">
          <span>Add a friend by email</span>
          <input type="email" name="email" required placeholder="them@example.com" autocapitalize="none" spellcheck="false">
        </label>
        <button class="btn btn-primary" type="submit">Send request</button>
      </form>

      ${state.friendsError ? `<p class="form-error" role="alert">${esc(state.friendsError)}</p>` : ''}

      <h2>Live sharing</h2>
      <div class="detail-actions">
        ${isSharingLive()
          ? `<button class="btn btn-ghost" type="button" data-action="live-stop">Stop sharing my location</button>
             <button class="btn btn-ghost" type="button" data-action="live-update">Update my position now</button>`
          : `<button class="btn btn-primary" type="button" data-action="live-start"${state.origin ? '' : ' disabled'}>Share my location with friends</button>
             ${state.origin ? '' : '<span class="filter-note">Set a location on the map first.</span>'}`}
      </div>
      ${state.live.locations.length ? `
        <ul class="friends-live">
          ${state.live.locations.map((l) => `
            <li class="friend-row">
              <span>${esc(l.name || l.email || 'A friend')}</span>
              <span class="result-distance">${esc(
                state.origin && isFinite(l.lat) && isFinite(l.lng)
                  ? formatDistance(haversine(state.origin, { lat: l.lat, lng: l.lng })) + ' away'
                  : 'Sharing now'
              )}</span>
              <span class="review-time">${esc(l.updatedAt ? relativeTime(l.updatedAt) : '')}</span>
            </li>
          `).join('')}
        </ul>
      ` : `<p class="filter-note">No friends are sharing their location right now.</p>`}

      <h2>Requests</h2>
      ${f.incoming.length ? f.incoming.map((r) => `
        <div class="request-row">
          <span>${esc(r.name || r.email || 'Someone')}</span>
          <span class="review-time">${esc(r.email || '')}</span>
          <button class="btn btn-primary" type="button" data-action="friend-accept" data-id="${esc(r.id || r.userId || r.email || '')}">Accept</button>
          <button class="btn btn-ghost" type="button" data-action="friend-decline" data-id="${esc(r.id || r.userId || r.email || '')}">Decline</button>
          <button class="btn btn-ghost" type="button" data-action="friend-block" data-id="${esc(r.id || r.userId || r.email || '')}">Block</button>
          <button class="btn btn-ghost" type="button" data-action="friend-report" data-id="${esc(r.id || r.userId || r.email || '')}">Report</button>
        </div>
      `).join('') : `<p class="filter-note">No pending requests.</p>`}

      <h2>Your friends</h2>
      ${f.friends.length ? f.friends.map((fr) => `
        <div class="friend-row">
          <span>${esc(fr.name || fr.email || 'Friend')}</span>
          <span class="review-time">${esc(fr.email || '')}</span>
          <button class="btn btn-ghost" type="button" data-action="friend-remove" data-id="${esc(fr.id || fr.userId || fr.email || '')}">Remove</button>
          <button class="btn btn-ghost" type="button" data-action="friend-block" data-id="${esc(fr.id || fr.userId || fr.email || '')}">Block</button>
          <button class="btn btn-ghost" type="button" data-action="friend-report" data-id="${esc(fr.id || fr.userId || fr.email || '')}">Report</button>
        </div>
      `).join('') : `<div class="empty-state"><h3>No friends yet</h3><p>Send a request with the form above and their check-ins will show up here.</p></div>`}

      ${f.blocked.length ? `
        <h2>Blocked</h2>
        ${f.blocked.map((b) => `
          <div class="friend-row friend-row-blocked">
            <span>${esc(b.name || b.email || 'Blocked account')}</span>
            <span class="review-time">${esc(b.email || '')}</span>
          </div>
        `).join('')}
      ` : ''}
    </section>
  `;
}

function viewCheckIns() {
  if (!state.user) return requireAuth('check-ins');
  return `
    ${viewLiveBanner()}
    <section class="checkins">
      <h1>Check-ins</h1>
      ${state.checkIns.length ? state.checkIns.map((c) => `
        <div class="checkin-row">
          <span class="result-name">${esc(c.name || c.placeName || 'A place')}</span>
          <span class="review-time">${esc(c.userName || (c.userId === (state.user && state.user.id) ? 'You' : 'A friend'))} · ${esc(relativeTime(c.createdAt || c.at))}</span>
          ${c.note ? `<p class="review-body">${esc(c.note)}</p>` : ''}
          ${c.placeId ? `<a class="btn btn-ghost" href="#/place/${escUrl(c.placeId)}" data-link>Open place</a>` : ''}
        </div>
      `).join('') : `
        <div class="empty-state">
          <h3>No check-ins yet</h3>
          <p>Check in from a place on the map and it will show up here — and for your friends.</p>
          <a class="btn btn-primary" href="#/map" data-link>Find somewhere to go</a>
        </div>
      `}
    </section>
  `;
}

function viewSaved() {
  if (!state.user) return requireAuth('saved places');
  return `
    <section class="saved">
      <h1>Saved places</h1>
      ${state.saved.length ? `
        <div class="results" role="list">
          ${state.saved.map((s) => {
            const id = s.placeId || s.id;
            const dist = state.origin && isFinite(s.lat) && isFinite(s.lng)
              ? haversine(state.origin, { lat: Number(s.lat), lng: Number(s.lng) }) : null;
            return `
              <article class="result-card" role="listitem" data-id="${esc(id)}">
                <h3 class="result-name">${esc(s.name || 'Saved place')}</h3>
                <div class="result-meta">
                  ${s.rating ? `<span class="result-rating"><span class="stars" aria-hidden="true">${esc(starsFor(s.rating))}</span> ${esc(Number(s.rating).toFixed(1))}</span>` : ''}
                  ${s.category && CATEGORY_LABELS[s.category] ? `<span>${esc(CATEGORY_LABELS[s.category])}</span>` : ''}
                  ${dist !== null ? `<span class="result-distance">${esc(formatDistance(dist))}</span>` : ''}
                </div>
                ${s.address ? `<p class="result-address">${esc(s.address)}</p>` : ''}
                <div class="result-actions">
                  <a class="btn btn-ghost" href="#/place/${escUrl(id)}" data-link>Details</a>
                  <button class="btn btn-ghost" type="button" data-action="unsave" data-id="${esc(id)}">Remove</button>
                </div>
              </article>
            `;
          }).join('')}
        </div>
      ` : `
        <div class="empty-state">
          <h3>Nothing saved yet</h3>
          <p>Tap Save on any result and it lands here, with its rating and directions attached.</p>
          <a class="btn btn-primary" href="#/map" data-link>Go find somewhere</a>
        </div>
      `}
    </section>
  `;
}

function viewModal() {
  const m = state.modal;
  if (!m) return '';
  if (m.kind === 'checkin') {
    return `
      <div class="modal" role="dialog" aria-modal="true" aria-label="Check in">
        <form class="auth-form" data-form="checkin">
          <h2>Check in at ${esc(m.place.name || 'this place')}</h2>
          <label class="field">
            <span>Add a note (optional)</span>
            <input type="text" name="note" maxlength="140" placeholder="Grabbing coffee, join me">
          </label>
          <div class="detail-actions">
            <button class="btn btn-primary" type="submit">Check in</button>
            <button class="btn btn-ghost" type="button" data-action="close-modal">Cancel</button>
          </div>
        </form>
      </div>
    `;
  }
  return '';
}

function viewToasts() {
  if (!state.toasts.length) return '';
  return state.toasts.map((t) => `<div class="toast" role="status">${esc(t.message)}</div>`).join('');
}

/* ------------------------------------------------------------------ *
 * 14. Render.
 * ------------------------------------------------------------------ */

let mainBody = '';

function render() {
  const root = document.getElementById('app');
  if (!root) return;

  let body;
  switch (state.route.name) {
    case 'map': body = viewMapPage(); break;
    case 'place': body = viewDetailPage(); break;
    case 'login': body = viewLogin(); break;
    case 'signup': body = viewSignup(); break;
    case 'verify': body = viewVerify(); break;
    case 'friends': body = viewFriends(); break;
    case 'checkins': body = viewCheckIns(); break;
    case 'saved': body = viewSaved(); break;
    default: body = viewHero(); break;
  }

  const html = `
    ${viewTopbar()}
    <main class="app-main">${body}</main>
    <footer class="app-footer">
      <span class="google-attrib">Powered by Google — place data, photos and reviews come from Google Maps Platform.</span>
    </footer>
    ${viewModal()}
    ${viewToasts()}
  `;

  // Preserve the live map node across re-renders.
  const mapNode = document.getElementById('map');
  const keepMap = mapInstance && mapNode ? mapNode : null;
  if (keepMap && keepMap.parentNode) keepMap.parentNode.removeChild(keepMap);

  root.innerHTML = html;
  // Lets CSS scope layout to the current route — the map route puts the results
  // panel in position:fixed, so the content column has to be offset for it.
  root.dataset.route = state.route.name || 'hero';
  mainBody = body;

  if (keepMap) {
    const slot = document.getElementById('map');
    if (slot && slot.parentNode) {
      slot.parentNode.replaceChild(keepMap, slot);
      try { window.google.maps.event.trigger(mapInstance, 'resize'); } catch (e) { /* ignore */ }
    } else {
      // No map slot in this view: park the node off-DOM so the instance survives.
      parkedMapNode = keepMap;
    }
  } else if (parkedMapNode) {
    const slot = document.getElementById('map');
    if (slot && slot.parentNode) {
      slot.parentNode.replaceChild(parkedMapNode, slot);
      parkedMapNode = null;
      try { window.google.maps.event.trigger(mapInstance, 'resize'); } catch (e) { /* ignore */ }
    }
  }
}

let parkedMapNode = null;

/* ------------------------------------------------------------------ *
 * 15. Delegated events.
 * ------------------------------------------------------------------ */

function placeById(id) {
  return detailCache.get(id) ||
    state.places.find((p) => p.id === id) ||
    (state.detail && state.detail.id === id ? state.detail : null) ||
    (function () {
      const s = state.saved.find((x) => (x.placeId || x.id) === id);
      return s ? { id, name: s.name, lat: Number(s.lat), lng: Number(s.lng), address: s.address } : null;
    })();
}

function onClick(ev) {
  const link = ev.target.closest ? ev.target.closest('a[data-link]') : null;
  if (link) {
    if (link.hasAttribute('data-stop')) ev.stopPropagation();
    return; // hash links route naturally
  }

  const el = ev.target.closest ? ev.target.closest('[data-action]') : null;
  if (!el) return;
  const action = el.getAttribute('data-action');
  const id = el.getAttribute('data-id');
  if (el.hasAttribute('data-stop')) ev.stopPropagation();

  switch (action) {
    case 'logout':
      ev.preventDefault();
      doLogout();
      break;

    case 'use-location':
      ev.preventDefault();
      requestGeolocation();
      break;

    case 'use-jlt-example':
      ev.preventDefault();
      useJltExample();
      break;

    case 'change-location':
      ev.preventDefault();
      state.geoStatus = 'idle';
      state.manualError = null;
      render();
      break;

    case 'hero-category':
      ev.preventDefault();
      state.category = el.getAttribute('data-category') || 'restaurants';
      navigate('#/map');
      break;

    case 'category': {
      ev.preventDefault();
      const next = el.getAttribute('data-category');
      if (!next || next === state.category) break;
      state.category = next;
      state.activeId = null;
      scheduleNearby(true);   // category change: paid call, but cached + deduped
      break;
    }

    case 'retry-nearby':
      ev.preventDefault();
      if (state.origin) {
        nearbyCache.delete(nearbyKey());
        scheduleNearby(true);
      }
      break;

    case 'select': {
      const cardId = el.getAttribute('data-id');
      if (cardId) setActive(cardId);
      break;
    }

    case 'save':
    case 'unsave': {
      ev.preventDefault();
      const p = placeById(id);
      if (p) toggleSaved(p);
      break;
    }

    case 'checkin': {
      ev.preventDefault();
      if (!state.user) { toast('Sign in to check in.'); navigate('#/login'); break; }
      const p = placeById(id);
      if (p) { state.modal = { kind: 'checkin', place: p }; render(); }
      break;
    }

    case 'close-modal':
      ev.preventDefault();
      state.modal = null;
      render();
      break;

    case 'live-start': ev.preventDefault(); liveAction('start'); break;
    case 'live-stop': ev.preventDefault(); liveAction('stop'); break;
    case 'live-update': ev.preventDefault(); liveAction('update'); break;

    case 'friend-accept': ev.preventDefault(); friendAction('accept', { id }); break;
    case 'friend-decline': ev.preventDefault(); friendAction('decline', { id }); break;
    case 'friend-remove': ev.preventDefault(); friendAction('remove', { id }); break;
    case 'friend-block': ev.preventDefault(); friendAction('block', { id }); break;
    case 'friend-report':
      ev.preventDefault();
      friendAction('report', { id, reason: 'Reported from the friends list' });
      break;

    default:
      break;
  }
}

function onChange(ev) {
  const el = ev.target;
  const action = el.getAttribute && el.getAttribute('data-action');
  if (!action) return;

  switch (action) {
    case 'theme':
      applyTheme(el.value);
      render();
      break;

    case 'min-rating':
      state.minRating = Number(el.value) || 0;
      render();
      syncMarkers();
      break;

    case 'sort':
      state.sort = el.value;
      render();
      break;

    case 'open-now':
      state.openNowOnly = !!el.checked;
      render();
      syncMarkers();
      break;

    default:
      break;
  }
}

function onInput(ev) {
  const el = ev.target;
  const action = el.getAttribute && el.getAttribute('data-action');
  if (!action) return;

  if (action === 'radius') {
    const v = Number(el.value);
    if (!isFinite(v)) return;
    state.radius = v;
    // Update only the label + circle live — do NOT re-render (it would kill the drag).
    const label = el.parentElement && el.parentElement.querySelector('span');
    if (label) label.textContent = `Radius — ${formatRadius(v)}`;
    if (mapRadiusCircle) { try { mapRadiusCircle.setRadius(v); } catch (e) { /* ignore */ } }
    // Debounced + cached: dragging the slider cannot burn the daily quota.
    scheduleNearbyFromSlider();
    return;
  }

  if (action === 'query') {
    state.query = el.value;
    queryRerender();
    return;
  }
}

const queryRerender = debounce(() => {
  const el = document.querySelector('[data-action="query"]');
  const pos = el ? el.selectionStart : null;
  render();
  const next = document.querySelector('[data-action="query"]');
  if (next) {
    next.focus();
    if (pos !== null) { try { next.setSelectionRange(pos, pos); } catch (e) { /* ignore */ } }
  }
  syncMarkers();
}, 180);

function scheduleNearbyFromSlider() {
  const key = nearbyKey();
  if (!key) return;
  const cached = cacheGet(key);
  if (cached) {
    state.places = cached;
    state.placesLoading = false;
    state.placesError = null;
    softRefreshResults();
    syncMarkers();
    return;
  }
  state.placesLoading = true;
  debouncedFetchNearby();
}

/** Repaint just the results list so the slider keeps focus mid-drag. */
function softRefreshResults() {
  const host = document.querySelector('.map-page');
  if (!host) { render(); return; }
  const old = host.querySelector('.results');
  const wrapper = document.createElement('div');
  wrapper.innerHTML = viewResults();
  const next = wrapper.firstElementChild;
  if (old && next) old.replaceWith(next);
  else if (next) host.appendChild(next);
}

function onSubmit(ev) {
  const form = ev.target.closest ? ev.target.closest('form[data-form]') : null;
  if (!form) return;
  ev.preventDefault();
  const kind = form.getAttribute('data-form');
  const fd = new FormData(form);

  if (kind === 'manual') {
    state.manualQuery = String(fd.get('q') || '');
    geocodeManual(state.manualQuery);
    return;
  }
  if (kind === 'login') {
    doAuth('login', { email: String(fd.get('email') || ''), password: String(fd.get('password') || '') });
    return;
  }
  if (kind === 'signup') {
    doAuth('signup', {
      name: String(fd.get('name') || ''),
      email: String(fd.get('email') || ''),
      password: String(fd.get('password') || '')
    });
    return;
  }
  if (kind === 'verify') {
    doVerify(String(fd.get('code') || ''));
    return;
  }
  if (kind === 'friend-request') {
    const email = String(fd.get('email') || '').trim();
    if (email) friendAction('request', { email });
    form.reset();
    return;
  }
  if (kind === 'checkin') {
    const m = state.modal;
    if (m && m.place) postCheckIn(m.place, String(fd.get('note') || ''));
    return;
  }
}

function onKeydown(ev) {
  if (ev.key === 'Escape' && state.modal) {
    state.modal = null;
    render();
    return;
  }
  if ((ev.key === 'Enter' || ev.key === ' ') && ev.target.classList && ev.target.classList.contains('result-card')) {
    ev.preventDefault();
    const id = ev.target.getAttribute('data-id');
    if (id) setActive(id);
  }
}

/* ------------------------------------------------------------------ *
 * 16. Embed mode (server-rendered SEO pages with #app-embed).
 * ------------------------------------------------------------------ */

async function bootEmbed(host) {
  const category = CATEGORY_KEYS.indexOf(host.getAttribute('data-category')) !== -1
    ? host.getAttribute('data-category')
    : 'restaurants';
  const attrLat = Number(host.getAttribute('data-lat'));
  const attrLng = Number(host.getAttribute('data-lng'));
  const radius = Number(host.getAttribute('data-radius')) || 5000;

  const label = CATEGORY_LABELS[category];

  function paint(inner) {
    host.innerHTML = `<div class="results">${inner}</div>`;
  }

  function card(p, origin) {
    const dist = origin ? haversine(origin, { lat: p.lat, lng: p.lng }) : null;
    return `
      <article class="result-card" data-id="${esc(p.id)}">
        <h3 class="result-name"><a href="/#/place/${escUrl(p.id)}">${esc(p.name || 'Unnamed place')}</a></h3>
        <div class="result-meta">
          ${p.rating ? `<span class="result-rating"><span class="stars" aria-hidden="true">${esc(starsFor(p.rating))}</span> ${esc(Number(p.rating).toFixed(1))}${p.ratingCount ? ` <span class="rating-count">(${esc(p.ratingCount)})</span>` : ''}</span>` : ''}
          ${p.priceLevel ? `<span class="result-price" title="${esc(priceTitle(p.priceLevel))}">${esc(priceSymbol(p.priceLevel))}</span>` : ''}
          ${dist !== null ? `<span class="result-distance">${esc(formatDistance(dist))}</span>` : ''}
        </div>
      </article>
    `;
  }

  async function run(origin) {
    paint(Array.from({ length: 4 }).map(() => `<div class="result-card skeleton"><span class="skeleton-line"></span></div>`).join(''));
    try {
      const params = new URLSearchParams({
        lat: String(origin.lat), lng: String(origin.lng), category, radius: String(radius)
      });
      const data = await api(`/api/nearby?${params.toString()}`);
      const places = Array.isArray(data.places) ? data.places : [];
      if (!places.length) {
        paint(`<div class="empty-state"><h3>No ${esc(label.toLowerCase())} found nearby</h3><p>Try the full map for a wider radius.</p><a class="btn btn-primary" href="/#/map">Open the map</a></div>`);
        return;
      }
      paint(places.slice(0, 10).map((p) => card(p, origin)).join('') +
        `<a class="btn btn-primary" href="/#/map">See all ${esc(label.toLowerCase())} on the map</a>` +
        `<p class="google-attrib">Place data and ratings provided by Google.</p>`);
    } catch (err) {
      paint(`<div class="empty-state" role="alert"><h3>${esc(err && err.message ? err.message : 'Could not load places.')}</h3><a class="btn btn-ghost" href="/#/map">Open the map</a></div>`);
    }
  }

  if (isFinite(attrLat) && isFinite(attrLng)) {
    run({ lat: attrLat, lng: attrLng });
    return;
  }

  if (!window.isSecureContext) {
    paint(`<div class="geo-error"><h3>${esc(GEO_COPY.insecure.title)}</h3><p>${esc(GEO_COPY.insecure.body)}</p><a class="btn btn-primary" href="/#/map">Open the full map</a></div>`);
    return;
  }
  if (!navigator.geolocation) {
    paint(`<div class="geo-error"><h3>${esc(GEO_COPY.unsupported.title)}</h3><p>${esc(GEO_COPY.unsupported.body)}</p><a class="btn btn-primary" href="/#/map">Open the full map</a></div>`);
    return;
  }

  paint(`<div class="geo-prompt"><p>Show ${esc(label.toLowerCase())} near you?</p><button class="btn btn-primary" type="button" id="bf-embed-locate">Use my location</button></div>`);
  const btn = host.querySelector('#bf-embed-locate');
  if (btn) {
    btn.addEventListener('click', () => {
      paint(`<div class="geo-prompt"><span>Finding where you are…</span></div>`);
      navigator.geolocation.getCurrentPosition(
        (pos) => run({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
        (err) => {
          let kind = 'unknown';
          if (err) {
            if (err.code === 1) kind = 'denied';
            else if (err.code === 2) kind = 'unavailable';
            else if (err.code === 3) kind = 'timeout';
          }
          const c = GEO_COPY[kind];
          paint(`<div class="geo-error" role="alert"><h3>${esc(c.title)}</h3><p>${esc(c.body)}</p><a class="btn btn-primary" href="/#/map">Open the full map</a></div>`);
        },
        { enableHighAccuracy: false, timeout: 12000, maximumAge: 120000 }
      );
    });
  }
}

/* ------------------------------------------------------------------ *
 * 17. Boot.
 * ------------------------------------------------------------------ */

async function loadConfig() {
  try {
    const cfg = await api('/api/config');
    state.config = {
      live: !!cfg.live,
      mapEnabled: !!cfg.mapEnabled,
      mapsBrowserKey: cfg.mapsBrowserKey || '',
      categories: Array.isArray(cfg.categories) && cfg.categories.length ? cfg.categories : CATEGORY_KEYS,
      quota: cfg.quota || null
    };
  } catch (err) {
    state.config = { live: false, mapEnabled: false, mapsBrowserKey: '', categories: CATEGORY_KEYS, quota: null };
    state.configError = err && err.message ? err.message : 'Could not load settings.';
  }
}

function watchSystemTheme() {
  try {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => { if (state.theme === 'system') applyTheme('system'); };
    if (mq.addEventListener) mq.addEventListener('change', handler);
    else if (mq.addListener) mq.addListener(handler);
  } catch (e) { /* ignore */ }
}

async function boot() {
  const embed = document.getElementById('app-embed');
  const app = document.getElementById('app');

  if (!app && embed) {
    await loadConfig();
    bootEmbed(embed);
    return;
  }
  if (!app) return;

  applyTheme(state.theme);
  watchSystemTheme();

  document.addEventListener('click', onClick);
  document.addEventListener('change', onChange);
  document.addEventListener('input', onInput);
  document.addEventListener('submit', onSubmit);
  document.addEventListener('keydown', onKeydown);
  window.addEventListener('hashchange', onRouteChange);

  state.route = parseHash();
  render();

  await Promise.all([loadConfig(), loadMe()]);

  if (state.user) {
    loadSaved(false);
    loadLive(false);
  }

  state.route = parseHash();
  state.booted = true;
  onRouteChange();

  if (embed) bootEmbed(embed);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
