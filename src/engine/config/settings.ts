// src/config/settings.ts

export const SETTINGS = {
  // Minimum pool liquidity to consider (USD-approx)
  MIN_LIQ_USD: 5000,

  // Max allowed slippage per hop (in basis points; 50 = 0.5%)
  MAX_SLIPPAGE_BPS: 50,

  // Max age of pool reserves before we consider them stale (seconds)
  STALE_SECONDS: 600, // 10 minutes

  // Minimum USD profit threshold (for off-chain filtering)
  MIN_PROFIT_USD: 1,

  // Safety limit on token universe if you want to cap it
  MAX_TOKENS: 200,

  // Default RPC batch size
  RPC_BATCH: 50
};
