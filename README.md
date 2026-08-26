# businessfind

Find great places. Bring people with you.

Search restaurants, cafes, groceries, malls, pharmacies, gyms and more near your current location — with real Google ratings and reviews, five colour themes, and a friends feature built around check-ins.

No build step. No dependencies. Just Node.

```bash
node server.js       # -> http://localhost:4321
```

The app runs without any API key — you'll get the full interface, themes and accounts, with a clear message where live results would be. Add Google keys to see real businesses.

---

## ⚠️ Read this before adding an API key

Google Maps Platform bills real money, and **the default configuration of a naive build costs around $615/month.** This project ships with caps set to keep you at **$0**, but two of them can only be enforced on Google's side. Do the Cloud Console setup below, or you risk a surprise bill.

### Why it's expensive

Since **1 March 2025** Google replaced the old $200/month universal credit with *per-SKU* free allowances. The expensive tiers have small ones:

| What we call | SKU tier | Free per month | Then |
|---|---|---|---|
| Nearby search (with ratings) | Enterprise | **1,000** | $35 / 1,000 |
| Place details (with reviews) | Enterprise + Atmosphere | **1,000** | $25 / 1,000 |
| Geocoding | — | 10,000 | $5 / 1,000 |
| Map loads | Dynamic Maps | 10,000 | $7 / 1,000 |

`rating`, `userRatingCount` and `priceLevel` are Enterprise-tier fields, so *every* nearby search costs Enterprise rates. `reviews` is an Atmosphere field, pushing place details a tier higher again.

### The caps that keep you at $0

In `.env`:

```
NEARBY_DAILY_CAP=30          # 1,000/month free ÷ 30 days
PLACE_DETAILS_DAILY_CAP=30   # 1,000/month free ÷ 30 days
GEOCODE_DAILY_CAP=200        # 10,000/month free — comfortable
```

Set any cap to `0` to disable that endpoint entirely.

30 searches/day sounds tight, but each one returns up to 20 businesses **with ratings** — roughly 600 rated results a day. That's a deliberate trade: keeping `rating` in the nearby field mask is far more efficient than fetching each rating individually.

### 🔴 The one cap this app cannot enforce

**Map loads go from the browser straight to Google.** This server never sees them, so no amount of application code can limit them. Published quota is 300 loads/min/IP — one abusive IP could bill ~12.9M loads/month. Referrer restrictions are spoofable outside a browser.

**You must cap this in Cloud Console:**

1. Go to **Google Cloud Console → APIs & Services → Maps JavaScript API → Quotas**
2. Set **Map loads per day** to `330`
3. Repeat for **Places API** and **Geocoding API** requests per day
4. Go to **Billing → Budgets & alerts** and create a budget (e.g. $1) with email alerts at 50%/90%/100%

> **Note the tradeoff:** when the daily map-load quota is exhausted, the map goes dark for everyone until midnight Pacific. It cannot degrade gracefully, because our code never sees those requests. The Places-side caps *do* degrade gracefully — the app stays usable and just says the daily limit is reached.

---

## Setup

### 1. Create a Google Cloud project

Enable these three APIs: **Places API (New)**, **Maps JavaScript API**, **Geocoding API**. Billing must be enabled even to use the free tier.

### 2. Create **two separate** API keys

This matters. One key is public, one must never be.

| Key | Env var | Restrict it to | Why |
|---|---|---|---|
| Browser | `GOOGLE_MAPS_BROWSER_KEY` | Maps JavaScript API only, **+ HTTP referrer restriction** to your domains | Must reach the browser to draw the map. Referrer-restricted so it can't be reused elsewhere. |
| Server | `GOOGLE_PLACES_SERVER_KEY` | Places API + Geocoding API, **no referrer restriction** | Never sent to the browser. The server has no referrer, so restrict by API instead. |

Never give the browser key Places access, and never let the server key reach the client.

### 3. Configure

```bash
cp .env.example .env
# fill in the two keys
node server.js
```

On first run a seed account is created and its credentials printed to the console. Change the password.

---

## Themes

Five themes plus follow-system, switchable in the header:

| Theme | Character |
|---|---|
| `aurora` | Light violet — the default light theme |
| `midnight` | Deep navy — the default dark theme |
| `meadow` | Warm green |
| `sunset` | Warm coral |
| `mono` | Neutral greyscale |

Each pairs with a Google Maps `styles[]` array, so the map canvas recolours along with the interface rather than staying stubbornly grey. The choice is stored in `localStorage` and applied by an inline script before first paint, so there's no flash of the wrong theme on reload.

---

## Friends, check-ins and location

The social side is deliberately conservative, because location sharing is the most dangerous thing a small app can get wrong.

- **Friends only.** Mutual accept required. There is no stranger discovery.
- **Email verification gates the friends surface.** Browsing, search, themes and saved places all work without it. This exists to stop someone registering an address they don't own and receiving a stranger's location.
- **Check-ins are the default.** You share a place deliberately ("I'm at Blue Tokai") rather than broadcasting continuously.
- **Live location is always time-boxed** — 15 minutes, 1 hour, or 8 hours. There is no "until I turn it off" option, by design.
- **Live coordinates never touch disk.** They live in memory with an expiry and are gone on restart.
- Blocking and reporting are built in, and a declined friend request can't be re-sent for 7 days.

Why not simply blur the location instead? Because rounding coordinates to a fixed grid isn't real protection — the grid is stable, so a friend polling your position over time converges on the cell you sleep in. Time-boxing and deliberate sharing are the actual defence.

---

## What's deliberately *not* here

**Programmatically generated city × category landing pages.** The obvious SEO play for a directory is to generate `/restaurants-in-mumbai` for every city and category. We don't, for three reasons:

1. Google's doorway abuse policy names this pattern verbatim — "multiple domain names or pages targeted at specific regions or cities that funnel users to one page."
2. Places API terms forbid caching business content (only `place_id` indefinitely, coordinates for 30 days). Such pages would legally contain no business data at all — thin by architecture, not by laziness.
3. The March 2026 core update demoted directories and aggregators as a class.

The pages in `seo-content.js` are **hand-written and few**. The sitemap enumerates that object's keys, so generating them in a loop would automatically ship doorway URLs to Google. Keep it hand-authored.

We also don't mark up Google reviews as our own `AggregateRating` structured data. Google's guidelines are explicit — "Don't aggregate reviews or ratings from other websites" — and the Maps terms independently forbid republishing. Doing it risks a manual action *and* the API key.

---

## Attribution requirements

Google's terms are specific about displaying Places content, and these are not optional:

- Places API results shown on a map must be shown on **a Google map**
- Reviews must display the **author's name, photo and profile link**, and link back to the listing via `googleMapsUri`
- Google's **official attribution logo** must be shown — download the real asset from Google's brand guidelines; a recreation isn't acceptable
- Attribution, links and notices must not be removed, altered or obscured
- The app needs a public **Privacy Policy** and **Terms of Use**

---

## How it's put together

```
server.js          HTTP server, routing, Google proxy, auth, friends
seo-content.js     Hand-written landing pages (never generate these)
data/store.js      All persistence — swap this one file for a real database
public/
  index.html       Shell + anti-flash theme script
  app.js           Router, views, map, state
  styles.css       Theme tokens + layout
docs/
  CONTRACT.md      The interface contract the build was written against
  *.json           Banked research reports
```

Three decisions worth preserving if you extend this:

1. **The Places key stays on the server.** The browser only ever talks to `/api/*`.
2. **Every Google call is metered before it's made** — validate first, consume budget second, refund on upstream failure.
3. **`data/store.js` is the entire storage layer.** Swap it for Postgres and nothing else changes.
