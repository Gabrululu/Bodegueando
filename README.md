# Bodegueando
Plataforma que digitaliza bodegas de barrio en Lima: cobros por QR, cashback/puntos de
lealtad, y "fiado inteligente" — un límite de crédito calculado on-chain a partir del
historial transaccional, ajustado por una capa de IA (Anthropic) que analiza patrones de pago,
y un libro de deuda real por cliente: cada bodega puede fiarle a un cliente específico y ese
cliente puede pagar su deuda de vuelta, todo verificable on-chain.

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
  en `FiadoScoring`. También expone `payFiado`, para que un cliente pague de vuelta una
  deuda de fiado (sin cashback, porque no es una compra nueva).
- **FiadoScoring** (Rust/Stylus): mantiene un buffer acotado de los últimos pagos por
  bodega y calcula un score/límite de crédito heurístico (promedio móvil de pagos,
  frecuencia, penalización por mora) — el cómputo pesado que justifica usar Stylus en
  vez de Solidity puro. También expone `updateScoreFromAi` para que el módulo de IA
  del frontend pueda ajustar el score con una recomendación externa, y un libro de
  deuda real por cliente (`extendFiado`/`repayFiado`) — ver "Fiado con libro de deuda
  real" más abajo.
- **Frontend** (Next.js): conecta ambos contratos vía wagmi/viem. La ruta
  `app/api/fiado-score/route.ts` lee el historial on-chain de una bodega, llama a la
  API de Anthropic (Claude) para obtener una recomendación de score/límite, y la
  escribe de vuelta on-chain.

## Contratos desplegados (Arbitrum Sepolia)

| Contrato | Dirección | Arbiscan |
|---|---|---|
| **FiadoScoring** (Stylus/Rust) | `0x9C6868b6c8521854e65C622a848A2C0C9873b6Df` | [ver / verificado](https://sepolia.arbiscan.io/address/0x9C6868b6c8521854e65C622a848A2C0C9873b6Df) |
| **PuntosToken** | `0x2bd8AbEB2F5598f8477560C70c742aFfc22912de` | [ver código verificado](https://sepolia.arbiscan.io/address/0x2bd8AbEB2F5598f8477560C70c742aFfc22912de#code) |
| **PaymentRouter** | `0x2e9F0b5Fd0f011B2e72950De9F4404F3295b76bd` | [ver código verificado](https://sepolia.arbiscan.io/address/0x2e9F0b5Fd0f011B2e72950De9F4404F3295b76bd#code) |
| **PuntosPaymaster** | `0x138572e9A1c858D2759e60f46586D36e974FBcEd` | [ver código verificado](https://sepolia.arbiscan.io/address/0x138572e9A1c858D2759e60f46586D36e974FBcEd#code) |
| **BeneficioToken** (PoC programas sociales) | `0x1ffbE40Ea1B050B1429cDE507a1A970e1AedF8Bc` | [ver código verificado](https://sepolia.arbiscan.io/address/0x1ffbE40Ea1B050B1429cDE507a1A970e1AedF8Bc#code) |

`FiadoScoring` y `PaymentRouter` fueron redesplegados el 2026-08-08 para incluir el ledger de
fiado (`extendFiado`/`repayFiado`/`payFiado`, ver más abajo). `PuntosToken` y `PuntosPaymaster`
no cambiaron — se reusaron tal cual (el minter de `PuntosToken` se re-vinculó al `PaymentRouter`
nuevo). El `aiOracle` del `FiadoScoring` nuevo se volvió a autorizar con la misma cuenta que
tenía el anterior.

`FiadoScoring` se redesplegó una segunda vez el mismo día para agregar el circuit breaker del
oráculo de IA (ver "Circuit breaker on-chain para el oráculo de IA" más abajo). Esta vez
`PaymentRouter` **no** cambió — solo se le pidió que apunte a la `FiadoScoring` nueva con
`setFiadoScoring` (función que ya existía, `onlyOwner`), sin redesplegarlo ni tocar su
verificación.

`BeneficioToken` se desplegó el 2026-08-08, apuntando al `PaymentRouter` existente como su
único `IBodegaRegistry` (no crea un segundo registro de bodegas). Su `owner` era originalmente
la cuenta deployer; ese mismo día se transfirió (`transferOwnership`) a la smart account de
quien opera los programas sociales desde su sesión logueada — ver "`BeneficioToken.sol`" más
abajo para el detalle de cómo se calculó esa dirección y el hash de la transacción.

`PaymentRouter` se redesplegó una tercera vez el mismo día para arreglar un bug real
descubierto en vivo: una bodega se queda sin PUNTOS para pagar gas después de su primera
transacción gratis (ver "Login sin wallet..." más abajo, sección "Bug real encontrado en
vivo"). `PuntosToken`, `FiadoScoring` y `PuntosPaymaster` no cambiaron en ese redeploy — se
reusaron tal cual, con el mismo relinkeo de minter que en el redeploy anterior.
`BeneficioToken.setBodegaRegistry` también necesita apuntar al `PaymentRouter` nuevo; como su
`owner` ya no es la cuenta deployer (ver arriba), esa actualización quedó como una acción de
un clic en el panel de administrador en vez de un `cast send` — solo quien tenga esa sesión la
puede autorizar.

`PuntosPaymaster` se redesplegó ese mismo día, aparte, por un segundo bug relacionado pero
distinto: `_postOp` marcaba una cuenta como "ya usó su transacción gratis" sin fijarse si esa
transacción había tenido éxito o revertido — así que el primer intento fallido de cualquiera
(no solo bodegas; cualquier comprador cuyo primer pago fallara por el motivo que sea) quemaba
igual el bootstrap y la dejaba sin PUNTOS para reintentar. Ver "Bug real encontrado en vivo"
en la misma sección de abajo para el detalle. Reusa el mismo `PuntosToken` de siempre; el
depósito de gas en el EntryPoint es nuevo (0.02 ETH), el del paymaster viejo queda huérfano.

`PuntosToken`, `PaymentRouter`, `PuntosPaymaster` y `BeneficioToken` están verificados con código fuente Solidity legible en
Arbiscan (`forge verify-contract`). `FiadoScoring` está verificado con
`cargo stylus verify` — no muestra código fuente como Etherscan, pero prueba que el
bytecode desplegado corresponde a un build reproducible de `src/lib.rs` dentro del
contenedor Docker oficial de cargo-stylus.

## Demo end-to-end

Dos vistas separadas, no una pantalla única que muestra u oculta secciones:

- **`BuyerPanel.tsx`** (comprador): buscar una bodega por su código, ver su fiado
  disponible si lo activó (solo lectura) y pagarle vía `PaymentRouter.receivePayment`.
  También muestra su propio código (para que una bodega le fíe a él) y, si tiene una
  deuda de fiado con la bodega que está mirando (`FiadoScoring.getFiadoDebt`), un
  botón para pagarla vía `PaymentRouter.payFiado`.
- **`BodegaOwnerPanel.tsx`** (bodeguero): su propio código para compartir con
  clientes, el interruptor de fiado (`setFiadoEnabled`), un botón para recalcular
  su fiado con IA (`/api/fiado-score`) — esto ya no lo puede disparar un comprador —
  y un formulario para fiarle a un cliente específico por su código
  (`FiadoScoring.extendFiado`), con la deuda total pendiente de cobro y el espacio
  disponible para seguir fiando.

`app/page.tsx` detecta el rol solo: después del login (ver "Login sin wallet" abajo), lee
`PaymentRouter.isBodega(direcciónDeLaSmartAccount)` y muestra el panel que corresponde. Por
defecto todos entran como comprador (fricción cero para pagar); un link chico "¿Tienes una
bodega? Regístrala aquí" dispara `registerSelf()` y recién ahí cambia al panel de bodeguero —
no hay una pantalla de elección forzada ni un selector manual, cada persona usa su propia
cuenta real (teléfono/correo).

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

### Fiado con libro de deuda real: `extendFiado` / `repayFiado` / `payFiado`

Hasta acá, `getCreditLimit` era solo un techo sugerido por bodega — nada registraba cuánto de
ese fiado ya se le había dado a un cliente en concreto, ni si lo había pagado de vuelta.
`FiadoScoring` ahora lleva ese libro de deuda real:

- **`extendFiado(cliente, monto)`** — la bodega (`msg.sender`, mismo patrón que
  `setFiadoEnabled`) le fía a un cliente específico. No mueve dinero: es la promesa de que el
  cliente se lleva algo ahora y paga después. Falla si el fiado está apagado para esa bodega o
  si supera el espacio disponible (`credit_limit - total_outstanding` de esa misma bodega).
- **`repayFiado(bodega, cliente, monto)`** — restringida a `payment_router`, igual que
  `recordPayment`, porque el ETH real ya se movió en `PaymentRouter.payFiado` antes de esta
  llamada. Si el cliente paga de más, el descuento se limita a la deuda pendiente (sin
  underflow ni revert).
- **`PaymentRouter.payFiado(bodega)`** — función `payable`: el comprador manda el ETH
  (equivalente a los soles que está pagando), se transfiere a la bodega igual que
  `receivePayment`, pero **no** otorga cashback (pagar una deuda no es una compra nueva) y
  llama a `repayFiado` en vez de `recordPayment`.
- **`getFiadoDebt(bodega, cliente)`**, **`getAvailableFiado(bodega)`**,
  **`getTotalOutstanding(bodega)`** — nuevas vistas que usa el frontend: `BodegaOwnerPanel`
  muestra cuánto fiado ya dio (pendiente de cobro) y cuánto espacio le queda, y le permite
  fiarle a un cliente por su código de 6 dígitos; `BuyerPanel` muestra su propio código (mismo
  sistema de `lib/bodegaCodes.ts`, ya genérico por dirección — no hizo falta construir uno
  nuevo) para dárselo a su bodega, y si tiene una deuda con la bodega que está mirando, puede
  pagarla ahí mismo.

Cubierto con tests unitarios en ambos contratos: `cargo test` (Rust, 6/6, incluyendo límite
excedido, fiado apagado, y que solo `payment_router` puede llamar `repayFiado`) y
`forge test` (Solidity, 17/17, incluyendo transferencia de fondos, ausencia de cashback, y
sobrepago).

**Redesplegado y verificado en Arbitrum Sepolia** (direcciones nuevas en la tabla de arriba):
`FiadoScoring` vía `cargo stylus deploy` + `cargo stylus verify --deployment-tx` (reproducible,
Docker), `PaymentRouter` vía `RedeployPaymentRouter.s.sol --verify` (reusa el `PuntosToken`
existente), reconectados con `setPaymentRouter` y con el `aiOracle` reautorizado en el contrato
nuevo. Nota para quien repita este deploy: `cargo stylus deploy --constructor-args` tiene
`allow_hyphen_values` activado en cargo-stylus 0.10.8, así que se traga cualquier flag que venga
después como si fuera otro argumento del constructor — `--constructor-args` tiene que ir **al
final** del comando.

**Corrida real de punta a punta contra los contratos nuevos** (dos cuentas reales, no
simuladas: la bodega de prueba de siempre y una wallet de cliente descartable recién creada
para esta corrida):

1. El cliente le paga a la bodega el equivalente a 0.0002 ETH vía `receivePayment`
   ([tx `0x518765...`](https://sepolia.arbiscan.io/tx/0x518765873e416fe33fb92c34d49298e6c1c1f65b2f4f68c182c767d8d63f656d)) —
   recibe cashback en `PUNTOS` automáticamente (`4e12` wei, exactamente 2% = `cashbackBps`
   por defecto).
2. La bodega activa fiado (`setFiadoEnabled(true)`) y, con el historial ya acumulado
   (`getScore` = 702, `getCreditLimit` ≈ 0.0004212 ETH), le fía al cliente el 40% de su
   límite disponible: `extendFiado(cliente, 0.00016848 ETH)`
   ([tx `0xaff74d...`](https://sepolia.arbiscan.io/tx/0xaff74d8dc46c8f0ee58a9aaec74399694210a091801831e2d2560151ac0c92b5)).
   `getFiadoDebt(bodega, cliente)` pasa de `0` a `168480000000000` wei on-chain.
3. El cliente paga una parte de su deuda con `payFiado`
   ([tx `0xf889c9...`](https://sepolia.arbiscan.io/tx/0xf889c985d7c7ce0b0cf19ecdc1761f37a2b2bbb15d631e28b97a43f4d551300a)):
   la deuda baja de `168480000000000` a `68480000000000` wei — el descuento parcial funciona
   igual en vivo que en los tests.
4. El cliente paga el resto con un segundo `payFiado`
   ([tx `0xbc496a...`](https://sepolia.arbiscan.io/tx/0xbc496afbfc85eca5641513c074adc98051dd56567f056ed2ad00ebb67b1edb40)):
   `getFiadoDebt` vuelve a `0`, `getTotalOutstanding` vuelve a `0`, y
   `getAvailableFiado` vuelve al límite completo (`421200000000000` wei) — el espacio de
   crédito se libera exactamente como debería.

El sobrepago y el control de acceso de `repayFiado` (solo `payment_router`) ya están cubiertos
por los tests locales, así que esta corrida se enfocó en probar el camino feliz completo con
ETH real moviéndose entre dos cuentas distintas en Arbitrum Sepolia.

### Circuit breaker on-chain para el oráculo de IA (probado en vivo)

`app/api/fiado-score/route.ts` firma `updateScoreFromAi` con `ORACLE_PRIVATE_KEY`, una clave
que vive como variable de entorno en el mismo proceso que sirve la web (ver "Atajos
conscientes de hackathon" más abajo — es un atajo de hackathon documentado, no una elección de
producción). Si esa clave se filtra, antes no había ningún límite: quien la tuviera podía
fijarle a cualquier bodega un límite de fiado inventado, sin ningún historial real detrás.

`FiadoScoring` ahora acota lo que el oráculo puede escribir: el límite que proponga puede ser
como máximo el doble de lo que el propio heurístico on-chain (el mismo que corre en cada
`record_payment`) calcularía para esa bodega en este momento. Bajar el límite (ser más
conservador que el heurístico) sigue sin tope, porque nunca es un riesgo. La matemática del
heurístico se extrajo a `heuristic_score_and_limit`, una función pura que tanto
`recompute_heuristic` (la que ya corría en cada pago) como `update_score_from_ai` (la
validación nueva) comparten — no hay dos cálculos que puedan desincronizarse.

Cubierto con 3 tests nuevos/actualizados en `cargo test` (8/8 en total): que un límite dentro
del 2× se acepta, que uno muy por encima revierte con `AiLimitOutOfRange`, y que bajar el
límite sigue siendo libre sin importar el heurístico.

**Corrida real en Arbitrum Sepolia** contra la `FiadoScoring` redesplegada
(`0x9C6868b6c8521854e65C622a848A2C0C9873b6Df`):

1. Con una bodega sin ningún historial en el contrato nuevo, se intentó
   `updateScoreFromAi(bodega, 900, 100 ETH)` con la cuenta oracle — revirtió on-chain
   (`AiLimitOutOfRange`, selector `0x482f64d6`). Ni con la clave del oráculo se puede inventar
   crédito de la nada.
2. Un cliente le pagó 0.0002 ETH a la bodega (mismo patrón de siempre), dejando un
   `heuristic_limit` real de `255000000000000` wei.
3. `updateScoreFromAi(bodega, 800, 1.5×heuristic_limit)` — aceptado, `getCreditLimit` pasó a
   `382500000000000` wei.
4. `updateScoreFromAi(bodega, 900, 3×heuristic_limit)` sobre la misma bodega, ahora con
   historial real detrás — igual revirtió con el mismo selector. El tope escala con el
   historial real, nunca lo ignora.

### `BeneficioToken.sol` — PoC de programas sociales on-chain (Vaso de Leche, Qali Warma, Pensión 65)

A diferencia de `PuntosToken` (libre, transferible entre cualquiera), `BeneficioToken` es un
ERC-20 restringido: un beneficiario solo puede gastarlo transfiriéndolo a una bodega ya
registrada en `PaymentRouter` (nunca revenderlo a otra persona ni cambiarlo por efectivo), y
cada emisión vence a los `duration` segundos de emitida. La restricción vive en `_update`, el
hook que ERC20 llama en *toda* transferencia (incluida `transferFrom`) — no hay forma de
saltársela usando otra función del token.

- **`issue(beneficiario, monto, duración)`** — solo el `owner` (en una integración real, la
  municipalidad o el ministerio correspondiente) puede emitir beneficio.
- **`transfer`/`transferFrom` normal** — funciona como "redimir": si el destino no es una
  bodega registrada (`IBodegaRegistry.isBodega`, la misma fuente de verdad que ya usa
  `PaymentRouter` — no hay un segundo registro que pueda desincronizarse) o si el beneficio del
  emisor ya venció, revierte (`NotABodega` / `BenefitExpired`).

**Qué NO resuelve esta PoC, a propósito:** no restringe la categoría del gasto ("solo
alimentos") porque la app no tiene catálogo de productos — construirlo sería un proyecto
aparte, no algo que este contrato pueda simular honestamente. Tampoco reclama solo el saldo
vencido de vuelta al programa (necesitaría un keeper on-chain); el beneficio vencido
simplemente deja de poder gastarse, se queda congelado en la wallet.

Cubierto con 9 tests en `forge test` (26/26 en todo el repo, sin romper nada existente):
emisión solo por el owner, vencimiento, gasto válido a una bodega registrada, el intento de
revender a otra persona (el caso que justifica todo el contrato) revierte, y que
`transferFrom` (aprobar a un tercero) queda sujeto a las mismas reglas que `transfer` directo.

**Desplegado y verificado en Arbitrum Sepolia**, con una UI mínima de emisión conectada al
mismo panel que ya usa cualquier bodega (`BodegaOwnerPanel.tsx`) — no un dashboard aparte:

- **Quién puede emitir, de verdad, no solo en la UI.** `issue()` es `onlyOwner` — eso ya se
  hacía cumplir on-chain desde el diseño original. Lo nuevo es que el panel ahora *lee* ese
  mismo `owner()` (`useReadContract`, sin variable de entorno separada que pudiera
  desincronizarse del contrato) y solo muestra la sección "Panel de administrador — Beneficios
  sociales" a la cuenta que matchea. Nadie más la ve, y aunque alguien manipulara el frontend
  para forzarla a aparecer, la llamada a `issue()` igual revertiría on-chain para cualquier
  otra cuenta.
- **Ya transferido a una sesión real logueada por Privy.** El `owner` original era la cuenta
  EOA deployer de siempre, y Privy genera una *smart account nueva* por cada login — no existe
  una forma de "iniciar sesión como" una clave privada externa preexistente a través del flujo
  normal de la app. La dirección de smart account no se ve en ningún dashboard (ni el de Privy,
  que solo muestra la wallet embebida que la *firma*, una dirección distinta); se calculó
  reproduciendo el mismo `toSimpleSmartAccount` que usa `lib/smartAccount.ts` para esa wallet
  embebida, y se confirmó cruzándola contra el registro real de vinculación de Telegram de esa
  cuenta antes de transferir. `transferOwnership` ya se ejecutó
  ([ver tx](https://sepolia.arbiscan.io/tx/0x5da2963d3cdf964f1041e9fc53e38474b4ae74d4cacf7675d394e2824182bc10)) —
  `owner()` ahora devuelve `0x3fBB9a2725aC676540Ce38567E2F62b39FC323fF`, así que quien tenga
  esa sesión ya ve "Panel de administrador — Beneficios sociales" al loguearse normal, sin
  pasos extra.
- **Por qué esto no toca el fiado.** `extendFiado`/`setFiadoEnabled` siguen siendo
  deliberadamente self-service y `msg.sender`-keyed — cada bodega controla únicamente su
  propio fiado, sin lista de permisos aparte (ver "Fiado con libro de deuda real" más arriba).
  Sumarle una capa de "solo un Admin" ahí revertiría esa decisión ya probada en vivo, así que
  el nuevo panel de administrador es aditivo (vive en la misma pantalla que ya tiene fiado,
  como una sección extra que solo un `owner` ve) en vez de restrictivo sobre algo que ya
  funcionaba.

**UI de canje, del lado del beneficiario (`BuyerPanel.tsx`).** Ya no hace falta salir de la
app para gastar el beneficio como una transferencia ERC-20 genérica: en cuanto el cliente
tiene saldo de `BeneficioToken` (`balanceOf > 0`), ve una tarjeta aparte —separada del pago en
efectivo, nunca mezclada con el botón "Pagar" normal— con su saldo y fecha de vencimiento. El
pago mismo (`transfer(bodega, monto)`) se habilita recién cuando también escribió el código de
una bodega, reusando el mismo buscador de código que ya usa para pagar en efectivo o pagar su
fiado. No se pre-valida el vencimiento en el frontend — si el beneficio ya venció, el intento
de pago revierte on-chain (`BenefitExpired`, ver `_update` en `BeneficioToken.sol`) y se
muestra un error genérico; la fuente de verdad sigue siendo el contrato, no un cálculo de
fecha en el cliente.

**Qué sigue faltando:** UI de "canjear" ya construida (ver arriba) — no queda ningún pendiente
de `BeneficioToken` en sí. Lo que sigue es roadmap fuera de este contrato (eSol, InvoiceEscrow,
ver "MVP actual" más abajo).

### El bot de Telegram como perfil (probado en vivo)

Ni la web ni el bot muestran nunca "ETH" ni una dirección `0x...` al bodeguero o al
comprador — todo se ve en soles, y la vinculación con Telegram se hace con un código
de 6 dígitos, no pegando una dirección en el chat.

**Webhook en producción, no polling — Vercel no puede correr un daemon.** La primera versión
de esto usaba `scripts/telegram-bot.mjs`, un proceso Node aparte haciendo `getUpdates`
(long-polling) sin parar. Eso funciona en una laptop con una terminal abierta, pero **no
puede funcionar en Vercel**: cada función serverless responde una vez y se apaga, no hay forma
de dejar un proceso escuchando para siempre. Con ese diseño, cualquier mensaje mandado al bot
mientras la app estaba en producción se quedaba sin procesar en la cola de Telegram — se
confirmó así al revisar `getWebhookInfo`/`getUpdates` directo contra la API de Telegram.

La solución es que Telegram llame a una URL nuestra en vez de que nosotros le preguntemos todo
el rato — un webhook, que sí encaja con el modelo de Vercel (una función que responde a un
solo POST). `app/api/telegram/webhook/route.ts` cumple ese rol; la lógica de negocio (que
antes vivía repartida entre el daemon y las rutas que llamaba) se movió a
`lib/telegramCommands.ts` (despacho de `/start`, `/vincular`, `/perfil`) y
`lib/telegramProfile.ts` (armado del texto de `/perfil`), para que el webhook y `GET
/api/telegram/profile` (que sigue existiendo para el daemon de desarrollo) compartan el mismo
código en vez de duplicarlo. El header `X-Telegram-Bot-Api-Secret-Token` (comparado contra
`TELEGRAM_WEBHOOK_SECRET`) rechaza pedidos que no vengan realmente de Telegram.

**Vinculación:**
1. Desde `BodegaOwnerPanel.tsx` (o `BuyerPanel.tsx`, opcional para el comprador) se
   pide un código con "Generar mi código" → `POST /api/telegram/generate-code` guarda
   `{código → dirección}` en memoria (vence a los 10 minutos, un solo uso).
2. Un botón abre `t.me/<bot>?start=<código>`. Se usa el mecanismo de `/start` con payload,
   *no* `?text=/vincular <código>` — probado en vivo que ese segundo formato es poco confiable:
   como `/vincular` ya está registrado como comando del bot, el cliente de Telegram a veces lo
   reconoce y lo manda solo, cortando el código antes de que el usuario pueda completarlo.
   `?start=` es el mecanismo que Telegram diseñó exactamente para este caso (deep link con un
   parámetro) y siempre llega completo.
3. El webhook recibe `/start <código>` y llama a la misma lógica que `/vincular <código>`,
   que guarda `chat_id → dirección` vía `lib/kv.ts` (Upstash Redis en producción,
   `frontend/.data/telegram-links.json` en desarrollo local — ver "Storage: Upstash Redis en
   producción" más abajo).
4. La web hace poll de `GET /api/telegram/status` hasta ver el link confirmado.

**Perfil por chat:** una vez vinculado, cualquiera —bodeguero o comprador— puede
escribirle `/perfil` al bot en cualquier momento, no solo recibir avisos push. Lee
`PaymentRouter.isBodega` para decidir el rol y arma la respuesta:

- **Bodega:** pagos recibidos, nivel de confianza y cuánto fiado ofrece (en soles).
- **Comprador:** puntos de cashback acumulados (convertidos a soles).

**Registrar el webhook** (una sola vez, después de desplegar el código de
`app/api/telegram/webhook`):

```bash
curl -X POST "https://api.telegram.org/bot<TELEGRAM_BOT_TOKEN>/setWebhook" \
  -H "Content-Type: application/json" \
  -d '{"url": "https://<tu-dominio>/api/telegram/webhook", "secret_token": "<TELEGRAM_WEBHOOK_SECRET>"}'
```

**Desarrollo local:** sin una URL pública HTTPS, Telegram no puede llamar al webhook, así que
en local se sigue usando el daemon de polling (`scripts/telegram-bot.mjs`, sin secreto, sin
webhook), corriendo aparte de `pnpm run dev`:

```bash
cd frontend
pnpm run bot
```

**Lista de comandos para @BotFather** (`/setcommands` → elegir el bot → pegar tal cual):

```
start - Ver cómo vincular tu cuenta de Bodegueando
vincular - Vincular tu cuenta con tu código de 6 dígitos (ej. /vincular 123456)
perfil - Ver tus pagos, puntos o fiado
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

### Storage: Upstash Redis en producción, archivo local en desarrollo

El filesystem de Vercel es efímero por invocación — dos requests al mismo endpoint pueden
correr en instancias serverless distintas que nunca vieron lo que la otra escribió. Con la app
ya desplegada en `bodegueando.vercel.app`, los dos stores que antes eran solo un JSON en
`frontend/.data/` (`getOrCreateCode`/`resolveCode` de códigos de bodega/cliente, y el mapeo
`chat_id ↔ dirección` de Telegram) corrían un riesgo real de comportarse de forma
inconsistente en producción — no un problema teórico, sino algo que ya podía estar pasando.

`lib/kv.ts` resuelve esto con dos backends detrás de la misma interfaz
(`readJsonStore`/`writeJsonStore`):

- **Con `UPSTASH_REDIS_REST_URL` y `UPSTASH_REDIS_REST_TOKEN` seteadas** (cuenta gratis en
  [console.upstash.com](https://console.upstash.com)): usa Redis real vía REST — funciona
  igual desde cualquier función serverless, sin necesidad de una conexión persistente.
- **Sin esas variables**: cae de vuelta al archivo JSON de siempre bajo `.data/` — cero
  fricción para seguir desarrollando en local sin crear una cuenta de Upstash.

`lib/bodegaCodes.ts` y `lib/telegram.ts` se refactorizaron para usar esta abstracción (sus
funciones pasaron de sync a `async`); las rutas API que las llaman ya eran `async`, así que
solo hizo falta agregar los `await` correspondientes. Verificado localmente: el
round-trip completo (generar código → resolverlo) sigue funcionando igual por el camino de
fallback a archivo, sin credenciales de Upstash configuradas.

### Login sin wallet + registro self-service + gas pagado con PUNTOS (probado en vivo)

La meta del producto es que nadie tenga que saber qué es una wallet. Esto ya funciona de
punta a punta:

- **Login (`components/Login.tsx`, Privy):** entras con tu teléfono o correo (código OTP),
  nunca con "conecta tu wallet". Privy crea una wallet embebida en el primer login, invisible
  para el usuario — solo ve su correo/teléfono en pantalla.
- **Registro self-service de bodegas (`PaymentRouter.registerSelf`):** cualquiera puede
  registrarse como bodega desde la web, sin que un admin lo apruebe (ver "Análisis" en el
  código del contrato: `isBodega` solo decide quién puede *recibir* un pago que el comprador
  ya eligió mandar — no hay nada que abusar).
- **Gas pagado con PUNTOS, no con ETH (`PuntosPaymaster.sol`, ERC-4337):** cada persona tiene
  una *smart account* (no una wallet normal) cuya llave es la wallet embebida de Privy. La
  primera transacción de cada cuenta la patrocina la app gratis (bootstrap); de ahí en
  adelante, el gas de cada transacción se cobra directamente en PUNTOS del propio saldo del
  usuario — sin oráculo de precio, porque PUNTOS ya está denominado en la misma unidad que el
  ETH del pago original (`cashback = monto × cashbackBps`, en wei). El usuario nunca ve "gas"
  ni firma un popup de MetaMask; solo ve un botón que dice "Registrar" o "Pagar".

**Bug real encontrado en vivo: una bodega se quedaba sin forma de pagar gas después de su
primera transacción.** El cashback en PUNTOS solo lo mintea `receivePayment` a quien *paga*
(`msg.sender`), nunca a la bodega que cobra — así que una cuenta que solo actúa como bodega
(nunca compra nada en otro lado) nunca junta PUNTOS por su cuenta. Su única transacción
gratuita es `registerSelf()` (el bootstrap); la siguiente — `setFiadoEnabled`, `extendFiado`,
cualquier acción de bodega — pasa por `PuntosPaymaster._validatePaymasterUserOp`, que exige
`balanceOf(cuenta) >= maxCost` y revierte con `InsufficientPuntosBalance` si no hay saldo. Con
0 PUNTOS, *cualquier* bodega quedaba permanentemente bloqueada apenas un paso después de
registrarse — confirmado leyendo `hasBootstrapped`/`balanceOf` directo on-chain contra una
cuenta real que reportó justo ese síntoma ("No se pudo guardar. Intenta de nuevo." al intentar
activar fiado).

**Fix:** `registerSelf()` (y `registerBodega`) ahora mintean `BODEGA_BOOTSTRAP_PUNTOS`
(0.005 ETH-equivalente, ~decenas de transacciones futuras) al momento del registro — el
mismo mecanismo que ya existía para compradores (ganar PUNTOS de su acción calificante),
aplicado a la acción calificante de una bodega. Probado end-to-end con una cuenta nueva
(`registerSelf` con el `approve` de PUNTOS incluido en el mismo bootstrap, igual que hace
`sendAndWait`, seguido de un `setFiadoEnabled` real pagado en PUNTOS desde el saldo de
bienvenida) antes de dar el fix por confirmado, no solo por los tests unitarios — ver
`test_RegisterSelf_MintsBootstrapPuntos` / `test_RegisterBodega_MintsBootstrapPuntos` en
`test/PaymentRouter.t.sol` para la cobertura unitaria.

**Segundo bug relacionado, en `PuntosPaymaster._postOp`: el bootstrap se quemaba aunque la
transacción hubiera fallado.** El primer parámetro de `_postOp` es un `PostOpMode`
(`opSucceeded` / `opReverted` / `postOpReverted`) que dice si la llamada de la cuenta salió
bien o no — el contrato original lo recibía sin siquiera nombrarlo, ignorándolo por completo,
y marcaba `hasBootstrapped[cuenta] = true` sin importar el resultado. Esto significa que el
*primer* intento fallido de cualquiera (una bodega con un código mal escrito, un comprador que
se equivocó de monto, cualquier revert dentro del contrato) igual consumía la única
transacción gratis — dejando a esa cuenta con 0 PUNTOS y sin ninguna forma de pagar la
siguiente. No es un bug exclusivo de bodegas: afecta a cualquier cuenta cuya primera
transacción patrocinada haya revertido, por el motivo que sea.

**Fix:** `_postOp` ahora solo marca el bootstrap como usado cuando `mode == PostOpMode.opSucceeded`.
Un primer intento que revierte no cuenta — la cuenta sigue teniendo su transacción gratis
disponible para cuando lo intente de nuevo (correctamente esta vez). Cubierto por
`test_FailedFirstUserOp_DoesNotBurnBootstrap` en `test/PuntosPaymaster.t.sol`: valida
`postOp` con `PostOpMode.opReverted` directo, confirma que `hasBootstrapped` sigue en `false`,
y que la cuenta todavía puede tener un primer `opSucceeded` gratis después. Verificado también
en vivo contra el paymaster redesplegado, con una cuenta real haciendo su primera transacción
exitosa y confirmando que `hasBootstrapped` pasa a `true` recién ahí. Como el mapeo
`hasBootstrapped` vive en el contrato del paymaster, redesplegarlo también "desatascó" de
paso a cualquier cuenta que ya hubiera quedado atrapada por este bug con el paymaster
anterior — sin necesitar identificarlas una por una.

Corrida real de punta a punta contra los contratos desplegados arriba (script standalone con
`permissionless.js` + el bundler de Pimlico, sin pasar por el navegador, para aislar la
infraestructura antes de probarla con Privy real):

1. Smart account nueva (owner: una wallet local descartable) manda `registerSelf()` como su
   primera UserOperation.
2. `PuntosPaymaster` la patrocina gratis (evento `FreeBootstrapUsed` emitido) — el usuario no
   pagó nada de gas.
3. `PaymentRouter` emite `BodegaRegistered` y `isBodega(smartAccount)` pasa a `true` on-chain.

Después de esto se repitió el flujo completo en el navegador con un login real de Privy:
entrar por teléfono/correo → elegir explícitamente "Soy bodeguero" (dispara `registerSelf()`,
sin popup de wallet, se siente instantáneo) → pasar a la vista de bodeguero, con un QR nuevo
para cobrar (ver siguiente sección) — confirmado en vivo.

### Bodeguero y cliente son dos espacios separados, nunca combinados

`app/app/page.tsx` no infiere el rol combinándolo con la vista del otro: una cuenta ya
registrada como bodega (`isBodega` on-chain) va **directo** a `BodegaOwnerPanel`, sin
posibilidad de ver `BuyerPanel` en la misma sesión. Una cuenta nueva ve una elección explícita
antes de cualquier panel — "Soy bodeguero" / "Soy cliente" — en vez del diseño anterior, donde
cualquiera que entraba caía primero en la vista de comprador con un link de "¿Tienes una
bodega? Regístrala aquí" flotando dentro de esa misma pantalla (los dos espacios mezclados en
una sola vista). "Soy bodeguero" dispara `registerSelf()` igual que antes; "Soy cliente" solo
guarda la elección (`localStorage`, por dirección) para no volver a preguntar en próximas
visitas — nunca se asume sola. El QR de bodega (`/pagar/[code]`, ver abajo) sigue sin pasar por
ningún selector: escanear un QR ya es una intención de cliente inequívoca.

**El mismo principio dentro de `BuyerPanel.tsx`: no ofrecer una acción hasta confirmar el rol
del código escrito.** El campo "Código de la bodega" resuelve contra el mismo store que los
códigos de cliente (`lib/bodegaCodes.ts` no distingue quién generó cada código) — así que
antes de este fix, escribir por error el código propio (el de "Tu código para que te fíen")
en ese campo dejaba ver y usar "Pagar en la bodega" igual, y el pago recién revertía on-chain
al mandarlo, con un error genérico sin explicar por qué. Se agregó una lectura de
`isBodega(dirección resuelta)` y toda la UI de pago (efectivo, fiado, beneficio social) queda
oculta hasta que el código resuelto sea, de verdad, una bodega registrada — si no lo es, se
avisa explícito ("Ese código no corresponde a una bodega") en vez de dejar intentar un pago
que va a fallar.

### Código de la bodega: QR + número corto, nunca una dirección (probado en vivo)

`BodegaOwnerPanel.tsx` ya no muestra una dirección `0x...` para que el cliente la copie —
genera un código permanente de 6 dígitos (`lib/bodegaCodes.ts`, vía `lib/kv.ts`, sin expirar —
a diferencia del código de Telegram, este tiene que seguir funcionando meses después, impreso
en un cartel) y lo muestra como QR
(`qrcode.react`) que codifica `https://<dominio>/pagar/<código>`.

El cliente escanea con la cámara nativa del celular (sin librería de escaneo: la URL abre
directo `app/pagar/[code]/page.tsx`, que resuelve el código server-side y precarga
`BuyerPanel`) o escribe el código a mano como respaldo. Ninguno de los dos paneles muestra un
`0x...` en ningún lado.

## Atajos conscientes de hackathon

- **eSol → ETH nativo de testnet.** `PaymentRouter.receivePayment` usa `msg.value`
  (ETH nativo de Arbitrum Sepolia) en vez de un token eSol con paridad PEN/USD, para no
  perder tiempo resolviendo un oráculo de precio durante la hackathon.
- **Oráculo de IA con clave en el servidor.** `app/api/fiado-score/route.ts` firma la
  transacción `updateScoreFromAi` con una clave privada de testnet guardada en
  `ORACLE_PRIVATE_KEY` (variable de entorno del servidor Next.js). En producción esto
  debería ser un servicio de firma dedicado, no una clave en el proceso del backend — eso
  sigue siendo cierto hoy. Lo que sí se agregó fue un límite al daño que esa clave puede hacer
  si se filtra: `FiadoScoring.update_score_from_ai` ahora rechaza cualquier límite que el
  oráculo proponga por encima del doble de lo que el heurístico on-chain ya justificaría con
  el historial real — ver "Circuit breaker on-chain para el oráculo de IA". No reemplaza mover
  la clave a un servicio aparte, pero acota el impacto mientras tanto.
- **`SimpleAccount` (referencia de eth-infinitism), no Safe ni Kernel.** Es la implementación
  que usa la guía oficial de Pimlico para signers de Privy — menor superficie de riesgo que
  evaluar otra librería de smart accounts contra el reloj de la hackathon.
- **Pimlico solo como bundler, paymaster propio.** `PuntosPaymaster.sol` es un contrato
  nuestro (no el paymaster ERC-20 hosteado de Pimlico) porque PUNTOS es un token propio sin
  precio de mercado — Pimlico solo transmite las UserOperations al EntryPoint, toda la lógica
  de "gratis la primera vez, después se cobra en PUNTOS" vive en nuestro contrato.
- **El depósito de gas del paymaster se repone a mano.** `PuntosPaymaster` necesita ETH real
  depositado en el EntryPoint para poder patrocinar transacciones (`deposit()` / `cast send`);
  no hay una ruta automática que lo recargue sola — es responsabilidad de quien opera la app,
  documentado así a propósito en vez de simular una automatización que no existe. Lo que sí
  hay es una alerta: `pnpm run check-paymaster-balance` (`scripts/check-paymaster-balance.mjs`)
  lee el depósito real del EntryPoint y manda un aviso por Telegram a `TELEGRAM_ADMIN_CHAT_ID`
  si cae bajo `PAYMASTER_BALANCE_ALERT_THRESHOLD_ETH` (default `0.01` ETH) — para correr a
  mano o desde un cron/CI. Sigue siendo *alerta*, no auto-repuesto: alguien sigue decidiendo
  cuándo recargar, solo que ahora se entera a tiempo.
- **El QR de la bodega necesita una URL real, no localhost.** `app/pagar/[code]/page.tsx` solo
  se puede escanear con la cámara del celular si la app está desplegada (Vercel u otro) —
  en `localhost` sigue funcionando el código de 6 dígitos escrito a mano.
- **WhatsApp (Twilio)**: solo un stub (`app/api/whatsapp/webhook/route.ts`), prioridad
  más baja del proyecto. WhatsApp Business API requiere aprobación de permisos de
  Meta — por eso **Telegram se implementó primero**: mismo objetivo (avisar al
  bodeguero cuando le pagan), sin ese trámite, mucho más rápido de demostrar.
- **Telegram: webhook en producción, polling solo en desarrollo local.**
  `app/api/telegram/webhook/route.ts` es lo que corre de verdad contra Vercel — un daemon de
  polling (`getUpdates` sin parar) no puede correr ahí, cada función serverless responde una
  vez y se apaga. `scripts/telegram-bot.mjs` se mantiene solo para desarrollo local, donde no
  hay una URL pública HTTPS para que Telegram le pegue a un webhook. El mapeo chat_id ↔
  dirección se guarda vía `lib/kv.ts` — ver "Storage: Upstash Redis en producción".
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

1. **Capa de usuario** — app PWA/web para bodeguero y cliente, login con celular/correo
   (Privy, sin "conecta tu wallet" — implementado), QR de cobro en el local (implementado),
   avisos de pago por Telegram (implementado) y WhatsApp (roadmap, pendiente de aprobación
   de Meta).
2. **Abstracción de cuenta (ERC-4337)** — smart accounts creadas en el primer login,
   bundler (Pimlico) + paymaster propio (`PuntosPaymaster.sol`) que patrocina la primera
   transacción gratis y cobra el resto en PUNTOS — implementado y probado en vivo. Login por
   passkey (WebAuthn) ya está habilitado como método de autenticación además de SMS/correo —
   el firmante de la smart account sigue siendo la misma wallet embebida de Privy en los tres
   casos, así que esto no cambió esta arquitectura, solo agregó una forma más de entrar.
3. **Contratos on-chain (Arbitrum)** — el ledger de verdad, no una base de datos:
   - `PaymentRouter.sol` — procesa pagos, cashback, puntos y registro self-service de
     bodegas (`registerSelf`, implementado — `MerchantRegistry.sol` separado ya no hace
     falta, esa responsabilidad vive en `PaymentRouter`).
   - `PuntosPaymaster.sol` — paymaster ERC-4337 que cobra el gas en PUNTOS (implementado).
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
       │  login con teléfono/correo (Privy)
       ▼
[App PWA / Web] ←→ [Bot de Telegram] (WhatsApp: roadmap)
       │  UserOperation (smart account, firmada por la wallet embebida)
       ▼
[Bundler (Pimlico) + PuntosPaymaster.sol]
       │
       ▼
[Arbitrum Sepolia]
  - PaymentRouter (pagos, cashback, registro self-service de bodegas)
  - PuntosToken (LoyaltyPoints)
  - FiadoScoring / CreditLineManager (Stylus)
  - PuntosPaymaster (paga el gas, cobrado en PUNTOS)
```

### MVP actual — qué está construido vs. roadmap

| Pieza | Estado |
|---|---|
| Pago QR → cashback → puntos (`PaymentRouter` + `PuntosToken`) | ✅ Desplegado y probado en Arbitrum Sepolia |
| Fiado con scoring on-chain (`FiadoScoring`, Stylus) | ✅ Desplegado y verificado |
| Fiado opt-in por bodega (`setFiadoEnabled`/`isFiadoEnabled`) | ✅ Desplegado — apagado por defecto, cada bodega prende el suyo |
| Ledger de fiado por cliente (`extendFiado`/`repayFiado`/`payFiado`) | ✅ Probado en vivo end-to-end en Arbitrum Sepolia (además de 6/6 Rust, 17/17 Solidity) — ver "Fiado con libro de deuda real" |
| Circuit breaker on-chain del oráculo de IA (`updateScoreFromAi` acotado al 2× del heurístico) | ✅ Probado en vivo en Arbitrum Sepolia (8/8 Rust) — ver "Circuit breaker on-chain para el oráculo de IA" |
| Login con passkey (WebAuthn) además de SMS/correo | ✅ Habilitado — mismo embedded wallet como firmante, solo cambia el método de autenticación |
| Alerta de balance bajo en `PuntosPaymaster` (`pnpm run check-paymaster-balance`) | ✅ Funcional — sigue siendo alerta, no auto-repuesto, a propósito |
| `BeneficioToken` — programas sociales restringidos (Vaso de Leche, Qali Warma, Pensión 65) | ✅ Desplegado, verificado y con ownership transferido a una sesión real logueada (9/9, 26/26 en todo el repo). UI de emisión admin-only en el panel de bodega + UI de canje en el panel de cliente, ambas funcionales — ver "`BeneficioToken.sol`" |
| Bodeguero/cliente como espacios separados (selector explícito, sin vistas combinadas) | ✅ Funcional — ver "Bodeguero y cliente son dos espacios separados" |
| Códigos de bodega/cliente y vínculos de Telegram en Upstash Redis (no archivo local) | ✅ Funcional con fallback automático a archivo si no hay credenciales de Upstash — cierra el riesgo real del filesystem efímero de Vercel, ver "Storage: Upstash Redis en producción" |
| Ajuste de fiado con IA (Claude, en español, escribe on-chain) | ✅ Probado en vivo end-to-end |
| Dashboard web (leer score/límite, pagar, pedir recálculo IA) | ✅ Funcional |
| Vistas separadas bodeguero/comprador, detectadas por rol on-chain | ✅ Funcional (`isBodega` en `PaymentRouter`) |
| Avisos de pago y perfil (`/perfil`) por Telegram, todo en soles | ✅ Funcional — webhook en producción (el daemon de polling no puede correr en Vercel), vinculación por código de 6 dígitos vía deep link `/start`, ver "El bot de Telegram como perfil" |
| Montos en soles (PEN) en vez de ETH, con tasa de cambio real | ✅ Funcional — conversión de display, ver "Atajos" |
| Registro self-service de bodegas (`PaymentRouter.registerSelf`) | ✅ Probado en vivo — cualquiera se registra desde la web, sin admin |
| Login sin wallet (Privy, teléfono/correo) | ✅ Probado en vivo — wallet embebida, nunca se ve "wallet" ni una dirección |
| Gas pagado en PUNTOS vía Account Abstraction (`PuntosPaymaster.sol`, ERC-4337) | ✅ Probado en vivo — primera transacción gratis, después se cobra en PUNTOS. Incluye dos fixes encontrados en vivo: PUNTOS de bienvenida para bodegas, y que un primer intento fallido ya no quema la transacción gratis, ver "Login sin wallet..." |
| Código de bodega por QR + número corto (sin `0x...` visible) | ✅ Probado en vivo — `/pagar/[code]`, código permanente de 6 dígitos |
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
forge install eth-infinitism/account-abstraction@v0.7.0 --no-git
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

Si `PuntosToken`/`FiadoScoring` ya están desplegados y solo cambió `PaymentRouter.sol`, usar
`RedeployPaymentRouter.s.sol` en vez de `Deploy.s.sol` — reusa el `PuntosToken` existente en
vez de crear uno nuevo (que borraría el saldo de puntos de todos los que ya probaron la app):

```bash
cd contracts/solidity
PUNTOS_TOKEN_ADDRESS=<dirección ya desplegada> \
  forge script script/RedeployPaymentRouter.s.sol:RedeployPaymentRouter \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
# después: cast send <FiadoScoringAddress> "setPaymentRouter(address)" <nuevoRouter> ...
```

Deploy de `PuntosPaymaster` (requiere `PuntosToken` ya desplegado; el EntryPoint v0.7 usa la
misma dirección canónica `0x0000000071727De22E5E9d8BAf0edAc6f37da032` en toda red EVM, ya
confirmada desplegada en Arbitrum Sepolia):

```bash
cd contracts/solidity
PUNTOS_TOKEN_ADDRESS=<dirección ya desplegada> DEPOSIT_ETH=0.02ether \
  forge script script/DeployPuntosPaymaster.s.sol:DeployPuntosPaymaster \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
```

Deploy de `BeneficioToken` (requiere `PaymentRouter` ya desplegado, usado como
`IBodegaRegistry`):

```bash
cd contracts/solidity
PAYMENT_ROUTER_ADDRESS=<dirección ya desplegada> \
  forge script script/DeployBeneficioToken.s.sol:DeployBeneficioToken \
  --rpc-url arbitrum_sepolia --broadcast --verify -vvvv
# opcional: cast send <BeneficioTokenAddress> "transferOwnership(address)" <smart account admin>
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

Para el login sin wallet y el gas pagado en PUNTOS hacen falta dos cuentas gratuitas más
(las crea quien opera el proyecto, nunca se pegan en el chat):

- [dashboard.privy.io](https://dashboard.privy.io) — crear una app, restringir los métodos de
  login a email + SMS, copiar el App ID público a `NEXT_PUBLIC_PRIVY_APP_ID`.
- [dashboard.pimlico.io](https://dashboard.pimlico.io) — API key gratis de testnet, a
  `NEXT_PUBLIC_PIMLICO_API_KEY`.
- `NEXT_PUBLIC_PUNTOS_PAYMASTER_ADDRESS` — la dirección de `PuntosPaymaster` desplegado
  arriba.

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
