import { getDefaultConfig } from '@rainbow-me/rainbowkit';
import { http } from 'wagmi';
import { mezoTestnet } from './chains';

export const wagmiConfig = getDefaultConfig({
  appName: 'TrovePilot',
  projectId: process.env.NEXT_PUBLIC_WC_PROJECT_ID || '',
  chains: [mezoTestnet],
  transports: {
    [mezoTestnet.id]: http(process.env.NEXT_PUBLIC_RPC_URL),
  },
});