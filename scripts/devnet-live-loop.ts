#!/usr/bin/env tsx
/**
 * Baseline devnet demo: loop `open_cookie` with a live user signature on
 * every call. Every transaction prints a Solana Explorer URL. Good to run
 * BEFORE redeploying the session-key version, to prove your user keypair,
 * RPC, and the CURRENTLY deployed program are working end-to-end.
 *
 *   cd tests && npx tsx ../scripts/devnet-live-loop.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85");
const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const CLUSTER_LABEL = RPC.includes("devnet")
  ? "devnet"
  : RPC.includes("testnet")
  ? "testnet"
  : "custom";
const LOOP_N = Number(process.env.LOOP_N ?? "5");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { IDL } = require(path.resolve(__dirname, "../app/src/hooks/fortune_cookie_idl"));

const explorerTx = (sig: string) =>
  `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER_LABEL}`;
const explorerAddr = (a: string) =>
  `https://explorer.solana.com/address/${a}?cluster=${CLUSTER_LABEL}`;

function loadOrCreateUser(): Keypair {
  const p = process.env.USER_KEYPAIR;
  if (p && fs.existsSync(p)) {
    const raw = JSON.parse(fs.readFileSync(p, "utf-8")) as number[];
    return Keypair.fromSecretKey(Uint8Array.from(raw));
  }
  const kp = Keypair.generate();
  const outPath = path.resolve(__dirname, `./devnet-user-${Date.now()}.json`);
  fs.writeFileSync(outPath, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`🔑 Generated fresh user keypair → ${outPath}`);
  return kp;
}

async function main() {
  console.log(`\n🌐 RPC:      ${RPC}`);
  console.log(`🧩 Program:  ${PROGRAM_ID.toBase58()}`);
  console.log(`🔁 Loop N:   ${LOOP_N}`);
  console.log("");

  const conn = new Connection(RPC, "confirmed");
  const user = loadOrCreateUser();
  console.log(`👤 User:     ${user.publicKey.toBase58()}`);
  console.log(`   ${explorerAddr(user.publicKey.toBase58())}`);

  const bal = await conn.getBalance(user.publicKey, "confirmed");
  console.log(`   balance: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (bal < 0.05 * LAMPORTS_PER_SOL) {
    console.log(`   airdropping 1 SOL …`);
    try {
      const sig = await conn.requestAirdrop(user.publicKey, LAMPORTS_PER_SOL);
      await conn.confirmTransaction(sig, "confirmed");
      console.log(`   ${explorerTx(sig)}`);
    } catch (e: any) {
      console.warn(`   ⚠ airdrop failed: ${e?.message}`);
    }
  }

  const wallet = {
    publicKey: user.publicKey,
    signTransaction: async (tx: any) => {
      tx.partialSign(user);
      return tx;
    },
    signAllTransactions: async (txs: any[]) => {
      for (const tx of txs) tx.partialSign(user);
      return txs;
    },
  };
  const provider = new anchor.AnchorProvider(
    conn,
    wallet as unknown as anchor.Wallet,
    { commitment: "confirmed" },
  );
  const program = new anchor.Program(IDL as any, PROGRAM_ID, provider);

  const [statsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stats")],
    PROGRAM_ID,
  );

  const statsInfo = await conn.getAccountInfo(statsPda);
  if (!statsInfo) {
    console.log(`\n📝 Initializing global stats PDA …`);
    const sig = await program.methods
      .initializeStats()
      .accounts({
        payer: user.publicKey,
        stats: statsPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   ✓ ${explorerTx(sig)}`);
  }

  console.log(
    `\n🔁 Looping ${LOOP_N} open_cookie calls — wallet signs on EVERY call:\n`,
  );
  const baseCounter = BigInt(Date.now()) * 1000n;
  const sigs: string[] = [];
  const loopStart = Date.now();

  for (let i = 0; i < LOOP_N; i++) {
    const counter = baseCounter + BigInt(i);
    const archetype = i % 4;
    const [cookiePda] = PublicKey.findProgramAddressSync(
      [
        user.publicKey.toBuffer(),
        Buffer.from("cookie"),
        new anchor.BN(counter.toString()).toArrayLike(Buffer, "le", 8),
      ],
      PROGRAM_ID,
    );

    const sig = await program.methods
      .openCookie(archetype, new anchor.BN(counter.toString()))
      .accounts({
        user: user.publicKey,
        cookie: cookiePda,
        stats: statsPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    sigs.push(sig);
    console.log(
      `   [${String(i + 1).padStart(String(LOOP_N).length)}/${LOOP_N}] ` +
        `archetype=${archetype} counter=${counter}  ${explorerTx(sig)}`,
    );
  }

  const loopMs = Date.now() - loopStart;
  const stats: any = await program.account.stats.fetch(statsPda);
  console.log(
    `\n✅ ${LOOP_N} live-signed opens in ${(loopMs / 1000).toFixed(1)}s ` +
      `(avg ${(loopMs / LOOP_N).toFixed(0)}ms/open). stats.total_opens=${stats.totalOpens.toString()}\n`,
  );
}

main().catch((e) => {
  console.error("\n❌", e);
  process.exit(1);
});
