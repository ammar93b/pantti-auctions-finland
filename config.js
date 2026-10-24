// Pantti auctions Finland: settings. Specs: specs/01–05. The README explains each one.

const { LIMITS } = require('./src/env');

module.exports = {
  // ── What you buy, and your limits ─────────────────────────────────────────
  // Every lot is sorted into one of these four categories (spec 05), in this order in the messages.
  // Your limits are in .env (never uploaded), in % of the lot's metal value at today's spot price:
  //   <KEY>_MAX_PCT    the most you bid            (e.g. 5 = 5 % above, 0 = never above, -5 = 5 % below)
  //   <KEY>_ALERT_PCT  🟢 when a lot can be had at or below this (default: the same as MAX)
  // Not set: 0 %, never above the metal value.
  categories: {
    goldCoins: { name: 'Gold coins & bars', metal: 'gold', ...LIMITS.GOLD_COINS },
    silverCoins: { name: 'Silver coins & bars', metal: 'silver', ...LIMITS.SILVER_COINS },
    junkGold: { name: 'Junk gold', metal: 'gold', ...LIMITS.JUNK_GOLD },
    junkSilver: { name: 'Junk silver', metal: 'silver', ...LIMITS.JUNK_SILVER },
  },

  // Lots worth less than this in metal are left out (not worth a pickup trip)
  minMetalEur: 30,

  // br / BR = gross weight (the lot holds other material too): the share of it counted as silver.
  // Gross-weight gold is always left out, and so are gold rings and earrings with stones.
  brSilverShare: 0.30,

  // ── When your phone gets a message ────────────────────────────────────────
  notify: {
    // Once, when an auction is first listed (lots added later: only if one is 🟢 at your price)
    whenListed: true,
    // Before the auction's first watched lot closes. Write hours and minutes: '10h', '30min', '1h30min'.
    // Add or remove times freely; [] = no reminders.
    beforeClosing: ['10h', '30min'],
    // New listings are looked for this often, only between these Helsinki times
    listingCheckEvery: '60min',
    listingCheckHours: ['08:00', '22:00'],
  },

  // How often the computer's scheduler starts the agent (minutes, 5–60). A run with nothing
  // due reads nothing from the internet. After a change: npm run schedule:install
  checkEveryMinutes: 10,

  // ── Auction sites and the lists that are read ─────────────────────────────
  sources: {
    // Helsingin Pantti: one auction a week, opens Friday 17:00, lots close Tuesday from 18:00
    pantti: {
      enabled: true,
      // Auction 966 opened on Friday 16.10.2026 at 17:00 (Helsinki). Each week the number goes up by one.
      // If Pantti ever skips a week, set this to any recent auction and its Friday.
      reference: { auction: 966, friday: '2026-10-16' },
      // {auction} is replaced by the week's auction number. Copy any list link from the site.
      // metal: keep only lots of this metal (leave out for lists with both, like coins & medals).
      // Each lot goes to coins & bars or junk by its own text (spec 05).
      lists: [
        { name: 'coins & medals', url: 'https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=5' },
        { name: 'silver', metal: 'silver', url: 'https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=2' },
        { name: 'gold jewellery', metal: 'gold', url: 'https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=1' },
      ],
    },

    // Suomen Panttilaina: four offices, each auctions every two weeks, lots close from 19:00
    panttilaina: {
      enabled: true,
      // metal: what every lot of the list is (the site has no per-lot metal field).
      // url: the old site (Huutokauppa 1.0, in use until 2 Nov 2026).
      // newSiteUrl: the new site (Huutokauppa 2.0). Both are read and merged; a lot in two lists counts once.
      // Each lot goes to coins & bars or junk by its own text (spec 05).
      lists: [
        {
          name: 'gold / other (coins, bars)', metal: 'gold',
          url: 'https://www.suomenpanttilaina.fi/huutokauppa/?product_category=1&product_sub_category=8',
          newSiteUrl: 'https://shop.suomenpanttilaina.fi/auction?SelectedProductSubCategories=8',
        },
        {
          name: 'silver / other (coins)', metal: 'silver',
          url: 'https://www.suomenpanttilaina.fi/huutokauppa/?product_category=3&product_sub_category=21',
          newSiteUrl: 'https://shop.suomenpanttilaina.fi/auction?SelectedProductSubCategories=21',
        },
        {
          name: 'silver / cutlery', metal: 'silver',
          url: 'https://www.suomenpanttilaina.fi/huutokauppa/?product_category=3&product_sub_category=14',
          newSiteUrl: 'https://shop.suomenpanttilaina.fi/auction?SelectedProductSubCategories=14',
        },
        {
          name: 'gold, all', metal: 'gold',
          url: 'https://www.suomenpanttilaina.fi/huutokauppa/?product_category=1&product_sub_category=',
          newSiteUrl: 'https://shop.suomenpanttilaina.fi/auction?SelectedProductCategories=1',
        },
      ],
      // One warning when no lots at all were found for this many days (the site may have changed)
      warnAfterDaysWithoutLots: 7,
    },
  },

  // ── Web requests ──────────────────────────────────────────────────────────
  // Pause between requests to the same site, time limit, and waits before retrying
  requestDelayMs: 1000,
  requestTimeoutMs: 30000,
  retryDelaysMs: [5000, 15000],
};
