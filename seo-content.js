'use strict';

/* ============================================================================
 * seo-content.js — HAND-AUTHORED landing pages. SIX OF THEM. BY HAND. FOREVER.
 * ============================================================================
 *
 * READ THIS BEFORE YOU ADD A PAGE. This is the most important comment in the
 * codebase, because the mistake it prevents is the kind that gets a domain
 * removed from Google's index rather than merely ranked poorly.
 *
 * THE TEMPTATION
 * --------------
 * There are 12 categories in this app and roughly 4,000 cities worth naming in
 * India alone. `for (city of cities) for (cat of categoryList) ...` produces
 * 48,000 URLs in about nine lines of code, each with a plausible <title>, a
 * plausible <h1>, and a paragraph of prose with two nouns swapped. Every
 * instinct a programmer has says: that is the same page written 48,000 times,
 * so write it once and interpolate. That instinct is correct about code and
 * catastrophically wrong about search.
 *
 * WHY WE DO NOT DO IT — FOUR INDEPENDENT REASONS, EACH SUFFICIENT
 * ---------------------------------------------------------------
 * 1. GOOGLE'S DOORWAY POLICY NAMES THIS EXACT PATTERN. The spam policy on
 *    doorway abuse calls out, verbatim, sets of pages generated for many
 *    cities or regions that funnel users into one undifferentiated
 *    destination. It is not an edge case we might argue our way out of; it is
 *    the textbook example in the policy text. A generated city x category grid
 *    IS the illustration Google uses. Manual actions for doorways apply
 *    site-wide, not per-URL — 48,000 doorway pages would take the six good
 *    pages, the app, and the domain down with them.
 *
 * 2. PLACES API TERMS MEAN THOSE PAGES WOULD LEGALLY CONTAIN NO BUSINESS DATA.
 *    Google Places prohibits caching or storing business content. The only
 *    field that may be retained indefinitely is the place ID; latitude and
 *    longitude may be held for at most 30 days. Names, ratings, review text,
 *    hours, photos, phone numbers — none of it may be persisted to build a
 *    static page. So a server-rendered "Best restaurants in Nashik" page is
 *    not allowed to list a single restaurant. It can only contain generic
 *    prose plus a JavaScript widget that fetches live at runtime, which
 *    Googlebot indexes as an empty shell. The pages are thin BY ARCHITECTURE,
 *    not by laziness. There is no version of this that is both compliant and
 *    substantive. That is the whole trap: the legal constraint and the quality
 *    constraint point at the same wall.
 *
 * 3. THE MARCH 2026 CORE UPDATE DEMOTED DIRECTORY SITES AS A CLASS. Aggregated
 *    listing pages that add no first-party observation lost visibility whether
 *    or not they were technically spam. Publishing 48,000 of them today is
 *    volunteering for a category that already lost.
 *
 * 4. THE SITEMAP IS MECHANICALLY COUPLED TO THIS OBJECT. server.js builds the
 *    sitemap from Object.keys(seoPages) and emits `/${key}` for each. A loop
 *    here does not produce drafts for review — it SHIPS every generated URL to
 *    Google on the next crawl, automatically, with no human ever seeing one.
 *    There is no staging gate between this object literal and the index.
 *
 * THE RULE
 * --------
 * Every key below is typed by a human who had something specific to say about
 * that category and could not have said it about any other. Six pages, six
 * genuinely different arguments about how to choose. If you want a seventh,
 * write it — with a real opinion, in your own words, about something you
 * actually know. Never generate one. Never interpolate a place name into one.
 * If the new page's prose would still read correctly with the category noun
 * swapped, it is a doorway page and it does not belong here.
 *
 * NO PLACES API DATA APPEARS ANYWHERE IN THIS FILE and none may ever be added.
 * ==========================================================================*/

/**
 * The 12 canonical category keys used across the entire app.
 * These strings are contractual: server routing, the Places type map, the
 * client UI and these pages all key off them. Do not rename or reorder.
 */
const categoryList = [
  'restaurants',
  'cafes',
  'groceries',
  'malls',
  'clothing',
  'pharmacies',
  'gyms',
  'salons',
  'atms',
  'petrol',
  'bakeries',
  'bars'
];

/**
 * seoPages: slug (no leading slash) -> page definition.
 *
 * Shape: { title, description, h1, lede, category, body, faq? }
 *   title       <title> text
 *   description meta description
 *   h1          page heading
 *   lede        one-sentence standfirst under the h1
 *   category    one of categoryList — preselects the category in the app widget
 *   body        HTML string (already-safe author-written markup, no user input)
 *   faq         optional [{ q, a }] — plain text, escaped at render time
 *
 * Slugs must match /^[a-z0-9-]+$/, must not start with "api", and must not
 * collide with index.html, app.js or styles.css.
 */
const seoPages = {

  /* ---------------------------------------------------------------- *
   * RESTAURANTS — angle: data freshness. A rating is a historical
   * average; dinner is tonight. Argues for recency over stars.
   * ---------------------------------------------------------------- */
  'restaurants-near-me': {
    title: 'Restaurants Near Me — Find What Is Actually Open Tonight',
    description:
      'A live map of restaurants around your current location, with a working argument for why a three-year-old star average is the least useful number on the screen.',
    h1: 'Restaurants near me',
    lede:
      'Search runs against live data from your current position — nothing about these results is stored, cached or pre-written.',
    category: 'restaurants',
    body: `
      <p>A restaurant's star rating is a weighted average of every meal anyone
      bothered to grade, going back years. It is a history, not a forecast. The
      kitchen that earned 4.6 has since lost the chef who earned it, changed
      owners twice, and now does a decent biryani on weekdays and something
      unrecognisable on Sunday. The number does not move, because averages
      resist new information by design: once a place has two thousand reviews,
      a hundred bad nights barely shift the second decimal.</p>

      <p>So read the count and the recency before you read the score. Forty
      reviews clustered in the last three months tell you far more than four
      thousand spread across a decade — a busy, recently-reviewed place is
      demonstrably still operating the way people are describing it. When you
      open a result here, scan the review dates first. If the newest one is
      from last winter, treat the whole page as archaeology.</p>

      <p>The other number worth trusting is the operational one. Whether the
      kitchen is open right now, and whether the listing says temporarily
      closed, is checked at the moment you search rather than remembered from
      an earlier crawl. That is the single field most likely to save you a
      wasted trip, and it is also the field most static "best restaurants"
      articles get wrong, because they were written once and never looked at
      again.</p>

      <p>Practical order: filter to open now, then let the price level tell you
      what kind of evening this is before the stars tell you anything.</p>
    `,
    faq: [
      {
        q: 'Why do you not publish a "best restaurants" list?',
        a: 'Because we would have to freeze business data to publish it, which the Places API terms forbid, and a frozen list is stale within weeks anyway. Everything you see is fetched live when you search.'
      },
      {
        q: 'Should I trust a 4.9 rating with 12 reviews?',
        a: 'Treat it as a promising unknown rather than a verdict. Twelve reviews is small enough that a handful of friends and a good opening month can produce it. Read the actual text before deciding.'
      },
      {
        q: 'Does the search know if a place is open right now?',
        a: 'Yes — open-now status and hours come back with the live result. They reflect what the business has published, so a kitchen closing early on a quiet night is still possible. Call ahead for anything far away.'
      }
    ]
  },

  /* ---------------------------------------------------------------- *
   * CAFES — angle: the thing you are actually buying is a seat and a
   * socket, and only prose reviews reveal those.
   * ---------------------------------------------------------------- */
  'cafes-near-me': {
    title: 'Cafes Near Me — Wifi, Power and a Seat You Can Keep',
    description:
      'Find cafes around you, and learn how to read reviews for the three things that actually decide whether you can work there: signal, sockets and seating.',
    h1: 'Cafes near me',
    lede:
      'Coffee quality is table stakes. What separates one cafe from the next is almost never in the star rating.',
    category: 'cafes',
    body: `
      <p>Nobody who is looking for a cafe at two in the afternoon is primarily
      looking for coffee. They are looking for somewhere to sit for ninety
      minutes without being made to feel like a squatter, ideally within reach
      of a plug and a signal that survives a video call. None of those three
      things has a field in any listing database. All three are routinely
      described in the reviews, and almost never in the ones with five stars
      and four words.</p>

      <p>So skip the raves. The useful review is medium-length and slightly
      annoyed: "great flat white, but there are two sockets and both are behind
      the counter" is worth more than fifty compliments. Complaints are
      specific in a way that praise is not, which makes negative reviews the
      highest-density source of the operational detail you actually want.
      Search the text for "wifi", "plug", "laptop", "loud", "queue" and read
      only what comes back.</p>

      <p>Time of day matters more here than for any other category. A cafe that
      is a library at ten in the morning is a waiting room at one and a bar by
      seven. Reviews carry timestamps; a complaint about noise written on a
      Saturday evening tells you nothing about your Tuesday morning. Open-now
      status and the day's hours come back live with each result, which is the
      part worth checking before you walk — closing time is the constraint that
      ends a working session, not the coffee.</p>
    `,
    faq: [
      {
        q: 'Can you filter for cafes with wifi?',
        a: 'No, and be sceptical of any directory that claims to. There is no reliable structured field for it, so the honest approach is reading recent review text, which is where that detail genuinely lives.'
      },
      {
        q: 'Why are the review photos useful here?',
        a: 'Photos show the room. Table size, whether seats are shared benches, how close the chairs are to each other and whether there is natural light are all instantly visible and never written down.'
      }
    ]
  },

  /* ---------------------------------------------------------------- *
   * GROCERIES — angle: intent is already fixed. Hours and distance
   * dominate; rating is nearly noise.
   * ---------------------------------------------------------------- */
  'grocery-stores-near-me': {
    title: 'Grocery Stores Near Me — Open Now, and Close By',
    description:
      'Supermarkets and grocery stores around your location, sorted for the two variables that actually matter on a grocery run: whether it is open and how far you have to go.',
    h1: 'Grocery stores near me',
    lede:
      'You already know what you want. The only open questions are hours and distance.',
    category: 'groceries',
    body: `
      <p>Groceries are the category where reviews matter least, and it is worth
      being explicit about why. You arrive with a list. The list is not
      negotiable, the products are largely identical between chains, and there
      is no experience being purchased — nobody chooses a supermarket for the
      atmosphere. That collapses the decision down to two variables: is it open,
      and how long does it take to get there and back with heavy bags.</p>

      <p>Ratings in this category are also unusually noisy. Supermarket reviews
      skew toward one bad checkout queue, one rude interaction, or one missing
      item, because satisfied shoppers have no reason to write anything at all.
      A 3.8 and a 4.3 in the same neighbourhood are usually the same store with
      different sample sizes. Reading them will not change what ends up in your
      basket.</p>

      <p>Hours are the field worth real attention. Grocery hours vary more by
      day than almost any other kind of business — shorter Sunday trading,
      earlier public-holiday closes, and a last-entry time that is quietly
      fifteen minutes before the posted close. The weekday hours come back with
      each result so you can see the whole week rather than a single open-now
      flag, which is the difference between planning tomorrow's shop and
      salvaging tonight's.</p>

      <p>One genuinely useful signal: price level. It separates a discount chain
      from a premium grocer faster than any review does, and it is the only
      structured field here that reliably changes where you should go.</p>
    `,
    faq: [
      {
        q: 'Why is the nearest store not always first?',
        a: 'Results come back ranked by relevance to the search, which mixes distance with how well a place matches the category. Widen or narrow the radius to control it — a tighter radius is the most direct way to force proximity.'
      },
      {
        q: 'Do the hours account for public holidays?',
        a: 'They reflect what the business has published, which usually means regular weekly hours. Special holiday hours are frequently not updated by the store, so treat a holiday as a call-ahead day.'
      }
    ]
  },

  /* ---------------------------------------------------------------- *
   * PHARMACIES — angle: urgency. Nearest open beats best rated,
   * always. Sort by distance, filter to open now.
   * ---------------------------------------------------------------- */
  'pharmacies-near-me': {
    title: 'Pharmacies Near Me — Open Now, Nearest First',
    description:
      'Find the closest pharmacy that is open right now. The nearest open counter is almost always the correct answer, and this page explains why rating should be ignored here.',
    h1: 'Pharmacies near me',
    lede:
      'Filter to open now. Sort by distance. Do not read the reviews — go.',
    category: 'pharmacies',
    body: `
      <p>This is the one category where we would tell you to ignore the ratings
      entirely. If you are searching for a pharmacy, something has gone wrong:
      a child has a fever, a prescription ran out on a Sunday, a course of
      antibiotics has one dose left. In that situation the nearest counter that
      is open is the right answer, and it is the right answer even if it has
      3.1 stars and someone in the reviews is furious about parking.</p>

      <p>Dispensed medicine is a regulated product. The paracetamol is the same
      paracetamol. What you are choosing between is not quality but access:
      distance, opening hours, and whether the shutter is up right now. Set the
      radius small first — one or two kilometres — and only widen it if nothing
      open comes back. A tight radius forces proximity to dominate the ranking,
      which is exactly what you want here and almost nowhere else in this app.</p>

      <p>Two cautions. Published hours are the business's own claim, and
      late-night pharmacy hours are the least reliable field in any listing
      database — past ten at night, phone the number on the result before you
      set off. And genuinely 24-hour counters are usually attached to hospitals
      and listed under the hospital name, so widen the radius and check those
      entries too.</p>

      <p>Everything here is fetched at the moment you search, so the open-now
      state is current rather than remembered.</p>
    `,
    faq: [
      {
        q: 'How do I find a 24-hour pharmacy?',
        a: 'Widen the radius and check the weekday hours on each result for a 24-hour entry. Hospital pharmacies are the most common genuinely round-the-clock option and are often listed under the hospital name.'
      },
      {
        q: 'Should I trust the opening hours late at night?',
        a: 'Treat them as a strong hint, not a guarantee. Late hours are the least reliably maintained field in listings. Call the number shown on the result before travelling any real distance after dark.'
      },
      {
        q: 'Is a low-rated pharmacy a problem?',
        a: 'Rarely, for an urgent errand. Pharmacy reviews mostly reflect queues, parking and counter staff. Dispensing is regulated, so the medicine is the same. Distance and open-now are the fields that matter.'
      }
    ]
  },

  /* ---------------------------------------------------------------- *
   * GYMS — angle: adherence. Proximity predicts attendance; quality
   * does not. The best gym you never go to is worth nothing.
   * ---------------------------------------------------------------- */
  'gyms-near-me': {
    title: 'Gyms Near Me — The One You Will Actually Keep Going To',
    description:
      'Find gyms close to you, with the case for choosing on distance rather than reviews: attendance is the only variable that produces results, and distance predicts attendance.',
    h1: 'Gyms near me',
    lede:
      'The best gym in the city is worthless if it is a forty-minute round trip from your front door.',
    category: 'gyms',
    body: `
      <p>Every gym decision is really an attendance decision. Equipment quality,
      class timetables and trainer credentials all matter, but they matter a
      distant second to whether you show up three times a week in month seven.
      And the strongest predictor of showing up is not motivation, price or
      programming — it is how much friction sits between your door and the
      squat rack. A gym on your commute gets visited. A better gym twenty
      minutes in the wrong direction gets visited in January.</p>

      <p>This inverts the usual advice, so be deliberate about it. Search with a
      deliberately small radius — the distance you would walk or cycle without
      thinking about it — and treat everything outside that circle as not
      really available to you, regardless of its rating. Then, and only then,
      compare what is inside the circle. If there are three options, ratings
      become a reasonable tiebreak. If there is one, the decision is made.</p>

      <p>When you do read reviews, read them for time-of-day congestion rather
      than overall sentiment. "Impossible to get a bench after six" is the
      single most actionable sentence in gym reviews, and it is decisive if six
      is the only hour you have. Photos are similarly useful: they show floor
      space, how many of each machine there are, and whether the free-weight
      area is an afterthought.</p>

      <p>Finally, check the opening hours against your actual schedule, not your
      aspirational one. A gym that opens at six is a different product from one
      that opens at five.</p>
    `,
    faq: [
      {
        q: 'What radius should I search?',
        a: 'Start with what you would cover on foot or by bike without planning it — often one to two kilometres. Anything you need to drive to competes with every excuse you will invent on a cold evening.'
      },
      {
        q: 'Do reviews tell you anything about a gym?',
        a: 'They are good for crowding at specific hours, cleanliness of changing rooms, and contract or cancellation complaints. They are poor for equipment quality, which photos show far better.'
      }
    ]
  },

  /* ---------------------------------------------------------------- *
   * MALLS — angle: the trip is a real time commitment, so the usual
   * proximity-first heuristic flips. Quality earns the travel.
   * ---------------------------------------------------------------- */
  'malls-near-me': {
    title: 'Shopping Malls Near Me — When Travelling Further Is Correct',
    description:
      'Shopping malls and centres around your location, plus the one case in this app where rating should outrank distance: a trip that costs you an afternoon.',
    h1: 'Shopping malls near me',
    lede:
      'A mall visit costs half a day. That is long enough that a better one is worth driving to.',
    category: 'malls',
    body: `
      <p>Almost every other page on this site argues for proximity. Malls are
      the exception, and the reason is arithmetic. A pharmacy run is six
      minutes and the travel is most of the cost, so distance dominates. A mall
      trip is three or four hours once parking, walking and queueing are
      counted — at which point an extra fifteen minutes in the car is a rounding
      error against the risk of arriving somewhere with four open units and a
      dead food court.</p>

      <p>So here, invert the rule. Widen the radius further than feels sensible,
      then rank what comes back by rating and review volume together. Volume
      matters unusually much for malls: they serve tens of thousands of people,
      so a genuinely busy centre accumulates thousands of reviews. A mall with
      a high average and only two hundred reviews is often a small strip of
      shops rather than the destination you are picturing, and the review count
      is the fastest way to tell those apart.</p>

      <p>Read the recent reviews specifically for occupancy and upkeep.
      Complaints about shuttered units, broken escalators, non-functioning
      air-conditioning or a closed cinema are the leading indicators of a
      centre in decline, and they show up in the text long before the average
      moves. Photos are the other reliable tell — recent visitor photos of
      empty corridors on a weekend afternoon say everything a rating will not.</p>

      <p>Check closing time before you leave, especially on a Sunday. Anchor
      stores frequently shut an hour before the mall itself.</p>
    `,
    faq: [
      {
        q: 'Why does review count matter more for malls?',
        a: 'Malls serve enormous numbers of people, so a real destination centre accumulates thousands of reviews. A high average on a few hundred reviews usually means a small retail strip rather than a full mall.'
      },
      {
        q: 'How do I tell if a mall is declining?',
        a: 'Read the most recent reviews for empty units, broken escalators or lifts, air-conditioning complaints and a closed cinema. Those appear in text months before the star average reflects them.'
      },
      {
        q: 'Should I still filter by open now?',
        a: 'Use it as a sanity check, but read the full weekday hours too. Mall hours differ by day, and anchor stores and food courts often keep shorter hours than the building itself.'
      }
    ]
  }

};

module.exports = { seoPages, categoryList };
