// LiteSVM integration tests for the fortune_cookie Anchor program
// Tests run in-memory with no validator needed

use anchor_lang::{prelude::*, InstructionData, ToAccountMetas};
use fortune_cookie::accounts as fc_accounts;
use fortune_cookie::instruction as fc_instruction;
use litesvm::LiteSVM;
use solana_sdk::{
    instruction::Instruction,
    pubkey::Pubkey,
    signature::{Keypair, Signer},
    system_program,
    transaction::Transaction,
};

const PROGRAM_ID: Pubkey = pubkey!("DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85");

fn stats_pda() -> (Pubkey, u8) {
    Pubkey::find_program_address(&[b"stats"], &PROGRAM_ID)
}

fn cookie_pda(user: &Pubkey, counter: u64) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[user.as_ref(), b"cookie", &counter.to_le_bytes()],
        &PROGRAM_ID,
    )
}

fn setup() -> (LiteSVM, Keypair) {
    let mut svm = LiteSVM::new();
    svm.add_program_from_file(PROGRAM_ID, "../../target/deploy/fortune_cookie.so")
        .expect("Failed to load fortune_cookie.so — run `anchor build` first");

    let payer = Keypair::new();
    svm.airdrop(&payer.pubkey(), 10_000_000_000).unwrap(); // 10 SOL
    (svm, payer)
}

#[test]
fn test_initialize_stats() {
    let (mut svm, payer) = setup();
    let (stats_pda, _bump) = stats_pda();

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::InitializeStats {
            payer: payer.pubkey(),
            stats: stats_pda,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::InitializeStats {}.data(),
    };

    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    );

    svm.send_transaction(tx).expect("initialize_stats failed");

    // Read back and verify
    let account = svm.get_account(&stats_pda).expect("stats account not found");
    assert!(!account.data.is_empty(), "stats account has no data");
}

#[test]
fn test_open_cookie_valid_archetypes() {
    let (mut svm, payer) = setup();
    let (stats_pda, _) = stats_pda();

    // Initialize stats first
    let init_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::InitializeStats {
            payer: payer.pubkey(),
            stats: stats_pda,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::InitializeStats {}.data(),
    };
    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[init_ix],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    );
    svm.send_transaction(tx).unwrap();

    // Test all valid archetypes (0-3)
    for archetype in 0u8..4 {
        let counter = archetype as u64 + 1000;
        let (cookie_pda, _) = cookie_pda(&payer.pubkey(), counter);

        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: fc_accounts::OpenCookie {
                user: payer.pubkey(),
                cookie: cookie_pda,
                stats: stats_pda,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
            data: fc_instruction::OpenCookie {
                archetype,
                counter,
            }
            .data(),
        };

        let blockhash = svm.latest_blockhash();
        let tx = Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer],
            blockhash,
        );
        svm.send_transaction(tx)
            .unwrap_or_else(|e| panic!("open_cookie failed for archetype {archetype}: {e}"));
    }
}

#[test]
fn test_open_cookie_invalid_archetype_rejected() {
    let (mut svm, payer) = setup();
    let (stats_pda, _) = stats_pda();

    // Initialize stats
    let init_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::InitializeStats {
            payer: payer.pubkey(),
            stats: stats_pda,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::InitializeStats {}.data(),
    };
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[init_ix],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    ))
    .unwrap();

    // Archetype 4 should be rejected (valid range is 0-3)
    let counter = 9999u64;
    let (cookie_pda, _) = cookie_pda(&payer.pubkey(), counter);

    let ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::OpenCookie {
            user: payer.pubkey(),
            cookie: cookie_pda,
            stats: stats_pda,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::OpenCookie {
            archetype: 4,
            counter,
        }
        .data(),
    };

    let blockhash = svm.latest_blockhash();
    let tx = Transaction::new_signed_with_payer(
        &[ix],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    );
    let result = svm.send_transaction(tx);
    assert!(result.is_err(), "archetype=4 should have been rejected");
}

#[test]
fn test_stats_increments_on_each_open() {
    let (mut svm, payer) = setup();
    let (stats_pda, _) = stats_pda();

    // Initialize
    let init_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::InitializeStats {
            payer: payer.pubkey(),
            stats: stats_pda,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::InitializeStats {}.data(),
    };
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[init_ix],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    ))
    .unwrap();

    // Open 3 cookies
    for i in 0u64..3 {
        let (cookie_pda, _) = cookie_pda(&payer.pubkey(), i);
        let ix = Instruction {
            program_id: PROGRAM_ID,
            accounts: fc_accounts::OpenCookie {
                user: payer.pubkey(),
                cookie: cookie_pda,
                stats: stats_pda,
                system_program: system_program::id(),
            }
            .to_account_metas(None),
            data: fc_instruction::OpenCookie {
                archetype: 0,
                counter: i,
            }
            .data(),
        };
        let blockhash = svm.latest_blockhash();
        svm.send_transaction(Transaction::new_signed_with_payer(
            &[ix],
            Some(&payer.pubkey()),
            &[&payer],
            blockhash,
        ))
        .unwrap();
    }

    // Read stats account — discriminator (8) + total_opens (8) + bump (1)
    let account = svm.get_account(&stats_pda).unwrap();
    let total_opens = u64::from_le_bytes(account.data[8..16].try_into().unwrap());
    assert_eq!(total_opens, 3, "stats.total_opens should be 3 after 3 opens");
}

#[test]
fn test_cannot_reuse_same_counter() {
    let (mut svm, payer) = setup();
    let (stats_pda, _) = stats_pda();

    // Initialize
    let init_ix = Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::InitializeStats {
            payer: payer.pubkey(),
            stats: stats_pda,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::InitializeStats {}.data(),
    };
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[init_ix],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    ))
    .unwrap();

    let counter = 42u64;
    let (cookie_pda, _) = cookie_pda(&payer.pubkey(), counter);

    let make_ix = || Instruction {
        program_id: PROGRAM_ID,
        accounts: fc_accounts::OpenCookie {
            user: payer.pubkey(),
            cookie: cookie_pda,
            stats: stats_pda,
            system_program: system_program::id(),
        }
        .to_account_metas(None),
        data: fc_instruction::OpenCookie {
            archetype: 1,
            counter,
        }
        .data(),
    };

    // First open succeeds
    let blockhash = svm.latest_blockhash();
    svm.send_transaction(Transaction::new_signed_with_payer(
        &[make_ix()],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    ))
    .unwrap();

    // Second open with same counter fails (PDA already initialized)
    let blockhash = svm.latest_blockhash();
    let result = svm.send_transaction(Transaction::new_signed_with_payer(
        &[make_ix()],
        Some(&payer.pubkey()),
        &[&payer],
        blockhash,
    ));
    assert!(result.is_err(), "duplicate counter should be rejected");
}
