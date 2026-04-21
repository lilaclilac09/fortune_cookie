/**
 * Public read endpoint for aggregated cookie stats.
 * Served from the webhook-updated in-memory store.
 *
 * GET /api/stats
 * Response: { total, byArchetype, byRarity, lastUpdated }
 *
 * Optional query params:
 *   ?shards=true  — also return on-chain shard totals (slower, hits RPC)
 */

import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { getStats } from "@/lib/statsStore";

const PROGRAM_ID = new PublicKey(
  "DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85"
);
const RPC = process.env.SOLANA_RPC_INTERNAL ?? "https://api.devnet.solana.com";

function shardPda(shardId: number): PublicKey {
  const [pda] = PublicKey.findProgramAddressSync(
    [Buffer.from("stats"), Buffer.from([shardId])],
    PROGRAM_ID
  );
  return pda;
}

/** Read total_opens from all 64 StatsShard accounts in one getMultipleAccounts call. */
async function fetchOnChainTotal(): Promise<number> {
  const conn = new Connection(RPC, "confirmed");
  const pdas = Array.from({ length: 64 }, (_, i) => shardPda(i));

  // getMultipleAccounts accepts max 100 keys per call — 64 fits in one round-trip
  const accounts = await conn.getMultipleAccountsInfo(pdas, {
    commitment: "confirmed",
  });

  return (accounts ?? []).reduce((sum, info) => {
    if (!info || info.data.length < 16) return sum;
    // StatsShard layout: 8 disc + 8 total_opens (u64 LE)
    const opens = Number(
      (info.data as Buffer).readBigUInt64LE(8)
    );
    return sum + opens;
  }, 0);
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  const wantChain = req.nextUrl.searchParams.get("shards") === "true";

  const offChain = getStats();

  if (!wantChain) {
    return NextResponse.json(offChain, {
      headers: { "Cache-Control": "public, s-maxage=5, stale-while-revalidate=30" },
    });
  }

  try {
    const onChainTotal = await fetchOnChainTotal();
    return NextResponse.json(
      { ...offChain, onChainTotal },
      {
        headers: { "Cache-Control": "public, s-maxage=15, stale-while-revalidate=60" },
      }
    );
  } catch (err) {
    // Fall back to off-chain aggregate if RPC fails
    return NextResponse.json(
      { ...offChain, onChainError: String(err) },
      { status: 200 }
    );
  }
}
