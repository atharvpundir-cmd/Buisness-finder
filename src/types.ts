/* ---------------------------------------------------------------------------
 * BuisnessFind Dubai — shared type definitions
 * ------------------------------------------------------------------------- */

export type CategoryId =
  | 'dining'
  | 'cafes'
  | 'shopping'
  | 'groceries'
  | 'fitness'
  | 'salons'
  | 'healthcare'
  | 'pharmacies'
  | 'automotive'
  | 'coworking'
  | 'hotels'
  | 'banks'
  | 'education'
  | 'services'
  | 'leisure'
  | 'other';

/** A top-level business category, with the palette used by cards and map pins. */
export interface BusinessCategory {
  id: CategoryId;
  label: string;
  labelAr: string;
  /** Lucide icon component name, resolved at render time. */
  icon: string;
  /** Hex colour used for Leaflet divIcon pins (must be a real hex string). */
  color: string;
  /** Tailwind classes for the chip / badge treatments. */
  chipBg: string;
  chipText: string;
  chipRing: string;
}

/** One day of a weekly opening-hours schedule. */
export interface OpeningHourDay {
  day: Weekday;
  /** 24h "HH:MM". Ignored when `closed` is true. */
  open: string;
  /** 24h "HH:MM". "23:59" is treated as end-of-day. */
  close: string;
  closed?: boolean;
}

export type Weekday =
  | 'Monday'
  | 'Tuesday'
  | 'Wednesday'
  | 'Thursday'
  | 'Friday'
  | 'Saturday'
  | 'Sunday';

/** Price tier, rendered as 1-4 "AED" glyphs. */
export type PriceTier = 1 | 2 | 3 | 4;

export interface Business {
  id: string;
  name: string;
  /** Arabic display name, shown as a subtitle. */
  nameAr: string;
  category: CategoryId;
  subcategory: string;
  description: string;
  /** Absolute image URLs. First entry is the card thumbnail. */
  photos: string[];
  rating: number;
  reviewCount: number;
  priceTier: PriceTier;
  address: string;
  /** Human-readable Dubai district, matches a DubaiArea name. */
  area: string;
  lat: number;
  lng: number;
  phone: string;
  /** International format without "+", used to build wa.me links. */
  whatsapp: string;
  website?: string;
  tags: string[];
  amenities: string[];
  verified: boolean;
  featured: boolean;
  hours: OpeningHourDay[];
  /** Populated at runtime by the distance engine, relative to the active origin. */
  distanceKm?: number;
  /** Where the record came from: hand-curated, or imported from OpenStreetMap. */
  source: 'curated' | 'osm';
  /** True when OSM listed no parsable opening_hours, so open/closed is unknown. */
  hoursUnknown?: boolean;
}

/** A Dubai district with a real centroid, used for manual origin selection. */
export interface DubaiArea {
  id: string;
  name: string;
  nameAr: string;
  lat: number;
  lng: number;
}

/** The active search origin — either GPS or a chosen district. */
export interface UserLocation {
  lat: number;
  lng: number;
  label: string;
  source: 'gps' | 'area';
  /** GPS accuracy in metres, when source is 'gps'. */
  accuracy?: number;
}

export type SortKey = 'distance' | 'rating' | 'reviews' | 'name';

export interface FilterState {
  query: string;
  category: CategoryId | 'all';
  radiusKm: number;
  openNow: boolean;
  verifiedOnly: boolean;
  topRated: boolean;
  favoritesOnly: boolean;
  sort: SortKey;
}

export type GpsStatus = 'idle' | 'locating' | 'granted' | 'denied' | 'unavailable';
