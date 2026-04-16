/**
 * Session wallet — burner keypair stored in localStorage.
 * User funds it once (0.05 SOL) from their main wallet.
 * Signs every game TX instantly, no popup.
 */
import { Keypair, PublicKey, Connection, SystemProgram, Transaction, LAMPORTS_PER_SOL } from '@solana/web3.js';

const SESSION_KEY = 'fc_session_keypair';
const MIN_BALANCE_LAMPORTS = 0.005 * LAMPORTS_PER_SOL; // warn below 0.005 SOL
const FUND_AMOUNT_LAMPORTS = 0.05 * LAMPORTS_PER_SOL;  // top up 0.05 SOL

export function getOrCreateSessionKeypair(): Keypair {
  if (typeof window === 'undefined') return Keypair.generate();
  const stored = localStorage.getItem(SESSION_KEY);
  if (stored) {
    try {
      const arr = JSON.parse(stored);
      return Keypair.fromSecretKey(new Uint8Array(arr));
    } catch {}
  }
  const kp = Keypair.generate();
  localStorage.setItem(SESSION_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

export function clearSessionKeypair() {
  if (typeof window !== 'undefined') localStorage.removeItem(SESSION_KEY);
}

export async function getSessionBalance(connection: Connection, pubkey: PublicKey): Promise<number> {
  const bal = await connection.getBalance(pubkey);
  return bal / LAMPORTS_PER_SOL;
}

/**
 * Silently airdrop devnet SOL to the session wallet if balance is low.
 * Uses the public devnet endpoint directly — Helius blocks requestAirdrop.
 */
export async function autoFundSessionIfNeeded(
  connection: Connection,
  pubkey: PublicKey,
): Promise<boolean> {
  try {
    const bal = await connection.getBalance(pubkey);
    if (bal >= MIN_BALANCE_LAMPORTS) return false; // already funded

    // Public devnet endpoint supports airdrops; Helius does not
    const devnetConnection = new Connection('https://api.devnet.solana.com', 'confirmed');
    const sig = await devnetConnection.requestAirdrop(pubkey, 0.5 * LAMPORTS_PER_SOL);
    const { blockhash, lastValidBlockHeight } = await devnetConnection.getLatestBlockhash();
    await devnetConnection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight }, 'confirmed');
    return true;
  } catch {
    return false;
  }
}

export async function fundSessionWallet(
  connection: Connection,
  sessionPubkey: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  fromPubkey: PublicKey,
): Promise<string> {
  const tx = new Transaction().add(
    SystemProgram.transfer({
      fromPubkey,
      toPubkey: sessionPubkey,
      lamports: FUND_AMOUNT_LAMPORTS,
    })
  );
  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = fromPubkey;
  const signed = await signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: false });
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
  return sig;
}

export const MIN_BALANCE_SOL = MIN_BALANCE_LAMPORTS / LAMPORTS_PER_SOL;
export const FUND_AMOUNT_SOL = FUND_AMOUNT_LAMPORTS / LAMPORTS_PER_SOL;
