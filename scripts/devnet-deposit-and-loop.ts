#!/usr/bin/env tsx
/**
 * Devnet E2E for the prepaid balance + treasury fee flow.
 *
 *   1. deposit SOL into user's balance PDA           [user signs]
 *   2. authorize_session with an ephemeral session key [user signs]
 *   3. loop open_cookie_prepaid N times               [session key signs]
 *   4. verify treasury grew by N × fee                [read-only]
 *
 * Every tx prints a Solana Explorer URL. Requires the new program deployed:
 *   anchor build && anchor deploy --provider.cluster devnet
 *
 * Run:
 *   cd tests && npx tsx ../scripts/devnet-deposit-and-loop.ts
 */

import * as fs from "fs";
import * as path from "path";
import * as anchor from "@coral-xyz/anchor";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85");
const RPC = process.env.RPC ?? "https://api.devnet.solana.com";
const CLUSTER_LABEL = RPC.includes("devnet")
  ? "devnet"
  : RPC.includes("testnet")
  ? "testnet"
  : "custom";
const LOOP_N = Number(process.env.LOOP_N ?? "10");
const DEPOSIT_SOL = Number(process.env.DEPOSIT_SOL ?? "0.05");
const SESSION_DURATION = Number(process.env.DURATION ?? "3600");
const SESSION_FUNDING_LAMPORTS = Number(
  process.env.SESSION_FUNDING ?? String(10_000_000), // 0.01 SOL — just for tx fees
);

const FEE_LAMPORTS = 500_000;

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { IDL: RAW_IDL } = require(path.resolve(__dirname, "../app/src/hooks/fortune_cookie_idl"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const crypto = require("crypto");

// Convert the hand-maintained Anchor 0.29-style IDL to the 0.30+ shape that
// the installed anchor client expects (address field, instruction
// discriminators, writable/signer flag rename, event types in `types[]`).
function disc(ns: string, name: string): number[] {
  return Array.from(
    crypto.createHash("sha256").update(`${ns}:${name}`).digest().slice(0, 8),
  );
}
function convertType(t: any): any {
  if (t === "publicKey") return "pubkey";
  if (typeof t === "object" && t !== null) {
    const o: any = {};
    for (const [k, v] of Object.entries(t)) o[k] = convertType(v);
    return o;
  }
  return t;
}
function convertFields(fields: any[]): any[] {
  return fields.map((f: any) => ({ ...f, type: convertType(f.type) }));
}
function convertAccount(acc: any): any {
  const o: any = { name: acc.name };
  if (acc.isMut || acc.writable) o.writable = true;
  if (acc.isSigner || acc.signer) o.signer = true;
  if (acc.address) o.address = acc.address;
  if (acc.pda) o.pda = acc.pda;
  if (acc.optional) o.optional = true;
  return o;
}
function buildIdl(idl: any): any {
  const accountTypes = (idl.accounts ?? []).map((a: any) => ({
    name: a.name,
    type: { ...a.type, fields: convertFields(a.type?.fields ?? []) },
  }));
  const eventTypes = (idl.events ?? []).map((e: any) => ({
    name: e.name,
    type: { kind: "struct", fields: convertFields(e.fields ?? []) },
  }));
  return {
    ...idl,
    address: PROGRAM_ID.toBase58(),
    instructions: idl.instructions.map((ix: any) => ({
      ...ix,
      discriminator: disc("global", ix.name),
      accounts: (ix.accounts ?? []).map(convertAccount),
      args: convertFields(ix.args ?? []),
    })),
    accounts: (idl.accounts ?? []).map((a: any) => ({
      name: a.name,
      discriminator: disc("account", a.name),
    })),
    types: [...(idl.types ?? []), ...accountTypes, ...eventTypes],
    events: idl.events?.map((e: any) => ({
      name: e.name,
      discriminator: disc("event", e.name),
    })),
  };
}
const IDL = buildIdl(RAW_IDL);

const explorerTx = (s: string) =>
  `https://explorer.solana.com/tx/${s}?cluster=${CLUSTER_LABEL}`;
const explorerAddr = (a: string) =>
  `https://explorer.solana.com/address/${a}?cluster=${CLUSTER_LABEL}`;

function loadOrCreateUser(): Keypair {
  const p = process.env.USER_KEYPAIR;
  if (p && fs.existsSync(p)) {
    return Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf-8")) as number[]),
    );
  }
  const kp = Keypair.generate();
  const out = path.resolve(__dirname, `./devnet-user-${Date.now()}.json`);
  fs.writeFileSync(out, JSON.stringify(Array.from(kp.secretKey)));
  console.log(`🔑 Generated user keypair → ${out}`);
  return kp;
}

async function ensureUserFunded(conn: Connection, user: PublicKey, min: number) {
  const bal = await conn.getBalance(user, "confirmed");
  console.log(`   user balance: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  if (bal >= min) return;
  try {
    const sig = await conn.requestAirdrop(user, 2 * LAMPORTS_PER_SOL);
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`   airdrop: ${explorerTx(sig)}`);
  } catch (e: any) {
    console.warn(`   ⚠ airdrop failed: ${e?.message}`);
  }
}

async function main() {
  console.log(`\n🌐 RPC:        ${RPC}`);
  console.log(`🧩 Program:    ${PROGRAM_ID.toBase58()}`);
  console.log(`🔁 Loop N:     ${LOOP_N}`);
  console.log(`💰 Deposit:    ${DEPOSIT_SOL} SOL → balance PDA`);
  console.log(`🪙 Fee/open:   ${(FEE_LAMPORTS / LAMPORTS_PER_SOL).toFixed(4)} SOL → treasury`);
  console.log("");

  const conn = new Connection(RPC, "confirmed");
  const user = loadOrCreateUser();
  console.log(`👤 User:       ${user.publicKey.toBase58()}`);
  console.log(`   ${explorerAddr(user.publicKey.toBase58())}`);

  await ensureUserFunded(conn, user.publicKey, 0.2 * LAMPORTS_PER_SOL);

  const wallet = {
    publicKey: user.publicKey,
    signTransaction: async (tx: Transaction) => {
      tx.partialSign(user);
      return tx;
    },
    signAllTransactions: async (txs: Transaction[]) => {
      for (const tx of txs) tx.partialSign(user);
      return txs;
    },
  };
  const provider = new anchor.AnchorProvider(
    conn,
    wallet as unknown as anchor.Wallet,
    { commitment: "confirmed" },
  );
  const program = new anchor.Program(IDL as any, provider as any);

  const [statsPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stats")],
    PROGRAM_ID,
  );
  const [balancePda] = PublicKey.findProgramAddressSync(
    [user.publicKey.toBuffer(), Buffer.from("balance")],
    PROGRAM_ID,
  );
  const [treasuryPda] = PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID,
  );
  const [sessionPda] = PublicKey.findProgramAddressSync(
    [user.publicKey.toBuffer(), Buffer.from("session")],
    PROGRAM_ID,
  );

  // ── Step 1: initialize_stats (idempotent) ──
  const statsInfo = await conn.getAccountInfo(statsPda);
  if (!statsInfo) {
    console.log(`\n📝 Initializing stats PDA …`);
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

  // ── Step 1b: initialize_treasury (idempotent: tops up to rent-exempt min) ──
  const treasuryInfo = await conn.getAccountInfo(treasuryPda);
  if (!treasuryInfo || treasuryInfo.lamports < 890_880) {
    console.log(`\n📝 Funding treasury PDA to rent-exempt minimum …`);
    const sig = await program.methods
      .initializeTreasury()
      .accounts({
        payer: user.publicKey,
        treasury: treasuryPda,
        systemProgram: SystemProgram.programId,
      })
      .rpc();
    console.log(`   ✓ ${explorerTx(sig)}`);
  }

  // ── Step 2: deposit + authorize_session + fund session_key, ONE tx (one wallet sig) ──
  const sessionKey = Keypair.generate();
  console.log(`\n🔑 Session key: ${sessionKey.publicKey.toBase58()}`);
  console.log(`   ${explorerAddr(sessionKey.publicKey.toBase58())}`);

  const depositIx = await program.methods
    .deposit(new anchor.BN(Math.round(DEPOSIT_SOL * LAMPORTS_PER_SOL)))
    .accounts({
      user: user.publicKey,
      balance: balancePda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const authIx = await program.methods
    .authorizeSession(sessionKey.publicKey, new anchor.BN(SESSION_DURATION))
    .accounts({
      user: user.publicKey,
      session: sessionPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const fundSessionIx = SystemProgram.transfer({
    fromPubkey: user.publicKey,
    toPubkey: sessionKey.publicKey,
    lamports: SESSION_FUNDING_LAMPORTS,
  });

  const setupTx = new Transaction().add(depositIx, authIx, fundSessionIx);
  const latest = await conn.getLatestBlockhash("confirmed");
  setupTx.feePayer = user.publicKey;
  setupTx.recentBlockhash = latest.blockhash;
  setupTx.sign(user);

  console.log(`\n📨 Setup tx: deposit + authorize_session + fund session_key (ONE wallet sig)`);
  const setupSig = await conn.sendRawTransaction(setupTx.serialize());
  await conn.confirmTransaction(
    {
      signature: setupSig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  console.log(`   ✓ ${explorerTx(setupSig)}`);

  const balanceBefore = await conn.getBalance(balancePda, "confirmed");
  const treasuryBefore = await conn.getBalance(treasuryPda, "confirmed");
  console.log(
    `   balance PDA: ${(balanceBefore / LAMPORTS_PER_SOL).toFixed(4)} SOL · treasury: ${(treasuryBefore / LAMPORTS_PER_SOL).toFixed(6)} SOL`,
  );

  // ── Step 3: loop open_cookie_prepaid (no user signature) ──
  console.log(
    `\n🔁 Looping ${LOOP_N} open_cookie_prepaid — balance PDA pays rent, treasury collects fees:\n`,
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

    const openIx = await program.methods
      .openCookiePrepaid(archetype, new anchor.BN(counter.toString()))
      .accounts({
        sessionKey: sessionKey.publicKey,
        user: user.publicKey,
        session: sessionPda,
        balance: balancePda,
        treasury: treasuryPda,
        cookie: cookiePda,
        stats: statsPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(openIx);
    const bh = await conn.getLatestBlockhash("confirmed");
    tx.feePayer = sessionKey.publicKey;
    tx.recentBlockhash = bh.blockhash;
    tx.sign(sessionKey);

    const sig = await conn.sendRawTransaction(tx.serialize());
    const conf = await conn.confirmTransaction(
      {
        signature: sig,
        blockhash: bh.blockhash,
        lastValidBlockHeight: bh.lastValidBlockHeight,
      },
      "confirmed",
    );
    if (conf.value.err) {
      throw new Error(
        `open_cookie_prepaid #${i} failed: ${JSON.stringify(conf.value.err)}`,
      );
    }
    sigs.push(sig);
    console.log(
      `   [${String(i + 1).padStart(String(LOOP_N).length)}/${LOOP_N}] ` +
        `archetype=${archetype} counter=${counter}  ${explorerTx(sig)}`,
    );
  }

  const loopMs = Date.now() - loopStart;

  // ── Assertions on-chain ──
  const balanceAfter = await conn.getBalance(balancePda, "confirmed");
  const treasuryAfter = await conn.getBalance(treasuryPda, "confirmed");
  const expectedTreasuryGain = LOOP_N * FEE_LAMPORTS;
  const actualTreasuryGain = treasuryAfter - treasuryBefore;
  const balanceSpent = balanceBefore - balanceAfter;

  console.log(`\n📊 On-chain assertions:`);
  console.log(
    `   treasury gained: ${actualTreasuryGain} lamports (expected ${expectedTreasuryGain}): ${
      actualTreasuryGain === expectedTreasuryGain ? "✓" : "✗"
    }`,
  );
  console.log(
    `   balance PDA spent: ${balanceSpent} lamports (${(balanceSpent / LAMPORTS_PER_SOL).toFixed(6)} SOL, avg ${Math.round(balanceSpent / LOOP_N)} per open)`,
  );
  console.log(`   all signatures unique: ${new Set(sigs).size === LOOP_N ? "✓" : "✗"}`);
  console.log(`   elapsed: ${(loopMs / 1000).toFixed(1)}s (avg ${(loopMs / LOOP_N).toFixed(0)}ms/open)`);
  console.log(`\n🎯 One user wallet signature for deposit+authorize. Then ${LOOP_N} cookies opened with zero user prompts.\n`);
}

main().catch((e) => {
  console.error("\n❌", e);
  process.exit(1);
});
