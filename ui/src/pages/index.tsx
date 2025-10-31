import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import {
  useAccount,
  useWriteContract,
  useWaitForTransactionReceipt,
} from 'wagmi';
import { createPublicClient, http, formatUnits } from 'viem';
import { mezoTestnet } from '../lib/chains';
import engineAbi from '../lib/abis/LiquidationEngine.json';
import regAbi from '../lib/abis/KeeperRegistry.json';
import pythAbi from '../lib/abis/Pyth.json';
import sortedAbi from '../lib/abis/SortedTroves.json';

const DEMO_DATA = {
  oracleStatus: 'active (111,982)',
  jobs: [
    {
      keeper: '0x8B2dD6238C0e9EDc43f41073cF2254C1Ce9Ff789',
      attempted: 6n,
      executed: 6n,
      gasUsed: 2578900n,
    },
    {
      keeper: '0xA15e5F7C1913c2DdA4374Bb8A2f5a2a6719F0b91',
      attempted: 4n,
      executed: 4n,
      gasUsed: 1884200n,
    },
  ],
  topKeepers: [
    { addr: '0x8B2dD6238C0e9EDc43f41073cF2254C1Ce9Ff789', score: 9850n },
    { addr: '0xA15e5F7C1913c2DdA4374Bb8A2f5a2a6719F0b91', score: 7640n },
    { addr: '0xF5bB53e2280D233b0E2B7C7B8aAc638D0d6C91a1', score: 5340n },
  ],
  stats: [
    {
      label: 'Estimated Gas Saved',
      value: '2.4 BTC (~$96k)',
      note: 'Across 312 automated batches',
      tip: 'Cumulative BTC saved by batching keeper redemptions instead of single-user transactions.',
    },
    {
      label: 'Vaults Automated',
      value: '147',
      note: 'Protecting 42,500 MUSD of collateral',
      tip: 'Number of Troves with active automation policies for top-ups and redemptions.',
    },
    {
      label: 'Keeper Network',
      value: '12 active',
      note: '99.7% uptime over 30 days',
      tip: 'Registered keepers providing coverage, along with their cumulative uptime.',
    },
    {
      label: 'Yield Boost',
      value: '+3.8% APY',
      note: 'Compared to idle MUSD',
      tip: 'Additional APY captured by routing idle balances into the YieldAggregator.',
    },
  ],
} as const;

const DEFAULT_STATS = [
  {
    label: 'Estimated Gas Saved',
    value: '—',
    note: 'Enable Demo Mode to preview expected savings',
    tip: 'Cumulative BTC saved by batching keeper redemptions instead of single-user transactions.',
  },
  {
    label: 'Vaults Automated',
    value: '—',
    note: 'Run the demo script to populate live data',
    tip: 'Number of Troves with active automation policies for top-ups and redemptions.',
  },
  {
    label: 'Keeper Network',
    value: '—',
    note: 'Waiting for keeper registrations',
    tip: 'Registered keepers providing coverage, along with their cumulative uptime.',
  },
  {
    label: 'Yield Boost',
    value: '—',
    note: 'Yield data appears when aggregations run',
    tip: 'Additional APY captured by routing idle balances into the YieldAggregator.',
  },
];

const ENGINE = (process.env.NEXT_PUBLIC_ENGINE || '').toLowerCase();
const VAULT = (process.env.NEXT_PUBLIC_VAULT || '').toLowerCase();
const AGG = (process.env.NEXT_PUBLIC_AGGREGATOR || '').toLowerCase();
const REG = (process.env.NEXT_PUBLIC_REGISTRY || '').toLowerCase();
const ROUTER = (process.env.NEXT_PUBLIC_ROUTER || '').toLowerCase();
const PYTH_CONTRACT = (
  process.env.NEXT_PUBLIC_PYTH_CONTRACT || ''
).toLowerCase();
const PYTH_PRICE_ID = process.env.NEXT_PUBLIC_PYTH_PRICE_ID || '';
const PYTH_MAX_AGE_SECONDS = Number(
  process.env.NEXT_PUBLIC_PYTH_MAX_AGE_SECONDS || '3600'
);
const SORTED_TROVES = (
  process.env.NEXT_PUBLIC_SORTED_TROVES ||
  '0x722E4D24FD6Ff8b0AC679450F3D91294607268fA'
).toLowerCase();
const TROVE_HINT_LIMIT = Number(
  process.env.NEXT_PUBLIC_TROVE_HINT_LIMIT || '6'
);
const TROVE_FALLBACK_RAW = process.env.NEXT_PUBLIC_TROVE_FALLBACK_LIST || '';
type OracleSource = 'skip' | 'pyth';

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

const ACTIVITY_ICON = {
  demo: {
    emoji: '🚀',
    bg: 'linear-gradient(135deg,#ede9fe,#c4b5fd)',
    color: '#312e81',
    title: 'Demo step',
  },
  job: {
    emoji: '⚡',
    bg: 'linear-gradient(135deg,#cffafe,#22d3ee)',
    color: '#0f172a',
    title: 'Keeper job',
  },
  keeper: {
    emoji: '🏅',
    bg: 'linear-gradient(135deg,#dcfce7,#4ade80)',
    color: '#064e3b',
    title: 'Leader highlight',
  },
} as const;

const ORACLE_OPTIONS: { id: OracleSource; label: string; helper: string }[] = [
  { id: 'skip', label: 'Skip', helper: 'Chainlink-style BTC/USD' },
  { id: 'pyth', label: 'Pyth', helper: 'Pyth Network multi-feed' },
];

type PythInfo = {
  price: string;
  conf: string;
  publishTime: number;
  expo: number;
};

type OracleReading = {
  source: OracleSource;
  label: string;
  raw: bigint | null;
  ageSeconds: number | null;
  healthy: boolean;
  fallback?: boolean;
  reason?: string;
};

const formatAge = (seconds: number): string => {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
};

export default function Home() {
  const client = useMemo(
    () =>
      createPublicClient({
        chain: mezoTestnet,
        transport: http(process.env.NEXT_PUBLIC_RPC_URL),
      }),
    []
  );

  const [oracleStatus, setOracleStatus] = useState<string>('checking...');
  const [jobs, setJobs] = useState<any[]>([]);
  const [topKeepers, setTopKeepers] = useState<
    { addr: string; score: bigint }[]
  >([]);
  const [demoMode, setDemoMode] = useState(true);
  const [demoOracleStatus, setDemoOracleStatus] = useState<string>(
    DEMO_DATA.oracleStatus
  );
  const [demoJobs, setDemoJobs] = useState<(typeof DEMO_DATA.jobs)[number][]>(
    () => [...DEMO_DATA.jobs]
  );
  const [demoKeepers, setDemoKeepers] = useState<
    (typeof DEMO_DATA.topKeepers)[number][]
  >(() => [...DEMO_DATA.topKeepers]);
  const [demoEvents, setDemoEvents] = useState<string[]>([]);
  const [isRunningDemo, setIsRunningDemo] = useState(false);
  const demoTimers = useRef<number[]>([]);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [copiedAddr, setCopiedAddr] = useState<string | null>(null);
  const hasPythConfig = Boolean(PYTH_CONTRACT && PYTH_PRICE_ID);
  const envOracleDefault =
    process.env.NEXT_PUBLIC_DEFAULT_ORACLE_SOURCE === 'pyth' && hasPythConfig
      ? 'pyth'
      : 'skip';
  const [oracleSource, setOracleSource] =
    useState<OracleSource>(envOracleDefault);
  const [oracleReading, setOracleReading] = useState<OracleReading | null>(
    null
  );
  const [pythInfo, setPythInfo] = useState<PythInfo | null>(null);
  const [oracleOverride, setOracleOverride] = useState(false);
  const [keeperTrovesInput, setKeeperTrovesInput] = useState('');
  const [keeperTrovesTouched, setKeeperTrovesTouched] = useState(false);
  const [troveSuggestions, setTroveSuggestions] = useState<`0x${string}`[]>([]);
  const [troveHintsLoading, setTroveHintsLoading] = useState(false);
  const [troveHintsError, setTroveHintsError] = useState<string | null>(null);
  const [keeperRetries, setKeeperRetries] = useState(0);
  const [keeperStatus, setKeeperStatus] = useState<{
    message: string;
    tone: 'ok' | 'warn' | 'pending';
  }>();
  const [keeperTxHash, setKeeperTxHash] = useState<`0x${string}` | undefined>();
  const [lastKeeperResult, setLastKeeperResult] = useState<{
    attempted: bigint;
    executed: bigint;
    gasUsed: bigint;
    timestamp: bigint;
  } | null>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('trovepilot-demo-mode');
    if (stored !== null) {
      setDemoMode(stored === 'true');
    }
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const stored = window.localStorage.getItem('trovepilot-oracle-source');
    if (stored === 'pyth' && hasPythConfig) {
      setOracleSource('pyth');
    } else if (stored === 'skip') {
      setOracleSource('skip');
    }
  }, [hasPythConfig]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      'trovepilot-demo-mode',
      demoMode ? 'true' : 'false'
    );
  }, [demoMode]);

  useEffect(() => {
    if (!hasPythConfig && oracleSource === 'pyth') {
      setOracleSource('skip');
    }
  }, [hasPythConfig, oracleSource]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem('trovepilot-oracle-source', oracleSource);
  }, [oracleSource]);

  useEffect(() => {
    if (oracleReading?.healthy || demoMode) {
      setOracleOverride(false);
    }
  }, [oracleReading, demoMode]);

  useEffect(() => {
    return () => {
      demoTimers.current.forEach((timer) => clearTimeout(timer));
    };
  }, []);

  useEffect(() => {
    if (oracleSource !== 'pyth') {
      setPythInfo(null);
    }
  }, [oracleSource]);

  const statusChip = (s: string) => {
    const lower = s.toLowerCase();
    const tone = lower.startsWith('active') ? 'chip--ok' : 'chip--bad';
    return <span className={`chip ${tone}`}>{s}</span>;
  };

  const short = (a?: string) =>
    a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '—';

  const usingDemo = demoMode;
  const displayOracleStatus = usingDemo ? demoOracleStatus : oracleStatus;
  const displayJobs = usingDemo ? demoJobs : jobs;
  const displayKeepers = usingDemo ? demoKeepers : topKeepers;
  const stats = usingDemo ? DEMO_DATA.stats : DEFAULT_STATS;
  const showLiveWarning =
    !demoMode &&
    oracleStatus !== 'checking...' &&
    (!oracleStatus.startsWith('active') ||
      (jobs.length === 0 && topKeepers.length === 0));
  const contractRows = [
    { label: 'LiquidationEngine', address: ENGINE },
    { label: 'VaultManager', address: VAULT },
    { label: 'RedemptionRouter', address: ROUTER },
    { label: 'YieldAggregator', address: AGG },
    { label: 'KeeperRegistry', address: REG },
  ];
  const selectedOracle =
    ORACLE_OPTIONS.find((opt) => opt.id === oracleSource) ?? ORACLE_OPTIONS[0];
  const liveSourceLabel = `Live • ${selectedOracle.label}`;
  const liveSourceDescription =
    oracleSource === 'pyth'
      ? `Primary: Pyth getPriceNoOlderThan (max age ${PYTH_MAX_AGE_SECONDS}s). Fallback to Skip fetchPrice when stale or unavailable.`
      : 'Skip oracle fetchPrice via Chainlink-compatible interface';
  const dataSourceLabel = usingDemo ? 'Demo dataset' : liveSourceLabel;
  const dataSourceDescription = usingDemo
    ? 'Simulated metrics while Mezo oracle is inactive.'
    : liveSourceDescription;
  const oracleChoices = hasPythConfig
    ? ORACLE_OPTIONS
    : ORACLE_OPTIONS.filter((opt) => opt.id === 'skip');
  const pythAgeSeconds = pythInfo
    ? Math.max(0, Math.floor(Date.now() / 1000 - pythInfo.publishTime))
    : null;
  const pythAgeDisplay =
    pythAgeSeconds !== null ? formatAge(pythAgeSeconds) : null;
  const parseTroves = useCallback((raw: string) => {
    const troves: `0x${string}`[] = [];
    const invalid: string[] = [];
    raw
      .split(/[\s,]+/)
      .map((addr) => addr.trim())
      .filter(Boolean)
      .forEach((addr) => {
        const lower = addr.toLowerCase();
        const looksAddress = lower.startsWith('0x') && lower.length === 42;
        if (!looksAddress) {
          invalid.push(addr);
          return;
        }
        if (!troves.includes(lower as `0x${string}`)) {
          troves.push(lower as `0x${string}`);
        }
      });
    return { troves, invalid };
  }, []);
  const { troves: parsedTroves, invalid: invalidTroves } = useMemo(
    () => parseTroves(keeperTrovesInput),
    [keeperTrovesInput, parseTroves]
  );
  const fallbackTroves = useMemo(() => {
    if (!TROVE_FALLBACK_RAW) return [] as `0x${string}`[];
    return parseTroves(TROVE_FALLBACK_RAW).troves;
  }, [parseTroves]);
  const oracleRequiresOverride =
    !usingDemo && oracleReading && !oracleReading.healthy;
  const showOracleBlocker = oracleRequiresOverride && !oracleOverride;
  const oracleWarning: OracleReading | null = oracleRequiresOverride
    ? oracleReading
    : null;
  const jobActivities = displayJobs.map((job: any) => ({
    key: `job-${job.keeper}-${job.attempted?.toString?.() || '0'}`,
    type: 'job' as const,
    title: `${short(job.keeper)} executed ${
      job.executed?.toString?.() || '0'
    }/${job.attempted?.toString?.() || '0'} jobs`,
    subtitle: job.gasUsed?.toString?.()
      ? `${job.gasUsed?.toString?.()} gas used`
      : undefined,
  }));
  const keeperHighlight = displayKeepers[0]
    ? {
        key: `keeper-${displayKeepers[0].addr}`,
        type: 'keeper' as const,
        title: `${short(displayKeepers[0].addr)} leads the keeper board`,
        subtitle: `Score ${displayKeepers[0].score.toString()}`,
      }
    : undefined;
  const activityEntries = [
    ...(usingDemo
      ? demoEvents.map((event, idx) => ({
          key: `demo-${idx}`,
          type: 'demo' as const,
          title: event,
          subtitle: `Step ${idx + 1}`,
        }))
      : []),
    ...jobActivities,
    ...(keeperHighlight ? [keeperHighlight] : []),
  ];
  const { address: walletAddress } = useAccount();
  const { writeContractAsync, isPending: keeperPending } = useWriteContract();
  const { isLoading: keeperConfirming, isSuccess: keeperSuccess } =
    useWaitForTransactionReceipt({
      hash: keeperTxHash,
      query: { enabled: Boolean(keeperTxHash) },
    });
  const jobButtonDisabled =
    keeperPending || keeperConfirming || Boolean(showOracleBlocker);

  const formatTimestamp = (ts: number | null) =>
    ts
      ? new Date(ts).toLocaleTimeString([], {
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        })
      : '—';

  const copyAddress = async (addr: string) => {
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(addr);
      } else {
        const textarea = document.createElement('textarea');
        textarea.value = addr;
        textarea.style.position = 'fixed';
        textarea.style.top = '-1000px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand('copy');
        document.body.removeChild(textarea);
      }
      setCopiedAddr(addr);
      window.setTimeout(() => setCopiedAddr(null), 1800);
    } catch (err) {
      console.error('Failed to copy address', err);
    }
  };

  const applyTroves = useCallback((next: `0x${string}`[]) => {
    setKeeperTrovesTouched(true);
    setKeeperTrovesInput(next.join(', '));
  }, []);

  const addTrove = useCallback(
    (addr: `0x${string}`) => {
      const { troves } = parseTroves(keeperTrovesInput);
      if (troves.includes(addr)) return;
      applyTroves([...troves, addr]);
    },
    [applyTroves, keeperTrovesInput, parseTroves]
  );

  const fetchTroveSuggestions = useCallback(async () => {
    if (!SORTED_TROVES) return;
    setTroveHintsError(null);
    setTroveHintsLoading(true);
    try {
      const hints: `0x${string}`[] = [];
      const first = (await client.readContract({
        address: SORTED_TROVES as `0x${string}`,
        abi: (sortedAbi as any).abi,
        functionName: 'getFirst',
        args: [] as const,
      })) as `0x${string}`;
      let cursor: `0x${string}` | null = first
        ? (first.toLowerCase() as `0x${string}`)
        : null;
      let guard = 0;
      while (cursor && cursor !== ZERO_ADDRESS && guard < TROVE_HINT_LIMIT) {
        hints.push(cursor);
        guard += 1;
        const next = (await client.readContract({
          address: SORTED_TROVES as `0x${string}`,
          abi: (sortedAbi as any).abi,
          functionName: 'getNext',
          args: [cursor],
        })) as `0x${string}`;
        const normalized = next ? (next.toLowerCase() as `0x${string}`) : null;
        if (
          !normalized ||
          normalized === ZERO_ADDRESS ||
          normalized === cursor
        ) {
          break;
        }
        cursor = normalized;
      }
      setTroveSuggestions(hints);
      if (!keeperTrovesTouched && hints.length) {
        applyTroves(hints.slice(0, Math.min(3, hints.length)));
      }
      if (!hints.length) {
        if (fallbackTroves.length) {
          setTroveSuggestions(fallbackTroves);
          if (!keeperTrovesTouched) {
            applyTroves(
              fallbackTroves.slice(0, Math.min(3, fallbackTroves.length))
            );
          }
          setTroveHintsError(
            'No on-chain hints available. Using fallback trove list from configuration.'
          );
        } else {
          setTroveHintsError(
            'No troves returned from SortedTroves. Paste addresses manually.'
          );
        }
      }
    } catch (error) {
      console.error('fetchTroveSuggestions failed', error);
      setTroveHintsError(
        fallbackTroves.length
          ? 'Unable to fetch trove hints. Showing fallback configuration.'
          : 'Unable to fetch trove hints. Paste addresses manually.'
      );
      if (!keeperTrovesTouched && fallbackTroves.length) {
        applyTroves(
          fallbackTroves.slice(0, Math.min(3, fallbackTroves.length))
        );
        setTroveSuggestions(fallbackTroves);
      }
    } finally {
      setTroveHintsLoading(false);
    }
  }, [applyTroves, client, fallbackTroves, keeperTrovesTouched]);

  const useAllSuggestions = useCallback(() => {
    if (!troveSuggestions.length) return;
    applyTroves(troveSuggestions);
  }, [applyTroves, troveSuggestions]);

  const triggerKeeperJob = async () => {
    setKeeperStatus(undefined);
    setLastKeeperResult(null);
    setKeeperTrovesTouched(true);
    if (!walletAddress) {
      setKeeperStatus({
        message: 'Connect a keeper wallet to run a job.',
        tone: 'warn',
      });
      return;
    }
    if (!ENGINE) {
      setKeeperStatus({
        message: 'Engine address missing. Check your environment variables.',
        tone: 'warn',
      });
      return;
    }
    if (!usingDemo) {
      const oracleIssue = oracleReading;
      if (!oracleIssue) {
        setKeeperStatus({
          message:
            'Oracle feed is unavailable or stale. Refresh or switch sources.',
          tone: 'warn',
        });
        return;
      }
      if (!oracleIssue.healthy && !oracleOverride) {
        setKeeperStatus({
          message:
            oracleIssue.reason ??
            'Oracle feed is unavailable or stale. Acknowledge the warning to continue.',
          tone: 'warn',
        });
        return;
      }
    }
    const { troves, invalid } = parseTroves(keeperTrovesInput);
    if (invalid.length) {
      setKeeperStatus({
        message: `Remove invalid trove address${
          invalid.length > 1 ? 'es' : ''
        }: ${invalid.map((entry) => short(entry)).join(', ')}`,
        tone: 'warn',
      });
      return;
    }
    if (!troves.length) {
      setKeeperStatus({
        message: 'Provide at least one trove address.',
        tone: 'warn',
      });
      return;
    }
    try {
      const hash = await writeContractAsync({
        abi: (engineAbi as any).abi,
        address: ENGINE as `0x${string}`,
        functionName: 'liquidateRange',
        args: [troves, 0n, BigInt(troves.length), keeperRetries],
      });
      setKeeperTxHash(hash);
      setKeeperStatus({
        message: 'Transaction submitted. Waiting for confirmation…',
        tone: 'pending',
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Failed to submit keeper transaction. Check console logs.';
      setKeeperStatus({ message, tone: 'warn' });
    }
  };

  const runDemoFlow = () => {
    if (isRunningDemo) return;
    if (typeof window === 'undefined') return;
    setDemoMode(true);
    setIsRunningDemo(true);
    setDemoEvents([]);
    setDemoOracleStatus('checking...');
    setDemoJobs([]);
    setDemoKeepers([]);
    demoTimers.current.forEach((timer) => clearTimeout(timer));
    demoTimers.current = [];

    const steps: {
      delay: number;
      message: string;
      action?: () => void;
    }[] = [
      {
        delay: 400,
        message:
          'Keeper 0x8B2d…D623 registers with TrovePilot and stakes 5,000 MUSD.',
        action: () => {
          setDemoKeepers([DEMO_DATA.topKeepers[0]]);
        },
      },
      {
        delay: 1500,
        message:
          'Vault 0x8B2d…D623 enables automated top-ups at a 150% collateral ratio.',
        action: () => {
          setDemoOracleStatus('active (111,982)');
        },
      },
      {
        delay: 2800,
        message:
          'Oracle price fetched; TrovePilot batches three redemption hints for execution.',
        action: () => {
          setDemoJobs([DEMO_DATA.jobs[0]]);
        },
      },
      {
        delay: 3900,
        message:
          'Automation executes batch #312 — keeper paid 1,450 MUSD for 6 successful redemptions.',
        action: () => {
          setDemoJobs([...DEMO_DATA.jobs]);
          setDemoKeepers([DEMO_DATA.topKeepers[0], DEMO_DATA.topKeepers[1]]);
        },
      },
      {
        delay: 5100,
        message:
          'YieldAggregator routes surplus MUSD, boosting returns by +3.8% APY and updating the leaderboard.',
        action: () => {
          setDemoJobs([...DEMO_DATA.jobs]);
          setDemoKeepers([...DEMO_DATA.topKeepers]);
          setDemoOracleStatus(DEMO_DATA.oracleStatus);
        },
      },
      {
        delay: 6400,
        message:
          'Gas savings recorded: 0.08 BTC saved this hour via automated batching.',
        action: () => {
          setDemoKeepers([...DEMO_DATA.topKeepers]);
        },
      },
    ];

    steps.forEach((step, index) => {
      const timer = window.setTimeout(() => {
        setDemoEvents((prev) => [...prev, step.message]);
        step.action?.();
        if (index === steps.length - 1) {
          setIsRunningDemo(false);
        }
      }, step.delay);
      demoTimers.current.push(timer);
    });
  };

  const refresh = useCallback(async () => {
    let oracleResolved = false;

    if (usingDemo) {
      setOracleReading(null);
    }

    if (oracleSource === 'pyth' && hasPythConfig) {
      try {
        const priceData: any = await client.readContract({
          address: PYTH_CONTRACT as `0x${string}`,
          abi: (pythAbi as any).abi,
          functionName: 'getPriceNoOlderThan',
          args: [PYTH_PRICE_ID as `0x${string}`, BigInt(PYTH_MAX_AGE_SECONDS)],
        });
        const priceRaw = BigInt(priceData.price ?? priceData[0]);
        const confRaw = BigInt(priceData.conf ?? priceData[1]);
        const expoRaw = Number(priceData.expo ?? priceData[2]);
        const publishRaw = Number(priceData.publishTime ?? priceData[3]);
        const decimals = expoRaw < 0 ? Math.abs(expoRaw) : 0;
        const priceFormatted =
          decimals > 0 ? formatUnits(priceRaw, decimals) : priceRaw.toString();
        const confFormatted =
          decimals > 0 ? formatUnits(confRaw, decimals) : confRaw.toString();
        const ageSeconds = Math.max(
          0,
          Math.floor(Date.now() / 1000 - publishRaw)
        );
        const stale = ageSeconds > PYTH_MAX_AGE_SECONDS;
        setPythInfo({
          price: priceFormatted,
          conf: confFormatted,
          publishTime: publishRaw,
          expo: expoRaw,
        });
        if (stale) {
          const staleSeconds = ageSeconds - PYTH_MAX_AGE_SECONDS;
          const staleLabel = formatAge(staleSeconds);
          setOracleStatus(`inactive • pyth (stale by ${staleLabel})`);
          setOracleReading({
            source: 'pyth',
            label: priceFormatted,
            raw: priceRaw,
            ageSeconds,
            healthy: false,
            reason: `Price stale by ${staleLabel}`,
          });
        } else {
          setOracleStatus(`active • pyth (${priceFormatted})`);
          oracleResolved = true;
          setOracleReading({
            source: 'pyth',
            label: priceFormatted,
            raw: priceRaw,
            ageSeconds,
            healthy: true,
          });
        }
      } catch (error) {
        console.error('Pyth price fetch failed', error);
        setPythInfo(null);
        setOracleStatus('inactive • pyth (fetch failed; using skip)');
        setOracleReading({
          source: 'pyth',
          label: '—',
          raw: null,
          ageSeconds: null,
          healthy: false,
          reason: 'Pyth price fetch failed; attempting skip fallback.',
        });
      }
    }

    if (oracleSource === 'skip' || !oracleResolved) {
      try {
        const data = await client.transport.request({
          method: 'eth_call',
          params: [
            {
              to: '0xec42B37C12b8D73d320f4075A1BCd58B306629c1',
              data: '0x0fdb11cf',
            },
            'latest',
          ],
        });
        const hex = data as `0x${string}`;
        const price = BigInt(hex);
        const label =
          oracleSource === 'pyth' ? 'skip fallback - pyth unavailable' : 'skip';
        setOracleStatus(
          price > 0n
            ? `active • ${label} (${price})`
            : `inactive • ${label} (no price)`
        );
        if (oracleSource !== 'pyth') {
          setPythInfo(null);
        }
        setOracleReading({
          source: 'skip',
          label: price > 0n ? price.toString() : '—',
          raw: price,
          ageSeconds: null,
          healthy: price > 0n,
          fallback: oracleSource === 'pyth',
          reason:
            price > 0n
              ? oracleSource === 'pyth'
                ? 'Using skip while Pyth is unavailable.'
                : undefined
              : 'Skip oracle returned zero price.',
        });
      } catch (error) {
        console.error('Skip oracle fetch failed', error);
        if (!oracleResolved) {
          setOracleStatus('inactive • skip (call failed)');
          setOracleReading({
            source: 'skip',
            label: '—',
            raw: null,
            ageSeconds: null,
            healthy: false,
            reason: 'Skip oracle RPC call failed.',
          });
        }
      }
    }

    if (ENGINE) {
      try {
        const res = (await client.readContract({
          address: ENGINE as `0x${string}`,
          abi: (engineAbi as any).abi,
          functionName: 'getRecentJobs',
          args: [5n],
        })) as {
          keeper: string;
          attempted: bigint;
          executed: bigint;
          timestamp: bigint;
          gasUsed: bigint;
        }[];
        setJobs(res as any[]);
      } catch (err) {
        console.error('getRecentJobs failed', err);
      }
    }

    if (REG) {
      try {
        const [addrs, scores] = (await client.readContract({
          address: REG as `0x${string}`,
          abi: (regAbi as any).abi,
          functionName: 'getTopKeepers',
          args: [5n],
        })) as [string[], bigint[]];
        const entries = addrs.map((a, i) => ({
          addr: a,
          score: BigInt(scores[i]),
        }));
        setTopKeepers(entries);
      } catch (err) {
        console.error('getTopKeepers failed', err);
      }
    }

    if (!usingDemo && SORTED_TROVES) {
      await fetchTroveSuggestions();
    }

    setLastUpdated(Date.now());
  }, [
    REG,
    ENGINE,
    client,
    hasPythConfig,
    oracleSource,
    fetchTroveSuggestions,
    usingDemo,
  ]);

  const summarizeRecentJob = useCallback(
    async (keeper: string) => {
      if (!ENGINE) return;
      try {
        const recent = (await client.readContract({
          address: ENGINE as `0x${string}`,
          abi: (engineAbi as any).abi,
          functionName: 'getRecentJobs',
          args: [10n],
        })) as {
          keeper: string;
          attempted: bigint;
          executed: bigint;
          timestamp: bigint;
          gasUsed: bigint;
        }[];
        const normalized = keeper.toLowerCase();
        const mine = [...recent]
          .reverse()
          .find((job) => job.keeper.toLowerCase() === normalized);
        if (mine) {
          setLastKeeperResult(mine);
          const attempted = mine.attempted.toString();
          const executed = mine.executed.toString();
          const gasUsed = mine.gasUsed.toString();
          if (mine.executed > 0n) {
            setKeeperStatus({
              message: `Keeper job executed ${executed}/${attempted} troves. Gas used ${gasUsed}.`,
              tone: 'ok',
            });
          } else {
            setKeeperStatus({
              message: `Job attempted ${attempted} troves but executed none. Check trove hints or retry.`,
              tone: 'warn',
            });
          }
          return;
        }
      } catch (error) {
        console.error('summarizeRecentJob failed', error);
      }
      setLastKeeperResult(null);
      setKeeperStatus({
        message: 'Keeper job confirmed, but no summary was found on-chain.',
        tone: 'warn',
      });
    },
    [ENGINE, client]
  );

  useEffect(() => {
    if (keeperConfirming) {
      setKeeperStatus({
        message: 'Transaction pending confirmation…',
        tone: 'pending',
      });
    }
  }, [keeperConfirming]);

  useEffect(() => {
    if (keeperSuccess && walletAddress) {
      setKeeperStatus({
        message: 'Keeper job confirmed. Gathering results…',
        tone: 'pending',
      });
      void refresh();
      void summarizeRecentJob(walletAddress);
    }
  }, [keeperSuccess, walletAddress, refresh, summarizeRecentJob]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!demoMode) {
      void refresh();
    }
  }, [demoMode, refresh]);

  return (
    <>
      <div className="topbar">Mezo Testnet • TrovePilot</div>
      <main className="container">
        <header className="header">
          <div className="title">TrovePilot Dashboard</div>
          <div className="header-controls">
            <button
              className="btn"
              onClick={() => setDemoMode((prev) => !prev)}
            >
              Demo Mode: {demoMode ? 'On' : 'Off'}
            </button>
            <ConnectButton />
          </div>
        </header>

        {demoMode && (
          <div className="notice notice--demo">
            Demo mode active — showing simulated TrovePilot activity while the
            Mezo testnet is quiet.
          </div>
        )}
        {showLiveWarning && (
          <div className="notice notice--warn">
            Live Mezo data is currently inactive. Enable Demo Mode to preview
            the full experience.
          </div>
        )}

        <div className="grid" style={{ marginTop: 16 }}>
          {stats.map((stat) => (
            <div key={stat.label} className="card card--quarter metric-card">
              <div className="metric-label">
                {stat.label}
                <span
                  className="hint"
                  data-tip={stat.tip}
                  aria-label={stat.tip}
                  tabIndex={0}
                >
                  i
                </span>
              </div>
              <div className="metric-value">{stat.value}</div>
              <div className="metric-note muted">{stat.note}</div>
            </div>
          ))}
        </div>

        <div className="grid" style={{ marginTop: 16 }}>
          <div className="card card--half info-card">
            <div className="info-card__row">
              <div>
                <div className="info-card__eyebrow">Oracle status</div>
                <div className="info-card__status">
                  {statusChip(displayOracleStatus)}
                </div>
              </div>
              <button className="btn" onClick={refresh}>
                Refresh
              </button>
            </div>
            <div className="info-card__meta">
              <span
                className={`badge ${usingDemo ? 'badge--demo' : 'badge--live'}`}
              >
                {dataSourceLabel}
              </span>
              <span className="muted">
                Last checked {formatTimestamp(lastUpdated)}
              </span>
            </div>
            {!usingDemo && (
              <div className="oracle-select">
                <label className="oracle-select__label" htmlFor="oracle-source">
                  Oracle source
                </label>
                <select
                  id="oracle-source"
                  className="oracle-select__input"
                  value={oracleSource}
                  onChange={(event) =>
                    setOracleSource(event.target.value as OracleSource)
                  }
                >
                  {oracleChoices.map((choice) => (
                    <option key={choice.id} value={choice.id}>
                      {choice.label}
                    </option>
                  ))}
                </select>
                <span className="muted oracle-select__helper">
                  {selectedOracle.helper}
                </span>
              </div>
            )}
            {oracleSource === 'pyth' && hasPythConfig && (
              <div className="oracle-pyth muted">
                {pythInfo
                  ? `Price ${pythInfo.price} ± ${pythInfo.conf} • updated ${
                      pythAgeDisplay ? `${pythAgeDisplay} ago` : 'just now'
                    }`
                  : 'Fetching latest Pyth price…'}
              </div>
            )}
            {!hasPythConfig && !usingDemo && (
              <div className="oracle-hint">
                Set NEXT_PUBLIC_PYTH_CONTRACT and NEXT_PUBLIC_PYTH_PRICE_ID to
                enable this toggle.
              </div>
            )}
            <div className="info-card__foot muted">{dataSourceDescription}</div>
          </div>

          <div className="card card--half info-card">
            <div className="info-card__row">
              <div>
                <div className="info-card__eyebrow">Contracts</div>
                <h3 className="info-card__title">
                  Latest deployment references
                </h3>
              </div>
            </div>
            <div className="contract-list">
              {contractRows.map((row) => (
                <div key={row.label} className="contract-row">
                  <div className="contract-row__name">{row.label}</div>
                  {row.address ? (
                    <div className="contract-row__value">
                      <a
                        className="link"
                        href={`https://explorer.test.mezo.org/address/${row.address}`}
                        target="_blank"
                        rel="noreferrer"
                      >
                        {short(row.address)}
                      </a>
                      <button
                        className="btn btn--ghost"
                        onClick={() => copyAddress(row.address)}
                      >
                        {copiedAddr === row.address ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                  ) : (
                    <span className="muted">—</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="grid" style={{ marginTop: 16 }}>
          <div className="card card--half automation-story">
            <h3>Automation Story</h3>
            <p className="muted automation-story__intro">
              Walk through how TrovePilot automates vault protection,
              redemptions, and yield routing.
            </p>
            <div className="row automation-story__actions">
              <button
                className="btn"
                onClick={runDemoFlow}
                disabled={isRunningDemo}
              >
                {isRunningDemo ? 'Running…' : 'Run Guided Demo'}
              </button>
              {isRunningDemo && <span className="muted">about 6 seconds</span>}
            </div>
            <ol className="timeline automation-story__timeline">
              {demoEvents.map((event, idx) => (
                <li key={`${idx}-${event}`} className="timeline__item">
                  <span className="timeline__index">{idx + 1}</span>
                  <span className="timeline__text">{event}</span>
                </li>
              ))}
              {!demoEvents.length && (
                <li className="timeline__item muted">
                  <span className="timeline__index">—</span>
                  <span className="timeline__text">
                    Press “Run Guided Demo” to see TrovePilot in action.
                  </span>
                </li>
              )}
            </ol>
          </div>

          <div className="card card--half">
            <h3>Activity Feed</h3>
            <ul className="activity">
              {activityEntries.map((item) => (
                <li
                  key={item.key}
                  className={`activity__item activity__item--${item.type}`}
                >
                  <span
                    className="activity__icon"
                    aria-hidden="true"
                    style={{
                      background: ACTIVITY_ICON[item.type].bg,
                      color: ACTIVITY_ICON[item.type].color,
                    }}
                    title={ACTIVITY_ICON[item.type].title}
                  >
                    {ACTIVITY_ICON[item.type].emoji}
                  </span>
                  <div className="activity__body">
                    <div className="activity__title">{item.title}</div>
                    {item.subtitle && (
                      <div className="activity__subtitle muted">
                        {item.subtitle}
                      </div>
                    )}
                  </div>
                </li>
              ))}
              {!activityEntries.length && (
                <li className="activity__item muted">
                  <span
                    className="activity__icon"
                    aria-hidden="true"
                    style={{
                      background: 'linear-gradient(135deg,#e2e8f0,#cbd5f5)',
                      color: '#1e293b',
                    }}
                  >
                    ℹ️
                  </span>
                  <div className="activity__body">
                    <div className="activity__title">
                      No recent activity yet
                    </div>
                    <div className="activity__subtitle">
                      Run the guided demo or execute a job on Mezo to populate
                      this feed.
                    </div>
                  </div>
                </li>
              )}
            </ul>
          </div>

          <div className="card card--half keeper-console">
            <h3>Keeper Console</h3>
            <p className="muted">
              Connect your keeper wallet to trigger a live liquidation job on
              Mezo. Provide known trove addresses or hints exported from the
              demo script.
            </p>
            {!usingDemo && (
              <div
                className={`keeper-oracle ${
                  showOracleBlocker ? 'keeper-oracle--warn' : ''
                }`}
              >
                <div className="keeper-oracle__header">
                  <span className="keeper-oracle__title">Oracle feed</span>
                  <span
                    className={`pill ${
                      oracleReading?.healthy ? 'pill--ok' : 'pill--warn'
                    }`}
                  >
                    {oracleReading ? oracleReading.label : 'fetching…'}
                  </span>
                </div>
                <div className="keeper-oracle__body">
                  {oracleReading ? (
                    <>
                      <span>
                        Source:{' '}
                        {oracleReading.fallback
                          ? 'Skip fallback'
                          : selectedOracle.label}
                      </span>
                      {oracleReading.ageSeconds !== null && (
                        <span>Age {formatAge(oracleReading.ageSeconds)}</span>
                      )}
                    </>
                  ) : (
                    <span>Waiting for latest price…</span>
                  )}
                </div>
                {oracleWarning?.reason && (
                  <div className="keeper-oracle__hint">
                    {oracleWarning.reason}
                  </div>
                )}
                {oracleWarning && (
                  <div className="keeper-oracle__override">
                    <label className="override-toggle">
                      <input
                        type="checkbox"
                        checked={oracleOverride}
                        onChange={(event) =>
                          setOracleOverride(event.target.checked)
                        }
                      />
                      <span>
                        I understand the oracle is degraded and want to proceed
                      </span>
                    </label>
                  </div>
                )}
              </div>
            )}
            <label className="field stretch" htmlFor="keeper-troves">
              <span className="field__label field__label--normal">
                Troves to liquidate
              </span>
              <span className="field__helper">
                Comma or newline-separated addresses
              </span>
              <textarea
                className="field__input keeper-troves-input"
                rows={2}
                value={keeperTrovesInput}
                onChange={(e) => {
                  setKeeperTrovesTouched(true);
                  setKeeperTrovesInput(e.target.value);
                }}
                id="keeper-troves"
                placeholder="Paste trove addresses, e.g. 0xabc..., 0xdef..."
              />
            </label>
            {invalidTroves.length > 0 && (
              <div className="keeper-warning">
                Remove invalid address
                {invalidTroves.length > 1 ? 'es' : ''}:{' '}
                {invalidTroves.map((addr) => short(addr)).join(', ')}
              </div>
            )}
            <div className="trove-suggestions">
              <div className="trove-suggestions__header">
                <span className="field__label">Suggested troves</span>
                <div className="row">
                  <button
                    className="btn btn--ghost"
                    onClick={() => fetchTroveSuggestions()}
                    disabled={troveHintsLoading}
                  >
                    {troveHintsLoading ? 'Loading…' : 'Refresh hints'}
                  </button>
                  <button
                    className="btn btn--ghost"
                    onClick={useAllSuggestions}
                    disabled={!troveSuggestions.length}
                  >
                    Use all
                  </button>
                </div>
              </div>
              <div className="trove-suggestions__chips">
                {troveSuggestions.map((addr) => (
                  <button
                    key={addr}
                    type="button"
                    className="trove-chip"
                    onClick={() => addTrove(addr)}
                    disabled={parsedTroves.includes(addr)}
                  >
                    {short(addr)}
                  </button>
                ))}
                {!troveHintsLoading && !troveSuggestions.length && (
                  <span className="muted">
                    No hints yet — refresh to fetch.
                  </span>
                )}
              </div>
              {troveHintsError && (
                <div className="trove-suggestions__error muted">
                  {troveHintsError}
                </div>
              )}
            </div>
            <label className="field field--compact">
              <span className="field__label">Max retries per trove</span>
              <input
                className="field__input field__input--compact"
                type="number"
                min={0}
                max={5}
                value={keeperRetries}
                onChange={(e) =>
                  setKeeperRetries(
                    Math.max(0, Math.min(5, Number(e.target.value) || 0))
                  )
                }
              />
            </label>
            <div className="row keeper-actions">
              <button
                className="btn"
                onClick={triggerKeeperJob}
                disabled={jobButtonDisabled}
              >
                {keeperPending || keeperConfirming
                  ? 'Submitting…'
                  : showOracleBlocker
                  ? 'Oracle blocked'
                  : 'Run Keeper Job'}
              </button>
              {!walletAddress && (
                <span className="muted">Connect wallet to run</span>
              )}
            </div>
            {keeperStatus && (
              <div className={`status status--${keeperStatus.tone}`}>
                {keeperStatus.message}
              </div>
            )}
            {lastKeeperResult && (
              <div className="keeper-summary">
                <div>
                  Attempted{' '}
                  <strong>{lastKeeperResult.attempted.toString()}</strong>{' '}
                  troves
                </div>
                <div>
                  Executed{' '}
                  <strong>{lastKeeperResult.executed.toString()}</strong> · Gas
                  used <strong>{lastKeeperResult.gasUsed.toString()}</strong>
                </div>
                <div>
                  Recorded{' '}
                  {formatAge(
                    Math.max(
                      0,
                      Math.floor(
                        Date.now() / 1000 - Number(lastKeeperResult.timestamp)
                      )
                    )
                  )}{' '}
                  ago
                </div>
              </div>
            )}
          </div>

          <div className="card card--half">
            <h3>Top Keepers</h3>
            <ol className="list list--dense">
              {displayKeepers.map((k: { addr: string; score: bigint }) => (
                <li key={k.addr}>
                  <strong>{short(k.addr)}</strong>{' '}
                  <span className="muted">score</span>{' '}
                  <span className="pill pill--mono">{k.score.toString()}</span>
                </li>
              ))}
              {!displayKeepers.length && <li className="muted">No keepers</li>}
            </ol>
          </div>
        </div>
        <div className="container footer">
          <span className="muted">Docs &amp; runbook:</span>
          <a
            className="link"
            href={
              process.env.NEXT_PUBLIC_TROVEPILOT_DOCS_URL ||
              'https://github.com/VitalR/mezo-trovepilot/tree/main/docs'
            }
            target="_blank"
            rel="noreferrer"
          >
            TrovePilot Docs
          </a>
          <span>·</span>
          <a
            className="link"
            href={
              process.env.NEXT_PUBLIC_GITHUB_URL ||
              'https://github.com/VitalR/mezo-trovepilot'
            }
            target="_blank"
            rel="noreferrer"
          >
            GitHub
          </a>
          <span>·</span>
          <span className="muted">
            © 2025 TrovePilot — Built for Mezo Hackathon 2025
          </span>
        </div>
      </main>
    </>
  );
}
