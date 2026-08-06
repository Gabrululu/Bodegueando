# Bodegueando

Proyecto realizado para ETH Lima Hack 2026 — bounty Advanced (Scaffold-Stylus + IA) del ecosistema Arbitrum.

Plataforma que digitaliza bodegas de barrio en Lima: cobros por QR, cashback/puntos de
lealtad, y "fiado inteligente" con un límite de crédito calculado on-chain a partir del
historial transaccional, ajustado por una capa de IA (Anthropic) que analiza patrones de pago.

## Arquitectura

```
bodegueando/
├── contracts/
│   ├── solidity/                 # Foundry — PaymentRouter, PuntosToken
│   └── stylus-fiado-scoring/     # Arbitrum Stylus (Rust) — FiadoScoring
└── frontend/                     # Next.js + Tailwind + wagmi/viem
```

- **PaymentRouter.sol / PuntosToken.sol** (Solidity/Foundry): reciben el pago de un
  cliente hacia una bodega, otorgan cashback en `PUNTOS` (ERC-20), y registran el pago
  en `FiadoScoring`.
- **FiadoScoring** (Rust/Stylus): mantiene un buffer acotado de los últimos pagos por
  bodega y calcula un score/límite de crédito heurístico (promedio móvil de pagos,
  frecuencia, penalización por mora) — el cómputo pesado que justifica usar Stylus en
  vez de Solidity puro. También expone `updateScoreFromAi` para que el módulo de IA
  del frontend pueda ajustar el score con una recomendación externa.
- **Frontend** (Next.js): conecta ambos contratos vía wagmi/viem. La ruta
  `app/api/fiado-score/route.ts` lee el historial on-chain de una bodega, llama a la
  API de Anthropic (Claude) para obtener una recomendación de score/límite, y la
  escribe de vuelta on-chain.

## Contratos desplegados (Arbitrum Sepolia)

| Contrato | Dirección | Arbiscan |
|---|---|---|
| **FiadoScoring** (Stylus/Rust) | `0xbB7b3951411B64ca284ca156d35E073F2a0Ac576` | [ver / verificado](https://sepolia.arbiscan.io/address/0xbB7b3951411B64ca284ca156d35E073F2a0Ac576) |
| **PuntosToken** | `0x2bd8AbEB2F5598f8477560C70c742aFfc22912de` | [ver código verificado](https://sepolia.arbiscan.io/address/0x2bd8AbEB2F5598f8477560C70c742aFfc22912de#code) |
| **PaymentRouter** | `0x7007508b1420e719D7a7A69B98765F60c7Aae759` | [ver código verificado](https://sepolia.arbiscan.io/address/0x7007508b1420e719D7a7A69B98765F60c7Aae759#code) |

`PuntosToken` y `PaymentRouter` están verificados con código fuente Solidity legible en
Arbiscan (`forge verify-contract`). `FiadoScoring` está verificado con
`cargo stylus verify` — no muestra código fuente como Etherscan, pero prueba que el
bytecode desplegado corresponde a un build reproducible de `src/lib.rs` dentro del
contenedor Docker oficial de cargo-stylus.

## Atajos conscientes de hackathon (documentados aquí, no escondidos)

- **eSol → ETH nativo de testnet.** `PaymentRouter.receivePayment` usa `msg.value`
  (ETH nativo de Arbitrum Sepolia) en vez de un token eSol con paridad PEN/USD, para no
  perder tiempo resolviendo un oráculo de precio durante la hackathon.
- **Oráculo de IA con clave en el servidor.** `app/api/fiado-score/route.ts` firma la
  transacción `updateScoreFromAi` con una clave privada de testnet guardada en
  `ORACLE_PRIVATE_KEY` (variable de entorno del servidor Next.js). En producción esto
  debería ser un servicio de firma dedicado, no una clave en el proceso del backend.
- **Passkey / Account Abstraction (ERC-4337)**: solo un stub (`components/PasskeyLogin.tsx`)
  con `TODO`s — el login real hoy es una wallet inyectada normal (wagmi `injected()`).
  Deprioritizado explícitamente para dejar el flujo de pagos y scoring demostrable primero.
- **WhatsApp (Twilio)**: solo un stub (`app/api/whatsapp/webhook/route.ts`), prioridad
  más baja del proyecto.

## Setup

### Prerequisitos

- Node.js + [pnpm](https://pnpm.io/)
- [Foundry](https://book.getfoundry.sh/getting-started/installation) (`forge`, `cast`)
- [Rust](https://rustup.rs/) + target `wasm32-unknown-unknown` + [cargo-stylus](https://github.com/OffchainLabs/cargo-stylus)

```bash
# Rust + wasm target
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
rustup target add wasm32-unknown-unknown
cargo install cargo-stylus

# Foundry
curl -L https://foundry.paradigm.xyz | bash
foundryup
```

### Instalar dependencias del monorepo

```bash
pnpm install
```

### Contratos Solidity

`contracts/solidity/lib/` (forge-std, OpenZeppelin) no está versionado — son dependencias de
terceros reproducibles, no código del proyecto. Instalarlas primero:

```bash
cd contracts/solidity
forge install foundry-rs/forge-std --no-git
forge install OpenZeppelin/openzeppelin-contracts --no-git
cd ../..
```

```bash
pnpm run contracts:build
pnpm run contracts:test
```

Deploy a Arbitrum Sepolia (requiere `contracts/solidity/.env` con `PRIVATE_KEY`,
`ARBITRUM_SEPOLIA_RPC_URL`, `FIADO_SCORING_ADDRESS` ya desplegado — ver abajo):

```bash
cd contracts/solidity
forge script script/Deploy.s.sol:Deploy --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
```

### Contrato Stylus (FiadoScoring)

```bash
pnpm run stylus:check
```

Deploy (requiere `contracts/stylus-fiado-scoring/.env` con `PRIVATE_KEY` y `RPC_URL`):

```bash
cd contracts/stylus-fiado-scoring
cargo stylus deploy --private-key-path=... --endpoint=https://sepolia-rollup.arbitrum.io/rpc
```

### Frontend

```bash
cp frontend/.env.example frontend/.env.local
# completar NEXT_PUBLIC_*_ADDRESS con las direcciones desplegadas,
# ANTHROPIC_API_KEY y ORACLE_PRIVATE_KEY (testnet)
pnpm run dev
```

## Regenerar ABIs para el frontend

```bash
forge inspect PaymentRouter abi --json > frontend/lib/abis/PaymentRouter.json   # envolver en {"abi": [...]}
forge inspect PuntosToken abi --json > frontend/lib/abis/PuntosToken.json      # envolver en {"abi": [...]}
cd contracts/stylus-fiado-scoring && cargo stylus export-abi --json   # copiar el array de salida a
                                                                       # ../../frontend/lib/abis/FiadoScoring.json,
                                                                       # envuelto en {"abi": [...]}
```

`cargo stylus export-abi` necesita `solc` en el `PATH` (Foundry lo descarga vía svm pero no lo
expone con ese nombre exacto):

```bash
ln -sf ~/.local/share/svm/0.8.26/solc-0.8.26 ~/.local/share/svm/0.8.26/solc
export PATH="$HOME/.local/share/svm/0.8.26:$PATH"
```

**Importante:** el macro `#[public]` de stylus-sdk convierte automáticamente los nombres de
función snake_case de Rust a camelCase al exportar el ABI de Solidity (p.ej. `record_payment` →
`recordPayment`). `contracts/solidity/src/interfaces/IFiadoScoring.sol` ya usa los nombres
camelCase correctos — si cambiás la API pública del contrato Rust, volvé a generar el ABI y
actualizá la interfaz Solidity para que coincidan.
