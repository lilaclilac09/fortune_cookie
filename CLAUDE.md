# CLAUDE.md — Zen Fortune Cookie

## What this project is
A Solana dApp where users tap a cookie to mint an on-chain fortune. Each open writes
a `FortuneCookie` PDA, bumps a sharded `StatsShard` counter, and emits a
`CookieOpened` event for off-chain aggregation. The whole point is that
gameplay never blocks on a wallet popup — a session keypair signs the hot path,
the main wallet only signs once to authorize the session.

## Current milestone
**M2 — concurrency hardening**
- Status: in progress
- Completed: M0 (cookie/rarity flow), M1 (64-shard stats + on-chain session tokens + SlotHashes entropy + Dynamic wallet + Helius webhook + optional VRF)
- Next: M3 (production stats backend — Vercel KV or Upstash)

## Stack
- On-chain: Anchor 0.31.1, Rust 1.89.0 (pinned in `rust-toolchain.toml`)
- App: Next.js 14.2.5, React 18, `@coral-xyz/anchor` 0.32, `@solana/wallet-adapter`
- Network: Solana devnet, program ID `DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85`
- Optional deps (graceful-degrade via try/catch): `@magicblock-labs/gum-react-sdk`,
  `@dynamic-labs/*`, `@switchboard-xyz/on-demand`

## Non-negotiable patterns
- The `counter` arg of `open_cookie` is part of the cookie PDA seed
  (`[authority, "cookie", counter.le_bytes()]`). It MUST be strictly monotonic per
  authority — two taps in the same second collide on the PDA and the second
  init fails with `AccountAlreadyInUse`. The hook keeps a `lastCounterRef`
  seeded from `Date.now()` and bumps by 1 on a tie. Never use
  `Math.floor(Date.now()/1000)`.
- Anchor 0.32 optional accounts: pass `null`, never `undefined`. Was bitten in
  commit da2fb5b.
- `shard_id` is fixed: `shard_id = authority.pubkey()[0] % 64`. The program
  validates this; don't try to pick a cheaper shard, the tx will fail with
  `InvalidShard`.
- Don't await `connection.confirmTransaction` on the hot path. Return the sig
  optimistically and surface real status via `lastConfirmedSig` /
  `lastConfirmError` so the UI never claims "confirmed" before the network
  agrees.
- Mark a stats shard initialized only AFTER `getAccountInfo` confirms it
  landed on-chain. Optimistic caching poisons the set on init failure and every
  later `open_cookie` errors with `AccountNotInitialized`.
- The RPC proxy at `app/src/app/api/rpc/route.ts` must forward the raw request
  body. JSON.parse/stringify mangles `u64::MAX` values (e.g. `rentEpoch`) via JS
  number precision loss.

## Architecture decisions
- Stats are sharded across 64 PDAs (`shard_id = userPubkey[0] % 64`) instead of
  a single global counter. Avoids hot-account write serialization.
- Session keys are on-chain (`SessionToken` PDA), not just localStorage. Main
  wallet signs `create_session` once, session keypair signs every `open_cookie`,
  `revoke_session` closes the PDA and reclaims rent.
- Default entropy is the `SlotHashes` sysvar (two most-recent slot hashes mixed
  with user pubkey + archetype + counter). Switchboard VRF is gated behind
  `--features vrf` and falls back to SlotHashes if randomness isn't settled in
  time.
- Helius webhook aggregates `CookieOpened` events into an in-memory store
  (`app/src/lib/statsStore.ts`). On-chain per-shard `total_opens` is the source
  of truth — the API-served aggregate is approximate and resets on Vercel cold
  start.
- Dynamic wallet provider imports its SDK inside a try/catch so the build
  passes even when the optional packages aren't installed.

## Known gotchas
- `lib/sessionKeyProvider.ts` (live) and `lib/session-wallet.ts` (dead) both
  export `getOrCreateSessionKeypair` under different localStorage keys
  (`fc_sk_keypair_v2` vs `fc_session_keypair`). Always import from
  `sessionKeyProvider`.
- IDL discriminators come from `anchor build`. Re-sync
  `app/src/hooks/fortune_cookie_idl.ts` and `.json` after every program rebuild
  or you'll send instructions to old code with no compile error.
- `Stats` struct changed between M0 and M1 (single account → 64 shards).
  Localnet needs `solana-test-validator --reset` to discard the old account.
- MagicBlock program ID in `app/src/lib/magicblockSession.ts` is a placeholder.
  Replace before enabling.
- Playwright e2e tests under `app/tests/e2e/` require `@playwright/test`, which
  is in `devDependencies` but not installed by default — install via
  `npm i -D @playwright/test && npx playwright install chromium`. The directory
  is excluded from `tsc --noEmit` so CI stays green without it.

## Spec index
- `PR_DESCRIPTION.md` — what shipped in M1 (sharding, session keys, VRF, Dynamic, webhook)
- `MIGRATION.md` — how to apply M1 changes on top of M0
- `BLOCKCHAIN_VERIFICATION.md` — manual on-chain verification recipes
- `docs/implementation-notes.md` — original M0 design notes

## Autonomous execution
Authorized: commit to feature branches, run tests, create PRs, run `anchor build`,
run `anchor deploy --provider.cluster devnet`.

Hard limits:
- No force push to `main`
- No bumping `@coral-xyz/anchor` without re-syncing the IDL files in `app/src/hooks/`
- No changing `declare_id!()` without redeploying and updating `PROGRAM_ID`
  constants in `useFortuneCookieRealBlockchain.ts`, `useVrfFortune.ts`, and
  `sessionKeyProvider.ts`
- No mainnet deploy
- No committing `~/.config/solana/id.json` or any private key file (also blocked
  by `.gitignore`, but double-check)

## Memory rules
1. Cookie PDA `counter` seed must be strictly monotonic. Second-granularity
   timestamps collide.
2. Anchor optional accounts pass `null`, not `undefined`.
3. Stats shard is determined by `authority.pubkey()[0] % 64` — the program
   enforces it.
4. Confirmation runs in the background. The UI must use `lastConfirmedSig` /
   `lastConfirmError` to display real status, not assume `sendRawTransaction`
   returning means confirmed.
5. The Anchor IDL files in `app/src/hooks/` are hand-synced after every
   `anchor build`. Don't edit them by hand.

## CI
GitHub Actions at `.github/workflows/ci.yml`:
- App job: `npm ci` → `tsc --noEmit` → PDA-monotonic regression smoke → `next build`
- Program job: `cargo check --manifest-path programs/fortune_cookie/Cargo.toml`

Full `anchor test` (needs solana-cli + a local validator) is not in CI yet —
add it when there's an integration test worth running on every push.
