/**
 * Prepaid balance + treasury fee path.
 *
 * User signs once to `deposit` SOL into their balance PDA (and once more for
 * `authorize_session`, or combine both in a single tx). From then on, every
 * `open_cookie_prepaid` call is signed only by the session key:
 *   - the balance PDA funds the cookie account's rent,
 *   - the balance PDA also pays FEE_LAMPORTS to the global treasury PDA,
 *   - session key signs the tx and pays the ~5000-lamport base fee.
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { IDL } from '@/hooks/fortune_cookie_idl';
import { saveSessionKey, type StoredSessionKey } from '@/lib/session-key';

export const FEE_LAMPORTS = 500_000; // 0.0005 SOL — must match program const
export const COOKIE_ACCOUNT_SPACE = 8 + 32 + 1 + 8 + 1 + 1;

// Rent for cookie account, at 19.055441 lamports/byte/year rent-exempt minimum.
// Solana's rent-exempt formula: ACCOUNT_STORAGE_OVERHEAD (128) + space, times
// 19.055441 lamports/byte × 2 years. We conservatively estimate 1_200_000 lamports
// and fetch the authoritative value from the RPC when we need to be precise.
export const COOKIE_RENT_ESTIMATE_LAMPORTS = 1_200_000;

export const COST_PER_OPEN_ESTIMATE =
  COOKIE_RENT_ESTIMATE_LAMPORTS + FEE_LAMPORTS;

export interface SignerWallet {
  publicKey: PublicKey;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
  signAllTransactions?: (txs: Transaction[]) => Promise<Transaction[]>;
}

export function deriveBalancePda(
  user: PublicKey,
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [user.toBuffer(), Buffer.from('balance')],
    programId,
  );
}

export function deriveTreasuryPda(
  programId: PublicKey,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('treasury')],
    programId,
  );
}

export async function getPrepaidBalanceLamports(
  connection: Connection,
  user: PublicKey,
  programId: PublicKey,
): Promise<number> {
  const [pda] = deriveBalancePda(user, programId);
  return connection.getBalance(pda, 'confirmed');
}

export async function getTreasuryLamports(
  connection: Connection,
  programId: PublicKey,
): Promise<number> {
  const [pda] = deriveTreasuryPda(programId);
  return connection.getBalance(pda, 'confirmed');
}

export function estimateRemainingOpens(balanceLamports: number): number {
  if (balanceLamports <= 0) return 0;
  return Math.floor(balanceLamports / COST_PER_OPEN_ESTIMATE);
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

export async function deposit(
  connection: Connection,
  wallet: SignerWallet,
  programId: PublicKey,
  amountLamports: number,
): Promise<string> {
  if (amountLamports <= 0) throw new Error('Amount must be > 0');
  const program = makeProgram(connection, wallet, programId);
  const [balancePda] = deriveBalancePda(wallet.publicKey, programId);

  const ix = await program.methods
    .deposit(new anchor.BN(amountLamports))
    .accounts({
      user: wallet.publicKey,
      balance: balancePda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(ix);
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
    throw new Error('deposit failed: ' + JSON.stringify(conf.value.err));
  }
  return sig;
}

export async function withdraw(
  connection: Connection,
  wallet: SignerWallet,
  programId: PublicKey,
  amountLamports: number,
): Promise<string> {
  if (amountLamports <= 0) throw new Error('Amount must be > 0');
  const program = makeProgram(connection, wallet, programId);
  const [balancePda] = deriveBalancePda(wallet.publicKey, programId);

  const ix = await program.methods
    .withdraw(new anchor.BN(amountLamports))
    .accounts({
      user: wallet.publicKey,
      balance: balancePda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();

  const tx = new Transaction().add(ix);
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
    throw new Error('withdraw failed: ' + JSON.stringify(conf.value.err));
  }
  return sig;
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

export interface PrepaidOpenResult {
  signature: string;
  archetype: number;
  counter: string;
  cookiePda: string;
  feePaidLamports: number;
}

/**
 * Open a cookie paid from the user's balance PDA. Signed by the session key;
 * user wallet never prompts.
 */
export async function openPrepaid(
  connection: Connection,
  stored: StoredSessionKey,
  programId: PublicKey,
  archetype: number,
): Promise<PrepaidOpenResult> {
  const sessionKp = Keypair.fromSecretKey(Uint8Array.from(stored.sessionKeySecret));
  const user = new PublicKey(stored.userPubkey);
  const sessionPda = new PublicKey(stored.sessionPda);
  const statsPda = deriveStatsPda(programId);
  const [balancePda] = deriveBalancePda(user, programId);
  const [treasuryPda] = deriveTreasuryPda(programId);

  const counter = BigInt(stored.nextCounter);
  const cookiePda = deriveCookiePda(user, counter, programId);

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
    .openCookiePrepaid(archetype, new anchor.BN(counter.toString()))
    .accounts({
      sessionKey: sessionKp.publicKey,
      user,
      session: sessionPda,
      balance: balancePda,
      treasury: treasuryPda,
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
      'open_cookie_prepaid failed: ' + JSON.stringify(conf.value.err),
    );
  }

  saveSessionKey({ ...stored, nextCounter: (counter + 1n).toString() });

  return {
    signature: sig,
    archetype,
    counter: counter.toString(),
    cookiePda: cookiePda.toBase58(),
    feePaidLamports: FEE_LAMPORTS,
  };
}

export function lamportsToSol(lamports: number): string {
  return (lamports / LAMPORTS_PER_SOL).toFixed(4);
}
