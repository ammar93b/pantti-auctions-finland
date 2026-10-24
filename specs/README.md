# Pantti auctions Finland: specifications

These files fully specify Pantti auctions Finland: a small program that watches the online auctions of two Finnish pawnshops for **gold and silver** and sends phone messages through ntfy:

- **Helsingin Pantti** (huutokauppa.pantti.fi): one auction a week, Friday 17:00 → Tuesday from about 18:05.
- **Suomen Panttilaina** (suomenpanttilaina.fi): four offices, each with an auction every two weeks, lots closing from 19:00.

Lots are sorted into the owner's **four categories**: gold coins & bars, silver coins & bars, junk gold and junk silver, each with its own limit (spec 05).

For every auction the owner gets **one message when it is listed**, then **reminders before it closes** (by default 10 h and 30 min before the first watched lot closes), with every lot valued by its own weight and fineness at today's spot price and the most to bid.

It is **not** an always-on service. The operating system starts it every few minutes; each run works out in Helsinki time what is due, does it and exits. A run with nothing due reads nothing from the internet. It uses no AI.

Every spec follows the owner's back-end template, `_spec-template.md` (project root). Each starts with the same rule: it is the single source of truth, and nothing outside it may be assumed.

| # | Spec | What it covers |
|---|---|---|
| 01 | [Environment and schedule](01-environment-and-schedule.md) | Requirements, files, `.env`, `config.js`, commands, the scheduled runs (launchd / systemd), lock, logs |
| 02 | [Helsingin Pantti](02-auction-reading-and-advice.md) | Auction number and window, list pages, lot tables, fineness codes, BR lots, valuation, the bid feed, limits, verdicts |
| 03 | [Messages and state](03-messages-and-state.md) | Listing checks, reminders, the messages, the state file that makes each message go out once, failure alerts |
| 04 | [Suomen Panttilaina](04-suomen-panttilaina.md) | Old and new site lists, lot text, offices, bid steps, max bid, auctions by office and day |
| 05 | [Item categories and limits](05-categories.md) | The four categories, the lists that feed them, coins-or-junk by text, what is left out, the limits in `.env` |

## Words used in every spec

- **Owner**: the single user. Runs the agent on their own Mac or Raspberry Pi.
- **Site**: one auction website (a "source" in the code): `pantti` or `panttilaina`.
- **Auction**: Helsingin Pantti's weekly auction (966, 967, …), or one Suomen Panttilaina office's auction day (Vuosaari 26.10.).
- **Lot**: one item for sale, with its weight and fineness.
- **Closing time** of an auction: when its first watched lot closes.
- **Metal value**: fine grams × today's spot price in euros per gram.
- **Category**: gold coins & bars, silver coins & bars, junk gold or junk silver (spec 05).
- **Limits**: per category, in `.env`: the most the owner bids (max) and the price at which a lot is marked 🟢 (spec 05).
- **Next bid**: the lowest bid the site accepts now.
- **Max bid** (Suomen Panttilaina): the highest legal bid amount not above the limit; the site bids for the owner up to it.

## Owner decisions

- 17 Oct 2026: metal content only from the listing itself, never from guesses or AI; unclear lots are "check by hand". Advice only: the agent never bids.
- 20 Oct 2026: BR (gross-weight) silver counts 30 % of its weight as silver. Own public repo, own ntfy topic, no always-on service.
- 21 Oct 2026: Suomen Panttilaina added: only **gold / other** (subcategory 8) and **silver / other** (subcategory 21), where the coins and bars are. The owner always picks up, so shipping is never added to the limit.
- 21 Oct 2026: limits gold +5 %, silver +3 % over metal value (replaced on 25 Oct by the limits per category).
- 21 Oct 2026: messages for every auction: **once when listed**, then **10 h** and **30 min** before closing. Times and links are settings in `config.js`.
- 21 Oct 2026: repository renamed from `helsingin-pantti-agent` to `pantti-auctions-finland`.
- 25 Oct 2026: **four categories**: gold coins & bars, silver coins & bars, junk gold, junk silver, each with its own limit. New lists: Helsingin Pantti category 1 (gold jewellery), Suomen Panttilaina silver cutlery (14) and all gold (category 1). **Gold rings and earrings with stones or br are left out.** Limits per category in `.env` (private, not in the repo): junk never above metal value and 🟢 only well below it; coins and bars may go a little over. **All gross-weight (br) gold is left out**; Helsingin Pantti's jewellery list: gold only; lots under **30 €** of metal left out.
- No secrets in the public repo: the ntfy topic and the data stay on the owner's computer.

## Keeping these specs current

When the agent changes, update the matching spec here, `README.md` and `docs/architecture.*` in the same change, run `npm test`, then commit and push.
