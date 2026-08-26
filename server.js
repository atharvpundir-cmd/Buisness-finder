'use strict';

/**
 * businessfind — single-file HTTP server (Node built-ins only).
 *
 * Responsibilities:
 *   - static file serving out of public/
 *   - server-side Google Places (New) proxy with hard daily budget caps
 *   - session auth + friends / check-ins / live sharing / saved places (delegated to data/store.js)
 *   - server-rendered SEO landing pages, sitemap.xml and robots.txt
 *
 * The Google Places SERVER key never leaves this process. The browser key is only
 * handed out when a map is actually enabled.
 */

const http = require('http');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const store = require('./data/store');

// SEO content is authored by another module; a broken/missing file must not stop the server.
let seoPages = {};
try {
  const seo = require('./seo-content');
  if (seo && seo.seoPages && typeof seo.seoPages === 'object') seoPages = seo.seoPages;
} catch (err) {
  console.error('[seo] seo-content.js unavailable — landing pages disabled:', err.message);
}

// ---------------------------------------------------------------------------
// env loading (no dependency, mirrors a plain KEY=VALUE .env file)
// ---------------------------------------------------------------------------

function loadEnvFile() {
  const file = path.join(__dirname, '.env');
  let raw;
  try {
    raw = fs.readFileSync(file, 'utf8');
  } catch {
    return; // no .env at all is a fully supported configuration
  }
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!key) continue;
    if (!Object.prototype.hasOwnProperty.call(process.env, key)) process.env[key] = value;
  }
}
loadEnvFile();

/** Number parser that accepts 0 (0 means "endpoint disabled", never "use the default"). */
const num = (v, d) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : d;
};

const PORT = num(process.env.PORT, 4321) || 4321;
const BROWSER_KEY = (process.env.GOOGLE_MAPS_BROWSER_KEY || '').trim();
const SERVER_KEY = (process.env.GOOGLE_PLACES_SERVER_KEY || '').trim();
const LIVE = Boolean(SERVER_KEY);
// Maps JavaScript is independent from Places search. A browser-restricted Maps
// key should still show the map when the server-side Places key is absent.
const MAP_ENABLED = Boolean(BROWSER_KEY);

const NEARBY_CAP = num(process.env.NEARBY_DAILY_CAP, 30);
const PLACE_CAP = num(process.env.PLACE_DETAILS_DAILY_CAP, 30);
const GEOCODE_CAP = num(process.env.GEOCODE_DAILY_CAP, 200);
const PHOTO_CAP = num(process.env.PHOTO_DAILY_CAP, 300);

const SITE_ORIGIN = String(process.env.SITE_ORIGIN || `http://localhost:${PORT}`).replace(/\/+$/, '');

const PUBLIC_DIR = path.join(__dirname, 'public');
const SESSION_COOKIE = 'bf_session';
const COOKIE_SECURE = process.env.COOKIE_SECURE === '1';
const MAX_BODY_BYTES = 8 * 1024;
const UPSTREAM_TIMEOUT_MS = 8000;
const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

const CATEGORY_TYPES = {
  all: null,
  restaurants: 'restaurant',
  cafes: 'cafe',
  groceries: 'supermarket',
  malls: 'shopping_mall',
  clothing: 'clothing_store',
  pharmacies: 'pharmacy',
  gyms: 'gym',
  salons: 'beauty_salon',
  atms: 'atm',
  petrol: 'gas_station',
  bakeries: 'bakery',
  bars: 'bar',
};
const CATEGORY_KEYS = Object.keys(CATEGORY_TYPES);

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

/**
 * Builds an error whose message is already safe to show a caller. Anything thrown
 * without `expose` is treated as an internal fault and answered generically.
 */
function httpError(status, message) {
  const err = new Error(message);
  err.status = status;
  err.expose = true;
  return err;
}

/** Marks an error as "not the caller's fault" so the daily budget is refunded. */
function upstreamError(status, message) {
  const err = httpError(status, message);
  err.refund = true;
  return err;
}

function esc(value) {
  return String(value === null || value === undefined ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sendJson(res, status, data) {
  if (res.headersSent) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

function sendHtml(res, status, html) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': status === 200 ? 'public, max-age=300' : 'no-store',
  });
  res.end(html);
}

function sendText(res, status, text, contentType) {
  if (res.headersSent) return;
  res.writeHead(status, {
    'content-type': contentType || 'text/plain; charset=utf-8',
    'content-length': Buffer.byteLength(text),
  });
  res.end(text);
}

function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    if (!key) continue;
    let value = part.slice(eq + 1).trim();
    try { value = decodeURIComponent(value); } catch { /* keep raw */ }
    out[key] = value;
  }
  return out;
}

function setSessionCookie(res, token, maxAge) {
  const parts = [`${SESSION_COOKIE}=${encodeURIComponent(token)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.max(0, Number(maxAge) || 0)}`];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function clearSessionCookie(res) {
  const parts = [`${SESSION_COOKIE}=`, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=0'];
  if (COOKIE_SECURE) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, 'Request body is too large.');
    chunks.push(chunk);
  }
  if (chunks.length === 0) return {};
  let parsed;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw httpError(400, 'Malformed JSON body.');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw httpError(400, 'JSON body must be an object.');
  return parsed;
}

function requireJsonContentType(req) {
  if (!String(req.headers['content-type'] || '').includes('application/json')) {
    throw httpError(415, 'Content-Type must be application/json.');
  }
}

function clientIp(req) {
  return req.socket.remoteAddress || 'unknown';
}

function str(value, max) {
  return String(value === null || value === undefined ? '' : value).trim().slice(0, max || 200);
}

/**
 * Resolves a store function by any of its accepted names. data/store.js is owned by
 * another module; tolerating a couple of naming variants keeps a rename from turning
 * into a 500 storm, and a genuinely missing capability reports a clean 501.
 */
function S(label, ...names) {
  for (const name of names) {
    const fn = store[name];
    if (typeof fn === 'function') return fn.bind(store);
  }
  throw httpError(501, `${label} is not available on this server.`);
}

/** Same as S(), but returns null instead of throwing (for optional read paths). */
function Sopt(...names) {
  for (const name of names) {
    const fn = store[name];
    if (typeof fn === 'function') return fn.bind(store);
  }
  return null;
}

// ---------------------------------------------------------------------------
// sessions / users
// ---------------------------------------------------------------------------

async function currentUser(req) {
  const cookies = parseCookies(req);
  const token = cookies[SESSION_COOKIE];
  if (!token) return null;
  try {
    return (await S('Sessions', 'userForToken', 'userForSession')(token)) || null;
  } catch (err) {
    if (err.status === 501) throw err;
    return null;
  }
}

async function requireUser(req) {
  const user = await currentUser(req);
  if (!user) throw httpError(401, 'Sign in required.');
  return user;
}

function isVerified(user) {
  if (!user) return false;
  return user.emailVerified === true || user.verified === true || user.emailVerified === 1;
}

async function requireVerifiedUser(req) {
  const user = await requireUser(req);
  if (!isVerified(user)) throw httpError(403, 'Verify your email address to use this feature.');
  return user;
}

function publicUser(user) {
  const fn = Sopt('publicUser', 'toPublicUser');
  if (!user) return null;
  return fn ? fn(user) : { id: user.id, name: user.name, email: user.email, emailVerified: isVerified(user) };
}

// ---------------------------------------------------------------------------
// per-IP rate limiting (in addition to the daily global caps)
// ---------------------------------------------------------------------------

const ipHits = new Map(); // "bucket|ip" -> [timestamps]
const MAX_RATE_WINDOW_MS = 60 * 60 * 1000;

function tooManyRequests(bucket, ip, limit, windowMs) {
  const key = `${bucket}|${ip}`;
  const now = Date.now();
  const hits = (ipHits.get(key) || []).filter((t) => now - t < windowMs);
  hits.push(now);
  ipHits.set(key, hits);
  return hits.length > limit;
}

setInterval(() => {
  const now = Date.now();
  for (const [key, hits] of ipHits) {
    const fresh = hits.filter((t) => now - t < MAX_RATE_WINDOW_MS);
    if (fresh.length === 0) ipHits.delete(key);
    else ipHits.set(key, fresh);
  }
}, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// login attempt throttling
// ---------------------------------------------------------------------------

const loginAttempts = new Map();
const ATTEMPT_LIMIT = 8;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;

function attemptKey(req, email) {
  return `${clientIp(req)}:${String(email || '').toLowerCase()}`;
}
function tooManyAttempts(key) {
  const entry = loginAttempts.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > ATTEMPT_WINDOW_MS) { loginAttempts.delete(key); return false; }
  return entry.count >= ATTEMPT_LIMIT;
}
function noteFailure(key) {
  const entry = loginAttempts.get(key) || { count: 0, first: Date.now() };
  entry.count += 1;
  loginAttempts.set(key, entry);
}
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of loginAttempts) {
    if (now - entry.first > ATTEMPT_WINDOW_MS) loginAttempts.delete(key);
  }
}, 5 * 60 * 1000).unref();

// ---------------------------------------------------------------------------
// daily budget accounting
// ---------------------------------------------------------------------------

const CAPS = { nearby: NEARBY_CAP, place: PLACE_CAP, geocode: GEOCODE_CAP, photo: PHOTO_CAP };

function quotaRemaining(kind) {
  const cap = CAPS[kind] || 0;
  if (cap <= 0) return 0;
  const rem = Sopt('quotaRemaining', 'remaining');
  if (rem) {
    const n = Number(rem(kind, cap));
    if (Number.isFinite(n)) return Math.max(0, Math.min(cap, n));
  }
  const used = Sopt('quotaUsed', 'usage', 'used');
  if (used) {
    const n = Number(used(kind));
    if (Number.isFinite(n)) return Math.max(0, cap - n);
  }
  return cap;
}

function consumeBudget(kind, friendlyName) {
  const cap = CAPS[kind] || 0;
  if (cap <= 0) throw httpError(503, `${friendlyName} is switched off on this server (daily cap is 0).`);
  const tryConsume = Sopt('tryConsume', 'consume');
  if (!tryConsume) return; // no accounting available — fail open rather than fail closed
  let ok = true;
  try {
    ok = tryConsume(kind, cap) !== false;
  } catch (err) {
    console.error('[budget] tryConsume failed for', kind, err);
    return;
  }
  if (!ok) throw httpError(429, `We've hit today's ${friendlyName.toLowerCase()} limit — please try again tomorrow.`);
}

function refundBudget(kind) {
  const refund = Sopt('refund', 'release', 'giveBack');
  if (!refund) return;
  try { refund(kind, 1); } catch (err) { console.error('[budget] refund failed for', kind, err); }
}

/** Consume one unit of `kind`, run fn(), and hand the unit back if the failure was ours-or-Google's. */
async function withBudget(kind, friendlyName, fn) {
  consumeBudget(kind, friendlyName);
  try {
    return await fn();
  } catch (err) {
    if (err && err.refund) refundBudget(kind);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// outbound fetch with a hard timeout
// ---------------------------------------------------------------------------

async function fetchUpstream(url, options) {
  try {
    return await fetch(url, { ...(options || {}), signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
  } catch (err) {
    const name = err && err.name;
    if (name === 'AbortError' || name === 'TimeoutError') {
      console.error('[upstream] timeout after', UPSTREAM_TIMEOUT_MS, 'ms:', String(url).split('?')[0]);
      throw upstreamError(504, 'The search provider took too long to respond. Please try again.');
    }
    console.error('[upstream] network failure:', err && err.message);
    throw upstreamError(502, 'Could not reach the search provider. Please try again.');
  }
}

/**
 * Turns an upstream non-2xx into a client-safe error. Google's response body is
 * logged, never relayed. 5xx / 401 / 403 refund the budget; caller-caused 4xx do not.
 */
async function upstreamFailure(res, label) {
  const body = await res.text().catch(() => '');
  console.error(`[upstream] ${label} responded ${res.status}: ${body.slice(0, 500)}`);
  if (res.status >= 500) throw upstreamError(502, 'The search provider is having trouble right now. Please try again shortly.');
  if (res.status === 401 || res.status === 403) throw upstreamError(502, 'Live search is misconfigured on this server.');
  // Places (New) reports a revoked/invalid/unauthorised key as a 400, not a 401.
  // That is an operator fault, not the caller's, so it must not burn the budget.
  if (res.status === 400 && /API_KEY|PERMISSION_DENIED|not authorized/i.test(body)) {
    throw upstreamError(502, 'Live search is misconfigured on this server.');
  }
  if (res.status === 429) throw httpError(429, 'The search provider is rate-limiting us right now. Please try again shortly.');
  if (res.status === 404) throw httpError(404, 'That place could not be found.');
  throw httpError(400, 'The search provider rejected that request.');
}

// ---------------------------------------------------------------------------
// Google Places (New) proxy
// ---------------------------------------------------------------------------

const PLACE_ID_RE = /^[A-Za-z0-9_-]{4,256}$/;
const PHOTO_NAME_RE = /^places\/[A-Za-z0-9_-]+\/photos\/[A-Za-z0-9_-]+$/;

function requireLive() {
  if (!LIVE) throw httpError(503, 'Live results are unavailable: this server has no Google Places key configured.');
}

function parseLatLng(params) {
  const lat = Number(params.lat);
  const lng = Number(params.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw httpError(400, 'lat and lng are required.');
  if (lat < -90 || lat > 90) throw httpError(400, 'lat must be between -90 and 90.');
  if (lng < -180 || lng > 180) throw httpError(400, 'lng must be between -180 and 180.');
  return { lat, lng };
}

function parseRadius(raw) {
  if (raw === undefined || raw === null || raw === '') return 5000;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) throw httpError(400, 'radius must be a positive number of metres.');
  return Math.min(Math.max(Math.round(n), 1), 50000);
}

function mapPlace(p) {
  const hours = p.regularOpeningHours || {};
  return {
    id: p.id || null,
    name: (p.displayName && p.displayName.text) || 'Unnamed place',
    lat: p.location ? p.location.latitude : null,
    lng: p.location ? p.location.longitude : null,
    rating: p.rating ?? null,
    ratingCount: p.userRatingCount ?? null,
    priceLevel: p.priceLevel ?? null,
    businessStatus: p.businessStatus ?? null,
    openNow: typeof hours.openNow === 'boolean' ? hours.openNow : null,
  };
}

async function placesNearby({ lat, lng, radius, includedType }) {
  const res = await fetchUpstream('https://places.googleapis.com/v1/places:searchNearby', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'X-Goog-Api-Key': SERVER_KEY,
      'X-Goog-FieldMask': [
        'places.id',
        'places.displayName',
        'places.location',
        'places.rating',
        'places.userRatingCount',
        'places.priceLevel',
        'places.businessStatus',
        'places.regularOpeningHours',
      ].join(','),
    },
    body: JSON.stringify({
      ...(includedType ? { includedTypes: [includedType] } : {}),
      maxResultCount: 20,
      rankPreference: 'POPULARITY',
      locationRestriction: { circle: { center: { latitude: lat, longitude: lng }, radius } },
    }),
  });
  if (!res.ok) await upstreamFailure(res, 'places:searchNearby');
  let json;
  try { json = await res.json(); } catch { throw upstreamError(502, 'The search provider returned an unreadable response.'); }
  return (Array.isArray(json.places) ? json.places : []).map(mapPlace);
}

async function placeDetails(placeId) {
  const res = await fetchUpstream(`https://places.googleapis.com/v1/places/${encodeURIComponent(placeId)}`, {
    headers: {
      'X-Goog-Api-Key': SERVER_KEY,
      'X-Goog-FieldMask': [
        'id', 'displayName', 'formattedAddress', 'location', 'rating', 'userRatingCount',
        'reviews', 'regularOpeningHours', 'nationalPhoneNumber', 'internationalPhoneNumber',
        'websiteUri', 'photos', 'priceLevel', 'businessStatus', 'googleMapsUri',
      ].join(','),
    },
  });
  if (!res.ok) await upstreamFailure(res, 'places.get');
  let p;
  try { p = await res.json(); } catch { throw upstreamError(502, 'The search provider returned an unreadable response.'); }
  const hours = p.regularOpeningHours || {};
  return {
    ...mapPlace(p),
    address: p.formattedAddress || null,
    phone: p.nationalPhoneNumber || p.internationalPhoneNumber || null,
    website: p.websiteUri || null,
    mapsUri: p.googleMapsUri || null,
    openNow: hours.openNow ?? null,
    weekdayHours: Array.isArray(hours.weekdayDescriptions) ? hours.weekdayDescriptions : [],
    photos: (Array.isArray(p.photos) ? p.photos : []).slice(0, 8).map((ph) => ph && ph.name).filter(Boolean),
    reviews: (Array.isArray(p.reviews) ? p.reviews : []).slice(0, 8).map((r) => ({
      author: (r.authorAttribution && r.authorAttribution.displayName) || 'Google user',
      authorPhoto: (r.authorAttribution && r.authorAttribution.photoUri) || null,
      profileUri: (r.authorAttribution && r.authorAttribution.uri) || null,
      rating: r.rating ?? null,
      text: (r.text && r.text.text) || (r.originalText && r.originalText.text) || '',
      relativeTime: r.relativePublishTimeDescription || '',
    })),
  };
}

async function geocode(query) {
  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('key', SERVER_KEY);

  const res = await fetchUpstream(url);
  if (!res.ok) await upstreamFailure(res, 'geocode');
  let json;
  try { json = await res.json(); } catch { throw upstreamError(502, 'The location service returned an unreadable response.'); }

  const status = json && json.status;
  if (status === 'ZERO_RESULTS') throw httpError(404, 'Could not find that location.');
  if (status === 'OVER_QUERY_LIMIT') {
    console.error('[upstream] geocode OVER_QUERY_LIMIT:', String(json.error_message || '').slice(0, 300));
    throw upstreamError(502, 'The location service is over its quota right now.');
  }
  if (status !== 'OK') {
    console.error('[upstream] geocode status', status, String((json && json.error_message) || '').slice(0, 300));
    throw upstreamError(502, 'The location service is having trouble right now. Please try again shortly.');
  }

  const first = Array.isArray(json.results) ? json.results[0] : null;
  const loc = first && first.geometry && first.geometry.location;
  if (!loc || !Number.isFinite(Number(loc.lat)) || !Number.isFinite(Number(loc.lng))) {
    throw httpError(404, 'Could not find that location.');
  }
  return { lat: Number(loc.lat), lng: Number(loc.lng), formattedAddress: first.formatted_address || query };
}

// ---------------------------------------------------------------------------
// /api/photo — server-side photo proxy
// ---------------------------------------------------------------------------

async function handlePhoto(req, res, url) {
  if (req.method !== 'GET') throw httpError(405, 'Method not allowed.');
  requireLive();

  const name = String(url.searchParams.get('name') || '').trim();
  if (!PHOTO_NAME_RE.test(name)) throw httpError(400, 'A valid photo name is required.');

  const requested = Number(url.searchParams.get('maxWidth'));
  const maxWidth = Number.isFinite(requested) && requested > 0 ? Math.min(Math.round(requested), 1600) : 800;

  const bytes = await withBudget('photo', 'Photo', async () => {
    const target = new URL(`https://places.googleapis.com/v1/${name}/media`);
    target.searchParams.set('maxWidthPx', String(maxWidth));
    target.searchParams.set('key', SERVER_KEY);

    const upstream = await fetchUpstream(target);
    if (!upstream.ok) await upstreamFailure(upstream, 'places.photos.media');

    const declared = Number(upstream.headers.get('content-length'));
    if (Number.isFinite(declared) && declared > MAX_PHOTO_BYTES) throw httpError(502, 'That photo is too large to proxy.');

    const buf = Buffer.from(await upstream.arrayBuffer());
    if (buf.length > MAX_PHOTO_BYTES) throw httpError(502, 'That photo is too large to proxy.');

    const type = String(upstream.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    return { buf, type: /^image\/[a-z0-9.+-]+$/i.test(type) ? type : 'image/jpeg' };
  });

  if (res.headersSent) return;
  res.writeHead(200, {
    'content-type': bytes.type,
    'content-length': bytes.buf.length,
    'cache-control': 'public, max-age=86400, immutable',
  });
  res.end(bytes.buf);
}

// ---------------------------------------------------------------------------
// generic GET /api/* route table
// ---------------------------------------------------------------------------

const routes = {
  async config() {
    return {
      live: LIVE,
      mapEnabled: MAP_ENABLED,
      mapsBrowserKey: MAP_ENABLED ? BROWSER_KEY : null,
      categories: CATEGORY_KEYS,
      quota: {
        nearby: quotaRemaining('nearby'),
        place: quotaRemaining('place'),
        geocode: quotaRemaining('geocode'),
        photo: quotaRemaining('photo'),
      },
    };
  },

  async nearby(params) {
    requireLive();
    // Validate everything BEFORE any budget is consumed.
    const { lat, lng } = parseLatLng(params);
    const radius = parseRadius(params.radius);
    const category = String(params.category || '');
    if (!Object.prototype.hasOwnProperty.call(CATEGORY_TYPES, category)) {
      throw httpError(400, 'Unknown category.');
    }
    const includedType = CATEGORY_TYPES[category];
    const places = await withBudget('nearby', 'Search', () => placesNearby({ lat, lng, radius, includedType }));
    return { places };
  },

  async place(params) {
    requireLive();
    let id = String(params.id || '').trim();
    if (id.startsWith('places/')) id = id.slice('places/'.length);
    if (!PLACE_ID_RE.test(id)) throw httpError(400, 'A valid place id is required.');
    const place = await withBudget('place', 'Place details', () => placeDetails(id));
    return { place };
  },

  async geocode(params) {
    requireLive();
    const q = String(params.q || '').trim();
    if (!q) throw httpError(400, 'q is required.');
    if (q.length > 200) throw httpError(400, 'That search is too long (200 characters max).');
    return await withBudget('geocode', 'Location lookup', () => geocode(q));
  },
};

// ---------------------------------------------------------------------------
// /api/auth/*
// ---------------------------------------------------------------------------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateSignup(body) {
  if (str(body.name, 80).length < 1) return 'Name is required.';
  if (!EMAIL_RE.test(str(body.email, 254))) return 'A valid email is required.';
  if (typeof body.password !== 'string' || body.password.length < 8) return 'Password must be at least 8 characters.';
  if (body.password.length > 200) return 'Password must be 200 characters or fewer.';
  return null;
}

async function handleAuth(req, res, url) {
  const action = url.pathname.slice('/api/auth/'.length).replace(/\/+$/, '');
  const cookies = parseCookies(req);

  if (action === 'me') {
    if (req.method !== 'GET') throw httpError(405, 'Method not allowed.');
    sendJson(res, 200, { user: publicUser(await currentUser(req)) });
    return;
  }

  if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');

  if (action === 'logout') {
    const destroy = Sopt('destroySession', 'deleteSession', 'endSession');
    if (destroy && cookies[SESSION_COOKIE]) await destroy(cookies[SESSION_COOKIE]);
    clearSessionCookie(res);
    sendJson(res, 200, { ok: true });
    return;
  }

  requireJsonContentType(req);
  const body = await readJsonBody(req);

  if (action === 'signup') {
    if (tooManyRequests('signup', clientIp(req), 3, 60 * 60 * 1000)) {
      throw httpError(429, 'Too many accounts created from this device. Try again later.');
    }
    const problem = validateSignup(body);
    if (problem) throw httpError(400, problem);

    const email = str(body.email, 254).toLowerCase();
    const existing = await S('Accounts', 'findByEmail', 'userByEmail')(email);
    if (existing) throw httpError(409, 'An account with that email already exists.');

    const user = await S('Accounts', 'createUser', 'addUser')({
      name: str(body.name, 80),
      email,
      password: String(body.password),
    });
    const session = await S('Sessions', 'createSession', 'startSession')(user.id);
    setSessionCookie(res, session.token, session.maxAge);
    sendJson(res, 201, { user: publicUser(user) });
    return;
  }

  if (action === 'login') {
    const key = attemptKey(req, body.email);
    if (tooManyAttempts(key)) throw httpError(429, 'Too many attempts. Try again later.');

    const email = str(body.email, 254).toLowerCase();
    const user = email ? await S('Accounts', 'findByEmail', 'userByEmail')(email) : null;
    const verify = S('Accounts', 'verifyPassword', 'checkPassword');
    // verifyPassword is async (scrypt on the threadpool) — without await this
    // is a Promise, which is always truthy, and every password succeeds.
    const ok = Boolean(user) && (await verify(String(body.password || ''), user.password, user));
    if (!ok) {
      noteFailure(key);
      throw httpError(401, 'Email or password is incorrect.');
    }
    loginAttempts.delete(key);
    const session = await S('Sessions', 'createSession', 'startSession')(user.id);
    setSessionCookie(res, session.token, session.maxAge);
    sendJson(res, 200, { user: publicUser(user) });
    return;
  }

  if (action === 'verify') {
    const token = str(body.token || body.code, 200);
    if (!token) throw httpError(400, 'A verification token is required.');
    const verified = await S('Email verification', 'verifyEmail', 'confirmEmail', 'verifyEmailToken')(token);
    if (!verified) throw httpError(400, 'That verification link is invalid or has expired.');
    sendJson(res, 200, { user: publicUser(typeof verified === 'object' ? verified : await currentUser(req)) });
    return;
  }

  throw httpError(404, 'Unknown auth action.');
}

// ---------------------------------------------------------------------------
// /api/friends/* (login + verified email required)
// ---------------------------------------------------------------------------

async function handleFriends(req, res, url) {
  const user = await requireVerifiedUser(req);
  const action = url.pathname.slice('/api/friends'.length).replace(/^\/+/, '').replace(/\/+$/, '');

  if (req.method === 'GET') {
    if (action !== '') throw httpError(404, 'Unknown friends endpoint.');
    const listFriends = Sopt('listFriends', 'friends');
    const listIncoming = Sopt('listIncomingRequests', 'incomingRequests', 'listRequests');
    const listBlocked = Sopt('listBlocked', 'blockedUsers', 'blocked');
    sendJson(res, 200, {
      friends: listFriends ? await listFriends(user.id) : [],
      incoming: listIncoming ? await listIncoming(user.id) : [],
      blocked: listBlocked ? await listBlocked(user.id) : [],
    });
    return;
  }

  if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
  requireJsonContentType(req);
  const body = await readJsonBody(req);

  if (action === 'request') {
    const email = str(body.email, 254).toLowerCase();
    let targetId = str(body.userId || body.friendId, 100);
    if (!targetId) {
      if (!EMAIL_RE.test(email)) throw httpError(400, 'A valid email is required.');
      const target = await S('Accounts', 'findByEmail', 'userByEmail')(email);
      if (!target) throw httpError(404, 'No account with that email.');
      targetId = target.id;
    }
    if (targetId === user.id) throw httpError(400, 'You cannot add yourself.');
    await S('Friends', 'sendFriendRequest', 'requestFriend', 'addFriendRequest')(user.id, targetId);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === 'accept' || action === 'decline') {
    const requestId = str(body.requestId || body.id, 100);
    if (!requestId) throw httpError(400, 'requestId is required.');
    const respond = Sopt('respondToRequest', 'respondToFriendRequest');
    if (respond) await respond(requestId, user.id, action === 'accept');
    else await S('Friends', action === 'accept' ? 'acceptFriendRequest' : 'declineFriendRequest')(requestId, user.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === 'remove') {
    const friendId = str(body.friendId || body.userId, 100);
    if (!friendId) throw httpError(400, 'friendId is required.');
    await S('Friends', 'removeFriend', 'unfriend')(user.id, friendId);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === 'block') {
    const targetId = str(body.userId || body.friendId, 100);
    if (!targetId) throw httpError(400, 'userId is required.');
    await S('Friends', 'blockUser', 'block')(user.id, targetId);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === 'report') {
    const targetId = str(body.userId || body.friendId, 100);
    if (!targetId) throw httpError(400, 'userId is required.');
    await S('Friends', 'reportUser', 'report')(user.id, targetId, str(body.reason, 500));
    sendJson(res, 200, { ok: true });
    return;
  }

  throw httpError(404, 'Unknown friends action.');
}

// ---------------------------------------------------------------------------
// /api/checkins (login + verified email required)
// ---------------------------------------------------------------------------

async function handleCheckins(req, res, url) {
  const user = await requireVerifiedUser(req);

  if (req.method === 'GET') {
    const scope = str(url.searchParams.get('scope'), 20) || 'all';
    const list = Sopt('listCheckIns', 'listCheckins', 'checkIns');
    sendJson(res, 200, { checkIns: list ? await list(user.id, { scope }) : [] });
    return;
  }

  if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
  requireJsonContentType(req);
  const body = await readJsonBody(req);

  let placeId = str(body.placeId || body.id, 256);
  if (placeId.startsWith('places/')) placeId = placeId.slice('places/'.length);
  if (!PLACE_ID_RE.test(placeId)) throw httpError(400, 'A valid placeId is required.');

  const name = str(body.name || body.placeName, 160);
  if (!name) throw httpError(400, 'A place name is required.');

  const lat = body.lat === undefined || body.lat === '' ? null : Number(body.lat);
  const lng = body.lng === undefined || body.lng === '' ? null : Number(body.lng);
  if (lat !== null && (!Number.isFinite(lat) || lat < -90 || lat > 90)) throw httpError(400, 'lat is out of range.');
  if (lng !== null && (!Number.isFinite(lng) || lng < -180 || lng > 180)) throw httpError(400, 'lng is out of range.');

  const rating = body.rating === undefined || body.rating === null || body.rating === '' ? null : Number(body.rating);
  if (rating !== null && (!Number.isFinite(rating) || rating < 1 || rating > 5)) throw httpError(400, 'rating must be between 1 and 5.');

  const visibility = str(body.visibility, 20) || 'friends';
  if (!['friends', 'private', 'public'].includes(visibility)) throw httpError(400, 'Unknown visibility.');

  const checkIn = await S('Check-ins', 'createCheckIn', 'addCheckIn', 'checkIn')(user.id, {
    placeId, name, lat, lng, rating, visibility,
    category: Object.prototype.hasOwnProperty.call(CATEGORY_TYPES, str(body.category, 40)) ? str(body.category, 40) : null,
    note: str(body.note, 500),
  });
  sendJson(res, 201, { checkIn: checkIn || null });
}

// ---------------------------------------------------------------------------
// /api/live and /api/live/* (login + verified email required)
// ---------------------------------------------------------------------------

async function handleLive(req, res, url) {
  const user = await requireVerifiedUser(req);
  const action = url.pathname.slice('/api/live'.length).replace(/^\/+/, '').replace(/\/+$/, '');

  if (req.method === 'GET') {
    if (action !== '') throw httpError(404, 'Unknown live endpoint.');
    const locations = Sopt('friendLocations', 'liveLocations', 'listLiveLocations');
    const status = Sopt('liveStatus', 'myLiveStatus', 'shareStatus');
    sendJson(res, 200, {
      locations: locations ? await locations(user.id) : [],
      status: status ? await status(user.id) : { sharing: false, expiresAt: null },
    });
    return;
  }

  if (req.method !== 'POST') throw httpError(405, 'Method not allowed.');
  requireJsonContentType(req);
  const body = await readJsonBody(req);

  if (action === 'start') {
    const minutes = Number(body.minutes || body.ttlMinutes);
    const ttlMinutes = Number.isFinite(minutes) && minutes > 0 ? Math.min(Math.round(minutes), 24 * 60) : 60;
    await S('Live sharing', 'startLiveShare', 'startLive', 'startSharing')(user.id, { ttlMinutes });
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === 'stop') {
    await S('Live sharing', 'stopLiveShare', 'stopLive', 'stopSharing')(user.id);
    sendJson(res, 200, { ok: true });
    return;
  }

  if (action === 'update') {
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) throw httpError(400, 'lat and lng are required.');
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) throw httpError(400, 'lat/lng out of range.');
    const accuracy = Number(body.accuracy);
    await S('Live sharing', 'updateLiveLocation', 'updateLocation', 'updateLive')(user.id, lat, lng, Number.isFinite(accuracy) ? accuracy : null);
    sendJson(res, 200, { ok: true });
    return;
  }

  throw httpError(404, 'Unknown live action.');
}

// ---------------------------------------------------------------------------
// /api/saved (login required)
// ---------------------------------------------------------------------------

async function handleSaved(req, res, url) {
  const user = await requireUser(req);
  const list = () => {
    const fn = Sopt('listSaved', 'savedPlaces', 'listSavedPlaces');
    return fn ? fn(user.id) : [];
  };

  if (req.method === 'GET') {
    sendJson(res, 200, { saved: await list() });
    return;
  }

  if (req.method === 'POST') {
    requireJsonContentType(req);
    const body = await readJsonBody(req);
    let placeId = str(body.id || body.placeId, 256);
    if (placeId.startsWith('places/')) placeId = placeId.slice('places/'.length);
    if (!PLACE_ID_RE.test(placeId)) throw httpError(400, 'A valid place id is required.');
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    await S('Saved places', 'savePlace', 'addSaved')(user.id, {
      id: placeId,
      placeId,
      name: str(body.name, 160) || 'Saved place',
      lat: Number.isFinite(lat) ? lat : null,
      lng: Number.isFinite(lng) ? lng : null,
      category: Object.prototype.hasOwnProperty.call(CATEGORY_TYPES, str(body.category, 40)) ? str(body.category, 40) : null,
      rating: Number.isFinite(Number(body.rating)) ? Number(body.rating) : null,
      address: str(body.address, 300) || null,
    });
    sendJson(res, 201, { saved: await list() });
    return;
  }

  if (req.method === 'DELETE') {
    const id = str(url.searchParams.get('id'), 256);
    if (!id) throw httpError(400, 'id is required.');
    await S('Saved places', 'unsavePlace', 'removeSaved')(user.id, id);
    sendJson(res, 200, { saved: await list() });
    return;
  }

  throw httpError(405, 'Method not allowed.');
}

// ---------------------------------------------------------------------------
// static files
// ---------------------------------------------------------------------------

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.webmanifest': 'application/manifest+json',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.pdf': 'application/pdf',
};

function mimeFor(ext) {
  return Object.prototype.hasOwnProperty.call(MIME, ext) ? MIME[ext] : 'application/octet-stream';
}

/** Returns true when the request was served, false when there is no such file. */
async function serveStatic(req, res, pathname) {
  let decoded;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    throw httpError(400, 'Bad path.');
  }
  if (decoded.includes('\0') || decoded.includes('..')) throw httpError(400, 'Bad path.');

  const rel = decoded === '/' ? '/index.html' : decoded;
  const filePath = path.resolve(PUBLIC_DIR, '.' + rel);
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) throw httpError(400, 'Bad path.');

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  const isHtml = ext === '.html';
  const etag = `W/"${stat.size.toString(16)}-${stat.mtimeMs.toString(16)}"`;
  if (req.headers['if-none-match'] === etag) {
    res.writeHead(304, { etag });
    res.end();
    return true;
  }

  const data = await fsp.readFile(filePath);
  res.writeHead(200, {
    'content-type': mimeFor(ext),
    'content-length': data.length,
    // No build step means no content hashes in filenames, so /app.js and
    // /styles.css keep their URLs forever. A max-age here would strand
    // returning visitors on stale code until it expired. 'no-cache' still
    // caches — it just revalidates against the ETag above, so unchanged
    // files cost a 304 rather than a re-download.
    'cache-control': 'no-cache',
    etag,
  });
  if (req.method === 'HEAD') res.end();
  else res.end(data);
  return true;
}

// ---------------------------------------------------------------------------
// SEO landing pages + sitemap/robots
// ---------------------------------------------------------------------------

function jsonLdScript(data) {
  // Escaping "<" prevents a "</script>" inside any interpolated value from breaking out.
  return `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`;
}

function pageShell({ title, description, canonical, bodyHtml, jsonLd }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(canonical)}">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:url" content="${esc(canonical)}">
<meta name="twitter:card" content="summary_large_image">
<link rel="stylesheet" href="/styles.css">
${jsonLd ? jsonLdScript(jsonLd) : ''}
<script>
(function () {
  try {
    var t = localStorage.getItem('bf-theme');
    if (t && t !== 'system') document.documentElement.dataset.theme = t;
  } catch (e) {}
})();
</script>
</head>
<body>
${bodyHtml}
<script src="/app.js" type="module"></script>
</body>
</html>`;
}

const SLUG_RE = /^[a-z0-9-]+$/;

function seoPageFor(slug) {
  if (!slug || slug.length > 120 || !SLUG_RE.test(slug)) return null;
  if (!Object.prototype.hasOwnProperty.call(seoPages, slug)) return null;
  const page = seoPages[slug];
  return page && typeof page === 'object' ? page : null;
}

function handleSeoPage(res, slug) {
  const page = seoPageFor(slug);
  if (!page) return false;

  const canonical = `${SITE_ORIGIN}/${slug}`;
  const category = Object.prototype.hasOwnProperty.call(CATEGORY_TYPES, String(page.category || '')) ? String(page.category) : '';
  const faq = Array.isArray(page.faq) ? page.faq.filter((f) => f && f.q && f.a) : [];

  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'WebPage',
    name: String(page.title || 'businessfind'),
    description: String(page.description || ''),
    url: canonical,
  };
  if (faq.length) {
    jsonLd.mainEntity = {
      '@type': 'FAQPage',
      mainEntity: faq.map((f) => ({
        '@type': 'Question',
        name: String(f.q),
        acceptedAnswer: { '@type': 'Answer', text: String(f.a) },
      })),
    };
  }

  const html = pageShell({
    title: page.title || 'businessfind',
    description: page.description || '',
    canonical,
    jsonLd,
    bodyHtml: `
<header class="seo-header"><a href="/" class="brand">businessfind</a></header>
<main class="seo-main">
  <h1>${esc(page.h1 || page.title || 'businessfind')}</h1>
  <p class="lede">${esc(page.lede || page.description || '')}</p>
  <div id="app-embed" data-category="${esc(category)}"></div>
  ${page.body ? `<section class="seo-copy">${page.body}</section>` : ''}
  ${faq.length ? `<section class="seo-faq"><h2>Frequently asked</h2>${faq.map((f) => `<h3>${esc(f.q)}</h3><p>${esc(f.a)}</p>`).join('')}</section>` : ''}
  <p class="seo-back"><a href="/">Open the live map &rarr;</a></p>
</main>`,
  });
  sendHtml(res, 200, html);
  return true;
}

function notFoundPage(res) {
  const html = pageShell({
    title: 'Page not found — businessfind',
    description: 'That page does not exist on businessfind.',
    canonical: `${SITE_ORIGIN}/`,
    jsonLd: null,
    bodyHtml: `
<header class="seo-header"><a href="/" class="brand">businessfind</a></header>
<main class="seo-main">
  <h1>Page not found</h1>
  <p class="lede">We could not find that page.</p>
  <p class="seo-back"><a href="/">Back to the map &rarr;</a></p>
</main>`,
  });
  sendHtml(res, 404, html);
}

function sitemapXml() {
  const slugs = Object.keys(seoPages).filter((s) => SLUG_RE.test(s));
  const urls = ['/', ...slugs.map((s) => `/${s}`)];
  const body = urls.map((u) => `<url><loc>${esc(SITE_ORIGIN + u)}</loc><changefreq>weekly</changefreq></url>`).join('');
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${body}</urlset>`;
}

function robotsTxt() {
  return `User-agent: *\nAllow: /\nDisallow: /api/\nSitemap: ${SITE_ORIGIN}/sitemap.xml\n`;
}

/**
 * Boot-time assertion: an SEO slug must never shadow a real file in public/ and must
 * never start with "api". Offending slugs are dropped (loudly) so the server still boots.
 */
function assertSeoSlugs() {
  let publicNames = [];
  try {
    publicNames = fs.readdirSync(PUBLIC_DIR);
  } catch {
    publicNames = [];
  }
  const taken = new Set();
  for (const name of publicNames) {
    taken.add(name);
    taken.add(name.replace(/\.[^.]+$/, ''));
  }
  const problems = [];
  for (const slug of Object.keys(seoPages)) {
    if (!SLUG_RE.test(slug)) problems.push([slug, 'slug must match /^[a-z0-9-]+$/']);
    else if (slug.startsWith('api')) problems.push([slug, 'slug must not start with "api"']);
    else if (taken.has(slug)) problems.push([slug, 'slug collides with a file in public/']);
  }
  if (problems.length) {
    const detail = problems.map(([slug, why]) => `  - "${slug}": ${why}`).join('\n');
    for (const [slug] of problems) delete seoPages[slug];
    console.error(`[seo] ${problems.length} invalid SEO slug(s) were dropped:\n${detail}`);
  }
}
assertSeoSlugs();

// ---------------------------------------------------------------------------
// request dispatch
// ---------------------------------------------------------------------------

const server = http.createServer(async (req, res) => {
  let url;
  try {
    url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  } catch {
    sendJson(res, 400, { error: 'Bad request URL.' });
    return;
  }
  const pathname = url.pathname;
  const ip = clientIp(req);

  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('x-frame-options', 'SAMEORIGIN');

  try {
    // 1. robots / sitemap
    if (pathname === '/robots.txt') { sendText(res, 200, robotsTxt()); return; }
    if (pathname === '/sitemap.xml') { sendText(res, 200, sitemapXml(), 'application/xml; charset=utf-8'); return; }

    // 2. /api/*
    if (pathname === '/api' || pathname.startsWith('/api/')) {
      if (pathname.startsWith('/api/auth/')) {
        if (tooManyRequests('auth', ip, 10, 60_000)) throw httpError(429, 'Too many auth requests — slow down.');
        await handleAuth(req, res, url);
        return;
      }
      if (pathname === '/api/friends' || pathname.startsWith('/api/friends/')) {
        if (tooManyRequests('friends', ip, 60, 60_000)) throw httpError(429, 'Slow down.');
        await handleFriends(req, res, url);
        return;
      }
      if (pathname === '/api/checkins' || pathname.startsWith('/api/checkins/')) {
        if (tooManyRequests('checkins', ip, 60, 60_000)) throw httpError(429, 'Slow down.');
        await handleCheckins(req, res, url);
        return;
      }
      if (pathname === '/api/live' || pathname.startsWith('/api/live/')) {
        if (tooManyRequests('live', ip, 120, 60_000)) throw httpError(429, 'Slow down.');
        await handleLive(req, res, url);
        return;
      }
      if (pathname === '/api/location') {
        // legacy alias for /api/live/update
        const aliased = new URL(url);
        aliased.pathname = '/api/live/update';
        await handleLive(req, res, aliased);
        return;
      }
      if (pathname === '/api/saved' || pathname.startsWith('/api/saved/')) {
        if (tooManyRequests('saved', ip, 60, 60_000)) throw httpError(429, 'Slow down.');
        await handleSaved(req, res, url);
        return;
      }
      if (pathname === '/api/photo') {
        if (tooManyRequests('photo', ip, 120, 60_000)) throw httpError(429, 'Too many photo requests — slow down.');
        await handlePhoto(req, res, url);
        return;
      }

      // generic GET-only data routes
      if (req.method !== 'GET') throw httpError(405, 'Method not allowed.');
      if (pathname === '/api/nearby' || pathname === '/api/place' || pathname === '/api/geocode') {
        if (tooManyRequests('places', ip, 30, 60_000)) throw httpError(429, 'Too many requests — slow down.');
      }
      const name = pathname.slice('/api/'.length).split('/')[0];
      if (!Object.prototype.hasOwnProperty.call(routes, name)) throw httpError(404, 'Unknown endpoint.');
      const params = Object.fromEntries(url.searchParams);
      sendJson(res, 200, await routes[name](params));
      return;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') throw httpError(405, 'Method not allowed.');

    // 3. static files
    if (await serveStatic(req, res, pathname)) return;

    // 4. SEO landing pages (never for asset-looking paths)
    if (pathname.length > 1 && !path.extname(pathname)) {
      if (handleSeoPage(res, pathname.slice(1).replace(/\/+$/, ''))) return;
    }

    // 5. 404
    notFoundPage(res);
  } catch (err) {
    const status = Number(err && err.status) || 500;
    const expose = Boolean(err && err.expose);
    // Unexpected faults get a full stack; deliberate 5xx (upstream down, no key) get one line.
    if (!expose) console.error('[server]', req.method, pathname, err);
    else if (status >= 500) console.error('[server]', req.method, pathname, status, err.message);
    if (res.headersSent) { try { res.end(); } catch { /* ignore */ } return; }
    const message = expose ? err.message : 'Something went wrong on our side. Please try again.';
    if (pathname === '/api' || pathname.startsWith('/api/')) sendJson(res, status, { error: message });
    else sendHtml(res, status, `<h1>${esc(status)}</h1><p>${esc(message)}</p><p><a href="/">Back to businessfind</a></p>`);
  }
});

// ---------------------------------------------------------------------------
// process-level safety nets
// ---------------------------------------------------------------------------

process.on('unhandledRejection', (reason) => {
  console.error('[unhandledRejection]', reason);
});
process.on('uncaughtException', (err) => {
  console.error('[uncaughtException]', err);
});

// ---------------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------------

async function boot() {
  const seed = {
    name: process.env.SEED_NAME || 'Admin',
    email: (process.env.SEED_EMAIL || 'admin@businessfind.local').toLowerCase(),
    password: process.env.SEED_PASSWORD || crypto.randomBytes(9).toString('base64url'),
  };

  let seeded = false;
  try {
    const ensure = Sopt('ensureAccount', 'ensureUser', 'seedAccount');
    if (ensure) seeded = Boolean(await ensure(seed));
    const prune = Sopt('pruneSessions', 'prune');
    if (prune) await prune();
  } catch (err) {
    console.error('[boot] store initialisation problem:', err && err.message);
  }

  server.listen(PORT, () => {
    console.log(`businessfind running at http://localhost:${PORT}  (canonical origin: ${SITE_ORIGIN})`);
    if (!LIVE) {
      console.log('No GOOGLE_PLACES_SERVER_KEY set — the UI runs, but /api/nearby, /api/place, /api/geocode and /api/photo return 503. See .env.example.');
    } else {
      console.log(`Daily caps — nearby:${NEARBY_CAP} place:${PLACE_CAP} geocode:${GEOCODE_CAP} photo:${PHOTO_CAP} (0 = endpoint disabled)`);
      if (!BROWSER_KEY) console.log('No GOOGLE_MAPS_BROWSER_KEY set — /api/config reports mapEnabled:false and the client will use the list-only view.');
    }
    if (seeded) console.log(`Seed account created: ${seed.email} / ${seed.password}`);
  });
}

boot();

module.exports = server;
