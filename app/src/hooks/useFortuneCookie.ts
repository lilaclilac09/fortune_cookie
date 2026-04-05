import { useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import {
  PublicKey,
  Transaction,
  SystemProgram,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');

interface FortuneCookieHook {
  recordFortune: (archetype: number) => Promise<string>;
  isLoading: boolean;
  error: string | null;
}

export function useFortuneCookie(): FortuneCookieHook {
  const { connection } = useConnection();
  const { publicKey, signTransaction } = useWallet();

  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      if (!publicKey || !signTransaction) {
        throw new Error('Wallet not connected');
      }

      try {
        // Get counter for PDA derivation
        const counterSeed = Math.floor(Date.now() / 1000);

        // Create instruction to open cookie
        const statsSeeds = [Buffer.from('stats')];
        const statsPDA = PublicKey.findProgramAddressSync(
          statsSeeds,
          PROGRAM_ID
        )[0];

        const cookieSeeds = [
          publicKey.toBuffer(),
          Buffer.from('cookie'),
          Buffer.from(new anchor.BN(counterSeed).toArray('le', 8)),
        ];
        const cookiePDA = PublicKey.findProgramAddressSync(
          cookieSeeds,
          PROGRAM_ID
        )[0];

        // Build instruction
        const instruction = new anchor.web3.TransactionInstruction({
          programId: PROGRAM_ID,
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: cookiePDA, isSigner: false, isWritable: true },
            { pubkey: statsPDA, isSigner: false, isWritable: true },
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          ],
          data: Buffer.concat([
            Buffer.from([0xab, 0x77, 0x99, 0xc3, 0xf4, 0x9f, 0xd5, 0x1f]), // open_cookie discriminator
            Buffer.from([archetype]),
            Buffer.from(new anchor.BN(counterSeed).toArray('le', 8)),
          ]),
        });

        // Create and send transaction
        const transaction = new Transaction();
        transaction.add(instruction);

        const { blockhash } = await connection.getLatestBlockhash();
        transaction.recentBlockhash = blockhash;
        transaction.feePayer = publicKey;

        const signed = await signTransaction(transaction);
        const signature = await connection.sendRawTransaction(
          signed.serialize(),
          { skipPreflight: false }
        );

        // Wait for confirmation
        await connection.confirmTransaction(signature, 'confirmed');

        return signature;
      } catch (error) {
        console.error('Error recording fortune:', error);
        throw error;
      }
    },
    [connection, publicKey, signTransaction]
  );

  return {
    recordFortune,
    isLoading: false,
    error: null,
  };
}
