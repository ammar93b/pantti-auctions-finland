# Spec: Messages and state

Use the following specification as your single source of truth.
Do not make assumptions about any requirement not listed here.

## Feature

For every auction on every enabled site: one phone message when it is listed and reminders before it closes, each sent once through ntfy, with a small state file that makes every run safe to repeat.

## Overview

Each scheduled run (01, `runDue` in `src/agent.js`) asks two questions: is a **listing check** due, and is a **reminder** due for an auction already seen? If neither, it stops at once without reading anything. Otherwise it takes the run lock, does what is due, records each message as soon as ntfy accepts it, and stops. Retries are simply later runs.

**Listing check** (`listingDue`)
- Due when the Helsinki time is inside `notify.listingCheckHours` (default 08:00–22:00) and at least `notify.listingCheckEvery` (default 60 min, 2 minutes early allowed) has passed since the last one.
- Asks each enabled site for its auctions (`listed`, 02 and 04) with their valued lots and list-only advice.
- An auction not seen before is recorded (`auctions` in the state file) with its closing time, and gets the **listed message** (if `notify.whenListed`) about all its lots.
- Lots that appear later in a known auction get a **new lots message** only when at least one of them is under the limit (`buy`); otherwise they are recorded silently. (Suomen Panttilaina fills an auction over several days.)
- When a reminder for that auction is already due at that moment, the listed message is not sent: the reminder covers it.
- The closing time of a known auction is updated from every check.

**Reminders** (`dueReminder`)
- `notify.beforeClosing` (default `['10h', '30min']`) gives the reminder times before the auction's closing time.
- At a run, the due reminder is the **latest** reminder time that has passed, if it was not sent and the auction has not closed. An earlier reminder that was missed (computer off) is skipped, never sent late.
- A reminder reads the auction again with live bids (`current`, 02 and 04) and sends the **reminder message**.
- Only auctions of sites that are still enabled get reminders.

**Messages** (`src/messages.js`; ntfy in `src/notify.js`)
- Inside each listed and reminder message the lots are shown in the four category sections of spec 05 (gold coins & bars, silver coins & bars, junk gold, junk silver), each with its own lines and counts; empty sections are left out. Gold rings and earrings with stones are never shown.
- `POST https://ntfy.sh/` (root URL) with JSON `{ topic, title, message, priority, click?, actions? }`; priority as a number (default 3, high 4, low 2); at most 3 actions; 15 s time limit; a non-OK answer fails with `ntfy answered <status>: <text>`. No topic: `{ skipped: 'no ntfy topic (NTFY_TOPIC in .env)' }`, which counts as not sent.
- Numbers in Finnish style: euros with 2 decimals only when not whole and under 100 €; percent with a sign and one decimal under 10 %.
- Messages over 3 800 characters are cut with "… (more on the computer)".

| Message | Title | Body | Priority |
|---|---|---|---|
| Listed | `🏛 <auction>: <n> lot(s) listed · <b> 🟢` | `Closes <Mon 26.10. 19:02> · <where>`; `<n> lots: <v> valued by weight, <c> to check by hand. Your limit: gold +5 %, silver +3 % over spot.`; up to 10 valued lots, best price ÷ metal value first: `🟢 <id> <name>` / `max bid <m> · needs <next> (<d> vs spot) · metal <value>` (Pantti: `bid <next>`), `🔵 … now <price> with bids · limit <limit>`, or `• <id> <name> · <price> (<d> vs spot): over the limit`; `Reminders: 10 h and 30 min before closing.` | default; opens the first 🟢 lot |
| New lots | `🏛 <auction>: <n> new lot(s) · <b> 🟢` | as above, only the new lots | default |
| Reminder | `⏰ <auction> closes in <10 h / 30 min>: <b> to bid on` | Suomen Panttilaina: `<b> to bid on. Set the MAX BID shown: the site bids for you up to it.`, lines `🟢 max bid <m> · <id> <name>` / `needs <next> now (<d> vs spot) · metal <value> · closes <19:42:30>`. Pantti: `Bid only the NEXT amount shown, never above the limit.`, lines `🟢 bid <next> (step <raise>) · lot <id> <name>` / `now <price> · limit <limit> · <d> vs spot at this bid`. Up to 12, lowest distance first; `· br: 30 % silver counted, check the photos` when it applies; `Nothing at your 🟢 price right now.` when none; footer `Not at your price: <n> · closed: <n> · check by hand: <n>` and `First lot closes <time> · <where>` | high when there is a buy; up to 3 buttons |
| Top (manual, `npm run top`) | `🏆 <category>: top <n> of <all> · <b> 🟢` | the category's limits; its best lots across every open auction, 🟢 first, then the lowest price against metal value: `🟢 <name>` / `needs <price> (<d> vs spot) · metal <value> · set max bid <m>` (Pantti: `bid <next>`) / `<auction> · lot <id> · closes <time>` | high when there is a 🟢 |
| Failure | `⚠ <what> failed` | the error + `It is tried again at the next run.` | low |
| Test | `🏛 Pantti auctions test` | `Phone messages work.` | default |

**State file** (`data/state.json`)
```
{
  "auctions": { "<key>": { key, source, title, closesAt, url, where, proxyBids, announced: [lot ids], listedAt } },
  "sent":     { "<key>-before-<minutes>": "<ISO>" },
  "failed":   { "<failure key>": "<ISO of first failure>" },
  "meta":     { "lastListingCheck": "<ISO>", "lotsSeen-<site>": "<ISO>" }
}
```
- Auction keys: `pantti-967`, `panttilaina-FI2-20261026`.
- An auction is recorded before its listed message is sent; its lots go into `announced` only after the message was accepted (or was not needed).
- A reminder goes into `sent` right after ntfy accepts it, and the file is saved at once, so a crash never repeats it.
- `failed` keeps the first failure, so each failure alert goes out once: listing checks per site per day (`<site>-listing-<yyyymmdd>`), reminders per auction and time (`<key>-before-<minutes>`).
- **No lots for days:** when a site with `warnAfterDaysWithoutLots` (Suomen Panttilaina: 7) has shown no lots at all for that long, one failure alert says the lists may have moved.
- Written to `.tmp` and renamed. A broken or missing file reads as empty. `sent` / `failed` entries older than 8 weeks and auctions 2 weeks past closing are pruned on save.

**Run lock** (`data/run.lock`, the process id): created atomically (`wx`). Held when it exists and its process is alive; otherwise taken over (moved aside first, so two runs can't both take it). Only the owner removes it.

**Reports and log**
- Every message built is also written to `data/reports/<key>-listed.txt` / `<key>-before-<minutes>.txt`; `--show` writes `data/reports/show.txt`.
- `data/logs/run.log`: one line per step with the local time (printed too when run in a terminal); trimmed to 200 kB when over 1 MB.

## Acceptance criteria

- [ ] An auction closing Monday 19:00 and seen on Wednesday: one listed message; reminders at Monday 09:00 and 18:30; no other message; runs in between are idle.
- [ ] A computer that wakes 20 minutes before closing sends only the 30-minute reminder.
- [ ] An auction first seen 9 h before closing gets the 10-hour reminder and no listed message.
- [ ] Lots added later: no message while all are over the limit; one "new lot" message when one is under it.
- [ ] A reminder whose site times out: one ⚠ alert; the next run sends the reminder; no second alert.
- [ ] Without `NTFY_TOPIC`: nothing is recorded as announced or sent, and the run reports "no ntfy topic".
- [ ] No listing check at 00:00; at 09:00 and again only from 09:58.
- [ ] A site with no lots for 7 days gives one warning.

## Out of scope

- Other channels than ntfy.
- Messages after an auction closes (results).

## Edge cases

- **ntfy is down:** that message is not recorded; a later run sends it (listing: at the next listing check; reminder: at the next run).
- **The state file is deleted:** auctions are seen as new again and get a listed message; reminders already sent may repeat once.
- **No lots valued in an auction:** the messages still go out with the counts.
- **A site is disabled in `config.js`:** it is not read and its known auctions get no more reminders.

## Security impact

Messages contain lot numbers, short names, prices and the pickup office only, sent to the owner's private ntfy topic.

## Threat modeling

| Threat | Mitigation |
|---|---|
| Repeated messages annoy or confuse | Lots recorded as announced, reminders recorded as sent, each saved at once |
| Many failure alerts | One alert per failure key (per day for listing checks) |
| A stranger reads the topic | Random topic in `.env` only, never in the repo |
