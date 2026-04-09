'use client';

import { useState, useEffect, Suspense } from 'react';
import dynamic from 'next/dynamic';

// Lazy load the actual button component to avoid context issues
const WalletMultiButtonLazy = dynamic(
  () => import('@solana/wallet-adapter-react-ui').then(mod => ({
    default: mod.WalletMultiButton
  })),
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

  return (
    <Suspense fallback={<div style={{ width: '200px', height: '40px', background: '#f59e0b', borderRadius: '999px' }} />}>
      <WalletMultiButtonLazy className="wallet-button" />
    </Suspense>
  );
}

