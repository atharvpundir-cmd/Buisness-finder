import { useEffect, useMemo, useState } from 'react';
import {
  Eye, EyeOff, LoaderCircle, Lock, Mail, MapPin, ShieldCheck, User, X,
} from 'lucide-react';
import { AuthError, passwordStrength, signIn, signUp, type AuthUser } from '../lib/auth';

export type AuthMode = 'login' | 'signup';

interface Props {
  open: boolean;
  mode: AuthMode;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
  onAuthenticated: (user: AuthUser) => void;
  /** Optional line explaining why the modal was opened. */
  reason?: string | null;
}

const BLANK = { name: '', email: '', password: '' };

export default function AuthModal({
  open, mode, onModeChange, onClose, onAuthenticated, reason,
}: Props) {
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(BLANK);
    setErrors({});
    setBusy(false);
    setShowPassword(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, mode, onClose]);

  const strength = useMemo(() => passwordStrength(form.password), [form.password]);

  if (!open) return null;

  const isSignup = mode === 'signup';
  const set = (key: keyof typeof BLANK, value: string) =>
    setForm((f) => ({ ...f, [key]: value }));

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setErrors({});
    try {
      const user = isSignup
        ? await signUp(form)
        : await signIn(form.email, form.password);
      onAuthenticated(user);
      onClose();
    } catch (err) {
      if (err instanceof AuthError) {
        setErrors({ [err.field]: err.message });
      } else {
        setErrors({ form: 'Something went wrong. Please try again.' });
      }
    } finally {
      setBusy(false);
    }
  };

  const field =
    'h-11 w-full rounded-xl border border-slate-200 bg-slate-50 pl-10 pr-3.5 text-sm font-medium text-slate-900 outline-none transition placeholder:font-normal placeholder:text-slate-400 focus:border-dubai-300 focus:bg-white focus:ring-4 focus:ring-dubai-100';
  const label = 'mb-1.5 block text-[12px] font-bold uppercase tracking-wider text-slate-500';
  const errText = 'mt-1 text-[12px] font-semibold text-dubai-600';
  const iconCls = 'pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400';

  return (
    <div
      className="fixed inset-0 z-[1100] flex items-end justify-center bg-slate-900/60 backdrop-blur-sm sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-label={isSignup ? 'Create an account' : 'Sign in'}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex max-h-[94vh] w-full max-w-md animate-scaleIn flex-col overflow-hidden rounded-t-3xl bg-white shadow-pop sm:rounded-3xl"
      >
        {/* Header */}
        <div className="relative shrink-0 overflow-hidden bg-gradient-to-br from-dubai-600 to-dubai-800 px-6 py-6 text-white">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="absolute right-3 top-3 grid h-9 w-9 place-items-center rounded-xl text-white/80 transition hover:bg-white/15 hover:text-white"
          >
            <X className="h-[18px] w-[18px]" />
          </button>
          <span className="grid h-11 w-11 place-items-center rounded-xl bg-white/15 backdrop-blur">
            <MapPin className="h-5 w-5" strokeWidth={2.5} />
          </span>
          <h2 className="mt-3 text-xl font-extrabold tracking-tight">
            {isSignup ? 'Create your account' : 'Welcome back'}
          </h2>
          <p className="mt-0.5 text-[13px] font-semibold text-white/75">
            {isSignup
              ? 'Save businesses and list your own on BuisnessFind Dubai.'
              : 'Sign in to reach your saved businesses.'}
          </p>
        </div>

        <form onSubmit={submit} className="min-h-0 flex-1 overflow-y-auto p-6">
          {reason && (
            <p className="mb-4 rounded-xl bg-dubai-50 px-3.5 py-2.5 text-[13px] font-semibold text-dubai-800 ring-1 ring-dubai-100">
              {reason}
            </p>
          )}

          {errors.form && (
            <p className="mb-4 rounded-xl bg-dubai-50 px-3.5 py-2.5 text-[13px] font-bold text-dubai-700 ring-1 ring-dubai-200">
              {errors.form}
            </p>
          )}

          {isSignup && (
            <div className="mb-4">
              <label className={label} htmlFor="auth-name">Full name</label>
              <div className="relative">
                <User className={iconCls} />
                <input
                  id="auth-name"
                  className={field}
                  value={form.name}
                  onChange={(e) => set('name', e.target.value)}
                  placeholder="Atharv Pundir"
                  autoComplete="name"
                />
              </div>
              {errors.name && <p className={errText}>{errors.name}</p>}
            </div>
          )}

          <div className="mb-4">
            <label className={label} htmlFor="auth-email">Email</label>
            <div className="relative">
              <Mail className={iconCls} />
              <input
                id="auth-email"
                type="email"
                className={field}
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
                placeholder="you@example.com"
                autoComplete="email"
              />
            </div>
            {errors.email && <p className={errText}>{errors.email}</p>}
          </div>

          <div className="mb-4">
            <label className={label} htmlFor="auth-password">Password</label>
            <div className="relative">
              <Lock className={iconCls} />
              <input
                id="auth-password"
                type={showPassword ? 'text' : 'password'}
                className={`${field} pr-11`}
                value={form.password}
                onChange={(e) => set('password', e.target.value)}
                placeholder={isSignup ? 'At least 8 characters' : 'Your password'}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2.5 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-lg text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {errors.password && <p className={errText}>{errors.password}</p>}

            {isSignup && form.password.length > 0 && (
              <div className="mt-2 flex items-center gap-2">
                <div className="flex h-1.5 flex-1 gap-1">
                  {[0, 1, 2].map((i) => (
                    <span
                      key={i}
                      className={`h-full flex-1 rounded-full transition ${
                        strength.score > i
                          ? strength.score === 3
                            ? 'bg-emerald-500'
                            : strength.score === 2
                              ? 'bg-amber-400'
                              : 'bg-dubai-400'
                          : 'bg-slate-200'
                      }`}
                    />
                  ))}
                </div>
                <span className="text-[11px] font-bold text-slate-500">{strength.label}</span>
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={busy}
            className="inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-dubai-600 text-sm font-extrabold text-white shadow-sm transition hover:bg-dubai-700 active:scale-[0.99] disabled:opacity-60"
          >
            {busy && <LoaderCircle className="h-4 w-4 animate-spin" />}
            {busy
              ? isSignup ? 'Creating account…' : 'Signing in…'
              : isSignup ? 'Create account' : 'Sign in'}
          </button>

          <p className="mt-4 text-center text-[13px] font-semibold text-slate-500">
            {isSignup ? 'Already have an account?' : 'New to BuisnessFind?'}{' '}
            <button
              type="button"
              onClick={() => {
                setErrors({});
                onModeChange(isSignup ? 'login' : 'signup');
              }}
              className="font-extrabold text-dubai-600 underline underline-offset-2 hover:text-dubai-700"
            >
              {isSignup ? 'Sign in' : 'Create one'}
            </button>
          </p>

          <p className="mt-5 flex items-start gap-2 rounded-xl bg-slate-50 px-3.5 py-3 text-[11.5px] font-semibold leading-relaxed text-slate-500">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
            <span>
              Accounts are stored on this device only. Your password is never saved — just a
              PBKDF2 hash of it. This demo has no server, so it is not a substitute for real
              authentication.
            </span>
          </p>
        </form>
      </div>
    </div>
  );
}
