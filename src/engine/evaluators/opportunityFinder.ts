
export function findOpportunities(pools) {
  const opps = [];

  for (const tokenPair of pools) {
    const dexes = tokenPair.dexes;

    if (dexes.length < 2) continue;

    dexes.sort((a, b) => b.price - a.price);

    const sell = dexes[0];
    const buy = dexes[dexes.length - 1];

    const spread = (sell.price - buy.price) / buy.price;

    if (spread > 0.005) {
      opps.push({
        tokenA: tokenPair.tokenA,
        tokenB: tokenPair.tokenB,
        buyDex: buy,
        sellDex: sell,
        spread
      });
    }
  }

  return opps;
}
