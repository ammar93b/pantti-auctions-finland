// Suomen Panttilaina: list reading, lot text, bid steps, max bid and auctions (spec 04).
// The fixtures are the old site's gold / other and silver / other lists, saved 20.10.2026.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sp = require('../src/panttilaina');
const CFG = require('../config');

const FX = path.join(__dirname, 'fixtures', 'panttilaina');
const read = (f) => fs.readFileSync(path.join(FX, f), 'utf8');
const SPOT = { gold: { eurG: 100 }, silver: { eurG: 1 } };
const gold = () => sp.parseOldList(read('old-gold-other.html'));
const silver = () => sp.parseOldList(read('old-silver-other.html'));

test('old site lists: every lot with number, link, text, price, next bid, bids, closing time, office', () => {
  const g = gold();
  assert.equal(g.hits, 63);
  assert.equal(g.lots.length, 63);
  assert.deepEqual(g.lots[0], {
    number: 'FI3.20261021.A27842',
    url: 'https://www.suomenpanttilaina.fi/huutokauppa/huutokaupan-numero/?f_id=159254',
    desc: 'Kultamitali, Ø 16mm, 585, Paino: 1,5 g',
    nowPrice: 110, next: 110, bids: 0, closesLocal: '2026-10-21 19:08:30',
    category: 'Kulta / Muut', office: 'Myyrmäen Pantti',
  });
  const s = silver();
  assert.equal(s.hits, 87);
  assert.equal(s.lots.length, 87);
  assert.ok(s.lots.every(l => l.category === 'Hopea / Muut'));
});

test('a lot with bids: the list\'s next bid is the current bid plus the site\'s step', () => {
  const withBids = [...gold().lots, ...silver().lots].filter(l => l.bids > 0);
  assert.ok(withBids.length > 0);
  for (const l of withBids) assert.equal(l.next, sp.nextStep(l.nowPrice), l.number);
});

test('closing times are Helsinki time', () => {
  assert.equal(sp.localToIso('2026-10-21 19:08:30'), '2026-10-21T16:08:30.000Z'); // summer time
  assert.equal(sp.localToIso('2026-11-04 19:00:00'), '2026-11-04T17:00:00.000Z'); // winter time
});

test('bid steps from the auction terms: +2 below 50, +5 below 100, +10 below 300, +20 below 1000, +50 below 2000, then +100', () => {
  assert.equal(sp.nextStep(4), 6);
  assert.equal(sp.nextStep(48), 50);
  assert.equal(sp.nextStep(50), 55);
  assert.equal(sp.nextStep(95), 100);
  assert.equal(sp.nextStep(100), 110);
  assert.equal(sp.nextStep(290), 300);
  assert.equal(sp.nextStep(300), 320);
  assert.equal(sp.nextStep(980), 1000);
  assert.equal(sp.nextStep(1000), 1050);
  assert.equal(sp.nextStep(2000), 2100);
});

test('max bid: the highest legal amount from the next bid up to the limit', () => {
  assert.equal(sp.maxBidFor(287, 250), 280); // 250 260 270 280 (290 > 287)
  assert.equal(sp.maxBidFor(305, 280), 300); // 280 290 300 (320 > 305)
  assert.equal(sp.maxBidFor(1149, 980), 1100); // 980 1000 1050 1100
  assert.equal(sp.maxBidFor(110, 110), 110);
  assert.equal(sp.maxBidFor(109.9, 110), null); // the next bid is already above the limit
});

test('lot text: fineness and weight in front of "Paino"; br = gross weight', () => {
  assert.deepEqual(sp.partOf('Kultaraha Frans Josef I, 4 dukaattia, Itävalta-Unkari, 1915, 986, Paino: 14 g', 'gold'),
    { metal: 'gold', fine: { value: 0.986, brutto: false }, grams: 14 });
  assert.deepEqual(sp.partOf('Kolme juhlarahaa, 500 Paino: 69,8 g', 'silver'),
    { metal: 'silver', fine: { value: 0.5, brutto: false }, grams: 69.8 });
  assert.deepEqual(sp.partOf('Viallisia koruja ja osia, 925br Paino: 66,9 g', 'silver'),
    { metal: 'silver', fine: { value: 0.925, brutto: true }, grams: 66.9 });
  assert.deepEqual(sp.partOf('Kultaharkko, Umicore, A317307, 9999, Paino: 10 g', 'gold'),
    { metal: 'gold', fine: { value: 0.9999, brutto: false }, grams: 10 });
});

test('lot text: anything unclear is check by hand', () => {
  const reason = (d, m) => sp.partOf(d, m).reason;
  assert.equal(reason('Kahdeksan juhlarahaa, nimellisarvo 100 markkaa, 925, Paino: 0 g', 'silver'), 'weight not stated (0 g)');
  assert.equal(reason('Kultaharkko, Comptoir Lyon-Alemand, 9999,', 'gold'), 'no weight in the listing');
  assert.equal(reason('Viallinen solmioneula, Paino: 1,6 g', 'gold'), 'fineness not stated');
  assert.equal(reason('Hopeamarkka, 1964, Paino: 6,5 g', 'silver'), 'fineness not stated'); // a year is not a fineness
  assert.equal(reason('Juhlaraha, nimellisarvo 50 euroa, 925/750 hopea ja kulta, Paino: 30 g', 'silver'), 'gold and silver in one lot');
  assert.equal(reason('Kynttilänjalat, kipsitäytetty, 830br, Paino: 500 g', 'silver'), 'plated or not solid metal');
  assert.equal(reason('Helsinki-mitali, 750br, Paino: 34 g', 'gold'), undefined); // parsed: br gold is refused when valued
  assert.equal(sp.valueText('Helsinki-mitali, 750br, Paino: 34 g', 'gold', SPOT, CFG).reason, 'gross (br) gold: the gold share is not known');
  // A maker's name is not a second metal
  assert.equal(sp.partOf('Hopeinen tarjotin, Kultakeskus, 830, Paino: 400 g', 'silver').metal, 'silver');
});

test('valuation: 4 ducats 986 14 g, and br silver counted at 30 %', () => {
  const v = sp.valueText('Kultaraha Frans Josef I, 4 dukaattia, 1915, 986, Paino: 14 g', 'gold', SPOT, CFG);
  assert.equal(v.fineG, 13.804);
  assert.equal(v.meltEur, 1380.4);
  const b = sp.valueText('Viallisia koruja ja osia, 925br Paino: 66,9 g', 'silver', SPOT, CFG);
  assert.equal(b.fineG, Math.round(66.9 * 0.3 * 0.925 * 10000) / 10000);
  assert.equal(b.brutto, true);
});

test('advice: max bid within gold +5 % / silver +3 %; over the limit; closed; check', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const lot = (desc, metal, next, closesAt = '2026-10-21T16:00:00.000Z') =>
    ({ desc, metal, next, bids: 0, nowPrice: next, closesAt, value: sp.valueText(desc, metal, SPOT, CFG) });
  // 13.804 g fine gold × 100 €/g = 1380.40 € → limit floor(1449.42) = 1449 → max bid 1400
  const buy = sp.adviseLot(lot('4 dukaattia, 986, Paino: 14 g', 'gold', 1200), now, CFG);
  assert.equal(buy.verdict, 'buy');
  assert.equal(buy.limit, 1449);
  assert.equal(buy.maxBid, 1400);
  assert.equal(sp.adviseLot(lot('4 dukaattia, 986, Paino: 14 g', 'gold', 1500), now, CFG).verdict, 'skip');
  // silver 1000 g at 925 = 925 € → limit floor(952.75) = 952 → max bid 940
  assert.equal(sp.adviseLot(lot('Erä, 925, Paino: 1000 g', 'silver', 900), now, CFG).maxBid, 940);
  assert.equal(sp.adviseLot(lot('4 dukaattia, 986, Paino: 14 g', 'gold', 1200, '2026-10-21T09:00:00.000Z'), now, CFG).verdict, 'closed');
  assert.equal(sp.adviseLot(lot('Viallinen neula, Paino: 1,6 g', 'gold', 50), now, CFG).verdict, 'check');
});

test('auctions: grouped by office and day, closing at the first lot, pickup address', () => {
  const lots = gold().lots.map(l => ({ ...l, id: l.number, closesAt: sp.localToIso(l.closesLocal) }));
  const groups = sp.group(lots);
  const keys = groups.map(g => g.auction.key).sort();
  assert.deepEqual(keys, ['panttilaina-FI1-20261029', 'panttilaina-FI2-20261026', 'panttilaina-FI3-20261021', 'panttilaina-FI3-20261104']);
  const vuosaari = groups.find(g => g.auction.key === 'panttilaina-FI2-20261026');
  assert.equal(vuosaari.lots.length, 42);
  assert.equal(vuosaari.auction.title, 'Suomen Panttilaina Vuosaari 26.10.');
  assert.match(vuosaari.auction.where, /pickup at Vuosaari, Vuotie 45, Helsinki/);
  assert.equal(vuosaari.auction.proxyBids, true);
  assert.equal(vuosaari.auction.closesAt, vuosaari.lots[0].closesAt);
  assert.ok(vuosaari.lots.every(l => l.closesAt >= vuosaari.auction.closesAt));
});

test('new site: lots from the JSON inside the page (field names from the site\'s scripts)', () => {
  const items = [
    { id: 1, number: 'FI2.20261109.A30001', heading: 'Kultaraha, 4 dukaattia, 986, Paino: 14 g', bidStartAmount: 1250, amount: 1200, bidCount: 3, closingTimeUtcSec: 1794330000, isOpen: true, category: 'Kulta / Muut', officeName: 'Vuosaaren Pantti' },
    { id: 2, number: 'FI2.20261109.A30002', heading: 'Suljettu', bidStartAmount: 10, amount: 10, bidCount: 0, closingTimeUtcSec: 1794330030, isOpen: false },
  ];
  const html = `<html><body><script type="application/json" id="auction-items-json">${JSON.stringify(items)}</script></body></html>`;
  const lots = sp.parseNewList(html, 'https://shop.suomenpanttilaina.fi/auction?SelectedProductSubCategories=8');
  assert.equal(lots.length, 1); // closed lots are left out
  assert.equal(lots[0].number, 'FI2.20261109.A30001');
  assert.equal(lots[0].next, 1250);
  assert.equal(lots[0].nowPrice, 1200);
  assert.equal(lots[0].bids, 3);
  assert.equal(lots[0].closesAt, new Date(1794330000 * 1000).toISOString());
  assert.deepEqual(sp.parseNewList('<html>no lots</html>', 'x'), []);
  assert.deepEqual(sp.parseNewList('<script id="auction-items-json">[]</script>', 'x'), []);
});

test('the config reads gold / other and silver / other on both sites', () => {
  const lists = CFG.sources.panttilaina.lists;
  assert.deepEqual(lists.map(l => l.metal), ['gold', 'silver']);
  assert.match(lists[0].url, /product_category=1&product_sub_category=8/);
  assert.match(lists[1].url, /product_category=3&product_sub_category=21/);
  assert.match(lists[0].newSiteUrl, /SelectedProductSubCategories=8$/);
  assert.match(lists[1].newSiteUrl, /SelectedProductSubCategories=21$/);
});
