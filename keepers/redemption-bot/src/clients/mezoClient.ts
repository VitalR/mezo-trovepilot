import {
  Address,
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { BotConfig } from '../config.js';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000' as Address;

export function buildClients(config: BotConfig) {
  const publicTransport = http(config.rpcUrl);
  const chain =
    config.chainId !== undefined
      ? defineChain({
          id: config.chainId,
          name: process.env.NETWORK ?? 'mezo',
          nativeCurrency: { name: 'BTC', symbol: 'BTC', decimals: 18 },
          rpcUrls: {
            default: {
              http: [config.rpcUrl].filter((u) => u && u.length > 0),
            },
          },
        })
      : undefined;
  const publicClient = createPublicClient({ transport: publicTransport, chain });

  // MVP signer approach:
  // - Default: local hot key (KEEPER_PRIVATE_KEY).
  // - Optional: unlocked RPC with keeper address (UNLOCKED_RPC_URL) that supports eth_sendTransaction.
  const hasPrivateKey = config.privateKey && config.privateKey.length > 2;
  if (hasPrivateKey) {
    const acct = privateKeyToAccount(config.privateKey);
    const walletClient = createWalletClient({
      transport: publicTransport,
      chain,
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
      chain,
      account: unlockedAccount,
    });
    return { publicClient, walletClient, account: unlockedAccount.address };
  }

  // DRY_RUN can be used in read-only mode (no signer); return a wallet client
  // without an account. Any tx attempts will fail upstream because dryRun=true.
  if (config.dryRun) {
    const walletClient = createWalletClient({
      transport: publicTransport,
      chain,
    });
    return {
      publicClient,
      walletClient,
      account: config.keeperAddress ?? ZERO_ADDRESS,
    };
  }

  throw new Error(
    'No signer configured; set KEEPER_PRIVATE_KEY or UNLOCKED_RPC_URL + KEEPER_ADDRESS'
  );
}

export type PublicClient = ReturnType<typeof createPublicClient>;
export type WalletClient = ReturnType<typeof createWalletClient>;
export type Account = ReturnType<typeof privateKeyToAccount>;
