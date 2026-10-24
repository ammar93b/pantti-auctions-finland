# Spec: Suomen Panttilaina

Use the following specification as your single source of truth.
Do not make assumptions about any requirement not listed here.

## Feature

Read Suomen Panttilaina's gold / other and silver / other auction lists on its old and new sites, value every lot from the weight and fineness in its text, group the lots into auctions by office and day, and give for each lot the max bid to set within the owner's limit.

## Overview

Suomen Panttilaina (suomenpanttilaina.fi) has four offices. Each holds an online auction every two weeks on its own weekday; lots are listed about two weeks ahead and close one by one from 19:00, 30 s apart. A bid in the last 30 s adds 30 s. Bidders can leave a **max bid** that the site raises step by step for them. There is no buyer's fee; the owner always picks up, so shipping is never part of the limit (owner, 21 Oct 2026). Lists read (owner, 21 and 25 Oct 2026): **gold / other (8)** and **silver / other (21)**, where the coins and bars are; **silver / cutlery (14)** and **all gold (category 1)** for junk silver and junk gold. How lots are sorted into the four categories, and the gold rings and earrings that are left out: spec 05.

Facts from the site (studied 20–21 Oct 2026, auction terms page and site scripts):

| Office (lot number prefix) | Weekday | Pickup |
|---|---|---|
| Hakaniemi (FI1) | Thursday | Hämeentie 8, Helsinki |
| Vuosaari (FI2) | Monday | Vuotie 45, Helsinki |
| Myyrmäki (FI3) | Wednesday | Iskoskuja 3 A 1, Vantaa |
| Kaivopiha (FI4) | Tuesday | Kaivokatu 10, Helsinki |

The agent does not depend on these weekdays: it reads whatever is listed.

**Lists** (`config.sources.panttilaina.lists`): each has a `name`, a `metal` (`gold` or `silver`: every lot of the list is that metal), a `url` on the old site and a `newSiteUrl` on the new one. Both are read; a lot on both is taken from the new site. A list failing on one site is fine when another answered; when none answered, the check fails.

**Old site (Huutokauppa 1.0, in use until 2 Nov 2026)**
- `GET <url>` with `length=100`, `offset=0,100,…` and `listTyp=lista` set; pages until all hits ("Osumat: <n>") are read or a page adds nothing. 1 s between pages.
- Each `div.item-container`:

| Field | From |
|---|---|
| `number` | `p.auktionsnummer` "Huutokaupan numero: FI3.20261021.A27842" (must match `FI<n>.<yyyymmdd>.`) |
| `url` | `https://www.suomenpanttilaina.fi/huutokauppa/huutokaupan-numero/?f_id=<f_id>` (hidden input `f_id`) |
| `desc` | `a.vara` text |
| `nowPrice` | `p.current-bid` |
| `next` | hidden input `start_bud`: the site's minimum next bid (start price without bids; current + step with bids) |
| `bids` | `span.num-bids` ("-" = 0) |
| `closesAt` | `data-closing-datetime` ("2026-10-21 19:08:30", Helsinki time) |
| `siteCategory`, `office` | the two `span`s of `.office-type` ("Kulta / Muut", "Myyrmäen Pantti") |

**New site (Huutokauppa 2.0, the only one from 3 Nov 2026)**
- `GET <newSiteUrl>` (`https://shop.suomenpanttilaina.fi/auction?SelectedProductSubCategories=8` / `21` / `14`, and `?SelectedProductCategories=1` for all gold; the site selects that subcategory or category, verified 21 Oct 2026).
- The lots are JSON in `<script id="auction-items-json">`. Fields (from the site's own `auction-list.js`, `auction-data-presenter.js`, `bid-handler.js`): `number`, `heading`, `descriptionLong`, `amount`, `bidStartAmount` (the lowest bid the bid form allows: the next bid), `bidCount`, `closingTimeUtcSec`, `isOpen`, `category`, `officeName`. Lots with `isOpen: false` are left out. Link: the list page.
- **Not yet verified on real lots:** on 21 Oct 2026 the new site listed none. When it does, a page is saved as a test fixture and this reader is checked (field values, paging, lot links).
- robots.txt of the shop disallows only `/secure` and `/external`; neither is used.

**Lot text → metal content** (`partOf`, `valueText`)
- Plated or not solid words (as in 02): check by hand `plated or not solid metal`.
- A word of the other metal (gold list: `hope`; silver list: `kulta`, `kulla`, `gold`), not counting the makers' names `Kultakeskus` and `kultaseppä…`: `gold and silver in one lot`.
- Fineness and weight are the number right before "Paino:" and the weight after it: `…, 986, Paino: 14 g`, `500 Paino: 69,8 g`, `925br Paino: 66,9 g`, `kg` allowed. No "Paino:" → `no weight in the listing`; "Paino: 0 g" → `weight not stated (0 g)`; no number, or one below 0.333 for gold / 0.3 for silver (a year such as 1964) → `fineness not stated`.
- `br` = gross weight: silver counts `brSilverShare`; gold br is left out (spec 05). Then valued as in 02.

**Bid steps** (auction terms; the same rule as the site's `nextBidStep`): below 50 € +2, below 100 € +5, below 300 € +10, below 1000 € +20, below 2000 € +50, then +100, on a grid from the band's lower edge (50 → 55, 290 → 300, 1000 → 1050).

**Advice** (`adviseLot`)
- Limits of the lot's category (spec 05): `max` and `buyAt`, rounded down as in 02.
- **Max bid** = the highest amount reachable from `next` by bid steps that is not above `max`.

| Verdict | When |
|---|---|
| `buy` | valued, open, `next` ≤ `buyAt`; gives `maxBid`, `next`, `limit` (= `max`), distance to spot at `next` |
| `skip` | valued, `next` > `buyAt` |
| `closed` | its closing time has passed |
| `check` | not valued, or no next bid |

**Auctions** (`group`): lots grouped by office and day from the lot number (`FI2.20261026.…` → key `panttilaina-FI2-20261026`, title `Suomen Panttilaina Vuosaari 26.10.`, where `pickup at Vuosaari, Vuotie 45, Helsinki`, max bids). Closing time = the earliest lot `closesAt`. `listed` returns every auction with lots still open; `current` reads the lists again and keeps that auction's lots.

## Acceptance criteria

- [ ] Saved old-site lists: gold / other 63 lots, silver / other 87 lots; the first gold lot is `FI3.20261021.A27842`, "Kultamitali, Ø 16mm, 585, Paino: 1,5 g", 110 €, closes 21.10.2026 19:08:30, Myyrmäen Pantti.
- [ ] For every saved lot with bids, the list's next bid equals the step rule applied to the current bid.
- [ ] "4 dukaattia, 986, Paino: 14 g" (gold coins, max +5 %) is 13.804 g fine; at 100 €/g the limit is 1449 € and with next 1200 € the max bid is 1400 €.
- [ ] Max bid: limit 287 €, next 250 € → 280 €; limit 109.90 €, next 110 € → none.
- [ ] "Paino: 0 g", no weight, a year before "Paino", gold and silver words and plated words are check by hand; br gold is left out.
- [ ] The saved gold list groups into Hakaniemi 29.10., Vuosaari 26.10. (42 lots), Myyrmäki 21.10. and Myyrmäki 4.11.
- [ ] New-site JSON with one open and one closed lot gives one lot with next = `bidStartAmount`.

## Out of scope

- Other categories (watches, art, …) unless the owner adds a list in `config.js`.
- Logging in, placing max bids, shipping costs.
- Closed auctions and their prices.

## Edge cases

- **The old site is shut down (3 Nov 2026):** its requests fail or return nothing; the new site answers, so the check goes on.
- **The new site changes its page:** no lots are found; after 7 days without any lot, one warning (03).
- **A lot is withdrawn** (the borrower redeemed it): it is simply missing from the next read.
- **Lots added over several days:** handled by the "new lots" rule (03).
- **The 30 s extension:** lots may close later than listed; the advice is a snapshot, and the max bid keeps working after the message.

## Security impact

Read-only use of public list pages: two lists × two sites (about 4–6 requests) per listing check, the same per reminder, one at a time, 1 s apart.

## Threat modeling

| Threat | Mitigation |
|---|---|
| A wrong number in the text is read as the fineness | Only the number right before "Paino:", within a plausible range; else check by hand |
| A silver lot with gold parts is valued as solid silver | The other metal's word makes it check by hand |
| A max bid above the limit | Max bid is computed down from the limit on the site's own step grid |
| Heavy use gets the agent blocked | Listing checks hourly in the daytime; nothing read when nothing is due |
