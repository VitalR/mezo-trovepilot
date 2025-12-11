import { Address, createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BotConfig } from '../config.js';

export function buildClients(config: BotConfig) {
  const account = privateKeyToAccount(config.privateKey);
  const transport = http(config.rpcUrl);

  const publicClient = createPublicClient({
    transport,
  });

  const walletClient = createWalletClient({
    transport,
    account,
  });

  return { publicClient, walletClient, account };
}

export type PublicClient = ReturnType<typeof createPublicClient>;
export type WalletClient = ReturnType<typeof createWalletClient>;
export type Account = ReturnType<typeof privateKeyToAccount>;
