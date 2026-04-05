import {
  BaseWalletAdapter,
  WalletAdapterNetwork,
  WalletName,
  WalletNotConnectedError,
  WalletError,
  WalletReadyState,
} from "@solana/wallet-adapter-base";
import { PublicKey, Transaction, VersionedTransaction } from "@solana/web3.js";

export const MockWalletName = "Mock Wallet" as WalletName<"Mock Wallet">;

/**
 * Mock wallet adapter for testing on localhost
 * Simulates a basic wallet that always approves transactions
 */
export class MockWalletAdapter extends BaseWalletAdapter {
  name = MockWalletName;
  url = "http://localhost";
  icon = "data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj48cmVjdCB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHJ4PSI0IiBmaWxsPSIjRkE1QzQxIi8+PHRleHQgeD0iNiIgeT0iMTgiIGZvbnQtc2l6ZT0iMTYiIGZvbnQtd2VpZ2h0PSJib2xkIiBmaWxsPSJ3aGl0ZSI+TTwvdGV4dD48L3N2Zz4=";
  readonly supportedTransactionVersions = null;
  private _publicKey: PublicKey | null = null;
  private _connecting = false;
  private _connected = false;

  constructor() {
    super();
    this._readyState = WalletReadyState.Installed;
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get connected(): boolean {
    return this._connected;
  }

  async connect(): Promise<void> {
    try {
      this._connecting = true;
      // Simulate connection delay
      await new Promise((resolve) => setTimeout(resolve, 500));
      // Use a fixed public key for testing
      this._publicKey = new PublicKey(
        "F4YdyV2GP1Rmo16k5oNtT2WiiPHhzfvgrnu6WBVCUcGL"
      );
      this._connected = true;
      this.emit("connect", this._publicKey);
    } catch (error) {
      this.emit("error", new WalletError("Failed to connect"));
      throw error;
    } finally {
      this._connecting = false;
    }
  }

  async disconnect(): Promise<void> {
    this._publicKey = null;
    this._connected = false;
    this.emit("disconnect");
  }

  async sendTransaction(
    transaction: Transaction | VersionedTransaction,
    connection: any,
    options?: any
  ): Promise<string> {
    try {
      if (!this._publicKey) throw new WalletNotConnectedError();
      // Sign the transaction (mock)
      if (transaction instanceof Transaction) {
        transaction.feePayer = this._publicKey;
      }
      // Return a fake signature
      return "mock_signature_" + Math.random().toString(36).substr(2, 9);
    } catch (error) {
      this.emit("error", new WalletError("Failed to send transaction"));
      throw error;
    }
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    transaction: T
  ): Promise<T> {
    try {
      if (!this._publicKey) throw new WalletNotConnectedError();
      // Mock signing - just return the transaction as-is
      return transaction;
    } catch (error) {
      this.emit("error", new WalletError("Failed to sign transaction"));
      throw error;
    }
  }

  async signAllTransactions<T extends Transaction | VersionedTransaction>(
    transactions: T[]
  ): Promise<T[]> {
    try {
      if (!this._publicKey) throw new WalletNotConnectedError();
      return transactions;
    } catch (error) {
      this.emit("error", new WalletError("Failed to sign transactions"));
      throw error;
    }
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    try {
      if (!this._publicKey) throw new WalletNotConnectedError();
      // Mock message signing - just return the message as-is
      return message;
    } catch (error) {
      this.emit("error", new WalletError("Failed to sign message"));
      throw error;
    }
  }
}
