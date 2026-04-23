/**
 * Durable Nonce pre-signing session.
 *
 * Batches N `open_cookie` transactions behind a single wallet prompt by using
 * one Solana nonce account per pre-signed tx. After setup, the user can crack
 * N cookies without another signature — the frontend just submits the next
 * pre-signed tx from a FIFO queue.
 *
 * Two wallet popups per session:
 *   1. Create + initialize N nonce accounts (and stats PDA if missing).
 *   2. Pre-sign N open_cookie txs, each with AdvanceNonceAccount as ix 0.
 *
 * After the queue drains, call `refillSession` to re-pre-sign on the same
 * nonce accounts (one popup).
 */

import {
  Connection,
  Keypair,
  NonceAccount,
  NONCE_ACCOUNT_LENGTH,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { IDL } from '@/hooks/fortune_cookie_idl';

export const DEFAULT_BATCH_SIZE = 5;
export const SESSION_STORAGE_PREFIX = 'fc_nonce_session:';

export interface SignerWallet {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions: (txs: Transaction[]) => Promise<Transaction[]>;
}

export interface SessionSlot {
  counter: string;
  archetype: number;
  cookiePda: string;
  noncePubkey: string;
  signedTxBase64: string;
}

export interface PresignedSession {
  userPubkey: string;
  programId: string;
  createdAt: number;
  nextIndex: number;
  slots: SessionSlot[];
  noncePubkeys: string[];
}

function storageKey(userPubkey: PublicKey, programId: PublicKey): string {
  return `${SESSION_STORAGE_PREFIX}${userPubkey.toBase58()}:${programId.toBase58()}`;
}

export function loadSession(
  userPubkey: PublicKey,
  programId: PublicKey,
): PresignedSession | null {
  if (typeof window === 'undefined') return null;
  const raw = window.localStorage.getItem(storageKey(userPubkey, programId));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as PresignedSession;
  } catch {
    return null;
  }
}

export function saveSession(session: PresignedSession): void {
  if (typeof window === 'undefined') return;
  const key = storageKey(
    new PublicKey(session.userPubkey),
    new PublicKey(session.programId),
  );
  window.localStorage.setItem(key, JSON.stringify(session));
}

export function clearSession(
  userPubkey: PublicKey,
  programId: PublicKey,
): void {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(storageKey(userPubkey, programId));
}

export function remainingSlots(session: PresignedSession | null): number {
  if (!session) return 0;
  return Math.max(0, session.slots.length - session.nextIndex);
}

function counterToLeBuffer(counter: bigint): Buffer {
  const bn = new anchor.BN(counter.toString());
  return bn.toArrayLike(Buffer, 'le', 8);
}

function deriveCookiePda(
  user: PublicKey,
  counter: bigint,
  programId: PublicKey,
): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [user.toBuffer(), Buffer.from('cookie'), counterToLeBuffer(counter)],
    programId,
  );
  return pda;
}

function deriveStatsPda(programId: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('stats')],
    programId,
  );
  return pda;
}

async function buildOpenCookieIx(
  program: anchor.Program,
  user: PublicKey,
  statsPda: PublicKey,
  cookiePda: PublicKey,
  archetype: number,
  counter: bigint,
): Promise<TransactionInstruction> {
  return program.methods
    .openCookie(archetype, new anchor.BN(counter.toString()))
    .accounts({
      user,
      cookie: cookiePda,
      stats: statsPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
}

async function confirmSignatures(
  connection: Connection,
  sigs: string[],
  blockhash: string,
  lastValidBlockHeight: number,
): Promise<void> {
  await Promise.all(
    sigs.map((signature) =>
      connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      ),
    ),
  );
}

/**
 * Phase A: create & initialize N nonce accounts (and stats PDA if missing).
 * One wallet popup via signAllTransactions.
 */
async function createNonceAccounts(
  connection: Connection,
  wallet: SignerWallet,
  programId: PublicKey,
  batchSize: number,
): Promise<Keypair[]> {
  const rent = await connection.getMinimumBalanceForRentExemption(
    NONCE_ACCOUNT_LENGTH,
  );
  const { blockhash, lastValidBlockHeight } =
    await connection.getLatestBlockhash('confirmed');

  const nonceKeypairs = Array.from({ length: batchSize }, () =>
    Keypair.generate(),
  );

  const statsPda = deriveStatsPda(programId);
  const statsInfo = await connection.getAccountInfo(statsPda);
  const needsStats = statsInfo === null;

  const provider = new anchor.AnchorProvider(
    connection,
    wallet as unknown as anchor.Wallet,
    { commitment: 'confirmed' },
  );
  const program = new anchor.Program(IDL as any, programId, provider);

  const txs: Transaction[] = [];

  if (needsStats) {
    const initStatsTx = await program.methods
      .initializeStats()
      .accounts({
        payer: wallet.publicKey,
        stats: statsPda,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    initStatsTx.feePayer = wallet.publicKey;
    initStatsTx.recentBlockhash = blockhash;
    txs.push(initStatsTx);
  }

  for (const nonceKp of nonceKeypairs) {
    const tx = new Transaction();
    tx.add(
      SystemProgram.createAccount({
        fromPubkey: wallet.publicKey,
        newAccountPubkey: nonceKp.publicKey,
        lamports: rent,
        space: NONCE_ACCOUNT_LENGTH,
        programId: SystemProgram.programId,
      }),
      SystemProgram.nonceInitialize({
        noncePubkey: nonceKp.publicKey,
        authorizedPubkey: wallet.publicKey,
      }),
    );
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = blockhash;
    tx.partialSign(nonceKp);
    txs.push(tx);
  }

  const signed = await wallet.signAllTransactions(txs);
  const sigs = await Promise.all(
    signed.map((tx) => connection.sendRawTransaction(tx.serialize())),
  );
  await confirmSignatures(connection, sigs, blockhash, lastValidBlockHeight);

  return nonceKeypairs;
}

/**
 * Phase B: read current nonce values + pre-sign N open_cookie txs.
 * One wallet popup via signAllTransactions.
 */
async function presignOpenBatch(
  connection: Connection,
  wallet: SignerWallet,
  programId: PublicKey,
  noncePubkeys: PublicKey[],
  baseCounter: bigint,
): Promise<SessionSlot[]> {
  const provider = new anchor.AnchorProvider(
    connection,
    wallet as unknown as anchor.Wallet,
    { commitment: 'confirmed' },
  );
  const program = new anchor.Program(IDL as any, programId, provider);
  const statsPda = deriveStatsPda(programId);

  const nonceValues: string[] = [];
  for (const noncePk of noncePubkeys) {
    const info = await connection.getAccountInfo(noncePk, 'confirmed');
    if (!info) {
      throw new Error(`Nonce account ${noncePk.toBase58()} not found`);
    }
    nonceValues.push(NonceAccount.fromAccountData(info.data).nonce);
  }

  const txs: Transaction[] = [];
  const pendingSlots: Omit<SessionSlot, 'signedTxBase64'>[] = [];

  for (let i = 0; i < noncePubkeys.length; i++) {
    const counter = baseCounter + BigInt(i);
    const archetype = i % 4;
    const cookiePda = deriveCookiePda(wallet.publicKey, counter, programId);

    const advanceIx = SystemProgram.nonceAdvance({
      noncePubkey: noncePubkeys[i],
      authorizedPubkey: wallet.publicKey,
    });
    const openIx = await buildOpenCookieIx(
      program,
      wallet.publicKey,
      statsPda,
      cookiePda,
      archetype,
      counter,
    );

    const tx = new Transaction();
    tx.add(advanceIx, openIx);
    tx.feePayer = wallet.publicKey;
    tx.recentBlockhash = nonceValues[i];

    txs.push(tx);
    pendingSlots.push({
      counter: counter.toString(),
      archetype,
      cookiePda: cookiePda.toBase58(),
      noncePubkey: noncePubkeys[i].toBase58(),
    });
  }

  const signed = await wallet.signAllTransactions(txs);

  return signed.map((tx, i) => ({
    ...pendingSlots[i],
    signedTxBase64: Buffer.from(
      tx.serialize({ requireAllSignatures: true, verifySignatures: false }),
    ).toString('base64'),
  }));
}

export interface CreateSessionOptions {
  connection: Connection;
  wallet: SignerWallet;
  programId: PublicKey;
  batchSize?: number;
}

export async function createSession({
  connection,
  wallet,
  programId,
  batchSize = DEFAULT_BATCH_SIZE,
}: CreateSessionOptions): Promise<PresignedSession> {
  if (batchSize < 1 || batchSize > 20) {
    throw new Error('batchSize must be between 1 and 20');
  }

  const nonceKeypairs = await createNonceAccounts(
    connection,
    wallet,
    programId,
    batchSize,
  );

  const baseCounter = BigInt(Date.now()) * 1000n;
  const slots = await presignOpenBatch(
    connection,
    wallet,
    programId,
    nonceKeypairs.map((kp) => kp.publicKey),
    baseCounter,
  );

  const session: PresignedSession = {
    userPubkey: wallet.publicKey.toBase58(),
    programId: programId.toBase58(),
    createdAt: Date.now(),
    nextIndex: 0,
    slots,
    noncePubkeys: nonceKeypairs.map((kp) => kp.publicKey.toBase58()),
  };
  saveSession(session);
  return session;
}

/**
 * Re-pre-sign a new batch on the same nonce accounts.
 * One wallet popup. Used after the queue drains.
 */
export async function refillSession(
  connection: Connection,
  wallet: SignerWallet,
  programId: PublicKey,
  existing: PresignedSession,
): Promise<PresignedSession> {
  const noncePubkeys = existing.noncePubkeys.map((s) => new PublicKey(s));
  const baseCounter = BigInt(Date.now()) * 1000n;

  const slots = await presignOpenBatch(
    connection,
    wallet,
    programId,
    noncePubkeys,
    baseCounter,
  );

  const session: PresignedSession = {
    ...existing,
    createdAt: Date.now(),
    nextIndex: 0,
    slots,
  };
  saveSession(session);
  return session;
}

export interface ConsumedSlot {
  signature: string;
  archetype: number;
  counter: string;
  cookiePda: string;
}

/**
 * Pop the next pre-signed tx from the queue and submit it.
 * No wallet interaction.
 */
export async function consumeNextSlot(
  connection: Connection,
  session: PresignedSession,
): Promise<ConsumedSlot> {
  if (session.nextIndex >= session.slots.length) {
    throw new Error('Session exhausted — refill or create a new session');
  }
  const slot = session.slots[session.nextIndex];
  const rawTx = Buffer.from(slot.signedTxBase64, 'base64');

  const signature = await connection.sendRawTransaction(rawTx, {
    skipPreflight: false,
    preflightCommitment: 'confirmed',
  });

  const latest = await connection.getLatestBlockhash('confirmed');
  const confirmation = await connection.confirmTransaction(
    {
      signature,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    'confirmed',
  );
  if (confirmation.value.err) {
    throw new Error(
      'Pre-signed tx failed: ' + JSON.stringify(confirmation.value.err),
    );
  }

  session.nextIndex += 1;
  saveSession(session);

  return {
    signature,
    archetype: slot.archetype,
    counter: slot.counter,
    cookiePda: slot.cookiePda,
  };
}
