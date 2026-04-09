/**
 * 钱包模式选择器
 * 支持：Demo Mode, Local Wallet, Solflare（仅提供模式上下文，不嵌套Provider）
 */

'use client';

import React, { createContext, useContext, useState, useEffect } from 'react';
import { LocalWallet, createLocalWallet } from '@/lib/mock-wallet';

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
  const [mode, setMode] = useState<WalletMode>('solflare');
  const [localWallet, setLocalWallet] = useState<LocalWallet | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);

  // Initialize after hydration on client side only
  useEffect(() => {
    setIsHydrated(true);
    if (typeof window !== 'undefined') {
      try {
        setLocalWallet(createLocalWallet());
      } catch (e) {
        console.error('Failed to create local wallet:', e);
      }
    }
  }, []);

  return (
    <WalletModeContext.Provider
      value={{
        mode,
        setMode,
        localWallet: mode === 'local' ? localWallet : null,
      }}
    >
      {children}
    </WalletModeContext.Provider>
  );
}
