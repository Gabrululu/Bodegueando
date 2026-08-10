import Link from "next/link";

const SIGNAL = "#c9e265";
const SIGNAL_BRIGHT = "#d6f17b";
const SIGNAL_DEEP = "#aec846";
const INK = "#0a0a0b";

const FEATURES = [
  {
    title: "Cobra con un código",
    body: "Muestras un código o un QR en tu bodega. Tu cliente lo escanea con la cámara de su celular, paga y listo — sin cables, sin máquinas raras.",
  },
  {
    title: "Junta puntos con cada compra",
    body: "Cada vez que alguien te paga, gana puntos de regalo que puede usar después. Como un sello de fidelidad, pero automático — nadie tiene que anotar nada a mano.",
  },
  {
    title: "Fiado sin arriesgarte",
    body: "El sistema recuerda quién paga bien y te dice cuánto es prudente fiarle a cada cliente. Tú siempre tienes la última palabra.",
  },
  {
    title: "Construye tu historial",
    body: "Cada venta que registras queda como parte de la historia de tu bodega. Con el tiempo, ese historial puede ayudarte a conseguir un préstamo — sin mostrarle a nadie tus cuentas exactas.",
  },
];

const MORE = [
  {
    title: "Premios para tus clientes",
    body: "Tus clientes cambian los puntos que ganan por premios que tú eliges — un producto, un sorteo, lo que quieras ofrecer.",
  },
  {
    title: "Bodegas cerca de ti",
    body: "Aparece en un mapa para que la gente de tu zona te encuentre fácil, y encuentra tú también a otras bodegas cercanas.",
  },
  {
    title: "Compra en grupo, paga menos",
    body: "Júntate con otras bodegas del barrio para pedir mercadería juntas y llegar a mejores precios con tus proveedores.",
  },
];

const STEPS = [
  {
    n: "01",
    title: "Entra con tu celular",
    body: "Con tu número o tu correo, nada más. Sin contraseñas complicadas ni papeles que firmar.",
  },
  {
    n: "02",
    title: "Muestra tu código",
    body: "Tu bodega tiene su propio código para cobrar. Lo enseñas al cliente y ya está.",
  },
  {
    n: "03",
    title: "Cobra en soles",
    body: "Todo se ve en soles, como cualquier otra app. Nada de monedas ni palabras raras en la pantalla.",
  },
  {
    n: "04",
    title: "Junta puntos y fía",
    body: "Ganas puntos con cada venta y, cuando quieras, puedes empezar a fiarle a tus clientes de confianza.",
  },
];

const TRUST = [
  {
    title: "Nadie borra un pago",
    body: "Una vez que un cliente te paga, queda anotado para siempre. Nadie puede inventar que no pagó ni hacerlo desaparecer.",
  },
  {
    title: "Tú decides a quién fiar",
    body: "El sistema te sugiere en quién confiar según su historial, pero la decisión final siempre es tuya. Puedes apagarlo cuando quieras.",
  },
  {
    title: "Tus puntos son tuyos",
    body: "Los puntos que ganas se quedan contigo. Nadie te los puede quitar ni cambiar las reglas de un día para otro.",
  },
];

function KickerLight({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-[#6b6d64]">
      <span className="h-2 w-2 shrink-0" style={{ background: SIGNAL_DEEP }} />
      {children}
    </p>
  );
}

function KickerDark({ children }: { children: React.ReactNode }) {
  return (
    <p className="flex items-center gap-2.5 text-[11.5px] font-bold uppercase tracking-[0.14em] text-[#a6a89f]">
      <span className="h-2 w-2 shrink-0" style={{ background: SIGNAL }} />
      {children}
    </p>
  );
}

function PrimaryButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex min-h-[52px] items-center gap-4 rounded-full px-5 pl-6 text-[15px] font-semibold transition-transform hover:-translate-y-0.5"
      style={{
        color: INK,
        background: `linear-gradient(180deg, ${SIGNAL_BRIGHT} 0%, ${SIGNAL} 100%)`,
        boxShadow: "inset 0 2px #ffffff57, inset 0 -4px #58691633, 0 12px 28px #6b811c47",
      }}
    >
      {children}
      <span
        className="grid h-7 w-7 place-items-center rounded-full text-base transition-transform group-hover:translate-x-0.5"
        style={{ background: "#00000014" }}
      >
        →
      </span>
    </Link>
  );
}

function SecondaryButtonDark({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="group inline-flex min-h-[52px] items-center gap-3 rounded-full border border-white/20 bg-white/[0.06] px-6 text-[15px] font-semibold text-white transition-colors hover:border-white/40"
    >
      {children}
      <span className="text-base transition-transform group-hover:translate-x-0.5">→</span>
    </Link>
  );
}

export default function Home() {
  return (
    <div className="flex-1 bg-[#fafaf7] text-[#0a0a0b] [font-family:var(--font-geist-sans)] selection:bg-[#c9e26566]">
      {/* nav */}
      <header className="sticky top-0 z-20 border-b border-black/[0.08] bg-[#fafaf7]/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <span className="flex items-center gap-2.5">
            <img src="/logo-mark.svg" alt="" className="h-8 w-8 shrink-0" />
            <span className="text-base font-semibold tracking-tight text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              Bodegueando
            </span>
          </span>
          <nav className="hidden items-center gap-8 text-sm font-medium text-[#42433d] sm:flex">
            <a href="#como-funciona" className="transition-colors hover:text-[#0a0a0b]">
              Cómo funciona
            </a>
            <a href="#fiado" className="transition-colors hover:text-[#0a0a0b]">
              Fiado
            </a>
            <a href="#mas" className="transition-colors hover:text-[#0a0a0b]">
              Más beneficios
            </a>
            <a href="#confianza" className="transition-colors hover:text-[#0a0a0b]">
              Confianza
            </a>
          </nav>
          <Link
            href="/app"
            className="inline-flex items-center gap-2 rounded-full px-4 py-2 text-xs font-bold transition-transform hover:-translate-y-0.5"
            style={{
              color: INK,
              background: `linear-gradient(180deg, ${SIGNAL_BRIGHT} 0%, ${SIGNAL} 100%)`,
              boxShadow: "inset 0 1px #ffffff75, 0 8px 20px #6e841b38",
            }}
          >
            Ingresar
          </Link>
        </div>
      </header>

      {/* hero — dark, matches wibify's near-black hero gradient */}
      <section
        className="relative isolate overflow-hidden"
        style={{
          background:
            "radial-gradient(72rem 46rem at 50% -8%, #242620eb, transparent 62%), linear-gradient(#0e0e10 0%, #111113 45%, #131316 78%, #191b12 100%)",
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10"
          style={{
            background:
              "radial-gradient(34rem 24rem at 8% 48%, #c9e2651a, transparent 70%), radial-gradient(40rem 28rem at 92% 62%, #aec84614, transparent 72%)",
          }}
        />
        <div className="relative mx-auto flex max-w-4xl flex-col items-center px-6 pb-24 pt-20 text-center sm:pt-28">
          <span className="mb-7 inline-flex items-center gap-2.5 rounded-full bg-[#ffffffe6] px-4 py-2 text-sm font-semibold text-[#191a17] shadow-lg">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: SIGNAL_DEEP }} />
            Hecho para tu bodega de barrio
          </span>
          <h1 className="max-w-3xl text-balance text-[clamp(2.6rem,6vw,4.6rem)] font-semibold leading-[0.95] tracking-[-0.045em] text-[#fafaf6] [font-family:var(--font-bricolage)]">
            Cobra, junta puntos
          </h1>
          <span
            className="mt-1 block text-balance text-[clamp(2.3rem,5.2vw,4rem)] font-normal italic leading-[0.95] tracking-[-0.02em] [font-family:var(--font-instrument-serif)]"
            style={{ color: SIGNAL }}
          >
            y fía sin arriesgarte.
          </span>
          <p className="mt-7 max-w-xl text-balance text-base font-medium text-[#b2b4ab] sm:text-lg">
            Cobra con un código, tus clientes ganan puntos por cada compra y tú decides
            a quién fiarle. Todo en soles, todo fácil, sin trámites raros.
          </p>
          <div className="mt-10 flex flex-col items-center gap-4 sm:flex-row">
            <PrimaryButton href="/app">Empezar a pagar</PrimaryButton>
            <SecondaryButtonDark href="/app">Soy bodeguero</SecondaryButtonDark>
          </div>

          <div className="mt-16 grid w-full grid-cols-1 gap-px overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.08] sm:grid-cols-3">
            {[
              ["QR", "cobra al toque, sin cables"],
              ["S/", "todo en soles, nunca otra cosa"],
              ["★", "puntos que premian a tus clientes"],
            ].map(([stat, label]) => (
              <div key={label} className="bg-[#111113] px-6 py-6 text-left">
                <div
                  className="text-2xl font-bold [font-family:var(--font-bricolage)]"
                  style={{ color: SIGNAL }}
                >
                  {stat}
                </div>
                <div className="mt-1 text-xs font-medium text-[#8f9189]">{label}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* features — light */}
      <section className="bg-[#fafaf7] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-xl">
            <KickerLight>Lo esencial</KickerLight>
            <h2 className="mt-4 text-[clamp(1.9rem,3.4vw,2.6rem)] font-medium leading-[0.98] tracking-[-0.05em] text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              Todo lo que necesita una bodega de barrio
            </h2>
            <p className="mt-3 text-[#55564f]">
              Sin líos, sin palabras raras — solo cobrar, juntar puntos y fiar cuando quieras.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((f) => (
              <div
                key={f.title}
                className="rounded-[20px] border border-black/[0.1] bg-[#fffffc] p-6 shadow-sm transition-colors hover:border-black/20"
              >
                <div
                  className="mb-4 grid h-11 w-11 place-items-center rounded-xl"
                  style={{ background: "#c9e26521", color: SIGNAL_DEEP }}
                >
                  <span className="text-lg font-bold">✓</span>
                </div>
                <h3 className="text-base font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                  {f.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#55564f]">{f.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* how it works — dark */}
      <section id="como-funciona" className="border-t border-white/10 bg-[#111113] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <KickerDark>Paso a paso</KickerDark>
          <h2 className="mt-4 text-[clamp(1.9rem,3.4vw,2.6rem)] font-medium leading-[0.98] tracking-[-0.05em] text-[#fafaf6] [font-family:var(--font-bricolage)]">
            Cómo funciona
          </h2>
          <div className="mt-12 grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s) => (
              <div key={s.n}>
                <div
                  className="text-sm font-bold [font-family:var(--font-bricolage)]"
                  style={{ color: SIGNAL }}
                >
                  {s.n}
                </div>
                <h3 className="mt-3 text-base font-semibold text-[#fafaf6] [font-family:var(--font-bricolage)]">
                  {s.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#a9aba1]">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* fiado — light, editorial-style panel */}
      <section id="fiado" className="bg-[#fafaf7] px-6 py-24">
        <div
          className="mx-auto max-w-6xl rounded-[24px] border border-[#2a30161f] p-10 shadow-sm sm:p-14"
          style={{ background: "linear-gradient(145deg, #c9e26521, #fffffce6)" }}
        >
          <div className="max-w-2xl">
            <KickerLight>Fiado</KickerLight>
            <h2 className="mt-4 text-[clamp(1.9rem,3.4vw,2.6rem)] font-medium leading-[1.02] tracking-[-0.05em] text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              Sabes a quién fiarle,
              <span
                className="mt-1 block text-[0.92em] font-normal italic [font-family:var(--font-instrument-serif)]"
                style={{ color: "#718817" }}
              >
                sin adivinar y sin arriesgarte.
              </span>
            </h2>
            <p className="mt-5 text-[#42433d]">
              El sistema mira el historial real de compras de cada cliente y te sugiere
              cuánto es prudente fiarle, explicándotelo en español sencillo. Nunca es
              obligatorio: cada bodega decide si quiere fiar, y a quién.
            </p>
            <p className="mt-3 text-[#42433d]">
              Y con el tiempo, ese mismo historial puede ser justo lo que le faltaba a tu
              bodega para acceder a un préstamo — sin tener que mostrarle a nadie tus cuentas
              exactas, línea por línea.
            </p>
          </div>
        </div>
      </section>

      {/* more — light, everything beyond charging */}
      <section id="mas" className="bg-[#fafaf7] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-xl">
            <KickerLight>Más beneficios</KickerLight>
            <h2 className="mt-4 text-[clamp(1.9rem,3.4vw,2.6rem)] font-medium leading-[0.98] tracking-[-0.05em] text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              Bodegueando es más que cobrar
            </h2>
            <p className="mt-3 text-[#55564f]">
              La misma cuenta te da acceso a esto, cuando quieras usarlo.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {MORE.map((m) => (
              <div
                key={m.title}
                className="rounded-[20px] border border-black/[0.1] bg-[#fffffc] p-6 shadow-sm transition-colors hover:border-black/20"
              >
                <h3 className="text-base font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                  {m.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#55564f]">{m.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* trust — light, simple reasons to believe */}
      <section id="confianza" className="bg-[#fafaf7] px-6 py-24">
        <div className="mx-auto max-w-6xl">
          <div className="max-w-xl">
            <KickerLight>Confianza</KickerLight>
            <h2 className="mt-4 text-[clamp(1.9rem,3.4vw,2.6rem)] font-medium leading-[0.98] tracking-[-0.05em] text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              Por qué puedes confiar
            </h2>
            <p className="mt-3 text-[#55564f]">
              Nada se hace a mano ni se puede alterar después — todo queda anotado tal
              cual pasó.
            </p>
          </div>
          <div className="mt-12 grid grid-cols-1 gap-4 sm:grid-cols-3">
            {TRUST.map((t) => (
              <div
                key={t.title}
                className="rounded-[20px] border border-black/[0.1] bg-[#fffffc] p-6 shadow-sm"
              >
                <h3 className="text-base font-semibold text-[#0a0a0b] [font-family:var(--font-bricolage)]">
                  {t.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[#55564f]">{t.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* final cta — dark, signal glow */}
      <section className="border-t border-white/10 bg-[#111113] px-6 py-24">
        <div
          className="relative mx-auto flex max-w-6xl flex-col items-center overflow-hidden rounded-[24px] border border-white/10 px-6 py-16 text-center"
          style={{ background: "radial-gradient(34rem 20rem at 88% 0%, #c9e2651a, transparent 65%), #1a1a1d" }}
        >
          <h2 className="text-balance text-[clamp(1.9rem,3.4vw,2.6rem)] font-medium tracking-[-0.05em] text-[#fafaf6] [font-family:var(--font-bricolage)]">
            Empieza hoy mismo
          </h2>
          <p className="mt-3 max-w-md text-[#b0b2aa]">
            Regístrate en segundos con tu teléfono o correo. Sin trámites, sin líos, sin
            nada que instalar.
          </p>
          <div className="mt-8">
            <PrimaryButton href="/app">Empezar ahora</PrimaryButton>
          </div>
        </div>
      </section>

      <footer className="border-t border-white/10 bg-[#0b0b0c] px-6 py-10">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-center gap-2 text-center text-xs font-medium text-[#777972]">
          <span>Bodegueando — hecho para bodegas de barrio del Perú.</span>
        </div>
      </footer>
    </div>
  );
}
