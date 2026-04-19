use anchor_lang::prelude::*;
// switchboard-on-demand feature-flag: compile-time opt-in via Cargo feature "vrf"
#[cfg(feature = "vrf")]
use switchboard_on_demand::on_demand::accounts::RandomnessAccountData;

declare_id!("DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85");

pub const NUM_SHARDS: u8 = 64;

#[program]
pub mod fortune_cookie {
    use super::*;

    /// One-time init per shard (call 64 times, shard_id 0..63).
    pub fn initialize_stats_shard(ctx: Context<InitializeStatsShard>, shard_id: u8) -> Result<()> {
        require!(shard_id < NUM_SHARDS, ErrorCode::InvalidShard);
        let shard = &mut ctx.accounts.shard;
        shard.total_opens = 0;
        shard.shard_id = shard_id;
        shard.bump = ctx.bumps.shard;
        Ok(())
    }

    /// Main wallet signs once to authorize a session keypair for `valid_until` (unix ts).
    pub fn create_session(ctx: Context<CreateSession>, valid_until: i64) -> Result<()> {
        let clock = Clock::get()?;
        require!(valid_until > clock.unix_timestamp, ErrorCode::InvalidSession);
        let session = &mut ctx.accounts.session_token;
        session.authority = ctx.accounts.authority.key();
        session.session_signer = ctx.accounts.session_signer.key();
        session.valid_until = valid_until;
        session.bump = ctx.bumps.session_token;
        Ok(())
    }

    /// Authority closes the session token and reclaims rent.
    pub fn revoke_session(_ctx: Context<RevokeSession>) -> Result<()> {
        Ok(())
    }

    /// Open a fortune cookie.
    ///
    /// - Direct mode:  signer == authority, session_token = None
    /// - Session mode: signer = ephemeral keypair, authority = main wallet,
    ///                 session_token = valid SessionToken PDA
    /// VRF variant — only compiled when feature "vrf" is enabled.
    /// Identical to open_cookie but uses Switchboard On-Demand randomness
    /// instead of SlotHashes, giving verifiable unbiased results.
    #[cfg(feature = "vrf")]
    pub fn open_cookie_vrf(
        ctx: Context<OpenCookieVrf>,
        archetype: u8,
        counter: u64,
        shard_id: u8,
    ) -> Result<()> {
        open_cookie_vrf_handler(ctx, archetype, counter, shard_id)
    }

    pub fn open_cookie(
        ctx: Context<OpenCookie>,
        archetype: u8,
        counter: u64,
        shard_id: u8,
    ) -> Result<()> {
        require!(archetype < 4, ErrorCode::InvalidArchetype);

        let clock = Clock::get()?;
        let authority_key = ctx.accounts.authority.key();

        // Validate signer authorization
        if let Some(session) = ctx.accounts.session_token.as_ref() {
            require!(session.valid_until > clock.unix_timestamp, ErrorCode::SessionExpired);
            require!(session.session_signer == ctx.accounts.signer.key(), ErrorCode::InvalidSession);
            require!(session.authority == authority_key, ErrorCode::InvalidSession);
        } else {
            // No session token: signer must be the authority
            require!(ctx.accounts.signer.key() == authority_key, ErrorCode::InvalidSession);
        }

        // Validate shard routing (prevents spoofing a cheaper shard)
        require!(
            shard_id == authority_key.as_ref()[0] % NUM_SHARDS,
            ErrorCode::InvalidShard
        );

        // Read entropy from SlotHashes sysvar (two most-recent slot hashes)
        let sh_data = ctx.accounts.slot_hashes.data.borrow();
        // Layout: 8-byte LE count, then (u64 slot, [u8;32] hash) per entry
        let hash_bytes: [u8; 32] = if sh_data.len() >= 48 {
            sh_data[16..48].try_into().unwrap_or([0u8; 32])
        } else {
            [0u8; 32]
        };
        drop(sh_data);

        let user_bytes = authority_key.to_bytes();

        // Mix hash + user + archetype + counter for fortune_id
        let mut seed = u64::from_le_bytes(hash_bytes[..8].try_into().unwrap());
        for (i, byte) in user_bytes.iter().enumerate() {
            seed = seed.wrapping_add((*byte as u64).wrapping_mul(i as u64 + 1));
        }
        seed = seed.wrapping_add(archetype as u64).wrapping_add(counter);
        let fortune_id = seed % 50;

        // Separate mix for rarity (different hash bytes + reversed user bytes)
        let mut rarity_seed = u64::from_le_bytes(hash_bytes[8..16].try_into().unwrap());
        for (i, byte) in user_bytes.iter().rev().enumerate() {
            rarity_seed = rarity_seed.wrapping_add((*byte as u64).wrapping_mul(i as u64 + 3));
        }
        rarity_seed = rarity_seed.wrapping_add(archetype as u64).wrapping_mul(13);
        let rarity: u8 = match rarity_seed % 100 {
            0..=69  => 0, // Common     70%
            70..=89 => 1, // Uncommon   20%
            90..=98 => 2, // Rare        9%
            _       => 3, // Legendary   1%
        };

        let cookie = &mut ctx.accounts.cookie;
        cookie.user = authority_key;
        cookie.archetype = archetype;
        cookie.fortune_id = fortune_id;
        cookie.rarity = rarity;
        cookie.bump = ctx.bumps.cookie;

        ctx.accounts.stats_shard.total_opens =
            ctx.accounts.stats_shard.total_opens.saturating_add(1);

        emit!(CookieOpened { user: authority_key, archetype, fortune_id, rarity });

        Ok(())
    }
}

// ─── Account contexts ──────────────────────────────────────────────────────────

#[derive(Accounts)]
#[instruction(shard_id: u8)]
pub struct InitializeStatsShard<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(
        init,
        payer = payer,
        space = 8 + 8 + 1 + 1, // total_opens + shard_id + bump
        seeds = [b"stats", &[shard_id]],
        bump
    )]
    pub shard: Account<'info, StatsShard>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct CreateSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    /// CHECK: pubkey of the ephemeral session keypair, no data required
    pub session_signer: UncheckedAccount<'info>,

    #[account(
        init,
        payer = authority,
        space = 8 + 32 + 32 + 8 + 1, // authority + session_signer + valid_until + bump
        seeds = [authority.key().as_ref(), session_signer.key().as_ref(), b"session"],
        bump
    )]
    pub session_token: Account<'info, SessionToken>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct RevokeSession<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        mut,
        seeds = [authority.key().as_ref(), session_token.session_signer.as_ref(), b"session"],
        bump = session_token.bump,
        close = authority
    )]
    pub session_token: Account<'info, SessionToken>,
}

#[derive(Accounts)]
#[instruction(archetype: u8, counter: u64, shard_id: u8)]
pub struct OpenCookie<'info> {
    /// Fee payer — authority directly, or a funded session keypair.
    #[account(mut)]
    pub signer: Signer<'info>,

    /// Real owner of the cookie. In direct mode equals signer.
    /// In session mode equals session_token.authority.
    /// CHECK: validated in handler against session_token or signer equality
    pub authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + 32 + 1 + 8 + 1 + 1,
        seeds = [authority.key().as_ref(), b"cookie", counter.to_le_bytes().as_ref()],
        bump
    )]
    pub cookie: Account<'info, FortuneCookie>,

    #[account(
        mut,
        seeds = [b"stats", &[shard_id]],
        bump = stats_shard.bump,
    )]
    pub stats_shard: Account<'info, StatsShard>,

    /// Present in session-key mode; None for direct-wallet mode.
    pub session_token: Option<Account<'info, SessionToken>>,

    /// CHECK: SlotHashes sysvar for on-chain entropy
    #[account(address = anchor_lang::solana_program::sysvar::slot_hashes::ID)]
    pub slot_hashes: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ─── Account data ──────────────────────────────────────────────────────────────

#[account]
pub struct FortuneCookie {
    pub user: Pubkey,
    pub archetype: u8,
    pub fortune_id: u64,
    pub rarity: u8,
    pub bump: u8,
}

#[account]
pub struct StatsShard {
    pub total_opens: u64,
    pub shard_id: u8,
    pub bump: u8,
}

#[account]
pub struct SessionToken {
    pub authority: Pubkey,
    pub session_signer: Pubkey,
    pub valid_until: i64,
    pub bump: u8,
}

// ─── Events & errors ──────────────────────────────────────────────────────────

#[event]
pub struct CookieOpened {
    pub user: Pubkey,
    pub archetype: u8,
    pub fortune_id: u64,
    pub rarity: u8,
}

#[error_code]
pub enum ErrorCode {
    #[msg("Invalid archetype (must be 0-3)")]
    InvalidArchetype,
    #[msg("Invalid shard ID (must be 0-63)")]
    InvalidShard,
    #[msg("Session token has expired")]
    SessionExpired,
    #[msg("Invalid session: signer or authority mismatch")]
    InvalidSession,
    #[msg("VRF randomness not yet settled — retry after one slot")]
    RandomnessNotSettled,
    #[msg("VRF randomness account is stale (> 150 slots old)")]
    RandomnessTooStale,
}

// ─── Switchboard VRF instruction (feature = "vrf") ────────────────────────────
//
// Compile with: anchor build -- --features vrf
// Add to Cargo.toml [features]: vrf = ["switchboard-on-demand"]
//
// Two-slot flow:
//   slot N   → client calls randomness.requestRandomness(rngKp, queue)
//   slot N+1 → Switchboard cranks; client calls open_cookie_vrf
//
// The hook (useVrfFortune.ts) pre-fetches the randomness request in the
// background so the user only sees one click.

#[cfg(feature = "vrf")]
#[derive(Accounts)]
#[instruction(archetype: u8, counter: u64, shard_id: u8)]
pub struct OpenCookieVrf<'info> {
    #[account(mut)]
    pub signer: Signer<'info>,

    /// CHECK: validated in handler (session or direct)
    pub authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = signer,
        space = 8 + 32 + 1 + 8 + 1 + 1,
        seeds = [authority.key().as_ref(), b"cookie", counter.to_le_bytes().as_ref()],
        bump
    )]
    pub cookie: Account<'info, FortuneCookie>,

    #[account(
        mut,
        seeds = [b"stats", &[shard_id]],
        bump = stats_shard.bump,
    )]
    pub stats_shard: Account<'info, StatsShard>,

    pub session_token: Option<Account<'info, SessionToken>>,

    /// CHECK: Switchboard On-Demand Randomness account (created by client before calling this ix)
    pub randomness_account_data: UncheckedAccount<'info>,

    pub system_program: Program<'info, System>,
}

#[cfg(feature = "vrf")]
impl<'info> OpenCookieVrf<'info> {
    /// Extract 32 bytes of verified randomness from the Switchboard account.
    /// Returns Err if the randomness hasn't been fulfilled yet or is stale.
    pub fn get_verified_randomness(&self) -> Result<[u8; 32]> {
        use switchboard_on_demand::on_demand::accounts::RandomnessAccountData;

        let clock = Clock::get()?;
        let data = self.randomness_account_data.try_borrow_data()?;
        let rng = RandomnessAccountData::parse(*data)
            .map_err(|_| error!(ErrorCode::RandomnessNotSettled))?;

        // get_value returns Err if not yet settled
        let value = rng
            .get_value(&clock)
            .map_err(|_| error!(ErrorCode::RandomnessNotSettled))?;

        // Reject if the randomness is older than 150 slots (~60 s)
        let age = clock.slot.saturating_sub(rng.seed_slot);
        require!(age <= 150, ErrorCode::RandomnessTooStale);

        Ok(value)
    }
}

// open_cookie_vrf handler — added to the #[program] module at build time
// when the "vrf" feature is enabled. See lib.rs #[program] block above for
// the non-VRF version; the logic below is identical except entropy source.
//
// Because Rust doesn't allow #[cfg] inside #[program] proc-macro, we expose
// a free function and call it from the module when the feature is on.
#[cfg(feature = "vrf")]
pub fn open_cookie_vrf_handler(
    ctx: Context<OpenCookieVrf>,
    archetype: u8,
    counter: u64,
    shard_id: u8,
) -> Result<()> {
    require!(archetype < 4, ErrorCode::InvalidArchetype);

    let clock = Clock::get()?;
    let authority_key = ctx.accounts.authority.key();

    if let Some(session) = ctx.accounts.session_token.as_ref() {
        require!(session.valid_until > clock.unix_timestamp, ErrorCode::SessionExpired);
        require!(session.session_signer == ctx.accounts.signer.key(), ErrorCode::InvalidSession);
        require!(session.authority == authority_key, ErrorCode::InvalidSession);
    } else {
        require!(ctx.accounts.signer.key() == authority_key, ErrorCode::InvalidSession);
    }

    require!(
        shard_id == authority_key.as_ref()[0] % NUM_SHARDS,
        ErrorCode::InvalidShard
    );

    // ── Switchboard verified randomness ────────────────────────────────────
    let vrf_bytes = ctx.accounts.get_verified_randomness()?;

    let user_bytes = authority_key.to_bytes();
    let mut seed = u64::from_le_bytes(vrf_bytes[..8].try_into().unwrap());
    for (i, byte) in user_bytes.iter().enumerate() {
        seed = seed.wrapping_add((*byte as u64).wrapping_mul(i as u64 + 1));
    }
    seed = seed.wrapping_add(archetype as u64).wrapping_add(counter);
    let fortune_id = seed % 50;

    let mut rarity_seed = u64::from_le_bytes(vrf_bytes[8..16].try_into().unwrap());
    for (i, byte) in user_bytes.iter().rev().enumerate() {
        rarity_seed = rarity_seed.wrapping_add((*byte as u64).wrapping_mul(i as u64 + 3));
    }
    rarity_seed = rarity_seed.wrapping_add(archetype as u64).wrapping_mul(13);
    let rarity: u8 = match rarity_seed % 100 {
        0..=69  => 0,
        70..=89 => 1,
        90..=98 => 2,
        _       => 3,
    };

    let cookie = &mut ctx.accounts.cookie;
    cookie.user      = authority_key;
    cookie.archetype = archetype;
    cookie.fortune_id = fortune_id;
    cookie.rarity    = rarity;
    cookie.bump      = ctx.bumps.cookie;

    ctx.accounts.stats_shard.total_opens =
        ctx.accounts.stats_shard.total_opens.saturating_add(1);

    emit!(CookieOpened { user: authority_key, archetype, fortune_id, rarity });
    Ok(())
}
