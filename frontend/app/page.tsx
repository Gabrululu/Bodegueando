import { PasskeyLogin } from "@/components/PasskeyLogin";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-xl flex-col items-center gap-8 px-6 py-32 text-center">
        <div className="space-y-3">
          <h1 className="text-3xl font-semibold tracking-tight text-black dark:text-zinc-50">
            Bodegueando
          </h1>
          <p className="text-zinc-600 dark:text-zinc-400">
            Cobros por QR, cashback y fiado inteligente para bodegas de barrio en Lima,
            construido sobre Arbitrum (Solidity + Stylus).
          </p>
        </div>
        <PasskeyLogin />
      </main>
    </div>
  );
}
