// 诊断和辅助函数
import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';

export async function getBalance(connection: Connection, publicKey: PublicKey): Promise<number> {
  try {
    const balance = await connection.getBalance(publicKey);
    return balance / LAMPORTS_PER_SOL;
  } catch (error) {
    console.error('获取余额失败:', error);
    return 0;
  }
}

export async function requestAirdrop(
  connection: Connection,
  publicKey: PublicKey,
  amountInSol: number = 1
): Promise<string | null> {
  try {
    const signature = await connection.requestAirdrop(
      publicKey,
      amountInSol * LAMPORTS_PER_SOL
    );
    
    // Wait for confirmation
    const latestBlockhash = await connection.getLatestBlockhash();
    await connection.confirmTransaction({
      blockhash: latestBlockhash.blockhash,
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      signature,
    });
    
    console.log(`✅ 成功airdrop ${amountInSol} SOL`);
    return signature;
  } catch (error: any) {
    console.error('❌ Airdrop失败:', error?.message);
    return null;
  }
}

export async function checkConnection(connection: Connection): Promise<boolean> {
  try {
    const version = await connection.getVersion();
    console.log('✅ RPC连接正常, Solana版本:', version);
    return true;
  } catch (error) {
    console.error('❌ RPC连接失败:', error);
    return false;
  }
}

export async function diagnostics(
  connection: Connection,
  publicKey: PublicKey | null
): Promise<string> {
  const lines: string[] = [];
  
  // 检查RPC
  const connected = await checkConnection(connection);
  lines.push(`🔗 RPC连接: ${connected ? '✅ OK' : '❌ 故障'}`);
  
  if (publicKey) {
    // 检查钱包
    const balance = await getBalance(connection, publicKey);
    lines.push(`💰 钱包: ${publicKey.toString().slice(0, 8)}...`);
    lines.push(`💵 余额: ${balance} SOL`);
    
    if (balance < 0.005) {
      lines.push(`⚠️ 余额过低! 需要 >= 0.005 SOL来发送交易`);
    }
  }
  
  return lines.join('\n');
}
