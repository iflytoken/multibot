
export async function discoverTokens(factories, provider) {
  const tokens = new Set();

  for (const f of factories) {
    const factory = new ethers.Contract(f.factory, FACTORY_ABI, provider);
    const length = await factory.allPairsLength();

    for (let i = 0; i < length; i++) {
      const pairAddr = await factory.allPairs(i);
      const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);

      const t0 = await pair.token0();
      const t1 = await pair.token1();

      tokens.add(t0);
      tokens.add(t1);
    }
  }

  return [...tokens];
}
