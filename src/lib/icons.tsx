import {
  Briefcase, Car, Coffee, Dumbbell, LayoutGrid, Pill, Scissors,
  ShoppingBag, ShoppingCart, Stethoscope, UtensilsCrossed,
  type LucideIcon,
} from 'lucide-react';

/**
 * Explicit name -> component map. Avoids dynamic namespace lookups so the
 * bundle stays tree-shaken and TypeScript can still prove the type.
 */
const ICONS: Record<string, LucideIcon> = {
  UtensilsCrossed,
  Coffee,
  ShoppingBag,
  ShoppingCart,
  Dumbbell,
  Scissors,
  Stethoscope,
  Pill,
  Car,
  Briefcase,
  LayoutGrid,
};

export const getIcon = (name: string): LucideIcon => ICONS[name] ?? LayoutGrid;
