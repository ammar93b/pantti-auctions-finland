# Running Pantti auctions Finland in Docker (Mac, Raspberry Pi) and managing it with Portainer

Pantti auctions Finland can run as a **Docker container**. The same files work on a Mac and on a Raspberry Pi, and **Portainer** gives you one web page to start, stop, restart and read the logs of every container you run (Pantti, HopeaGold Market Watch, Pi-hole …).

> **Status:** the Docker files are written and the loop inside them is tested on a Mac, but the container itself has not been built on a real machine yet. The first build is the test. If a step fails, open an issue with the message it printed.

**Only one copy may run.** If the Mac (launchd), the Pi (systemd timer) and a container all run, every message arrives several times. Stop the other one first (step 3).

Docker is **optional**. The plain scheduler (`deploy/raspberry-pi.md`, README) works as before. Choose Docker if you want Portainer, or to run several programs the same way.

## Docker or the plain scheduler?

| | launchd / systemd timer | Docker |
|---|---|---|
| Mac | Light: starts a run every 10 minutes, nothing in between | Docker Desktop keeps a hidden Linux machine running: about 1–2 GB of memory. Not worth it for this program |
| Raspberry Pi | Works | Light on Linux; the better choice with Portainer |
| One page for all programs | No | Yes (Portainer) |
| Updates | `git pull` (nothing to restart) | `git pull`, `docker compose up -d --build` |

## What the Docker files do

- **`Dockerfile`**: Node 22 plus the code (no npm packages). Runs as the unprivileged user `node`. Works on Intel/AMD and ARM.
- **`scripts/docker-loop.js`**: inside Docker there is no launchd or systemd, so this small loop starts `node run.js` every `checkEveryMinutes` minutes (default 10), on the clock (:00, :10, :20 …), and stops cleanly when the container stops. A lock left by a run that was cut off is cleared when the container starts.
- **`docker-compose.yml`**: the container `pantti-auctions`, restarted automatically after a crash, a reboot or a power cut. `.env` is mounted read-only; `data/` is mounted from your folder (what was announced and sent survives updates). The health check says "healthy" while runs keep writing to the log. Logs are capped at 3 × 2 MB.
- Time: Finnish time inside the container, whatever the computer's clock zone is.

## 1. Install Docker

**Raspberry Pi** (64-bit Raspberry Pi OS):

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER      # then log out and in again
docker compose version             # Docker Compose v2
```

**Mac:** install Docker Desktop (docker.com), start it once.

## 2. Download it

```bash
git clone https://github.com/ammar93b/pantti-auctions-finland.git ~/pantti-auctions-finland
cd ~/pantti-auctions-finland       # main branch
```

## 3. Settings and data

Moving from the plain scheduler on the same computer: stop it, and keep your `.env` and `data/`.

```bash
npm run schedule:remove            # stop the launchd / systemd runs first
```

Moving from the Mac to a Pi: do step 5 of `deploy/raspberry-pi.md` (copy `.env` and `data/`), so the Pi doesn't announce the current auctions again.

New install:

```bash
mkdir -p data
cp .env.example .env
nano .env                          # NTFY_TOPIC=<your topic> and your limits (README → "Set up your four categories")
```

## 4. Build and start

```bash
docker compose up -d --build
docker compose ps                  # "healthy" after the first run
docker compose logs -f             # Ctrl+C to leave
```

## 5. Test

```bash
docker compose exec pantti node run.js --test-push    # "🏛 Pantti auctions test" arrives
docker compose exec pantti node run.js --show --list  # every auction listed now (nothing sent)
docker compose exec pantti node run.js --status
```

(`npm run …` commands are not needed inside the container: use `node run.js …` as above.)

---

## Portainer: one page for all your containers

Install it once on the Pi (or Mac):

```bash
docker volume create portainer_data
docker run -d --name portainer --restart=always \
  -p 127.0.0.1:9443:9443 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  portainer/portainer-ce:lts
```

Open it: on the computer itself **https://localhost:9443**; on a Pi from your Mac `ssh -N -L 9443:localhost:9443 <your-user>@<pi-address>`, then https://localhost:9443 (your browser warns about the certificate: it is Portainer's own; accept it). **Create the admin user within a few minutes**, or Portainer locks itself and has to be restarted (`docker restart portainer`). Choose "Get started" and the local environment.

Then **Containers** lists `pantti-auctions` (and Market Watch, Pi-hole …): start, stop, restart, logs, memory and CPU, health, and a **Console** button for a terminal inside it. Portainer is for watching and controlling. First setup and updates are done with `docker compose` as above.

> Portainer can control every container on the computer, so keep it on `127.0.0.1` (as above) or behind your own VPN. Don't open its port to the internet.

## Day to day

| What | How |
|---|---|
| Is it running? | `docker compose ps`, or Portainer → Containers |
| Recent log lines | `docker compose logs --tail 60`, or Portainer → the container → Logs |
| What it has seen and sent | `docker compose exec pantti node run.js --status` |
| Best lots now, to the phone | `docker compose exec pantti node run.js --top --push` |
| Update to the latest code | `git pull && docker compose up -d --build` |
| Changed `.env` or `checkEveryMinutes` | `docker compose restart` (`config.js` is in the image: rebuild with `up -d --build`) |
| Stop it | `docker compose down` (data is kept) |

## If something goes wrong

- **The container keeps restarting:** `docker compose logs --tail 60`. Usually `.env` is missing (`cp .env.example .env`) or `data/` was created by Docker as root: `sudo chown -R 1000:1000 data`.
- **Permission denied on `data/`:** the container runs as user id 1000 (the first user on a Pi): `sudo chown -R 1000:1000 data`.
- **"unhealthy":** no run has written to the log for about 25 minutes: `docker compose logs --tail 60`.
- **Messages arrive twice:** another copy is running: `npm run schedule:status`, `docker ps`.
- **No messages at all:** the test push (step 5), then `--status`.
- **Blocked websites:** with Pi-hole, allow the domains in `deploy/raspberry-pi.md`, plus `registry-1.docker.io`, `production.cloudflare.docker.com` and `deb.debian.org` for builds and updates.

## Limits

- Containers stop when the Mac sleeps. Only a Pi runs around the clock. If the computer is off through a whole reminder window, that reminder is skipped; a later one still goes out.
- Advice only: it never bids for you.
