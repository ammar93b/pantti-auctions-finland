# Spec: Environment and schedule

Use the following specification as your single source of truth.
Do not make assumptions about any requirement not listed here.

## Feature

A small Node program that the operating system starts every few minutes; each run sends the messages that are due, if any, and exits.

## Overview

The agent has a few short jobs a week: notice new auctions, and remind the owner before each one closes. Running all the time would only waste power, so the system scheduler (launchd on macOS, a systemd timer on Linux / Raspberry Pi) starts it every `checkEveryMinutes` minutes (default 10). Every run is safe to repeat: it checks the clock (Helsinki time) and its state file (03), and does nothing, without any web request, when nothing is due.

**Requirements**

| What | Detail |
|---|---|
| Computer | A Mac (macOS 13+) or a Raspberry Pi / Linux machine with systemd, on (or asleep, for a Mac) most of the day. |
| Node.js | 18 or newer. Plain CommonJS, **no npm dependencies**, no `npm install`. Built-ins only: `fs`, `path`, `os`, `child_process`, global `fetch`, `AbortSignal`, `Intl`. |
| ntfy | The ntfy app on the owner's phone, subscribed to a private topic on ntfy.sh. |
| Network | HTTPS to `huutokauppa.pantti.fi`, `www.suomenpanttilaina.fi`, `shop.suomenpanttilaina.fi`, `api.gold-api.com`, `api.frankfurter.dev`, `ntfy.sh`. |

No AI tool and no account at either site are needed.

**Files**

```
run.js               one run (this spec)
config.js            settings: limits, BR share, message times, sites and their list links, delays
src/env.js           .env loader, data folder, Helsinki time zone
src/http.js          web requests with retries, HTML text helpers
src/common.js        Helsinki time, number and fineness parsing, valuation, categories, limits, formatting
src/spot.js          gold and silver spot price in euros
src/pantti.js        Helsingin Pantti (02)
src/panttilaina.js   Suomen Panttilaina (04)
src/messages.js      the phone messages (03)
src/agent.js         what is due, listing checks, reminders (03)
src/notify.js        ntfy (03)
src/state.js         state file, run lock, reports, log (03)
scripts/schedule.js  install / remove / status / print the scheduled runs
docs/                architecture diagram (draw.io and PNG)
test/                tests on saved copies of the live pages (npm test)
specs/               these specs
data/                created at run time: state, reports, log. Never committed.
.env                 the owner's ntfy topic. Never committed.
```

**`.env`** (copied from `.env.example`): `NTFY_TOPIC` (the phone topic; without it nothing is sent and the run says so), the owner's limits `<CATEGORY>_MAX_PCT` / `<CATEGORY>_ALERT_PCT` for `GOLD_COINS`, `SILVER_COINS`, `JUNK_GOLD`, `JUNK_SILVER` (spec 05; not set = 0 %), and optional `TZ` (default `Europe/Helsinki`, set by `src/env.js` when empty). The loader reads `KEY=value` lines, skips `#` lines, keeps real environment variables, and removes one pair of quotes only when they wrap the whole value.

**`config.js`** (all settings in one place; the README explains each)

| Setting | Default | Meaning |
|---|---|---|
| `categories` | gold coins & bars, silver coins & bars, junk gold, junk silver, each `{ name, metal }` + its limits from `.env` | The four categories, in message order (spec 05) |
| `minMetalEur` | 30 | Lots with less metal value are left out |
| `brSilverShare` | 0.30 | Silver share of a gross-weight (br) row |
| `notify.whenListed` | true | One message when an auction is listed |
| `notify.beforeClosing` | `['10h', '30min']` | Reminders before closing; `'1h30min'` style; `[]` = none |
| `notify.listingCheckEvery` | `'60min'` | How often new listings are looked for |
| `notify.listingCheckHours` | `['08:00', '22:00']` | Helsinki times when listings are looked for |
| `checkEveryMinutes` | 10 | How often the scheduler starts a run (5–60) |
| `sources.pantti` | enabled, reference 966 / 2026-10-16, three list links (categories 5, 2 `silver`, 1 `gold`) | Helsingin Pantti (02, 05) |
| `sources.panttilaina` | enabled, four lists × two sites (gold / other 8, silver / other 21, silver cutlery 14, all gold 1), `warnAfterDaysWithoutLots` 7 | Suomen Panttilaina (04, 05) |
| `requestDelayMs`, `requestTimeoutMs`, `retryDelaysMs` | 1 s, 30 s, 5 s / 15 s | Politeness and retries |

A time written wrongly in `notify` (for example `'ten hours'`) stops the run with a message naming the value.

**Commands**

| Command | Runs | What it does |
|---|---|---|
| `npm run once` | `node run.js` | The scheduled run: does what is due now, if anything |
| `npm run show` | `node run.js --show` | Every auction listed now: lots, values and advice with live bids, printed. Nothing sent |
| `npm run show:list` | `node run.js --show --list` | Lots and values from the lists only (fast) |
| `npm run push` | `node run.js --show --push` | Like `show`, and sends each auction's advice to the phone |
| `npm run top` | `node run.js --top --push` | Every open auction on every site, with live bids: one 🏆 message per category with its 5 best lots (`--top N` for another number; without `--push` only printed). State is not changed |
| `npm run test-push` | `node run.js --test-push` | One test message |
| `npm run status` | `node run.js --status` | Auctions seen, reminders sent, failures, settings, the limits in use |
| `npm run schedule:install` / `:remove` / `:status` / `:print` | `node scripts/schedule.js …` | The scheduled runs |
| `npm run log` | `tail -n 60 data/logs/run.log` | Recent log lines |
| `npm test` | `node --test …` | Tests |

`--source pantti|panttilaina` limits `--show` to one site; `--limit N` reads only the first N lots of each list.

**Scheduler**
- **macOS:** a launchd agent `fi.panttiauctions.agent` in `~/Library/LaunchAgents/` with `StartInterval` = `checkEveryMinutes × 60` and `RunAtLoad`. `ProgramArguments` = [absolute Node path, `run.js`]; `WorkingDirectory` = the project; output to `data/logs/run.log`. A run missed while the Mac sleeps happens on wake.
- **Linux:** a systemd **user** service `pantti-auctions.service` (`Type=oneshot`) and timer `pantti-auctions.timer` with `OnCalendar=*-*-* *:00/<N>:00` and `Persistent=true`. Install prints `sudo loginctl enable-linger <user>` when lingering is off.
- The computer's own time zone does not matter: every time is worked out in `Europe/Helsinki`.
- `install` replaces any earlier install, including one under the old name (`fi.helsinginpantti.agent`, `helsingin-pantti.*`). `remove` stops and deletes it. `status` says installed or not. `print` shows the files.

**One run** (`node run.js`, no flags): trim the log (over 1 MB → last 200 kB), then the agent run of spec 03. Exit 0, or 1 when something failed (it is retried by a later run).

**Manual runs** (`--show`) read every enabled site whatever the time (Helsingin Pantti: the most recent auction that has opened) and never change the state file. With `--push` they send one advice message per auction and say for each whether it was sent.

## Acceptance criteria

- [ ] `package.json` has no dependencies; `npm test` passes on a fresh clone with only Node installed.
- [ ] A run with nothing due logs "nothing due", makes no web request and exits 0.
- [ ] `npm run schedule:print` on macOS shows `StartInterval` 600; on Linux a timer with `OnCalendar=*-*-* *:00/10:00` and `Persistent=true`.
- [ ] `checkEveryMinutes: 3` stops `schedule:install` with a clear message.
- [ ] Without `NTFY_TOPIC`, `npm run test-push` prints "Not sent: no ntfy topic (NTFY_TOPIC in .env)".
- [ ] No file in the repository contains the owner's ntfy topic, email address or data.

## Out of scope

- A dashboard or any web server.
- Bidding, logging in, or reading lot photos.
- Windows.

## Edge cases

- **The computer is off for a whole reminder window:** that reminder is skipped; a later one still goes out (03).
- **Two runs at once** (a slow reminder still going): the lock keeps the second one out.
- **A run is killed:** its lock is free as soon as its process is gone; the state shows what was already sent, so nothing is sent twice.
- **Daylight saving changes:** all times are Helsinki time, computed with `Intl`.

## Security impact

- The repository is public. `.env` (ntfy topic) and `data/` are git-ignored. Commits use the owner's GitHub no-reply address.
- Only public pages and Helsingin Pantti's public bid-state endpoint are read; no logins, no cookies. Paths in the sites' robots.txt are not used.
- The scheduled job runs as the owner, not root.

## Threat modeling

| Threat | Mitigation |
|---|---|
| The ntfy topic leaks through the public repo | Only in `.env`, which is git-ignored; `.env.example` has an empty value |
| Someone reads the owner's buying interest from the repo | No data, reports or state are committed |
| Heavy requests get the agent blocked | Nothing is read when nothing is due; listing checks hourly in the daytime; one request at a time, 1 s apart |
| A stuck run blocks the next one | Each request has a 30 s time limit and a few retries; the lock frees itself when the process is gone |
