/**
 * Off-chain stats store.
 *
 * In production, swap the in-memory Map for Vercel KV / Upstash Redis:
 *   import { kv } from '@vercel/kv';
 *   await kv.hincrby('cookie_stats', 'total', delta);
 *
 * Current impl uses a module-level Map so it persists across hot-reloads
 * during development but resets on cold starts.  Good enough for devnet.
 */

export interface CookieStats {
  total: number;
  byArchetype: [number, number, number, number]; // index = archetype 0-3
  byRarity: [number, number, number, number];    // 0=common 1=uncommon 2=rare 3=legendary
  lastUpdated: number; // unix ms
}

// ── In-memory store (replace with KV in production) ───────────────────────────

const store: CookieStats = {
  total: 0,
  byArchetype: [0, 0, 0, 0],
  byRarity: [0, 0, 0, 0],
  lastUpdated: Date.now(),
};

export function getStats(): CookieStats {
  return { ...store, byArchetype: [...store.byArchetype] as any, byRarity: [...store.byRarity] as any };
}

export function applyEvent(event: {
  archetype: number;
  rarity: number;
}): void {
  if (event.archetype >= 0 && event.archetype <= 3) {
    store.byArchetype[event.archetype]++;
  }
  if (event.rarity >= 0 && event.rarity <= 3) {
    store.byRarity[event.rarity]++;
  }
  store.total++;
  store.lastUpdated = Date.now();
}

// ── Helius webhook payload types ───────────────────────────────────────────────

export interface HeliusWebhookTransaction {
  type: string;
  signature: string;
  slot: number;
  logs: string[];
  events?: {
    compressed?: unknown[];
    nft?: unknown[];
    swap?: unknown[];
  };
  // Helius enhanced-transactions also include instructions
  instructions?: Array<{
    programId: string;
    accounts: string[];
    data: string;
    innerInstructions?: unknown[];
  }>;
  accountData?: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: unknown[];
  }>;
}

/**
 * Parse a `CookieOpened` event from the raw transaction logs.
 * Anchor emits events as base64-encoded data in the program logs.
 * The log line looks like:
 *   Program data: <base64 of (8-byte discriminator + serialized event)>
 *
 * We detect it by checking the discriminator (first 8 bytes of
 * sha256("event:CookieOpened")).  Since we can't run sha256 at import time,
 * we match by the known prefix from `anchor build` output.
 */
const COOKIE_OPENED_DISC = Buffer.from([137, 39, 90, 246, 59, 233, 68, 238]);

export interface ParsedCookieEvent {
  user: string;       // base58
  archetype: number;
  fortuneId: number;
  rarity: number;
}

export function parseCookieOpenedFromLogs(
  logs: string[]
): ParsedCookieEvent | null {
  for (const log of logs) {
    if (!log.startsWith("Program data: ")) continue;
    const b64 = log.slice("Program data: ".length).trim();
    let buf: Buffer;
    try {
      buf = Buffer.from(b64, "base64");
    } catch {
      continue;
    }
    if (buf.length < 8) continue;
    if (!buf.subarray(0, 8).equals(COOKIE_OPENED_DISC)) continue;

    // Layout after discriminator:
    //   32 bytes user pubkey
    //   1  byte  archetype
    //   8  bytes fortune_id (u64 LE)
    //   1  byte  rarity
    if (buf.length < 8 + 32 + 1 + 8 + 1) continue;

    const user = new (
      require("@solana/web3.js").PublicKey
    )(buf.subarray(8, 40)).toBase58();
    const archetype = buf[40];
    const rarity = buf[49];

    return { user, archetype, fortuneId: Number(buf.readBigUInt64LE(41)), rarity };
  }
  return null;
}
