import { Heart, MapPin, Plus, Search, Sparkles, X } from 'lucide-react';

interface Props {
  query: string;
  onQueryChange: (value: string) => void;
  onAddBusiness: () => void;
  onOpenAi: () => void;
  onToggleFavorites: () => void;
  favoritesCount: number;
  favoritesActive: boolean;
}

export default function DubizzleNavbar({
  query,
  onQueryChange,
  onAddBusiness,
  onOpenAi,
  onToggleFavorites,
  favoritesCount,
  favoritesActive,
}: Props) {
  return (
    <header className="sticky top-0 z-[900] border-b border-slate-200 bg-white/95 backdrop-blur supports-[backdrop-filter]:bg-white/80">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center gap-3 px-3 sm:px-5">
        {/* Brand */}
        <a href="/" className="flex shrink-0 items-center gap-2" aria-label="BuisnessFind Dubai home">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-dubai-600 text-white shadow-sm">
            <MapPin className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <span className="hidden leading-tight sm:block">
            <span className="block text-[15px] font-extrabold tracking-tight text-slate-900">
              Buisness<span className="text-dubai-600">Find</span>
            </span>
            <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              Dubai
            </span>
          </span>
        </a>

        {/* Search */}
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
          <input
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            type="search"
            placeholder="Search restaurants, gyms, clinics, salons…"
            aria-label="Search businesses"
            className="h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-10 text-sm font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-dubai-300 focus:bg-white focus:ring-4 focus:ring-dubai-100"
          />
          {query.length > 0 && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Clear search"
              className="absolute right-2.5 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-full text-slate-400 transition hover:bg-slate-200 hover:text-slate-700"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Actions */}
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenAi}
            className="hidden h-11 items-center gap-2 rounded-xl border border-slate-200 px-3.5 text-sm font-semibold text-slate-700 transition hover:border-dubai-200 hover:bg-dubai-50 hover:text-dubai-700 md:inline-flex"
          >
            <Sparkles className="h-4 w-4" />
            Smart Finder
          </button>

          <button
            type="button"
            onClick={onToggleFavorites}
            aria-pressed={favoritesActive}
            aria-label="Show saved businesses"
            className={`relative grid h-11 w-11 place-items-center rounded-xl border transition ${
              favoritesActive
                ? 'border-dubai-200 bg-dubai-50 text-dubai-600'
                : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            }`}
          >
            <Heart className={`h-5 w-5 ${favoritesActive ? 'fill-dubai-600' : ''}`} />
            {favoritesCount > 0 && (
              <span className="absolute -right-1 -top-1 grid h-5 min-w-[20px] place-items-center rounded-full bg-dubai-600 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                {favoritesCount}
              </span>
            )}
          </button>

          <button
            type="button"
            onClick={onAddBusiness}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-dubai-600 px-3.5 text-sm font-bold text-white shadow-sm transition hover:bg-dubai-700 active:scale-[0.98]"
          >
            <Plus className="h-4 w-4" strokeWidth={2.6} />
            <span className="hidden sm:inline">List your business</span>
          </button>
        </div>
      </div>
    </header>
  );
}
