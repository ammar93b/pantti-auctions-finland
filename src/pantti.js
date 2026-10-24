// Helsingin Pantti auctions (huutokauppa.pantti.fi). Spec 02.
//
// Every week a new auction opens on Friday 17:00 (Helsinki time); its lots close on
// Tuesday from about 18:05. The lists read are config.sources.pantti.lists; each lot goes
// to one of the owner's four categories (spec 05).
//
// Metal content comes from the listing's own table (weight and fineness per row),
// never from guesses. The next legal bid comes from the lot's bid feed, the same call
// the lot page makes: top bid + minimum raise, or the start price with no bids.

const CFG = require('../config');
const { getSpot } = require('./spot');
const { get, post, sleep, text } = require('./http');
const { hel, helToDate, parseEuro, parseGrams, parseFineness, NOT_SOLID, check, valueParts, limitsFor, shorten, isCoinText, categoryOf, ringWithStone } = require('./common');

const WEEK = 7 * 86400e3;
const SITE = 'Helsingin Pantti';

// ── Auction number and window ───────────────────────────────────────────────

const conf = (cfg) => cfg.sources.pantti;

function auctionNumber(fridayIso, cfg = CFG) {
  const ref = conf(cfg).reference;
  return ref.auction + Math.round((Date.parse(`${fridayIso}T00:00:00Z`) - Date.parse(`${ref.friday}T00:00:00Z`)) / WEEK);
}

// The auction whose window (Friday 17:00 → Tuesday 18:00) contains `now`, or null.
// With { any: true }: the most recent auction that has opened.
function auctionAt(now = new Date(), { any = false, cfg = CFG } = {}) {
  const h = hel(now);
  const daysBack = (h.wd - 5 + 7) % 7; // days since the most recent Friday
  let latest = null;
  for (let k = 0; k < 2; k++) {
    const fri = new Date(Date.UTC(h.y, h.mo - 1, h.d - daysBack - 7 * k));
    const y = fri.getUTCFullYear(), mo = fri.getUTCMonth() + 1, d = fri.getUTCDate();
    const friday = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    const a = {
      number: auctionNumber(friday, cfg), friday,
      opens: helToDate(y, mo, d, 17, 0),
      closes: helToDate(y, mo, d + 4, 18, 0),
    };
    if (!latest && now >= a.opens) latest = a;
    if (now >= a.opens && now < a.closes) return a;
  }
  return any ? latest : null;
}

// "päättyy 20.10. klo 18:05" → that instant (Helsinki), in the year of the auction's Friday
function parseEnds(s, friday) {
  const m = String(s || '').match(/(\d{1,2})\.(\d{1,2})\.?\s*(?:klo)?\s*(\d{1,2})[:.](\d{2})/);
  if (!m) return null;
  let y = +friday.slice(0, 4);
  if (+m[2] < +friday.slice(5, 7)) y++; // a December auction closing in January
  return helToDate(y, +m[2], +m[1], +m[3], +m[4]);
}

// ── Lot text ────────────────────────────────────────────────────────────────

// Metal from the row's own description. Plated or gilded items are never solid metal.
function metalOf(desc) {
  if (NOT_SOLID.test(desc)) return null;
  const silver = /hope/i.test(desc);
  const gold = /kulta|kulla|gold/i.test(desc);
  if (silver && gold) return null; // e.g. a silver ring with a gold stone: check by hand
  if (silver) return 'silver';
  if (gold) return 'gold';
  return null;
}

// ── Lists ───────────────────────────────────────────────────────────────────

// One page of an auction list → lots, each with its table rows (sub-lots)
function parseList(html, list = '', origin = 'https://huutokauppa.pantti.fi') {
  const lots = [];
  for (const block of html.split('<div class="col-12 col-sm-6 col-xl-4 item').slice(1)) {
    const id = text(block.match(/class="item_id">([^<]*)</)?.[1]);
    const href = block.match(/href="(huutokauppa\/[^"]+)"/)?.[1];
    if (!id || !href) continue;
    const infoHtml = block.match(/<div class="info">([\s\S]*?)<\/table>/)?.[1] || '';
    const rows = [...infoHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => text(c[1])));
    lots.push({
      id, list, url: `${origin}/${href}`,
      ends: text(block.match(/class="ends">([\s\S]*?)<\/span>/)?.[1]),
      startingPrice: /lähtö/i.test(text(block.match(/class="start-price">([^<]*)</)?.[1])),
      listPrice: parseEuro(text(block.match(/class="price">([^<]*)</)?.[1])),
      parts: rows.map(r => ({ desc: r[0] || '', weight: r[1] || '', fine: r[2] || '' })),
    });
  }
  return lots;
}

// The list link of one auction, page p: {auction} filled in, paging added
function listUrl(template, auction, page) {
  const u = new URL(template.replace('{auction}', auction));
  u.searchParams.set('page', page);
  if (!u.searchParams.has('sort')) u.searchParams.set('sort', 'default');
  if (!u.searchParams.has('search')) u.searchParams.set('search', '');
  return u.toString();
}

// Every page of one list, until a page adds no new lots. May be empty.
async function fetchList(auction, list, cfg = CFG) {
  const seen = new Map();
  const origin = new URL(list.url.replace('{auction}', auction)).origin;
  for (let page = 0; page < 40; page++) {
    const html = await get(listUrl(list.url, auction, page));
    const before = seen.size;
    for (const l of parseList(html, list.name, origin)) if (!seen.has(l.id)) seen.set(l.id, l);
    if (seen.size === before) break;
    await sleep(cfg.requestDelayMs);
  }
  return [...seen.values()];
}

// ── Valuation ───────────────────────────────────────────────────────────────

// Fine metal of a lot from its own rows. Anything unclear → 'check' (no advice).
function valueLot(lot, spot, cfg = CFG) {
  if (!lot.parts.length) return check('no weight in the listing');
  const parts = [];
  for (const p of lot.parts) {
    const metal = metalOf(p.desc);
    const fine = parseFineness(String(p.fine).replace(/^T(?=H?\d)/i, '')); // "TH925" in the jewellery list
    const grams = parseGrams(p.weight);
    if (!metal) return check(`metal not stated (${p.desc || 'no description'})`);
    if (!fine) return check(`fineness not stated (${p.fine || 'empty'})`);
    if (!grams) return check('weight not stated');
    parts.push({ metal, fine, grams });
  }
  return valueParts(parts, spot, cfg);
}

// ── Bid feed and verdict ────────────────────────────────────────────────────

async function bidState(lot) {
  const html = await get(lot.url);
  const itemId = html.match(/pageitemid = (\d+)/)?.[1];
  if (!itemId) throw new Error('lot page has no item id');
  const origin = new URL(lot.url).origin;
  const j = await post(`${origin}/ajax/bid.json`, { mode: 'getBids', item: itemId }, { Referer: lot.url, 'X-Requested-With': 'XMLHttpRequest' });
  if (j.status !== 'ok') throw new Error(`bid feed answered ${j.status}`);
  const d = j.data;
  return { startPrice: d.bid_start, topBid: d.top_bid, minRaise: d.min_raise, timeLeftSec: d.timeleft, biddingAllowed: j.biddingallowed !== false };
}

const minimumNext = (bid) => (bid.topBid > 0 ? bid.topBid + bid.minRaise : bid.startPrice);

function advise(lot, bid, cfg = CFG) {
  if (lot.value.status !== 'ok') return { verdict: 'check', reason: lot.value.reason };
  if (!bid || bid.error) return { verdict: 'check', reason: bid?.error || 'no bid data' };
  if (!bid.biddingAllowed || bid.timeLeftSec <= 0) return { verdict: 'closed' };
  const next = minimumNext(bid);
  if (!(next > 0)) return { verdict: 'check', reason: 'no bid amount from the feed' };
  const { max, buyAt } = limitsFor(lot.value, lot.category, cfg);
  return { verdict: next <= buyAt ? 'buy' : 'skip', next, limit: max, buyAt, vsSpot: next / lot.value.meltEur - 1, now: bid.topBid || null, step: bid.minRaise };
}

// ── The source, as the agent uses it ────────────────────────────────────────

const title = (lot) => shorten(lot.parts.map(p => p.desc).filter(Boolean).join(' + ') || '—');

// The lot's category, or why it is left out (spec 05). `list.metal` keeps only that metal.
function sortLot(l, list, cfg = CFG) {
  const text = l.parts.map(p => p.desc).join(' ');
  if (l.value.status === 'hidden') return l.value.reason;
  if (l.value.status === 'ok') {
    if (list.metal && l.value.metal !== list.metal) return `not ${list.metal}`;
    if (l.value.metal === 'gold' && ringWithStone(`${text} ${l.parts.map(p => p.fine).join(' ')}`)) return 'gold ring or earrings with stones';
    if (l.value.meltEur < (cfg.minMetalEur || 0)) return 'under the minimum lot value';
    l.category = categoryOf(l.value.metal, l.parts.every(p => isCoinText(p.desc)));
    return null;
  }
  // Check by hand: in a one-metal list, only lots whose text names that metal
  if (list.metal === 'gold' && (!/kulta|kulla|gold/i.test(text) || ringWithStone(text))) return 'not gold';
  if (list.metal === 'silver' && !/hope/i.test(text)) return 'not silver';
  return null;
}

// Reads every list of auction `a` and values its lots (in the shape the messages use).
// A lot in two lists counts once; lots the owner does not want are left out.
async function loadLots(a, { spot, limit = Infinity, cfg = CFG } = {}) {
  const lots = new Map();
  let read = 0;
  for (const list of conf(cfg).lists) {
    for (const l of (await fetchList(a.number, list, cfg)).slice(0, limit)) {
      read++;
      if (lots.has(l.id)) continue;
      l.value = valueLot(l, spot, cfg);
      if (sortLot(l, list, cfg)) continue;
      l.title = title(l);
      l.closesAt = parseEnds(l.ends, a.friday)?.toISOString() || a.closes.toISOString();
      l.nowPrice = l.listPrice;
      l.next = l.startingPrice ? l.listPrice : null; // with bids, the next bid needs the feed
      lots.set(l.id, l);
    }
  }
  if (!read) throw new Error(`${SITE} auction ${a.number} has no lots (the number changed or it is not open yet)`);
  return [...lots.values()];
}

function auctionOf(a, lots) {
  const first = lots.map(l => l.closesAt).sort()[0] || a.closes.toISOString();
  return {
    key: `pantti-${a.number}`, source: 'pantti', site: SITE, title: `${SITE} ${a.number}`,
    closesAt: first, url: lots[0]?.url, where: 'online at huutokauppa.pantti.fi', proxyBids: false,
  };
}

// The auction listed now (Friday 17:00 → Tuesday 18:00), unless it was already announced.
// Pantti adds no lots after Friday, so an announced auction is not read again.
async function listed({ now = new Date(), spot, known = {}, manual = false, limit, cfg = CFG } = {}) {
  const a = auctionAt(now, { any: manual, cfg });
  if (!a || known[`pantti-${a.number}`]?.announced?.length) return [];
  spot ||= await getSpot();
  const lots = await loadLots(a, { spot, limit, cfg });
  for (const l of lots) l.advice = preview(l, cfg);
  return [{ auction: auctionOf(a, lots), lots }];
}

// Advice from the list alone (no bid feed): exact while a lot has no bids; with bids the
// next legal bid is above the shown price, so only "over the limit" is certain
function preview(lot, cfg = CFG) {
  if (lot.value.status !== 'ok') return { verdict: 'check', reason: lot.value.reason };
  const { max, buyAt } = limitsFor(lot.value, lot.category, cfg);
  const price = lot.listPrice;
  if (!(price > 0)) return { verdict: 'check', reason: 'no price in the list' };
  const vsSpot = price / lot.value.meltEur - 1;
  if (lot.startingPrice) return { verdict: price <= buyAt ? 'buy' : 'skip', next: price, limit: max, buyAt, vsSpot };
  return { verdict: price < buyAt ? 'open' : 'skip', now: price, limit: max, buyAt, vsSpot };
}

// Fresh lots of one auction with the live bid state of the lots that may be 🟢 (for a reminder)
async function current(auction, { spot, limit, cfg = CFG } = {}) {
  const number = +auction.key.split('-')[1];
  const ref = conf(cfg).reference;
  const friday = new Date(Date.parse(`${ref.friday}T00:00:00Z`) + (number - ref.auction) * WEEK).toISOString().slice(0, 10);
  const [y, mo, d] = friday.split('-').map(Number);
  const a = { number, friday, closes: helToDate(y, mo, d + 4, 18, 0) };
  spot ||= await getSpot();
  const lots = await loadLots(a, { spot, limit, cfg });
  for (const l of lots) {
    if (l.value.status !== 'ok') { l.advice = advise(l, null, cfg); continue; }
    // The live bid is read only where the list price could still be a 🟢: a lot already
    // above it can only go up (keeps a reminder to a few requests, not one per lot)
    const pre = preview(l, cfg);
    if (pre.verdict === 'skip') { l.advice = pre; continue; }
    let bid;
    try { bid = await bidState(l); } catch (err) { bid = { error: err.message }; }
    l.advice = advise(l, bid, cfg);
    await sleep(cfg.requestDelayMs);
  }
  return lots;
}

module.exports = {
  id: 'pantti', name: SITE, listed, current,
  auctionNumber, auctionAt, parseEnds, metalOf, parseList, listUrl, fetchList, valueLot,
  bidState, minimumNext, advise, preview, sortLot, loadLots, auctionOf,
};
