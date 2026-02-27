# Fortune Cookie Implementation Notes

## What We Changed
- Replaced the on-chain program with a cookie/rarity flow and global stats counter.
- Added a fortunes JSON bank at app/src/fortunes.json with 4 archetypes and rarity buckets.

## Program Changes (Anchor)
- Instructions:
  - initialize_stats: creates the global stats PDA (seed: "stats").
  - open_cookie: creates a per-user-per-counter cookie PDA and stores archetype, fortune_id, and rarity.
- Accounts:
  - Stats: tracks total_opens and bump.
  - FortuneCookie: stores user, archetype (u8), fortune_id (u64), rarity (u8), bump.
- Randomness:
  - Pseudo-random hash from slot + user + archetype + counter via keccak.
  - fortune_id uses first 8 bytes modulo 50.
  - rarity uses next 8 bytes modulo 100 with weights 70/20/9/1.

## Front-End Data
- Fortunes live in app/src/fortunes.json.
- Archetype mapping: 0=degen, 1=builder, 2=vc, 3=founder.
- Rarity mapping: 0=common, 1=rare, 2=epic, 3=legendary.

## Hand Gesture Integration
- Added MediaPipe Hands for webcam-based gesture detection
- Users can enable "Gesture Mode" to crack cookies by pulling hands apart
- Component: app/src/components/GestureDetector.tsx
- Gesture: Hold both hands close together, then pull apart to trigger crack
- Fallback: Button-based cracking remains available
- Privacy: All hand tracking runs in-browser, no data sent to servers

## Obstacles / Gaps
- Front-end repo not available for direct integration or validation.
- The previous on-chain program minted SPL tokens; it was replaced by the cookie/rarity flow, so any client code for minting is no longer valid.
- The stats PDA must be initialized once before open_cookie; client needs a guard or admin init path.
- declare_id remains set to the existing program ID; update if you redeploy.
- Fortune count is hardcoded to modulo 50; adjust if any rarity bucket has a different size.
- No tests or local build were run in this session.

## Files Touched
- programs/fortune_cookie/src/lib.rs
- app/src/fortunes.json
- app/src/app/page.tsx
- app/src/app/globals.css
- app/src/components/GestureDetector.tsx (new)
- app/package.json

## Deployment Status

### Build
Built successfully at target/deploy/fortune_cookie.so (213 KB).

### Deployment to Devnet
Connection to https://api.devnet.solana.com failed with TLS handshake EOF.

**Options:**
1. Try again later when network is stable
2. Deploy locally with `solana-test-validator` + `anchor deploy`
3. Use a different RPC (e.g., Helius, QuickNode) via `solana config set --url <RPC>`

**Once network is accessible, deploy with:**
```bash
cd /Users/aileen/fortune_cookie
solana airdrop 2  # if balance is low
anchor deploy --provider.cluster devnet
```

**Program ID:** `GpPcUYfhJzGwpN1xwNMHRiEGmj2BnvAtPkZSn2Nyi8n8`  
After deploy, update it in `programs/fortune_cookie/src/lib.rs` with the new deploy key if it changes.
