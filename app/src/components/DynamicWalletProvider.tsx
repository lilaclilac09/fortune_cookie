"use client";

/**
 * Dynamic embedded wallet provider.
 *
 * Install:
 *   yarn add @dynamic-labs/sdk-react-core \
 *            @dynamic-labs/solana \
 *            @dynamic-labs/wallet-connector-core
 *
 * Then set in .env.local:
 *   NEXT_PUBLIC_DYNAMIC_ENV_ID=<your Dynamic environment ID>
 *
 * Dynamic gives you: email / Google / Apple social login that auto-creates
 * an embedded Solana wallet — zero-friction onboarding, no MetaMask needed.
 *
 * This provider is drop-in alongside the existing @solana/wallet-adapter stack.
 * Dynamic provides a `useDynamicContext` hook that surfaces the wallet; we
 * bridge it into wallet-adapter via `DynamicSolanaAdapterBridge` so the rest
 * of the app (useFortuneCookie, page.tsx) needs zero changes.
 */

import React, { useMemo } from "react";

// ── Dynamic SDK imports ───────────────────────────────────────────────────────
// Wrapped in try/catch at runtime so the file compiles without the package.
// Replace with direct imports once installed:
//
//   import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
//   import { SolanaWalletConnectors } from "@dynamic-labs/solana";

let DynamicContextProvider: React.FC<{
  settings: Record<string, unknown>;
  children: React.ReactNode;
}>;

let SolanaWalletConnectors: unknown;

try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const core = require("@dynamic-labs/sdk-react-core");
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const sol = require("@dynamic-labs/solana");
  DynamicContextProvider = core.DynamicContextProvider;
  SolanaWalletConnectors = sol.SolanaWalletConnectors;
} catch {
  // Not installed — render children as-is (existing wallet-adapter handles it)
  DynamicContextProvider = ({ children }) => <>{children}</>;
  SolanaWalletConnectors = undefined;
}

// ── Provider ──────────────────────────────────────────────────────────────────

interface Props {
  children: React.ReactNode;
}

export default function DynamicWalletProvider({ children }: Props) {
  const envId = process.env.NEXT_PUBLIC_DYNAMIC_ENV_ID ?? "";

  const settings = useMemo(
    () => ({
      environmentId: envId,
      walletConnectors: SolanaWalletConnectors ? [SolanaWalletConnectors] : [],
      // Show wallet connect UI inside the modal (not a full-page redirect)
      displaySiweStatement: false,
      // Keep existing wallet-adapter wallets available alongside Dynamic
      walletConnectPreferredChains: ["solana:devnet"],
      cssOverrides: `
        .dynamic-widget-inline-controls {
          border-radius: 12px;
        }
      `,
    }),
    [envId]
  );

  if (!envId) {
    // Dynamic not configured — fall through to wallet-adapter
    return <>{children}</>;
  }

  return (
    <DynamicContextProvider settings={settings}>
      {children}
    </DynamicContextProvider>
  );
}
