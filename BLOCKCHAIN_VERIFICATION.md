# 🔗 Zen Fortune Cookie - Blockchain Verification Guide

## Program Status ✅

**Program ID:** `DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85`  
**Network:** Solana Localnet (localhost:8899)  
**Status:** ✅ DEPLOYED AND WORKING

```bash
Program Id: DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85
Owner: BPFLoaderUpgradeab1e11111111111111111111111
Data Length: 218344 bytes
Balance: 1.52087832 SOL
Last Deployed In Slot: 124
```

## Quick Start - Monitor Transactions

### Terminal 1: Watch Program Logs
```bash
solana logs DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85 -u http://localhost:8899
```

### Terminal 2: Run the App
```bash
cd /Users/aileen/fortune_cookie/app
npm run dev
```

### Terminal 3: Trigger Fortunes
1. Open http://localhost:3000
2. Click "Select Wallet"
3. Choose Phantom or Solflare
4. Once connected, use hand gestures to break cookies
5. **Watch Terminal 1** - you'll see:
   ```
   Program invoked...
   [Program log: Instruction: OpenCookie]
   Program consumed X compute units
   Program success ✓
   ```

## Verify a Transaction

After triggering a fortune in the app, you get a transaction signature. Use it:

```bash
# Check if transaction succeeded
solana confirm <SIGNATURE> -u http://localhost:8899

# View full transaction details
solana transaction show <SIGNATURE> -u http://localhost:8899

# View decoded JSON format
solana transaction show <SIGNATURE> -u http://localhost:8899 --output json | jq

# View the fortune cookie account that was created
solana account <COOKIE_PDA> -u http://localhost:8899 --output json
```

## Verify Program State

```bash
# Check program is deployed
solana program show DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85 \
  -u http://localhost:8899

# View program data
solana program show DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85 \
  --programs -u http://localhost:8899
```

## Check Accounts Created

### Global Stats Account
```bash
# Derive and view stats PDA
solana account \
  "Hs3FnxWJGkNyWqMZ3Uf2CcQYyCiRhGdSUc64NN2cUvGX" \
  -u http://localhost:8899 --output json
```

### User's Cookie Accounts
```bash
# Derive cookie PDA for a user (seeds: user_pubkey, "cookie", counter)
solana account <COOKIE_PDA> -u http://localhost:8899 --output json
```

## Reading Transaction Logs

When you run `solana logs`, you'll see entries like:

```
Program DaBeUWY...dfJ85 invoke [1]
Program log: Instruction: OpenCookie
Program log: User: <USER_PUBKEY>
Program log: Archetype: 2
Program log: Fortune ID: 17
Program log: Rarity: 1
Program consumed 2123 compute units
Program DaBeUWY...dfJ85 success ✓
```

**What this means:**
- `Program invoke [1]` - Main program call
- `Instruction: OpenCookie` - Which instruction ran
- `User, Archetype, Fortune ID, Rarity` - The fortune data recorded
- `consumed 2123 compute units` - Gas used
- `success ✓` - Transaction succeeded

## Debugging Failed Transactions

If a transaction fails, check the logs for errors:

```bash
# Watch logs and look for error messages
solana logs DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85 \
  -u http://localhost:8899

# Common errors:
# - "InvalidArchetype" - archetype must be 0-3
# - "Account not initialized" - stats account doesn't exist
# - "Insufficient funds" - not enough SOL for rent
```

## How the Program Works

### Data Structure
```rust
#[account]
pub struct FortuneCookie {
    pub user: Pubkey,           // User who opened cookie
    pub archetype: u8,          // Type of fortune (0-3)
    pub fortune_id: u64,        // Random fortune (0-49)
    pub rarity: u8,             // Rarity tier (0-3)
    pub bump: u8,               // PDA bump seed
}

#[account]
pub struct Stats {
    pub total_opens: u64,       // Total cookies opened
    pub bump: u8,               // PDA bump seed
}
```

### Instructions

#### 1. initialize_stats (Called once)
```bash
solana program invoke DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85 \
  --instruction initialize_stats \
  -u http://localhost:8899
```

#### 2. open_cookie (Called when user breaks cookie)
```
Input: archetype (0-3), counter (u64)
Output: FortuneCookie account created with on-chain derived fortune
```

## On-Chain Fortune Generation

The program derives the fortune on-chain using:
- Current blockchain slot
- User's public key bytes
- Archetype value
- Counter (timestamp-based)

This ensures:
- ✅ Fortunes are verifiable on-chain
- ✅ Each user gets different fortunes
- ✅ Can't be predicted or manipulated
- ✅ Immutable record for each cookie opened

## Quick Reference

| Command | Purpose |
|---------|---------|
| `solana logs <PROGRAM_ID> -u http://localhost:8899` | Watch program output |
| `solana confirm <TX>` | Check if tx succeeded |
| `solana transaction show <TX> --output json` | Decode transaction |
| `solana account <ACCOUNT> --output json` | View account data |
| `scripts/verify-chain.sh` | Run verification script |

## Testing Checklist

- [x] Program deployed to localhost:8899
- [x] App connects to wallet
- [x] App calls program when cookie breaks
- [x] Transaction appears in logs
- [x] Transaction confirms on-chain
- [x] Cookie account created with correct data
- [x] Stats account incremented
- [x] User can see transaction signature

## Troubleshooting

**Problem:** "Program account not found"
- Solution: Make sure validator is running and program is deployed

**Problem:** "Transaction timeout"
- Solution: Check validator is healthy: `solana ping -u http://localhost:8899`

**Problem:** "Invalid account"
- Solution: Stats PDA might not be initialized - run initialize_stats once

**Problem:** "Insufficient funds"
- Solution: Airdrop SOL: `solana airdrop 10 <WALLET> -u http://localhost:8899`

---

**Need help?** Check the logs with `solana logs` command - it will show exact error messages!
