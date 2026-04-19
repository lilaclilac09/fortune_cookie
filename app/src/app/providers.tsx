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
import DynamicWalletProvider from "@/components/DynamicWalletProvider";

export default function Providers({
  children
}: {
  children: React.ReactNode;
}) {
  const rawEndpoint =
    process.env.NEXT_PUBLIC_SOLANA_RPC ?? "https://api.devnet.solana.com";

  let endpoint = rawEndpoint;
  if (rawEndpoint.startsWith('/')) {
    if (typeof window !== 'undefined') {
      endpoint = `${window.location.origin}${rawEndpoint}`;
    } else {
      endpoint = "https://api.devnet.solana.com";
    }
  }

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <DynamicWalletProvider>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect={false}>
          <WalletModalProvider>
            <WalletModeProvider>
              {children}
            </WalletModeProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </DynamicWalletProvider>
  );
}
