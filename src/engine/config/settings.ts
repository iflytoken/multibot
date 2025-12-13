// src/config/settings.ts

/**
 * Global engine settings for scanning, risk control, loan sizing,
 * gas modeling, and execution behavior.
 *
 * This file merges:
 *  - Original baseline settings
 *  - Step 6.1 (Risk controls: slippage, stale reserves)
 *  - Step 6.2 (Gas cost modeling, net profit filters)
 */

export const SETTINGS = {
  // --------------------------------------------------
  // ORIGINAL BASELINE CONFIG
  // --------------------------------------------------

  // Liquidity threshold (USD estimate).
  // Pools below this value are ignored.
  MIN_LIQ_USD: 20000,

  // RPC batching size
  RPC_BATCH: 75,

  // Whether multi-hop (triangular) arbitrage is enabled
  ENABLE_TRI: true,

  // Minimum USD profit required before considering execution
  MIN_PROFIT_USD: 1,


  // --------------------------------------------------
  // STEP 6.1 — RISK CONTROL SETTINGS (NEW)
  // --------------------------------------------------

  /**
   * Maximum slippage per hop (in basis points).
   * Example:
   *   50 = 0.50%
   *   100 = 1.00%
   */
  MAX_SLIPPAGE_BPS: 50,

  /**
   * How long a pool's reserves can remain untouched before we consider
   * the liquidity stale and unsafe.
   *
   * If "blockTimestampLast" is older than STALE_SECONDS:
   *    → pool is ignored entirely.
   */
  STALE_SECONDS: 600, // 10 minutes

  /**
   * Maximum number of tokens we allow in the universe.
   * Prevents explosion of triangular path generation.
   */
  MAX_TOKENS: 200,


  // --------------------------------------------------
  // STEP 6.2 — GAS MODEL SETTINGS (NEW)
  // --------------------------------------------------

  /**
   * Trades must exceed the gas cost multiplied by this multiplier.
   *
   * Example:
   *   GAS_RISK_MULTIPLIER = 1.2 → profit must exceed 120% of gas cost
   */
  GAS_RISK_MULTIPLIER: 1.20,

  /**
   * Fallback gas limit (in case gas estimation fails).
   */
  DEFAULT_GAS_LIMIT: 450000,

  /**
   * Token -> USD price map
   * Used for estimating profit and gas cost in USD.
   * Replace these with an oracle later.
   */
  USD_PRICE_MAP: {
    WBNB: 580,
    BUSD: 1,
    USDT: 1,
    USDC: 1,
    CAKE: 3,
    ETH: 3400,
    BTCB: 65000
  }
};
