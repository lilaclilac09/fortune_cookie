import { useCallback, useState, useEffect, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Keypair, Transaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { IDL } from './fortune_cookie_idl';
import { useWalletMode } from '@/components/WalletModeSelector';
import {
  getOrCreateSessionKeypair,
  getStatsShard,
  getSessionTokenPda,
  ensureSession,
} from '@/lib/sessionKeyProvider';
import { getSessionBalance, autoFundSessionIfNeeded } from '@/lib/session-wallet';

const PROGRAM_ID   = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');
const SLOT_HASHES  = new PublicKey('SysvarS1otHashes111111111111111111111111111');
const BLOCKHASH_TTL_MS = 30_000;
const MIN_BALANCE_SOL  = 0.005;

interface BlockhashCache {
  blockhash: string;
  lastValidBlockHeight: number;
  fetchedAt: number;
}

export interface FortuneCookieHook {
  recordFortune: (archetype: number) => Promise<string>;
  isLoading: boolean;
  error: string | null;
  sessionPubkey: PublicKey | null;
  sessionBalance: number;
  needsFunding: boolean;
  fundSession: () => Promise<void>;
  /** Set when the most recent recordFortune call is finalized on-chain. */
  lastConfirmedSig: string | null;
  /** Set when the most recent recordFortune call fails to confirm. */
  lastConfirmError: string | null;
}

export function useFortuneCookie(): FortuneCookieHook {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();
  const { mode, localWallet } = useWalletMode();

  const [isLoading,         setIsLoading]         = useState(false);
  const [error,             setError]             = useState<string | null>(null);
  const [sessionBalance,    setSessionBalance]    = useState(0);
  const [sessionKeypair,    setSessionKeypair]    = useState<Keypair | null>(null);
  const [lastConfirmedSig,  setLastConfirmedSig]  = useState<string | null>(null);
  const [lastConfirmError,  setLastConfirmError]  = useState<string | null>(null);

  const blockhashCacheRef      = useRef<BlockhashCache | null>(null);
  const shardsInitializedRef   = useRef<Set<number>>(new Set());
  const airdropAttemptedRef    = useRef(false);
  // Strictly monotonic counter for the cookie PDA seed. Date.now() granularity (ms)
  // is not enough on its own — two taps within the same ms would derive the same
  // PDA and the second init would fail with "account already in use", forcing
  // serial-only opens. Tracking the last value and bumping by 1 on a tie keeps
  // every tap unique without losing rough wall-clock ordering.
  const lastCounterRef         = useRef<number>(0);

  useEffect(() => {
    setSessionKeypair(getOrCreateSessionKeypair());
  }, []);

  // Balance polling — skip airdrop if a real wallet is connected (use fundSession instead)
  useEffect(() => {
    if (!sessionKeypair) return;
    const init = async () => {
      const bal = await getSessionBalance(connection, sessionKeypair.publicKey);
      setSessionBalance(bal);
      // Only attempt airdrop when NO main wallet is connected (demo/local-no-wallet flows)
      if (bal < MIN_BALANCE_SOL && !airdropAttemptedRef.current && !publicKey) {
        airdropAttemptedRef.current = true;
        const funded = await autoFundSessionIfNeeded(connection, sessionKeypair.publicKey);
        if (funded) {
          setSessionBalance(await getSessionBalance(connection, sessionKeypair.publicKey));
        }
      }
    };
    init().catch(() => {});
  }, [sessionKeypair, connection, publicKey]);

  useEffect(() => {
    if (!sessionKeypair) return;
    const id = setInterval(async () => {
      try {
        setSessionBalance(await getSessionBalance(connection, sessionKeypair.publicKey));
      } catch {}
    }, 15_000);
    return () => clearInterval(id);
  }, [sessionKeypair, connection]);

  const getFreshBlockhash = useCallback(async (): Promise<BlockhashCache> => {
    const now = Date.now();
    if (blockhashCacheRef.current && now - blockhashCacheRef.current.fetchedAt < BLOCKHASH_TTL_MS) {
      return blockhashCacheRef.current;
    }
    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');
    const cache = { blockhash, lastValidBlockHeight, fetchedAt: now };
    blockhashCacheRef.current = cache;
    return cache;
  }, [connection]);

  useEffect(() => {
    getFreshBlockhash().catch(() => {});
    const id = setInterval(() => getFreshBlockhash().catch(() => {}), BLOCKHASH_TTL_MS - 2000);
    return () => clearInterval(id);
  }, [getFreshBlockhash]);

  // Pre-warm shard cache so first tap doesn't wait on getAccountInfo
  useEffect(() => {
    if (!sessionKeypair) return;
    const authorityKey = (connected && publicKey) ? publicKey : sessionKeypair.publicKey;
    const { shardId, pda } = getStatsShard(authorityKey);
    if (shardsInitializedRef.current.has(shardId)) return;
    connection.getAccountInfo(pda).then(info => {
      if (info) shardsInitializedRef.current.add(shardId);
    }).catch(() => {});
  }, [sessionKeypair, connection, connected, publicKey]);

  const needsFunding = sessionBalance < MIN_BALANCE_SOL;

  const fundSession = useCallback(async () => {
    if (!sessionKeypair || !publicKey || !signTransaction) return;
    setIsLoading(true);
    setError(null);
    try {
      const { LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      const tx = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: sessionKeypair.publicKey,
          lamports: 0.05 * LAMPORTS_PER_SOL,
        }),
      );
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
      setSessionBalance(await getSessionBalance(connection, sessionKeypair.publicKey));
    } catch (err: any) {
      setError(err?.message || 'Funding failed');
    } finally {
      setIsLoading(false);
    }
  }, [sessionKeypair, publicKey, signTransaction, connection]);

  // Ensure the stats shard for `userPubkey` is initialized (lazy, cached per session)
  const ensureStatsShard = useCallback(
    async (
      program: anchor.Program<any>,
      signTx: (tx: Transaction) => Promise<Transaction>,
      userPubkey: PublicKey,
    ) => {
      const { shardId, pda } = getStatsShard(userPubkey);
      if (shardsInitializedRef.current.has(shardId)) return { shardId, pda };

      const info = await connection.getAccountInfo(pda);
      if (info) {
        shardsInitializedRef.current.add(shardId);
        return { shardId, pda };
      }

      // Shard missing — initialize it. We must verify the account exists before
      // marking the cache; otherwise a failed init poisons it and every later
      // open_cookie call fails with AccountNotInitialized.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx: Transaction = await (program.methods as any)
        .initializeStatsShard(shardId)
        .accounts({ payer: userPubkey, shard: pda, systemProgram: SystemProgram.programId })
        .transaction();
      const signed = await signTx(tx);
      try {
        await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
      } catch {
        // Another tab/session may have raced us. The recheck below decides.
      }

      // Poll for the shard account up to ~3s before giving up.
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 500));
        const recheck = await connection.getAccountInfo(pda);
        if (recheck) {
          shardsInitializedRef.current.add(shardId);
          return { shardId, pda };
        }
      }
      throw new Error(`Stats shard ${shardId} init did not land — try again`);
    },
    [connection],
  );

  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        // ── Determine signer + authority ────────────────────────────────────
        // Priority: session keypair (no popup) → local wallet → main wallet

        // Use polled balance (updated every 15s) — avoid a blocking RPC call per tap
        const liveBalance = sessionBalance;

        type SignerMode = 'session' | 'local' | 'wallet';
        let signerMode: SignerMode;
        let signerPubkey: PublicKey;
        let authorityPubkey: PublicKey;

        if (sessionKeypair && liveBalance >= MIN_BALANCE_SOL) {
          signerMode      = 'session';
          signerPubkey    = sessionKeypair.publicKey;
          // authority = main wallet if connected, else session key itself
          authorityPubkey = (connected && publicKey) ? publicKey : sessionKeypair.publicKey;
        } else if (mode === 'local' && localWallet) {
          signerMode      = 'local';
          signerPubkey    = localWallet.publicKey;
          authorityPubkey = localWallet.publicKey;
        } else if (connected && publicKey) {
          signerMode      = 'wallet';
          signerPubkey    = publicKey;
          authorityPubkey = publicKey;
        } else {
          throw new Error('No wallet connected');
        }

        // ── Sign helper ─────────────────────────────────────────────────────
        const signTx = async (tx: Transaction): Promise<Transaction> => {
          tx.feePayer = signerPubkey;
          const { blockhash } = await getFreshBlockhash();
          tx.recentBlockhash = tx.recentBlockhash ?? blockhash;

          if (signerMode === 'session' && sessionKeypair) {
            tx.partialSign(sessionKeypair);
            return tx;
          }
          if (signerMode === 'local' && localWallet) return localWallet.signTransaction(tx);
          if (signerMode === 'wallet' && signTransaction) return signTransaction(tx);
          throw new Error('No signer');
        };

        // ── Anchor program ──────────────────────────────────────────────────
        const dummyWallet = {
          publicKey: signerPubkey,
          signTransaction: signTx,
          signAllTransactions: async (txs: Transaction[]) => Promise.all(txs.map(signTx)),
        };
        const provider = new anchor.AnchorProvider(connection, dummyWallet as any, {
          commitment: 'processed',
        });
        const program = new anchor.Program(IDL as any, provider);

        // ── Session token (for session mode with a connected main wallet) ───
        let sessionTokenPda: PublicKey | null = null;
        if (signerMode === 'session' && connected && publicKey && signTransaction) {
          try {
            sessionTokenPda = await ensureSession(
              connection,
              program,
              publicKey,
              signTransaction,
              sessionKeypair!.publicKey,
            );
          } catch {
            // Fall through without session token: cookie owned by session key
          }
        }

        // ── Ensure shard is initialized ─────────────────────────────────────
        const { shardId, pda: statsShard } = await ensureStatsShard(
          program,
          signTx,
          authorityPubkey,
        );

        // ── PDAs ────────────────────────────────────────────────────────────
        const candidate = Date.now();
        const counterSeed =
          candidate > lastCounterRef.current ? candidate : lastCounterRef.current + 1;
        lastCounterRef.current = counterSeed;
        const [cookiePda] = PublicKey.findProgramAddressSync(
          [
            authorityPubkey.toBuffer(),
            Buffer.from('cookie'),
            new anchor.BN(counterSeed).toArrayLike(Buffer, 'le', 8),
          ],
          PROGRAM_ID,
        );

        const { blockhash, lastValidBlockHeight } = await getFreshBlockhash();

        // ── Build + sign + send ─────────────────────────────────────────────
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx: Transaction = await (program.methods as any)
          .openCookie(new anchor.BN(archetype), new anchor.BN(counterSeed), shardId)
          .accounts({
            signer:       signerPubkey,
            authority:    authorityPubkey,
            cookie:       cookiePda,
            statsShard,
            sessionToken: sessionTokenPda,
            slotHashes:   SLOT_HASHES,
            systemProgram: SystemProgram.programId,
          })
          .transaction();

        tx.recentBlockhash = blockhash;
        tx.feePayer = signerPubkey;

        const signedTx = await signTx(tx);
        const txSig = await connection.sendRawTransaction(signedTx.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        console.log(`⚡ [${signerMode}] TX:`, txSig);

        // Clear any previous confirmation state — this signature supersedes it.
        setLastConfirmedSig(null);
        setLastConfirmError(null);
        connection
          .confirmTransaction({ blockhash, lastValidBlockHeight, signature: txSig }, 'processed')
          .then(res => {
            if (res.value.err) {
              const msg = `On-chain error: ${JSON.stringify(res.value.err)}`;
              console.warn(msg);
              setLastConfirmError(msg);
            } else {
              console.log('✅ Confirmed:', txSig);
              setLastConfirmedSig(txSig);
            }
          })
          .catch(err => {
            const msg = err?.message || 'Confirmation timed out';
            console.warn('TX confirm failed:', msg);
            setLastConfirmError(msg);
          });

        if (signerMode === 'session' && sessionKeypair) {
          getSessionBalance(connection, sessionKeypair.publicKey)
            .then(setSessionBalance)
            .catch(() => {});
        }

        return txSig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        console.error('TX error:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [
      connection, publicKey, signTransaction, mode, localWallet,
      sessionKeypair, sessionBalance, getFreshBlockhash,
      connected, ensureStatsShard,
    ],
  );

  return {
    recordFortune,
    isLoading,
    error,
    sessionPubkey: sessionKeypair?.publicKey ?? null,
    sessionBalance,
    needsFunding,
    fundSession,
    lastConfirmedSig,
    lastConfirmError,
  };
}
