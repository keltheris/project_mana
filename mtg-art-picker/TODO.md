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

Confirmed which Scryfall card fields to pull in when this gets built —
`oracle_text` cleanly excludes flavor text already, no filtering needed:
- `oracle_text` — rules text only (abilities separated by `\n`), flavor
  text lives in the separate `flavor_text` field and can just be ignored
- `mana_cost` — e.g. `"{1}{U}{B}{R}"`
- `power` / `toughness` — strings, creatures only
- `type_line` — e.g. `"Legendary Creature — Human Wizard"`
- `keywords` — array Scryfall already parses out, e.g. `["Flying"]`
- `cmc` — converted mana cost as a number, useful for sorting/filtering
- Double-faced/split cards: these fields can live under `card_faces[0]`/
  `card_faces[1]` instead of top-level — same fallback pattern
  `leanPrinting()` already uses for `image_uris` should apply here too
  (`card.oracle_text ?? card.card_faces?.[0]?.oracle_text`).

## Save / share a finished list

Needs a backend piece — a KV-backed short link (`/s/<id>` style), not just
cramming the whole selection state into a URL query string. Reuse the
`MANIFEST_KV` binding with a distinct key prefix, or a separate namespace.

## Order-received checklist (exploratory — no direction chosen yet)

Friend's feature request, relayed by the user: after buying cards through
this tool, let them check items off as they physically arrive in the mail
— useful because TCGplayer orders often ship from multiple sellers over
1–3 weeks, so "did I get everything" is a real multi-week tracking problem,
not a one-sitting task.

**This is intentionally not scoped to a quick win.** The user wants to
weigh the options for real before building, not just take the cheapest
path. Revisit and actually decide before writing code.

Worth noting up front: the UI half-exists already. The "mark done" checkbox
list on the results page (`doneChecks` state, next to the direct TCGplayer
links — see `App.jsx`) is functionally the same checklist. Today it only
lives in React state, so it's gone on refresh/tab close. The open question
is entirely about *persistence*, not the checklist UI itself.

Options on the table, no favorite yet:

- **localStorage.** Free, no backend, no new data-retention questions.
  Works for the common case (checking off mail on the same laptop/phone
  over a couple weeks). Breaks on clearing browser data, switching
  devices/browsers, or private/incognito mode. Needs a stable key to
  reconnect to the right checklist later — e.g. hashing the list's
  contents — since there's no session/account concept in this app.
- **URL-encoded state.** Cram the checked/unchecked bits into the URL
  itself (15 items is a couple bytes even before encoding). Shareable and
  bookmarkable without a backend. Every checkbox click has to rewrite the
  URL (via `history.replaceState`), and it's really "whoever has this
  exact link," not a synced account — closer to a snapshot than a
  persistent record.
- **Backend-persisted via a short link.** Same underlying infrastructure
  as "Save / share a finished list" above — if that KV-backed `/s/<id>`
  link gets built, the received-checklist state could just ride along as
  more data on that same saved record. Durable, works across devices,
  no separate system needed. Costs: needs that backend to exist first,
  and it's a step up in data sensitivity (storing "here's what this
  person bought and when they got it" server-side, even under an
  unguessable link) versus everything else this app currently stores.
- **Export/import a small file.** User downloads a tiny JSON/text
  snapshot of their checklist, re-uploads it later or on another device.
  Zero backend, zero server-side data retention, works cross-device in
  principle — but puts the file-management burden on the user, which is
  real friction for a casual tool.

Open scoping questions, not just implementation ones:

- Does this need to be tied to a finished decklist at all, or could it be
  a standalone generic checklist utility (paste any list of line items,
  get a persistent checklist)? The friend's original framing ("create an
  interactable HTML page that has a checklist") reads more generic than
  "a feature of the decklist flow."
- If tied to a decklist: does the checklist track per-*line* (each
  printing) or per-*card* (the original entry, e.g. one checkbox for "5
  Island" rather than tracking each unit)? Probably per-line, matching
  what's already shipped, but worth confirming against the actual friend
  use case (do they think in terms of packages/products, or exact
  quantities?).
- Multi-seller reality: a TCGplayer order can arrive as several separate
  packages. Does "received" need a partial-quantity concept (e.g. "3 of
  the 5 Islands arrived") or is a binary checkbox enough?

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
