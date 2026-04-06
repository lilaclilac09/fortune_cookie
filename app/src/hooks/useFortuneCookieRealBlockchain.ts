import { useCallback, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { IDL } from './fortune_cookie_idl';
import { useWalletMode } from '@/components/WalletModeSelector';

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');

interface FortuneCookieHook {
  recordFortune: (archetype: number) => Promise<string>;
  isLoading: boolean;
  error: string | null;
}

export function useFortuneCookie(): FortuneCookieHook {
  const { connection } = useConnection();
  const { publicKey, signTransaction, sendTransaction, connected } = useWallet();
  const { mode, localWallet } = useWalletMode();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        // Local wallet mode
        if (mode === 'local' && localWallet) {
          const publicKeyLocal = localWallet.publicKey;
          
          const provider = new anchor.AnchorProvider(
            connection,
            {
              publicKey: publicKeyLocal,
              signTransaction: async (tx: any) => {
                return localWallet.signTransaction(tx);
              },
              signAllTransactions: async (txs: any) => {
                return localWallet.signAllTransactions(txs);
              },
            } as any,
            { commitment: 'confirmed' }
          );

          const program = new anchor.Program(IDL as any, PROGRAM_ID, provider);
          const counterSeed = Math.floor(Date.now() / 1000);

          const [statsAccount] = PublicKey.findProgramAddressSync(
            [Buffer.from('stats')],
            PROGRAM_ID
          );

          const [cookieAccount] = PublicKey.findProgramAddressSync(
            [
              publicKeyLocal.toBuffer(),
              Buffer.from('cookie'),
              new anchor.BN(counterSeed).toArrayLike(Buffer, 'le', 8),
            ],
            PROGRAM_ID
          );

          console.log('📍 Stats Account:', statsAccount.toString());
          console.log('📍 Cookie Account:', cookieAccount.toString());
          console.log('📍 User (Local):', publicKeyLocal.toString());

          let statsAccountInfo = await connection.getAccountInfo(statsAccount);
          if (!statsAccountInfo) {
            console.log('📝 Stats account initializing...');
            try {
              const initTx = await program.methods
                .initializeStats()
                .accounts({
                  payer: publicKeyLocal,
                  stats: statsAccount,
                  systemProgram: SystemProgram.programId,
                })
                .transaction();

              const latestBlockhash = await connection.getLatestBlockhash();
              initTx.feePayer = publicKeyLocal;
              initTx.recentBlockhash = latestBlockhash.blockhash;
              const signedInitTx = await localWallet.signTransaction(initTx);
              
              const initSig = await connection.sendRawTransaction(
                signedInitTx.serialize()
              );
              console.log('✅ Stats initialized:', initSig);
              await new Promise(resolve => setTimeout(resolve, 2000));
            } catch (initError: any) {
              console.warn('⚠️ Init error (continuing):', initError?.message);
            }
          }

          console.log('🚀 Sending openCookie transaction (Local)...');
          const tx = await program.methods
            .openCookie(new anchor.BN(archetype), new anchor.BN(counterSeed))
            .accounts({
              user: publicKeyLocal,
              cookie: cookieAccount,
              stats: statsAccount,
              systemProgram: SystemProgram.programId,
            })
            .transaction();

          const latestBlockhash = await connection.getLatestBlockhash();
          tx.feePayer = publicKeyLocal;
          tx.recentBlockhash = latestBlockhash.blockhash;

          const signedTx = await localWallet.signTransaction(tx);
          console.log('✅ Transaction signed (Local)');

          const txSig = await connection.sendRawTransaction(
            signedTx.serialize()
          );
          console.log('✅ Transaction sent:', txSig);

          const confirmation = await connection.confirmTransaction({
            blockhash: latestBlockhash.blockhash,
            lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
            signature: txSig,
          });

          if (confirmation.value.err) {
            throw new Error('Transaction failed: ' + JSON.stringify(confirmation.value.err));
          }

          console.log('✅ Fortune recorded on-chain (Local)!', {
            signature: txSig,
            user: publicKeyLocal.toString(),
            archetype,
          });

          return txSig;
        }

        // Solflare mode
        if (!publicKey || !signTransaction || !sendTransaction) {
          throw new Error('Wallet not connected properly');
        }

        let balance = 0;
        try {
          balance = await connection.getBalance(publicKey);
          console.log(`Balance: ${balance / 1e9} SOL (${balance} lamports)`);
        } catch (e) {
          console.warn('Could not fetch balance:', e);
        }

        const provider = new anchor.AnchorProvider(
          connection,
          {
            publicKey,
            signTransaction,
            signAllTransactions: async (txs: any) => {
              const signedTxs: any[] = [];
              for (const tx of txs) {
                try {
                  signedTxs.push(await signTransaction(tx));
                } catch (err) {
                  console.error('Sign transaction failed:', err);
                  throw err;
                }
              }
              return signedTxs;
            },
          } as any,
          { commitment: 'confirmed' }
        );

        const program = new anchor.Program(IDL as any, PROGRAM_ID, provider);
        const counterSeed = Math.floor(Date.now() / 1000);

        const [statsAccount] = PublicKey.findProgramAddressSync(
          [Buffer.from('stats')],
          PROGRAM_ID
        );

        const [cookieAccount] = PublicKey.findProgramAddressSync(
          [
            publicKey.toBuffer(),
            Buffer.from('cookie'),
            new anchor.BN(counterSeed).toArrayLike(Buffer, 'le', 8),
          ],
          PROGRAM_ID
        );

        console.log('📍 Stats Account:', statsAccount.toString());
        console.log('📍 User:', publicKey.toString());

        let statsAccountInfo = await connection.getAccountInfo(statsAccount);
        if (!statsAccountInfo) {
          console.log('📝 Initializing stats...');
          try {
            const initTx = await program.methods
              .initializeStats()
              .accounts({
                payer: publicKey,
                stats: statsAccount,
                systemProgram: SystemProgram.programId,
              })
              .transaction();

            const latestBlockhash = await connection.getLatestBlockhash();
            initTx.feePayer = publicKey;
            initTx.recentBlockhash = latestBlockhash.blockhash;
            const signedInitTx = await signTransaction(initTx);
            
            const initSig = await sendTransaction(signedInitTx, connection);
            console.log('✅ Stats initialized:', initSig);
            await new Promise(resolve => setTimeout(resolve, 2000));
          } catch (initError: any) {
            console.warn('Init error:', initError?.message);
          }
        }

        console.log('🚀 Sending openCookie transaction...');
        const tx = await program.methods
          .openCookie(new anchor.BN(archetype), new anchor.BN(counterSeed))
          .accounts({
            user: publicKey,
            cookie: cookieAccount,
            stats: statsAccount,
            systemProgram: SystemProgram.programId,
          })
          .transaction();

        const latestBlockhash = await connection.getLatestBlockhash();
        tx.feePayer = publicKey;
        tx.recentBlockhash = latestBlockhash.blockhash;

        const signedTx = await signTransaction(tx);
        console.log('✅ Transaction signed');

        const txSig = await sendTransaction(signedTx, connection);
        console.log('✅ Transaction sent:', txSig);

        const confirmation = await connection.confirmTransaction({
          blockhash: latestBlockhash.blockhash,
          lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
          signature: txSig,
        });

        if (confirmation.value.err) {
          throw new Error('Transaction failed: ' + JSON.stringify(confirmation.value.err));
        }

        console.log('✅ Fortune recorded on-chain!', {
          signature: txSig,
          user: publicKey.toString(),
          archetype,
        });

        return txSig;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        console.error('Transaction error:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [connection, publicKey, signTransaction, sendTransaction, mode, localWallet]
  );

  return {
    recordFortune,
    isLoading,
    error,
  };
}
