// src/engine/config/routers.ts

export interface RouterConfig {
    name: string;
    router: string;
    factory: string;
}

/**
 * PancakeSwap V2 Router + Factory — mainnet
 * Important:
 *   - Must be lowercase (to avoid ethers v6 checksum validation)
 *   - Do NOT wrap in .toLowerCase()
 */
export const PANCAKE_ROUTER = "0x10ed43c718714eb63d5aa57b78b54704e256024e";
export const PANCAKE_FACTORY = "0xca143ce32fe78f1f7019d7d551a6402fc5350c73";

export const ROUTERS: RouterConfig[] = [
    {
        name: "PancakeSwap V2",
        router: PANCAKE_ROUTER,
        factory: PANCAKE_FACTORY
    }
];
