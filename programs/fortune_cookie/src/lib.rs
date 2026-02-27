use anchor_lang::prelude::*;

declare_id!("GpPcUYfhJzGwpN1xwNMHRiEGmj2BnvAtPkZSn2Nyi8n8");

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

        // Simple pseudo-random using slot and user pubkey bytes
        let slot_bytes = clock.slot.to_le_bytes();
        let user_bytes = user_key.to_bytes();
        
        // Mix slot, user, archetype, and counter for fortune_id
        let mut seed: u64 = clock.slot;
        for (i, byte) in user_bytes.iter().enumerate() {
            seed = seed.wrapping_add((*byte as u64).wrapping_mul(i as u64 + 1));
        }
        seed = seed.wrapping_add(archetype as u64);
        seed = seed.wrapping_add(counter);
        
        let fortune_id = seed % 50;
        
        // Use different mix for rarity
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
}
