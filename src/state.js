// data/: the state file (auctions seen, messages sent), the run lock, saved reports and the log. Spec 03.

const fs = require('fs');
const path = require('path');
const { DATA } = require('./env');

const STATE = () => path.join(DATA, 'state.json');
const LOCK = () => path.join(DATA, 'run.lock');
const LOG = () => path.join(DATA, 'logs', 'run.log');
const KEEP_MS = 8 * 7 * 86400e3; // sent / failed entries are pruned after 8 weeks
const KEEP_AUCTION_MS = 14 * 86400e3; // auctions two weeks after they close

// ── State ───────────────────────────────────────────────────────────────────

function load() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch {}
  return { sent: s.sent || {}, failed: s.failed || {}, auctions: s.auctions || {}, meta: s.meta || {} };
}

function save(st) {
  fs.mkdirSync(DATA, { recursive: true });
  const cutoff = Date.now() - KEEP_MS;
  for (const group of [st.sent, st.failed]) {
    for (const [k, t] of Object.entries(group)) if (new Date(t).getTime() < cutoff) delete group[k];
  }
  for (const [k, a] of Object.entries(st.auctions || {})) {
    if (Date.parse(a.closesAt) < Date.now() - KEEP_AUCTION_MS) delete st.auctions[k];
  }
  // Write then rename, so a killed run never leaves half a file
  fs.writeFileSync(`${STATE()}.tmp`, JSON.stringify(st, null, 2));
  fs.renameSync(`${STATE()}.tmp`, STATE());
}

// ── Lock: one run at a time ─────────────────────────────────────────────────

const readLock = () => { try { return fs.readFileSync(LOCK(), 'utf8').trim(); } catch { return null; } };
function pidAlive(pid) {
  const n = Number(pid);
  if (!Number.isInteger(n) || n <= 0) return false;
  try { process.kill(n, 0); return true; } catch (e) { return e.code === 'EPERM'; }
}

// A run takes a minute or two. A lock older than this was left by a run that was cut off
// (a power cut on a Raspberry Pi): after a reboot its process id may belong to another program.
const LOCK_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const lockAge = () => { try { return Date.now() - fs.statSync(LOCK()).mtimeMs; } catch { return 0; } };

// Held when the lock file's process is still running and the lock is younger than
// LOCK_MAX_AGE_MS; otherwise taken over. The stale file is moved aside first, so two runs
// can't both take it.
function lock() {
  fs.mkdirSync(DATA, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(LOCK(), String(process.pid), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const stalePid = readLock();
      if (pidAlive(stalePid) && lockAge() < LOCK_MAX_AGE_MS) return false;
      const aside = `${LOCK()}.stale-${process.pid}`;
      try {
        fs.renameSync(LOCK(), aside);
        if (fs.readFileSync(aside, 'utf8').trim() !== stalePid) {
          try { fs.linkSync(aside, LOCK()); } catch {}
          fs.unlinkSync(aside);
          return false;
        }
        fs.unlinkSync(aside);
      } catch {}
    }
  }
  return false;
}

function unlock() {
  try { if (readLock() === String(process.pid)) fs.unlinkSync(LOCK()); } catch {}
}

// ── Reports and log ─────────────────────────────────────────────────────────

function writeReport(name, textContent) {
  const dir = path.join(DATA, 'reports');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, name), textContent);
  return path.join(dir, name);
}

function log(...parts) {
  const line = `${new Date().toLocaleString('fi-FI')} ${parts.join(' ')}`;
  // The scheduler already sends the output to the log file: print only in a terminal
  if (process.stdout.isTTY) console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG()), { recursive: true });
    fs.appendFileSync(LOG(), `${line}\n`);
  } catch {}
}

// Keeps the log small: over 1 MB, only the last 200 kB are kept
function trimLog() {
  try { if (fs.statSync(LOG()).size > 1e6) fs.writeFileSync(LOG(), fs.readFileSync(LOG(), 'utf8').slice(-200e3)); } catch {}
}

module.exports = { load, save, lock, unlock, writeReport, log, trimLog, pidAlive, LOCK_MAX_AGE_MS };
