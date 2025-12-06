export function buildArbPlan(opp, bestAmount, beneficiary) {
  return {
    loanToken: opp.tokenA,
    loanAmount: bestAmount,
    minProfit: 0,
    beneficiary,
    steps: [
      {
        router: opp.buyDex.router,
        path: [opp.tokenA, opp.tokenB],
        amountIn: bestAmount,
        minOut: 1
      },
      {
        router: opp.sellDex.router,
        path: [opp.tokenB, opp.tokenA],
        amountIn: 0,         // filled in callback
        minOut: 1
      }
    ]
  };
}

