// The scheduled run: each message is sent once, failures alert once, retries resend
// only what is missing (spec 03). Uses a temporary data folder and fake senders.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.PANTTI_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pantti-test-'));
process.env.NTFY_TOPIC = 'test-topic';
const state = require('../src/state');
const p = require('../src/pantti');

const TUE_1700 = new Date('2026-10-20T14:00:00Z');
const TUE_1715 = new Date('2026-10-20T14:15:00Z');
const FRI_1700 = new Date('2026-10-23T14:00:00Z');
const FRI_1730 = new Date('2026-10-23T14:30:00Z');
const quiet = () => {};
const msg = (t) => ({ title: t, message: t });

function reset() { fs.rmSync(process.env.PANTTI_DATA, { recursive: true, force: true }); }

test('Tuesday: coins sent, silver fails → one alert; next run sends only silver, no second alert', async () => {
  reset();
  const sent = [];
  const push = async (m) => { sent.push(m.title); return { sent: true }; };
  const r1 = await p.runDue({ now: TUE_1700, push, log: quiet,
    build: async (phase, a, { skip }) => ({ items: [{ id: 'coins', msg: msg('coins') }], errors: { silver: 'silver: timed out' }, skip }) });
  assert.equal(r1.status, 'failed');
  assert.deepEqual(sent, ['coins', '⚠ Pantti check failed']);
  let askedSkip;
  const r2 = await p.runDue({ now: TUE_1715, push, log: quiet,
    build: async (phase, a, { skip }) => { askedSkip = skip; return { items: [{ id: 'silver', msg: msg('silver') }], errors: {} }; } });
  assert.equal(r2.status, 'done');
  assert.deepEqual(askedSkip, ['coins']);
  assert.deepEqual(sent, ['coins', '⚠ Pantti check failed', 'silver']);
  const r3 = await p.runDue({ now: new Date('2026-10-20T14:30:00Z'), push, log: quiet, build: async () => { throw new Error('should not run'); } });
  assert.equal(r3.status, 'idle');
});

test('Friday: the list is sent once; the 17:30 run does nothing', async () => {
  reset();
  const sent = [];
  const push = async (m) => { sent.push(m.title); return { sent: true }; };
  const build = async () => ({ items: [{ id: 'list', msg: msg('list') }], errors: {} });
  assert.equal((await p.runDue({ now: FRI_1700, push, build, log: quiet })).status, 'done');
  assert.equal((await p.runDue({ now: FRI_1730, push, build, log: quiet })).status, 'idle');
  assert.deepEqual(sent, ['list']);
  assert.ok(fs.existsSync(path.join(process.env.PANTTI_DATA, 'reports', 'pantti-967-announce.txt')));
});

test('a message ntfy rejected is sent again at the next run time', async () => {
  reset();
  let calls = 0;
  const flaky = async (m) => { calls++; if (m.title === 'list' && calls === 1) throw new Error('ntfy answered 502'); return { sent: true }; };
  const build = async () => ({ items: [{ id: 'list', msg: msg('list') }], errors: {} });
  assert.equal((await p.runDue({ now: FRI_1700, push: flaky, build, log: quiet })).status, 'failed');
  assert.equal((await p.runDue({ now: FRI_1730, push: flaky, build, log: quiet })).status, 'done');
});

test('without a topic nothing is recorded as sent and the run says why', async () => {
  reset();
  const build = async () => ({ items: [{ id: 'list', msg: msg('list') }], errors: {} });
  const r = await p.runDue({ now: FRI_1700, push: async () => ({ skipped: 'no ntfy topic (NTFY_TOPIC in .env)' }), build, log: quiet });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /no ntfy topic/);
  assert.deepEqual(state.load().sent, {});
});

test('outside the window nothing happens', async () => {
  reset();
  const r = await p.runDue({ now: new Date('2026-10-21T10:00:00Z'), push: async () => { throw new Error('no'); }, build: async () => { throw new Error('no'); }, log: quiet });
  assert.equal(r.status, 'idle');
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
  fs.unlinkSync(lockFile);
});

test.after(() => reset());
