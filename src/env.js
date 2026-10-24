// Loads .env (KEY=value lines) into process.env without overriding real env vars,
// sets Finnish time, and names the data folder.

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');

function loadEnv() {
  const file = path.join(ROOT, '.env');
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#') || process.env[m[1]] !== undefined) continue;
    let v = m[2];
    // One pair of quotes is removed only when it wraps the whole value
    if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0] && !v.slice(1, -1).includes(v[0])) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

loadEnv();

// The schedule and messages are Finnish time, whatever the computer's own clock says
if (!process.env.TZ) process.env.TZ = 'Europe/Helsinki';

// Your limits, in % of the metal value, from .env (never uploaded): <CATEGORY>_MAX_PCT is the
// most you bid, <CATEGORY>_ALERT_PCT the price at which a lot is marked 🟢 (default: the max).
// Not set or not a number from -50 to 100: 0 %, so never above the metal value.
function pct(value, fallback = 0) {
  const n = Number(value);
  return value !== undefined && String(value).trim() !== '' && Number.isFinite(n) && n >= -50 && n <= 100 ? n : fallback;
}
function limitsOf(prefix) {
  const maxPct = pct(process.env[`${prefix}_MAX_PCT`]);
  return { maxPct, alertPct: Math.min(maxPct, pct(process.env[`${prefix}_ALERT_PCT`], maxPct)) };
}

module.exports = {
  ROOT,
  // PANTTI_DATA lets the tests use a temporary folder
  DATA: process.env.PANTTI_DATA || path.join(ROOT, 'data'),
  NTFY_TOPIC: process.env.NTFY_TOPIC || '',
  LIMITS: {
    GOLD_COINS: limitsOf('GOLD_COINS'), SILVER_COINS: limitsOf('SILVER_COINS'),
    JUNK_GOLD: limitsOf('JUNK_GOLD'), JUNK_SILVER: limitsOf('JUNK_SILVER'),
  },
  pct, limitsOf,
};
