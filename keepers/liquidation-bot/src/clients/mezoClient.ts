import { Address, createPublicClient, createWalletClient, http } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BotConfig } from '../config.js';

export function buildClients(config: BotConfig) {
  const publicTransport = http(config.rpcUrl);
  const publicClient = createPublicClient({ transport: publicTransport });

  // MVP signer approach:
  // - Default: local hot key (KEEPER_PRIVATE_KEY).
  // - Optional: unlocked RPC with keeper address (UNLOCKED_RPC_URL) that supports eth_sendTransaction.
  const hasPrivateKey = config.privateKey && config.privateKey.length > 2;
  if (hasPrivateKey) {
    const acct = privateKeyToAccount(config.privateKey);
    const walletClient = createWalletClient({
      transport: publicTransport,
      account: acct,
    });
    return { publicClient, walletClient, account: acct.address as Address };
  }

  if (config.unlockedRpcUrl && config.keeperAddress) {
    const unlockedAccount = {
      address: config.keeperAddress,
      type: 'json-rpc' as const,
    };
    const walletClient = createWalletClient({
      transport: http(config.unlockedRpcUrl),
      account: unlockedAccount,
    });
    return { publicClient, walletClient, account: unlockedAccount.address };
  }

  throw new Error(
    'No signer configured; set KEEPER_PRIVATE_KEY or UNLOCKED_RPC_URL + KEEPER_ADDRESS'
  );
}

export type PublicClient = ReturnType<typeof createPublicClient>;
export type WalletClient = ReturnType<typeof createWalletClient>;
export type Account = ReturnType<typeof privateKeyToAccount>;
