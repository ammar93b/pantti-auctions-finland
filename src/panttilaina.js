// Suomen Panttilaina auctions (suomenpanttilaina.fi). Spec 04.
//
// Four offices, each with an auction every two weeks on its own weekday; lots are listed
// about two weeks ahead and close from 19:00, 30 s apart (+30 s when a bid comes in the
// last 30 s). Bidders can leave a max bid that the site raises step by step for them.
// The lists read are config.sources.panttilaina.lists: each one is read on the old site
// (Huutokauppa 1.0, until 2 Nov 2026) and the new one (Huutokauppa 2.0), then merged.
// Each lot goes to one of the owner's four categories (spec 05).
//
// Weight and fineness are in the lot's text ("…, 986, Paino: 14 g"); br = gross weight.
// The metal is the list's (gold / other, silver / other). Anything unclear is check by hand.

const CFG = require('../config');
const { getSpot } = require('./spot');
const { get, sleep, text } = require('./http');
const { helToDate, parseEuro, parseGrams, parseFineness, NOT_SOLID, OTHER_METAL, withoutMakers, fineFits, check, hidden, valueParts, limitsFor, shorten, isCoinText, categoryOf, ringWithStone } = require('./common');

const SITE = 'Suomen Panttilaina';
const OLD_ORIGIN = 'https://www.suomenpanttilaina.fi';

// The office is the first part of the lot number: FI2.20261026.A27901
const OFFICES = {
  FI1: { name: 'Hakaniemi', address: 'Hämeentie 8, Helsinki' },
  FI2: { name: 'Vuosaari', address: 'Vuotie 45, Helsinki' },
  FI3: { name: 'Myyrmäki', address: 'Iskoskuja 3 A 1, Vantaa' },
  FI4: { name: 'Kaivopiha', address: 'Kaivokatu 10, Helsinki' },
};

// The site's fixed bid steps (auction terms): below 50 € +2, below 100 € +5, below 300 € +10,
// below 1000 € +20, below 2000 € +50, then +100. The same rule as the site's own bid page.
const STEPS = [[50, 2], [100, 5], [300, 10], [1000, 20], [2000, 50], [Infinity, 100]];
function nextStep(current) {
  let lower = 0;
  for (const [upper, step] of STEPS) {
    if (current < upper) return lower + (Math.floor((current - lower) / step) + 1) * step;
    lower = upper;
  }
  return current + 100;
}

// The highest legal bid amount from `next` upwards that is not above `limit` (null if none)
function maxBidFor(limit, next) {
  if (!(next > 0) || next > limit) return null;
  let v = next;
  for (let n = nextStep(v); n <= limit; n = nextStep(v)) v = n;
  return v;
}

// ── Lot text ────────────────────────────────────────────────────────────────

// "Kultaraha Frans Josef I, 4 dukaattia, 1915, 986, Paino: 14 g" in a gold list → one part
function partOf(desc, metal) {
  if (OTHER_METAL.test(desc)) return hidden('not gold or silver');
  if (NOT_SOLID.test(desc)) return check('plated or not solid metal');
  // Kultakeskus and kultaseppä (goldsmith) are makers' names, not metal; "valkokulta" (white
  // gold) and other gold colours only name a gold lot's colour
  const named = withoutMakers(desc);
  if (metal === 'gold' ? /hope/i.test(named) : /kulta|kulla|gold/i.test(named)) return check('gold and silver in one lot');
  // "…, 986, Paino: 14 g", "…, 585br valkokulta, Paino: 0,7 g", "…, 585 kelta- ja valkokulta, Paino: 2 g"
  const m = desc.match(/(\d{3,4}(?:,\d)?)\s*(br)?\s*(?:(?:\p{L}+-\s*ja\s+)?\p{L}*kulta\s*)?,?\s*Paino:\s*(\d[\d\s]*(?:,\d+)?)\s*(kg|g)\b/iu);
  if (!m) return check(/Paino:/i.test(desc) ? 'fineness not stated' : 'no weight in the listing');
  const fine = parseFineness(m[1] + (m[2] ? 'BR' : ''));
  const grams = parseGrams(m[3]);
  if (!grams) return check('weight not stated (0 g)');
  // A year or a size in front of "Paino" is not a fineness: gold 333–999.9, silver 300–999.9
  if (!fine || fine.value < (metal === 'gold' ? 0.333 : 0.3)) return check('fineness not stated');
  // A silver standard in a gold list is a silver piece: not what the owner reads this list for
  if (!fineFits(metal, fine.value)) return metal === 'gold' ? hidden(`not gold (${m[1]})`) : check(`fineness ${m[1]} does not fit silver`);
  return { metal, fine, grams: m[4].toLowerCase() === 'kg' ? grams * 1000 : grams };
}

function valueText(desc, metal, spot, cfg = CFG) {
  const p = partOf(desc, metal);
  return p.status ? p : valueParts([p], spot, cfg); // check or hidden as it is
}

// ── The old site (Huutokauppa 1.0): server-rendered list pages ──────────────

// One list page → raw lots, plus the number of hits ("Osumat: 63")
function parseOldList(html) {
  const lots = [];
  for (const block of html.split('<div class="item-container').slice(1)) {
    const number = text(block.match(/class="auktionsnummer">[^:<]*:\s*([^<]*)</)?.[1]);
    const fId = block.match(/name="f_id"[^>]*value="(\d+)"/)?.[1];
    if (!/^FI\d+\.\d{8}\./.test(number) || !fId) continue;
    const bids = text(block.match(/class="num-bids">([^<]*)</)?.[1]);
    const cat = [...(block.match(/class="[^"]*office-type[^"]*">\s*<p>([\s\S]*?)<\/p>/)?.[1] || '').matchAll(/<span>([^<]*)<\/span>/g)].map(x => text(x[1]));
    lots.push({
      number,
      url: `${OLD_ORIGIN}/huutokauppa/huutokaupan-numero/?f_id=${fId}`,
      desc: text(block.match(/<a class="vara"[^>]*>([\s\S]*?)<\/a>/)?.[1]),
      nowPrice: parseEuro(text(block.match(/current-bid">([^<]*)</)?.[1])),
      // The site's own minimum next bid (the start price while there are no bids)
      next: parseEuro(block.match(/name="start_bud"[^>]*value="([^"]*)"/)?.[1]),
      bids: /^\d+$/.test(bids) ? +bids : 0,
      closesLocal: block.match(/data-closing-datetime="([^"]+)"/)?.[1] || null,
      siteCategory: cat[0] || '', office: cat[1] || '',
    });
  }
  const hits = text(html.match(/class="traffar_varulistor">([\s\S]*?)<\/p>/)?.[1]).match(/(\d+)/);
  return { lots, hits: hits ? +hits[1] : lots.length };
}

// "2026-10-21 19:08:30" (Helsinki) → ISO instant
function localToIso(s) {
  const m = String(s || '').match(/(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/);
  return m ? helToDate(+m[1], +m[2], +m[3], +m[4], +m[5], +(m[6] || 0)).toISOString() : null;
}

// Every page of one old-site list, 100 lots a page
async function fetchOld(url, cfg = CFG) {
  const seen = new Map();
  for (let offset = 0; offset < 5000; offset += 100) {
    const u = new URL(url);
    u.searchParams.set('length', '100');
    u.searchParams.set('offset', String(offset));
    u.searchParams.set('listTyp', 'lista');
    const { lots, hits } = parseOldList(await get(u.toString()));
    const before = seen.size;
    for (const l of lots) seen.set(l.number, { ...l, closesAt: localToIso(l.closesLocal) });
    if (seen.size === before || seen.size >= hits) break;
    await sleep(cfg.requestDelayMs);
  }
  return [...seen.values()];
}

// ── The new site (Huutokauppa 2.0): lots as JSON inside the page ────────────
// Field names are from the site's own scripts (auction-list.js, auction-data-presenter.js).
// The page had no lots yet on 21 Oct 2026, so this reader is checked against the scripts only.

function parseNewList(html, pageUrl) {
  const json = html.match(/<script[^>]*id="auction-items-json"[^>]*>([\s\S]*?)<\/script>/)?.[1];
  if (!json) return [];
  let items;
  try { items = JSON.parse(json); } catch { return []; }
  if (!Array.isArray(items)) return [];
  return items.filter(it => /^FI\d+\.\d{8}\./.test(String(it?.number || '')) && it.isOpen !== false).map(it => ({
    number: String(it.number),
    url: pageUrl,
    desc: text(it.heading || it.descriptionLong || ''),
    nowPrice: Number(it.amount) || Number(it.startingPrice) || null,
    next: Number(it.bidStartAmount) || null, // the bid page starts at this amount: the minimum next bid
    bids: Number(it.bidCount) || 0,
    closesAt: it.closingTimeUtcSec ? new Date(it.closingTimeUtcSec * 1000).toISOString() : null,
    siteCategory: String(it.category || ''), office: String(it.officeName || ''),
  }));
}

async function fetchNew(url) {
  return parseNewList(await get(url), url);
}

// ── Lots, auctions, advice ──────────────────────────────────────────────────

const conf = (cfg) => cfg.sources.panttilaina;

// "FI2.20261026.A27901" → { key: 'panttilaina-FI2-20261026', office, date: '26.10.' }
function auctionOfNumber(number) {
  const [code, ymd] = number.split('.');
  const office = OFFICES[code] || { name: code, address: '' };
  return { key: `panttilaina-${code}-${ymd}`, office, date: `${+ymd.slice(6, 8)}.${+ymd.slice(4, 6)}.` };
}

// Reads every list on both sites (one list failing on one site is fine if the other answers)
async function loadLots({ spot, limit = Infinity, cfg = CFG } = {}) {
  const byNumber = new Map();
  const errors = [];
  let answered = 0;
  for (const list of conf(cfg).lists) {
    for (const [url, read] of [[list.url, fetchOld], [list.newSiteUrl, fetchNew]]) {
      if (!url) continue;
      try {
        for (const raw of (await read(url, cfg)).slice(0, limit)) {
          if (byNumber.has(raw.number) && read === fetchOld) continue; // the new site wins
          byNumber.set(raw.number, { ...raw, list: list.name, metal: list.metal });
        }
        answered++;
      } catch (err) {
        errors.push(`${list.name} (${new URL(url).hostname}): ${err.message}`);
      }
      await sleep(cfg.requestDelayMs);
    }
  }
  if (!answered && errors.length) throw new Error(errors.join(' · '));
  const lots = [];
  for (const l of byNumber.values()) {
    const lot = { ...l, id: l.number, title: shorten(l.desc || '—'), value: valueText(l.desc, l.metal, spot, cfg) };
    if (!sortLot(lot, cfg)) lots.push(lot);
  }
  return lots;
}

// The lot's category, or why it is left out (spec 05)
function sortLot(lot, cfg = CFG) {
  if (lot.value.status === 'hidden') return lot.value.reason;
  if (lot.metal === 'gold' && ringWithStone(`${lot.desc} ${/Sormukset|Korvakorut/i.test(lot.siteCategory || '') ? 'sormus' : ''}`)) return 'gold ring or earrings with stones';
  if (lot.value.status !== 'ok') return null; // check by hand: counted, no advice
  if (lot.value.meltEur < (cfg.minMetalEur || 0)) return 'under the minimum lot value';
  lot.category = categoryOf(lot.value.metal, isCoinText(lot.desc));
  return null;
}

function adviseLot(lot, now = new Date(), cfg = CFG) {
  if (lot.value.status !== 'ok') return { verdict: 'check', reason: lot.value.reason };
  if (lot.closesAt && Date.parse(lot.closesAt) <= now.getTime()) return { verdict: 'closed' };
  if (!(lot.next > 0)) return { verdict: 'check', reason: 'no bid amount in the list' };
  const { max, buyAt } = limitsFor(lot.value, lot.category, cfg);
  const maxBid = maxBidFor(max, lot.next);
  return { verdict: maxBid && lot.next <= buyAt ? 'buy' : 'skip', next: lot.next, limit: max, buyAt, maxBid, vsSpot: lot.next / lot.value.meltEur - 1, now: lot.bids ? lot.nowPrice : null };
}

// Lots grouped into auctions (office + day), each closing at its first lot's time
function group(lots) {
  const map = new Map();
  for (const l of lots) {
    const { key, office, date } = auctionOfNumber(l.number);
    if (!map.has(key)) {
      map.set(key, {
        auction: {
          key, source: 'panttilaina', site: SITE, title: `${SITE} ${office.name} ${date}`, closesAt: null,
          url: l.url, where: `pickup at ${office.name}${office.address ? `, ${office.address}` : ''}`, proxyBids: true,
        },
        lots: [],
      });
    }
    map.get(key).lots.push(l);
  }
  for (const g of map.values()) {
    g.lots.sort((a, b) => String(a.closesAt).localeCompare(String(b.closesAt)));
    g.auction.closesAt = g.lots.find(l => l.closesAt)?.closesAt || null;
  }
  return [...map.values()];
}

// Every auction with lots still open
async function listed({ now = new Date(), spot, limit, cfg = CFG } = {}) {
  spot ||= await getSpot();
  const lots = await loadLots({ spot, limit, cfg });
  for (const l of lots) l.advice = adviseLot(l, now, cfg);
  return group(lots.filter(l => !l.closesAt || Date.parse(l.closesAt) > now.getTime()))
    .filter(g => g.auction.closesAt);
}

// Fresh lots of one auction with advice (for a reminder)
async function current(auction, { now = new Date(), spot, limit, cfg = CFG } = {}) {
  spot ||= await getSpot();
  const lots = (await loadLots({ spot, limit, cfg })).filter(l => auctionOfNumber(l.number).key === auction.key);
  for (const l of lots) l.advice = adviseLot(l, now, cfg);
  return lots;
}

module.exports = {
  id: 'panttilaina', name: SITE, listed, current,
  OFFICES, STEPS, nextStep, maxBidFor, partOf, valueText, parseOldList, localToIso, parseNewList,
  auctionOfNumber, loadLots, sortLot, adviseLot, group,
};
