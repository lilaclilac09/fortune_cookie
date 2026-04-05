#!/bin/bash
# Script to check program on-chain state and verify transactions

PROGRAM_ID="DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85"
RPC_URL="http://localhost:8899"

echo "=========================================="
echo "🔗 Zen Fortune Cookie - Chain Verification"
echo "=========================================="
echo ""

# 1. Check program is deployed
echo "1️⃣  CHECKING PROGRAM DEPLOYMENT..."
echo "   Program: $PROGRAM_ID"
echo "   RPC: $RPC_URL"
echo ""

PROGRAM_INFO=$(solana program show $PROGRAM_ID -u $RPC_URL 2>/dev/null)
if [ $? -eq 0 ]; then
  echo "✅ Program is DEPLOYED on-chain"
  echo "$PROGRAM_INFO" | head -10
else
  echo "❌ Program NOT found on-chain"
  exit 1
fi

echo ""
echo "2️⃣  HOW TO MONITOR TRANSACTIONS IN REAL-TIME:"
echo ""
echo "   Run this command to watch program logs:"
echo "   "
echo "   solana logs $PROGRAM_ID -u $RPC_URL"
echo ""
echo "   Then trigger a fortune in the app and you'll see:"
echo "   - Program invocation"
echo "   - CookieOpened event emissions"
echo "   - Success/error status"
echo ""

echo "3️⃣  HOW TO VERIFY A SPECIFIC TRANSACTION:"
echo ""
echo "   After getting a transaction signature from the app:"
echo ""
echo "   a) Check if transaction succeeded:"
echo "      solana confirm <SIGNATURE> -u http://localhost:8899"
echo ""
echo "   b) View full transaction details:"
echo "      solana transaction show <SIGNATURE> -u http://localhost:8899"
echo ""
echo "   c) View decoded transaction:"
echo "      solana transaction show <SIGNATURE> -u http://localhost:8899 --output json | jq"
echo ""
echo "   d) View the account that was created:"
echo "      solana account <COOKIE_PDA_ADDRESS> -u http://localhost:8899 --output json"
echo ""

echo "4️⃣  CURRENT PROGRAM STATE:"
echo ""

# Check program binary
solana program show $PROGRAM_ID -u $RPC_URL | grep -E "Program Id|Data Length|Balance"

echo ""
echo "=========================================="
echo ""
echo "🚀 QUICK START:"
echo ""
echo "   Terminal 1 - Watch logs:"
echo "   $ solana logs $PROGRAM_ID -u http://localhost:8899"
echo ""
echo "   Terminal 2 - Test the app:"
echo "   1. Open http://localhost:3000"
echo "   2. Connect wallet"
echo "   3. Trigger a fortune (hand gesture)"
echo "   4. Watch the logs in Terminal 1"
echo ""
echo "=========================================="
