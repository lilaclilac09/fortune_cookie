import { useCallback, useEffect, useMemo, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { IDL } from './fortune_cookie_idl';
import { useWalletMode } from '@/components/WalletModeSelector';
import {
  DEFAULT_BATCH_SIZE,
  clearSession,
  consumeNextSlot,
  createSession,
  loadSession,
  PresignedSession,
  refillSession,
  remainingSlots,
  SignerWallet,
} from '@/lib/durable-nonce-session';
import {
  authorizeSession,
  clearSessionKey,
  isSessionKeyValid,
  loadSessionKey,
  openViaSession,
  revokeSession,
  secondsUntilExpiry,
  StoredSessionKey,
} from '@/lib/session-key';
import {
  closeCookie as prepaidCloseCookie,
  collectTreasury as prepaidCollectTreasury,
  COST_PER_OPEN_ESTIMATE,
  deposit as prepaidDeposit,
  estimateRemainingOpens,
  FEE_LAMPORTS,
  getPrepaidBalanceLamports,
  getTreasuryAuthority,
  getTreasuryLamports,
  openPrepaid,
  withdraw as prepaidWithdraw,
} from '@/lib/prepaid';

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');

export interface FortuneCookieHook {
  recordFortune: (archetype: number) => Promise<string>;
  isLoading: boolean;
  error: string | null;
  session: PresignedSession | null;
  sessionRemaining: number;
  isPreparingSession: boolean;
  prepareSession: (batchSize?: number) => Promise<void>;
  topUpSession: () => Promise<void>;
  resetSession: () => void;
  sessionKey: StoredSessionKey | null;
  sessionKeyValid: boolean;
  sessionKeyExpiresInSeconds: number;
  isAuthorizingSessionKey: boolean;
  authorizeSessionKey: (durationSeconds?: number) => Promise<void>;
  revokeSessionKey: () => Promise<void>;
  prepaidBalanceLamports: number;
  prepaidRemainingOpens: number;
  treasuryLamports: number;
  treasuryAuthority: PublicKey | null;
  isTreasuryAuthority: boolean;
  isDepositing: boolean;
  isWithdrawing: boolean;
  isCollectingTreasury: boolean;
  deposit: (amountLamports: number) => Promise<void>;
  withdraw: (amountLamports: number) => Promise<void>;
  collectTreasury: (amountLamports: number, recipient: PublicKey) => Promise<void>;
  closeCookie: (counter: bigint) => Promise<string>;
  refreshBalances: () => Promise<void>;
  feeLamports: number;
  costPerOpenLamports: number;
}

export function useFortuneCookie(): FortuneCookieHook {
  const { connection } = useConnection();
  const { publicKey, signTransaction, signAllTransactions, sendTransaction, connected } =
    useWallet();
  const { mode, localWallet } = useWalletMode();

  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [session, setSession] = useState<PresignedSession | null>(null);
  const [isPreparingSession, setIsPreparingSession] = useState(false);
  const [sessionKey, setSessionKey] = useState<StoredSessionKey | null>(null);
  const [isAuthorizingSessionKey, setIsAuthorizingSessionKey] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const [prepaidBalanceLamports, setPrepaidBalanceLamports] = useState(0);
  const [treasuryLamports, setTreasuryLamports] = useState(0);
  const [treasuryAuthority, setTreasuryAuthority] = useState<PublicKey | null>(null);
  const [isDepositing, setIsDepositing] = useState(false);
  const [isWithdrawing, setIsWithdrawing] = useState(false);
  const [isCollectingTreasury, setIsCollectingTreasury] = useState(false);

  const activePubkey: PublicKey | null = useMemo(() => {
    if (mode === 'local' && localWallet) return localWallet.publicKey;
    if (publicKey) return publicKey;
    return null;
  }, [mode, localWallet, publicKey]);

  const signerWallet: SignerWallet | null = useMemo(() => {
    if (mode === 'local' && localWallet) {
      return {
        publicKey: localWallet.publicKey,
        signTransaction: (tx: Transaction) => localWallet.signTransaction(tx),
        signAllTransactions: (txs: Transaction[]) =>
          localWallet.signAllTransactions(txs),
      };
    }
    if (publicKey && signTransaction) {
      const batchSigner =
        signAllTransactions ??
        (async (txs: Transaction[]) => {
          const out: Transaction[] = [];
          for (const tx of txs) out.push(await signTransaction(tx));
          return out;
        });
      return {
        publicKey,
        signTransaction,
        signAllTransactions: batchSigner,
      };
    }
    return null;
  }, [mode, localWallet, publicKey, signTransaction, signAllTransactions]);

  useEffect(() => {
    if (!activePubkey) {
      setSession(null);
      setSessionKey(null);
      return;
    }
    setSession(loadSession(activePubkey, PROGRAM_ID));
    setSessionKey(loadSessionKey(activePubkey, PROGRAM_ID));
  }, [activePubkey]);

  useEffect(() => {
    const id = setInterval(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => clearInterval(id);
  }, []);

  const refreshBalances = useCallback(async () => {
    if (!activePubkey) {
      setPrepaidBalanceLamports(0);
      setTreasuryLamports(0);
      setTreasuryAuthority(null);
      return;
    }
    try {
      const [b, t, auth] = await Promise.all([
        getPrepaidBalanceLamports(connection, activePubkey, PROGRAM_ID),
        getTreasuryLamports(connection, PROGRAM_ID),
        getTreasuryAuthority(connection, PROGRAM_ID),
      ]);
      setPrepaidBalanceLamports(b);
      setTreasuryLamports(t);
      setTreasuryAuthority(auth);
    } catch (err) {
      console.warn('refreshBalances failed:', err);
    }
  }, [connection, activePubkey]);

  useEffect(() => {
    refreshBalances();
    const id = setInterval(refreshBalances, 15_000);
    return () => clearInterval(id);
  }, [refreshBalances]);

  const deposit = useCallback(
    async (amountLamports: number) => {
      if (!signerWallet) throw new Error('Wallet not connected');
      setIsDepositing(true);
      setError(null);
      try {
        await prepaidDeposit(connection, signerWallet, PROGRAM_ID, amountLamports);
        await refreshBalances();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Deposit failed';
        setError(msg);
        throw err;
      } finally {
        setIsDepositing(false);
      }
    },
    [connection, signerWallet, refreshBalances],
  );

  const withdraw = useCallback(
    async (amountLamports: number) => {
      if (!signerWallet) throw new Error('Wallet not connected');
      setIsWithdrawing(true);
      setError(null);
      try {
        await prepaidWithdraw(connection, signerWallet, PROGRAM_ID, amountLamports);
        await refreshBalances();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Withdraw failed';
        setError(msg);
        throw err;
      } finally {
        setIsWithdrawing(false);
      }
    },
    [connection, signerWallet, refreshBalances],
  );

  const collectTreasury = useCallback(
    async (amountLamports: number, recipient: PublicKey) => {
      if (!signerWallet) throw new Error('Wallet not connected');
      setIsCollectingTreasury(true);
      setError(null);
      try {
        await prepaidCollectTreasury(
          connection,
          signerWallet,
          PROGRAM_ID,
          amountLamports,
          recipient,
        );
        await refreshBalances();
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Collect failed';
        setError(msg);
        throw err;
      } finally {
        setIsCollectingTreasury(false);
      }
    },
    [connection, signerWallet, refreshBalances],
  );

  const closeCookie = useCallback(
    async (counter: bigint) => {
      if (!signerWallet) throw new Error('Wallet not connected');
      setError(null);
      try {
        const sig = await prepaidCloseCookie(
          connection,
          signerWallet,
          PROGRAM_ID,
          counter,
        );
        await refreshBalances();
        return sig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Close cookie failed';
        setError(msg);
        throw err;
      }
    },
    [connection, signerWallet, refreshBalances],
  );

  const prepareSession = useCallback(
    async (batchSize: number = DEFAULT_BATCH_SIZE) => {
      if (!signerWallet) throw new Error('Wallet not connected');
      setIsPreparingSession(true);
      setError(null);
      try {
        const next = await createSession({
          connection,
          wallet: signerWallet,
          programId: PROGRAM_ID,
          batchSize,
        });
        setSession(next);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Session prep failed';
        setError(msg);
        throw err;
      } finally {
        setIsPreparingSession(false);
      }
    },
    [connection, signerWallet],
  );

  const topUpSession = useCallback(async () => {
    if (!signerWallet) throw new Error('Wallet not connected');
    if (!session) {
      await prepareSession();
      return;
    }
    setIsPreparingSession(true);
    setError(null);
    try {
      const next = await refillSession(
        connection,
        signerWallet,
        PROGRAM_ID,
        session,
      );
      setSession(next);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Refill failed';
      setError(msg);
      throw err;
    } finally {
      setIsPreparingSession(false);
    }
  }, [connection, signerWallet, session, prepareSession]);

  const resetSession = useCallback(() => {
    if (!activePubkey) return;
    clearSession(activePubkey, PROGRAM_ID);
    setSession(null);
  }, [activePubkey]);

  const authorizeSessionKey = useCallback(
    async (durationSeconds?: number) => {
      if (!signerWallet) throw new Error('Wallet not connected');
      setIsAuthorizingSessionKey(true);
      setError(null);
      try {
        const next = await authorizeSession({
          connection,
          wallet: signerWallet,
          programId: PROGRAM_ID,
          durationSeconds,
        });
        setSessionKey(next);
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Authorize failed';
        setError(msg);
        throw err;
      } finally {
        setIsAuthorizingSessionKey(false);
      }
    },
    [connection, signerWallet],
  );

  const revokeSessionKey = useCallback(async () => {
    if (!signerWallet || !sessionKey) return;
    setIsAuthorizingSessionKey(true);
    setError(null);
    try {
      await revokeSession(connection, signerWallet, PROGRAM_ID, sessionKey);
      setSessionKey(null);
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Revoke failed';
      setError(msg);
      // Even if on-chain revoke fails, clear local cache so user can re-auth.
      if (activePubkey) {
        clearSessionKey(activePubkey, PROGRAM_ID);
        setSessionKey(null);
      }
      throw err;
    } finally {
      setIsAuthorizingSessionKey(false);
    }
  }, [connection, signerWallet, sessionKey, activePubkey]);

  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        if (sessionKey && isSessionKeyValid(sessionKey)) {
          // Prefer prepaid path when balance PDA can cover rent + fee.
          if (prepaidBalanceLamports >= COST_PER_OPEN_ESTIMATE) {
            const consumed = await openPrepaid(
              connection,
              sessionKey,
              PROGRAM_ID,
              archetype,
            );
            const refreshed = loadSessionKey(
              new PublicKey(sessionKey.userPubkey),
              PROGRAM_ID,
            );
            setSessionKey(refreshed);
            await refreshBalances();
            console.log('✅ Fortune recorded via prepaid balance', consumed);
            return consumed.signature;
          }
          const consumed = await openViaSession(
            connection,
            sessionKey,
            PROGRAM_ID,
            archetype,
          );
          const refreshed = loadSessionKey(
            new PublicKey(sessionKey.userPubkey),
            PROGRAM_ID,
          );
          setSessionKey(refreshed);
          console.log('✅ Fortune recorded via session key (direct)', consumed);
          return consumed.signature;
        }

        if (session && session.nextIndex < session.slots.length) {
          const consumed = await consumeNextSlot(connection, session);
          setSession({ ...session });
          console.log('✅ Fortune recorded via pre-signed nonce tx', {
            signature: consumed.signature,
            archetype: consumed.archetype,
            requestedArchetype: archetype,
            cookiePda: consumed.cookiePda,
            remaining: remainingSlots(session),
          });
          return consumed.signature;
        }

        if (mode === 'local' && localWallet) {
          return await liveOpenLocal({
            connection,
            localWallet,
            archetype,
          });
        }

        if (publicKey && signTransaction) {
          return await liveOpenWalletAdapter({
            connection,
            publicKey,
            signTransaction,
            sendTransaction,
            archetype,
          });
        }

        throw new Error('Wallet not connected properly');
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        console.error('Transaction error:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [
      connection,
      session,
      sessionKey,
      prepaidBalanceLamports,
      refreshBalances,
      mode,
      localWallet,
      publicKey,
      signTransaction,
      sendTransaction,
    ],
  );

  return {
    recordFortune,
    isLoading,
    error,
    session,
    sessionRemaining: remainingSlots(session),
    isPreparingSession,
    prepareSession,
    topUpSession,
    resetSession,
    sessionKey,
    sessionKeyValid: isSessionKeyValid(sessionKey, nowSeconds),
    sessionKeyExpiresInSeconds: secondsUntilExpiry(sessionKey, nowSeconds),
    isAuthorizingSessionKey,
    authorizeSessionKey,
    revokeSessionKey,
    prepaidBalanceLamports,
    prepaidRemainingOpens: estimateRemainingOpens(prepaidBalanceLamports),
    treasuryLamports,
    treasuryAuthority,
    isTreasuryAuthority:
      !!activePubkey && !!treasuryAuthority && activePubkey.equals(treasuryAuthority),
    isDepositing,
    isWithdrawing,
    isCollectingTreasury,
    deposit,
    withdraw,
    collectTreasury,
    closeCookie,
    refreshBalances,
    feeLamports: FEE_LAMPORTS,
    costPerOpenLamports: COST_PER_OPEN_ESTIMATE,
  };
}

async function liveOpenLocal(opts: {
  connection: anchor.web3.Connection;
  localWallet: NonNullable<ReturnType<typeof useWalletMode>['localWallet']>;
  archetype: number;
}): Promise<string> {
  const { connection, localWallet, archetype } = opts;
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey: localWallet.publicKey,
      signTransaction: (tx: any) => localWallet.signTransaction(tx),
      signAllTransactions: (txs: any) => localWallet.signAllTransactions(txs),
    } as any,
    { commitment: 'confirmed' },
  );
  const program = new anchor.Program(IDL as any, PROGRAM_ID, provider);
  const counterSeed = Math.floor(Date.now() / 1000);

  const [statsAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('stats')],
    PROGRAM_ID,
  );
  const [cookieAccount] = PublicKey.findProgramAddressSync(
    [
      localWallet.publicKey.toBuffer(),
      Buffer.from('cookie'),
      new anchor.BN(counterSeed).toArrayLike(Buffer, 'le', 8),
    ],
    PROGRAM_ID,
  );

  const statsInfo = await connection.getAccountInfo(statsAccount);
  if (!statsInfo) {
    const initTx = await program.methods
      .initializeStats()
      .accounts({
        payer: localWallet.publicKey,
        stats: statsAccount,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    const bh = await connection.getLatestBlockhash();
    initTx.feePayer = localWallet.publicKey;
    initTx.recentBlockhash = bh.blockhash;
    const signed = await localWallet.signTransaction(initTx);
    await connection.sendRawTransaction(signed.serialize());
    await new Promise((r) => setTimeout(r, 2000));
  }

  const tx = await program.methods
    .openCookie(new anchor.BN(archetype), new anchor.BN(counterSeed))
    .accounts({
      user: localWallet.publicKey,
      cookie: cookieAccount,
      stats: statsAccount,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const latest = await connection.getLatestBlockhash();
  tx.feePayer = localWallet.publicKey;
  tx.recentBlockhash = latest.blockhash;
  const signed = await localWallet.signTransaction(tx);
  const sig = await connection.sendRawTransaction(signed.serialize());
  const conf = await connection.confirmTransaction({
    signature: sig,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  if (conf.value.err) {
    throw new Error('Transaction failed: ' + JSON.stringify(conf.value.err));
  }
  return sig;
}

async function liveOpenWalletAdapter(opts: {
  connection: anchor.web3.Connection;
  publicKey: PublicKey;
  signTransaction: <T extends Transaction>(tx: T) => Promise<T>;
  sendTransaction: (tx: Transaction, connection: anchor.web3.Connection) => Promise<string>;
  archetype: number;
}): Promise<string> {
  const { connection, publicKey, signTransaction, sendTransaction, archetype } = opts;
  const provider = new anchor.AnchorProvider(
    connection,
    {
      publicKey,
      signTransaction,
      signAllTransactions: async (txs: any) => {
        const out: any[] = [];
        for (const tx of txs) out.push(await signTransaction(tx));
        return out;
      },
    } as any,
    { commitment: 'confirmed' },
  );
  const program = new anchor.Program(IDL as any, PROGRAM_ID, provider);
  const counterSeed = Math.floor(Date.now() / 1000);

  const [statsAccount] = PublicKey.findProgramAddressSync(
    [Buffer.from('stats')],
    PROGRAM_ID,
  );
  const [cookieAccount] = PublicKey.findProgramAddressSync(
    [
      publicKey.toBuffer(),
      Buffer.from('cookie'),
      new anchor.BN(counterSeed).toArrayLike(Buffer, 'le', 8),
    ],
    PROGRAM_ID,
  );

  const statsInfo = await connection.getAccountInfo(statsAccount);
  if (!statsInfo) {
    const initTx = await program.methods
      .initializeStats()
      .accounts({
        payer: publicKey,
        stats: statsAccount,
        systemProgram: SystemProgram.programId,
      })
      .transaction();
    const bh = await connection.getLatestBlockhash();
    initTx.feePayer = publicKey;
    initTx.recentBlockhash = bh.blockhash;
    const signed = await signTransaction(initTx);
    await sendTransaction(signed, connection);
    await new Promise((r) => setTimeout(r, 2000));
  }

  const tx = await program.methods
    .openCookie(new anchor.BN(archetype), new anchor.BN(counterSeed))
    .accounts({
      user: publicKey,
      cookie: cookieAccount,
      stats: statsAccount,
      systemProgram: SystemProgram.programId,
    })
    .transaction();

  const latest = await connection.getLatestBlockhash();
  tx.feePayer = publicKey;
  tx.recentBlockhash = latest.blockhash;
  const signed = await signTransaction(tx);
  const sig = await sendTransaction(signed, connection);
  const conf = await connection.confirmTransaction({
    signature: sig,
    blockhash: latest.blockhash,
    lastValidBlockHeight: latest.lastValidBlockHeight,
  });
  if (conf.value.err) {
    throw new Error('Transaction failed: ' + JSON.stringify(conf.value.err));
  }
  return sig;
}
