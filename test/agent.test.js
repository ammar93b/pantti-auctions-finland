// The scheduled run (spec 03): a message when an auction is listed, reminders before it
// closes, each sent once; failures alert once and are retried by the next run.
// Uses a temporary data folder, a fake auction site and a fake phone.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

process.env.PANTTI_DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'pantti-agent-test-'));
process.env.NTFY_TOPIC = 'test-topic';
const state = require('../src/state');
const agent = require('../src/agent');
const { minutesOf, minutesLabel } = require('../src/common');
const CFG = require('./cfg');
const env = require('../src/env');

const H = 3600e3;
const CLOSE = Date.parse('2026-10-26T17:00:00Z'); // Mon 26.10. 19:00 Helsinki (winter time)
const at = (msBeforeClose) => new Date(CLOSE - msBeforeClose);
const quiet = () => {};
const spotFn = async () => ({ gold: { eurG: 100 }, silver: { eurG: 1 } });
const cfg = { ...CFG, notify: { ...CFG.notify, whenListed: true, beforeClosing: ['10h', '30min'], listingCheckEvery: '60min', listingCheckHours: ['08:00', '22:00'] } };

const lot = (id, verdict) => ({
  id, title: `lot ${id}`, url: `https://example.fi/${id}`, closesAt: new Date(CLOSE).toISOString(),
  category: 'goldCoins', value: { status: 'ok', metal: 'gold', meltEur: 1000 },
  advice: verdict === 'buy' ? { verdict, next: 900, limit: 1050, maxBid: 1050, vsSpot: -0.1 } : { verdict: 'skip', next: 1200, limit: 1050, vsSpot: 0.2 },
});
const auction = { key: 'fake-A', source: 'fake', site: 'Fake', title: 'Fake auction', closesAt: new Date(CLOSE).toISOString(), url: 'https://example.fi', where: 'pickup at Vuosaari', proxyBids: true };

// A fake site: `lots` is what the listing and the reminder check see
function site(lots, { failCurrent = 0 } = {}) {
  let fails = failCurrent;
  return {
    id: 'fake', name: 'Fake',
    listed: async () => (lots.length ? [{ auction, lots }] : []),
    current: async () => { if (fails-- > 0) throw new Error('timed out'); return lots; },
  };
}
const phone = () => {
  const sent = [];
  const push = async (m) => { sent.push(m.title); return { sent: true }; };
  return { sent, push };
};
const run = (now, src, p, extra = {}) => agent.runDue({ now, sources: [src], push: p.push, spotFn, log: quiet, cfg, ...extra });
function reset() { fs.rmSync(process.env.PANTTI_DATA, { recursive: true, force: true }); }

test('listed once, then 10 h and 30 min before closing; nothing else', async () => {
  reset();
  const p = phone();
  const src = site([lot('1', 'buy'), lot('2', 'skip')]);
  assert.equal((await run(at(5 * 24 * H), src, p)).status, 'done'); // Wed 21.10. 19:00: listing check
  assert.equal(p.sent.length, 1);
  assert.match(p.sent[0], /^🏛 Fake auction: 2 lots listed · 1 🟢$/);
  assert.equal((await run(at(5 * 24 * H - 10 * 60e3), src, p)).status, 'idle'); // 10 min later: nothing due
  await run(at(5 * 24 * H - 2 * H), src, p); // a later listing check: nothing new
  assert.equal(p.sent.length, 1);
  await run(at(10 * H), src, p); // 09:00 on the day
  assert.match(p.sent[1], /^⏰ Fake auction closes in 10 h: 1 to bid on$/);
  assert.equal((await run(at(10 * H - 10 * 60e3), src, p)).status, 'idle');
  await run(at(30 * 60e3), src, p); // 18:30
  assert.match(p.sent[2], /^⏰ Fake auction closes in 30 min: 1 to bid on$/);
  assert.equal((await run(at(-60e3), src, p)).status, 'idle'); // closed
  assert.equal(p.sent.length, 3);
});

test('a missed reminder is skipped: a computer that wakes 20 min before closing sends only the 30 min one', async () => {
  reset();
  const p = phone();
  const src = site([lot('1', 'buy')]);
  await run(at(3 * 24 * H), src, p);
  await run(at(20 * 60e3), src, p);
  await run(at(10 * 60e3), src, p);
  assert.deepEqual(p.sent.map(t => t.split(':')[0]), ['🏛 Fake auction', '⏰ Fake auction closes in 30 min']);
});

test('an auction first seen when a reminder is due gets the reminder, not a listing message', async () => {
  reset();
  const p = phone();
  await run(at(9 * H), site([lot('1', 'buy')]), p); // first seen at 10:00 on the day
  assert.deepEqual(p.sent, ['⏰ Fake auction closes in 10 h: 1 to bid on']);
});

test('lots added later: a message only when a new lot is under the limit', async () => {
  reset();
  const p = phone();
  const lots = [lot('1', 'skip')];
  const src = site(lots);
  await run(at(5 * 24 * H), src, p);
  lots.push(lot('2', 'skip'));
  await run(at(4 * 24 * H), src, p); // only over-the-limit lots added: silent
  lots.push(lot('3', 'buy'));
  await run(at(3 * 24 * H), src, p);
  assert.deepEqual(p.sent, ['🏛 Fake auction: 1 lot listed · 0 🟢', '🏛 Fake auction: 1 new lot · 1 🟢']);
  assert.deepEqual(state.load().auctions['fake-A'].announced, ['1', '2', '3']);
});

test('a reminder that fails alerts once and is sent by the next run', async () => {
  reset();
  const p = phone();
  const src = site([lot('1', 'buy')], { failCurrent: 2 });
  await run(at(3 * 24 * H), src, p);
  assert.equal((await run(at(10 * H), src, p)).status, 'failed');
  assert.equal((await run(at(10 * H - 10 * 60e3), src, p)).status, 'failed');
  assert.equal((await run(at(10 * H - 20 * 60e3), src, p)).status, 'done');
  assert.deepEqual(p.sent.slice(1), ['⚠ Fake auction reminder failed', '⏰ Fake auction closes in 10 h: 1 to bid on']);
});

test('without a topic nothing is recorded as sent, and the run says why', async () => {
  reset();
  const r = await agent.runDue({ now: at(3 * 24 * H), sources: [site([lot('1', 'buy')])], push: async () => ({ skipped: 'no ntfy topic (NTFY_TOPIC in .env)' }), spotFn, log: quiet, cfg });
  assert.equal(r.status, 'failed');
  assert.match(r.error, /no ntfy topic/);
  assert.deepEqual(state.load().auctions['fake-A'].announced, []);
});

test('no listing checks at night; the listing check waits its interval', async () => {
  reset();
  let reads = 0;
  const src = { ...site([lot('1', 'skip')]), listed: async () => { reads++; return []; } };
  const p = phone();
  await run(new Date('2026-10-21T21:00:00Z'), src, p); // 00:00 Helsinki
  assert.equal(reads, 0);
  await run(new Date('2026-10-21T06:00:00Z'), src, p); // 09:00
  await run(new Date('2026-10-21T06:30:00Z'), src, p); // 09:30: not yet
  await run(new Date('2026-10-21T06:59:00Z'), src, p); // 09:59: within 2 minutes of the hour
  assert.equal(reads, 2);
});

test('a site with no lots for 7 days warns once', async () => {
  reset();
  const p = phone();
  const src = site([]);
  const c = { ...cfg, sources: { ...cfg.sources, fake: { warnAfterDaysWithoutLots: 7 } } };
  const day = (d) => new Date(Date.parse('2026-10-21T07:00:00Z') + d * 24 * H);
  for (const d of [0, 3, 7, 8]) await agent.runDue({ now: day(d), sources: [src], push: p.push, spotFn, log: quiet, cfg: c });
  assert.deepEqual(p.sent, ['⚠ Fake reading failed']);
});

test('reminder times are written like 10h, 30min, 1h30min', () => {
  assert.equal(minutesOf('10h'), 600);
  assert.equal(minutesOf('30min'), 30);
  assert.equal(minutesOf('1h30min'), 90);
  assert.equal(minutesOf('45m'), 45);
  assert.throws(() => minutesOf('ten hours'), /not a time/);
  assert.equal(minutesLabel(600), '10 h');
  assert.equal(minutesLabel(90), '1 h 30 min');
  assert.deepEqual(agent.reminderMinutes({ notify: { beforeClosing: ['30min', '10h', '30min'] } }), [600, 30]);
});

test('the default settings: listed, 10 h and 30 min before closing; the four categories', () => {
  const REAL = require('../config');
  assert.equal(REAL.notify.whenListed, true);
  assert.deepEqual(agent.reminderMinutes(REAL), [600, 30]);
  assert.deepEqual(Object.keys(REAL.categories), ['goldCoins', 'silverCoins', 'junkGold', 'junkSilver']);
  assert.equal(REAL.minMetalEur, 30);
});

test('limits from .env: % of metal value from -50 to 100; ALERT defaults to MAX and is never above it', () => {
  assert.equal(env.pct('5'), 5);
  assert.equal(env.pct('-5'), -5);
  assert.equal(env.pct('2.5'), 2.5);
  for (const bad of [undefined, '', ' ', 'abc', '-51', '101']) assert.equal(env.pct(bad), 0);
  process.env.T1_MAX_PCT = '0'; process.env.T1_ALERT_PCT = '-5';
  assert.deepEqual(env.limitsOf('T1'), { maxPct: 0, alertPct: -5 });
  process.env.T2_MAX_PCT = '5';
  assert.deepEqual(env.limitsOf('T2'), { maxPct: 5, alertPct: 5 });
  process.env.T3_MAX_PCT = '0'; process.env.T3_ALERT_PCT = '10';
  assert.deepEqual(env.limitsOf('T3'), { maxPct: 0, alertPct: 0 });
  assert.deepEqual(env.limitsOf('UNSET'), { maxPct: 0, alertPct: 0 });
});

test('an auction\'s closing time only moves earlier, so later lots don\'t shift its reminders', async () => {
  reset();
  const p = phone();
  const lots = [lot('1', 'skip')];
  let closesAt = new Date(CLOSE).toISOString();
  const src = { ...site(lots), listed: async () => [{ auction: { ...auction, closesAt }, lots }] };
  await run(at(3 * 24 * H), src, p);
  closesAt = new Date(CLOSE + 2 * H).toISOString(); // the first lot has closed: the next one is later
  await run(at(2 * 24 * H), src, p);
  assert.equal(state.load().auctions['fake-A'].closesAt, new Date(CLOSE).toISOString());
});

test('messages: lots in the four categories, each with its own 🟢 price', () => {
  const { listedMessage, reminderMessage } = require('../src/messages');
  const mk = (id, category, verdict, metal = 'gold') => ({
    ...lot(id, verdict), category, value: { status: 'ok', metal, meltEur: 1000 },
  });
  const lots = [mk('1', 'goldCoins', 'buy'), mk('2', 'junkSilver', 'buy', 'silver'), mk('3', 'junkGold', 'skip'),
    { id: '4', title: 'lot 4', value: { status: 'check', reason: 'fineness not stated' }, advice: { verdict: 'check' } }];
  const m = listedMessage(auction, lots, { cfg, reminders: [600, 30] });
  assert.match(m.title, /4 lots listed · 2 🟢$/);
  assert.match(m.message, /3 valued by weight, 1 to check by hand/);
  const heads = m.message.split('\n').filter(l => l.startsWith('— ')).map(l => l.split(':')[0]);
  assert.deepEqual(heads, ['— Gold coins & bars', '— Junk gold', '— Junk silver']);
  assert.match(m.message, /— Junk silver: 1 · 1 🟢 \(🟢 at −5,0 % · max 0,0 % vs metal\)/);
  const r = reminderMessage(auction, lots, 30, { cfg });
  assert.match(r.title, /closes in 30 min: 2 to bid on/);
  assert.deepEqual(r.message.split('\n').filter(l => l.startsWith('— ')).map(l => l.split(' (')[0]), ['— Gold coins & bars', '— Junk silver']);
});

test.after(() => reset());
