/**
 * Batch-initialize all 64 StatsShard PDAs on-chain.
 *
 * Usage:
 *   ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
 *   ANCHOR_WALLET=~/.config/solana/id.json \
 *   npx ts-node --esm scripts/initShards.ts
 *
 * Options (env vars):
 *   SHARD_START=0   first shard (inclusive, default 0)
 *   SHARD_END=63    last shard  (inclusive, default 63)
 *   CONCURRENCY=4   parallel sends (default 4, max ~8 before rate-limit)
 *   DRY_RUN=1       print PDAs without sending transactions
 */

import * as anchor from "@coral-xyz/anchor";
import { PublicKey, SystemProgram } from "@solana/web3.js";

// Copy from target/idl/fortune_cookie.json after `anchor build`
import { IDL } from "../app/src/hooks/fortune_cookie_idl.js";

const PROGRAM_ID = new PublicKey(
  "DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85"
);
const NUM_SHARDS = 64;

function shardPda(shardId: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stats"), Buffer.from([shardId])],
    PROGRAM_ID
  );
  return pda;
}

async function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

async function initShard(
  program: anchor.Program<any>,
  shardId: number,
  pda: PublicKey,
  dryRun: boolean
): Promise<"skipped" | "created" | "failed"> {
  const info = await program.provider.connection.getAccountInfo(pda);
  if (info) return "skipped";

  if (dryRun) {
    console.log(`  [DRY] shard ${shardId.toString().padStart(2)} → ${pda.toBase58()}`);
    return "created";
  }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const sig = await program.methods
        .initializeStatsShard(shardId)
        .accounts({
          payer: program.provider.publicKey,
          shard: pda,
          systemProgram: SystemProgram.programId,
        })
        .rpc({ commitment: "confirmed" });
      console.log(`  ✓ shard ${shardId.toString().padStart(2)} → ${sig.slice(0, 16)}…`);
      return "created";
    } catch (err: any) {
      const msg = String(err?.message ?? err);
      if (msg.includes("already in use") || msg.includes("custom program error: 0x0")) {
        return "skipped"; // race: another process initialized it
      }
      if (attempt < 3) {
        console.warn(`  ↺ shard ${shardId} attempt ${attempt} failed, retrying…`);
        await sleep(1500 * attempt);
      } else {
        console.error(`  ✗ shard ${shardId} FAILED: ${msg}`);
        return "failed";
      }
    }
  }
  return "failed";
}

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(IDL as any, provider);

  const start = Number(process.env.SHARD_START ?? 0);
  const end = Number(process.env.SHARD_END ?? NUM_SHARDS - 1);
  const concurrency = Math.min(Number(process.env.CONCURRENCY ?? 4), 8);
  const dryRun = process.env.DRY_RUN === "1";

  console.log(`\n🥠 Fortune Cookie — Shard Initializer`);
  console.log(`   Program : ${PROGRAM_ID.toBase58()}`);
  console.log(`   Cluster : ${provider.connection.rpcEndpoint}`);
  console.log(`   Payer   : ${provider.publicKey?.toBase58()}`);
  console.log(`   Range   : shards ${start}–${end}`);
  console.log(`   Parallel: ${concurrency}${dryRun ? "  [DRY RUN]" : ""}\n`);

  const shards = Array.from({ length: end - start + 1 }, (_, i) => start + i);
  const results = { created: 0, skipped: 0, failed: 0 };

  // Process in batches of `concurrency`
  for (let i = 0; i < shards.length; i += concurrency) {
    const batch = shards.slice(i, i + concurrency);
    const outcomes = await Promise.all(
      batch.map((id) => initShard(program, id, shardPda(id), dryRun))
    );
    outcomes.forEach((o) => results[o]++);
    // Short pause between batches to avoid hitting RPC rate limits
    if (i + concurrency < shards.length) await sleep(300);
  }

  console.log(`\n📊 Done`);
  console.log(`   Created : ${results.created}`);
  console.log(`   Skipped : ${results.skipped} (already existed)`);
  console.log(`   Failed  : ${results.failed}`);

  if (results.failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
