#!/usr/bin/env bash
# Despliegue del stack en USDG sobre Arbitrum Sepolia, en el orden correcto:
#   1. Chequeos previos on-chain (red, dueños, saldo, y que FiadoScoring acepte los setters).
#   2. forge script DeployUsdgStack (solo contratos Solidity — forge no puede ejecutar Stylus).
#   3. cast send de setPaymentRouter / setEscrow en FiadoScoring (Stylus), y relectura on-chain.
#   4. Verificación en Arbiscan de cada contrato nuevo (si falla, no aborta: ya está desplegado).
#
# Uso (desde contracts/solidity, con .env que tenga PRIVATE_KEY, ARBITRUM_SEPOLIA_RPC_URL y
# ARBISCAN_API_KEY):
#   script/deploy-usdg-stack.sh            # simulación: no envía nada
#   script/deploy-usdg-stack.sh broadcast  # despliegue real
# PUNTOS_PER_ETH (precio ETH/USD × 1e18) se puede pasar por entorno; si no, se lee de CoinGecko.
set -euo pipefail

cd "$(dirname "$0")/.."
MODE="${1:-simulate}"
if [[ "$MODE" != "simulate" && "$MODE" != "broadcast" ]]; then
  echo "Uso: $0 [simulate|broadcast]" >&2
  exit 1
fi

set -a
# shellcheck disable=SC1091
source .env
set +a
: "${PRIVATE_KEY:?falta PRIVATE_KEY en .env}"
: "${ARBITRUM_SEPOLIA_RPC_URL:?falta ARBITRUM_SEPOLIA_RPC_URL en .env}"
RPC="$ARBITRUM_SEPOLIA_RPC_URL"

# Contratos que se reutilizan (ver ARCHITECTURE.md, "Deploying the USDG stack").
export FIADO_SCORING_ADDRESS=0x22FD7ED957b356dcF4a93574D24fC724736480B2
export PUNTOS_TOKEN_ADDRESS=0x2bd8AbEB2F5598f8477560C70c742aFfc22912de
export CREDIT_CERTIFICATE_ADDRESS=0xc42547586FbEfCA3D8EA189B1e87a2c234f67828
export REWARDS_CATALOG_ADDRESS=0x0c07b1b63aAbAD36d15877D80f10411534C44a2f
export BENEFICIO_TOKEN_ADDRESS=0x1ffbE40Ea1B050B1429cDE507a1A970e1AedF8Bc
export OLD_PAYMASTER_ADDRESS=0xa00d04374BBE8002c9F1CC55AA2F1CAA658a6403
export PAYMASTER_DEPOSIT_ETH="${PAYMASTER_DEPOSIT_ETH:-20000000000000000}" # 0.02 ETH
ENTRY_POINT=0x0000000071727De22E5E9d8BAf0edAc6f37da032

if [[ -z "${PUNTOS_PER_ETH:-}" ]]; then
  ETH_USD=$(curl -sf "https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd" \
    | python3 -c "import json,sys; print(int(json.load(sys.stdin)['ethereum']['usd']))")
  export PUNTOS_PER_ETH="${ETH_USD}000000000000000000"
fi

DEPLOYER=$(cast wallet address --private-key "$PRIVATE_KEY")
lower() { tr '[:upper:]' '[:lower:]' <<<"$1"; }
fail() { echo "✗ $*" >&2; exit 1; }

echo "== Chequeos previos"
[[ "$(cast chain-id --rpc-url "$RPC")" == "421614" ]] || fail "el RPC no es Arbitrum Sepolia"
echo "✓ Red: Arbitrum Sepolia"
echo "✓ Deployer: $DEPLOYER"
for pair in "FiadoScoring:$FIADO_SCORING_ADDRESS" "PuntosToken:$PUNTOS_TOKEN_ADDRESS" "PuntosPaymaster viejo:$OLD_PAYMASTER_ADDRESS"; do
  name="${pair%%:*}"; addr="${pair#*:}"
  owner=$(cast call "$addr" "owner()(address)" --rpc-url "$RPC")
  [[ "$(lower "$owner")" == "$(lower "$DEPLOYER")" ]] || fail "$name ($addr) es de $owner, no del deployer"
  echo "✓ Dueño de $name: deployer"
done
# eth_call corre en el nodo de Arbitrum (sí ejecuta Stylus): prueba que el deployer puede llamar
# los setters de FiadoScoring sin enviar nada.
cast call "$FIADO_SCORING_ADDRESS" "setPaymentRouter(address)" "$DEPLOYER" --from "$DEPLOYER" --rpc-url "$RPC" >/dev/null \
  || fail "FiadoScoring rechazaría setPaymentRouter del deployer"
cast call "$FIADO_SCORING_ADDRESS" "setEscrow(address)" "$DEPLOYER" --from "$DEPLOYER" --rpc-url "$RPC" >/dev/null \
  || fail "FiadoScoring rechazaría setEscrow del deployer"
echo "✓ FiadoScoring acepta setPaymentRouter / setEscrow del deployer (eth_call)"
BALANCE=$(cast balance "$DEPLOYER" --rpc-url "$RPC")
OLD_DEPOSIT=$(cast call "$ENTRY_POINT" "balanceOf(address)(uint256)" "$OLD_PAYMASTER_ADDRESS" --rpc-url "$RPC" | awk '{print $1}')
echo "✓ Saldo deployer: $(cast from-wei "$BALANCE") ETH (+ $(cast from-wei "$OLD_DEPOSIT") ETH a recuperar del paymaster viejo)"
echo "✓ PUNTOS_PER_ETH: $PUNTOS_PER_ETH  ·  depósito paymaster nuevo: $(cast from-wei "$PAYMASTER_DEPOSIT_ETH") ETH"

echo
echo "== Contratos Solidity ($MODE)"
FORGE_ARGS=(script script/DeployUsdgStack.s.sol:DeployUsdgStack --rpc-url arbitrum_sepolia -vv)
if [[ "$MODE" == "broadcast" ]]; then
  FORGE_ARGS+=(--broadcast --slow)
fi
forge "${FORGE_ARGS[@]}"

if [[ "$MODE" == "simulate" ]]; then
  echo
  echo "Simulación OK. Nada se envió. Paso siguiente en el despliegue real:"
  echo "  cast send $FIADO_SCORING_ADDRESS \"setPaymentRouter(address)\" <PaymentRouter nuevo>"
  echo "  cast send $FIADO_SCORING_ADDRESS \"setEscrow(address)\" <InvoiceEscrow nuevo>"
  exit 0
fi

RUN=broadcast/DeployUsdgStack.s.sol/421614/run-latest.json
addr_of() {
  python3 - "$RUN" "$1" <<'PY'
import json, sys
run, name = json.load(open(sys.argv[1])), sys.argv[2]
print(next(t["contractAddress"] for t in run["transactions"] if t.get("transactionType") == "CREATE" and t.get("contractName") == name))
PY
}
ROUTER=$(addr_of PaymentRouter)
PAYMASTER=$(addr_of PuntosPaymaster)
ESCROW=$(addr_of InvoiceEscrow)
GROUP_ORDERS=$(addr_of GroupOrders)
CREDIT_LINE=$(addr_of CreditLine)
DEPLOY_BLOCK=$(python3 -c "import json,sys; r=json.load(open('$RUN'))['receipts']; print(min(int(x['blockNumber'],16) for x in r))")

echo
echo "== FiadoScoring (Stylus) vía cast send"
cast send "$FIADO_SCORING_ADDRESS" "setPaymentRouter(address)" "$ROUTER" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" >/dev/null
cast send "$FIADO_SCORING_ADDRESS" "setEscrow(address)" "$ESCROW" --private-key "$PRIVATE_KEY" --rpc-url "$RPC" >/dev/null
[[ "$(lower "$(cast call "$FIADO_SCORING_ADDRESS" "paymentRouter()(address)" --rpc-url "$RPC")")" == "$(lower "$ROUTER")" ]] || fail "paymentRouter no quedó seteado"
[[ "$(lower "$(cast call "$FIADO_SCORING_ADDRESS" "escrow()(address)" --rpc-url "$RPC")")" == "$(lower "$ESCROW")" ]] || fail "escrow no quedó seteado"
echo "✓ FiadoScoring.paymentRouter = $ROUTER"
echo "✓ FiadoScoring.escrow        = $ESCROW"

echo
echo "== Verificación en Arbiscan (no bloqueante)"
for pair in "PaymentRouter:$ROUTER" "PuntosPaymaster:$PAYMASTER" "InvoiceEscrow:$ESCROW" "GroupOrders:$GROUP_ORDERS" "CreditLine:$CREDIT_LINE"; do
  name="${pair%%:*}"; addr="${pair#*:}"
  if forge verify-contract "$addr" "$name" --chain 421614 --rpc-url "$RPC" --guess-constructor-args --watch >/dev/null 2>&1; then
    echo "✓ $name verificado"
  else
    echo "⚠ $name no se pudo verificar ahora — reintentar: forge verify-contract $addr $name --chain 421614 --rpc-url \$ARBITRUM_SEPOLIA_RPC_URL --guess-constructor-args --watch"
  fi
done

echo
echo "== Variables para el frontend (Vercel)"
cat <<EOF
NEXT_PUBLIC_PAYMENT_ROUTER_ADDRESS=$ROUTER
NEXT_PUBLIC_PUNTOS_PAYMASTER_ADDRESS=$PAYMASTER
NEXT_PUBLIC_INVOICE_ESCROW_ADDRESS=$ESCROW
NEXT_PUBLIC_GROUP_ORDERS_ADDRESS=$GROUP_ORDERS
NEXT_PUBLIC_CREDIT_LINE_ADDRESS=$CREDIT_LINE
NEXT_PUBLIC_CONTRACTS_DEPLOY_BLOCK=$DEPLOY_BLOCK
EOF
