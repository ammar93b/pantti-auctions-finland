# Running Pantti auctions Finland on a Raspberry Pi

Pantti auctions Finland runs the same code on a Raspberry Pi as on a Mac. The Pi is on around the clock, so listing messages and reminders before closing go out even when your Mac is closed or away.

> **Status:** the Linux scheduler (systemd timer) and these steps are written and checked on a Mac, but not yet tested on a real Pi. The first install is the test. If a step fails, open an issue with the message it printed.

**Only one computer may run it.** If the Mac and the Pi both run it, every message arrives twice. Step 5 stops the Mac and moves its state to the Pi.

It is light: a run takes a minute or two at most, and most runs only check the clock and stop. It fits next to other programs on the same Pi (Pi-hole, HopeaGold Market Watch).

---

## What you need

- A Raspberry Pi (Pi 3, 4 or 5; 1 GB of memory is enough) with **Raspberry Pi OS** (Bookworm or newer; 64-bit recommended)
- Internet access (the repo is public: no GitHub account needed)
- The ntfy app on your phone, and your ntfy topic (the same one the Mac uses)

No AI tool, no npm packages and no account at the auction sites.

## 1. Check the Pi

Log in to the Pi from your Mac's Terminal:

```bash
ssh <your-user>@<pi-address>
```

Then:

```bash
systemctl --user status >/dev/null && echo "systemd user services: OK"
timedatectl                 # the clock must be synchronised ("System clock synchronized: yes")
sudo apt update && sudo apt full-upgrade -y
```

The Pi's time zone does not matter (every time is worked out in Finnish time), but its clock must be right. Setting it to Finnish time keeps the log easy to read:

```bash
sudo timedatectl set-timezone Europe/Helsinki
```

## 2. Install Node.js and git

Node.js 18 or newer. The NodeSource package includes `npm`:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
node --version              # v22.x (18 or newer is fine)
```

(Raspberry Pi OS's own `nodejs` package also works, but `npm` comes separately: `sudo apt install -y nodejs npm git`.)

## 3. Download it

Use the `main` branch, in a folder **without spaces** in its path:

```bash
git clone https://github.com/ammar93b/pantti-auctions-finland.git ~/pantti-auctions-finland
cd ~/pantti-auctions-finland
git branch --show-current   # main
npm test                    # all tests pass (no packages to install)
```

## 4. Settings

**Moving from a Mac?** Do step 5 instead: it copies your settings, limits and state.

**New install:**

```bash
cp .env.example .env
nano .env                   # NTFY_TOPIC=<your topic> and your limits (README → "Set up your four categories")
```

## 5. Move from the Mac (skip on a new install)

Your `.env` (ntfy topic and limits) and `data/` (which auctions were already announced and which reminders were sent) are not on GitHub. Copy them, so the Pi does not announce the current auctions again.

On the **Mac**, in your Pantti folder:

```bash
npm run schedule:remove     # stop the Mac's runs first
scp -r .env data <your-user>@<pi-address>:~/pantti-auctions-finland/
```

## 6. Test

On the Pi:

```bash
cd ~/pantti-auctions-finland
npm run test-push           # "🏛 Pantti auctions test" arrives on your phone
npm run show:list           # every auction listed now, lots and values (nothing sent)
npm run status              # settings and limits in use, auctions seen
```

## 7. Start the runs

```bash
npm run schedule:install    # systemd user timer: a run every 10 minutes
sudo loginctl enable-linger <your-user>   # the install prints this line when needed: run it once
npm run schedule:status     # next and last run; "Last run ended …: OK" after the first run
```

`enable-linger` makes the runs continue after a reboot or power cut without anyone logging in. A run missed while the Pi was off happens as soon as it is back (`Persistent=true`).

---

## Day to day

| What | How |
|---|---|
| Is it running? | `npm run schedule:status` (next run, last run and its result) |
| Recent log lines | `npm run log` |
| What it has seen and sent | `npm run status` |
| Run once now | `npm run once` |
| Best lots now, to the phone | `npm run top` |
| Update to the latest code | `cd ~/pantti-auctions-finland && git pull` (the next run uses it; nothing to restart) |
| Changed `checkEveryMinutes` in `config.js` | `npm run schedule:install` again |
| Changed `.env` or other settings | nothing: the next run uses them |
| Stop it | `npm run schedule:remove` |
| The timer's own log | `journalctl --user -u pantti-auctions.service -n 50` |
| Pi maintenance | `sudo apt update && sudo apt full-upgrade -y` every month or two |

## If something goes wrong

- **"Not installed" or "Timer file exists but is not loaded":** run `npm run schedule:install` again.
- **"Runs only while you are logged in":** run `sudo loginctl enable-linger <your-user>` once.
- **"Last run ended …: exit 1":** `npm run log` shows why. A failed run is retried by the next one, and a ⚠ message tells your phone once what failed.
- **No messages at all:** `npm run test-push` (topic right?), `npm run status`, `npm run log`. Check that the Pi's clock is right (`timedatectl`).
- **"The project folder has a space in its path":** systemd needs a path without spaces. Move the folder (for example to `~/pantti-auctions-finland`) and install again.
- **Blocked websites:** if the Pi runs Pi-hole, allow `huutokauppa.pantti.fi`, `www.suomenpanttilaina.fi`, `shop.suomenpanttilaina.fi`, `api.gold-api.com`, `api.frankfurter.dev`, `ntfy.sh` and `github.com`. A blocked site shows up as a failed run in `npm run log`.
- **After a power cut:** nothing to do. A run that was cut off leaves its lock behind; the next run takes it over (a lock older than 2 hours, or whose process is gone, is stale).

## Limits of this setup

- The Pi must be on and connected. If it is off through a whole reminder window, that reminder is skipped; a later one still goes out.
- Advice only: it never bids for you.
