import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, parseEther, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { readJsonStore, writeJsonStore } from "@/lib/kv";

/**
 * Faucet de saldo de prueba (ETH de testnet, la moneda que Bodegueando usa como stand-in de
 * eSol — ver README) para que quien prueba la demo pueda pagar sin que un operador tenga que
 * fondearlo a mano cada vez, como se hizo manualmente antes de existir esta ruta. Nunca es
 * dinero real: solo tiene sentido en Arbitrum Sepolia.
 *
 * Una sola vez por dirección: se registra en lib/kv.ts (igual que bodega-codes/telegram-links)
 * apenas se manda la transacción, así una misma cuenta no puede pedir de nuevo aunque gaste
 * el saldo. También se chequea el balance on-chain actual antes de mandar nada, por si ya
 * tiene fondos (fondeada a mano, como se hizo con las primeras cuentas de prueba).
 */
const STORE_NAME = "faucet-funded";
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;
const faucetPrivateKey = process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined;
const faucetAmountEth = process.env.FAUCET_AMOUNT_ETH || "0.005";
const MIN_BALANCE_TO_SKIP = parseEther("0.001");

function publicClient() {
  return createPublicClient({ chain: arbitrumSepolia, transport: http(rpcUrl) });
}

export async function POST(request: NextRequest) {
  const body = await request.json().catch(() => null);
  const address = body?.address;

  if (typeof address !== "string" || !isAddress(address)) {
    return NextResponse.json({ error: "address must be a valid address" }, { status: 400 });
  }
  if (!faucetPrivateKey) {
    return NextResponse.json({ funded: false, reason: "faucet_not_configured" });
  }

  const key = (address as Address).toLowerCase();
  const alreadyFunded = await readJsonStore<Record<string, { txHash: string; at: number }>>(STORE_NAME, {});
  if (alreadyFunded[key]) {
    return NextResponse.json({ funded: false, reason: "already_funded" });
  }

  try {
    const client = publicClient();
    const balance = await client.getBalance({ address: address as Address });
    if (balance >= MIN_BALANCE_TO_SKIP) {
      alreadyFunded[key] = { txHash: "", at: Date.now() };
      await writeJsonStore(STORE_NAME, alreadyFunded);
      return NextResponse.json({ funded: false, reason: "already_has_balance" });
    }

    const funder = privateKeyToAccount(faucetPrivateKey);
    const walletClient = createWalletClient({ account: funder, chain: arbitrumSepolia, transport: http(rpcUrl) });
    const txHash = await walletClient.sendTransaction({
      to: address as Address,
      value: parseEther(faucetAmountEth),
    });

    alreadyFunded[key] = { txHash, at: Date.now() };
    await writeJsonStore(STORE_NAME, alreadyFunded);

    return NextResponse.json({ funded: true, amountEth: faucetAmountEth, txHash });
  } catch (err) {
    console.error("[faucet] failed to fund", key, err);
    return NextResponse.json({ funded: false, reason: "faucet_error" }, { status: 500 });
  }
}
