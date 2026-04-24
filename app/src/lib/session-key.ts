/**
 * Session Key authorization.
 *
 * Sign once to authorize an ephemeral browser-held keypair; the session key
 * then signs every subsequent `open_cookie_via_session` call on behalf of
 * the user — no wallet popup until the session expires or is revoked.
 *
 * Flow:
 *   1. `authorizeSession` — wallet popup. Creates a session PDA
 *      `[user, b"session"]` that records `(user, session_key, expires_at)`
 *      and transfers a small SOL allowance to the session key so it can pay
 *      its own fees + cookie-account rent.
 *   2. `openViaSession` — no wallet popup. The session key signs, the on-chain
 *      program verifies `session.session_key == signer` and `now < expires_at`.
 *   3. `revokeSession` — wallet popup. Closes the PDA, refunds rent to user,
 *      and (best-effort) sweeps remaining session-key balance back to user.
 *
 * Security notes: the session key's secret is stored in localStorage. If an
 * attacker reads it they can call `open_cookie_via_session` until expiry —
 * damage is bounded to the session key's SOL allowance plus rent on newly
 * created cookie PDAs. Keep the default duration short (we use 1 hour here).
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { IDL } from '@/hooks/fortune_cookie_idl';

export const SESSION_STORAGE_PREFIX = 'fc_session_key:';
export const DEFAULT_SESSION_DURATION_SEC = 60 * 60; // 1 hour
export const DEFAULT_SESSION_FUNDING_LAMPORTS = 20_000_000; // 0.02 SOL

export interface SignerWallet {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]>;
}

export interface StoredSessionKey {
  userPubkey: string;
  programId: string;
  sessionKeySecret: number[];
  sessionPda: string;
  expiresAt: number;
  nextCounter: string;
  fundedLamports: number;
  createdAt: number;
}

function storageKey(userPubkey: PublicKey, programId: PublicKey): string {
  return `${SESSION_STORAGE_PREFIX}${userPubkey.toBase58()}:${programId.toBase58()}`;
}

export function loadSessionKey(
  userPubkey: PublicKey,
  programId: PublicKey,
): StoredSessionKey | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(storageKey(userPubkey, programId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredSessionKey;
  } catch {
    return null;
  }
}

export function saveSessionKey(stored: StoredSessionKey): void {
  if (typeof window === 'undefined') return;
  const key = storageKey(
    new PublicKey(stored.userPubkey),
    new PublicKey(stored.programId),
  );
  window.localStorage.setItem(key, JSON.stringify(stored));
}

export function clearSessionKey(
  userPubkey: PublicKey,
  programId: PublicKey,
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(userPubkey, programId));
}

export function isSessionKeyValid(
  stored: StoredSessionKey | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): boolean {
  return !!stored && stored.expiresAt > nowSeconds;
}

export function secondsUntilExpiry(
  stored: StoredSessionKey | null,
  nowSeconds: number = Math.floor(Date.now() / 1000),
): number {
  if (!stored) return 0;
  return Math.max(0, stored.expiresAt - nowSeconds);
}

function keypairFromStored(stored: StoredSessionKey): Keypair {
  return Keypair.fromSecretKey(Uint8Array.from(stored.sessionKeySecret));
}

function deriveSessionPda(
  user: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [user.toBuffer(), Buffer.from('session')],
    programId,
  );
}

function deriveStatsPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('stats')],
    programId,
  );
  return pda;
}

function deriveCookiePda(
  user: PublicKey,
  counter: bigint,
  programId: PublicKey,
): PublicKey {
  const counterBytes = new anchor.BN(counter.toString()).toArrayLike(
    Buffer,
    'le',
    8,
  );
  const [pda] = PublicKey.findProgramAddressSync(
    [user.toBuffer(), Buffer.from('cookie'), counterBytes],
    programId,
  );
  return pda;
}

function makeProgram(
  connection: Connection,
  wallet: SignerWallet,
  programId: PublicKey,
): anchor.Program {
  const provider = new anchor.AnchorProvider(
    connection,
    wallet as unknown as anchor.Wallet,
    { commitment: 'confirmed' },
  );
  return new anchor.Program(IDL as any, programId, provider);
}

export interface AuthorizeOptions {
  connection: Connection;
  wallet: SignerWallet;
  programId: PublicKey;
  durationSeconds?: number;
  fundingLamports?: number;
}

export async function authorizeSession({
  connection,
  wallet,
  programId,
  durationSeconds = DEFAULT_SESSION_DURATION_SEC,
  fundingLamports = DEFAULT_SESSION_FUNDING_LAMPORTS,
}: AuthorizeOptions): Promise<StoredSessionKey> {
  const sessionKey = Keypair.generate();
  const [sessionPda] = deriveSessionPda(wallet.publicKey, programId);
  const statsPda = deriveStatsPda(programId);
  const program = makeProgram(connection, wallet, programId);

  const authorizeIx = await program.methods
    .authorizeSession(sessionKey.publicKey, new anchor.BN(durationSeconds))
    .accounts({
      user: wallet.publicKey,
      session: sessionPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const fundIx = SystemProgram.transfer({
    fromPubkey: wallet.publicKey,
    toPubkey: sessionKey.publicKey,
    lamports: fundingLamports,
  });

  const tx = new Transaction().add(authorizeIx, fundIx);

  const statsInfo = await connection.getAccountInfo(statsPda);
  if (!statsInfo) {
    const initStatsIx = await program.methods
      .initializeStats()
      .accounts({
        payer: wallet.publicKey,
        stats: statsPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();
    tx.instructions.unshift(initStatsIx);
  }

  const latest = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = latest.blockhash;

  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  const conf = await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed',
  );
  if (conf.value.err) {
    throw new Error(
      'authorize_session failed: ' + JSON.stringify(conf.value.err),
    );
  }

  const expiresAt = Math.floor(Date.now() / 1000) + durationSeconds;
  const stored: StoredSessionKey = {
    userPubkey: wallet.publicKey.toBase58(),
    programId: programId.toBase58(),
    sessionKeySecret: Array.from(sessionKey.secretKey),
    sessionPda: sessionPda.toBase58(),
    expiresAt,
    nextCounter: (BigInt(Date.now()) * 1000n).toString(),
    fundedLamports: fundingLamports,
    createdAt: Date.now(),
  };
  saveSessionKey(stored);
  return stored;
}

export interface OpenViaSessionResult {
  signature: string;
  archetype: number;
  counter: string;
  cookiePda: string;
}

export async function openViaSession(
  connection: Connection,
  stored: StoredSessionKey,
  programId: PublicKey,
  archetype: number,
): Promise<OpenViaSessionResult> {
  if (!isSessionKeyValid(stored)) {
    throw new Error('Session expired — re-authorize');
  }

  const sessionKp = keypairFromStored(stored);
  const user = new PublicKey(stored.userPubkey);
  const sessionPda = new PublicKey(stored.sessionPda);
  const statsPda = deriveStatsPda(programId);

  const counter = BigInt(stored.nextCounter);
  const cookiePda = deriveCookiePda(user, counter, programId);

  // Build with a minimal "read-only" provider — we sign manually with session key.
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: sessionKp.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(sessionKp);
        return tx;
      },
      signAllTransactions: async (txs: Transaction[]) => {
        for (const tx of txs) tx.partialSign(sessionKp);
        return txs;
      },
    } as any,
    { commitment: 'confirmed' },
  );
  const program = new anchor.Program(IDL as any, programId, provider);

  const openIx = await program.methods
    .openCookieViaSession(archetype, new anchor.BN(counter.toString()))
    .accounts({
      sessionKey: sessionKp.publicKey,
      user,
      session: sessionPda,
      cookie: cookiePda,
      stats: statsPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(openIx);
  const latest = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = sessionKp.publicKey;
  tx.recentBlockhash = latest.blockhash;
  tx.sign(sessionKp);

  const sig = await connection.sendRawTransaction(tx.serialize());
  const conf = await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed',
  );
  if (conf.value.err) {
    throw new Error(
      'open_cookie_via_session failed: ' + JSON.stringify(conf.value.err),
    );
  }

  const next = counter + 1n;
  saveSessionKey({ ...stored, nextCounter: next.toString() });

  return {
    signature: sig,
    archetype,
    counter: counter.toString(),
    cookiePda: cookiePda.toBase58(),
  };
}

export async function revokeSession(
  connection: Connection,
  wallet: SignerWallet,
  programId: PublicKey,
  stored: StoredSessionKey,
): Promise<string> {
  const sessionKp = keypairFromStored(stored);
  const sessionPda = new PublicKey(stored.sessionPda);
  const program = makeProgram(connection, wallet, programId);

  const revokeIx = await program.methods
    .revokeSession()
    .accounts({
      user: wallet.publicKey,
      session: sessionPda,
    })
    .instruction();

  const tx = new Transaction().add(revokeIx);

  // Best-effort sweep of session-key balance back to user (minus ~5000 lamport fee).
  const balance = await connection.getBalance(sessionKp.publicKey, 'confirmed');
  const sweepAmount = balance - 5000;
  if (sweepAmount > 0) {
    tx.add(
      SystemProgram.transfer({
        fromPubkey: sessionKp.publicKey,
        toPubkey: wallet.publicKey,
        lamports: sweepAmount,
      }),
    );
  }

  const latest = await connection.getLatestBlockhash('confirmed');
  tx.feePayer = wallet.publicKey;
  tx.recentBlockhash = latest.blockhash;

  if (sweepAmount > 0) tx.partialSign(sessionKp);
  const signed = await wallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  const conf = await connection.confirmTransaction(
    {
      signature: sig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed',
  );
  if (conf.value.err) {
    throw new Error('revoke_session failed: ' + JSON.stringify(conf.value.err));
  }

  clearSessionKey(new PublicKey(stored.userPubkey), programId);
  return sig;
}
