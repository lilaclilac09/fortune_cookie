use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    program::{invoke, invoke_signed},
    system_instruction,
};

declare_id!("DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85");

const MAX_SESSION_DURATION: i64 = 60 * 60 * 24 * 30; // 30 days
const FEE_LAMPORTS: u64 = 500_000; // 0.0005 SOL per open → treasury
const COOKIE_SPACE: usize = 8 + 32 + 1 + 8 + 1 + 1;

#[program]
pub mod fortune_cookie {
    use super::*;

    pub fn initialize_stats(ctx: Context<InitializeStats>) -> Result<()> {
        let stats = &mut ctx.accounts.stats;
        stats.total_opens = 0;
        stats.bump = ctx.bumps.stats;
        Ok(())
    }

    /// One-time global initialization: funds the treasury PDA with the
    /// rent-exempt minimum so subsequent fee transfers (smaller than rent)
    /// don't violate the post-tx rent check. Idempotent: if treasury is
    /// already rent-exempt this is a no-op.
    pub fn initialize_treasury(ctx: Context<InitializeTreasury>) -> Result<()> {
        let rent_min = Rent::get()?.minimum_balance(0);
        let current = ctx.accounts.treasury.lamports();
        if current >= rent_min {
            return Ok(());
        }
        let needed = rent_min - current;
        let ix = system_instruction::transfer(
            &ctx.accounts.payer.key(),
            &ctx.accounts.treasury.key(),
            needed,
        );
        invoke(
            &ix,
            &[
                ctx.accounts.payer.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        Ok(())
    }

    pub fn open_cookie(ctx: Context<OpenCookie>, archetype: u8, counter: u64) -> Result<()> {
        require!(archetype < 4, ErrorCode::InvalidArchetype);

        let clock = Clock::get()?;
        let user_key = ctx.accounts.user.key();
        let (fortune_id, rarity) = derive_fortune(&clock, &user_key, archetype, counter);

        let cookie = &mut ctx.accounts.cookie;
        cookie.user = user_key;
        cookie.archetype = archetype;
        cookie.fortune_id = fortune_id;
        cookie.rarity = rarity;
        cookie.bump = ctx.bumps.cookie;

        let stats = &mut ctx.accounts.stats;
        stats.total_opens += 1;

        emit!(CookieOpened {
            user: user_key,
            archetype,
            fortune_id,
            rarity,
        });

        Ok(())
    }

    /// Authorize (or re-authorize) an ephemeral session key for the caller.
    /// Until `expires_at`, the session key may invoke `open_cookie_via_session`
    /// on behalf of the user without any additional wallet signature.
    pub fn authorize_session(
        ctx: Context<AuthorizeSession>,
        session_key: Pubkey,
        duration_seconds: i64,
    ) -> Result<()> {
        require!(
            duration_seconds > 0 && duration_seconds <= MAX_SESSION_DURATION,
            ErrorCode::InvalidDuration
        );

        let clock = Clock::get()?;
        let session = &mut ctx.accounts.session;
        session.user = ctx.accounts.user.key();
        session.session_key = session_key;
        session.expires_at = clock.unix_timestamp.saturating_add(duration_seconds);
        session.bump = ctx.bumps.session;

        emit!(SessionAuthorized {
            user: session.user,
            session_key: session.session_key,
            expires_at: session.expires_at,
        });
        Ok(())
    }

    /// Revoke the active session. The `close = user` constraint refunds
    /// the session PDA's rent back to the user and zeroes its data.
    pub fn revoke_session(_ctx: Context<RevokeSession>) -> Result<()> {
        Ok(())
    }

    /// Open a cookie using the authorized session key (no user wallet signature).
    pub fn open_cookie_via_session(
        ctx: Context<OpenCookieViaSession>,
        archetype: u8,
        counter: u64,
    ) -> Result<()> {
        require!(archetype < 4, ErrorCode::InvalidArchetype);

        let clock = Clock::get()?;
        let session = &ctx.accounts.session;
        require!(
            clock.unix_timestamp < session.expires_at,
            ErrorCode::SessionExpired
        );

        let user_key = session.user;
        let (fortune_id, rarity) = derive_fortune(&clock, &user_key, archetype, counter);

        let cookie = &mut ctx.accounts.cookie;
        cookie.user = user_key;
        cookie.archetype = archetype;
        cookie.fortune_id = fortune_id;
        cookie.rarity = rarity;
        cookie.bump = ctx.bumps.cookie;

        let stats = &mut ctx.accounts.stats;
        stats.total_opens += 1;

        emit!(CookieOpened {
            user: user_key,
            archetype,
            fortune_id,
            rarity,
        });

        Ok(())
    }

    /// Top up the user's prepaid balance PDA. System-owned account is auto-created
    /// by the transfer if it didn't exist.
    pub fn deposit(ctx: Context<Deposit>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        let ix = system_instruction::transfer(
            &ctx.accounts.user.key(),
            &ctx.accounts.balance.key(),
            amount,
        );
        invoke(
            &ix,
            &[
                ctx.accounts.user.to_account_info(),
                ctx.accounts.balance.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
        )?;
        Ok(())
    }

    /// Withdraw SOL from the user's balance PDA back to the user wallet.
    /// Program signs on behalf of the PDA via its derivation seeds.
    pub fn withdraw(ctx: Context<Withdraw>, amount: u64) -> Result<()> {
        require!(amount > 0, ErrorCode::InvalidAmount);
        require!(
            ctx.accounts.balance.lamports() >= amount,
            ErrorCode::InsufficientBalance
        );

        let user_key = ctx.accounts.user.key();
        let bump = ctx.bumps.balance;
        let seeds: &[&[u8]] = &[user_key.as_ref(), b"balance", &[bump]];

        let ix = system_instruction::transfer(
            &ctx.accounts.balance.key(),
            &ctx.accounts.user.key(),
            amount,
        );
        invoke_signed(
            &ix,
            &[
                ctx.accounts.balance.to_account_info(),
                ctx.accounts.user.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[seeds],
        )?;
        Ok(())
    }

    /// Open a cookie paid from the user's prepaid balance PDA.
    ///
    /// - Session key signs (authorization + tx base fee).
    /// - Balance PDA funds the cookie account's rent AND pays FEE_LAMPORTS to the
    ///   treasury PDA, both via program-signed CPIs.
    /// - Cookie account is created manually because its funder (balance PDA) is
    ///   not a transaction-level signer.
    pub fn open_cookie_prepaid(
        ctx: Context<OpenCookiePrepaid>,
        archetype: u8,
        counter: u64,
    ) -> Result<()> {
        require!(archetype < 4, ErrorCode::InvalidArchetype);

        let clock = Clock::get()?;
        let session = &ctx.accounts.session;
        require!(
            clock.unix_timestamp < session.expires_at,
            ErrorCode::SessionExpired
        );

        let user_key = session.user;
        let rent = Rent::get()?.minimum_balance(COOKIE_SPACE);
        let total_debit = rent
            .checked_add(FEE_LAMPORTS)
            .ok_or(ErrorCode::Overflow)?;

        require!(
            ctx.accounts.balance.lamports() >= total_debit,
            ErrorCode::InsufficientBalance
        );

        let balance_bump = ctx.bumps.balance;
        let balance_seeds: &[&[u8]] = &[user_key.as_ref(), b"balance", &[balance_bump]];

        // 1) Fee: balance PDA → treasury PDA
        let fee_ix = system_instruction::transfer(
            &ctx.accounts.balance.key(),
            &ctx.accounts.treasury.key(),
            FEE_LAMPORTS,
        );
        invoke_signed(
            &fee_ix,
            &[
                ctx.accounts.balance.to_account_info(),
                ctx.accounts.treasury.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[balance_seeds],
        )?;

        // 2) Create cookie account funded by balance PDA.
        let cookie_bump = ctx.bumps.cookie;
        let counter_bytes = counter.to_le_bytes();
        let cookie_seeds: &[&[u8]] = &[
            user_key.as_ref(),
            b"cookie",
            counter_bytes.as_ref(),
            &[cookie_bump],
        ];

        let create_ix = system_instruction::create_account(
            &ctx.accounts.balance.key(),
            &ctx.accounts.cookie.key(),
            rent,
            COOKIE_SPACE as u64,
            ctx.program_id,
        );
        invoke_signed(
            &create_ix,
            &[
                ctx.accounts.balance.to_account_info(),
                ctx.accounts.cookie.to_account_info(),
                ctx.accounts.system_program.to_account_info(),
            ],
            &[balance_seeds, cookie_seeds],
        )?;

        // 3) Populate cookie data (anchor discriminator + fields).
        let (fortune_id, rarity) = derive_fortune(&clock, &user_key, archetype, counter);
        let cookie = FortuneCookie {
            user: user_key,
            archetype,
            fortune_id,
            rarity,
            bump: cookie_bump,
        };
        let cookie_info = ctx.accounts.cookie.to_account_info();
        let mut data = cookie_info.try_borrow_mut_data()?;
        let mut writer: &mut [u8] = &mut data;
        cookie.try_serialize(&mut writer)?;

        ctx.accounts.stats.total_opens += 1;

        emit!(CookieOpened {
            user: user_key,
            archetype,
            fortune_id,
            rarity,
        });
        emit!(FeeCollected {
            user: user_key,
            amount: FEE_LAMPORTS,
        });
        Ok(())
    }
}

fn derive_fortune(
    clock: &Clock,
    user_key: &Pubkey,
    archetype: u8,
    counter: u64,
) -> (u64, u8) {
    let user_bytes = user_key.to_bytes();

    let mut seed: u64 = clock.slot;
    for (i, byte) in user_bytes.iter().enumerate() {
        seed = seed.wrapping_add((*byte as u64).wrapping_mul(i as u64 + 1));
    }
    seed = seed.wrapping_add(archetype as u64);
    seed = seed.wrapping_add(counter);

    let fortune_id = seed % 50;

    let mut rarity_seed: u64 = clock.slot.wrapping_mul(7);
    for (i, byte) in user_bytes.iter().rev().enumerate() {
        rarity_seed = rarity_seed.wrapping_add((*byte as u64).wrapping_mul(i as u64 + 3));
    }
    rarity_seed = rarity_seed.wrapping_add(archetype as u64).wrapping_mul(13);

    let rarity_score = rarity_seed % 100;
    let rarity: u8 = if rarity_score < 70 {
        0
    } else if rarity_score < 90 {
        1
    } else if rarity_score < 99 {
        2
    } else {
        3
    };

    (fortune_id, rarity)
}

#[derive(Accounts)]
pub struct InitializeTreasury<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        mut,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeStats<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + 8 + 1,
        seeds = [b"stats"],
        bump
    )]
    pub stats: Account<'info, Stats>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(archetype: u8, counter: u64)]
pub struct OpenCookie<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init,
        payer = user,
        space = 8 + 32 + 1 + 8 + 1 + 1,
        seeds = [user.key().as_ref(), b"cookie", counter.to_le_bytes().as_ref()],
        bump
    )]
    pub cookie: Account<'info, FortuneCookie>,

    #[account(
        mut,
        seeds = [b"stats"],
        bump = stats.bump
    )]
    pub stats: Account<'info, Stats>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AuthorizeSession<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        init_if_needed,
        payer = user,
        space = 8 + 32 + 32 + 8 + 1,
        seeds = [user.key().as_ref(), b"session"],
        bump
    )]
    pub session: Account<'info, Session>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeSession<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        close = user,
        seeds = [user.key().as_ref(), b"session"],
        bump = session.bump,
        has_one = user
    )]
    pub session: Account<'info, Session>,
}

#[derive(Accounts)]
pub struct Deposit<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [user.key().as_ref(), b"balance"],
        bump
    )]
    pub balance: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct Withdraw<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(
        mut,
        seeds = [user.key().as_ref(), b"balance"],
        bump
    )]
    pub balance: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(archetype: u8, counter: u64)]
pub struct OpenCookiePrepaid<'info> {
    /// Ephemeral browser-held key. Pays the tx base fee only (~5000 lamports).
    #[account(mut)]
    pub session_key: Signer<'info>,

    /// CHECK: session owner; verified by `has_one = user` on session.
    pub user: UncheckedAccount<'info>,

    #[account(
        seeds = [user.key().as_ref(), b"session"],
        bump = session.bump,
        has_one = user,
        constraint = session.session_key == session_key.key()
            @ ErrorCode::UnauthorizedSessionKey
    )]
    pub session: Account<'info, Session>,

    /// User's prepaid balance PDA. Funds cookie rent + fee.
    #[account(
        mut,
        seeds = [user.key().as_ref(), b"balance"],
        bump
    )]
    pub balance: SystemAccount<'info>,

    /// CHECK: global treasury PDA. Receives FEE_LAMPORTS per open.
    #[account(
        mut,
        seeds = [b"treasury"],
        bump
    )]
    pub treasury: SystemAccount<'info>,

    /// CHECK: cookie account is created manually via invoke_signed inside the
    /// instruction because its funder (balance PDA) is not a tx-level signer.
    #[account(
        mut,
        seeds = [user.key().as_ref(), b"cookie", counter.to_le_bytes().as_ref()],
        bump
    )]
    pub cookie: UncheckedAccount<'info>,

    #[account(
        mut,
        seeds = [b"stats"],
        bump = stats.bump
    )]
    pub stats: Account<'info, Stats>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(archetype: u8, counter: u64)]
pub struct OpenCookieViaSession<'info> {
    /// Ephemeral browser-held key. Pays fees + cookie rent.
    #[account(mut)]
    pub session_key: Signer<'info>,

    /// CHECK: The session's owner. Not a signer; its pubkey seeds the session
    /// and cookie PDAs and becomes `cookie.user`. Authenticity is enforced by
    /// `has_one = user` on the session account below.
    pub user: UncheckedAccount<'info>,

    #[account(
        seeds = [user.key().as_ref(), b"session"],
        bump = session.bump,
        has_one = user,
        constraint = session.session_key == session_key.key()
            @ ErrorCode::UnauthorizedSessionKey
    )]
    pub session: Account<'info, Session>,

    #[account(
        init,
        payer = session_key,
        space = 8 + 32 + 1 + 8 + 1 + 1,
        seeds = [user.key().as_ref(), b"cookie", counter.to_le_bytes().as_ref()],
        bump
    )]
    pub cookie: Account<'info, FortuneCookie>,

    #[account(
        mut,
        seeds = [b"stats"],
        bump = stats.bump
    )]
    pub stats: Account<'info, Stats>,

    pub system_program: Program<'info, System>,
}

#[account]
pub struct FortuneCookie {
    pub user: Pubkey,
    pub archetype: u8,
    pub fortune_id: u64,
    pub rarity: u8,
    pub bump: u8,
}

#[account]
pub struct Stats {
    pub total_opens: u64,
    pub bump: u8,
}

#[account]
pub struct Session {
    pub user: Pubkey,
    pub session_key: Pubkey,
    pub expires_at: i64,
    pub bump: u8,
}

#[event]
pub struct CookieOpened {
    pub user: Pubkey,
    pub archetype: u8,
    pub fortune_id: u64,
    pub rarity: u8,
}

#[event]
pub struct SessionAuthorized {
    pub user: Pubkey,
    pub session_key: Pubkey,
    pub expires_at: i64,
}

#[event]
pub struct FeeCollected {
    pub user: Pubkey,
    pub amount: u64,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid archetype (must be 0-3)")]
    InvalidArchetype,
    #[msg("Session has expired")]
    SessionExpired,
    #[msg("Session key does not match authorized key")]
    UnauthorizedSessionKey,
    #[msg("Duration must be > 0 and <= 30 days")]
    InvalidDuration,
    #[msg("Amount must be > 0")]
    InvalidAmount,
    #[msg("Insufficient prepaid balance")]
    InsufficientBalance,
    #[msg("Arithmetic overflow")]
    Overflow,
}
