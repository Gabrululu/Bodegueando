import { BuyerPanel } from "@/components/BuyerPanel";
import { Login } from "@/components/Login";

export default async function PagarPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;

  return (
    <div className="flex flex-col flex-1 items-center bg-[#fafaf7] [font-family:var(--font-geist-sans)]">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 px-6 py-16 text-center">
        <div className="space-y-3">
          <div className="flex items-center justify-center gap-2.5">
            <img src="/logo-mark.svg" alt="" className="h-9 w-9 shrink-0" />
            <h1 className="text-3xl font-semibold tracking-tight text-[#0a0a0b] [font-family:var(--font-bricolage)]">
              Bodegueando
            </h1>
          </div>
          <p className="text-[#55564f]">Vas a pagarle a esta bodega.</p>
        </div>

        <Login />

        <BuyerPanel initialCode={code} />
      </main>
    </div>
  );
}
