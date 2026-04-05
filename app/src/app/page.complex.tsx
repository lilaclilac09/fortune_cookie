"use client";

import { useEffect, useMemo, useState } from "react";
import { PublicKey, SystemProgram } from "@solana/web3.js";
import { useAnchorWallet, useConnection } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { AnchorProvider, BN, Idl, Program } from "@coral-xyz/anchor";
import fortunesData from "../fortunes.json";
import GestureDetector from "../components/GestureDetector";

const archetypes = ["degen", "builder", "vc", "founder"] as const;
const rarities = ["common", "rare", "epic", "legendary"] as const;

type Archetype = (typeof archetypes)[number];
type Rarity = (typeof rarities)[number];

type Fortunes = {
  archetypes: Archetype[];
  fortunes: Record<Archetype, Record<Rarity, string[]>>;
};

const PROGRAM_ID = new PublicKey(
  "GpPcUYfhJzGwpN1xwNMHRiEGmj2BnvAtPkZSn2Nyi8n8"
);

const idl: Idl = {
  version: "0.1.0",
  name: "fortune_cookie",
  instructions: [
    {
      name: "initializeStats",
      accounts: [
        { name: "payer", isMut: true, isSigner: true },
        { name: "stats", isMut: true, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false }
      ],
      args: []
    },
    {
      name: "openCookie",
      accounts: [
        { name: "user", isMut: true, isSigner: true },
        { name: "cookie", isMut: true, isSigner: false },
        { name: "stats", isMut: true, isSigner: false },
        { name: "systemProgram", isMut: false, isSigner: false }
      ],
      args: [
        { name: "archetype", type: "u8" },
        { name: "counter", type: "u64" }
      ]
    }
  ],
  accounts: [
    {
      name: "fortuneCookie",
      type: {
        kind: "struct",
        fields: [
          { name: "user", type: "publicKey" },
          { name: "archetype", type: "u8" },
          { name: "fortuneId", type: "u64" },
          { name: "rarity", type: "u8" },
          { name: "bump", type: "u8" }
        ]
      }
    },
    {
      name: "stats",
      type: {
        kind: "struct",
        fields: [
          { name: "totalOpens", type: "u64" },
          { name: "bump", type: "u8" }
        ]
      }
    }
  ],
  events: [
    {
      name: "CookieOpened",
      fields: [
        { name: "user", type: "publicKey", index: false },
        { name: "archetype", type: "u8", index: false },
        { name: "fortuneId", type: "u64", index: false },
        { name: "rarity", type: "u8", index: false }
      ]
    }
  ]
};

const textEncoder = new TextEncoder();

function pickFrom<T>(items: T[]): T {
  return items[Math.floor(Math.random() * items.length)];
}

function u64ToBytes(value: number): Uint8Array {
  const buffer = new ArrayBuffer(8);
  const view = new DataView(buffer);
  view.setBigUint64(0, BigInt(value), true);
  return new Uint8Array(buffer);
}

export default function HomePage() {
  const data = fortunesData as Fortunes;
  const { connection } = useConnection();
  const anchorWallet = useAnchorWallet();

  const [selected, setSelected] = useState<Archetype>("degen");
  const [randomMode, setRandomMode] = useState(false);
  const [gestureMode, setGestureMode] = useState(false);
  const [fortune, setFortune] = useState<string | null>(null);
  const [rarity, setRarity] = useState<Rarity>("common");
  const [archetype, setArchetype] = useState<Archetype>("degen");
  const [isLoading, setIsLoading] = useState(false);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [statsReady, setStatsReady] = useState<boolean | null>(null);
  const [statsTotal, setStatsTotal] = useState<number | null>(null);

  const provider = useMemo(() => {
    if (!anchorWallet) {
      return null;
    }
    return new AnchorProvider(connection, anchorWallet, {
      commitment: "confirmed"
    });
  }, [anchorWallet, connection]);

  const program = useMemo(() => {
    if (!provider) {
      return null;
    }
    return new Program(idl, PROGRAM_ID, provider);
  }, [provider]);

  const seedLabel = useMemo(() => {
    if (randomMode) {
      return "random archetype";
    }
    return selected;
  }, [randomMode, selected]);

  const statsPda = useMemo(() => {
    const [pda] = PublicKey.findProgramAddressSync(
      [textEncoder.encode("stats")],
      PROGRAM_ID
    );
    return pda;
  }, []);

  useEffect(() => {
    const checkStats = async () => {
      try {
        const info = await connection.getAccountInfo(statsPda);
        setStatsReady(!!info);
      } catch (err) {
        setStatsReady(false);
      }
    };

    checkStats();
  }, [connection, statsPda]);

  const refreshStats = async () => {
    if (!program) {
      return;
    }
    try {
      const statsAccount = await program.account.stats.fetch(statsPda);
      setStatsTotal(Number(statsAccount.totalOpens));
      setStatsReady(true);
    } catch {
      setStatsTotal(null);
    }
  };

  const initializeStats = async () => {
    if (!program || !provider) {
      setError("Connect a wallet to initialize stats.");
      return;
    }
    setError(null);
    setIsLoading(true);
    try {
      await program.methods
        .initializeStats()
        .accounts({
          payer: provider.wallet.publicKey,
          stats: statsPda,
          systemProgram: SystemProgram.programId
        })
        .rpc();
      await refreshStats();
    } catch (err) {
      setError("Failed to initialize stats account.");
    } finally {
      setIsLoading(false);
    }
  };

  const crackCookie = async () => {
    if (!program || !provider) {
      setError("Connect a wallet to crack a cookie.");
      return;
    }
    if (!statsReady) {
      setError("Stats account not initialized yet.");
      return;
    }

    setError(null);
    setIsLoading(true);

    try {
      const nextArchetype = randomMode ? pickFrom(archetypes) : selected;
      const archetypeIndex = archetypes.indexOf(nextArchetype);
      const user = provider.wallet.publicKey;

      const cookieAccounts = await connection.getProgramAccounts(PROGRAM_ID, {
        dataSlice: { offset: 0, length: 0 },
        filters: [
          {
            memcmp: {
              offset: 8,
              bytes: user.toBase58()
            }
          }
        ]
      });
      const counter = cookieAccounts.length;

      const [cookiePda] = PublicKey.findProgramAddressSync(
        [
          user.toBytes(),
          textEncoder.encode("cookie"),
          u64ToBytes(counter)
        ],
        PROGRAM_ID
      );

      const signature = await program.methods
        .openCookie(archetypeIndex, new BN(counter))
        .accounts({
          user,
          cookie: cookiePda,
          stats: statsPda,
          systemProgram: SystemProgram.programId
        })
        .rpc();

      const cookie = await program.account.fortuneCookie.fetch(cookiePda);
      const fortuneIndex = Number(cookie.fortuneId);
      const rarityIndex = Number(cookie.rarity);
      const rarityKey = rarities[rarityIndex] ?? "common";
      const pool = data.fortunes[nextArchetype][rarityKey];
      const nextFortune = pool[fortuneIndex % pool.length];

      setArchetype(nextArchetype);
      setRarity(rarityKey);
      setFortune(nextFortune);
      setTxSig(signature);
      await refreshStats();
    } catch (err) {
      setError("Transaction failed. Check wallet and network.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main>
      <div className="shell">
        <section className="hero">
          <span className="kicker">Zen Fortune Cookie</span>
          <h1 className="title">Crack a fortune with on-chain flavor.</h1>
          <p className="subtitle">
            Connect a wallet, pick an archetype, then call the on-chain program
            to reveal a fortune backed by proof.
          </p>
          <WalletMultiButton />
        </section>

        <section className="panel">
          <div className="grid">
            <div className="buttons">
              {archetypes.map((item) => (
                <button
                  key={item}
                  className={!randomMode && selected === item ? "active" : ""}
                  onClick={() => {
                    setSelected(item);
                    setRandomMode(false);
                  }}
                  type="button"
                >
                  {item}
                </button>
              ))}
              <button
                className={randomMode ? "active" : ""}
                onClick={() => setRandomMode(true)}
                type="button"
              >
                random
              </button>
            </div>

            <div className="buttons">
              <button
                className={gestureMode ? "active" : ""}
                onClick={() => setGestureMode(!gestureMode)}
                type="button"
              >
                {gestureMode ? "👋 Gesture Mode ON" : "👋 Gesture Mode"}
              </button>
            </div>

            {gestureMode ? (
              <GestureDetector
                enabled={gestureMode}
                onCrackGestureDetected={crackCookie}
                onDisable={() => setGestureMode(false)}
              />
            ) : (
              <div className="buttons">
                <button
                  className="crack"
                  onClick={crackCookie}
                  type="button"
                  disabled={isLoading}
                >
                  {isLoading ? "Cracking..." : "Crack the cookie"}
                </button>
                {statsReady === false && (
                  <button onClick={initializeStats} type="button">
                    Initialize stats
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="fortune-card">
            <div className="badges">
              <span className="badge">archetype: {archetype}</span>
              <span className="badge">rarity: {rarity}</span>
              <span className="badge">seed: {seedLabel}</span>
              {typeof statsTotal === "number" && (
                <span className="badge">total opens: {statsTotal}</span>
              )}
            </div>
            <div className="fortune-text">
              {fortune ?? "No fortune yet. Crack a cookie to reveal one."}
            </div>
            {txSig && (
              <div className="footer">tx: {txSig.slice(0, 10)}...</div>
            )}
            {error && <div className="footer">{error}</div>}
          </div>

          <p className="footer">
            On-chain proof: program {PROGRAM_ID.toBase58().slice(0, 8)}...
          </p>
        </section>
      </div>
    </main>
  );
}
