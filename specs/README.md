# Helsingin Pantti agent: specifications

These files fully specify the Helsingin Pantti agent: a small program that watches the weekly online auction of Helsingin Pantti (huutokauppa.pantti.fi) and sends two phone messages per auction:

- **Friday 17:00:** the auction is open, with its coin and silver lots valued by their own weight and fineness.
- **Tuesday 17:00:** bid advice for every lot: the next legal bid, the owner's limit, and how far below or above spot that bid is.

It is **not** an always-on service. The operating system starts it at a few fixed times on Fridays and Tuesdays; each run does what is due and exits. It uses no AI.

Every spec follows the owner's back-end template, `_spec-template.md` (project root). Each starts with the same rule: it is the single source of truth, and nothing outside it may be assumed.

| # | Spec | What it covers |
|---|---|---|
| 01 | [Environment and schedule](01-environment-and-schedule.md) | Requirements, folder, `.env`, commands, the scheduled runs (launchd / systemd), what one run does, lock, logs |
| 02 | [Auction reading and advice](02-auction-reading-and-advice.md) | Auction number and window, list pages, lot tables, fineness codes, BR lots, valuation, the bid feed, limits, verdicts |
| 03 | [Messages and state](03-messages-and-state.md) | The Friday and Tuesday messages, the state file that makes each message go out once, failure alerts, saved reports |

## Words used in every spec

- **Owner**: the single user. Runs the agent on their own Mac or Raspberry Pi.
- **Auction**: one weekly Pantti auction, numbered (966, 967, …). It opens on Friday at 17:00 and its lots close on Tuesday from about 18:00 (Helsinki time).
- **Lot**: one item for sale ("myyntierä"), with a table of sub-lots (description, weight in grams, fineness code).
- **Phase**: `announce` (Friday list) or `advise` (Tuesday bid advice).
- **Metal value**: fine grams × today's spot price in euros per gram.
- **Next legal bid**: the lowest bid the auction accepts now: top bid + minimum raise, or the start price when there are no bids.
- **Limit**: the most the owner will bid: coins 10 % over metal value, silver never above it.

## Owner decisions (17–20 Oct 2026)

- Two lists per auction: coins and medals (category 5) and silver (category 2).
- Coins: never bid more than 10 % above metal value. Silver: never above metal value.
- BR (gross-weight) silver rows count 35 % of their weight as silver.
- Metal content only from the auction's own tables, never from guesses or AI.
- Friday list at 17:00; Tuesday bid advice at 17:00. Advice only: the agent never bids.
- Separate from the Huuto/Tori Market Watch: own repo (public), own folder, own schedule. It does not need to run all the time.
- No secrets in the public repo: the ntfy topic and the data stay on the owner's computer.

## Keeping these specs current

When the agent changes, update the matching spec here and `README.md` in the same change, run `npm test`, then commit and push.
