// Chequeo puntual del depósito de gas de PuntosPaymaster en el EntryPoint (ERC-4337).
// Corre aparte del servidor de Next.js, igual que scripts/telegram-bot.mjs (`pnpm run
// check-paymaster-balance`, a mano o desde un cron/CI) — a diferencia del bot, esto es una
// lectura on-chain de solo lectura sin lógica de negocio que reusar de una API route, así
// que lee directo con viem en vez de agregar una ruta sin otro consumidor.
//
// Es una ALERTA, no un auto-repuesto: el depósito se sigue recargando a mano (ver README,
// "El depósito de gas del paymaster se repone a mano") — esto solo evita enterarse recién
// cuando los pagos empiecen a fallar por falta de gas patrocinado.

import { createPublicClient, http, formatEther, parseEther } from "viem";
import { arbitrumSepolia } from "viem/chains";

const RPC_URL = process.env.NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL;
const PAYMASTER_ADDRESS = process.env.NEXT_PUBLIC_PUNTOS_PAYMASTER_ADDRESS;
const THRESHOLD_ETH = process.env.PAYMASTER_BALANCE_ALERT_THRESHOLD_ETH || "0.01";
const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const ADMIN_CHAT_ID = process.env.TELEGRAM_ADMIN_CHAT_ID;

// EntryPoint v0.7, misma dirección canónica en toda red EVM (ver
// contracts/solidity/script/DeployPuntosPaymaster.s.sol). Solo necesitamos balanceOf, que
// viene de IStakeManager — no hace falta el ABI completo del EntryPoint para esto.
const ENTRY_POINT_ADDRESS = "0x0000000071727De22E5E9d8BAf0edAc6f37da032";
const ENTRY_POINT_ABI = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
];

if (!RPC_URL || !PAYMASTER_ADDRESS) {
  console.error("Faltan NEXT_PUBLIC_ARBITRUM_SEPOLIA_RPC_URL o NEXT_PUBLIC_PUNTOS_PAYMASTER_ADDRESS en .env.local");
  process.exit(1);
}

async function sendTelegramAlert(text) {
  if (!BOT_TOKEN || !ADMIN_CHAT_ID) {
    console.warn("TELEGRAM_BOT_TOKEN o TELEGRAM_ADMIN_CHAT_ID no configurados — no se manda alerta, solo se loggea.");
    return;
  }
  await fetch(`https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: ADMIN_CHAT_ID, text }),
  }).catch(() => {});
}

async function main() {
  const client = createPublicClient({ chain: arbitrumSepolia, transport: http(RPC_URL) });

  const balanceWei = await client.readContract({
    address: ENTRY_POINT_ADDRESS,
    abi: ENTRY_POINT_ABI,
    functionName: "balanceOf",
    args: [PAYMASTER_ADDRESS],
  });

  const balanceEth = formatEther(balanceWei);
  const thresholdWei = parseEther(THRESHOLD_ETH);
  const isLow = balanceWei < thresholdWei;

  console.log(`PuntosPaymaster (${PAYMASTER_ADDRESS}) tiene ${balanceEth} ETH depositados en el EntryPoint.`);
  console.log(`Umbral de alerta: ${THRESHOLD_ETH} ETH.`);

  if (isLow) {
    const text =
      `⚠️ PuntosPaymaster se está quedando sin gas.\n\n` +
      `Depósito actual: ${balanceEth} ETH\n` +
      `Umbral: ${THRESHOLD_ETH} ETH\n\n` +
      `Recárgalo con deposit() en el EntryPoint antes de que los pagos empiecen a fallar.`;
    console.error(text);
    await sendTelegramAlert(text);
    process.exit(1);
  }

  console.log("Todo bien, no hace falta recargar todavía.");
}

main().catch((err) => {
  console.error("No se pudo chequear el balance del paymaster:", err);
  process.exit(1);
});
