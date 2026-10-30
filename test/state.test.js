// The state file and the run lock (spec 03). Uses a temporary data folder.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.PANTTI_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pantti-state-test-'));
const state = require('../src/state');

function reset() { fs.rmSync(process.env.PANTTI_DATA, { recursive: true, force: true }); }

test('a broken or missing state file reads as empty', () => {
  reset();
  assert.deepEqual(state.load(), { sent: {}, failed: {}, auctions: {}, meta: {} });
  fs.mkdirSync(process.env.PANTTI_DATA, { recursive: true });
  fs.writeFileSync(path.join(process.env.PANTTI_DATA, 'state.json'), '{ half a fi');
  assert.deepEqual(state.load(), { sent: {}, failed: {}, auctions: {}, meta: {} });
});

test('old entries are pruned: messages after 8 weeks, auctions 2 weeks after closing', () => {
  reset();
  const old = new Date(Date.now() - 60 * 86400e3).toISOString();
  const recent = new Date(Date.now() - 86400e3).toISOString();
  state.save({
    sent: { a: old, b: recent }, failed: { c: old },
    auctions: { x: { closesAt: new Date(Date.now() - 15 * 86400e3).toISOString() }, y: { closesAt: recent } },
    meta: { lastListingCheck: recent },
  });
  const st = state.load();
  assert.deepEqual(Object.keys(st.sent), ['b']);
  assert.deepEqual(st.failed, {});
  assert.deepEqual(Object.keys(st.auctions), ['y']);
  assert.equal(st.meta.lastListingCheck, recent);
});

test('a lock whose process is gone is taken over; a live one is respected', () => {
  reset();
  fs.mkdirSync(process.env.PANTTI_DATA, { recursive: true });
  const lockFile = path.join(process.env.PANTTI_DATA, 'run.lock');
  fs.writeFileSync(lockFile, '999999');
  assert.equal(state.lock(), true);
  state.unlock();
  assert.equal(fs.existsSync(lockFile), false);
  fs.writeFileSync(lockFile, String(process.ppid)); // a live process
  assert.equal(state.lock(), false);
  // Left over from before a reboot: the id now belongs to another program, but the lock is old
  const old = (Date.now() - state.LOCK_MAX_AGE_MS - 60000) / 1000;
  fs.utimesSync(lockFile, old, old);
  assert.equal(state.lock(), true);
  state.unlock();
  assert.equal(fs.existsSync(lockFile), false);
});

test.after(() => reset());
