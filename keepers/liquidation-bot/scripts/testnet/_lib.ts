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

export function parseAddressList(params: {
  name: string;
  raw: string | undefined;
  allowEmpty?: boolean;
}): Address[] {
  const { name, raw, allowEmpty = false } = params;
  if (!raw || raw.trim() === '') return allowEmpty ? [] : [];
  const parts = raw
    .split(/[\s,]+/g)
    .map((s) => s.trim())
    .filter(Boolean);
  const out: Address[] = [];
  for (const p of parts) {
    if (!isAddress(p)) {
      throw new Error(`Invalid address in ${name}: ${p}`);
    }
    if (p === '0x0000000000000000000000000000000000000000') continue;
    out.push(p as Address);
  }
  if (!allowEmpty && out.length === 0) {
    // Keep error messaging explicit to avoid silent no-ops when users paste bad lists.
    throw new Error(`No valid addresses provided for ${name}`);
  }
  return out;
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
    tokens?: {
      musd?: Address;
    };
    price: {
      priceFeed: Address;
    };
  };
  trovePilot: {
    /**
     * Canonical unified wrapper address (TrovePilotEngine).
     * Prefer this over legacy `liquidationEngine`.
     */
    trovePilotEngine: Address;
    /**
     * Deprecated legacy name kept for older config files.
     */
    liquidationEngine?: Address;
  };
};

export function resolveDefaultConfigPath(): string {
  // npm scripts run with CWD = keepers/liquidation-bot
  return path.resolve(process.cwd(), '../../configs/addresses.testnet.json');
}

export function loadAddressBook(): AddressBook {
  const configPath = process.env.CONFIG_PATH ?? resolveDefaultConfigPath();
  const resolved = path.resolve(process.cwd(), configPath);
  const json = readJsonFile<any>(resolved);

  // Optional explicit overrides to avoid accidental cross-wiring when deployments move.
  // These are still gated by NETWORK/chainId checks.
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
  const envTrovePilotEngine = envAddressOrUndef('TROVE_PILOT_ENGINE_ADDRESS');
  const envLiquidationEngine = envAddressOrUndef('LIQUIDATION_ENGINE_ADDRESS'); // deprecated alias

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
        ? {
            musd: requireAddress('mezo.tokens.musd', json.mezo?.tokens?.musd),
          }
        : undefined,
      price: {
        priceFeed: requireAddress(
          'mezo.price.priceFeed',
          envPriceFeed ?? json.mezo?.price?.priceFeed
        ),
      },
    },
    trovePilot: {
      trovePilotEngine: requireAddress(
        'trovePilot.trovePilotEngine',
        envTrovePilotEngine ??
          envLiquidationEngine ??
          json.trovePilot?.trovePilotEngine ??
          json.trovePilot?.liquidationEngine
      ),
      liquidationEngine: json.trovePilot?.liquidationEngine
        ? requireAddress('trovePilot.liquidationEngine', json.trovePilot?.liquidationEngine)
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

export async function assertTestnet(client: PublicClient, book: AddressBook) {
  const envNetwork = process.env.NETWORK ?? book.network ?? 'unknown';
  if (!envNetwork.toLowerCase().includes('testnet')) {
    throw new Error(
      `Refusing to run: NETWORK is not a testnet (${envNetwork})`
    );
  }

  const chainId = await client.getChainId();
  if (book.chainId && chainId !== book.chainId) {
    throw new Error(
      `Refusing to run: chainId mismatch (rpc=${chainId}, config=${book.chainId})`
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
    component: 'testnet',
    runId,
    keeper: params.keeper,
    network: params.network ?? process.env.NETWORK ?? 'mezo-testnet',
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
