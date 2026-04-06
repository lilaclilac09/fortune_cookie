import { useCallback, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { IDL } from './fortune_cookie_idl';

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');

interface FortuneCookieHook {
  recordFortune: (archetype: number) => Promise<string>;
  isLoading: boolean;
  error: string | null;
}

export function useFortuneCookie(): FortuneCookieHook {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      if (!publicKey || !signTransaction) {
        throw new Error('Wallet not connected');
      }

      setIsLoading(true);
      setError(null);

      try {
        // Create Anchor provider
        const provider = new anchor.AnchorProvider(
          connection,
          {
            publicKey,
            signTransaction,
            signAllTransactions: async (txs: any) => {
              const signedTxs: any[] = [];
              for (const tx of txs) {
                signedTxs.push(await signTransaction(tx));
              }
              return signedTxs;
            },
          } as any,
          { commitment: 'confirmed' }
        );

        // Create program interface
        const program = new anchor.Program(IDL as any, PROGRAM_ID, provider);

        const counterSeed = Math.floor(Date.now() / 1000);

        // Derive PDAs
        const [statsAccount, statsBump] = PublicKey.findProgramAddressSync(
          [Buffer.from('stats')],
          PROGRAM_ID
        );

        const [cookieAccount, cookieBump] = PublicKey.findProgramAddressSync(
          [
            publicKey.toBuffer(),
            Buffer.from('cookie'),
            new anchor.BN(counterSeed).toArrayLike(Buffer, 'le', 8),
          ],
          PROGRAM_ID
        );

        // Check if stats account exists, initialize if needed
        const statsAccountInfo = await connection.getAccountInfo(statsAccount);
        if (!statsAccountInfo) {
          console.log('📝 Initializing stats account...');
          try {
            const initTx = await program.methods
              .initializeStats()
              .accounts({
                payer: publicKey,
                stats: statsAccount,
                systemProgram: SystemProgram.programId,
              })
              .rpc({ skipPreflight: false, commitment: 'confirmed' });
            console.log('✅ Stats initialized:', initTx);
            // Wait a bit for account to be available
            await new Promise(resolve => setTimeout(resolve, 1000));
          } catch (initError: any) {
            console.log('⚠️ Stats init error (might exist):', initError?.message);
            // Continue anyway - account might already exist
          }
        }

        // Call program - explicitly pass all required accounts
        const tx = await program.methods
          .openCookie(archetype, new anchor.BN(counterSeed))
          .accounts({
            user: publicKey,
            cookie: cookieAccount,
            stats: statsAccount,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ skipPreflight: false, commitment: 'confirmed', maxRetries: 10 });

        // Verify transaction was actually processed
        console.log('✅ Fortune recorded on-chain:', {
          tx,
          user: publicKey.toString(),
          archetype,
          cookie: cookieAccount.toString(),
        });

        // Check if transaction actually confirmed
        const txDetails = await connection.getTransaction(tx, {
          commitment: 'confirmed',
          maxSupportedTransactionVersion: 0,
        });
        
        if (txDetails?.meta?.err) {
          throw new Error(`Transaction failed on-chain: ${JSON.stringify(txDetails.meta.err)}`);
        }

        return tx;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        console.error('❌ Error recording fortune:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [connection, publicKey, signTransaction]
  );

  return {
    recordFortune,
    isLoading,
    error,
  };
}
