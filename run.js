#!/usr/bin/env node
// Pantti auctions Finland: one run. Spec 01.
//   node run.js                     the scheduled run: new listings and reminders that are due now
//   node run.js --show              every auction listed now: lots, values, bid advice (nothing sent)
//   node run.js --show --list       lots and values only (fast, no live bid checks)
//   node run.js --show --push       like --show, and sends the advice to the phone
//   node run.js --show --source panttilaina    one site only (pantti | panttilaina)
//   node run.js --show --limit 5    only the first 5 lots of each list
//   node run.js --top [--push]      every open auction: the 5 best lots of each category (one message each)
//   node run.js --test-push         one test message
//   node run.js --status            auctions seen, messages sent, settings

require('./src/env');
const CFG = require('./config');
const state = require('./src/state');
const notify = require('./src/notify');
const agent = require('./src/agent');
const { when, eur, pct, minutesLabel } = require('./src/common');
const { reminderMessage, topMessage, report } = require('./src/messages');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);
const arg = (f) => (flag(f) ? args[args.indexOf(f) + 1] : undefined);

function limitArg() {
  if (!flag('--limit')) return Infinity;
  const n = Number(arg('--limit'));
  if (!(n > 0)) { console.error('--limit needs a number, for example --limit 5'); process.exit(1); }
  return n;
}

function sourcesArg() {
  const all = agent.enabled(CFG);
  const want = arg('--source');
  if (!want) return all;
  const one = all.filter(s => s.id === want);
  if (!one.length) { console.error(`--source is one of: ${all.map(s => s.id).join(', ')}`); process.exit(1); }
  return one;
}

function verdictText(a, l) {
  const x = l.advice || {};
  if (x.verdict === 'buy') return a.proxyBids
    ? `🟢 MAX BID ${eur(x.maxBid)} (needs ${eur(x.next)}, ${pct(x.vsSpot)} vs spot, 🟢 at ${eur(x.buyAt)}, max ${eur(x.limit)})`
    : `🟢 BID ${eur(x.next)}${x.step ? ` (step ${eur(x.step)})` : ''}, ${pct(x.vsSpot)} vs spot, max ${eur(x.limit)}`;
  if (x.verdict === 'skip') return `not at your price: ${eur(x.next ?? x.now)} (${pct(x.vsSpot)} vs spot), 🟢 at ${eur(x.buyAt)}`;
  if (x.verdict === 'open') return `has bids, now ${eur(x.now)}; 🟢 at ${eur(x.buyAt)} (the live check gives the next bid)`;
  if (x.verdict === 'closed') return 'closed';
  return `check: ${x.reason || '—'}`;
}

async function show() {
  if (flag('--push') && flag('--list')) { console.error('--push needs the live check: run without --list.'); process.exit(1); }
  const out = [];
  const say = (l = '') => { console.log(l); out.push(l); };
  const now = new Date();
  const limit = limitArg();
  for (const src of sourcesArg()) {
    let found;
    try { found = await src.listed({ now, known: {}, manual: true, limit }); } catch (err) { say(`\n⚠ ${src.name}: ${err.message}`); continue; }
    if (!found.length) say(`\n${src.name}: no auction listed now`);
    for (const g of found) {
      const a = g.auction;
      const lots = flag('--list') ? g.lots : await src.current(a, { now, limit });
      say(`\n== ${a.title} · first lot closes ${when(a.closesAt)} · ${a.where}`);
      say(`   ${lots.length} lots, ${lots.filter(l => l.value.status === 'ok').length} valued by weight`);
      for (const l of lots) {
        const head = `${String(l.id).padStart(5)}  ${l.title.slice(0, 52).padEnd(52)}`;
        const cat = (CFG.categories[l.category]?.name || '').padEnd(19);
        say(l.value.status !== 'ok' ? `${head}  ${''.padEnd(19)}  CHECK BY HAND: ${l.value.reason}` : `${head}  ${cat}  metal ${eur(l.value.meltEur)} · ${verdictText(a, l)}`);
      }
      if (flag('--push')) {
        const r = await notify.push(reminderMessage(a, lots, null, { cfg: CFG }));
        say(r.skipped ? `Not sent: ${r.skipped}` : 'Sent to your phone.');
      }
    }
  }
  if (!flag('--push')) say('\nNot sent to your phone (add --push to send).');
  state.writeReport('show.txt', `${out.join('\n')}\n`);
}

// Every open auction on every site, with live advice: [{ a, l }] per valued lot
async function everyLot(now, limit) {
  const items = [];
  for (const src of sourcesArg()) {
    let found;
    try { found = await src.listed({ now, known: {}, manual: true, limit }); } catch (err) { console.log(`⚠ ${src.name}: ${err.message}`); continue; }
    for (const g of found) {
      // Suomen Panttilaina's list already has the live bid; Pantti needs its bid feed
      const lots = src.id === 'panttilaina' ? g.lots : await src.current(g.auction, { now, limit });
      for (const l of lots) if (l.value?.status === 'ok' && l.category && l.advice?.verdict !== 'closed') items.push({ a: g.auction, l });
    }
  }
  return items;
}

// The best lots of each category now, one message per category
async function top() {
  const n = Number(arg('--top')) > 0 ? Number(arg('--top')) : 5;
  const items = await everyLot(new Date(), limitArg());
  const msgs = Object.keys(CFG.categories).map(k => topMessage(k, items.filter(i => i.l.category === k), CFG, n));
  console.log(report(msgs));
  if (flag('--push')) {
    for (const m of msgs) {
      const r = await notify.push(m);
      console.log(r.skipped ? `Not sent: ${r.skipped}` : `Sent: ${m.title}`);
    }
  } else console.log('\nNot sent to your phone (add --push to send).');
  state.writeReport('top.txt', `${report(msgs)}\n`);
}

function status() {
  const st = state.load();
  console.log(`Now: ${when(new Date())} (Helsinki).`);
  const auctions = Object.values(st.auctions).sort((x, y) => String(x.closesAt).localeCompare(String(y.closesAt)));
  if (!auctions.length) console.log('No auctions seen yet.');
  for (const a of auctions) {
    const sent = Object.keys(st.sent).filter(k => k.startsWith(`${a.key}-before-`)).map(k => `${minutesLabel(+k.split('-').pop())} reminder sent`);
    console.log(`  ${a.title}: first lot closes ${when(a.closesAt)} · ${a.announced?.length || 0} lots announced${sent.length ? ` · ${sent.join(', ')}` : ''}`);
  }
  for (const [k, t] of Object.entries(st.failed)) console.log(`  failed ${k}: ${when(t)}`);
  console.log(`Last listing check: ${st.meta.lastListingCheck ? when(st.meta.lastListingCheck) : 'never'}`);
  const n = CFG.notify;
  console.log(`Messages: ${n.whenListed ? 'when listed, ' : ''}${agent.reminderMinutes(CFG).map(minutesLabel).join(' and ')} before closing.`);
  console.log(`Listings checked every ${n.listingCheckEvery} between ${n.listingCheckHours.join('–')}; the scheduler runs every ${CFG.checkEveryMinutes} min.`);
  console.log(`Sites: ${agent.enabled(CFG).map(s => s.name).join(', ')}`);
  console.log('Your limits (% vs metal value, from .env):');
  for (const c of Object.values(CFG.categories)) console.log(`  ${c.name.padEnd(20)} 🟢 at ${pct(c.alertPct / 100)} · max ${pct(c.maxPct / 100)}`);
  console.log(`Lots under ${eur(CFG.minMetalEur)} of metal, gross-weight gold and gold rings / earrings with stones are left out.`);
}

async function main() {
  if (flag('--test-push')) {
    const r = await notify.push({ title: '🏛 Pantti auctions test', message: 'Phone messages work.' });
    console.log(r.skipped ? `Not sent: ${r.skipped}` : 'Test message sent.');
    return 0;
  }
  if (flag('--status')) { status(); return 0; }
  if (flag('--show')) { await show(); return 0; }
  if (flag('--top')) { await top(); return 0; }
  state.trimLog();
  const r = await agent.runDue();
  return r.status === 'failed' ? 1 : 0;
}

main().then(code => process.exit(code)).catch(err => { state.log('crashed:', err.message); process.exit(1); });
