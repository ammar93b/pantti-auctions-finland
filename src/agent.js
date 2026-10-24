// One scheduled run (spec 03): look for new listings when due, then send every reminder
// that is due. Each message is recorded as soon as ntfy accepts it, so nothing is sent
// twice; anything that failed is simply tried again by the next run.

const CFG = require('../config');
const state = require('./state');
const notify = require('./notify');
const { getSpot } = require('./spot');
const { hel, minutesOf, minutesLabel } = require('./common');
const { listedMessage, reminderMessage, report } = require('./messages');

const ALL = { pantti: require('./pantti'), panttilaina: require('./panttilaina') };
const enabled = (cfg) => Object.entries(cfg.sources).filter(([id, s]) => s.enabled && ALL[id]).map(([id]) => ALL[id]);

// Reminder times in minutes before closing, largest first: ['10h', '30min'] → [600, 30]
const reminderMinutes = (cfg) => [...new Set((cfg.notify.beforeClosing || []).map(minutesOf))].sort((a, b) => b - a);

const hhmm = (s) => { const [h, m] = String(s).split(':').map(Number); return h * 60 + (m || 0); };

// Time for a listing check: inside listingCheckHours and listingCheckEvery since the last one
// (2 minutes early is fine, so a 10-minute scheduler doesn't push it to the next run)
function listingDue(st, now, cfg = CFG) {
  const [from, to] = (cfg.notify.listingCheckHours || ['00:00', '24:00']).map(hhmm);
  const h = hel(now);
  const t = h.h * 60 + h.mi;
  if (t < from || t >= to) return false;
  const last = Date.parse(st.meta.lastListingCheck || 0) || 0;
  return now.getTime() - last >= (minutesOf(cfg.notify.listingCheckEvery || '60min') - 2) * 60e3;
}

// The reminder due for an auction now: the latest reminder time that has passed and not
// been sent (an earlier one that was missed is skipped). null when none or closed.
function dueReminder(a, st, now, offsets) {
  const close = Date.parse(a.closesAt);
  if (!(close > now.getTime())) return null;
  let due = null;
  for (const m of offsets) if (now.getTime() >= close - m * 60e3) due = m;
  if (due == null || st.sent[`${a.key}-before-${due}`]) return null;
  return due;
}

const dayKey = (now) => { const h = hel(now); return `${h.y}${String(h.mo).padStart(2, '0')}${String(h.d).padStart(2, '0')}`; };

async function runDue({ now = new Date(), push = notify.push, sources, spotFn = getSpot, log = state.log, cfg = CFG } = {}) {
  sources ||= enabled(cfg);
  const byId = Object.fromEntries(sources.map(s => [s.id, s]));
  const offsets = reminderMinutes(cfg);
  const st = state.load();
  const listing = listingDue(st, now, cfg);
  // Reminders only for auctions of sites that are still enabled
  const watched = () => Object.values(st.auctions).filter(a => byId[a.source]);
  const anyReminder = () => watched().some(a => dueReminder(a, st, now, offsets) != null);
  if (!listing && !anyReminder()) { log('nothing due'); return { status: 'idle' }; }
  if (!state.lock()) { log('another run is still going'); return { status: 'busy' }; }

  let spot = null;
  const spotOnce = async () => (spot ||= await spotFn());
  const sent = [];
  const failures = [];

  // Sends one message; ntfy refusing or no topic is an error (so it is retried)
  async function send(msg) {
    const r = await push(msg);
    if (r?.skipped) throw new Error(`not sent: ${r.skipped}`);
    sent.push(msg.title);
  }

  // One alert per key, not one per retry
  async function failed(key, what, err) {
    log('FAILED:', what, err.message);
    failures.push(`${what}: ${err.message}`);
    if (st.failed[key]) return;
    st.failed[key] = now.toISOString();
    state.save(st);
    if (!/no ntfy topic/.test(err.message)) {
      await push({ title: `⚠ ${what} failed`, message: `${err.message}\nIt is tried again at the next run.`, priority: 'low' }).catch(() => {});
    }
  }

  try {
    // 1. New listings
    if (listing) {
      for (const src of sources) {
        try {
          const found = await src.listed({ now, spot: await spotOnce(), known: st.auctions, cfg });
          if (found.some(g => g.lots.length)) st.meta[`lotsSeen-${src.id}`] = now.toISOString();
          for (const { auction, lots } of found) await announce(src, auction, lots);
          await watchdog(src);
        } catch (err) {
          await failed(`${src.id}-listing-${dayKey(now)}`, `${src.name} listing check`, err);
        }
      }
      st.meta.lastListingCheck = now.toISOString();
      state.save(st);
    }

    // 2. Reminders
    for (const a of watched()) {
      const m = dueReminder(a, st, now, offsets);
      if (m == null) continue;
      const key = `${a.key}-before-${m}`;
      try {
        log(`reminder ${minutesLabel(m)} before closing: ${a.title}`);
        const lots = await byId[a.source].current(a, { now, spot: await spotOnce(), cfg });
        const msg = reminderMessage(a, lots, m, { cfg });
        state.writeReport(`${a.key}-before-${m}.txt`, `${report([msg])}\n`);
        await send(msg);
        st.sent[key] = new Date().toISOString();
        state.save(st); // saved at once: a crash never sends it twice
      } catch (err) {
        await failed(key, `${a.title} reminder`, err);
      }
    }
  } finally {
    state.unlock();
  }
  log(sent.length ? `sent: ${sent.join(' | ')}` : 'nothing sent');
  return failures.length ? { status: 'failed', sent, error: failures.join(' · ') } : { status: 'done', sent };

  // An auction (or its new lots) seen in a listing check
  async function announce(src, auction, lots) {
    const rec = st.auctions[auction.key] || { ...auction, announced: [], listedAt: now.toISOString() };
    const first = !st.auctions[auction.key];
    // The closing time only moves earlier: once the first lots have closed, the later
    // ones must not shift the auction's reminders (they were for the first lot)
    const closesAt = rec.closesAt && rec.closesAt < auction.closesAt ? rec.closesAt : auction.closesAt;
    Object.assign(rec, { title: auction.title, closesAt, url: auction.url, where: auction.where, proxyBids: auction.proxyBids });
    st.auctions[auction.key] = rec;
    state.save(st);
    const fresh = lots.filter(l => !rec.announced.includes(l.id));
    if (!fresh.length) return;
    // Lots added to an announced auction get a message only if one is under the limit;
    // none at all when a reminder is due right now (the reminder covers them)
    const worth = first || fresh.some(l => l.advice?.verdict === 'buy');
    if (cfg.notify.whenListed && worth && dueReminder(rec, st, now, offsets) == null) {
      const msg = listedMessage(rec, first ? lots : fresh, { first, cfg, reminders: offsets });
      state.writeReport(`${auction.key}-listed${first ? '' : `-${Date.now()}`}.txt`, `${report([msg])}\n`);
      await send(msg);
    }
    rec.announced.push(...fresh.map(l => l.id));
    state.save(st);
  }

  // One warning when a site has shown no lots for warnAfterDaysWithoutLots days
  async function watchdog(src) {
    const days = cfg.sources[src.id]?.warnAfterDaysWithoutLots;
    if (!days) return;
    const k = `lotsSeen-${src.id}`;
    if (!st.meta[k]) { st.meta[k] = now.toISOString(); return; }
    if (now.getTime() - Date.parse(st.meta[k]) < days * 86400e3) return;
    await failed(`${src.id}-nolots-${st.meta[k]}`, `${src.name} reading`,
      new Error(`no lots found for ${days} days: the lists may have moved. Check the links in config.js (sources.${src.id}.lists).`));
  }
}

module.exports = { runDue, listingDue, dueReminder, reminderMinutes, enabled, ALL };
