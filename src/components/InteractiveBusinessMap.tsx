import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Crosshair, Layers, Maximize2 } from 'lucide-react';
import { categoryColor } from '../data/categories';
import type { Business, UserLocation } from '../types';

/* ---------------------------------------------------------------------------
 * Coordinate sanitisation — nothing invalid may ever reach Leaflet.
 * A single NaN produces "Invalid LatLng object: (NaN, NaN)" and tears down
 * the whole map, so every value is funnelled through these two guards.
 * ------------------------------------------------------------------------- */

export function toValidCoord(value: unknown): number | null {
  const n = typeof value === 'string' ? Number(value) : (value as number);
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
}

export function isValidCoordPair(lat: unknown, lng: unknown): boolean {
  const a = toValidCoord(lat);
  const b = toValidCoord(lng);
  return (
    a !== null && b !== null &&
    a >= -90 && a <= 90 &&
    b >= -180 && b <= 180
  );
}

const DUBAI_FALLBACK: [number, number] = [25.0756, 55.1454];

const escapeHtml = (value: string): string =>
  String(value).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string)
  );

const TILE_LAYERS = {
  street: {
    // OpenStreetMap's standard tiles: no API key, no signup. CARTO's basemaps
    // now watermark every tile with "API KEY REQUIRED" off localhost, which is
    // only visible once deployed.
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution:
      '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    maxZoom: 19,
  },
  satellite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
  },
} as const;

type LayerKey = keyof typeof TILE_LAYERS;

interface Props {
  businesses: Business[];
  userLocation: UserLocation;
  radiusKm: number;
  activeId: string | null;
  onSelect: (business: Business) => void;
  onHover?: (id: string | null) => void;
}

export default function InteractiveBusinessMap({
  businesses,
  userLocation,
  radiusKm,
  activeId,
  onSelect,
}: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<L.Map | null>(null);
  const tileRef = useRef<L.TileLayer | null>(null);
  const markersRef = useRef<L.LayerGroup | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);
  const circleRef = useRef<L.Circle | null>(null);
  const markerIndex = useRef<Map<string, L.Marker>>(new Map());
  /** Kept in a ref so the marker click handler never closes over a stale prop. */
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  const [layer, setLayer] = useState<LayerKey>('street');

  /** The origin, guaranteed valid. */
  const origin = useMemo<[number, number]>(() => {
    if (isValidCoordPair(userLocation.lat, userLocation.lng)) {
      return [userLocation.lat, userLocation.lng];
    }
    return DUBAI_FALLBACK;
  }, [userLocation.lat, userLocation.lng]);

  /** Only businesses with usable coordinates ever reach Leaflet. */
  const plottable = useMemo(
    () => businesses.filter((b) => isValidCoordPair(b.lat, b.lng)),
    [businesses]
  );

  /** True when the container has a real, non-zero size. */
  const hasUsableSize = useCallback((map: L.Map): boolean => {
    try {
      const size = map.getSize();
      return !!size && size.x > 0 && size.y > 0;
    } catch {
      return false;
    }
  }, []);

  /* ----------------------------- Map lifecycle ---------------------------- */
  useEffect(() => {
    const el = containerRef.current;
    if (!el || mapRef.current) return;

    const map = L.map(el, {
      center: DUBAI_FALLBACK,
      zoom: 13,
      zoomControl: true,
      preferCanvas: false,
      attributionControl: true,
    });
    mapRef.current = map;

    const cfg = TILE_LAYERS.street;
    tileRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(map);

    markersRef.current = L.layerGroup().addTo(map);

    // Layout changes (split view <-> tabs, sidebar collapse) resize the
    // container without a window resize event. Without invalidateSize the
    // map keeps a stale pixel origin and projections start returning NaN.
    let frame = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const m = mapRef.current;
        if (!m) return;
        try {
          if (hasUsableSize(m)) m.invalidateSize({ animate: false });
        } catch {
          /* container detached mid-frame — safe to ignore */
        }
      });
    });
    observer.observe(el);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      markerIndex.current.clear();
      markersRef.current = null;
      userMarkerRef.current = null;
      circleRef.current = null;
      tileRef.current = null;
      try {
        map.remove();
      } catch {
        /* already torn down */
      }
      mapRef.current = null;
    };
  }, [hasUsableSize]);

  /* ------------------------------ Tile switch ----------------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    if (tileRef.current) {
      try {
        map.removeLayer(tileRef.current);
      } catch {
        /* ignore */
      }
    }
    const cfg = TILE_LAYERS[layer];
    tileRef.current = L.tileLayer(cfg.url, {
      attribution: cfg.attribution,
      maxZoom: cfg.maxZoom,
    }).addTo(map);
  }, [layer]);

  /* --------------------- User marker + radius circle ---------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasUsableSize(map)) return;

    const [lat, lng] = origin;
    if (!isValidCoordPair(lat, lng)) return;

    const icon = L.divIcon({
      className: 'bf-user-marker',
      html: '<div class="bf-pulse"><span class="bf-pulse-ring"></span><span class="bf-pulse-dot"></span></div>',
      iconSize: [18, 18],
      iconAnchor: [9, 9],
    });

    try {
      if (userMarkerRef.current) {
        userMarkerRef.current.setLatLng([lat, lng]);
      } else {
        userMarkerRef.current = L.marker([lat, lng], {
          icon,
          zIndexOffset: 1000,
          keyboard: false,
        })
          .addTo(map)
          .bindPopup('<div style="padding:10px 12px;font-weight:700">You are here</div>');
      }

      const radiusMeters = Number.isFinite(radiusKm) ? Math.max(100, radiusKm * 1000) : 5000;
      if (circleRef.current) {
        circleRef.current.setLatLng([lat, lng]);
        circleRef.current.setRadius(radiusMeters);
      } else {
        circleRef.current = L.circle([lat, lng], {
          radius: radiusMeters,
          color: '#E4002B',
          weight: 1.5,
          opacity: 0.55,
          fillColor: '#E4002B',
          fillOpacity: 0.07,
          interactive: false,
        }).addTo(map);
      }
    } catch {
      /* transient layout state — the next effect run repairs it */
    }
  }, [origin, radiusKm, hasUsableSize]);

  /* ------------------------------- Markers -------------------------------- */
  /*
   * The catalogue runs to tens of thousands of businesses, which Leaflet
   * cannot hold as individual markers. Instead we cluster per viewport: on
   * every pan/zoom we project only the points currently in bounds into pixel
   * space, bucket them into a fixed pixel grid, and instantiate one marker per
   * bucket. Marker count is therefore bounded by screen area (~250), not by
   * dataset size, while every business remains addressable.
   */
  const pointsRef = useRef<Business[]>([]);
  pointsRef.current = plottable;

  const CELL_PX = 62;

  /** Builds a single business pin, or null if its coordinates are unusable. */
  const buildBusinessMarker = useCallback((b: Business): L.Marker | null => {
    const lat = toValidCoord(b.lat);
    const lng = toValidCoord(b.lng);
    if (lat === null || lng === null) return null;

    const color = categoryColor(b.category);
    const rated = Number.isFinite(b.rating) && b.rating > 0;
    const label = rated ? `${b.rating.toFixed(1)} &#9733;` : '&#9679;';
    const html = `
      <div style="position:relative;display:flex;flex-direction:column;align-items:center">
        <div style="display:flex;align-items:center;gap:3px;background:${color};color:#fff;
                    padding:3px 7px;border-radius:9px;font-size:11px;font-weight:800;
                    white-space:nowrap;box-shadow:0 2px 8px rgba(16,24,40,.3);
                    border:1.5px solid #fff;font-family:'Plus Jakarta Sans',sans-serif">
          ${label}
        </div>
        <div style="width:2px;height:7px;background:${color}"></div>
      </div>`;

    const marker = L.marker([lat, lng], {
      icon: L.divIcon({
        className: 'bf-marker',
        html,
        iconSize: [46, 30],
        iconAnchor: [23, 30],
      }),
      title: b.name,
    });

    marker.bindPopup(
      `<div style="font-family:'Plus Jakarta Sans',sans-serif">
         <img src="${escapeHtml(b.photos[0] ?? '')}" alt="" style="width:100%;height:104px;object-fit:cover;border-radius:14px 14px 0 0;display:block" />
         <div style="padding:10px 12px 12px">
           <div style="font-weight:800;font-size:13.5px;color:#0f172a;line-height:1.25">${escapeHtml(b.name)}</div>
           <div style="font-size:11.5px;color:#64748b;margin-top:2px">${escapeHtml(b.subcategory)} &middot; ${escapeHtml(b.area)}</div>
           <div style="font-size:11.5px;color:#0f172a;margin-top:6px;font-weight:700">
             ${rated
               ? `&#9733; ${b.rating.toFixed(1)} <span style="color:#94a3b8;font-weight:500">(${b.reviewCount.toLocaleString()})</span>`
               : '<span style="color:#94a3b8;font-weight:600">No ratings yet</span>'}
           </div>
         </div>
       </div>`,
      { closeButton: true, maxWidth: 232 }
    );
    return marker;
  }, []);

  const renderMarkers = useCallback(() => {
    const map = mapRef.current;
    const group = markersRef.current;
    if (!map || !group || !hasUsableSize(map)) return;

    let bounds: L.LatLngBounds;
    try {
      bounds = map.getBounds().pad(0.25);
    } catch {
      return;
    }
    if (!bounds.isValid()) return;

    group.clearLayers();
    markerIndex.current.clear();

    interface Cell { items: Business[]; sx: number; sy: number }
    const cells = new Map<string, Cell>();

    for (const b of pointsRef.current) {
      const lat = toValidCoord(b.lat);
      const lng = toValidCoord(b.lng);
      if (lat === null || lng === null) continue;
      if (!bounds.contains([lat, lng])) continue;

      let px: L.Point;
      try {
        px = map.latLngToLayerPoint([lat, lng]);
      } catch {
        continue;
      }
      if (!Number.isFinite(px.x) || !Number.isFinite(px.y)) continue;

      const key = `${Math.floor(px.x / CELL_PX)}:${Math.floor(px.y / CELL_PX)}`;
      const cell = cells.get(key);
      if (cell) {
        cell.items.push(b);
        cell.sx += lat;
        cell.sy += lng;
      } else {
        cells.set(key, { items: [b], sx: lat, sy: lng });
      }
    }

    cells.forEach((cell) => {
      if (cell.items.length === 1) {
        const b = cell.items[0];
        const marker = buildBusinessMarker(b);
        if (!marker) return;
        marker.on('click', () => onSelectRef.current(b));
        marker.addTo(group);
        markerIndex.current.set(b.id, marker);
        return;
      }

      const count = cell.items.length;
      const lat = cell.sx / count;
      const lng = cell.sy / count;
      if (!isValidCoordPair(lat, lng)) return;

      const size = count > 500 ? 54 : count > 100 ? 48 : count > 20 ? 42 : 36;
      const label = count > 999 ? `${Math.round(count / 1000)}k` : String(count);
      const cluster = L.marker([lat, lng], {
        icon: L.divIcon({
          className: 'bf-marker',
          html: `<div style="width:${size}px;height:${size}px;border-radius:9999px;
                   display:flex;align-items:center;justify-content:center;
                   background:rgba(228,0,43,.92);color:#fff;font-weight:800;
                   font-size:${size > 45 ? 14 : 12}px;border:3px solid #fff;
                   box-shadow:0 3px 12px rgba(16,24,40,.35);
                   font-family:'Plus Jakarta Sans',sans-serif">${label}</div>`,
          iconSize: [size, size],
          iconAnchor: [size / 2, size / 2],
        }),
        title: `${count} businesses`,
      });

      cluster.on('click', () => {
        const m = mapRef.current;
        if (!m || !hasUsableSize(m)) return;
        try {
          const pts = cell.items
            .filter((b) => isValidCoordPair(b.lat, b.lng))
            .map((b) => [b.lat, b.lng] as [number, number]);
          const cb = L.latLngBounds(pts);
          if (cb.isValid()) {
            m.fitBounds(cb, { padding: [56, 56], maxZoom: 18, animate: true });
          }
        } catch {
          /* ignore */
        }
      });

      cluster.addTo(group);
    });
  }, [hasUsableSize, buildBusinessMarker]);

  /* Re-cluster on data change and on every pan/zoom. */
  useEffect(() => {
    renderMarkers();
  }, [plottable, renderMarkers]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const handler = () => renderMarkers();
    map.on('moveend', handler);
    map.on('zoomend', handler);
    return () => {
      map.off('moveend', handler);
      map.off('zoomend', handler);
    };
  }, [renderMarkers]);

  /* ------------------- Recentre when the origin changes ------------------- */
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !hasUsableSize(map)) return;
    const [lat, lng] = origin;
    if (!isValidCoordPair(lat, lng)) return;
    try {
      map.setView([lat, lng], map.getZoom() ?? 13, { animate: true });
    } catch {
      /* ignore */
    }
  }, [origin, hasUsableSize]);

  /* --------------------- Open the active business popup ------------------- */
  useEffect(() => {
    if (!activeId) return;
    const map = mapRef.current;
    const marker = markerIndex.current.get(activeId);
    if (!map || !marker || !hasUsableSize(map)) return;
    try {
      const pos = marker.getLatLng();
      if (isValidCoordPair(pos.lat, pos.lng)) {
        map.panTo(pos, { animate: true });
        marker.openPopup();
      }
    } catch {
      /* ignore */
    }
  }, [activeId, hasUsableSize]);

  /* ------------------------------- Controls ------------------------------- */
  const recenter = useCallback(() => {
    const map = mapRef.current;
    if (!map || !hasUsableSize(map)) return;
    const [lat, lng] = origin;
    if (!isValidCoordPair(lat, lng)) return;
    try {
      map.setView([lat, lng], 14, { animate: true });
    } catch {
      /* ignore */
    }
  }, [origin, hasUsableSize]);

  const fitAll = useCallback(() => {
    const map = mapRef.current;
    if (!map || !hasUsableSize(map)) return;

    const points: L.LatLngExpression[] = [];
    if (isValidCoordPair(origin[0], origin[1])) points.push(origin);
    plottable.forEach((b) => {
      const lat = toValidCoord(b.lat);
      const lng = toValidCoord(b.lng);
      if (lat !== null && lng !== null) points.push([lat, lng]);
    });
    if (points.length === 0) return;

    try {
      const bounds = L.latLngBounds(points);
      if (bounds.isValid()) {
        map.fitBounds(bounds, { padding: [48, 48], maxZoom: 16, animate: true });
      }
    } catch {
      /* ignore */
    }
  }, [origin, plottable, hasUsableSize]);

  return (
    <div className="relative h-full w-full overflow-hidden rounded-2xl border border-slate-200 bg-slate-100">
      <div ref={containerRef} className="h-full w-full" aria-label="Map of nearby businesses" />

      {/* Controls */}
      <div className="pointer-events-none absolute right-3 top-3 z-[500] flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setLayer((l) => (l === 'street' ? 'satellite' : 'street'))}
          className="pointer-events-auto inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-3 text-[12px] font-bold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white"
          title="Toggle satellite imagery"
        >
          <Layers className="h-4 w-4" />
          {layer === 'street' ? 'Satellite' : 'Street'}
        </button>
        <button
          type="button"
          onClick={recenter}
          className="pointer-events-auto inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-3 text-[12px] font-bold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white"
          title="Centre on my location"
        >
          <Crosshair className="h-4 w-4" />
          My location
        </button>
        <button
          type="button"
          onClick={fitAll}
          className="pointer-events-auto inline-flex h-10 items-center gap-1.5 rounded-xl border border-slate-200 bg-white/95 px-3 text-[12px] font-bold text-slate-700 shadow-sm backdrop-blur transition hover:bg-white"
          title="Fit all results"
        >
          <Maximize2 className="h-4 w-4" />
          Fit all
        </button>
      </div>

      {/* Legend */}
      <div className="pointer-events-none absolute bottom-6 left-3 z-[500] rounded-xl border border-slate-200 bg-white/95 px-3 py-2 text-[11px] font-bold text-slate-600 shadow-sm backdrop-blur">
        <span className="text-slate-900">{plottable.length}</span> shown ·{' '}
        <span className="text-dubai-600">{radiusKm} km</span> radius
      </div>
    </div>
  );
}
