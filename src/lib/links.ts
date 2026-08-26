import type { Business } from '../types';

/** Pre-filled WhatsApp chat link for a business. */
export const whatsappUrl = (b: Business): string => {
  const digits = String(b.whatsapp || '').replace(/\D/g, '');
  const text = encodeURIComponent(
    `Hi ${b.name}, I found you on BuisnessFind Dubai and would like to ask about your services.`
  );
  return `https://wa.me/${digits}?text=${text}`;
};

/** Google Maps turn-by-turn directions to a business. */
export const directionsUrl = (b: Business): string => {
  if (Number.isFinite(b.lat) && Number.isFinite(b.lng)) {
    return `https://www.google.com/maps/dir/?api=1&destination=${b.lat},${b.lng}`;
  }
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    `${b.name} ${b.address}`
  )}`;
};

export const telUrl = (b: Business): string =>
  `tel:${String(b.phone || '').replace(/\s/g, '')}`;

/** Price tier rendered as repeated "AED". */
export const priceLabel = (tier: number): string =>
  'AED'.repeat(Math.max(1, Math.min(4, tier))).replace(/AED(?=AED)/g, 'AED ');
