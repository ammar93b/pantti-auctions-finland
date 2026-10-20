// Helsingin Pantti auctions (huutokauppa.pantti.fi). Specs 02 and 03.
//
// Every week a new auction opens on Friday 17:00 (Helsinki time); its lots close on
// Tuesday from 18:00. Two lists per auction:
//   coins  = category 5 "Rahat ja mitalit" → bid at most 10 % over metal value
//   silver = category 2                     → bid never above metal value
//   Friday 17:00  → phone: the auction is open, its lots and their metal value
//   Tuesday 17:00 → phone: next legal bid per lot, the limit, and the distance to spot
//
// Metal content comes from the listing's own table (weight and fineness per row),
// never from guesses. The next legal bid comes from the lot's bid feed, the same call
// the lot page makes: top bid + minimum raise, or the start price with no bids.

const CFG = require('../config');
const state = require('./state');
const notify = require('./notify');
const { getSpot } = require('./spot');
const { get, post, sleep, text } = require('./http');

const BASE = 'https://huutokauppa.pantti.fi/';
const TZ = 'Europe/Helsinki';
const WEEK = 7 * 86400e3;
const CATS = ['coins', 'silver'];
const LABEL = { coins: 'coins & medals', silver: 'silver' };

// ── Helsinki time ───────────────────────────────────────────────────────────

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Wall-clock parts of an instant in Helsinki
function hel(date) {
  const p = {};
  for (const x of fmt.formatToParts(date)) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, wd: WEEKDAYS.indexOf(p.weekday) };
}

// The instant at which Helsinki wall-clock time reads y-mo-d h:mi
function helToDate(y, mo, d, h, mi) {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const w = hel(new Date(guess));
  return new Date(guess - (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi) - guess));
}

// ── Auction number and window ───────────────────────────────────────────────

function auctionNumber(fridayIso, cfg = CFG) {
  const ref = Date.parse(`${cfg.reference.friday}T00:00:00Z`);
  return cfg.reference.auction + Math.round((Date.parse(`${fridayIso}T00:00:00Z`) - ref) / WEEK);
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
      adviseAt: helToDate(y, mo, d + 4, 17, 0),
      closes: helToDate(y, mo, d + 4, 18, 0),
    };
    if (!latest && now >= a.opens) latest = a;
    if (now >= a.opens && now < a.closes) return a;
  }
  return any ? latest : null;
}

// ── Lot text ────────────────────────────────────────────────────────────────

// "200 €", "1 200 €", "12,50 €" → number
function parseEuro(s) {
  const t = String(s || '').replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

// "1,7" → 1.7 (grams)
function parseGrams(s) {
  const n = parseFloat(String(s || '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "H925BR" → 0.925 gross (BR), "585" → 0.585, "999,9"/"9999" → 0.9999, "1000" → 1; else null
function parseFineness(code) {
  const c = String(code || '').toUpperCase().replace(/\s/g, '');
  const m = c.match(/^H?(\d{3,4}(?:[.,]\d)?)(BR)?$/);
  if (!m) return null;
  const v = parseFloat(m[1].replace(',', '.'));
  let f = null;
  if (v === 1000) f = 1;
  else if (v >= 1000 && v <= 9999) f = v / 10000;
  else if (v >= 100 && v < 1000) f = v / 1000;
  return f ? { value: f, brutto: !!m[2] } : null;
}

// Metal from the row's own description. Plated or gilded items are never solid metal.
const NOT_SOLID = /kullattu|kultaus|hopeoitu|kultapinnoi|hopeapinnoi|päällys|pinnoite|täytetty|plated|vermeil|setel|kopio|replik/i;
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
function parseList(html, cat) {
  const lots = [];
  for (const block of html.split('<div class="col-12 col-sm-6 col-xl-4 item').slice(1)) {
    const id = text(block.match(/class="item_id">([^<]*)</)?.[1]);
    const href = block.match(/href="(huutokauppa\/[^"]+)"/)?.[1];
    if (!id || !href) continue;
    const infoHtml = block.match(/<div class="info">([\s\S]*?)<\/table>/)?.[1] || '';
    const rows = [...infoHtml.matchAll(/<tr>([\s\S]*?)<\/tr>/g)]
      .map(r => [...r[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map(c => text(c[1])));
    lots.push({
      id, cat, url: BASE + href,
      ends: text(block.match(/class="ends">([\s\S]*?)<\/span>/)?.[1]),
      startingPrice: /lähtö/i.test(text(block.match(/class="start-price">([^<]*)</)?.[1])),
      listPrice: parseEuro(text(block.match(/class="price">([^<]*)</)?.[1])),
      parts: rows.map(r => ({ desc: r[0] || '', weight: r[1] || '', fine: r[2] || '' })),
    });
  }
  return lots;
}

// Every page of one list, until a page adds no new lots. May be empty.
async function fetchList(auction, cat, cfg = CFG) {
  const seen = new Map();
  for (let page = 0; page < 40; page++) {
    const html = await get(`${BASE}huutokauppa/${auction}/?category=${cat}&page=${page}&sort=default&search=`);
    const before = seen.size;
    for (const l of parseList(html, cat)) if (!seen.has(l.id)) seen.set(l.id, l);
    if (seen.size === before) break;
    await sleep(cfg.requestDelayMs);
  }
  return [...seen.values()];
}

// ── Valuation ───────────────────────────────────────────────────────────────

// Round down: to 10 cents under 100 €, whole euros from 100 € (never over the limit)
const floorEur = (n) => (n < 100 ? Math.floor(n * 10) / 10 : Math.floor(n));

// Fine metal of a lot from its own rows. Anything unclear → 'check' (no advice).
function valueLot(lot, spot, cfg = CFG) {
  if (!lot.parts.length) return { status: 'check', reason: 'no weight in the listing' };
  let metal = null;
  let fineG = 0;
  let brutto = false;
  for (const p of lot.parts) {
    const m = metalOf(p.desc);
    const f = parseFineness(p.fine);
    const g = parseGrams(p.weight);
    if (!m) return { status: 'check', reason: `metal not stated (${p.desc || 'no description'})` };
    if (!f) return { status: 'check', reason: `fineness not stated (${p.fine || 'empty'})` };
    if (!g) return { status: 'check', reason: 'weight not stated' };
    if (f.brutto && m !== 'silver') return { status: 'check', reason: 'gross (BR) gold: the gold share is not known' };
    if (metal && metal !== m) return { status: 'check', reason: 'gold and silver in one lot' };
    metal = m;
    // BR = gross weight with other material: only the owner's silver share counts
    fineG += (f.brutto ? g * cfg.brSilverShare : g) * f.value;
    brutto = brutto || f.brutto;
  }
  const perG = spot[metal]?.eurG;
  if (!(perG > 0)) return { status: 'check', reason: 'no spot price' };
  fineG = Math.round(fineG * 10000) / 10000;
  return { status: 'ok', metal, fineG, meltEur: Math.round(fineG * perG * 100) / 100, brutto, brShare: brutto ? cfg.brSilverShare : null };
}

const limitFor = (lot, cfg = CFG) => floorEur(lot.value.meltEur * cfg.capOverMetal[lot.catName]);

// ── Bid feed and verdict ────────────────────────────────────────────────────

async function bidState(lot) {
  const html = await get(lot.url);
  const itemId = html.match(/pageitemid = (\d+)/)?.[1];
  if (!itemId) throw new Error('lot page has no item id');
  const j = await post(`${BASE}ajax/bid.json`, { mode: 'getBids', item: itemId }, { Referer: lot.url, 'X-Requested-With': 'XMLHttpRequest' });
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
  const limit = limitFor(lot, cfg);
  return { verdict: next <= limit ? 'buy' : 'skip', next, limit, vsSpot: next / lot.value.meltEur - 1, topBid: bid.topBid, minRaise: bid.minRaise };
}

// ── Messages ────────────────────────────────────────────────────────────────

const nf = (dec) => new Intl.NumberFormat('fi-FI', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const eur = (n) => (n == null ? '—' : `${nf(Math.abs(n) < 100 ? 2 : 0).format(n)} €`);
const pct = (p) => (p == null ? '—' : `${p > 0 ? '+' : ''}${nf(Math.abs(p) < 0.1 ? 1 : 0).format(p * 100)} %`);
const short = (lot) => {
  const t = lot.parts.map(p => p.desc).filter(Boolean).join(' + ');
  return t.length > 60 ? `${t.slice(0, 57)}…` : t;
};
const cap = (s, n = 3800) => (s.length > n ? `${s.slice(0, n - 30)}\n… (more on the computer)` : s);

// Friday: what is in the auction, best value first
function announceMessage(a, lots, errors = {}) {
  const parts = [];
  for (const c of CATS) {
    const all = lots.filter(l => l.catName === c);
    const ratio = (l) => (l.listPrice == null ? Infinity : l.listPrice / l.value.meltEur);
    const valued = all.filter(l => l.value.status === 'ok').sort((x, y) => ratio(x) - ratio(y));
    parts.push(`${LABEL[c][0].toUpperCase()}${LABEL[c].slice(1)}: ${all.length} lots, ${valued.length} valued by weight, ${all.length - valued.length} to check by hand`);
    for (const l of valued.slice(0, 8)) {
      const vs = l.listPrice ? pct(l.listPrice / l.value.meltEur - 1) : '—';
      parts.push(`• ${l.id} ${short(l)} · ${l.startingPrice ? 'start' : 'now'} ${eur(l.listPrice)} · metal ${eur(l.value.meltEur)} (${vs})`);
    }
    if (valued.length > 8) parts.push(`  +${valued.length - 8} more in the list`);
  }
  const failed = Object.values(errors);
  if (failed.length) parts.push(`⚠ Not read: ${failed.join(' · ')}`);
  parts.push('Bid advice comes on Tuesday 17:00. Lots close from 18:00 on Tuesday.');
  return { title: `🏛 Pantti auction ${a.number} is open · ${lots.length} lots`, message: cap(parts.join('\n')), priority: 'default', click: lots[0]?.url };
}

// Tuesday: per category, the lots whose next legal bid is within the limit
function adviceMessage(a, lots, cat) {
  const mine = lots.filter(l => l.catName === cat);
  const buy = mine.filter(l => l.advice?.verdict === 'buy').sort((x, y) => x.advice.vsSpot - y.advice.vsSpot);
  const count = (v) => mine.filter(l => l.advice?.verdict === v).length;
  const lines = buy.slice(0, 12).map(l => {
    const x = l.advice;
    const gross = l.value.brutto ? ` · BR lot: counted at ${Math.round(l.value.brShare * 100)} % silver (estimate), check the photos` : '';
    return `🟢 bid ${eur(x.next)} (step ${eur(x.minRaise)}) · lot ${l.id} ${short(l)}\n    now ${eur(x.topBid || l.listPrice)} · limit ${eur(x.limit)} · ${pct(x.vsSpot)} vs spot at this bid${gross}`;
  });
  if (buy.length > 12) lines.push(`+${buy.length - 12} more (see the report on the computer)`);
  const head = buy.length ? `${buy.length} to bid on. Bid only the NEXT amount shown, never above the limit.` : 'Nothing under the limit right now.';
  return {
    title: `🏛 Pantti ${a.number} ${LABEL[cat]}: ${buy.length} to bid on`,
    message: cap([head, ...lines, `Above the limit: ${count('skip')} · closed: ${count('closed')} · check by hand: ${count('check')}`].join('\n')),
    priority: buy.length ? 'high' : 'default',
    click: buy[0]?.url || mine[0]?.url,
    actions: buy.slice(0, 3).map((l, i) => ({ action: 'view', label: `${i + 1}. lot ${l.id}`, url: l.url })),
  };
}

// ── Building a phase ────────────────────────────────────────────────────────

// Reads the lists (not the categories in `skip`) and values every lot
async function loadAuction(a, { limit = Infinity, skip = [], cfg = CFG } = {}) {
  const spot = await getSpot();
  const lots = [];
  const errors = {};
  for (const catName of CATS) {
    if (skip.includes(catName)) continue;
    try {
      for (const l of (await fetchList(a.number, cfg.categories[catName], cfg)).slice(0, limit)) {
        l.catName = catName;
        l.value = valueLot(l, spot, cfg);
        lots.push(l);
      }
    } catch (err) {
      errors[catName] = `${LABEL[catName]}: ${err.message}`;
    }
  }
  if (!lots.length && !Object.keys(errors).length && skip.length < CATS.length) {
    throw new Error(`Pantti auction ${a.number} has no lots (the number changed or it is not open yet)`);
  }
  if (!lots.length && Object.keys(errors).length) throw new Error(Object.values(errors).join(' · '));
  return { spot, lots, errors };
}

// Reads the live bid state of every valued lot, one at a time
async function loadBids(lots, cfg = CFG) {
  for (const l of lots) {
    if (l.value.status !== 'ok') { l.advice = advise(l, null, cfg); continue; }
    let bid;
    try { bid = await bidState(l); } catch (err) { bid = { error: err.message }; }
    l.advice = advise(l, bid, cfg);
    await sleep(cfg.requestDelayMs);
  }
}

// The messages of one phase: [{ id, msg }] plus the lists that could not be read
async function buildPhase(phase, a, { limit = Infinity, skip = [], cfg = CFG } = {}) {
  const { lots, errors } = await loadAuction(a, { limit, skip, cfg });
  if (phase === 'announce') return { lots, items: [{ id: 'list', msg: announceMessage(a, lots, errors) }], errors: {} };
  await loadBids(lots, cfg);
  const items = CATS.filter(c => !errors[c] && !skip.includes(c)).map(c => ({ id: c, msg: adviceMessage(a, lots, c) }));
  return { lots, items, errors };
}

// ── What is due, and the scheduled run ──────────────────────────────────────

// announce: Friday 17:00 + announceWindowHours. advise: Tuesday 17:00 until the window closes.
function phaseDue(a, st, now, cfg = CFG) {
  const n = a.number;
  const listEnd = a.opens.getTime() + (cfg.announceWindowHours ?? 3) * 3600e3;
  if (!st.done[`${n}-announce`] && now >= a.opens && now.getTime() < listEnd) return 'announce';
  if (!st.done[`${n}-advise`] && now >= a.adviseAt && now < a.closes) return 'advise';
  return null;
}

const report = (items) => items.map(i => `${i.msg.title}\n${i.msg.message}`).join('\n\n----\n\n');

// One scheduled run: sends what is due and not yet sent; each message is recorded
// as soon as ntfy accepts it. Returns { status: 'idle'|'done'|'failed'|'busy', … }.
async function runDue({ now = new Date(), push = notify.push, build = buildPhase, log = state.log } = {}) {
  const a = auctionAt(now);
  if (!a) { log('no auction window now'); return { status: 'idle' }; }
  const st = state.load();
  const phase = phaseDue(a, st, now);
  if (!phase) { log(`nothing due for auction ${a.number}`); return { status: 'idle', auction: a.number }; }
  if (!state.lock()) { log('another run is still going'); return { status: 'busy' }; }
  const key = `${a.number}-${phase}`;
  try {
    log(`${phase === 'announce' ? 'Friday list' : 'bid advice'} for auction ${a.number}`);
    const skip = phase === 'advise' ? CATS.filter(c => st.sent[`${key}-${c}`]) : [];
    const { items, errors } = await build(phase, a, { skip });
    state.writeReport(`pantti-${a.number}-${phase}.txt`, `${report(items)}\n`);
    let notSent = null;
    for (const it of items) {
      if (st.sent[`${key}-${it.id}`]) continue;
      const r = await push(it.msg);
      if (r?.skipped) { notSent = r.skipped; continue; }
      st.sent[`${key}-${it.id}`] = new Date().toISOString();
      state.save(st); // saved at once: a crash never sends it twice
    }
    if (notSent) throw new Error(`not sent: ${notSent}`);
    const failed = Object.values(errors);
    if (failed.length) throw new Error(failed.join(' · '));
    st.done[key] = new Date().toISOString();
    state.save(st);
    log(`${phase} sent`);
    return { status: 'done', phase, auction: a.number };
  } catch (err) {
    log('FAILED:', err.message);
    const cur = state.load();
    const first = !cur.failed[key];
    if (first) cur.failed[key] = new Date().toISOString();
    state.save(cur);
    // One failure alert per phase, not one per retry
    if (first && !/no ntfy topic/.test(err.message)) {
      await push({ title: '⚠ Pantti check failed', message: `${err.message}\nIt retries at the next run time.`, priority: 'low' }).catch(() => {});
    }
    return { status: 'failed', phase, auction: a.number, error: err.message };
  } finally {
    state.unlock();
  }
}

module.exports = {
  hel, helToDate, auctionNumber, auctionAt, parseEuro, parseGrams, parseFineness, metalOf,
  parseList, fetchList, floorEur, valueLot, limitFor, bidState, minimumNext, advise,
  announceMessage, adviceMessage, loadAuction, loadBids, buildPhase, phaseDue, runDue, report, eur, pct,
};
