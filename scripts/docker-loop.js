// The container's scheduler: starts `node run.js` every config.checkEveryMinutes minutes, on the
// clock (:00, :10, :20 … for 10), like the launchd / systemd timers do. Spec 01.
//   node scripts/docker-loop.js            the loop (container command)
//   node scripts/docker-loop.js --health   exit 0 when a run has written to the log recently

require('../src/env');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const CFG = require('../config');
const { DATA } = require('../src/env');

const RUN = path.join(__dirname, '..', 'run.js');
const LOG = path.join(DATA, 'logs', 'run.log');
const LOCK = path.join(DATA, 'run.lock');
const EVERY = Number(CFG.checkEveryMinutes);

if (!Number.isInteger(EVERY) || EVERY < 5 || EVERY > 60) { console.log('config.js: checkEveryMinutes must be a whole number from 5 to 60.'); process.exit(1); }

if (process.argv.includes('--health')) {
  let age = Infinity;
  try { age = Date.now() - fs.statSync(LOG).mtimeMs; } catch {}
  const limit = (EVERY * 2 + 5) * 60e3;
  console.log(age < limit ? 'ok' : `no run for ${Math.round(age / 60e3)} min`);
  process.exit(age < limit ? 0 : 1);
}

let child = null;
let stopping = false;

function runOnce() {
  return new Promise((resolve) => {
    child = spawn(process.execPath, [RUN], { stdio: 'inherit' });
    child.on('close', () => { child = null; resolve(); });
    child.on('error', (err) => { console.log(`Could not start a run: ${err.message}`); child = null; resolve(); });
  });
}

const msToNext = () => { const n = Date.now(); return EVERY * 60e3 - (n % (EVERY * 60e3)); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

for (const sig of ['SIGTERM', 'SIGINT']) {
  process.on(sig, () => { stopping = true; if (child) child.kill(sig); else process.exit(0); });
}

(async () => {
  // This loop is the only runner: a lock left by a run that was cut off belongs to nobody
  try { fs.unlinkSync(LOCK); } catch {}
  console.log(`Pantti auctions Finland: a run every ${EVERY} minutes (on the clock). Time zone ${process.env.TZ}.`);
  while (!stopping) {
    await runOnce();
    if (stopping) break;
    await sleep(msToNext());
  }
  process.exit(0);
})();
