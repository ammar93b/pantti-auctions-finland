// Installs the scheduled runs. Spec 01.
//   node scripts/schedule.js install | remove | status | print
//   macOS → launchd agent with one StartCalendarInterval per run time (the Mac must be on Finnish time)
//   Linux → systemd user service + timer, OnCalendar in Europe/Helsinki, Persistent=true

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

// Each run time: { weekday (1 = Monday … 5 = Friday), hour, minute, name }
function times() {
  const list = [];
  for (const [day, wd, name] of [['friday', 5, 'Fri'], ['tuesday', 2, 'Tue']]) {
    for (const t of CFG.schedule[day]) {
      const [h, m] = t.split(':').map(Number);
      list.push({ wd, h, m, name, t });
    }
  }
  return list;
}

// ── macOS: launchd ──────────────────────────────────────────────────────────

const LABEL = 'fi.helsinginpantti.agent';
const PLIST = path.join(os.homedir(), 'Library', 'LaunchAgents', `${LABEL}.plist`);
const xml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const launchctl = (...a) => execFileSync('launchctl', a, { stdio: 'pipe' }).toString();
const domain = () => `gui/${process.getuid()}`;

function plist() {
  const intervals = times().map(x => `    <dict><key>Weekday</key><integer>${x.wd}</integer><key>Hour</key><integer>${x.h}</integer><key>Minute</key><integer>${x.m}</integer></dict>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key>
  <array><string>${xml(NODE)}</string><string>${xml(RUN)}</string></array>
  <key>WorkingDirectory</key><string>${xml(ROOT)}</string>
  <key>StartCalendarInterval</key>
  <array>
${intervals}
  </array>
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
    try { launchctl('bootout', `${domain()}/${LABEL}`); } catch {}
    if (fs.existsSync(PLIST)) fs.unlinkSync(PLIST);
    if (!quiet) console.log('Removed: no more scheduled runs.');
  },
  install() {
    fs.mkdirSync(path.dirname(LOG), { recursive: true });
    fs.mkdirSync(path.dirname(PLIST), { recursive: true });
    mac.remove({ quiet: true });
    fs.writeFileSync(PLIST, plist());
    launchctl('bootstrap', domain(), PLIST);
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    console.log(`Installed ${PLIST}`);
    console.log(`Runs (this Mac's clock, ${tz}): ${times().map(x => `${x.name} ${x.t}`).join(', ')}`);
    if (tz !== 'Europe/Helsinki') console.log('Note: this Mac is not on Finnish time; launchd uses the Mac clock. Set the time zone to Helsinki.');
  },
  status() {
    if (!fs.existsSync(PLIST)) return console.log('Not installed. Run: npm run schedule:install');
    try { launchctl('print', `${domain()}/${LABEL}`); console.log(`Installed and loaded: ${times().map(x => `${x.name} ${x.t}`).join(', ')}`); }
    catch { console.log('Plist exists but is not loaded. Run: npm run schedule:install'); }
  },
  print() { console.log(`# ${PLIST}\n${plist()}`); },
};

// ── Linux: systemd user timer ───────────────────────────────────────────────

const UNIT_DIR = path.join(os.homedir(), '.config', 'systemd', 'user');
const SERVICE = 'helsingin-pantti.service';
const TIMER = 'helsingin-pantti.timer';
const q = (s) => `"${String(s).replace(/(["\\])/g, '\\$1')}"`;
const systemctl = (...a) => execFileSync('systemctl', ['--user', ...a], { stdio: 'pipe' }).toString();

const serviceUnit = () => `[Unit]
Description=Helsingin Pantti agent (one run)
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
Description=Helsingin Pantti agent: Friday list and Tuesday bid advice

[Timer]
${times().map(x => `OnCalendar=${x.name} *-*-* ${x.t}:00 Europe/Helsinki`).join('\n')}
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
    try { systemctl('disable', '--now', TIMER); } catch {}
    for (const f of [SERVICE, TIMER]) { const p = path.join(UNIT_DIR, f); if (fs.existsSync(p)) fs.unlinkSync(p); }
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
