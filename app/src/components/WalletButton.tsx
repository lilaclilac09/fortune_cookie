'use client';

import { useState, useEffect } from 'react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';

export default function WalletButton() {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) {
    return <div style={{ width: '200px', height: '40px', background: '#f59e0b', borderRadius: '999px' }} />;
  }

  return <WalletMultiButton className="wallet-button" />;
}

