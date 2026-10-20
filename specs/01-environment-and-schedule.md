# Spec: Environment and schedule

Use the following specification as your single source of truth.
Do not make assumptions about any requirement not listed here.

## Feature

A small Node program that the operating system starts at fixed times on Fridays and Tuesdays; each run sends the Pantti message that is due, if any, and exits.

## Overview

The agent has two jobs a week, each a few minutes long. Running all the time would only waste power, so it is started by the system scheduler (launchd on macOS, a systemd timer on Linux / Raspberry Pi) at a few fixed times. Every run is safe to repeat: it checks the clock and its state file (03) and does nothing if there is nothing to do. The extra start times are the retries.

**Requirements**

| What | Detail |
|---|---|
| Computer | A Mac (macOS 13+) or a Raspberry Pi / Linux machine with systemd. It must be on (or asleep, for a Mac) at the run times. |
| Node.js | 18 or newer. Plain CommonJS, **no npm dependencies**, no `npm install`. Built-ins only: `fs`, `path`, `os`, `child_process`, global `fetch`, `AbortSignal`, `Intl`. |
| ntfy | The ntfy app on the owner's phone, subscribed to a private topic on ntfy.sh. |
| Network | HTTPS to `huutokauppa.pantti.fi`, `api.gold-api.com`, `api.frankfurter.dev`, `ntfy.sh`. |

No AI tool and no account at Pantti are needed.

**Files**

```
run.js               one run: decides what is due and does it (this spec)
config.js            settings: limits, BR share, auction reference, schedule, delays
src/env.js           .env loader, data folder, Helsinki time zone
src/http.js          web requests with retries, HTML text helpers
src/spot.js          gold and silver spot price in euros (02)
src/pantti.js        auction reading, valuation, advice, messages (02, 03)
src/notify.js        ntfy (03)
src/state.js         state file, run lock, log (03)
scripts/schedule.js  install / remove / status / print the scheduled runs
test/                tests on saved copies of the live pages (npm test)
specs/               these specs
data/                created at run time: state, reports, log. Never committed.
.env                 the owner's ntfy topic. Never committed.
```

**`.env`** (copied from `.env.example`):

| Key | Use |
|---|---|
| `NTFY_TOPIC` | The phone topic. Without it nothing is sent; the run says so. |
| `TZ` | Optional. Default `Europe/Helsinki`, set by `src/env.js` when empty. |

The loader reads `KEY=value` lines, skips `#` lines, keeps real environment variables, and removes one pair of quotes only when they wrap the whole value.

**Commands**

| Command | Runs | What it does |
|---|---|---|
| `npm run once` | `node run.js` | The scheduled run: does what is due now, if anything |
| `npm run show` | `node run.js --show` | The latest auction now: lots, values and advice, printed. Nothing sent |
| `npm run show:list` | `node run.js --show --list` | Lots and values only (fast, no bid checks) |
| `npm run push` | `node run.js --show --push` | Like `show`, and sends the advice to the phone |
| `npm run test-push` | `node run.js --test-push` | One test message |
| `npm run status` | `node run.js --status` | What was sent for each auction, and the next run times |
| `npm run schedule:install` | `node scripts/schedule.js install` | Install the scheduled runs |
| `npm run schedule:remove` | `… remove` | Remove them |
| `npm run schedule:status` | `… status` | Are they installed? |
| `npm run schedule:print` | `… print` | Show the scheduler files without installing |
| `npm run log` | `tail -n 60 data/logs/run.log` | Recent log lines |
| `npm test` | `node --test test/*.test.js` | Tests |

`--limit N` (only the first N lots of each list) works with `--show`.

**Run times** (Helsinki time; `config.schedule`)

| Day | Times | Why |
|---|---|---|
| Friday | 17:00, 17:30, 18:30, 19:30 | The Friday list; the later times are retries inside its 3-hour window |
| Tuesday | 17:00, 17:15, 17:30, 17:45 | The bid advice; the later times are retries before lots start closing |

**Scheduler**
- **macOS:** a launchd agent `fi.helsinginpantti.agent` in `~/Library/LaunchAgents/`, with one `StartCalendarInterval` entry per run time (`Weekday` 5 = Friday, 2 = Tuesday). launchd uses the Mac's own clock, so the Mac must be set to Finnish time. A time missed while the Mac sleeps runs once on wake. `ProgramArguments` = [absolute Node path, `run.js`]; `WorkingDirectory` = the project; `StandardOutPath` / `StandardErrorPath` = `data/logs/run.log`; no `KeepAlive`, no `RunAtLoad`.
- **Linux:** a systemd **user** service `helsingin-pantti.service` (`Type=oneshot`, runs `node run.js`) and timer `helsingin-pantti.timer` with one `OnCalendar=` line per run time written with the time zone (`Fri *-*-* 17:00:00 Europe/Helsinki`), `Persistent=true` (a time missed while off runs once after boot). Install prints `sudo loginctl enable-linger <user>` when lingering is off.
- `install` replaces any earlier install. `remove` stops and deletes it. `status` says installed or not, and for systemd the next trigger. `print` shows the files.

**One run** (`node run.js`, no flags)
1. Trim `data/logs/run.log` to its last 200 kB when over 1 MB. Log `run started`.
2. Find the auction whose window contains now (02). None: log `no auction window now` and exit 0.
3. Find the phase that is due (03). None: log `nothing due for auction <n>` and exit 0.
4. Take the run lock (03). Held by a live process: log and exit 0.
5. Run the phase (02, 03). Success: exit 0. Failure: record it (03), exit 1.
6. Always release the lock.

**Manual runs** (`--show`) use the most recent auction that has opened, whatever the time, and never change the state file. With `--push` they send the advice messages and say for each one whether it was sent.

## Acceptance criteria

- [ ] `package.json` has no dependencies; `npm test` passes on a fresh clone with only Node installed.
- [ ] `npm run once` on a Wednesday logs "no auction window now", sends nothing and exits 0.
- [ ] On Friday at 17:30, after the 17:00 run already sent the list, `npm run once` sends nothing.
- [ ] `npm run schedule:print` on macOS shows 8 `StartCalendarInterval` entries; on Linux a timer with 8 `OnCalendar` lines in `Europe/Helsinki`.
- [ ] A Mac asleep at Tuesday 17:00 and woken at 17:20 sends the advice once.
- [ ] Without `NTFY_TOPIC`, `npm run test-push` prints "Not sent: no ntfy topic (NTFY_TOPIC in .env)".
- [ ] No file in the repository contains the owner's ntfy topic, email address or data.

## Out of scope

- A dashboard or any web server.
- Running all the time.
- Bidding, logging in to Pantti, or reading lot photos.
- Windows.

## Edge cases

- **The computer is off for the whole window:** nothing is sent for that phase. The next run times start again the next Friday.
- **Two runs start at once** (a retry time while a slow run is still going): the lock keeps the second one out.
- **A run is killed:** its lock is free as soon as its process is gone (03); its state shows what was already sent, so nothing is sent twice.
- **The Mac's clock is not on Finnish time:** launchd times are wrong; the run still only acts inside the window (computed in Helsinki time), so it may send late or not at all. Set the time zone.
- **Daylight saving changes:** systemd follows the given time zone. launchd follows the Mac's clock.

## Security impact

- The repository is public. `.env` (ntfy topic) and `data/` are git-ignored. Commits use the owner's GitHub no-reply address.
- Only public pages and Pantti's public bid-state endpoint are read; no logins, no cookies.
- The scheduled job runs as the owner, not root.

## Threat modeling

| Threat | Mitigation |
|---|---|
| The ntfy topic leaks through the public repo | Only in `.env`, which is git-ignored; `.env.example` has an empty value |
| Someone reads the owner's buying interest from the repo | No data, reports or state are committed |
| Heavy requests get the agent blocked | One request at a time, 1 s apart, only twice a week |
| A stuck run blocks the next one | Each request has a 30 s time limit and a few retries; the lock frees itself when the process is gone |
