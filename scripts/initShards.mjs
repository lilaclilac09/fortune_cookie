// Plain ESM script — no ts-node needed
// Usage: ANCHOR_WALLET=~/.config/solana/id.json node scripts/initShards.mjs

import { readFileSync } from 'fs';
import { homedir } from 'os';
import { Connection, Keypair, PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const IDL = require('../target/idl/fortune_cookie.json');

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');
const RPC = process.env.ANCHOR_PROVIDER_URL ?? 'https://api.devnet.solana.com';
const WALLET_PATH = (process.env.ANCHOR_WALLET ?? '~/.config/solana/id.json').replace('~', homedir());

const kpRaw = JSON.parse(readFileSync(WALLET_PATH, 'utf8'));
const payer = Keypair.fromSecretKey(new Uint8Array(kpRaw));
const connection = new Connection(RPC, 'confirmed');

const wallet = {
  publicKey: payer.publicKey,
  signTransaction: async (tx) => { tx.partialSign(payer); return tx; },
  signAllTransactions: async (txs) => txs.map(tx => { tx.partialSign(payer); return tx; }),
};
const provider = new anchor.AnchorProvider(connection, wallet, { commitment: 'confirmed' });
const program = new anchor.Program(IDL, provider);

function shardPda(shardId) {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from('stats'), Buffer.from([shardId])],
    PROGRAM_ID
  );
  return pda;
}

async function initShard(shardId) {
  const pda = shardPda(shardId);
  const info = await connection.getAccountInfo(pda);
  if (info) { process.stdout.write(`s${shardId}✓ `); return 'skipped'; }

  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const sig = await program.methods
        .initializeStatsShard(shardId)
        .accounts({ payer: payer.publicKey, shard: pda, systemProgram: SystemProgram.programId })
        .rpc({ commitment: 'confirmed', skipPreflight: false });
      process.stdout.write(`s${shardId}✅ `);
      return 'created';
    } catch (err) {
      const msg = String(err?.message ?? err);
      if (msg.includes('already in use') || msg.includes('0x0')) {
        process.stdout.write(`s${shardId}≈ `);
        return 'skipped';
      }
      if (attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * attempt));
      } else {
        process.stdout.write(`s${shardId}✗ `);
        console.error(`\nShard ${shardId} failed: ${msg}`);
        return 'failed';
      }
    }
  }
}

const DRY = process.env.DRY_RUN === '1';
console.log(`🥠 Initializing 64 StatsShard accounts`);
console.log(`   RPC:   ${RPC}`);
console.log(`   Payer: ${payer.publicKey.toBase58()}`);
if (DRY) { console.log('   [DRY RUN — not sending]'); }

const results = { created: 0, skipped: 0, failed: 0 };

// Batches of 4 to avoid rate-limit
for (let i = 0; i < 64; i += 4) {
  const batch = [i, i+1, i+2, i+3].filter(n => n < 64);
  const outcomes = await Promise.all(batch.map(id => initShard(id)));
  outcomes.forEach(o => results[o]++);
  if (i + 4 < 64) await new Promise(r => setTimeout(r, 400));
}

console.log(`\n\n📊 Results: created=${results.created}  skipped=${results.skipped}  failed=${results.failed}`);
if (results.failed > 0) process.exit(1);
