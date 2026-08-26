/* ---------------------------------------------------------------------------
 * Local account store.
 *
 * This app has no backend, so accounts live in localStorage on the device.
 * Passwords are never stored: each account keeps a random 16-byte salt and a
 * PBKDF2-SHA256 derivation of the password, and sign-in re-derives and
 * compares. That prevents casual password disclosure (and reuse damage) if
 * someone reads localStorage.
 *
 * It is NOT server-side authentication. Anything client-only can be bypassed
 * by editing storage, so this gates UI, not trust. Swap `signUp`/`signIn` for
 * real API calls when a backend exists — nothing else needs to change.
 * ------------------------------------------------------------------------- */

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  createdAt: string;
}

interface StoredAccount extends AuthUser {
  salt: string;
  hash: string;
  iterations: number;
}

const ACCOUNTS_KEY = 'bf-dubai-accounts';
const SESSION_KEY = 'bf-dubai-session';
const ITERATIONS = 210_000;

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/* ------------------------------- storage -------------------------------- */

function readAccounts(): StoredAccount[] {
  try {
    const raw = window.localStorage.getItem(ACCOUNTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? (parsed as StoredAccount[]) : [];
  } catch {
    return [];
  }
}

function writeAccounts(accounts: StoredAccount[]): void {
  try {
    window.localStorage.setItem(ACCOUNTS_KEY, JSON.stringify(accounts));
  } catch {
    /* storage full or disabled — the account simply will not persist */
  }
}

const normaliseEmail = (email: string): string => email.trim().toLowerCase();

/* -------------------------------- crypto -------------------------------- */

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary);
};

const randomBytes = (length: number): Uint8Array => {
  const out = new Uint8Array(length);
  crypto.getRandomValues(out);
  return out;
};

async function derive(
  password: string,
  saltB64: string,
  iterations: number
): Promise<string> {
  const salt = Uint8Array.from(atob(saltB64), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    key,
    256
  );
  return toBase64(new Uint8Array(bits));
}

/** Length-independent comparison, so timing does not leak the hash. */
function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

/* -------------------------------- public -------------------------------- */

export class AuthError extends Error {
  readonly field: 'name' | 'email' | 'password' | 'form';
  constructor(field: AuthError['field'], message: string) {
    super(message);
    this.name = 'AuthError';
    this.field = field;
  }
}

const publicUser = (account: StoredAccount): AuthUser => ({
  id: account.id,
  name: account.name,
  email: account.email,
  createdAt: account.createdAt,
});

export async function signUp(input: {
  name: string;
  email: string;
  password: string;
}): Promise<AuthUser> {
  const name = input.name.trim();
  const email = normaliseEmail(input.email);

  if (name.length < 2) throw new AuthError('name', 'Please enter your name.');
  if (!EMAIL_RE.test(email)) throw new AuthError('email', 'Enter a valid email address.');
  if (input.password.length < 8) {
    throw new AuthError('password', 'Password must be at least 8 characters.');
  }
  if (input.password.length > 200) {
    throw new AuthError('password', 'Password must be 200 characters or fewer.');
  }

  const accounts = readAccounts();
  if (accounts.some((a) => normaliseEmail(a.email) === email)) {
    throw new AuthError('email', 'An account with that email already exists.');
  }

  const salt = toBase64(randomBytes(16));
  const hash = await derive(input.password, salt, ITERATIONS);

  const account: StoredAccount = {
    id:
      typeof crypto.randomUUID === 'function'
        ? crypto.randomUUID()
        : `u_${Date.now().toString(36)}_${Math.floor(Math.random() * 1e6).toString(36)}`,
    name,
    email,
    createdAt: new Date().toISOString(),
    salt,
    hash,
    iterations: ITERATIONS,
  };

  writeAccounts([...accounts, account]);
  startSession(account.id);
  return publicUser(account);
}

export async function signIn(email: string, password: string): Promise<AuthUser> {
  const target = normaliseEmail(email);
  const accounts = readAccounts();
  const account = accounts.find((a) => normaliseEmail(a.email) === target);

  // Derive even when the email is unknown, so a missing account and a wrong
  // password take the same amount of work.
  const salt = account?.salt ?? toBase64(new Uint8Array(16));
  const iterations = account?.iterations ?? ITERATIONS;
  const candidate = await derive(password, salt, iterations);

  if (!account || !safeEqual(candidate, account.hash)) {
    throw new AuthError('form', 'That email and password do not match.');
  }

  startSession(account.id);
  return publicUser(account);
}

export function startSession(userId: string): void {
  try {
    window.localStorage.setItem(SESSION_KEY, userId);
  } catch {
    /* ignore */
  }
}

export function signOut(): void {
  try {
    window.localStorage.removeItem(SESSION_KEY);
  } catch {
    /* ignore */
  }
}

/** The signed-in user for this device, or null. */
export function currentUser(): AuthUser | null {
  try {
    const id = window.localStorage.getItem(SESSION_KEY);
    if (!id) return null;
    const account = readAccounts().find((a) => a.id === id);
    return account ? publicUser(account) : null;
  } catch {
    return null;
  }
}

/** Rough strength signal for the signup form. */
export function passwordStrength(password: string): {
  score: 0 | 1 | 2 | 3;
  label: string;
} {
  if (password.length < 8) return { score: 0, label: 'Too short' };
  let score = 0;
  if (password.length >= 12) score += 1;
  if (/[a-z]/.test(password) && /[A-Z]/.test(password)) score += 1;
  if (/\d/.test(password) && /[^A-Za-z0-9]/.test(password)) score += 1;
  const clamped = Math.min(3, score) as 0 | 1 | 2 | 3;
  return { score: clamped, label: ['Weak', 'Fair', 'Good', 'Strong'][clamped] };
}
