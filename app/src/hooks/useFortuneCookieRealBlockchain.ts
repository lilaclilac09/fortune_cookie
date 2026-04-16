import { useCallback, useState, useEffect, useRef } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Keypair } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { IDL } from './fortune_cookie_idl';
import { useWalletMode } from '@/components/WalletModeSelector';
import { getOrCreateSessionKeypair, fundSessionWallet, getSessionBalance, autoFundSessionIfNeeded, MIN_BALANCE_SOL, FUND_AMOUNT_SOL } from '@/lib/session-wallet';

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');
const BLOCKHASH_TTL_MS = 30_000; // refresh blockhash every 30s

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

  // Load session keypair on mount
  useEffect(() => {
    const kp = getOrCreateSessionKeypair();
    setSessionKeypair(kp);
  }, []);

  // Once we have both keypair and connection, check balance + auto-airdrop if needed
  useEffect(() => {
    if (!sessionKeypair) return;
    const init = async () => {
      const bal = await getSessionBalance(connection, sessionKeypair.publicKey);
      setSessionBalance(bal);
      if (bal < MIN_BALANCE_SOL) {
        const funded = await autoFundSessionIfNeeded(connection, sessionKeypair.publicKey);
        if (funded) {
          const newBal = await getSessionBalance(connection, sessionKeypair.publicKey);
          setSessionBalance(newBal);
        }
      }
    };
    init().catch(() => {});
  }, [sessionKeypair, connection]);

  // Poll session balance
  useEffect(() => {
    if (!sessionKeypair) return;
    const refresh = async () => {
      try {
        const bal = await getSessionBalance(connection, sessionKeypair.publicKey);
        setSessionBalance(bal);
      } catch {}
    };
    refresh();
    const id = setInterval(refresh, 15_000);
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

  // Warm up blockhash cache when connected
  useEffect(() => {
    getFreshBlockhash().catch(() => {});
    const id = setInterval(() => getFreshBlockhash().catch(() => {}), BLOCKHASH_TTL_MS - 2000);
    return () => clearInterval(id);
  }, [getFreshBlockhash]);

  const needsFunding = sessionBalance < MIN_BALANCE_SOL;

  const fundSession = useCallback(async () => {
    if (!sessionKeypair || !publicKey || !signTransaction) return;
    setIsLoading(true);
    setError(null);
    try {
      await fundSessionWallet(connection, sessionKeypair.publicKey, signTransaction, publicKey);
      const bal = await getSessionBalance(connection, sessionKeypair.publicKey);
      setSessionBalance(bal);
    } catch (err: any) {
      setError(err?.message || 'Funding failed');
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [sessionKeypair, publicKey, signTransaction, connection]);

  const buildProgram = useCallback((signerKeypair: Keypair) => {
    const wallet = {
      publicKey: signerKeypair.publicKey,
      signTransaction: async (tx: any) => { tx.partialSign(signerKeypair); return tx; },
      signAllTransactions: async (txs: any[]) => { txs.forEach(tx => tx.partialSign(signerKeypair)); return txs; },
    };
    const provider = new anchor.AnchorProvider(connection, wallet as any, { commitment: 'processed' });
    return new anchor.Program(IDL as any, provider);
  }, [connection]);

  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        // Pick signer: session key (no popup) > local wallet > Solflare
        let signerKeypair: Keypair | null = null;
        let userPubkey: PublicKey;

        // Always fetch live balance — React state can be stale on first click
        let liveSessionBalance = sessionBalance;
        if (sessionKeypair) {
          try {
            liveSessionBalance = await getSessionBalance(connection, sessionKeypair.publicKey);
            setSessionBalance(liveSessionBalance);
          } catch {}
        }

        const useSession = sessionKeypair && liveSessionBalance >= MIN_BALANCE_SOL;

        if (useSession && sessionKeypair) {
          signerKeypair = sessionKeypair;
          userPubkey = sessionKeypair.publicKey;
        } else if (mode === 'local' && localWallet) {
          // local dev wallet
          userPubkey = localWallet.publicKey;
        } else if (connected && publicKey) {
          // Solflare — will show popup
          userPubkey = publicKey;
        } else {
          throw new Error('No wallet connected');
        }

        const counterSeed = Math.floor(Date.now() / 1000);

        const [statsAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from('stats')],
          PROGRAM_ID
        );
        const [cookieAccount] = PublicKey.findProgramAddressSync(
          [
            userPubkey.toBuffer(),
            Buffer.from('cookie'),
            new anchor.BN(counterSeed).toArrayLike(Buffer, 'le', 8),
          ],
          PROGRAM_ID
        );

        // Get blockhash from cache (fast)
        const { blockhash, lastValidBlockHeight } = await getFreshBlockhash();

        if (signerKeypair) {
          // --- Session key path: instant, no popup ---
          const program = buildProgram(signerKeypair);

          // Init stats once, cache the result
          if (!statsInitializedRef.current) {
            const info = await connection.getAccountInfo(statsAccount);
            if (!info) {
              try {
                const initTx = await program.methods
                  .initializeStats()
                  .accounts({ payer: userPubkey, stats: statsAccount, systemProgram: SystemProgram.programId })
                  .transaction();
                const bh = await getFreshBlockhash();
                initTx.feePayer = userPubkey;
                initTx.recentBlockhash = bh.blockhash;
                initTx.partialSign(signerKeypair);
                await connection.sendRawTransaction(initTx.serialize(), { skipPreflight: true });
                await new Promise(r => setTimeout(r, 1500));
              } catch {}
            }
            statsInitializedRef.current = true;
          }

          const tx = await program.methods
            .openCookie(new anchor.BN(archetype), new anchor.BN(counterSeed))
            .accounts({ user: userPubkey, cookie: cookieAccount, stats: statsAccount, systemProgram: SystemProgram.programId })
            .transaction();

          tx.feePayer = userPubkey;
          tx.recentBlockhash = blockhash;
          tx.partialSign(signerKeypair);

          const txSig = await connection.sendRawTransaction(tx.serialize(), {
            skipPreflight: true,   // skip simulation for speed
            maxRetries: 3,
          });

          console.log('⚡ Session TX sent:', txSig);

          // Optimistic: confirm at 'processed' (~400ms) not 'confirmed' (10-30s)
          connection.confirmTransaction(
            { blockhash, lastValidBlockHeight, signature: txSig },
            'processed'
          ).then(res => {
            if (res.value.err) console.warn('TX finalization error:', res.value.err);
            else console.log('✅ Confirmed:', txSig);
          });

          // Refresh session balance in background
          getSessionBalance(connection, signerKeypair.publicKey)
            .then(setSessionBalance)
            .catch(() => {});

          return txSig;

        } else if (mode === 'local' && localWallet) {
          // --- Local wallet path ---
          const wallet = {
            publicKey: localWallet.publicKey,
            signTransaction: (tx: any) => localWallet.signTransaction(tx),
            signAllTransactions: (txs: any) => localWallet.signAllTransactions(txs),
          };
          const provider = new anchor.AnchorProvider(connection, wallet as any, { commitment: 'processed' });
          const program = new anchor.Program(IDL as any, provider);

          if (!statsInitializedRef.current) {
            const info = await connection.getAccountInfo(statsAccount);
            if (!info) {
              try {
                const initTx = await program.methods
                  .initializeStats()
                  .accounts({ payer: userPubkey, stats: statsAccount, systemProgram: SystemProgram.programId })
                  .transaction();
                initTx.feePayer = userPubkey;
                initTx.recentBlockhash = blockhash;
                const signed = await localWallet.signTransaction(initTx);
                await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true });
                await new Promise(r => setTimeout(r, 1500));
              } catch {}
            }
            statsInitializedRef.current = true;
          }

          const tx = await program.methods
            .openCookie(new anchor.BN(archetype), new anchor.BN(counterSeed))
            .accounts({ user: userPubkey, cookie: cookieAccount, stats: statsAccount, systemProgram: SystemProgram.programId })
            .transaction();

          tx.feePayer = userPubkey;
          tx.recentBlockhash = blockhash;
          const signed = await localWallet.signTransaction(tx);
          const txSig = await connection.sendRawTransaction(signed.serialize(), { skipPreflight: true, maxRetries: 3 });
          console.log('⚡ Local TX sent:', txSig);

          connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: txSig }, 'processed')
            .then(res => { if (res.value.err) console.warn('TX error:', res.value.err); });

          return txSig;

        } else {
          // --- Solflare path (popup) — fallback when session not funded ---
          if (!signTransaction || !sendTransaction || !publicKey) throw new Error('Wallet not connected');

          const provider = new anchor.AnchorProvider(
            connection,
            { publicKey, signTransaction, signAllTransactions: async (txs: any[]) => { const r=[]; for(const t of txs) r.push(await signTransaction(t)); return r; } } as any,
            { commitment: 'processed' }
          );
          const program = new anchor.Program(IDL as any, provider);

          if (!statsInitializedRef.current) {
            const info = await connection.getAccountInfo(statsAccount);
            if (!info) {
              try {
                const initTx = await program.methods
                  .initializeStats()
                  .accounts({ payer: publicKey, stats: statsAccount, systemProgram: SystemProgram.programId })
                  .transaction();
                initTx.feePayer = publicKey;
                initTx.recentBlockhash = blockhash;
                const signed = await signTransaction(initTx);
                await sendTransaction(signed, connection);
                await new Promise(r => setTimeout(r, 1500));
              } catch {}
            }
            statsInitializedRef.current = true;
          }

          const tx = await program.methods
            .openCookie(new anchor.BN(archetype), new anchor.BN(counterSeed))
            .accounts({ user: publicKey, cookie: cookieAccount, stats: statsAccount, systemProgram: SystemProgram.programId })
            .transaction();

          tx.feePayer = publicKey;
          tx.recentBlockhash = blockhash;
          const signed = await signTransaction(tx);
          const txSig = await sendTransaction(signed, connection);
          console.log('⚡ Solflare TX sent:', txSig);

          connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: txSig }, 'processed')
            .then(res => { if (res.value.err) console.warn('TX error:', res.value.err); });

          return txSig;
        }

      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Unknown error';
        setError(msg);
        console.error('TX error:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [connection, publicKey, signTransaction, sendTransaction, mode, localWallet, sessionKeypair, sessionBalance, getFreshBlockhash, buildProgram]
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
