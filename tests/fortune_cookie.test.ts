/**
 * fortune_cookie bankrun tests
 * Uses solana-bankrun + anchor-bankrun for fast in-memory VM.
 * Anchor 0.30 requires discriminators in the IDL; we compute and inject them
 * here so the app's IDL file (Anchor 0.29 format) stays unchanged.
 *
 * Program binary: ../target/deploy/fortune_cookie.so
 */

import * as crypto from "crypto";
import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { PublicKey, Keypair, SystemProgram } from "@solana/web3.js";
import { startAnchor } from "solana-bankrun";
import { BankrunProvider } from "anchor-bankrun";
import * as path from "path";
import * as assert from "assert";

const PROGRAM_ID = new PublicKey("DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85");

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { IDL } = require("../app/src/hooks/fortune_cookie_idl");

// ── Discriminator helpers ────────────────────────────────────────────────────

function disc(namespace: string, name: string): number[] {
  return Array.from(
    crypto.createHash("sha256").update(`${namespace}:${name}`).digest().slice(0, 8)
  );
}

/**
 * Anchor 0.29 → 0.30 IDL type conversion.
 * "publicKey" → "pubkey" (the only rename we need for this program).
 */
function convertType(t: any): any {
  if (t === "publicKey") return "pubkey";
  if (typeof t === "object" && t !== null) {
    const result: any = {};
    for (const [k, v] of Object.entries(t)) {
      result[k] = convertType(v);
    }
    return result;
  }
  return t;
}

function convertFields(fields: any[]): any[] {
  return fields.map((f: any) => ({ ...f, type: convertType(f.type) }));
}

/**
 * Upgrade an Anchor 0.29 IDL to 0.30 format.
 *
 * Key changes in 0.30:
 *  - Each instruction gets a `discriminator` field
 *  - Account struct definitions move from `accounts[*].type` → `types[]`
 *  - `accounts[]` retains only `name` + `discriminator`
 *  - Field type "publicKey" → "pubkey"
 *  - Top-level `address` replaces the old `metadata.address`
 *
 * The original IDL object is NOT mutated.
 */
function convertAccount(acc: any): any {
  // Anchor 0.30+ renamed instruction-account flags: isMut → writable, isSigner → signer.
  const out: any = { name: acc.name };
  if (acc.isMut || acc.writable) out.writable = true;
  if (acc.isSigner || acc.signer) out.signer = true;
  if (acc.address) out.address = acc.address;
  if (acc.pda) out.pda = acc.pda;
  if (acc.optional) out.optional = true;
  return out;
}

function addDiscriminators(idl: any): any {
  // Promote account type definitions to top-level `types`, converting field types
  const accountTypes = (idl.accounts ?? []).map((acc: any) => ({
    name: acc.name,
    type: {
      ...acc.type,
      fields: convertFields(acc.type?.fields ?? []),
    },
  }));

  // Anchor 0.30+ also expects each event to have a corresponding entry in `types`
  // (struct kind) so the BorshEventCoder can deserialize it.
  const eventTypes = (idl.events ?? []).map((ev: any) => ({
    name: ev.name,
    type: {
      kind: "struct",
      fields: convertFields(
        (ev.fields ?? []).map((f: any) => ({ name: f.name, type: f.type })),
      ),
    },
  }));

  return {
    ...idl,
    address: PROGRAM_ID.toBase58(),
    instructions: idl.instructions.map((ix: any) => ({
      ...ix,
      discriminator: disc("global", ix.name),
      accounts: (ix.accounts ?? []).map(convertAccount),
      args: convertFields(ix.args ?? []),
    })),
    accounts: (idl.accounts ?? []).map((acc: any) => ({
      name: acc.name,
      discriminator: disc("account", acc.name),
    })),
    types: [...(idl.types ?? []), ...accountTypes, ...eventTypes],
    events: idl.events?.map((ev: any) => ({
      name: ev.name,
      discriminator: disc("event", ev.name),
    })),
  };
}

const IDL30 = addDiscriminators(IDL);

// ── PDA helpers ──────────────────────────────────────────────────────────────

function statsPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("stats")], PROGRAM_ID);
}

function cookiePda(user: PublicKey, counter: BN): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [user.toBuffer(), Buffer.from("cookie"), counter.toArrayLike(Buffer, "le", 8)],
    PROGRAM_ID
  );
}

function sessionPda(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [user.toBuffer(), Buffer.from("session")],
    PROGRAM_ID
  );
}

function balancePda(user: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [user.toBuffer(), Buffer.from("balance")],
    PROGRAM_ID
  );
}

function treasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("treasury")],
    PROGRAM_ID
  );
}

// ── Test suite ───────────────────────────────────────────────────────────────

describe("fortune_cookie (bankrun)", () => {
  let program: any;
  let payer: Keypair;
  let getBalance: (pk: PublicKey) => Promise<number>;

  before(async () => {
    const context = await startAnchor(
      path.resolve(__dirname, ".."),
      [{ name: "fortune_cookie", programId: PROGRAM_ID }],
      []
    );
    payer = context.payer;
    const provider = new BankrunProvider(context);
    anchor.setProvider(provider as any);
    program = new Program(IDL30, provider as any);
    getBalance = async (pk: PublicKey) => {
      const lamports = await context.banksClient.getBalance(pk);
      return Number(lamports);
    };
  });

  // ── initialize_stats ────────────────────────────────────────────────────

  it("initialize_stats creates stats account with total_opens=0", async () => {
    const [statsAccount] = statsPda();

    await program.methods
      .initializeStats()
      .accounts({
        payer: payer.publicKey,
        stats: statsAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const stats = await program.account.stats.fetch(statsAccount);
    assert.equal(stats.totalOpens.toNumber(), 0);
  });

  // ── open_cookie valid archetypes ─────────────────────────────────────────

  it("open_cookie archetype=0 succeeds and stores correct data", async () => {
    const [statsAccount] = statsPda();
    const counter = new BN(1001);
    const [cookieAccount] = cookiePda(payer.publicKey, counter);

    await program.methods
      .openCookie(0, counter)
      .accounts({
        user: payer.publicKey,
        cookie: cookieAccount,
        stats: statsAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const cookie = await program.account.fortuneCookie.fetch(cookieAccount);
    assert.equal(cookie.archetype, 0);
    assert.ok(cookie.fortuneId.toNumber() < 50, "fortune_id must be < 50");
    assert.ok(cookie.rarity <= 3, "rarity must be 0-3");
    assert.ok(cookie.user.equals(payer.publicKey));
  });

  it("open_cookie archetypes 1-3 all succeed", async () => {
    const [statsAccount] = statsPda();

    for (let archetype = 1; archetype <= 3; archetype++) {
      const counter = new BN(2000 + archetype);
      const [cookieAccount] = cookiePda(payer.publicKey, counter);

      await program.methods
        .openCookie(archetype, counter)
        .accounts({
          user: payer.publicKey,
          cookie: cookieAccount,
          stats: statsAccount,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      const cookie = await program.account.fortuneCookie.fetch(cookieAccount);
      assert.equal(cookie.archetype, archetype);
    }
  });

  // ── open_cookie invalid archetype ────────────────────────────────────────

  it("open_cookie archetype=4 is rejected with InvalidArchetype", async () => {
    const [statsAccount] = statsPda();
    const counter = new BN(9999);
    const [cookieAccount] = cookiePda(payer.publicKey, counter);

    try {
      await program.methods
        .openCookie(4, counter)
        .accounts({
          user: payer.publicKey,
          cookie: cookieAccount,
          stats: statsAccount,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Expected error for archetype=4");
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      // Anchor error 6000 = InvalidArchetype; bankrun may surface it as
      // "0x1770" (hex), "6000" (decimal), or the named variant
      assert.ok(
        msg.includes("InvalidArchetype") || msg.includes("6000") || msg.includes("1770"),
        `Expected InvalidArchetype (6000 / 0x1770), got: ${msg}`
      );
    }
  });

  // ── stats counter ────────────────────────────────────────────────────────

  it("stats.total_opens increments after each open", async () => {
    const [statsAccount] = statsPda();
    const statsBefore = await program.account.stats.fetch(statsAccount);
    const before = statsBefore.totalOpens.toNumber();

    const counter = new BN(5000);
    const [cookieAccount] = cookiePda(payer.publicKey, counter);
    await program.methods
      .openCookie(0, counter)
      .accounts({
        user: payer.publicKey,
        cookie: cookieAccount,
        stats: statsAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const statsAfter = await program.account.stats.fetch(statsAccount);
    assert.equal(statsAfter.totalOpens.toNumber(), before + 1);
  });

  // ── duplicate counter ─────────────────────────────────────────────────────

  it("duplicate counter (same PDA) is rejected", async () => {
    const [statsAccount] = statsPda();
    const counter = new BN(7777);
    const [cookieAccount] = cookiePda(payer.publicKey, counter);

    await program.methods
      .openCookie(2, counter)
      .accounts({
        user: payer.publicKey,
        cookie: cookieAccount,
        stats: statsAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    try {
      await program.methods
        .openCookie(2, counter)
        .accounts({
          user: payer.publicKey,
          cookie: cookieAccount,
          stats: statsAccount,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      assert.fail("Should have failed — PDA already initialized");
    } catch (err: any) {
      assert.ok(err, "Expected error for duplicate counter");
    }
  });

  // ── authorize_session ────────────────────────────────────────────────────

  it("authorize_session stores user + session_key + expires_at", async () => {
    const sessionKey = Keypair.generate();
    const [sessionAccount] = sessionPda(payer.publicKey);
    const durationSeconds = new BN(3600);

    await program.methods
      .authorizeSession(sessionKey.publicKey, durationSeconds)
      .accounts({
        user: payer.publicKey,
        session: sessionAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    const session = await program.account.session.fetch(sessionAccount);
    assert.ok(session.user.equals(payer.publicKey));
    assert.ok(session.sessionKey.equals(sessionKey.publicKey));
    assert.ok(session.expiresAt.toNumber() > 0);
  });

  it("authorize_session rejects duration <= 0 and > 30 days", async () => {
    const sessionKey = Keypair.generate();
    const [sessionAccount] = sessionPda(payer.publicKey);

    for (const bad of [new BN(0), new BN(-1), new BN(60 * 60 * 24 * 31)]) {
      try {
        await program.methods
          .authorizeSession(sessionKey.publicKey, bad)
          .accounts({
            user: payer.publicKey,
            session: sessionAccount,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        assert.fail(`Expected InvalidDuration for ${bad.toString()}`);
      } catch (err: any) {
        const msg = err?.message ?? String(err);
        assert.ok(
          msg.includes("InvalidDuration") || msg.includes("6003") || msg.includes("1773"),
          `Expected InvalidDuration, got: ${msg}`
        );
      }
    }
  });

  // ── open_cookie_via_session ──────────────────────────────────────────────

  it("open_cookie_via_session opens when session key is valid", async () => {
    // Fresh user to avoid collision with prior session
    const user = Keypair.generate();

    // Airdrop-equivalent: transfer from payer
    const { Transaction } = require("@solana/web3.js");
    const tx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: user.publicKey,
        lamports: 100_000_000, // 0.1 SOL
      })
    );
    await (program.provider as any).sendAndConfirm(tx, [payer]);

    const sessionKey = Keypair.generate();
    // Fund session key
    const fundTx = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: payer.publicKey,
        toPubkey: sessionKey.publicKey,
        lamports: 50_000_000,
      })
    );
    await (program.provider as any).sendAndConfirm(fundTx, [payer]);

    const [sessionAccount] = sessionPda(user.publicKey);
    await program.methods
      .authorizeSession(sessionKey.publicKey, new BN(3600))
      .accounts({
        user: user.publicKey,
        session: sessionAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const [statsAccount] = statsPda();
    const counter = new BN(42001);
    const [cookieAccount] = cookiePda(user.publicKey, counter);

    await program.methods
      .openCookieViaSession(1, counter)
      .accounts({
        sessionKey: sessionKey.publicKey,
        user: user.publicKey,
        session: sessionAccount,
        cookie: cookieAccount,
        stats: statsAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([sessionKey])
      .rpc();

    const cookie = await program.account.fortuneCookie.fetch(cookieAccount);
    assert.ok(cookie.user.equals(user.publicKey), "cookie.user should be the session owner");
    assert.equal(cookie.archetype, 1);
  });

  it("open_cookie_via_session rejects a wrong session key", async () => {
    const user = Keypair.generate();
    const { Transaction } = require("@solana/web3.js");
    await (program.provider as any).sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: user.publicKey,
          lamports: 100_000_000,
        })
      ),
      [payer]
    );

    const authorizedKey = Keypair.generate();
    const imposterKey = Keypair.generate();
    await (program.provider as any).sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: imposterKey.publicKey,
          lamports: 50_000_000,
        })
      ),
      [payer]
    );

    const [sessionAccount] = sessionPda(user.publicKey);
    await program.methods
      .authorizeSession(authorizedKey.publicKey, new BN(3600))
      .accounts({
        user: user.publicKey,
        session: sessionAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const [statsAccount] = statsPda();
    const counter = new BN(42002);
    const [cookieAccount] = cookiePda(user.publicKey, counter);

    try {
      await program.methods
        .openCookieViaSession(0, counter)
        .accounts({
          sessionKey: imposterKey.publicKey,
          user: user.publicKey,
          session: sessionAccount,
          cookie: cookieAccount,
          stats: statsAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([imposterKey])
        .rpc();
      assert.fail("Expected UnauthorizedSessionKey");
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      assert.ok(
        msg.includes("UnauthorizedSessionKey") || msg.includes("6002") || msg.includes("1772"),
        `Expected UnauthorizedSessionKey, got: ${msg}`
      );
    }
  });

  it("one authorize_session → N silent open_cookie_via_session calls (unlimited loop)", async () => {
    const user = Keypair.generate();
    const sessionKey = Keypair.generate();
    const { Transaction } = require("@solana/web3.js");

    // Fund user + session key from bankrun payer
    await (program.provider as any).sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: user.publicKey,
          lamports: 200_000_000,
        }),
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: sessionKey.publicKey,
          lamports: 500_000_000, // 0.5 SOL — plenty for many opens
        })
      ),
      [payer]
    );

    const [sessionAccount] = sessionPda(user.publicKey);
    const [statsAccount] = statsPda();

    // Single authorize_session — ONE "user signature". Counts as the one-time cost.
    const authStart = Date.now();
    await program.methods
      .authorizeSession(sessionKey.publicKey, new BN(3600))
      .accounts({
        user: user.publicKey,
        session: sessionAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();
    const authMs = Date.now() - authStart;

    // Now loop: open N cookies using ONLY the session key — no user signature.
    const N = 25;
    const statsBefore = await program.account.stats.fetch(statsAccount);
    const openedBefore = statsBefore.totalOpens.toNumber();

    const signatures: string[] = [];
    const loopStart = Date.now();
    for (let i = 0; i < N; i++) {
      const counter = new BN(900000 + i);
      const [cookieAccount] = cookiePda(user.publicKey, counter);
      const archetype = i % 4;

      const sig = await program.methods
        .openCookieViaSession(archetype, counter)
        .accounts({
          sessionKey: sessionKey.publicKey,
          user: user.publicKey,
          session: sessionAccount,
          cookie: cookieAccount,
          stats: statsAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([sessionKey])  // <-- user is NOT in signers
        .rpc();
      signatures.push(sig);

      // Assert cookie written correctly
      const cookie = await program.account.fortuneCookie.fetch(cookieAccount);
      assert.ok(cookie.user.equals(user.publicKey));
      assert.equal(cookie.archetype, archetype);
    }
    const loopMs = Date.now() - loopStart;

    // Stats should have incremented N times
    const statsAfter = await program.account.stats.fetch(statsAccount);
    assert.equal(
      statsAfter.totalOpens.toNumber(),
      openedBefore + N,
      "stats must increment once per open"
    );

    // All N signatures distinct → each was a real on-chain tx
    assert.equal(new Set(signatures).size, N, "each open should have a unique signature");

    // Session still valid → user could keep going indefinitely until expiry
    const session = await program.account.session.fetch(sessionAccount);
    assert.ok(session.sessionKey.equals(sessionKey.publicKey));

    console.log(
      `  ✓ 1 authorize_session (${authMs}ms) → ${N} silent opens in ${loopMs}ms ` +
      `(avg ${(loopMs / N).toFixed(1)}ms/open) · session still live`
    );
  });

  // ── prepaid balance + treasury fee ──────────────────────────────────────

  it("deposit → open_cookie_prepaid loop drains balance PDA, fills treasury", async () => {
    const user = Keypair.generate();
    const sessionKey = Keypair.generate();
    const { Transaction } = require("@solana/web3.js");

    // Fund user + session key
    await (program.provider as any).sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: user.publicKey,
          lamports: 500_000_000,
        }),
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: sessionKey.publicKey,
          lamports: 100_000_000,
        })
      ),
      [payer]
    );

    const [sessionAccount] = sessionPda(user.publicKey);
    const [balanceAccount] = balancePda(user.publicKey);
    const [treasuryAccount] = treasuryPda();
    const [statsAccount] = statsPda();

    // 1. Authorize session
    await program.methods
      .authorizeSession(sessionKey.publicKey, new BN(3600))
      .accounts({
        user: user.publicKey,
        session: sessionAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // 1b. Initialize treasury (idempotent, funds rent-exempt minimum)
    await program.methods
      .initializeTreasury()
      .accounts({
        payer: payer.publicKey,
        treasury: treasuryAccount,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    // 2. Deposit 0.05 SOL into balance PDA
    const depositLamports = 50_000_000;
    await program.methods
      .deposit(new BN(depositLamports))
      .accounts({
        user: user.publicKey,
        balance: balanceAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const balanceAfterDeposit = await getBalance(balanceAccount);
    console.log(`  [debug] balance PDA after deposit: ${balanceAfterDeposit} lamports (expected ${depositLamports})`);
    assert.equal(balanceAfterDeposit, depositLamports, "balance PDA should hold deposited amount");

    // 3. Open 3 cookies via prepaid — session key signs, user does NOT
    const treasuryBefore = await getBalance(treasuryAccount);
    console.log(`  [debug] treasury before: ${treasuryBefore} lamports`);
    const N = 3;
    for (let i = 0; i < N; i++) {
      const counter = new BN(77000 + i);
      const [cookieAccount] = cookiePda(user.publicKey, counter);

      await program.methods
        .openCookiePrepaid(i % 4, counter)
        .accounts({
          sessionKey: sessionKey.publicKey,
          user: user.publicKey,
          session: sessionAccount,
          balance: balanceAccount,
          treasury: treasuryAccount,
          cookie: cookieAccount,
          stats: statsAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([sessionKey])
        .rpc();

      // Cookie was created with correct data
      const cookie = await program.account.fortuneCookie.fetch(cookieAccount);
      assert.ok(cookie.user.equals(user.publicKey));
      assert.equal(cookie.archetype, i % 4);
    }

    // Treasury gained exactly N * 500_000 lamports
    const treasuryAfter = await getBalance(treasuryAccount);
    assert.equal(
      treasuryAfter - treasuryBefore,
      N * 500_000,
      "treasury should collect 0.0005 SOL per open"
    );

    // Balance PDA drained by N * (rent + fee); should still have some left
    const balanceAfter = await getBalance(balanceAccount);
    assert.ok(
      balanceAfter < balanceAfterDeposit,
      "balance PDA should be debited for rent + fee per open"
    );
    const totalCost = balanceAfterDeposit - balanceAfter;
    console.log(
      `  ✓ ${N} prepaid opens cost ${totalCost} lamports (${(totalCost / 1_000_000_000).toFixed(6)} SOL) from balance PDA; treasury +${(N * 500_000) / 1_000_000_000} SOL`
    );
  });

  it("open_cookie_prepaid fails with InsufficientBalance when balance is empty", async () => {
    const user = Keypair.generate();
    const sessionKey = Keypair.generate();
    const { Transaction } = require("@solana/web3.js");

    await (program.provider as any).sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: user.publicKey,
          lamports: 100_000_000,
        }),
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: sessionKey.publicKey,
          lamports: 50_000_000,
        })
      ),
      [payer]
    );

    const [sessionAccount] = sessionPda(user.publicKey);
    const [balanceAccount] = balancePda(user.publicKey);
    const [treasuryAccount] = treasuryPda();
    const [statsAccount] = statsPda();

    await program.methods
      .authorizeSession(sessionKey.publicKey, new BN(3600))
      .accounts({
        user: user.publicKey,
        session: sessionAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Deposit nothing — balance PDA doesn't exist / is empty
    const counter = new BN(88001);
    const [cookieAccount] = cookiePda(user.publicKey, counter);

    try {
      await program.methods
        .openCookiePrepaid(0, counter)
        .accounts({
          sessionKey: sessionKey.publicKey,
          user: user.publicKey,
          session: sessionAccount,
          balance: balanceAccount,
          treasury: treasuryAccount,
          cookie: cookieAccount,
          stats: statsAccount,
          systemProgram: SystemProgram.programId,
        })
        .signers([sessionKey])
        .rpc();
      assert.fail("Expected InsufficientBalance");
    } catch (err: any) {
      const msg = err?.message ?? String(err);
      assert.ok(
        msg.includes("InsufficientBalance") || msg.includes("6005") || msg.includes("1775"),
        `Expected InsufficientBalance, got: ${msg}`
      );
    }
  });

  it("withdraw moves SOL back to user", async () => {
    const user = Keypair.generate();
    const { Transaction } = require("@solana/web3.js");
    await (program.provider as any).sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: user.publicKey,
          lamports: 200_000_000,
        })
      ),
      [payer]
    );

    const [balanceAccount] = balancePda(user.publicKey);
    const depositAmount = 80_000_000;
    await program.methods
      .deposit(new BN(depositAmount))
      .accounts({
        user: user.publicKey,
        balance: balanceAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const userBefore = await getBalance(user.publicKey);
    const withdrawAmount = 30_000_000;
    await program.methods
      .withdraw(new BN(withdrawAmount))
      .accounts({
        user: user.publicKey,
        balance: balanceAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    const userAfter = await getBalance(user.publicKey);
    const balanceAfter = await getBalance(balanceAccount);

    // User got back withdrawAmount minus the tx fee paid
    assert.ok(
      userAfter - userBefore >= withdrawAmount - 10_000,
      `user balance should increase by ~${withdrawAmount}, got ${userAfter - userBefore}`
    );
    assert.equal(balanceAfter, depositAmount - withdrawAmount);
  });

  it("revoke_session closes the PDA and refunds rent to user", async () => {
    const user = Keypair.generate();
    const { Transaction } = require("@solana/web3.js");
    await (program.provider as any).sendAndConfirm(
      new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: payer.publicKey,
          toPubkey: user.publicKey,
          lamports: 100_000_000,
        })
      ),
      [payer]
    );

    const sessionKey = Keypair.generate();
    const [sessionAccount] = sessionPda(user.publicKey);
    await program.methods
      .authorizeSession(sessionKey.publicKey, new BN(3600))
      .accounts({
        user: user.publicKey,
        session: sessionAccount,
        systemProgram: SystemProgram.programId,
      })
      .signers([user])
      .rpc();

    // Session exists
    await program.account.session.fetch(sessionAccount);

    await program.methods
      .revokeSession()
      .accounts({
        user: user.publicKey,
        session: sessionAccount,
      })
      .signers([user])
      .rpc();

    try {
      await program.account.session.fetch(sessionAccount);
      assert.fail("Session should be closed");
    } catch (err: any) {
      // Expected: account not found or zero-length
      assert.ok(err, "Expected session to be closed");
    }
  });
});
