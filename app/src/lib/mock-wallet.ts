/**
 * 本地钱包模拟器 - 用于开发测试
 * 不需要Solflare、Phantom等扩展
 */

import { PublicKey, Transaction, Keypair } from '@solana/web3.js';

export interface WalletAdapter {
  publicKey: PublicKey | null;
  connected: boolean;
  connect: () => Promise<void>;
  disconnect: () => Promise<void>;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
  signAllTransactions: (transactions: Transaction[]) => Promise<Transaction[]>;
}

export class LocalWallet implements WalletAdapter {
  private keypair: Keypair;
  public publicKey: PublicKey;
  public connected: boolean = false;

  constructor(keypairSeed?: Uint8Array) {
    // 如果提供了seed，用seed创建；否则随机生成
    if (keypairSeed) {
      // 64字节用fromSecretKey，32字节用fromSeed
      this.keypair = keypairSeed.length === 64
        ? Keypair.fromSecretKey(keypairSeed)
        : Keypair.fromSeed(keypairSeed);
    } else {
      const fixedSeed = new Uint8Array([
        72, 66, 220, 189, 149, 12, 40, 197,
        140, 216, 203, 20, 181, 154, 255, 177,
        124, 217, 255, 99, 182, 115, 116, 226,
        48, 146, 35, 132, 96, 100, 155, 123,
      ]);
      this.keypair = Keypair.fromSeed(fixedSeed);
    }
    this.publicKey = this.keypair.publicKey;
  }

  async connect(): Promise<void> {
    this.connected = true;
    console.log('✅ Local wallet connected:', this.publicKey.toString());
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    console.log('✅ Local wallet disconnected');
  }

  async signTransaction(transaction: Transaction): Promise<Transaction> {
    if (!this.connected) {
      throw new Error('Wallet not connected');
    }
    transaction.sign(this.keypair);
    return transaction;
  }

  async signAllTransactions(transactions: Transaction[]): Promise<Transaction[]> {
    if (!this.connected) {
      throw new Error('Wallet not connected');
    }
    return transactions.map((tx) => {
      tx.sign(this.keypair);
      return tx;
    });
  }

  /**
   * 获取钱包的私钥（仅限测试用）
   * WARNING: 生产环境中永不使用！
   */
  getSecretKey(): Uint8Array {
    return this.keypair.secretKey;
  }
}

/**
 * 预定义的测试钱包账户
 * 可用于快速切换测试身份
 */
export const TEST_ACCOUNTS = {
  account1: {
    name: 'Test Account 1',
    seed: new Uint8Array([
      72, 66, 220, 189, 149, 12, 40, 197,
      140, 216, 203, 20, 181, 154, 255, 177,
      124, 217, 255, 99, 182, 115, 116, 226,
      48, 146, 35, 132, 96, 100, 155, 123,
    ]),
  },
  account2: {
    name: 'Test Account 2',
    seed: new Uint8Array([
      73, 67, 221, 190, 150, 13, 41, 198,
      141, 217, 204, 21, 182, 155, 0, 178,
      125, 218, 0, 100, 183, 116, 117, 227,
      49, 147, 36, 133, 97, 101, 156, 124,
    ]),
  },
  account3: {
    name: 'Test Account 3',
    seed: new Uint8Array([
      74, 68, 222, 191, 151, 14, 42, 199,
      142, 218, 205, 22, 183, 156, 1, 179,
      126, 219, 1, 101, 184, 117, 118, 228,
      50, 148, 37, 134, 98, 102, 157, 125,
    ]),
  },
};

/**
 * 创建本地钱包实例
 */
export function createLocalWallet(
  keypairSeed?: Uint8Array
): LocalWallet {
  return new LocalWallet(keypairSeed);
}

/**
 * 获取预定义的测试钱包
 */
export function getTestWallet(accountName: string): LocalWallet {
  const account =
    TEST_ACCOUNTS[accountName as keyof typeof TEST_ACCOUNTS];
  if (!account) {
    throw new Error(`Unknown account: ${accountName}`);
  }
  return new LocalWallet(account.seed);
}
