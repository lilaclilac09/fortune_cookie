// LiteSVM integration tests — runs in-memory, no validator needed.
// After changing lib.rs, run: anchor build && cargo test --manifest-path programs/fortune_cookie/Cargo.toml

use anchor_lang::{prelude::*, InstructionData, ToAccountMetas};
use fortune_cookie::accounts as fc_accounts;
use fortune_cookie::instruction as fc_instruction;
use fortune_cookie::NUM_SHARDS;
use litesvm::LiteSVM;
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};

const PROGRAM_ID: Pubkey = pubkey!("DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85");

fn stats_shard_pda(shard_id: u8) -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"stats", &[shard_id]], &PROGRAM_ID)
}

fn cookie_pda(authority: &Pubkey, counter: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[authority.as_ref(), b"cookie", &counter.to_le_bytes()],
        &PROGRAM_ID,
    )
}

fn session_token_pda(authority: &Pubkey, session_signer: &Pubkey) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[authority.as_ref(), session_signer.as_ref(), b"session"],
        &PROGRAM_ID,
    )
}

fn shard_id_for(user: &Pubkey) -> u8 {
    user.as_ref()[0] % NUM_SHARDS
}

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(PROGRAM_ID, "../../target/deploy/fortune_cookie.so")
        .expect("Failed to load fortune_cookie.so — run `anchor build` first");
    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap();
    (svm, payer)
}

fn init_shard(svm: &mut LiteSVM, payer: &Keypair, shard_id: u8) {
    let (shard_pda, _) = stats_shard_pda(shard_id);
    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::InitializeStatsShard {
            payer: payer.pubkey(),
            shard: shard_pda,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::InitializeStatsShard { shard_id }.data(),
    };
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[payer],
        blockhash,
    ))
    .unwrap_or_else(|e| panic!("init shard {shard_id} failed: {e}"));
}

fn open_cookie_direct(
    svm: &mut LiteSVM,
    payer: &Keypair,
    archetype: u8,
    counter: u64,
) -> Result<(), Box<dyn std::error::Error>> {
    let shard_id = shard_id_for(&payer.pubkey());
    let (shard_pda, _) = stats_shard_pda(shard_id);
    let (cookie_pda, _) = cookie_pda(&payer.pubkey(), counter);

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::OpenCookie {
            signer: payer.pubkey(),
            authority: payer.pubkey(),
            cookie: cookie_pda,
            stats_shard: shard_pda,
            session_token: None,
            slot_hashes: anchor_lang::solana_program::sysvar::slot_hashes::ID,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::OpenCookie { archetype, counter, shard_id }.data(),
    };

    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[payer],
        blockhash,
    ))?;
    Ok(())
}

// ─── Tests ────────────────────────────────────────────────────────────────────

#[test]
fn test_initialize_stats_shard() {
    let (mut svm, payer) = setup();
    let shard_id = shard_id_for(&payer.pubkey());
    init_shard(&mut svm, &payer, shard_id);

    let (shard_pda, _) = stats_shard_pda(shard_id);
    let account = svm.get_account(&shard_pda).expect("shard account not found");
    assert!(!account.data.is_empty());
}

#[test]
fn test_open_cookie_valid_archetypes() {
    let (mut svm, payer) = setup();
    let shard_id = shard_id_for(&payer.pubkey());
    init_shard(&mut svm, &payer, shard_id);

    for archetype in 0u8..4 {
        let counter = archetype as u64 + 1000;
        open_cookie_direct(&mut svm, &payer, archetype, counter)
            .unwrap_or_else(|e| panic!("open_cookie failed for archetype {archetype}: {e}"));
    }
}

#[test]
fn test_open_cookie_invalid_archetype_rejected() {
    let (mut svm, payer) = setup();
    let shard_id = shard_id_for(&payer.pubkey());
    init_shard(&mut svm, &payer, shard_id);

    let result = open_cookie_direct(&mut svm, &payer, 4, 9999);
    assert!(result.is_err(), "archetype=4 should be rejected");
}

#[test]
fn test_stats_shard_increments() {
    let (mut svm, payer) = setup();
    let shard_id = shard_id_for(&payer.pubkey());
    init_shard(&mut svm, &payer, shard_id);

    for i in 0u64..3 {
        open_cookie_direct(&mut svm, &payer, 0, i).unwrap();
    }

    let (shard_pda, _) = stats_shard_pda(shard_id);
    let account = svm.get_account(&shard_pda).unwrap();
    // discriminator(8) + total_opens(8) + shard_id(1) + bump(1)
    let total_opens = u64::from_le_bytes(account.data[8..16].try_into().unwrap());
    assert_eq!(total_opens, 3);
}

#[test]
fn test_cannot_reuse_same_counter() {
    let (mut svm, payer) = setup();
    let shard_id = shard_id_for(&payer.pubkey());
    init_shard(&mut svm, &payer, shard_id);

    open_cookie_direct(&mut svm, &payer, 0, 42).unwrap();
    let result = open_cookie_direct(&mut svm, &payer, 0, 42);
    assert!(result.is_err(), "duplicate counter should be rejected");
}

#[test]
fn test_session_key_flow() {
    let (mut svm, authority) = setup();
    let shard_id = shard_id_for(&authority.pubkey());
    init_shard(&mut svm, &authority, shard_id);

    // Fund a session keypair
    let session_kp = Keypair::new();
    svm.airdrop(&session_kp.pubkey(), 1_000_000_000).unwrap();

    let (session_pda, _) = session_token_pda(&authority.pubkey(), &session_kp.pubkey());

    // Authority creates session token (valid for 1 hour)
    let valid_until = 9_999_999_999i64; // far future for test
    let create_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::CreateSession {
            authority: authority.pubkey(),
            session_signer: session_kp.pubkey(),
            session_token: session_pda,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::CreateSession { valid_until }.data(),
    };
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[create_ix],
        Some(&authority.pubkey()),
        &[&authority],
        blockhash,
    ))
    .expect("create_session failed");

    // Session keypair opens a cookie on behalf of authority
    let counter = 500u64;
    let (cookie_pda, _) = cookie_pda(&authority.pubkey(), counter);
    let open_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::OpenCookie {
            signer: session_kp.pubkey(),
            authority: authority.pubkey(),
            cookie: cookie_pda,
            stats_shard: stats_shard_pda(shard_id).0,
            session_token: Some(session_pda),
            slot_hashes: anchor_lang::solana_program::sysvar::slot_hashes::ID,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::OpenCookie { archetype: 1, counter, shard_id }.data(),
    };
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[open_ix],
        Some(&session_kp.pubkey()),
        &[&session_kp],
        blockhash,
    ))
    .expect("session open_cookie failed");

    // Cookie should be owned by authority, not session keypair
    let cookie_account = svm.get_account(&cookie_pda).expect("cookie not found");
    // discriminator(8) + user pubkey starts at byte 8
    let cookie_user = Pubkey::try_from(&cookie_account.data[8..40]).unwrap();
    assert_eq!(cookie_user, authority.pubkey(), "cookie.user must be authority");

    // Authority revokes session
    let revoke_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::RevokeSession {
            authority: authority.pubkey(),
            session_token: session_pda,
        }
        .to_account_metas(None),
        data: fc_instruction::RevokeSession {}.data(),
    };
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[revoke_ix],
        Some(&authority.pubkey()),
        &[&authority],
        blockhash,
    ))
    .expect("revoke_session failed");

    // Session token account should be closed
    assert!(svm.get_account(&session_pda).is_none(), "session token should be closed after revoke");
}

#[test]
fn test_wrong_shard_rejected() {
    let (mut svm, payer) = setup();
    let correct_shard = shard_id_for(&payer.pubkey());
    // Initialize a wrong shard (ensure it exists)
    let wrong_shard = correct_shard.wrapping_add(1) % NUM_SHARDS;
    init_shard(&mut svm, &payer, wrong_shard);

    let (wrong_shard_pda, _) = stats_shard_pda(wrong_shard);
    let (cookie_pda, _) = cookie_pda(&payer.pubkey(), 777);

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::OpenCookie {
            signer: payer.pubkey(),
            authority: payer.pubkey(),
            cookie: cookie_pda,
            stats_shard: wrong_shard_pda,
            session_token: None,
            slot_hashes: anchor_lang::solana_program::sysvar::slot_hashes::ID,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::OpenCookie { archetype: 0, counter: 777, shard_id: wrong_shard }.data(),
    };
    let blockhash = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    ));
    assert!(result.is_err(), "wrong shard should be rejected");
}
