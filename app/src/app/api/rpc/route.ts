import { NextRequest, NextResponse } from 'next/server';
import https from 'node:https';
import { HttpsProxyAgent } from 'https-proxy-agent';

const RPC_URL = process.env.SOLANA_RPC_INTERNAL ?? 'https://api.devnet.solana.com';
const proxyUrl =
  process.env.https_proxy ??
  process.env.http_proxy ??
  process.env.HTTPS_PROXY ??
  process.env.HTTP_PROXY ??
  process.env.ALL_PROXY ??
  process.env.all_proxy;

function httpsPost(url: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
      ...(proxyUrl ? { agent: new HttpsProxyAgent(proxyUrl) } : {}),
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve(data));
    });

    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const raw = await httpsPost(RPC_URL, JSON.stringify(body));
    return NextResponse.json(JSON.parse(raw));
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
