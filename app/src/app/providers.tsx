"use client";

import { useMemo } from "react";
import {
  ConnectionProvider,
  WalletProvider
} from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {
  PhantomWalletAdapter,
  SolflareWalletAdapter,
} from "@solana/wallet-adapter-wallets";
import { WalletModeProvider } from "@/components/WalletModeSelector";

export default function Providers({
  children
}: {
  children: React.ReactNode;
}) {
  const rawEndpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";

  // If it's a relative path (proxy), make it absolute using current origin on client side
  // On server side, use the public devnet endpoint
  let endpoint = rawEndpoint;
  if (rawEndpoint.startsWith('/')) {
    if (typeof window !== 'undefined') {
      endpoint = `${window.location.origin}${rawEndpoint}`;
    } else {
      // Server-side: use public endpoint as fallback
      endpoint = "https://api.devnet.solana.com";
    }
  }

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <ConnectionProvider endpoint={endpoint}>
      <WalletProvider wallets={wallets} autoConnect={false}>
        <WalletModalProvider>
          <WalletModeProvider>
            {children}
          </WalletModeProvider>
        </WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
