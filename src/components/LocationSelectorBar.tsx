import { ChevronDown, Crosshair, LoaderCircle, MapPin, TriangleAlert } from 'lucide-react';
import { DUBAI_AREAS } from '../data/dubaiAreas';
import type { GpsStatus, UserLocation } from '../types';

interface Props {
  activeAreaId: string;
  onAreaChange: (areaId: string) => void;
  onUseGps: () => void;
  userLocation: UserLocation;
  gpsStatus: GpsStatus;
  resultCount: number;
}

const statusCopy: Record<GpsStatus, string | null> = {
  idle: null,
  locating: 'Locating you…',
  granted: null,
  denied: 'Location permission denied — pick a district instead.',
  unavailable: 'Location unavailable — pick a district instead.',
};

export default function LocationSelectorBar({
  activeAreaId,
  onAreaChange,
  onUseGps,
  userLocation,
  gpsStatus,
  resultCount,
}: Props) {
  const message = statusCopy[gpsStatus];
  const isError = gpsStatus === 'denied' || gpsStatus === 'unavailable';

  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-3 px-3 py-3 sm:px-5">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-500">
          <MapPin className="h-4 w-4 text-dubai-600" />
          Searching near
        </div>

        {/* District picker */}
        <div className="relative">
          <select
            value={activeAreaId}
            onChange={(e) => onAreaChange(e.target.value)}
            aria-label="Choose a Dubai district"
            className="h-10 appearance-none rounded-xl border border-slate-200 bg-slate-50 pl-3.5 pr-9 text-sm font-bold text-slate-900 outline-none transition hover:bg-slate-100 focus:border-dubai-300 focus:ring-4 focus:ring-dubai-100"
          >
            {DUBAI_AREAS.map((area) => (
              <option key={area.id} value={area.id}>
                {area.name}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
        </div>

        {/* GPS */}
        <button
          type="button"
          onClick={onUseGps}
          disabled={gpsStatus === 'locating'}
          className="inline-flex h-10 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 transition hover:border-dubai-200 hover:bg-dubai-50 hover:text-dubai-700 disabled:cursor-wait disabled:opacity-60"
        >
          {gpsStatus === 'locating' ? (
            <LoaderCircle className="h-4 w-4 animate-spin" />
          ) : (
            <Crosshair className="h-4 w-4" />
          )}
          Use my GPS location
        </button>

        {/* Active origin badge */}
        {userLocation.source === 'gps' && (
          <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-bold text-emerald-700 ring-1 ring-emerald-200">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            GPS active
            {typeof userLocation.accuracy === 'number' && Number.isFinite(userLocation.accuracy) && (
              <span className="font-semibold text-emerald-600">
                ±{Math.round(userLocation.accuracy)} m
              </span>
            )}
          </span>
        )}

        {message && (
          <span
            className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
              isError ? 'text-amber-700' : 'text-slate-500'
            }`}
          >
            {isError && <TriangleAlert className="h-3.5 w-3.5" />}
            {message}
          </span>
        )}

        <div className="ml-auto text-sm font-semibold text-slate-500">
          <span className="font-extrabold text-slate-900">{resultCount}</span>{' '}
          {resultCount === 1 ? 'business' : 'businesses'} found
        </div>
      </div>
    </div>
  );
}
