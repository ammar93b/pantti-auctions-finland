# Spec: Item categories

Use the following specification as your single source of truth.
Do not make assumptions about any requirement not listed here.

> **Status (25 Oct 2026):** structure agreed with the owner; code follows after the owner sets the limits (open points at the end).

## Feature

Sort every valued lot from every list into one of the owner's four categories, each with its own limit, and leave out the gold rings and earrings with stones that the owner does not want.

## Overview

Both sites sell four kinds of things the owner buys (owner, 25 Oct 2026):

| # | Category | What it is |
|---|---|---|
| 1 | **Gold coins & bars** | gold coins, bars, ingots, medals |
| 2 | **Silver coins & bars** | silver coins, bars, medals |
| 3 | **Junk gold** | gold jewellery, broken pieces, dental gold, other gold items |
| 4 | **Junk silver** | cutlery, silverware, silver jewellery, other silver items |

**Lists read** (`config.js`; `{auction}` = the week's auction number at Helsingin Pantti)

| Site | List | Link | Gives |
|---|---|---|---|
| Helsingin Pantti | coins & medals | `https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=5` | 1 and 2 (metal per row) |
| Helsingin Pantti | silver | `https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=2` | 4 (a coin in it goes to 2) |
| Helsingin Pantti | jewellery (gold) | `https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=1` | 3 (silver pieces in it: open point 1) |
| Suomen Panttilaina | gold / other (8) | old `…/huutokauppa/?product_category=1&product_sub_category=8` · new `…/auction?SelectedProductSubCategories=8` | 1 (other gold items in it go to 3) |
| Suomen Panttilaina | silver / other (21) | old `…/huutokauppa/?product_category=3&product_sub_category=21` · new `…/auction?SelectedProductSubCategories=21` | 2 (other silver items in it go to 4) |
| Suomen Panttilaina | silver / cutlery (14) | old `…/huutokauppa/?product_category=3&product_sub_category=14` · new `…/auction?SelectedProductSubCategories=14` | 4 |
| Suomen Panttilaina | gold, all subcategories (1) | old `…/huutokauppa/?product_category=1&product_sub_category=` · new `…/auction?SelectedProductCategories=1` | 3 (coins and bars in it go to 1) |

Old site = `https://www.suomenpanttilaina.fi`, new site = `https://shop.suomenpanttilaina.fi`. The gold "all" list also holds every lot of gold / other: a lot in two lists is counted once (by lot number).

**Metal:** Helsingin Pantti from each row (spec 02); Suomen Panttilaina from the list's `metal` (spec 04). Valuation as before (specs 02, 04).

**Coins & bars or junk** (`categoryOf`): by the lot's own text, whatever list it came from.
- Coins & bars: `raha` (kultaraha, hopearaha, juhlaraha, rahasarja), `kolikko`, `dukaat`, `markka` / `markkaa` (as a coin), `harkko`, `laatta`, `unssi` / `oz`, `sovereign`, `krugerrand`, `dollari`, `rupla`, `mitali`.
- Everything else of that metal: junk.

**Left out: gold rings and earrings with stones** (owner, 25 Oct 2026)
- A **gold** lot that is a **ring** (`sormus`, the site's subcategory "Sormukset") or **earrings** (`korvakoru`, `korvarengas`, `korvanappi`, `korvikset`, subcategory "Korvakorut") **and** has a stone or gross weight (`br` / `BR`, `kivi`, `timantti`, `briljantti`, `helmi`, `ct`, `safiiri`, `rubiini`, `smaragdi`, `zirkoni`, `opaali`, `granaatti`, `topaasi`, `ametisti`) is left out completely: not valued, not counted, not in any message.
- Other gross-weight gold (a pendant or brooch with a stone) stays **check by hand** (spec 02).

**Limits** (`config.categories`): limit = metal value × the category's `maxOverSpot`, rounded down (spec 02). Until the owner sets them (open point 3), each category keeps the current limit of its metal: gold coins & bars 1.05, silver coins & bars 1.03, junk gold 1.05, junk silver 1.03.

**Messages** (spec 03): the listed and reminder messages show the lots in four sections, in the order above, each with its own 🟢 lines and counts. Sections with no lots are left out.

## Acceptance criteria

- [ ] "Kultaraha Frans Josef I, 4 dukaattia, 986, Paino: 14 g" → gold coins & bars; "Kultaharkko, Umicore, 9999, Paino: 10 g" → gold coins & bars.
- [ ] "Juhlaraha, 10 markkaa, 900, Paino: 24 g" in silver / other → silver coins & bars; "Hopeinen tarjotin, 830, Paino: 400 g" in silver / other → junk silver.
- [ ] "Viisi kahvilusikkaa, 813, Paino: 39,8 g" (cutlery) → junk silver; "Viallisia koruja, 585, Paino: 17 g" → junk gold.
- [ ] "Kivisormus, koko 18, 585br, Paino: 4,1 g", "Timanttisormus …, 585, Paino: 4,2 g" and "Helmikorvakorut, 585br, Paino: 13,9 g" are left out; "Sileä sormus, 585, Paino: 1,3 g" → junk gold.
- [ ] A lot in both gold / other and gold (all) appears once.
- [ ] Each category uses its own `maxOverSpot`.

## Out of scope

- Collector or design value (a coin's numismatic premium, a Wirkkala tray): the limits are metal-based only.
- Other metals (platinum, bronze).

## Edge cases

- **A coin in a junk list** (a silver commemorative coin in Helsingin Pantti's silver list): goes to coins & bars by its text.
- **A lot whose rows mix coins and jewellery** (Helsingin Pantti): coins & bars only when every row is a coin or bar; otherwise junk.
- **A word inside another word** ("raha" in "rahakas"): words are matched at the start of a word or as the known compounds above.

## Open points (owner)

1. Helsingin Pantti's category 1 is its **jewellery** list: gold, silver (`H925BR`, `TH925`) and bronze. Proposed: gold → junk gold, silver → junk silver, other metals left out silently.
2. Medals (`mitali`) counted with coins & bars. Proposed: yes.
3. **The four limits.** Proposed from 500 closed Suomen Panttilaina lots per list (20 Oct 2026): gold coins & bars +10 % (contested lots closed at about +12 %), silver coins & bars +3 % (closed at about spot), junk gold and junk silver below spot (the refiner pays below spot; for example −8 % and −15 %).
4. A smallest lot worth a pickup (for example 50 € metal value). Proposed: yes, per category.

## Security impact

None beyond specs 02 and 04: the same public pages, two more lists per listing check.

## Threat modeling

| Threat | Mitigation |
|---|---|
| A junk lot is advised with the coin limit | The category is decided by the lot's own text; a mixed lot is junk |
| An unwanted ring or earring with a stone fills the messages | Left out completely before valuation |
| More lists slow the run or get it blocked | 1 s between requests; listing checks hourly in the daytime |
