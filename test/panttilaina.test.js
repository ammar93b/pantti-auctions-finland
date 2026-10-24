// Suomen Panttilaina: list reading, lot text, bid steps, max bid and auctions (spec 04).
// The fixtures are the old site's gold / other and silver / other lists, saved 20.10.2026.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const sp = require('../src/panttilaina');
const CFG = require('./cfg');

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
    siteCategory: 'Kulta / Muut', office: 'Myyrmäen Pantti',
  });
  const s = silver();
  assert.equal(s.hits, 87);
  assert.equal(s.lots.length, 87);
  assert.ok(s.lots.every(l => l.siteCategory === 'Hopea / Muut'));
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
  assert.deepEqual(sp.valueText('Helsinki-mitali, 750br, Paino: 34 g', 'gold', SPOT, CFG), { status: 'hidden', reason: 'gross (br) gold' });
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

test('advice: gold coins max +5 %; junk 🟢 at 5 % below metal value, max bid never above it; closed; check', () => {
  const now = new Date('2026-10-21T10:00:00Z');
  const lot = (desc, metal, category, next, closesAt = '2026-10-21T16:00:00.000Z') =>
    ({ desc, metal, category, next, bids: 0, nowPrice: next, closesAt, value: sp.valueText(desc, metal, SPOT, CFG) });
  // 13.804 g fine gold × 100 €/g = 1380.40 € → max floor(1449.42) = 1449 → max bid 1400
  const buy = sp.adviseLot(lot('4 dukaattia, 986, Paino: 14 g', 'gold', 'goldCoins', 1200), now, CFG);
  assert.equal(buy.verdict, 'buy');
  assert.equal(buy.limit, 1449);
  assert.equal(buy.maxBid, 1400);
  assert.equal(sp.adviseLot(lot('4 dukaattia, 986, Paino: 14 g', 'gold', 'goldCoins', 1500), now, CFG).verdict, 'skip');
  // junk silver 1000 g at 925 = 925 € → 🟢 at floor(878.75) = 878, max 925 → max bid 920
  const junk = sp.adviseLot(lot('Erä, 925, Paino: 1000 g', 'silver', 'junkSilver', 860), now, CFG);
  assert.equal(junk.verdict, 'buy');
  assert.equal(junk.buyAt, 878);
  assert.equal(junk.maxBid, 920);
  assert.equal(sp.adviseLot(lot('Erä, 925, Paino: 1000 g', 'silver', 'junkSilver', 900), now, CFG).verdict, 'skip'); // −2.7 %: not 5 % below
  assert.equal(sp.adviseLot(lot('4 dukaattia, 986, Paino: 14 g', 'gold', 'goldCoins', 1200, '2026-10-21T09:00:00.000Z'), now, CFG).verdict, 'closed');
  assert.equal(sp.adviseLot(lot('Viallinen neula, Paino: 1,6 g', 'gold', null, 50), now, CFG).verdict, 'check');
});

test('sorting: coins & bars or junk by the text; gold rings and earrings with stones and small lots left out', () => {
  const sort = (desc, metal, siteCategory = '') => {
    const REAL = { gold: { eurG: 115 }, silver: { eurG: 1.55 } }; // about the spot of 25 Oct 2026
    const l = { desc, metal, siteCategory, value: sp.valueText(desc, metal, REAL, CFG) };
    return sp.sortLot(l, CFG) || l.category || 'check';
  };
  assert.equal(sort('Kultaraha Frans Josef I, 4 dukaattia, 986, Paino: 14 g', 'gold'), 'goldCoins');
  assert.equal(sort('Kultaharkko, Umicore, A317307, 9999, Paino: 10 g', 'gold'), 'goldCoins');
  assert.equal(sort('Juhlaraha, 10 markkaa, Itsenäinen Suomi 50 vuotta, 900, Paino: 24 g', 'silver'), 'silverCoins');
  assert.equal(sort('Hopeinen tarjotin, Kultakeskus, 830, Paino: 400 g', 'silver'), 'junkSilver');
  assert.equal(sort('Viisi kahvilusikkaa, 110-120mm, 813, Paino: 39,8 g', 'silver'), 'junkSilver');
  assert.equal(sort('Vialliset koruja, 585, Paino: 17 g', 'gold'), 'junkGold');
  assert.equal(sort('Sileä sormus, koko 15, 585, Paino: 1,3 g', 'gold'), 'junkGold');
  assert.equal(sort('Kivisormus, koko 18, 585br, Paino: 4,1 g', 'gold', 'Kulta / Sormukset'), 'gross (br) gold');
  assert.equal(sort('Timanttisormus 7xn.0.05ct, koko 17¾, valkokulta, 585, Paino: 4,2 g', 'gold', 'Kulta / Sormukset'), 'gold ring or earrings with stones');
  assert.equal(sort('Helmikorvakorut, Ø 22mm, kilpsikiinnitys, 585, Paino: 13,9 g', 'gold', 'Kulta / Korvakorut'), 'gold ring or earrings with stones');
  assert.equal(sort('Kolmet korvakorut, 925br, Paino: 5,3 g', 'silver'), 'under the minimum lot value'); // 2.28 € of silver
  assert.equal(sort('Juhlaraha, 25 markkaa, 500, Paino: 26,7 g', 'silver'), 'under the minimum lot value'); // 20.69 €
  assert.equal(sort('Viallinen solmioneula, Paino: 1,6 g', 'gold'), 'check');
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

test('the config reads gold / other, silver / other, silver cutlery and all gold on both sites', () => {
  const lists = CFG.sources.panttilaina.lists;
  assert.deepEqual(lists.map(l => l.metal), ['gold', 'silver', 'silver', 'gold']);
  assert.match(lists[0].url, /product_category=1&product_sub_category=8$/);
  assert.match(lists[1].url, /product_category=3&product_sub_category=21$/);
  assert.match(lists[2].url, /product_category=3&product_sub_category=14$/);
  assert.match(lists[3].url, /product_category=1&product_sub_category=$/);
  assert.deepEqual(lists.map(l => new URL(l.newSiteUrl).search),
    ['?SelectedProductSubCategories=8', '?SelectedProductSubCategories=21', '?SelectedProductSubCategories=14', '?SelectedProductCategories=1']);
});
