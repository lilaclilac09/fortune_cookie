#!/usr/bin/env tsx
/**
 * End-to-end devnet demo of the session-key flow.
 *
 * Every transaction prints a Solana Explorer URL you can click to confirm
 * it actually landed on-chain.
 *
 * Prerequisites
 *   1. Anchor program must be deployed with the session-key instructions
 *      (authorize_session / revoke_session / open_cookie_via_session).
 *      Locally:  anchor build && anchor deploy --provider.cluster devnet
 *   2. Node deps installed:  cd tests && npm install
 *   3. SOL on the user keypair (script will request devnet airdrop if low).
 *
 * Run
 *   cd tests
 *   npx tsx ../scripts/devnet-session-key-loop.ts           # fresh random user
 *   USER_KEYPAIR=/path/to/id.json npx tsx ../scripts/devnet-session-key-loop.ts
 *   LOOP_N=30 npx tsx ../scripts/devnet-session-key-loop.ts # 30 cookies
 *   RPC=https://api.devnet.solana.com npx tsx ../scripts/devnet-session-key-loop.ts
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
const SESSION_DURATION_SEC = Number(process.env.DURATION ?? "3600");
const SESSION_FUNDING = Number(process.env.FUNDING_LAMPORTS ?? String(50_000_000)); // 0.05 SOL

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { IDL: RAW_IDL } = require(path.resolve(__dirname, "../app/src/hooks/fortune_cookie_idl"));
// eslint-disable-next-line @typescript-eslint/no-var-requires
const crypto = require("crypto");

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
function convertAccount(a: any): any {
  const o: any = { name: a.name };
  if (a.isMut || a.writable) o.writable = true;
  if (a.isSigner || a.signer) o.signer = true;
  if (a.address) o.address = a.address;
  if (a.pda) o.pda = a.pda;
  if (a.optional) o.optional = true;
  return o;
}
const IDL = {
  ...RAW_IDL,
  address: PROGRAM_ID.toBase58(),
  instructions: RAW_IDL.instructions.map((ix: any) => ({
    ...ix,
    discriminator: disc("global", ix.name),
    accounts: (ix.accounts ?? []).map(convertAccount),
    args: convertFields(ix.args ?? []),
  })),
  accounts: (RAW_IDL.accounts ?? []).map((a: any) => ({
    name: a.name,
    discriminator: disc("account", a.name),
  })),
  types: [
    ...(RAW_IDL.types ?? []),
    ...(RAW_IDL.accounts ?? []).map((a: any) => ({
      name: a.name,
      type: { ...a.type, fields: convertFields(a.type?.fields ?? []) },
    })),
    ...(RAW_IDL.events ?? []).map((e: any) => ({
      name: e.name,
      type: { kind: "struct", fields: convertFields(e.fields ?? []) },
    })),
  ],
  events: RAW_IDL.events?.map((e: any) => ({
    name: e.name,
    discriminator: disc("event", e.name),
  })),
};

// ── Helpers ────────────────────────────────────────────────────────────────

function explorerTx(sig: string): string {
  return `https://explorer.solana.com/tx/${sig}?cluster=${CLUSTER_LABEL}`;
}

function explorerAddr(addr: string): string {
  return `https://explorer.solana.com/address/${addr}?cluster=${CLUSTER_LABEL}`;
}

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

async function ensureFunded(
  conn: Connection,
  owner: PublicKey,
  minLamports: number,
  label: string,
): Promise<void> {
  const bal = await conn.getBalance(owner, "confirmed");
  if (bal >= minLamports) {
    console.log(`   ${label} balance: ${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL (ok)`);
    return;
  }
  const need = Math.max(minLamports - bal, LAMPORTS_PER_SOL);
  console.log(
    `   ${label} low (${(bal / LAMPORTS_PER_SOL).toFixed(4)} SOL) → airdrop ${
      need / LAMPORTS_PER_SOL
    } SOL …`,
  );
  try {
    const sig = await conn.requestAirdrop(owner, need);
    await conn.confirmTransaction(sig, "confirmed");
    console.log(`   airdrop: ${explorerTx(sig)}`);
  } catch (err: any) {
    console.warn(`   ⚠ airdrop failed (${err?.message}) — top up manually if txs fail`);
  }
}

function deriveStatsPda(): PublicKey {
  return PublicKey.findProgramAddressSync([Buffer.from("stats")], PROGRAM_ID)[0];
}

function deriveSessionPda(user: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [user.toBuffer(), Buffer.from("session")],
    PROGRAM_ID,
  )[0];
}

function deriveCookiePda(user: PublicKey, counter: bigint): PublicKey {
  const bn = new anchor.BN(counter.toString()).toArrayLike(Buffer, "le", 8);
  return PublicKey.findProgramAddressSync(
    [user.toBuffer(), Buffer.from("cookie"), bn],
    PROGRAM_ID,
  )[0];
}

// ── Main ───────────────────────────────────────────────────────────────────

async function main() {
  console.log(`\n🌐 RPC:       ${RPC}`);
  console.log(`🧩 Program:   ${PROGRAM_ID.toBase58()}`);
  console.log(`🔁 Loop N:    ${LOOP_N}`);
  console.log(`⏱  Duration:  ${SESSION_DURATION_SEC}s`);
  console.log(`💰 Funding:   ${(SESSION_FUNDING / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
  console.log("");

  const conn = new Connection(RPC, "confirmed");
  const user = loadOrCreateUser();
  console.log(`👤 User:      ${user.publicKey.toBase58()}`);
  console.log(`   ${explorerAddr(user.publicKey.toBase58())}`);

  await ensureFunded(conn, user.publicKey, LAMPORTS_PER_SOL, "user");

  // Wallet shim (same shape the frontend uses)
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

  const statsPda = deriveStatsPda();
  const sessionPda = deriveSessionPda(user.publicKey);

  // ── Step 1: initialize_stats (idempotent) ──
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
  } else {
    console.log(`\n📊 Stats PDA already exists: ${explorerAddr(statsPda.toBase58())}`);
  }

  // ── Step 2: authorize_session + fund the session key (ONE user signature) ──
  const sessionKey = Keypair.generate();
  console.log(`\n🔑 Session key (ephemeral): ${sessionKey.publicKey.toBase58()}`);
  console.log(`   ${explorerAddr(sessionKey.publicKey.toBase58())}`);

  const authIx = await program.methods
    .authorizeSession(sessionKey.publicKey, new anchor.BN(SESSION_DURATION_SEC))
    .accounts({
      user: user.publicKey,
      session: sessionPda,
      systemProgram: SystemProgram.programId,
    })
    .instruction();
  const fundIx = SystemProgram.transfer({
    fromPubkey: user.publicKey,
    toPubkey: sessionKey.publicKey,
    lamports: SESSION_FUNDING,
  });

  const authTx = new Transaction().add(authIx, fundIx);
  const latest = await conn.getLatestBlockhash("confirmed");
  authTx.feePayer = user.publicKey;
  authTx.recentBlockhash = latest.blockhash;
  authTx.sign(user);

  console.log(`\n📨 authorize_session + fund transfer (THE ONLY wallet signature) …`);
  const authSig = await conn.sendRawTransaction(authTx.serialize());
  await conn.confirmTransaction(
    {
      signature: authSig,
      blockhash: latest.blockhash,
      lastValidBlockHeight: latest.lastValidBlockHeight,
    },
    "confirmed",
  );
  console.log(`   ✓ ${explorerTx(authSig)}`);
  console.log(`   session PDA: ${explorerAddr(sessionPda.toBase58())}`);

  // ── Step 3: loop open_cookie_via_session (NO user signature) ──
  console.log(
    `\n🔁 Looping ${LOOP_N} open_cookie_via_session calls — user wallet is NOT signing:\n`,
  );

  const baseCounter = BigInt(Date.now()) * 1000n;
  const loopStart = Date.now();
  const signatures: string[] = [];

  for (let i = 0; i < LOOP_N; i++) {
    const counter = baseCounter + BigInt(i);
    const archetype = i % 4;
    const cookiePda = deriveCookiePda(user.publicKey, counter);

    const openIx = await program.methods
      .openCookieViaSession(archetype, new anchor.BN(counter.toString()))
      .accounts({
        sessionKey: sessionKey.publicKey,
        user: user.publicKey,
        session: sessionPda,
        cookie: cookiePda,
        stats: statsPda,
        systemProgram: SystemProgram.programId,
      })
      .instruction();

    const tx = new Transaction().add(openIx);
    const bh = await conn.getLatestBlockhash("confirmed");
    tx.feePayer = sessionKey.publicKey; // session key pays everything
    tx.recentBlockhash = bh.blockhash;
    tx.sign(sessionKey); // <-- user is NOT in signers

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
        `open_cookie_via_session #${i} failed: ${JSON.stringify(conf.value.err)}`,
      );
    }

    signatures.push(sig);
    console.log(
      `   [${String(i + 1).padStart(String(LOOP_N).length)}/${LOOP_N}] ` +
        `archetype=${archetype} counter=${counter}  ${explorerTx(sig)}`,
    );
  }

  const loopMs = Date.now() - loopStart;

  // ── Assertions ──
  const unique = new Set(signatures);
  if (unique.size !== LOOP_N) {
    throw new Error(`Expected ${LOOP_N} distinct signatures, got ${unique.size}`);
  }

  const stats: any = await program.account.stats.fetch(statsPda);
  const session: any = await program.account.session.fetch(sessionPda);

  console.log(
    `\n✅ Looped ${LOOP_N} opens in ${(loopMs / 1000).toFixed(1)}s ` +
      `(avg ${(loopMs / LOOP_N).toFixed(0)}ms/open), all distinct signatures on-chain.`,
  );
  console.log(
    `   stats.total_opens: ${stats.totalOpens.toString()} · session expires_at: ${session.expiresAt.toString()}`,
  );
  console.log(
    `\n🎯 Only ONE user-wallet signature happened. Every subsequent tx above is\n` +
      `   signed by the session key, not the user. Click any Explorer link to verify.\n`,
  );
}

main().catch((err) => {
  console.error("\n❌", err);
  process.exit(1);
});
