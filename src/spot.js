// Gold and silver spot in euros: gold-api.com (USD per troy ounce, no key) × the ECB rate.

const { get } = require('./http');

const OZ = 31.1035;

async function getSpot() {
  const [xau, xag, fx] = await Promise.all([
    get('https://api.gold-api.com/price/XAU', { json: true }),
    get('https://api.gold-api.com/price/XAG', { json: true }),
    get('https://api.frankfurter.dev/v1/latest?from=USD&to=EUR', { json: true }),
  ]);
  const usdEur = fx?.rates?.EUR;
  if (!(xau?.price > 0) || !(xag?.price > 0) || !(usdEur > 0)) throw new Error('Spot price feed returned no price');
  return {
    gold: { eurOz: xau.price * usdEur, eurG: (xau.price * usdEur) / OZ },
    silver: { eurOz: xag.price * usdEur, eurG: (xag.price * usdEur) / OZ },
    usdEur, at: new Date().toISOString(),
  };
}

module.exports = { getSpot, OZ };
