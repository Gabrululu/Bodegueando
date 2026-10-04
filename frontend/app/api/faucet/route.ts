import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { readJsonStore, writeJsonStore } from "@/lib/kv";
import { stablecoinAbi, stablecoinAddress, STABLECOIN_DECIMALS } from "@/lib/contracts";

/**
 * Faucet de saldo de prueba (USDG de testnet, el stablecoin con el que se cobra todo en la app)
 * para que quien prueba la demo pueda pagar sin que un operador tenga que fondearlo a mano cada
 * vez. No hace falta ETH: el gas lo paga PuntosPaymaster. La billetera del faucet se recarga en
 * https://faucet.paxos.com (Arbitrum Sepolia). Nunca es dinero real: solo tiene sentido en
 * Arbitrum Sepolia.
 *
 * Una sola vez por dirección: se registra en lib/kv.ts (igual que bodega-codes/telegram-links)
 * apenas se manda la transacción, así una misma cuenta no puede pedir de nuevo aunque gaste
 * el saldo. También se chequea el saldo de USDG actual antes de mandar nada, por si ya tiene
 * fondos (fondeada a mano).
 */
const STORE_NAME = "faucet-funded";
const rpcUrl = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;
const faucetPrivateKey = process.env.FAUCET_PRIVATE_KEY as `0x${string}` | undefined;
const faucetAmountUsdg = process.env.FAUCET_AMOUNT_USDG || "10";
const MIN_USDG_TO_SKIP = parseUnits("1", STABLECOIN_DECIMALS);

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
    const balance = await client.readContract({
      address: stablecoinAddress,
      abi: stablecoinAbi,
      functionName: "balanceOf",
      args: [address as Address],
    });
    if (balance >= MIN_USDG_TO_SKIP) {
      alreadyFunded[key] = { txHash: "", at: Date.now() };
      await writeJsonStore(STORE_NAME, alreadyFunded);
      return NextResponse.json({ funded: false, reason: "already_has_balance" });
    }

    const funder = privateKeyToAccount(faucetPrivateKey);
    const walletClient = createWalletClient({ account: funder, chain: arbitrumSepolia, transport: http(rpcUrl) });
    const txHash = await walletClient.writeContract({
      address: stablecoinAddress,
      abi: stablecoinAbi,
      functionName: "transfer",
      args: [address as Address, parseUnits(faucetAmountUsdg, STABLECOIN_DECIMALS)],
    });

    alreadyFunded[key] = { txHash, at: Date.now() };
    await writeJsonStore(STORE_NAME, alreadyFunded);

    return NextResponse.json({ funded: true, amountUsd: faucetAmountUsdg, txHash });
  } catch (err) {
    console.error("[faucet] failed to fund", key, err);
    return NextResponse.json({ funded: false, reason: "faucet_error" }, { status: 500 });
  }
}
