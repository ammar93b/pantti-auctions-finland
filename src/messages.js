// The phone messages: one when an auction is listed, and the reminders before it closes.
// Spec 03. Both sites use the same layout; Suomen Panttilaina takes max bids, so its
// advice is "set your max bid", Helsingin Pantti's is "bid the next amount".

const { when, clock, minutesLabel, eur, pct } = require('./common');

const LIST_LINES = 10;
const ADVICE_LINES = 12;
const cap = (s, n = 3800) => (s.length > n ? `${s.slice(0, n - 30)}\n… (more on the computer)` : s);
const count = (lots, v) => lots.filter(l => l.advice?.verdict === v).length;
const brNote = (l) => (l.value?.brutto ? ` · br: ${Math.round(l.value.brShare * 100)} % silver counted, check the photos` : '');
const limitsLine = (cfg) => `Your limit: gold ${pct(cfg.maxOverSpot.gold - 1)}, silver ${pct(cfg.maxOverSpot.silver - 1)} over spot.`;

// Price / metal value, lower is better; lots without a price last
const ratio = (l) => {
  const price = l.advice?.next ?? l.advice?.now ?? l.nowPrice;
  return price > 0 && l.value?.meltEur ? price / l.value.meltEur : Infinity;
};

// One line per valued lot in the listing message
function listLine(a, l) {
  const x = l.advice || {};
  const metal = `metal ${eur(l.value.meltEur)}`;
  if (x.verdict === 'buy') {
    const bid = a.proxyBids ? `max bid ${eur(x.maxBid)}` : `bid ${eur(x.next)}`;
    return `🟢 ${l.id} ${l.title}\n    ${bid} · needs ${eur(x.next)} (${pct(x.vsSpot)} vs spot) · ${metal}`;
  }
  if (x.verdict === 'open') return `🔵 ${l.id} ${l.title}\n    now ${eur(x.now)} with bids · limit ${eur(x.limit)} · ${metal}`;
  const price = x.next ?? x.now ?? l.nowPrice;
  return `• ${l.id} ${l.title} · ${eur(price)} (${pct(x.vsSpot)} vs spot): over the limit`;
}

// When an auction is first seen (`first`), or when lots were added to a known one
function listedMessage(a, lots, { first = true, cfg, reminders = [] }) {
  const valued = lots.filter(l => l.value?.status === 'ok').sort((x, y) => ratio(x) - ratio(y));
  const buy = valued.filter(l => l.advice?.verdict === 'buy');
  const parts = [
    `Closes ${when(a.closesAt)} · ${a.where}`,
    `${lots.length} lot${lots.length === 1 ? '' : 's'}: ${valued.length} valued by weight, ${lots.length - valued.length} to check by hand. ${limitsLine(cfg)}`,
    ...valued.slice(0, LIST_LINES).map(l => listLine(a, l)),
  ];
  if (valued.length > LIST_LINES) parts.push(`+${valued.length - LIST_LINES} more (npm run show on the computer)`);
  if (reminders.length) parts.push(`Reminders: ${reminders.map(minutesLabel).join(' and ')} before closing.`);
  return {
    title: first ? `🏛 ${a.title}: ${lots.length} lot${lots.length === 1 ? '' : 's'} listed · ${buy.length} under your limit`
      : `🏛 ${a.title}: ${lots.length} new lot${lots.length === 1 ? '' : 's'} · ${buy.length} under your limit`,
    message: cap(parts.join('\n')),
    priority: 'default',
    click: buy[0]?.url || a.url,
  };
}

// `minutes` before the first lot closes (null for a manual check): what to bid now
function reminderMessage(a, lots, minutes, { cfg }) {
  const buy = lots.filter(l => l.advice?.verdict === 'buy').sort((x, y) => x.advice.vsSpot - y.advice.vsSpot);
  const lines = buy.slice(0, ADVICE_LINES).map(l => {
    const x = l.advice;
    const ends = l.closesAt ? ` · closes ${clock(l.closesAt)}` : '';
    if (a.proxyBids) {
      return `🟢 max bid ${eur(x.maxBid)} · ${l.id} ${l.title}\n    needs ${eur(x.next)} now (${pct(x.vsSpot)} vs spot) · metal ${eur(l.value.meltEur)}${ends}${brNote(l)}`;
    }
    return `🟢 bid ${eur(x.next)} (step ${eur(x.step)}) · lot ${l.id} ${l.title}\n    now ${eur(x.now ?? l.nowPrice)} · limit ${eur(x.limit)} · ${pct(x.vsSpot)} vs spot at this bid${ends}${brNote(l)}`;
  });
  if (buy.length > ADVICE_LINES) lines.push(`+${buy.length - ADVICE_LINES} more (npm run show on the computer)`);
  const head = !buy.length ? 'Nothing under your limit right now.'
    : a.proxyBids ? `${buy.length} to bid on. Set the MAX BID shown: the site bids for you up to it.`
      : `${buy.length} to bid on. Bid only the NEXT amount shown, never above the limit.`;
  const lead = minutes ? `closes in ${minutesLabel(minutes)}` : 'now';
  return {
    title: `⏰ ${a.title} ${lead}: ${buy.length} to bid on`,
    message: cap([
      head, ...lines,
      `Above the limit: ${count(lots, 'skip')} · closed: ${count(lots, 'closed')} · check by hand: ${count(lots, 'check')}`,
      `First lot closes ${when(a.closesAt)} · ${a.where}`,
    ].join('\n')),
    priority: buy.length ? 'high' : 'default',
    click: buy[0]?.url || a.url,
    actions: buy.slice(0, 3).map((l, i) => ({ action: 'view', label: `${i + 1}. ${l.id.split('.').pop()}`, url: l.url })),
  };
}

const report = (msgs) => msgs.map(m => `${m.title}\n${m.message}`).join('\n\n----\n\n');

module.exports = { listedMessage, reminderMessage, report, ratio };
