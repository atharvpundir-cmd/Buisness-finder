import { useEffect, useMemo, useState } from 'react';
import { Building2, Check, MapPin, X } from 'lucide-react';
import { CATEGORIES } from '../data/categories';
import { DUBAI_AREAS } from '../data/dubaiAreas';
import { WEEKDAYS } from '../data/businesses';
import type { Business, CategoryId, PriceTier } from '../types';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (business: Business) => void;
}

interface FormShape {
  name: string;
  nameAr: string;
  category: CategoryId;
  subcategory: string;
  description: string;
  address: string;
  areaId: string;
  priceTier: PriceTier;
  phone: string;
  whatsapp: string;
  openTime: string;
  closeTime: string;
  amenities: string;
  tags: string;
}

const BLANK: FormShape = {
  name: '', nameAr: '', category: 'dining', subcategory: '',
  description: '', address: '', areaId: 'jlt', priceTier: 2,
  phone: '', whatsapp: '', openTime: '09:00', closeTime: '22:00',
  amenities: '', tags: '',
};

const FALLBACK_PHOTO =
  'https://images.unsplash.com/photo-1441986300917-64674bd600d8?auto=format&fit=crop&w=900&q=80';

/** Small deterministic jitter so new pins do not stack on the area centroid. */
const jitter = (seed: number, spread = 0.012): number => {
  const x = Math.sin(seed) * 10000;
  return (x - Math.floor(x) - 0.5) * spread;
};

export default function AddBusinessModal({ open, onClose, onSubmit }: Props) {
  const [form, setForm] = useState<FormShape>(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(BLANK);
    setErrors({});
    setDone(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  const area = useMemo(
    () => DUBAI_AREAS.find((a) => a.id === form.areaId) ?? DUBAI_AREAS[0],
    [form.areaId]
  );

  if (!open) return null;

  const set = <K extends keyof FormShape>(key: K, value: FormShape[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const validate = (): boolean => {
    const next: Record<string, string> = {};
    if (form.name.trim().length < 2) next.name = 'Business name is required.';
    if (form.subcategory.trim().length < 2) next.subcategory = 'Tell people what type of place this is.';
    if (form.address.trim().length < 4) next.address = 'A street address is required.';
    if (form.description.trim().length < 12) next.description = 'Add at least a sentence of description.';
    if (!/^[+\d][\d\s-]{6,}$/.test(form.phone.trim())) next.phone = 'Enter a valid phone number.';
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    const seed = form.name.length + form.address.length + Date.now() % 1000;
    const whatsapp = (form.whatsapp || form.phone).replace(/\D/g, '');

    const business: Business = {
      id: `user-${Date.now().toString(36)}`,
      name: form.name.trim(),
      nameAr: form.nameAr.trim() || form.name.trim(),
      category: form.category,
      subcategory: form.subcategory.trim(),
      description: form.description.trim(),
      photos: [FALLBACK_PHOTO],
      rating: 0,
      reviewCount: 0,
      priceTier: form.priceTier,
      address: form.address.trim(),
      area: area.name,
      lat: area.lat + jitter(seed),
      lng: area.lng + jitter(seed + 7),
      phone: form.phone.trim(),
      whatsapp,
      tags: form.tags.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean),
      amenities: form.amenities.split(',').map((t) => t.trim()).filter(Boolean),
      verified: false,
      featured: false,
      source: 'curated',
      hours: WEEKDAYS.map((day) => ({ day, open: form.openTime, close: form.closeTime })),
    };

    onSubmit(business);
    setDone(true);
    window.setTimeout(onClose, 1100);
  };

  const field =
    'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3.5 text-sm font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-dubai-300 focus:bg-white focus:ring-4 focus:ring-dubai-100';
  const label = 'mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-slate-500';
  const errText = 'mt-1 text-[12px] font-semibold text-dubai-600';

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label="List your business"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-2xl animate-scaleIn flex-col overflow-hidden rounded-t-3xl bg-white shadow-pop sm:rounded-3xl"
      >
        <div className="flex shrink-0 items-center gap-3 border-b border-slate-200 px-5 py-4">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-dubai-600 text-white">
            <Building2 className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-extrabold tracking-tight text-slate-900">
              List your business
            </h2>
            <p className="text-[12px] font-semibold text-slate-400">
              Add your place to the Dubai directory — it appears on the map instantly.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="grid h-9 w-9 place-items-center rounded-xl text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
        </div>

        {done ? (
          <div className="flex flex-col items-center justify-center gap-3 px-6 py-16 text-center">
            <span className="grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-emerald-600">
              <Check className="h-7 w-7" strokeWidth={3} />
            </span>
            <h3 className="text-xl font-extrabold text-slate-900">Business added</h3>
            <p className="text-sm font-semibold text-slate-500">
              {form.name} is now live in {area.name}.
            </p>
          </div>
        ) : (
          <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-5 sm:p-6">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="bf-name">Business name</label>
                <input
                  id="bf-name" className={field} value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="e.g. Al Noor Cafeteria"
                />
                {errors.name && <p className={errText}>{errors.name}</p>}
              </div>

              <div>
                <label className={label} htmlFor="bf-namear">Arabic name (optional)</label>
                <input
                  id="bf-namear" dir="rtl" className={field} value={form.nameAr}
                  onChange={(e) => set('nameAr', e.target.value)}
                  placeholder="اسم النشاط"
                />
              </div>

              <div>
                <label className={label} htmlFor="bf-category">Category</label>
                <select
                  id="bf-category" className={field} value={form.category}
                  onChange={(e) => set('category', e.target.value as CategoryId)}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.id} value={c.id}>{c.label}</option>
                  ))}
                </select>
              </div>

              <div>
                <label className={label} htmlFor="bf-sub">Business type</label>
                <input
                  id="bf-sub" className={field} value={form.subcategory}
                  onChange={(e) => set('subcategory', e.target.value)}
                  placeholder="e.g. Lebanese Restaurant"
                />
                {errors.subcategory && <p className={errText}>{errors.subcategory}</p>}
              </div>

              <div>
                <label className={label} htmlFor="bf-area">Dubai area</label>
                <select
                  id="bf-area" className={field} value={form.areaId}
                  onChange={(e) => set('areaId', e.target.value)}
                >
                  {DUBAI_AREAS.map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </div>

              <div className="sm:col-span-2">
                <label className={label} htmlFor="bf-address">Street address</label>
                <input
                  id="bf-address" className={field} value={form.address}
                  onChange={(e) => set('address', e.target.value)}
                  placeholder="e.g. Cluster C, Goldcrest Executive Tower"
                />
                {errors.address && <p className={errText}>{errors.address}</p>}
                <p className="mt-1.5 inline-flex items-center gap-1.5 text-[12px] font-semibold text-slate-400">
                  <MapPin className="h-3.5 w-3.5 text-dubai-500" />
                  Pin will be placed in {area.name} ({area.lat.toFixed(4)}, {area.lng.toFixed(4)})
                </p>
              </div>

              <div className="sm:col-span-2">
                <label className={label} htmlFor="bf-desc">Description</label>
                <textarea
                  id="bf-desc" rows={3} value={form.description}
                  onChange={(e) => set('description', e.target.value)}
                  placeholder="What makes this place worth visiting?"
                  className="w-full rounded-xl border border-slate-200 bg-slate-50 p-3.5 text-sm font-medium leading-relaxed text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-dubai-300 focus:bg-white focus:ring-4 focus:ring-dubai-100"
                />
                {errors.description && <p className={errText}>{errors.description}</p>}
              </div>

              <div>
                <label className={label} htmlFor="bf-phone">Phone</label>
                <input
                  id="bf-phone" className={field} value={form.phone}
                  onChange={(e) => set('phone', e.target.value)}
                  placeholder="+971 4 000 0000"
                />
                {errors.phone && <p className={errText}>{errors.phone}</p>}
              </div>

              <div>
                <label className={label} htmlFor="bf-wa">WhatsApp (optional)</label>
                <input
                  id="bf-wa" className={field} value={form.whatsapp}
                  onChange={(e) => set('whatsapp', e.target.value)}
                  placeholder="Defaults to the phone number"
                />
              </div>

              <div>
                <label className={label}>Price tier</label>
                <div className="flex gap-1.5">
                  {([1, 2, 3, 4] as PriceTier[]).map((tier) => (
                    <button
                      key={tier}
                      type="button"
                      onClick={() => set('priceTier', tier)}
                      aria-pressed={form.priceTier === tier}
                      className={`h-11 flex-1 rounded-xl border text-[12px] font-extrabold transition ${
                        form.priceTier === tier
                          ? 'border-dubai-600 bg-dubai-600 text-white'
                          : 'border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                      }`}
                    >
                      {'AED '.repeat(tier).trim()}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className={label}>Daily hours</label>
                <div className="flex items-center gap-2">
                  <input
                    type="time" aria-label="Opening time" className={field} value={form.openTime}
                    onChange={(e) => set('openTime', e.target.value)}
                  />
                  <span className="font-bold text-slate-400">–</span>
                  <input
                    type="time" aria-label="Closing time" className={field} value={form.closeTime}
                    onChange={(e) => set('closeTime', e.target.value)}
                  />
                </div>
              </div>

              <div>
                <label className={label} htmlFor="bf-amen">Amenities (comma separated)</label>
                <input
                  id="bf-amen" className={field} value={form.amenities}
                  onChange={(e) => set('amenities', e.target.value)}
                  placeholder="Free WiFi, Parking, Delivery"
                />
              </div>

              <div>
                <label className={label} htmlFor="bf-tags">Tags (comma separated)</label>
                <input
                  id="bf-tags" className={field} value={form.tags}
                  onChange={(e) => set('tags', e.target.value)}
                  placeholder="breakfast, halal, family"
                />
              </div>
            </div>

            <div className="mt-6 flex items-center gap-2 border-t border-slate-100 pt-5">
              <button
                type="button"
                onClick={onClose}
                className="h-11 flex-1 rounded-xl border border-slate-200 text-sm font-bold text-slate-600 transition hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="h-11 flex-[2] rounded-xl bg-dubai-600 text-sm font-extrabold text-white shadow-sm transition hover:bg-dubai-700 active:scale-[0.99]"
              >
                Publish business
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
