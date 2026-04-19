/**
 * Helius enhanced-transaction webhook receiver.
 *
 * Setup (Helius dashboard → Webhooks → Create):
 *   URL      : https://<your-domain>/api/webhook/helius
 *   Type     : Enhanced Transactions
 *   Program  : DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85
 *   Secret   : set HELIUS_WEBHOOK_SECRET in .env.local
 *
 * Helius will POST a JSON array of enriched transactions any time
 * our program is involved.  We parse the CookieOpened event and
 * update the in-memory stats store (swap for KV in prod).
 */

import { NextRequest, NextResponse } from "next/server";
import { createHmac, timingSafeEqual } from "crypto";
import {
  applyEvent,
  parseCookieOpenedFromLogs,
  type HeliusWebhookTransaction,
} from "@/lib/statsStore";

const WEBHOOK_SECRET = process.env.HELIUS_WEBHOOK_SECRET ?? "";

function verifySignature(body: string, sigHeader: string | null): boolean {
  if (!WEBHOOK_SECRET) {
    console.warn("[helius-webhook] HELIUS_WEBHOOK_SECRET not set — skipping verification");
    return true; // allow in dev without a secret
  }
  if (!sigHeader) return false;

  const expected = createHmac("sha256", WEBHOOK_SECRET)
    .update(body)
    .digest("hex");

  try {
    return timingSafeEqual(
      Buffer.from(sigHeader, "hex"),
      Buffer.from(expected, "hex")
    );
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const rawBody = await req.text();
  const sig = req.headers.get("helius-signature");

  if (!verifySignature(rawBody, sig)) {
    return NextResponse.json({ error: "invalid signature" }, { status: 401 });
  }

  let payload: HeliusWebhookTransaction[];
  try {
    payload = JSON.parse(rawBody);
    if (!Array.isArray(payload)) throw new Error("expected array");
  } catch (err) {
    return NextResponse.json({ error: "bad payload" }, { status: 400 });
  }

  let processed = 0;

  for (const tx of payload) {
    const logs: string[] = tx.logs ?? [];
    const event = parseCookieOpenedFromLogs(logs);

    if (event) {
      applyEvent(event);
      processed++;
      console.log(
        `[helius-webhook] CookieOpened sig=${tx.signature.slice(0, 12)}… ` +
          `user=${event.user.slice(0, 8)}… archetype=${event.archetype} rarity=${event.rarity}`
      );
    }
  }

  return NextResponse.json({ ok: true, processed });
}

// Helius sends GET pings to verify the endpoint is alive
export async function GET(): Promise<NextResponse> {
  return NextResponse.json({ ok: true, service: "fortune-cookie-webhook" });
}
