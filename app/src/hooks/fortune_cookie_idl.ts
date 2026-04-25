// Auto-generated IDL type (Anchor 0.29 style — converted to 0.30+ on-the-fly
// by the bankrun test helper).
export const IDL = {
  "version": "0.1.0",
  "name": "fortune_cookie",
  "instructions": [
    {
      "name": "initialize_stats",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "stats",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "system_program",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "initialize_treasury",
      "accounts": [
        {
          "name": "payer",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "treasury",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "system_program",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "open_cookie",
      "accounts": [
        {
          "name": "user",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "cookie",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "stats",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "system_program",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "archetype",
          "type": "u8"
        },
        {
          "name": "counter",
          "type": "u64"
        }
      ]
    },
    {
      "name": "authorize_session",
      "accounts": [
        {
          "name": "user",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "session",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "system_program",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "session_key",
          "type": "publicKey"
        },
        {
          "name": "duration_seconds",
          "type": "i64"
        }
      ]
    },
    {
      "name": "revoke_session",
      "accounts": [
        {
          "name": "user",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "session",
          "isMut": true,
          "isSigner": false
        }
      ],
      "args": []
    },
    {
      "name": "open_cookie_via_session",
      "accounts": [
        {
          "name": "session_key",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "user",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "session",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "cookie",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "stats",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "system_program",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "archetype",
          "type": "u8"
        },
        {
          "name": "counter",
          "type": "u64"
        }
      ]
    },
    {
      "name": "deposit",
      "accounts": [
        {
          "name": "user",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "balance",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "system_program",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "withdraw",
      "accounts": [
        {
          "name": "user",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "balance",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "system_program",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "open_cookie_prepaid",
      "accounts": [
        {
          "name": "session_key",
          "isMut": true,
          "isSigner": true
        },
        {
          "name": "user",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "session",
          "isMut": false,
          "isSigner": false
        },
        {
          "name": "balance",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "treasury",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "cookie",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "stats",
          "isMut": true,
          "isSigner": false
        },
        {
          "name": "system_program",
          "isMut": false,
          "isSigner": false
        }
      ],
      "args": [
        {
          "name": "archetype",
          "type": "u8"
        },
        {
          "name": "counter",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "FortuneCookie",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "publicKey"
          },
          {
            "name": "archetype",
            "type": "u8"
          },
          {
            "name": "fortune_id",
            "type": "u64"
          },
          {
            "name": "rarity",
            "type": "u8"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "Stats",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "total_opens",
            "type": "u64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "Session",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "user",
            "type": "publicKey"
          },
          {
            "name": "session_key",
            "type": "publicKey"
          },
          {
            "name": "expires_at",
            "type": "i64"
          },
          {
            "name": "bump",
            "type": "u8"
          }
        ]
      }
    }
  ],
  "events": [
    {
      "name": "CookieOpened",
      "fields": [
        {
          "name": "user",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "archetype",
          "type": "u8",
          "index": false
        },
        {
          "name": "fortune_id",
          "type": "u64",
          "index": false
        },
        {
          "name": "rarity",
          "type": "u8",
          "index": false
        }
      ]
    },
    {
      "name": "SessionAuthorized",
      "fields": [
        {
          "name": "user",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "session_key",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "expires_at",
          "type": "i64",
          "index": false
        }
      ]
    },
    {
      "name": "FeeCollected",
      "fields": [
        {
          "name": "user",
          "type": "publicKey",
          "index": false
        },
        {
          "name": "amount",
          "type": "u64",
          "index": false
        }
      ]
    }
  ]
} as const;
