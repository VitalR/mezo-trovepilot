'use client';
import '@rainbow-me/rainbowkit/styles.css';
import {
  RainbowKitProvider,
  lightTheme,
  type AvatarComponent,
} from '@rainbow-me/rainbowkit';
import type { AppProps } from 'next/app';
import { WagmiProvider } from 'wagmi';
import { wagmiConfig } from '../lib/wagmi';
import { mezoTestnet } from '../lib/chains';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import '../styles/globals.css';

const queryClient = new QueryClient();

const MezoAvatar: AvatarComponent = ({ address, size }) => {
  const short = address ? `${address.slice(2, 4)}`.toUpperCase() : 'MZ';
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 999,
        background:
          'linear-gradient(135deg, rgba(245,176,0,1) 0%, rgba(255,214,102,1) 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: '#2b2b2b',
        fontWeight: 800,
        fontSize: Math.max(10, Math.floor((size || 24) / 2.4)),
        letterSpacing: 0.4,
        border: '1px solid rgba(0,0,0,0.15)',
      }}
      aria-label="Mezo avatar"
      title={`Account ${address}`}
    >
      {short}
    </div>
  );
};

export default function App({ Component, pageProps }: AppProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider
          chains={[mezoTestnet]}
          theme={lightTheme({ accentColor: '#2563eb', borderRadius: 'large' })}
          avatar={MezoAvatar}
        >
          <Component {...pageProps} />
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
