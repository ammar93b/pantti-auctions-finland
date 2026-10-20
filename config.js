// Helsingin Pantti agent: settings. Specs: specs/01–03.

module.exports = {
  // Auction 966 opened on Friday 16.10.2026 at 17:00 (Helsinki). Each week the number goes up by one.
  // If Pantti ever skips a week, set this to any recent auction and its Friday.
  reference: { auction: 966, friday: '2026-10-16' },

  // The two lists per auction: category 5 = coins and medals, category 2 = silver
  categories: { coins: 5, silver: 2 },

  // The most you will bid, as a share of the metal value:
  // coins at most 10 % above it, silver never above it
  capOverMetal: { coins: 1.10, silver: 1.00 },

  // BR = gross weight (the lot holds other material too): the share of it counted as silver
  brSilverShare: 0.35,

  // Run times, Helsinki time (the scheduler starts the agent at these; later ones are retries)
  schedule: {
    friday: ['17:00', '17:30', '18:30', '19:30'],
    tuesday: ['17:00', '17:15', '17:30', '17:45'],
  },

  // The Friday list is only sent this long after the auction opens (later it is out of date)
  announceWindowHours: 3,

  // Web requests: pause between requests to Pantti, time limit, and waits before retrying
  requestDelayMs: 1000,
  requestTimeoutMs: 30000,
  retryDelaysMs: [5000, 15000],
};
