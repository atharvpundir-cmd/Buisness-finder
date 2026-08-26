import { ArrowUpDown, BadgeCheck, Clock, Star } from 'lucide-react';
import type { FilterState, SortKey } from '../types';

export const RADIUS_PRESETS = [1, 2, 3, 5, 10, 15, 25];

const SORT_OPTIONS: { value: SortKey; label: string }[] = [
  { value: 'distance', label: 'Nearest first' },
  { value: 'rating', label: 'Highest rated' },
  { value: 'reviews', label: 'Most reviews' },
  { value: 'name', label: 'Name (A–Z)' },
];

interface Props {
  filters: FilterState;
  onChange: <K extends keyof FilterState>(key: K, value: FilterState[K]) => void;
}

function Toggle({
  active,
  onClick,
  icon,
  label,
  activeClasses,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  activeClasses: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-[13px] font-bold transition ${
        active ? activeClasses : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
      }`}
    >
      {icon}
      {label}
    </button>
  );
}

export default function RadiusFilterBar({ filters, onChange }: Props) {
  return (
    <div className="border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-[1600px] px-3 py-3 sm:px-5">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
          {/* Radius presets */}
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-400">
              Radius
            </span>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {RADIUS_PRESETS.map((km) => {
                const active = filters.radiusKm === km;
                return (
                  <button
                    key={km}
                    type="button"
                    onClick={() => onChange('radiusKm', km)}
                    aria-pressed={active}
                    className={`h-9 min-w-[52px] rounded-full border px-3 text-[13px] font-bold transition ${
                      active
                        ? 'border-dubai-600 bg-dubai-600 text-white shadow-sm'
                        : 'border-slate-200 bg-white text-slate-600 hover:border-dubai-200 hover:bg-dubai-50 hover:text-dubai-700'
                    }`}
                  >
                    {km} km
                  </button>
                );
              })}
            </div>
          </div>

          <span className="hidden h-6 w-px bg-slate-200 lg:block" />

          {/* Quality toggles */}
          <div className="flex flex-wrap items-center gap-1.5">
            <Toggle
              active={filters.openNow}
              onClick={() => onChange('openNow', !filters.openNow)}
              icon={<Clock className="h-3.5 w-3.5" />}
              label="Open now"
              activeClasses="border-emerald-600 bg-emerald-600 text-white shadow-sm"
            />
            <Toggle
              active={filters.verifiedOnly}
              onClick={() => onChange('verifiedOnly', !filters.verifiedOnly)}
              icon={<BadgeCheck className="h-3.5 w-3.5" />}
              label="Verified only"
              activeClasses="border-emerald-600 bg-emerald-600 text-white shadow-sm"
            />
            <Toggle
              active={filters.topRated}
              onClick={() => onChange('topRated', !filters.topRated)}
              icon={<Star className="h-3.5 w-3.5" />}
              label="4.5+ rated"
              activeClasses="border-amber-500 bg-amber-500 text-white shadow-sm"
            />
          </div>

          {/* Sort */}
          <div className="ml-auto flex items-center gap-2">
            <ArrowUpDown className="h-4 w-4 text-slate-400" />
            <select
              value={filters.sort}
              onChange={(e) => onChange('sort', e.target.value as SortKey)}
              aria-label="Sort results"
              className="h-9 rounded-xl border border-slate-200 bg-white px-3 text-[13px] font-bold text-slate-800 outline-none transition hover:bg-slate-50 focus:border-dubai-300 focus:ring-4 focus:ring-dubai-100"
            >
              {SORT_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
