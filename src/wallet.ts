/**
 * On-chain balance lookups for the dashboard wallet panel.
 *
 * Uses `ethers` (already a transitive dependency of @croo-network/sdk) to read
 * Maestro's AA-wallet ETH and USDC balances from Base. Called periodically by
 * the server; failures are non-fatal (the dashboard simply shows "—").
 */
import { JsonRpcProvider, Contract, formatEther } from 'ethers';
import { BASE_USDC_ADDRESS, USDC_DECIMALS, runtime } from './config.js';
import { state } from './state.js';

const ERC20_ABI = ['function balanceOf(address owner) view returns (uint256)'];

export interface Balances {
  ethWei: string;
  usdc: number;
}

export async function fetchBalances(address: string): Promise<Balances> {
  const provider = new JsonRpcProvider(runtime.baseRpcUrl);
  const ethWei = await provider.getBalance(address);
  const usdcContract = new Contract(BASE_USDC_ADDRESS, ERC20_ABI, provider);
  const raw = (await usdcContract.balanceOf(address)) as bigint;
  const usdc = Number(raw) / 10 ** USDC_DECIMALS;
  return { ethWei: ethWei.toString(), usdc };
}

/** Refresh the dashboard wallet snapshot. Safe to call on a timer. */
export async function refreshWallet(): Promise<void> {
  const address = state.wallet.address;
  if (!address) return;
  try {
    const { ethWei, usdc } = await fetchBalances(address);
    state.setWallet({ ethWei, usdc, fetchedAt: Date.now() });
  } catch (err) {
    // Non-fatal: leave the previous snapshot in place.
    console.warn('[maestro] wallet refresh failed:', err instanceof Error ? err.message : err);
  }
}

export { formatEther };
