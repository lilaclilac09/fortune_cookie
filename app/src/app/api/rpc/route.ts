import { NextRequest, NextResponse } from 'next/server';

const RPC_URL = process.env.SOLANA_RPC_INTERNAL ?? 'https://api.devnet.solana.com';

export async function POST(request: NextRequest) {
  try {
    // Pass body as raw text to avoid JSON.parse/stringify mangling u64 values
    // (e.g. rentEpoch = u64::MAX gets corrupted by JS number precision)
    const rawBody = await request.text();
    const res = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: rawBody,
    });
    const rawResponse = await res.text();
    return new Response(rawResponse, {
      status: res.status,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
