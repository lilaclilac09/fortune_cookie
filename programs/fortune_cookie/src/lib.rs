use anchor_lang::prelude::*;

declare_id!("DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85");

const MAX_SESSION_DURATION: i64 = 60 * 60 * 24 * 30; // 30 days

#[program]
pub mod fortune_cookie {
    use super::*;

    pub fn initialize_stats(ctx: Context<InitializeStats>) -> Result<()> {
        let stats = &mut ctx.accounts.stats;
        stats.total_opens = 0;
        stats.bump = ctx.bumps.stats;
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
}
