# businessfind — FROZEN INTERFACE CONTRACT

**Every agent builds against this. Do not change it. If something here seems wrong, implement it anyway and note the concern in your report — a unilateral change breaks another agent's file.**

Project root: `/Users/atharv/businessfind`. Node >= 18, CommonJS on the server, ES modules in the browser. **Zero npm dependencies.** No build step.

---

## 1. File ownership (do not edit files you do not own)

| Agent | Owns |
|---|---|
| A | `seo-content.js` |
| B | `data/store.js` |
| C | `server.js`, `.env.example`, `package.json` |
| D | `public/styles.css` |
| E | `public/index.html`, `public/app.js` |

---

## 2. `data/store.js` exports (Agent B provides, Agent C consumes)

All mutating functions are **async** and `await` an atomic save before resolving.

```js
module.exports = {
  // users
  createUser({name,email,password}),        // async -> user
  findByEmail(email), findById(id),
  publicUser(user),                          // {id,name,email,createdAt,emailVerified}
  verifyPassword(password, encoded),         // async -> bool
  ensureAccount({name,email,password}),      // async -> bool (true if seeded)
  // email verification
  createVerificationToken(userId),           // async -> rawToken
  consumeVerificationToken(rawToken),        // async -> userId|null
  // sessions
  createSession(userId),                     // async -> {token,maxAge}
  userForToken(token), destroySession(token), pruneSessions(),
  // friends
  sendFriendRequest(fromId,toId),            // async
  respondToRequest(requestId,userId,accept), // async
  removeFriend(userId,friendId),             // async
  listFriends(userId), listIncomingRequests(userId),
  areFriends(a,b),
  blockUser(userId,targetId), unblockUser(userId,targetId),  // async
  isBlocked(a,b), listBlocked(userId),
  reportUser(userId,targetId,reason),        // async
  // check-ins (the DEFAULT social primitive)
  createCheckIn(userId,{placeId,placeName,note}),  // async -> checkIn
  listFriendCheckIns(userId),                // active check-ins from friends
  // live location — IN MEMORY ONLY, never persisted
  startLiveShare(userId,durationMs),         // durationMs in {900000,3600000,28800000}
  stopLiveShare(userId),
  updateLiveLocation(userId,lat,lng),
  friendLiveLocations(userId),               // [{id,name,lat,lng,expiresAt}]
  activeShareStatus(userId),                 // {sharing,expiresAt,visibleTo:[names]}
  // saved places
  savePlace(userId,{placeId,name,category}), // async
  unsavePlace(userId,id), listSaved(userId),
  // cost caps
  tryConsume(kind,cap),                      // 'nearby'|'place'|'geocode' -> bool
  refund(kind),                              // undo on upstream failure
  usageRemaining(kind,cap),
};
```

**Hard requirements for Agent B:**
- Atomic writes: `writeFile(FILE+'.tmp')` then `rename()`. Never truncate-in-place.
- `load()` distinguishes ENOENT (fresh start) from parse failure. On parse failure: rename to `store.json.corrupt-<ts>` and **throw** — never silently wipe.
- Type-coerce every field after load (`Array.isArray(x)?x:[]`, etc.) so `"users":null` can't cause a permanent 500.
- Live locations live in a module-level `Map`, excluded from `emptyDb()` and from the save snapshot.
- Password hashing: **async** `crypto.scrypt`, N=32768, r=8, p=1, keylen=32, explicit `maxmem: 64*1024*1024`. Clamp N/r/p to a whitelist on verify. Optional `AUTH_PEPPER` env: `scrypt(HMAC-SHA256(password,PEPPER), salt, ...)`.
- Export a module-level `DUMMY_HASH` path so unknown-email logins still spend hashing time.
- `pruneSessions` on a 6h `setInterval(...).unref()`.
- `removeFriend` also drops friendRequest rows between the pair and any live-share entry.

---

## 3. HTTP API (Agent C provides, Agent E consumes)

All responses JSON. Errors: `{error: "message"}` with an appropriate status. 5xx never leaks upstream text.

| Method | Path | Returns |
|---|---|---|
| GET | `/api/config` | `{live, mapEnabled, mapsBrowserKey, categories:[...], quota:{nearby,place,geocode}}` |
| GET | `/api/nearby?lat&lng&category&radius` | `{places:[Place]}` |
| GET | `/api/place?id=` | `{place: PlaceDetail}` |
| GET | `/api/photo?name=&maxWidth=` | image bytes (proxy — **new route**) |
| GET | `/api/geocode?q=` | `{lat,lng,formattedAddress}` |
| GET/POST | `/api/auth/me\|signup\|login\|logout\|verify` | `{user}` / `{ok}` |
| GET | `/api/friends` | `{friends,incoming,blocked}` |
| POST | `/api/friends/request\|accept\|decline\|remove\|block\|report` | `{ok}` |
| GET | `/api/checkins` | `{checkIns:[...]}` |
| POST | `/api/checkins` | `{checkIn}` |
| GET | `/api/live` | `{locations:[...], status:{...}}` |
| POST | `/api/live/start\|stop\|update` | `{ok}` |
| GET/POST/DELETE | `/api/saved` | `{saved:[...]}` |

**Place** (from nearby): `{id,name,lat,lng,rating,ratingCount,priceLevel,businessStatus}`
**PlaceDetail**: adds `{address,phone,website,mapsUri,openNow,weekdayHours,photos:[name],reviews:[{author,authorPhoto,profileUri,rating,text,relativeTime}]}`

`priceLevel` is a **string enum** (`PRICE_LEVEL_MODERATE`), not numeric.

**Categories** (exact keys, both server and client use these):
`restaurants cafes groceries malls clothing pharmacies gyms salons atms petrol bakeries bars`

**Hard requirements for Agent C:**
- Validate **before** `tryConsume`. Reject unknown category, range-check lat/lng, clamp radius to 1..50000.
- `refund()` on upstream 5xx / network error / 401 / 403.
- `AbortSignal.timeout(8000)` on every outbound fetch.
- Rate-limit `/api/auth/*` (10/min/IP; signup 3/hour/IP).
- Guard `seoPages[slug]` with `hasOwnProperty` + `/^[a-z0-9-]+$/`. Skip SEO handling when `path.extname()` is non-empty or path starts with `/api/`. **Order: API → static → SEO → 404.**
- Cap parsing must accept `0`: `const num=(v,d)=>{const n=Number(v);return Number.isFinite(n)&&n>=0?n:d;}`
- `SITE_ORIGIN` env var replaces every hardcoded `buisnessfind.app` in canonical/sitemap/robots.
- Escape all interpolation in `pageShell`.
- `emailVerified` gate on `/api/friends/*`, `/api/checkins`, `/api/live`.
- `process.on('unhandledRejection')`; `res.headersSent` check in the catch.
- MIME table: add png, jpg, jpeg, webp, avif, ico, woff2, webmanifest, txt, xml. Read via `hasOwnProperty`.
- Default caps: `NEARBY_DAILY_CAP=30`, `PLACE_DETAILS_DAILY_CAP=30`, `GEOCODE_DAILY_CAP=200`.

---

## 4. CSS contract (Agent D provides, Agent E consumes)

Themes set via `document.documentElement.dataset.theme` ∈ `aurora|midnight|meadow|sunset|mono`; pref stored at `localStorage['bf-theme']` (may also be `system`).

**Tokens** (Agent D defines, Agent E only consumes):
`--bg --bg-elevated --bg-sunken --surface --surface-hover --border --text --text-muted --text-faint --accent --accent-hover --accent-contrast --accent-soft --success --warning --danger --shadow --focus-ring --chip-bg --chip-active-bg --chip-active-text --overlay --map-tint`
Scale: `--radius-sm/md/lg/full`, `--space-1..8`, `--font-sans`, `--z-map/header/sheet/modal/toast`

**Class names Agent E will emit — Agent D must style exactly these:**
```
.app-shell .topbar .brand .nav-actions .theme-picker
.hero .hero-title .hero-sub .hero-cta
.map-wrap #map .map-placeholder
.chips .chip .chip[aria-pressed="true"]
.filters .filter .radius-slider
.results .result-card .result-card.is-active
  .result-name .result-meta .result-rating .result-distance
.detail .detail-header .detail-photos .detail-hours .detail-actions
  .reviews .review .review-author .review-body .google-attrib
.geo-prompt .geo-error .manual-location
.auth-wrap .auth-form .field .btn .btn-primary .btn-ghost .form-error
.friends .friend-row .request-row .checkin-row .share-banner
.saved .empty-state .skeleton .toast .modal
```
Mobile-first. Map full-bleed; results as a bottom sheet under 720px, side panel above.

---

## 5. Shared rules

- **XSS:** every interpolated value passes through `esc()`. No exceptions.
- **Secrets:** the Places server key never reaches the browser. Only `mapsBrowserKey` is public.
- **Attribution:** reviews render author name, photo, profile link, and link to `mapsUri`. Google logo required.
- **No caching of Places content** beyond `place_id` (indefinite) and lat/lng (30 days).
- Match the existing hand-rolled style: no frameworks, template literals, delegated events.
