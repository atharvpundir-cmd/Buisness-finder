import type { Business, OpeningHourDay, Weekday } from '../types';

/* ---------------------------------------------------------------------------
 * Geo helpers
 * ------------------------------------------------------------------------- */

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/**
 * Great-circle distance between two coordinates, in kilometres.
 * Returns NaN-free output: invalid input yields Infinity so the caller's
 * radius filter simply excludes the row rather than crashing the map.
 */
export function calculateDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  if (
    !Number.isFinite(lat1) || !Number.isFinite(lng1) ||
    !Number.isFinite(lat2) || !Number.isFinite(lng2)
  ) {
    return Number.POSITIVE_INFINITY;
  }
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** "450 m" under a kilometre, otherwise "2.4 km". */
export function formatDistance(km: number | undefined): string {
  if (km === undefined || !Number.isFinite(km)) return '—';
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/* ---------------------------------------------------------------------------
 * Opening hours
 * ------------------------------------------------------------------------- */

export const WEEKDAYS: Weekday[] = [
  'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday',
];

/** Same hours every day. */
const every = (open: string, close: string): OpeningHourDay[] =>
  WEEKDAYS.map((day) => ({ day, open, close }));

/** Weekday hours plus a distinct weekend (Sat/Sun) window. */
const weekdayWeekend = (
  open: string, close: string,
  weOpen: string, weClose: string
): OpeningHourDay[] =>
  WEEKDAYS.map((day) =>
    day === 'Saturday' || day === 'Sunday'
      ? { day, open: weOpen, close: weClose }
      : { day, open, close }
  );

/** Same hours daily, closed on the named days. */
const exceptClosed = (
  open: string, close: string, closedDays: Weekday[]
): OpeningHourDay[] =>
  WEEKDAYS.map((day) =>
    closedDays.includes(day)
      ? { day, open, close, closed: true }
      : { day, open, close }
  );

const ALL_DAY = every('00:00', '23:59');

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return 0;
  return h * 60 + m;
};

/**
 * Whether a business is trading at `now`. Handles windows that cross midnight
 * (e.g. a bar open 18:00-02:00) by rolling into the previous day's schedule.
 */
export function isOpenNow(business: Business, now: Date = new Date()): boolean {
  const schedule = business.hours;
  if (!Array.isArray(schedule) || schedule.length === 0) return false;

  const dayIndex = (now.getDay() + 6) % 7; // JS Sunday=0 -> our Monday=0
  const today = schedule.find((d) => d.day === WEEKDAYS[dayIndex]);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  if (today && !today.closed) {
    const open = minutesOf(today.open);
    const close = minutesOf(today.close);
    if (close > open && nowMin >= open && nowMin <= close) return true;
    // Window crosses midnight and we are in the late-night tail.
    if (close < open && nowMin >= open) return true;
  }

  // Check whether yesterday's post-midnight window still covers us.
  const yIndex = (dayIndex + 6) % 7;
  const yesterday = schedule.find((d) => d.day === WEEKDAYS[yIndex]);
  if (yesterday && !yesterday.closed) {
    const open = minutesOf(yesterday.open);
    const close = minutesOf(yesterday.close);
    if (close < open && nowMin <= close) return true;
  }
  return false;
}

/** Today's window as display text, e.g. "09:00 – 23:00" or "Closed". */
export function todayHours(business: Business, now: Date = new Date()): string {
  const dayIndex = (now.getDay() + 6) % 7;
  const today = business.hours.find((d) => d.day === WEEKDAYS[dayIndex]);
  if (!today || today.closed) return 'Closed today';
  if (today.open === '00:00' && today.close === '23:59') return 'Open 24 hours';
  return `${today.open} – ${today.close}`;
}

/* ---------------------------------------------------------------------------
 * Photo helpers
 * ------------------------------------------------------------------------- */

const img = (id: string): string =>
  `https://images.unsplash.com/photo-${id}?auto=format&fit=crop&w=900&q=80`;

/* ---------------------------------------------------------------------------
 * Seed catalogue — 30 curated Dubai businesses
 * ------------------------------------------------------------------------- */

export const BUSINESSES: Business[] = [
  /* ----------------------------- Dining ----------------------------- */
  {
    id: 'ravi-satwa',
    name: 'Ravi Restaurant',
    nameAr: 'مطعم رافي',
    category: 'dining', subcategory: 'Pakistani',
    description:
      'A Satwa institution since 1978. Charcoal-grilled seed kebabs, butter chicken and hot naan served until the early hours, at prices that have barely moved in decades.',
    photos: [img('1585937421612-70a008356fbe'), img('1517248135467-4c7edcad34c4'), img('1544025162-d76694265947')],
    rating: 4.5, reviewCount: 18422, priceTier: 1,
    address: 'Al Satwa Road, Al Satwa', area: 'Jumeirah',
    lat: 25.2295, lng: 55.2765,
    phone: '+971 4 331 5353', whatsapp: '97143315353',
    tags: ['pakistani', 'kebab', 'late night', 'budget', 'halal', 'biryani'],
    amenities: ['Outdoor seating', 'Takeaway', 'Family section', 'Cash only', 'Late night'],
    verified: true, featured: true,
    hours: every('05:00', '03:00'),
  },
  {
    id: 'zuma-difc',
    name: 'Zuma Dubai',
    nameAr: 'زوما دبي',
    category: 'dining', subcategory: 'Japanese Izakaya',
    description:
      'Contemporary izakaya dining in the Gate Village. Robata grill, sushi counter and a bar that stays busy long past midnight.',
    photos: [img('1579871494447-9811cf80d66c'), img('1552566626-52f8b828add9'), img('1414235077428-338989a2e8c0')],
    rating: 4.7, reviewCount: 9840, priceTier: 4,
    address: 'Gate Village 06, DIFC', area: 'DIFC',
    lat: 25.2145, lng: 55.2820,
    phone: '+971 4 425 5660', whatsapp: '97144255660',
    website: 'https://zumarestaurant.com',
    tags: ['japanese', 'sushi', 'fine dining', 'cocktails', 'robata'],
    amenities: ['Valet parking', 'Bar', 'Reservations', 'Outdoor terrace', 'Card payment'],
    verified: true, featured: true,
    hours: weekdayWeekend('12:00', '00:00', '12:00', '01:00'),
  },
  {
    id: 'al-safadi-bb',
    name: 'Al Safadi Restaurant',
    nameAr: 'مطعم الصفدي',
    category: 'dining', subcategory: 'Lebanese',
    description:
      'Generous Lebanese mezze, charcoal mixed grills and fresh juices. A reliable family stop with quick service and big portions.',
    photos: [img('1544025162-d76694265947'), img('1517248135467-4c7edcad34c4')],
    rating: 4.4, reviewCount: 7310, priceTier: 2,
    address: 'Sheikh Zayed Road, Business Bay', area: 'Business Bay',
    lat: 25.1860, lng: 55.2620,
    phone: '+971 4 321 9200', whatsapp: '97143219200',
    tags: ['lebanese', 'mezze', 'shawarma', 'grill', 'halal', 'family'],
    amenities: ['Family section', 'Delivery', 'Takeaway', 'Parking', 'Card payment'],
    verified: true, featured: false,
    hours: every('07:00', '02:00'),
  },
  {
    id: 'bu-qtair',
    name: 'Bu Qtair',
    nameAr: 'بو قطير',
    category: 'dining', subcategory: 'Seafood',
    description:
      'The legendary fishing-shack fry-up near Umm Suqeim beach. Pick your catch, wait for your number, eat it with paratha and masala sauce.',
    photos: [img('1414235077428-338989a2e8c0'), img('1517248135467-4c7edcad34c4')],
    rating: 4.3, reviewCount: 6120, priceTier: 1,
    address: 'Fishing Harbour 2, Umm Suqeim', area: 'Dubai Marina',
    lat: 25.0855, lng: 55.1350,
    phone: '+971 55 705 2130', whatsapp: '971557052130',
    tags: ['seafood', 'fish', 'casual', 'beachside', 'budget', 'local favourite'],
    amenities: ['Outdoor seating', 'Takeaway', 'Cash only', 'Walk-ins only'],
    verified: false, featured: false,
    hours: every('11:30', '23:30'),
  },
  {
    id: 'ibn-albahr-jlt',
    name: 'Ibn AlBahr Lebanese Seafood',
    nameAr: 'ابن البحر',
    category: 'dining', subcategory: 'Lebanese Seafood',
    description:
      'Lakeside Lebanese seafood in JLT — grilled hammour, sayadieh rice and a long mezze list, with tables right on the promenade.',
    photos: [img('1552566626-52f8b828add9'), img('1414235077428-338989a2e8c0')],
    rating: 4.5, reviewCount: 3980, priceTier: 3,
    address: 'Cluster P, Jumeirah Lake Towers', area: 'Jumeirah Lake Towers',
    lat: 25.0740, lng: 55.1440,
    phone: '+971 4 447 3355', whatsapp: '97144473355',
    tags: ['seafood', 'lebanese', 'waterfront', 'mezze', 'halal'],
    amenities: ['Outdoor seating', 'Reservations', 'Delivery', 'Parking', 'Family section'],
    verified: true, featured: false,
    hours: every('12:00', '01:00'),
  },
  {
    id: 'tashas-downtown',
    name: "Tashas Downtown",
    nameAr: 'تاشاز',
    category: 'dining', subcategory: 'All-Day Brunch',
    description:
      'All-day café dining with a Mediterranean lean. Strong brunch menu, good coffee and a long weekend queue worth timing around.',
    photos: [img('1517248135467-4c7edcad34c4'), img('1554118811-1e0d58224f24')],
    rating: 4.6, reviewCount: 5240, priceTier: 3,
    address: 'The Dubai Mall, Downtown Dubai', area: 'Downtown Dubai',
    lat: 25.1960, lng: 55.2760,
    phone: '+971 4 388 2200', whatsapp: '97143882200',
    tags: ['brunch', 'breakfast', 'mediterranean', 'coffee', 'salads'],
    amenities: ['Wheelchair access', 'Reservations', 'Mall parking', 'Card payment', 'Family friendly'],
    verified: true, featured: true,
    hours: every('08:00', '23:00'),
  },

  /* ------------------------------ Cafes ----------------------------- */
  {
    id: 'arabica-downtown',
    name: '% Arabica Dubai Opera',
    nameAr: 'أرابيكا',
    category: 'cafes', subcategory: 'Specialty Coffee',
    description:
      'Minimalist Kyoto coffee house with Burj Khalifa views. Single-origin pour-overs and the signature Spanish latte.',
    photos: [img('1495474472287-4d71bcdd2085'), img('1501339847302-ac426a4a7cbb'), img('1554118811-1e0d58224f24')],
    rating: 4.6, reviewCount: 4410, priceTier: 2,
    address: 'Sheikh Mohammed bin Rashid Blvd, Downtown', area: 'Downtown Dubai',
    lat: 25.1950, lng: 55.2745,
    phone: '+971 4 566 2211', whatsapp: '97145662211',
    tags: ['coffee', 'specialty', 'matcha', 'wifi', 'views', 'laptop friendly'],
    amenities: ['Free WiFi', 'Power outlets', 'Outdoor seating', 'Takeaway', 'Card payment'],
    verified: true, featured: true,
    hours: every('07:30', '00:00'),
  },
  {
    id: 'tim-hortons-jlt',
    name: 'Tim Hortons JLT',
    nameAr: 'تيم هورتنز',
    category: 'cafes', subcategory: 'Coffee Chain',
    description:
      'Reliable all-hours coffee and bake shop in Cluster I — a default remote-work stop for the JLT towers.',
    photos: [img('1501339847302-ac426a4a7cbb'), img('1509440159596-0249088772ff')],
    rating: 4.1, reviewCount: 2180, priceTier: 1,
    address: 'Cluster I, Jumeirah Lake Towers', area: 'Jumeirah Lake Towers',
    lat: 25.0700, lng: 55.1425,
    phone: '+971 4 456 7788', whatsapp: '97144567788',
    tags: ['coffee', 'donuts', 'breakfast', 'wifi', 'budget', 'laptop friendly'],
    amenities: ['Free WiFi', 'Power outlets', 'Drive-thru', 'Delivery', '24 hours'],
    verified: true, featured: false,
    hours: ALL_DAY,
  },
  {
    id: 'common-grounds-moe',
    name: 'Common Grounds',
    nameAr: 'كومون جراوندز',
    category: 'cafes', subcategory: 'Café & Bakery',
    description:
      'Mall of the Emirates favourite for long breakfasts, layered cakes and a laptop-friendly back room.',
    photos: [img('1554118811-1e0d58224f24'), img('1509440159596-0249088772ff')],
    rating: 4.4, reviewCount: 3060, priceTier: 2,
    address: 'Mall of the Emirates, Al Barsha', area: 'Al Barsha',
    lat: 25.1180, lng: 55.2000,
    phone: '+971 4 341 3757', whatsapp: '97143413757',
    tags: ['cafe', 'bakery', 'breakfast', 'cakes', 'wifi', 'laptop friendly'],
    amenities: ['Free WiFi', 'Power outlets', 'Mall parking', 'Wheelchair access', 'Family friendly'],
    verified: true, featured: false,
    hours: weekdayWeekend('08:00', '23:00', '08:00', '00:00'),
  },
  {
    id: 'espresso-lab-difc',
    name: 'The Espresso Lab',
    nameAr: 'إسبريسو لاب',
    category: 'cafes', subcategory: 'Specialty Coffee',
    description:
      'Competition-grade roastery serving rare micro-lots. Serious brew bar, quiet enough to actually work in.',
    photos: [img('1495474472287-4d71bcdd2085'), img('1501339847302-ac426a4a7cbb')],
    rating: 4.8, reviewCount: 1920, priceTier: 3,
    address: 'Gate Avenue, DIFC', area: 'DIFC',
    lat: 25.2120, lng: 55.2800,
    phone: '+971 4 355 0088', whatsapp: '97143550088',
    tags: ['coffee', 'specialty', 'roastery', 'wifi', 'quiet', 'laptop friendly'],
    amenities: ['Free WiFi', 'Power outlets', 'Takeaway', 'Card payment', 'Quiet workspace'],
    verified: true, featured: false,
    hours: every('07:00', '22:00'),
  },

  /* ---------------------------- Shopping ---------------------------- */
  {
    id: 'dubai-mall',
    name: 'The Dubai Mall',
    nameAr: 'دبي مول',
    category: 'shopping', subcategory: 'Shopping Mall',
    description:
      'The anchor of Downtown — 1,200+ stores, an aquarium, an ice rink and the fountain terrace. Allow far longer than you planned.',
    photos: [img('1519567241046-7f570eee3ce6'), img('1441986300917-64674bd600d8')],
    rating: 4.7, reviewCount: 42150, priceTier: 3,
    address: 'Financial Center Road, Downtown Dubai', area: 'Downtown Dubai',
    lat: 25.1975, lng: 55.2796,
    phone: '+971 4 362 7500', whatsapp: '97143627500',
    website: 'https://thedubaimall.com',
    tags: ['mall', 'shopping', 'fashion', 'entertainment', 'aquarium', 'family'],
    amenities: ['Free parking', 'Wheelchair access', 'Prayer room', 'Food court', 'Valet', 'Metro link'],
    verified: true, featured: true,
    hours: weekdayWeekend('10:00', '00:00', '10:00', '01:00'),
  },
  {
    id: 'mall-of-emirates',
    name: 'Mall of the Emirates',
    nameAr: 'مول الإمارات',
    category: 'shopping', subcategory: 'Shopping Mall',
    description:
      'Al Barsha landmark with 630+ retailers, Ski Dubai under the same roof and a direct metro link.',
    photos: [img('1441986300917-64674bd600d8'), img('1519567241046-7f570eee3ce6')],
    rating: 4.6, reviewCount: 28900, priceTier: 3,
    address: 'Sheikh Zayed Road, Al Barsha 1', area: 'Al Barsha',
    lat: 25.1181, lng: 55.2003,
    phone: '+971 4 409 9000', whatsapp: '97144099000',
    tags: ['mall', 'shopping', 'ski dubai', 'cinema', 'fashion', 'family'],
    amenities: ['Free parking', 'Wheelchair access', 'Prayer room', 'Cinema', 'Metro link', 'Valet'],
    verified: true, featured: true,
    hours: weekdayWeekend('10:00', '00:00', '10:00', '01:00'),
  },
  {
    id: 'nakheel-mall-palm',
    name: 'Nakheel Mall',
    nameAr: 'نخيل مول',
    category: 'shopping', subcategory: 'Shopping Mall',
    description:
      'The Palm’s own mall at the base of The View observation deck — 300 stores, a rooftop dining level and beach-club access.',
    photos: [img('1519567241046-7f570eee3ce6'), img('1441986300917-64674bd600d8')],
    rating: 4.5, reviewCount: 11240, priceTier: 3,
    address: 'Palm Jumeirah', area: 'Palm Jumeirah',
    lat: 25.1128, lng: 55.1390,
    phone: '+971 4 375 4444', whatsapp: '97143754444',
    tags: ['mall', 'shopping', 'the view', 'dining', 'monorail'],
    amenities: ['Free parking', 'Wheelchair access', 'Monorail link', 'Food court', 'Valet'],
    verified: true, featured: false,
    hours: every('10:00', '22:00'),
  },

  /* --------------------------- Groceries ---------------------------- */
  {
    id: 'carrefour-moe',
    name: 'Carrefour Hypermarket MOE',
    nameAr: 'كارفور',
    category: 'groceries', subcategory: 'Hypermarket',
    description:
      'Full-size hypermarket inside Mall of the Emirates. Fresh produce, bakery counter, electronics and same-day delivery.',
    photos: [img('1542838132-92c53300491e'), img('1601599963565-b7f49deb352d')],
    rating: 4.3, reviewCount: 15600, priceTier: 2,
    address: 'Mall of the Emirates, Al Barsha 1', area: 'Al Barsha',
    lat: 25.1185, lng: 55.2010,
    phone: '+971 800 73232', whatsapp: '97180073232',
    tags: ['supermarket', 'hypermarket', 'groceries', 'delivery', 'fresh produce'],
    amenities: ['Free parking', 'Delivery', 'Card payment', 'Wheelchair access', 'Bakery counter'],
    verified: true, featured: false,
    hours: every('08:00', '01:00'),
  },
  {
    id: 'spinneys-jlt',
    name: 'Spinneys JLT',
    nameAr: 'سبينيس',
    category: 'groceries', subcategory: 'Supermarket',
    description:
      'Premium supermarket in Cluster N with a strong deli, international aisle and a butcher counter.',
    photos: [img('1601599963565-b7f49deb352d'), img('1542838132-92c53300491e')],
    rating: 4.4, reviewCount: 4320, priceTier: 3,
    address: 'Cluster N, Jumeirah Lake Towers', area: 'Jumeirah Lake Towers',
    lat: 25.0685, lng: 55.1400,
    phone: '+971 4 447 8080', whatsapp: '97144478080',
    tags: ['supermarket', 'groceries', 'deli', 'organic', 'butcher'],
    amenities: ['Parking', 'Delivery', 'Card payment', 'Deli counter', 'Wheelchair access'],
    verified: true, featured: false,
    hours: every('08:00', '00:00'),
  },
  {
    id: 'waitrose-downtown',
    name: 'Waitrose Dubai Mall',
    nameAr: 'ويتروز',
    category: 'groceries', subcategory: 'Supermarket',
    description:
      'British supermarket on the lower ground floor of The Dubai Mall — strong ready-meals, cheese room and bakery.',
    photos: [img('1542838132-92c53300491e'), img('1601599963565-b7f49deb352d')],
    rating: 4.4, reviewCount: 6870, priceTier: 3,
    address: 'The Dubai Mall, Downtown Dubai', area: 'Downtown Dubai',
    lat: 25.1970, lng: 55.2790,
    phone: '+971 4 434 0700', whatsapp: '97144340700',
    tags: ['supermarket', 'groceries', 'bakery', 'imported', 'ready meals'],
    amenities: ['Mall parking', 'Delivery', 'Card payment', 'Bakery counter', 'Wheelchair access'],
    verified: true, featured: false,
    hours: every('09:00', '00:00'),
  },

  /* ---------------------------- Fitness ----------------------------- */
  {
    id: 'fitness-first-jlt',
    name: 'Fitness First JLT',
    nameAr: 'فتنس فيرست',
    category: 'fitness', subcategory: 'Gym & Health Club',
    description:
      'Full-service club in Cluster X with a lap pool, free-weights floor and a heavy group-class timetable.',
    photos: [img('1534438327276-14e5300c3a48'), img('1571902943202-507ec2618e8f')],
    rating: 4.3, reviewCount: 1980, priceTier: 3,
    address: 'Bonnington Tower, Cluster X, JLT', area: 'Jumeirah Lake Towers',
    lat: 25.0710, lng: 55.1450,
    phone: '+971 4 448 6000', whatsapp: '97144486000',
    tags: ['gym', 'fitness', 'pool', 'classes', 'personal trainer', 'sauna'],
    amenities: ['Swimming pool', 'Sauna', 'Personal trainers', 'Group classes', 'Parking', 'Showers'],
    verified: true, featured: true,
    hours: weekdayWeekend('06:00', '23:00', '08:00', '21:00'),
  },
  {
    id: 'gymnation-alquoz',
    name: 'GymNation Al Quoz',
    nameAr: 'جيم نيشن',
    category: 'fitness', subcategory: 'Budget Gym',
    description:
      'Enormous 24/7 warehouse gym with low monthly fees, hundreds of machines and unlimited classes.',
    photos: [img('1571902943202-507ec2618e8f'), img('1534438327276-14e5300c3a48')],
    rating: 4.5, reviewCount: 5640, priceTier: 1,
    address: 'Al Quoz Industrial Area 3', area: 'Al Quoz',
    lat: 25.1420, lng: 55.2330,
    phone: '+971 4 244 0500', whatsapp: '97142440500',
    tags: ['gym', '24/7', 'budget', 'classes', 'personal trainer', 'crossfit'],
    amenities: ['24 hours', 'Free parking', 'Group classes', 'Personal trainers', 'Showers', 'Ladies section'],
    verified: true, featured: true,
    hours: ALL_DAY,
  },
  {
    id: 'warehouse-gym-d3',
    name: 'Warehouse Gym d3',
    nameAr: 'ويرهاوس جيم',
    category: 'fitness', subcategory: 'Boutique Fitness',
    description:
      'Design District boutique gym known for its nightclub-grade lighting, strong coaching and packed HIIT classes.',
    photos: [img('1534438327276-14e5300c3a48'), img('1571902943202-507ec2618e8f')],
    rating: 4.6, reviewCount: 1450, priceTier: 3,
    address: 'Building 8, Dubai Design District', area: 'Business Bay',
    lat: 25.1870, lng: 55.2900,
    phone: '+971 4 514 6262', whatsapp: '97145146262',
    tags: ['gym', 'hiit', 'boutique', 'classes', 'personal trainer', 'strength'],
    amenities: ['Group classes', 'Personal trainers', 'Showers', 'Parking', 'Towel service'],
    verified: true, featured: false,
    hours: weekdayWeekend('06:00', '22:00', '08:00', '20:00'),
  },

  /* ----------------------------- Salons ----------------------------- */
  {
    id: 'tips-toes-jlt',
    name: 'Tips & Toes JLT',
    nameAr: 'تيبس آند تووز',
    category: 'salons', subcategory: 'Ladies Salon',
    description:
      'Long-running ladies salon chain — manicures, hair, threading and express treatments with walk-in slots.',
    photos: [img('1560066984-138dadb4c035'), img('1600334089648-b0d9d3028eb2')],
    rating: 4.2, reviewCount: 2140, priceTier: 2,
    address: 'Cluster C, Jumeirah Lake Towers', area: 'Jumeirah Lake Towers',
    lat: 25.0688, lng: 55.1430,
    phone: '+971 4 447 1010', whatsapp: '97144471010',
    tags: ['salon', 'nails', 'hair', 'ladies', 'threading', 'walk-in'],
    amenities: ['Walk-ins welcome', 'Ladies only', 'Card payment', 'Parking', 'Appointments'],
    verified: true, featured: false,
    hours: every('10:00', '22:00'),
  },
  {
    id: '1847-difc',
    name: '1847 Grooming Lounge DIFC',
    nameAr: '1847 صالون رجالي',
    category: 'salons', subcategory: 'Mens Grooming',
    description:
      'Men’s grooming lounge in Gate Village — hot-towel shaves, precision cuts and manicures, walk-ins usually possible.',
    photos: [img('1560066984-138dadb4c035'), img('1600334089648-b0d9d3028eb2')],
    rating: 4.5, reviewCount: 1120, priceTier: 3,
    address: 'Gate Village 04, DIFC', area: 'DIFC',
    lat: 25.2130, lng: 55.2790,
    phone: '+971 4 425 2960', whatsapp: '97144252960',
    tags: ['barber', 'grooming', 'mens', 'shave', 'haircut'],
    amenities: ['Walk-ins welcome', 'Appointments', 'Card payment', 'Valet parking', 'Mens only'],
    verified: true, featured: false,
    hours: every('10:00', '22:00'),
  },
  {
    id: 'talise-spa-palm',
    name: 'Talise Spa Palm',
    nameAr: 'منتجع تاليس',
    category: 'salons', subcategory: 'Luxury Spa',
    description:
      'Resort spa on the Palm with hydrothermal suites, couples rooms and a full-day access option.',
    photos: [img('1600334089648-b0d9d3028eb2'), img('1560066984-138dadb4c035')],
    rating: 4.7, reviewCount: 890, priceTier: 4,
    address: 'Palm Jumeirah, West Crescent', area: 'Palm Jumeirah',
    lat: 25.1140, lng: 55.1420,
    phone: '+971 4 453 0444', whatsapp: '97144530444',
    tags: ['spa', 'massage', 'luxury', 'sauna', 'couples', 'wellness'],
    amenities: ['Sauna', 'Steam room', 'Pool access', 'Couples rooms', 'Valet parking', 'Appointments'],
    verified: true, featured: true,
    hours: every('09:00', '21:00'),
  },

  /* --------------------------- Healthcare --------------------------- */
  {
    id: 'aster-clinic-jlt',
    name: 'Aster Clinic JLT',
    nameAr: 'عيادة أستر',
    category: 'healthcare', subcategory: 'Multi-Speciality Clinic',
    description:
      'Walk-in multi-speciality clinic — GP, dental, dermatology and paediatrics, with most major insurers accepted.',
    photos: [img('1519494026892-80bbd2d6fd0d'), img('1516549655169-df83a0774514')],
    rating: 4.2, reviewCount: 2760, priceTier: 2,
    address: 'Cluster D, Jumeirah Lake Towers', area: 'Jumeirah Lake Towers',
    lat: 25.0715, lng: 55.1405,
    phone: '+971 4 440 0500', whatsapp: '97144400500',
    tags: ['clinic', 'doctor', 'dental', 'insurance', 'paediatrics', 'walk-in'],
    amenities: ['Insurance accepted', 'Walk-ins welcome', 'Parking', 'Wheelchair access', 'Pharmacy on site'],
    verified: true, featured: false,
    hours: every('08:00', '22:00'),
  },
  {
    id: 'mediclinic-city',
    name: 'Mediclinic City Hospital',
    nameAr: 'مستشفى ميديكلينيك',
    category: 'healthcare', subcategory: 'Hospital',
    description:
      'Full-service private hospital in Dubai Healthcare City with a 24-hour emergency department and maternity unit.',
    photos: [img('1516549655169-df83a0774514'), img('1519494026892-80bbd2d6fd0d')],
    rating: 4.3, reviewCount: 4180, priceTier: 4,
    address: 'Dubai Healthcare City, Oud Metha', area: 'Deira & Dubai Creek',
    lat: 25.2320, lng: 55.3230,
    phone: '+971 4 435 9999', whatsapp: '97144359999',
    tags: ['hospital', 'emergency', '24/7', 'maternity', 'surgery', 'insurance'],
    amenities: ['24 hour emergency', 'Insurance accepted', 'Parking', 'Wheelchair access', 'Pharmacy on site'],
    verified: true, featured: true,
    hours: ALL_DAY,
  },
  {
    id: 'emirates-hospital-jumeirah',
    name: 'Emirates Hospital Jumeirah',
    nameAr: 'مستشفى الإمارات',
    category: 'healthcare', subcategory: 'Hospital & Clinic',
    description:
      'Beach Road hospital with a 24/7 walk-in clinic, orthopaedics and diagnostics under one roof.',
    photos: [img('1519494026892-80bbd2d6fd0d'), img('1516549655169-df83a0774514')],
    rating: 4.1, reviewCount: 2340, priceTier: 3,
    address: 'Jumeirah Beach Road, Jumeirah 1', area: 'Jumeirah',
    lat: 25.2200, lng: 55.2520,
    phone: '+971 4 349 6666', whatsapp: '97143496666',
    tags: ['hospital', 'clinic', '24/7', 'orthopaedics', 'diagnostics', 'insurance'],
    amenities: ['24 hour clinic', 'Insurance accepted', 'Parking', 'Wheelchair access', 'Laboratory'],
    verified: true, featured: false,
    hours: ALL_DAY,
  },

  /* --------------------------- Pharmacies --------------------------- */
  {
    id: 'life-pharmacy-jlt',
    name: 'Life Pharmacy JLT',
    nameAr: 'صيدلية لايف',
    category: 'pharmacies', subcategory: '24/7 Pharmacy',
    description:
      'Round-the-clock pharmacy in Cluster F with prescription dispensing, vitamins and free local delivery.',
    photos: [img('1576091160399-112ba8d25d1d'), img('1587854692152-cbe660dbde88')],
    rating: 4.4, reviewCount: 1680, priceTier: 2,
    address: 'Cluster F, Jumeirah Lake Towers', area: 'Jumeirah Lake Towers',
    lat: 25.0698, lng: 55.1418,
    phone: '+971 4 363 5535', whatsapp: '97143635535',
    tags: ['pharmacy', '24/7', 'prescription', 'delivery', 'vitamins'],
    amenities: ['24 hours', 'Free delivery', 'Insurance accepted', 'Card payment', 'Parking'],
    verified: true, featured: true,
    hours: ALL_DAY,
  },
  {
    id: 'aster-pharmacy-marina',
    name: 'Aster Pharmacy Marina',
    nameAr: 'صيدلية أستر',
    category: 'pharmacies', subcategory: 'Pharmacy',
    description:
      'Marina Walk pharmacy with insurance billing, baby care aisle and same-hour delivery to nearby towers.',
    photos: [img('1587854692152-cbe660dbde88'), img('1576091160399-112ba8d25d1d')],
    rating: 4.3, reviewCount: 1140, priceTier: 2,
    address: 'Marina Walk, Dubai Marina', area: 'Dubai Marina',
    lat: 25.0810, lng: 55.1400,
    phone: '+971 4 399 8814', whatsapp: '97143998814',
    tags: ['pharmacy', 'prescription', 'delivery', 'baby care', 'insurance'],
    amenities: ['Delivery', 'Insurance accepted', 'Card payment', 'Wheelchair access'],
    verified: true, featured: false,
    hours: every('08:00', '00:00'),
  },
  {
    id: 'binsina-downtown',
    name: 'BinSina Pharmacy Downtown',
    nameAr: 'صيدلية بن سينا',
    category: 'pharmacies', subcategory: '24/7 Pharmacy',
    description:
      'Always-open pharmacy near Burj Khalifa with a dermatology-grade skincare range and rapid delivery.',
    photos: [img('1576091160399-112ba8d25d1d'), img('1587854692152-cbe660dbde88')],
    rating: 4.2, reviewCount: 960, priceTier: 2,
    address: 'Boulevard Plaza, Downtown Dubai', area: 'Downtown Dubai',
    lat: 25.1965, lng: 55.2750,
    phone: '+971 4 425 6767', whatsapp: '97144256767',
    tags: ['pharmacy', '24/7', 'skincare', 'prescription', 'delivery'],
    amenities: ['24 hours', 'Delivery', 'Insurance accepted', 'Card payment', 'Parking'],
    verified: true, featured: false,
    hours: ALL_DAY,
  },

  /* --------------------------- Automotive --------------------------- */
  {
    id: 'zdegree-alquoz',
    name: 'ZDEGREE Auto Service',
    nameAr: 'زد ديجري',
    category: 'automotive', subcategory: 'Service Centre',
    description:
      'Tyres, batteries, oil changes and full diagnostics with transparent fixed-price packages and same-day slots.',
    photos: [img('1486262715619-67b85e0b08d3'), img('1503376780353-7e6692767b70')],
    rating: 4.4, reviewCount: 3210, priceTier: 2,
    address: 'Al Quoz Industrial Area 4', area: 'Al Quoz',
    lat: 25.1400, lng: 55.2350,
    phone: '+971 4 338 8500', whatsapp: '97143388500',
    tags: ['car service', 'tyres', 'battery', 'oil change', 'diagnostics'],
    amenities: ['Free parking', 'Waiting lounge', 'Card payment', 'Pickup & drop', 'Warranty'],
    verified: true, featured: false,
    hours: exceptClosed('08:00', '20:00', ['Sunday']),
  },
  {
    id: 'icon-auto-alquoz',
    name: 'Icon Auto Garage',
    nameAr: 'أيكون أوتو',
    category: 'automotive', subcategory: 'Specialist Garage',
    description:
      'German-marque specialist for BMW, Mercedes and Audi — engine work, ECU tuning and pre-purchase inspections.',
    photos: [img('1503376780353-7e6692767b70'), img('1486262715619-67b85e0b08d3')],
    rating: 4.6, reviewCount: 1480, priceTier: 3,
    address: 'Al Quoz Industrial Area 3', area: 'Al Quoz',
    lat: 25.1440, lng: 55.2300,
    phone: '+971 4 339 1122', whatsapp: '97143391122',
    tags: ['garage', 'bmw', 'mercedes', 'audi', 'diagnostics', 'tuning'],
    amenities: ['Free parking', 'Pickup & drop', 'Warranty', 'Card payment', 'Waiting lounge'],
    verified: true, featured: false,
    hours: exceptClosed('08:30', '19:00', ['Sunday']),
  },
  {
    id: 'autopro-silicon',
    name: 'AutoPro Silicon Oasis',
    nameAr: 'أوتو برو',
    category: 'automotive', subcategory: 'Tyres & Service',
    description:
      'Quick-fit centre for tyres, brakes, batteries and AC servicing — walk-in bays and a clean waiting area.',
    photos: [img('1486262715619-67b85e0b08d3'), img('1503376780353-7e6692767b70')],
    rating: 4.2, reviewCount: 870, priceTier: 2,
    address: 'Dubai Silicon Oasis', area: 'Dubai Silicon Oasis',
    lat: 25.1220, lng: 55.3780,
    phone: '+971 4 372 4455', whatsapp: '97143724455',
    tags: ['tyres', 'brakes', 'ac service', 'battery', 'walk-in'],
    amenities: ['Walk-ins welcome', 'Free parking', 'Waiting lounge', 'Card payment', 'Warranty'],
    verified: false, featured: false,
    hours: every('08:00', '21:00'),
  },

  /* --------------------------- Coworking ---------------------------- */
  {
    id: 'wework-onecentral',
    name: 'WeWork One Central',
    nameAr: 'وي وورك',
    category: 'coworking', subcategory: 'Coworking Space',
    description:
      'Hot desks, private offices and bookable meeting rooms next to the World Trade Centre, with 24/7 member access.',
    photos: [img('1497366754035-f200968a6e72'), img('1524758631624-e2822e304c36')],
    rating: 4.5, reviewCount: 940, priceTier: 3,
    address: 'One Central, World Trade Centre', area: 'DIFC',
    lat: 25.2200, lng: 55.2830,
    phone: '+971 4 512 4000', whatsapp: '97145124000',
    tags: ['coworking', 'hot desk', 'meeting rooms', 'wifi', 'office', '24/7'],
    amenities: ['24/7 access', 'Fast WiFi', 'Meeting rooms', 'Free coffee', 'Printing', 'Parking'],
    verified: true, featured: true,
    hours: ALL_DAY,
  },
  {
    id: 'nook-jlt',
    name: 'Nook Coworking JLT',
    nameAr: 'نوك',
    category: 'coworking', subcategory: 'Coworking Space',
    description:
      'Affordable flexible desks in Cluster R with day passes, phone booths and a quiet focus floor.',
    photos: [img('1524758631624-e2822e304c36'), img('1497366754035-f200968a6e72')],
    rating: 4.4, reviewCount: 610, priceTier: 2,
    address: 'Cluster R, Jumeirah Lake Towers', area: 'Jumeirah Lake Towers',
    lat: 25.0705, lng: 55.1435,
    phone: '+971 4 570 8080', whatsapp: '97145708080',
    tags: ['coworking', 'day pass', 'hot desk', 'wifi', 'quiet', 'laptop friendly'],
    amenities: ['Fast WiFi', 'Phone booths', 'Free coffee', 'Printing', 'Meeting rooms', 'Parking'],
    verified: true, featured: false,
    hours: weekdayWeekend('08:00', '20:00', '10:00', '18:00'),
  },
  {
    id: 'letswork-dubaihills',
    name: 'Letswork Dubai Hills',
    nameAr: 'ليتس وورك',
    category: 'coworking', subcategory: 'Flexible Workspace',
    description:
      'Pay-as-you-go workspace network operating out of Dubai Hills Mall — book a seat by the hour from the app.',
    photos: [img('1497366754035-f200968a6e72'), img('1524758631624-e2822e304c36')],
    rating: 4.3, reviewCount: 520, priceTier: 1,
    address: 'Dubai Hills Mall, Dubai Hills Estate', area: 'Dubai Hills',
    lat: 25.1050, lng: 55.2480,
    phone: '+971 4 452 9090', whatsapp: '97144529090',
    tags: ['coworking', 'hourly', 'day pass', 'wifi', 'cafe', 'laptop friendly'],
    amenities: ['Fast WiFi', 'Power outlets', 'Mall parking', 'Cafe on site', 'Flexible booking'],
    verified: false, featured: false,
    hours: every('09:00', '22:00'),
  },
];
