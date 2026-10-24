# Spec: Item categories and limits

Use the following specification as your single source of truth.
Do not make assumptions about any requirement not listed here.

## Feature

Sort every lot from every list into one of the owner's four categories, give each category its own limits (kept private in `.env`), and leave out the lots the owner does not want.

## Overview

Both sites sell four kinds of things the owner buys (owner, 25 Oct 2026):

| # | Key | Category | What it is |
|---|---|---|---|
| 1 | `goldCoins` | **Gold coins & bars** | gold coins, bars, ingots, medals |
| 2 | `silverCoins` | **Silver coins & bars** | silver coins, bars, medals |
| 3 | `junkGold` | **Junk gold** | gold jewellery, broken pieces, dental gold, other gold items |
| 4 | `junkSilver` | **Junk silver** | cutlery, silverware, other silver items |

**Lists read** (`config.js`; `{auction}` = the week's auction number at Helsingin Pantti). Every link was opened on 25 Oct 2026.

| Site | List (`metal`) | Link | Lots on 25 Oct | Feeds |
|---|---|---|---|---|
| Helsingin Pantti | coins & medals (both) | `https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=5` | 48 | 1, 2 |
| Helsingin Pantti | silver (`silver`) | `https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=2` | 134 | 4 (a coin in it: 2) |
| Helsingin Pantti | gold jewellery (`gold`) | `https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=1` | 885 | 3 (a coin in it: 1) |
| Suomen Panttilaina | gold / other, sub 8 (`gold`) | old `https://www.suomenpanttilaina.fi/huutokauppa/?product_category=1&product_sub_category=8` · new `https://shop.suomenpanttilaina.fi/auction?SelectedProductSubCategories=8` | 48 | 1 (other gold items: 3) |
| Suomen Panttilaina | silver / other, sub 21 (`silver`) | old `…/huutokauppa/?product_category=3&product_sub_category=21` · new `…/auction?SelectedProductSubCategories=21` | 62 | 2 (other silver items: 4) |
| Suomen Panttilaina | silver / cutlery, sub 14 (`silver`) | old `…/huutokauppa/?product_category=3&product_sub_category=14` · new `…/auction?SelectedProductSubCategories=14` | 42 | 4 |
| Suomen Panttilaina | gold, all subcategories (`gold`) | old `…/huutokauppa/?product_category=1&product_sub_category=` · new `…/auction?SelectedProductCategories=1` | 308 | 3 (coins and bars in it: 1) |

The new site (`shop.suomenpanttilaina.fi`) listed no lots on 25 Oct 2026; each of its links selects the right category. A lot that is in two lists of a site (gold / other is inside "gold, all") is read once, from the first list.

**Metal:** Helsingin Pantti from each row (spec 02); a list with `metal` keeps only lots of that metal (others are left out, also check-by-hand lots whose text does not name the metal). Suomen Panttilaina: the list's `metal` (spec 04).

**Coins & bars or junk** (`categoryOf`, `isCoinText`): by the lot's own text, whatever list it came from.
- Coins & bars when the text has `raha` (kultaraha, hopearaha, juhlaraha, rahasarja), `kolikk`, `dukaat`, `harkko`, `laatta`, `unssi`, `oz`, `sovereign`, `krugerrand`, `dollari`, `rupla`, `mitali`, `markka`, `mk`. At Helsingin Pantti every row must have one (a lot mixing coins and spoons is junk).
- Everything else of that metal: junk.

**Not gold or silver, or not the list's metal** (found on 25 Oct 2026)
- Palladium, platinum, bronze, brass and nickel silver (`palladi`, `platin`, `pronssi`, `messinki`, `uushopea`, `alpakka`): left out.
- Makers' names are not metal words: `Kultakeskus`, `kultaseppä` (a Kultakeskus necklace in 925 is silver).
- The fineness must exist for the metal: gold 333, 375, 417, 500, 583, 585, 750, 875, 900, 916/917, 958, 986, 990, 995, 999, 999.9, 1000; silver 300–1000 except 375 / 583 / 585. A silver fineness (925, 830, 813) in a gold list: left out; a gold fineness in a silver list: check by hand.
- Gold colours between fineness and weight are allowed: `750 valkokulta, Paino: 6,1 g`, `585 kelta- ja valkokulta, Paino: 2 g`.
- `laatta` alone is a bar; `Laatta-ranneketju` is a flat-link bracelet (junk).

**Left out completely** (not valued, not counted, never in a message; owner, 25 Oct 2026)
- **Gross-weight gold** (`br` / `BR` with a gold fineness), in any category.
- **Gold rings and earrings with stones:** the text (or the site's subcategory "Sormukset" / "Korvakorut") names a ring (`sormus`) or earrings (`korvakoru`, `korvarengas`, `korvanappi`, `korvikset`) and a stone (`kivi`, `timantti`, `briljantti`, `helmi`, `ct`, `safiiri`, `rubiini`, `smaragdi`, `zirkoni`, `opaali`, `granaatti`, `topaasi`, `ametisti`) or `br`.
- **Small lots:** metal value under `config.minMetalEur` (**30 €**), not worth a pickup trip.
- At Helsingin Pantti's gold jewellery list: everything that is not gold (silver, bronze).

**Limits** (owner, 25 Oct 2026). In `.env`, never uploaded, so the owner's own numbers are not in this repository; each in % of the lot's metal value, from −50 to 100; not set = 0:

| Category | `.env` keys | Example | Meaning of the example |
|---|---|---|---|
| Gold coins & bars | `GOLD_COINS_MAX_PCT` (+ optional `_ALERT_PCT`) | 5 | 🟢 and max bid up to +5 % |
| Silver coins & bars | `SILVER_COINS_MAX_PCT` (+ optional `_ALERT_PCT`) | 5 | the same |
| Junk gold | `JUNK_GOLD_MAX_PCT`, `JUNK_GOLD_ALERT_PCT` | 0, −5 | 🟢 only at 5 % or more below metal value; max bid never above it |
| Junk silver | `JUNK_SILVER_MAX_PCT`, `JUNK_SILVER_ALERT_PCT` | 0, −5 | the same |

The owner's principle (25 Oct 2026): buy below spot; junk never above metal value; coins and bars may go a little over it.

- `max` = metal value × (1 + MAX/100), `buyAt` = metal value × (1 + ALERT/100), both rounded down (spec 02). `ALERT` defaults to `MAX` and is never above it.
- A lot is 🟢 (`buy`) when the bid needed now ≤ `buyAt`. Suomen Panttilaina's max bid is the highest legal amount up to `max` (spec 04); Helsingin Pantti shows the next bid and `max` as the limit.

**Messages** (spec 03): listed and reminder messages show the lots in four sections, in the order above, each with its count, its 🟢 count and its limits ("🟢 at −5 % · max 0 % vs metal"); empty sections are left out.

## Acceptance criteria

- [ ] "Kultaraha Frans Josef I, 4 dukaattia, 986, Paino: 14 g" and "Kultaharkko, Umicore, 9999, Paino: 10 g" → gold coins & bars.
- [ ] "Juhlaraha, 10 markkaa, 900, Paino: 24 g" (silver) → silver coins & bars; "Hopeinen tarjotin, Kultakeskus, 830, Paino: 400 g" → junk silver.
- [ ] "Viisi kahvilusikkaa, 813, Paino: 39,8 g" → junk silver; "Vialliset koruja, 585, Paino: 17 g" and "Sileä sormus, 585, Paino: 1,3 g" → junk gold.
- [ ] "Kivisormus, 585br, Paino: 4,1 g", "Timanttisormus 7xn.0.05ct, 585, Paino: 4,2 g" and "Helmikorvakorut, 585, Paino: 13,9 g" are left out; so are "Kolmet korvakorut, 925br, Paino: 5,3 g" (2.28 € of silver) and a silver chain in Helsingin Pantti's gold list.
- [ ] Junk silver worth 925 €: 🟢 at 878 €, max bid 920 €; asking 900 € is not 🟢.
- [ ] `.env` `JUNK_GOLD_MAX_PCT=0`, `JUNK_GOLD_ALERT_PCT=-5` → max 0 %, 🟢 at −5 %; `ALERT=10` with `MAX=0` → 🟢 at 0 %; unset → 0 %.

## Out of scope

- Collector or design value (a coin's numismatic premium, a Wirkkala tray): the limits are metal-based only.
- Other metals (platinum, bronze).

## Edge cases

- **A coin in a junk list** (a commemorative coin in Helsingin Pantti's silver list): goes to coins & bars by its text.
- **Single small silver coins:** a 25 markkaa coin (500 silver, 26.7 g) holds about 21 € of silver, under the 30 € minimum, so it is left out; lots of several coins usually pass.
- **Check-by-hand lots** (no weight or fineness) have no category; they are only counted.

## Security impact

The owner's limits stay in `.env` (git-ignored), not in the public repository. Two more lists per site per listing check; at Helsingin Pantti the bid feed is read only for lots that may be 🟢.

## Threat modeling

| Threat | Mitigation |
|---|---|
| A junk lot is advised with the coin limit | The category is decided by the lot's own text; a mixed lot is junk |
| Unwanted rings, earrings and br gold fill the messages | Left out completely before they are counted |
| The owner's buying limits become public | Limits only in `.env`; `.env.example` has empty values |
| 885 gold lots make reminders slow or get the agent blocked | Bid feed only for lots whose list price may be 🟢; 1 s between requests |
