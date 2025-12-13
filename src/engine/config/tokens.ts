// src/engine/config/tokens.ts

export interface TokenConfig {
    symbol: string;
    address: string;
    decimals: number;
}

// ------------------------------------------------------
// 1. SEED TOKENS – our static, safe, core token universe
// ------------------------------------------------------
export const SEED_TOKENS: TokenConfig[] = [
    {
        symbol: "WBNB",
        address: "0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c",
        decimals: 18
    },
    {
        symbol: "BUSD",
        address: "0xe9e7cea3dedca5984780bafc599bd69add087d56",
        decimals: 18
    },
    {
        symbol: "USDT",
        address: "0x55d398326f99059ff775485246999027b3197955",
        decimals: 18
    },
    {
        symbol: "USDC",
        address: "0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d",
        decimals: 18
    },
    {
        symbol: "CAKE",
        address: "0x0e09fabb73bd3ade0a17ecc321fd13a19e81ce82",
        decimals: 18
    }
];

// ------------------------------------------------------
// 2. DYNAMIC TOKENS – empty for now, but can be discovered later
// ------------------------------------------------------
let dynamicTokens: TokenConfig[] = [];

// ------------------------------------------------------
// 3. HYBRID GETTER
//    Combines seed + dynamic, removes duplicates by address
// ------------------------------------------------------
export function getTokensHybrid(): TokenConfig[] {
    const merged = [...SEED_TOKENS, ...dynamicTokens];

    const deduped = merged.reduce((acc, token) => {
        const key = token.address.toLowerCase();
        if (!acc.map.has(key)) {
            acc.map.set(key, true);
            acc.list.push(token);
        }
        return acc;
    }, { list: [] as TokenConfig[], map: new Map<string, boolean>() });

    return deduped.list;
}

// ------------------------------------------------------
// 4. Allow dynamic token injection later (optional)
// ------------------------------------------------------
export function addDynamicToken(token: TokenConfig) {
    dynamicTokens.push({
        ...token,
        address: token.address.toLowerCase()
    });
}
