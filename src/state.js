// data/: the state file (what was sent), the run lock, saved reports and the log. Spec 03.

const fs = require('fs');
const path = require('path');
const { DATA } = require('./env');

const STATE = () => path.join(DATA, 'state.json');
const LOCK = () => path.join(DATA, 'run.lock');
const LOG = () => path.join(DATA, 'logs', 'run.log');
const KEEP_MS = 8 * 7 * 86400e3; // state entries are pruned after 8 weeks

// ── State ───────────────────────────────────────────────────────────────────

function load() {
  let s = {};
  try { s = JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch {}
  return { sent: s.sent || {}, done: s.done || {}, failed: s.failed || {} };
}

function save(st) {
  fs.mkdirSync(DATA, { recursive: true });
  const cutoff = Date.now() - KEEP_MS;
  for (const group of [st.sent, st.done, st.failed]) {
    for (const [k, t] of Object.entries(group)) if (new Date(t).getTime() < cutoff) delete group[k];
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

// Held when the lock file's process is still running; otherwise taken over. The stale
// file is moved aside first, so two runs can't both take it.
function lock() {
  fs.mkdirSync(DATA, { recursive: true });
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      fs.writeFileSync(LOCK(), String(process.pid), { flag: 'wx' });
      return true;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
      const stalePid = readLock();
      if (pidAlive(stalePid)) return false;
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
  console.log(line);
  try {
    fs.mkdirSync(path.dirname(LOG()), { recursive: true });
    fs.appendFileSync(LOG(), `${line}\n`);
  } catch {}
}

// Keeps the log small: over 1 MB, only the last 200 kB are kept
function trimLog() {
  try { if (fs.statSync(LOG()).size > 1e6) fs.writeFileSync(LOG(), fs.readFileSync(LOG(), 'utf8').slice(-200e3)); } catch {}
}

module.exports = { load, save, lock, unlock, writeReport, log, trimLog, pidAlive };
