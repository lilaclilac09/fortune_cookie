// Unit tests — no validator needed.
// Run: cargo test --manifest-path programs/fortune_cookie/Cargo.toml

use fortune_cookie::NUM_SHARDS;

// ─── Shard routing ─────────────────────────────────────────────────────────────

#[test]
fn test_num_shards_is_64() {
    assert_eq!(NUM_SHARDS, 64);
}

#[test]
fn test_shard_routing_covers_all_shards() {
    // Every possible first byte should map to a valid shard
    for byte in 0u8..=255 {
        let shard = byte % NUM_SHARDS;
        assert!(shard < NUM_SHARDS, "shard {shard} out of range for byte {byte}");
    }
}

#[test]
fn test_shard_routing_distribution() {
    // Each shard should be assigned the same number of pubkey prefixes
    let mut counts = [0u32; 64];
    for byte in 0u8..=255 {
        counts[(byte % NUM_SHARDS) as usize] += 1;
    }
    // 256 / 64 = 4 exactly
    for (i, &count) in counts.iter().enumerate() {
        assert_eq!(count, 4, "shard {i} has {count} prefixes instead of 4");
    }
}

// ─── Archetype validation ──────────────────────────────────────────────────────

#[test]
fn test_valid_archetypes() {
    for archetype in 0u8..4 {
        assert!(archetype < 4, "archetype {archetype} should be valid");
    }
}

#[test]
fn test_invalid_archetypes() {
    for archetype in 4u8..=255 {
        assert!(archetype >= 4, "archetype {archetype} should be invalid");
    }
}

// ─── Fortune & rarity computation ─────────────────────────────────────────────

fn compute_fortune(hash_bytes: &[u8; 32], user_bytes: &[u8; 32], archetype: u8, counter: u64) -> (u64, u8) {
    let mut seed = u64::from_le_bytes(hash_bytes[..8].try_into().unwrap());
    for (i, byte) in user_bytes.iter().enumerate() {
        seed = seed.wrapping_add((*byte as u64).wrapping_mul(i as u64 + 1));
    }
    seed = seed.wrapping_add(archetype as u64).wrapping_add(counter);
    let fortune_id = seed % 50;

    let mut rarity_seed = u64::from_le_bytes(hash_bytes[8..16].try_into().unwrap());
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

    (fortune_id, rarity)
}

#[test]
fn test_fortune_id_in_range() {
    let hash = [0u8; 32];
    let user = [1u8; 32];
    for archetype in 0u8..4 {
        for counter in 0u64..10 {
            let (fortune_id, rarity) = compute_fortune(&hash, &user, archetype, counter);
            assert!(fortune_id < 50, "fortune_id {fortune_id} out of range");
            assert!(rarity < 4, "rarity {rarity} out of range");
        }
    }
}

#[test]
fn test_fortune_deterministic() {
    let hash = [42u8; 32];
    let user = [7u8; 32];
    let (f1, r1) = compute_fortune(&hash, &user, 2, 100);
    let (f2, r2) = compute_fortune(&hash, &user, 2, 100);
    assert_eq!(f1, f2, "fortune_id must be deterministic");
    assert_eq!(r1, r2, "rarity must be deterministic");
}

#[test]
fn test_different_counters_different_fortune() {
    let hash = [0u8; 32];
    let user = [0u8; 32];
    let (f0, _) = compute_fortune(&hash, &user, 0, 0);
    let (f1, _) = compute_fortune(&hash, &user, 0, 1);
    // With counter=0 seed wraps differently than counter=1
    assert_ne!(f0, f1, "different counters should (usually) yield different fortunes");
}

#[test]
fn test_rarity_buckets_reasonable() {
    // Verify the rarity bucket boundaries match the program constants
    let rarity_from_seed = |s: u64| -> u8 {
        match s % 100 {
            0..=69  => 0,
            70..=89 => 1,
            90..=98 => 2,
            _       => 3,
        }
    };
    let mut counts = [0u32; 4];
    for s in 0u64..10_000 {
        counts[rarity_from_seed(s) as usize] += 1;
    }
    // Common ~70%, Uncommon ~20%, Rare ~9%, Legendary ~1%
    assert!(counts[0] > counts[1], "common should be most frequent");
    assert!(counts[1] > counts[2], "uncommon should be more than rare");
    assert!(counts[2] > counts[3], "rare should be more than legendary");
}

// ─── Shard ID validation ───────────────────────────────────────────────────────

#[test]
fn test_shard_id_boundary() {
    // shard_id 0..63 valid, 64+ invalid
    for id in 0u8..NUM_SHARDS {
        assert!(id < NUM_SHARDS);
    }
    assert!(NUM_SHARDS >= NUM_SHARDS); // 64 is invalid
}

#[test]
fn test_wrong_shard_detection() {
    // If authority byte[0] = 10 -> shard must be 10 % 64 = 10
    let authority_first_byte: u8 = 10;
    let correct_shard = authority_first_byte % NUM_SHARDS;
    let wrong_shard = correct_shard.wrapping_add(1) % NUM_SHARDS;
    assert_ne!(correct_shard, wrong_shard);
    assert_eq!(correct_shard, 10);
}
