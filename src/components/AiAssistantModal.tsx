import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowRight, LoaderCircle, Send, Sparkles, X } from 'lucide-react';
import { CATEGORIES } from '../data/categories';
import type { Business, CategoryId, FilterState } from '../types';

export interface AiPlan {
  patch: Partial<FilterState>;
  summary: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  businesses: Business[];
  onApply: (plan: AiPlan) => void;
}

const QUICK_PROMPTS = [
  'Find 24/7 pharmacies near me',
  'Laptop-friendly cafes with WiFi & power plugs in Marina',
  'Top-rated gyms with personal trainers',
  'Affordable family restaurants open right now',
  'Verified clinics within 3 km',
  'Luxury spas and salons for the weekend',
];

/** Keyword -> category routing table. */
const CATEGORY_HINTS: [CategoryId, string[]][] = [
  ['pharmacies', ['pharmacy', 'pharmacies', 'chemist', 'medicine', 'prescription']],
  ['healthcare', ['clinic', 'clinics', 'doctor', 'hospital', 'dentist', 'medical', 'health']],
  ['cafes', ['cafe', 'cafes', 'coffee', 'bakery', 'espresso', 'brunch spot']],
  ['dining', ['restaurant', 'restaurants', 'dining', 'eat', 'food', 'dinner', 'lunch', 'shawarma', 'biryani']],
  ['fitness', ['gym', 'gyms', 'fitness', 'workout', 'trainer', 'crossfit', 'yoga']],
  ['salons', ['salon', 'salons', 'spa', 'spas', 'barber', 'massage', 'nails', 'grooming']],
  ['groceries', ['grocery', 'groceries', 'supermarket', 'hypermarket', 'spinneys', 'carrefour']],
  ['shopping', ['mall', 'malls', 'shopping', 'retail', 'store', 'fashion']],
  ['automotive', ['car', 'garage', 'tyre', 'tyres', 'automotive', 'mechanic', 'service centre']],
  ['coworking', ['coworking', 'co-working', 'desk', 'workspace', 'office space']],
];

const AMENITY_HINTS: [string, string[]][] = [
  ['wifi', ['wifi', 'wi-fi', 'internet', 'laptop']],
  ['power outlets', ['power', 'plug', 'plugs', 'socket', 'outlet']],
  ['personal trainer', ['personal trainer', 'trainers', 'coaching']],
  ['delivery', ['delivery', 'deliver']],
  ['parking', ['parking', 'park']],
  ['24 hours', ['24/7', '24 7', '24-hour', '24 hour', 'all night', 'always open', 'round the clock']],
];

/**
 * Deterministic intent parser. Reads a natural-language request and produces a
 * concrete filter patch — the "concierge" is a rule engine over the catalogue,
 * so results are instant and never hallucinated.
 */
export function planFromPrompt(prompt: string): AiPlan {
  const text = prompt.toLowerCase();
  const patch: Partial<FilterState> = { favoritesOnly: false };
  const notes: string[] = [];

  for (const [category, words] of CATEGORY_HINTS) {
    if (words.some((w) => text.includes(w))) {
      patch.category = category;
      const label = CATEGORIES.find((c) => c.id === category)?.label ?? category;
      notes.push(label);
      break;
    }
  }

  const keywords: string[] = [];
  for (const [amenity, words] of AMENITY_HINTS) {
    if (words.some((w) => text.includes(w))) keywords.push(amenity);
  }

  if (/24\s*\/?\s*7|24[- ]hour|always open|round the clock|all night/.test(text)) {
    patch.openNow = true;
    notes.push('open around the clock');
  }
  if (/open (right )?now|open today|currently open/.test(text)) {
    patch.openNow = true;
    notes.push('open now');
  }
  if (/verified|trusted|licensed/.test(text)) {
    patch.verifiedOnly = true;
    notes.push('verified only');
  }
  if (/top[- ]rated|best|highest rated|excellent|great/.test(text)) {
    patch.topRated = true;
    patch.sort = 'rating';
    notes.push('rated 4.5+');
  }
  if (/cheap|affordable|budget|inexpensive/.test(text)) {
    keywords.push('budget');
    notes.push('budget friendly');
  }
  if (/luxury|premium|high[- ]end|fine dining/.test(text)) {
    keywords.push('luxury');
    notes.push('premium');
  }
  if (/near me|nearby|closest|walking distance/.test(text)) {
    patch.sort = 'distance';
    notes.push('closest first');
  }

  const radiusMatch = text.match(/(\d+(?:\.\d+)?)\s*km/);
  if (radiusMatch) {
    const km = Number(radiusMatch[1]);
    if (Number.isFinite(km) && km > 0) {
      patch.radiusKm = Math.min(25, Math.max(1, Math.round(km)));
      notes.push(`within ${patch.radiusKm} km`);
    }
  }

  // Free-text keywords become the search query so tags/amenities match too.
  if (keywords.length > 0) {
    patch.query = keywords[0];
  } else {
    const areaWord = ['marina', 'jlt', 'downtown', 'difc', 'barsha', 'deira', 'jumeirah', 'quoz', 'palm']
      .find((w) => text.includes(w));
    if (areaWord) {
      patch.query = areaWord;
      notes.push(`in ${areaWord.toUpperCase()}`);
    }
  }

  const summary =
    notes.length > 0
      ? `Filtering for ${notes.join(', ')}.`
      : 'Showing the closest matches across every category.';

  return { patch, summary };
}

export default function AiAssistantModal({ open, onClose, businesses, onApply }: Props) {
  const [prompt, setPrompt] = useState('');
  const [thinking, setThinking] = useState(false);
  const [plan, setPlan] = useState<AiPlan | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!open) return;
    setPrompt('');
    setPlan(null);
    setThinking(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const focus = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      window.clearTimeout(focus);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [open, onClose]);

  const previewCount = useMemo(() => {
    if (!plan?.patch.category) return businesses.length;
    return businesses.filter((b) => b.category === plan.patch.category).length;
  }, [plan, businesses]);

  if (!open) return null;

  const run = (text: string) => {
    const q = text.trim();
    if (!q) return;
    setPrompt(q);
    setThinking(true);
    setPlan(null);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      setPlan(planFromPrompt(q));
      setThinking(false);
    }, 550);
  };

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="Smart Finder"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-xl animate-scaleIn flex-col overflow-hidden rounded-t-3xl bg-white shadow-pop sm:rounded-3xl"
      >
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-dubai-600 via-dubai-600 to-dubai-800 px-5 py-5 text-white">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
          <div className="flex items-center gap-2.5">
            <span className="grid h-10 w-10 place-items-center rounded-xl bg-white/15 backdrop-blur">
              <Sparkles className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-extrabold tracking-tight">Smart Finder</h2>
              <p className="text-[12px] font-semibold text-white/75">
                Describe what you need — I'll filter the directory instantly.
              </p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              run(prompt);
            }}
            className="relative"
          >
            <input
              ref={inputRef}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="e.g. quiet cafe with WiFi near JLT open now"
              aria-label="Describe what you are looking for"
              className="h-12 w-full rounded-xl border border-slate-200 bg-slate-50 pl-4 pr-12 text-sm font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-dubai-300 focus:bg-white focus:ring-4 focus:ring-dubai-100"
            />
            <button
              type="submit"
              aria-label="Ask"
              disabled={!prompt.trim() || thinking}
              className="absolute right-2 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-lg bg-dubai-600 text-white transition hover:bg-dubai-700 disabled:opacity-40"
            >
              {thinking ? (
                <LoaderCircle className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </button>
          </form>

          {/* Result */}
          {thinking && (
            <div className="mt-4 flex items-center gap-2 rounded-xl bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-500">
              <LoaderCircle className="h-4 w-4 animate-spin text-dubai-600" />
              Reading the directory…
            </div>
          )}

          {plan && !thinking && (
            <div className="mt-4 animate-fadeUp rounded-2xl border border-dubai-100 bg-dubai-50/60 p-4">
              <p className="text-[13px] font-bold text-slate-800">{plan.summary}</p>
              <p className="mt-1 text-[12px] font-semibold text-slate-500">
                About {previewCount} {previewCount === 1 ? 'business' : 'businesses'} match this
                shape before distance filtering.
              </p>
              <button
                type="button"
                onClick={() => {
                  onApply(plan);
                  onClose();
                }}
                className="mt-3 inline-flex h-10 items-center gap-1.5 rounded-xl bg-dubai-600 px-4 text-[13px] font-extrabold text-white transition hover:bg-dubai-700"
              >
                Apply these filters
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          )}

          {/* Quick prompts */}
          <div className="mt-5">
            <p className="text-[11px] font-extrabold uppercase tracking-wider text-slate-400">
              Try one of these
            </p>
            <div className="mt-2 grid gap-1.5">
              {QUICK_PROMPTS.map((q) => (
                <button
                  key={q}
                  type="button"
                  onClick={() => run(q)}
                  className="group flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3.5 py-2.5 text-left text-[13px] font-semibold text-slate-700 transition hover:border-dubai-200 hover:bg-dubai-50 hover:text-dubai-700"
                >
                  <Sparkles className="h-3.5 w-3.5 shrink-0 text-dubai-500" />
                  <span className="min-w-0 flex-1 truncate">{q}</span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-dubai-500" />
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
