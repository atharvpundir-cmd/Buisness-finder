import { useRef } from 'react';
import { ChevronLeft, ChevronRight, LayoutGrid } from 'lucide-react';
import { CATEGORIES } from '../data/categories';
import { getIcon } from '../lib/icons';
import type { CategoryId } from '../types';

interface Props {
  active: CategoryId | 'all';
  counts: Record<string, number>;
  totalCount: number;
  onChange: (category: CategoryId | 'all') => void;
}

export default function DubizzleCategoryCarousel({
  active,
  counts,
  totalCount,
  onChange,
}: Props) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);

  const nudge = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollBy({ left: direction * 320, behavior: 'smooth' });
  };

  return (
    <div className="relative border-b border-slate-200 bg-white">
      <div className="mx-auto max-w-[1600px] px-3 sm:px-5">
        <div className="relative">
          <button
            type="button"
            onClick={() => nudge(-1)}
            aria-label="Scroll categories left"
            className="absolute -left-1 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:bg-slate-50 lg:grid"
          >
            <ChevronLeft className="h-4 w-4 text-slate-600" />
          </button>

          <div
            ref={scrollerRef}
            className="flex items-stretch gap-2 overflow-x-auto scroll-smooth py-3 no-scrollbar"
          >
            {/* All */}
            <button
              type="button"
              onClick={() => onChange('all')}
              aria-pressed={active === 'all'}
              className={`group flex min-w-[112px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-3 py-2.5 transition ${
                active === 'all'
                  ? 'border-dubai-600 bg-dubai-50 ring-1 ring-dubai-200'
                  : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
              }`}
            >
              <span
                className={`grid h-9 w-9 place-items-center rounded-xl ${
                  active === 'all' ? 'bg-dubai-600 text-white' : 'bg-slate-100 text-slate-600'
                }`}
              >
                <LayoutGrid className="h-[18px] w-[18px]" />
              </span>
              <span
                className={`text-center text-[11px] font-bold leading-tight ${
                  active === 'all' ? 'text-dubai-700' : 'text-slate-700'
                }`}
              >
                All categories
              </span>
              <span className="text-[10px] font-semibold text-slate-400">{totalCount}</span>
            </button>

            {CATEGORIES.map((cat) => {
              const Icon = getIcon(cat.icon);
              const isActive = active === cat.id;
              const count = counts[cat.id] ?? 0;
              return (
                <button
                  key={cat.id}
                  type="button"
                  onClick={() => onChange(cat.id)}
                  aria-pressed={isActive}
                  className={`group flex min-w-[112px] shrink-0 flex-col items-center gap-1.5 rounded-2xl border px-3 py-2.5 transition ${
                    isActive
                      ? 'border-dubai-600 bg-dubai-50 ring-1 ring-dubai-200'
                      : 'border-slate-200 bg-white hover:border-slate-300 hover:bg-slate-50'
                  }`}
                >
                  <span
                    className="grid h-9 w-9 place-items-center rounded-xl text-white transition group-hover:scale-105"
                    style={{ backgroundColor: cat.color }}
                  >
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <span
                    className={`text-center text-[11px] font-bold leading-tight ${
                      isActive ? 'text-dubai-700' : 'text-slate-700'
                    }`}
                  >
                    {cat.label}
                  </span>
                  <span className="text-[10px] font-semibold text-slate-400">{count}</span>
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => nudge(1)}
            aria-label="Scroll categories right"
            className="absolute -right-1 top-1/2 z-10 hidden h-8 w-8 -translate-y-1/2 place-items-center rounded-full border border-slate-200 bg-white shadow-sm transition hover:bg-slate-50 lg:grid"
          >
            <ChevronRight className="h-4 w-4 text-slate-600" />
          </button>
        </div>
      </div>
    </div>
  );
}
