# Bodegueando

Bodegueando digitaliza la bodega de barrio sin pedirle que cambie cómo cobra. La bodega
sigue aceptando efectivo, Yape o Plin como ya lo hace — Bodegueando no compite con esos
métodos, los adopta: por encima de cada cobro, agrega una capa de historial verificable,
cashback abierto y, con el tiempo, un score financiero que hoy simplemente no existe para
ningún negocio de este tamaño.

Construido y probado en vivo sobre Arbitrum Sepolia: contratos desplegados y verificados,
transacciones reales, sin entorno simulado. Para el detalle técnico completo — contratos,
mecanismos, direcciones desplegadas, tests, corridas en vivo y setup — ver
[**ARCHITECTURE.md**](./ARCHITECTURE.md).

## Descripción detallada

Cómo funciona, componente por componente:

**1. Cobro y registro.** El cliente escanea un código QR o ingresa un número corto de 6
dígitos de la bodega —nunca ve una dirección de wallet— y paga en soles desde su celular.
Cada pago queda registrado on-chain, de forma permanente y verificable, sin importar que el
monto real se haya movido antes por efectivo o billetera digital: es esa capa de registro la
que hoy no existe en ningún lado.

**2. Cashback abierto.** Cada pago acuña automáticamente puntos equivalentes a un 2% del
monto — igual que el cashback de una cadena como Sip, pero sin depender de pertenecer a
ningún grupo empresarial: cualquier bodega se registra y empieza a dar puntos desde el primer
día. Los puntos son un token que el contrato crea en cada transacción, no una salida de caja
de la plataforma.

**3. Historial y score financiero.** Cada pago alimenta un cálculo on-chain de reputación por
bodega —puntualidad, volumen, recurrencia— que corre en Stylus por el volumen de cómputo que
implica recalcular esto en cada transacción. Ese historial es la base de dos cosas: primero,
un límite de fiado que la bodega puede activar si quiere fiarle a un cliente específico
(apagado por defecto, decisión suya); segundo, y más importante, el insumo para el score
financiero del propio negocio —la prueba objetiva de solidez que hoy ninguna bodega puede
mostrarle a una microfinanciera. Una IA puede sugerir ajustes a ese historial, acotada por un
mecanismo en el propio contrato que le impide proponer un salto mayor al doble de lo que los
datos reales justifican. Ese historial ya se puede convertir, además, en un certificado de
crédito con Zero-Knowledge ("mi score ≥ 700" sin revelar la cifra exacta) que un banco valida
en un click, y consumir directamente en una línea de crédito on-chain con menor garantía
cuanto mejor el score probado — ver ARCHITECTURE.md, secciones CreditCertificate/CreditLine.

**4. Onboarding sin fricción.** El usuario entra con su celular, correo o passkey, sin crear
ni entender una wallet. Cada persona tiene una cuenta inteligente (ERC-4337) cuyo gas se paga
con sus propios puntos de cashback — nunca con dinero aparte, igual que no existe un "cargo de
red" en Yape o Plin. La bodega es un caso distinto a propósito: como no cobra cashback por
recibir pagos (el cashback es del comprador), sus propias acciones (activar fiado, fiarle a un
cliente, publicar un beneficio) las patrocina la plataforma siempre, sin tocar puntos — nunca
tiene que pensar en gas, punto.

**5. Notificaciones.** Un bot de Telegram avisa al bodeguero cuando le pagan y muestra su
perfil —ventas, nivel de confianza, fiado disponible— todo en soles. (WhatsApp llega en las
próximas semanas — por eso Telegram salió primero: mismo objetivo, disponible de inmediato.)

Alrededor de ese núcleo, la plataforma ya suma piezas adicionales construidas sobre el mismo
historial on-chain: fiado con garantía parcial (`InvoiceEscrow`) para montos donde la bodega
prefiere pedir un depósito, un catálogo de beneficios canjeables por puntos entre cualquier
bodega de la red (`RewardsCatalog`), compras conjuntas entre bodegas cercanas —de la misma
zona, no de cualquier parte de la ciudad— para alcanzar el mínimo de un distribuidor
(`GroupOrders`), un mapa de bodegas cercanas, y una vía inicial para programas sociales
restringidos a gastarse solo en bodegas registradas (`BeneficioToken`). Detalle completo de
cada una en ARCHITECTURE.md.

El resultado no es una nueva forma de pagar, sino la infraestructura de confianza que falta
detrás de un tipo de comercio que ya mueve más de 500 mil negocios en el Perú, muchos de ellos
el único sustento de una familia, y presentes justo donde el comercio formal nunca abre
sucursal.

## Uso de Arbitrum

Bodegueando usa Arbitrum en dos capas distintas, no como detalle técnico aislado sino como
base que hace viable el modelo entero.

**1. Contratos estándar en Solidity, sobre Arbitrum.** `PaymentRouter` (procesa cada cobro y
dispara el cashback), `PuntosToken` (el ERC-20 de puntos) y `PuntosPaymaster` (paymaster
ERC-4337 que permite pagar el gas en puntos en vez de ETH) — y, sobre el mismo patrón,
`InvoiceEscrow`, `RewardsCatalog`, `GroupOrders`, `BeneficioToken`, `CreditCertificate` y
`CreditLine` — corren sobre Arbitrum por su compatibilidad total con el tooling EVM (Foundry,
viem, bundlers ERC-4337 como Pimlico) y, sobre todo, por el costo: una bodega cobra montos de
S/5 a S/20; en una L1 la comisión de red podría superar el valor de la venta. En Arbitrum el
costo por transacción es de fracciones de centavo — cobrar por blockchain resulta, por primera
vez, más barato que un POS tradicional (2.5%–3.5% de comisión), no más caro.

**2. El cálculo del fiado, específicamente en Arbitrum Stylus (Rust).** `FiadoScoring` es el
único contrato que no está en Solidity, y no por estética: cada pago dispara un recálculo del
score (promedio de puntualidad, volumen acumulado, agregados de reputación entre bodegas) —
aritmética repetida sobre varios acumuladores en cada transacción. Ese cómputo es
sustancialmente más caro en EVM puro que compilado a WASM. Stylus es hoy la única forma de
tener ese cálculo corriendo on-chain —no en un backend centralizado, que rompería la propiedad
central del producto: que el historial de fiado sea verificable e inalterable— sin que el gas
vuelva impracticable cada pago. El mismo contrato valida además, en cada ajuste, que la
recomendación de la IA nunca supere el doble de lo que el historial real justificaría
(nuestro "circuit breaker").

**Por qué no alcanza con "estar en una red compatible" sin más.** Si Bodegueando solo
necesitara mover tokens, cualquier L2 serviría igual y el uso de blockchain sería superficial.
Lo que hace que Arbitrum —y en particular Stylus— sea una elección real es que el producto
necesita costos bajos para que el caso de uso sea económicamente viable, y cómputo on-chain no
trivial para el motor de scoring, que en EVM genérica sería demasiado caro de ejecutar en cada
pago. Ambas cosas están probadas hoy contra contratos desplegados y verificados en Arbitrum
Sepolia, no en un entorno simulado.

## Problema e impacto

El problema, sin rodeos: una bodega de barrio hoy cobra en efectivo, Yape o Plin —casi ninguna
acepta tarjeta— pero ese movimiento diario no deja ningún rastro que sirva más allá del
momento de la venta. No hay nada que conecte esas transacciones con una prueba de que el
negocio es sólido, ni con los otros negocios de la misma cuadra, ni con nadie que pudiera
confiar en él a partir de eso.

Esto pesa más de lo que parece porque estas no son tiendas cualquiera: para quien las abrió,
muchas veces son el sustento de toda una familia, y suelen estar exactamente donde el comercio
formal —supermercados, cadenas, bancos— nunca llega. Ese alcance ya existe; lo que falta es la
infraestructura para aprovecharlo.

De ahí se desprenden varios problemas concretos, todos con la misma raíz:

- **Fidelización desigual.** Una cadena como Sip puede dar cashback porque todas sus tiendas
  pertenecen al mismo grupo y se financian entre sí. Una bodega independiente no tiene forma
  de ofrecer algo parecido — compite contra ese beneficio sin ninguna herramienta equivalente.
- **Cero historial verificable.** Todo lo que prueba que el negocio funciona (que vende, que
  sus clientes vuelven, que el fiado que da se recupera) vive en la memoria del bodeguero.
  Cuando busca un préstamo de una microfinanciera para capital de trabajo, se lo niegan o se
  lo dan mínimo — no porque el negocio sea débil, sino porque no tiene con qué respaldarse
  frente a un analista de crédito.
- **Programas sociales que no llegan bien.** Un programa como Vaso de Leche o Programas Municipales
  depende de intermediarios para distribuir beneficios en barrios donde, otra vez, la bodega
  es el punto más cercano — pero hoy no hay ningún registro verificable de esos negocios que
  facilite esa distribución.
- **Trámites de formalización que quedan pendientes.** No todas las bodegas tienen sus
  permisos municipales al día, muchas veces simplemente porque el proceso es lento o poco
  claro, no porque no quieran operar en regla.
- **Compras al por mayor ineficientes.** Cada bodega negocia sola con distribuidores, que a
  veces mandan un vendedor tienda por tienda —un costo real que termina encareciendo el
  producto— o la bodega tiene que trasladarse hasta un mayorista. En una misma cuadra, varias
  bodegas hacen ese viaje por separado, y ni siquiera tienen entre ellas los mismos productos.

**Qué hace Bodegueando.** No compite con el efectivo, Yape o Plin — los adopta: la bodega
sigue cobrando como ya cobra, y por encima de eso gana una capa de historial, cashback abierto
(sin depender de ningún grupo empresarial) y verificación, todo registrado on-chain de forma
que nadie puede alterar. Ese historial, acumulado pasivamente venta a venta, es la base para
construir el score financiero de la bodega — el activo que hoy no existe y que ya puede
mostrarle a una microfinanciera sin exponer sus ventas reales línea por línea, gracias al
certificado de crédito con Zero-Knowledge.

El resto del problema comparte la misma solución de fondo — una vez que existe un registro
verificable de bodegas activas y su ubicación real: los programas sociales tienen a quién
distribuir beneficios de forma directa y trazable; una bodega registrada tiene un punto de
partida más claro para regularizar sus permisos; varias bodegas de un mismo barrio pueden
juntar sus pedidos a un mayorista y recibir en un solo punto de entrega, en vez de viajes o
visitas por separado; y esa misma presencia de barrio —la persona detrás del mostrador que ya
conoce a las familias de la cuadra— puede convertir a la bodega en un punto de aviso frente a
la seguridad ciudadana, algo que hoy nadie está aprovechando.

**Impacto esperado:** más de 500 mil bodegas en el Perú operan hoy sin ninguna infraestructura
digital que las respalde, siendo al mismo tiempo el comercio más cercano a millones de
familias que viven del día a día. Digitalizar lo que ya hacen —sin pedirles que cambien cómo
cobran— es la base para que, con el tiempo, ese historial se traduzca en crédito real, en
programas sociales mejor distribuidos, y en negocios de barrio con una posición más fuerte
frente a lo que hoy solo tienen las grandes cadenas.

## Modelo de negocio

Bodegueando no le cobra a la bodega por lo que hoy ya la trae a la plataforma: cobrar, ganar
puntos y construir su historial es gratis para ella, y así se queda. Cobrarle una comisión por
transacción —aunque fuera menor al 2.5%–3.5% de un POS tradicional— rompería la promesa
central del proyecto: que la bodega gane, no que pague, por dejar un registro verificable de
su propio negocio. Ningún ingreso de la plataforma puede salir del bolsillo del bodeguero por
su venta diaria.

Entonces, ¿de dónde sale el dinero para cubrir lo que sí cuesta operar (gas patrocinado en
Arbitrum vía `PuntosPaymaster`, cómputo del oráculo de IA, infraestructura)? De actores
distintos al bodeguero-vendiendo, cada uno pagando por un valor nuevo y real que Bodegueando
le crea:

1. **Bancos y microfinancieras pagan por consultar el certificado de crédito**, no la bodega.
   Es el mismo modelo que ya opera hoy: en Perú, Equifax/Infocorp no le cobra al consumidor
   por su propio historial (tiene una consulta gratis al año, por ley) — cobra a bancos,
   aseguradoras y financieras que consultan el reporte para decidir si prestan. La bodega
   genera y usa su certificado gratis; una entidad financiera que quiere validar
   "score ≥ 700" antes de prestarle paga por esa consulta, igual que ya le paga a un buró de
   crédito tradicional — solo que con datos que hoy ese buró no tiene, porque nunca
   existieron.
2. **Un spread pequeño sobre el interés de `CreditLine`, solo cuando la bodega elige pedir
   prestado.** Es un préstamo opcional, nunca una condición para vender — un servicio nuevo
   (crédito con menos garantía gracias a su historial) que hoy no existe para este segmento a
   ningún precio. El contrato ya cobra un interés fijo que hoy vuelve 100% al fondo de quien
   prestó; quedarse con una porción pequeña de ese interés no le cuesta más a la bodega frente
   a su alternativa real de hoy: no tener acceso a crédito, o pagarlo mucho más caro de forma
   informal.
3. **Distribuidores pagan una comisión de intermediación en las compras conjuntas
   (`GroupOrders`), no las bodegas.** Hoy un distribuidor gasta en mandar un vendedor tienda
   por tienda para juntar pedidos chicos — un costo real que ya paga. Bodegueando le entrega
   la demanda ya agregada de varias bodegas de una misma zona: cobrarle una comisión menor a
   lo que hoy gasta en ventas puerta a puerta es valor nuevo para él, no un costo para la
   bodega, que de cualquier forma sale ganando con mejor precio.
4. **Programas sociales (gobierno o municipalidad) pagan una cuota de administración**, no el
   beneficiario ni la bodega. La filtración —que el beneficio llegue a quien no le
   corresponde— en programas como Vaso de Leche llegó a superar el 70% en Lima según cifras
   del MEF: un problema carísimo para el Estado. Una cuota de administración sobre
   `BeneficioToken`, muy por debajo de lo que hoy se pierde en filtración e intermediarios, es
   un ahorro neto para el programa, no un costo nuevo para nadie más.

Lo que Bodegueando nunca va a cobrar: comisión por transacción de cobro (el corazón de la
promesa frente a un POS tradicional), comisión por ganar o canjear puntos de cashback (son de
la bodega y del cliente, no de la plataforma), ni comisión por construir o consultar su propio
historial y score.

**Nota de honestidad:** ninguno de estos cuatro mecanismos de cobro está activado hoy en los
contratos desplegados — `CreditLine.sol` devuelve el 100% del interés al fondo de
prestamistas, sin ningún corte de protocolo, y no hay ninguna tarifa on-chain para bancos,
distribuidores o programas sociales todavía. Activarlos es sencillo (una constante de
protocolo en el contrato, o un cobro fuera de la cadena para las consultas B2B/B2G), pero se
dejó fuera de esta primera versión a propósito: primero construir la infraestructura y la
confianza, después cobrar por lo que sí genera valor nuevo — nunca al revés.

### La infraestructura para cobrar ya está construida, no es solo un plan

Los cuatro mecanismos de arriba no son una lista de deseos: cada uno tiene, hoy, el contrato
que lo soporta ya desplegado y probado en Arbitrum Sepolia — activar el cobro es prender un
interruptor sobre algo que ya funciona, no construirlo desde cero.

- **Mecanismo 1 (consulta de certificado)** — `CreditCertificate.sol` ya emite el certificado
  ZK y `getCertifiedThreshold` ya es la vista pública que una entidad financiera consultaría;
  falta solo el cobro por esa consulta, que puede vivir fuera de la cadena (una API B2B/B2G) sin
  tocar el contrato.
- **Mecanismo 2 (spread de `CreditLine`)** — el pool de préstamos, los tiers de garantía por
  score, y el cobro de interés fijo (5%) ya existen y ya se probaron en vivo con un préstamo
  real repagado; falta solo una constante de protocolo que retenga una porción de ese interés
  en vez de devolverlo 100% al fondo.
- **Mecanismo 3 (comisión de `GroupOrders`)** — el flujo completo de aportar, alcanzar meta y
  retirar ya está probado en vivo con ETH real moviéndose entre bodegas; falta solo un
  porcentaje de protocolo sobre el retiro.
- **Mecanismo 4 (cuota sobre `BeneficioToken`)** — la emisión, el vencimiento y la restricción
  de gasto a bodegas registradas ya funcionan; falta solo una cuota de administración,
  cobrable al programa social que emite, no al beneficiario.

**Por qué el mecanismo 1 es el primero en activarse en la práctica.** De los cuatro, es el que
menos depende de acumular volumen o de un socio externo: no necesita liquidez profunda como el
mecanismo 2, ni un acuerdo logístico con un distribuidor como el 3, ni un convenio estatal como
el 4. En cuanto existan bodegas reales con certificados reales, alcanza con una sola entidad
financiera dispuesta a pagar por consultar un score para empezar a generar ingreso — sin tocar
ni redesplegar ningún contrato del resto del producto.

**El costo real que hay que cubrir mientras tanto.** Cobrar cero por transacción es la promesa
central del proyecto, pero operar no es gratis: el gas patrocinado (`PuntosPaymaster`) y, a
futuro, el costo de convertir soles reales hacia y desde la app (ver más abajo) son gastos
reales de la plataforma desde el primer día, sin que ningún ingreso los cubra todavía. Esa
brecha se cierra con capital semilla o de programa (no con una cuota al bodeguero) hasta que el
mecanismo 1 — el más rápido de los cuatro — empiece a generar ingreso real.

### El paso a soles reales (eSol) no le agrega costo a nadie

Hoy el pago usa ETH de testnet como equivalente de soles (ver "Atajos" en ARCHITECTURE.md). El
plan para reemplazarlo por soles reales on-chain no es construir un banco ni emitir una moneda
propia — es **integrar con un proveedor de conversión soles↔saldo on-chain ya autorizado para
operar en Perú**, evaluado en su momento sin comprometerse hoy a uno en particular. Construir
esa pieza desde cero (licencia, reservas propias, atestación) es un proyecto de otra escala,
con riesgos regulatorios reales; integrarse a uno que ya exista es lo que sí se puede activar
en un plazo razonable.

Ese cambio de activo **no toca el mecanismo del cashback en absoluto.** Los puntos que gana un
cliente en cada compra nunca salen del monto que paga ni de lo que recibe la bodega —
`PaymentRouter` los acuña aparte, como supply nuevo, exactamente igual que un programa de
millas o el sello de fidelidad de una tienda: nadie paga de más para que existan. Eso es cierto
hoy con ETH de testnet y sigue siendo cierto el día que el activo detrás sea soles reales — el
código que acuña PUNTOS no cambia, porque nunca dependió de qué activo se usó para pagar.

Lo único que sí tiene un costo real en ese cambio es la conversión misma (el proveedor de
on/off-ramp cobra un margen, como cualquier cambio de moneda) — y ahí Bodegueando ya tiene el
patrón para absorberlo sin que el usuario lo note: es el mismo que usa hoy con el gas.
`PuntosPaymaster` ya paga un costo real (el gas en Arbitrum) por cada transacción y lo esconde
del usuario, patrocinándolo la plataforma en vez de cobrárselo — probado en vivo, no en teoría.
El margen del on/off-ramp se puede absorber con la misma lógica: costo operativo de la
plataforma, nunca una comisión visible para el bodeguero o el comprador. Quien paga sigue
viendo exactamente lo mismo que ve hoy — un monto en soles y un botón — sin importar qué pasa
por debajo.

*Fuentes: [Equifax Perú — Reporte Infocorp](https://www.equifax.pe/personas/productos/reporte-infocorp-credito/)
(modelo de cobro a entidades financieras, consulta gratuita anual del consumidor por Ley
27489); MEF, "Caracterización del Programa del Vaso de Leche" y balance de políticas sociales
(filtración de beneficios).*

## Estado actual

Todo lo descrito arriba está desplegado y verificado en Arbitrum Sepolia, con tests
automatizados y corridas en vivo con transacciones reales (no simuladas): cobro con cashback,
fiado con libro de deuda real, circuit breaker on-chain del oráculo de IA, fiado con garantía
parcial, catálogo de beneficios, compras conjuntas entre bodegas, certificado de crédito ZK y
línea de crédito on-chain que lo consume, login sin wallet con gas pagado en puntos, bot de
Telegram, y mapa de bodegas cercanas. En camino: notificaciones por WhatsApp (próximas
semanas). Pendiente de terceros: rampas eSol ↔ PEN reales.

El detalle de cada pieza — mecanismo, qué NO resuelve a propósito, cobertura de tests, y la
corrida en vivo con los hashes de transacción reales — está en
[**ARCHITECTURE.md**](./ARCHITECTURE.md).
