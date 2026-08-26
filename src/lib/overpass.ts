import type { Business, CategoryId, OpeningHourDay, PriceTier, Weekday } from '../types';
import { WEEKDAYS } from '../data/businesses';

/* ---------------------------------------------------------------------------
 * Raw record shape, as shipped in /data/dubai-osm.json and as produced by the
 * live Overpass client below. Keys are single letters to keep the file small.
 * ------------------------------------------------------------------------- */
export interface OsmRecord {
  i: string;                      // "n1234" / "w5678"
  a: number;                      // latitude
  o: number;                      // longitude
  t: Record<string, string>;      // trimmed OSM tags
}

/* ---------------------------------------------------------------------------
 * OSM tag -> app category
 * ------------------------------------------------------------------------- */

const AMENITY_MAP: Record<string, CategoryId> = {
  restaurant: 'dining', fast_food: 'dining', food_court: 'dining',
  bar: 'dining', pub: 'dining', biergarten: 'dining',
  cafe: 'cafes', ice_cream: 'cafes',
  pharmacy: 'pharmacies',
  clinic: 'healthcare', doctors: 'healthcare', dentist: 'healthcare',
  hospital: 'healthcare', veterinary: 'healthcare',
  bank: 'banks', atm: 'banks', bureau_de_change: 'banks',
  fuel: 'automotive', car_wash: 'automotive', car_rental: 'automotive',
  driving_school: 'automotive',
  school: 'education', university: 'education', college: 'education',
  kindergarten: 'education', language_school: 'education', library: 'education',
  cinema: 'leisure', theatre: 'leisure', casino: 'leisure',
  nightclub: 'leisure', arts_centre: 'leisure', community_centre: 'leisure',
  marketplace: 'groceries',
  post_office: 'services',
  coworking_space: 'coworking',
  spa: 'salons', gym: 'fitness',
};

const SHOP_MAP: Record<string, CategoryId> = {
  supermarket: 'groceries', convenience: 'groceries', grocery: 'groceries',
  greengrocer: 'groceries', butcher: 'groceries', seafood: 'groceries',
  deli: 'groceries', alcohol: 'groceries', beverages: 'groceries',
  dairy: 'groceries', farm: 'groceries', frozen_food: 'groceries',
  spices: 'groceries', health_food: 'groceries',
  bakery: 'cafes', pastry: 'cafes', confectionery: 'cafes',
  chocolate: 'cafes', coffee: 'cafes', tea: 'cafes',
  hairdresser: 'salons', beauty: 'salons', massage: 'salons',
  nails: 'salons', tattoo: 'salons', barber: 'salons', perfumery: 'salons',
  chemist: 'pharmacies',
  car: 'automotive', car_repair: 'automotive', car_parts: 'automotive',
  tyres: 'automotive', motorcycle: 'automotive', motorcycle_repair: 'automotive',
  laundry: 'services', dry_cleaning: 'services', travel_agency: 'services',
  copyshop: 'services', tailor: 'services', funeral_directors: 'services',
  locksmith: 'services', estate_agent: 'services', insurance: 'services',
  pet_grooming: 'services', storage_rental: 'services',
  optician: 'healthcare', hearing_aids: 'healthcare', medical_supply: 'healthcare',
  sports: 'fitness', fitness: 'fitness', bicycle: 'fitness',
};

const LEISURE_MAP: Record<string, CategoryId> = {
  fitness_centre: 'fitness', sports_centre: 'fitness', swimming_pool: 'fitness',
  golf_course: 'fitness', horse_riding: 'fitness', pitch: 'fitness',
  spa: 'salons',
  park: 'leisure', garden: 'leisure', playground: 'leisure',
  water_park: 'leisure', marina: 'leisure', dance: 'leisure',
  bowling_alley: 'leisure', escape_game: 'leisure', amusement_arcade: 'leisure',
};

const TOURISM_MAP: Record<string, CategoryId> = {
  hotel: 'hotels', hostel: 'hotels', guest_house: 'hotels',
  motel: 'hotels', apartment: 'hotels', chalet: 'hotels', resort: 'hotels',
  attraction: 'leisure', museum: 'leisure', gallery: 'leisure',
  theme_park: 'leisure', zoo: 'leisure', aquarium: 'leisure',
};

const OFFICE_MAP: Record<string, CategoryId> = {
  coworking: 'coworking',
  financial: 'banks', insurance: 'banks', accountant: 'banks',
  estate_agent: 'services', lawyer: 'services', company: 'services',
  it: 'services', government: 'services', employment_agency: 'services',
  telecommunication: 'services', advertising_agency: 'services',
  architect: 'services', consulting: 'services', educational_institution: 'education',
  travel_agent: 'services', ngo: 'services', association: 'services',
};

/** Human-readable sub-type, e.g. "Fast Food" from amenity=fast_food. */
const titleCase = (value: string): string =>
  value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export function classify(tags: Record<string, string>): {
  category: CategoryId;
  subcategory: string;
} {
  const pick = <T,>(map: Record<string, T>, key: string): T | undefined =>
    tags[key] ? map[tags[key]] : undefined;

  const category =
    pick(AMENITY_MAP, 'amenity') ??
    pick(SHOP_MAP, 'shop') ??
    pick(LEISURE_MAP, 'leisure') ??
    pick(TOURISM_MAP, 'tourism') ??
    pick(OFFICE_MAP, 'office') ??
    // Generic fallbacks so nothing named is silently dropped.
    (tags.healthcare ? 'healthcare' : undefined) ??
    (tags.shop ? 'shopping' : undefined) ??
    (tags.office ? 'services' : undefined) ??
    (tags.tourism ? 'leisure' : undefined) ??
    (tags.leisure ? 'leisure' : undefined) ??
    'other';

  const rawType =
    tags.amenity ?? tags.shop ?? tags.leisure ?? tags.tourism ??
    tags.healthcare ?? tags.office ?? 'business';

  let subcategory = titleCase(rawType);
  if (tags.cuisine) {
    const cuisine = titleCase(tags.cuisine.split(';')[0]);
    subcategory = `${cuisine} ${subcategory}`;
  }
  return { category, subcategory };
}

/* ---------------------------------------------------------------------------
 * opening_hours
 * ------------------------------------------------------------------------- */

const DAY_INDEX: Record<string, number> = {
  mo: 0, tu: 1, we: 2, th: 3, fr: 4, sa: 5, su: 6,
};

/**
 * Parses the common subset of the OSM opening_hours grammar:
 *   "24/7", "Mo-Fr 09:00-18:00", "Mo-Th,Sa 10:00-22:00; Su off"
 * Anything it cannot understand returns null, and the caller marks the
 * business as "hours unknown" rather than guessing.
 */
export function parseOpeningHours(spec: string | undefined): OpeningHourDay[] | null {
  if (!spec) return null;
  const text = spec.trim().toLowerCase();
  if (!text) return null;

  if (text === '24/7' || text === '24x7' || text === 'mo-su 00:00-24:00') {
    return WEEKDAYS.map((day) => ({ day, open: '00:00', close: '23:59' }));
  }

  const result = new Map<Weekday, OpeningHourDay>();
  let matchedAnything = false;

  for (const rule of text.split(';')) {
    const chunk = rule.trim();
    if (!chunk) continue;

    const closed = /\b(off|closed)\b/.test(chunk);
    const timeMatch = chunk.match(/(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})/);
    if (!closed && !timeMatch) continue;

    const dayPart = chunk.split(/\s+/)[0];
    const days: number[] = [];

    for (const token of dayPart.split(',')) {
      const range = token.match(/^([a-z]{2})-([a-z]{2})$/);
      if (range && range[1] in DAY_INDEX && range[2] in DAY_INDEX) {
        let i = DAY_INDEX[range[1]];
        const end = DAY_INDEX[range[2]];
        for (let guard = 0; guard < 7; guard += 1) {
          days.push(i);
          if (i === end) break;
          i = (i + 1) % 7;
        }
      } else if (token in DAY_INDEX) {
        days.push(DAY_INDEX[token]);
      }
    }

    // No day prefix at all -> the rule applies to the whole week.
    const targets = days.length > 0 ? days : [0, 1, 2, 3, 4, 5, 6];

    for (const index of targets) {
      const day = WEEKDAYS[index];
      if (closed) {
        result.set(day, { day, open: '00:00', close: '00:00', closed: true });
        matchedAnything = true;
      } else if (timeMatch) {
        const open = `${timeMatch[1].padStart(2, '0')}:${timeMatch[2]}`;
        const rawClose = `${timeMatch[3].padStart(2, '0')}:${timeMatch[4]}`;
        result.set(day, {
          day,
          open,
          close: rawClose === '24:00' ? '23:59' : rawClose,
        });
        matchedAnything = true;
      }
    }
  }

  if (!matchedAnything) return null;

  return WEEKDAYS.map(
    (day) => result.get(day) ?? { day, open: '00:00', close: '00:00', closed: true }
  );
}

/* ---------------------------------------------------------------------------
 * Presentation helpers — OSM has no photos, ratings or price levels.
 * ------------------------------------------------------------------------- */

const PHOTO_POOL: Record<CategoryId, string[]> = {
  dining: ['1517248135467-4c7edcad34c4', '1552566626-52f8b828add9', '1414235077428-338989a2e8c0'],
  cafes: ['1501339847302-ac426a4a7cbb', '1495474472287-4d71bcdd2085', '1554118811-1e0d58224f24'],
  shopping: ['1441986300917-64674bd600d8', '1519567241046-7f570eee3ce6'],
  groceries: ['1542838132-92c53300491e', '1601599963565-b7f49deb352d'],
  fitness: ['1534438327276-14e5300c3a48', '1571902943202-507ec2618e8f'],
  salons: ['1560066984-138dadb4c035', '1600334089648-b0d9d3028eb2'],
  healthcare: ['1519494026892-80bbd2d6fd0d', '1516549655169-df83a0774514'],
  pharmacies: ['1576091160399-112ba8d25d1d', '1587854692152-cbe660dbde88'],
  automotive: ['1486262715619-67b85e0b08d3', '1503376780353-7e6692767b70'],
  coworking: ['1497366754035-f200968a6e72', '1524758631624-e2822e304c36'],
  hotels: ['1566073771259-6a8506099945', '1571896349842-33c89424de2d'],
  banks: ['1601597111158-2fceff292cdc', '1518546305927-5a555bb7020d'],
  education: ['1523050854058-8df90110c9f1', '1497633762265-9d179a990aa6'],
  services: ['1521791136064-7986c2920216', '1454165804606-c3d57bc86b40'],
  leisure: ['1533105079780-92b9be482077', '1470229722913-7ea0d339c4d3'],
  other: ['1441986300917-64674bd600d8', '1521791136064-7986c2920216'],
};

/** Stable hash so a given business always gets the same placeholder image. */
const hash = (value: string): number => {
  let h = 0;
  for (let i = 0; i < value.length; i += 1) {
    h = (h * 31 + value.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
};

const photosFor = (id: string, category: CategoryId): string[] => {
  const pool = PHOTO_POOL[category] ?? PHOTO_POOL.other;
  const start = hash(id) % pool.length;
  return [pool[start], pool[(start + 1) % pool.length]].map(
    (p) => `https://images.unsplash.com/photo-${p}?auto=format&fit=crop&w=900&q=80`
  );
};

const AMENITY_TAG_LABELS: [string, string, string][] = [
  ['internet_access', 'wlan', 'Free WiFi'],
  ['wifi', 'yes', 'Free WiFi'],
  ['outdoor_seating', 'yes', 'Outdoor seating'],
  ['takeaway', 'yes', 'Takeaway'],
  ['delivery', 'yes', 'Delivery'],
  ['drive_through', 'yes', 'Drive-thru'],
  ['air_conditioning', 'yes', 'Air conditioned'],
  ['wheelchair', 'yes', 'Wheelchair access'],
  ['self_service', 'yes', 'Self service'],
];

function amenitiesFrom(tags: Record<string, string>): string[] {
  const out: string[] = [];
  for (const [key, expected, label] of AMENITY_TAG_LABELS) {
    const value = tags[key];
    if (!value) continue;
    if (value === expected || (key === 'internet_access' && value !== 'no')) {
      if (!out.includes(label)) out.push(label);
    }
  }
  if (tags.opening_hours === '24/7') out.push('Open 24 hours');
  if (tags.brand) out.push(`${tags.brand} branch`);
  return out;
}

function addressFrom(tags: Record<string, string>): string {
  const parts = [
    [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' '),
    tags['addr:suburb'] ?? tags['addr:place'],
    tags['addr:city'],
  ].filter((p): p is string => Boolean(p && p.trim()));
  return parts.length > 0 ? parts.join(', ') : 'Dubai, United Arab Emirates';
}

const digitsOnly = (value: string | undefined): string =>
  (value ?? '').replace(/\D/g, '');

/** Price tier guessed from tags; defaults to mid-range. */
function priceFrom(tags: Record<string, string>): PriceTier {
  const stars = Number(tags.stars);
  if (Number.isFinite(stars) && stars >= 5) return 4;
  if (Number.isFinite(stars) && stars >= 4) return 3;
  if (tags.amenity === 'fast_food') return 1;
  return 2;
}

/* ---------------------------------------------------------------------------
 * Normalisation
 * ------------------------------------------------------------------------- */

export function toBusiness(record: OsmRecord, areaName: string): Business | null {
  const tags = record.t ?? {};
  const name = tags['name:en'] || tags.name;
  if (!name) return null;
  if (!Number.isFinite(record.a) || !Number.isFinite(record.o)) return null;

  const { category, subcategory } = classify(tags);
  const hours = parseOpeningHours(tags.opening_hours);
  const phone = tags.phone || tags['contact:phone'] || tags.mobile || '';

  return {
    id: `osm-${record.i}`,
    name,
    nameAr: tags['name:ar'] || '',
    category,
    subcategory,
    description:
      `${subcategory} in ${areaName}. Listed in OpenStreetMap` +
      (tags.operator ? `, operated by ${tags.operator}` : '') + '.',
    photos: photosFor(record.i, category),
    rating: 0,
    reviewCount: 0,
    priceTier: priceFrom(tags),
    address: addressFrom(tags),
    area: areaName,
    lat: record.a,
    lng: record.o,
    phone,
    whatsapp: digitsOnly(phone),
    website: tags.website || tags['contact:website'] || undefined,
    tags: [
      tags.amenity, tags.shop, tags.leisure, tags.tourism, tags.office, tags.healthcare,
      ...(tags.cuisine ? tags.cuisine.split(';') : []),
      tags.brand,
    ]
      .filter((t): t is string => Boolean(t))
      .map((t) => t.toLowerCase().replace(/_/g, ' ')),
    amenities: amenitiesFrom(tags),
    verified: false,
    featured: false,
    hours: hours ?? [],
    hoursUnknown: hours === null,
    source: 'osm',
  };
}

/* ---------------------------------------------------------------------------
 * Loading
 * ------------------------------------------------------------------------- */

/** Loads the dataset shipped with the app (public/data/dubai-osm.json). */
export async function loadShippedDataset(signal?: AbortSignal): Promise<OsmRecord[]> {
  const res = await fetch('/data/dubai-osm.json', { signal });
  if (!res.ok) throw new Error(`dataset ${res.status}`);
  const json = await res.json();
  return Array.isArray(json) ? (json as OsmRecord[]) : [];
}

const OVERPASS_ENDPOINTS = [
  'https://overpass-api.de/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
];

export function buildOverpassQuery(lat: number, lng: number, radiusM: number): string {
  const at = `around:${Math.round(radiusM)},${lat},${lng}`;
  return `[out:json][timeout:90];
(
  nwr[shop][name](${at});
  nwr[amenity~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|nightclub|pharmacy|clinic|doctors|dentist|hospital|veterinary|bank|atm|bureau_de_change|fuel|car_wash|car_rental|cinema|theatre|library|school|university|college|kindergarten|marketplace|post_office|coworking_space|spa|gym)$"][name](${at});
  nwr[leisure~"^(fitness_centre|sports_centre|swimming_pool|golf_course|bowling_alley|water_park|marina|park|garden|spa)$"][name](${at});
  nwr[healthcare][name](${at});
  nwr[office][name](${at});
  nwr[tourism~"^(hotel|hostel|guest_house|motel|apartment|attraction|museum|gallery|theme_park|zoo|aquarium)$"][name](${at});
);
out center tags;`;
}

/**
 * Live refresh straight from Overpass. Falls through the endpoint list on
 * failure. Public instances are donated infrastructure and frequently return
 * 429/504 under load, which is exactly why the shipped dataset is the default.
 */
export async function fetchLive(
  lat: number,
  lng: number,
  radiusM: number,
  signal?: AbortSignal
): Promise<OsmRecord[]> {
  const body = buildOverpassQuery(lat, lng, radiusM);
  let lastError: unknown = null;

  for (const endpoint of OVERPASS_ENDPOINTS) {
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain' },
        body,
        signal,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = await res.json();
      const elements: unknown[] = Array.isArray(json?.elements) ? json.elements : [];

      return elements.flatMap((raw) => {
        const el = raw as {
          type?: string; id?: number; lat?: number; lon?: number;
          center?: { lat?: number; lon?: number }; tags?: Record<string, string>;
        };
        const tags = el.tags ?? {};
        if (!tags.name) return [];
        const lat2 = el.lat ?? el.center?.lat;
        const lon2 = el.lon ?? el.center?.lon;
        if (!Number.isFinite(lat2) || !Number.isFinite(lon2)) return [];
        return [{
          i: `${(el.type ?? 'n')[0]}${el.id ?? 0}`,
          a: lat2 as number,
          o: lon2 as number,
          t: tags,
        }];
      });
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') throw err;
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Overpass unavailable');
}
