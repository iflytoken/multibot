// src/engine/executors/nonceManager.ts

import { ethers } from "ethers";

/**
 * Nonce Manager for high-frequency transaction bots.
 * Avoids "nonce too low" and "replacement transaction underpriced" errors.
 */
export class SafeNonceManager {
  private provider: ethers.Provider;
  private wallet: ethers.Wallet;
  private lastKnownNonce: number | null = null;
  private ready: Promise<void>;

  constructor(provider: ethers.Provider, privateKey: string) {
    this.provider = provider;
    this.wallet = new ethers.Wallet(privateKey, provider);
    this.ready = this.initialize();
  }

  private async initialize() {
    this.lastKnownNonce = await this.provider.getTransactionCount(
      this.wallet.address,
      "latest"
    );
  }

  async waitReady() {
    return this.ready;
  }

  /**
   * Returns the next safe nonce.
   * If pending transactions exist, bumps to the next available slot.
   */
  async getNextNonce(): Promise<number> {
    await this.waitReady();

    const networkNonce = await this.provider.getTransactionCount(
      this.wallet.address,
      "pending"
    );

    if (this.lastKnownNonce === null || networkNonce > this.lastKnownNonce) {
      this.lastKnownNonce = networkNonce;
    }

    const next = this.lastKnownNonce;
    this.lastKnownNonce = next + 1;

    return next;
  }

  /**
   * Returns a signer using the SafeNonceManager.
   */
  async getSigner() {
    const nonce = await this.getNextNonce();
    return this.wallet.connect(this.provider).populateTransaction({ nonce });
  }
}
