# Zen Fortune Cookie

A Solana dApp where you tap a cookie and mint an on-chain fortune. Each
open writes a `FortuneCookie` PDA, bumps a sharded `StatsShard` counter,
and emits a `CookieOpened` event for off-chain aggregation.

The whole point: gameplay never blocks on a wallet popup. A session
keypair signs the hot path; the main wallet only signs once to authorize
the session.

Four archetypes (`degen`, `builder`, `vc`, `founder`), three rarity
tiers, every open immutably recorded on Solana.

**Program ID:** `DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85` (devnet)

## Stack

- **On-chain:** Anchor 0.31.1, Rust (pinned in `rust-toolchain.toml`)
- **App:** Next.js 14.2.5, React 18, `@coral-xyz/anchor` 0.32,
  `@solana/wallet-adapter`
- **Optional:** `@dynamic-labs/*` (email/social wallet),
  `@magicblock-labs/gum-react-sdk` (MagicBlock session keys),
  `@switchboard-xyz/on-demand` (VRF). All guarded by try/catch so the
  build passes without them.
- **Off-chain stats:** Helius webhook → in-memory event store
  (swap for Vercel KV / Upstash in M3).

## Quick start

Prereqs: Rust + Solana CLI + Anchor 0.31 + Node 20+.

```bash
# 1. Build & deploy the program
anchor build
solana-test-validator --reset &        # localnet
anchor deploy

# 2. Initialize all 64 stats shards (one-time per deploy)
ANCHOR_PROVIDER_URL=http://localhost:8899 \
ANCHOR_WALLET=~/.config/solana/id.json \
node scripts/initShards.mjs

# 3. Run the frontend
cd app
npm install --omit=optional
npm run dev
```

Open http://localhost:3000, connect Phantom/Solflare, tap the cookie.

## Project layout

```
.
├── programs/fortune_cookie/   # Anchor program (Rust)
│   ├── src/lib.rs             # instructions + state
│   └── tests/                 # Rust unit tests
├── app/                       # Next.js frontend
│   └── src/
│       ├── app/               # routes, api/rpc proxy, api/webhook, api/stats
│       ├── components/        # GestureDetector, WalletButton, ...
│       ├── hooks/             # useFortuneCookie*, useVrfFortune, IDL
│       ├── lib/               # session keys, stats store, diagnostics
│       └── fortunes.json      # all four archetypes' fortune pools
├── scripts/
│   ├── initShards.mjs         # one-time shard init
│   └── verify-chain.sh        # on-chain sanity check
├── tests/                     # ts-mocha integration tests
├── .github/workflows/ci.yml   # type-check, PDA-collision regression, next build
└── Anchor.toml
```

## How a fortune is generated

1. Frontend builds an `open_cookie` ix with a strictly monotonic
   `counter` (millisecond, bumped by 1 on tie — the cookie PDA seed
   is `[authority, "cookie", counter.le_bytes()]`, so same-second
   collisions fail).
2. Program reads the two most recent `SlotHashes` for entropy.
3. Mixes with `user_pubkey` + `archetype` + `counter`.
4. Derives `fortune_id` (0–49) and `rarity` (0–3).
5. Writes the `FortuneCookie` PDA + bumps `StatsShard[user[0] % 64]`.

Frontend looks up the text in `fortunes.json` using
`(archetype, rarity, fortune_id)`.

## Wallet modes

| Mode | Trigger | Popups per session |
|------|---------|--------------------|
| Phantom / Solflare | default | 1 connect + 1 `create_session`, then 0 |
| Dynamic (email / Google / Apple) | set `NEXT_PUBLIC_DYNAMIC_ENV_ID` | same |
| Demo / mock | no wallet | 0 — no on-chain calls |

## Testing

```bash
# Rust unit tests (Anchor program)
cargo test --manifest-path programs/fortune_cookie/Cargo.toml

# TypeScript integration tests (against local validator)
anchor test

# Playwright E2E (auto-starts the dev server)
cd app
npm i -D @playwright/test && npx playwright install chromium
npm run test:e2e
```

CI runs `tsc --noEmit`, a PDA-monotonic-counter regression check, and
`next build` on every PR — see [.github/workflows/ci.yml](.github/workflows/ci.yml).

## Verifying on-chain activity

```bash
solana logs DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85 \
  -u http://localhost:8899
```

Full debugging recipes in [BLOCKCHAIN_VERIFICATION.md](BLOCKCHAIN_VERIFICATION.md).

## Docs

- [CLAUDE.md](CLAUDE.md) — architecture decisions, gotchas, non-negotiable patterns
- [MIGRATION.md](MIGRATION.md) — M0 → M1 (sharded stats, session keys)
- [PR_DESCRIPTION.md](PR_DESCRIPTION.md) — M1 changelog + feature-flag matrix
- [BLOCKCHAIN_VERIFICATION.md](BLOCKCHAIN_VERIFICATION.md) — manual on-chain verification
- [app/GESTURE_SETUP.md](app/GESTURE_SETUP.md) — webcam / hand-tracking setup

## License

MIT
