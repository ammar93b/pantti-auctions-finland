# Spec: Auction reading and advice

Use the following specification as your single source of truth.
Do not make assumptions about any requirement not listed here.

## Feature

Read one weekly Pantti auction (coin and silver lists), value every lot from its own table of weights and fineness at today's spot price, and, on Tuesday, read each lot's live bid state to say whether its next legal bid is within the owner's limit.

## Overview

Code only, no AI: the auction's own table gives weight and fineness, the public bid feed gives the bid, and fixed rules decide. Anything unclear is "check by hand", never guessed (owner decision, 17 Oct 2026).

**Auction number and window** (Helsinki time, computed with `Intl` in `Europe/Helsinki` whatever the computer's clock)
- Reference: auction **966** opened **Friday 16.10.2026 17:00**. The auction whose Friday is *F* is numbered `966 + (F − 16.10.2026) / 7 days` (`config.reference`).
- Window: Friday 17:00 ≤ now < the following Tuesday 18:00.
- `opens` = Friday 17:00, `adviseAt` = Tuesday 17:00, `closes` = Tuesday 18:00.
- `auctionAt(now)`: the auction whose window contains now, or none. With `{ any: true }`: the most recent auction that **has opened** (before Friday 17:00 that is last week's).

**Web requests** (`src/http.js`)
- Header `User-Agent` of a desktop Chrome, `Accept-Language: fi-FI,fi;q=0.9,en;q=0.8`; time limit 30 s each.
- **Retries:** a failed request (time-out, network error, HTTP 5xx or 429) is tried again after 5 s, then 15 s: three tries in all. HTTP 4xx other than 429 is not retried. Then it fails with `<host> answered <status>` or the error message. (On 20 Oct 2026 one silver list request timed out once; this keeps such a hiccup from delaying the advice.)
- 1 s pause between requests to Pantti (`config.requestDelayMs`).

**Lists**
- `GET https://huutokauppa.pantti.fi/huutokauppa/<auction>/?category=<cat>&page=<p>&sort=default&search=`, `p` from 0. Categories (`config.categories`): coins 5, silver 2.
- Read pages until a page adds no new lots (at most 40 pages).
- A category with no lots is not an error. An auction with no lots in **either** list fails: `Pantti auction <n> has no lots (the number changed or it is not open yet)`.
- Each lot block (`div.col-12.col-sm-6.col-xl-4.item`):

| Field | From |
|---|---|
| `id` | `span.item_id` |
| `url` | the lot link `huutokauppa/<n>/…`, made absolute |
| `ends` | `span.ends` text ("päättyy 20.10. klo 18:05") |
| `startingPrice` | `span.start-price` reads "Lähtöhinta" (no bids yet) |
| `listPrice` | `span.price`: spaces and thousands dots removed, comma as decimal ("1 200 €" → 1200, "12,50 €" → 12.5) |
| `parts` | each `tr` of `div.info > table`: `{ desc, weight, fine }` |

- HTML text: tags removed, entities decoded (named, decimal, hex; out-of-range numbers kept as written), spaces collapsed.

**Fineness codes** (`parseFineness`)

| Code | Fineness | BR |
|---|---|---|
| `H925`, `H830`, `585` | 0.925, 0.830, 0.585 | no |
| `H925BR`, `585BR` | 0.925, 0.585 | yes (gross weight) |
| `999,9`, `9999` | 0.9999 | no |
| `1000` | 1.000 | no |
| anything else (`HOP`, empty) | not stated | — |

**Metal from the row's description** (`metalOf`)
- Plated, gilded or not solid (`kullattu`, `kultaus`, `hopeoitu`, `kultapinnoi`, `hopeapinnoi`, `päällys`, `pinnoite`, `täytetty`, `plated`, `vermeil`, `setel`, `kopio`, `replik`): no metal.
- Both a silver word (`hope`) and a gold word (`kulta`, `kulla`, `gold`): no metal (e.g. a silver ring with a gold stone).
- `hope…` → silver; `kulta…`, `kulla…`, `gold` → gold.

**Valuation** (`valueLot`)
- Every row must state metal, fineness and weight (> 0 g), and all rows the same metal. Otherwise **check by hand** with the reason: `metal not stated (…)`, `fineness not stated (…)`, `weight not stated`, `gold and silver in one lot`, `no weight in the listing`.
- **BR rows:** silver counts only its share of the gross weight, `config.brSilverShare` = **0.35** (owner, 17 Oct 2026: 1000 g of 830 BR = 350 g silver = 290.5 g fine). A BR **gold** row is check by hand: `gross (BR) gold: the gold share is not known`.
- `fineG` = Σ (weight × [BR share] × fineness), 4 decimals. `meltEur` = `fineG` × spot €/g of the metal, to the cent.

**Spot** (`src/spot.js`): `https://api.gold-api.com/price/XAU` and `/XAG` (USD per troy ounce) × the ECB rate from `https://api.frankfurter.dev/v1/latest?from=USD&to=EUR`; €/g = €/oz ÷ 31.1035. Missing or zero → the run fails (never an old price).

**Bid feed** (Tuesday only, one lot at a time)
- `GET <lot url>`; read `pageitemid = <number>` (the internal item id).
- `POST https://huutokauppa.pantti.fi/ajax/bid.json`, form `mode=getBids&item=<id>`, headers `X-Requested-With: XMLHttpRequest` and `Referer: <lot url>`. The same call the lot page makes.
- Read `status` ("ok"), `data.bid_start`, `data.top_bid` (0 = no bids), `data.min_raise`, `data.timeleft` (seconds), `biddingallowed`.
- Verified 17 Oct 2026, lot 190: start 180, top 200, raise 10 → next legal bid 210 €. The page's own "Minimikorotus" field is stale and is never used.
- A lot that fails here becomes `check` with the error; other lots go on.

**Limit, next bid and verdict**
- **Limit** = `meltEur × cap`, rounded **down** (to 10 cents under 100 €, whole euros from 100 €). `cap` = 1.10 for coins, 1.00 for silver (`config.capOverMetal`).
- **Next legal bid** = `top_bid + min_raise` if `top_bid` > 0, else `bid_start`.
- **Distance to spot** = next bid ÷ `meltEur` − 1.

| Verdict | When |
|---|---|
| `buy` | valued, bidding allowed, time left > 0, next bid ≤ limit |
| `skip` | valued, next bid > limit |
| `closed` | bidding not allowed or time left ≤ 0 |
| `check` | not valued, or no bid data |

## Acceptance criteria

- [ ] Auction 966 from Friday 16.10.2026 17:00 Helsinki (14:00 UTC, summer time) until Tuesday 20.10.2026 18:00; 967 from Friday 23.10.2026 17:00; 968 from Friday 30.10.2026 17:00 (15:00 UTC, winter time).
- [ ] With the saved pages: 30 + 8 coin lots, 30 silver lots on page 1; lot 190 has one row `2 KULTARAHAA · 1,7 · 999,9`; lot 15 has four rows.
- [ ] Lot 190 is 1.6998 g fine gold; lot 15 values its three BR rows at 35 %.
- [ ] `1000 g, H830BR` alone is 290.5 g fine silver; `10 g, KULTAKORU, H585BR` is check by hand.
- [ ] Bid feed fixture (top 200, raise 10) → next 210; no bids, start 240 → next 240.
- [ ] A coin with next bid above 1.10 × metal value is `skip`; silver above 1.00 × metal value is `skip`.
- [ ] A request that times out twice and then works is not an error.

## Out of scope

- Collector value, condition, photos.
- Other auction houses or categories.
- Placing bids.

## Edge cases

- **Pantti changes its page layout:** the lists parse to nothing → "has no lots" → a failure message (03). Fix the parser and the saved test pages together.
- **A lot closes one minute after its last bid** (Pantti rule): the advice is a snapshot at the time of the run; the next legal bid may have moved by the time the owner bids.
- **A wrong auction number** (Pantti skipped a week): "has no lots"; change `config.reference` to a known auction and its Friday.
- **Lots with no listed price:** valued, shown last in the Friday list.

## Security impact

Read-only use of public pages and one public endpoint, about 400 requests per Tuesday, one at a time.

## Threat modeling

| Threat | Mitigation |
|---|---|
| A lot description leads to a wrong high metal value | Each row needs metal, fineness and weight stated; plated words and mixed metals block valuation; unclear = check by hand |
| A stale or odd bid feed leads to a bad advice | The verdict is capped by the owner's limit; the owner bids by hand and sees the live price |
| Heavy use gets the agent blocked | 1 s between requests, retries only after 5 s and 15 s |
