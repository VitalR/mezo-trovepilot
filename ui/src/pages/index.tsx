import { ConnectButton } from '@rainbow-me/rainbowkit';
import { useMemo, useState, useEffect } from 'react';
import { createPublicClient, http } from 'viem';
import { mezoTestnet } from '../lib/chains';
import engineAbi from '../lib/abis/LiquidationEngine.json';
import regAbi from '../lib/abis/KeeperRegistry.json';

const ENGINE = (process.env.NEXT_PUBLIC_ENGINE || '').toLowerCase();
const VAULT = (process.env.NEXT_PUBLIC_VAULT || '').toLowerCase();
const AGG = (process.env.NEXT_PUBLIC_AGGREGATOR || '').toLowerCase();
const REG = (process.env.NEXT_PUBLIC_REGISTRY || '').toLowerCase();
const ROUTER = (process.env.NEXT_PUBLIC_ROUTER || '').toLowerCase();

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
  const statusChip = (s: string) => (
    <span
      className={`chip ${s.startsWith('active') ? 'chip--ok' : 'chip--bad'}`}
    >
      {s}
    </span>
  );

  const short = (a?: string) =>
    a && a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a || '—';

  async function refresh() {
    // Oracle status from TM proxy fetchPrice (best-effort via eth_call)
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
      setOracleStatus(price > 0n ? `active (${price})` : 'inactive');
    } catch {
      setOracleStatus('inactive');
    }

    // Recent jobs
    if (ENGINE) {
      try {
        const res: any = await client.readContract({
          address: ENGINE as `0x${string}`,
          abi: (engineAbi as any).abi,
          functionName: 'getRecentJobs',
          args: [5n],
        });
        setJobs(res as any[]);
      } catch {}
    }

    // Top keepers
    if (REG) {
      try {
        const [addrs, scores]: any = await client.readContract({
          address: REG as `0x${string}`,
          abi: (regAbi as any).abi,
          functionName: 'getTopKeepers',
          args: [5n],
        });
        const entries = (addrs as string[]).map((a, i) => ({
          addr: a,
          score: BigInt(scores[i]),
        }));
        setTopKeepers(entries);
      } catch {}
    }
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <div className="topbar">Mezo Testnet • TrovePilot</div>
      <main className="container">
        <header className="header">
          <div className="title">TrovePilot Dashboard</div>
          <ConnectButton />
        </header>

        <div className="grid" style={{ marginTop: 16 }}>
          <div className="card card--half">
            <h3>Status</h3>
            <div className="row">
              <button className="btn" onClick={refresh}>
                Refresh
              </button>
              {statusChip(oracleStatus)}
            </div>
          </div>

          <div className="card card--half">
            <h3>Contracts</h3>
            <div className="kv mono">
              <div className="k">LiquidationEngine</div>
              <div className="v">
                {ENGINE ? (
                  <a
                    className="link"
                    href={`https://explorer.test.mezo.org/address/${ENGINE}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(ENGINE)}
                  </a>
                ) : (
                  '—'
                )}
              </div>
              <div className="k">VaultManager</div>
              <div className="v">
                {VAULT ? (
                  <a
                    className="link"
                    href={`https://explorer.test.mezo.org/address/${VAULT}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(VAULT)}
                  </a>
                ) : (
                  '—'
                )}
              </div>
              <div className="k">RedemptionRouter</div>
              <div className="v">
                {ROUTER ? (
                  <a
                    className="link"
                    href={`https://explorer.test.mezo.org/address/${ROUTER}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(ROUTER)}
                  </a>
                ) : (
                  '—'
                )}
              </div>
              <div className="k">YieldAggregator</div>
              <div className="v">
                {AGG ? (
                  <a
                    className="link"
                    href={`https://explorer.test.mezo.org/address/${AGG}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(AGG)}
                  </a>
                ) : (
                  '—'
                )}
              </div>
              <div className="k">KeeperRegistry</div>
              <div className="v">
                {REG ? (
                  <a
                    className="link"
                    href={`https://explorer.test.mezo.org/address/${REG}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    {short(REG)}
                  </a>
                ) : (
                  '—'
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="grid" style={{ marginTop: 16 }}>
          <div className="card card--half">
            <h3>Recent Jobs</h3>
            <ul className="list mono">
              {jobs.map((j, i) => (
                <li key={i}>
                  keeper {short(j.keeper)} — attempted{' '}
                  {j.attempted?.toString?.()} — executed{' '}
                  {j.executed?.toString?.()} — gas {j.gasUsed?.toString?.()}
                </li>
              ))}
              {!jobs.length && <li className="muted">No jobs</li>}
            </ul>
          </div>

          <div className="card card--half">
            <h3>Top Keepers</h3>
            <ol className="list mono">
              {topKeepers.map((k) => (
                <li key={k.addr}>
                  {short(k.addr)} — score {k.score.toString()}
                </li>
              ))}
              {!topKeepers.length && <li className="muted">No keepers</li>}
            </ol>
          </div>
        </div>
        <div className="container footer">
          <a
            className="link"
            href={process.env.NEXT_PUBLIC_FAQ_URL || '#'}
            target="_blank"
            rel="noreferrer"
          >
            FAQ
          </a>
          <span>·</span>
          <a
            className="link"
            href={process.env.NEXT_PUBLIC_TROVEPILOT_DOCS_URL || '#'}
            target="_blank"
            rel="noreferrer"
          >
            TrovePilot Docs
          </a>
          <span>·</span>
          <a
            className="link"
            href={process.env.NEXT_PUBLIC_GITHUB_URL || 'https://github.com'}
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
