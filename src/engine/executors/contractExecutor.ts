
import { ethers } from "ethers";
import ArbExecutorABI from "../../abi/ArbExecutor.json";

export async function executePlan(plan, provider, privateKey, contractAddress) {
  const signer = new ethers.Wallet(privateKey, provider);
  const contract = new ethers.Contract(contractAddress, ArbExecutorABI, signer);

  const tx = await contract.executeArb(plan);
  return tx.wait();
}
