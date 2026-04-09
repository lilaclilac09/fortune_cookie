'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const WalletButtonContent = dynamic(
  async () => {
    // Import on client side only
    const { WalletMultiButton } = await import('@solana/wallet-adapter-react-ui');

    return {
      default: function DynamicWalletButton() {
        return <WalletMultiButton className="wallet-button" />;
      }
    };
  },
  {
    ssr: false,
    loading: () => <div style={{ width: '200px', height: '40px', background: '#f59e0b', borderRadius: '999px' }} />
  }
);

export default function WalletButton() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div style={{ width: '200px', height: '40px', background: '#f59e0b', borderRadius: '999px' }} />;
  }

  return <WalletButtonContent />;
}

