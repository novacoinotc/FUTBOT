import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getOrCreateAssociatedTokenAccount,
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import bs58 from "bs58";
import { env } from "../config/env.js";

// Solana USDT (mainnet)
const USDT_MINT = new PublicKey(
  "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB"
);

// Use mainnet by default, devnet for testing
const SOLANA_RPC =
  process.env.SOLANA_RPC_URL || "https://api.mainnet-beta.solana.com";

const connection = new Connection(SOLANA_RPC, "confirmed");

export interface WalletInfo {
  address: string;
  privateKey: string;
  solBalance: number;
  usdtBalance: number;
}

// Generate a new Solana wallet for an agent
export function generateWallet(): { address: string; privateKey: string } {
  const keypair = Keypair.generate();
  const address = keypair.publicKey.toBase58();
  const privateKey = bs58.encode(keypair.secretKey);
  return { address, privateKey };
}

// Get keypair from stored private key
function getKeypair(privateKey: string): Keypair {
  const secretKey = bs58.decode(privateKey);
  return Keypair.fromSecretKey(secretKey);
}

// Get SOL balance
export async function getSolBalance(address: string): Promise<number> {
  try {
    const pubkey = new PublicKey(address);
    const balance = await connection.getBalance(pubkey);
    return balance / LAMPORTS_PER_SOL;
  } catch {
    return 0;
  }
}

// Get USDT balance on Solana
export async function getUsdtBalance(address: string): Promise<number> {
  try {
    const pubkey = new PublicKey(address);
    const tokenAddress = await getAssociatedTokenAddress(USDT_MINT, pubkey);

    const accountInfo =
      await connection.getTokenAccountBalance(tokenAddress);
    return Number(accountInfo.value.uiAmount || 0);
  } catch {
    return 0;
  }
}

// Get full wallet info
export async function getWalletInfo(
  address: string,
  privateKey: string
): Promise<WalletInfo> {
  const [solBalance, usdtBalance] = await Promise.all([
    getSolBalance(address),
    getUsdtBalance(address),
  ]);

  return { address, privateKey, solBalance, usdtBalance };
}

// Transfer USDT from agent wallet to a destination
export async function transferUsdt(
  fromPrivateKey: string,
  toAddress: string,
  amount: number
): Promise<{ signature: string; success: boolean; error?: string }> {
  try {
    const fromKeypair = getKeypair(fromPrivateKey);
    const toPubkey = new PublicKey(toAddress);

    // Get or create token accounts
    const fromTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      fromKeypair,
      USDT_MINT,
      fromKeypair.publicKey
    );

    const toTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      fromKeypair,
      USDT_MINT,
      toPubkey
    );

    // USDT has 6 decimals on Solana
    const amountInSmallestUnit = Math.floor(amount * 1_000_000);

    const transaction = new Transaction().add(
      createTransferInstruction(
        fromTokenAccount.address,
        toTokenAccount.address,
        fromKeypair.publicKey,
        amountInSmallestUnit,
        [],
        TOKEN_PROGRAM_ID
      )
    );

    const signature = await connection.sendTransaction(transaction, [
      fromKeypair,
    ]);
    await connection.confirmTransaction(signature, "confirmed");

    return { signature, success: true };
  } catch (error) {
    return {
      signature: "",
      success: false,
      error: error instanceof Error ? error.message : "Transfer failed",
    };
  }
}

// Transfer SOL (needed for gas fees)
export async function transferSol(
  fromPrivateKey: string,
  toAddress: string,
  amountSol: number
): Promise<{ signature: string; success: boolean; error?: string }> {
  try {
    const fromKeypair = getKeypair(fromPrivateKey);
    const toPubkey = new PublicKey(toAddress);

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: fromKeypair.publicKey,
        toPubkey,
        lamports: Math.floor(amountSol * LAMPORTS_PER_SOL),
      })
    );

    const signature = await connection.sendTransaction(transaction, [
      fromKeypair,
    ]);
    await connection.confirmTransaction(signature, "confirmed");

    return { signature, success: true };
  } catch (error) {
    return {
      signature: "",
      success: false,
      error: error instanceof Error ? error.message : "Transfer failed",
    };
  }
}
