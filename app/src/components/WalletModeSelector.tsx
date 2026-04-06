/**
 * 钱包模式选择器
 * 支持：Demo Mode, Local Wallet, Solflare
 */

'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import {
  ConnectionProvider,
  WalletProvider,
} from '@solana/wallet-adapter-react';
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui';
import { PhantomWalletAdapter, SolflareWalletAdapter } from '@solana/wallet-adapter-wallets';
import { clusterApiUrl } from '@solana/web3.js';
import { LocalWallet, createLocalWallet } from '@/lib/mock-wallet';

require('@solana/wallet-adapter-react-ui/styles.css');

type WalletMode = 'demo' | 'local' | 'solflare';

interface WalletModeContextType {
  mode: WalletMode;
  setMode: (mode: WalletMode) => void;
  localWallet: LocalWallet | null;
}

const WalletModeContext = createContext<WalletModeContextType | undefined>(
  undefined
);

export function useWalletMode() {
  const context = useContext(WalletModeContext);
  if (!context) {
    throw new Error('useWalletMode must be used within WalletModeProvider');
  }
  return context;
}

export function WalletModeProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [mode, setMode] = useState<WalletMode>('demo');
  const [localWallet, setLocalWallet] = useState<LocalWallet | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Initialize after hydration on client side
  useEffect(() => {
    setIsHydrated(true);
    // Only create wallet on client side
    if (typeof window !== 'undefined') {
      setLocalWallet(createLocalWallet());
    }
  }, []);

  const endpoint = clusterApiUrl('devnet');

  // 对于Local模式，创建一个不包含浏览器钱包的适配器列表
  const wallets =
    mode === 'local'
      ? [] // Local模式不需要任何钱包适配器
      : [new PhantomWalletAdapter(), new SolflareWalletAdapter()];

  return (
    <WalletModeContext.Provider
      value={{
        mode,
        setMode,
        localWallet: mode === 'local' ? localWallet : null,
      }}
    >
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect={false}>
          <WalletModalProvider>{children}</WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </WalletModeContext.Provider>
  );
}
