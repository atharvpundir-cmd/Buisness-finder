import { useState } from 'react';
import {
  BadgeCheck, Heart, MapPin, MessageCircle, Navigation, Star,
} from 'lucide-react';
import { getCategory } from '../data/categories';
import { formatDistance, isOpenNow, todayHours } from '../data/businesses';
import { directionsUrl, priceLabel, whatsappUrl } from '../lib/links';
import { getIcon } from '../lib/icons';
import type { Business } from '../types';

interface Props {
  business: Business;
  isFavorite: boolean;
  isActive: boolean;
  onToggleFavorite: (id: string) => void;
  onOpen: (business: Business) => void;
  onHover?: (id: string | null) => void;
}

export default function DubizzleBusinessCard({
  business,
  isFavorite,
  isActive,
  onToggleFavorite,
  onOpen,
  onHover,
}: Props) {
  const [photoIndex, setPhotoIndex] = useState(0);
  const category = getCategory(business.category);
  const Icon = getIcon(category.icon);
  const open = isOpenNow(business);
  const photos = business.photos.length > 0 ? business.photos : [''];
  const photo = photos[Math.min(photoIndex, photos.length - 1)];

  return (
    <article
      onMouseEnter={() => {
        onHover?.(business.id);
        if (photos.length > 1) setPhotoIndex(1);
      }}
      onMouseLeave={() => {
        onHover?.(null);
        setPhotoIndex(0);
      }}
      className={`group overflow-hidden rounded-2xl border bg-white shadow-card transition duration-200 hover:-translate-y-0.5 hover:shadow-pop ${
        isActive ? 'border-dubai-400 ring-2 ring-dubai-200' : 'border-slate-200'
      }`}
    >
      <div className="flex flex-col sm:flex-row">
        {/* Image */}
        <button
          type="button"
          onClick={() => onOpen(business)}
          aria-label={`View ${business.name}`}
          className="relative block h-48 w-full shrink-0 overflow-hidden bg-slate-100 sm:h-auto sm:w-[232px]"
        >
          {photo ? (
            <img
              src={photo}
              alt={business.name}
              loading="lazy"
              className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.04]"
            />
          ) : (
            <span className="grid h-full w-full place-items-center text-slate-300">
              <Icon className="h-10 w-10" />
            </span>
          )}

          {/* Photo dots */}
          {photos.length > 1 && (
            <span className="absolute bottom-2.5 left-1/2 flex -translate-x-1/2 gap-1">
              {photos.map((_, i) => (
                <span
                  key={i}
                  className={`h-1.5 rounded-full transition-all ${
                    i === photoIndex ? 'w-4 bg-white' : 'w-1.5 bg-white/60'
                  }`}
                />
              ))}
            </span>
          )}

          {business.featured && (
            <span className="absolute left-2.5 top-2.5 rounded-lg bg-amber-400 px-2 py-1 text-[10px] font-extrabold uppercase tracking-wide text-amber-950 shadow-sm">
              Featured
            </span>
          )}
        </button>

        {/* Body */}
        <div className="flex min-w-0 flex-1 flex-col p-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ring-1 ${category.chipBg} ${category.chipText} ${category.chipRing}`}
                >
                  <Icon className="h-3 w-3" />
                  {business.subcategory}
                </span>
                {business.verified && (
                  <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 ring-1 ring-emerald-200">
                    <BadgeCheck className="h-3 w-3" />
                    Verified
                  </span>
                )}
              </div>

              <h3
                onClick={() => onOpen(business)}
                className="mt-1.5 cursor-pointer truncate text-[17px] font-extrabold leading-tight text-slate-900 transition hover:text-dubai-600"
              >
                {business.name}
              </h3>
              <p dir="rtl" className="truncate text-[13px] font-medium text-slate-400">
                {business.nameAr}
              </p>
            </div>

            <button
              type="button"
              onClick={() => onToggleFavorite(business.id)}
              aria-pressed={isFavorite}
              aria-label={isFavorite ? 'Remove from saved' : 'Save business'}
              className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl border transition ${
                isFavorite
                  ? 'border-dubai-200 bg-dubai-50 text-dubai-600'
                  : 'border-slate-200 text-slate-400 hover:border-dubai-200 hover:text-dubai-600'
              }`}
            >
              <Heart className={`h-4 w-4 ${isFavorite ? 'fill-dubai-600' : ''}`} />
            </button>
          </div>

          {/* Rating + meta */}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            <span className="inline-flex items-center gap-1 font-bold text-slate-900">
              <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
              {business.rating.toFixed(1)}
              <span className="font-medium text-slate-400">
                ({business.reviewCount.toLocaleString()})
              </span>
            </span>
            <span className="font-bold text-slate-700">{priceLabel(business.priceTier)}</span>
            <span
              className={`inline-flex items-center gap-1 font-bold ${
                open ? 'text-emerald-600' : 'text-slate-400'
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full ${open ? 'bg-emerald-500' : 'bg-slate-300'}`}
              />
              {open ? 'Open now' : 'Closed'}
              <span className="font-medium text-slate-400">· {todayHours(business)}</span>
            </span>
          </div>

          <p className="mt-2 line-clamp-2 text-[13px] leading-relaxed text-slate-500">
            {business.description}
          </p>

          {/* Footer */}
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
            <span className="inline-flex items-center gap-1 text-[12px] font-semibold text-slate-500">
              <MapPin className="h-3.5 w-3.5 text-slate-400" />
              {business.area}
            </span>
            {typeof business.distanceKm === 'number' && (
              <span className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-extrabold text-white">
                {formatDistance(business.distanceKm)} away
              </span>
            )}

            <div className="ml-auto flex items-center gap-2">
              <a
                href={whatsappUrl(business)}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-500 px-3 text-[12px] font-bold text-white transition hover:bg-emerald-600"
              >
                <MessageCircle className="h-3.5 w-3.5" />
                WhatsApp
              </a>
              <a
                href={directionsUrl(business)}
                target="_blank"
                rel="noreferrer noopener"
                onClick={(e) => e.stopPropagation()}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 px-3 text-[12px] font-bold text-slate-700 transition hover:border-dubai-200 hover:bg-dubai-50 hover:text-dubai-700"
              >
                <Navigation className="h-3.5 w-3.5" />
                Directions
              </a>
            </div>
          </div>
        </div>
      </div>
    </article>
  );
}
