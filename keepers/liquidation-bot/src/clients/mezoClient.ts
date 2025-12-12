import { Address, createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BotConfig } from '../config.js';

export function buildClients(config: BotConfig) {
  const publicTransport = http(config.rpcUrl);

  const publicClient = createPublicClient({ transport: publicTransport });

  let account: Address;
  let walletTransport = publicTransport;
  let walletClient;

  if (config.externalSignerUrl && config.keeperAddress) {
    account = config.keeperAddress;
    walletTransport = http(config.externalSignerUrl);
    walletClient = createWalletClient({
      transport: walletTransport,
      account,
    });
  } else {
    const acct = privateKeyToAccount(config.privateKey);
    account = acct.address as Address;
    walletClient = createWalletClient({
      transport: walletTransport,
      account: acct,
    });
  }

  return { publicClient, walletClient, account };
}

export type PublicClient = ReturnType<typeof createPublicClient>;
export type WalletClient = ReturnType<typeof createWalletClient>;
export type Account = ReturnType<typeof privateKeyToAccount>;
