import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  Address,
  createPublicClient,
  http,
  isAddress,
  PublicClient,
  webSocket,
} from 'viem';
import { log, setLogContext } from '../../src/core/logging.js';

export const MEZO_MAINNET_CHAIN_ID = 31612;

export type Args = Record<string, string | boolean>;

export function parseArgs(argv = process.argv.slice(2)): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!;
    if (!a.startsWith('--')) continue;
    const raw = a.slice(2);
    const eq = raw.indexOf('=');
    if (eq >= 0) {
      const k = raw.slice(0, eq);
      const v = raw.slice(eq + 1);
      out[k] = v;
      continue;
    }
    // --flag or --key value
    const next = argv[i + 1];
    if (next && !next.startsWith('--')) {
      out[raw] = next;
      i++;
    } else {
      out[raw] = true;
    }
  }
  return out;
}

export function argString(args: Args, key: string): string | undefined {
  const v = args[key];
  if (v === undefined || v === false) return undefined;
  if (v === true) return 'true';
  return String(v);
}

export function argBool(args: Args, key: string): boolean | undefined {
  const v = args[key];
  if (v === undefined) return undefined;
  if (v === true) return true;
  if (v === false) return false;
  const s = String(v).toLowerCase();
  if (s === 'true' || s === '1' || s === 'yes') return true;
  if (s === 'false' || s === '0' || s === 'no') return false;
  throw new Error(`Invalid boolean for --${key}: ${String(v)}`);
}

export function argNumber(args: Args, key: string): number | undefined {
  const s = argString(args, key);
  if (s === undefined) return undefined;
  const n = Number(s);
  if (!Number.isFinite(n)) throw new Error(`Invalid number for --${key}: ${s}`);
  return n;
}

export function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required env: ${name}`);
  return v;
}

export function scriptPaths() {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const stateDir = path.join(here, '.state');
  const latest = path.join(stateDir, 'latest.json');
  const runsDir = path.join(stateDir, 'runs');
  return { here, stateDir, runsDir, latest };
}

export function ensureStateDir() {
  const { stateDir } = scriptPaths();
  fs.mkdirSync(stateDir, { recursive: true });
  return stateDir;
}

export function ensureRunsDir() {
  const { runsDir } = scriptPaths();
  fs.mkdirSync(runsDir, { recursive: true });
  return runsDir;
}

export function readJsonFile<T>(filePath: string): T {
  const raw = fs.readFileSync(filePath, 'utf8');
  return JSON.parse(raw) as T;
}

export function writeJsonFile(filePath: string, data: unknown) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${filePath}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2) + '\n', 'utf8');
  fs.renameSync(tmp, filePath);
}

/**
 * Persist state in two forms:
 * - `latest.json` (always overwritten)
 * - an append-only snapshot under `.state/runs/` (never overwritten)
 *
 * Optionally also writes to `stateFile` if it is not `latest.json`.
 */
export function writeStateWithHistory(params: {
  stateFile: string;
  latestFile: string;
  snapshotPrefix: string;
  data: unknown;
}) {
  const { stateFile, latestFile, snapshotPrefix, data } = params;
  writeJsonFile(latestFile, data);
  if (stateFile !== latestFile) {
    writeJsonFile(stateFile, data);
  }
  const dir = ensureRunsDir();
  const ts = Date.now();
  const safePrefix = snapshotPrefix.replace(/[^a-zA-Z0-9_.-]+/g, '_');
  const snap = path.join(dir, `${safePrefix}_${ts}.json`);
  writeJsonFile(snap, data);
  return snap;
}

export function requireAddress(name: string, v: unknown): Address {
  if (typeof v !== 'string' || !isAddress(v)) {
    throw new Error(`Invalid address for ${name}`);
  }
  return v as Address;
}

export type AddressBook = {
  chainId: number;
  network: string;
  mezo: {
    core: {
      troveManager: Address;
      sortedTroves: Address;
      hintHelpers: Address;
      borrowerOperations: Address;
    };
    tokens?: { musd?: Address };
    price: { priceFeed: Address };
  };
  trovePilot: { liquidationEngine: Address; redemptionRouter?: Address };
};

export function resolveDefaultConfigPath(): string {
  // npm scripts run with CWD = keepers/liquidation-bot
  return path.resolve(process.cwd(), '../../configs/addresses.mainnet.json');
}

export function loadAddressBook(): AddressBook {
  const configPath = process.env.CONFIG_PATH ?? resolveDefaultConfigPath();
  const resolved = path.resolve(process.cwd(), configPath);
  const json = readJsonFile<any>(resolved);

  // Keep the override surface consistent with testnet scripts (still gated by chainId checks).
  const envAddressOrUndef = (name: string): Address | undefined => {
    const raw = process.env[name];
    if (!raw || raw === '0') return undefined;
    if (!isAddress(raw)) {
      log.warn(`Ignoring invalid ${name} override: ${raw}`);
      return undefined;
    }
    if (raw === '0x0000000000000000000000000000000000000000') return undefined;
    return raw as Address;
  };

  const envBorrowerOperations = envAddressOrUndef(
    'BORROWER_OPERATIONS_ADDRESS'
  );
  const envHintHelpers = envAddressOrUndef('HINT_HELPERS_ADDRESS');
  const envSortedTroves = envAddressOrUndef('SORTED_TROVES_ADDRESS');
  const envTroveManager = envAddressOrUndef('TROVE_MANAGER_ADDRESS');
  const envPriceFeed = envAddressOrUndef('PRICE_FEED_ADDRESS');
  const envLiquidationEngine = envAddressOrUndef('LIQUIDATION_ENGINE_ADDRESS');

  return {
    chainId: Number(json.chainId),
    network: String(json.network),
    mezo: {
      core: {
        troveManager: requireAddress(
          'mezo.core.troveManager',
          envTroveManager ?? json.mezo?.core?.troveManager
        ),
        sortedTroves: requireAddress(
          'mezo.core.sortedTroves',
          envSortedTroves ?? json.mezo?.core?.sortedTroves
        ),
        hintHelpers: requireAddress(
          'mezo.core.hintHelpers',
          envHintHelpers ?? json.mezo?.core?.hintHelpers
        ),
        borrowerOperations: requireAddress(
          'mezo.core.borrowerOperations',
          envBorrowerOperations ?? json.mezo?.core?.borrowerOperations
        ),
      },
      tokens: json.mezo?.tokens?.musd
        ? { musd: requireAddress('mezo.tokens.musd', json.mezo?.tokens?.musd) }
        : undefined,
      price: {
        priceFeed: requireAddress(
          'mezo.price.priceFeed',
          envPriceFeed ?? json.mezo?.price?.priceFeed
        ),
      },
    },
    trovePilot: {
      liquidationEngine: requireAddress(
        'trovePilot.liquidationEngine',
        envLiquidationEngine ?? json.trovePilot?.liquidationEngine
      ),
      redemptionRouter: json.trovePilot?.redemptionRouter
        ? requireAddress(
            'trovePilot.redemptionRouter',
            json.trovePilot?.redemptionRouter
          )
        : undefined,
    },
  };
}

export function buildPublicClient(rpcUrl: string): PublicClient {
  const timeout =
    process.env.RPC_TIMEOUT_MS && Number(process.env.RPC_TIMEOUT_MS) > 0
      ? Number(process.env.RPC_TIMEOUT_MS)
      : 60_000;
  const retryCount =
    process.env.RPC_RETRY_COUNT && Number(process.env.RPC_RETRY_COUNT) >= 0
      ? Number(process.env.RPC_RETRY_COUNT)
      : 2;
  const retryDelay =
    process.env.RPC_RETRY_DELAY_MS &&
    Number(process.env.RPC_RETRY_DELAY_MS) >= 0
      ? Number(process.env.RPC_RETRY_DELAY_MS)
      : 250;

  const url = rpcUrl.trim();
  const transport =
    url.startsWith('ws://') || url.startsWith('wss://')
      ? webSocket(url, { retryCount, retryDelay })
      : http(url, { timeout, retryCount, retryDelay });

  return createPublicClient({ transport });
}

function parseRpcUrlList(raw: string | undefined): string[] {
  if (!raw) return [];
  // Accept comma-separated and/or whitespace-separated lists.
  return raw
    .split(/[\s,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Returns candidate Mezo mainnet RPC URLs. If the user provides
 * `MEZO_RPC_URL_MAINNET` as a list, we try them in order. Otherwise we fall back
 * to `rpc.mezo.org` (docs) + several known public endpoints.
 *
 * Note: this is best-effort ergonomics. For production keepers, use a dedicated
 * RPC provider with stable DNS + rate limits.
 */
export function getMainnetRpcCandidates(): string[] {
  const user = parseRpcUrlList(process.env.MEZO_RPC_URL_MAINNET);
  if (user.length > 0) return user;
  // Official docs default (may be unreachable under some DNS resolvers).
  return [
    'https://rpc.mezo.org',
    'wss://rpc.mezo.org/websocket',
    // Known public endpoints from ecosystem providers.
    'https://rpc-http.mezo.boar.network',
    'wss://rpc-ws.mezo.boar.network',
    'https://rpc_evm-mezo.imperator.co',
    'wss://ws_evm-mezo.imperator.co',
    'https://mainnet.mezo.public.validationcloud.io',
    'wss://mainnet.mezo.public.validationcloud.io',
  ];
}

export async function selectMainnetRpcUrl(params?: {
  candidates?: string[];
  book?: AddressBook;
}): Promise<string> {
  const candidates = params?.candidates ?? getMainnetRpcCandidates();
  let lastErr: unknown;
  for (const url of candidates) {
    try {
      const c = buildPublicClient(url);
      await assertMainnet(c, { book: params?.book, rpcUrl: url });
      return url;
    } catch (err) {
      lastErr = err;
      continue;
    }
  }
  const tried = candidates.join(', ');
  const lastMsg = (lastErr as any)?.message
    ? String((lastErr as any).message)
    : String(lastErr);
  throw new Error(
    `No reachable mainnet RPC endpoints. Tried: ${tried}\n\nLast error: ${lastMsg}`
  );
}

export async function assertMainnet(
  client: PublicClient,
  params?: { book?: AddressBook; rpcUrl?: string }
) {
  const envNetwork = process.env.NETWORK ?? 'mezo-mainnet';
  if (envNetwork.toLowerCase().includes('testnet')) {
    throw new Error(
      `Refusing to run mainnet script with NETWORK=${envNetwork}`
    );
  }

  let chainId: number;
  try {
    chainId = await client.getChainId();
  } catch (err: any) {
    const msg = String(err?.message ?? err);
    const rpcUrl = params?.rpcUrl ?? process.env.MEZO_RPC_URL ?? '(unknown)';
    const hint =
      msg.toLowerCase().includes('fetch failed') ||
      msg.toLowerCase().includes('failed to fetch')
        ? `RPC unreachable (${rpcUrl}). Try:\n` +
          `- curl -sS ${rpcUrl} -H 'content-type: application/json' --data '{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}'\n` +
          `- if curl works but Node doesn't: export NODE_OPTIONS=--dns-result-order=ipv4first\n` +
          `- use a dedicated RPC provider URL (higher stability/rate limits)\n` +
          `- or try a WSS endpoint (set MEZO_RPC_URL_MAINNET=wss://...)`
        : `RPC error while calling eth_chainId (${rpcUrl})`;
    throw new Error(`${hint}\n\nOriginal error: ${msg}`);
  }
  if (chainId !== MEZO_MAINNET_CHAIN_ID) {
    throw new Error(
      `Refusing to run: expected mezo mainnet chainId=${MEZO_MAINNET_CHAIN_ID}, got ${chainId}`
    );
  }
  if (params?.book?.chainId && chainId !== params.book.chainId) {
    throw new Error(
      `Refusing to run: chainId mismatch (rpc=${chainId}, config=${params.book.chainId})`
    );
  }
}

export function initScriptLogContext(params: {
  script: string;
  keeper?: Address;
  network?: string;
}) {
  const runId = `${Date.now()}-${Math.floor(Math.random() * 1e9)}`;
  setLogContext({
    component: 'mainnet',
    runId,
    keeper: params.keeper,
    network: params.network ?? process.env.NETWORK ?? 'mezo-mainnet',
  });
  log.jsonInfo('script_start', { script: params.script });
  return runId;
}

export function requireConfirm(dryRun: boolean) {
  if (dryRun) return;
  const ok =
    (process.env.CONFIRM ?? '').toLowerCase() === 'true' ||
    (process.env.CONFIRM ?? '') === '1';
  if (!ok) {
    throw new Error(
      'Refusing to send transactions without CONFIRM=true (or run with DRY_RUN=true)'
    );
  }
}

/**
 * Map *_MAINNET env vars to the keeper/bot env vars so we can reuse `src/config.ts`
 * and `src/clients/mezoClient.ts` without duplicating config logic.
 */
export function applyMainnetEnvAliases() {
  // IMPORTANT: mainnet scripts should be runnable even if the user's shell has
  // testnet defaults exported (e.g. NETWORK=mezo-testnet). If *_MAINNET vars are
  // provided, they take precedence and override the base vars.
  const networkMainnet = (process.env.NETWORK_MAINNET ?? '').trim();
  if (networkMainnet) process.env.NETWORK = networkMainnet;
  process.env.NETWORK ??= 'mezo-mainnet';

  const configPathMainnet = (process.env.CONFIG_PATH_MAINNET ?? '').trim();
  if (configPathMainnet) process.env.CONFIG_PATH = configPathMainnet;
  process.env.CONFIG_PATH ??= resolveDefaultConfigPath();

  // Do NOT copy MEZO_RPC_URL_MAINNET into MEZO_RPC_URL here:
  // - MEZO_RPC_URL_MAINNET may be a comma-separated list of fallbacks
  // - scripts will select a working endpoint and then set MEZO_RPC_URL explicitly
  //   to the chosen single URL.

  const pkMainnet = (process.env.KEEPER_PRIVATE_KEY_MAINNET ?? '').trim();
  if (pkMainnet) process.env.KEEPER_PRIVATE_KEY = pkMainnet;
}
