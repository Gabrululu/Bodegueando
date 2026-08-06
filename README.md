# Bodegueando
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
| **FiadoScoring** (Stylus/Rust) | `0x244CF96dDfa77c103B569EEe2Ff33f61641e3e5e` | [ver / verificado](https://sepolia.arbiscan.io/address/0x244CF96dDfa77c103B569EEe2Ff33f61641e3e5e) |
| **PuntosToken** | `0x2bd8AbEB2F5598f8477560C70c742aFfc22912de` | [ver código verificado](https://sepolia.arbiscan.io/address/0x2bd8AbEB2F5598f8477560C70c742aFfc22912de#code) |
| **PaymentRouter** | `0x7007508b1420e719D7a7A69B98765F60c7Aae759` | [ver código verificado](https://sepolia.arbiscan.io/address/0x7007508b1420e719D7a7A69B98765F60c7Aae759#code) |

`PuntosToken` y `PaymentRouter` están verificados con código fuente Solidity legible en
Arbiscan (`forge verify-contract`). `FiadoScoring` está verificado con
`cargo stylus verify` — no muestra código fuente como Etherscan, pero prueba que el
bytecode desplegado corresponde a un build reproducible de `src/lib.rs` dentro del
contenedor Docker oficial de cargo-stylus.

## Demo end-to-end

Dos vistas separadas, no una pantalla única que muestra u oculta secciones:

- **`BuyerPanel.tsx`** (comprador): buscar una bodega por su código, ver su fiado
  disponible si lo activó (solo lectura) y pagarle vía `PaymentRouter.receivePayment`.
- **`BodegaOwnerPanel.tsx`** (bodeguero): su propio código para compartir con
  clientes, el interruptor de fiado (`setFiadoEnabled`), y un botón para recalcular
  su fiado con IA (`/api/fiado-score`) — esto ya no lo puede disparar un comprador.

`app/page.tsx` detecta el rol solo: al conectar la wallet, lee
`PaymentRouter.isBodega(direcciónConectada)` y muestra el panel que corresponde,
sin preguntar nada. Hay un link chico "Ver como comprador / Ver como bodeguero" para
forzar la vista durante la demo sin necesitar dos wallets distintas.

**El fiado es opt-in por bodega, no automático.** En la vida real una bodega no
siempre fía — es decisión del dueño ("hoy no se fía, mañana sí"). `fiado_enabled`
en `FiadoScoring` arranca en `false` para todas las bodegas y solo la bodega misma
puede prenderlo (`setFiadoEnabled`, escrito por `msg.sender`, sin lista de permisos
aparte). El historial de pagos y el score se siguen calculando siempre — así una
bodega ya tiene track record el día que decide activarlo. Mientras está apagado, el
cliente no ve nada de fiado en la app, solo puede pagar.

Corrida real contra los contratos desplegados arriba (bodega de prueba, un pago de
0.0001 ETH registrado, fiado todavía sin activar):

| | Valor |
|---|---|
| `getScore` | 425 / 1000 (el historial se calculó igual) |
| `isFiadoEnabled` | `false` (nadie ve el panel de fiado hasta que la bodega lo prenda) |

Y el control de acceso del toggle, probado con `cast`: firmar `setFiadoEnabled(true)`
con una clave que no es la de esa bodega solo prende el flag *de esa otra cuenta*,
nunca el de la bodega que se está mirando — cada quien controla únicamente su propio
fiado.

La ruta de IA (`/api/fiado-score`, `claude-opus-5`, salida estructurada) y la escritura
on-chain vía `updateScoreFromAi` ya se probaron end-to-end en una corrida anterior:
Claude devolvió una recomendación más conservadora que la heurística ("*solo un pago
no es historial suficiente*") y quedó confirmada on-chain. Esa prueba corrió contra el
`FiadoScoring` anterior (antes de agregar el toggle de fiado); la mecánica es idéntica
en el contrato actual.

### El bot de Telegram como perfil (probado en vivo)

Ni la web ni el bot muestran nunca "ETH" ni una dirección `0x...` al bodeguero o al
comprador — todo se ve en soles, y la vinculación con Telegram se hace con un código
de 6 dígitos, no pegando una dirección en el chat.

**Vinculación:**
1. Desde `BodegaOwnerPanel.tsx` (o `BuyerPanel.tsx`, opcional para el comprador) se
   pide un código con "Generar mi código" → `POST /api/telegram/generate-code` guarda
   `{código → dirección}` en memoria (vence a los 10 minutos, un solo uso).
2. Un botón abre `t.me/<bot>` con `/vincular <código>` precargado.
3. `scripts/telegram-bot.mjs` (el daemon, corre aparte) recibe el mensaje y llama a
   `POST /api/telegram/consume-code`, que guarda `chat_id → dirección` en
   `frontend/.data/telegram-links.json`.
4. La web hace poll de `GET /api/telegram/status` hasta ver el link confirmado.

**Perfil por chat:** una vez vinculado, cualquiera —bodeguero o comprador— puede
escribirle `/perfil` al bot en cualquier momento, no solo recibir avisos push. El
daemon reenvía el pedido a `GET /api/telegram/profile?chatId=...`, que lee
`PaymentRouter.isBodega` para decidir el rol y arma la respuesta:

- **Bodega:** pagos recibidos, nivel de confianza y cuánto fiado ofrece (en soles).
- **Comprador:** puntos de cashback acumulados (convertidos a soles).

Para correr el bot en desarrollo (además de `pnpm run dev`, en otra terminal):

```bash
cd frontend
pnpm run bot
```

Corrida real de punta a punta contra los contratos desplegados arriba:

1. Código generado desde la web, vinculado con `/vincular <código>` en
   [@bodegueandobot](https://t.me/bodegueandobot).
2. `/perfil` respondió: *"🛍️ Tu cuenta en Bodegueando · Tienes S/ 0.30 en puntos
   acumulados por cashback."* — nunca un monto en ETH.
3. Pago real de 0.002 ETH, notificado como
   [tx `0x59afd6a7...`](https://sepolia.arbiscan.io/tx/0x59afd6a78efaf73276b055b8a371b10648e2b962052ab82ac7718153854712fb):
   mensaje de Telegram recibido al instante, ahora en soles (*"💰 Te pagaron S/ X.XX
   en Bodegueando."*).

## Atajos conscientes de hackathon

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
  más baja del proyecto. WhatsApp Business API requiere aprobación de permisos de
  Meta — por eso **Telegram se implementó primero**: mismo objetivo (avisar al
  bodeguero cuando le pagan), sin ese trámite, mucho más rápido de demostrar.
- **Vinculación de Telegram por polling, no webhook.** `scripts/telegram-bot.mjs`
  (el daemon del bot) usa `getUpdates` (long-polling) en vez de un webhook de
  Telegram, porque un webhook necesita una URL pública HTTPS y el server de
  desarrollo corre en localhost sin túnel. El mapeo chat_id ↔ dirección se guarda en
  `frontend/.data/telegram-links.json` (no versionado) — un archivo, no una base de
  datos, alcanza para la demo.
- **Tasa de cambio ETH → PEN de solo lectura, cacheada.** `lib/exchangeRate.ts` trae
  ETH/USD de CoinGecko y USD/PEN de open.er-api.com (ambas sin API key; se descartó
  frankfurter.app porque solo cubre monedas de referencia del BCE y no incluye
  soles), cachea el resultado ~5 minutos y cae a una tasa aproximada hardcodeada si
  alguna de las dos está caída — la demo no se puede romper por una API externa.
  No hay contrato de por medio: es puramente de display, para que nadie vea "ETH" en
  la app.

## Arquitectura completa / Roadmap

La idea de producto es que la blockchain sea invisible: el bodeguero y el cliente nunca
deberían ver "gas", "red", "dirección" ni "seed phrase" — todo se siente como una app de
pagos y puntos, pero por dentro lo crítico (saldo, puntos, fiado) vive on-chain. Lo que
sigue es la arquitectura completa a la que apunta el producto; la sección **MVP actual**
marca qué parte de esto ya está construido y probado en testnet.

### Capas del sistema

1. **Capa de usuario** — app PWA/web para bodeguero y cliente, login con celular +
   passkey (sin "conecta tu wallet"), QR de cobro en el local, avisos de pago por
   Telegram (implementado) y WhatsApp (roadmap, pendiente de aprobación de Meta).
2. **Abstracción de cuenta (ERC-4337)** — smart accounts por usuario creadas en el
   primer login, bundler + paymaster que patrocina el gas, passkey como llave principal
   con recuperación por teléfono/email/guardián. El usuario solo ve "saldo" y "puntos".
3. **Contratos on-chain (Arbitrum)** — el ledger de verdad, no una base de datos:
   - `PaymentRouter.sol` — procesa pagos, cashback y puntos.
   - `MerchantRegistry.sol` — registro y membresías de bodegas (self-service; hoy solo
     el owner puede registrar vía `registerBodega`).
   - `LoyaltyPoints.sol` — token de puntos (implementado como `PuntosToken`, ERC-20).
   - `CreditLineManager.sol` — líneas de fiado, límites y vencimientos (implementado
     como `FiadoScoring` en Stylus, con scoring on-chain **y** ajuste por IA — ya en
     producción en testnet, no es "próxima fase").
   - `InvoiceEscrow.sol` (opcional) — fiado con garantía parcial.
4. **Backend y servicios** — API que orquesta creación de smart account, llamadas a
   contratos, scoring y notificaciones; base de datos para perfil/catálogo/métricas y
   cache de saldos para que la UX se sienta instantánea; motor de riesgo off-chain
   como complemento al scoring on-chain.
5. **On/off ramps** — conversión eSol ↔ PEN bancarizado vía rampas locales. Para la
   hackathon queda simulado (eSol = ETH nativo de testnet, ver "Atajos" arriba), pero
   el punto de integración queda claro en el diseño.

```
[Cliente / Bodeguero]
       │
       ▼
[App PWA / Web] ←→ [Bot de Telegram] (WhatsApp: roadmap)
       │
       ▼
[Backend API + Bundler + Paymaster]
       │
       ▼
[Arbitrum Sepolia / One]
  - PaymentRouter
  - MerchantRegistry
  - LoyaltyPoints
  - CreditLineManager (FiadoScoring)
```

### MVP actual — qué está construido vs. roadmap

| Pieza | Estado |
|---|---|
| Pago QR → cashback → puntos (`PaymentRouter` + `PuntosToken`) | ✅ Desplegado y probado en Arbitrum Sepolia |
| Fiado con scoring on-chain (`FiadoScoring`, Stylus) | ✅ Desplegado y verificado |
| Fiado opt-in por bodega (`setFiadoEnabled`/`isFiadoEnabled`) | ✅ Desplegado — apagado por defecto, cada bodega prende el suyo |
| Ajuste de fiado con IA (Claude, en español, escribe on-chain) | ✅ Probado en vivo end-to-end |
| Dashboard web (leer score/límite, pagar, pedir recálculo IA) | ✅ Funcional |
| Vistas separadas bodeguero/comprador, detectadas por rol on-chain | ✅ Funcional (`isBodega` en `PaymentRouter`) |
| Avisos de pago y perfil (`/perfil`) por Telegram, todo en soles | ✅ Funcional — vinculación por código de 6 dígitos + daemon de polling, ver "El bot de Telegram como perfil" |
| Montos en soles (PEN) en vez de ETH, con tasa de cambio real | ✅ Funcional — conversión de display, ver "Atajos" |
| Registro self-service de bodegas (`MerchantRegistry`) | 🔜 Roadmap — hoy es owner-only |
| Login con passkey + smart accounts + paymaster (ERC-4337) | 🔜 Roadmap — el costo de integrar bundler/paymaster/AA es de días, no de horas; se prioriza demostrar el flujo de pagos + Stylus + IA con wallet normal |
| Notificaciones por WhatsApp | 🔜 Roadmap — stub existente; requiere aprobación de Meta, por eso Telegram salió primero |
| `InvoiceEscrow` (fiado con garantía) | 🔜 Roadmap, opcional |
| Rampas eSol ↔ PEN reales | 🔜 Roadmap — simulado con ETH de testnet |
| `ePEN` (token propio, redimible 1:1 por soles reales) | 🔜 Roadmap — hoy la app solo convierte el monto a soles para mostrarlo (ver "Atajos"); un `ePEN` real necesitaría un emisor regulado que respalde cada token con soles en custodia (como una stablecoin bancaria), que es un problema de compliance y de rampas fiat, no solo de contrato. Construir el contrato ERC-20 en sí es trivial; lo que falta es esa pieza, y no vale la pena simularla con una paridad falsa que parezca más sólida de lo que es |

### Flujo de demo objetivo (jurado)

1. Cliente escanea el QR de la bodega y paga.
2. Recibe confirmación y puntos de cashback al instante.
3. Se pide el recálculo de fiado — la IA analiza el historial on-chain y ajusta el
   límite, explicando por qué en español simple.
4. Todo es verificable en el explorador: contratos verificados, transacciones reales.

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
camelCase correctos — si cambias la API pública del contrato Rust, vuelve a generar el ABI y
actualiza la interfaz Solidity para que coincidan.
