import { useEffect, useState } from 'react';
import {
  BadgeCheck, Check, ChevronLeft, ChevronRight, Globe, Heart, MapPin,
  MessageCircle, Navigation, Phone, Star, X,
} from 'lucide-react';
import { getCategory } from '../data/categories';
import {
  WEEKDAYS, formatDistance, isOpenNow, todayHours,
} from '../data/businesses';
import { directionsUrl, priceLabel, telUrl, whatsappUrl } from '../lib/links';
import { getIcon } from '../lib/icons';
import type { Business } from '../types';

interface Props {
  business: Business | null;
  isFavorite: boolean;
  onToggleFavorite: (id: string) => void;
  onClose: () => void;
}

export default function BusinessDetailModal({
  business,
  isFavorite,
  onToggleFavorite,
  onClose,
}: Props) {
  const [index, setIndex] = useState(0);

  useEffect(() => setIndex(0), [business?.id]);

  useEffect(() => {
    if (!business) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [business, onClose]);

  if (!business) return null;

  const category = getCategory(business.category);
  const Icon = getIcon(category.icon);
  const open = isOpenNow(business);
  const photos = business.photos.length > 0 ? business.photos : [''];
  const todayName = WEEKDAYS[(new Date().getDay() + 6) % 7];

  const step = (dir: -1 | 1) =>
    setIndex((i) => (i + dir + photos.length) % photos.length);

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/60 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={business.name}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-3xl animate-scaleIn flex-col overflow-hidden rounded-t-3xl bg-white shadow-pop sm:rounded-3xl"
      >
        {/* Gallery */}
        <div className="relative h-60 shrink-0 bg-slate-200 sm:h-72">
          {photos[index] ? (
            <img
              src={photos[index]}
              alt={`${business.name} photo ${index + 1}`}
              className="h-full w-full object-cover"
            />
          ) : (
            <span className="grid h-full w-full place-items-center text-slate-400">
              <Icon className="h-12 w-12" />
            </span>
          )}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-slate-900/70 via-transparent to-slate-900/20" />

          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-full bg-white/90 text-slate-700 shadow-sm transition hover:bg-white"
          >
            <X className="h-[18px] w-[18px]" />
          </button>

          <button
            type="button"
            onClick={() => onToggleFavorite(business.id)}
            aria-label={isFavorite ? 'Remove from saved' : 'Save business'}
            className="absolute right-3 top-14 grid h-9 w-9 place-items-center rounded-full bg-white/90 shadow-sm transition hover:bg-white"
          >
            <Heart
              className={`h-4 w-4 ${isFavorite ? 'fill-dubai-600 text-dubai-600' : 'text-slate-700'}`}
            />
          </button>

          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => step(-1)}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-700 shadow-sm transition hover:bg-white"
              >
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 grid h-9 w-9 -translate-y-1/2 place-items-center rounded-full bg-white/90 text-slate-700 shadow-sm transition hover:bg-white"
              >
                <ChevronRight className="h-5 w-5" />
              </button>
              <div className="absolute bottom-3 left-1/2 flex -translate-x-1/2 gap-1.5">
                {photos.map((_, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => setIndex(i)}
                    aria-label={`Photo ${i + 1}`}
                    className={`h-1.5 rounded-full transition-all ${
                      i === index ? 'w-5 bg-white' : 'w-1.5 bg-white/60'
                    }`}
                  />
                ))}
              </div>
            </>
          )}

          <div className="absolute bottom-3 left-4 flex items-center gap-2">
            {business.featured && (
              <span className="rounded-lg bg-amber-400 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-amber-950">
                Featured
              </span>
            )}
            {business.verified && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-500 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-white">
                <BadgeCheck className="h-3 w-3" />
                Verified
              </span>
            )}
          </div>
        </div>

        {/* Scrollable body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="p-5 sm:p-6">
            <div className="flex flex-wrap items-start gap-3">
              <div className="min-w-0 flex-1">
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${category.chipBg} ${category.chipText} ${category.chipRing}`}
                >
                  <Icon className="h-3 w-3" />
                  {business.subcategory}
                </span>
                <h2 className="mt-2 text-2xl font-extrabold leading-tight tracking-tight text-slate-900">
                  {business.name}
                </h2>
                <p dir="rtl" className="text-[15px] font-semibold text-slate-400">
                  {business.nameAr}
                </p>
              </div>

              <div className="text-right">
                <div className="inline-flex items-center gap-1.5 rounded-xl bg-amber-50 px-3 py-2 ring-1 ring-amber-200">
                  <Star className="h-4 w-4 fill-amber-400 text-amber-400" />
                  <span className="text-lg font-extrabold text-slate-900">
                    {business.rating.toFixed(1)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] font-semibold text-slate-400">
                  {business.reviewCount.toLocaleString()} reviews
                </p>
              </div>
            </div>

            {/* Status strip */}
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-[12px] font-bold ring-1 ${
                  open
                    ? 'bg-emerald-50 text-emerald-700 ring-emerald-200'
                    : 'bg-slate-100 text-slate-500 ring-slate-200'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${open ? 'bg-emerald-500' : 'bg-slate-400'}`}
                />
                {open ? 'Open now' : 'Closed'} · {todayHours(business)}
              </span>
              <span className="rounded-full bg-slate-100 px-3 py-1.5 text-[12px] font-bold text-slate-700">
                {priceLabel(business.priceTier)}
              </span>
              {typeof business.distanceKm === 'number' && (
                <span className="rounded-full bg-slate-900 px-3 py-1.5 text-[12px] font-extrabold text-white">
                  {formatDistance(business.distanceKm)} away
                </span>
              )}
            </div>

            {/* Actions */}
            <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <a
                href={whatsappUrl(business)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-emerald-500 text-[13px] font-bold text-white transition hover:bg-emerald-600"
              >
                <MessageCircle className="h-4 w-4" />
                WhatsApp
              </a>
              <a
                href={directionsUrl(business)}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl bg-dubai-600 text-[13px] font-bold text-white transition hover:bg-dubai-700"
              >
                <Navigation className="h-4 w-4" />
                Directions
              </a>
              <a
                href={telUrl(business)}
                className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-[13px] font-bold text-slate-700 transition hover:bg-slate-50"
              >
                <Phone className="h-4 w-4" />
                Call
              </a>
              {business.website ? (
                <a
                  href={business.website}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-slate-200 text-[13px] font-bold text-slate-700 transition hover:bg-slate-50"
                >
                  <Globe className="h-4 w-4" />
                  Website
                </a>
              ) : (
                <span className="inline-flex h-11 items-center justify-center gap-1.5 rounded-xl border border-dashed border-slate-200 text-[13px] font-bold text-slate-300">
                  <Globe className="h-4 w-4" />
                  No site
                </span>
              )}
            </div>

            {/* About */}
            <section className="mt-6">
              <h3 className="text-[13px] font-extrabold uppercase tracking-wider text-slate-400">
                About
              </h3>
              <p className="mt-2 text-[14px] leading-relaxed text-slate-600">
                {business.description}
              </p>
              <p className="mt-3 inline-flex items-start gap-2 text-[13px] font-semibold text-slate-500">
                <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-dubai-600" />
                {business.address}, {business.area}
              </p>
            </section>

            {/* Hours */}
            <section className="mt-6">
              <h3 className="text-[13px] font-extrabold uppercase tracking-wider text-slate-400">
                Opening hours
              </h3>
              <div className="mt-2 overflow-hidden rounded-xl border border-slate-200">
                {WEEKDAYS.map((day) => {
                  const row = business.hours.find((h) => h.day === day);
                  const isToday = day === todayName;
                  return (
                    <div
                      key={day}
                      className={`flex items-center justify-between px-3.5 py-2.5 text-[13px] ${
                        isToday ? 'bg-dubai-50' : 'bg-white'
                      } border-b border-slate-100 last:border-b-0`}
                    >
                      <span
                        className={`font-bold ${isToday ? 'text-dubai-700' : 'text-slate-700'}`}
                      >
                        {day}
                        {isToday && (
                          <span className="ml-2 rounded bg-dubai-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">
                            Today
                          </span>
                        )}
                      </span>
                      <span
                        className={`font-semibold ${
                          !row || row.closed ? 'text-slate-400' : 'text-slate-600'
                        }`}
                      >
                        {!row || row.closed
                          ? 'Closed'
                          : row.open === '00:00' && row.close === '23:59'
                            ? 'Open 24 hours'
                            : `${row.open} – ${row.close}`}
                      </span>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Amenities */}
            <section className="mt-6">
              <h3 className="text-[13px] font-extrabold uppercase tracking-wider text-slate-400">
                Amenities
              </h3>
              <ul className="mt-2 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {business.amenities.map((a) => (
                  <li
                    key={a}
                    className="inline-flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-[13px] font-semibold text-slate-700"
                  >
                    <Check className="h-3.5 w-3.5 shrink-0 text-emerald-600" strokeWidth={3} />
                    {a}
                  </li>
                ))}
              </ul>
            </section>

            {/* Tags */}
            <section className="mt-6">
              <h3 className="text-[13px] font-extrabold uppercase tracking-wider text-slate-400">
                Tags
              </h3>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {business.tags.map((t) => (
                  <span
                    key={t}
                    className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-bold text-slate-600"
                  >
                    #{t}
                  </span>
                ))}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
