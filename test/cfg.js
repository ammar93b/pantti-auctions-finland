// A fixed configuration for the tests: the owner's real limits live in .env and must not
// change test results. Example limits: coins up to +5 %, junk 🟢 at −5 % and never above metal.

const CFG = require('../config');

module.exports = {
  ...CFG,
  categories: {
    goldCoins: { ...CFG.categories.goldCoins, maxPct: 5, alertPct: 5 },
    silverCoins: { ...CFG.categories.silverCoins, maxPct: 5, alertPct: 5 },
    junkGold: { ...CFG.categories.junkGold, maxPct: 0, alertPct: -5 },
    junkSilver: { ...CFG.categories.junkSilver, maxPct: 0, alertPct: -5 },
  },
  minMetalEur: 30,
};
