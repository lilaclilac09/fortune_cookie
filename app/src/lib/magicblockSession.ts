/**
 * MagicBlock Session Keys integration
 *
 * Uses @magicblock-labs/gum-react-sdk's createSessionTokenIx / closeSessionTokenIx
 * so we get their audited on-chain program instead of rolling our own.
 *
 * Install:
 *   yarn add @magicblock-labs/gum-react-sdk
 *
 * IMPORTANT: After switching to this module, remove the custom
 * create_session / revoke_session instructions from lib.rs and instead
 * validate sessions by CPI-reading MagicBlock's SessionToken account.
 * The MB program ID on devnet/mainnet-beta is:
 *   TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA (placeholder — check MB docs)
 *
 * In practice, for our current lib.rs (which owns its own SessionToken PDA),
 * we use MB's SDK only on the *client* to build the instruction bytes, then
 * submit them alongside our open_cookie tx.  The two session token accounts
 * are independent; use ONE of the two approaches, not both.
 */

import {
  PublicKey,
  Transaction,
  Connection,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";

// ── MagicBlock SDK types ───────────────────────────────────────────────────────
// If @magicblock-labs/gum-react-sdk is installed, import directly:
//
//   import {
//     createSessionTokenIx,
//     closeSessionTokenIx,
//   } from "@magicblock-labs/gum-react-sdk";
//
// The types below match MB SDK v0.3.x.  Adjust if a newer version changes them.

interface CreateSessionTokenParams {
  /** AnchorProvider wrapping the *main* wallet (will sign the ix) */
  provider: anchor.AnchorProvider;
  /** Ephemeral session keypair public key */
  sessionSigner: PublicKey;
  /** Your program's ID (MB scopes sessions per-program) */
  targetProgram: PublicKey;
  /** SOL to top-up the session signer (typically 0.01–0.05) */
  topUp: boolean;
  /** Expiry as unix timestamp (anchor.BN) */
  validUntil: anchor.BN;
  /** RPC endpoint (needed by MB's internal provider) */
  connectionURL: string;
}

interface CloseSessionTokenParams {
  provider: anchor.AnchorProvider;
  sessionSigner: PublicKey;
  targetProgram: PublicKey;
  connectionURL: string;
}

// Shim — replace with real import when package is installed
async function loadMagicBlockSDK() {
  try {
    // Dynamic import so the app builds even without the package installed
    const sdk = await import("@magicblock-labs/gum-react-sdk" as any);
    return {
      createSessionTokenIx: sdk.createSessionTokenIx as (
        params: CreateSessionTokenParams
      ) => Promise<TransactionInstruction>,
      closeSessionTokenIx: sdk.closeSessionTokenIx as (
        params: CloseSessionTokenParams
      ) => Promise<TransactionInstruction>,
    };
  } catch {
    throw new Error(
      "MagicBlock SDK not installed. Run: yarn add @magicblock-labs/gum-react-sdk"
    );
  }
}

// ── MB Session Token PDA helper ────────────────────────────────────────────────
// MagicBlock derives the session token PDA using their own seeds.
// Replicating their derivation lets us read/pass the PDA without an SDK call.
const MB_SESSION_PROGRAM_ID = new PublicKey(
  // Replace with the actual deployed MB session-keys program ID from their docs
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
);

export function getMbSessionTokenPda(
  authority: PublicKey,
  sessionSigner: PublicKey,
  targetProgram: PublicKey
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from("session_token"),
      authority.toBuffer(),
      sessionSigner.toBuffer(),
      targetProgram.toBuffer(),
    ],
    MB_SESSION_PROGRAM_ID
  );
  return pda;
}

// ── createMbSession ────────────────────────────────────────────────────────────

export interface MbSessionResult {
  /** Transaction signature of the create_session tx */
  sig: string;
  /** Session token PDA (pass into open_cookie as session_token account) */
  tokenPda: PublicKey;
}

/**
 * Creates a MagicBlock-managed session token.
 * The main wallet signs once; the session keypair can then sign freely
 * until `validUntil` expires.
 *
 * @param connection     Solana connection
 * @param provider       AnchorProvider with main wallet attached
 * @param signTransaction  main wallet's signTransaction (from useWallet())
 * @param sessionSigner  ephemeral session keypair pubkey
 * @param targetProgramId  your Anchor program ID (scope per-program)
 * @param validUntilSec  unix timestamp; defaults to now + 3600
 */
export async function createMbSession(
  connection: Connection,
  provider: anchor.AnchorProvider,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  sessionSigner: PublicKey,
  targetProgramId: PublicKey,
  validUntilSec?: number
): Promise<MbSessionResult> {
  const { createSessionTokenIx } = await loadMagicBlockSDK();

  const validUntil = new anchor.BN(
    validUntilSec ?? Math.floor(Date.now() / 1000) + 3600
  );

  const ix = await createSessionTokenIx({
    provider,
    sessionSigner,
    targetProgram: targetProgramId,
    topUp: true,          // MB will fund the session signer from authority's wallet
    validUntil,
    connectionURL: connection.rpcEndpoint,
  });

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = provider.publicKey;

  const signed = await signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });

  const tokenPda = getMbSessionTokenPda(
    provider.publicKey,
    sessionSigner,
    targetProgramId
  );

  return { sig, tokenPda };
}

// ── revokeMbSession ────────────────────────────────────────────────────────────

export async function revokeMbSession(
  connection: Connection,
  provider: anchor.AnchorProvider,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  sessionSigner: PublicKey,
  targetProgramId: PublicKey
): Promise<string> {
  const { closeSessionTokenIx } = await loadMagicBlockSDK();

  const ix = await closeSessionTokenIx({
    provider,
    sessionSigner,
    targetProgram: targetProgramId,
    connectionURL: connection.rpcEndpoint,
  });

  const tx = new Transaction().add(ix);
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = provider.publicKey;

  const signed = await signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
  return sig;
}

// ── getMbSessionStatus ─────────────────────────────────────────────────────────

export interface MbSessionStatus {
  valid: boolean;
  validUntil: number;
  tokenPda: PublicKey;
}

/**
 * Check if a MagicBlock session token exists and is still valid.
 * Reads the MB session token account layout:
 *   8 disc | 32 authority | 32 session_signer | 32 target_program | 8 valid_until | ...
 */
export async function getMbSessionStatus(
  connection: Connection,
  authority: PublicKey,
  sessionSigner: PublicKey,
  targetProgramId: PublicKey
): Promise<MbSessionStatus> {
  const tokenPda = getMbSessionTokenPda(authority, sessionSigner, targetProgramId);
  const info = await connection.getAccountInfo(tokenPda);

  if (!info || info.data.length < 112) {
    return { valid: false, validUntil: 0, tokenPda };
  }

  // Offset: 8 disc + 32 + 32 + 32 = 104 → valid_until i64 LE
  const validUntil = Number(info.data.readBigInt64LE(104));
  const now = Math.floor(Date.now() / 1000);
  return { valid: validUntil > now + 60, validUntil, tokenPda };
}

// ── React hook ────────────────────────────────────────────────────────────────

import { useState, useCallback, useRef } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { getOrCreateSessionKeypair } from "./sessionKeyProvider";

const FORTUNE_PROGRAM_ID = new PublicKey(
  "DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85"
);

export interface MbSessionHook {
  sessionPubkey: PublicKey | null;
  tokenPda: PublicKey | null;
  isValid: boolean;
  isCreating: boolean;
  error: string | null;
  ensureMbSession: () => Promise<PublicKey | null>;
  revokeCurrentSession: () => Promise<void>;
}

export function useMagicBlockSession(): MbSessionHook {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();

  const sessionKp = useRef(getOrCreateSessionKeypair());
  const [tokenPda, setTokenPda] = useState<PublicKey | null>(null);
  const [isValid, setIsValid] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ensureMbSession = useCallback(async (): Promise<PublicKey | null> => {
    if (!publicKey || !signTransaction) return null;

    // Check cache
    const status = await getMbSessionStatus(
      connection,
      publicKey,
      sessionKp.current.publicKey,
      FORTUNE_PROGRAM_ID
    );

    if (status.valid) {
      setTokenPda(status.tokenPda);
      setIsValid(true);
      return status.tokenPda;
    }

    setIsCreating(true);
    setError(null);
    try {
      const dummyWallet = {
        publicKey,
        signTransaction,
        signAllTransactions: async (txs: Transaction[]) =>
          Promise.all(txs.map(signTransaction)),
      };
      const provider = new anchor.AnchorProvider(connection, dummyWallet as any, {
        commitment: "confirmed",
      });

      const { tokenPda: pda } = await createMbSession(
        connection,
        provider,
        signTransaction,
        sessionKp.current.publicKey,
        FORTUNE_PROGRAM_ID
      );
      setTokenPda(pda);
      setIsValid(true);
      return pda;
    } catch (err: any) {
      setError(err?.message ?? "Session creation failed");
      return null;
    } finally {
      setIsCreating(false);
    }
  }, [connection, publicKey, signTransaction]);

  const revokeCurrentSession = useCallback(async () => {
    if (!publicKey || !signTransaction) return;
    try {
      const dummyWallet = {
        publicKey,
        signTransaction,
        signAllTransactions: async (txs: Transaction[]) =>
          Promise.all(txs.map(signTransaction)),
      };
      const provider = new anchor.AnchorProvider(connection, dummyWallet as any, {});
      await revokeMbSession(
        connection,
        provider,
        signTransaction,
        sessionKp.current.publicKey,
        FORTUNE_PROGRAM_ID
      );
      setTokenPda(null);
      setIsValid(false);
    } catch (err: any) {
      setError(err?.message ?? "Revoke failed");
    }
  }, [connection, publicKey, signTransaction]);

  return {
    sessionPubkey: sessionKp.current.publicKey,
    tokenPda,
    isValid,
    isCreating,
    error,
    ensureMbSession,
    revokeCurrentSession,
  };
}
