# Spec: Messages and state

Use the following specification as your single source of truth.
Do not make assumptions about any requirement not listed here.

## Feature

The two phone messages per auction, sent once each through ntfy, and the small state file that makes every run safe to repeat.

## Overview

Each scheduled run (01) asks: which phase is due, and which of its messages have not gone out yet? It sends only those, records each one as soon as it is sent, and stops. Retries are simply the later run times.

**Which phase is due** (`phaseDue(auction, state, now)`)
- `announce`: not yet sent for this auction, and now is between Friday 17:00 and 20:00 (a Friday list sent later would be out of date).
- `advise`: not yet sent, and now is between Tuesday 17:00 and 18:00 (the window end).
- Otherwise nothing.

**Messages** (ntfy, `src/notify.js`)
- `POST https://ntfy.sh/` (root URL) with JSON `{ topic, title, message, priority, click?, actions? }`; priority as a number (default 3, high 4, low 2); at most 3 actions; 15 s time limit; a non-OK answer fails with `ntfy answered <status>: <text>`. No topic: `{ skipped: 'no ntfy topic (NTFY_TOPIC in .env)' }`.
- Numbers in Finnish style: euros with 2 decimals under 100 € and none from 100 €; percent with a sign and one decimal under 10 %.
- Messages over 3 800 characters are cut with "… (more on the computer)".

| Message | When | Title | Body | Priority |
|---|---|---|---|---|
| Friday list | `announce` | `🏛 Pantti auction <n> is open · <lots> lots` | Per category: `<Name>: <n> lots, <v> valued by weight, <c> to check by hand`, then up to 8 valued lots, best value first (list price ÷ metal value; lots without a price last): `• <id> <name> · start/now <price> · metal <value> (<distance>)`; `⚠ Not read: …` if a list failed; last line `Bid advice comes on Tuesday 17:00. Lots close from 18:00 on Tuesday.` | default; opens the first lot |
| Tuesday advice | `advise`, one per category (coins, silver) | `🏛 Pantti <n> <coins & medals / silver>: <b> to bid on` | `<b> to bid on. Bid only the NEXT amount shown, never above the limit.` (or `Nothing under the limit right now.`), up to 12 buy lines, lowest distance first: `🟢 bid <next> (step <raise>) · lot <id> <name>` / `now <price> · limit <limit> · <distance> vs spot at this bid` + `· BR lot: counted at 30 % silver (estimate), check the photos` when it applies; footer `Above the limit: <n> · closed: <n> · check by hand: <n>` | high when there is a buy, else default; up to 3 buttons, one per buy lot |
| Failure | first failure of a phase | `⚠ Pantti check failed` | the error + `It retries at the next run time.` | low |
| Test | `--test-push` | `🏛 Pantti agent test` | `Phone messages work.` | default |

The Friday list is sent even if one category could not be read (it says so). The Tuesday advice is per category: a category whose list failed is retried at the next run time; one already sent is not read again.

**State file** (`data/state.json`)
```
{
  "sent":   { "<auction>-announce-list": "<ISO>", "<auction>-advise-coins": "<ISO>", "<auction>-advise-silver": "<ISO>" },
  "done":   { "<auction>-announce": "<ISO>", "<auction>-advise": "<ISO>" },
  "failed": { "<auction>-<phase>": "<ISO of first failure>" }
}
```
- A message is recorded in `sent` right after ntfy accepts it, and the file is saved at once, so a crash never repeats it.
- A phase goes into `done` when all its messages are sent. `done` phases are never run again.
- `failed` keeps the first failure, so the failure alert goes out once per phase.
- Written to `.tmp` and renamed (a crash never leaves half a file). A broken or missing file reads as empty.
- Entries older than 8 weeks are pruned on each run.

**Run lock** (`data/run.lock`, the process id)
- Created atomically (`wx`). Held when it exists and its process is alive; otherwise taken over (moved aside first, so two runs can't both take it). Only the owner removes it.

**Reports and log**
- Each run that builds messages writes `data/reports/pantti-<n>-<phase>.txt` with every message in full. `--show` writes `data/reports/pantti-<n>-show.txt`.
- `data/logs/run.log`: one line per step with the local time; trimmed to 200 kB when over 1 MB.

## Acceptance criteria

- [ ] Tuesday 17:00: coins sent, silver list times out three times → coins recorded, `failed` set, one ⚠ alert. Tuesday 17:15: only silver is read and sent; no second ⚠ alert; the phase becomes `done`.
- [ ] Friday 17:30 after a successful 17:00: nothing is read or sent.
- [ ] Friday 20:30 (list never sent): nothing is sent.
- [ ] Killing a run after the coins message: the next run sends only silver.
- [ ] Without `NTFY_TOPIC`: messages are built and saved, nothing is recorded as sent, and the run reports "no ntfy topic".

## Out of scope

- Other channels than ntfy.
- Messages after the auction closes (results).

## Edge cases

- **ntfy is down:** that message is not recorded; the next run time sends it.
- **The state file is deleted mid-week:** the due phase runs again at the next run time (a duplicate is possible only then).
- **No lots valued in a category:** the advice still goes out ("Nothing under the limit right now."), with the counts.

## Security impact

Messages contain lot numbers, short names and prices only, sent to the owner's private ntfy topic.

## Threat modeling

| Threat | Mitigation |
|---|---|
| Repeated messages annoy or confuse | `sent` per message, saved immediately; `done` per phase |
| Many failure alerts | One alert per phase (`failed`) |
| A stranger reads the topic | Random topic in `.env` only, never in the repo |
