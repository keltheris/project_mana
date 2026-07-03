# Backlog

Feature ideas from planning sessions that haven't been built yet. Not
prioritized against each other beyond the rough grouping below — pick
whichever the user asks for next.

## Visual polish

- **Card tilt-on-hover** — rotate/tilt the art based on mouse position over
  the card. Described as "easy but needs tuning so it isn't annoying."
- **Foil effects** — make foil-marked printings actually look foil, ideally
  mimicking real foil patterns (rainbow/etched, galaxy, etc). Bigger and more
  iterative than tilt; do tilt first.
- **"+X/+X" selection stamp** — replace the plain checkmark badge on a
  selected art card with an MTG-themed counter showing how many copies that
  print will contribute (e.g. `+2/+2`), instead of just a checkmark. Ties
  into how quantities get resolved per print (see `allocateQty`/
  `customAllocation` in `src/App.jsx`).
- For any of these: since there's no image-generation tool available, build
  a few live interactive CSS/JS variants side by side (an HTML page the user
  can click through) rather than static mockups — works well since all of
  this is code, not illustration.

## The UX rethink (its own focused pass, not a quick tweak)

Flagged as a real layout problem, not something to patch incrementally:

- Too much empty space on desktop.
- Start Over / Feedback buttons sit in the top corners — far from where the
  user's attention/hands are during the actual flow.
- On cards with a lot of printings, reaching Next/Previous means scrolling
  a long way down; worse on mobile.
- General principle from the user: "less work for the user" — buttons
  closer/faster to reach matters more than information density.

**Folded into this pass:** use the empty PC-only space productively by
showing the card's oracle text, keywords, mana cost, kicker cost, etc.
alongside the art grid. Likely PC-only (not enough room on mobile).
**Scope note:** this isn't just a layout change — `shared/manifest.js`
currently strips printings down to just image/prices/set info before
writing to KV (see `leanPrinting()`). None of the oracle-text/keyword/mana
cost fields ride along today. Showing them means extending what the
manifest carries, then manually redeploying `worker/` and rebuilding the KV
index (see `DEPLOY.md` step 2 / `worker/README.md`) — same category of
change as the deferred "add release year to the Secret Lair display" idea.

## Save / share a finished list

Needs a backend piece — a KV-backed short link (`/s/<id>` style), not just
cramming the whole selection state into a URL query string. Reuse the
`MANIFEST_KV` binding with a distinct key prefix, or a separate namespace.

## Priority set list

Let the user specify a priority order of sets (e.g. "always show Secret
Lair prints first, if any exist") that sorts the review-screen art grid.
Should support multiple sets/tags, in priority order.

- User's instinct: a tag-picker (type-ahead chips for set codes/names) beats
  free-text input — avoids typos/invalid codes, can validate against real
  set data already available from Scryfall.
- Open design question for whenever this gets built: global default
  (applies to every card) vs. per-list vs. per-card override. Probably
  global with a per-card override, but not decided.

## Explicitly shelved (not "later," actually decided against)

- **Hero image** — the old `hero.png` was deleted; it was generic
  placeholder art unrelated to the app's identity. Not reusing it. A new
  hero image idea would start from scratch if one ever comes up.
- **TCGplayer precon auto-import via URL** — confirmed dead end. The
  precon deck page is a JS-rendered SPA with nothing in the raw HTML, and
  its "Export" button builds the text file client-side via a `data:` URI —
  there's no fetchable endpoint to hit. The shipped alternative (a landing-
  page hint pointing people at TCGplayer's own Export → Download Deck Text
  File button, since that format already matches this tool's input format
  exactly) is the intended solution, not a stopgap.
- **Direct "add to cart" URL via TCGplayer product/SKU IDs** — confirmed
  dead end. TCGplayer's actual add-to-cart call is a session-authenticated
  POST to a private `mpgateway.tcgplayer.com` endpoint keyed by seller-
  specific `sku` + `sellerKey`, not the `productId` this app has from
  Scryfall — there's no public equivalent. The pre-filled Mass Entry link
  (`buildMassEntryPrefillUrl` in `src/App.jsx`) is the practical ceiling.
