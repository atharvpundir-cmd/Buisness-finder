import type { DubaiArea } from '../types';

/**
 * Real centroid coordinates for Dubai's main districts.
 * Used both for the manual area picker and for snapping a GPS fix
 * to the nearest recognisable neighbourhood.
 */
export const DUBAI_AREAS: DubaiArea[] = [
  { id: 'downtown',   name: 'Downtown Dubai',        nameAr: 'وسط مدينة دبي',   lat: 25.1972, lng: 55.2744 },
  { id: 'marina',     name: 'Dubai Marina',          nameAr: 'مرسى دبي',        lat: 25.0805, lng: 55.1403 },
  { id: 'jlt',        name: 'Jumeirah Lake Towers',  nameAr: 'أبراج بحيرات جميرا', lat: 25.0756, lng: 55.1454 },
  { id: 'difc',       name: 'DIFC',                  nameAr: 'مركز دبي المالي',  lat: 25.2110, lng: 55.2810 },
  { id: 'palm',       name: 'Palm Jumeirah',         nameAr: 'نخلة جميرا',       lat: 25.1124, lng: 55.1390 },
  { id: 'businessbay',name: 'Business Bay',          nameAr: 'الخليج التجاري',   lat: 25.1857, lng: 55.2650 },
  { id: 'albarsha',   name: 'Al Barsha',             nameAr: 'البرشاء',          lat: 25.1120, lng: 55.2000 },
  { id: 'deira',      name: 'Deira & Dubai Creek',   nameAr: 'ديرة وخور دبي',    lat: 25.2697, lng: 55.3095 },
  { id: 'dubaihills', name: 'Dubai Hills',           nameAr: 'دبي هيلز',         lat: 25.1050, lng: 55.2480 },
  { id: 'alquoz',     name: 'Al Quoz',               nameAr: 'القوز',            lat: 25.1420, lng: 55.2330 },
  { id: 'silicon',    name: 'Dubai Silicon Oasis',   nameAr: 'واحة دبي للسيليكون', lat: 25.1213, lng: 55.3773 },
  { id: 'jumeirah',   name: 'Jumeirah',              nameAr: 'جميرا',            lat: 25.2048, lng: 55.2450 },
];

/** Default origin when nothing has been chosen yet. */
export const DEFAULT_AREA: DubaiArea =
  DUBAI_AREAS.find((a) => a.id === 'jlt') ?? DUBAI_AREAS[0];

export const findAreaById = (id: string): DubaiArea | undefined =>
  DUBAI_AREAS.find((a) => a.id === id);
