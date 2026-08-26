import type { BusinessCategory, CategoryId } from '../types';

/**
 * The ten top-level categories. `color` is a literal hex string because it is
 * injected straight into Leaflet divIcon markup, where Tailwind classes do not
 * apply.
 */
export const CATEGORIES: BusinessCategory[] = [
  {
    id: 'dining', label: 'Dining & Restaurants', labelAr: 'مطاعم',
    icon: 'UtensilsCrossed', color: '#E4002B',
    chipBg: 'bg-dubai-50', chipText: 'text-dubai-700', chipRing: 'ring-dubai-200',
  },
  {
    id: 'cafes', label: 'Cafes & Bakeries', labelAr: 'مقاهي ومخابز',
    icon: 'Coffee', color: '#B45309',
    chipBg: 'bg-amber-50', chipText: 'text-amber-700', chipRing: 'ring-amber-200',
  },
  {
    id: 'shopping', label: 'Shopping & Retail', labelAr: 'تسوق',
    icon: 'ShoppingBag', color: '#7C3AED',
    chipBg: 'bg-violet-50', chipText: 'text-violet-700', chipRing: 'ring-violet-200',
  },
  {
    id: 'groceries', label: 'Supermarkets & Groceries', labelAr: 'بقالة',
    icon: 'ShoppingCart', color: '#059669',
    chipBg: 'bg-emerald-50', chipText: 'text-emerald-700', chipRing: 'ring-emerald-200',
  },
  {
    id: 'fitness', label: 'Fitness & Gyms', labelAr: 'لياقة بدنية',
    icon: 'Dumbbell', color: '#0891B2',
    chipBg: 'bg-cyan-50', chipText: 'text-cyan-700', chipRing: 'ring-cyan-200',
  },
  {
    id: 'salons', label: 'Salons & Spas', labelAr: 'صالونات ومنتجعات',
    icon: 'Scissors', color: '#DB2777',
    chipBg: 'bg-pink-50', chipText: 'text-pink-700', chipRing: 'ring-pink-200',
  },
  {
    id: 'healthcare', label: 'Healthcare & Clinics', labelAr: 'عيادات',
    icon: 'Stethoscope', color: '#2563EB',
    chipBg: 'bg-blue-50', chipText: 'text-blue-700', chipRing: 'ring-blue-200',
  },
  {
    id: 'pharmacies', label: 'Pharmacies', labelAr: 'صيدليات',
    icon: 'Pill', color: '#16A34A',
    chipBg: 'bg-green-50', chipText: 'text-green-700', chipRing: 'ring-green-200',
  },
  {
    id: 'automotive', label: 'Automotive & Car Care', labelAr: 'خدمات السيارات',
    icon: 'Car', color: '#475569',
    chipBg: 'bg-slate-100', chipText: 'text-slate-700', chipRing: 'ring-slate-200',
  },
  {
    id: 'coworking', label: 'Coworking Spaces', labelAr: 'مساحات عمل',
    icon: 'Briefcase', color: '#EA580C',
    chipBg: 'bg-orange-50', chipText: 'text-orange-700', chipRing: 'ring-orange-200',
  },
  {
    id: 'hotels', label: 'Hotels & Stays', labelAr: 'فنادق',
    icon: 'BedDouble', color: '#9333EA',
    chipBg: 'bg-purple-50', chipText: 'text-purple-700', chipRing: 'ring-purple-200',
  },
  {
    id: 'banks', label: 'Banks & ATMs', labelAr: 'بنوك',
    icon: 'Landmark', color: '#0D9488',
    chipBg: 'bg-teal-50', chipText: 'text-teal-700', chipRing: 'ring-teal-200',
  },
  {
    id: 'education', label: 'Schools & Education', labelAr: 'تعليم',
    icon: 'GraduationCap', color: '#4F46E5',
    chipBg: 'bg-indigo-50', chipText: 'text-indigo-700', chipRing: 'ring-indigo-200',
  },
  {
    id: 'services', label: 'Professional Services', labelAr: 'خدمات',
    icon: 'Wrench', color: '#0284C7',
    chipBg: 'bg-sky-50', chipText: 'text-sky-700', chipRing: 'ring-sky-200',
  },
  {
    id: 'leisure', label: 'Leisure & Attractions', labelAr: 'ترفيه',
    icon: 'FerrisWheel', color: '#C026D3',
    chipBg: 'bg-fuchsia-50', chipText: 'text-fuchsia-700', chipRing: 'ring-fuchsia-200',
  },
  {
    id: 'other', label: 'Other Businesses', labelAr: 'أخرى',
    icon: 'Store', color: '#64748B',
    chipBg: 'bg-slate-100', chipText: 'text-slate-700', chipRing: 'ring-slate-200',
  },
];

const CATEGORY_MAP: Record<string, BusinessCategory> = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c])
);

/** Never returns undefined — falls back to the first category. */
export const getCategory = (id: CategoryId | string): BusinessCategory =>
  CATEGORY_MAP[id] ?? CATEGORIES[0];

export const categoryColor = (id: CategoryId | string): string => getCategory(id).color;
