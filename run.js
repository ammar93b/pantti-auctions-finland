#!/usr/bin/env node
// Helsingin Pantti agent: one run. Spec 01.
//   node run.js                    the scheduled run: does what is due now (Friday list / Tuesday advice)
//   node run.js --show             the latest auction now: lots, values, bid advice (nothing sent)
//   node run.js --show --list      lots and values only (fast, no bid checks)
//   node run.js --show --push      like --show, and sends the advice to the phone
//   node run.js --show --limit 5   only the first 5 lots of each list
//   node run.js --test-push        one test message
//   node run.js --status           what was sent, and the next run times

require('./src/env');
const CFG = require('./config');
const state = require('./src/state');
const notify = require('./src/notify');
const pantti = require('./src/pantti');

const args = process.argv.slice(2);
const flag = (f) => args.includes(f);

function limitArg() {
  if (!flag('--limit')) return Infinity;
  const n = Number(args[args.indexOf('--limit') + 1]);
  if (!(n > 0)) { console.error('--limit needs a number, for example --limit 5'); process.exit(1); }
  return n;
}

async function show() {
  if (flag('--push') && flag('--list')) { console.error('--push needs the bid check: run without --list.'); process.exit(1); }
  const out = [];
  const say = (l = '') => { console.log(l); out.push(l); };
  const a = pantti.auctionAt(new Date(), { any: true });
  say(`Pantti auction ${a.number} (opened Friday ${a.friday} 17:00, Helsinki time)`);
  const { lots, errors } = await pantti.loadAuction(a, { limit: limitArg() });
  for (const e of Object.values(errors)) say(`⚠ Not read: ${e}`);
  if (!flag('--list')) await pantti.loadBids(lots);
  for (const cat of ['coins', 'silver']) {
    const mine = lots.filter(l => l.catName === cat);
    say(`\n== ${cat}: ${mine.length} lots, ${mine.filter(l => l.value.status === 'ok').length} valued by weight`);
    for (const l of mine) {
      const head = `${l.id.padStart(5)}  ${(l.parts.map(x => x.desc).join(' + ') || '—').slice(0, 52).padEnd(52)}`;
      if (l.value.status !== 'ok') { say(`${head}  CHECK BY HAND: ${l.value.reason}`); continue; }
      const x = l.advice;
      const verdict = !x ? '' : x.verdict === 'buy' ? `BID ${pantti.eur(x.next)} (step ${pantti.eur(x.minRaise)}), ${pantti.pct(x.vsSpot)} vs spot, limit ${pantti.eur(x.limit)}`
        : x.verdict === 'skip' ? `skip: next ${pantti.eur(x.next)} is above the limit ${pantti.eur(x.limit)}`
        : x.verdict === 'closed' ? 'closed' : `check: ${x.reason}`;
      say(`${head}  metal ${pantti.eur(l.value.meltEur)} · ${l.startingPrice ? 'start' : 'now'} ${pantti.eur(l.listPrice)}  ${verdict}`);
    }
  }
  if (flag('--push')) {
    for (const cat of ['coins', 'silver'].filter(c => !errors[c])) {
      const r = await notify.push(pantti.adviceMessage(a, lots, cat));
      say(r.skipped ? `Not sent (${cat}): ${r.skipped}` : `Sent to your phone (${cat}).`);
    }
  } else {
    say('\nNot sent to your phone (add --push to send).');
  }
  state.writeReport(`pantti-${a.number}-show.txt`, `${out.join('\n')}\n`);
}

function status() {
  const st = state.load();
  const now = new Date();
  const a = pantti.auctionAt(now, { any: true });
  console.log(`Now: ${now.toLocaleString('fi-FI')} (Helsinki). Latest auction: ${a ? a.number : '—'}.`);
  const byAuction = {};
  for (const [k, t] of Object.entries(st.sent)) {
    const [n, phase, part] = k.split('-');
    (byAuction[n] ||= []).push(`${phase} ${part}: ${new Date(t).toLocaleString('fi-FI')}`);
  }
  for (const n of Object.keys(byAuction).sort()) console.log(`  ${n}: ${byAuction[n].join(' · ')}`);
  if (!Object.keys(byAuction).length) console.log('  nothing sent yet');
  for (const [k, t] of Object.entries(st.failed)) console.log(`  failed ${k}: ${new Date(t).toLocaleString('fi-FI')}${st.done[k] ? ' (later sent)' : ''}`);
  console.log(`Run times (Helsinki): Friday ${CFG.schedule.friday.join(', ')} · Tuesday ${CFG.schedule.tuesday.join(', ')}`);
}

async function main() {
  if (flag('--test-push')) {
    const r = await notify.push({ title: '🏛 Pantti agent test', message: 'Phone messages work.' });
    console.log(r.skipped ? `Not sent: ${r.skipped}` : 'Test message sent.');
    return 0;
  }
  if (flag('--status')) { status(); return 0; }
  if (flag('--show')) { await show(); return 0; }
  state.trimLog();
  state.log('run started');
  const r = await pantti.runDue();
  return r.status === 'failed' ? 1 : 0;
}

main().then(code => process.exit(code)).catch(err => { state.log('crashed:', err.message); process.exit(1); });
