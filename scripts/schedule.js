// Installs the scheduled runs: the agent starts every config.checkEveryMinutes minutes. Spec 01.
//   node scripts/schedule.js install | remove | status | print
//   macOS → launchd agent with StartInterval (a run missed while the Mac sleeps happens on wake)
//   Linux → systemd user service + timer (OnCalendar every N minutes, Persistent=true)
// Each run works out in Helsinki time what is due, so the computer's own time zone doesn't matter.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const CFG = require('../config');

const ROOT = path.join(__dirname, '..');
const RUN = path.join(ROOT, 'run.js');
const LOG = path.join(ROOT, 'data', 'logs', 'run.log');
const NODE = process.execPath;
const PATHS = [path.dirname(NODE), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'].join(':');

// Minutes between runs, 5–60
function every() {
  const n = Number(CFG.checkEveryMinutes);
  if (!Number.isInteger(n) || n < 5 || n > 60) { console.log('config.js: checkEveryMinutes must be a whole number from 5 to 60.'); process.exit(1); }
  return n;
}

// Earlier installs under the project's old name are removed on install
const OLD = { label: 'fi.helsinginpantti.agent', units: ['helsingin-pantti.timer', 'helsingin-pantti.service'] };

// ── macOS: launchd ──────────────────────────────────────────────────────────

const LABEL = 'fi.panttiauctions.agent';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const launchctl = (...a) => execFileSync('launchctl', a, { stdio: 'pipe' }).toString();
const domain = () => `gui/${process.getuid()}`;

function plist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(NODE)}</string><string>${xml(RUN)}</string></array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>StartInterval</key><integer>${every() * 60}</integer>
  <key>RunAtLoad</key><true/>
  <key>EnvironmentVariables</key>
  <dict><key>PATH</key><string>${xml(PATHS)}</string><key>HOME</key><string>${xml(os.homedir())}</string></dict>
  <key>StandardOutPath</key><string>${xml(LOG)}</string>
  <key>StandardErrorPath</key><string>${xml(LOG)}</string>
  <key>ProcessType</key><string>Background</string>
</dict>
</plist>
`;
}

const mac = {
  remove({ quiet } = {}) {
    for (const label of [LABEL, OLD.label]) {
      try { launchctl('bootout', `${domain()}/${label}`); } catch {}
      const file = path.join(path.dirname(PLIST), `${label}.plist`);
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    if (!quiet) console.log('Removed: no more scheduled runs.');
  },
  install() {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    mac.remove({ quiet: true });
    fs.writeFileSync(PLIST, plist());
    launchctl('bootstrap', domain(), PLIST);
    console.log(`Installed ${PLIST}`);
    console.log(`Runs every ${every()} minutes (and once now). Times are worked out in Helsinki time.`);
  },
  status() {
    if (!fs.existsSync(PLIST)) return console.log('Not installed. Run: npm run schedule:install');
    try { launchctl('print', `${domain()}/${LABEL}`); console.log(`Installed and loaded: runs every ${every()} minutes.`); }
    catch { console.log('Plist exists but is not loaded. Run: npm run schedule:install'); }
  },
  print() { console.log(`# ${PLIST}\n${plist()}`); },
};

// ── Linux: systemd user timer ───────────────────────────────────────────────

const UNIT_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE = 'pantti-auctions.service';
const TIMER = 'pantti-auctions.timer';
const q = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;
const systemctl = (...a) => execFileSync('systemctl', ['--user', ...a], { stdio: 'pipe' }).toString();

const serviceUnit = () => `[Unit]
Description=Pantti auctions Finland (one run)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${q(ROOT)}
ExecStart=${q(NODE)} ${q(RUN)}
Environment=${q(`PATH=${PATHS}`)}
StandardOutput=append:${LOG}
StandardError=append:${LOG}
`;
const timerUnit = () => `[Unit]
Description=Pantti auctions Finland: new listings and reminders before closing

[Timer]
OnCalendar=*-*-* *:00/${every()}:00
Persistent=true

[Install]
WantedBy=timers.target
`;

function lingering() {
  try { return /Linger=yes/.test(execFileSync('loginctl', ['show-user', os.userInfo().username, '-p', 'Linger'], { stdio: 'pipe' }).toString()); }
  catch { return null; }
}

const linux = {
  remove({ quiet } = {}) {
    for (const t of [TIMER, OLD.units[0]]) { try { systemctl('disable', '--now', t); } catch {} }
    for (const f of [SERVICE, TIMER, ...OLD.units]) { const p = path.join(UNIT_DIR, f); if (fs.existsSync(p)) fs.unlinkSync(p); }
    try { systemctl('daemon-reload'); } catch {}
    if (!quiet) console.log('Removed: no more scheduled runs.');
  },
  install() {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.mkdirSync(UNIT_DIR, { recursive: true });
    linux.remove({ quiet: true });
    fs.writeFileSync(path.join(UNIT_DIR, SERVICE), serviceUnit());
    fs.writeFileSync(path.join(UNIT_DIR, TIMER), timerUnit());
    systemctl('daemon-reload');
    systemctl('enable', '--now', TIMER);
    console.log(`Installed ${TIMER} in ${UNIT_DIR}`);
    if (lingering() === false) console.log(`\nOne more step, so it also runs without anyone logged in:\n  sudo loginctl enable-linger ${os.userInfo().username}`);
  },
  status() {
    if (!fs.existsSync(path.join(UNIT_DIR, TIMER))) return console.log('Not installed. Run: npm run schedule:install');
    try { console.log(systemctl('list-timers', TIMER, '--no-pager').trim()); } catch { console.log('Timer file exists but is not loaded. Run: npm run schedule:install'); }
  },
  print() { console.log(`# ${path.join(UNIT_DIR, SERVICE)}\n${serviceUnit()}\n# ${path.join(UNIT_DIR, TIMER)}\n${timerUnit()}`); },
};

const cmd = process.argv[2];
const impl = process.platform === 'darwin' ? mac : process.platform === 'linux' ? linux : null;
if (!['install', 'remove', 'status', 'print'].includes(cmd)) { console.log('Usage: node scripts/schedule.js install | remove | status | print'); process.exit(1); }
if (!impl) { console.log('macOS and Linux only.'); process.exit(1); }
impl[cmd]();
