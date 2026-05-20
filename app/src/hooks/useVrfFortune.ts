/**
 * useVrfFortune — Switchboard On-Demand VRF hook
 *
 * Install:
 *   yarn add @switchboard-xyz/on-demand
 *
 * Two-slot flow (automated, looks instant to user):
 *   Background: requestRandomness() every ~400ms (one slot ahead)
 *   On click:   consume the pre-fetched randomness in open_cookie_vrf
 *
 * Requires the "vrf" feature compiled into the Anchor program:
 *   anchor build -- --features vrf
 *
 * Falls back to useFortuneCookie (SlotHashes) if Switchboard is unavailable.
 */

import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import {
  useWallet,
  useConnection,
} from "@solana/wallet-adapter-react";
import {
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import * as anchor from "@coral-xyz/anchor";
import { IDL } from "./fortune_cookie_idl";
import { getOrCreateSessionKeypair, getStatsShard } from "@/lib/sessionKeyProvider";
import { getSessionBalance, autoFundSessionIfNeeded } from "@/lib/session-wallet";

const PROGRAM_ID  = new PublicKey("DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85");
const MIN_BALANCE = 0.005;

// Switchboard On-Demand devnet queue
const SB_QUEUE_DEVNET = new PublicKey("FfD96yeXs4cxZshoPPSKhSPgVQxLAJUT3gefgh84m1Di");

// ── Switchboard loader (dynamic import — package optional) ─────────────────────

async function loadSb() {
  try {
    const sb = await import("@switchboard-xyz/on-demand" as any);
    return sb as {
      Randomness: {
        create: (
          program: any,
          rngKp: Keypair,
          queue: PublicKey
        ) => Promise<[any, Transaction]>;
      };
      Queue: { fromSeed: (program: any, seed: PublicKey) => Promise<any> };
    };
  } catch {
    return null;
  }
}

// ── Pre-fetched randomness slot ────────────────────────────────────────────────

interface PrefetchedRng {
  rngKp: Keypair;
  randomnessPda: PublicKey;
  requestedAtSlot: number;
  settled: boolean;
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export interface VrfFortuneHook {
  recordFortune: (archetype: number) => Promise<string>;
  isLoading: boolean;
  error: string | null;
  vrfMode: "switchboard" | "slothashes" | "pending";
  sessionPubkey: PublicKey | null;
  sessionBalance: number;
  needsFunding: boolean;
}

export function useVrfFortune(): VrfFortuneHook {
  const { connection } = useConnection();
  const { publicKey, signTransaction, connected } = useWallet();

  const [isLoading,      setIsLoading]      = useState(false);
  const [error,          setError]          = useState<string | null>(null);
  const [sessionBalance, setSessionBalance] = useState(0);
  const [vrfMode,        setVrfMode]        = useState<"switchboard"|"slothashes"|"pending">("pending");

  const sessionKpRef      = useRef<Keypair>(getOrCreateSessionKeypair());
  const sbRef             = useRef<Awaited<ReturnType<typeof loadSb>>>(null);
  const prefetchedRng     = useRef<PrefetchedRng | null>(null);
  const prefetchInFlight  = useRef(false);
  const airdropDone       = useRef(false);
  // See useFortuneCookieRealBlockchain: needed so back-to-back taps don't collide
  // on the cookie PDA (counter is a u64 seed).
  const lastCounterRef    = useRef<number>(0);

  // ── Init: load Switchboard SDK + fund session ───────────────────────────────
  useEffect(() => {
    loadSb().then((sb) => {
      sbRef.current = sb;
      setVrfMode(sb ? "switchboard" : "slothashes");
    });

    const init = async () => {
      const bal = await getSessionBalance(connection, sessionKpRef.current.publicKey);
      setSessionBalance(bal);
      if (bal < MIN_BALANCE && !airdropDone.current) {
        airdropDone.current = true;
        const ok = await autoFundSessionIfNeeded(connection, sessionKpRef.current.publicKey);
        if (ok) setSessionBalance(await getSessionBalance(connection, sessionKpRef.current.publicKey));
      }
    };
    init().catch(() => {});
  }, [connection]);

  // ── Background prefetch: keep one randomness request ready ─────────────────
  const prefetchRandomness = useCallback(async (program: anchor.Program<any>) => {
    if (!sbRef.current || prefetchInFlight.current) return;
    const current = prefetchedRng.current;
    if (current && !current.settled) return; // already prefetched

    prefetchInFlight.current = true;
    try {
      const rngKp = Keypair.generate();
      const [_rng, createTx] = await sbRef.current.Randomness.create(
        program,
        rngKp,
        SB_QUEUE_DEVNET
      );

      const { blockhash } = await connection.getLatestBlockhash("confirmed");
      createTx.recentBlockhash = blockhash;
      createTx.feePayer = sessionKpRef.current.publicKey;
      createTx.partialSign(sessionKpRef.current, rngKp);

      const sig = await connection.sendRawTransaction(createTx.serialize(), {
        skipPreflight: true,
      });
      const { lastValidBlockHeight } = await connection.getLatestBlockhash();
      await connection.confirmTransaction({ blockhash, lastValidBlockHeight, signature: sig });

      const slot = await connection.getSlot();
      prefetchedRng.current = {
        rngKp,
        randomnessPda: rngKp.publicKey, // Switchboard uses the rngKp pubkey as the account address
        requestedAtSlot: slot,
        settled: false,
      };
    } catch (e) {
      console.warn("[vrf] prefetch failed:", e);
    } finally {
      prefetchInFlight.current = false;
    }
  }, [connection]);

  // ── Main record function ────────────────────────────────────────────────────
  const recordFortune = useCallback(
    async (archetype: number): Promise<string> => {
      setIsLoading(true);
      setError(null);

      try {
        const sessionKp = sessionKpRef.current;
        const liveBalance = await getSessionBalance(connection, sessionKp.publicKey);
        setSessionBalance(liveBalance);

        let signerPubkey: PublicKey;
        let authorityPubkey: PublicKey;

        if (liveBalance >= MIN_BALANCE) {
          signerPubkey    = sessionKp.publicKey;
          authorityPubkey = (connected && publicKey) ? publicKey : sessionKp.publicKey;
        } else if (connected && publicKey) {
          signerPubkey    = publicKey;
          authorityPubkey = publicKey;
        } else {
          throw new Error("No funded wallet available");
        }

        const signTx = async (tx: Transaction): Promise<Transaction> => {
          tx.feePayer = tx.feePayer ?? signerPubkey;
          if (signerPubkey.equals(sessionKp.publicKey)) {
            tx.partialSign(sessionKp);
            return tx;
          }
          if (signTransaction) return signTransaction(tx);
          throw new Error("No signer");
        };

        const dummyWallet = {
          publicKey: signerPubkey,
          signTransaction: signTx,
          signAllTransactions: async (txs: Transaction[]) =>
            Promise.all(txs.map(signTx)),
        };
        const provider = new anchor.AnchorProvider(connection, dummyWallet as any, {
          commitment: "processed",
        });
        const program = new anchor.Program(IDL as any, provider);

        const { shardId, pda: statsShard } = getStatsShard(authorityPubkey);
        const candidate = Date.now();
        const counterSeed =
          candidate > lastCounterRef.current ? candidate : lastCounterRef.current + 1;
        lastCounterRef.current = counterSeed;
        const [cookiePda] = PublicKey.findProgramAddressSync(
          [
            authorityPubkey.toBuffer(),
            Buffer.from("cookie"),
            new anchor.BN(counterSeed).toArrayLike(Buffer, "le", 8),
          ],
          PROGRAM_ID
        );

        // ── Switchboard path ──────────────────────────────────────────────────
        if (sbRef.current && prefetchedRng.current) {
          const rng = prefetchedRng.current;

          // Wait up to 2s for Switchboard to settle the randomness
          let settled = false;
          for (let i = 0; i < 5; i++) {
            const info = await connection.getAccountInfo(rng.randomnessPda);
            if (info && info.data.length > 64) { settled = true; break; }
            await new Promise(r => setTimeout(r, 400));
          }

          if (settled) {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const tx: Transaction = await (program.methods as any)
              .openCookieVrf(
                new anchor.BN(archetype),
                new anchor.BN(counterSeed),
                shardId
              )
              .accounts({
                signer:                signerPubkey,
                authority:             authorityPubkey,
                cookie:                cookiePda,
                statsShard,
                sessionToken:          null,
                randomnessAccountData: rng.randomnessPda,
                systemProgram:         SystemProgram.programId,
              })
              .transaction();

            const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
            tx.recentBlockhash = blockhash;
            tx.feePayer = signerPubkey;
            const signed = await signTx(tx);
            const txSig = await connection.sendRawTransaction(signed.serialize(), {
              skipPreflight: true,
              maxRetries: 3,
            });

            // Mark consumed + trigger next prefetch in background
            prefetchedRng.current = { ...rng, settled: true };
            prefetchRandomness(program).catch(() => {});

            console.log("⚡ [vrf/switchboard] TX:", txSig);
            connection
              .confirmTransaction({ blockhash, lastValidBlockHeight, signature: txSig }, "processed")
              .then(r => { if (!r.value.err) console.log("✅ VRF confirmed:", txSig); });

            return txSig;
          }
          // Switchboard didn't settle in time — fall through to SlotHashes
          console.warn("[vrf] randomness not settled in time, falling back to SlotHashes");
        }

        // ── SlotHashes fallback ───────────────────────────────────────────────
        const SLOT_HASHES = new PublicKey("SysvarS1otHashes111111111111111111111111111");
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const tx: Transaction = await (program.methods as any)
          .openCookie(
            new anchor.BN(archetype),
            new anchor.BN(counterSeed),
            shardId
          )
          .accounts({
            signer:        signerPubkey,
            authority:     authorityPubkey,
            cookie:        cookiePda,
            statsShard,
            sessionToken:  null,
            slotHashes:    SLOT_HASHES,
            systemProgram: SystemProgram.programId,
          })
          .transaction();

        const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
        tx.recentBlockhash = blockhash;
        tx.feePayer = signerPubkey;
        const signed = await signTx(tx);
        const txSig = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: true,
          maxRetries: 3,
        });

        console.log("⚡ [slothashes fallback] TX:", txSig);
        connection
          .confirmTransaction({ blockhash, lastValidBlockHeight, signature: txSig }, "processed")
          .then(r => { if (!r.value.err) console.log("✅ Confirmed:", txSig); });

        // Trigger first prefetch for next click
        if (sbRef.current) prefetchRandomness(program).catch(() => {});

        return txSig;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(msg);
        throw err;
      } finally {
        setIsLoading(false);
      }
    },
    [connection, publicKey, signTransaction, connected, prefetchRandomness]
  );

  return {
    recordFortune,
    isLoading,
    error,
    vrfMode,
    sessionPubkey: sessionKpRef.current.publicKey,
    sessionBalance,
    needsFunding: sessionBalance < MIN_BALANCE,
  };
}
