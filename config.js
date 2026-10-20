// Pantti auctions Finland: settings. Specs: specs/01–04. The README explains each one.

module.exports = {
  // ── Your limits ───────────────────────────────────────────────────────────
  // The most you will bid, as a share of the lot's metal value at today's spot price:
  // gold at most 5 % above it, silver at most 3 % above it (owner, 21 Oct 2026)
  maxOverSpot: { gold: 1.05, silver: 1.03 },

  // br / BR = gross weight (the lot holds other material too): the share of it counted as silver.
  // Gross-weight gold is always "check by hand".
  brSilverShare: 0.30,

  // ── When your phone gets a message ────────────────────────────────────────
  notify: {
    // Once, when an auction is first listed (lots added later: only if one is under your limit)
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
      lists: [
        { name: 'coins & medals', url: 'https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=5' },
        { name: 'silver', url: 'https://huutokauppa.pantti.fi/huutokauppa/{auction}/?category=2' },
      ],
    },

    // Suomen Panttilaina: four offices, each auctions every two weeks, lots close from 19:00
    panttilaina: {
      enabled: true,
      // metal: what every lot of the list is (the site has no per-lot metal field).
      // url: the old site (Huutokauppa 1.0, in use until 2 Nov 2026).
      // newSiteUrl: the new site (Huutokauppa 2.0). Both are read and merged.
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
