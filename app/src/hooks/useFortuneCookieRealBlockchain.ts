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
            signAllTransactions: async (txs) => {
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

        // Call program
        const tx = await program.methods
          .openCookie(archetype, new anchor.BN(counterSeed))
          .accounts({
            user: publicKey,
            cookie: cookieAccount,
            stats: statsAccount,
            systemProgram: SystemProgram.programId,
          })
          .rpc({ skipPreflight: false });

        console.log('✅ Fortune recorded on-chain:', {
          tx,
          user: publicKey.toString(),
          archetype,
          cookie: cookieAccount.toString(),
        });

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
