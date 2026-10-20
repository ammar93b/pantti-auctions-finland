# Helsingin Pantti agent

Watches the weekly online auction of **Helsingin Pantti** ([huutokauppa.pantti.fi](https://huutokauppa.pantti.fi)) and sends two phone messages per auction:

| When (Helsinki time) | Message |
|---|---|
| **Friday 17:00** | 🏛 The auction is open: its coin and silver lots, valued by their own weight and fineness at today's spot price, best value first |
| **Tuesday 17:00** | 🏛 Bid advice, one message for coins and one for silver: for each lot, the **next legal bid**, your **limit**, and how far **below or above spot** that bid is |

Lots close on Tuesday from about 18:00, so the advice comes an hour before.

It is **not** an always-on service. Your computer's scheduler starts it at a few fixed times on Fridays and Tuesdays; each run sends what is due and exits. It needs no AI, no account at Pantti, and no npm packages.

> Not affiliated with Helsingin Pantti. Advice only: the agent never bids, and the auction can move between the message and your bid. Always check the lot yourself.

---

## How it decides

- **Two lists per auction:** coins and medals (category 5) and silver (category 2).
- **Metal content from the auction's own table**, row by row: description, weight in grams, fineness code (`H925`, `H830BR`, `585`, `999,9` …). Anything not clearly stated (no weight, no fineness, plated, gold and silver mixed) is marked **check by hand**, never guessed.
- **BR rows** (gross weight, the lot holds other material too) count **30 %** of their weight as silver. 1000 g of 830 BR = 300 g silver = 249 g fine. Gross-weight gold is checked by hand.
- **Metal value** = fine grams × today's spot (gold-api.com × the ECB euro rate).
- **Next legal bid** comes from the lot's live bid feed (the same call the lot page makes): top bid + minimum raise, or the start price when there are no bids.
- **Your limits:** coins at most **10 % above** metal value; silver **never above** it.
- **Verdict:** 🟢 bid when the next legal bid is within the limit; otherwise above the limit, closed, or check by hand.

Example (auction 966, lot 190, 2 gold coins, 1,7 g at 999,9): top bid 200 €, minimum raise 10 € → next legal bid **210 €**, limit 10 % above the metal value.

Each message is sent **once**. If something fails (a page times out, ntfy is down), you get one ⚠ message and the next run time retries only what is missing.

## Run times

| Day | Times (Helsinki) |
|---|---|
| Friday | 17:00, 17:30, 18:30, 19:30 (the later times are retries; the Friday list is not sent after 20:00) |
| Tuesday | 17:00, 17:15, 17:30, 17:45 (retries before lots start closing) |

Change them in `config.js` (`schedule`), then run `npm run schedule:install` again.

---

## Set up (about 10 minutes)

You need **Node.js 18+** and the free **ntfy** app on your phone.

```bash
git clone https://github.com/ammar93b/helsingin-pantti-agent.git
cd helsingin-pantti-agent
npm test                         # all tests should pass; there is nothing to install
```

**Phone:** install ntfy, make a private topic name just for this agent (`echo pantti-$(openssl rand -hex 5)`), and subscribe to it in the app. Use a separate topic for each app you run, so each one has its own list of notifications.

```bash
cp .env.example .env             # then set NTFY_TOPIC=<your topic>
npm run test-push                # "🏛 Pantti agent test" arrives on your phone
npm run show:list                # the current auction's lots and values (nothing sent)
npm run schedule:install         # start the Friday and Tuesday runs
npm run schedule:status
```

- **Mac:** a launchd agent (`fi.helsinginpantti.agent`). It uses the Mac's clock, so set the Mac to Finnish time. A run missed while the Mac sleeps happens once when it wakes.
- **Raspberry Pi / Linux:** a systemd user timer in `Europe/Helsinki` time with `Persistent=true` (a run missed while the Pi was off happens once after boot). The install prints one extra command, `sudo loginctl enable-linger <you>`, so it also runs without anyone logged in.

## Commands

| Command | What it does |
|---|---|
| `npm run once` | What the scheduler runs: does what is due now, if anything |
| `npm run show` | The latest auction now: lots, values and bid advice, printed (nothing sent) |
| `npm run show:list` | Lots and values only (fast, no bid checks) |
| `npm run push` | Like `show`, and sends the advice to your phone |
| `npm run status` | What was sent for each auction, and the run times |
| `npm run test-push` | One test message |
| `npm run log` | Recent log lines |
| `npm run schedule:install` / `:remove` / `:status` / `:print` | The scheduled runs |
| `npm test` | Tests (saved copies of real auction pages) |

`npm run show -- --limit 5` checks only the first 5 lots of each list.

## Settings (`config.js`)

| Setting | Default | Meaning |
|---|---|---|
| `capOverMetal` | coins 1.10, silver 1.00 | Your limit as a share of the metal value |
| `brSilverShare` | 0.30 | Silver share of a BR (gross-weight) row |
| `reference` | auction 966, Friday 2026-10-16 | Anchor for the weekly auction number |
| `categories` | coins 5, silver 2 | The two lists |
| `schedule` | see above | Run times |
| `announceWindowHours` | 3 | The Friday list is not sent later than this after opening |
| `requestDelayMs`, `requestTimeoutMs`, `retryDelaysMs` | 1 s, 30 s, 5 s / 15 s | Politeness and retries |

`.env` holds only `NTFY_TOPIC` (and optionally `TZ`). It and `data/` (state, reports, log) stay on your computer and are never committed.

## Files

```
run.js               one run (scheduled or manual)
config.js            settings
src/pantti.js        auction reading, valuation, bid advice, messages, what is due
src/http.js          web requests with retries, HTML text helpers
src/spot.js          gold and silver spot in euros
src/notify.js        ntfy
src/state.js         what was sent (data/state.json), run lock, reports, log
scripts/schedule.js  launchd / systemd install
specs/               full specifications
test/                tests and saved auction pages
```

## If something goes wrong

| Problem | Fix |
|---|---|
| No messages | `npm run test-push`; check the topic in `.env` and in the app |
| "has no lots (the number changed or it is not open yet)" | Pantti skipped or renumbered a week: set `reference` in `config.js` to a current auction and its Friday |
| Nothing on Friday | `npm run schedule:status`, `npm run log`; is the computer on at 17:00 and on Finnish time? |
| Pantti changed its pages | The tests fail on fresh pages; update `parseList` in `src/pantti.js` and the saved pages in `test/fixtures/` |

The full design is in [`specs/`](specs/README.md).

## Licence

[MIT](LICENSE). Use, change and share it freely.
