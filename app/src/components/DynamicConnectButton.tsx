"use client";

/**
 * DynamicConnectButton
 *
 * Shows a Dynamic "Connect" widget if the SDK is installed and configured,
 * otherwise falls back to the standard WalletButton (Phantom / Solflare).
 *
 * Usage in page.tsx — swap out <WalletButton /> with <DynamicConnectButton />
 * and wrap providers.tsx with <DynamicWalletProvider>.
 *
 * The Dynamic widget handles:
 *   • Email OTP → embedded wallet created server-side (no seed phrase)
 *   • Google / Apple social login
 *   • QR-code deep-link for Phantom / Backpack / Solflare on mobile
 *   • Wallet-Connect bridge for desktop extension wallets
 */

import dynamic from "next/dynamic";
import React, { useState, useEffect } from "react";

// ── Dynamic SDK widget ─────────────────────────────────────────────────────────
// DynamicWidget renders a complete login / account button.
// We lazy-load it so SSR doesn't fail when the package isn't installed.

const DynamicWidget = dynamic(
  async () => {
    try {
      const mod = await import("@dynamic-labs/sdk-react-core" as any);
      return mod.DynamicWidget ?? (() => null);
    } catch {
      return () => null;
    }
  },
  { ssr: false }
);

// Fallback — plain wallet-adapter button
const WalletButton = dynamic(() => import("./WalletButton"), { ssr: false });

// ── Hook: is Dynamic SDK present + configured? ────────────────────────────────

function useDynamicAvailable(): boolean {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    const envId = process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID ?? "";
    if (!envId) return;
    import("@dynamic-labs/sdk-react-core" as any)
      .then(() => setAvailable(true))
      .catch(() => {});
  }, []);
  return available;
}

// ── useDynamicWalletBridge ────────────────────────────────────────────────────
// Extracts the Solana signer from Dynamic's context and exposes it as a
// plain publicKey + signTransaction pair compatible with useFortuneCookie.

export function useDynamicWalletBridge(): {
  publicKey: import("@solana/web3.js").PublicKey | null;
  signTransaction: (<T extends import("@solana/web3.js").Transaction>(tx: T) => Promise<T>) | null;
} {
  const [ctx, setCtx] = useState<any>(null);

  useEffect(() => {
    import("@dynamic-labs/sdk-react-core" as any)
      .then((mod) => {
        // DynamicContextProvider exposes useDynamicContext hook
        // We can't call a hook outside a component, so we poll the context object
        if (mod.__dynamicContext) setCtx(mod.__dynamicContext);
      })
      .catch(() => {});
  }, []);

  if (!ctx?.primaryWallet) return { publicKey: null, signTransaction: null };

  // Dynamic's Solana wallet adapter
  const solanaWallet = ctx.primaryWallet;
  return {
    publicKey: solanaWallet.address
      ? new (require("@solana/web3.js").PublicKey)(solanaWallet.address)
      : null,
    signTransaction: solanaWallet.signTransaction?.bind(solanaWallet) ?? null,
  };
}

// ── Component ──────────────────────────────────────────────────────────────────

interface Props {
  /** Extra Tailwind / inline styles forwarded to the wrapper */
  className?: string;
  style?: React.CSSProperties;
}

export default function DynamicConnectButton({ className, style }: Props) {
  const dynamicAvailable = useDynamicAvailable();

  if (dynamicAvailable) {
    return (
      <div className={className} style={style}>
        <DynamicWidget />
      </div>
    );
  }

  // Fallback to wallet-adapter (Phantom / Solflare)
  return <WalletButton />;
}
