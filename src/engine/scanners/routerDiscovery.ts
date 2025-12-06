
import { ROUTERS } from "../../config/routers";
import { ethers } from "ethers";
import { FACTORY_ABI, ROUTER_ABI } from "../../constants";

export async function discoverFactories(provider: ethers.Provider) {
  const results = [];

  for (const r of ROUTERS) {
    try {
      const router = new ethers.Contract(r.address, ROUTER_ABI, provider);
      const factory = await router.factory();

      results.push({
        name: r.name,
        router: r.address,
        factory
      });

    } catch (err) {
      console.warn(`Failed to load router ${r.name}: ${err}`);
    }
  }

  return results;
}
