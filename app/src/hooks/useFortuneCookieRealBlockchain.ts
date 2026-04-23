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
      return;
    }
    setSession(loadSession(activePubkey, PROGRAM_ID));
  }, [activePubkey]);

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

  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
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
