// Auto-generated IDL type
export const IDL = {
  "address": "DaBeUWY9HtfNDW9mED1BoGiUbDULM7mcubJaaardfJ85",
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
    }
  ]
} as const;
