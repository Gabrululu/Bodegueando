import { NextRequest, NextResponse } from "next/server";
import { createPublicClient, createWalletClient, http, isAddress, parseUnits, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { arbitrumSepolia } from "viem/chains";
import { deleteKey, getValue, readJsonStore, setIfNotExists, setValue } from "@/lib/kv";
import { clientIp, hitRateLimit } from "@/lib/rateLimit";
import { stablecoinAbi, stablecoinAddress, STABLECOIN_DECIMALS } from "@/lib/contracts";

/**
 * Faucet de saldo de prueba (USDG de testnet, el stablecoin con el que se cobra todo en la app)
 * para que quien prueba la demo pueda pagar sin que un operador tenga que fondearlo a mano cada
 * vez. No hace falta ETH: el gas lo paga PuntosPaymaster. La billetera del faucet se recarga en
 * https://faucet.paxos.com (Arbitrum Sepolia). Nunca es dinero real: solo tiene sentido en
 * Arbitrum Sepolia.
 *
 * Una sola vez por dirección: la dirección se reserva de forma atómica en lib/kv.ts
 * (`setIfNotExists`) antes de mandar la transacción, así ni una misma cuenta que gastó el saldo
 * ni dos pedidos simultáneos cobran dos veces; si el envío falla, la reserva se libera. También
 * se chequea el saldo de USDG actual antes de mandar nada, por si ya tiene fondos.
 *
 * Una dirección nueva no cuesta nada (cualquiera puede generar miles con un script), así que
 * "una vez por dirección" no alcanza para que no vacíen el faucet. Por eso, además, cada regalo
 * cuenta contra un límite por IP y un tope global por día (FAUCET_DAILY_LIMIT), que acota lo
 * que se puede llevar alguien aunque automatice. Solo cuentan los regalos que de verdad se
 * intentan: las cuentas ya fondeadas responden antes, sin gastar cupo.
 */
const LEGACY_STORE_NAME = "faucet-funded";
const PER_IP_DAILY_LIMIT = 3;
const GLOBAL_DAILY_LIMIT = Number(process.env.FAUCET_DAILY_LIMIT) || 100;
const DAY_SECONDS = 24 * 60 * 60;
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
  const fundedKey = `faucet:funded:${key}`;
  // Las cuentas fondeadas antes de pasar a una clave por dirección siguen en el blob viejo.
  const legacyFunded = await readJsonStore<Record<string, unknown>>(LEGACY_STORE_NAME, {});
  if (legacyFunded[key] || (await getValue(fundedKey)) !== null) {
    return NextResponse.json({ funded: false, reason: "already_funded" });
  }

  let claimed = false;
  try {
    const client = publicClient();
    const balance = await client.readContract({
      address: stablecoinAddress,
      abi: stablecoinAbi,
      functionName: "balanceOf",
      args: [address as Address],
    });
    if (balance >= MIN_USDG_TO_SKIP) {
      await setValue(fundedKey, "has_balance");
      return NextResponse.json({ funded: false, reason: "already_has_balance" });
    }

    if (await hitRateLimit(`faucet:ip:${clientIp(request)}`, PER_IP_DAILY_LIMIT, DAY_SECONDS)) {
      return NextResponse.json({ funded: false, reason: "rate_limited" }, { status: 429 });
    }
    if (await hitRateLimit("faucet:global", GLOBAL_DAILY_LIMIT, DAY_SECONDS)) {
      return NextResponse.json({ funded: false, reason: "daily_limit_reached" }, { status: 429 });
    }

    // Reserva atómica: si otro pedido para la misma dirección llegó primero, este no manda nada.
    if (!(await setIfNotExists(fundedKey, "pending"))) {
      return NextResponse.json({ funded: false, reason: "already_funded" });
    }
    claimed = true;

    const funder = privateKeyToAccount(faucetPrivateKey);
    const walletClient = createWalletClient({ account: funder, chain: arbitrumSepolia, transport: http(rpcUrl) });
    const txHash = await walletClient.writeContract({
      address: stablecoinAddress,
      abi: stablecoinAbi,
      functionName: "transfer",
      args: [address as Address, parseUnits(faucetAmountUsdg, STABLECOIN_DECIMALS)],
    });

    await setValue(fundedKey, txHash);

    return NextResponse.json({ funded: true, amountUsd: faucetAmountUsdg, txHash });
  } catch (err) {
    console.error("[faucet] failed to fund", key, err);
    // Sin transacción enviada, la dirección puede volver a pedir.
    if (claimed) await deleteKey(fundedKey).catch(() => undefined);
    return NextResponse.json({ funded: false, reason: "faucet_error" }, { status: 500 });
  }
}
