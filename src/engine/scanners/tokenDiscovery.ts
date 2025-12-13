// src/engine/scanners/tokenDiscovery.ts

import { ethers } from "ethers";
import { ROUTERS } from "../config/routers";

// Minimal ABI fragments
const FACTORY_ABI = [
  "function allPairsLength() external view returns (uint256)",
  "function allPairs(uint256) external view returns (address)"
];

const PAIR_ABI = [
  "function token0() external view returns (address)",
  "function token1() external view returns (address)"
];

export async function discoverTokens(provider: ethers.JsonRpcProvider) {
  const tokens = new Set<string>();

  for (const dex of ROUTERS) {
    try {
      const factory = new ethers.Contract(
        dex.factory,
        FACTORY_ABI,
        provider
      );

      const length: bigint = await factory.allPairsLength();

      for (let i = 0n; i < length; i++) {
        const pairAddr = await factory.allPairs(i);
        const pair = new ethers.Contract(pairAddr, PAIR_ABI, provider);

        let t0 = await pair.token0();
        let t1 = await pair.token1();

        // Force lowercase → required for ethers v6 checksum rules
        t0 = t0.toLowerCase();
        t1 = t1.toLowerCase();

        tokens.add(t0);
        tokens.add(t1);
      }
    } catch (err) {
      console.warn(`Token discovery failed on ${dex.name}:`, err);
    }
  }

  return [...tokens];
}
