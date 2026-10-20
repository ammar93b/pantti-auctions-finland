// Auction reading, valuation, bid rules and the Helsinki-time window (spec 02).
// Run with: npm test
// The fixtures are saved copies of the live auction 966 pages (test/fixtures/pantti).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const p = require('../src/pantti');

const FX = path.join(__dirname, 'fixtures', 'pantti');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const SPOT = { gold: { eurG: 100 }, silver: { eurG: 1 } };

test('coin list: 30 lots on page 1, 8 on page 2, with weights and fineness', () => {
  const p0 = p.parseList(read('list-coins-p0.html'), 5);
  const p1 = p.parseList(read('list-coins-p1.html'), 5);
  assert.equal(p0.length, 30);
  assert.equal(p1.length, 8);
  const lot190 = p0.find(l => l.id === '190');
  assert.equal(lot190.url, 'https://huutokauppa.pantti.fi/huutokauppa/966/190-rahat-ja-mitalit-myyntiera-190');
  assert.deepEqual(lot190.parts, [{ desc: '2 KULTARAHAA', weight: '1,7', fine: '999,9' }]);
  assert.equal(lot190.listPrice, 200);
  assert.equal(lot190.startingPrice, false);
  assert.match(lot190.ends, /20\.10\. klo 18:05/);
  // Lot 510 has no bids yet: the list shows its start price
  const lot510 = p0.find(l => l.id === '510');
  assert.equal(lot510.startingPrice, true);
  assert.equal(lot510.listPrice, 45);
});

test('silver list: multi-row lots keep every sub-lot and its fineness code', () => {
  const lots = p.parseList(read('list-silver-p0.html'), 2);
  assert.equal(lots.length, 30);
  const lot15 = lots.find(l => l.id === '15');
  assert.equal(lot15.parts.length, 4);
  assert.deepEqual(lot15.parts[0], { desc: 'ERÄ HOPEAA', weight: '35,4', fine: 'H925BR' });
  assert.deepEqual(lot15.parts[2], { desc: 'ERÄ HOPEAA', weight: '82,7', fine: 'H830BR' });
  assert.deepEqual(lot15.parts[3], { desc: 'ERÄ HOPEAA', weight: '60', fine: 'H813BR' });
});

test('fineness codes: H-prefix, BR (gross) suffix, comma decimals, unknown', () => {
  assert.deepEqual(p.parseFineness('H925BR'), { value: 0.925, brutto: true });
  assert.deepEqual(p.parseFineness('585BR'), { value: 0.585, brutto: true });
  assert.deepEqual(p.parseFineness('999,9'), { value: 0.9999, brutto: false });
  assert.deepEqual(p.parseFineness('9999'), { value: 0.9999, brutto: false });
  assert.equal(p.parseFineness('HOP'), null);
  assert.equal(p.parseFineness(''), null);
});

test('metal from the description; plated and gilded items are never solid metal', () => {
  assert.equal(p.metalOf('ERÄ HOPEAA'), 'silver');
  assert.equal(p.metalOf('2 KULTARAHAA'), 'gold');
  assert.equal(p.metalOf('LAATTA UMICORE'), null);
  assert.equal(p.metalOf('KULTAUS HOPEA'), null);
  assert.equal(p.metalOf('HOPEOITU LUSIKKA'), null);
});

test('valuation: gold coin lot with its weight and fineness', () => {
  const lot = p.parseList(read('list-coins-p0.html'), 5).find(l => l.id === '190');
  const v = p.valueLot(lot, SPOT);
  assert.equal(v.status, 'ok');
  assert.equal(v.metal, 'gold');
  assert.equal(v.fineG, 1.6998); // 1.7 g × 0.9999 = 1.6998 g of fine gold
  assert.equal(v.meltEur, 169.98);
});

test('valuation: silver lot adds up every sub-lot; BR sub-lots count only the silver share', () => {
  const lot = p.parseList(read('list-silver-p0.html'), 2).find(l => l.id === '15');
  const v = p.valueLot(lot, SPOT);
  // Sub-lots: 35.4 BR×0.925, 71.5×0.916 (not BR), 82.7 BR×0.830, 60 BR×0.813.
  // BR rows count 30 % of the weight: 35.4×0.30×0.925 + 71.5×0.916 + 82.7×0.30×0.830 + 60×0.30×0.813
  const expected = 35.4 * 0.30 * 0.925 + 71.5 * 0.916 + 82.7 * 0.30 * 0.830 + 60 * 0.30 * 0.813;
  assert.equal(v.status, 'ok');
  assert.ok(Math.abs(v.fineG - expected) < 0.001, `fineG ${v.fineG} vs ${expected}`);
  assert.ok(Math.abs(v.meltEur - expected) < 0.01); // silver at 1 €/g in the test spot
  assert.equal(v.brutto, true);
  assert.equal(v.brShare, 0.30);
});

test('the owner\'s BR example: 1000 g of 830 BR is 30 % silver, so 300 g at 830 = 249 g fine', () => {
  const lot = { id: 'z', parts: [{ desc: 'ERÄ HOPEAA', weight: '1000', fine: 'H830BR' }] };
  const v = p.valueLot(lot, SPOT);
  assert.equal(v.status, 'ok');
  assert.equal(v.fineG, 249);
});

test('a lot with an unstated fineness is "check by hand", never valued', () => {
  const lot = { id: 'x', parts: [{ desc: 'ERÄ HOPEAA', weight: '60,8', fine: 'HOP' }] };
  const v = p.valueLot(lot, SPOT);
  assert.equal(v.status, 'check');
  assert.match(v.reason, /fineness not stated/);
});

test('a lot with no table at all is "check by hand"', () => {
  assert.equal(p.valueLot({ id: 'y', parts: [] }, SPOT).status, 'check');
});

test('next legal bid: top bid + minimum raise, or the start price with no bids', () => {
  assert.equal(p.minimumNext({ topBid: 200, minRaise: 10, startPrice: 180 }), 210);
  assert.equal(p.minimumNext({ topBid: 0, minRaise: 10, startPrice: 240 }), 240);
});

test('verdicts: coins may go to +10 % over metal value, silver never above it', () => {
  const coin = { catName: 'coins', value: { status: 'ok', meltEur: 169.98 } };
  const silver = { catName: 'silver', value: { status: 'ok', meltEur: 215.66 } };
  // coins: limit = floor(169.98 × 1.10) = 186 (whole euros above 100 €); next 210 → skip
  assert.equal(p.advise(coin, { topBid: 200, minRaise: 10, startPrice: 180, timeLeftSec: 3600, biddingAllowed: true }).verdict, 'skip');
  // coins: next 170 is under the limit → buy
  const buy = p.advise(coin, { topBid: 160, minRaise: 10, startPrice: 150, timeLeftSec: 3600, biddingAllowed: true });
  assert.equal(buy.verdict, 'buy');
  assert.equal(buy.next, 170);
  assert.equal(buy.limit, 186);
  // silver: limit = 215 (never above metal value); a start price of 240 is above it
  const s = p.advise(silver, { topBid: 0, minRaise: 10, startPrice: 240, timeLeftSec: 3600, biddingAllowed: true });
  assert.equal(s.verdict, 'skip');
  assert.equal(s.limit, 215);
  // …and a start price of 200 is under it
  assert.equal(p.advise(silver, { topBid: 0, minRaise: 10, startPrice: 200, timeLeftSec: 3600, biddingAllowed: true }).verdict, 'buy');
  // closed lots are not advised
  assert.equal(p.advise(coin, { topBid: 160, minRaise: 10, startPrice: 150, timeLeftSec: 0, biddingAllowed: true }).verdict, 'closed');
});

test('the bid feed is read as the lot page reads it (fixture)', () => {
  const j = JSON.parse(read('bid-190.json'));
  assert.equal(j.status, 'ok');
  assert.equal(p.minimumNext({ topBid: j.data.top_bid, minRaise: j.data.min_raise, startPrice: j.data.bid_start }), 210);
});

test('auction window: Friday 17:00 to Tuesday 18:00 in Helsinki time, number 966 then 967', () => {
  const at = (iso) => new Date(iso);
  // Helsinki is on summer time (UTC+3) until 25 Oct 2026, so 17:00 Helsinki = 14:00 UTC
  assert.equal(p.auctionAt(at('2026-10-16T13:59:00Z')), null); // 16:59 Helsinki, not open yet
  assert.equal(p.auctionAt(at('2026-10-16T14:00:00Z')).number, 966); // 17:00 Helsinki: opens
  assert.equal(p.auctionAt(at('2026-10-16T14:00:00Z')).opens.toISOString(), '2026-10-16T14:00:00.000Z');
  assert.equal(p.auctionAt(at('2026-10-19T10:00:00Z')).number, 966); // Monday
  const tue = p.auctionAt(at('2026-10-20T14:30:00Z')); // Tue 17:30 Helsinki
  assert.equal(tue.number, 966);
  assert.equal(tue.adviseAt.toISOString(), '2026-10-20T14:00:00.000Z'); // Tue 17:00 Helsinki: advice
  assert.equal(p.auctionAt(at('2026-10-20T15:30:00Z')), null); // Tue 18:30 Helsinki: over
  assert.equal(p.auctionAt(at('2026-10-23T14:00:00Z')).number, 967); // next Friday 17:00
  // Winter time after 25 Oct: Friday 17:00 Helsinki = 15:00 UTC
  assert.equal(p.auctionAt(at('2026-10-30T15:00:00Z')).number, 968);
});

test('auction numbers step by one each week from the reference', () => {
  const cfg = { reference: { auction: 966, friday: '2026-10-16' } };
  assert.equal(p.auctionNumber('2026-10-16', cfg), 966);
  assert.equal(p.auctionNumber('2026-10-23', cfg), 967);
  assert.equal(p.auctionNumber('2026-10-30', cfg), 968);
});

test('the Friday message lists both links, value first, and says when the advice comes', () => {
  const lots = [
    ...p.parseList(read('list-coins-p0.html'), 5), ...p.parseList(read('list-coins-p1.html'), 5),
  ].map(l => ({ ...l, catName: 'coins' }))
    .concat(p.parseList(read('list-silver-p0.html'), 2).map(l => ({ ...l, catName: 'silver' })))
    .map(l => ({ ...l, value: p.valueLot(l, SPOT) }));
  const m = p.announceMessage({ number: 966 }, lots);
  assert.match(m.title, /auction 966 is open · 68 lots/);
  assert.match(m.message, /Tuesday 17:00/);
  assert.match(m.message, /Coins & medals: 38 lots/);
  assert.match(m.message, /Silver: 30 lots/);
});

test('phases: the Friday list only in the first 3 hours; the Tuesday advice until the window closes', () => {
  assert.equal(p.phaseDue(p.auctionAt(new Date('2026-10-20T14:30:00Z')), { done: {} }, new Date('2026-10-20T15:05:00Z')), null); // Tue 18:05: closed
  const at = (iso) => new Date(iso);
  const fri = p.auctionAt(at('2026-10-16T14:30:00Z')); // Fri 17:30 Helsinki
  assert.equal(p.phaseDue(fri, { done: {} }, at('2026-10-16T14:30:00Z')), 'announce');
  assert.equal(p.phaseDue(fri, { done: {} }, at('2026-10-16T19:30:00Z')), null); // 22:30 Friday: too late for the list
  const sat = p.auctionAt(at('2026-10-17T19:26:00Z')); // the Saturday restart that sent it late
  assert.equal(p.phaseDue(sat, { done: {} }, at('2026-10-17T19:26:00Z')), null);
  assert.equal(p.phaseDue(fri, { done: { '966-announce': 'x' } }, at('2026-10-16T14:30:00Z')), null); // already sent
  const tue = p.auctionAt(at('2026-10-20T14:30:00Z')); // Tue 17:30 Helsinki
  assert.equal(p.phaseDue(tue, { done: { '966-announce': 'x' } }, at('2026-10-20T14:30:00Z')), 'advise');
  assert.equal(p.phaseDue(tue, { done: { '966-announce': 'x', '966-advise': 'x' } }, at('2026-10-20T14:30:00Z')), null);
});

test('review fixes: pure 1000 fineness, plated Finnish words, mixed metal words, gold gross weight', () => {
  assert.deepEqual(p.parseFineness('1000'), { value: 1, brutto: false });
  assert.equal(p.metalOf('Hopeapäällystetty rasia'), null);
  assert.equal(p.metalOf('Hopeasormus kultakivellä'), null);
  assert.equal(p.metalOf('Hopea 925'), 'silver');
  const gold = { id: 'g', parts: [{ desc: 'KULTAKORU', weight: '10', fine: 'H585BR' }] };
  const v = p.valueLot(gold, SPOT);
  assert.equal(v.status, 'check');
  assert.match(v.reason, /gross \(BR\) gold/);
});


test('a manual run before Friday 17:00 uses the last auction that has opened', () => {
  const fri10 = new Date('2026-10-23T07:00:00Z'); // Fri 10:00 Helsinki, 967 not open yet
  assert.equal(p.auctionAt(fri10), null);
  assert.equal(p.auctionAt(fri10, { any: true }).number, 966);
});
