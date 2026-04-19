/**
 * Session Key Provider
 *
 * Manages on-chain SessionToken PDAs.  The main wallet signs once to create a
 * session token that authorizes an ephemeral keypair (stored in localStorage)
 * to sign open_cookie transactions for up to SESSION_TTL seconds.
 *
 * Flow:
 *   1. ensureSession(program, authority, signTransaction, sessionSigner)
 *      → creates SessionToken on-chain if missing/expired (one wallet popup)
 *   2. open_cookie uses sessionKeypair as tx signer, passes session_token PDA
 *   3. revokeSession() closes the PDA and reclaims rent
 *
 * NOTE: discriminators come from the IDL via program.methods.* — always
 * re-run `anchor build` and update fortune_cookie_idl.ts before deploying.
 */

import {
  Keypair,
  PublicKey,
  Transaction,
  Connection,
  SystemProgram,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');
const SESSION_TTL = 3600; // 1 hour in seconds

const SK_KEYPAIR_KEY   = 'fc_sk_keypair_v2';
const SK_VALID_UNTIL   = 'fc_sk_valid_until_v2';
const SK_AUTHORITY_KEY = 'fc_sk_authority_v2';

// ─── Keypair persistence ───────────────────────────────────────────────────────

export function getOrCreateSessionKeypair(): Keypair {
  if (typeof window === 'undefined') return Keypair.generate();
  const stored = localStorage.getItem(SK_KEYPAIR_KEY);
  if (stored) {
    try {
      return Keypair.fromSecretKey(new Uint8Array(JSON.parse(stored)));
    } catch {}
  }
  const kp = Keypair.generate();
  localStorage.setItem(SK_KEYPAIR_KEY, JSON.stringify(Array.from(kp.secretKey)));
  return kp;
}

export function clearSessionKeypair(): void {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(SK_KEYPAIR_KEY);
  localStorage.removeItem(SK_VALID_UNTIL);
  localStorage.removeItem(SK_AUTHORITY_KEY);
}

// ─── PDA derivation ────────────────────────────────────────────────────────────

export function getSessionTokenPda(authority: PublicKey, sessionSigner: PublicKey): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [authority.toBuffer(), sessionSigner.toBuffer(), Buffer.from('session')],
    PROGRAM_ID,
  );
  return pda;
}

/** Returns the shardId (0-63) and its PDA for a given user pubkey. */
export function getStatsShard(userPubkey: PublicKey): { shardId: number; pda: PublicKey } {
  const shardId = userPubkey.toBuffer()[0] % 64;
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('stats'), Buffer.from([shardId])],
    PROGRAM_ID,
  );
  return { shardId, pda };
}

// ─── On-chain session status ───────────────────────────────────────────────────

export interface SessionStatus {
  valid: boolean;
  validUntil: number; // unix timestamp, 0 if token doesn't exist
  tokenPda: PublicKey;
}

export async function getSessionStatus(
  connection: Connection,
  authority: PublicKey,
  sessionSigner: PublicKey,
): Promise<SessionStatus> {
  const tokenPda = getSessionTokenPda(authority, sessionSigner);
  const info = await connection.getAccountInfo(tokenPda);
  if (!info) return { valid: false, validUntil: 0, tokenPda };

  // SessionToken layout: 8 disc | 32 authority | 32 session_signer | 8 valid_until | 1 bump
  const validUntil = Number(info.data.readBigInt64LE(8 + 32 + 32));
  const now = Math.floor(Date.now() / 1000);
  return { valid: validUntil > now, validUntil, tokenPda };
}

// ─── Local cache helpers ───────────────────────────────────────────────────────

function isCachedSessionValid(authority: PublicKey): boolean {
  if (typeof window === 'undefined') return false;
  const storedAuthority = localStorage.getItem(SK_AUTHORITY_KEY);
  const storedUntil     = localStorage.getItem(SK_VALID_UNTIL);
  if (!storedAuthority || !storedUntil) return false;
  if (storedAuthority !== authority.toBase58()) return false;
  // Treat as invalid 60 s before expiry to avoid races
  return Number(storedUntil) > Math.floor(Date.now() / 1000) + 60;
}

function cacheSession(authority: PublicKey, validUntil: number): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SK_AUTHORITY_KEY, authority.toBase58());
  localStorage.setItem(SK_VALID_UNTIL, validUntil.toString());
}

// ─── create_session ────────────────────────────────────────────────────────────

/**
 * Sends a create_session transaction signed by the main wallet.
 * `program` must be built with an AnchorProvider whose wallet is authority.
 */
export async function createSession(
  connection: Connection,
  program: anchor.Program<any>,
  authority: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  sessionSigner: PublicKey,
  validUntil?: number,
): Promise<string> {
  const until = validUntil ?? Math.floor(Date.now() / 1000) + SESSION_TTL;
  const tokenPda = getSessionTokenPda(authority, sessionSigner);

  const tx: Transaction = await program.methods
    .createSession(new anchor.BN(until))
    .accounts({
      authority,
      sessionSigner,
      sessionToken: tokenPda,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = authority;

  const signed = await signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });

  cacheSession(authority, until);
  return sig;
}

// ─── revoke_session ────────────────────────────────────────────────────────────

export async function revokeSession(
  connection: Connection,
  program: anchor.Program<any>,
  authority: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  sessionSigner: PublicKey,
): Promise<string> {
  const tokenPda = getSessionTokenPda(authority, sessionSigner);

  const tx: Transaction = await program.methods
    .revokeSession()
    .accounts({ authority, sessionToken: tokenPda })
    .transaction();

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  tx.recentBlockhash = blockhash;
  tx.feePayer = authority;

  const signed = await signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });

  localStorage.removeItem(SK_VALID_UNTIL);
  localStorage.removeItem(SK_AUTHORITY_KEY);
  return sig;
}

// ─── ensureSession ─────────────────────────────────────────────────────────────

/**
 * Idempotent: creates the session token on-chain if missing or near-expired.
 * Returns the session token PDA to pass into open_cookie.
 * Triggers exactly one wallet popup when a new session is needed.
 */
export async function ensureSession(
  connection: Connection,
  program: anchor.Program<any>,
  authority: PublicKey,
  signTransaction: (tx: Transaction) => Promise<Transaction>,
  sessionSigner: PublicKey,
): Promise<PublicKey> {
  const tokenPda = getSessionTokenPda(authority, sessionSigner);

  if (isCachedSessionValid(authority)) return tokenPda;

  const status = await getSessionStatus(connection, authority, sessionSigner);
  if (status.valid) {
    cacheSession(authority, status.validUntil);
    return tokenPda;
  }

  await createSession(connection, program, authority, signTransaction, sessionSigner);
  return tokenPda;
}
