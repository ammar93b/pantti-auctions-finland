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

module.exports = {
  ROOT,
  // PANTTI_DATA lets the tests use a temporary folder
  DATA: process.env.PANTTI_DATA || path.join(ROOT, 'data'),
  NTFY_TOPIC: process.env.NTFY_TOPIC || '',
};
