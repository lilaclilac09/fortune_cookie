'use client';

import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';

const DynamicWalletButton = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then(mod => {
    // Create a simple wrapper to avoid context issues
    return {
      default: () => {
        const Button = mod.WalletMultiButton;
        return <Button className="wallet-button" />;
      }
    };
  }),
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

  return <DynamicWalletButton />;
}

