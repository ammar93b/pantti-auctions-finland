// Shared by both auction sites: Helsinki time, number parsing, fineness codes,
// valuation, the four categories, the owner's limits and number formatting. Specs 02–05.

const TZ = 'Europe/Helsinki';

// ── Helsinki time ───────────────────────────────────────────────────────────

const fmt = new Intl.DateTimeFormat('en-GB', {
  timeZone: TZ, weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

// Wall-clock parts of an instant in Helsinki
function hel(date) {
  const p = {};
  for (const x of fmt.formatToParts(date)) p[x.type] = x.value;
  return { y: +p.year, mo: +p.month, d: +p.day, h: +p.hour, mi: +p.minute, s: +p.second, wd: WEEKDAYS.indexOf(p.weekday) };
}

// The instant at which Helsinki wall-clock time reads y-mo-d h:mi:s
function helToDate(y, mo, d, h, mi, s = 0) {
  const guess = Date.UTC(y, mo - 1, d, h, mi, s);
  const w = hel(new Date(guess));
  return new Date(guess - (Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - guess));
}

const two = (n) => String(n).padStart(2, '0');
// "Mon 26.10. 19:00" in Helsinki time
function when(date) {
  const h = hel(new Date(date));
  return `${WEEKDAYS[h.wd]} ${h.d}.${h.mo}. ${two(h.h)}:${two(h.mi)}`;
}
// "19:42:30" in Helsinki time
const clock = (date) => { const h = hel(new Date(date)); return `${two(h.h)}:${two(h.mi)}${h.s ? `:${two(h.s)}` : ''}`; };

// "10h" → 600, "30min" → 30, "1h30min" → 90, "45m" → 45 (minutes); anything else throws
function minutesOf(s) {
  const m = String(s).trim().toLowerCase().match(/^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m(?:in)?)?$/);
  const total = m ? (+(m[1] || 0)) * 60 + (+(m[2] || 0)) : NaN;
  if (!(total > 0)) throw new Error(`config: "${s}" is not a time like '10h', '30min' or '1h30min'`);
  return total;
}
// 600 → "10 h", 30 → "30 min", 90 → "1 h 30 min"
const minutesLabel = (m) => [Math.floor(m / 60) && `${Math.floor(m / 60)} h`, m % 60 && `${m % 60} min`].filter(Boolean).join(' ');

// ── Numbers in lot text ─────────────────────────────────────────────────────

// "200 €", "1 200 €", "12,50 €", "1.200 €" → number
function parseEuro(s) {
  const t = String(s ?? '').replace(/[^\d,.]/g, '').replace(/\.(?=\d{3}\b)/g, '').replace(',', '.');
  const n = parseFloat(t);
  return Number.isFinite(n) ? n : null;
}

// "1,7" → 1.7 (grams); 0 or empty → null
function parseGrams(s) {
  const n = parseFloat(String(s ?? '').replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) && n > 0 ? n : null;
}

// "H925BR" → 0.925 gross (BR), "585" → 0.585, "585br" → 0.585 gross,
// "999,9"/"9999" → 0.9999, "1000" → 1; anything else → null
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

// Plated, gilded or not solid metal: never valued
const NOT_SOLID = /kullattu|kultaus|hopeoitu|kultapinnoi|hopeapinnoi|päällys|pinnoite|täytetty|plated|vermeil|setel|kopio|replik/i;

// Not gold or silver at all (palladium, platinum, bronze, brass, nickel silver): left out
const OTHER_METAL = /palladi|platin|pronssi|messinki|uushopea|alpakka/i;

// Makers' names that contain a metal word: Kultakeskus Oy, kultaseppä (goldsmith)
const withoutMakers = (s) => String(s || '').replace(/kultakeskus\w*|kultasep\w*/gi, '');

// Finenesses that exist for each metal. A silver standard (925, 830, 813) on a "gold" lot,
// or a gold standard (585, 375) on a silver lot, means the lot is not what its list says.
const GOLD_FINE = [0.333, 0.375, 0.417, 0.5, 0.583, 0.585, 0.75, 0.875, 0.9, 0.916, 0.917, 0.958, 0.986, 0.99, 0.995, 0.999, 0.9999, 1];
function fineFits(metal, value) {
  if (metal === 'gold') return GOLD_FINE.some(f => Math.abs(f - value) < 0.0005);
  if (metal === 'silver') return value >= 0.3 && value <= 1 && ![0.375, 0.583, 0.585].includes(value);
  return false;
}

// ── Valuation and limits ────────────────────────────────────────────────────

const check = (reason) => ({ status: 'check', reason });

// A lot the owner does not want at all: not valued, not counted, not in any message
const hidden = (reason) => ({ status: 'hidden', reason });

// parts: [{ metal: 'gold'|'silver', fine: { value, brutto }, grams }], all stated.
// BR silver counts only the owner's share of its gross weight; BR gold is left out (owner).
function valueParts(parts, spot, cfg) {
  let metal = null;
  let fineG = 0;
  let brutto = false;
  for (const p of parts) {
    if (p.fine.brutto && p.metal !== 'silver') return hidden('gross (br) gold');
    if (metal && metal !== p.metal) return check('gold and silver in one lot');
    metal = p.metal;
    fineG += (p.fine.brutto ? p.grams * cfg.brSilverShare : p.grams) * p.fine.value;
    brutto = brutto || p.fine.brutto;
  }
  if (!metal) return check('no weight in the listing');
  const perG = spot?.[metal]?.eurG;
  if (!(perG > 0)) return check('no spot price');
  fineG = Math.round(fineG * 10000) / 10000;
  return { status: 'ok', metal, fineG, meltEur: Math.round(fineG * perG * 100) / 100, brutto, brShare: brutto ? cfg.brSilverShare : null };
}

// Round down: to 10 cents under 100 €, whole euros from 100 € (never over the limit)
const floorEur = (n) => (n < 100 ? Math.floor(n * 10) / 10 : Math.floor(n));

// ── Categories (spec 05) ────────────────────────────────────────────────────

// Coins, bars and medals by the lot's own words (kultaraha, juhlaraha, harkko, dukaatti, …)
// ("laatta" alone is a bar; "laatta-ranneketju" is a flat-link bracelet)
const COIN = /raha|kolikk|dukaat|harkko|(?<![\p{L}-])laatta(?![\p{L}-])|unssi|\boz\b|sovereign|krugerrand|dollari|rupla|mitali|markka|\bmk\b/iu;
const isCoinText = (s) => COIN.test(String(s || ''));

// gold / silver + coins or not → goldCoins | silverCoins | junkGold | junkSilver
function categoryOf(metal, coin) {
  if (metal === 'gold') return coin ? 'goldCoins' : 'junkGold';
  if (metal === 'silver') return coin ? 'silverCoins' : 'junkSilver';
  return null;
}

// Gold rings and earrings with a stone or gross weight are not wanted (owner, 25 Oct 2026)
const RING_OR_EARRING = /sormus|korvakoru|korvarenga|korvanap|korvis/i;
const STONE = /\dbr\b|\bbr\b|kivi|timant|briljant|helmi|\d\s*ct\b|\bct\b|safiiri|rubiini|smaragdi|zirkoni|opaali|granaatti|topaasi|ametisti/i;
const ringWithStone = (s) => RING_OR_EARRING.test(s) && STONE.test(s);

// The owner's limits for a valued lot of category `cat`: the most to bid (max) and the
// price at which it is marked 🟢 (buyAt), both rounded down
function limitsFor(value, cat, cfg) {
  const c = cfg.categories[cat];
  return {
    max: floorEur(value.meltEur * (1 + c.maxPct / 100)),
    buyAt: floorEur(value.meltEur * (1 + Math.min(c.alertPct ?? c.maxPct, c.maxPct) / 100)),
  };
}

// ── Number formatting ───────────────────────────────────────────────────────

const nf = (dec) => new Intl.NumberFormat('fi-FI', { minimumFractionDigits: dec, maximumFractionDigits: dec });
const eur = (n) => (n == null ? '—' : `${nf(Math.abs(n) < 100 && n % 1 ? 2 : 0).format(n)} €`);
const pct = (p) => (p == null ? '—' : `${p > 0 ? '+' : ''}${nf(Math.abs(p) < 0.1 ? 1 : 0).format(p * 100)} %`);
const shorten = (s, n = 60) => (s.length > n ? `${s.slice(0, n - 3)}…` : s);

module.exports = {
  TZ, hel, helToDate, when, clock, minutesOf, minutesLabel,
  parseEuro, parseGrams, parseFineness, NOT_SOLID, OTHER_METAL, withoutMakers, fineFits, check, hidden, valueParts, floorEur,
  isCoinText, categoryOf, ringWithStone, limitsFor,
  eur, pct, shorten,
};
