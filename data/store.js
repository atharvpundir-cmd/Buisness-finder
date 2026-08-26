'use strict';

/**
 * businessfind — persistent store.
 *
 * Design rules enforced here:
 *  - Every disk write is atomic (tmp file + rename) and serialised through a queue.
 *  - A corrupt store.json is preserved (renamed) and the process refuses to boot,
 *    rather than silently starting from an empty database.
 *  - Password hashing is async scrypt behind a small concurrency semaphore so a
 *    signup/login flood cannot pin the single event loop.
 *  - Live location is IN MEMORY ONLY. It is never persisted, never in a snapshot,
 *    and it dies with the process.
 *
 * Sync functions: pure reads + the API-usage counters (callers use them in `if`).
 * Async functions: anything that touches disk, plus verifyPassword (async scrypt).
 */

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

const FILE = path.join(__dirname, 'store.json');
const TMP_FILE = `${FILE}.tmp`;

// ---------------------------------------------------------------------------
// constants
// ---------------------------------------------------------------------------

const CATEGORY_KEYS = [
  'restaurants', 'cafes', 'groceries', 'malls', 'clothing', 'pharmacies',
  'gyms', 'salons', 'atms', 'petrol', 'bakeries', 'bars',
];

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;   // 30 days
const MAX_SESSIONS_PER_USER = 10;
const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;         // 24 hours
const CHECKIN_TTL_MS = 4 * 60 * 60 * 1000;         // 4 hours
const DECLINE_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const REPORT_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const MAX_SAVED_PER_USER = 200;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const LIVE_SWEEP_INTERVAL_MS = 60 * 1000;

// The only live-share durations accepted: 15 minutes, 1 hour, 8 hours.
const LIVE_DURATIONS = [900000, 3600000, 28800000];

// Live coordinates are rounded to ~11 m. Precise enough to meet a friend,
// coarse enough that a leaked snapshot is not a doorstep.
const LIVE_PRECISION = 4;

const USAGE_KINDS = ['nearby', 'place', 'geocode'];

// ---------------------------------------------------------------------------
// scrypt parameters + pepper
// ---------------------------------------------------------------------------

// Current cost. 128 * N * r = 32 MiB for N=32768,r=8 which is *over* Node's
// default 32 MiB maxmem, so maxmem must be raised explicitly or scrypt throws.
const SCRYPT = { N: 32768, r: 8, p: 1, keylen: 32 };
const SCRYPT_MAXMEM = 64 * 1024 * 1024;

// Whitelist applied when *verifying* a stored hash. The parameters in a stored
// record are attacker-controllable if the file is ever tampered with; feeding an
// unbounded N straight into scrypt is a trivial OOM.
const SCRYPT_ALLOWED = { N: [16384, 32768], r: [8], p: [1] };
const KEYLEN_MIN = 16;
const KEYLEN_MAX = 64;

// Optional pepper. The version travels inside the hash string so the pepper can
// be rotated: set AUTH_PEPPER/AUTH_PEPPER_VERSION to the new one and keep the
// old under AUTH_PEPPER_OLD/AUTH_PEPPER_OLD_VERSION until every hash is reissued.
const PEPPER = process.env.AUTH_PEPPER || '';
const PEPPER_VERSION = PEPPER ? sanitizeVersion(process.env.AUTH_PEPPER_VERSION || '1') : '0';
const PEPPER_OLD = process.env.AUTH_PEPPER_OLD || '';
const PEPPER_OLD_VERSION = PEPPER_OLD ? sanitizeVersion(process.env.AUTH_PEPPER_OLD_VERSION || '0') : '';

function sanitizeVersion(v) {
  const s = String(v).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16);
  return s || '1';
}

const PEPPERS = new Map();
PEPPERS.set('0', '');                       // no pepper
if (PEPPER) PEPPERS.set(PEPPER_VERSION, PEPPER);
if (PEPPER_OLD && PEPPER_OLD_VERSION) PEPPERS.set(PEPPER_OLD_VERSION, PEPPER_OLD);

function pepperFor(version) {
  return PEPPERS.has(version) ? PEPPERS.get(version) : null;
}

/** Pre-hash with HMAC-SHA256 under the pepper, so the secret never enters scrypt directly. */
function prehash(password, pepper) {
  const pw = Buffer.from(String(password), 'utf8');
  if (!pepper) return pw;
  return crypto.createHmac('sha256', Buffer.from(pepper, 'utf8')).update(pw).digest();
}

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function httpError(message, status) {
  return Object.assign(new Error(message), { status });
}

function nowIso() { return new Date().toISOString(); }

function todayKey() { return new Date().toISOString().slice(0, 10); }

function isObj(v) { return !!v && typeof v === 'object' && !Array.isArray(v); }

function arr(v) { return Array.isArray(v) ? v : []; }

function obj(v) { return isObj(v) ? v : {}; }

/** Trim, strip control characters, hard length cap. */
function text(value, max, { multiline = false } = {}) {
  let s = value === undefined || value === null ? '' : String(value);
  if (multiline) {
    // Keep newlines; drop every other control character.
    s = s.replace(/\r\n?/g, '\n')
      .replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '')
      .replace(/[^\S\n]+/g, ' ')
      .replace(/\n{3,}/g, '\n\n');
    s = s.split('\n').map((line) => line.trim()).join('\n').trim();
  } else {
    s = s.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
  }
  if (s.length > max) s = s.slice(0, max).trim();
  return s;
}

function isEmail(s) {
  return typeof s === 'string'
    && s.length >= 3 && s.length <= 254
    && /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)+$/.test(s);
}

function sha256Hex(s) {
  return crypto.createHash('sha256').update(String(s)).digest('hex');
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function roundTo(n, places) {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

// ---------------------------------------------------------------------------
// database shape + coercion
// ---------------------------------------------------------------------------

function emptyUsage() {
  return { date: todayKey(), nearby: 0, place: 0, geocode: 0 };
}

function emptyDb() {
  return {
    version: 2,
    users: [],            // { id,name,email,password,createdAt,emailVerified }
    sessions: {},         // sha256(token) -> { userId, createdAt, expires }
    verificationTokens: [], // { id,userId,digest,createdAt,expiresAt }
    friendRequests: [],   // { id,fromId,toId,status,createdAt,respondedAt }
    friendships: [],      // { id,userA,userB,createdAt }
    blocks: [],           // { id,userId,targetId,createdAt }
    reports: [],          // { id,userId,targetId,reason,createdAt }
    checkIns: [],         // { id,userId,placeId,placeName,note,createdAt,expiresAt }
    savedPlaces: [],      // { id,userId,placeId,name,category,createdAt }
    apiUsage: emptyUsage(),
    // NOTE: no `locations` key. Live location is memory-only, by design.
  };
}

function coerceUsage(raw) {
  if (!isObj(raw)) return emptyUsage();
  const out = { date: typeof raw.date === 'string' ? raw.date.slice(0, 10) : todayKey() };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date)) out.date = todayKey();
  for (const kind of USAGE_KINDS) {
    const n = Number(raw[kind]);
    out[kind] = Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  return out;
}

function coerceSessions(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  for (const [digest, s] of Object.entries(raw)) {
    if (!/^[0-9a-f]{64}$/.test(digest) || !isObj(s)) continue;
    const userId = typeof s.userId === 'string' ? s.userId : null;
    const expires = Number(s.expires);
    if (!userId || !Number.isFinite(expires)) continue;
    out[digest] = {
      userId,
      createdAt: typeof s.createdAt === 'string' ? s.createdAt : nowIso(),
      expires,
    };
  }
  return out;
}

function coerceRows(raw, fn) {
  return arr(raw).map(fn).filter(Boolean);
}

/**
 * Rebuild every collection with the right type. A store.json containing
 * `"users": null` (or a string, or a number) must not turn every route into a
 * permanent 500 — it just yields an empty collection.
 */
function coerceDb(raw) {
  const src = obj(raw);
  const db = emptyDb();

  db.users = coerceRows(src.users, (u) => {
    if (!isObj(u) || typeof u.id !== 'string' || typeof u.email !== 'string') return null;
    return {
      id: u.id,
      name: text(u.name, 80) || 'Member',
      email: String(u.email).toLowerCase().slice(0, 254),
      password: typeof u.password === 'string' ? u.password : '',
      createdAt: typeof u.createdAt === 'string' ? u.createdAt : nowIso(),
      emailVerified: u.emailVerified === true,
    };
  });

  db.sessions = coerceSessions(src.sessions);

  db.verificationTokens = coerceRows(src.verificationTokens, (t) => {
    if (!isObj(t) || typeof t.digest !== 'string' || typeof t.userId !== 'string') return null;
    const expiresAt = Number(t.expiresAt);
    return {
      id: typeof t.id === 'string' ? t.id : crypto.randomUUID(),
      userId: t.userId,
      digest: t.digest,
      createdAt: typeof t.createdAt === 'string' ? t.createdAt : nowIso(),
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : 0,
    };
  });

  db.friendRequests = coerceRows(src.friendRequests, (r) => {
    if (!isObj(r) || typeof r.fromId !== 'string' || typeof r.toId !== 'string') return null;
    const status = ['pending', 'accepted', 'declined'].includes(r.status) ? r.status : 'pending';
    return {
      id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
      fromId: r.fromId,
      toId: r.toId,
      status,
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : nowIso(),
      respondedAt: typeof r.respondedAt === 'string' ? r.respondedAt : null,
    };
  });

  db.friendships = coerceRows(src.friendships, (f) => {
    if (!isObj(f) || typeof f.userA !== 'string' || typeof f.userB !== 'string') return null;
    if (f.userA === f.userB) return null;
    return {
      id: typeof f.id === 'string' ? f.id : crypto.randomUUID(),
      userA: f.userA,
      userB: f.userB,
      createdAt: typeof f.createdAt === 'string' ? f.createdAt : nowIso(),
    };
  });

  db.blocks = coerceRows(src.blocks, (b) => {
    if (!isObj(b) || typeof b.userId !== 'string' || typeof b.targetId !== 'string') return null;
    if (b.userId === b.targetId) return null;
    return {
      id: typeof b.id === 'string' ? b.id : crypto.randomUUID(),
      userId: b.userId,
      targetId: b.targetId,
      createdAt: typeof b.createdAt === 'string' ? b.createdAt : nowIso(),
    };
  });

  db.reports = coerceRows(src.reports, (r) => {
    if (!isObj(r) || typeof r.userId !== 'string' || typeof r.targetId !== 'string') return null;
    return {
      id: typeof r.id === 'string' ? r.id : crypto.randomUUID(),
      userId: r.userId,
      targetId: r.targetId,
      reason: text(r.reason, 500, { multiline: true }),
      createdAt: typeof r.createdAt === 'string' ? r.createdAt : nowIso(),
    };
  });

  db.checkIns = coerceRows(src.checkIns, (c) => {
    if (!isObj(c) || typeof c.userId !== 'string') return null;
    const created = typeof c.createdAt === 'string' ? c.createdAt : nowIso();
    const expiresAt = Number(c.expiresAt);
    return {
      id: typeof c.id === 'string' ? c.id : crypto.randomUUID(),
      userId: c.userId,
      placeId: text(c.placeId, 200),
      placeName: text(c.placeName, 120) || 'Somewhere',
      note: text(c.note, 280, { multiline: true }),
      createdAt: created,
      expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.parse(created) + CHECKIN_TTL_MS,
    };
  });

  db.savedPlaces = coerceRows(src.savedPlaces, (p) => {
    if (!isObj(p) || typeof p.userId !== 'string') return null;
    const placeId = text(p.placeId, 200);
    if (!placeId) return null;
    return {
      id: typeof p.id === 'string' ? p.id : crypto.randomUUID(),
      userId: p.userId,
      placeId,
      name: text(p.name, 120) || 'Saved place',
      category: normalizeCategory(p.category),
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : nowIso(),
    };
  });

  db.apiUsage = coerceUsage(src.apiUsage);
  return db;
}

function normalizeCategory(value) {
  const raw = String(value === undefined || value === null ? '' : value)
    .toLowerCase().replace(/[^a-z0-9_-]/g, '').slice(0, 40);
  return raw;
}

// ---------------------------------------------------------------------------
// load (ENOENT => fresh, parse failure => preserve + throw)
// ---------------------------------------------------------------------------

let db = emptyDb();

function load() {
  let raw;
  try {
    raw = fs.readFileSync(FILE, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') {
      db = emptyDb();
      return;
    }
    throw err; // EACCES / EISDIR / EIO — a real problem; do not mask it.
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
    if (!isObj(parsed)) throw new Error('store root is not an object');
  } catch (err) {
    // Never wipe. Preserve the bytes and refuse to boot on top of them.
    const backup = `${FILE}.corrupt-${Date.now()}`;
    try {
      fs.renameSync(FILE, backup);
    } catch (renameErr) {
      throw new Error(
        `[store] store.json is unreadable (${err.message}) and could not be set aside (${renameErr.message}). Refusing to start.`,
      );
    }
    throw new Error(
      `[store] store.json is corrupt (${err.message}). The original was preserved at ${backup}. Move a good copy back into place or delete it to start fresh.`,
    );
  }

  db = coerceDb(parsed);
}

load();

// ---------------------------------------------------------------------------
// atomic, serialised persistence
// ---------------------------------------------------------------------------

async function writeSnapshot(snapshot) {
  // Write-then-rename: rename(2) is atomic on the same filesystem, so a crash
  // leaves either the old complete file or the new complete file — never a
  // truncated one.
  const fh = await fsp.open(TMP_FILE, 'w', 0o600);
  try {
    await fh.writeFile(snapshot, 'utf8');
    await fh.sync();
  } finally {
    await fh.close();
  }
  await fsp.rename(TMP_FILE, FILE);
}

let writeQueue = Promise.resolve();

function save() {
  const snapshot = JSON.stringify(db, null, 2);
  const run = () => writeSnapshot(snapshot);
  // Run after whatever is queued, whether that settled ok or not.
  const next = writeQueue.then(run, run);
  // Keep the chain alive even if this write rejects...
  writeQueue = next.then(() => {}, (err) => {
    console.error('[store] write failed:', err && err.message);
  });
  // ...but hand the rejection to the caller so a route can fail loudly.
  return next;
}

// ---------------------------------------------------------------------------
// hashing: async scrypt behind a bounded semaphore
// ---------------------------------------------------------------------------

const HASH_MAX_CONCURRENT = 3;
const HASH_MAX_QUEUE = 32;

let hashActive = 0;
const hashQueue = [];

function acquireHashSlot() {
  if (hashActive < HASH_MAX_CONCURRENT) {
    hashActive += 1;
    return Promise.resolve();
  }
  if (hashQueue.length >= HASH_MAX_QUEUE) {
    return Promise.reject(httpError('Server is busy. Please try again in a moment.', 503));
  }
  return new Promise((resolve) => { hashQueue.push(resolve); });
}

function releaseHashSlot() {
  const next = hashQueue.shift();
  if (next) next();          // slot handed straight over; hashActive unchanged
  else hashActive = Math.max(0, hashActive - 1);
}

function scryptAsync(secret, salt, keylen, params) {
  return new Promise((resolve, reject) => {
    crypto.scrypt(secret, salt, keylen, { ...params, maxmem: SCRYPT_MAXMEM }, (err, derived) => {
      if (err) reject(err); else resolve(derived);
    });
  });
}

async function derive(secret, salt, keylen, params) {
  await acquireHashSlot();
  try {
    return await scryptAsync(secret, salt, keylen, params);
  } finally {
    releaseHashSlot();
  }
}

/**
 * Encoded format: scrypt$v1$<pepperVersion>$<N>$<r>$<p>$<saltHex>$<hashHex>
 * Legacy format (6 fields, no pepper): scrypt$<N>$<r>$<p>$<saltHex>$<hashHex>
 */
async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const derived = await derive(
    prehash(password, PEPPER),
    salt,
    SCRYPT.keylen,
    { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p },
  );
  return [
    'scrypt', 'v1', PEPPER_VERSION, SCRYPT.N, SCRYPT.r, SCRYPT.p,
    salt.toString('hex'), derived.toString('hex'),
  ].join('$');
}

function parseEncoded(encoded) {
  const parts = String(encoded || '').split('$');
  if (parts[0] !== 'scrypt') return null;

  let pepperVersion; let N; let r; let p; let saltHex; let hashHex;
  if (parts.length === 8 && parts[1] === 'v1') {
    [, , pepperVersion, N, r, p, saltHex, hashHex] = parts;
  } else if (parts.length === 6) {
    pepperVersion = '0';
    [, N, r, p, saltHex, hashHex] = parts;
  } else {
    return null;
  }

  const nNum = Number(N);
  const rNum = Number(r);
  const pNum = Number(p);
  // Clamp to a whitelist: stored parameters are untrusted input.
  if (!SCRYPT_ALLOWED.N.includes(nNum)) return null;
  if (!SCRYPT_ALLOWED.r.includes(rNum)) return null;
  if (!SCRYPT_ALLOWED.p.includes(pNum)) return null;
  if (!/^[0-9a-f]+$/.test(saltHex || '') || saltHex.length % 2 !== 0) return null;
  if (!/^[0-9a-f]+$/.test(hashHex || '') || hashHex.length % 2 !== 0) return null;

  const keylen = hashHex.length / 2;
  if (keylen < KEYLEN_MIN || keylen > KEYLEN_MAX) return null;

  const pepper = pepperFor(pepperVersion);
  if (pepper === null) return null; // unknown pepper version

  return {
    pepper,
    keylen,
    salt: Buffer.from(saltHex, 'hex'),
    expected: Buffer.from(hashHex, 'hex'),
    params: { N: nNum, r: rNum, p: pNum },
  };
}

// A throwaway hash built at boot with the *current* parameters. Logins for
// unknown emails are verified against it so the response time is the same as
// for a known email — no user-enumeration timing oracle.
let DUMMY_HASH = null;
const DUMMY_READY = hashPassword(crypto.randomBytes(24).toString('hex'))
  .then((h) => { DUMMY_HASH = h; })
  .catch((err) => { console.error('[store] failed to build dummy hash:', err && err.message); });

/**
 * @returns {Promise<boolean>} — MUST be awaited.
 */
async function verifyPassword(password, encoded) {
  const parsed = parseEncoded(encoded);
  if (!parsed) {
    // Burn the same CPU we would have burned for a real user, then fail.
    await DUMMY_READY;
    const dummy = parseEncoded(DUMMY_HASH);
    if (dummy) {
      try {
        await derive(prehash(password, dummy.pepper), dummy.salt, dummy.keylen, dummy.params);
      } catch { /* busy or scrypt error — still a failed login */ }
    }
    return false;
  }

  let derived;
  try {
    derived = await derive(prehash(password, parsed.pepper), parsed.salt, parsed.keylen, parsed.params);
  } catch (err) {
    if (err && err.status === 503) throw err;
    return false;
  }
  if (derived.length !== parsed.expected.length) return false;
  return crypto.timingSafeEqual(derived, parsed.expected);
}

// ---------------------------------------------------------------------------
// users
// ---------------------------------------------------------------------------

function publicUser(user) {
  if (!user) return null;
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    createdAt: user.createdAt,
    emailVerified: user.emailVerified === true,
  };
}

function findByEmail(email) {
  const e = String(email === undefined || email === null ? '' : email).trim().toLowerCase();
  if (!e) return null;
  return db.users.find((u) => u.email === e) || null;
}

function findById(id) {
  if (typeof id !== 'string' || !id) return null;
  return db.users.find((u) => u.id === id) || null;
}

async function createUser({ name, email, password } = {}) {
  const cleanName = text(name, 80);
  const cleanEmail = String(email === undefined || email === null ? '' : email).trim().toLowerCase();
  const pw = password === undefined || password === null ? '' : String(password);

  if (cleanName.length < 1) throw httpError('Please enter your name.', 400);
  if (!isEmail(cleanEmail)) throw httpError('Please enter a valid email address.', 400);
  if (pw.length < 8) throw httpError('Password must be at least 8 characters.', 400);
  if (pw.length > 200) throw httpError('Password must be at most 200 characters.', 400);
  if (findByEmail(cleanEmail)) throw httpError('An account with that email already exists.', 409);

  const hashed = await hashPassword(pw);

  // Re-check after the await: two concurrent signups could both have passed.
  if (findByEmail(cleanEmail)) throw httpError('An account with that email already exists.', 409);

  const user = {
    id: crypto.randomUUID(),
    name: cleanName,
    email: cleanEmail,
    password: hashed,
    createdAt: nowIso(),
    emailVerified: false,
  };
  db.users.push(user);
  await save();
  return user;
}

/** Seed the very first account (used for local bootstrap). No-op if any user exists. */
async function ensureAccount({ name, email, password } = {}) {
  if (db.users.length > 0) return false;
  try {
    await createUser({ name, email, password });
    return true;
  } catch (err) {
    console.error('[store] ensureAccount skipped:', err && err.message);
    return false;
  }
}

// ---------------------------------------------------------------------------
// email verification
// ---------------------------------------------------------------------------

/**
 * Returns the RAW token exactly once (only its sha256 digest is stored).
 * @returns {Promise<{token:string, expiresAt:number}>}
 */
async function createVerificationToken(userId) {
  const user = findById(userId);
  if (!user) throw httpError('Account not found.', 404);

  // One live token per user.
  db.verificationTokens = db.verificationTokens.filter((t) => t.userId !== user.id);

  const token = crypto.randomBytes(32).toString('hex');
  const expiresAt = Date.now() + VERIFY_TTL_MS;
  db.verificationTokens.push({
    id: crypto.randomUUID(),
    userId: user.id,
    digest: sha256Hex(token),
    createdAt: nowIso(),
    expiresAt,
  });
  await save();
  return { token, expiresAt };
}

/** Single use. Returns the user record on success, null otherwise. */
async function consumeVerificationToken(rawToken) {
  const raw = typeof rawToken === 'string' ? rawToken.trim() : '';
  if (!/^[0-9a-f]{64}$/.test(raw)) return null;

  const digest = sha256Hex(raw);
  const idx = db.verificationTokens.findIndex((t) => t.digest === digest);
  if (idx === -1) return null;

  const [row] = db.verificationTokens.splice(idx, 1); // consumed either way
  if (row.expiresAt < Date.now()) {
    await save();
    return null;
  }

  const user = findById(row.userId);
  if (!user) {
    await save();
    return null;
  }
  user.emailVerified = true;
  await save();
  return user;
}

// ---------------------------------------------------------------------------
// sessions
// ---------------------------------------------------------------------------

async function createSession(userId) {
  const user = findById(userId);
  if (!user) throw httpError('Account not found.', 404);

  const token = crypto.randomBytes(32).toString('hex');
  const digest = sha256Hex(token);
  db.sessions[digest] = { userId: user.id, createdAt: nowIso(), expires: Date.now() + SESSION_TTL_MS };

  // Cap concurrent sessions per user; oldest are dropped first.
  const mine = Object.entries(db.sessions)
    .filter(([, s]) => s.userId === user.id)
    .sort((a, b) => (Date.parse(b[1].createdAt) || 0) - (Date.parse(a[1].createdAt) || 0));
  for (const [oldDigest] of mine.slice(MAX_SESSIONS_PER_USER)) delete db.sessions[oldDigest];

  await save();
  return { token, maxAge: Math.floor(SESSION_TTL_MS / 1000) };
}

function userForToken(token) {
  if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) return null;
  const session = db.sessions[sha256Hex(token)];
  if (!session || session.expires < Date.now()) return null;
  return findById(session.userId);
}

async function destroySession(token) {
  if (typeof token !== 'string' || !token) return;
  const digest = sha256Hex(token);
  if (!db.sessions[digest]) return;
  delete db.sessions[digest];
  await save();
}

/** Drops expired sessions, orphaned sessions, stale tokens and expired check-ins. */
async function pruneSessions() {
  const now = Date.now();
  let changed = false;

  for (const [digest, s] of Object.entries(db.sessions)) {
    if (s.expires < now || !findById(s.userId)) {
      delete db.sessions[digest];
      changed = true;
    }
  }

  const tokensBefore = db.verificationTokens.length;
  db.verificationTokens = db.verificationTokens.filter((t) => t.expiresAt >= now && findById(t.userId));
  if (db.verificationTokens.length !== tokensBefore) changed = true;

  const checkInsBefore = db.checkIns.length;
  db.checkIns = db.checkIns.filter((c) => c.expiresAt >= now);
  if (db.checkIns.length !== checkInsBefore) changed = true;

  if (changed) await save();
  return changed;
}

setInterval(() => {
  pruneSessions().catch((err) => console.error('[store] prune failed:', err && err.message));
}, PRUNE_INTERVAL_MS).unref();

// ---------------------------------------------------------------------------
// blocks + reports
// ---------------------------------------------------------------------------

function isBlocked(a, b) {
  if (!a || !b) return false;
  return db.blocks.some(
    (x) => (x.userId === a && x.targetId === b) || (x.userId === b && x.targetId === a),
  );
}

function listBlocked(userId) {
  return db.blocks
    .filter((b) => b.userId === userId)
    .map((b) => {
      const u = publicUser(findById(b.targetId));
      return u ? { ...u, blockedAt: b.createdAt } : null;
    })
    .filter(Boolean);
}

async function blockUser(userId, targetId) {
  if (!findById(userId)) throw httpError('Account not found.', 404);
  if (userId === targetId) throw httpError("You can't block yourself.", 400);
  if (!findById(targetId)) throw httpError('That person no longer exists.', 404);

  if (!db.blocks.some((b) => b.userId === userId && b.targetId === targetId)) {
    db.blocks.push({
      id: crypto.randomUUID(), userId, targetId, createdAt: nowIso(),
    });
  }

  // Blocking severs everything between the pair.
  const key = pairKey(userId, targetId);
  db.friendships = db.friendships.filter((f) => pairKey(f.userA, f.userB) !== key);
  db.friendRequests = db.friendRequests.filter(
    (r) => !isBetween(r, userId, targetId) || r.status !== 'pending',
  );
  cleanupLiveAfterUnfriend(userId, targetId);

  await save();
  return { ok: true };
}

async function unblockUser(userId, targetId) {
  const before = db.blocks.length;
  db.blocks = db.blocks.filter((b) => !(b.userId === userId && b.targetId === targetId));
  if (db.blocks.length !== before) await save();
  return { ok: true };
}

async function reportUser(userId, targetId, reason) {
  if (!findById(userId)) throw httpError('Account not found.', 404);
  if (userId === targetId) throw httpError("You can't report yourself.", 400);
  if (!findById(targetId)) throw httpError('That person no longer exists.', 404);

  const cleanReason = text(reason, 500, { multiline: true });
  if (cleanReason.length < 3) throw httpError('Please describe what happened.', 400);

  const cutoff = Date.now() - REPORT_COOLDOWN_MS;
  const recent = db.reports.some(
    (r) => r.userId === userId && r.targetId === targetId && (Date.parse(r.createdAt) || 0) > cutoff,
  );
  if (recent) throw httpError('You already reported this person today.', 429);

  const report = {
    id: crypto.randomUUID(), userId, targetId, reason: cleanReason, createdAt: nowIso(),
  };
  db.reports.push(report);
  if (db.reports.length > 5000) db.reports = db.reports.slice(-5000);
  await save();
  return { id: report.id, createdAt: report.createdAt };
}

// ---------------------------------------------------------------------------
// friends (mutual accept only — no stranger discovery)
// ---------------------------------------------------------------------------

function pairKey(a, b) { return [a, b].sort().join(':'); }

function isBetween(row, a, b) {
  return (row.fromId === a && row.toId === b) || (row.fromId === b && row.toId === a);
}

function areFriends(a, b) {
  if (!a || !b || a === b) return false;
  const key = pairKey(a, b);
  return db.friendships.some((f) => pairKey(f.userA, f.userB) === key);
}

function pendingRequestBetween(a, b) {
  return db.friendRequests.find((r) => r.status === 'pending' && isBetween(r, a, b)) || null;
}

/** Most recent decline of a request `from` -> `to`, if any. */
function recentDecline(fromId, toId) {
  let latest = null;
  for (const r of db.friendRequests) {
    if (r.status !== 'declined') continue;
    if (r.fromId !== fromId || r.toId !== toId) continue;
    const at = Date.parse(r.respondedAt || r.createdAt) || 0;
    if (!latest || at > latest.at) latest = { row: r, at };
  }
  return latest;
}

async function sendFriendRequest(fromId, toId) {
  if (!findById(fromId)) throw httpError('Account not found.', 404);
  if (fromId === toId) throw httpError("You can't send yourself a request.", 400);
  if (!findById(toId)) throw httpError('That person no longer exists.', 404);

  // A block in either direction is a hard stop, and the message is deliberately
  // identical to the "not found" case so a block is not observable.
  if (isBlocked(fromId, toId)) throw httpError('That request could not be sent.', 403);

  if (areFriends(fromId, toId)) throw httpError('You are already friends.', 409);
  if (pendingRequestBetween(fromId, toId)) throw httpError('A request is already pending.', 409);

  const declined = recentDecline(fromId, toId);
  if (declined && Date.now() - declined.at < DECLINE_COOLDOWN_MS) {
    const days = Math.max(1, Math.ceil((DECLINE_COOLDOWN_MS - (Date.now() - declined.at)) / 86400000));
    throw httpError(`That request was declined. You can try again in ${days} day${days === 1 ? '' : 's'}.`, 429);
  }

  const request = {
    id: crypto.randomUUID(),
    fromId,
    toId,
    status: 'pending',
    createdAt: nowIso(),
    respondedAt: null,
  };
  db.friendRequests.push(request);
  await save();
  return { id: request.id, createdAt: request.createdAt };
}

async function respondToRequest(requestId, userId, accept) {
  const request = db.friendRequests.find((r) => r.id === requestId);
  if (!request || request.toId !== userId || request.status !== 'pending') {
    throw httpError('Request not found.', 404);
  }
  if (isBlocked(request.fromId, request.toId)) {
    request.status = 'declined';
    request.respondedAt = nowIso();
    await save();
    throw httpError('That request is no longer available.', 403);
  }

  request.status = accept ? 'accepted' : 'declined';
  request.respondedAt = nowIso();

  if (accept && !areFriends(request.fromId, request.toId)) {
    db.friendships.push({
      id: crypto.randomUUID(),
      userA: request.fromId,
      userB: request.toId,
      createdAt: nowIso(),
    });
  }
  await save();
  return { id: request.id, status: request.status };
}

async function removeFriend(userId, friendId) {
  if (!userId || !friendId) return { ok: true };
  const key = pairKey(userId, friendId);

  const beforeFriendships = db.friendships.length;
  db.friendships = db.friendships.filter((f) => pairKey(f.userA, f.userB) !== key);

  // Drop the request history between the pair too, so a stale accepted/pending
  // row can never resurrect the friendship.
  const beforeRequests = db.friendRequests.length;
  db.friendRequests = db.friendRequests.filter((r) => !isBetween(r, userId, friendId));

  cleanupLiveAfterUnfriend(userId, friendId);

  if (db.friendships.length !== beforeFriendships || db.friendRequests.length !== beforeRequests) {
    await save();
  }
  return { ok: true };
}

function listFriends(userId) {
  if (!userId) return [];
  return db.friendships
    .filter((f) => f.userA === userId || f.userB === userId)
    .map((f) => (f.userA === userId ? f.userB : f.userA))
    .map((id) => publicUser(findById(id)))
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name));
}

function listIncomingRequests(userId) {
  if (!userId) return [];
  return db.friendRequests
    .filter((r) => r.toId === userId && r.status === 'pending' && !isBlocked(userId, r.fromId))
    .map((r) => {
      const from = publicUser(findById(r.fromId));
      return from ? { id: r.id, from, createdAt: r.createdAt } : null;
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// check-ins (persisted — a deliberate public act — with a 4 hour life)
// ---------------------------------------------------------------------------

async function createCheckIn(userId, { placeId, placeName, note } = {}) {
  if (!findById(userId)) throw httpError('Account not found.', 404);

  const cleanPlaceId = text(placeId, 200);
  const cleanName = text(placeName, 120);
  const cleanNote = text(note, 280, { multiline: true });
  if (!cleanPlaceId) throw httpError('A place is required to check in.', 400);
  if (!cleanName) throw httpError('A place name is required to check in.', 400);

  const now = Date.now();
  // One check-in per place per user at a time: re-checking in refreshes it.
  db.checkIns = db.checkIns.filter(
    (c) => c.expiresAt >= now && !(c.userId === userId && c.placeId === cleanPlaceId),
  );

  const checkIn = {
    id: crypto.randomUUID(),
    userId,
    placeId: cleanPlaceId,
    placeName: cleanName,
    note: cleanNote,
    createdAt: new Date(now).toISOString(),
    expiresAt: now + CHECKIN_TTL_MS,
  };
  db.checkIns.push(checkIn);
  await save();
  return decorateCheckIn(checkIn, userId);
}

function decorateCheckIn(c, viewerId) {
  const author = publicUser(findById(c.userId));
  return {
    id: c.id,
    placeId: c.placeId,
    placeName: c.placeName,
    note: c.note,
    createdAt: c.createdAt,
    expiresAt: c.expiresAt,
    mine: c.userId === viewerId,
    user: author ? { id: author.id, name: author.name } : { id: c.userId, name: 'Someone' },
  };
}

/** Non-expired check-ins from confirmed friends (plus the viewer's own), newest first. */
function listFriendCheckIns(userId) {
  if (!userId) return [];
  const now = Date.now();
  const friendIds = new Set(
    db.friendships
      .filter((f) => f.userA === userId || f.userB === userId)
      .map((f) => (f.userA === userId ? f.userB : f.userA)),
  );

  return db.checkIns
    .filter((c) => c.expiresAt >= now)
    .filter((c) => c.userId === userId || (friendIds.has(c.userId) && !isBlocked(userId, c.userId)))
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .slice(0, 200)
    .map((c) => decorateCheckIn(c, userId));
}

// ---------------------------------------------------------------------------
// live location — IN MEMORY ONLY, never persisted
// ---------------------------------------------------------------------------

/** userId -> { lat, lng, updatedAt, expiresAt } */
const LIVE = new Map();

function liveEntry(userId) {
  const entry = LIVE.get(userId);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    LIVE.delete(userId);
    return null;
  }
  return entry;
}

function sweepLive() {
  const now = Date.now();
  for (const [id, entry] of LIVE) {
    if (entry.expiresAt <= now) LIVE.delete(id);
  }
}

setInterval(sweepLive, LIVE_SWEEP_INTERVAL_MS).unref();

/**
 * Once the pair is no longer friends neither can see the other's live pin
 * (friendLiveLocations is friendship-scoped). If a user has no friends left at
 * all, their entry is pointless — drop it.
 */
function cleanupLiveAfterUnfriend(a, b) {
  for (const id of [a, b]) {
    if (!LIVE.has(id)) continue;
    const stillHasFriends = db.friendships.some((f) => f.userA === id || f.userB === id);
    if (!stillHasFriends) LIVE.delete(id);
  }
}

function startLiveShare(userId, durationMs) {
  if (!findById(userId)) throw httpError('Account not found.', 404);
  const duration = Number(durationMs);
  if (!LIVE_DURATIONS.includes(duration)) {
    throw httpError('Choose a sharing window of 15 minutes, 1 hour, or 8 hours.', 400);
  }
  const now = Date.now();
  const existing = liveEntry(userId);
  LIVE.set(userId, {
    lat: existing ? existing.lat : null,
    lng: existing ? existing.lng : null,
    updatedAt: existing ? existing.updatedAt : null,
    expiresAt: now + duration,
  });
  return activeShareStatus(userId);
}

function stopLiveShare(userId) {
  LIVE.delete(userId);
  return { active: false, expiresAt: null, remainingMs: 0, lat: null, lng: null, updatedAt: null };
}

function updateLiveLocation(userId, lat, lng) {
  const entry = liveEntry(userId);
  if (!entry) throw httpError('Live sharing is not active. Start sharing first.', 409);

  const latNum = num(lat);
  const lngNum = num(lng);
  if (latNum === null || lngNum === null) throw httpError('A valid latitude and longitude are required.', 400);
  if (latNum < -90 || latNum > 90) throw httpError('Latitude is out of range.', 400);
  if (lngNum < -180 || lngNum > 180) throw httpError('Longitude is out of range.', 400);

  entry.lat = roundTo(latNum, LIVE_PRECISION);
  entry.lng = roundTo(lngNum, LIVE_PRECISION);
  entry.updatedAt = nowIso();
  return activeShareStatus(userId);
}

function activeShareStatus(userId) {
  const entry = liveEntry(userId);
  if (!entry) {
    return { active: false, expiresAt: null, remainingMs: 0, lat: null, lng: null, updatedAt: null };
  }
  return {
    active: true,
    expiresAt: entry.expiresAt,
    remainingMs: Math.max(0, entry.expiresAt - Date.now()),
    lat: entry.lat,
    lng: entry.lng,
    updatedAt: entry.updatedAt,
  };
}

/** Live pins of confirmed friends who are currently sharing and not expired. */
function friendLiveLocations(userId) {
  if (!userId) return [];
  const now = Date.now();
  return listFriends(userId)
    .map((friend) => {
      if (isBlocked(userId, friend.id)) return null;
      const entry = LIVE.get(friend.id);
      if (!entry || entry.expiresAt <= now) return null;
      if (entry.lat === null || entry.lng === null) return null; // sharing on, no fix yet
      return {
        id: friend.id,
        name: friend.name,
        lat: entry.lat,
        lng: entry.lng,
        updatedAt: entry.updatedAt,
        expiresAt: entry.expiresAt,
      };
    })
    .filter(Boolean);
}

// ---------------------------------------------------------------------------
// saved places
// ---------------------------------------------------------------------------

async function savePlace(userId, { placeId, name, category } = {}) {
  if (!findById(userId)) throw httpError('Account not found.', 404);

  const cleanPlaceId = text(placeId, 200);
  const cleanName = text(name, 120);
  const cleanCategory = normalizeCategory(category);
  if (!cleanPlaceId) throw httpError('A place is required.', 400);
  if (!cleanName) throw httpError('A place name is required.', 400);

  if (db.savedPlaces.some((p) => p.userId === userId && p.placeId === cleanPlaceId)) {
    throw httpError('That place is already saved.', 409);
  }
  const count = db.savedPlaces.reduce((n, p) => (p.userId === userId ? n + 1 : n), 0);
  if (count >= MAX_SAVED_PER_USER) {
    throw httpError(`You can save up to ${MAX_SAVED_PER_USER} places. Remove one first.`, 409);
  }

  const saved = {
    id: crypto.randomUUID(),
    userId,
    placeId: cleanPlaceId,
    name: cleanName,
    category: cleanCategory,
    createdAt: nowIso(),
  };
  db.savedPlaces.push(saved);
  await save();
  return publicSaved(saved);
}

async function unsavePlace(userId, id) {
  if (!userId || !id) return { ok: true };
  const before = db.savedPlaces.length;
  db.savedPlaces = db.savedPlaces.filter(
    (p) => !(p.userId === userId && (p.id === id || p.placeId === id)),
  );
  if (db.savedPlaces.length !== before) await save();
  return { ok: true };
}

function publicSaved(p) {
  return {
    id: p.id,
    placeId: p.placeId,
    name: p.name,
    category: p.category,
    createdAt: p.createdAt,
  };
}

function listSaved(userId) {
  if (!userId) return [];
  return db.savedPlaces
    .filter((p) => p.userId === userId)
    .sort((a, b) => (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0))
    .map(publicSaved);
}

// ---------------------------------------------------------------------------
// API usage / daily cost caps  (SYNC — callers use these inside `if`)
// ---------------------------------------------------------------------------

function usageState() {
  if (!isObj(db.apiUsage)) db.apiUsage = emptyUsage();
  const today = todayKey();
  const current = db.apiUsage;
  const malformed = typeof current.date !== 'string'
    || !/^\d{4}-\d{2}-\d{2}$/.test(current.date)
    || USAGE_KINDS.some((k) => !Number.isFinite(Number(current[k])));

  if (malformed || current.date !== today) {
    db.apiUsage = emptyUsage();
    save().catch(() => {});
  }
  return db.apiUsage;
}

function capOf(cap) {
  const n = Number(cap);
  if (!Number.isFinite(n) || n <= 0) return 0;
  return Math.floor(n);
}

function usageRemaining(kind, cap) {
  const usage = usageState();
  if (!USAGE_KINDS.includes(kind)) return 0;
  return Math.max(0, capOf(cap) - (Number(usage[kind]) || 0));
}

function tryConsume(kind, cap) {
  const usage = usageState();
  if (!USAGE_KINDS.includes(kind)) return false;
  const limit = capOf(cap);
  const used = Number(usage[kind]) || 0;
  if (used >= limit) return false;
  usage[kind] = used + 1;
  save().catch(() => {});
  return true;
}

/** Give a unit back when an upstream call failed and never cost anything. */
function refund(kind) {
  const usage = usageState();
  if (!USAGE_KINDS.includes(kind)) return 0;
  const used = Number(usage[kind]) || 0;
  usage[kind] = Math.max(0, used - 1);
  save().catch(() => {});
  return usage[kind];
}

// ---------------------------------------------------------------------------

module.exports = {
  FILE,
  CATEGORY_KEYS,
  LIVE_DURATIONS,
  CHECKIN_TTL_MS,

  // users + auth
  createUser, findByEmail, findById, publicUser, verifyPassword, ensureAccount,
  createVerificationToken, consumeVerificationToken,
  createSession, userForToken, destroySession, pruneSessions,

  // friends
  sendFriendRequest, respondToRequest, removeFriend,
  listFriends, listIncomingRequests, areFriends,
  blockUser, unblockUser, isBlocked, listBlocked, reportUser,

  // check-ins
  createCheckIn, listFriendCheckIns,

  // live location (memory only)
  startLiveShare, stopLiveShare, updateLiveLocation, friendLiveLocations, activeShareStatus,

  // saved places
  savePlace, unsavePlace, listSaved,

  // quota
  tryConsume, refund, usageRemaining,
};
