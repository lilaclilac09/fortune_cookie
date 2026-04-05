import { useCallback, useState } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');

interface FortuneCookieHook {
  recordFortune: (archetype: number) => Promise<string>;
  isLoading: boolean;
  error: string | null;
}

export function useFortuneCookie(): FortuneCookieHook {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      if (!publicKey) {
        throw new Error('Wallet not connected');
      }

      setIsLoading(true);
      setError(null);

      try {
        // Generate a pseudo-transaction signature for now
        // In production, this would make a real transaction
        const timestamp = Date.now();
        const counterSeed = Math.floor(timestamp / 1000);
        
        // Create a signature-like string
        const signatureData = Buffer.concat([
          publicKey.toBuffer(),
          Buffer.from([archetype]),
          Buffer.from(counterSeed.toString()),
        ]);
        
        // Hash it to create a signature-like string
        const signature = Array.from(signatureData)
          .map(b => b.toString(16).padStart(2, '0'))
          .join('')
          .slice(0, 88); // Solana signatures are 88 characters

        // Log for debugging
        console.log('Fortune recorded (simulated):', {
          user: publicKey.toString(),
          archetype,
          counter: counterSeed,
          signature,
        });

        // Simulate network delay
        await new Promise(resolve => setTimeout(resolve, 500));

        return signature;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error';
        setError(errorMsg);
        console.error('Error recording fortune:', err);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [publicKey]
  );

  return {
    recordFortune,
    isLoading,
    error,
  };
}
