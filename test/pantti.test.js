// Helsingin Pantti: auction reading, valuation, bid rules and the Helsinki-time window (spec 02).
// Run with: npm test
// The fixtures are saved copies of the live auction 966 pages (test/fixtures/pantti).

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const p = require('../src/pantti');
const { parseFineness } = require('../src/common');
const CFG = require('./cfg');

const FX = path.join(__dirname, 'fixtures', 'pantti');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const SPOT = { gold: { eurG: 100 }, silver: { eurG: 1 } };

test('coin list: 30 lots on page 1, 8 on page 2, with weights and fineness', () => {
  const p0 = p.parseList(read('list-coins-p0.html'), 'coins & medals');
  const p1 = p.parseList(read('list-coins-p1.html'), 'coins & medals');
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
  const lots = p.parseList(read('list-silver-p0.html'), 'silver');
  assert.equal(lots.length, 30);
  const lot15 = lots.find(l => l.id === '15');
  assert.equal(lot15.parts.length, 4);
  assert.deepEqual(lot15.parts[0], { desc: 'ERÄ HOPEAA', weight: '35,4', fine: 'H925BR' });
  assert.deepEqual(lot15.parts[2], { desc: 'ERÄ HOPEAA', weight: '82,7', fine: 'H830BR' });
  assert.deepEqual(lot15.parts[3], { desc: 'ERÄ HOPEAA', weight: '60', fine: 'H813BR' });
});

test('fineness codes: H-prefix, BR (gross) suffix, comma decimals, unknown', () => {
  assert.deepEqual(parseFineness('H925BR'), { value: 0.925, brutto: true });
  assert.deepEqual(parseFineness('585BR'), { value: 0.585, brutto: true });
  assert.deepEqual(parseFineness('999,9'), { value: 0.9999, brutto: false });
  assert.deepEqual(parseFineness('9999'), { value: 0.9999, brutto: false });
  assert.equal(parseFineness('HOP'), null);
  assert.equal(parseFineness(''), null);
});

test('metal from the description; plated and gilded items are never solid metal', () => {
  assert.equal(p.metalOf('ERÄ HOPEAA'), 'silver');
  assert.equal(p.metalOf('2 KULTARAHAA'), 'gold');
  assert.equal(p.metalOf('LAATTA UMICORE'), null);
  assert.equal(p.metalOf('KULTAUS HOPEA'), null);
  assert.equal(p.metalOf('HOPEOITU LUSIKKA'), null);
});

test('valuation: gold coin lot with its weight and fineness', () => {
  const lot = p.parseList(read('list-coins-p0.html'), 'coins & medals').find(l => l.id === '190');
  const v = p.valueLot(lot, SPOT);
  assert.equal(v.status, 'ok');
  assert.equal(v.metal, 'gold');
  assert.equal(v.fineG, 1.6998); // 1.7 g × 0.9999 = 1.6998 g of fine gold
  assert.equal(v.meltEur, 169.98);
});

test('valuation: silver lot adds up every sub-lot; BR sub-lots count only the silver share', () => {
  const lot = p.parseList(read('list-silver-p0.html'), 'silver').find(l => l.id === '15');
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

test('verdicts: gold coins up to +5 %; junk silver 🟢 at 5 % below metal value, never above it', () => {
  const coin = { category: 'goldCoins', value: { status: 'ok', metal: 'gold', meltEur: 169.98 } };
  const junk = { category: 'junkSilver', value: { status: 'ok', metal: 'silver', meltEur: 215.66 } };
  const open = { timeLeftSec: 3600, biddingAllowed: true };
  // gold coins: limit = floor(169.98 × 1.05) = 178 (whole euros from 100 €); next 210 → skip
  assert.equal(p.advise(coin, { topBid: 200, minRaise: 10, startPrice: 180, ...open }, CFG).verdict, 'skip');
  const buy = p.advise(coin, { topBid: 160, minRaise: 10, startPrice: 150, ...open }, CFG);
  assert.equal(buy.verdict, 'buy');
  assert.equal(buy.next, 170);
  assert.equal(buy.limit, 178);
  assert.equal(buy.step, 10);
  // junk silver: 🟢 at floor(215.66 × 0.95) = 204, max floor(215.66) = 215
  const s = p.advise(junk, { topBid: 0, minRaise: 10, startPrice: 210, ...open }, CFG);
  assert.equal(s.verdict, 'skip'); // 210 is under the max but above the 🟢 price
  assert.equal(s.buyAt, 204);
  assert.equal(s.limit, 215);
  assert.equal(p.advise(junk, { topBid: 0, minRaise: 10, startPrice: 200, ...open }, CFG).verdict, 'buy');
  // closed lots are not advised
  assert.equal(p.advise(coin, { topBid: 160, minRaise: 10, startPrice: 150, timeLeftSec: 0, biddingAllowed: true }, CFG).verdict, 'closed');
});

test('list-only advice: exact without bids; with bids only "not at your price" is certain', () => {
  const lot = (startingPrice, listPrice) => ({ startingPrice, listPrice, category: 'goldCoins', value: { status: 'ok', metal: 'gold', meltEur: 100 } });
  assert.equal(p.preview(lot(true, 100), CFG).verdict, 'buy'); // start 100 ≤ 105
  assert.equal(p.preview(lot(true, 110), CFG).verdict, 'skip');
  assert.equal(p.preview(lot(false, 100), CFG).verdict, 'open'); // has bids, now 100: the next bid is unknown
  assert.equal(p.preview(lot(false, 105), CFG).verdict, 'skip');
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
  assert.equal(tue.closes.toISOString(), '2026-10-20T15:00:00.000Z'); // Tue 18:00 Helsinki
  assert.equal(p.auctionAt(at('2026-10-20T15:30:00Z')), null); // Tue 18:30 Helsinki: over
  assert.equal(p.auctionAt(at('2026-10-23T14:00:00Z')).number, 967); // next Friday 17:00
  // Winter time after 25 Oct: Friday 17:00 Helsinki = 15:00 UTC
  assert.equal(p.auctionAt(at('2026-10-30T15:00:00Z')).number, 968);
});

test('auction numbers step by one each week from the reference', () => {
  const cfg = { sources: { pantti: { reference: { auction: 966, friday: '2026-10-16' } } } };
  assert.equal(p.auctionNumber('2026-10-16', cfg), 966);
  assert.equal(p.auctionNumber('2026-10-23', cfg), 967);
  assert.equal(p.auctionNumber('2026-10-30', cfg), 968);
});

test('closing times from the list: "päättyy 20.10. klo 18:05", also across New Year', () => {
  assert.equal(p.parseEnds('päättyy 20.10. klo 18:05', '2026-10-16').toISOString(), '2026-10-20T15:05:00.000Z');
  assert.equal(p.parseEnds('päättyy 5.1. klo 18:05', '2026-12-31').toISOString(), '2027-01-05T16:05:00.000Z');
  assert.equal(p.parseEnds('', '2026-10-16'), null);
});

test('list links: {auction} is filled in and paging added; the config has both lists', () => {
  assert.equal(p.listUrl('https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=5', 967, 2),
    'https://huutokauppa.pantti.fi/huutokauppa/967/?category=5&page=2&sort=default&search=');
  assert.deepEqual(CFG.sources.pantti.lists.map(l => [l.name, l.metal, new URL(l.url.replace('{auction}', 967)).searchParams.get('category')]),
    [['coins & medals', undefined, '5'], ['silver', 'silver', '2'], ['gold jewellery', 'gold', '1']]);
});

test('an auction for the messages: first lot closing time, online, next-bid style', () => {
  const lots = p.parseList(read('list-coins-p0.html'), 'coins & medals')
    .map(l => ({ ...l, closesAt: p.parseEnds(l.ends, '2026-10-16').toISOString() }));
  const a = p.auctionOf({ number: 966, closes: new Date('2026-10-20T15:00:00Z') }, lots);
  assert.equal(a.key, 'pantti-966');
  assert.equal(a.title, 'Helsingin Pantti 966');
  assert.equal(a.closesAt, '2026-10-20T15:05:00.000Z');
  assert.equal(a.proxyBids, false);
});

test('review fixes: pure 1000 fineness, plated Finnish words, mixed metal words, gold gross weight', () => {
  assert.deepEqual(parseFineness('1000'), { value: 1, brutto: false });
  assert.equal(p.metalOf('Hopeapäällystetty rasia'), null);
  assert.equal(p.metalOf('Hopeasormus kultakivellä'), null);
  assert.equal(p.metalOf('Hopea 925'), 'silver');
  const gold = { id: 'g', parts: [{ desc: 'KULTAKORU', weight: '10', fine: 'H585BR' }] };
  const v = p.valueLot(gold, SPOT);
  assert.equal(v.status, 'hidden'); // gross-weight gold is left out (owner, 25 Oct 2026)
  assert.match(v.reason, /gross \(br\) gold/);
});


test('a manual run before Friday 17:00 uses the last auction that has opened', () => {
  const fri10 = new Date('2026-10-23T07:00:00Z'); // Fri 10:00 Helsinki, 967 not open yet
  assert.equal(p.auctionAt(fri10), null);
  assert.equal(p.auctionAt(fri10, { any: true }).number, 966);
});

test('sorting: coins & bars or junk by the rows\' text; gold only in the gold list; small lots and stones left out', () => {
  const lot = (rows) => ({ id: 'x', parts: rows.map(([desc, weight, fine]) => ({ desc, weight, fine })) });
  const REAL = { gold: { eurG: 115 }, silver: { eurG: 1.55 } }; // about the spot of 25 Oct 2026
  const sort = (l, list) => { l.value = p.valueLot(l, REAL, CFG); return p.sortLot(l, list, CFG) || l.category; };
  const coins = { name: 'coins & medals' };
  const gold = { name: 'gold jewellery', metal: 'gold' };
  assert.equal(sort(lot([['2 KULTARAHAA', '1,7', '999,9']]), coins), 'goldCoins');
  assert.equal(sort(lot([['HOPEINEN JUHLARAHA 10 €', '25,5', 'H925']]), coins), 'silverCoins');
  assert.equal(sort(lot([['HOPEINEN JUHLARAHA', '25', 'H925'], ['HOPEALUSIKKA', '30', 'H830']]), coins), 'junkSilver'); // mixed: junk
  assert.equal(sort(lot([['KULTAKETJU', '5,3', '585']]), gold), 'junkGold');
  assert.equal(sort(lot([['HOPEAKETJU', '24,7', 'TH925']]), gold), 'not gold'); // silver in the gold list: left out
  assert.equal(sort(lot([['KULTAINEN KIVISORMUS', '3,2', '585']]), gold), 'gold ring or earrings with stones');
  assert.equal(sort(lot([['KULTASORMUS', '0,4', '585']]), gold), 'under the minimum lot value'); // 0.234 g × 115 €/g = 27 €
  assert.equal(sort(lot([['KAULAKORU KALEVALA PRONSSI', '', '']]), gold), 'not gold or silver');
  // seen on 25 Oct 2026: a Kultakeskus (maker) silver necklace in the gold list, and a crystal vase on a silver foot
  assert.equal(sort(lot([['KAULAKORU KULTAKESKUS OY HELKY JUVONEN EI KAIV 60.5 CM V.1973', '24,5', 'H925']]), gold), 'not gold');
  assert.equal(sort(lot([['KULTAKETJU', '5,3', 'H925']]), gold), 'not gold'); // "gold" with a silver fineness: left out of the gold list
  assert.equal(sort(lot([['KRISTALLIMALJAKKO HOPEAJALALLA 24 CM', '925,0', 'H813BR']]), { name: 'silver', metal: 'silver' }), 'junkSilver'); // br: 30 % counted
});
