# Bodegueando — brief de pitch para diseño

Este archivo es el insumo completo para pedirle a una IA de diseño (Claude Design u otra) que
arme una presentación de pitch en PDF. Tiene dos partes: (1) el sistema de marca, para que el
diseño respete los colores y tipografías reales del producto en vez de inventar unos nuevos, y
(2) el contenido del pitch, ya estructurado por slide. Al final hay un prompt listo para pegar.

---

## 1. Sistema de marca

### Paleta de colores

| Color | Hex | Uso |
|---|---|---|
| **Signal (lima, color de marca)** | `#c9e265` | Acento principal: botones, íconos, detalles, resplandor de fondo |
| **Signal Bright** | `#d6f17b` | Extremo claro del degradé de los botones |
| **Signal Deep** | `#aec846` | Íconos y texto de acento sobre fondo claro (más legible que el lima puro) |
| **Verde acento sobre claro** | `#718817` | Texto itálico de acento dentro de un titular, sobre fondo claro |
| **Ink (tinta, texto principal)** | `#0a0a0b` | Texto principal sobre fondo claro, texto sobre el logo |
| **Fondo claro primario** | `#fafaf7` | Fondo general de las secciones claras |
| **Fondo claro de tarjeta** | `#fffffc` | Cards, tarjetas, superficies elevadas |
| **Fondo oscuro primario** | `#111113` | Secciones oscuras (hero, cierre) |
| **Fondo oscuro, variantes del degradé del hero** | `#0e0e10`, `#131316`, `#191b12` | Degradé de fondo del hero (de arriba hacia abajo, con un toque verdoso al final) |
| **Texto secundario sobre claro** | `#55564f`, `#42433d` | Párrafos y subtítulos sobre fondo claro |
| **Texto muted sobre claro** | `#6b6d64`, `#8f9189` | Texto terciario, etiquetas, notas pequeñas |
| **Texto sobre oscuro (titulares)** | `#fafaf6` | Titulares sobre fondo oscuro |
| **Texto sobre oscuro (cuerpo)** | `#b2b4ab`, `#a9aba1`, `#a6a89f` | Párrafos sobre fondo oscuro |

**Botón primario:** degradé lineal 180°, de `#d6f17b` (arriba) a `#c9e265` (abajo), texto en
`#0a0a0b`, con una sombra interior blanca sutil arriba (`inset 0 1-2px #ffffff`) y un resplandor
lima difuso debajo (`0 8-28px`, color lima con baja opacidad). Siempre en forma de píldora
(completamente redondeado).

### Tipografía

- **Bricolage Grotesque** — titulares, números destacados, etiquetas de UI en mayúscula. Es la
  tipografía geométrica y contemporánea de la marca; casi todo lo que es "titular" la usa.
- **Instrument Serif** (solo cursiva, peso 400) — una frase de acento *dentro* de un titular
  (nunca el titular completo), como un guiño editorial y humano en medio de una tipografía
  geométrica. Ejemplo real: el titular "Cobra, junta puntos" en Bricolage, seguido de "y fía sin
  arriesgarte." en Instrument Serif cursiva, en color Signal.
- **Geist Sans** — cuerpo de texto, UI general, párrafos.
- Nada de tipografías "tech" o monoespaciadas en el pitch — esas quedan para código, no para
  marca.

### Lenguaje visual

- **Secciones alternadas, no todo oscuro ni todo claro**: el hero y el cierre son oscuros (con
  un resplandor radial lima de fondo, sutil); el resto (features, cómo funciona, confianza) es
  claro. Un pitch en slides puede usar el mismo patrón: portada y cierre oscuros con resplandor,
  slides intermedios claros.
- **Cards**: esquinas muy redondeadas (20–24px), fondo `#fffffc`, borde negro al 10% de opacidad,
  sombra sutil. Nunca esquinas rectas.
- **Botones**: siempre en forma de píldora, nunca rectangulares.
- **Logo**: un badge cuadrado con esquinas muy redondeadas, fondo en el degradé lima, con el
  ícono en tinta (`#0a0a0b`) de un toldo/fachada de bodega (una línea en zigzag arriba, como el
  toldo de una tienda) sobre una puerta. Transmite "bodega de barrio", no "fintech genérica".
- **Tono visual general**: cálido, cercano, hecho a mano — lo opuesto a la estética
  "cripto"/neón/tech-fría, a pesar de que por dentro el producto es 100% on-chain. La marca
  nunca debe verse como una wallet o un exchange.

---

## 2. Contenido del pitch

*(Estructura pensada para una presentación oral corta, tipo demo day de hackathon — cada
sección de abajo es una idea de slide o bloque de slides.)*

### Gancho

> Miles de peruanos arrancan su primer negocio en el mismo lugar donde viven — sin cadena que
> los respalde, sin una red de otros negocios detrás, sin nadie que les diga si van por buen
> camino. Bodegueando nace en la bodega de la esquina, pero el problema que resuelve —
> fidelizar sin depender de nadie más, y construir un historial que hoy simplemente no existe—
> es el de cualquiera que empieza de cero.

*(Nota de diseño: slide de portada, fondo oscuro. En vez de una cifra gigante, el foco visual
acá es humano — una fachada de bodega real o una silueta de alguien atendiendo su propio
negocio, con la frase superpuesta. La cifra de "500 mil bodegas" todavía sirve, pero movida a
"El problema" como respaldo del tamaño de la oportunidad, no como la apertura.)*

### El problema

En el Perú, 3 de cada 10 locales comerciales son una bodega — más de 500 mil en todo el país.
Cada una es, para quien la abrió, su primer negocio propio. Y empezar así, sola, trae un
paquete de problemas que nadie le explicó de antemano:

- **Empieza completamente sola, sin ninguna red detrás.** No hay una cadena, un franquiciador
  ni un equipo corporativo respaldándola — solo la persona, su local, y su propio criterio.
  Aunque tenga otra bodega a media cuadra, no hay ninguna infraestructura que las conecte ni
  las ayude entre ellas.
- **La fidelización no es pareja.** Las grandes cadenas (Plaza Vea, Inkafarma, Vivanda...) sí
  tienen su propio cashback — porque son del mismo grupo empresarial y pueden financiarlo
  entre ellas. Una bodega independiente no tiene forma de ofrecerle algo parecido a su
  cliente: compite contra el descuento de la cadena grande sin ninguna herramienta
  equivalente.
- **No hay historial, y sin historial no hay crédito — para nadie.** El banco no le presta al
  bodeguero porque no tiene cómo demostrar que su negocio es sólido; y el bodeguero, por la
  misma razón, tampoco tiene cómo saber a qué cliente le conviene fiarle. Es el mismo problema
  mirado desde los dos lados del mostrador.
- **Lo poco que existe hoy vive en la memoria o en un cuaderno.** El fiado que igual se da,
  porque el vecino lo necesita, queda anotado a mano o simplemente recordado — se puede
  perder, mojar, o "olvidar" una deuda, y no hay ningún dato objetivo detrás de la decisión de
  a quién fiarle.
- **El crédito formal no es una opción para esto.** Un banco o una microfinanciera no está
  pensado para una deuda de S/ 15 entre vecinos — es demasiado lento y burocrático para el
  problema real.

### La solución

**Bodegueando** digitaliza la bodega de barrio sin pedirle que deje de ser una bodega, sobre
cuatro pilares:

1. **Cobra con un código o QR** — el cliente escanea con la cámara de su celular y paga, en
   soles, sin instalar nada raro.
2. **Cashback abierto, de verdad de cualquiera para cualquiera.** El cliente gana puntos
   automáticamente con cada compra — pero a diferencia del cashback de una cadena grande, este
   no depende de que la bodega pertenezca a ningún grupo empresarial: cualquier bodega se
   registra y empieza a dar puntos desde el primer día, sin negociar con nadie, y el registro de
   quién ganó qué vive en una cadena de bloques verificable — no en la base de datos privada de
   una sola empresa que puede cambiar las reglas cuando quiera.
3. **El sistema sugiere cuánto fiarle a cada cliente**, mirando su historial real de pagos con
   esa misma bodega — la IA lo explica en español simple, y el bodeguero siempre tiene la
   última palabra: puede prender o apagar el fiado cuando quiera. La deuda queda registrada de
   verdad — cuánto se fió, cuánto se pagó, a quién — sin que nadie la pueda borrar ni inventar.
4. **La misma infraestructura sirve para programas sociales.** Un programa como Vaso de Leche
   o Pensión 65 puede emitir un beneficio que solo se gasta en una bodega registrada — nunca se
   revende ni se cambia por efectivo. Tiene sentido justo por lo que ya es cierto hoy: la
   bodega llega a barrios y familias donde el comercio formal grande nunca abre una sucursal —
   es, sin quererlo, la red de distribución social más grande y más cercana que ya existe.

Empieza en la bodega porque ahí el problema es más urgente y más visible — pero fidelizar sin
depender de nadie más y construir un historial que hoy no existe no es un problema exclusivo
de las bodegas. Es el de cualquier persona que emprende de cero.

*(Nota de diseño: esta es la sección para un flujo de pantallas real de la app — capturas de
"Tu código para cobrar", el toggle de fiado, y la tarjeta de "Fiado disponible en esta bodega" —
en vez de mockups genéricos. El producto ya existe y se ve así.)*

### Propuesta de valor

Lo que hace diferente a Bodegueando no es cobrar por QR — eso ya lo resuelven Yape y Plin.
Es todo lo que pasa *después* del cobro:

- **Vs. Sip (Intercorp): cashback sin pertenecer a ningún conglomerado.** Sip solo devuelve su
  1% dentro de las propias tiendas de Intercorp (Plaza Vea, Inkafarma, Vivanda...) porque todas
  se financian entre sí. Una bodega independiente nunca va a ser parte de ese grupo — con
  Bodegueando no le hace falta: se registra y ya está dando cashback real, verificable por
  cualquiera, sin pedirle permiso a nadie.
- **Vs. Yape/Plin: cobran, pero ninguna fía con criterio.** Ninguna app de pagos peruana hoy
  calcula un límite de fiado por cliente basado en su historial real.
- **Vs. el cuaderno de toda la vida: nada se puede alterar.** Cada fiado y cada pago quedan
  registrados de forma permanente — no depende de la memoria ni de la buena fe de nadie.
- **La IA ayuda, pero no manda.** El límite que sugiere la inteligencia artificial está
  además acotado por una regla fija en el propio sistema: nunca puede proponer un salto
  descabellado respecto a lo que el historial real ya justifica. La bodega siempre decide.
- **Vs. un programa social genérico: llega literalmente a la puerta de al lado.** La bodega ya
  está en cada barrio donde el comercio formal grande nunca abre — Bodegueando aprovecha esa
  presencia real para que el beneficio llegue directo, sin intermediarios que se queden con
  una parte en el camino.
- **Empieza en la bodega, pero el historial que construye no tiene por qué quedarse ahí.** El
  mismo mecanismo que hoy le da a un cliente un límite de fiado puede, mañana, darle a
  cualquier emprendedor sin historial crediticio formal —una peluquera, un taller, un puesto de
  mercado— una forma de demostrar que su negocio es sólido, sin depender de que un banco decida
  creerle sin ninguna prueba.
- **Nunca se siente "cripto".** Se entra con el celular o el correo, nada de contraseñas
  complicadas ni palabras como "wallet" — toda la tecnología compleja queda invisible.

### Tecnología y viabilidad

Bodegueando no es un mockup: es un producto funcional, con contratos reales desplegados y
verificados en la red Arbitrum (Sepolia), y ya publicado en producción.

- **Arbitrum**, por costos de transacción mínimos y compatibilidad total con el ecosistema
  Ethereum — clave para que cobrar S/ 5 nunca cueste más que eso en comisión de red.
- **Arbitrum Stylus (Rust)** para el contrato de scoring de fiado — el cálculo del historial de
  pagos es una operación matemática que conviene correr en WASM, no en EVM puro.
  Solidity para el resto: pagos, puntos y el token de programas sociales.
- **Cuentas inteligentes (ERC-4337)** en vez de wallets tradicionales: el usuario entra con su
  celular o correo (Privy), y el gas de sus transacciones se paga con sus propios puntos —
  nunca necesita ETH ni entender qué es "el gas".
- **Inteligencia artificial (Claude, de Anthropic)** analiza el historial on-chain de cada
  bodega y sugiere un ajuste de su límite de fiado, explicándolo en español simple.
- **Todo en soles**, nunca en criptomonedas — la conversión pasa por debajo, invisible para
  el usuario.

### Prueba de que funciona

*(Este punto no estaba en la lista original — se agrega porque es la diferencia más grande
entre este proyecto y un demo de hackathon típico: acá hay evidencia real, no solo una
promesa.)*

- Contratos **desplegados y verificados en Arbitrum Sepolia**, con código fuente legible en el
  explorador — nada oculto.
- **Transacciones reales de punta a punta**, probadas en vivo: un pago real, un fiado real
  otorgado y pagado de vuelta, un ajuste de IA aceptado y otro rechazado por el propio sistema
  por proponer un salto injustificado.
- **Aplicación en producción**, no solo en un entorno de pruebas — accesible hoy mismo desde
  el celular.
- Durante las pruebas con datos reales aparecieron dos problemas genuinos de diseño del
  sistema de gas — **se encontraron y se corrigieron en vivo**, con la corrección igual de
  probada que el resto. Eso no es un detalle menor: es la diferencia entre un producto que
  se probó de verdad y uno que solo se mostró una vez.

### Roadmap: lo que sigue

Lo construido hoy ya funciona de punta a punta, pero es la base de una visión más grande —
todo pensado para empoderar al bodeguero, no solo para digitalizar lo que ya hacía. Y aunque
hoy arranca en la bodega, la misma infraestructura no tiene por qué quedarse ahí: cualquier
emprendedor sin historial formal —del rubro que sea— tiene exactamente el mismo problema.

- **Score crediticio del propio bodeguero, con Zero-Knowledge.** Hoy el historial on-chain
  demuestra si *sus clientes* pagan bien. El siguiente paso es que el bodeguero use ese mismo
  historial de ventas para demostrar *su propia* solidez financiera frente a un banco, una
  microfinanciera o un proveedor — sin tener que entregarles sus ventas reales, línea por
  línea. Con una prueba de conocimiento cero (ZK) puede probar un enunciado verdadero sobre su
  historial ("mis ventas superan tal umbral", "mi puntaje de confianza es mayor a tal número")
  sin revelar los datos sensibles detrás — información que hoy nadie comparte precisamente
  porque compartirla es un riesgo, no un beneficio.
- **Compras conjuntas entre bodegas.** Muchas bodegas, sobre todo las más alejadas, pierden
  ventas simplemente porque el distribuidor no llega hasta donde están, o el pedido mínimo es
  más grande de lo que una sola bodega necesita. Bodegueando puede coordinar pedidos grupales
  entre bodegas cercanas — juntan su demanda, alcanzan el mínimo, y todas reciben mercadería
  que solas no podrían pedir.
- **eSol real y rampas con soles de verdad.** Hoy el pago usa ETH de testnet como stand-in;
  el camino a producción implica una rampa real entre soles y saldo dentro de la app (Yape,
  efectivo), y eventualmente `InvoiceEscrow` (fiado con garantía) para montos más grandes.

*(Nota de diseño: esta slide puede ser una línea de tiempo simple de tres etapas, o tres
tarjetas — cada idea con un ícono, sin necesitar mockups todavía, porque nada de este bloque
está construido: es a propósito la visión, no una demo.)*

### El equipo

Bodegueando lo construyó **una sola persona** durante las horas del hackathon: producto,
contratos inteligentes (Solidity y Rust/Stylus), frontend, integración de IA y despliegue —
de punta a punta. No hay una división de roles que mostrar porque no hizo falta: cada pieza
del sistema, del contrato de fiado al bot de Telegram, salió de la misma persona en el mismo
sprint.

*(Nota de diseño: si el formato de la presentación pide "roles", esta slide puede mostrarse
como una sola tarjeta con el nombre y la lista de disciplinas cubiertas, en vez de una grilla
de varias personas.)*

### Cierre

> Cada bodega que se sube a Bodegueando no solo cobra más rápido — construye, venta a venta,
> una reputación financiera que hasta hoy nunca pudo tener, ni para fiarle a sus clientes ni
> para que a ella misma le fíen. Empezamos con las más de 500 mil bodegas del Perú porque ahí
> el problema es más urgente — pero el día que cualquier persona que emprende sola, sin red y
> sin historial, pueda demostrar con su propio esfuerzo que merece confianza, no va a
> importar si empezó vendiendo abarrotes o cortando el cabello. Esa es la confianza de barrio
> que por fin queremos que cuente para algo.

---

## 3. Prompt listo para pegar

Copiar todo el contenido de este archivo (desde "## 1. Sistema de marca" hasta el final) y
pegarlo junto con esto al pedirle la presentación a la IA de diseño:

```
Necesito una presentación de pitch de hackathon en PDF, de 9-10 slides, para el proyecto
Bodegueando. Abajo te paso el sistema de marca completo (colores exactos, tipografías,
lenguaje visual) — respetalo estrictamente, no inventes una paleta nueva. También te paso el
contenido ya escrito y estructurado por sección: cada sección de "## 2. Contenido del pitch"
es una slide o un bloque de slides. Mantené el texto tal cual está escrito (está en español
neutro peruano, ya pensado para decirse en voz alta), solo maquetalo. Alterná fondos oscuros
y claros como se describe en "Lenguaje visual". Usá Bricolage Grotesque para titulares e
Instrument Serif cursiva solo para frases de acento cortas dentro de un titular, nunca para
párrafos completos.

[pegar acá el contenido de pitch.md]
```

---

*Generado a partir del código real de la marca (`frontend/app/page.tsx`, `frontend/app/layout.tsx`,
`frontend/public/logo-mark.svg`) y del estado real del proyecto al 2026-08-08, no de una
descripción genérica. Cifras de mercado (bodegas en Perú, participación de Sip en el mercado
de billeteras) verificadas por búsqueda web el mismo día — fuentes: Asociación de Bodegueros del Perú (ABP,
vía La República/Andina), INEI (Censo Económico), Kantar y Statista.*
