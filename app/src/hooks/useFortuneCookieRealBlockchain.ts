import { useCallback, useState, useEffect, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Keypair, Transaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { IDL } from './fortune_cookie_idl';
import { useWalletMode } from '@/components/WalletModeSelector';
import { getOrCreateSessionKeypair, getSessionBalance, autoFundSessionIfNeeded, MIN_BALANCE_SOL } from '@/lib/session-wallet';

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');
const BLOCKHASH_TTL_MS = 30_000;

interface BlockhashCache {
  blockhash: string;
  lastValidBlockHeight: number;
  fetchedAt: number;
}

interface FortuneCookieHook {
  recordFortune: (archetype: number) => Promise<string>;
  isLoading: boolean;
  error: string | null;
  sessionPubkey: PublicKey | null;
  sessionBalance: number;
  needsFunding: boolean;
  fundSession: () => Promise<void>;
}

export function useFortuneCookie(): FortuneCookieHook {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction, connected } = useWallet();
  const { mode, localWallet } = useWalletMode();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionBalance, setSessionBalance] = useState(0);
  const [sessionKeypair, setSessionKeypair] = useState<Keypair | null>(null);

  const blockhashCacheRef = useRef<BlockhashCache | null>(null);
  const statsInitializedRef = useRef<boolean>(false);
  const airdropAttemptedRef = useRef(false);

  // Load session keypair on mount
  useEffect(() => {
    const kp = getOrCreateSessionKeypair();
    setSessionKeypair(kp);
  }, []);

  // Once connection is ready, fetch balance and auto-airdrop if needed (devnet only)
  useEffect(() => {
    if (!sessionKeypair) return;
    const init = async () => {
      const bal = await getSessionBalance(connection, sessionKeypair.publicKey);
      setSessionBalance(bal);
      if (bal < MIN_BALANCE_SOL && !airdropAttemptedRef.current) {
        airdropAttemptedRef.current = true;
        const funded = await autoFundSessionIfNeeded(connection, sessionKeypair.publicKey);
        if (funded) {
          const newBal = await getSessionBalance(connection, sessionKeypair.publicKey);
          setSessionBalance(newBal);
        }
      }
    };
    init().catch(() => {});
  }, [sessionKeypair, connection]);

  // Poll session balance every 15s
  useEffect(() => {
    if (!sessionKeypair) return;
    const id = setInterval(async () => {
      try {
        const bal = await getSessionBalance(connection, sessionKeypair.publicKey);
        setSessionBalance(bal);
      } catch {}
    }, 15_000);
    return () => clearInterval(id);
  }, [sessionKeypair, connection]);

  // Pre-fetch and cache blockhash
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

  // Warm blockhash cache
  useEffect(() => {
    getFreshBlockhash().catch(() => {});
    const id = setInterval(() => getFreshBlockhash().catch(() => {}), BLOCKHASH_TTL_MS - 2000);
    return () => clearInterval(id);
  }, [getFreshBlockhash]);

  const needsFunding = sessionBalance < MIN_BALANCE_SOL;

  // Manual top-up from connected wallet (one-time, requires one Solflare approval)
  const fundSession = useCallback(async () => {
    if (!sessionKeypair || !publicKey || !signTransaction) return;
    setIsLoading(true);
    setError(null);
    try {
      const { Transaction: Tx, SystemProgram: SP, LAMPORTS_PER_SOL } = await import('@solana/web3.js');
      const tx = new Tx().add(SP.transfer({
        fromPubkey: publicKey,
        toPubkey: sessionKeypair.publicKey,
        lamports: 0.05 * LAMPORTS_PER_SOL,
      }));
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.feePayer = publicKey;
      const signed = await signTransaction(tx);
      const sig = await connection.sendRawTransaction(signed.serialize());
      await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });
      const bal = await getSessionBalance(connection, sessionKeypair.publicKey);
      setSessionBalance(bal);
    } catch (err: any) {
      setError(err?.message || 'Funding failed');
    } finally {
      setIsLoading(false);
    }
  }, [sessionKeypair, publicKey, signTransaction, connection]);

  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        // ── Determine signer ─────────────────────────────────────────────
        // 1. Session keypair  — instant, no popup (funded burner in localStorage)
        // 2. Local dev wallet — instant, no popup (mock keypair)
        // 3. Solflare         — popup (last resort)

        // Always read live balance — React state can lag on first click
        let liveBalance = sessionBalance;
        if (sessionKeypair) {
          try {
            liveBalance = await getSessionBalance(connection, sessionKeypair.publicKey);
            setSessionBalance(liveBalance);
          } catch {}
        }

        let signerType: 'session' | 'local' | 'solflare';
        let userPubkey: PublicKey;

        if (sessionKeypair && liveBalance >= MIN_BALANCE_SOL) {
          signerType = 'session';
          userPubkey = sessionKeypair.publicKey;
        } else if (mode === 'local' && localWallet) {
          signerType = 'local';
          userPubkey = localWallet.publicKey;
        } else if (connected && publicKey) {
          signerType = 'solflare';
          userPubkey = publicKey;
        } else {
          throw new Error('No wallet connected');
        }

        // ── PDAs ─────────────────────────────────────────────────────────
        const counterSeed = Math.floor(Date.now() / 1000);
        const [statsAccount] = PublicKey.findProgramAddressSync([Buffer.from('stats')], PROGRAM_ID);
        const [cookieAccount] = PublicKey.findProgramAddressSync(
          [userPubkey.toBuffer(), Buffer.from('cookie'), new anchor.BN(counterSeed).toArrayLike(Buffer, 'le', 8)],
          PROGRAM_ID
        );
        const { blockhash, lastValidBlockHeight } = await getFreshBlockhash();

        // ── Signer helper ─────────────────────────────────────────────────
        const signTx = async (tx: Transaction): Promise<Transaction> => {
          tx.feePayer = userPubkey;
          tx.recentBlockhash = blockhash;
          if (signerType === 'session' && sessionKeypair) {
            tx.partialSign(sessionKeypair);
            return tx;
          }
          if (signerType === 'local' && localWallet) return localWallet.signTransaction(tx);
          if (signerType === 'solflare' && signTransaction) return signTransaction(tx);
          throw new Error('No signer available');
        };

        // ── Anchor provider (uses our signTx so no wallet popup from Anchor) ──
        const dummyWallet = {
          publicKey: userPubkey,
          signTransaction: signTx,
          signAllTransactions: async (txs: Transaction[]) => Promise.all(txs.map(signTx)),
        };
        const provider = new anchor.AnchorProvider(connection, dummyWallet as any, { commitment: 'processed' });
        const program = new anchor.Program(IDL as any, provider);

        // ── Init stats account once ──────────────────────────────────────
        if (!statsInitializedRef.current) {
          const info = await connection.getAccountInfo(statsAccount);
          if (!info) {
            try {
              const initTx = await program.methods
                .initializeStats()
                .accounts({ payer: userPubkey, stats: statsAccount, systemProgram: SystemProgram.programId })
                .transaction();
              const signedInit = await signTx(initTx);
              await connection.sendRawTransaction(signedInit.serialize(), { skipPreflight: true });
              await new Promise(r => setTimeout(r, 1500));
            } catch {}
          }
          statsInitializedRef.current = true;
        }

        // ── Build + sign + send ──────────────────────────────────────────
        const tx = await program.methods
          .openCookie(new anchor.BN(archetype), new anchor.BN(counterSeed))
          .accounts({ user: userPubkey, cookie: cookieAccount, stats: statsAccount, systemProgram: SystemProgram.programId })
          .transaction();

        const signedTx = await signTx(tx);
        const txSig = await connection.sendRawTransaction(signedTx.serialize(), { skipPreflight: true, maxRetries: 3 });

        console.log(`⚡ [${signerType}] TX:`, txSig);

        connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: txSig }, 'processed')
          .then(res => {
            if (res.value.err) console.warn('TX error:', res.value.err);
            else console.log('✅ Confirmed:', txSig);
          });

        if (signerType === 'session' && sessionKeypair) {
          getSessionBalance(connection, sessionKeypair.publicKey).then(setSessionBalance).catch(() => {});
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
    [connection, publicKey, signTransaction, sendTransaction, mode, localWallet,
     sessionKeypair, sessionBalance, getFreshBlockhash, connected]
  );

  return {
    recordFortune,
    isLoading,
    error,
    sessionPubkey: sessionKeypair?.publicKey ?? null,
    sessionBalance,
    needsFunding,
    fundSession,
  };
}
