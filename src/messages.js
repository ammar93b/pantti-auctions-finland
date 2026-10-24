// The phone messages: one when an auction is listed, and the reminders before it closes.
// Spec 03. Inside each message the lots are shown in the owner's four categories (spec 05).
// Suomen Panttilaina takes max bids, so its advice is "set your max bid"; Helsingin
// Pantti's is "bid the next amount".

const { when, clock, minutesLabel, eur, pct } = require('./common');

const LIST_LINES = 5; // per category in the listed message
const ADVICE_LINES = 6; // per category in a reminder
const cap = (s, n = 3800) => (s.length > n ? `${s.slice(0, n - 30)}\n… (more on the computer)` : s);
const count = (lots, v) => lots.filter(l => l.advice?.verdict === v).length;
const brNote = (l) => (l.value?.brutto ? ` · br: ${Math.round(l.value.brShare * 100)} % silver counted, check the photos` : '');
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

// Price / metal value, lower is better; lots without a price last
const ratio = (l) => {
  const price = l.advice?.next ?? l.advice?.now ?? l.nowPrice;
  return price > 0 && l.value?.meltEur ? price / l.value.meltEur : Infinity;
};
const buyFirst = (x, y) => (y.advice?.verdict === 'buy') - (x.advice?.verdict === 'buy') || ratio(x) - ratio(y);

// Valued lots in the four categories, in config order; empty ones left out
function sections(lots, cfg) {
  return Object.entries(cfg.categories)
    .map(([key, c]) => ({ key, name: c.name, cat: c, lots: lots.filter(l => l.value?.status === 'ok' && l.category === key) }))
    .filter(s => s.lots.length);
}

// "max +5 %, 🟢 at −5 %" for a section heading
const limitText = (c) => (c.alertPct < c.maxPct ? `🟢 at ${pct(c.alertPct / 100)} · max ${pct(c.maxPct / 100)}` : `max ${pct(c.maxPct / 100)}`) + ' vs metal';

// One line per valued lot in the listing message
function listLine(a, l) {
  const x = l.advice || {};
  const metal = `metal ${eur(l.value.meltEur)}`;
  if (x.verdict === 'buy') {
    const bid = a.proxyBids ? `max bid ${eur(x.maxBid)}` : `bid ${eur(x.next)}`;
    return `🟢 ${l.id} ${l.title}\n    ${bid} · needs ${eur(x.next)} (${pct(x.vsSpot)} vs spot) · ${metal}`;
  }
  if (x.verdict === 'open') return `🔵 ${l.id} ${l.title}\n    now ${eur(x.now)} with bids · 🟢 at ${eur(x.buyAt)} · ${metal}`;
  const price = x.next ?? x.now ?? l.nowPrice;
  return `• ${l.id} ${l.title} · ${eur(price)} (${pct(x.vsSpot)} vs spot)`;
}

// When an auction is first seen (`first`), or when lots were added to a known one
function listedMessage(a, lots, { first = true, cfg, reminders = [] }) {
  const secs = sections(lots, cfg);
  const valued = secs.reduce((n, s) => n + s.lots.length, 0);
  const buy = count(lots, 'buy');
  const parts = [
    `Closes ${when(a.closesAt)} · ${a.where}`,
    `${plural(lots.length, 'lot')}: ${valued} valued by weight, ${lots.length - valued} to check by hand.`,
  ];
  for (const s of secs) {
    const sorted = [...s.lots].sort(buyFirst);
    parts.push(`— ${s.name}: ${s.lots.length} · ${count(s.lots, 'buy')} 🟢 (${limitText(s.cat)})`);
    parts.push(...sorted.slice(0, LIST_LINES).map(l => listLine(a, l)));
    if (sorted.length > LIST_LINES) parts.push(`  +${sorted.length - LIST_LINES} more`);
  }
  if (reminders.length) parts.push(`Reminders: ${reminders.map(minutesLabel).join(' and ')} before closing.`);
  const firstBuy = lots.filter(l => l.advice?.verdict === 'buy').sort(buyFirst)[0];
  return {
    title: first ? `🏛 ${a.title}: ${plural(lots.length, 'lot')} listed · ${buy} 🟢`
      : `🏛 ${a.title}: ${plural(lots.length, 'new lot')} · ${buy} 🟢`,
    message: cap(parts.join('\n')),
    priority: 'default',
    click: firstBuy?.url || a.url,
  };
}

// `minutes` before the first lot closes (null for a manual check): what to bid now
function reminderMessage(a, lots, minutes, { cfg }) {
  const buyAll = lots.filter(l => l.advice?.verdict === 'buy').sort((x, y) => x.advice.vsSpot - y.advice.vsSpot);
  const parts = [];
  if (!buyAll.length) parts.push('Nothing at your 🟢 price right now.');
  else parts.push(a.proxyBids ? `${buyAll.length} to bid on. Set the MAX BID shown: the site bids for you up to it.`
    : `${buyAll.length} to bid on. Bid only the NEXT amount shown, never above the limit.`);
  for (const s of sections(lots, cfg)) {
    const buy = s.lots.filter(l => l.advice?.verdict === 'buy').sort((x, y) => x.advice.vsSpot - y.advice.vsSpot);
    if (!buy.length) continue;
    parts.push(`— ${s.name} (${limitText(s.cat)})`);
    for (const l of buy.slice(0, ADVICE_LINES)) {
      const x = l.advice;
      const ends = l.closesAt ? ` · closes ${clock(l.closesAt)}` : '';
      parts.push(a.proxyBids
        ? `🟢 max bid ${eur(x.maxBid)} · ${l.id} ${l.title}\n    needs ${eur(x.next)} now (${pct(x.vsSpot)} vs spot) · metal ${eur(l.value.meltEur)}${ends}${brNote(l)}`
        : `🟢 bid ${eur(x.next)} (step ${eur(x.step)}) · lot ${l.id} ${l.title}\n    now ${eur(x.now ?? l.nowPrice)} · limit ${eur(x.limit)} · ${pct(x.vsSpot)} vs spot at this bid${ends}${brNote(l)}`);
    }
    if (buy.length > ADVICE_LINES) parts.push(`  +${buy.length - ADVICE_LINES} more (npm run show on the computer)`);
  }
  parts.push(`Not at your price: ${count(lots, 'skip')} · closed: ${count(lots, 'closed')} · check by hand: ${count(lots, 'check')}`);
  parts.push(`First lot closes ${when(a.closesAt)} · ${a.where}`);
  const lead = minutes ? `closes in ${minutesLabel(minutes)}` : 'now';
  return {
    title: `⏰ ${a.title} ${lead}: ${buyAll.length} to bid on`,
    message: cap(parts.join('\n')),
    priority: buyAll.length ? 'high' : 'default',
    click: buyAll[0]?.url || a.url,
    actions: buyAll.slice(0, 3).map((l, i) => ({ action: 'view', label: `${i + 1}. ${l.id.split('.').pop()}`, url: l.url })),
  };
}

// One category across every open auction: its best `n` lots now, 🟢 first, then the
// lowest price against metal value (`npm run top`)
function topMessage(key, items, cfg, n = 5) {
  const c = cfg.categories[key];
  const order = (x, y) => buyFirst(x.l, y.l);
  const best = [...items].sort(order).slice(0, n);
  const buy = items.filter(i => i.l.advice?.verdict === 'buy').length;
  const lines = best.map(({ a, l }) => {
    const x = l.advice || {};
    const price = x.next ?? x.now ?? l.nowPrice;
    const vs = x.vsSpot ?? (price > 0 ? price / l.value.meltEur - 1 : null);
    const bid = x.verdict === 'buy' ? (a.proxyBids ? ` · set max bid ${eur(x.maxBid)}` : ` · bid ${eur(x.next)}`) : '';
    const now = x.verdict === 'open' ? 'now (has bids) ' : x.next ? 'needs ' : 'now ';
    return `${x.verdict === 'buy' ? '🟢' : '•'} ${l.title}\n    ${now}${eur(price)} (${pct(vs)} vs spot) · metal ${eur(l.value.meltEur)}${bid}${brNote(l)}\n    ${a.title} · lot ${String(l.id).split('.').pop()} · closes ${when(l.closesAt)}`;
  });
  return {
    title: `🏆 ${c.name}: top ${best.length} of ${items.length} · ${buy} 🟢`,
    message: cap([`${limitText(c)}. Best price against metal value first.`, ...lines].join('\n')),
    priority: buy ? 'high' : 'default',
    click: best[0]?.l.url,
    actions: best.slice(0, 3).map(({ l }, i) => ({ action: 'view', label: `${i + 1}. ${String(l.id).split('.').pop()}`, url: l.url })),
  };
}

const report = (msgs) => msgs.map(m => `${m.title}\n${m.message}`).join('\n\n----\n\n');

module.exports = { listedMessage, reminderMessage, topMessage, report, ratio, sections };
