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

  // @solana/web3.js auto-derives the WebSocket endpoint by replacing http→ws on
  // `endpoint`. When `endpoint` is our same-origin /api/rpc proxy (which only
  // speaks HTTP), the derived ws://localhost:PORT/api/rpc has no listener and
  // confirmTransaction's subscription hangs forever — UI stays on
  // "⚡ Submitted — confirming…" even after the tx finalizes on-chain.
  // Point WebSockets straight at the upstream RPC instead. HTTP traffic still
  // flows through the proxy so the raw-bytes-forwarding (u64::MAX safety) is
  // preserved.
  const wsEndpoint =
    process.env.NEXT_PUBLIC_SOLANA_WS ?? "wss://api.devnet.solana.com";

  const wallets = useMemo(
    () => [new PhantomWalletAdapter(), new SolflareWalletAdapter()],
    []
  );

  return (
    <DynamicWalletProvider>
      <ConnectionProvider endpoint={endpoint} config={{ wsEndpoint }}>
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
