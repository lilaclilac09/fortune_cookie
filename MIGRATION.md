# Migration Guide — v1 → v2

## Summary of changes

| Area | Before | After |
|------|--------|-------|
| Stats | Single `Stats` PDA `[b"stats"]` | 64 `StatsShard` PDAs `[b"stats", &[id]]` |
| Randomness | `clock.slot + user + counter` (user-predictable) | SlotHashes sysvar (unpredictable) |
| Session auth | Burner wallet (no on-chain link) | `SessionToken` PDA ties ephemeral key to main wallet |
| `open_cookie` args | `(archetype, counter)` | `(archetype, counter, shard_id)` |
| `open_cookie` accounts | `user, cookie, stats, system_program` | `signer, authority, cookie, stats_shard, session_token?, slot_hashes, system_program` |
| New instructions | — | `initialize_stats_shard`, `create_session`, `revoke_session` |

---

## Step-by-step

### 1. Build the program

```bash
anchor build
```

This regenerates `target/idl/fortune_cookie.json` and `target/types/fortune_cookie.ts`.

### 2. Update the frontend IDL

Copy the new IDL into the app:

```bash
cp target/idl/fortune_cookie.json app/src/hooks/fortune_cookie_idl.json
# or update fortune_cookie_idl.ts manually from target/types/fortune_cookie.ts
```

The IDL now includes `initialize_stats_shard`, `create_session`, `revoke_session`, and
the updated `open_cookie` signature. If you keep `fortune_cookie_idl.ts` as a hand-written
file, copy the discriminators and type definitions exactly from the generated output —
any mismatch will silently send malformed instructions.

### 3. Reset localnet (required)

Old `Stats` PDA data is incompatible with `StatsShard`. On localnet:

```bash
solana-test-validator --reset
```

On devnet you can skip reset because the old program is not yet deployed at the new
address, but make sure you redeploy with:

```bash
anchor deploy --provider.cluster devnet
```

### 4. Initialize all 64 stat shards

Run this once after deployment. A convenience script:

```typescript
// scripts/initShards.ts
import * as anchor from '@coral-xyz/anchor';
import { PublicKey, SystemProgram } from '@solana/web3.js';
import { IDL } from '../app/src/hooks/fortune_cookie_idl';

const PROGRAM_ID = new PublicKey('DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85');

async function main() {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);
  const program = new anchor.Program(IDL as any, provider);

  for (let i = 0; i < 64; i++) {
    const [shard] = PublicKey.findProgramAddressSync(
      [Buffer.from('stats'), Buffer.from([i])],
      PROGRAM_ID,
    );
    const exists = await provider.connection.getAccountInfo(shard);
    if (exists) { console.log(`shard ${i} already exists`); continue; }
    await program.methods.initializeStatsShard(i)
      .accounts({ payer: provider.wallet.publicKey, shard, systemProgram: SystemProgram.programId })
      .rpc();
    console.log(`initialized shard ${i}`);
  }
}

main().catch(console.error);
```

```bash
ANCHOR_PROVIDER_URL=https://api.devnet.solana.com \
ANCHOR_WALLET=~/.config/solana/id.json \
ts-node scripts/initShards.ts
```

### 5. Run tests

```bash
anchor build && cargo test --manifest-path programs/fortune_cookie/Cargo.toml
```

All five tests should pass:
- `test_initialize_stats_shard`
- `test_open_cookie_valid_archetypes`
- `test_open_cookie_invalid_archetype_rejected`
- `test_stats_shard_increments`
- `test_cannot_reuse_same_counter`
- `test_session_key_flow`
- `test_wrong_shard_rejected`

### 6. Frontend — session flow

The updated hook (`useFortuneCookieRealBlockchain.ts`) now:

1. Uses the session keypair (localStorage) as the **tx signer** when funded.
2. Calls `ensureSession()` once per browser session — triggers one wallet popup
   to create the on-chain `SessionToken` PDA linking the ephemeral key to the
   main wallet. Subsequent opens need zero popups.
3. Routes stats writes to `statsShard` = `userPubkey[0] % 64` (fully parallel).
4. Passes the `SlotHashes` sysvar so the program can use real on-chain entropy.

---

## Concurrency improvement

With 64 shards, the expected write contention drops from **all users** serialized
on one account to **users per shard = totalUsers / 64**. For 1,000 concurrent
opens, each shard handles ~15 writes instead of 1,000.

## Security notes

- `rarity` is still pseudo-random (SlotHashes + user bytes). For any future
  feature that ties rarity to on-chain value (NFT mint, prize, reward), upgrade
  to Switchboard On-Demand VRF.
- Session tokens expire after 1 hour (`SESSION_TTL = 3600`). Users who open the
  app after expiry get one popup to renew.
- `revoke_session()` lets the main wallet immediately invalidate a session
  (e.g., if the device is lost). The on-chain check `session.valid_until > clock.unix_timestamp`
  ensures expired tokens are rejected even if the client doesn't call revoke.
